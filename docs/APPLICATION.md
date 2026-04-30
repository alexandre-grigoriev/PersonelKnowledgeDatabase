# Application Description — Scientific Knowledge Base

## What it is

A desktop application for scientists and engineers to build private, searchable knowledge bases from PDF publications and ASTM standards. Documents are ingested, chunked, enriched by an LLM, embedded, and stored in a local Neo4j knowledge graph. Users query the graph in natural language and receive cited answers.

---

## Who it is for

- Materials scientists and engineers managing ASTM standards libraries
- Researchers building domain-specific corpora from journal papers
- Teams that need a private, on-premise alternative to cloud RAG services

---

## Key capabilities

| Capability | Description |
|---|---|
| Multi-KB | Unlimited isolated knowledge bases, each with its own graph and archive |
| PDF ingestion | Drag-and-drop PDF upload → heuristic chunking → Gemini enrichment → vector + graph storage |
| ASTM support | Dedicated chunking strategy for ASTM numbered sections and normative tables |
| Hybrid RAG | Vector similarity + fulltext + graph expansion + entity lookup, merged and ranked |
| Cited answers | Gemini synthesises an answer citing [1], [2]… with source metadata |
| Archive | Every ingested PDF is archived as source-of-truth; the graph can be rebuilt at any time |
| Chrome extension | Capture PDFs and web pages directly from the browser |

---

## Architecture summary

```
┌──────────────────────────────────────────────────────────────┐
│  Electron shell (app/)                                        │
│    main.js — starts backend + creates BrowserWindow          │
│    preload.js — contextBridge IPC                            │
│    tray.js — system tray                                     │
├──────────────────────────────────────────────────────────────┤
│  React UI (frontend/)                                         │
│    KB Dashboard · Ingest · Query · Archive                   │
│    Vite dev server proxies /api → localhost:3000             │
├──────────────────────────────────────────────────────────────┤
│  Express backend (backend/)  — port 3000                     │
│    /api/kb        CRUD knowledge bases                       │
│    /api/ingest    PDF + text ingestion (async jobs)          │
│    /api/query     Hybrid RAG pipeline                        │
│    /api/kb/:id/archive  Archive management + SSE rebuild     │
├──────────────────────────────────────────────────────────────┤
│  Ingestion pipeline                                           │
│    pdfParser  → pdfplumber Python subprocess                 │
│    chunker    → heuristic (publication / ASTM)               │
│    llmEnricher → Gemini: summary, entities, claims, keywords │
│    embedder   → gemini-embedding-001 (3072 dims)             │
│    graphWriter → Neo4j MERGE (Document, Section, Chunk, …)  │
├──────────────────────────────────────────────────────────────┤
│  Retrieval pipeline                                           │
│    queryPlanner   → Gemini decomposes question               │
│    hybridRetriever → vector + fulltext + graph expansion     │
│    synthesizer    → Gemini generates cited answer            │
├──────────────────────────────────────────────────────────────┤
│  Storage (per KB, fully isolated)                             │
│    Neo4j 5.x  — graph + vector index (cosine, 3072 dims)    │
│    SQLite     — document/chunk/job metadata                  │
│    Filesystem — PDF archive (source of truth)               │
└──────────────────────────────────────────────────────────────┘
```

---

## User flows

### Create a knowledge base
1. Go to **Knowledge Bases** page → fill name + colour → click **Create**
2. Neo4j schema is initialised automatically (constraints + vector index)

### Ingest a PDF
1. Go to **Ingest** → select KB → drag PDF or click to browse → fill metadata → **Start ingestion**
2. Pipeline: archive → parse (pdfplumber) → chunk → enrich (Gemini) → embed (Gemini) → write (Neo4j)
3. Progress bar polls the job status; job completes in minutes depending on document length

### Query
1. Go to **Query** → select KB → type a natural-language question → **Ask**
2. Pipeline: decompose question → embed sub-queries → vector search → graph expansion → synthesise
3. Answer is returned with numbered citations and relevance scores

### Browse archive
1. Go to **Archive** → select KB → search by title/author/DOI
2. Delete individual documents (removes from Neo4j + SQLite + filesystem)

---

## Data model (Neo4j graph)

```
(:Document)-[:HAS_SECTION]->(:Section)-[:HAS_CHUNK]->(:Chunk)
(:Document)-[:HAS_CHUNK]->(:Chunk)
(:Chunk)-[:NEXT_CHUNK]->(:Chunk)
(:Chunk)-[:MENTIONS {frequency}]->(:Entity)
(:Chunk)-[:SUPPORTS]->(:Claim)
(:Entity)-[:RELATES_TO {relation}]->(:Entity)
(:Document)-[:CITES]->(:Document)
```

Vector search uses the `chunk_vector` index (3072-dim cosine).
Fulltext search uses `chunk_fulltext` (text + summary + keywords).
All nodes carry a `kbId` property — isolation is enforced at query time.

---

## Technology choices and rationale

| Choice | Rationale |
|---|---|
| Gemini 2.0 Flash | Best quality/cost for structured JSON extraction; 1M token context |
| gemini-embedding-001 | 3072-dim embeddings outperform 768-dim alternatives on scientific text |
| Neo4j 5.x | Combined vector + graph in one store; no extra vector DB |
| pdfplumber | Preserves layout, font sizes, and table structure — critical for heading detection |
| better-sqlite3 | Synchronous, zero-config, perfect for single-user desktop queuing |
| Electron | Cross-platform desktop with Node.js backend bundled — no server needed |
