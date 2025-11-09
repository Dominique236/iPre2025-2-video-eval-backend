import express from 'express';

const router = express.Router();

export default function createEvaluateRoutes({ upload }) {
  // Placeholder: add evaluate-specific endpoints here.
  router.get('/uploads/health', (req, res) => res.json({ ok: true }));

  return router;
}
