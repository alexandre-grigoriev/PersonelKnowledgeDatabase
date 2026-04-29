# Séquence d'implémentation — Ordre pour Claude Code (RAG_PIPELINE.md)

## Ordre d'implémentation recommandé

Implémenter fichier par fichier, compiler sans erreur avant de passer au suivant.

### Phase 1 — Fondations
1. `backend/utils/config.js` — variables d'env + chemins platform-specific
2. `backend/utils/logger.js` — pino logger (remplace console.log partout)
3. `backend/utils/geminiClient.js` — wrapper Gemini (generateContent + embedContent)
4. `backend/utils/archiveManager.js` — gestion archive PDF + index.json
5. `scripts/initNeo4j.js` — DDL constraints + indexes (vecteur + fulltext)
6. `backend/utils/neo4jClient.js` — driver singleton par KB + startNeo4jForKb()

### Phase 2 — Multi-KB
7. `backend/routes/kb.js` — CRUD KBs (GET/POST/DELETE + stats)
8. `backend/server.js` — Express app + middleware (multer, cors, pino-http)

### Phase 3 — Ingestion pipeline
9.  `backend/ingestion/pdfParser.js` — extraction layout via pdfplumber subprocess
10. `backend/ingestion/chunker.js` — chunking heuristique (publications + ASTM)
11. `backend/ingestion/llmEnricher.js` — enrichissement Gemini par chunk
12. `backend/ingestion/embedder.js` — embeddings Gemini (séquentiels)
13. `backend/ingestion/graphWriter.js` — MERGE Neo4j (Document, Section, Chunk, Entity)
14. `backend/routes/ingest.js` — POST /api/ingest (multipart) + POST /api/ingest/text

### Phase 4 — Archive & Preview
15. `backend/routes/archive.js` — GET archive, preview, DELETE, rebuild SSE

### Phase 5 — Query pipeline
16. `backend/retrieval/queryPlanner.js` — décomposition LLM de la question
17. `backend/retrieval/hybridRetriever.js` — vector search + graph expansion Cypher
18. `backend/retrieval/synthesizer.js` — synthèse LLM avec citations
19. `backend/routes/query.js` — POST /api/query

### Phase 6 — Electron shell
20. `frontend/main.js` — process principal, démarrage services, tray
21. `frontend/preload.js` — IPC bridge contextIsolation
22. `frontend/tray.js` — icône système + menu

### Phase 7 — Extension Chrome
23. `chrome-extension/content.js` — détection PDF + extraction méta
24. `chrome-extension/background.js` — service worker download + fetch
25. `chrome-extension/popup.js` + `popup.html` — UI

### Phase 8 — Scripts utilitaires
26. `scripts/rebuildKb.js` — ré-ingestion depuis archive

---

## Prompt Gemini — Enrichissement chunk

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

## Prompt Gemini — Query planning

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

## Prompt Gemini — Synthèse finale

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
