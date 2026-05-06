# Scientific Knowledge Base — Root Spec (CLAUDE.md)

## Vision
An all-in-one desktop application (Mac + Windows) for managing multiple thematic knowledge bases built from scientific PDF publications and ASTM standards. Includes a Chrome extension for capturing web content directly.

## Tech Stack
| Component      | Technology                                               |
|----------------|----------------------------------------------------------|
| Desktop shell  | Electron 30+ (bundled Node.js + embedded Neo4j)          |
| Backend API    | Node.js 20 / Express / CommonJS                          |
| LLM            | Google Gemini 2.5 Flash (gemini-2.5-flash)           |
| Embeddings     | gemini-embedding-001 (3072 dimensions)                   |
| Graph + Vector | Neo4j 5.x Community (one instance per KB)                |
| PDF parsing    | pdf-parse + pdfplumber (Python subprocess)               |
| Archive        | Local filesystem (~/scientific-kb/)                      |
| Metadata/Queue | SQLite 3 (one DB per KB)                                 |
| Frontend UI    | React 19 / TypeScript / Tailwind / Vite (frontend/)      |
| Extension      | Chrome Manifest V3 (Vanilla JS)                          |

## Repository Layout
```
/
├── CLAUDE.md
├── docs/
│   ├── ARCHITECTURE.md
│   ├── MULTI_KB.md
│   ├── CHUNKING_STRATEGY.md
│   ├── NEO4J_SCHEMA.md
│   ├── ARCHIVE_SYSTEM.md
│   ├── INSTALLER.md
│   ├── CHROME_EXTENSION.md
│   └── API_CONTRACTS.md
├── app/                        ← Electron shell
│   ├── main.js
│   ├── preload.js
│   └── tray.js
├── frontend/                   ← React 19 / TypeScript / Tailwind UI
│   ├── src/
│   ├── index.html
│   └── package.json
├── backend/
│   ├── server.js
│   ├── routes/
│   │   ├── ingest.js           POST /api/ingest
│   │   ├── query.js            POST /api/query
│   │   ├── kb.js               CRUD knowledge bases
│   │   └── archive.js          rebuild + preview
│   ├── ingestion/
│   │   ├── pdfParser.js
│   │   ├── chunker.js
│   │   ├── llmEnricher.js
│   │   ├── embedder.js
│   │   └── graphWriter.js
│   ├── retrieval/
│   │   ├── queryPlanner.js
│   │   ├── hybridRetriever.js
│   │   └── synthesizer.js
│   └── utils/
│       ├── config.js
│       ├── geminiClient.js
│       ├── neo4jClient.js      singleton per KB
│       ├── archiveManager.js
│       └── logger.js           pino
├── chrome-extension/
│   ├── manifest.json
│   ├── background.js           service worker
│   ├── content.js              content script
│   ├── popup.html
│   ├── popup.js
│   └── icons/
├── scripts/
│   ├── initNeo4j.js            DDL indexes + constraints
│   └── rebuildKb.js            re-ingestion from archive
└── data/                       created at install time
    └── [kb-name]/
        ├── pdfs/               archive — source of truth
        ├── metadata.db         SQLite per KB
        └── neo4j/              Neo4j data per KB
```

## Frontend (frontend/)

Pages: **KB Dashboard** · **Ingest** · **Query** · **Archive**

```
frontend/
├── index.html
├── package.json          Vite + React 19 + TypeScript + Tailwind
├── vite.config.ts        proxy /api → localhost:3000
├── tailwind.config.ts
└── src/
    ├── main.tsx
    ├── App.tsx            state-based navigation, 3 pages
    ├── index.css
    ├── api/client.ts      typed fetch wrappers for all endpoints
    ├── types/index.ts     Kb, ArchivedDoc, IngestJob, QueryResult …
    ├── components/
    │   └── ui/TopSelect.tsx
    ├── hooks/
    │   └── useSpeechRecognition.ts
    └── pages/
        ├── Ingest.tsx       drag-and-drop PDF/MD + metadata + progress bar
        ├── Query.tsx        chat panel + cited answer + source cards
        └── Archive.tsx      searchable document table + delete
```

Dev server: `cd frontend && npm install && npm run dev` → http://localhost:5173
Vite proxies all `/api/*` calls to the backend on port 3000.

## Absolute Rules
1. Gemini calls must be sequential only — never in parallel
2. Neo4j MERGE only — never direct CREATE
3. No console.log in production — use the pino logger
4. JSDoc on all public functions (backend JS only)
5. Heuristic chunking first — detect structure before calling the LLM
6. Archive is the source of truth — every ingestion copies the file first
7. Multi-KB = full isolation — each KB has its own Neo4j directory + SQLite
