# Transfert et Migration de Knowledge Base (KB_TRANSFER.md)

## Principe fondamental
L'archive PDF est la source de vérité. Neo4j est un index reconstituable.
Il existe donc deux stratégies de transfert selon le contexte :

| Stratégie | Taille exportée | Temps de restauration | Cas d'usage |
|---|---|---|---|
| **Export complet** (archive + Neo4j dump) | Grande | Immédiat | Disque externe, réseau local rapide |
| **Export léger** (archive PDF uniquement) | Petite | Rebuild requis | Envoi par internet, partage cloud |

---

## Stratégie A — Export complet (recommandé si disque disponible)

Exporte l'archive PDF + le dump Neo4j + la config. Restauration immédiate sans rebuild.

### Séquence d'export
```
1. Pause de l'ingestion en cours (attendre fin des jobs actifs)
2. Arrêt de l'instance Neo4j de la KB
3. neo4j-admin database dump → kb-export/{kb-name}/neo4j.dump
4. Copie de pdfs/ + index.json → kb-export/{kb-name}/pdfs/
5. Copie de kb.json et metadata.db
6. Compression → {kb-name}_full_{date}.scientifickb
7. Redémarrage Neo4j
```

### Séquence d'import
```
1. Décompression de l'archive .scientifickb
2. Vérification checksum (sha256 du fichier)
3. Création du répertoire KB (nouveau UUID si collision)
4. Copie pdfs/ + index.json + metadata.db + kb.json
5. neo4j-admin database load → répertoire neo4j/ de la KB
6. Démarrage Neo4j + vérification intégrité (count nodes)
7. Affichage dans l'UI
```

---

## Stratégie B — Export léger (archive PDF uniquement)

N'exporte que les PDF sources. Nécessite un rebuild sur la machine cible
(ré-ingestion complète via le pipeline RAG).

### Séquence d'export
```
1. Copie de pdfs/ + index.json → {kb-name}_light_{date}.scientifickb
2. Copie de kb.json (nom, description, couleur)
3. Compression
```

### Séquence d'import
```
1. Décompression
2. Création de la KB (nouveau UUID)
3. Copie pdfs/ + index.json + kb.json
4. Déclenchement du rebuild automatique (POST /api/kb/:id/rebuild)
5. Progression affichée dans l'UI (SSE)
```

---

## Format du fichier .scientifickb

Extension propriétaire = archive ZIP renommée.

```
{kb-name}_full_2025-01-20.scientifickb
└── [ZIP]
    ├── manifest.json          ← métadonnées du transfert
    ├── kb.json                ← config KB (nom, couleur, description)
    ├── metadata.db            ← SQLite (présent uniquement en mode full)
    ├── pdfs/
    │   ├── index.json
    │   ├── abc123def.pdf
    │   └── ...
    └── neo4j.dump             ← dump Neo4j (présent uniquement en mode full)
```

### manifest.json
```json
{
  "formatVersion": 1,
  "exportType": "full",          // "full" | "light"
  "exportedAt": "2025-01-20T14:30:00Z",
  "appVersion": "1.2.0",
  "kbName": "Matériaux ASTM",
  "kbId": "a3f2bc91",            // ID original (sera remappé à l'import)
  "docCount": 147,
  "chunkCount": 3821,
  "archiveSizeBytes": 524288000,
  "checksum": "sha256:abcdef...", // checksum du zip avant renommage
  "neo4jVersion": "5.15.0",      // pour compatibilité dump/load
  "embeddingModel": "gemini-embedding-001",
  "embeddingDimensions": 3072
}
```

---

## Avertissements à l'utilisateur

### Avant export
```
⚠️ Export en cours — ne pas éteindre l'application
Taille estimée : 2.1 GB (mode complet) / 510 MB (mode léger)
Durée estimée : ~3 min (SSD) / ~12 min (HDD)
```

### Avant import mode léger
```
⚠️ Rebuild nécessaire
Cette knowledge base devra être reconstruite sur cet ordinateur.
Durée estimée : ~45 min pour 147 documents
La base sera consultable une fois le rebuild terminé.
[Importer et reconstruire]   [Annuler]
```

