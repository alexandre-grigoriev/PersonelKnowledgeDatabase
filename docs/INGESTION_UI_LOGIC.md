# KB Dialog — UI Logic

The KB dialog (`EditKbModal`) opens when the user clicks **Edit selected KB…** in the header gear menu.
It is a wide modal (720 px) with three tabs that are **all mounted simultaneously** — switching tabs only
toggles `display`, so running jobs and scroll state survive navigation between tabs.

---

## Modal lifecycle

| Event | Effect |
|---|---|
| Open | `docCount` initialised from `kb.docCount`; global settings (Gemini models) fetched |
| `onRefresh()` | Calls `loadKbs()` in the parent — updates `kb.docCount` → `useEffect` syncs `docCount` in the tab label |
| `onDone()` | Calls `loadKbs()` **and** closes the modal |
| `onClose()` | Closes the modal without refreshing |

---

## Tab 1 — Ingest

**Component:** `<Ingest kbId onDone>`
**Mount strategy:** always mounted; `key={ingestKey}` resets the form after each successful job.

### Flow

```
User drops / picks a file
    ↓
pickFile() detects type: pdf | text | image
    ↓
PDF  → extractPdfMeta()   reads first 3 pages with pdf.js
         fills Title, ASTM code, Authors, Year, DOI, Abstract (regex)
         then extractAbstract() sends raw text to Gemini → overwrites Abstract with clean version
    ↓
MD/TXT → reads text, extracts first # heading as Title, first paragraphs as Abstract
    ↓
Image  → pre-fills Title from filename; Abstract left blank
    ↓
User reviews / edits fields, clicks "Ingest"
    ↓
submit()
  pdf   → ingestPdf()   POST /api/ingest  (multipart, field: pdf)
  text  → ingestText()  POST /api/ingest/text  (JSON body)
  image → ingestText()  with auto-generated Markdown wrapper
    ↓
Backend responds 202 with { jobId, docId }
    ↓
startPoll() polls GET /api/ingest/jobs/:jobId every 2 s
  progress bar updates
  step label updates (parse → chunk → enrich → embed → write)
    ↓
Job done  → onDone() → handleIngestDone()
  ingestKey++ (form resets to empty)
  onRefresh() (parent reloads KB list → docCount in tab label increments)
Job failed → error shown inline; form stays for retry
```

### Backend pipeline (per ingestion)

1. **Archive** — PDF copied to `data/{kbId}/pdfs/{sha256}.pdf`; `index.json` updated
2. **Convert** — `pdf_to_md.py` runs via PyMuPDF → `data/{kbId}/uploads/{sha256}/content.md` + `images/`
3. **Parse** — `pdfParser.js` extracts text blocks & tables via Python subprocess
4. **Chunk** — `chunker.js` splits into semantic chunks (heuristic first, then LLM)
5. **Enrich** — `llmEnricher.js` calls Gemini sequentially per chunk (summary, entities, claims)
6. **Embed** — `embedder.js` calls Gemini embedding per chunk (3072-dim vectors)
7. **Write** — `graphWriter.js` MERGEs Document + Chunk nodes into Neo4j; updates SQLite

---

## Tab 2 — Documents

**Component:** `<Archive kbId onDelete>`
**Mount strategy:** always mounted; search input and scroll position survive tab switches.

### List view

- Fetches `GET /api/kb/:kbId/archive` on mount → shows all archived documents
- Search filters by title, authors, or DOI (client-side)
- Count shown as `N / M documents`
- Trash icon → `DELETE /api/kb/:kbId/archive/:sha256` → removes PDF, uploads folder, Neo4j nodes,
  SQLite records → `onDelete()` → `onRefresh()` → `docCount` in tab label decrements

### Document popup (click any row)

Opens a full-screen overlay (`z-index: 200`) with:

**Left panel (300 px, scrollable)**

| Section | Source |
|---|---|
| Title + status badge | `ArchivedDoc` from archive list |
| Authors | `ArchivedDoc` |
| DOI (clickable link to doi.org) | `ArchivedDoc` |
| Abstract | `doc.abstract` if set; otherwise "No abstract" message |
| Chunk count + ingestion date | `GET /api/kb/:kbId/archive/:sha256/preview` (hits Neo4j + SQLite) |

**Right panel (flex: 1)**

1. Tries `GET /api/kb/:kbId/archive/:sha256/md` → if MD exists, renders with `ReactMarkdown`
   - Image URLs rewritten from `images/fig_X.png` → `/api/kb/:kbId/archive/:sha256/images/fig_X.png`
   - Inline images clickable → opens lightbox (scroll-to-zoom, Esc to close)
2. Falls back to `<iframe src="/api/kb/:kbId/archive/:sha256/pdf">` if MD not yet generated

---

## Tab 3 — Settings

**Mount strategy:** conditionally rendered (no long-running state).

### Fields

| Field | API |
|---|---|
| Name (required) | `PATCH /api/kb/:id` |
| Description | `PATCH /api/kb/:id` |
| Color (colour picker) | `PATCH /api/kb/:id` |
| Gemini model | `PUT /api/settings` → `settings.json` → `reloadModels()` in `geminiClient.js` |
| Embedding model | `PUT /api/settings` → same |

**Save** → patches the KB metadata and saves model settings simultaneously → `onDone()` closes the modal.

### Reset knowledge base

Two-step confirmation. Calls `POST /api/kb/:id/reset { confirm: true }`:
- Deletes all Neo4j nodes for this KB (`DETACH DELETE`)
- Clears `chunks` and `jobs` SQLite tables; resets document statuses to `pending`
- Resets `doc_count` and `chunk_count` in `kb.json` to 0
- Chat history for this KB cleared from localStorage (`onReset()`)
- Archived PDF files and `uploads/` folder are **kept intact** — documents can be re-ingested

### Delete knowledge base

Two-step confirmation. Calls `DELETE /api/kb/:id { confirm: true }`:
- Stops the Neo4j instance for this KB
- Deletes the entire `data/{kbId}/` directory (PDFs, uploads, SQLite, Neo4j data)
- Removes KB from the selector → modal closes → `onDone()`
