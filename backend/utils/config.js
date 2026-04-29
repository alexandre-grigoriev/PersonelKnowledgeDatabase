/**
 * backend/utils/config.js
 * Centralizes environment variables and platform-specific paths.
 * Always use path.join for cross-platform compatibility.
 * No hardcoded forward slashes.
 */

const path = require('path');

// Root directory (project root)
const ROOT_DIR = path.resolve(__dirname, '../..');

// Data directory (where all KBs are stored)
const DATA_DIR = process.env.SKB_DATA_DIR || path.join(ROOT_DIR, 'data');

// Neo4j binaries directory (for embedded Neo4j)
const NEO4J_BIN_DIR = process.env.SKB_NEO4J_BIN_DIR || path.join(ROOT_DIR, 'neo4j-bin');

// Default port for backend API
const API_PORT = process.env.SKB_API_PORT || 3000;

// Default port range for Neo4j instances
const NEO4J_PORT_START = parseInt(process.env.SKB_NEO4J_PORT_START || '7687', 10);
const NEO4J_PORT_END = parseInt(process.env.SKB_NEO4J_PORT_END || '7787', 10);

// PDF parsing Python script path
const PDF_PARSER_SCRIPT = process.env.SKB_PDF_PARSER_SCRIPT || path.join(ROOT_DIR, 'scripts', 'pdf_parse.py');

// Archive directory (where PDF source of truth is stored)
function getKbArchiveDir(kbId) {
  return path.join(DATA_DIR, kbId, 'pdfs');
}

// Neo4j data directory for a given KB
function getKbNeo4jDir(kbId) {
  return path.join(DATA_DIR, kbId, 'neo4j');
}

// SQLite DB path for a given KB
function getKbSqlitePath(kbId) {
  return path.join(DATA_DIR, kbId, 'metadata.db');
}

module.exports = {
  ROOT_DIR,
  DATA_DIR,
  NEO4J_BIN_DIR,
  API_PORT,
  NEO4J_PORT_START,
  NEO4J_PORT_END,
  PDF_PARSER_SCRIPT,
  getKbArchiveDir,
  getKbNeo4jDir,
  getKbSqlitePath,
};
