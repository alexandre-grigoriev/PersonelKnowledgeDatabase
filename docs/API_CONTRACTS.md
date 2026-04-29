# API Contracts — REST Endpoints (API_CONTRACTS.md)

## Base URL
http://localhost:3000/api

## Headers communs
```
Content-Type: application/json
X-KB-ID: {kbId}    (ou inclus dans le body selon l'endpoint)
```

---

## Knowledge Bases

### GET /api/kb
Liste toutes les KBs.
```json
// Response 200
[
  {
    "id": "a3f2bc91",
    "name": "Matériaux ASTM",
    "description": "...",
    "color": "#3B8BD4",
    "docCount": 147,
    "chunkCount": 3821,
    "createdAt": "2025-01-15T10:30:00Z",
    "status": "ready"   // "ready"|"indexing"|"rebuilding"
  }
]
```

### POST /api/kb
```json
// Body
{ "name": "Chimie organique", "description": "...", "color": "#1D9E75" }

// Response 201
{ "id": "...", "name": "Chimie organique", "createdAt": "..." }
```

### GET /api/kb/:id/stats
```json
// Response 200
{
  "id": "...",
  "name": "Matériaux ASTM",
  "docCount": 147,
  "chunkCount": 3821,
  "entityCount": 892,
  "archiveSizeBytes": 524288000,
  "neo4jSizeBytes": 104857600,
  "lastIngestedAt": "2025-01-20T14:22:00Z"
}
```

### DELETE /api/kb/:id
```json
// Body requis
{ "confirm": true }
// Response 200
{ "deleted": true }
```

---

## Ingestion

### POST /api/ingest
Upload d'un PDF. Multipart form data.
```
pdf         File        Fichier PDF
kbId        String      ID de la knowledge base cible
meta        JSON String {title?, doi?, authors?, year?, sourceType?, astmCode?}
source      String      'upload'|'chrome-extension'|'rebuild'
sourceUrl   String?     URL d'origine (extension Chrome)
```
```json
// Response 202 (traitement asynchrone)
{
  "jobId": "job_abc123",
  "docId": "sha256_xyz",
  "status": "queued",
  "isDuplicate": false
}
```

### POST /api/ingest/text
Ingestion d'un contenu textuel (page web capturée).
```json
// Body
{
  "text": "...",
  "kbId": "...",
  "meta": {
    "title": "Tensile behavior of...",
    "authors": ["Smith J."],
    "doi": "10.1016/...",
    "year": 2023,
    "pageUrl": "https://sciencedirect.com/..."
  },
  "source": "chrome-extension"
}
// Response 202
{ "jobId": "...", "docId": "...", "status": "queued" }
```

### GET /api/ingest/jobs/:jobId
```json
// Response 200
{
  "jobId": "job_abc123",
  "docId": "sha256_xyz",
  "status": "processing",   // queued|processing|done|failed
  "step": "chunk",          // parse|chunk|enrich|embed|write
  "progress": 45,           // 0-100
  "chunksDone": 12,
  "chunksTotal": 27,
  "error": null
}
```

---

## Query

### POST /api/query
```json
// Body
{
  "question": "Quelles sont les propriétés mécaniques de l'alliage 7075-T6 ?",
  "kbId": "a3f2bc91",
  "options": {
    "topK": 8,
    "useGraphExpansion": true,
    "minScore": 0.72,
    "includeChunks": false    // inclure les chunks bruts dans la réponse
  }
}

// Response 200
{
  "answer": "L'alliage 7075-T6 présente une résistance à la traction de...",
  "sources": [
    {
      "docId": "sha256_abc",
      "title": "Mechanical properties of 7075...",
      "authors": ["Smith J."],
      "doi": "10.1016/...",
      "year": 2023,
      "chunkId": "chunk_xyz",
      "section": "Results",
      "relevanceScore": 0.94,
      "pdfPreviewUrl": "/api/archive/sha256_abc/preview"
    }
  ],
  "entities": ["7075-T6", "tensile strength", "yield strength"],
  "queryPlan": {
    "subQueries": ["propriétés mécaniques 7075", "alliage aluminium T6"],
    "strategy": "hybrid"
  }
}
```

---

## Archive

### GET /api/kb/:kbId/archive
```json
// Response 200
[
  {
    "sha256": "abc123",
    "title": "Tensile Testing of...",
    "authors": ["Smith J."],
    "doi": "10.1016/...",
    "year": 2023,
    "sourceType": "publication",
    "addedAt": "2025-01-15T10:30:00Z",
    "fileSizeBytes": 2458621,
    "pageCount": 12,
    "status": "done"
  }
]
```

### GET /api/kb/:kbId/archive/:sha256/preview
```json
// Response 200
{
  "sha256": "abc123",
  "title": "...",
  "authors": ["..."],
  "abstract": "...",
  "pageCount": 12,
  "previewText": "First 500 chars of content...",
  "chunkCount": 27,
  "lastIngested": "2025-01-15T10:30:00Z"
}
```

### DELETE /api/kb/:kbId/archive/:sha256
```json
// Body
{ "confirm": true }
// Response 200
{ "deleted": true, "chunksRemoved": 27 }
```

### POST /api/kb/:kbId/rebuild
```json
// Body
{ "confirm": true }
// Response 202
{ "jobId": "rebuild_xyz", "totalDocs": 147 }
```

### GET /api/kb/:kbId/rebuild/status  (SSE)
```
Content-Type: text/event-stream

data: {"progress": 0, "current": null, "done": 0, "total": 147, "errors": []}
data: {"progress": 5, "current": "Smith2023_tensile.pdf", "done": 7, "total": 147, "errors": []}
data: {"progress": 100, "current": null, "done": 147, "total": 147, "errors": [], "complete": true}
```
