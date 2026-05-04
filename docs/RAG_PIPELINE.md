# Implementation Sequence — Order for Claude Code (RAG_PIPELINE.md)

## Recommended implementation order

Implement file by file, compile without errors before moving to the next.

### Phase 1 — Foundations
1. `backend/utils/config.js` — env variables + platform-specific paths
2. `backend/utils/logger.js` — pino logger (replaces console.log everywhere)
3. `backend/utils/geminiClient.js` — Gemini wrapper (generateContent + embedContent)
4. `backend/utils/archiveManager.js` — PDF archive management + index.json
5. `scripts/initNeo4j.js` — DDL constraints + indexes (vector + fulltext)
6. `backend/utils/neo4jClient.js` — driver singleton per KB + startNeo4jForKb()

### Phase 2 — Multi-KB
7. `backend/routes/kb.js` — CRUD KBs (GET/POST/DELETE + stats)
8. `backend/server.js` — Express app + middleware (multer, cors, pino-http)

### Phase 3 — Ingestion pipeline
9.  `backend/ingestion/pdfParser.js` — layout extraction via pdfplumber subprocess
10. `backend/ingestion/chunker.js` — heuristic chunking (publications + ASTM)
11. `backend/ingestion/llmEnricher.js` — Gemini enrichment per chunk
12. `backend/ingestion/embedder.js` — Gemini embeddings (sequential)
13. `backend/ingestion/graphWriter.js` — MERGE Neo4j (Document, Section, Chunk, Entity)
14. `backend/routes/ingest.js` — POST /api/ingest (multipart) + POST /api/ingest/text

### Phase 4 — Archive & Preview
15. `backend/routes/archive.js` — GET archive, preview, DELETE, rebuild SSE

### Phase 5 — Query pipeline
16. `backend/retrieval/queryPlanner.js` — LLM decomposition of the question
17. `backend/retrieval/hybridRetriever.js` — vector search + graph expansion Cypher
18. `backend/retrieval/synthesizer.js` — LLM synthesis with citations
19. `backend/routes/query.js` — POST /api/query

### Phase 6 — Electron shell
20. `app/main.js` — main process, service startup, tray
21. `app/preload.js` — IPC bridge contextIsolation
22. `app/tray.js` — system tray icon + menu

### Phase 7 — Chrome Extension
23. `chrome-extension/content.js` — PDF detection + metadata extraction
24. `chrome-extension/background.js` — service worker download + fetch
25. `chrome-extension/popup.js` + `popup.html` — UI

### Phase 8 — Utility scripts
26. `scripts/rebuildKb.js` — re-ingestion from archive

---

## Gemini prompt — Chunk enrichment

```
System: You are a scientific knowledge extraction expert. Extract structured information
from scientific document chunks. Always respond with valid JSON only, no markdown.

User:
Document type: {docType}
Document title: {docTitle}
Section: {section}
Chunk type: {chunkType}

Extract from this chunk:
1. summary: 2-sentence summary in English
2. entities: array of {name, type} where type is one of:
   material | method | standard | compound | property | equipment | organization
3. claims: array of key findings or specifications as strings
4. relations: array of {from, relation, to} semantic relationships
5. keywords: 5-10 key terms

Chunk text:
{chunkText}

Respond ONLY with:
{
  "summary": "...",
  "entities": [...],
  "claims": [...],
  "relations": [...],
  "keywords": [...]
}
```

## Gemini prompt — Query planning

```
System: You are a scientific document retrieval expert.
Decompose the user question into 2-4 precise sub-queries optimized for semantic search
over scientific literature and ASTM standards.
Respond with JSON only.

User question: {question}
Active knowledge base: {kbName}

Respond with:
{
  "subQueries": ["...", "..."],
  "entities": ["key entity names to look up"],
  "strategy": "vector_only | graph_only | hybrid",
  "needsAstm": true | false
}
```

## Gemini prompt — Final synthesis

```
System: You are a scientific assistant answering questions based on retrieved document
chunks. Always cite your sources. Be precise and use the technical vocabulary from
the documents. If the retrieved chunks don't contain enough information, say so clearly.

User question: {question}

Retrieved context:
{formattedChunks}
(each chunk: [Source: {title} ({year}), Section: {section}]\n{chunkText})

Instructions:
- Answer in the same language as the question
- Cite sources using [Author, Year] notation
- For ASTM standards, cite the standard code
- If values conflict between sources, mention both
- Structure the answer with clear paragraphs
```
