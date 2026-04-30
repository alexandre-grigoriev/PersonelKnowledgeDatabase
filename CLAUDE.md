# Scientific Knowledge Base — Spec Racine (CLAUDE.md)

## Vision
Application desktop tout-en-un (Mac + Windows) permettant de gérer plusieurs knowledge bases
thématiques à partir de publications scientifiques PDF et de standards ASTM. Inclut une
extension Chrome pour capturer du contenu web directement.

## Stack technique
| Composant      | Technologie                                              |
|----------------|----------------------------------------------------------|
| Desktop shell  | Electron 30+ (bundle Node.js + Neo4j embedded)           |
| Backend API    | Node.js 20 / Express / CommonJS                          |
| LLM            | Google Gemini 2.0 Flash (gemini-2.0-flash-exp)           |
| Embeddings     | gemini-embedding-001 (3072 dimensions)                   |
| Graph + Vector | Neo4j 5.x Community (instance par KB)                   |
| PDF parsing    | pdf-parse + pdfplumber (Python subprocess)               |
| Archive        | Filesystem local (~/scientific-kb/)                      |
| Metadata/Queue | SQLite 3 (une DB par KB)                                 |
| Frontend UI    | React 19 / TypeScript / Tailwind / Vite (frontend/)      |
| Extension      | Chrome Manifest V3 (Vanilla JS)                          |

## Layout du dépôt
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
│       ├── neo4jClient.js      singleton par KB
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
│   ├── initNeo4j.js            DDL indexes + contraintes
│   └── rebuildKb.js            ré-ingestion depuis archive
└── data/                       créé à l'installation
    └── [kb-name]/
        ├── pdfs/               archive source of truth
        ├── metadata.db         SQLite par KB
        └── neo4j/              data Neo4j par KB
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
    ├── App.tsx            React Router v6 — 4 routes
    ├── index.css
    ├── api/client.ts      typed fetch wrappers for all endpoints
    ├── types/index.ts     Kb, ArchivedDoc, IngestJob, QueryResult …
    ├── components/
    │   ├── Layout.tsx     top nav + KB selector
    │   └── KbSelector.tsx shared KB picker (localStorage)
    └── pages/
        ├── KbDashboard.tsx  list + create + stats + delete
        ├── Ingest.tsx       drag-and-drop PDF + metadata + progress bar
        ├── Query.tsx        question input + cited answer + source cards
        └── Archive.tsx      searchable document table + delete
```

Dev server: `cd frontend && npm install && npm run dev` → http://localhost:5173
Vite proxies all `/api/*` calls to the backend on port 3000.

## Règles absolues
1. Appels Gemini séquentiels uniquement — jamais en parallèle
2. Neo4j MERGE uniquement — jamais CREATE direct
3. Pas de console.log en production — utiliser logger (pino)
4. JSDoc sur toutes les fonctions publiques (backend JS uniquement)
5. Chunking heuristique d'abord — structure détectée avant appel LLM
6. Archive = source of truth — toute ingestion copie d'abord le PDF
7. Multi-KB = isolation complète — chaque KB a son propre répertoire Neo4j + SQLite
