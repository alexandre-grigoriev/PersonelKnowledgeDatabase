/**
 * backend/routes/kb.js
 * CRUD endpoints for Knowledge Base management.
 *
 * GET    /api/kb              — list all KBs
 * POST   /api/kb              — create a new KB
 * GET    /api/kb/:id/stats    — detailed stats for one KB
 * DELETE /api/kb/:id          — delete a KB (requires { confirm: true })
 */

'use strict';

const crypto  = require('crypto');
const express = require('express');
const fs      = require('fs');
const path    = require('path');

const Database = require('better-sqlite3');
const logger   = require('../utils/logger');
const {
  DATA_DIR,
  NEO4J_PORT_START,
  NEO4J_PORT_END,
  getKbArchiveDir,
  getKbNeo4jDir,
  getKbSqlitePath,
} = require('../utils/config');
const { startNeo4jForKb, getDriver, stopNeo4jForKb } = require('../utils/neo4jClient');

const router = express.Router();

// ─── SQLite DDL ───────────────────────────────────────────────────────────────

const SQLITE_DDL = `
  CREATE TABLE IF NOT EXISTS documents (
    id          TEXT PRIMARY KEY,
    title       TEXT,
    authors     TEXT,
    doi         TEXT,
    year        INTEGER,
    source_type TEXT,
    astm_code   TEXT,
    pdf_path    TEXT,
    ingested_at TEXT,
    status      TEXT DEFAULT 'pending'
  );

  CREATE TABLE IF NOT EXISTS chunks (
    id             TEXT PRIMARY KEY,
    doc_id         TEXT REFERENCES documents(id),
    chunk_index    INTEGER,
    section        TEXT,
    chunk_type     TEXT,
    token_count    INTEGER,
    neo4j_node_id  TEXT
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id         TEXT PRIMARY KEY,
    doc_id     TEXT,
    status     TEXT,
    step       TEXT,
    progress   INTEGER DEFAULT 0,
    error      TEXT,
    created_at TEXT,
    updated_at TEXT
  );
`;

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Opens (or creates) the SQLite metadata DB for a KB and ensures the schema exists.
 * @param {string} kbId
 * @returns {import('better-sqlite3').Database}
 */
function openDb(kbId) {
  const db = new Database(getKbSqlitePath(kbId));
  db.pragma('journal_mode = WAL');
  db.exec(SQLITE_DDL);
  return db;
}

/**
 * Reads and parses kb.json from a KB directory. Returns null if absent or malformed.
 * @param {string} kbDir
 * @returns {Object|null}
 */
function readKbJson(kbDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(kbDir, 'kb.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Serialises kb.json back to disk.
 * @param {string} kbDir
 * @param {Object} data
 */
function writeKbJson(kbDir, data) {
  fs.writeFileSync(path.join(kbDir, 'kb.json'), JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Returns every valid KB directory (those that contain a parseable kb.json).
 * @returns {{ kbDir: string, kbJson: Object }[]}
 */
function scanKbs() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => {
      const kbDir  = path.join(DATA_DIR, e.name);
      const kbJson = readKbJson(kbDir);
      return kbJson ? { kbDir, kbJson } : null;
    })
    .filter(Boolean);
}

/**
 * Allocates the first bolt port in [NEO4J_PORT_START, NEO4J_PORT_END] not yet claimed
 * by an existing KB.
 * @returns {number}
 * @throws {Error} if the entire port range is already occupied
 */
function allocatePort() {
  const used = new Set(
    scanKbs().map(({ kbJson }) => kbJson.neo4j_port).filter(Number.isInteger),
  );
  for (let p = NEO4J_PORT_START; p <= NEO4J_PORT_END; p++) {
    if (!used.has(p)) return p;
  }
  throw new Error(`No available Neo4j port in range ${NEO4J_PORT_START}–${NEO4J_PORT_END}`);
}

/**
 * Recursively computes the total byte size of a directory tree.
 * Returns 0 when the directory does not exist.
 * @param {string} dir
 * @returns {number}
 */
function dirSizeBytes(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += dirSizeBytes(full);
    } else {
      try { total += fs.statSync(full).size; } catch { /* skip unreadable */ }
    }
  }
  return total;
}

/**
 * Derives the runtime status of a KB from its jobs table.
 * @param {string} kbId
 * @returns {'ready'|'indexing'|'rebuilding'}
 */
