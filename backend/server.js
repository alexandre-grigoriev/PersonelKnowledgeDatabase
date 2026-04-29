/**
 * backend/server.js
 * Express application: middleware, route mounting, startup, graceful shutdown.
 *
 * Exports: { app, upload, start }
 *   app    — Express instance (for Electron IPC and tests)
 *   upload — shared multer instance (imported by routes/ingest.js)
 *   start  — async fn that recovers existing KBs then begins listening
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const cors     = require('cors');
const express  = require('express');
const multer   = require('multer');
const pinoHttp = require('pino-http');

const logger               = require('./utils/logger');
const { API_PORT, DATA_DIR } = require('./utils/config');
const { startNeo4jForKb, closeAll } = require('./utils/neo4jClient');

const kbRouter = require('./routes/kb');

// ─── Shared multer instance ───────────────────────────────────────────────────
// Configured here once; imported by routes/ingest.js to avoid duplicate instances.
// 100 MB ceiling — generous for multi-page PDFs, still protects disk.

const upload = multer({
  dest:   path.join(os.tmpdir(), 'skb-uploads'),
  limits: { fileSize: 100 * 1024 * 1024 },
});

// ─── Express app ─────────────────────────────────────────────────────────────

const app = express();

app.use(pinoHttp({ logger }));
app.use(cors());
app.use(express.json());

// ─── Route loader ─────────────────────────────────────────────────────────────

/**
 * Requires a route module; returns a 501 stub router when the file does not
 * exist yet. This lets server.js compile and run at every implementation step.
 * @param {string} rel - Require-style path relative to this file
 * @returns {express.Router}
 */
function loadRoute(rel) {
  try {
    return require(rel);
  } catch {
    const stub = express.Router();
    stub.use((_req, res) => res.status(501).json({ error: 'Not yet implemented' }));
    return stub;
  }
}

// ─── Route mounting ───────────────────────────────────────────────────────────
// Archive routes (/:kbId/archive, /:kbId/rebuild) are also under /api/kb
// so archiveRouter is mounted at the same prefix as kbRouter.

app.use('/api/kb',     kbRouter);
app.use('/api/kb',     loadRoute('./routes/archive'));
app.use('/api/ingest', loadRoute('./routes/ingest'));
app.use('/api/query',  loadRoute('./routes/query'));

// ─── Fallthrough handlers ─────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ error: `No route: ${req.method} ${req.path}` });
});

// Four-argument signature required by Express to recognise an error handler.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error({ err }, 'unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

// ─── KB recovery on startup ───────────────────────────────────────────────────

/**
 * Scans DATA_DIR and starts Neo4j for every KB that has a valid kb.json.
 * Runs sequentially to avoid port-range race conditions.
 * Individual failures are non-fatal: a warning is logged and the loop continues.
 * @returns {Promise<void>}
 */
async function startExistingKbs() {
  if (!fs.existsSync(DATA_DIR)) return;

  const entries = fs.readdirSync(DATA_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory());

  for (const entry of entries) {
    const kbJsonPath = path.join(DATA_DIR, entry.name, 'kb.json');
    try {
      const kbJson = JSON.parse(fs.readFileSync(kbJsonPath, 'utf8'));
      logger.info({ kbId: kbJson.id, port: kbJson.neo4j_port }, 'recovering KB on startup');
      await startNeo4jForKb(kbJson.id, kbJson.neo4j_port);
    } catch (err) {
      logger.warn({ err, dir: entry.name }, 'could not start KB on startup — skipping');
    }
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

/**
 * Closes all Neo4j driver connections and kills spawned processes, then exits.
 * @param {string} signal
 */
function shutdown(signal) {
  logger.info({ signal }, 'shutdown signal received');
  closeAll()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'error during shutdown');
      process.exit(1);
    });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Recovers existing KB Neo4j instances then starts the HTTP server.
 * @returns {Promise<import('http').Server>}
 */
async function start() {
  await startExistingKbs();

  return new Promise((resolve, reject) => {
    const server = app.listen(API_PORT, () => {
      logger.info({ port: API_PORT }, 'server listening');
      resolve(server);
    });
    server.once('error', reject);
  });
}

if (require.main === module) {
  start().catch((err) => {
    logger.error({ err }, 'startup failed');
    process.exit(1);
  });
}

module.exports = { app, upload, start };
