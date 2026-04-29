/**
 * backend/utils/neo4jClient.js
 * Singleton registry of per-KB Neo4j driver instances.
 * Each KB runs its own Neo4j process on a dedicated bolt port.
 *
 * Public API:
 *   startNeo4jForKb(kbId, port)  — spawn + wait + init schema
 *   getDriver(kbId)              — return active driver (throws if not started)
 *   stopNeo4jForKb(kbId)        — graceful stop (used by rebuild flow)
 *   closeAll()                   — call on application shutdown
 */

'use strict';

const fs   = require('fs');
const net  = require('net');
const path = require('path');
const { spawn } = require('child_process');

const neo4j  = require('neo4j-driver');
const logger = require('./logger');
const { NEO4J_BIN_DIR, getKbNeo4jDir } = require('./config');
const { initNeo4j } = require('../../scripts/initNeo4j');

/**
 * @typedef {{ driver: import('neo4j-driver').Driver, proc: import('child_process').ChildProcess, port: number }} KbInstance
 * @type {Map<string, KbInstance>}
 */
const _instances = new Map();

const IS_WINDOWS = process.platform === 'win32';

// Neo4j startup readiness window
const STARTUP_TIMEOUT_MS  = parseInt(process.env.NEO4J_STARTUP_TIMEOUT_MS  || '90000', 10);
const POLL_INTERVAL_MS    = 1500;

// ─── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Writes a minimal neo4j.conf file for an isolated KB instance.
 * Auth is disabled — instance is local-only (desktop app).
 * HTTP connector is disabled — we use bolt exclusively.
 * @param {string} confDir  - Directory to write neo4j.conf into
 * @param {string} neo4jDir - Root Neo4j directory for this KB
 * @param {number} boltPort
 */
function _writeConf(confDir, neo4jDir, boltPort) {
  const lines = [
    // Data directories
    `server.directories.data=${path.join(neo4jDir, 'data')}`,
    `server.directories.logs=${path.join(neo4jDir, 'logs')}`,
    `server.directories.plugins=${path.join(neo4jDir, 'plugins')}`,
    `server.directories.import=${path.join(neo4jDir, 'import')}`,
    // Bolt only
    `server.bolt.listen_address=:${boltPort}`,
    `server.bolt.advertised_address=:${boltPort}`,
    'server.http.enabled=false',
    'server.https.enabled=false',
    // Disable auth — single-user desktop app, bolt is localhost-only
    'dbms.security.auth_enabled=false',
    // Single instance mode
    'dbms.mode=SINGLE',
  ];
  fs.writeFileSync(path.join(confDir, 'neo4j.conf'), lines.join('\n'), 'utf8');
}

/**
 * Polls until a TCP port accepts connections or the deadline passes.
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
function _waitForPort(port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    function attempt() {
      const sock = net.createConnection({ host: 'localhost', port });
      sock.once('connect', () => { sock.destroy(); resolve(); });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`Neo4j bolt :${port} did not open within ${timeoutMs}ms`));
          return;
        }
        setTimeout(attempt, POLL_INTERVAL_MS);
      });
    }
    attempt();
  });
}

/**
 * Retries driver.verifyConnectivity() until success or timeout.
 * The bolt port being open does not guarantee Neo4j is fully ready.
 * @param {import('neo4j-driver').Driver} driver
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
async function _waitForConnectivity(driver, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      await driver.verifyConnectivity();
      return;
    } catch (err) {
      lastErr = err;
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
  throw new Error(`Neo4j driver not ready within ${timeoutMs}ms: ${lastErr && lastErr.message}`);
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Launches a Neo4j instance for the given KB and initializes its schema.
 * No-op if the instance is already running.
 * @param {string} kbId  - Knowledge base UUID
 * @param {number} port  - Bolt port to use for this instance
 * @returns {Promise<void>}
 */
