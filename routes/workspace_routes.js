import express from 'express';
import db from '../lib/db.js';

const router = express.Router();

export default function createWorkspaceRoutes() {
    // Create a workspace
    router.post('/workspaces', async (req, res) => {
        const { name, description, owner, metadata } = req.body || {};
        if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name is required' });
        try {
            await db.init();
            const ws = await db.createWorkspace({ name, description: description || null, owner: owner || null, metadata: metadata || {} });
            res.status(201).json(ws);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Get all workspaces
    router.get('/workspaces', async (req, res) => {
    try {
      await db.init();
      const result = await db.getWorkspaces({});
      res.json({ workspaces: result });
    } catch (e) {
      // don't fail the entire endpoint if DB is not configured; return empty list with warning
      console.error('Workspaces list error:', e && e.stack ? e.stack : e);
      res.status(200).json({ workspaces: [], error: `DB unavailable: ${e && e.message ? e.message : String(e)}` });
    }
    });

    // Create a rubric under a workspace
    router.post('/workspaces/:workspaceId/rubrics', async (req, res) => {
        const workspaceId = req.params.workspaceId;
        const { name, description, config, criteria } = req.body || {};
        if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name is required' });
        try {
            await db.init();
            const rub = await db.createRubric({ workspaceId, name, description: description || null, config: config || [] });
            // optionally insert criteria rows
            let insertedCriteria = [];
            if (Array.isArray(criteria) && criteria.length > 0) {
                // normalize criteria to expected shape
                const norm = criteria.map((c, i) => ({ idx: c.idx ?? i, key: c.key ?? null, title: c.title || `criteria_${i}`, description: c.description || null, max_score: c.max_score ?? 1 }));
                insertedCriteria = await db.createRubricCriteriaBulk(rub.id, norm);
            }
            res.status(201).json({ rubric: rub, criteria: insertedCriteria });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

  return router;
}

