---

## Export / Import d’une Knowledge Base (partage)

Pour partager une base de connaissances créée avec d’autres utilisateurs ou ordinateurs, utilisez la procédure d’export/import :

### Export (sauvegarde ou partage)
1. **Fermez l’application** pour garantir l’intégrité des fichiers.
2. **Localisez le dossier de la KB** dans `data/[nom-de-la-KB]/`.
3. **Compressez** ce dossier (ZIP recommandé) pour faciliter le transfert.
4. **Transférez** l’archive (clé USB, cloud, email, etc.) au destinataire.

### Import (restauration ou ajout)
1. **Décompressez** l’archive reçue sur le nouvel ordinateur.
2. **Copiez** le dossier extrait dans le répertoire `data/` de l’application.
3. **Redémarrez l’application** : la KB importée sera détectée automatiquement.

### (À venir) Export/Import automatisé
- Des fonctions d’export/import intégrées à l’application pourront être ajoutées pour simplifier ces étapes (menu ou bouton « Exporter/Importer »).

**Remarques :**
- Toujours fermer l’application avant toute opération d’export/import.
- Pour partager plusieurs KB, répétez la procédure pour chaque dossier.
# INSTALLATION.md

This guide explains how to install and set up the application on both **Windows** and **Mac**. All dependencies (Node.js, Neo4j, app files, and Node.js packages) will be installed for a ready-to-use experience.

---

## Windows Installation (setup.exe)

### End Users
1. **Download** the provided `setup.exe` from the official release or build it yourself (see below).
2. **Run** `setup.exe` as Administrator.
3. The installer will automatically:
   - Check for Node.js and install it if missing
   - Install Neo4j Community Edition (or unpack embedded version)
   - Copy all application files
   - Run `npm install` to fetch dependencies
   - Optionally, initialize Neo4j database and create shortcuts
4. **Launch** the application from the desktop/start menu shortcut.

### Developers: Building the Installer
1. **Prepare dependencies:**
   - Download Node.js Windows installer (.msi)
   - Download Neo4j Community Edition (.zip or .exe)
   - Prepare your application files
2. **Write an NSIS or Inno Setup script** to automate:
   - Node.js installation (silent mode)
   - Neo4j installation/unpacking
   - Copying app files
   - Running `npm install`
   - Creating shortcuts
3. **Build** the installer using NSIS or Inno Setup.

---

## Mac Installation

### End Users
1. **Download** the provided `.pkg` installer, `.dmg` (for Electron apps), or shell script (if available).
2. **Run** the installer or script. It will:
   - Check for Node.js and install it if missing (or prompt you)
   - Install Neo4j Community Edition (or prompt you)
   - Copy all application files
   - Run `npm install` to fetch dependencies
   - Optionally, initialize Neo4j database and create shortcuts
3. **Launch** the application from Applications or via shortcut.

#### Manual Installation (if no installer provided)
1. **Install Node.js:**
   - `brew install node` (recommended)
   - Or download from [nodejs.org](https://nodejs.org/)
2. **Install Neo4j:**
   - `brew install neo4j` (recommended)
   - Or download from [neo4j.com](https://neo4j.com/download/)
3. **Clone or download the app:**
   - `git clone <repo-url>` or download and unzip
4. **Install dependencies:**
   - `cd <app-folder>`
   - `npm install`
5. **Start Neo4j** (if not embedded):
   - `neo4j start` (Homebrew) or run the Neo4j Desktop app
6. **Run the application:**
   - `npm start` or as described in the README

---

## Troubleshooting
- Ensure you have Administrator rights on Windows
- On Mac, you may need to allow the installer in Security & Privacy
- Neo4j may require Java (usually bundled)
- If `npm install` fails, check your internet connection and Node.js version

---

## See Also
- [AGENTS.md](AGENTS.md) — Agent instructions and conventions
- [CLAUDE.md](CLAUDE.md) — Project vision and stack
- [docs/INSTALLER.md](docs/INSTALLER.md) — Installer script details (if present)

---

## Transférer une Knowledge Base vers un autre ordinateur

Pour transférer une base de connaissances (Knowledge Base) complète d’un ordinateur à l’autre :

1. **Repérez le dossier de la KB**
   - Par défaut, chaque KB est stockée dans le dossier `data/[nom-de-la-KB]/` (PDFs, base SQLite, données Neo4j).

2. **Copiez le dossier**
   - Copiez tout le dossier `data/[nom-de-la-KB]/` sur un support externe (clé USB, disque dur, cloud, etc.).

3. **Collez sur le nouvel ordinateur**
   - Installez l’application et toutes les dépendances comme décrit ci-dessus.
   - Collez le dossier KB dans le répertoire `data/` de l’installation sur le nouvel ordinateur.

4. **Redémarrez l’application**
   - La KB transférée sera automatiquement détectée et utilisable.

**Remarques :**
- Assurez-vous que l’application n’est pas en cours d’exécution lors de la copie.
- Si la structure du dossier diffère, adaptez le chemin selon la configuration locale.
- Pour plusieurs KB, répétez l’opération pour chaque dossier `data/[nom-de-la-KB]/`.
