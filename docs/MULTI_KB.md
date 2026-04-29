# Multi-Knowledge Base — Spec (MULTI_KB.md)

## Concept
Chaque Knowledge Base est une unité autonome et isolée. L'utilisateur peut en créer autant
qu'il veut (ex: "Matériaux ASTM", "Chimie organique", "Normes ISO bâtiment"). Il choisit
la KB active dans l'UI avant d'ingérer ou de requêter.

## Structure sur disque (par KB)
```
~/scientific-kb/
└── {kb-id}/                    ← UUID v4, ex: "a3f2bc91-..."
    ├── kb.json                 ← métadonnées KB (nom, description, dates)
    ├── pdfs/                   ← archive PDF source of truth
    │   ├── {sha256}.pdf
    │   └── index.json          ← mapping sha256 -> {title, doi, added_at}
    ├── metadata.db             ← SQLite: documents, chunks, jobs queue
    └── neo4j/                  ← data directory Neo4j pour cette KB
        ├── data/
        └── logs/
```

## kb.json (schéma)
```json
{
  "id": "a3f2bc91-4d1e-4a2b-b3c0-1234567890ab",
  "name": "Matériaux ASTM",
  "description": "Standards ASTM E et F, publications métallurgie",
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
  id          TEXT PRIMARY KEY,       -- SHA256 du PDF
  title       TEXT,
  authors     TEXT,                   -- JSON array
  doi         TEXT,
  year        INTEGER,
  source_type TEXT,                   -- 'publication' | 'astm_standard'
  astm_code   TEXT,                   -- ex: "ASTM E8/E8M-22"
  pdf_path    TEXT,                   -- chemin relatif dans pdfs/
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
Retourne la liste de toutes les KBs.
```json
[
  { "id": "...", "name": "Matériaux ASTM", "doc_count": 147, "color": "#3B8BD4" }
]
```

### POST /api/kb
Crée une nouvelle KB.
```json
// Body
{ "name": "Chimie organique", "description": "...", "color": "#1D9E75" }

// Response 201
{ "id": "uuid-généré", "name": "Chimie organique", ... }
```

### DELETE /api/kb/:id
Supprime une KB (Neo4j data + SQLite + PDFs archivés).
Requiert confirmation explicite dans le body : `{ "confirm": true }`.

### GET /api/kb/:id/stats
Statistiques détaillées : nb docs, nb chunks, taille archive, dernière mise à jour.

## Neo4j — instance par KB
Chaque KB démarre sa propre instance Neo4j sur un port dynamique (7687 + index).
Le `neo4jClient.js` maintient un Map `kbId -> Driver`.

```javascript
/**
 * @param {string} kbId
 * @returns {Promise<import('neo4j-driver').Driver>}
 */
async function getDriver(kbId) { ... }

/**
 * Lance Neo4j pour une KB si pas déjà démarré.
 * @param {string} kbId
 * @param {number} port
 */
async function startNeo4jForKb(kbId, port) { ... }
```

## Règles d'isolation
- Les requêtes Cypher incluent toujours `WHERE doc.kb_id = $kbId` ou utilisent une database Neo4j dédiée
- La KB active est passée dans chaque requête API via header `X-KB-ID` ou body field `kbId`
- Jamais de cross-KB query sans flag explicite `crossKb: true`
