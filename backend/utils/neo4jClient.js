/**
 * backend/utils/neo4jClient.js
 * Neo4j driver registry with two operating modes:
 *
 * MANAGED MODE (recommended for development):
 *   Set NEO4J_URI in .env — connects to an already-running Neo4j instance.
 *   All KBs share one server; isolation is enforced by kbId filters in every query.
 *   startNeo4jForKb() just registers the KB and initialises its schema.
 *   stopNeo4jForKb() is a no-op (we don't own the process).
 *
 * EMBEDDED MODE (future Electron bundle):
 *   NEO4J_URI is not set — spawns a dedicated Neo4j process per KB.
 *   Requires NEO4J_BIN_DIR to point to a bundled Neo4j installation.
 *
 * Public API (same in both modes):
 *   startNeo4jForKb(kbId, port)
 *   getDriver(kbId)
 *   stopNeo4jForKb(kbId)
 *   closeAll()
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

// ─── Mode detection ───────────────────────────────────────────────────────────

const NEO4J_URI      = process.env.NEO4J_URI;      // e.g. bolt://localhost:7687
const NEO4J_USER     = process.env.NEO4J_USER     || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'neo4j';
const MANAGED_MODE   = !!NEO4J_URI;

if (MANAGED_MODE) {
  logger.info({ uri: NEO4J_URI }, 'neo4jClient: MANAGED MODE — connecting to existing Neo4j');
} else {
  logger.info({ binDir: NEO4J_BIN_DIR }, 'neo4jClient: EMBEDDED MODE — will spawn Neo4j per KB');
}

// ─── Shared state ─────────────────────────────────────────────────────────────

/**
 * In managed mode:  Map<kbId, { driver, port: null, proc: null }>
 * In embedded mode: Map<kbId, { driver, port, proc }>
 * @type {Map<string, { driver: import('neo4j-driver').Driver, proc: any, port: number|null }>}
 */
const _instances = new Map();

// Shared driver reused by all KBs in managed mode (one connection pool).
let _sharedDriver = null;

const IS_WINDOWS         = process.platform === 'win32';
const STARTUP_TIMEOUT_MS = parseInt(process.env.NEO4J_STARTUP_TIMEOUT_MS || '90000', 10);
const POLL_INTERVAL_MS   = 1500;

// ─── Helpers (embedded mode only) ────────────────────────────────────────────

function _writeConf(confDir, neo4jDir, boltPort) {
  const lines = [
    `server.directories.data=${path.join(neo4jDir, 'data')}`,
    `server.directories.logs=${path.join(neo4jDir, 'logs')}`,
    `server.directories.plugins=${path.join(neo4jDir, 'plugins')}`,
    `server.directories.import=${path.join(neo4jDir, 'import')}`,
    `server.bolt.listen_address=:${boltPort}`,
    `server.bolt.advertised_address=:${boltPort}`,
    'server.http.enabled=false',
    'server.https.enabled=false',
    'dbms.security.auth_enabled=false',
    'dbms.mode=SINGLE',
  ];
  fs.writeFileSync(path.join(confDir, 'neo4j.conf'), lines.join('\n'), 'utf8');
}

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

async function _waitForConnectivity(driver, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try { await driver.verifyConnectivity(); return; }
    catch (err) { lastErr = err; await new Promise(r => setTimeout(r, POLL_INTERVAL_MS)); }
  }
  throw new Error(`Neo4j not ready within ${timeoutMs}ms: ${lastErr && lastErr.message}`);
}

// ─── Managed mode implementation ──────────────────────────────────────────────

async function _startManaged(kbId) {
  // Reuse the shared driver — create it once on first KB registration
  if (!_sharedDriver) {
    _sharedDriver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
    await _waitForConnectivity(_sharedDriver, 15000);
    logger.info({ uri: NEO4J_URI }, 'neo4jClient: shared driver connected');
  }

  // Initialise schema for this KB (idempotent — safe to call every startup)
  await initNeo4j(_sharedDriver);

  _instances.set(kbId, { driver: _sharedDriver, proc: null, port: null });
  logger.info({ kbId }, 'neo4jClient: KB registered in managed mode');
}

async function _stopManaged(kbId) {
  _instances.delete(kbId);
  logger.info({ kbId }, 'neo4jClient: KB unregistered (shared Neo4j left running)');
}

// ─── Embedded mode implementation ─────────────────────────────────────────────

