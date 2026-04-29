/**
 * backend/retrieval/hybridRetriever.js
 * Executes vector search, graph expansion, and fulltext search against Neo4j,
 * then merges and deduplicates results into a ranked candidate list.
 */

'use strict';

const { embedText }   = require('../ingestion/embedder');
const logger          = require('../utils/logger');

const DEFAULT_TOP_K   = 8;
const DEFAULT_MIN_SCORE = 0.72;

/**
 * @typedef {Object} RetrievedChunk
 * @property {string} chunkId
 * @property {string} docId
 * @property {string} docTitle
 * @property {string} [doi]
 * @property {string} [pdfPath]
 * @property {string} text
 * @property {string} summary
 * @property {string} section
 * @property {string} chunkType
 * @property {number} relevanceScore
 * @property {string} [year]
 */

// ─── Individual search strategies ────────────────────────────────────────────

/**
 * Vector similarity search using the chunk_vector index.
 * @param {import('neo4j-driver').Session} session
 * @param {string} kbId
 * @param {number[]} embedding
 * @param {number} topK
 * @param {number} minScore
 * @returns {Promise<RetrievedChunk[]>}
 */
async function vectorSearch(session, kbId, embedding, topK, minScore) {
  const result = await session.readTransaction(tx => tx.run(
    `CALL db.index.vector.queryNodes('chunk_vector', $topK, $embedding)
     YIELD node AS chunk, score
     WHERE chunk.kbId = $kbId AND score >= $minScore
     MATCH (d:Document)-[:HAS_CHUNK]->(chunk)
     RETURN chunk.id        AS chunkId,
            chunk.text      AS text,
            chunk.summary   AS summary,
            chunk.section   AS section,
            chunk.chunkType AS chunkType,
            d.id            AS docId,
            d.title         AS docTitle,
            d.doi           AS doi,
            d.year          AS year,
            d.pdfPath       AS pdfPath,
            score
     ORDER BY score DESC`,
    { kbId, topK, embedding, minScore },
  ));
  return result.records.map(r => ({
    chunkId:       r.get('chunkId'),
    docId:         r.get('docId'),
    docTitle:      r.get('docTitle') || '',
    doi:           r.get('doi'),
    year:          r.get('year'),
    pdfPath:       r.get('pdfPath'),
    text:          r.get('text')    || '',
    summary:       r.get('summary') || '',
    section:       r.get('section') || '',
    chunkType:     r.get('chunkType') || '',
    relevanceScore: r.get('score'),
  }));
}

/**
 * Graph expansion: finds chunks sharing entities with the seed chunks.
 * @param {import('neo4j-driver').Session} session
 * @param {string} kbId
 * @param {string[]} seedChunkIds
 * @returns {Promise<RetrievedChunk[]>}
 */
async function graphExpansion(session, kbId, seedChunkIds) {
  if (!seedChunkIds.length) return [];
  const result = await session.readTransaction(tx => tx.run(
    `UNWIND $seedIds AS seedId
     MATCH (seed:Chunk {id: seedId})-[:MENTIONS]->(e:Entity)<-[:MENTIONS]-(related:Chunk)
     WHERE related.kbId = $kbId AND NOT related.id IN $seedIds
     MATCH (d:Document)-[:HAS_CHUNK]->(related)
     RETURN related.id       AS chunkId,
            related.text     AS text,
            related.summary  AS summary,
            related.section  AS section,
            related.chunkType AS chunkType,
            d.id             AS docId,
            d.title          AS docTitle,
            d.doi            AS doi,
            d.year           AS year,
            d.pdfPath        AS pdfPath,
            count(e)         AS sharedEntities
     ORDER BY sharedEntities DESC
     LIMIT 5`,
    { kbId, seedIds: seedChunkIds },
  ));
  return result.records.map(r => ({
    chunkId:        r.get('chunkId'),
    docId:          r.get('docId'),
    docTitle:       r.get('docTitle') || '',
    doi:            r.get('doi'),
    year:           r.get('year'),
    pdfPath:        r.get('pdfPath'),
    text:           r.get('text')    || '',
    summary:        r.get('summary') || '',
    section:        r.get('section') || '',
    chunkType:      r.get('chunkType') || '',
    relevanceScore: 0.6, // graph-expansion results get a fixed baseline score
  }));
}

/**
 * Fulltext search across chunk text, summary, and keywords.
 * @param {import('neo4j-driver').Session} session
 * @param {string} kbId
 * @param {string} queryText
 * @param {number} topK
 * @returns {Promise<RetrievedChunk[]>}
 */
