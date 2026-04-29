/**
 * scripts/rebuildKb.js
 * Re-ingests every archived PDF for a KB into a freshly wiped Neo4j instance.
 * Used after Neo4j corruption, migration, or chunking strategy changes.
 *
 * CLI usage:
 *   node scripts/rebuildKb.js --kbId <uuid>
 *
 * Sequence (from ARCHIVE_SYSTEM.md):
 *   1. Verify KB exists (kb.json present)
 *   2. Stop Neo4j instance for the KB
 *   3. Wipe neo4j/data/ directory
 *   4. Restart Neo4j (fresh database)
 *   5. Schema already re-initialised inside startNeo4jForKb
 *   6. Read archive index.json
 *   7. Re-ingest each PDF sequentially (parse → chunk → enrich → embed → write)
 *   8. Update SQLite status after each document
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const Database = require('better-sqlite3');

const logger       = require('../backend/utils/logger');
const { DATA_DIR, getKbArchiveDir, getKbNeo4jDir, getKbSqlitePath } = require('../backend/utils/config');
const { stopNeo4jForKb, startNeo4jForKb, getDriver } = require('../backend/utils/neo4jClient');

const pdfParser   = require('../backend/ingestion/pdfParser');
const chunker     = require('../backend/ingestion/chunker');
const llmEnricher = require('../backend/ingestion/llmEnricher');
const embedder    = require('../backend/ingestion/embedder');
const graphWriter  = require('../backend/ingestion/graphWriter');

// ─── Archive index reader ─────────────────────────────────────────────────────

function readArchiveIndex(kbId) {
  const p = path.join(getKbArchiveDir(kbId), 'index.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return { version: 1, documents: {} }; }
}

// ─── SQLite DDL ───────────────────────────────────────────────────────────────

const SQLITE_DDL = `
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY, title TEXT, authors TEXT, doi TEXT,
    year INTEGER, source_type TEXT, astm_code TEXT,
    pdf_path TEXT, ingested_at TEXT, status TEXT DEFAULT 'pending'
  );
  CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY, doc_id TEXT REFERENCES documents(id),
    chunk_index INTEGER, section TEXT, chunk_type TEXT,
    token_count INTEGER, neo4j_node_id TEXT
  );
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, doc_id TEXT, status TEXT, step TEXT,
    progress INTEGER DEFAULT 0, error TEXT, created_at TEXT, updated_at TEXT
  );
`;

// ─── Main rebuild logic ───────────────────────────────────────────────────────

/**
 * Rebuilds the Neo4j graph for a KB from its archived PDFs.
 * @param {string} kbId
 * @returns {Promise<{ done: number, failed: number }>}
 */
