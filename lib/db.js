import { Pool } from 'pg';

let pool = null;

function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL || null;
  if (connectionString) {
    pool = new Pool({ connectionString });
  } else {
    // prefer DB_* env vars (as in .env) then fall back to PG* vars
    const host = process.env.DB_HOST ? String(process.env.DB_HOST).trim() : (process.env.PGHOST ? String(process.env.PGHOST).trim() : 'localhost');
    const port = process.env.DB_PORT ? parseInt(String(process.env.DB_PORT).trim(), 10) : (process.env.PGPORT ? parseInt(String(process.env.PGPORT).trim(), 10) : 5432);
    const user = process.env.DB_USERNAME ? String(process.env.DB_USERNAME).trim() : (process.env.PGUSER ? String(process.env.PGUSER).trim() : (process.env.USER || ''));
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : (process.env.PGDATABASE ? String(process.env.PGDATABASE).trim() : (process.env.USER || undefined));
    const rawPwd = process.env.DB_PASSWORD ?? process.env.PGPASSWORD ?? process.env.DB_PASS ?? process.env.PASSWORD ?? undefined;
    const pwd = rawPwd === undefined || rawPwd === null ? undefined : String(rawPwd);

    const cfg = { host, port, user, database: dbName };
    if (pwd !== undefined && pwd.trim() !== '') cfg.password = pwd;
    pool = new Pool(cfg);
  }
  return pool;
}

async function init() {
  const p = getPool();
  try {
    await p.query('SELECT 1');
    return p;
  } catch (e) {
    const err = new Error(`Postgres connection failed: ${e && e.message ? e.message : String(e)}`);
    err.cause = e;
    throw err;
  }
}

async function query(text, params) {
  const p = getPool();
  return p.query(text, params);
}

async function createWorkspace({ name, description = null, owner = null, metadata = {} }) {
  const sql = `INSERT INTO workspaces (name, description, owner, metadata) VALUES ($1,$2,$3,$4) RETURNING *`;
  const res = await query(sql, [name, description, owner, metadata]);
  return res.rows[0];
}

async function getWorkspaces({ name, description = null, owner = null, metadata = {} }) {
  const sql = `SELECT * FROM workspaces ORDER BY id DESC`;
  // currently no filtering implemented; don't pass unused params to query
  const res = await query(sql);
  return res.rows;
}

async function createRubric({ workspaceId = null, name, description = null, config = [] }) {
  const sql = `INSERT INTO rubrics (workspace_id, name, description, config) VALUES ($1,$2,$3,$4) RETURNING *`;
  const res = await query(sql, [workspaceId, name, description, config]);
  return res.rows[0];
}

async function createRubricCriteriaBulk(rubricId, criteriaArray) {
  // criteriaArray: [{ idx, key, title, description, max_score }, ...]
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const inserted = [];
    for (const c of criteriaArray) {
      const res = await client.query(
        `INSERT INTO rubric_criteria (rubric_id, idx, key, title, description, weight, max_score) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [rubricId, c.idx || 0, c.key || null, c.title, c.description || null, c.weight ?? 0, c.max_score || 1]
      );
      inserted.push(res.rows[0]);
    }
    await client.query('COMMIT');
    return inserted;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function createVideo({ jobExternalId = null, workspaceId = null, rubricId = null, title = null, originalPath = null, presentationPath = null, thumbnailPath = null, status = null, durationSeconds = null, metadata = null }) {
  const sql = `INSERT INTO videos (job_external_id, workspace_id, rubric_id, title, original_path, presentation_path, thumbnail_path, status, duration_seconds, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`;
  const res = await query(sql, [jobExternalId, workspaceId, rubricId, title, originalPath, presentationPath, thumbnailPath, status, durationSeconds, metadata]);
  return res.rows[0];
}

async function getVideoByJobExternalId(jobExternalId) {
  const sql = `SELECT * FROM videos WHERE job_external_id = $1 LIMIT 1`;
  const res = await query(sql, [jobExternalId]);
  return res.rows[0] || null;
}

async function getVideosByWorkspaceId(workspaceId) {
  const sql = `SELECT * FROM videos WHERE workspace_id = $1 ORDER BY id DESC`;
  const res = await query(sql, [workspaceId]);
  return res.rows;
}

async function getEvaluationsByVideoIds(videoIds) {
  if (!Array.isArray(videoIds) || videoIds.length === 0) return [];
  const placeholders = videoIds.map((_, idx) => `$${idx + 1}`).join(',');
  const sql = `SELECT * FROM evaluations WHERE video_id IN (${placeholders}) ORDER BY id DESC`;
  const res = await query(sql, videoIds);
  return res.rows;
}

async function insertVideoChunk({ videoId, chunkIndex, filePath, durationSeconds }) {
  const sql = `INSERT INTO video_chunks (video_id, chunk_index, file_path, duration_seconds) VALUES ($1,$2,$3,$4) RETURNING *`;
  const res = await query(sql, [videoId, chunkIndex, filePath, durationSeconds]);
  return res.rows[0];
}

async function insertTranscriptSegment({ videoId, startSeconds, endSeconds, text, source = 'srt' }) {
  const sql = `INSERT INTO transcript_segments (video_id, start_seconds, end_seconds, text, source) VALUES ($1,$2,$3,$4,$5) RETURNING *`;
  const res = await query(sql, [videoId, startSeconds, endSeconds, text, source]);
  return res.rows[0];
}

async function insertEvaluation({ videoId, evaluatorId = null, rubricId = null, scores = {}, totalScore = null, notes = null }) {
  const sql = `INSERT INTO evaluations (video_id, evaluator_id, rubric_id, scores, total_score, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`;
  const res = await query(sql, [videoId, evaluatorId, rubricId, scores, totalScore, notes]);
  return res.rows[0];
}

async function updateEvaluation(id, updates = {}) {
  // allowed updatable columns
  const allowed = ['evaluator_id', 'rubric_id', 'scores', 'total_score', 'notes'];
  const sets = [];
  const params = [];
  let idx = 1;
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      sets.push(`${key} = $${idx}`);
      params.push(updates[key]);
      idx += 1;
    }
  }
  if (sets.length === 0) throw new Error('no updatable fields provided');
  params.push(id);
  const sql = `UPDATE evaluations SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`;
  const res = await query(sql, params);
  return res.rows[0] || null;
}

export default {
  init,
  query,
  createWorkspace,
  getWorkspaces,
  createRubric,
  createRubricCriteriaBulk,
  createVideo,
  getVideoByJobExternalId,
  getVideosByWorkspaceId,
  getEvaluationsByVideoIds,
  insertVideoChunk,
  insertTranscriptSegment,
  insertEvaluation,
  updateEvaluation,
};
