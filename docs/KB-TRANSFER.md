# Knowledge Base Transfer and Migration (KB-TRANSFER.md)

## Core principle
The PDF archive is the source of truth. Neo4j is a reconstructable index.
Two transfer strategies exist depending on the context:

| Strategy | Export size | Restore time | Use case |
|---|---|---|---|
| **Full export** (archive + Neo4j dump) | Large | Immediate | External disk, fast local network |
| **Light export** (PDF archive only) | Small | Rebuild required | Internet transfer, cloud sharing |

---

## Strategy A — Full export (recommended when disk is available)

Exports the PDF archive + Neo4j dump + config. Immediate restore without rebuild.

### Export sequence
```
1. Pause any running ingestion (wait for active jobs to finish)
2. Stop the KB's Neo4j instance
3. neo4j-admin database dump → kb-export/{kb-name}/neo4j.dump
4. Copy pdfs/ + index.json → kb-export/{kb-name}/pdfs/
5. Copy kb.json and metadata.db
6. Compress → {kb-name}_full_{date}.scientifickb
7. Restart Neo4j
```

### Import sequence
```
1. Decompress the .scientifickb archive
2. Verify checksum (sha256 of the file)
3. Create the KB directory (new UUID if collision)
4. Copy pdfs/ + index.json + metadata.db + kb.json
5. neo4j-admin database load → KB's neo4j/ directory
6. Start Neo4j + verify integrity (node count)
7. Display in the UI
```

---

## Strategy B — Light export (PDF archive only)

Exports only the source PDF files. Requires a rebuild on the target machine
(full re-ingestion through the RAG pipeline).

### Export sequence
```
1. Copy pdfs/ + index.json → {kb-name}_light_{date}.scientifickb
2. Copy kb.json (name, description, colour)
3. Compress
```

### Import sequence
```
1. Decompress
2. Create the KB (new UUID)
3. Copy pdfs/ + index.json + kb.json
4. Trigger automatic rebuild (POST /api/kb/:id/rebuild)
5. Progress displayed in the UI (SSE)
```

---

## .scientifickb file format

Proprietary extension = a renamed ZIP archive.

```
{kb-name}_full_2025-01-20.scientifickb
└── [ZIP]
    ├── manifest.json          ← transfer metadata
    ├── kb.json                ← KB config (name, colour, description)
    ├── metadata.db            ← SQLite (present in full mode only)
    ├── pdfs/
    │   ├── index.json
    │   ├── abc123def.pdf
    │   └── ...
    └── neo4j.dump             ← Neo4j dump (present in full mode only)
```

### manifest.json
```json
{
  "formatVersion": 1,
  "exportType": "full",          // "full" | "light"
  "exportedAt": "2025-01-20T14:30:00Z",
  "appVersion": "1.2.0",
  "kbName": "ASTM Materials",
  "kbId": "a3f2bc91",            // original ID (will be remapped on import)
  "docCount": 147,
  "chunkCount": 3821,
  "archiveSizeBytes": 524288000,
  "checksum": "sha256:abcdef...", // checksum of the zip before renaming
  "neo4jVersion": "5.15.0",      // for dump/load compatibility
  "embeddingModel": "gemini-embedding-001",
  "embeddingDimensions": 3072
}
```

---

## User warnings

### Before export
```
⚠️ Export in progress — do not close the application
Estimated size: 2.1 GB (full mode) / 510 MB (light mode)
Estimated time: ~3 min (SSD) / ~12 min (HDD)
```

### Before light-mode import
```
⚠️ Rebuild required
This knowledge base must be rebuilt on this computer.
Estimated time: ~45 min for 147 documents
The base will be available once the rebuild is complete.
[Import and rebuild]   [Cancel]
```

### Neo4j version incompatibility
```
⚠️ Incompatible Neo4j version
Export created with Neo4j 5.12, installed version: 5.15
Only light export (rebuild) is possible in this case.
```

### Embedding model mismatch
```
⚠️ Different embedding model
The export uses "gemini-embedding-001" (3072 dim).
Your installation uses a different model.
A full rebuild is required to recalculate embeddings.
```

---

## API routes (routes/transfer.js)

```
POST /api/kb/:kbId/export
  Body: { "mode": "full" | "light" }
  Response SSE:
    { "step": "stopping_neo4j", "progress": 0 }
    { "step": "dumping", "progress": 30 }
    { "step": "compressing", "progress": 70 }
    { "step": "done", "progress": 100, "filePath": "/tmp/export.scientifickb", "sizeBytes": 2100000000 }

POST /api/kb/import
  Content-Type: multipart/form-data
  Fields: file (.scientifickb), targetName? (rename on import)
  Response: { "jobId": "...", "kbId": "new-uuid", "requiresRebuild": false }

GET /api/kb/import/jobs/:jobId
  Response SSE (same format as rebuild/status)
```

---

## UI — User flow

### Export
```
[KB Menu] → "Export this base"
  → Choice: ● Full (Neo4j included)  ○ Light (PDF only)
  → Choose destination folder
  → Progress bar
  → "✓ Export complete — {kb-name}_full_2025-01-20.scientifickb (2.1 GB)"
  → Button "Open in Finder / Explorer"
```

### Import
```
[Main menu] → "Import a base"
  → File selector (.scientifickb)
  → Read manifest.json → display info:
      Name: ASTM Materials
      Documents: 147  |  Archive size: 510 MB
      Type: Light → rebuild required (~45 min)
  → Optional "Rename the base" field
  → [Import]
  → Progress bar (import + rebuild if needed)
  → "✓ Base imported and available"
```

---

## Recommended transfer methods

| Situation | Recommended method |
|---|---|
| Same local network | Full export → shared network folder |
| USB drive / external disk | Full export to the disk |
| Internet transfer (base < 2 GB) | Light export → WeTransfer / Google Drive |
| Internet transfer (base > 2 GB) | Light export → rsync or multi-part sharing |
| Regular automated backup | Cron script → light export to cloud (Dropbox, iCloud) |

### Automatic backup script (example)
```bash
#!/bin/bash
# backup_kb.sh — add to crontab (e.g. every Sunday at 2am)
# 0 2 * * 0 /path/to/backup_kb.sh

KB_ID="a3f2bc91"
DEST="$HOME/Dropbox/scientific-kb-backups"
DATE=$(date +%Y-%m-%d)

curl -s -X POST "http://localhost:3000/api/kb/$KB_ID/export" \
  -H "Content-Type: application/json" \
  -d '{"mode": "light", "outputDir": "'"$DEST"'"}' \
  --no-buffer | grep -E '"step"|"progress"'

echo "Backup complete: $DEST/${KB_ID}_light_${DATE}.scientifickb"
```

---

## Partial sharing — Exporting a document subset

Allows exporting only selected documents from a KB (e.g. sharing only ASTM E8
documents with a colleague).

```
POST /api/kb/:kbId/export/subset
  Body: {
    "mode": "light",
    "filter": {
      "sourceType": "astm_standard",  // or "publication"
      "astmCodePrefix": "ASTM E",     // filter by code prefix
      "yearFrom": 2020,
      "docIds": ["sha256_1", "sha256_2"]  // explicit list
    }
  }
```

Subset export is always in light mode (rebuild required), because extracting a
coherent Neo4j sub-graph is complex.
