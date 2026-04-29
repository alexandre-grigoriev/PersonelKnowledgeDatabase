# Installateur Cross-Platform — Mac & Windows (INSTALLER.md)

## Approche : Electron + Services Bundlés

Electron encapsule l'UI React, le backend Express, et orchestre les services Neo4j
et Python. L'utilisateur installe un seul `.dmg` (Mac) ou `.exe` (Windows) et
n'a besoin d'aucun prérequis technique.

## Ce qui est bundlé dans l'installateur
- Node.js (via Electron)
- Backend Express (CommonJS)
- Frontend React (buildé statiquement, servi par Express)
- Neo4j Community 5.x (binaires téléchargés au premier lancement)
- Python 3.11 (portable, pour pdfplumber)
- Dépendances Python : pdfplumber, pdfminer.six

## Structure du package Electron
```
ScientificKB.app (Mac) / ScientificKB (Windows)
├── resources/
│   ├── app/                    ← code Node.js
│   │   ├── frontend/main.js    ← main process Electron
│   │   ├── backend/            ← Express backend
│   │   └── frontend/build/     ← React buildé
│   ├── neo4j/                  ← binaires Neo4j (téléchargés au setup)
│   │   ├── bin/neo4j
│   │   └── conf/neo4j.conf.template
│   └── python/                 ← Python portable
│       ├── python (Mac) / python.exe (Win)
│       └── lib/site-packages/pdfplumber/
└── ...
```

## frontend/main.js — Process principal Electron

### Séquence de démarrage
```javascript
app.on('ready', async () => {
  await ensureDataDirectory();      // créer ~/scientific-kb/ si absent
  await checkFirstRun();            // afficher wizard si première utilisation
  await startBackend();             // lancer Express sur port 3000
  await loadKnowledgeBases();       // démarrer Neo4j pour les KBs existantes
  createMainWindow();               // afficher l'UI
  createTrayIcon();                 // icône dans la barre système
});
```

### Gestion des services Neo4j
```javascript
/**
 * Démarre une instance Neo4j pour une KB donnée.
 * Assigne un port dynamique entre 7687 et 7787.
 * @param {string} kbId
 * @returns {Promise<{port: number, pid: number}>}
 */
async function startNeo4jForKb(kbId) {
  const port = await findFreePort(7687, 7787);
  const configPath = await writeNeo4jConfig(kbId, port);
  const neo4jBin = getNeo4jBinPath();  // platform-specific
  const proc = spawn(neo4jBin, ['console'], { cwd: configPath });
  // Attendre le log "Started." avant de résoudre
  return { port, pid: proc.pid };
}
```

### Tray (frontend/tray.js)
L'application reste active dans le tray même fenêtre fermée.
Menu tray :
- "Ouvrir ScientificKB"
- "Bases de données" → sous-menu KB actives
- "Statut" → CPU/RAM/Neo4j status
- "Quitter" (arrête tous les services Neo4j proprement)

## Packaging (electron-builder)

### package.json config
```json
{
  "build": {
    "appId": "com.scientifickb.app",
    "productName": "Scientific KB",
    "directories": { "output": "dist" },
    "files": ["frontend/**", "backend/**"],
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

## Premier lancement — Setup Wizard
Si `~/scientific-kb/` n'existe pas :
1. Afficher un écran "Bienvenue" dans l'UI
2. Télécharger les binaires Neo4j (si non bundlés) avec barre de progression
3. Tester la connexion Gemini API (demander la clé)
4. Créer la première KB (optionnel, peut être fait plus tard)
5. Afficher l'interface principale

## Mise à jour automatique
Utiliser `electron-updater` avec un serveur de mise à jour (GitHub Releases).
```javascript
import { autoUpdater } from 'electron-updater';
autoUpdater.checkForUpdatesAndNotify();
```

## Variables d'environnement (config.js)
Toutes les configs sont dans `~/scientific-kb/settings.json` (pas de .env).
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

## Chemins platform-specific
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
