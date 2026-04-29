/**
 * backend/ingestion/chunker.js
 * Pass 1 of 2 — heuristic segmentation of PDF text blocks into RawChunks.
 * No LLM calls, no network. Fast and fully deterministic.
 *
 * Public API:
 *   detectDocumentType(firstPagesText) → 'publication' | 'astm_standard' | 'unknown'
 *   chunkDocument(blocks, docType, tables?) → RawChunk[]
 *   countTokens(text) → number
 */

'use strict';

/**
 * @typedef {import('./pdfParser').TextBlock} TextBlock
 * @typedef {import('./pdfParser').Table} Table
 */

/**
 * @typedef {Object} RawChunk
 * @property {number} index
 * @property {string} text
 * @property {string} chunkType - 'abstract'|'section'|'subsection'|'table'|'figure_caption'|'reference_list'
 * @property {string} section   - parent section title
 * @property {number} pageStart
 * @property {number} pageEnd
 * @property {number} tokenCount
 */

const MAX_TOKENS     = 800;
const REF_GROUP_SIZE = 8; // within the 5–10 range from spec

// ─── Token utilities ──────────────────────────────────────────────────────────

/**
 * Approximates token count at 1 token ≈ 4 characters.
 * @param {string} text
 * @returns {number}
 */
function countTokens(text) {
  return Math.ceil((text || '').length / 4);
}

/**
 * Returns the first two complete sentences of a text, used as the overlap
 * prefix prepended to the following chunk.
 * @param {string} text
 * @returns {string}
 */
function firstTwoSentences(text) {
  const m = (text || '').match(/[^.!?]*[.!?]+/g);
  return m ? m.slice(0, 2).join(' ').trim() : '';
}

// ─── Known H1 section titles for scientific publications ─────────────────────

const PUB_H1_TITLES = new Set([
  'abstract',
  'introduction', 'background', 'related work', 'related works',
  'methods', 'method', 'methodology', 'materials and methods',
  'experimental', 'experimental section', 'experiments',
  'results', 'results and discussion',
  'discussion', 'conclusion', 'conclusions', 'summary',
  'acknowledgements', 'acknowledgments', 'funding',
  'references', 'bibliography', 'literature cited',
  'supplementary', 'supplementary material', 'appendix',
  'theory', 'overview', 'approach', 'limitations', 'future work',
]);

// ─── Document type detection ──────────────────────────────────────────────────

/**
 * Detects the document type from the concatenated text of the first 3 pages.
 * @param {string} firstPagesText
 * @returns {'publication' | 'astm_standard' | 'unknown'}
 */
function detectDocumentType(firstPagesText) {
  const text = firstPagesText || '';

  const isAstm =
    /\bASTM\s+[A-Z]\d+/i.test(text) &&
    /\b1\s*\.\s*(Scope|Application)\b/i.test(text);
  if (isAstm) return 'astm_standard';

  const hasAbstract     = /\bAbstract\b/i.test(text);
  const hasIntroduction = /\bIntroduction\b/i.test(text);
  const hasDoi          = /\b10\.\d{4,}\/\S+/.test(text);
  const hasKeywords     = /\bKeywords?\s*:/i.test(text);

  if (hasAbstract && (hasIntroduction || hasDoi || hasKeywords)) return 'publication';
  if (hasAbstract) return 'publication';

  return 'unknown';
}

// ─── Body font size (mode across all blocks) ─────────────────────────────────

/**
 * @param {TextBlock[]} blocks
 * @returns {number}
 */
function detectBodyFontSize(blocks) {
  const freq = new Map();
  for (const b of blocks) {
    if (!b.fontSize) continue;
    const key = Math.round(b.fontSize * 2) / 2; // quantise to 0.5 pt
    freq.set(key, (freq.get(key) || 0) + 1);
  }
  let bodySize = 12;
  let maxFreq  = 0;
  for (const [size, count] of freq) {
    if (count > maxFreq) { maxFreq = count; bodySize = size; }
  }
  return bodySize;
}

