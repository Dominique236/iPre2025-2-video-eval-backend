Database migrations and migration runner

This project includes two ways to run migrations:

1) Raw SQL runner (minimal):
   - Files are in `migrations/` and are plain SQL files.
   - Run them in order with the provided runner:

     ```bash
     npm run migrate
     ```

   - This runner is simple and doesn't track applied migrations; it's useful for quick setups.

2) Sequelize CLI (versioned migrations):
   - Sequelize migrations are provided in `sequelize_migrations/` and are executed with `sequelize-cli`.
   - Configure your DB with `DATABASE_URL` (or PG env vars) and run:

     ```bash
     npm install
     npm run sequelize:create
     npm run sequelize:migrate
     ```

   - `SequelizeMeta` will track applied migrations and `npm run sequelize:undo` can revert the last migration.

Migrating existing jobs into Postgres
------------------------------------

A migration helper script is available at `scripts/migrate_jobs.js`. It will:

- Insert a `videos` row per job found under `jobs/<jobId>/metadata.json` (if a row for that job doesn't already exist).
- Attempt to detect chunks under `chunks/` and store chunk records (video_chunks) with durations (uses `ffprobe` on the host).
- Parse job-local transcripts under `jobs/<jobId>/transcripts/*.srt` and insert transcript segments into the DB.

Usage example:

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/mydb node scripts/migrate_jobs.js
```
