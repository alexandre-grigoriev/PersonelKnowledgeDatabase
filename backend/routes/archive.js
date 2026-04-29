/**
 * backend/routes/archive.js
 * Archive management and rebuild endpoints (mounted at /api/kb).
 *
 * GET  /:kbId/archive                  — list archived documents
 * GET  /:kbId/archive/:sha256/preview  — metadata + text preview
 * DELETE /:kbId/archive/:sha256        — remove from archive + Neo4j
 * POST /:kbId/rebuild                  — trigger full re-ingestion
 * GET  /:kbId/rebuild/status           — SSE progress stream
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const Database = require('better-sqlite3');
const express  = require('express');

const logger       = require('../utils/logger');
const { getKbArchiveDir, getKbSqlitePath, DATA_DIR } = require('../utils/config');
const { getDriver, stopNeo4jForKb, startNeo4jForKb } = require('../utils/neo4jClient');
const { deleteDocument: deleteFromNeo4j } = require('../ingestion/graphWriter');

const router = express.Router({ mergeParams: true });

// ─── Archive index helpers ────────────────────────────────────────────────────

function readIndex(kbId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(getKbArchiveDir(kbId), 'index.json'), 'utf8'));
  } catch { return { version: 1, documents: {} }; }
}

function writeIndex(kbId, index) {
  fs.writeFileSync(
    path.join(getKbArchiveDir(kbId), 'index.json'),
    JSON.stringify(index, null, 2), 'utf8',
  );
}

function openDb(kbId, opts = {}) {
  return new Database(getKbSqlitePath(kbId), opts);
}

// ─── SSE rebuild state (in-process, single-user desktop app) ─────────────────
/** @type {Map<string, { progress: number, current: string|null, done: number, total: number, errors: string[], complete: boolean }>} */
const rebuildState = new Map();

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /:kbId/archive
 * Lists all documents in the KB archive, enriched with SQLite status.
 */
router.get('/:kbId/archive', (req, res) => {
  const { kbId } = req.params;
  const index = readIndex(kbId);

  let statusMap = {};
  try {
    const db = openDb(kbId, { readonly: true });
    const rows = db.prepare('SELECT id, status FROM documents').all();
    db.close();
    for (const r of rows) statusMap[r.id] = r.status;
  } catch { /* SQLite might not exist yet */ }

  const docs = Object.values(index.documents).map(d => ({
    sha256:       d.sha256,
    title:        d.title        || '',
    authors:      d.authors      || [],
    doi:          d.doi          || null,
    year:         d.year         || null,
    sourceType:   d.source_type  || 'publication',
    addedAt:      d.added_at,
    fileSizeBytes: d.file_size_bytes || 0,
    pageCount:    d.page_count   || null,
    status:       statusMap[d.sha256] || 'unknown',
  }));

  res.json(docs);
});

/**
 * GET /:kbId/archive/:sha256/preview
 * Returns metadata + first 500 chars of text content for a document.
 */
router.get('/:kbId/archive/:sha256/preview', async (req, res) => {
  const { kbId, sha256 } = req.params;
  const index = readIndex(kbId);
  const entry = index.documents[sha256];
  if (!entry) return res.status(404).json({ error: 'Document not found in archive' });

  // Chunk count from SQLite
  let chunkCount    = 0;
  let lastIngested  = null;
  try {
    const db = openDb(kbId, { readonly: true });
    chunkCount   = db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE doc_id=?').get(sha256)?.n || 0;
    lastIngested = db.prepare('SELECT ingested_at FROM documents WHERE id=?').get(sha256)?.ingested_at || null;
    db.close();
  } catch { /* no SQLite yet */ }

  // Preview text: first 500 chars from the first chunk in Neo4j
  let previewText = '';
  try {
    const driver  = getDriver(kbId);
    const session = driver.session();
    const result  = await session.run(
      `MATCH (d:Document {id:$sha256})-[:HAS_CHUNK]->(c:Chunk)
       RETURN c.text AS t ORDER BY c.chunkIndex LIMIT 1`,
      { sha256 },
    );
    await session.close();
    if (result.records.length) previewText = (result.records[0].get('t') || '').slice(0, 500);
  } catch { /* Neo4j might be offline */ }

  res.json({
    sha256,
    title:        entry.title       || '',
    authors:      entry.authors     || [],
    abstract:     entry.abstract    || null,
    pageCount:    entry.page_count  || null,
    previewText,
    chunkCount,
    lastIngested,
  });
});

