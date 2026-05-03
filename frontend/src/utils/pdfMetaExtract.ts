/**
 * Client-side PDF metadata extractor using PDF.js.
 * Reads the first 3 pages and the document info dictionary to infer:
 *   title, authors, year, doi, astmCode, journal, abstract, sourceType
 */

import * as pdfjsLib from 'pdfjs-dist'

// Vite resolves this URL at build time — no separate copy step needed
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

export interface ExtractedMeta {
  title?:      string
  authors?:    string[]
  year?:       number
  doi?:        string
  astmCode?:   string
  journal?:    string
  abstract?:   string
  sourceType?: 'publication' | 'astm_standard'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clean(s: string) {
  return s.replace(/\s+/g, ' ').replace(/[^\x20-\x7EÀ-ſ]/g, ' ').trim()
}

function firstMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const p of patterns) {
    const m = text.match(p)
    if (m) return m[1]?.trim()
  }
}

// ─── Main extractor ───────────────────────────────────────────────────────────

export async function extractPdfMeta(file: File): Promise<ExtractedMeta> {
  const buffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buffer, verbosity: 0 }).promise

  // Extract text from first 3 pages
  const pagesToScan = Math.min(pdf.numPages, 3)
  let text = ''
  for (let i = 1; i <= pagesToScan; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    text += content.items.map((it: any) => it.str ?? '').join(' ') + '\n'
  }
  text = clean(text)

  // PDF document info dictionary
  let info: Record<string, string> = {}
  try {
    const meta = await pdf.getMetadata()
    info = (meta?.info ?? {}) as Record<string, string>
  } catch { /* non-fatal */ }

  return parse(text, info)
}

// ─── Pattern matching ─────────────────────────────────────────────────────────

function parse(text: string, info: Record<string, string>): ExtractedMeta {
  const result: ExtractedMeta = {}

  // ── Source type ──────────────────────────────────────────────────────────────
  const isAstm = /\bASTM\b/i.test(text) && /\b(Scope|Referenced Documents|Significance and Use)\b/.test(text)
  result.sourceType = isAstm ? 'astm_standard' : 'publication'

  // ── DOI ──────────────────────────────────────────────────────────────────────
  const doiRaw = firstMatch(text, [
    /\bDOI[:\s]+([10]\.\d{4,}\/[^\s,;()\[\]]+)/i,
    /\b(10\.\d{4,}\/[^\s,;()\[\]]{4,})/,
  ])
  if (doiRaw) result.doi = doiRaw.replace(/[.,;)\]]+$/, '')

  // ── ASTM code ─────────────────────────────────────────────────────────────────
  if (isAstm) {
    const astmRaw = firstMatch(text, [
      /Designation[:\s]+([A-Z]\d+(?:\/[A-Z]\d+[A-Z]?)?\s*[−\-]\s*\d{2,4})/i,
      /ASTM\s+([A-Z]\d+(?:\/[A-Z]\d+[A-Z]?)?\s*[−\-]\s*\d{2,4})/i,
    ])
    if (astmRaw) {
      // Normalise em-dash to hyphen: "E2911 − 23" → "E2911-23"
      result.astmCode = 'ASTM ' + astmRaw.replace(/\s*[−–\-]\s*/g, '-').replace(/\s+/g, '')
      // Year from code
      const ym = astmRaw.match(/[−–\-]\s*(\d{2,4})\s*$/)
      if (ym) {
        const y = parseInt(ym[1])
        result.year = y < 100 ? 2000 + y : y
      }
    }
  }

  // ── Year ──────────────────────────────────────────────────────────────────────
  if (!result.year) {
    const ym = firstMatch(text, [
      /Copyright\s+©?\s+\w+\s+(20\d{2})/i,
      /Published\s+\w+\s+(20\d{2})/i,
      /approved\s+\w+\s+\d+,\s+(20\d{2})/i,
      /\b(20\d{2})\b/,
    ])
    if (ym) result.year = parseInt(ym)
  }

  // ── Title ─────────────────────────────────────────────────────────────────────
  if (info.Title) {
    result.title = info.Title.trim()
  } else if (isAstm) {
    // ASTM: "Standard Guide/Practice/Test Method/Specification for ..."
    const tm = text.match(
      /Standard\s+(Guide|Test Method|Practice|Specification|Test Methods)\s+for\s+([\w\s,/\-()]+?)(?=\s{2,}|\d\.|This standard)/i,
    )
    if (tm) result.title = `Standard ${tm[1]} for ${tm[2].trim()}`
  } else {
    // Publication: title is usually the first long capitalised phrase
    const tm = text.match(/^([A-Z][^.!?\n]{30,120})/)
    if (tm) result.title = tm[1].trim()
  }

  // ── Authors ───────────────────────────────────────────────────────────────────
  if (!isAstm) {
    if (info.Author) {
      // PDF metadata Author field (may contain semicolon or comma-separated list)
      result.authors = info.Author.split(/[;,]/).map(a => a.trim()).filter(Boolean)
    } else {
      // Heuristic: look for "Name Name1, Name Name2" before Abstract keyword
      const beforeAbstract = text.split(/\bAbstract\b/i)[0] ?? text.slice(0, 600)
      const am = beforeAbstract.match(/([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+(?:,\s+[A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)*)/)
      if (am && am[1].split(',').length <= 8) {
        result.authors = am[1].split(',').map(a => a.trim()).filter(Boolean)
      }
    }
  }

  // ── Journal ───────────────────────────────────────────────────────────────────
  if (info.Subject) result.journal = info.Subject.trim()
  if (!result.journal && !isAstm) {
    const jm = firstMatch(text, [
      /(?:journal of|proceedings of|in:\s)([A-Z][^,.]{5,60})/i,
    ])
    if (jm) result.journal = jm.trim()
  }

  // ── Abstract ─────────────────────────────────────────────────────────────────
  if (!isAstm) {
    const am = text.match(/\bAbstract[.\s—\-:]+([^]+?)(?=\n\s*(?:Keywords?|Introduction|1\.|Background))/i)
    if (am) result.abstract = am[1].replace(/\s+/g, ' ').trim().slice(0, 1000)
  }

  return result
}
