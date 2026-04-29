/**
 * app/preload.js
 * IPC bridge between the Electron main process and the renderer.
 * contextIsolation=true: only whitelisted APIs are exposed — no raw Node.js.
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Exposes a minimal, typed API surface to the renderer via window.skbApi.
 * The renderer must never import electron or Node modules directly.
 */
contextBridge.exposeInMainWorld('skbApi', {
  /**
   * Returns the backend API base URL (e.g. http://localhost:3000/api).
   * @returns {Promise<string>}
   */
  getApiUrl: () => ipcRenderer.invoke('get-api-url'),

  /**
   * Opens a local file or directory in the OS file manager.
   * @param {string} filePath
   * @returns {Promise<void>}
   */
  openPath: (filePath) => ipcRenderer.invoke('open-path', filePath),

  /**
   * Returns the current platform string ('win32' | 'darwin' | 'linux').
   * @returns {string}
   */
  platform: process.platform,
});
