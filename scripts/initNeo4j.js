/**
 * scripts/initNeo4j.js
 * DDL initialization: creates all constraints and indexes for a KB's Neo4j instance.
 * Idempotent — every statement uses IF NOT EXISTS.
 *
 * CLI usage:
 *   node scripts/initNeo4j.js --port 7687 [--host localhost] [--kbId <id>]
 *   Credentials via NEO4J_USERNAME / NEO4J_PASSWORD env vars (default: neo4j/neo4j).
 *
 * Programmatic usage (by neo4jClient.js and rebuildKb.js):
 *   const { initNeo4j } = require('./scripts/initNeo4j');
 *   await initNeo4j(driver);
 */

'use strict';

const neo4j = require('neo4j-driver');
const logger = require('../backend/utils/logger');

const DDL_STATEMENTS = [
  // Uniqueness constraints
  'CREATE CONSTRAINT doc_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE',
  'CREATE CONSTRAINT chunk_id IF NOT EXISTS FOR (c:Chunk) REQUIRE c.id IS UNIQUE',
  'CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (e:Entity) REQUIRE e.id IS UNIQUE',
  'CREATE CONSTRAINT section_id IF NOT EXISTS FOR (s:Section) REQUIRE s.id IS UNIQUE',

  // KB-scoped lookup indexes
  'CREATE INDEX doc_kb IF NOT EXISTS FOR (d:Document) ON (d.kbId)',
  'CREATE INDEX chunk_kb IF NOT EXISTS FOR (c:Chunk) ON (c.kbId)',
  'CREATE INDEX entity_kb IF NOT EXISTS FOR (e:Entity) ON (e.kbId)',

  // Fulltext search indexes
  'CREATE FULLTEXT INDEX chunk_fulltext IF NOT EXISTS FOR (c:Chunk) ON EACH [c.text, c.summary, c.keywords]',
  'CREATE FULLTEXT INDEX doc_fulltext IF NOT EXISTS FOR (d:Document) ON EACH [d.title, d.abstract, d.keywords]',

  // Vector similarity index — 3072 dims matches gemini-embedding-001, cosine matches scoring in hybridRetriever
  `CREATE VECTOR INDEX chunk_vector IF NOT EXISTS FOR (c:Chunk) ON (c.embedding) OPTIONS { indexConfig: { \`vector.dimensions\`: 3072, \`vector.similarity_function\`: 'cosine' } }`,
];

/**
 * Creates all Neo4j constraints and indexes for a KB database.
 * Safe to call on an already-initialized instance (IF NOT EXISTS guards every statement).
 * Statements run sequentially — never in parallel.
 * @param {import('neo4j-driver').Driver} driver - Connected Neo4j driver for this KB's instance
 * @returns {Promise<void>}
 */
async function initNeo4j(driver) {
  const session = driver.session();
  try {
    for (const stmt of DDL_STATEMENTS) {
      logger.debug({ stmt }, 'neo4j ddl');
      await session.run(stmt);
    }
    logger.info('neo4j schema initialized');
  } finally {
    await session.close();
  }
}

// CLI entrypoint — only runs when executed directly
if (require.main === module) {
  const args = process.argv.slice(2);

  /**
   * @param {string} name
   * @param {string} [fallback]
   * @returns {string}
   */
  function arg(name, fallback) {
    const i = args.indexOf(`--${name}`);
    return i !== -1 ? args[i + 1] : fallback;
  }

  const port     = parseInt(arg('port', '7687'), 10);
  const host     = arg('host', 'localhost');
  const kbId     = arg('kbId');
  const username = process.env.NEO4J_USERNAME || 'neo4j';
  const password = process.env.NEO4J_PASSWORD || 'neo4j';
  const uri      = `bolt://${host}:${port}`;

  logger.info({ uri, kbId }, 'connecting to neo4j');

  const driver = neo4j.driver(uri, neo4j.auth.basic(username, password));

  initNeo4j(driver)
    .then(() => driver.close())
    .then(() => {
      logger.info({ kbId, uri }, 'init complete');
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err, kbId, uri }, 'initNeo4j failed');
      driver.close().finally(() => process.exit(1));
    });
}

module.exports = { initNeo4j };
