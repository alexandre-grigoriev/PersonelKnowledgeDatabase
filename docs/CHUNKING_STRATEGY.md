# Chunking Strategy — Heuristic PDF Segmentation (CHUNKING_STRATEGY.md)

## General approach
Chunking is done in two passes:
1. **Heuristic pass** (deterministic rules on the PDF structure)
2. **LLM pass** (semantic enrichment of each chunk)

The heuristic pass never makes any network calls. It is fast and reproducible.

## Document type detection

### Scientific publication
Indicators: presence of an abstract, sections "Introduction / Methods / Results / Discussion",
reference list at the end of the document, DOI in header/footer.

### ASTM standard
Indicators: header "ASTM [Code]/[Code]M-[Year]", numbered sections (1. Scope, 2. Referenced
Documents, 3. Terminology...), specification tables, mandatory annexes.

```javascript
/**
 * Detects the document type from the raw text of the first pages.
 * @param {string} firstPagesText - Text of the first 3 pages
 * @returns {'publication' | 'astm_standard' | 'unknown'}
 */
function detectDocumentType(firstPagesText) { ... }
```

## Layout extraction (pdfParser.js)

Uses `pdfplumber` (via Python subprocess) to extract:
- Text blocks with coordinates (x, y, width, height)
- Font size and weight (for title detection)
- Tables (cells with positions)
- Annotations and links

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

## Chunking rules for scientific publications

### Section (heading) detection
A block is a heading if: fontSize >= 1.2 * bodyFontSize AND (isBold OR allCaps for
level 2+ sub-headings).

Recognised hierarchy:
- H1: Abstract, Introduction, Methods, Results, Discussion, Conclusion, References
- H2: numbered sub-sections (e.g. "2.1 Sample Preparation")
- H3: sub-sub-sections

### Splitting rules
| Chunk type      | Creation rule                                             | Target size     |
|-----------------|-----------------------------------------------------------|-----------------|
| abstract        | The entire Abstract block                                 | 150-400 tokens  |
| section         | A complete H1 section, split if > 800 tokens             | 300-800 tokens  |
| subsection      | An H2 section when the parent section exceeds 800 tokens | 200-600 tokens  |
| table           | A complete table with its caption                        | 100-500 tokens  |
| figure_caption  | A figure legend (text only)                              | 50-200 tokens   |
| reference_list  | References grouped in sets of 5-10                       | 200-400 tokens  |

### Overlap rule
Each chunk (except abstract and references) includes the first 2 sentences of the previous
chunk as a sliding-window context prefix.

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
 * @property {string} section    - parent section title
 * @property {number} pageStart
 * @property {number} pageEnd
 * @property {number} tokenCount
 */
```

## Chunking rules for ASTM standards

### Fixed ASTM structure
ASTM standards follow a normalised structure. Sections are:
1. Scope — 2. Referenced Documents — 3. Terminology — 4. Significance and Use
5+. Technical sections — Annexes A, B, C...

Each numbered section becomes one chunk. Specification tables (mechanical values,
compositions) are separate chunks carrying their parent section as context.

### Normative value extraction
For ASTM tables, extract values in structured format:
```
[Table] Mechanical requirements for Grade X
Property | Min | Max | Unit
Tensile Strength | 415 | - | MPa
Yield Strength | 205 | - | MPa
Elongation | 20 | - | %
```

## LLM pass — enrichment (llmEnricher.js)

After heuristic chunking, each chunk is sent to Gemini for enrichment.

### Enrichment prompt (text chunk)
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

### Enrichment prompt (table chunk)
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

## Token counting
Use approximate counting: 1 token ≈ 4 characters.
The maximum budget per chunk before splitting is 800 tokens.
