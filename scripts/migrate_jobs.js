#!/usr/bin/env node
/*
  Script to migrate existing jobs under ./jobs into Postgres via lib/db.js
  - Inserts a videos row per job (if not present)
  - Parses job-local transcripts (jobs/<id>/transcripts/*.srt) and inserts transcript_segments
  - Attempts to detect chunk durations from ./chunks/chunk_XXX.mp4 and insert video_chunks

  Usage:
    DATABASE_URL=postgres://user:pass@host:5432/db node scripts/migrate_jobs.js
*/
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import db from '../lib/db.js';

const JOBS_DIR = process.env.JOBS_DIR || path.resolve(process.cwd(), 'jobs');
const CHUNKS_DIR = process.env.CHUNKS_DIR || path.resolve(process.cwd(), 'chunks');

function toSeconds(ts) {
  if (!ts) return null;
  const parts = ts.split(':').map(p => p.trim());
  if (parts.length === 2) {
    const mm = parseInt(parts[0], 10);
    const ss = parseFloat(parts[1].replace(',', '.'));
    if (Number.isNaN(mm) || Number.isNaN(ss)) return null;
    return mm * 60 + ss;
  } else if (parts.length === 3) {
    const hh = parseInt(parts[0], 10);
    const mm = parseInt(parts[1], 10);
    const ss = parseFloat(parts[2].replace(',', '.'));
    if (Number.isNaN(hh) || Number.isNaN(mm) || Number.isNaN(ss)) return null;
    return hh * 3600 + mm * 60 + ss;
  }
  return null;
}

function getDurationSeconds(filePath) {
  try {
    const ff = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath], { encoding: 'utf-8' });
    if (ff.status !== 0) return null;
    const val = parseFloat((ff.stdout || '').trim());
    return Number.isFinite(val) ? val : null;
  } catch (e) { return null; }
}

async function processJob(jobId) {
  const jobDir = path.join(JOBS_DIR, jobId);
  const metaPath = path.join(jobDir, 'metadata.json');
  if (!fs.existsSync(metaPath)) return console.log('skip', jobId, 'no metadata');
  const raw = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

  await db.init();
  const existing = await db.getVideoByJobExternalId(jobId);
  if (existing) {
    console.log('skipping existing job', jobId);
    return;
  }

  const video = await db.createVideo({
    jobExternalId: jobId,
    workspaceId: null,
    rubricId: null,
    title: raw.title || jobId,
    originalPath: raw.audio || null,
    presentationPath: raw.presentation || null,
    thumbnailPath: fs.existsSync(path.join(jobDir, 'thumbnail.jpg')) ? path.join(jobDir, 'thumbnail.jpg') : null,
    status: raw.status || 'unknown',
    durationSeconds: null,
    metadata: raw
  });
  console.log('created video', video.id, 'for job', jobId);

  // video chunks: try to detect chunk files by naming convention chunk_000.mp4 etc.
  // We'll look for files chunk_XXX.* in CHUNKS_DIR and insert those where index matches.
  const chunkFiles = fs.existsSync(CHUNKS_DIR) ? fs.readdirSync(CHUNKS_DIR).filter(f => /^chunk_\d+\.(mp4|mp3|m4a)$/i.test(f)) : [];
  for (const cf of chunkFiles) {
    const m = cf.match(/chunk_(\d+)\./i);
    if (!m) continue;
    const idx = parseInt(m[1], 10);
    const filePath = path.join(CHUNKS_DIR, cf);
    const dur = getDurationSeconds(filePath);
    if (dur == null) continue;
    await db.insertVideoChunk({ videoId: video.id, chunkIndex: idx, filePath: path.relative(process.cwd(), filePath), durationSeconds: dur });
    console.log('inserted chunk', cf, 'dur', dur);
  }

  // transcripts in job-local transcripts dir
  const transcriptsDir = path.join(jobDir, 'transcripts');
  let cumulativeOffset = 0;
  if (fs.existsSync(transcriptsDir)) {
    const files = fs.readdirSync(transcriptsDir).filter(f => f.match(/\.srt$|\.vtt$|\.txt$/i)).sort();
    for (const f of files) {
      const txt = fs.readFileSync(path.join(transcriptsDir, f), 'utf-8');
      // detect chunk index for offset
      const mName = f.match(/chunk[_-]?(\d+)/i);
      if (mName) {
        const idx = parseInt(mName[1], 10);
        const candidate = path.join(CHUNKS_DIR, `chunk_${String(idx).padStart(3, '0')}.mp4`);
        if (fs.existsSync(candidate)) {
          const cd = getDurationSeconds(candidate);
          if (cd != null) {
            // use existing cumulativeOffset (do not update immediately since this file contains relative timestamps), but after processing we set offset += cd
          }
        }
      }

      const blocks = txt.split(/\r?\n\r?\n/).map(b => b.trim()).filter(Boolean);
      for (const block of blocks) {
        const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length === 0) continue;
        const tsLineIndex = lines.findIndex(l => l.includes('-->'));
        if (tsLineIndex === -1) continue;
        const tsLine = lines[tsLineIndex];
        const [rawStartRaw, rawEndRaw] = tsLine.split(/-->/).map(s => s.trim());
        if (!rawStartRaw || !rawEndRaw) continue;
        const rawStart = rawStartRaw;
        const rawEnd = rawEndRaw;
        const textLines = lines.slice(tsLineIndex + 1);
        let text = textLines.join(' ').trim();
        text = text.replace(/\s*\d+\s*$/g, '').trim();
        const relStart = toSeconds(rawStart);
        const relEnd = toSeconds(rawEnd);
        const absStart = (relStart != null ? relStart : 0) + cumulativeOffset;
        const absEnd = (relEnd != null ? relEnd : 0) + cumulativeOffset;
        await db.insertTranscriptSegment({ videoId: video.id, startSeconds: absStart, endSeconds: absEnd, text, source: 'srt' });
      }

      // after processing file, try to add candidate duration to cumulativeOffset
      const mName2 = f.match(/chunk[_-]?(\d+)/i);
      if (mName2) {
        const idx = parseInt(mName2[1], 10);
        const candidate = path.join(CHUNKS_DIR, `chunk_${String(idx).padStart(3, '0')}.mp4`);
        if (fs.existsSync(candidate)) {
          const cd = getDurationSeconds(candidate);
          if (cd != null) {
            cumulativeOffset += cd;
          }
        }
      } else {
        // attempt to use last inserted transcript end as new offset
        const last = await db.query('SELECT end_seconds FROM transcript_segments WHERE video_id=$1 ORDER BY end_seconds DESC LIMIT 1', [video.id]);
        if (last && last.rows && last.rows[0]) cumulativeOffset = Math.max(cumulativeOffset, parseFloat(last.rows[0].end_seconds));
      }
    }
  }

  console.log('finished migrating job', jobId);
}

async function run() {
  try {
    await db.init();
    const jobs = fs.readdirSync(JOBS_DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
    for (const j of jobs) {
      try {
        await processJob(j);
      } catch (e) {
        console.error('failed job', j, e.message);
      }
    }
    console.log('migration complete');
    process.exit(0);
  } catch (e) {
    console.error('migration runner failed', e.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith('migrate_jobs.js')) run();
