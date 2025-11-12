import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

async function main() {
  const migrationsDir = path.resolve(process.cwd(), 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.error('migrations directory not found:', migrationsDir);
    process.exit(1);
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const connectionString = process.env.DATABASE_URL || null;
  const pool = connectionString ? new Pool({ connectionString }) : new Pool();

  try {
    console.log('Connecting to Postgres...');
    await pool.query('SELECT 1');

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      console.log('Applying migration:', file);
      const sql = fs.readFileSync(filePath, 'utf8');
      try {
        // Run each migration in a transaction to avoid partial application
        await pool.query('BEGIN');
        await pool.query(sql);
        await pool.query('COMMIT');
        console.log('  ✓ applied', file);
      } catch (e) {
        await pool.query('ROLLBACK');
        console.error('  ✗ failed', file, e.message);
        throw e;
      }
    }

    console.log('All migrations applied.');
    await pool.end();
    process.exit(0);
  } catch (e) {
    console.error('Migration runner failed:', e && e.message ? e.message : String(e));
    try { await pool.end(); } catch (_) {}
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith('run_migrations.js')) {
  main();
}