/**
 * backend/routes/settings.js
 * Global application settings: Gemini model selection, etc.
 * Settings are persisted to a JSON file in the project root.
 */

const fs   = require('fs');
const path = require('path');
const express = require('express');

const logger = require('../utils/logger');
const { reloadModels } = require('../utils/geminiClient');

const SETTINGS_FILE = path.join(__dirname, '..', '..', 'settings.json');

// Default settings
const DEFAULTS = {
  geminiModel:      'gemini-2.5-flash',
  geminiEmbedModel: 'gemini-embedding-001',
  geminiApiKey:     '',
};

// Load settings from file, or use defaults
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      return { ...DEFAULTS, ...data };
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load settings, using defaults');
  }
  return { ...DEFAULTS };
}

// Save settings to file
function saveSettings(settings) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (err) {
    logger.error({ err }, 'Failed to save settings');
    throw new Error('Failed to save settings');
  }
}

const router = express.Router();

// GET /api/settings — get all settings
router.get('/', (req, res) => {
  const settings = loadSettings();
  res.json(settings);
});

// PUT /api/settings — update settings
router.put('/', (req, res) => {
  const current = loadSettings();
  const updated = { ...current, ...req.body };
  saveSettings(updated);
  reloadModels(); // Reload models in memory
  res.json(updated);
});

module.exports = router;