/**
 * backend/utils/geminiClient.js
 * Google Gemini 2.0 Flash API wrapper for content generation and embeddings.
 * All Gemini API calls must be sequential (never parallel).
 * Usage: await gemini.generateContent(...), await gemini.embedContent(...)
 */

const fetch = require('node-fetch');
const logger = require('./logger');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp';
const GEMINI_EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';

if (!GEMINI_API_KEY) {
  logger.error('GEMINI_API_KEY is not set.');
  throw new Error('GEMINI_API_KEY is required');
}

// Sequential lock to enforce no parallel calls
let lastPromise = Promise.resolve();
function sequential(fn) {
  return (...args) => {
    lastPromise = lastPromise.then(() => fn(...args));
    return lastPromise;
  };
}

/**
 * Generate content using Gemini LLM
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function _generateContent(prompt) {
  const url = `${GEMINI_API_URL}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }]
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    logger.error({ status: res.status, statusText: res.statusText }, 'Gemini generateContent failed');
    throw new Error(`Gemini generateContent failed: ${res.statusText}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/**
 * Get embeddings for text using Gemini
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function _embedContent(text) {
  const url = `${GEMINI_API_URL}/${GEMINI_EMBED_MODEL}:embedContent?key=${GEMINI_API_KEY}`;
  const body = { content: { parts: [{ text }] } };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    logger.error({ status: res.status, statusText: res.statusText }, 'Gemini embedContent failed');
    throw new Error(`Gemini embedContent failed: ${res.statusText}`);
  }
  const data = await res.json();
  return data.embedding?.values || [];
}

module.exports = {
  generateContent: sequential(_generateContent),
  embedContent: sequential(_embedContent),
};
