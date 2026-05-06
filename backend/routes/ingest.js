/**
 * backend/routes/ingest.js
 * Ingestion pipeline endpoints.
 *
 * POST /api/ingest         — multipart PDF upload
 * POST /api/ingest/text    — plain-text page capture (Chrome extension)
 * GET  /api/ingest/jobs/:jobId — job status polling
 *
 * The pipeline (parse → chunk → enrich → embed → write) runs asynchronously
 * after the 202 response so the client can poll for progress.
 */

'use strict';

const crypto  = require('crypto');
const fs      = require('fs');
const os      = require('os');
const path    = require('path');

const Database = require('better-sqlite3');
const express  = require('express');
const multer   = require('multer');

const logger       = require('../utils/logger');
const { getKbSqlitePath, getKbArchiveDir, DATA_DIR } = require('../utils/config');
const { convertToMd } = require('../utils/pdfToMd');
const { cleanupMd }  = require('../utils/mdCleaner');
const { getDriver } = require('../utils/neo4jClient');

const pdfParser   = require('../ingestion/pdfParser');
const chunker     = require('../ingestion/chunker');
const llmEnricher = require('../ingestion/llmEnricher');
const embedder    = require('../ingestion/embedder');
const graphWriter  = require('../ingestion/graphWriter');

const router = express.Router();

