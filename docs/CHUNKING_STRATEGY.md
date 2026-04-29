# Chunking Strategy — Segmentation Heuristique PDF (CHUNKING_STRATEGY.md)

## Principe général
Le chunking est en deux passes :
1. **Passe heuristique** (règles déterministes sur la structure du PDF)
2. **Passe LLM** (enrichissement sémantique de chaque chunk)

La passe heuristique ne fait jamais d'appel réseau. Elle est rapide et reproductible.

## Détection du type de document

### Publication scientifique
Indices : présence d'abstract, sections "Introduction / Methods / Results / Discussion",
liste de références en fin de document, DOI en header/footer.

### Standard ASTM
Indices : en-tête "ASTM [Code]/[Code]M-[Year]", sections numérotées (1. Scope, 2. Referenced
Documents, 3. Terminology...), tableaux de spécifications, annexes obligatoires.

```javascript
/**
 * Détecte le type de document à partir du texte brut des premières pages.
 * @param {string} firstPagesText - Texte des 3 premières pages
 * @returns {'publication' | 'astm_standard' | 'unknown'}
 */
function detectDocumentType(firstPagesText) { ... }
```

## Extraction layout (pdfParser.js)

Utilise `pdfplumber` (via subprocess Python) pour extraire :
- Blocs de texte avec coordonnées (x, y, width, height)
- Taille et graisse de la police (détection de titres)
- Tableaux (cellules avec positions)
- Annotations et liens

```javascript
/**
 * @typedef {Object} TextBlock
 * @property {string} text
 * @property {number} x0
 * @property {number} y0
 * @property {number} fontSize
 * @property {boolean} isBold
 * @property {number} pageNum
 */

/**
 * @param {string} pdfPath
 * @returns {Promise<{blocks: TextBlock[], tables: Table[], pageCount: number}>}
 */
async function extractLayout(pdfPath) { ... }
```

## Règles de chunking pour publications scientifiques

### Détection des sections (titres)
Un bloc est un titre si : fontSize >= 1.2 * bodyFontSize ET (isBold OR allCaps pour 
les sous-titres de niveau 2+).

Hiérarchie reconnue :
- H1 : Abstract, Introduction, Methods, Results, Discussion, Conclusion, References
- H2 : sous-sections numérotées (ex: "2.1 Sample Preparation")
- H3 : sous-sous-sections

### Règles de découpage
| Type de chunk     | Règle de création                                         | Taille cible    |
|-------------------|-----------------------------------------------------------|-----------------|
| abstract          | Tout le bloc Abstract                                     | 150-400 tokens  |
| section           | Une section H1 complète, découpée si > 800 tokens         | 300-800 tokens  |
| subsection        | Une section H2 si la section parente > 800 tokens         | 200-600 tokens  |
| table             | Un tableau complet avec son titre (caption)               | 100-500 tokens  |
| figure_caption    | La légende d'une figure (texte uniquement)                | 50-200 tokens   |
| reference_list    | Les références, groupées par 5-10                         | 200-400 tokens  |

### Règle de chevauchement (overlap)
Chaque chunk (sauf abstract et références) inclut les 2 premières phrases du chunk
précédent comme contexte de fenêtre glissante.

```javascript
/**
 * @param {TextBlock[]} blocks
 * @param {'publication' | 'astm_standard'} docType
 * @returns {RawChunk[]}
 */
function chunkDocument(blocks, docType) { ... }

/**
 * @typedef {Object} RawChunk
 * @property {number} index
 * @property {string} text
 * @property {string} chunkType  - 'abstract'|'section'|'subsection'|'table'|'figure_caption'|'reference_list'
 * @property {string} section    - titre de la section parente
 * @property {number} pageStart
 * @property {number} pageEnd
 * @property {number} tokenCount
 */
```

## Règles de chunking pour standards ASTM

### Structure fixe ASTM
Les standards ASTM ont une structure normalisée. Les sections sont :
1. Scope — 2. Referenced Documents — 3. Terminology — 4. Significance and Use
5+. Sections techniques — Annexes A, B, C...

Chaque section numérotée devient un chunk. Les tableaux de spécifications (valeurs
mécaniques, compositions) sont des chunks séparés avec le contexte de la section.

### Extraction des valeurs normatives
Pour les tableaux ASTM, extraire les valeurs en format structuré :
```
[Table] Mechanical requirements for Grade X
Property | Min | Max | Unit
Tensile Strength | 415 | - | MPa
Yield Strength | 205 | - | MPa
Elongation | 20 | - | %
```

## Passe LLM — enrichissement (llmEnricher.js)

Après le chunking heuristique, chaque chunk passe par Gemini pour :

### Prompt d'enrichissement (chunk de texte)
```
You are a scientific knowledge extraction expert.
Given this chunk from a [publication|ASTM standard], extract:
1. A 2-sentence summary in English
2. Key entities: materials, compounds, methods, standards referenced (as JSON array)
3. Key claims or specifications (as JSON array of strings)
4. Relations to other concepts (as JSON array of {from, relation, to})
5. Keywords (5-10 terms)

Chunk type: {chunkType}
Parent section: {section}
Document title: {docTitle}

CHUNK:
{chunkText}

Respond ONLY with valid JSON:
{
  "summary": "...",
  "entities": [{"name": "...", "type": "material|method|standard|compound|property"}],
  "claims": ["..."],
  "relations": [{"from": "...", "relation": "...", "to": "..."}],
  "keywords": ["..."]
}
```

### Prompt d'enrichissement (chunk tableau)
```
You are analyzing a table from a [publication|ASTM standard].
Extract the structured data and explain what it specifies.

Table content:
{tableText}

Respond ONLY with valid JSON:
{
  "summary": "...",
  "tableType": "mechanical_properties|chemical_composition|test_conditions|other",
  "properties": [{"name": "...", "value": "...", "unit": "...", "condition": "..."}],
  "applicableMaterials": ["..."],
  "keywords": ["..."]
}
```

## Comptage de tokens
Utiliser `@anthropic-ai/tokenizer` ou compter approximativement : 1 token ≈ 4 caractères.
Le budget max par chunk avant découpage est 800 tokens.
