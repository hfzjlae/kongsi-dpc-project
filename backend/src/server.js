// ------------------------------------------------------------------
// server.js — starts the APPLICATION TIER (the REST API).
//
// The frontend (presentation tier) never talks to the database or S3.
// It only calls the URLs defined here, and this server decides what
// is allowed and talks to the data tier on the user's behalf.
// ------------------------------------------------------------------
const os = require('os');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const config = require('./config');
const db = require('./db');
const storage = require('./storage');

const app = express();

// Behind Nginx / a load balancer, trust the forwarded client IP
app.set('trust proxy', 1);

// Security headers. Images are allowed to be shown on another origin
// (the frontend runs on a different address from the API).
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// CORS: only our own frontend may call this API from a browser.
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) {
        return cb(null, true);
      }
      return cb(null, false);
    },
  })
);

app.use(express.json({ limit: '100kb' }));

// Tells you WHICH server instance answered. When you run 2 instances
// behind a load balancer, this header shows requests being shared out.
const INSTANCE = os.hostname();
app.use((req, res, next) => {
  res.set('X-Served-By', INSTANCE);
  next();
});

// Simple request log: method, path, status, time taken
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

// Limit repeated login/register attempts (brute-force protection)
if (config.authRateLimit > 0) {
  app.use(
    '/api/auth',
    rateLimit({ windowMs: 15 * 60 * 1000, limit: config.authRateLimit, standardHeaders: true, legacyHeaders: false })
  );
}

// In local mode, uploaded photos are served from backend/uploads
if (config.storageMode === 'local') {
  app.use('/uploads', express.static(storage.LOCAL_DIR, { maxAge: '1h' }));
}

// Health check: used by you, by Nginx and by a load balancer
app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', instance: INSTANCE, storage: config.storageMode, time: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'database unavailable', instance: INSTANCE });
  }
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/groups', require('./routes/groups'));
app.use('/api/photos', require('./routes/photos'));
app.use('/api/comments', require('./routes/comments'));

// Unknown API path
app.use('/api', (req, res) => res.status(404).json({ error: 'No such API endpoint.' }));

// Central error handler: logs the real error, sends a safe message
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `Photos must be under ${config.maxUploadBytes / 1024 / 1024} MB.` });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });

  console.error(err);
  return res.status(500).json({ error: 'Something went wrong on the server. Try again.' });
});

const server = app.listen(config.port, () => {
  console.log(`Kongsi API listening on port ${config.port} (storage: ${config.storageMode}, instance: ${INSTANCE})`);
});

// Graceful shutdown: finish in-flight requests, then close DB pool
function shutdown() {
  console.log('Shutting down...');
  server.close(() => db.pool.end().then(() => process.exit(0)));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