/**
 * DELETE /:kbId/archive/:sha256
 * Removes a document from the archive filesystem, index.json, SQLite, and Neo4j.
 * Body: { confirm: true }
 */
router.delete('/:kbId/archive/:sha256', async (req, res) => {
  const { kbId, sha256 } = req.params;
  if (req.body?.confirm !== true) {
    return res.status(400).json({ error: 'Body must contain { "confirm": true }' });
  }

  const index = readIndex(kbId);
  if (!index.documents[sha256]) return res.status(404).json({ error: 'Document not found' });

  try {
    // Remove from Neo4j
    let chunksRemoved = 0;
    try {
      const db = openDb(kbId, { readonly: true });
      chunksRemoved = db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE doc_id=?').get(sha256)?.n || 0;
      db.close();
      const driver = getDriver(kbId);
      await deleteFromNeo4j(driver, kbId, sha256);
    } catch (err) {
      logger.warn({ err, sha256 }, 'archive DELETE: neo4j removal failed, continuing');
    }

    // Remove from SQLite
    try {
      const db = openDb(kbId);
      db.prepare('DELETE FROM chunks WHERE doc_id=?').run(sha256);
      db.prepare('DELETE FROM documents WHERE id=?').run(sha256);
      db.prepare('DELETE FROM jobs WHERE doc_id=?').run(sha256);
      db.close();
    } catch { /* no SQLite yet */ }

    // Remove PDF file
    const pdfPath = path.join(getKbArchiveDir(kbId), `${sha256}.pdf`);
    if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);

    // Update index
    delete index.documents[sha256];
    writeIndex(kbId, index);

    // Update kb.json counts
    const kbJsonPath = path.join(DATA_DIR, kbId, 'kb.json');
    try {
      const kbJson = JSON.parse(fs.readFileSync(kbJsonPath, 'utf8'));
      kbJson.doc_count   = Math.max(0, (kbJson.doc_count   || 1) - 1);
      kbJson.chunk_count = Math.max(0, (kbJson.chunk_count || chunksRemoved) - chunksRemoved);
      kbJson.updated_at  = new Date().toISOString();
      fs.writeFileSync(kbJsonPath, JSON.stringify(kbJson, null, 2), 'utf8');
    } catch { /* non-fatal */ }

    logger.info({ kbId, sha256, chunksRemoved }, 'archive: document deleted');
    res.json({ deleted: true, chunksRemoved });
  } catch (err) {
    logger.error({ err, kbId, sha256 }, 'archive DELETE failed');
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

/**
 * POST /:kbId/rebuild
 * Wipes Neo4j data and re-ingests all archived PDFs from scratch.
 * Body: { confirm: true }
 * Response 202: { jobId, totalDocs }
 */
router.post('/:kbId/rebuild', async (req, res) => {
  const { kbId } = req.params;
  if (req.body?.confirm !== true) {
    return res.status(400).json({ error: 'Body must contain { "confirm": true }' });
  }

  const index = readIndex(kbId);
  const docs  = Object.values(index.documents);
  const jobId = `rebuild_${kbId}`;

  rebuildState.set(kbId, { progress: 0, current: null, done: 0, total: docs.length, errors: [], complete: false });
  res.status(202).json({ jobId, totalDocs: docs.length });

  setImmediate(async () => {
    const state = rebuildState.get(kbId);
    const { initNeo4j } = require('../../scripts/initNeo4j');
    const graphWriter    = require('../ingestion/graphWriter');
    const pdfParser      = require('../ingestion/pdfParser');
    const chunker        = require('../ingestion/chunker');
    const llmEnricher    = require('../ingestion/llmEnricher');
    const embedder       = require('../ingestion/embedder');

    try {
      // Read kb.json for port
      const kbJsonPath = path.join(DATA_DIR, kbId, 'kb.json');
      const kbJson     = JSON.parse(fs.readFileSync(kbJsonPath, 'utf8'));

      // Stop, wipe, restart Neo4j
      await stopNeo4jForKb(kbId);
      const neo4jDataDir = path.join(DATA_DIR, kbId, 'neo4j', 'data');
      if (fs.existsSync(neo4jDataDir)) fs.rmSync(neo4jDataDir, { recursive: true, force: true });
      await startNeo4jForKb(kbId, kbJson.neo4j_port);

      // Re-init SQLite schema
      const db = openDb(kbId);
      db.prepare('DELETE FROM chunks').run();
      db.prepare('DELETE FROM documents').run();
      db.prepare('DELETE FROM jobs').run();

      const driver = getDriver(kbId);

      for (let i = 0; i < docs.length; i++) {
        const doc    = docs[i];
        const sha256 = doc.sha256;
        state.current  = doc.title || sha256;
        state.progress = Math.round((i / docs.length) * 100);

        try {
          const pdfPath = path.join(getKbArchiveDir(kbId), `${sha256}.pdf`);
          if (!fs.existsSync(pdfPath)) { state.errors.push(`Missing: ${sha256}`); continue; }

          const { blocks, tables, pageCount } = await pdfParser.extractLayout(pdfPath);
          const firstPagesText = blocks.filter(b => b.pageNum <= 3).map(b => b.text).join(' ');
          const docType   = chunker.detectDocumentType(firstPagesText);
          const rawChunks = chunker.chunkDocument(blocks, docType, tables);

          const enriched = [];
          for (const c of rawChunks) enriched.push(await llmEnricher.enrichChunk(c, { docType, docTitle: doc.title || '' }));
          const embeddings = [];
          for (const c of rawChunks) embeddings.push(await embedder.embedText(c.text));

          await graphWriter.writeGraph(driver, kbId, {
            id: sha256, title: doc.title || '', authors: doc.authors || [],
            doi: doc.doi || null, year: doc.year || null,
            sourceType: doc.source_type || 'publication', pdfPath, pageCount,
          }, rawChunks, enriched, embeddings);

          const now = new Date().toISOString();
          db.prepare(`INSERT OR REPLACE INTO documents (id,title,authors,doi,year,source_type,pdf_path,status,ingested_at)
            VALUES (?,?,?,?,?,?,?,'done',?)`)
            .run(sha256, doc.title||'', JSON.stringify(doc.authors||[]), doc.doi||null,
                 doc.year||null, doc.source_type||'publication', pdfPath, now);
          for (const c of rawChunks) {
            db.prepare(`INSERT OR REPLACE INTO chunks(id,doc_id,chunk_index,section,chunk_type,token_count)
              VALUES(?,?,?,?,?,?)`)
              .run(`${sha256}_${c.index}`, sha256, c.index, c.section, c.chunkType, c.tokenCount);
          }
          state.done++;
        } catch (err) {
          logger.error({ err, sha256 }, 'rebuild: doc failed');
          state.errors.push(`${sha256}: ${err.message}`);
        }
      }
      db.close();
      state.progress = 100;
      state.complete = true;
      logger.info({ kbId, done: state.done, errors: state.errors.length }, 'rebuild complete');
    } catch (err) {
      logger.error({ err, kbId }, 'rebuild: fatal error');
      state.errors.push(err.message);
      state.complete = true;
    }
  });
});

/**
 * GET /:kbId/rebuild/status
 * SSE stream emitting rebuild progress events.
 */
router.get('/:kbId/rebuild/status', (req, res) => {
  const { kbId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const state = rebuildState.get(kbId);
  if (!state) { send({ error: 'No rebuild in progress' }); res.end(); return; }

  const interval = setInterval(() => {
    const s = rebuildState.get(kbId);
    if (!s) { clearInterval(interval); res.end(); return; }
    send({ progress: s.progress, current: s.current, done: s.done, total: s.total, errors: s.errors, complete: s.complete });
    if (s.complete) { clearInterval(interval); res.end(); }
  }, 1000);

  req.on('close', () => clearInterval(interval));
});

module.exports = router;
