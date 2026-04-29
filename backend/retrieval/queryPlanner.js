/**
 * backend/retrieval/queryPlanner.js
 * Decomposes a user question into sub-queries and a retrieval strategy
 * using Gemini. Output drives hybridRetriever.js.
 */

'use strict';

const { generateContent } = require('../utils/geminiClient');
const logger              = require('../utils/logger');

/**
 * @typedef {Object} QueryPlan
 * @property {string[]} subQueries  - 2–4 precise sub-queries for semantic search
 * @property {string[]} entities    - key entity names to look up in the graph
 * @property {'vector_only'|'graph_only'|'hybrid'} strategy
 * @property {boolean}  needsAstm   - true when ASTM standards are likely relevant
 */

/**
 * Strips markdown code fences from a Gemini response.
 * @param {string} raw
 * @returns {string}
 */
function stripFences(raw) {
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

/**
 * Decomposes a user question into a structured retrieval plan via Gemini.
 * Called once per query — sequential by virtue of the geminiClient lock.
 * @param {string} question
 * @param {string} kbName - Active knowledge base name (for prompt context)
 * @returns {Promise<QueryPlan>}
 */
async function planQuery(question, kbName) {
  const prompt = `You are a scientific document retrieval expert.
Decompose the user question into 2-4 precise sub-queries optimized for semantic search
over scientific literature and ASTM standards.
Respond with JSON only.

User question: ${question}
Active knowledge base: ${kbName}

Respond with:
{
  "subQueries": ["...", "..."],
  "entities": ["key entity names to look up"],
  "strategy": "vector_only | graph_only | hybrid",
  "needsAstm": true | false
}`;

  logger.debug({ question, kbName }, 'queryPlanner: planning');

  let raw;
  try {
    raw = await generateContent(prompt);
  } catch (err) {
    logger.error({ err }, 'queryPlanner: Gemini call failed, using fallback plan');
    return { subQueries: [question], entities: [], strategy: 'vector_only', needsAstm: false };
  }

  try {
    const p = JSON.parse(stripFences(raw));
    return {
      subQueries: Array.isArray(p.subQueries) ? p.subQueries : [question],
      entities:   Array.isArray(p.entities)   ? p.entities   : [],
      strategy:   ['vector_only', 'graph_only', 'hybrid'].includes(p.strategy) ? p.strategy : 'hybrid',
      needsAstm:  Boolean(p.needsAstm),
    };
  } catch (err) {
    logger.warn({ err, raw: raw.slice(0, 200) }, 'queryPlanner: parse failed, using fallback');
    return { subQueries: [question], entities: [], strategy: 'hybrid', needsAstm: false };
  }
}

module.exports = { planQuery };
