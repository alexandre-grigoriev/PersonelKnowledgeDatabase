# AGENTS.md

## Purpose
This file provides essential instructions and conventions for AI coding agents working in this codebase. It summarizes key architecture, workflows, and rules, and links to detailed documentation. This ensures agents are immediately productive and follow project-specific practices.

---

## Project Overview
- **Desktop app** (Electron 30+, Node.js, Neo4j embedded)
- **Backend**: Node.js 20, Express, CommonJS
- **LLM**: Google Gemini 2.0 Flash (gemini-2.0-flash-exp)
- **Embeddings**: gemini-embedding-001 (3072d)
- **Graph/Vector**: Neo4j 5.x Community (one instance per KB)
- **PDF parsing**: Python subprocess (pdf-parse, pdfplumber)
- **Archive**: Local filesystem (~/scientific-kb/)
- **Metadata/Queue**: SQLite 3 (one DB per KB)
- **Frontend**: React 19, TypeScript, Tailwind (DO NOT MODIFY)
- **Chrome extension**: Manifest V3, Vanilla JS

---

## Key Directories
- `frontend/` — Electron shell
- `backend/` — API, ingestion, retrieval, utils
- `chrome-extension/` — Browser extension
- `scripts/` — Setup and maintenance scripts
- `data/` — Per-KB storage (created at install)
- See [CLAUDE.md](CLAUDE.md) for full structure

---

## Absolute Rules
1. Gemini API calls: **sequential only** (never parallel)
2. Neo4j: **MERGE only** (never direct CREATE)
3. No `console.log` in production — use `logger` (pino)
4. **JSDoc** required on all public functions
5. **Heuristic chunking first** — detect structure before LLM
6. **Frontend is off-limits** (do not modify)
7. **Archive is source of truth** — always copy PDF first
8. **Multi-KB = full isolation** — each KB has its own Neo4j + SQLite

---

## Documentation Links
- [CLAUDE.md](CLAUDE.md) — Vision, stack, layout, rules
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Architecture details
- [docs/MULTI_KB.md](docs/MULTI_KB.md) — Multi-KB isolation
- [docs/CHUNKING_STRATEGY.md](docs/CHUNKING_STRATEGY.md) — Chunking pipeline
- [docs/NEO4J_SCHEMA.md](docs/NEO4J_SCHEMA.md) — Graph schema
- [docs/ARCHIVE_SYSTEM.md](docs/ARCHIVE_SYSTEM.md) — Archive system
- [docs/INSTALLER.md](docs/INSTALLER.md) — Installer
- [docs/CHROME_EXTENSION.md](docs/CHROME_EXTENSION.md) — Chrome extension
- [docs/API_CONTRACTS.md](docs/API_CONTRACTS.md) — API contracts

---

## Agent Guidance
- **Link, don’t duplicate**: Always link to docs above for details
- **Minimal by default**: Only include what’s not easily discoverable
- **Concise and actionable**: Every line should guide agent behavior
- For new skills or agent customizations, see [agent-customization skill](d:\Users\GRIGORIEV\.vscode\extensions\github.copilot-chat-0.45.1\assets\prompts\skills\agent-customization\SKILL.md)
