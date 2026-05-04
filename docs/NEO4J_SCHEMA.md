# Neo4j Schema — Knowledge Graph (NEO4J_SCHEMA.md)

## Nodes

### Document
```cypher
(:Document {
  id: String,          // SHA256 of the source file
  kbId: String,        // knowledge base ID
  title: String,
  authors: [String],
  doi: String,
  year: Integer,
  sourceType: String,  // 'publication' | 'astm_standard'
  astmCode: String,    // e.g. "ASTM E8/E8M-22" (null for publications)
  journal: String,
  abstract: String,
  keywords: [String],
  pdfPath: String,
  ingestedAt: String
})
```

### Section
```cypher
(:Section {
  id: String,          // docId + '_' + slugified sectionTitle
  docId: String,
  kbId: String,
  title: String,
  level: Integer,      // 1=H1, 2=H2, 3=H3
  pageStart: Integer,
  pageEnd: Integer
})
```

### Chunk
```cypher
(:Chunk {
  id: String,          // UUID v4
  docId: String,
  kbId: String,
  sectionId: String,
  chunkIndex: Integer,
  chunkType: String,   // 'abstract'|'section'|'subsection'|'table'|'figure_caption'|'reference_list'
  text: String,        // raw text
  summary: String,     // LLM-generated
  keywords: [String],
  pageStart: Integer,
  pageEnd: Integer,
  tokenCount: Integer,
  embedding: [Float]   // 3072-dim vector (stored in the vector index)
})
```

### Entity
```cypher
(:Entity {
  id: String,          // normalised slug
  name: String,
  type: String,        // 'material'|'method'|'standard'|'compound'|'property'
  kbId: String
})
```

### Claim
```cypher
(:Claim {
  id: String,
  text: String,
  kbId: String,
  docId: String
})
```

## Relationships

```cypher
// Document structure
(:Document)-[:HAS_SECTION]->(:Section)
(:Section)-[:HAS_CHUNK]->(:Chunk)
(:Section)-[:HAS_SUBSECTION]->(:Section)
(:Document)-[:HAS_CHUNK]->(:Chunk)       // direct shortcut

// Chunk sequence
(:Chunk)-[:NEXT_CHUNK]->(:Chunk)

// Entities and claims
(:Chunk)-[:MENTIONS {frequency: Integer}]->(:Entity)
(:Chunk)-[:SUPPORTS]->(:Claim)
(:Claim)-[:ABOUT]->(:Entity)

// Semantic relations between entities (extracted by LLM)
(:Entity)-[:RELATES_TO {relation: String, docId: String}]->(:Entity)
// example relations: 'tested_with', 'specified_by', 'composed_of', 'improves', 'conflicts_with'

// Cross-document citations
(:Document)-[:CITES]->(:Document)

// Referenced standards
(:Document)-[:REFERENCES_STANDARD {astmCode: String}]->(:Document)
```

## Index DDL (scripts/initNeo4j.js)

```cypher
// Uniqueness constraints
CREATE CONSTRAINT doc_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE;
CREATE CONSTRAINT chunk_id IF NOT EXISTS FOR (c:Chunk) REQUIRE c.id IS UNIQUE;
CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (e:Entity) REQUIRE e.id IS UNIQUE;
CREATE CONSTRAINT section_id IF NOT EXISTS FOR (s:Section) REQUIRE s.id IS UNIQUE;

// KB filtering indexes
CREATE INDEX doc_kb IF NOT EXISTS FOR (d:Document) ON (d.kbId);
CREATE INDEX chunk_kb IF NOT EXISTS FOR (c:Chunk) ON (c.kbId);
CREATE INDEX entity_kb IF NOT EXISTS FOR (e:Entity) ON (e.kbId);

// Fulltext search indexes
CREATE FULLTEXT INDEX chunk_fulltext IF NOT EXISTS
  FOR (c:Chunk) ON EACH [c.text, c.summary, c.keywords];

CREATE FULLTEXT INDEX doc_fulltext IF NOT EXISTS
  FOR (d:Document) ON EACH [d.title, d.abstract, d.keywords];

// Vector similarity index
CREATE VECTOR INDEX chunk_vector IF NOT EXISTS
  FOR (c:Chunk) ON (c.embedding)
  OPTIONS {
    indexConfig: {
      `vector.dimensions`: 3072,
      `vector.similarity_function`: 'cosine'
    }
  };
```

## Cypher patterns — Ingestion (MERGE only)

### Create / update a Document
```cypher
MERGE (d:Document {id: $id})
SET d.kbId = $kbId,
    d.title = $title,
    d.authors = $authors,
    d.doi = $doi,
    d.year = $year,
    d.sourceType = $sourceType,
    d.astmCode = $astmCode,
    d.keywords = $keywords,
    d.ingestedAt = datetime()
RETURN d
```

### Create a Chunk with embedding
```cypher
MERGE (c:Chunk {id: $id})
SET c.kbId = $kbId,
    c.docId = $docId,
    c.text = $text,
    c.summary = $summary,
    c.chunkType = $chunkType,
    c.embedding = $embedding,
    c.tokenCount = $tokenCount
WITH c
MATCH (d:Document {id: $docId})
MERGE (d)-[:HAS_CHUNK]->(c)
```

### Create an Entity and link it
```cypher
MERGE (e:Entity {id: $entityId, kbId: $kbId})
ON CREATE SET e.name = $name, e.type = $type
WITH e
MATCH (c:Chunk {id: $chunkId})
MERGE (c)-[r:MENTIONS]->(e)
ON CREATE SET r.frequency = 1
ON MATCH SET r.frequency = r.frequency + 1
```

## Cypher patterns — Query (hybridRetriever.js)

### Vector search (cosine similarity)
```cypher
CALL db.index.vector.queryNodes('chunk_vector', $topK, $queryEmbedding)
YIELD node AS chunk, score
WHERE chunk.kbId = $kbId AND score > $minScore
MATCH (d:Document)-[:HAS_CHUNK]->(chunk)
RETURN chunk, d.title AS docTitle, d.doi AS doi,
       d.pdfPath AS pdfPath, score
ORDER BY score DESC
```

### Graph expansion (neighbours of a chunk)
```cypher
MATCH (seed:Chunk {id: $seedChunkId})
MATCH (seed)-[:MENTIONS]->(e:Entity)<-[:MENTIONS]-(related:Chunk)
WHERE related.kbId = $kbId AND related.id <> $seedChunkId
MATCH (d:Document)-[:HAS_CHUNK]->(related)
RETURN related, d.title AS docTitle, count(e) AS sharedEntities
ORDER BY sharedEntities DESC
LIMIT 10
```

### Named entity lookup
```cypher
MATCH (e:Entity {kbId: $kbId})
WHERE e.name =~ ('(?i).*' + $entityName + '.*')
MATCH (c:Chunk)-[:MENTIONS]->(e)
MATCH (d:Document)-[:HAS_CHUNK]->(c)
RETURN c, d.title, e.name, e.type
ORDER BY c.chunkType
```

### Fulltext search
```cypher
CALL db.index.fulltext.queryNodes('chunk_fulltext', $query)
YIELD node AS chunk, score
WHERE chunk.kbId = $kbId
MATCH (d:Document)-[:HAS_CHUNK]->(chunk)
RETURN chunk, d.title, score
ORDER BY score DESC
LIMIT $topK
```