async function rebuildKb(kbId) {
  // 1. Verify KB exists
  const kbJsonPath = path.join(DATA_DIR, kbId, 'kb.json');
  if (!fs.existsSync(kbJsonPath)) {
    throw new Error(`KB not found: no kb.json at ${kbJsonPath}`);
  }
  const kbJson = JSON.parse(fs.readFileSync(kbJsonPath, 'utf8'));
  const port   = kbJson.neo4j_port;
  logger.info({ kbId, port, name: kbJson.name }, 'rebuild: starting');

  // 2. Stop Neo4j
  await stopNeo4jForKb(kbId);

  // 3. Wipe neo4j/data/
  const neo4jDataDir = path.join(getKbNeo4jDir(kbId), 'data');
  if (fs.existsSync(neo4jDataDir)) {
    fs.rmSync(neo4jDataDir, { recursive: true, force: true });
    logger.info({ neo4jDataDir }, 'rebuild: neo4j data wiped');
  }

  // 4+5. Restart Neo4j (startNeo4jForKb calls initNeo4j internally)
  await startNeo4jForKb(kbId, port);
  const driver = getDriver(kbId);

  // Reset SQLite
  const db = new Database(getKbSqlitePath(kbId));
  db.pragma('journal_mode = WAL');
  db.exec(SQLITE_DDL);
  db.prepare('DELETE FROM chunks').run();
  db.prepare('DELETE FROM documents').run();
  db.prepare('DELETE FROM jobs').run();

  // 6. Read archive
  const index = readArchiveIndex(kbId);
  const docs  = Object.values(index.documents);
  logger.info({ total: docs.length }, 'rebuild: documents to process');

  let done   = 0;
  let failed = 0;

  // 7. Re-ingest each PDF sequentially
  for (const doc of docs) {
    const sha256  = doc.sha256;
    const pdfPath = path.join(getKbArchiveDir(kbId), `${sha256}.pdf`);

    if (!fs.existsSync(pdfPath)) {
      logger.warn({ sha256 }, 'rebuild: PDF missing from archive, skipping');
      failed++;
      continue;
    }

    logger.info({ sha256, title: doc.title }, 'rebuild: processing document');
    try {
      const { blocks, tables, pageCount } = await pdfParser.extractLayout(pdfPath);
      const firstPagesText = blocks.filter(b => b.pageNum <= 3).map(b => b.text).join(' ');
      const docType   = chunker.detectDocumentType(firstPagesText);
      const rawChunks = chunker.chunkDocument(blocks, docType, tables);

      const enriched = [];
      for (const c of rawChunks) {
        enriched.push(await llmEnricher.enrichChunk(c, { docType, docTitle: doc.title || '' }));
      }

      const embeddings = [];
      for (const c of rawChunks) {
        embeddings.push(await embedder.embedText(c.text));
      }

      await graphWriter.writeGraph(driver, kbId, {
        id:         sha256,
        title:      doc.title      || '',
        authors:    doc.authors    || [],
        doi:        doc.doi        || null,
        year:       doc.year       || null,
        sourceType: doc.source_type || 'publication',
        astmCode:   doc.astm_code  || null,
        pdfPath,
        pageCount,
      }, rawChunks, enriched, embeddings);

      // 8. Update SQLite
      const now = new Date().toISOString();
      db.prepare(
        `INSERT OR REPLACE INTO documents
         (id, title, authors, doi, year, source_type, astm_code, pdf_path, ingested_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'done')`,
      ).run(sha256, doc.title || '', JSON.stringify(doc.authors || []),
            doc.doi || null, doc.year || null, doc.source_type || 'publication',
            doc.astm_code || null, pdfPath, now);

      for (const c of rawChunks) {
        db.prepare(
          `INSERT OR REPLACE INTO chunks (id, doc_id, chunk_index, section, chunk_type, token_count)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(`${sha256}_${c.index}`, sha256, c.index, c.section, c.chunkType, c.tokenCount);
      }

      done++;
      logger.info({ sha256, chunks: rawChunks.length, done, total: docs.length }, 'rebuild: document done');
    } catch (err) {
      failed++;
      logger.error({ err, sha256 }, 'rebuild: document failed');
      db.prepare(`INSERT OR REPLACE INTO documents (id, status) VALUES (?, 'error')`)
        .run(sha256);
    }
  }

  // Update kb.json counts
  try {
    kbJson.doc_count   = done;
    kbJson.chunk_count = db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n;
    kbJson.updated_at  = new Date().toISOString();
    fs.writeFileSync(kbJsonPath, JSON.stringify(kbJson, null, 2), 'utf8');
  } catch { /* non-fatal */ }

  db.close();
  logger.info({ kbId, done, failed }, 'rebuild: complete');
  return { done, failed };
}

// ─── CLI entrypoint ───────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const idx  = args.indexOf('--kbId');
  const kbId = idx !== -1 ? args[idx + 1] : null;

  if (!kbId) {
    logger.error('Usage: node scripts/rebuildKb.js --kbId <uuid>');
    process.exit(1);
  }

  rebuildKb(kbId)
    .then(({ done, failed }) => {
      logger.info({ done, failed }, 'rebuild finished');
      process.exit(failed > 0 ? 1 : 0);
    })
    .catch(err => {
      logger.error({ err }, 'rebuild failed');
      process.exit(1);
    });
}

module.exports = { rebuildKb };