// ─── Heading classifiers ──────────────────────────────────────────────────────

/**
 * Classifies a block as a publication heading or returns null.
 * H1: known section name, or large font + bold/allcaps.
 * H2: two-level numbered ("2.1 Title") + bold or slightly large.
 * H3: three-level numbered ("2.1.3 Title").
 * @param {TextBlock} block
 * @param {number} bodyFontSize
 * @returns {{ level: 1|2|3, title: string } | null}
 */
function classifyPublicationHeading(block, bodyFontSize) {
  const text = block.text.trim();
  if (!text || text.length > 120) return null; // headings are short

  const lower    = text.toLowerCase();
  const isLarge  = block.fontSize >= bodyFontSize * 1.2;
  const isAllCaps = text.length > 3 && text === text.toUpperCase() && /[A-Z]/.test(text);

  // H3 before H2 to avoid partial match on "2.1.3"
  if (/^\d+\.\d+\.\d+\s+\S/.test(text) && (block.isBold || isLarge)) {
    return { level: 3, title: text };
  }
  if (/^\d+\.\d+\s+\S/.test(text) && (block.isBold || isLarge)) {
    return { level: 2, title: text };
  }
  if (PUB_H1_TITLES.has(lower) || (isLarge && (block.isBold || isAllCaps))) {
    return { level: 1, title: text };
  }
  return null;
}

/**
 * Returns true when a block starts an ASTM numbered section or annex.
 * Matches: "1.", "1.1", "A1.", "Annex A", "Appendix X1"
 * @param {TextBlock} block
 * @returns {boolean}
 */
function isAstmSectionHeading(block) {
  const t = block.text.trim();
  return /^\d+(\.\d+)*\s+\S/.test(t) || /^(Annex|Appendix)\s+[A-Z0-9]/i.test(t);
}

/** @param {TextBlock} b */
function isFigureCaption(b) {
  return /^(fig(ure)?\.?\s*\d+)/i.test(b.text.trim());
}

// ─── Chunk factory ────────────────────────────────────────────────────────────

/**
 * @param {{ index:number, text:string, chunkType:string, section:string, pageStart:number, pageEnd:number }} p
 * @returns {RawChunk}
 */
function makeChunk({ index, text, chunkType, section, pageStart, pageEnd }) {
  const t = (text || '').trim();
  return { index, text: t, chunkType, section, pageStart, pageEnd, tokenCount: countTokens(t) };
}

/**
 * Splits a text that exceeds MAX_TOKENS into subsection chunks at sentence
 * boundaries. Used when an H1 section is too long to be a single chunk.
 * @param {string} text
 * @param {string} section
 * @param {number} pageStart
 * @param {number} pageEnd
 * @param {number} startIndex
 * @returns {RawChunk[]}
 */
function splitLong(text, section, pageStart, pageEnd, startIndex) {
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s+|$)/g) || [text];
  const result = [];
  let buf = '';
  let idx = startIndex;

  for (const s of sentences) {
    if (countTokens(buf + s) > MAX_TOKENS && buf) {
      result.push(makeChunk({ index: idx++, text: buf, chunkType: 'subsection', section, pageStart, pageEnd }));
      buf = s;
    } else {
      buf += s;
    }
  }
  if (buf.trim()) {
    result.push(makeChunk({ index: idx, text: buf, chunkType: 'subsection', section, pageStart, pageEnd }));
  }
  return result;
}

// ─── Table formatter ──────────────────────────────────────────────────────────

/**
 * Renders a table's rows as pipe-separated text.
 * ASTM tables get a section context prefix.
 * @param {Table} table
 * @param {string} [sectionPrefix]
 * @returns {string}
 */
function formatTable(table, sectionPrefix) {
  const rows = table.rows.map(row => row.join(' | ')).join('\n');
  return sectionPrefix ? `[Section: ${sectionPrefix}]\n${rows}` : rows;
}

