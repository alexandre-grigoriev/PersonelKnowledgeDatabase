# DATA PREPROCESSING STRATEGY

## Goal
Normalize all input sources into consistent, high-quality Markdown files suitable for indexing, retrieval, and RAG workflows.

Each ingested item must produce:
- One `content.md` file (Gemini-cleaned)
- An abstract (auto-extracted then Gemini-improved)
- A dedicated `images/` subfolder (if images exist)
- Correct relative image references inside the Markdown
- Metadata describing the source and processing

---

## Storage Layout

```
data/{kbId}/
  pdfs/{sha256}.pdf          ← archive source of truth (never deleted on re-ingest)
  uploads/{sha256}/
    content.md               ← Gemini-cleaned Markdown
    images/
      fig_{page}_{n}.png     ← extracted figures (rendered, colour-corrected)
  metadata.db                ← SQLite (documents, chunks, jobs)
  neo4j/                     ← graph store
  kb.json                    ← KB metadata (name, colour, counts)
```

`uploads/` is cleared and regenerated every time the document is re-ingested.
When a document is deleted, its `uploads/{sha256}/` folder is removed alongside the PDF and graph nodes.

---

## Standard Markdown Structure

```md
# Section heading

Body paragraph text.

![Figure 1](images/fig_2_1.png)

## Sub-section
...
```

Image references are always **relative** to `content.md` so the backend image-serving route can resolve them.

---

## General Rules

### Image Handling

- Images are extracted page-by-page and stored in `images/fig_{page}_{globalIndex}.png`
- The `images/` folder is **wiped before each conversion run** to avoid stale files from previous extractions
- Images smaller than 60 × 60 px are discarded (decorative rules / icons)
- Identical images (same MD5 hash) are deduplicated — repeated headers / logos appear only once
- Image references inside `content.md` are rewritten to absolute API URLs by the frontend before rendering:
  `images/fig_2_1.png` → `/api/kb/{kbId}/archive/{sha256}/images/fig_2_1.png`

### Colorspace Correction

PDFs may embed images in CMYK, grayscale-inverted, or JBIG2 mask format.
To avoid colour inversion in the browser:
- Images are extracted via `page.get_image_info(xrefs=True)` to obtain the bounding box on the page
- Each image is rendered with `page.get_pixmap(clip=bbox, alpha=False)` — PyMuPDF renders it exactly as it appears visually, regardless of internal colorspace
- Result is always saved as RGB or grayscale PNG

### Font-Encoding Cleanup (Gemini post-processing)

ASTM and some scientific PDFs use custom Symbol fonts. PyMuPDF maps glyphs to wrong Unicode codepoints:

| Extracted | Correct |
|-----------|---------|
| `◆u` | `Δν` (wavenumber) |
| `◆` | `Δ` (delta) |
| `~` (before variable) | `(` |
| `!` (after variable) | `)` |

After `pdf_to_md.py` writes `content.md`, `backend/utils/mdCleaner.js`:
1. Splits the file into ~3 000-character chunks at paragraph boundaries
2. Sends each chunk to Gemini with an instruction to fix encoding errors while preserving Markdown structure and image references
3. Writes the corrected content back to `content.md`

This runs in the background (non-blocking, non-fatal). The ingestion job is already complete by then.

---

## 1. PDF Ingestion

### Tools
- **`scripts/pdf_to_md.py`** — PyMuPDF-based converter (image extraction + text)
- **`backend/utils/pdfToMd.js`** — Node wrapper, runs the script via `child_process.execFile`
- **`backend/utils/mdCleaner.js`** — Gemini post-processor for encoding cleanup

### Pipeline

```
User uploads PDF
    ↓
archivePdf()             copies to pdfs/{sha256}.pdf, updates index.json
    ↓
convertToMd()            runs pdf_to_md.py:
                           • sorts page blocks top-to-bottom (reading order)
                           • extracts text with heading detection (font size ratio)
                           • extracts images via page.get_image_info + get_pixmap (RGB render)
                           • writes uploads/{sha256}/content.md + images/
    ↓
cleanupMd()              Gemini fixes encoding errors in content.md (chunks of 3000 chars)
    ↓
runPipeline()            parse → chunk → enrich → embed → write to Neo4j + SQLite
```

### Abstract extraction

On the **frontend**, before submitting:
1. `pdfMetaExtract.ts` reads first 3 pages with pdf.js and runs regex patterns (title, year, DOI, ASTM code, authors, abstract section)
2. `POST /api/ingest/extract-abstract` sends the raw page text to Gemini → returns clean abstract sentence(s)
   - For ASTM standards: targets the Scope section (section 1)
   - For publications: targets the Abstract section

---

## 2. Web Page / Text Ingestion

### Processing
- Text content sent as JSON body to `POST /api/ingest/text`
- Stored as `{sha256}.txt` placeholder in the archive index (no PDF file)
- No `uploads/` folder is created (no image extraction)
- Abstract optionally provided by the user or extracted from the first paragraphs

---

## 3. Image / Screenshot Ingestion

### Processing
- Frontend wraps image metadata in a Markdown stub:
  ```md
  # {title}
  ![{title}]({filename})
  ## Description
  {abstract}
  ```
- Sent via `POST /api/ingest/text` as text content
- OCR not yet implemented — description / abstract must be entered manually

---

## 4. Scanned PDF Handling

Not yet implemented. Planned approach:
- Detect scanned pages (no extractable text blocks)
- Render each page as a high-DPI PNG using `page.get_pixmap()`
- Apply OCR (Tesseract or Gemini Vision) to extract text
- Proceed with standard chunking pipeline

---

## 5. Markdown File Handling

### Processing
- Content read directly (no transformation)
- Sent via `POST /api/ingest/text` as text content
- Title extracted from first `# heading`
- Abstract extracted from first non-heading paragraphs

---

## Pipeline Overview

```
Step 1  Detect file type         pdf | md/txt | image → route to correct handler

Step 2  Extract content          pdf_to_md.py (PyMuPDF) | f.text() | stub wrapper

Step 3  Extract images           page.get_pixmap(clip, alpha=False) → images/fig_P_N.png
        Deduplicate              MD5 hash comparison
        Colour-correct           RGB render, discard < 60×60 px

Step 4  Abstract                 regex (frontend) → Gemini cleanup → presFieldInput

Step 5  Gemini encoding fix      mdCleaner.js chunks content.md → Gemini → rewrite

Step 6  Ingestion pipeline       parse → chunk → enrich → embed → Neo4j + SQLite

Step 7  Archive update           index.json + kb.json counts
```

---

## Acceptance Criteria

A document is valid after ingestion if:

- [x] PDF archived to `pdfs/{sha256}.pdf`
- [x] `uploads/{sha256}/content.md` exists with clean encoding
- [x] `uploads/{sha256}/images/` contains all figures ≥ 60×60 px, colour-correct
- [x] Image references in `content.md` are relative (`images/fig_P_N.png`)
- [x] Abstract is present in archive `index.json`
- [x] Neo4j `Document` + `Chunk` nodes created with embeddings
- [x] SQLite `documents` row has `status = 'done'`
- [x] `kb.json` `doc_count` and `chunk_count` are updated
- [ ] OCR applied for scanned PDFs *(planned)*
- [ ] GitHub URL ingestion *(planned)*
