import express from 'express';
import path from 'path';
import fs from 'fs';
import db from '../lib/db.js';

const router = express.Router();

export default function createEvaluateRoutes({ upload, jobsDir }) {
  // Obtener la evaluacion de la IA y toda la info del video (sin su transcripción)
  router.get('/video/:videoJobId/evaluation', async (req, res) => {
    const { videoJobId } = req.params;
    const host = `${req.protocol}://${req.get('host')}`;

    // Try DB first
    try {
      await db.init();
      const video = await db.getVideoByJobExternalId(videoJobId);
      if (video) {
        const r = await db.query('SELECT * FROM evaluations WHERE video_id = $1 ORDER BY id DESC', [video.id]);
        const urls = {
          file: `${host}/jobs/${videoJobId}/file`,
          presentation: `${host}/jobs/${videoJobId}/presentation`,
          thumbnail: `${host}/jobs/${videoJobId}/thumbnail`
        };
        return res.json({
          video: {
            id: video.id,
            jobExternalId: video.job_external_id,
            title: video.title,
            created_at: video.created_at || null,
            urls,
            playerUrl: `${host}/jobs/${videoJobId}`,
            detailedUrl: `${host}/jobs/${videoJobId}/detailed`
          },
          evaluations: r.rows || []
        });
      }
    } catch (e) {
      console.warn('[GET /video/:videoJobId/evaluation] DB error:', e && e.message ? e.message : String(e));
      // continue to filesystem fallback
    }

    // Fallback: try to read jobs/<jobId>/metadata.json for any evaluation notes
    try {
      const metaPath = path.join(jobsDir || path.resolve(process.cwd(), 'jobs'), videoJobId, 'metadata.json');
      if (!fs.existsSync(metaPath)) return res.status(404).json({ error: 'evaluation not found' });
      const raw = fs.readFileSync(metaPath, 'utf8');
      const meta = JSON.parse(raw);
      // metadata might contain an `evaluation` or `evaluations` field
      const evaluations = meta.evaluations || meta.evaluation || null;
      const urls = {
        file: `${host}/jobs/${videoJobId}/file`,
        presentation: `${host}/jobs/${videoJobId}/presentation`,
        thumbnail: `${host}/jobs/${videoJobId}/thumbnail`
      };
      return res.json({
        video: { jobId: videoJobId, title: meta.title || null, created_at: meta.createdAt || null, urls, playerUrl: `${host}/jobs/${videoJobId}`, detailedUrl: `${host}/jobs/${videoJobId}/detailed` },
        evaluations,
        metadata: meta
      });
    } catch (e) {
      console.error('[GET /video/:videoJobId/evaluation] FS error:', e && e.message ? e.message : String(e));
      return res.status(500).json({ error: 'failed to read evaluation' });
    }
  });

  // Allow updating an evaluation (any updatable field). Body may include `id` (evaluation id) or leave it out to update latest.
  router.patch('/video/:videoJobId/evaluation', async (req, res) => {
    const { videoJobId } = req.params;
    const payload = req.body || {};
    // normalize incoming keys to DB column names
    const mapPayload = {};
    if (payload.evaluatorId !== undefined) mapPayload.evaluator_id = payload.evaluatorId;
    if (payload.rubricId !== undefined) mapPayload.rubric_id = payload.rubricId;
    if (payload.scores !== undefined) mapPayload.scores = payload.scores;
    if (payload.total_score !== undefined) mapPayload.total_score = payload.total_score;
    if (payload.totalScore !== undefined && mapPayload.total_score === undefined) mapPayload.total_score = payload.totalScore;
    if (payload.notes !== undefined) mapPayload.notes = payload.notes;

    try {
      await db.init();
      const video = await db.getVideoByJobExternalId(videoJobId);
      if (!video) {
        // filesystem fallback: try to update metadata.json
        const metaPath = path.join(jobsDir || path.resolve(process.cwd(), 'jobs'), videoJobId, 'metadata.json');
        if (!fs.existsSync(metaPath)) return res.status(404).json({ error: 'video not found' });
        const raw = fs.readFileSync(metaPath, 'utf8');
        const meta = JSON.parse(raw);
        // support `evaluations` array or single `evaluation` object
        if (Array.isArray(meta.evaluations) && meta.evaluations.length > 0) {
          let idx = meta.evaluations.length - 1; // default to last
          if (payload.id) {
            const found = meta.evaluations.findIndex(e => (e.id && e.id === payload.id) || (e.id && String(e.id) === String(payload.id)));
            if (found !== -1) idx = found;
          }
          meta.evaluations[idx] = { ...meta.evaluations[idx], ...payload };
          fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
          return res.json({ ok: true, evaluation: meta.evaluations[idx] });
        } else if (meta.evaluation) {
          meta.evaluation = { ...meta.evaluation, ...payload };
          fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
          return res.json({ ok: true, evaluation: meta.evaluation });
        }
        return res.status(404).json({ error: 'no evaluation found in metadata' });
      }

      // choose evaluation id: provided id or latest for video
      let evalId = payload.id || null;
      if (!evalId) {
        const r = await db.query('SELECT id FROM evaluations WHERE video_id = $1 ORDER BY created_at DESC LIMIT 1', [video.id]);
        if (!r.rows || r.rows.length === 0) return res.status(404).json({ error: 'no evaluation found for video' });
        evalId = r.rows[0].id;
      }

      if (Object.keys(mapPayload).length === 0) return res.status(400).json({ error: 'no updatable fields provided' });

      const updated = await db.updateEvaluation(evalId, mapPayload);
      if (!updated) return res.status(404).json({ error: 'evaluation not found' });
      return res.json({ ok: true, evaluation: updated });
    } catch (e) {
      console.error('[PATCH /video/:videoJobId/evaluation] error:', e && e.message ? e.message : String(e));
      return res.status(500).json({ error: e && e.message ? e.message : String(e) });
    }
  });
  
  return router;
}
