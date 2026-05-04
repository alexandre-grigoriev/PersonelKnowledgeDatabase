# Multi-Knowledge Base — Spec (MULTI_KB.md)

## Concept
Each Knowledge Base is an autonomous, isolated unit. Users can create as many as they want (e.g. "ASTM Materials", "Organic Chemistry", "ISO Building Standards"). The active KB is selected in the UI before ingesting or querying.

## On-disk structure (per KB)
```
~/scientific-kb/
└── {kb-id}/                    ← UUID v4, e.g. "a3f2bc91-..."
    ├── kb.json                 ← KB metadata (name, description, dates)
    ├── pdfs/                   ← PDF archive — source of truth
    │   ├── {sha256}.pdf
    │   └── index.json          ← mapping sha256 -> {title, doi, added_at}
    ├── metadata.db             ← SQLite: documents, chunks, jobs queue
    └── neo4j/                  ← Neo4j data directory for this KB
        ├── data/
        └── logs/
```

## kb.json (schema)
```json
{
  "id": "a3f2bc91-4d1e-4a2b-b3c0-1234567890ab",
  "name": "ASTM Materials",
  "description": "ASTM E and F standards, metallurgy publications",
  "created_at": "2025-01-15T10:30:00Z",
  "updated_at": "2025-01-20T14:22:00Z",
  "doc_count": 147,
  "chunk_count": 3821,
  "neo4j_port": 7687,
  "color": "#3B8BD4"
}
```

## SQLite schema (metadata.db)
```sql
CREATE TABLE documents (
  id          TEXT PRIMARY KEY,       -- SHA256 of the PDF
  title       TEXT,
  authors     TEXT,                   -- JSON array
  doi         TEXT,
  year        INTEGER,
  source_type TEXT,                   -- 'publication' | 'astm_standard'
  astm_code   TEXT,                   -- e.g. "ASTM E8/E8M-22"
  pdf_path    TEXT,                   -- relative path inside pdfs/
  ingested_at TEXT,
  status      TEXT DEFAULT 'pending'  -- 'pending'|'processing'|'done'|'error'
);

CREATE TABLE chunks (
  id          TEXT PRIMARY KEY,
  doc_id      TEXT REFERENCES documents(id),
  chunk_index INTEGER,
  section     TEXT,
  chunk_type  TEXT,                   -- 'text'|'table'|'figure_caption'|'reference'
  token_count INTEGER,
  neo4j_node_id TEXT
);

CREATE TABLE jobs (
  id          TEXT PRIMARY KEY,
  doc_id      TEXT,
  status      TEXT,                   -- 'queued'|'running'|'done'|'failed'
  step        TEXT,                   -- 'parse'|'chunk'|'enrich'|'embed'|'write'
  progress    INTEGER DEFAULT 0,      -- 0-100
  error       TEXT,
  created_at  TEXT,
  updated_at  TEXT
);
```

## API KB Management (routes/kb.js)

### GET /api/kb
Returns the list of all KBs.
```json
[
  { "id": "...", "name": "ASTM Materials", "doc_count": 147, "color": "#3B8BD4" }
]
```

### POST /api/kb
Creates a new KB.
```json
// Body
{ "name": "Organic Chemistry", "description": "...", "color": "#1D9E75" }

// Response 201
{ "id": "generated-uuid", "name": "Organic Chemistry", ... }
```

### DELETE /api/kb/:id
Deletes a KB (Neo4j data + SQLite + archived files).
Requires explicit confirmation in the body: `{ "confirm": true }`.

### GET /api/kb/:id/stats
Detailed statistics: doc count, chunk count, archive size, last update.

## Neo4j — one instance per KB
Each KB starts its own Neo4j instance on a dynamic port (7687 + index).
`neo4jClient.js` maintains a Map `kbId -> Driver`.

```javascript
/**
 * @param {string} kbId
 * @returns {Promise<import('neo4j-driver').Driver>}
 */
async function getDriver(kbId) { ... }

/**
 * Starts Neo4j for a KB if not already running.
 * @param {string} kbId
 * @param {number} port
 */
async function startNeo4jForKb(kbId, port) { ... }
```

## Isolation rules
- Cypher queries always include `WHERE doc.kb_id = $kbId` or use a dedicated Neo4j database
- The active KB is passed in every API request via the `X-KB-ID` header or `kbId` body field
- No cross-KB queries without an explicit `crossKb: true` flag
