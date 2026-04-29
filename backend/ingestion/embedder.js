/**
 * backend/ingestion/embedder.js
 * Wraps the Gemini embedding API (gemini-embedding-001, 3072 dims).
 * All calls are sequential via the geminiClient lock — never call embedAll
 * concurrently across parallel ingestion jobs.
 */

'use strict';

const { embedContent } = require('../utils/geminiClient');
const logger           = require('../utils/logger');

/**
 * Embeds a single text string.
 * Sequential by virtue of the geminiClient's sequential lock.
 * @param {string} text
 * @returns {Promise<number[]>} 3072-dimensional cosine-space vector
 */
async function embedText(text) {
  logger.debug({ chars: text.length }, 'embedder: embedding');
  return embedContent(text);
}

/**
 * Embeds every text in the array one at a time (strictly sequential).
 * Progress is logged every 10 items for visibility during long ingestions.
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
async function embedAll(texts) {
  const results = [];
  for (let i = 0; i < texts.length; i++) {
    if (i % 10 === 0) {
      logger.debug({ done: i, total: texts.length }, 'embedder: progress');
    }
    results.push(await embedText(texts[i]));
  }
  return results;
}

module.exports = { embedText, embedAll };
