/**
 * backend/routes/query.js
 * POST /api/query — orchestrates the full RAG pipeline:
 *   planQuery → retrieve → synthesize
 */

'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');

const logger          = require('../utils/logger');
const { DATA_DIR }    = require('../utils/config');
const { getDriver }   = require('../utils/neo4jClient');
const { planQuery }   = require('../retrieval/queryPlanner');
const { retrieve }    = require('../retrieval/hybridRetriever');
const { synthesize }  = require('../retrieval/synthesizer');

const router = express.Router();

/**
 * POST /api/query
 * Body: {
 *   question: string,
 *   kbId: string,
 *   options?: {
 *     topK?: number,
 *     useGraphExpansion?: boolean,
 *     minScore?: number,
 *     includeChunks?: boolean
 *   }
 * }
 */
router.post('/', async (req, res) => {
  const { question, kbId, options = {} } = req.body || {};

  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'question is required' });
  }
  if (!kbId) {
    return res.status(400).json({ error: 'kbId is required' });
  }

  // Resolve KB name from kb.json for prompt context
  let kbName = kbId;
  try {
    const kbJson = JSON.parse(fs.readFileSync(path.join(DATA_DIR, kbId, 'kb.json'), 'utf8'));
    kbName = kbJson.name || kbId;
  } catch { /* fallback to kbId */ }

  let driver;
  try {
    driver = getDriver(kbId);
  } catch (err) {
    return res.status(503).json({ error: `Neo4j instance for KB "${kbId}" is not running` });
  }

  try {
    // 1. Plan
    const plan = await planQuery(question, kbName);
    logger.debug({ plan }, 'query: plan ready');

    // 2. Retrieve
    const chunks = await retrieve(driver, kbId, plan, {
      topK:             options.topK             ?? 8,
      minScore:         options.minScore         ?? 0.72,
      useGraphExpansion: options.useGraphExpansion ?? true,
    });

    // 3. Synthesize
    const result = await synthesize(question, chunks);

    const response = {
      answer:    result.answer,
      sources:   result.sources,
      entities:  result.entities,
      queryPlan: { subQueries: plan.subQueries, strategy: plan.strategy },
    };

    if (options.includeChunks) response.chunks = chunks;

    res.json(response);
  } catch (err) {
    logger.error({ err, question, kbId }, 'POST /api/query failed');
    res.status(500).json({ error: 'Query failed' });
  }
});

module.exports = router;
