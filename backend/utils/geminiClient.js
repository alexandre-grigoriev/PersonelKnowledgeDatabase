/**
 * backend/utils/geminiClient.js
 * Google Gemini 2.0 Flash API wrapper for content generation and embeddings.
 * All Gemini API calls must be sequential (never parallel).
 * Usage: await gemini.generateContent(...), await gemini.embedContent(...)
 */

const fetch = require('node-fetch');
const logger = require('./logger');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1/models';
const GEMINI_BETA_API_URL = process.env.GEMINI_BETA_API_URL || 'https://generativelanguage.googleapis.com/v1beta/models';

// Load model from settings.json if exists, else env var, else default
let GEMINI_MODEL;
let GEMINI_EMBED_MODEL;

function loadModels() {
  try {
    const settingsPath = require('path').join(__dirname, '..', '..', 'settings.json');
    if (require('fs').existsSync(settingsPath)) {
      const settings = require(settingsPath);
      GEMINI_MODEL = settings.geminiModel || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
      GEMINI_EMBED_MODEL = settings.geminiEmbedModel || process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';
    } else {
      GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
      GEMINI_EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';
    }
  } catch {
    GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    GEMINI_EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';
  }
}

loadModels();

// Function to reload models after settings change
function reloadModels() {
  // Clear require cache for settings.json
  try {
    const settingsPath = require('path').join(__dirname, '..', '..', 'settings.json');
    delete require.cache[require.resolve(settingsPath)];
  } catch {}
  loadModels();
}

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

function buildModelUrl(baseUrl, model, method) {
  return `${baseUrl}/${model}:${method}?key=${GEMINI_API_KEY}`;
}

async function _performRequest(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const raw = await res.text();
  return { res, raw };
}

async function _fetchGeminiWithFallbacks(urls, body) {
  let lastResult = null;
  for (const url of urls) {
    const result = await _performRequest(url, body);
    if (result.res.ok) {
      return result;
    }
    logger.warn({
      status: result.res.status,
      statusText: result.res.statusText,
      body: result.raw,
      url,
    }, 'Gemini API request failed');
    lastResult = result;
  }
  return lastResult;
}

/**
 * Generate content using Gemini LLM
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function _generateContent(prompt) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }]
  };

  const urls = [
    buildModelUrl(GEMINI_API_URL, GEMINI_MODEL, 'generateContent'),
    buildModelUrl(GEMINI_BETA_API_URL, GEMINI_MODEL, 'generateContent'),
    buildModelUrl(GEMINI_API_URL, GEMINI_MODEL, 'generateText'),
    buildModelUrl(GEMINI_BETA_API_URL, GEMINI_MODEL, 'generateText'),
  ];

  const { res, raw } = await _fetchGeminiWithFallbacks(urls, body);
  if (!res.ok) {
    logger.error({ status: res.status, statusText: res.statusText, body: raw }, 'Gemini generation failed');
    throw new Error(`Gemini generation failed: ${res.status} ${res.statusText}${raw ? ` - ${raw}` : ''}`);
  }

  const data = raw ? JSON.parse(raw) : {};
  return data.candidates?.[0]?.content?.parts?.[0]?.text
    || data.candidates?.[0]?.output
    || data.outputText
    || '';
}

/**
 * Get embeddings for text using Gemini
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function _embedContent(text) {
  const body = { content: { parts: [{ text }] } };

  const urls = [
    buildModelUrl(GEMINI_API_URL, GEMINI_EMBED_MODEL, 'embedContent'),
    buildModelUrl(GEMINI_BETA_API_URL, GEMINI_EMBED_MODEL, 'embedContent'),
  ];

  const { res, raw } = await _fetchGeminiWithFallbacks(urls, body);
  if (!res.ok) {
    logger.error({ status: res.status, statusText: res.statusText, body: raw }, 'Gemini embedding failed');
    throw new Error(`Gemini embedding failed: ${res.status} ${res.statusText}${raw ? ` - ${raw}` : ''}`);
  }

  const data = raw ? JSON.parse(raw) : {};
  return data.embedding?.values
    || data.embedding?.value
    || data.data?.[0]?.embedding?.values
    || [];
}

module.exports = {
  reloadModels,
  generateContent: sequential(_generateContent),
  embedContent: sequential(_embedContent),
};
