/**
 * backend/utils/archiveManager.js
 * Handles PDF archive management and index.json for each KB.
 * Archive = source of truth. All ingestion copies PDF here first.
 */

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');
const logger = require('./logger');

/**
 * Get the path to the PDF archive directory for a KB
 * @param {string} kbId
 * @returns {string}
 */
function getArchiveDir(kbId) {
  return path.join(DATA_DIR, kbId, 'pdfs');
}

/**
 * Get the path to index.json for a KB
 * @param {string} kbId
 * @returns {string}
 */
function getIndexPath(kbId) {
  return path.join(getArchiveDir(kbId), 'index.json');
}

/**
 * Ensure the archive directory and index.json exist for a KB
 * @param {string} kbId
 */
function ensureArchive(kbId) {
  const archiveDir = getArchiveDir(kbId);
  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, { recursive: true });
    logger.info({ kbId, archiveDir }, 'Created archive directory');
  }
  const indexPath = getIndexPath(kbId);
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(indexPath, JSON.stringify({ pdfs: [] }, null, 2));
    logger.info({ kbId, indexPath }, 'Created index.json');
  }
}

/**
 * Add a PDF to the archive and update index.json
 * @param {string} kbId
 * @param {string} pdfPath - Path to the source PDF
 * @param {object} meta - Metadata (title, doi, etc.)
 * @returns {string} - Destination path in archive
 */
function addPdfToArchive(kbId, pdfPath, meta) {
  ensureArchive(kbId);
  const archiveDir = getArchiveDir(kbId);
  const fileName = path.basename(pdfPath);
  const destPath = path.join(archiveDir, fileName);
  fs.copyFileSync(pdfPath, destPath);
  // Update index.json
  const indexPath = getIndexPath(kbId);
  let index = { pdfs: [] };
  if (fs.existsSync(indexPath)) {
    index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  }
  index.pdfs.push({ ...meta, file: fileName });
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  logger.info({ kbId, fileName }, 'PDF added to archive');
  return destPath;
}

/**
 * List all PDFs in the archive for a KB
 * @param {string} kbId
 * @returns {Array<{file: string, ...}>}
 */
function listArchivePdfs(kbId) {
  const indexPath = getIndexPath(kbId);
  if (!fs.existsSync(indexPath)) return [];
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  return index.pdfs || [];
}

module.exports = {
  getArchiveDir,
  getIndexPath,
  ensureArchive,
  addPdfToArchive,
  listArchivePdfs,
};