// ─── Publication chunker ──────────────────────────────────────────────────────

/**
 * @param {TextBlock[]} blocks
 * @param {Table[]} tables
 * @returns {RawChunk[]}
 */
function chunkPublication(blocks, tables) {
  const bodyFontSize = detectBodyFontSize(blocks);
  const chunks       = [];

  // Index tables by page for in-order interleaving
  /** @type {Map<number, Table[]>} */
  const tablesByPage    = new Map();
  const emittedTablePgs = new Set();
  for (const t of tables) {
    if (!tablesByPage.has(t.pageNum)) tablesByPage.set(t.pageNum, []);
    tablesByPage.get(t.pageNum).push(t);
  }

  // ── State ──
  let currentSection = '';
  let currentType    = 'section'; // 'abstract' | 'section' | 'reference_list'
  let overlapText    = '';
  let inReferences   = false;

  /** @type {{ text: string, pageNum: number }[]} */
  let buf = [];

  /** @type {{ text: string, pageNum: number }[]} */
  let refBuf = [];

  // ── Helpers ──
  const emitTablesForPage = (pageNum) => {
    if (emittedTablePgs.has(pageNum) || !tablesByPage.has(pageNum)) return;
    emittedTablePgs.add(pageNum);
    for (const tbl of tablesByPage.get(pageNum)) {
      const text = formatTable(tbl);
      if (!text.trim()) continue;
      chunks.push(makeChunk({
        index: chunks.length, text, chunkType: 'table',
        section: currentSection, pageStart: pageNum, pageEnd: pageNum,
      }));
    }
  };

  const flushBuf = () => {
    if (!buf.length) return;
    const pageStart = buf[0].pageNum;
    const pageEnd   = buf[buf.length - 1].pageNum;
    const joined    = buf.map(b => b.text).join(' ');
    buf = [];
    if (!joined.trim()) return;

    const withOverlap = (overlapText && currentType === 'section')
      ? `${overlapText} ${joined}`
      : joined;

    if (countTokens(withOverlap) > MAX_TOKENS && currentType === 'section') {
      const sub = splitLong(withOverlap, currentSection, pageStart, pageEnd, chunks.length);
      chunks.push(...sub);
      if (sub.length) overlapText = firstTwoSentences(sub[sub.length - 1].text);
    } else {
      chunks.push(makeChunk({
        index: chunks.length, text: withOverlap, chunkType: currentType,
        section: currentSection, pageStart, pageEnd,
      }));
      overlapText = currentType === 'abstract' ? '' : firstTwoSentences(withOverlap);
    }
  };

  const flushRefs = () => {
    if (!refBuf.length) return;
    const pageStart = refBuf[0].pageNum;
    const pageEnd   = refBuf[refBuf.length - 1].pageNum;
    chunks.push(makeChunk({
      index: chunks.length, text: refBuf.map(r => r.text).join('\n'),
      chunkType: 'reference_list', section: 'References', pageStart, pageEnd,
    }));
    refBuf = [];
    overlapText = '';
  };

  // ── Main loop ──
  for (const block of blocks) {
    if (!block.text.trim()) continue;

    emitTablesForPage(block.pageNum);

    // Figure captions → immediate standalone chunk
    if (isFigureCaption(block)) {
      inReferences ? flushRefs() : flushBuf();
      chunks.push(makeChunk({
        index: chunks.length, text: block.text.trim(), chunkType: 'figure_caption',
        section: currentSection, pageStart: block.pageNum, pageEnd: block.pageNum,
      }));
      continue;
    }

    const heading = classifyPublicationHeading(block, bodyFontSize);

    if (heading) {
      inReferences ? flushRefs() : flushBuf();
      inReferences   = false;
      currentSection = heading.title;
      const lower    = heading.title.toLowerCase();

      if (lower === 'abstract') {
        currentType = 'abstract';
        overlapText = '';
      } else if (lower === 'references' || lower === 'bibliography' || lower === 'literature cited') {
        inReferences = true;
        currentType  = 'reference_list';
        overlapText  = '';
      } else {
        currentType = heading.level === 1 ? 'section' : 'subsection';
      }
      continue;
    }

    if (inReferences) {
      refBuf.push({ text: block.text.trim(), pageNum: block.pageNum });
      if (refBuf.length >= REF_GROUP_SIZE) flushRefs();
      continue;
    }

    buf.push({ text: block.text.trim(), pageNum: block.pageNum });
  }

  // Drain remaining state
  if (inReferences) flushRefs();
  else flushBuf();

  // Emit tables from pages not encountered in the block loop (e.g. table-only pages)
  for (const pageNum of tablesByPage.keys()) emitTablesForPage(pageNum);

  chunks.forEach((c, i) => { c.index = i; });
  return chunks;
}

