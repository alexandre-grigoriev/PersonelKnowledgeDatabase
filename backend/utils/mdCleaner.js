/**
 * backend/utils/mdCleaner.js
 * Post-processes a pdf_to_md-generated content.md using Gemini to fix
 * font-encoding corruptions common in ASTM/scientific PDFs (e.g. ◆u → Δν).
 * Preserves all Markdown structure and image references.
 */

'use strict';

const fs     = require('fs');
const logger = require('./logger');
const { generateContent } = require('./geminiClient');

const CHUNK_CHARS = 3000;

const SYSTEM_PROMPT = `You are correcting text extracted from a scientific PDF where a custom Symbol font caused character encoding errors.

Rules:
- Fix corrupted mathematical symbols and Greek letters using scientific context.
  Common patterns: ◆u or ◆ u → Δν (wavenumber), isolated ◆ → Δ (delta),
  ~ immediately before a symbol/variable → ( (opening parenthesis),
  ! immediately after a symbol/variable → ) (closing parenthesis).
- Fix any other garbled characters the same way — infer correct symbol from context.
- Preserve ALL Markdown formatting: headings (#/##/###), bold (**), lists, blank lines.
- Preserve image references exactly as-is: ![Figure N](images/fig_X_Y.png)
- Do NOT add, remove, or rephrase content — only fix encoding errors.
- Return ONLY the corrected Markdown text, no explanation.

Text to fix:`;

/**
 * Splits text into chunks at paragraph boundaries.
 * @param {string} text
 * @param {number} maxChars
 * @returns {string[]}
 */
function splitChunks(text, maxChars) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf('\n\n', end);
      if (boundary > start) end = boundary + 2;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

/**
 * Reads content.md, cleans encoding errors via Gemini, writes result back.
 * Non-fatal: if Gemini fails on a chunk the original chunk is kept.
 * @param {string} mdPath  absolute path to content.md
 * @returns {Promise<void>}
 */
async function cleanupMd(mdPath) {
  if (!fs.existsSync(mdPath)) return;

  const original = fs.readFileSync(mdPath, 'utf8');
  if (original.length < 100) return;

  const chunks = splitChunks(original, CHUNK_CHARS);
  logger.info({ mdPath, chunks: chunks.length, chars: original.length }, 'mdCleaner: starting');

  const cleaned = [];
  for (let i = 0; i < chunks.length; i++) {
    try {
      const result = await generateContent(`${SYSTEM_PROMPT}\n\n${chunks[i]}`);
      cleaned.push(result.trim());
      logger.debug({ i, total: chunks.length }, 'mdCleaner: chunk done');
    } catch (err) {
      logger.warn({ err, i }, 'mdCleaner: chunk failed, keeping original');
      cleaned.push(chunks[i]);
    }
  }

  fs.writeFileSync(mdPath, cleaned.join('\n\n'), 'utf8');
  logger.info({ mdPath }, 'mdCleaner: complete');
}

module.exports = { cleanupMd };
