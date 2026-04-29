/**
 * backend/ingestion/pdfParser.js
 * Extracts layout information from a PDF by spawning the pdfplumber Python
 * subprocess (scripts/pdf_parse.py). Returns structured text blocks and tables
 * ready for heuristic chunking.
 */

'use strict';

const { spawn } = require('child_process');

const logger            = require('../utils/logger');
const { PDF_PARSER_SCRIPT } = require('../utils/config');

// Allow overriding the Python binary (use 'python' on Windows if needed).
const PYTHON_BIN = process.env.SKB_PYTHON || 'python3';

/**
 * @typedef {Object} TextBlock
 * @property {string}  text     - Reconstructed line text
 * @property {number}  x0       - Left edge (PDF coordinates, origin bottom-left)
 * @property {number}  y0       - Bottom edge of the line (PDF coordinates)
 * @property {number}  fontSize - Dominant font size in the line (pt)
 * @property {boolean} isBold   - True when the majority of words use a bold font
 * @property {number}  pageNum  - 1-based page number
 */

/**
 * @typedef {Object} Table
 * @property {number}     pageNum - 1-based page number
 * @property {string[][]} rows    - 2-D array of cell text values (row-major)
 */

/**
 * @typedef {Object} ParsedPdf
 * @property {TextBlock[]} blocks    - Text lines in document reading order
 * @property {Table[]}     tables   - Tables extracted per page
 * @property {number}      pageCount
 */

/**
 * Extracts layout information from a PDF via a pdfplumber Python subprocess.
 * The subprocess writes JSON to stdout; any stderr output is captured and
 * included in the rejection message for easy diagnosis.
 *
 * @param {string} pdfPath - Absolute path to the PDF file
 * @returns {Promise<ParsedPdf>}
 */
function extractLayout(pdfPath) {
  return new Promise((resolve, reject) => {
    logger.debug({ pdfPath }, 'pdfParser: spawning python subprocess');

    const proc = spawn(PYTHON_BIN, [PDF_PARSER_SCRIPT, pdfPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks = [];
    const stderrChunks = [];

    proc.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    proc.stderr.on('data', (chunk) => stderrChunks.push(chunk));

    proc.on('error', (err) => {
      // spawn itself failed (e.g. python3 not found on PATH)
      reject(new Error(
        `pdfParser: failed to spawn "${PYTHON_BIN}" — is Python installed? ${err.message}`,
      ));
    });

    proc.on('close', (code) => {
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();

      if (code !== 0) {
        return reject(new Error(
          `pdfParser: pdf_parse.py exited with code ${code}` +
          (stderr ? ` — ${stderr}` : ''),
        ));
      }

      let parsed;
      try {
        parsed = JSON.parse(Buffer.concat(stdoutChunks).toString('utf8'));
      } catch (parseErr) {
        return reject(new Error(
          `pdfParser: subprocess output was not valid JSON — ${parseErr.message}`,
        ));
      }

      if (stderr) {
        // Warnings from pdfplumber (e.g. missing font metadata) — log but don't fail.
        logger.warn({ pdfPath, stderr }, 'pdfParser: subprocess stderr');
      }

      const result = {
        blocks:    Array.isArray(parsed.blocks)    ? parsed.blocks    : [],
        tables:    Array.isArray(parsed.tables)    ? parsed.tables    : [],
        pageCount: typeof parsed.pageCount === 'number' ? parsed.pageCount : 0,
      };

      logger.debug(
        { pdfPath, pageCount: result.pageCount, blockCount: result.blocks.length, tableCount: result.tables.length },
        'pdfParser: extraction complete',
      );

      resolve(result);
    });
  });
}

module.exports = { extractLayout };