// ─── ASTM chunker ─────────────────────────────────────────────────────────────

/**
 * @param {TextBlock[]} blocks
 * @param {Table[]} tables
 * @returns {RawChunk[]}
 */
function chunkAstmStandard(blocks, tables) {
  const chunks = [];

  /** @type {Map<number, Table[]>} */
  const tablesByPage    = new Map();
  const emittedTablePgs = new Set();
  for (const t of tables) {
    if (!tablesByPage.has(t.pageNum)) tablesByPage.set(t.pageNum, []);
    tablesByPage.get(t.pageNum).push(t);
  }

  let currentSection = '';
  /** @type {{ text: string, pageNum: number }[]} */
  let buf = [];

  const emitTablesForPage = (pageNum) => {
    if (emittedTablePgs.has(pageNum) || !tablesByPage.has(pageNum)) return;
    emittedTablePgs.add(pageNum);
    for (const tbl of tablesByPage.get(pageNum)) {
      const text = formatTable(tbl, currentSection || undefined);
      if (!text.trim()) continue;
      chunks.push(makeChunk({
        index: chunks.length, text, chunkType: 'table',
        section: currentSection, pageStart: pageNum, pageEnd: pageNum,
      }));
    }
  };

  const flushBuf = () => {
    if (!buf.length) return;
    const pageStart = buf[0].pageNum;
    const pageEnd   = buf[buf.length - 1].pageNum;
    const text      = buf.map(b => b.text).join(' ');
    buf = [];
    if (!text.trim()) return;

    if (countTokens(text) > MAX_TOKENS) {
      const sub = splitLong(text, currentSection, pageStart, pageEnd, chunks.length);
      chunks.push(...sub);
    } else {
      chunks.push(makeChunk({
        index: chunks.length, text, chunkType: 'section',
        section: currentSection, pageStart, pageEnd,
      }));
    }
  };

  for (const block of blocks) {
    if (!block.text.trim()) continue;

    emitTablesForPage(block.pageNum);

    if (isAstmSectionHeading(block)) {
      flushBuf();
      currentSection = block.text.trim();
      continue;
    }

    buf.push({ text: block.text.trim(), pageNum: block.pageNum });
  }

  flushBuf();
  for (const pageNum of tablesByPage.keys()) emitTablesForPage(pageNum);

  chunks.forEach((c, i) => { c.index = i; });
  return chunks;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Heuristically segments a document's text blocks into RawChunks.
 * Tables are interleaved at their page positions.
 * No LLM calls — deterministic and network-free.
 *
 * @param {TextBlock[]} blocks  - From pdfParser.extractLayout()
 * @param {'publication' | 'astm_standard' | 'unknown'} docType
 * @param {Table[]} [tables=[]] - From pdfParser.extractLayout()
 * @returns {RawChunk[]}
 */
function chunkDocument(blocks, docType, tables = []) {
  if (docType === 'astm_standard') return chunkAstmStandard(blocks, tables);
  return chunkPublication(blocks, tables); // 'unknown' treated as publication
}

module.exports = { detectDocumentType, chunkDocument, countTokens };