// Own multer instance — avoids circular dependency with server.js
const upload = multer({
  dest:   path.join(os.tmpdir(), 'skb-uploads'),
  limits: { fileSize: 100 * 1024 * 1024 },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Opens the SQLite DB for a KB (schema assumed to already exist).
 * @param {string} kbId
 * @returns {import('better-sqlite3').Database}
 */
function openDb(kbId) {
  return new Database(getKbSqlitePath(kbId));
}

/**
 * Computes the SHA-256 hex digest of a file.
 * @param {string} filePath
 * @returns {string}
 */
function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Reads the KB's archive index.json (spec format: { version, documents }).
 * @param {string} kbId
 * @returns {{ version: number, documents: Record<string, Object> }}
 */
function readArchiveIndex(kbId) {
  const p = path.join(getKbArchiveDir(kbId), 'index.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return { version: 1, documents: {} }; }
}

/**
 * Persists the archive index.json.
 * @param {string} kbId
 * @param {{ version: number, documents: Record<string, Object> }} index
 */
function writeArchiveIndex(kbId, index) {
  const p = path.join(getKbArchiveDir(kbId), 'index.json');
  fs.writeFileSync(p, JSON.stringify(index, null, 2), 'utf8');
}

/**
 * Copies a PDF into the archive as {sha256}.pdf and updates index.json.
 * Returns isDuplicate=true when the SHA already exists.
 * @param {string} kbId
 * @param {string} tmpPath - temp file path from multer
 * @param {string} sha256
 * @param {Object} meta
 * @returns {{ pdfPath: string, isDuplicate: boolean }}
 */
function archivePdf(kbId, tmpPath, sha256, meta) {
  const archiveDir = getKbArchiveDir(kbId);
  fs.mkdirSync(archiveDir, { recursive: true });
  const index = readArchiveIndex(kbId);
  if (index.documents[sha256]) {
    return { pdfPath: path.join(archiveDir, `${sha256}.pdf`), isDuplicate: true };
  }
  const dest = path.join(archiveDir, `${sha256}.pdf`);
  fs.copyFileSync(tmpPath, dest);
  const stat = fs.statSync(dest);
  index.documents[sha256] = {
    sha256,
    filename:       meta.originalName || `${sha256}.pdf`,
    title:          meta.title  || '',
    doi:            meta.doi    || null,
    authors:        meta.authors || [],
    year:           meta.year   || null,
    source_type:    meta.sourceType || 'publication',
    astm_code:      meta.astmCode || null,
    abstract:       meta.abstract || null,
    added_at:       new Date().toISOString(),
    file_size_bytes: stat.size,
  };
  writeArchiveIndex(kbId, index);
  return { pdfPath: dest, isDuplicate: false };
}

// ─── Ingestion pipeline ───────────────────────────────────────────────────────

/**
 * Runs the full parse→chunk→enrich→embed→write pipeline for one document.
 * Updates the SQLite jobs table throughout.
 * @param {string} jobId
 * @param {string} kbId
 * @param {string} pdfPath - archived PDF path
 * @param {string} sha256
 * @param {Object} meta
 * @param {import('better-sqlite3').Database} db
 */
async function runPipeline(jobId, kbId, pdfPath, sha256, meta, db) {
  const upd = (status, step, progress, error = null) =>
    db.prepare('UPDATE jobs SET status=?, step=?, progress=?, error=?, updated_at=? WHERE id=?')
      .run(status, step, progress, error, new Date().toISOString(), jobId);

  try {
    // 1. Parse
    upd('running', 'parse', 5);
    const { blocks, tables, pageCount } = await pdfParser.extractLayout(pdfPath);

    // 2. Chunk
    upd('running', 'chunk', 15);
    const firstPagesText = blocks.filter(b => b.pageNum <= 3).map(b => b.text).join(' ');
    const docType  = chunker.detectDocumentType(firstPagesText);
    const rawChunks = chunker.chunkDocument(blocks, docType, tables);

    // 3. Enrich (sequential Gemini calls)
    const enriched = [];
    for (let i = 0; i < rawChunks.length; i++) {
      upd('running', 'enrich', 15 + Math.round((i / rawChunks.length) * 40));
      enriched.push(await llmEnricher.enrichChunk(rawChunks[i], {
        docType,
        docTitle: meta.title || '',
      }));
    }

    // 4. Embed (sequential Gemini calls)
    const embeddings = [];
    for (let i = 0; i < rawChunks.length; i++) {
      upd('running', 'embed', 55 + Math.round((i / rawChunks.length) * 30));
      embeddings.push(await embedder.embedText(rawChunks[i].text));
    }

    // 5. Write to Neo4j
    upd('running', 'write', 85);
    const driver = getDriver(kbId);
    await graphWriter.writeGraph(driver, kbId, {
      id:         sha256,
      title:      meta.title      || '',
      authors:    meta.authors    || [],
      doi:        meta.doi        || null,
      year:       meta.year       || null,
      sourceType: meta.sourceType || docType,
      astmCode:   meta.astmCode   || null,
      journal:    meta.journal    || null,
      abstract:   meta.abstract   || null,
      keywords:   [],
      pdfPath,
      pageCount,
    }, rawChunks, enriched, embeddings);

    // 6. Update SQLite document + chunks
    const now = new Date().toISOString();
    db.prepare(`UPDATE documents SET status='done', ingested_at=? WHERE id=?`).run(now, sha256);

    const insChunk = db.prepare(
      `INSERT OR REPLACE INTO chunks (id, doc_id, chunk_index, section, chunk_type, token_count)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const c of rawChunks) {
      insChunk.run(`${sha256}_${c.index}`, sha256, c.index, c.section, c.chunkType, c.tokenCount);
    }

    // Update kb.json counts
    const kbJsonPath = path.join(DATA_DIR, kbId, 'kb.json');
    try {
      const kbJson = JSON.parse(fs.readFileSync(kbJsonPath, 'utf8'));
      kbJson.doc_count   = (kbJson.doc_count   || 0) + 1;
      kbJson.chunk_count = (kbJson.chunk_count  || 0) + rawChunks.length;
      kbJson.updated_at  = now;
      fs.writeFileSync(kbJsonPath, JSON.stringify(kbJson, null, 2), 'utf8');
    } catch { /* non-fatal */ }

    upd('done', 'write', 100);
    logger.info({ jobId, sha256, chunks: rawChunks.length }, 'ingest: pipeline complete');
  } catch (err) {
    logger.error({ err, jobId, sha256 }, 'ingest: pipeline failed');
    upd('failed', null, 0, err.message);
    db.prepare(`UPDATE documents SET status='error' WHERE id=?`).run(sha256);
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/ingest
 * Accepts a PDF via multipart/form-data.
 * Fields: pdf (file), kbId, meta (JSON string), source, sourceUrl
 */
router.post('/', upload.single('pdf'), async (req, res) => {
  const { kbId, source = 'upload' } = req.body || {};
  const file = req.file;

  if (!kbId)  return res.status(400).json({ error: 'kbId is required' });
  if (!file)  return res.status(400).json({ error: 'pdf file is required' });

  let meta = {};
  try { meta = JSON.parse(req.body.meta || '{}'); } catch { /* use empty */ }
  meta.originalName = file.originalname;

  let sha256;
  try {
    sha256 = sha256File(file.path);
  } catch (err) {
    fs.unlink(file.path, () => {});
    return res.status(500).json({ error: 'Failed to hash PDF' });
  }

  const db    = openDb(kbId);
  const jobId = `job_${crypto.randomUUID()}`;

  // Archive (or detect duplicate)
  let archiveResult;
  try {
    archiveResult = archivePdf(kbId, file.path, sha256, meta);
  } catch (err) {
    fs.unlink(file.path, () => {});
    db.close();
    logger.error({ err }, 'ingest: archive failed');
    return res.status(500).json({ error: 'Failed to archive PDF' });
  } finally {
    fs.unlink(file.path, () => {}); // always clean up tmp file
  }

  if (archiveResult.isDuplicate) {
    db.close();
    return res.status(202).json({ jobId: null, docId: sha256, status: 'skipped', isDuplicate: true });
  }

  // Insert document + job rows
  db.prepare(
    `INSERT OR IGNORE INTO documents (id, title, authors, doi, year, source_type, astm_code, pdf_path, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
  ).run(sha256, meta.title || '', JSON.stringify(meta.authors || []), meta.doi || null,
        meta.year || null, meta.sourceType || 'publication', meta.astmCode || null,
        archiveResult.pdfPath);

  db.prepare(
    `INSERT INTO jobs (id, doc_id, status, step, progress, created_at, updated_at)
     VALUES (?, ?, 'queued', 'parse', 0, ?, ?)`,
  ).run(jobId, sha256, new Date().toISOString(), new Date().toISOString());

  res.status(202).json({ jobId, docId: sha256, status: 'queued', isDuplicate: false });

  // Convert to MD then clean up encoding errors — both non-blocking and non-fatal
  convertToMd(kbId, sha256, archiveResult.pdfPath)
    .then(({ mdPath }) => cleanupMd(mdPath))
    .catch(err => logger.warn({ err, sha256 }, 'ingest: pdf→md conversion/cleanup failed (non-fatal)'));

  // Run pipeline after response
  setImmediate(() => runPipeline(jobId, kbId, archiveResult.pdfPath, sha256, meta, db)
    .finally(() => db.close()));
});

/**
 * POST /api/ingest/text
 * Ingests a plain-text page capture from the Chrome extension.
 * Body: { text, kbId, meta: { title, authors, doi, year, pageUrl }, source }
 */
router.post('/text', async (req, res) => {
  const { text, kbId, meta = {}, source = 'chrome-extension' } = req.body || {};

  if (!kbId) return res.status(400).json({ error: 'kbId is required' });
  if (!text) return res.status(400).json({ error: 'text is required' });

  const sha256 = crypto.createHash('sha256').update(text).digest('hex');
  const db     = openDb(kbId);
  const jobId  = `job_${crypto.randomUUID()}`;

  // Write text content as a .txt "pdf path" placeholder in archive index
  const archiveDir = getKbArchiveDir(kbId);
  fs.mkdirSync(archiveDir, { recursive: true });
  const txtPath = path.join(archiveDir, `${sha256}.txt`);
  fs.writeFileSync(txtPath, text, 'utf8');

  const index = readArchiveIndex(kbId);
  const isDuplicate = !!index.documents[sha256];
  if (!isDuplicate) {
    index.documents[sha256] = {
      sha256, title: meta.title || '', authors: meta.authors || [],
      doi: meta.doi || null, year: meta.year || null,
      source_type: 'web_capture', abstract: meta.abstract || null,
      added_at: new Date().toISOString(),
      page_url: meta.pageUrl || null,
    };
    writeArchiveIndex(kbId, index);
  }

  if (isDuplicate) {
    db.close();
    return res.status(202).json({ jobId: null, docId: sha256, status: 'skipped', isDuplicate: true });
  }

  db.prepare(
    `INSERT OR IGNORE INTO documents (id, title, authors, doi, year, source_type, pdf_path, status)
     VALUES (?, ?, ?, ?, ?, 'web_capture', ?, 'pending')`,
  ).run(sha256, meta.title || '', JSON.stringify(meta.authors || []), meta.doi || null,
        meta.year || null, txtPath);

  db.prepare(
    `INSERT INTO jobs (id, doc_id, status, step, progress, created_at, updated_at)
     VALUES (?, ?, 'queued', 'parse', 0, ?, ?)`,
  ).run(jobId, sha256, new Date().toISOString(), new Date().toISOString());

  res.status(202).json({ jobId, docId: sha256, status: 'queued', isDuplicate: false });

  // For text ingestion: skip pdfParser, use text directly as one chunk input
  setImmediate(async () => {
    const upd = (status, step, progress, error = null) =>
      db.prepare('UPDATE jobs SET status=?, step=?, progress=?, error=?, updated_at=? WHERE id=?')
        .run(status, step, progress, error, new Date().toISOString(), jobId);
    try {
      upd('running', 'chunk', 10);
      const fakeBlocks = [{ text, x0: 0, y0: 0, fontSize: 12, isBold: false, pageNum: 1 }];
      const docType   = chunker.detectDocumentType(text.slice(0, 3000));
      const rawChunks = chunker.chunkDocument(fakeBlocks, docType, []);

      const enriched = [];
      for (let i = 0; i < rawChunks.length; i++) {
        upd('running', 'enrich', 10 + Math.round((i / rawChunks.length) * 40));
        enriched.push(await llmEnricher.enrichChunk(rawChunks[i], { docType, docTitle: meta.title || '' }));
      }
      const embeddings = [];
      for (let i = 0; i < rawChunks.length; i++) {
        upd('running', 'embed', 50 + Math.round((i / rawChunks.length) * 35));
        embeddings.push(await embedder.embedText(rawChunks[i].text));
      }
      upd('running', 'write', 85);
      const driver = getDriver(kbId);
      await graphWriter.writeGraph(driver, kbId, {
        id: sha256, title: meta.title || '', authors: meta.authors || [],
        doi: meta.doi || null, year: meta.year || null, sourceType: 'web_capture',
        pdfPath: txtPath,
      }, rawChunks, enriched, embeddings);

      db.prepare(`UPDATE documents SET status='done', ingested_at=? WHERE id=?`)
        .run(new Date().toISOString(), sha256);
      upd('done', 'write', 100);
    } catch (err) {
      logger.error({ err, jobId }, 'ingest/text: pipeline failed');
      upd('failed', null, 0, err.message);
    } finally {
      db.close();
    }
  });
});

/**
 * POST /api/ingest/extract-abstract
 * Uses Gemini to extract and clean the abstract/scope from raw PDF text.
 * Body: { text: string, isAstm?: boolean }
 * Response: { abstract: string }
 */
router.post('/extract-abstract', async (req, res) => {
  const { text, isAstm = false } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text is required' });

  const docType = isAstm ? 'ASTM standard' : 'scientific publication';
  const section = isAstm ? 'Scope section (section 1, starting at "1.1")' : 'Abstract section';

  const prompt = `You are processing raw text extracted from a ${docType}.
The text may have PDF extraction artefacts: words concatenated without spaces, superscripts embedded as words, hyphenated line-breaks, etc.

Task: extract the ${section} and return it as one clean, properly spaced paragraph.
Rules:
- Fix all word-concatenation artefacts (e.g. "theprocess" → "the process")
- Remove footnote markers, superscripts, and page numbers
- Do NOT invent content — only use what is in the text
- Return only the abstract/scope text, no label, no markdown, no commentary
- Maximum 350 words

Raw document text (first pages):
${text.slice(0, 5000)}`;

  try {
    const { generateContent } = require('../utils/geminiClient');
    const abstract = await generateContent(prompt);
    res.json({ abstract: abstract.trim() });
  } catch (err) {
    logger.error({ err }, 'extract-abstract: Gemini call failed');
    res.status(500).json({ error: 'Failed to generate abstract' });
  }
});

/**
 * GET /api/ingest/jobs/:jobId
 * Returns current status of an ingestion job.
 */
router.get('/jobs/:jobId', (req, res) => {
  const { jobId } = req.params;
  // kbId must be passed as query param since jobs are per-KB
  const { kbId } = req.query;
  if (!kbId) return res.status(400).json({ error: 'kbId query param required' });

  try {
    const db  = new Database(getKbSqlitePath(kbId), { readonly: true });
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    db.close();
    if (!row) return res.status(404).json({ error: 'Job not found' });

    // Also get chunk count for progress detail
    const db2       = new Database(getKbSqlitePath(kbId), { readonly: true });
    const chunkRow  = db2.prepare('SELECT COUNT(*) AS n FROM chunks WHERE doc_id = ?').get(row.doc_id);
    db2.close();

    res.json({
      jobId:       row.id,
      docId:       row.doc_id,
      status:      row.status,
      step:        row.step,
      progress:    row.progress,
      chunksDone:  chunkRow ? chunkRow.n : 0,
      error:       row.error || null,
    });
  } catch (err) {
    logger.error({ err, jobId }, 'GET /ingest/jobs/:jobId failed');
    res.status(500).json({ error: 'Failed to fetch job status' });
  }
});

module.exports = router;