function kbStatus(kbId) {
  try {
    const db  = new Database(getKbSqlitePath(kbId), { readonly: true });
    const row = db.prepare(`SELECT step FROM jobs WHERE status = 'running' LIMIT 1`).get();
    db.close();
    if (!row) return 'ready';
    return row.step === 'rebuild' ? 'rebuilding' : 'indexing';
  } catch {
    return 'ready';
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/kb
 * Lists all knowledge bases found in DATA_DIR.
 */
router.get('/', (req, res) => {
  try {
    const kbs = scanKbs().map(({ kbJson }) => ({
      id:          kbJson.id,
      name:        kbJson.name,
      description: kbJson.description || '',
      color:       kbJson.color || '#3B8BD4',
      docCount:    kbJson.doc_count   || 0,
      chunkCount:  kbJson.chunk_count || 0,
      createdAt:   kbJson.created_at,
      status:      kbStatus(kbJson.id),
    }));
    res.json(kbs);
  } catch (err) {
    logger.error({ err }, 'GET /api/kb failed');
    res.status(500).json({ error: 'Failed to list knowledge bases' });
  }
});

/**
 * POST /api/kb
 * Creates a new knowledge base: directory layout, kb.json, archive index, SQLite schema,
 * and starts the dedicated Neo4j instance.
 * Body: { name: string, description?: string, color?: string }
 * Response 201: { id, name, description, color, createdAt }
 */
router.post('/', async (req, res) => {
  const { name, description = '', color = '#3B8BD4' } = req.body || {};

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  const id  = crypto.randomUUID();
  const now = new Date().toISOString();

  let port;
  try {
    port = allocatePort();
  } catch (err) {
    logger.error({ err }, 'POST /api/kb: port allocation failed');
    return res.status(503).json({ error: err.message });
  }

  const kbDir      = path.join(DATA_DIR, id);
  const archiveDir = getKbArchiveDir(id);

  try {
    // Directory layout
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.mkdirSync(getKbNeo4jDir(id), { recursive: true });

    // kb.json
    const kbData = {
      id,
      name:        name.trim(),
      description: description.trim(),
      color,
      created_at:  now,
      updated_at:  now,
      doc_count:   0,
      chunk_count: 0,
      neo4j_port:  port,
    };
    writeKbJson(kbDir, kbData);

    // Empty archive index
    fs.writeFileSync(
      path.join(archiveDir, 'index.json'),
      JSON.stringify({ version: 1, documents: {} }, null, 2),
      'utf8',
    );

    // SQLite — creates file + applies schema
    openDb(id).close();

    // Start Neo4j and initialize the graph schema (awaited — client shows a spinner)
    await startNeo4jForKb(id, port);

    logger.info({ id, name: kbData.name, port }, 'KB created');
    res.status(201).json({
      id,
      name:        kbData.name,
      description: kbData.description,
      color,
      createdAt:   now,
    });
  } catch (err) {
    logger.error({ err, id }, 'POST /api/kb failed');
    // Best-effort cleanup so a partial KB dir doesn't pollute future listings
    try { fs.rmSync(kbDir, { recursive: true, force: true }); } catch { /* ignore */ }
    res.status(500).json({ error: 'Failed to create knowledge base' });
  }
});

/**
 * GET /api/kb/:id/stats
 * Returns document, chunk and entity counts plus filesystem sizes for one KB.
 * Response: { id, name, docCount, chunkCount, entityCount, archiveSizeBytes, neo4jSizeBytes, lastIngestedAt }
 */
router.get('/:id/stats', async (req, res) => {
  const { id } = req.params;
  const kbDir  = path.join(DATA_DIR, id);
  const kbJson = readKbJson(kbDir);

  if (!kbJson) {
    return res.status(404).json({ error: 'Knowledge base not found' });
  }

  try {
    // SQLite counts
    const db         = openDb(id);
    const docCount   = db.prepare(`SELECT COUNT(*) AS n FROM documents WHERE status = 'done'`).get().n;
    const chunkCount = db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n;
    const lastRow    = db.prepare('SELECT MAX(ingested_at) AS ts FROM documents').get();
    db.close();

    // Neo4j entity count — non-fatal if Neo4j is not running
    let entityCount = 0;
    try {
      const driver  = getDriver(id);
      const session = driver.session();
      const result  = await session.run(
        'MATCH (e:Entity {kbId: $kbId}) RETURN count(e) AS n',
        { kbId: id },
      );
      entityCount = result.records[0].get('n').toNumber();
      await session.close();
    } catch (err) {
      logger.warn({ err, id }, 'stats: neo4j entity count unavailable');
    }

    res.json({
      id,
      name:              kbJson.name,
      docCount,
      chunkCount,
      entityCount,
      archiveSizeBytes:  dirSizeBytes(getKbArchiveDir(id)),
      neo4jSizeBytes:    dirSizeBytes(getKbNeo4jDir(id)),
      lastIngestedAt:    lastRow && lastRow.ts ? lastRow.ts : null,
    });
  } catch (err) {
    logger.error({ err, id }, 'GET /api/kb/:id/stats failed');
    res.status(500).json({ error: 'Failed to fetch KB stats' });
  }
});

/**
 * PATCH /api/kb/:id
 * Updates mutable fields (name, description, color) in kb.json.
 * Body: { name?: string, description?: string, color?: string }
 * Response: updated KB object
 */
router.patch('/:id', (req, res) => {
  const { id } = req.params;
  const kbDir  = path.join(DATA_DIR, id);
  const kbJson = readKbJson(kbDir);

  if (!kbJson) {
    return res.status(404).json({ error: 'Knowledge base not found' });
  }

  const { name, description, color } = req.body || {};

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name must be a non-empty string' });
    }
    kbJson.name = name.trim();
  }
  if (description !== undefined) kbJson.description = String(description).trim();
  if (color       !== undefined) kbJson.color       = String(color);
  kbJson.updated_at = new Date().toISOString();

  try {
    writeKbJson(kbDir, kbJson);
    logger.info({ id, name: kbJson.name }, 'KB updated');
    res.json({
      id:          kbJson.id,
      name:        kbJson.name,
      description: kbJson.description || '',
      color:       kbJson.color       || '#3B8BD4',
      docCount:    kbJson.doc_count   || 0,
      chunkCount:  kbJson.chunk_count || 0,
      createdAt:   kbJson.created_at,
      status:      kbStatus(id),
    });
  } catch (err) {
    logger.error({ err, id }, 'PATCH /api/kb/:id failed');
    res.status(500).json({ error: 'Failed to update knowledge base' });
  }
});

