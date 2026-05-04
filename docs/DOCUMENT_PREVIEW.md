# Document Preview (DOCUMENT_PREVIEW.md)

## Goal
Give the user a fast, useful overview of an archived document before or after ingestion —
without re-running the full pipeline.

---

## What a preview shows

| Field | Source | Notes |
|---|---|---|
| Title | Archive index / PDF metadata | |
| Authors | Archive index | |
| Year | Archive index | |
| DOI / URL | Archive index | |
| ASTM code | Archive index | ASTM documents only |
| Abstract | First chunk of type `abstract` in Neo4j, or extracted from the raw file | |
| Page count | Stored at archive time | PDF only |
| Chunk count | SQLite `chunks` table | Populated after ingestion |
| Ingestion status | SQLite `documents.status` | pending / processing / done / error |
| Preview text | First 500 characters of the first text chunk | |
| Images | Thumbnails from `{sha256}_images/` if folder exists | |

---

## Preview sources

### Before ingestion (file archived, not yet indexed)
- Metadata comes from the archive `index.json`
- Preview text: extracted client-side from the PDF using PDF.js (first 2 pages),
  or first 500 characters of the Markdown file
- No chunk count, no abstract from Neo4j

### After ingestion (fully indexed)
- Abstract: queried from Neo4j (`MATCH (d:Document {id:$sha256})-[:HAS_CHUNK]->(c:Chunk {chunkType:'abstract'}) RETURN c.text`)
- Chunk count: queried from SQLite
- Preview text: first chunk text from Neo4j

---

## API endpoint

```
GET /api/kb/:kbId/archive/:sha256/preview

Response 200:
{
  "sha256": "abc123...",
  "title": "Tensile Testing of Aluminum Alloys",
  "authors": ["Smith J.", "Doe A."],
  "doi": "10.1016/j.msea.2023.145123",
  "year": 2023,
  "astmCode": null,
  "abstract": "This study investigates...",
  "pageCount": 12,
  "chunkCount": 27,
  "lastIngested": "2025-01-15T10:30:00Z",
  "previewText": "First 500 chars of content...",
  "imageFolder": "abc123_images",
  "images": ["abc123_images/fig1.png", "abc123_images/fig2.png"]
}
```

---

## Image preview

If the document has an associated image folder (`{sha256}_images/`), the preview lists
the image filenames. The frontend displays them as thumbnails using relative paths served
via a static file endpoint:

```
GET /api/kb/:kbId/archive/:sha256/images/:filename
```

Images are served directly from the filesystem — no database involved.

---

## Client-side preview (Ingest form)

When a file is dropped in the Ingest form, a lightweight preview is generated **before upload**:

### PDF
- PDF.js reads the first 3 pages in the browser
- Extracts: title, authors, DOI, ASTM code, year, abstract (first paragraph)
- Fields are pre-filled and remain editable
- No images shown client-side (images are extracted server-side during ingestion)

### Markdown / TXT
- File is read as text in the browser
- Title extracted from the first `# Heading`
- Abstract from the first non-heading paragraph (up to 800 characters)
- Source URL pre-filled if present in frontmatter or metadata

---

## Archive page preview (inline)

In the Archive tab of the Edit KB modal, each document row is expandable.
Clicking a row reveals:
- Abstract (from Neo4j or archive index)
- Summary (LLM-generated, from the first chunk's `summary` field)
- Image thumbnails (from `{sha256}_images/` if present)
- Chunk count and ingestion date
- "Delete" action

---

## Re-ingestion preview

When re-ingesting an already-ingested document (new version), the user sees a preview
of the **new file** alongside the **existing document's metadata**, allowing comparison
before committing the update.

Flow:
1. User drops new file in the Ingest form
2. Client-side preview extracts metadata from the new file
3. Backend checks if `sha256` already exists in the archive
4. If duplicate: response includes `isDuplicate: true` and the existing document's metadata
5. UI shows a side-by-side comparison and asks for confirmation before overwriting

---

## Preview generation (backend)

The `generatePreview()` function in `archiveManager.js` is called on demand:

```javascript
/**
 * Generates a preview for an archived document.
 * Queries Neo4j for abstract and chunk count if the document has been ingested.
 * Falls back to raw file extraction if not yet indexed.
 * @param {string} kbId
 * @param {string} sha256
 * @returns {Promise<PreviewResult>}
 */
async function generatePreview(kbId, sha256) { ... }
```

Fallback chain for abstract:
1. Neo4j: chunk of type `abstract` → use `c.text`
2. Neo4j: first chunk of any type → use `c.summary`
3. Raw file: first 800 characters of extracted text
4. Archive index: `abstract` field if present