async function startNeo4jForKb(kbId, port) {
  if (_instances.has(kbId)) {
    logger.info({ kbId, port }, 'neo4j already running, skipping start');
    return;
  }

  const neo4jDir = getKbNeo4jDir(kbId);
  const confDir  = path.join(neo4jDir, 'conf');

  // Ensure all required sub-directories exist
  for (const sub of ['data', 'logs', 'plugins', 'import', 'conf']) {
    fs.mkdirSync(path.join(neo4jDir, sub), { recursive: true });
  }

  _writeConf(confDir, neo4jDir, port);

  // neo4j binary — .bat on Windows, plain script on Unix
  const neo4jBin = path.join(NEO4J_BIN_DIR, 'bin', IS_WINDOWS ? 'neo4j.bat' : 'neo4j');

  logger.info({ kbId, port, neo4jBin }, 'starting neo4j process');

  const proc = spawn(neo4jBin, ['console'], {
    env: {
      ...process.env,
      NEO4J_HOME: NEO4J_BIN_DIR,
      NEO4J_CONF: confDir,
    },
    // shell required on Windows for .bat execution
    shell: IS_WINDOWS,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  proc.stdout.on('data', (d) => logger.debug({ kbId }, `[neo4j] ${d.toString().trimEnd()}`));
  proc.stderr.on('data', (d) => logger.warn({ kbId },  `[neo4j] ${d.toString().trimEnd()}`));
  proc.on('exit', (code, signal) => {
    logger.info({ kbId, code, signal }, 'neo4j process exited');
    _instances.delete(kbId);
  });

  // Two-phase readiness: TCP port open, then bolt handshake
  await _waitForPort(port, STARTUP_TIMEOUT_MS);
  logger.debug({ kbId, port }, 'bolt port open');

  const driver = neo4j.driver(
    `bolt://localhost:${port}`,
    neo4j.auth.none(),   // auth disabled in conf
  );

  await _waitForConnectivity(driver, 30000);
  logger.debug({ kbId, port }, 'bolt connectivity confirmed');

  // Initialize constraints + indexes (idempotent)
  await initNeo4j(driver);

  _instances.set(kbId, { driver, proc, port });
  logger.info({ kbId, port }, 'neo4j ready');
}

/**
 * Returns the active Neo4j driver for a KB.
 * @param {string} kbId
 * @returns {import('neo4j-driver').Driver}
 * @throws {Error} if the KB's Neo4j instance has not been started
 */
function getDriver(kbId) {
  const instance = _instances.get(kbId);
  if (!instance) {
    throw new Error(`Neo4j instance for KB "${kbId}" is not running — call startNeo4jForKb first`);
  }
  return instance.driver;
}

/**
 * Gracefully stops the Neo4j instance for a KB.
 * Used by the rebuild flow before wiping the data directory.
 * @param {string} kbId
 * @returns {Promise<void>}
 */
async function stopNeo4jForKb(kbId) {
  const instance = _instances.get(kbId);
  if (!instance) {
    logger.warn({ kbId }, 'stopNeo4jForKb: no running instance, nothing to stop');
    return;
  }

  logger.info({ kbId }, 'stopping neo4j');

  try {
    await instance.driver.close();
  } catch (err) {
    logger.warn({ err, kbId }, 'error closing neo4j driver');
  }

  instance.proc.kill('SIGTERM');

  // Wait up to 15 s for graceful exit, then force-kill
  await new Promise((resolve) => {
    const watchdog = setTimeout(() => {
      logger.warn({ kbId }, 'neo4j did not stop gracefully, sending SIGKILL');
      try { instance.proc.kill('SIGKILL'); } catch (_) { /* already gone */ }
      resolve();
    }, 15000);

    instance.proc.once('exit', () => {
      clearTimeout(watchdog);
      resolve();
    });
  });

  _instances.delete(kbId);
  logger.info({ kbId }, 'neo4j stopped');
}

/**
 * Closes all active drivers and terminates all Neo4j processes.
 * Call on application shutdown to avoid orphan processes.
 * @returns {Promise<void>}
 */
async function closeAll() {
  const ids = [..._instances.keys()];
  logger.info({ count: ids.length }, 'closing all neo4j instances');
  for (const kbId of ids) {
    await stopNeo4jForKb(kbId);
  }
}

module.exports = { startNeo4jForKb, getDriver, stopNeo4jForKb, closeAll };
