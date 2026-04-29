/**
 * backend/ingestion/graphWriter.js
 * Persists a fully-enriched, embedded document into Neo4j.
 * Uses MERGE exclusively — never CREATE — so re-ingestion is idempotent.
 *
 * Call order (managed by ingest.js):
 *   writeGraph(driver, kbId, docData, chunks, enriched, embeddings)
 */

'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');

// ─── ID helpers ───────────────────────────────────────────────────────────────

/**
 * Normalises a string into a URL-safe slug used as a stable Neo4j node ID.
 * @param {string} s
 * @returns {string}
 */
function slugify(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

/** @param {string} name @param {string} kbId */
const entityId  = (name, kbId)       => `${kbId}_${slugify(name)}`;
/** @param {string} docId @param {string} title */
const sectionId = (docId, title)     => `${docId}_${slugify(title)}`;

// ─── Cypher helpers ───────────────────────────────────────────────────────────

/**
 * Runs a Cypher statement inside a write transaction and returns the result.
 * @param {import('neo4j-driver').Session} session
 * @param {string} cypher
 * @param {Object} params
 */
async function run(session, cypher, params = {}) {
  return session.writeTransaction(tx => tx.run(cypher, params));
}

// ─── Node writers ─────────────────────────────────────────────────────────────

/**
 * MERGEs the Document node and sets all metadata properties.
 * @param {import('neo4j-driver').Session} session
 * @param {string} kbId
 * @param {DocData} d
 */
async function writeDocument(session, kbId, d) {
  await run(session, `
    MERGE (doc:Document {id: $id})
    SET doc.kbId       = $kbId,
        doc.title      = $title,
        doc.authors    = $authors,
        doc.doi        = $doi,
        doc.year       = $year,
        doc.sourceType = $sourceType,
        doc.astmCode   = $astmCode,
        doc.journal    = $journal,
        doc.abstract   = $abstract,
        doc.keywords   = $keywords,
        doc.pdfPath    = $pdfPath,
        doc.ingestedAt = datetime()
  `, {
    id:         d.id,
    kbId,
    title:      d.title      || '',
    authors:    d.authors    || [],
    doi:        d.doi        || null,
    year:       d.year       ? parseInt(d.year, 10) : null,
    sourceType: d.sourceType || 'publication',
    astmCode:   d.astmCode   || null,
    journal:    d.journal    || null,
    abstract:   d.abstract   || null,
    keywords:   d.keywords   || [],
    pdfPath:    d.pdfPath    || null,
  });
}

/**
 * MERGEs a Section node and links it to its Document.
 * @param {import('neo4j-driver').Session} session
 * @param {string} kbId
 * @param {string} docId
 * @param {string} sectionTitle
 * @param {number} pageStart
 * @param {number} pageEnd
 * @returns {Promise<string>} sectionNodeId
 */
async function writeSection(session, kbId, docId, sectionTitle, pageStart, pageEnd) {
  const sid = sectionId(docId, sectionTitle || 'root');
  await run(session, `
    MERGE (s:Section {id: $id})
    SET s.kbId      = $kbId,
        s.docId     = $docId,
        s.title     = $title,
        s.pageStart = $pageStart,
        s.pageEnd   = $pageEnd
    WITH s
    MATCH (d:Document {id: $docId})
    MERGE (d)-[:HAS_SECTION]->(s)
  `, { id: sid, kbId, docId, title: sectionTitle || '', pageStart, pageEnd });
  return sid;
}

/**
 * MERGEs a Chunk node, stores its embedding, and links it to Document + Section.
 * @param {import('neo4j-driver').Session} session
 * @param {string} kbId
 * @param {string} docId
 * @param {string} sectionNodeId
 * @param {import('./chunker').RawChunk} chunk
 * @param {import('./llmEnricher').EnrichedData} enriched
 * @param {number[]} embedding
 * @returns {Promise<string>} chunkNodeId
 */
async function writeChunk(session, kbId, docId, sectionNodeId, chunk, enriched, embedding) {
  const chunkNodeId = crypto.randomUUID();
  await run(session, `
    MERGE (c:Chunk {id: $id})
    SET c.kbId        = $kbId,
        c.docId       = $docId,
        c.sectionId   = $sectionId,
        c.chunkIndex  = $chunkIndex,
        c.chunkType   = $chunkType,
        c.text        = $text,
        c.summary     = $summary,
        c.keywords    = $keywords,
        c.pageStart   = $pageStart,
        c.pageEnd     = $pageEnd,
        c.tokenCount  = $tokenCount,
        c.embedding   = $embedding
    WITH c
    MATCH (d:Document {id: $docId})
    MERGE (d)-[:HAS_CHUNK]->(c)
    WITH c
    MATCH (s:Section {id: $sectionId})
    MERGE (s)-[:HAS_CHUNK]->(c)
  `, {
    id:         chunkNodeId,
    kbId,
    docId,
    sectionId:  sectionNodeId,
    chunkIndex: chunk.index,
    chunkType:  chunk.chunkType,
    text:       chunk.text,
    summary:    enriched.summary    || '',
    keywords:   enriched.keywords   || [],
    pageStart:  chunk.pageStart,
    pageEnd:    chunk.pageEnd,
    tokenCount: chunk.tokenCount,
    embedding,
  });
  return chunkNodeId;
}

/**
 * MERGEs NEXT_CHUNK between two consecutive chunk nodes.
 * @param {import('neo4j-driver').Session} session
 * @param {string} prevId
 * @param {string} currId
 */
async function linkNextChunk(session, prevId, currId) {
  await run(session, `
    MATCH (a:Chunk {id: $prevId}), (b:Chunk {id: $currId})
    MERGE (a)-[:NEXT_CHUNK]->(b)
  `, { prevId, currId });
}

/**
 * MERGEs Entity nodes extracted from a chunk and creates MENTIONS relationships.
 * @param {import('neo4j-driver').Session} session
 * @param {string} kbId
 * @param {string} docId
 * @param {string} chunkNodeId
 * @param {{ name: string, type: string }[]} entities
 * @returns {Promise<string[]>} entity node IDs
 */
async function writeEntities(session, kbId, docId, chunkNodeId, entities) {
  const ids = [];
  for (const ent of entities) {
    if (!ent.name) continue;
    const eid = entityId(ent.name, kbId);
    await run(session, `
      MERGE (e:Entity {id: $id})
      ON CREATE SET e.name = $name, e.type = $type, e.kbId = $kbId
      WITH e
      MATCH (c:Chunk {id: $chunkId})
      MERGE (c)-[r:MENTIONS]->(e)
      ON CREATE SET r.frequency = 1
      ON MATCH  SET r.frequency = r.frequency + 1
    `, { id: eid, name: ent.name, type: ent.type || 'unknown', kbId, chunkId: chunkNodeId });
    ids.push(eid);
  }
  return ids;
}

/**
 * MERGEs semantic RELATES_TO edges between Entity pairs.
 * @param {import('neo4j-driver').Session} session
 * @param {string} kbId
 * @param {string} docId
 * @param {{ from: string, relation: string, to: string }[]} relations
 */
async function writeRelations(session, kbId, docId, relations) {
  for (const rel of relations) {
    if (!rel.from || !rel.to) continue;
    const fromId = entityId(rel.from, kbId);
    const toId   = entityId(rel.to, kbId);
    await run(session, `
      MERGE (e1:Entity {id: $fromId})
      ON CREATE SET e1.name = $fromName, e1.kbId = $kbId
      MERGE (e2:Entity {id: $toId})
      ON CREATE SET e2.name = $toName, e2.kbId = $kbId
      MERGE (e1)-[r:RELATES_TO {relation: $relation}]->(e2)
      ON CREATE SET r.docId = $docId
    `, {
      fromId, fromName: rel.from,
      toId,   toName:   rel.to,
      relation: rel.relation || 'related',
      kbId, docId,
    });
  }
}

/**
 * MERGEs Claim nodes and links them to their chunk.
 * @param {import('neo4j-driver').Session} session
 * @param {string} kbId
 * @param {string} docId
 * @param {string} chunkNodeId
 * @param {string[]} claims
 */
async function writeClaims(session, kbId, docId, chunkNodeId, claims) {
  for (const claimText of claims) {
    if (!claimText) continue;
    const claimNodeId = crypto.randomUUID();
    await run(session, `
      MERGE (cl:Claim {id: $id})
      SET cl.text  = $text,
          cl.kbId  = $kbId,
          cl.docId = $docId
      WITH cl
      MATCH (c:Chunk {id: $chunkId})
      MERGE (c)-[:SUPPORTS]->(cl)
    `, { id: claimNodeId, text: claimText, kbId, docId, chunkId: chunkNodeId });
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} DocData
 * @property {string}   id          - SHA256 of PDF (document primary key)
 * @property {string}   title
 * @property {string[]} authors
 * @property {string}   [doi]
 * @property {number}   [year]
 * @property {string}   sourceType  - 'publication' | 'astm_standard'
 * @property {string}   [astmCode]
 * @property {string}   [journal]
 * @property {string}   [abstract]
 * @property {string[]} [keywords]
 * @property {string}   [pdfPath]
 */

/**
 * Writes a fully-enriched document into Neo4j using MERGE throughout.
 * Safe to call multiple times on the same document (idempotent).
 * @param {import('neo4j-driver').Driver} driver
 * @param {string} kbId
 * @param {DocData} docData
 * @param {import('./chunker').RawChunk[]} chunks
 * @param {import('./llmEnricher').EnrichedData[]} enriched - parallel to chunks
 * @param {number[][]} embeddings - parallel to chunks
 * @returns {Promise<void>}
 */
async function writeGraph(driver, kbId, docData, chunks, enriched, embeddings) {
  const session = driver.session();
  try {
    await writeDocument(session, kbId, docData);
    logger.debug({ docId: docData.id, chunks: chunks.length }, 'graphWriter: document MERGEd');

    // Section cache to avoid re-running the same section MERGE
    const sectionCache = new Map();
    const chunkNodeIds = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const enc   = enriched[i]   || {};
      const emb   = embeddings[i] || [];

      // MERGE Section (cached per title)
      const secTitle = chunk.section || 'General';
      let sid = sectionCache.get(secTitle);
      if (!sid) {
        sid = await writeSection(session, kbId, docData.id, secTitle, chunk.pageStart, chunk.pageEnd);
        sectionCache.set(secTitle, sid);
      }

      // MERGE Chunk
      const chunkNodeId = await writeChunk(session, kbId, docData.id, sid, chunk, enc, emb);
      chunkNodeIds.push(chunkNodeId);

      // NEXT_CHUNK link
      if (i > 0) await linkNextChunk(session, chunkNodeIds[i - 1], chunkNodeId);

      // Entities + their semantic relations
      await writeEntities(session, kbId, docData.id, chunkNodeId, enc.entities || []);
      await writeRelations(session, kbId, docData.id, enc.relations || []);

      // Claims
      await writeClaims(session, kbId, docData.id, chunkNodeId, enc.claims || []);

      logger.debug({ chunkIndex: i, total: chunks.length }, 'graphWriter: chunk written');
    }

    logger.info({ docId: docData.id, kbId, chunkCount: chunks.length }, 'graphWriter: document complete');
  } finally {
    await session.close();
  }
}

/**
 * Removes all nodes related to a document (chunks, sections, claims) before
 * re-ingestion. Entities are kept since they may be shared across documents.
 * @param {import('neo4j-driver').Driver} driver
 * @param {string} kbId
 * @param {string} docId
 * @returns {Promise<void>}
 */
async function deleteDocument(driver, kbId, docId) {
  const session = driver.session();
  try {
    await run(session, `
      MATCH (d:Document {id: $docId, kbId: $kbId})
      OPTIONAL MATCH (d)-[:HAS_CHUNK]->(c:Chunk)
      OPTIONAL MATCH (d)-[:HAS_SECTION]->(s:Section)
      OPTIONAL MATCH (c)-[:SUPPORTS]->(cl:Claim)
      DETACH DELETE c, s, cl, d
    `, { docId, kbId });
    logger.info({ docId, kbId }, 'graphWriter: document deleted from Neo4j');
  } finally {
    await session.close();
  }
}

module.exports = { writeGraph, deleteDocument };
