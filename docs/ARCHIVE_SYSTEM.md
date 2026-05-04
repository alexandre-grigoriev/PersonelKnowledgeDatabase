# Archive System — Source of Truth (ARCHIVE_SYSTEM.md)

## Principle
Every ingested file is first copied into the archive before any processing.
The archive is the source of truth. The Neo4j knowledge base can be fully rebuilt
from the archive at any time.

## Archive structure
```
~/scientific-kb/{kb-id}/pdfs/
├── index.json               ← registry of all archived documents
├── {sha256-1}.pdf
├── {sha256-2}.pdf
└── ...
```

## index.json (schema)
```json
{
  "version": 1,
  "documents": {
    "{sha256}": {
      "sha256": "abc123...",
      "filename": "Smith2023_tensile_testing.pdf",
      "title": "Tensile Testing of Aluminum Alloys",
      "doi": "10.1016/j.msea.2023.145123",
      "authors": ["Smith J.", "Doe A."],
      "year": 2023,
      "source_type": "publication",
      "astm_code": null,
      "added_at": "2025-01-15T10:30:00Z",
      "file_size_bytes": 2458621,
      "page_count": 12
    }
  }
}
```

## archiveManager.js — API

```javascript
/**
 * Archives a file and returns its SHA256.
 * Copies the file, updates index.json, rejects duplicates.
 * @param {string} kbId
 * @param {string} sourcePath - temporary path of the uploaded file
 * @param {Object} meta - { title, doi, authors, year, sourceType, astmCode }
 * @returns {Promise<{sha256: string, pdfPath: string, isDuplicate: boolean}>}
 */
async function archivePdf(kbId, sourcePath, meta) { ... }

/**
 * Lists all archived documents for a KB.
 * @param {string} kbId
 * @returns {Promise<ArchivedDoc[]>}
 */
async function listArchive(kbId) { ... }

/**
 * Generates a preview of an archived document (text of first 2 pages + metadata).
 * Used in the UI for preview before ingestion or update.
 * @param {string} kbId
 * @param {string} sha256
 * @returns {Promise<{title, authors, abstract, pageCount, previewText}>}
 */
async function generatePreview(kbId, sha256) { ... }

/**
 * Removes a document from the archive AND from Neo4j.
 * @param {string} kbId
 * @param {string} sha256
 * @returns {Promise<void>}
 */
async function deleteDocument(kbId, sha256) { ... }
```

## Rebuild (scripts/rebuildKb.js)

The rebuild re-ingests all archived files into a fresh KB.
Useful after Neo4j corruption, migration, or a change of chunking strategy.

### Rebuild sequence
```
1. Verify the KB exists (kb.json present)
2. Stop the KB's Neo4j instance
3. Delete ~/scientific-kb/{kb-id}/neo4j/data/
4. Restart Neo4j (empty database)
5. Run initNeo4j.js (create indexes + constraints)
6. Read index.json → list of archived documents
7. For each document (sequentially):
   a. Read the file from the archive
   b. Run the full pipeline: parse → chunk → enrich → embed → write
   c. Update the status in SQLite
8. Report progress in real time via SSE (GET /api/kb/:id/rebuild/status)
```

### API routes (routes/archive.js)

```
POST /api/kb/:kbId/rebuild
  Body: { "confirm": true }
  Response: { "jobId": "...", "totalDocs": 147 }

GET /api/kb/:kbId/rebuild/status
  Response SSE stream: { "progress": 42, "current": "Smith2023...", "errors": [] }

GET /api/kb/:kbId/archive
  Response: [ { sha256, title, authors, year, ... } ]

GET /api/kb/:kbId/archive/:sha256/preview
  Response: { title, authors, abstract, pageCount, previewText }

DELETE /api/kb/:kbId/archive/:sha256
  Removes from filesystem + Neo4j
  Body: { "confirm": true }
```

## Re-ingestion preview
When a document is already ingested and needs to be re-ingested (new version), the flow is:
1. Upload the new file
2. `generatePreview()` → display the preview in the UI
3. If the user confirms: `deleteDocument()` old version + `archivePdf()` + full pipeline
4. Old version chunks are removed from Neo4j before the new version is written

### Removing chunks from Neo4j before re-ingestion
```cypher
MATCH (d:Document {id: $sha256, kbId: $kbId})
OPTIONAL MATCH (d)-[:HAS_CHUNK]->(c:Chunk)
OPTIONAL MATCH (d)-[:HAS_SECTION]->(s:Section)
DETACH DELETE c, s, d
```
