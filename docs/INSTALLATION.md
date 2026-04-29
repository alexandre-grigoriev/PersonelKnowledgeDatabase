# Installation Guide

Step-by-step setup for **Windows** and **Mac** — development mode (backend only, no Electron build required).

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 20+ | [nodejs.org](https://nodejs.org) |
| Python | 3.9+ | [python.org](https://python.org) — needed for PDF parsing |
| Neo4j Community | 5.x | [neo4j.com/download-center/#community](https://neo4j.com/download-center/#community) — extract the ZIP anywhere |
| Git | any | to clone the repo |

---

## 1 — Clone the repository

```bash
git clone https://github.com/alexandre-grigoriev/PersonelKnowledgeDatabase.git
cd PersonelKnowledgeDatabase
```

---

## 2 — Install Node.js dependencies

```bash
npm install
```

---

## 3 — Install Python dependencies

```bash
pip install pdfplumber
```

> On Windows, use `pip` (not `pip3`). If `pip` is not found, try `python -m pip install pdfplumber`.

---

## 4 — Configure environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

Then edit `.env`:

```env
# Required — get a free key at https://aistudio.google.com/app/apikey
GEMINI_API_KEY=your_gemini_api_key_here

# Path to the Neo4j installation root (the folder that contains bin/, conf/, lib/)
# Windows example:
SKB_NEO4J_BIN_DIR=E:\Neo4J
# Mac/Linux example:
# SKB_NEO4J_BIN_DIR=/usr/local/opt/neo4j

# Python binary name — use 'python' on Windows, 'python3' on Mac/Linux
SKB_PYTHON=python

# Pretty logs in development
NODE_ENV=development
```

**Important:** `SKB_NEO4J_BIN_DIR` must point to the **root** of the Neo4j installation — the folder that directly contains `bin/`. On Windows this is usually the folder you extracted the zip into (e.g. `E:\Neo4J`, not `E:\Neo4J\bin`).

---

## 5 — Start the backend server

```bash
npm start
```

You should see:

```
{"level":"info","msg":"server listening","port":3000}
```

The server is now running at **http://localhost:3000**.

> **First run note:** No databases exist yet. The server starts cleanly with no Neo4j processes.

---

## 6 — Create your first Knowledge Base

Neo4j **starts automatically** when you create a KB — you never touch it directly.

Use any HTTP client (curl, Postman, your browser's fetch console):

```bash
curl -X POST http://localhost:3000/api/kb \
  -H "Content-Type: application/json" \
  -d '{"name": "My First KB", "description": "Scientific papers", "color": "#3B8BD4"}'
```

Response (after ~30–60 s while Neo4j boots):

```json
{
  "id": "a3f2bc91-4d1e-4a2b-b3c0-1234567890ab",
  "name": "My First KB",
  "description": "Scientific papers",
  "color": "#3B8BD4",
  "createdAt": "2026-04-29T10:00:00.000Z"
}
```

Save the `id` — that is your **KB reference** for all subsequent API calls.

### What happens under the hood

1. A directory `data/{kb-id}/` is created with `pdfs/`, `neo4j/`, `metadata.db`
2. A `neo4j.conf` is written for this KB (isolated port, bolt-only, auth disabled)
3. Neo4j is spawned on the next free port in range 7687–7787
4. All graph constraints and indexes are initialised (`scripts/initNeo4j.js`)

---

## 7 — Verify everything is working

```bash
# List all KBs
curl http://localhost:3000/api/kb

# Stats for a specific KB (replace the id)
curl http://localhost:3000/api/kb/a3f2bc91-4d1e-4a2b-b3c0-1234567890ab/stats
```

---

## 8 — Ingest a PDF

```bash
curl -X POST http://localhost:3000/api/ingest \
  -F "pdf=@/path/to/paper.pdf" \
  -F "kbId=a3f2bc91-4d1e-4a2b-b3c0-1234567890ab" \
  -F 'meta={"title":"My Paper","authors":["Smith J."],"year":2023}'
```

Response:

```json
{ "jobId": "job_xxx", "docId": "sha256...", "status": "queued" }
```

Poll the job until `status` is `done`:

```bash
curl "http://localhost:3000/api/ingest/jobs/job_xxx?kbId=a3f2bc91-..."
```

---

## 9 — Query the knowledge base

```bash
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What are the tensile properties of 7075-T6?",
    "kbId": "a3f2bc91-4d1e-4a2b-b3c0-1234567890ab"
  }'
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Error: GEMINI_API_KEY is required` | Add `GEMINI_API_KEY` to `.env` |
| `pdfParser: failed to spawn "python"` | Set `SKB_PYTHON=python3` (Mac/Linux) or install Python |
| `pdfplumber` not found | Run `pip install pdfplumber` |
| `startNeo4jForKb` times out | Check `SKB_NEO4J_BIN_DIR` points to Neo4j root, not `bin/` subfolder |
| Neo4j port already in use | Another KB already owns port 7687 — the next KB gets 7688, etc. |
| `better-sqlite3` build error on `npm install` | Run `npm install --build-from-source` or install Visual Studio Build Tools |

---

## Data directory

All KB data is stored in `data/` (git-ignored):

```
data/
└── {kb-id}/
    ├── kb.json          ← KB metadata (name, port, counts)
    ├── pdfs/            ← archived source PDFs (source of truth)
    │   └── index.json
    ├── metadata.db      ← SQLite: documents, chunks, jobs
    └── neo4j/           ← Neo4j data for this KB
        ├── conf/
        ├── data/
        └── logs/
```

To **delete** a KB, call `DELETE /api/kb/{id}` with `{"confirm":true}` — it stops Neo4j, removes all files, and cleans up SQLite.

To **rebuild** a KB from its archived PDFs (e.g. after changing chunking strategy):

```bash
node scripts/rebuildKb.js --kbId a3f2bc91-4d1e-4a2b-b3c0-1234567890ab
```
