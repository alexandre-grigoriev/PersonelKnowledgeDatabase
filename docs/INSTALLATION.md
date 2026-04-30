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

## 4 — Start Neo4j

Start Neo4j manually and leave it running in the background. The app connects to it over bolt — it does **not** spawn or manage the Neo4j process.

**Windows:**
```powershell
E:\Neo4J\bin\neo4j.bat console
```

**Mac / Linux:**
```bash
/usr/local/opt/neo4j/bin/neo4j console
```

Wait until you see a line like:
```
Started.
```

> If you see `Neo4j is already running` — that's fine, it's already up.

---

## 5 — Change the default Neo4j password

Neo4j requires a password change before allowing any connections. Do this **once** after the first install.

**Option A — Neo4j Browser (easiest)**

1. Open **http://localhost:7474** in your browser
2. Log in with username `neo4j`, password `neo4j`
3. Neo4j will prompt you to set a new password
4. Choose a strong password and confirm

**Option B — Cypher command**

Connect to Neo4j with any bolt client and run:
```cypher
ALTER CURRENT USER SET PASSWORD FROM 'neo4j' TO 'your_new_password'
```

---

## 6 — Configure environment variables

Copy the example file:

```bash
cp .env.example .env       # Mac / Linux
copy .env.example .env     # Windows
```

Edit `.env` with your values:

```env
# Gemini API key — get one free at https://aistudio.google.com/app/apikey
GEMINI_API_KEY=your_gemini_api_key_here

# Neo4j connection (managed mode — connect to your running instance)
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your_new_password   # ← the password you set in step 5

# Python binary name
SKB_PYTHON=python       # Windows
# SKB_PYTHON=python3    # Mac / Linux

# Pretty coloured logs
NODE_ENV=development
LOG_LEVEL=info
```

---

## 7 — Start the backend server

```powershell
npm start
```

Expected output:
```
{"level":"info","msg":"neo4jClient: MANAGED MODE — connecting to existing Neo4j","uri":"bolt://localhost:7687"}
{"level":"info","msg":"server listening","port":3000}
```

---

## 8 — Create your first Knowledge Base

```powershell
# PowerShell
Invoke-RestMethod -Method POST http://localhost:3000/api/kb `
  -ContentType "application/json" `
  -Body '{"name":"My First KB","description":"Scientific papers","color":"#3B8BD4"}'
```

```bash
# Mac / Linux (curl)
curl -X POST http://localhost:3000/api/kb \
  -H "Content-Type: application/json" \
  -d '{"name":"My First KB","description":"Scientific papers","color":"#3B8BD4"}'
```

> On Windows PowerShell, `curl` is an alias for `Invoke-WebRequest` — always use `Invoke-RestMethod` or `curl.exe` (with the `.exe` extension).

Expected response (returned in under 1 second):
```json
{
  "id": "4901a656-a9a4-463b-8a42-5c5f97425df2",
  "name": "My First KB",
  "description": "Scientific papers",
  "color": "#3B8BD4",
  "createdAt": "2026-04-30T11:54:27.278Z"
}
```

Save the `id` — you need it for every ingest and query call.

---

## 9 — Ingest a PDF

```powershell
# PowerShell
curl.exe -X POST http://localhost:3000/api/ingest `
  -F "pdf=@C:\path\to\paper.pdf" `
  -F "kbId=4901a656-a9a4-463b-8a42-5c5f97425df2" `
  -F 'meta={"title":"Paper Title","authors":["Smith J."],"year":2023}'
```

```bash
# Mac / Linux
curl -X POST http://localhost:3000/api/ingest \
  -F "pdf=@/path/to/paper.pdf" \
  -F "kbId=4901a656-a9a4-463b-8a42-5c5f97425df2" \
  -F 'meta={"title":"Paper Title","authors":["Smith J."],"year":2023}'
```

Response:
```json
{ "jobId": "job_xxx", "docId": "sha256...", "status": "queued" }
```

Poll until `status` is `done` (ingestion runs in the background):
```powershell
Invoke-RestMethod "http://localhost:3000/api/ingest/jobs/job_xxx?kbId=4901a656-..."
```

---

## 10 — Query the knowledge base

```powershell
# PowerShell
Invoke-RestMethod -Method POST http://localhost:3000/api/query `
  -ContentType "application/json" `
  -Body '{"question":"What are the main findings?","kbId":"4901a656-a9a4-463b-8a42-5c5f97425df2"}'
```

```bash
# Mac / Linux
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"question":"What are the main findings?","kbId":"4901a656-..."}'
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `GEMINI_API_KEY is required` | Add `GEMINI_API_KEY` to `.env` |
| `CredentialsExpired` / password must be changed | Complete step 5 — change Neo4j password at http://localhost:7474 |
| `Authentication failed` | Check `NEO4J_PASSWORD` in `.env` matches what you set in step 5 |
| `Connection refused` on bolt | Neo4j is not running — run `neo4j.bat console` first |
| `pdfParser: failed to spawn "python"` | Set `SKB_PYTHON=python3` (Mac/Linux) or install Python and add to PATH |
| `pdfplumber` not found | Run `pip install pdfplumber` |
| `curl` errors in PowerShell | Use `curl.exe` (with `.exe`) or `Invoke-RestMethod` instead |
| `better-sqlite3` build error on `npm install` | Install Visual Studio Build Tools, then retry |

---

## Data directory

All KB data lives in `data/` (git-ignored):

```
data/
└── {kb-id}/
    ├── kb.json          ← KB metadata (name, port, counts)
    ├── pdfs/            ← archived source PDFs (source of truth)
    │   └── index.json
    ├── metadata.db      ← SQLite: documents, chunks, jobs
    └── neo4j/           ← Neo4j schema init marker (managed mode: unused)
```

**Delete a KB:**
```powershell
Invoke-RestMethod -Method DELETE http://localhost:3000/api/kb/4901a656-... `
  -ContentType "application/json" `
  -Body '{"confirm":true}'
```

**Rebuild a KB** from archived PDFs (after changing chunking strategy):
```bash
node scripts/rebuildKb.js --kbId 4901a656-a9a4-463b-8a42-5c5f97425df2
```

---

## Keeping Neo4j running across restarts

Instead of running `neo4j.bat console` every time, install Neo4j as a Windows service (run once as Administrator):

```powershell
# Install and start as a service
E:\Neo4J\bin\neo4j.bat windows-service install
E:\Neo4J\bin\neo4j.bat start

# To stop
E:\Neo4J\bin\neo4j.bat stop
```

After that, Neo4j starts automatically with Windows and `npm start` connects to it immediately.