### Incompatibilité de version Neo4j
```
⚠️ Version Neo4j incompatible
Export créé avec Neo4j 5.12, version installée : 5.15
Seul l'export léger (rebuild) est possible dans ce cas.
```

### Incompatibilité de modèle d'embedding
```
⚠️ Modèle d'embedding différent
L'export utilise "gemini-embedding-001" (3072 dim).
Votre installation utilise un modèle différent.
Un rebuild complet est nécessaire pour recalculer les embeddings.
```

---

## Routes API (routes/transfer.js)

```
POST /api/kb/:kbId/export
  Body: { "mode": "full" | "light" }
  Response SSE:
    { "step": "stopping_neo4j", "progress": 0 }
    { "step": "dumping", "progress": 30 }
    { "step": "compressing", "progress": 70 }
    { "step": "done", "progress": 100, "filePath": "/tmp/export.scientifickb", "sizeBytes": 2100000000 }

POST /api/kb/import
  Content-Type: multipart/form-data
  Fields: file (.scientifickb), targetName? (renommer à l'import)
  Response: { "jobId": "...", "kbId": "nouveau-uuid", "requiresRebuild": false }

GET /api/kb/import/jobs/:jobId
  Response SSE (même format que rebuild/status)
```

---

## UI — Flux utilisateur

### Export
```
[Menu KB] → "Exporter cette base"
  → Choix : ● Complet (Neo4j inclus)  ○ Léger (PDF uniquement)
  → Choix du dossier de destination
  → Barre de progression
  → "✓ Export terminé — {kb-name}_full_2025-01-20.scientifickb (2.1 GB)"
  → Bouton "Ouvrir dans le Finder / Explorateur"
```

### Import
```
[Menu principal] → "Importer une base"
  → Sélecteur de fichier (.scientifickb)
  → Lecture du manifest.json → affichage des infos :
      Nom : Matériaux ASTM
      Documents : 147  |  Taille archive : 510 MB
      Type : Léger → rebuild requis (~45 min)
  → Champ optionnel "Renommer la base"
  → [Importer]
  → Barre de progression (import + rebuild si nécessaire)
  → "✓ Base importée et disponible"
```

---

## Méthodes de transfert recommandées

| Situation | Méthode recommandée |
|---|---|
| Même réseau local | Export complet → dossier partagé réseau |
| Clé USB / disque externe | Export complet vers le disque |
| Envoi par internet (base < 2 GB) | Export léger → WeTransfer / Google Drive |
| Envoi par internet (base > 2 GB) | Export léger → rsync ou partage en plusieurs parties |
| Backup régulier automatique | Script cron → export léger vers cloud (Dropbox, iCloud) |

### Script de backup automatique (exemple)
```bash
#!/bin/bash
# backup_kb.sh — à placer dans crontab (ex: chaque dimanche à 2h)
# 0 2 * * 0 /path/to/backup_kb.sh

KB_ID="a3f2bc91"
DEST="$HOME/Dropbox/scientific-kb-backups"
DATE=$(date +%Y-%m-%d)

curl -s -X POST "http://localhost:3000/api/kb/$KB_ID/export" \
  -H "Content-Type: application/json" \
  -d '{"mode": "light", "outputDir": "'"$DEST"'"}' \
  --no-buffer | grep -E '"step"|"progress"'

echo "Backup terminé : $DEST/${KB_ID}_light_${DATE}.scientifickb"
```

---

## Partage partiel — Exporter un sous-ensemble de documents

Permet d'exporter uniquement certains documents d'une KB (ex: partager
les documents ASTM E8 uniquement avec un collègue).

```
POST /api/kb/:kbId/export/subset
  Body: {
    "mode": "light",
    "filter": {
      "sourceType": "astm_standard",  // ou "publication"
      "astmCodePrefix": "ASTM E",     // filtre par code
      "yearFrom": 2020,
      "docIds": ["sha256_1", "sha256_2"]  // liste explicite
    }
  }
```

L'export subset est toujours en mode léger (rebuild requis), car
extraire un sous-graphe Neo4j cohérent est complexe.