/**
 * DELETE /api/kb/:id
 * Permanently removes a KB: stops Neo4j, wipes all files.
 * Body: { confirm: true }
 * Response: { deleted: true }
 */
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const kbDir  = path.join(DATA_DIR, id);

  if (!readKbJson(kbDir)) {
    return res.status(404).json({ error: 'Knowledge base not found' });
  }

  if (req.body?.confirm !== true) {
    return res.status(400).json({ error: 'Body must contain { "confirm": true }' });
  }

  try {
    await stopNeo4jForKb(id);
    fs.rmSync(kbDir, { recursive: true, force: true });
    logger.info({ id }, 'KB deleted');
    res.json({ deleted: true });
  } catch (err) {
    logger.error({ err, id }, 'DELETE /api/kb/:id failed');
    res.status(500).json({ error: 'Failed to delete knowledge base' });
  }
});

/**
 * POST /api/kb/:id/reset
 * Wipes all Neo4j nodes and SQLite chunks for a KB, keeping archived files intact.
 * Documents are reset to 'pending' so they can be re-ingested.
 * Body: { confirm: true }
 * Response: { reset: true, nodesDeleted: number }
 */
router.post('/:id/reset', async (req, res) => {
  const { id } = req.params;
  const kbDir  = path.join(DATA_DIR, id);

  if (!readKbJson(kbDir)) {
    return res.status(404).json({ error: 'Knowledge base not found' });
  }
  if (req.body?.confirm !== true) {
    return res.status(400).json({ error: 'Body must contain { "confirm": true }' });
  }

  let nodesDeleted = 0;

  // 1. Delete all Neo4j nodes belonging to this KB
  try {
    const driver  = getDriver(id);
    const session = driver.session();
    const result  = await session.writeTransaction(tx =>
      tx.run('MATCH (n {kbId: $kbId}) DETACH DELETE n RETURN count(n) AS n', { kbId: id }),
    );
    nodesDeleted = result.records[0]?.get('n')?.toNumber() ?? 0;
    await session.close();
  } catch (err) {
    logger.warn({ err, id }, 'reset: neo4j wipe failed (non-fatal)');
  }

  // 2. Clear SQLite chunks and reset document statuses
  try {
    const db = openDb(id);
    db.prepare('DELETE FROM chunks').run();
    db.prepare('DELETE FROM jobs').run();
    db.prepare(`UPDATE documents SET status = 'pending', ingested_at = NULL`).run();
    db.close();
  } catch (err) {
    logger.warn({ err, id }, 'reset: sqlite clear failed');
  }

  // 3. Reset kb.json counts
  try {
    const kbJsonPath = path.join(kbDir, 'kb.json');
    const kbJson = JSON.parse(fs.readFileSync(kbJsonPath, 'utf8'));
    kbJson.doc_count   = 0;
    kbJson.chunk_count = 0;
    kbJson.updated_at  = new Date().toISOString();
    fs.writeFileSync(kbJsonPath, JSON.stringify(kbJson, null, 2), 'utf8');
  } catch { /* non-fatal */ }

  logger.info({ id, nodesDeleted }, 'KB reset');
  res.json({ reset: true, nodesDeleted });
});

module.exports = router;
