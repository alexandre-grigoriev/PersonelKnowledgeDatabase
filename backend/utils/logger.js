/**
 * backend/utils/logger.js
 * Centralized logger using pino. No console.log in production code.
 * Usage: const logger = require('./logger'); logger.info('message');
 */

const pino = require('pino');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const LOGS_DIR = path.join(__dirname, '../../logs');
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: { colorize: true }
  } : undefined,
},
  pino.destination(path.join(LOGS_DIR, 'app.log'))
);

module.exports = logger;
