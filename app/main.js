/**
 * app/main.js
 * Electron main process.
 * Responsibilities: start the Express backend, create the BrowserWindow,
 * register the system tray, and handle graceful shutdown.
 */

'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');

const logger     = require('../backend/utils/logger');
const { start: startServer, app: expressApp } = require('../backend/server');
const { closeAll } = require('../backend/utils/neo4jClient');
const { setupTray } = require('./tray');

let mainWindow = null;
let httpServer = null;

// ─── Window ───────────────────────────────────────────────────────────────────

/**
 * Creates the main BrowserWindow and loads the frontend.
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1280,
    height: 800,
    minWidth:  900,
    minHeight: 600,
    title: 'Scientific Knowledge Base',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          true,
    },
  });

  // Load the React frontend (built output or dev server)
  const frontendUrl = process.env.SKB_FRONTEND_URL || `file://${path.join(__dirname, '../frontend/dist/index.html')}`;
  mainWindow.loadURL(frontendUrl);

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => { mainWindow = null; });

  // Open external links in the system browser, not Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

/**
 * Relay backend API URL to renderer so it never hard-codes the port.
 */
ipcMain.handle('get-api-url', () => {
  const port = process.env.SKB_API_PORT || 3000;
  return `http://localhost:${port}/api`;
});

/**
 * Open a file or directory in the system file manager.
 */
ipcMain.handle('open-path', (_event, filePath) => shell.openPath(filePath));

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  logger.info('Electron app ready — starting backend server');

  try {
    httpServer = await startServer();
    logger.info('Backend server started');
  } catch (err) {
    logger.error({ err }, 'Failed to start backend server');
    // Continue so the user sees an error in the UI rather than a silent crash
  }

  createWindow();
  setupTray(app, mainWindow);

  app.on('activate', () => {
    // macOS: re-create window when dock icon clicked and no windows open
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // macOS convention: keep app alive in menu bar until explicitly quit
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  logger.info('Shutting down Neo4j instances');
  await closeAll();
  if (httpServer) httpServer.close();
});

// ─── Security ─────────────────────────────────────────────────────────────────

// Prevent renderer from navigating to arbitrary URLs
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (ev, url) => {
    const allowed = process.env.SKB_FRONTEND_URL || 'file://';
    if (!url.startsWith(allowed) && !url.startsWith('http://localhost')) {
      ev.preventDefault();
      logger.warn({ url }, 'Blocked navigation to external URL');
    }
  });
});
