import { useEffect, useRef, useState } from 'react'
import { ingestPdf, getJobStatus } from '../api/client'
import type { IngestJob } from '../types'

interface Props { kbId: string; onDone?: () => void }

export default function Ingest({ kbId, onDone }: Props) {
  const [file, setFile]       = useState<File | null>(null)
  const [title, setTitle]     = useState('')
  const [authors, setAuthors] = useState('')
  const [doi, setDoi]         = useState('')
  const [year, setYear]       = useState('')
  const [dragging, setDragging] = useState(false)
  const [job, setJob]         = useState<IngestJob | null>(null)
  const [error, setError]     = useState('')
  const [submitting, setSubmitting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const pickFile = (f: File) => {
    if (f.type !== 'application/pdf') return
    setFile(f)
    setTitle(f.name.replace(/\.pdf$/i, ''))
    setJob(null); setError('')
  }

  const startPoll = (jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const s = await getJobStatus(jobId, kbId)
        setJob(s)
        if (s.status === 'done' || s.status === 'failed') {
          clearInterval(pollRef.current!)
          if (s.status === 'done') onDone?.()
        }
      } catch { /* retry next tick */ }
    }, 2000)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return
    setSubmitting(true); setError(''); setJob(null)
    try {
      const r = await ingestPdf(kbId, file, {
        title: title || file.name,
        authors: authors ? authors.split(',').map(a => a.trim()).filter(Boolean) : [],
        doi:    doi  || undefined,
        year:   year ? parseInt(year) : undefined,
      })
      setJob(r)
      if (r.jobId) startPoll(r.jobId)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const pct = job?.progress ?? 0
  const statusBadgeClass =
    job?.status === 'done'   ? 'badgeDone' :
    job?.status === 'failed' ? 'badgeError' :
    job?.status === 'running' ? 'badgeProcessing' : 'badgePending'

  return (
    <div className="flexCol gap20" style={{ maxWidth: 560 }}>
      <form onSubmit={submit} className="flexCol gap16">
        {/* Drop zone */}
        <div
          className={`dropZone ${dragging ? 'dropZoneActive' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) pickFile(f) }}
          onClick={() => document.getElementById('pdf-input')?.click()}
        >
          {file ? (
            <p style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14 }}>
              📄 {file.name}
              <span className="textMuted fontMedium" style={{ marginLeft: 8, fontWeight: 400 }}>
                ({(file.size / 1024 / 1024).toFixed(2)} MB)
              </span>
            </p>
          ) : (
            <>
              <p className="dropZoneText">Drop a PDF here or click to browse</p>
              <p className="dropZoneHint">Maximum 100 MB</p>
            </>
          )}
          <input id="pdf-input" type="file" accept="application/pdf" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f) }} />
        </div>

        {/* Metadata */}
        <div className="flexCol gap12">
          <div>
            <label className="fieldLabel">Title</label>
            <input className="authInput" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Paper title" />
          </div>
          <div>
            <label className="fieldLabel">Authors (comma-separated)</label>
            <input className="authInput" value={authors} onChange={e => setAuthors(e.target.value)}
              placeholder="Smith J., Doe A." />
          </div>
          <div className="flex gap12">
            <div style={{ flex: 1 }}>
              <label className="fieldLabel">Year</label>
              <input className="authInput" type="number" value={year} onChange={e => setYear(e.target.value)}
                placeholder="2024" min="1900" max="2100" />
            </div>
            <div style={{ flex: 2 }}>
              <label className="fieldLabel">DOI</label>
              <input className="authInput" value={doi} onChange={e => setDoi(e.target.value)}
                placeholder="10.1016/j.msea.2024.xxx" />
            </div>
          </div>
        </div>

        {error && <p style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>}

        <button type="submit" className="blueBtn w100" disabled={!file || submitting}
          style={{ justifyContent: 'center', padding: '11px 0' }}>
          {submitting ? 'Uploading…' : 'Start ingestion'}
        </button>
      </form>

      {/* Job status */}
      {job && (
        <div className="cardLite" style={{ padding: 20 }}>
          <div className="flex itemsCenter gap8 mb12">
            <span style={{ fontWeight: 600, fontSize: 15 }}>Ingestion job</span>
            <span className={`badge ${statusBadgeClass}`}>{job.status}</span>
            <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 13 }}>{pct}%</span>
          </div>
          <div className="progressTrack mb8">
            <div className="progressFill" style={{ width: `${pct}%` }} />
          </div>
          {job.step && <p className="textSm textMuted">Step: {job.step}</p>}
          {job.status === 'done' && (
            <p style={{ color: '#16a34a', fontSize: 13, marginTop: 8 }}>
              ✓ Document ingested — {job.chunksDone} chunks created
            </p>
          )}
          {job.status === 'failed' && (
            <p style={{ color: '#dc2626', fontSize: 13, marginTop: 8 }}>✗ {job.error}</p>
          )}
          {job.jobId && <p className="textXs textMuted mt8" style={{ fontFamily: 'monospace' }}>{job.jobId}</p>}
        </div>
      )}
    </div>
  )
}
