export interface Kb {
  id: string
  name: string
  description: string
  color: string
  docCount: number
  chunkCount: number
  createdAt: string
  status: 'ready' | 'indexing' | 'rebuilding'
}

export interface KbStats {
  id: string
  name: string
  docCount: number
  chunkCount: number
  entityCount: number
  archiveSizeBytes: number
  neo4jSizeBytes: number
  lastIngestedAt: string | null
}

export interface ArchivedDoc {
  sha256: string
  title: string
  authors: string[]
  doi: string | null
  year: number | null
  sourceType: string
  abstract: string | null
  addedAt: string
  fileSizeBytes: number
  pageCount: number | null
  status: string
}

export interface IngestJob {
  jobId: string
  docId: string
  status: 'queued' | 'running' | 'done' | 'failed'
  step: string | null
  progress: number
  chunksDone: number
  error: string | null
}

export interface QuerySource {
  docId: string
  title: string
  doi: string | null
  year: number | null
  chunkId: string
  section: string
  relevanceScore: number
}

export interface QueryResult {
  answer: string
  sources: QuerySource[]
  entities: string[]
  queryPlan: { subQueries: string[]; strategy: string }
}

export interface ChatMessage {
  id:         string
  role:       'user' | 'assistant'
  text:       string
  timestamp:  string
  sources?:   QuerySource[]
  subQueries?: string[]
}

export interface Settings {
  geminiModel:    string
  geminiEmbedModel: string
  geminiApiKey?:  string
}
