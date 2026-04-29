/**
 * backend/ingestion/llmEnricher.js
 * Pass 2 of 2 — LLM enrichment of raw chunks via Gemini.
 * Extracts summary, entities, claims, relations, and keywords.
 * All Gemini calls go through the sequential client (rule: never in parallel).
 */

'use strict';

const { generateContent } = require('../utils/geminiClient');
const logger              = require('../utils/logger');

const ENTITY_TYPES = 'material | method | standard | compound | property | equipment | organization';

/**
 * @typedef {Object} EnrichedData
 * @property {string}   summary
 * @property {{ name: string, type: string }[]}              entities
 * @property {string[]}                                       claims
 * @property {{ from: string, relation: string, to: string }[]} relations
 * @property {string[]}                                       keywords
 * @property {string}   [tableType]           - table chunks only
 * @property {{ name: string, value: string, unit: string, condition: string }[]} [properties] - table chunks only
 * @property {string[]} [applicableMaterials] - table chunks only
 */

// ─── Prompt builders ──────────────────────────────────────────────────────────

/**
 * @param {import('./chunker').RawChunk} chunk
 * @param {{ docType: string, docTitle: string }} meta
 * @returns {string}
 */
function buildTextPrompt(chunk, meta) {
  return `You are a scientific knowledge extraction expert. Extract structured information from scientific document chunks. Always respond with valid JSON only, no markdown.

Document type: ${meta.docType}
Document title: ${meta.docTitle}
Section: ${chunk.section}
Chunk type: ${chunk.chunkType}

Extract from this chunk:
1. summary: 2-sentence summary in English
2. entities: array of {name, type} where type is one of: ${ENTITY_TYPES}
3. claims: array of key findings or specifications as strings
4. relations: array of {from, relation, to} semantic relationships
5. keywords: 5-10 key terms

Chunk text:
${chunk.text}

Respond ONLY with:
{
  "summary": "...",
  "entities": [{"name": "...", "type": "..."}],
  "claims": ["..."],
  "relations": [{"from": "...", "relation": "...", "to": "..."}],
  "keywords": ["..."]
}`;
}

/**
 * @param {import('./chunker').RawChunk} chunk
 * @param {{ docType: string, docTitle: string }} meta
 * @returns {string}
 */
function buildTablePrompt(chunk, meta) {
  const label = meta.docType === 'astm_standard' ? 'ASTM standard' : 'publication';
  return `You are analyzing a table from a ${label}.
Extract the structured data and explain what it specifies.

Table content:
${chunk.text}

Respond ONLY with valid JSON:
{
  "summary": "...",
  "tableType": "mechanical_properties|chemical_composition|test_conditions|other",
  "properties": [{"name": "...", "value": "...", "unit": "...", "condition": "..."}],
  "applicableMaterials": ["..."],
  "keywords": ["..."]
}`;
}

// ─── Response parsing ─────────────────────────────────────────────────────────

/**
 * Strips markdown code fences that Gemini sometimes wraps responses in.
 * @param {string} raw
 * @returns {string}
 */
function stripFences(raw) {
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

/**
 * Parses Gemini's JSON response into an EnrichedData object.
 * Falls back to safe empty defaults on any parse failure so a bad LLM
 * response never crashes the ingestion pipeline.
 * @param {string} raw
 * @param {string} chunkType
 * @returns {EnrichedData}
 */
function parseEnrichment(raw, chunkType) {
  try {
    const p = JSON.parse(stripFences(raw));
    if (chunkType === 'table') {
      return {
        summary:             String(p.summary || ''),
        entities:            [],
        claims:              [],
        relations:           [],
        keywords:            Array.isArray(p.keywords)            ? p.keywords            : [],
        tableType:           String(p.tableType || 'other'),
        properties:          Array.isArray(p.properties)          ? p.properties          : [],
        applicableMaterials: Array.isArray(p.applicableMaterials) ? p.applicableMaterials : [],
      };
    }
    return {
      summary:   String(p.summary || ''),
      entities:  Array.isArray(p.entities)  ? p.entities  : [],
      claims:    Array.isArray(p.claims)    ? p.claims    : [],
      relations: Array.isArray(p.relations) ? p.relations : [],
      keywords:  Array.isArray(p.keywords)  ? p.keywords  : [],
    };
  } catch (err) {
    logger.warn({ err, raw: raw.slice(0, 200) }, 'llmEnricher: JSON parse failed, using empty defaults');
    return { summary: '', entities: [], claims: [], relations: [], keywords: [] };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Enriches a single chunk with LLM-extracted metadata.
 * Called sequentially inside a for-loop by the ingestion pipeline —
 * do not call concurrently.
 * @param {import('./chunker').RawChunk} chunk
 * @param {{ docType: string, docTitle: string }} docMeta
 * @returns {Promise<EnrichedData>}
 */
async function enrichChunk(chunk, docMeta) {
  const prompt = chunk.chunkType === 'table'
    ? buildTablePrompt(chunk, docMeta)
    : buildTextPrompt(chunk, docMeta);

  logger.debug({ chunkIndex: chunk.index, chunkType: chunk.chunkType }, 'llmEnricher: enriching');

  const raw = await generateContent(prompt);
  return parseEnrichment(raw, chunk.chunkType);
}

module.exports = { enrichChunk };