async function fulltextSearch(session, kbId, queryText, topK) {
  try {
    const result = await session.readTransaction(tx => tx.run(
      `CALL db.index.fulltext.queryNodes('chunk_fulltext', $query)
       YIELD node AS chunk, score
       WHERE chunk.kbId = $kbId
       MATCH (d:Document)-[:HAS_CHUNK]->(chunk)
       RETURN chunk.id        AS chunkId,
              chunk.text      AS text,
              chunk.summary   AS summary,
              chunk.section   AS section,
              chunk.chunkType AS chunkType,
              d.id            AS docId,
              d.title         AS docTitle,
              d.doi           AS doi,
              d.year          AS year,
              d.pdfPath       AS pdfPath,
              score
       ORDER BY score DESC
       LIMIT $topK`,
      { kbId, query: queryText, topK },
    ));
    return result.records.map(r => ({
      chunkId:       r.get('chunkId'),
      docId:         r.get('docId'),
      docTitle:      r.get('docTitle') || '',
      doi:           r.get('doi'),
      year:          r.get('year'),
      pdfPath:       r.get('pdfPath'),
      text:          r.get('text')    || '',
      summary:       r.get('summary') || '',
      section:       r.get('section') || '',
      chunkType:     r.get('chunkType') || '',
      relevanceScore: Math.min(r.get('score') / 10, 1), // normalise Lucene score
    }));
  } catch (err) {
    logger.warn({ err }, 'hybridRetriever: fulltext search failed');
    return [];
  }
}

/**
 * Entity name lookup — finds chunks mentioning specific named entities.
 * @param {import('neo4j-driver').Session} session
 * @param {string} kbId
 * @param {string[]} entityNames
 * @returns {Promise<RetrievedChunk[]>}
 */
async function entitySearch(session, kbId, entityNames) {
  if (!entityNames.length) return [];
  const result = await session.readTransaction(tx => tx.run(
    `UNWIND $names AS eName
     MATCH (e:Entity {kbId: $kbId})
     WHERE toLower(e.name) CONTAINS toLower(eName)
     MATCH (c:Chunk)-[:MENTIONS]->(e)
     MATCH (d:Document)-[:HAS_CHUNK]->(c)
     RETURN DISTINCT
            c.id        AS chunkId,
            c.text      AS text,
            c.summary   AS summary,
            c.section   AS section,
            c.chunkType AS chunkType,
            d.id        AS docId,
            d.title     AS docTitle,
            d.doi       AS doi,
            d.year      AS year,
            d.pdfPath   AS pdfPath
     LIMIT 5`,
    { kbId, names: entityNames },
  ));
  return result.records.map(r => ({
    chunkId:       r.get('chunkId'),
    docId:         r.get('docId'),
    docTitle:      r.get('docTitle') || '',
    doi:           r.get('doi'),
    year:          r.get('year'),
    pdfPath:       r.get('pdfPath'),
    text:          r.get('text')    || '',
    summary:       r.get('summary') || '',
    section:       r.get('section') || '',
    chunkType:     r.get('chunkType') || '',
    relevanceScore: 0.65,
  }));
}

// ─── Merge & deduplicate ──────────────────────────────────────────────────────

/**
 * Merges candidate lists from multiple sources, keeping the highest score
 * for each unique chunkId.
 * @param {...RetrievedChunk[]} lists
 * @returns {RetrievedChunk[]}
 */
function mergeAndDedupe(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const chunk of list) {
      const existing = map.get(chunk.chunkId);
      if (!existing || chunk.relevanceScore > existing.relevanceScore) {
        map.set(chunk.chunkId, chunk);
      }
    }
  }
  return [...map.values()].sort((a, b) => b.relevanceScore - a.relevanceScore);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Runs the configured retrieval strategy and returns ranked chunks.
 * @param {import('neo4j-driver').Driver} driver
 * @param {string} kbId
 * @param {import('./queryPlanner').QueryPlan} plan
 * @param {Object} [opts]
 * @param {number}  [opts.topK=8]
 * @param {number}  [opts.minScore=0.72]
 * @param {boolean} [opts.useGraphExpansion=true]
 * @returns {Promise<RetrievedChunk[]>}
 */
async function retrieve(driver, kbId, plan, opts = {}) {
  const topK             = opts.topK            ?? DEFAULT_TOP_K;
  const minScore         = opts.minScore         ?? DEFAULT_MIN_SCORE;
  const useGraphExpansion = opts.useGraphExpansion ?? true;

  const session = driver.session();
  try {
    const vectorResults = [];
    const fulltextResults = [];

    // Run vector search for each sub-query (sequential — embedText uses geminiClient lock)
    if (plan.strategy !== 'graph_only') {
      for (const q of plan.subQueries) {
        const emb = await embedText(q);
        const hits = await vectorSearch(session, kbId, emb, topK, minScore);
        vectorResults.push(...hits);
        // Also fulltext
        const ft = await fulltextSearch(session, kbId, q, topK);
        fulltextResults.push(...ft);
      }
    }

    // Graph expansion on top vector seeds
    const graphResults = [];
    if (useGraphExpansion && plan.strategy !== 'vector_only') {
      const seedIds = [...new Set(vectorResults.slice(0, 5).map(c => c.chunkId))];
      graphResults.push(...await graphExpansion(session, kbId, seedIds));
    }

    // Entity lookup
    const entityResults = [];
    if (plan.entities.length) {
      entityResults.push(...await entitySearch(session, kbId, plan.entities));
    }

    const merged = mergeAndDedupe(vectorResults, fulltextResults, graphResults, entityResults);
    logger.debug({ kbId, total: merged.length }, 'hybridRetriever: retrieved');
    return merged.slice(0, topK * 2); // return up to 2× topK for synthesizer to trim
  } finally {
    await session.close();
  }
}

module.exports = { retrieve };
