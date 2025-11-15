import express from 'express';
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';
import db from '../lib/db.js';

const router = express.Router();

function safeSendJson(res, payload, label = "") {
  // si ya se envió una respuesta, loggear y no intentar enviar otra
  if (res.headersSent) {
    console.warn(`[safeSendJson] headers already sent — skip response (${label})`);
    // imprime stack para saber dónde fue el primer res
    console.warn(new Error("safeSendJson: attempted second response").stack);
    return false;
  }
  try {
    console.log(`[safeSendJson] sending response (${label})`);
    res.json(payload);
    return true;
  } catch (err) {
    console.error("[safeSendJson] error sending response:", err);
    return false;
  }
}

export default function createVideoRoutes({ jobsDir }) {
  // List all persisted pairs (jobs) for a given workspace
  router.get("/workspaces/:workspaceId/pairs", async (req, res) => {
    const { workspaceId } = req.params;
    const host = `${req.protocol}://${req.get("host")}`;
    console.log(`[GET /workspaces/${workspaceId}/pairs] start - pid=${process.pid} - ts=${new Date().toISOString()}`);

    let dbRows = [];
    try {
      await db.init();
      const r = await db.query(
        "SELECT id, job_external_id, workspace_id, title, status, created_at FROM videos WHERE workspace_id = $1 ORDER BY created_at DESC",
        [workspaceId]
      );
      dbRows = r.rows || [];
      console.log(`[GET /workspaces/${workspaceId}/pairs] loaded ${dbRows.length} rows from DB`);
    } catch (dbErr) {
      console.warn(`[GET /workspaces/${workspaceId}/pairs] DB error: ${dbErr?.message}`);
      dbRows = []; // permitimos fallback a filesystem
    }

    // Helper: leer metadata.json seguro dentro de jobsDir
    const readMeta = (jobId) => {
      const metaPath = path.join(jobsDir, jobId, "metadata.json");
      if (!fs.existsSync(metaPath)) return null;
      try {
        const raw = fs.readFileSync(metaPath, "utf8");
        const parsed = JSON.parse(raw);
        return parsed;
      } catch (e) {
        console.warn(`[GET /workspaces/${workspaceId}/pairs] invalid metadata.json for ${jobId}: ${e.message}`);
        return { _invalid: true };
      }
    };

    // Si la BD no devolvió nada, listamos todas las carpetas del jobsDir (filesystem-only mode)
    let jobs = [];
    
    // Si la BD devolvió rows, por cada row forzamos la lectura de metadata.json y la usamos para sobrescribir
    jobs = dbRows.map((row) => {
      const jobId = row.job_external_id || row.id;
      const meta = readMeta(jobId);
      const usedSource = meta ? (meta._invalid ? "meta_invalid" : "meta_file") : "db_only";
      if (!meta) {
        // no hay metadata.json => usar lo de la BD (pero sin campo metadata antiguo)
        return {
          jobId,
          dbId: row.id,
          workspaceId: row.workspace_id,
          title: row.title || null,
          status: row.status || "unknown",
          createdAt: row.created_at || null,
          metadata: null,
          metadataSource: "db",
          urls: buildUrls(jobId)
        };
      } else if (meta._invalid) {
        return {
          jobId,
          dbId: row.id,
          workspaceId: row.workspace_id,
          title: row.title || meta.title || null,
          status: meta.status || row.status || "unknown",
          createdAt: meta.createdAt || row.created_at || null,
          metadata: null,
          metadataSource: "invalid_file",
          urls: buildUrls(jobId)
        };
      } else {
        // metadata válido: usarlo como verdad (sobrescribe)
        return {
          jobId,
          dbId: row.id,
          workspaceId: row.workspace_id || meta.workspaceId || null,
          title: meta.title || row.title || null,
          status: meta.status || row.status || "unknown",
          createdAt: meta.createdAt || row.created_at || null,
          metadata: meta,
          metadataSource: "file",
          urls: buildUrls(jobId)
        };
      }
    });

    // small util
    function buildUrls(id) {
      return {
        file: `${host}/jobs/${id}/file`,
        presentation: `${host}/jobs/${id}/presentation`,
        thumbnail: `${host}/jobs/${id}/thumbnail`
      };
    }

    console.log(`[GET /workspaces/${workspaceId}/pairs] returning ${jobs.length} jobs (first metadataSource=${jobs[0]?.metadataSource})`);
    return res.json(jobs);
  });

    router.get("/jobs/:id", async (req, res) => {
    const { id } = req.params;
    const host = `${req.protocol}://${req.get("host")}`;
    console.log(`[GET /jobs/${id}] start`);

    let dbRow = null;
    try {
      await db.init();
      dbRow = await db.getVideoByJobExternalId(id);
    } catch (e) {
      console.warn(`[GET /jobs/${id}] DB read failed: ${e.message}`);
    }

    const metaPath = path.join(jobsDir, id, "metadata.json");
    if (!fs.existsSync(metaPath)) {
      return res.status(404).json({ error: "job not found" });
    }

    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    } catch (e) {
      console.error(`[GET /jobs/${id}] invalid metadata.json: ${e.message}`);
      return res.status(500).json({ error: "invalid metadata.json" });
    }

    const merged = {
      jobId: id,
      workspaceId: dbRow?.workspace_id || meta.workspaceId || null,
      title: dbRow?.title || meta.title || null,
      ...meta,
      urls: {
        file: `${host}/jobs/${id}/file`,
        presentation: `${host}/jobs/${id}/presentation`,
        thumbnail: `${host}/jobs/${id}/thumbnail`
      },
      metadataSource: "file"
    };

    console.log(`[GET /jobs/${id}] returning metadata from file (merged)`);
    return res.json(merged);
  });

  // Serve the main media file (audio or video) for a job
  router.get('/jobs/:id/file', (req, res) => {
    const id = req.params.id;
    const metaPath = path.join(jobsDir, id, 'metadata.json');
    if (!fs.existsSync(metaPath)) return res.status(404).json({ error: 'job not found' });
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      const filePath = path.resolve(process.cwd(), meta.audio);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file not found' });

      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = req.headers.range;

      const ext = path.extname(filePath).toLowerCase();
      const mimeType = ext === '.mp4' ? 'video/mp4' : ext === '.mp3' ? 'audio/mpeg' : ext === '.m4a' ? 'audio/mp4' : 'application/octet-stream';

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        if (start >= fileSize || end >= fileSize) {
          res.status(416).set({ 'Content-Range': `bytes */${fileSize}` }).end();
          return;
        }
        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(filePath, { start, end });
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': mimeType,
        });
        file.pipe(res);
      } else {
        res.writeHead(200, { 'Content-Length': fileSize, 'Content-Type': mimeType });
        fs.createReadStream(filePath).pipe(res);
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Serve the presentation (PDF/PPTX) for a job
  router.get('/jobs/:id/presentation', (req, res) => {
    const id = req.params.id;
    const metaPath = path.join(jobsDir, id, 'metadata.json');
    if (!fs.existsSync(metaPath)) return res.status(404).json({ error: 'job not found' });
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      const filePath = path.resolve(process.cwd(), meta.presentation);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'presentation not found' });
      const ext = path.extname(filePath).toLowerCase();
      const filename = path.basename(filePath);
      if (ext === '.pdf') {
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      } else {
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      }
      res.sendFile(filePath);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Generate (if needed) and serve a thumbnail image for the job's video
  router.get('/jobs/:id/thumbnail', (req, res) => {
    const id = req.params.id;
    const metaPath = path.join(jobsDir, id, 'metadata.json');
    if (!fs.existsSync(metaPath)) return res.status(404).json({ error: 'job not found' });
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      const mediaPath = path.resolve(process.cwd(), meta.audio);
      if (!fs.existsSync(mediaPath)) return res.status(404).json({ error: 'media not found' });
      const thumbPath = path.join(jobsDir, id, 'thumbnail.jpg');
      if (fs.existsSync(thumbPath)) {
        return res.sendFile(thumbPath);
      }
      res.status(404).json({ error: 'thumbnail not found' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Detailed endpoint: return media URLs and parsed transcript segments
  router.get('/jobs/:id/detailed', (req, res) => {
    const id = req.params.id;
    const metaPath = path.join(jobsDir, id, 'metadata.json');
    if (!fs.existsSync(metaPath)) return res.status(404).json({ error: 'job not found' });
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      const host = req.protocol + '://' + req.get('host');
      const result = {
        jobId: meta.jobId || id,
        urls: {
          file: `${host}/jobs/${id}/file`,
          presentation: `${host}/jobs/${id}/presentation`,
          thumbnail: `${host}/jobs/${id}/thumbnail`,
        },
        segments: [],
      };

      // try to read transcripts from job-local folder or global /transcripts folder (prefer job-local), else parse stdout
      const jobLocal = path.join(jobsDir, id, 'transcripts');
      const globalTrans = path.resolve(process.cwd(), 'transcripts');
      const transcriptsDir = fs.existsSync(jobLocal) ? jobLocal : (fs.existsSync(globalTrans) ? globalTrans : null);

      if (transcriptsDir) {
        let files = fs.readdirSync(transcriptsDir).filter(f => f.match(/\.srt$|\.vtt$|\.txt$/i));
        files = files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

        function getDurationSeconds(filePath) {
          try {
            const ff = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath], { encoding: 'utf-8' });
            if (ff.status !== 0) return null;
            const val = parseFloat((ff.stdout || '').trim());
            return Number.isFinite(val) ? val : null;
          } catch (e) { return null; }
        }

        function secondsToTimestamp(sec) {
          if (sec == null || Number.isNaN(sec)) return null;
          const total = Math.max(0, sec);
          const hh = Math.floor(total / 3600);
          const mm = Math.floor((total % 3600) / 60);
          const s = Math.floor(total % 60);
          const ms = Math.round((total - Math.floor(total)) * 1000);
          const pad2 = (n) => String(n).padStart(2, '0');
          const pad3 = (n) => String(n).padStart(3, '0');
          if (hh > 0) return `${pad2(hh)}:${pad2(mm)}:${pad2(s)}.${pad3(ms)}`;
          return `${pad2(mm)}:${pad2(s)}.${pad3(ms)}`;
        }

        let cumulativeOffset = 0;
        for (const f of files) {
          const txt = fs.readFileSync(path.join(transcriptsDir, f), 'utf-8');
          // fileOffset is current cumulativeOffset (sum of previous chunks' durations)
          let fileOffset = cumulativeOffset;

          // try to detect a chunk file for this transcript to add its duration after processing
          const mName = f.match(/chunk[_-]?(\d+)/i);
          let candidateDuration = null;
          if (mName) {
            const idx = parseInt(mName[1], 10);
            const candidate = path.resolve(process.cwd(), 'chunks', `chunk_${String(idx).padStart(3, '0')}.mp4`);
            if (fs.existsSync(candidate)) {
              candidateDuration = getDurationSeconds(candidate);
            }
          }

          // Robust SRT block parsing: split on blank lines and handle optional numeric index lines
          const blocks = txt.split(/\r?\n\r?\n/).map(b => b.trim()).filter(Boolean);
          for (const block of blocks) {
            const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            if (lines.length === 0) continue;
            // find the line that contains the timestamp separator
            const tsLineIndex = lines.findIndex(l => l.includes('-->'));
            if (tsLineIndex === -1) continue;
            const tsLine = lines[tsLineIndex];
            // strip optional numeric index if it's on the first line (e.g., '1')
            // timestamp may be on line 0 or 1 depending on SRT
            const [rawStartRaw, rawEndRaw] = tsLine.split(/-->/).map(s => s.trim());
            if (!rawStartRaw || !rawEndRaw) continue;
            const rawStart = rawStartRaw;
            const rawEnd = rawEndRaw;
            const textLines = lines.slice(tsLineIndex + 1);
            let text = textLines.join(' ').trim();
            // remove any trailing numeric-only tokens that accidentally remain
            text = text.replace(/\s*\d+\s*$/g, '').trim();
            const relStart = toSeconds(rawStart);
            const relEnd = toSeconds(rawEnd);
            const absStart = (relStart != null ? relStart : 0) + fileOffset;
            const absEnd = (relEnd != null ? relEnd : 0) + fileOffset;
            result.segments.push({ start: secondsToTimestamp(absStart), end: secondsToTimestamp(absEnd), text, startSec: absStart, endSec: absEnd });
          }

          if (candidateDuration != null) {
            cumulativeOffset += candidateDuration;
          } else {
            const last = result.segments[result.segments.length - 1];
            if (last && typeof last.endSec === 'number') cumulativeOffset = Math.max(cumulativeOffset, last.endSec);
          }
        }
        // sort segments by absolute time
        if (result.segments.length > 0) result.segments.sort((a, b) => (a.startSec || 0) - (b.startSec || 0));
      } else if (meta.stdout) {
        // parse timestamps from meta.stdout using pattern like [00:00.000 --> 00:08.080]
        const regex = /\[(\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}:\d{2}\.\d{3})\]\s*([^\n\[]+)/g;
        let m;
        while ((m = regex.exec(meta.stdout)) !== null) {
          result.segments.push({ start: m[1], end: m[2], text: m[3].trim() });
        }
        // if no bracket timestamps found, try inline bracketless pattern like [00:00.000 --> 00:08.080]
        if (result.segments.length === 0) {
          const regex2 = /(\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}\.\d{3})\s*([^\n]+)/g;
          while ((m = regex2.exec(meta.stdout)) !== null) {
            result.segments.push({ start: m[1], end: m[2], text: m[3].trim() });
          }
        }
      }

      // deduplicate exact segments (startSec, endSec, text) to avoid double-processing
      if (result.segments && result.segments.length > 0) {
        const seen = new Set();
        result.segments = result.segments.filter(s => {
          const key = `${Math.round((s.startSec||0)*1000)}_${Math.round((s.endSec||0)*1000)}_${(s.text||'').slice(0,200)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }

      // enrich segments with numeric seconds for easier seeking
      function toSeconds(ts) {
        // accept formats: mm:ss.mmm or hh:mm:ss.mmm and support comma decimals
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
      // helper: format seconds to HH:MM:SS (always zero-padded)
      function formatNoMs(sec) {
        if (sec == null || Number.isNaN(sec)) return null;
        const total = Math.max(0, Math.floor(sec));
        const hh = Math.floor(total / 3600);
        const mm = Math.floor((total % 3600) / 60);
        const ss = total % 60;
        const pad2 = (n) => String(n).padStart(2, '0');
        return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
      }

      // ensure segments have numeric seconds and formatted start/end without ms
      result.segments = result.segments.map(s => {
        const startSec = typeof s.startSec === 'number' ? s.startSec : toSeconds(s.start);
        const endSec = typeof s.endSec === 'number' ? s.endSec : toSeconds(s.end);
        return { ...s, start: formatNoMs(startSec), end: formatNoMs(endSec), startSec, endSec };
      });
      // sort by startSec just in case
      result.segments.sort((a, b) => (a.startSec || 0) - (b.startSec || 0));
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
