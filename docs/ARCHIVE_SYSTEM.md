# Archive System — Source of Truth PDF (ARCHIVE_SYSTEM.md)

## Principe
Chaque PDF ingéré est d'abord copié dans l'archive avant toute ingestion.
L'archive est la source de vérité. La knowledge base Neo4j peut être reconstruite
entièrement depuis l'archive à tout moment.

## Structure de l'archive
```
~/scientific-kb/{kb-id}/pdfs/
├── index.json               ← registre de tous les PDFs
├── {sha256-1}.pdf
├── {sha256-2}.pdf
└── ...
```

## index.json (schéma)
```json
{
  "version": 1,
  "documents": {
    "{sha256}": {
      "sha256": "abc123...",
      "filename": "Smith2023_tensile_testing.pdf",
      "title": "Tensile Testing of Aluminum Alloys",
      "doi": "10.1016/j.msea.2023.145123",
      "authors": ["Smith J.", "Doe A."],
      "year": 2023,
      "source_type": "publication",
      "astm_code": null,
      "added_at": "2025-01-15T10:30:00Z",
      "file_size_bytes": 2458621,
      "page_count": 12
    }
  }
}
```

## archiveManager.js — API

```javascript
/**
 * Archive un PDF et retourne son SHA256.
 * Copie le fichier, met à jour index.json, refuse les doublons.
 * @param {string} kbId
 * @param {string} sourcePath - chemin temporaire du PDF uploadé
 * @param {Object} meta - { title, doi, authors, year, sourceType, astmCode }
 * @returns {Promise<{sha256: string, pdfPath: string, isDuplicate: boolean}>}
 */
async function archivePdf(kbId, sourcePath, meta) { ... }

/**
 * Liste tous les PDFs archivés pour une KB.
 * @param {string} kbId
 * @returns {Promise<ArchivedDoc[]>}
 */
async function listArchive(kbId) { ... }

/**
 * Génère un preview d'un PDF archivé (texte des 2 premières pages + métadonnées).
 * Utilisé pour l'UI preview avant ingestion ou mise à jour.
 * @param {string} kbId
 * @param {string} sha256
 * @returns {Promise<{title, authors, abstract, pageCount, previewText}>}
 */
async function generatePreview(kbId, sha256) { ... }

/**
 * Supprime un document de l'archive ET de Neo4j.
 * @param {string} kbId
 * @param {string} sha256
 * @returns {Promise<void>}
 */
async function deleteDocument(kbId, sha256) { ... }
```

## Rebuild (scripts/rebuildKb.js)

Le rebuild ré-ingère tous les PDFs archivés dans une KB vierge.
Utile en cas de corruption Neo4j, migration, ou changement de stratégie de chunking.

### Séquence de rebuild
```
1. Vérifier que la KB existe (kb.json présent)
2. Arrêter l'instance Neo4j de la KB
3. Supprimer ~/scientific-kb/{kb-id}/neo4j/data/
4. Redémarrer Neo4j (base vierge)
5. Exécuter initNeo4j.js (créer indexes + contraintes)
6. Lire index.json → liste des PDFs archivés
7. Pour chaque PDF (séquentiellement) :
   a. Lire le PDF depuis l'archive
   b. Exécuter le pipeline complet : parse → chunk → enrich → embed → write
   c. Mettre à jour le statut dans SQLite
8. Reporter la progression en temps réel via SSE (GET /api/kb/:id/rebuild/status)
```

### Route API (routes/archive.js)

```
POST /api/kb/:kbId/rebuild
  Body: { "confirm": true }
  Response: { "jobId": "...", "totalDocs": 147 }

GET /api/kb/:kbId/rebuild/status
  Response SSE stream: { "progress": 42, "current": "Smith2023...", "errors": [] }

GET /api/kb/:kbId/archive
  Response: [ { sha256, title, authors, year, ... } ]

GET /api/kb/:kbId/archive/:sha256/preview
  Response: { title, authors, abstract, pageCount, previewText }

DELETE /api/kb/:kbId/archive/:sha256
  Supprime du filesystem + Neo4j
  Body: { "confirm": true }
```

## Preview avant mise à jour
Quand un document est déjà ingéré et qu'on veut le ré-ingérer (nouvelle version),
le flow est :
1. Upload du nouveau PDF
2. `generatePreview()` → afficher le preview dans l'UI
3. Si l'utilisateur confirme : `deleteDocument()` ancienne version + `archivePdf()` + pipeline complet
4. Les chunks de l'ancienne version sont supprimés de Neo4j avant l'écriture de la nouvelle

### Suppression des chunks en Neo4j avant ré-ingestion
```cypher
MATCH (d:Document {id: $sha256, kbId: $kbId})
OPTIONAL MATCH (d)-[:HAS_CHUNK]->(c:Chunk)
OPTIONAL MATCH (d)-[:HAS_SECTION]->(s:Section)
DETACH DELETE c, s, d
```
