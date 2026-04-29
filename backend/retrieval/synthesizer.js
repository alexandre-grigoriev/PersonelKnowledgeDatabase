/**
 * backend/retrieval/synthesizer.js
 * Generates a cited, structured answer from retrieved chunks using Gemini.
 */

'use strict';

const { generateContent } = require('../utils/geminiClient');
const logger              = require('../utils/logger');

/**
 * @typedef {Object} SynthesisResult
 * @property {string} answer
 * @property {import('./hybridRetriever').RetrievedChunk[]} sources
 * @property {string[]} entities
 */

/**
 * Formats retrieved chunks into the context block injected into the prompt.
 * @param {import('./hybridRetriever').RetrievedChunk[]} chunks
 * @returns {string}
 */
function formatContext(chunks) {
  return chunks.map((c, i) => {
    const sourceLabel = c.doi
      ? `${c.docTitle} (${c.year || 'n.d.'}) DOI:${c.doi}`
      : c.docTitle || 'Unknown source';
    return `[${i + 1}] [Source: ${sourceLabel}, Section: ${c.section || 'N/A'}]\n${c.text}`;
  }).join('\n\n');
}

/**
 * Synthesises a final answer from the question and retrieved chunks.
 * Called once per query — sequential by virtue of the geminiClient lock.
 * @param {string} question
 * @param {import('./hybridRetriever').RetrievedChunk[]} chunks
 * @returns {Promise<SynthesisResult>}
 */
async function synthesize(question, chunks) {
  if (!chunks.length) {
    return {
      answer: 'No relevant documents were found in the knowledge base for this question.',
      sources: [],
      entities: [],
    };
  }

  const context = formatContext(chunks);

  const prompt = `You are a scientific assistant answering questions based on retrieved document chunks. Always cite your sources. Be precise and use the technical vocabulary from the documents. If the retrieved chunks don't contain enough information, say so clearly.

User question: ${question}

Retrieved context:
${context}

Instructions:
- Answer in the same language as the question
- Cite sources using [1], [2], ... notation matching the numbers above
- For ASTM standards, cite the standard code explicitly
- If values conflict between sources, mention both
- Structure the answer with clear paragraphs
- If the context is insufficient, state that clearly`;

  logger.debug({ question, chunkCount: chunks.length }, 'synthesizer: generating answer');

  let answer;
  try {
    answer = await generateContent(prompt);
  } catch (err) {
    logger.error({ err }, 'synthesizer: Gemini call failed');
    answer = 'Failed to generate answer due to an API error.';
  }

  // Extract entity names from chunks for the response metadata
  const entitySet = new Set();
  // (entities would be loaded from Neo4j in a richer implementation;
  //  here we surface the doc titles as a lightweight proxy)
  for (const c of chunks) if (c.docTitle) entitySet.add(c.docTitle);

  return {
    answer,
    sources: chunks.map(c => ({
      docId:          c.docId,
      title:          c.docTitle,
      doi:            c.doi      || null,
      year:           c.year     || null,
      chunkId:        c.chunkId,
      section:        c.section,
      relevanceScore: c.relevanceScore,
      pdfPreviewUrl:  c.docId ? `/api/kb/${c.kbId}/archive/${c.docId}/preview` : null,
    })),
    entities: [...entitySet],
  };
}

module.exports = { synthesize };
