/**
 * app/tray.js
 * System tray icon and context menu.
 * The tray keeps the app alive when the main window is closed on macOS/Windows.
 */

'use strict';

const path = require('path');
const { Tray, Menu, BrowserWindow } = require('electron');

const logger = require('../backend/utils/logger');

let tray = null;

/**
 * Creates the system tray icon and its context menu.
 * Must be called after app.whenReady().
 * @param {import('electron').App} app
 * @param {import('electron').BrowserWindow | null} mainWindowRef - mutable reference holder
 */
function setupTray(app, mainWindowRef) {
  const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const iconPath = path.join(__dirname, '..', 'assets', iconName);

  try {
    tray = new Tray(iconPath);
  } catch (err) {
    // Assets not yet present during development — skip tray gracefully
    logger.warn({ err }, 'tray: icon not found, skipping system tray');
    return;
  }

  tray.setToolTip('Scientific Knowledge Base');

  const buildMenu = () => Menu.buildFromTemplate([
    {
      label: 'Open Scientific KB',
      click: () => {
        const wins = BrowserWindow.getAllWindows();
        if (wins.length) {
          wins[0].show();
          wins[0].focus();
        } else {
          // Re-create window if user closed it
          app.emit('activate');
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit(),
    },
  ]);

  tray.setContextMenu(buildMenu());

  // Single-click on Windows/Linux shows the window
  tray.on('click', () => {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length) { wins[0].show(); wins[0].focus(); }
    else app.emit('activate');
  });

  logger.info('tray: system tray ready');
}

module.exports = { setupTray };
