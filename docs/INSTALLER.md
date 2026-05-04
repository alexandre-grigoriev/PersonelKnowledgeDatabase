# Cross-Platform Installer — Mac & Windows (INSTALLER.md)

## Approach: Electron + Bundled Services

Electron wraps the React UI, the Express backend, and orchestrates the Neo4j and Python services.
The user installs a single `.dmg` (Mac) or `.exe` (Windows) with no technical prerequisites.

## What is bundled in the installer
- Node.js (via Electron)
- Express backend (CommonJS)
- React frontend (statically built, served by Express)
- Neo4j Community 5.x (binaries downloaded on first launch)
- Python 3.11 (portable, for pdfplumber)
- Python dependencies: pdfplumber, pdfminer.six

## Electron package structure
```
ScientificKB.app (Mac) / ScientificKB (Windows)
├── resources/
│   ├── app/                    ← Node.js code
│   │   ├── app/main.js         ← Electron main process
│   │   ├── backend/            ← Express backend
│   │   └── frontend/build/     ← Built React app
│   ├── neo4j/                  ← Neo4j binaries (downloaded at setup)
│   │   ├── bin/neo4j
│   │   └── conf/neo4j.conf.template
│   └── python/                 ← Portable Python
│       ├── python (Mac) / python.exe (Win)
│       └── lib/site-packages/pdfplumber/
└── ...
```

## app/main.js — Electron main process

### Startup sequence
```javascript
app.on('ready', async () => {
  await ensureDataDirectory();      // create ~/scientific-kb/ if absent
  await checkFirstRun();            // show wizard on first launch
  await startBackend();             // start Express on port 3000
  await loadKnowledgeBases();       // start Neo4j for existing KBs
  createMainWindow();               // show the UI
  createTrayIcon();                 // icon in the system tray
});
```

### Neo4j service management
```javascript
/**
 * Starts a Neo4j instance for a given KB.
 * Assigns a dynamic port between 7687 and 7787.
 * @param {string} kbId
 * @returns {Promise<{port: number, pid: number}>}
 */
async function startNeo4jForKb(kbId) {
  const port = await findFreePort(7687, 7787);
  const configPath = await writeNeo4jConfig(kbId, port);
  const neo4jBin = getNeo4jBinPath();  // platform-specific
  const proc = spawn(neo4jBin, ['console'], { cwd: configPath });
  // Wait for the "Started." log line before resolving
  return { port, pid: proc.pid };
}
```

### Tray (app/tray.js)
The application remains active in the tray even when the main window is closed.
Tray menu:
- "Open ScientificKB"
- "Databases" → sub-menu of active KBs
- "Status" → CPU/RAM/Neo4j status
- "Quit" (stops all Neo4j services cleanly)

## Packaging (electron-builder)

### package.json config
```json
{
  "build": {
    "appId": "com.scientifickb.app",
    "productName": "Scientific KB",
    "directories": { "output": "dist" },
    "files": ["app/**", "backend/**", "frontend/build/**"],
    "extraResources": [
      { "from": "resources/neo4j", "to": "neo4j" },
      { "from": "resources/python", "to": "python" }
    ],
    "mac": {
      "target": [{ "target": "dmg", "arch": ["x64", "arm64"] }],
      "category": "public.app-category.productivity",
      "icon": "assets/icon.icns"
    },
    "win": {
      "target": [{ "target": "nsis", "arch": ["x64"] }],
      "icon": "assets/icon.ico"
    },
    "nsis": {
      "oneClick": false,
      "allowDirChange": true,
      "installerIcon": "assets/icon.ico"
    }
  }
}
```

## First launch — Setup Wizard
If `~/scientific-kb/` does not exist:
1. Display a "Welcome" screen in the UI
2. Download Neo4j binaries (if not bundled) with a progress bar
3. Test the Gemini API connection (prompt for the API key)
4. Create the first KB (optional, can be done later)
5. Display the main interface

## Auto-update
Use `electron-updater` with an update server (GitHub Releases).
```javascript
import { autoUpdater } from 'electron-updater';
autoUpdater.checkForUpdatesAndNotify();
```

## Environment variables (config.js)
All configuration is stored in `~/scientific-kb/settings.json` (no .env).
```json
{
  "geminiApiKey": "AIza...",
  "dataDir": "~/scientific-kb",
  "backendPort": 3000,
  "logLevel": "info",
  "autoStartNeo4j": true,
  "theme": "light"
}
```

## Platform-specific paths
```javascript
const { app } = require('electron');

const DATA_DIR = path.join(app.getPath('home'), 'scientific-kb');
const NEO4J_BIN = process.platform === 'win32'
  ? path.join(process.resourcesPath, 'neo4j', 'bin', 'neo4j.bat')
  : path.join(process.resourcesPath, 'neo4j', 'bin', 'neo4j');
const PYTHON_BIN = process.platform === 'win32'
  ? path.join(process.resourcesPath, 'python', 'python.exe')
  : path.join(process.resourcesPath, 'python', 'python3');
```
