/**
 * backend/utils/pdfToMd.js
 * Converts an archived PDF to Markdown + images using scripts/pdf_to_md.py.
 * Output is stored in data/uploads/{kbId}/{sha256}/content.md + images/
 */

'use strict';

const { execFile } = require('child_process');
const fs   = require('fs');
const path = require('path');

const logger = require('./logger');
const { PDF_TO_MD_SCRIPT, getKbUploadsDir } = require('./config');

const PYTHON = process.env.SKB_PYTHON || 'python';

/**
 * Returns the directory where the Markdown output for a document lives.
 * @param {string} kbId
 * @param {string} sha256
 * @returns {string}
 */
function getMdDir(kbId, sha256) {
  return path.join(getKbUploadsDir(kbId), sha256);
}

/**
 * Returns the path to the converted content.md, or null if not yet converted.
 * @param {string} kbId
 * @param {string} sha256
 * @returns {string|null}
 */
function getMdPath(kbId, sha256) {
  const p = path.join(getMdDir(kbId, sha256), 'content.md');
  return fs.existsSync(p) ? p : null;
}

/**
 * Converts a PDF to Markdown asynchronously.
 * Resolves with { mdPath, imageCount, pageCount } on success.
 * Rejects on failure.
 * @param {string} kbId
 * @param {string} sha256
 * @param {string} pdfPath
 * @returns {Promise<{ mdPath: string, imageCount: number, pageCount: number }>}
 */
function convertToMd(kbId, sha256, pdfPath) {
  const outDir = getMdDir(kbId, sha256);
  fs.mkdirSync(outDir, { recursive: true });

  return new Promise((resolve, reject) => {
    execFile(
      PYTHON,
      [PDF_TO_MD_SCRIPT, pdfPath, outDir],
      { maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          logger.error({ err, stderr }, 'pdf_to_md: process error');
          return reject(new Error(stderr || err.message));
        }
        try {
          const result = JSON.parse(stdout.trim());
          if (result.error) return reject(new Error(result.error));
          logger.info({ kbId, sha256, ...result }, 'pdf_to_md: conversion complete');
          resolve({ mdPath: result.md_path, imageCount: result.image_count, pageCount: result.page_count });
        } catch (e) {
          reject(new Error(`pdf_to_md: invalid output: ${stdout}`));
        }
      },
    );
  });
}

module.exports = { convertToMd, getMdPath, getMdDir };