async function _startEmbedded(kbId, port) {
  const neo4jDir = getKbNeo4jDir(kbId);
  const confDir  = path.join(neo4jDir, 'conf');

  for (const sub of ['data', 'logs', 'plugins', 'import', 'conf']) {
    fs.mkdirSync(path.join(neo4jDir, sub), { recursive: true });
  }
  _writeConf(confDir, neo4jDir, port);

  const neo4jPs1 = path.join(NEO4J_BIN_DIR, 'bin', 'neo4j.ps1');
  const neo4jBin = path.join(NEO4J_BIN_DIR, 'bin', 'neo4j');
  const [cmd, args] = IS_WINDOWS
    ? ['powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', neo4jPs1, 'console']]
    : [neo4jBin, ['console']];

  logger.info({ kbId, port, cmd }, 'neo4jClient: spawning Neo4j');

  const proc = spawn(cmd, args, {
    env: { ...process.env, NEO4J_HOME: NEO4J_BIN_DIR, NEO4J_CONF: confDir },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  proc.stdout.on('data', d => logger.debug({ kbId }, `[neo4j] ${d.toString().trimEnd()}`));
  proc.stderr.on('data', d => logger.warn({ kbId },  `[neo4j] ${d.toString().trimEnd()}`));
  proc.on('exit', (code, signal) => {
    logger.info({ kbId, code, signal }, 'neo4jClient: process exited');
    _instances.delete(kbId);
  });

  await _waitForPort(port, STARTUP_TIMEOUT_MS);
  const driver = neo4j.driver(`bolt://localhost:${port}`, neo4j.auth.basic('neo4j', 'neo4j'));
  await _waitForConnectivity(driver, 30000);
  await initNeo4j(driver);

  _instances.set(kbId, { driver, proc, port });
  logger.info({ kbId, port }, 'neo4jClient: KB ready (embedded)');
}

async function _stopEmbedded(kbId) {
  const inst = _instances.get(kbId);
  if (!inst) return;
  try { await inst.driver.close(); } catch (err) { logger.warn({ err, kbId }, 'driver close error'); }

  inst.proc.kill('SIGTERM');
  await new Promise(resolve => {
    const watchdog = setTimeout(() => {
      try { inst.proc.kill('SIGKILL'); } catch (_) {}
      resolve();
    }, 15000);
    inst.proc.once('exit', () => { clearTimeout(watchdog); resolve(); });
  });

  _instances.delete(kbId);
  logger.info({ kbId }, 'neo4jClient: embedded instance stopped');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Registers a KB with Neo4j and initialises its graph schema.
 * In managed mode: connects to the shared instance (no process spawned).
 * In embedded mode: spawns a dedicated Neo4j process on the given port.
 * @param {string} kbId
 * @param {number} port - used only in embedded mode
 * @returns {Promise<void>}
 */
async function startNeo4jForKb(kbId, port) {
  if (_instances.has(kbId)) {
    logger.info({ kbId }, 'neo4jClient: already started, skipping');
    return;
  }
  if (MANAGED_MODE) return _startManaged(kbId);
  return _startEmbedded(kbId, port);
}

/**
 * Returns the Neo4j driver for a KB.
 * @param {string} kbId
 * @returns {import('neo4j-driver').Driver}
 */
function getDriver(kbId) {
  const inst = _instances.get(kbId);
  if (!inst) throw new Error(`Neo4j not started for KB "${kbId}" — call startNeo4jForKb first`);
  return inst.driver;
}

/**
 * Stops the Neo4j instance for a KB.
 * In managed mode: unregisters the KB (does not stop the shared server).
 * In embedded mode: kills the spawned process.
 * @param {string} kbId
 * @returns {Promise<void>}
 */
async function stopNeo4jForKb(kbId) {
  if (!_instances.has(kbId)) {
    logger.warn({ kbId }, 'neo4jClient: stopNeo4jForKb — not running');
    return;
  }
  if (MANAGED_MODE) return _stopManaged(kbId);
  return _stopEmbedded(kbId);
}

/**
 * Shuts down all KB registrations and, in managed mode, closes the shared driver.
 * @returns {Promise<void>}
 */
async function closeAll() {
  for (const kbId of [..._instances.keys()]) await stopNeo4jForKb(kbId);
  if (MANAGED_MODE && _sharedDriver) {
    await _sharedDriver.close();
    _sharedDriver = null;
    logger.info('neo4jClient: shared driver closed');
  }
}

module.exports = { startNeo4jForKb, getDriver, stopNeo4jForKb, closeAll };
