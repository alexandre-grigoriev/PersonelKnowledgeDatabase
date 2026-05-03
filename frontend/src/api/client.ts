import type { Kb, KbStats, ArchivedDoc, IngestJob, QueryResult } from '../types'

const BASE = '/api'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

// ── Knowledge Bases ───────────────────────────────────────────────────────────

export const listKbs = () => req<Kb[]>('/kb')

export const createKb = (name: string, description = '', color = '#3B8BD4') =>
  req<Kb>('/kb', {
    method: 'POST',
    body: JSON.stringify({ name, description, color }),
  })

export const deleteKb = (id: string) =>
  req<{ deleted: boolean }>(`/kb/${id}`, {
    method: 'DELETE',
    body: JSON.stringify({ confirm: true }),
  })

export const getKbStats = (id: string) => req<KbStats>(`/kb/${id}/stats`)

// ── Archive ───────────────────────────────────────────────────────────────────

export const listArchive = (kbId: string) =>
  req<ArchivedDoc[]>(`/kb/${kbId}/archive`)

export const deleteDocument = (kbId: string, sha256: string) =>
  req<{ deleted: boolean; chunksRemoved: number }>(`/kb/${kbId}/archive/${sha256}`, {
    method: 'DELETE',
    body: JSON.stringify({ confirm: true }),
  })

// ── Ingestion ─────────────────────────────────────────────────────────────────

export async function ingestPdf(
  kbId: string,
  file: File,
  meta: {
    title?:      string
    authors?:    string[]
    doi?:        string
    year?:       number
    sourceType?: string
    astmCode?:   string
    journal?:    string
    abstract?:   string
  },
): Promise<IngestJob> {
  const form = new FormData()
  form.append('pdf', file)
  form.append('kbId', kbId)
  form.append('meta', JSON.stringify(meta))
  form.append('source', 'upload')

  const res = await fetch(`${BASE}/ingest`, { method: 'POST', body: form })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
  }
  return res.json()
}

export async function ingestText(
  kbId: string,
  text: string,
  meta: { title?: string; doi?: string; year?: number; pageUrl?: string; abstract?: string },
): Promise<IngestJob> {
  return req<IngestJob>('/ingest/text', {
    method: 'POST',
    body: JSON.stringify({ kbId, text, meta, source: 'upload' }),
  })
}

export const getJobStatus = (jobId: string, kbId: string) =>
  req<IngestJob>(`/ingest/jobs/${jobId}?kbId=${kbId}`)

// ── Query ─────────────────────────────────────────────────────────────────────

export const queryKb = (
  kbId: string,
  question: string,
  options?: { topK?: number; minScore?: number; useGraphExpansion?: boolean },
) =>
  req<QueryResult>('/query', {
    method: 'POST',
    body: JSON.stringify({ kbId, question, options }),
  })
