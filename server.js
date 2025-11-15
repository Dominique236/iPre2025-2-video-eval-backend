#!/usr/bin/env node
// load environment variables from .env when present
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import multer from 'multer';

import createVideoRoutes from './routes/video_routes.js';
import createEvaluateRoutes from './routes/evaluate_routes.js';
import createUploadRoutes from './routes/upload_routes.js';
import createWorkspaceRoutes from './routes/workspace_routes.js';
import createDashboardRoutes from './routes/dashboard_routes.js';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Setup jobs directories and multer
const jobsDir = path.resolve(process.cwd(), 'jobs');
if (!fs.existsSync(jobsDir)) fs.mkdirSync(jobsDir, { recursive: true });
// ensure uploads dir exists for multer temporary storage
const uploadsDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// define storage for multer (files will be stored in uploads/ with a unique filename)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniq = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const ext = path.extname(file.originalname) || '';
    cb(null, `${uniq}${ext}`);
  }
});

const upload = multer({ storage });

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Mount routers
app.use('/', createVideoRoutes({ jobsDir }));
app.use('/', createEvaluateRoutes({ upload, jobsDir }));
app.use('/', createUploadRoutes({ upload, jobsDir }));
app.use('/', createWorkspaceRoutes());
app.use('/', createDashboardRoutes({ upload, jobsDir }));

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
