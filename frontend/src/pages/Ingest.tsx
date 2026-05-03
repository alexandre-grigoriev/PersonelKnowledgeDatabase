import { useEffect, useRef, useState } from 'react'
import { ingestPdf, getJobStatus } from '../api/client'
import type { IngestJob } from '../types'
import { extractPdfMeta } from '../utils/pdfMetaExtract'

interface Props { kbId: string; onDone?: () => void }

export default function Ingest({ kbId, onDone }: Props) {
  const [file, setFile]           = useState<File | null>(null)
  const [extracting, setExtracting] = useState(false)

  // Core fields
  const [sourceType, setSourceType] = useState<'publication' | 'astm_standard'>('publication')
  const [title, setTitle]           = useState('')
  const [authors, setAuthors]       = useState('')
  const [year, setYear]             = useState('')
  const [doi, setDoi]               = useState('')

  // Extended fields
  const [astmCode, setAstmCode]     = useState('')
  const [journal, setJournal]       = useState('')
  const [abstract, setAbstract]     = useState('')

  const [dragging, setDragging]     = useState(false)
  const [job, setJob]               = useState<IngestJob | null>(null)
  const [error, setError]           = useState('')
  const [submitting, setSubmitting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const resetFields = () => {
    setTitle(''); setAuthors(''); setYear(''); setDoi('')
    setAstmCode(''); setJournal(''); setAbstract('')
    setSourceType('publication')
  }

  const pickFile = async (f: File) => {
    if (f.type !== 'application/pdf') return
    setFile(f)
    setJob(null); setError('')
    resetFields()

    // Auto-extract metadata from PDF
    setExtracting(true)
    try {
      const meta = await extractPdfMeta(f)
      if (meta.sourceType)           setSourceType(meta.sourceType)
      if (meta.title)                setTitle(meta.title)
      if (meta.authors?.length)      setAuthors(meta.authors.join(', '))
      if (meta.year)                 setYear(String(meta.year))
      if (meta.doi)                  setDoi(meta.doi)
      if (meta.astmCode)             setAstmCode(meta.astmCode)
      if (meta.journal)              setJournal(meta.journal)
      if (meta.abstract)             setAbstract(meta.abstract)
    } catch {
      // Non-fatal — user fills manually
    } finally {
      setExtracting(false)
    }
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
      } catch { /* retry */ }
    }, 2000)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return
    setSubmitting(true); setError(''); setJob(null)
    try {
      const r = await ingestPdf(kbId, file, {
        title:      title  || file.name,
        authors:    authors ? authors.split(',').map(a => a.trim()).filter(Boolean) : [],
        doi:        doi     || undefined,
        year:       year    ? parseInt(year) : undefined,
        sourceType,
        astmCode:   astmCode || undefined,
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
    job?.status === 'done'    ? 'badgeDone' :
    job?.status === 'failed'  ? 'badgeError' :
    job?.status === 'running' ? 'badgeProcessing' : 'badgePending'

  return (
    <div className="flexCol gap20">
      <form onSubmit={submit} className="flexCol gap16">

        {/* Drop zone */}
        <div
          className={`dropZone${dragging ? ' dropZoneActive' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) pickFile(f) }}
          onClick={() => document.getElementById('pdf-input')?.click()}
        >
          {file ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>📄</span>
              <div>
                <p style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14 }}>{file.name}</p>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                  {extracting && <span style={{ marginLeft: 8, color: '#478cd0' }}>· Extracting metadata…</span>}
                </p>
              </div>
            </div>
          ) : (
            <>
              <p className="dropZoneText">Drop a PDF here or click to browse</p>
              <p className="dropZoneHint">Metadata will be extracted automatically · Max 100 MB</p>
            </>
          )}
          <input id="pdf-input" type="file" accept="application/pdf" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f) }} />
        </div>

        {/* Source type */}
        <div>
          <label className="fieldLabel">Document type</label>
          <div style={{ display: 'flex', gap: 12 }}>
            {(['publication', 'astm_standard'] as const).map(v => (
              <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
                <input type="radio" value={v} checked={sourceType === v} onChange={() => setSourceType(v)} />
                {v === 'publication' ? 'Scientific publication' : 'ASTM standard'}
              </label>
            ))}
          </div>
        </div>

        {/* Title */}
        <div>
          <label className="fieldLabel">Title</label>
          <input className="authInput" value={title} onChange={e => setTitle(e.target.value)}
            placeholder={sourceType === 'astm_standard'
              ? 'Standard Guide for Relative Intensity Correction…'
              : 'Paper title'} />
        </div>

        {/* ASTM code — shown for ASTM standards */}
        {sourceType === 'astm_standard' && (
          <div>
            <label className="fieldLabel">ASTM designation</label>
            <input className="authInput" value={astmCode} onChange={e => setAstmCode(e.target.value)}
              placeholder="ASTM E2911-23" />
          </div>
        )}

        {/* Authors — shown for publications */}
        {sourceType === 'publication' && (
          <div>
            <label className="fieldLabel">Authors (comma-separated)</label>
            <input className="authInput" value={authors} onChange={e => setAuthors(e.target.value)}
              placeholder="Smith J., Doe A." />
          </div>
        )}

        {/* Year + DOI */}
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

        {/* Journal — shown for publications */}
        {sourceType === 'publication' && (
          <div>
            <label className="fieldLabel">Journal / Conference</label>
            <input className="authInput" value={journal} onChange={e => setJournal(e.target.value)}
              placeholder="Journal of Materials Science" />
          </div>
        )}

        {/* Abstract */}
        <div>
          <label className="fieldLabel">Abstract <span style={{ color: 'var(--muted)', fontWeight: 400, textTransform: 'none' }}>(optional — auto-extracted)</span></label>
          <textarea className="authInput" value={abstract} onChange={e => setAbstract(e.target.value)}
            placeholder="Abstract text…"
            rows={3} style={{ resize: 'vertical', fontFamily: 'inherit', fontSize: 14 }} />
        </div>

        {error && <p style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>}

        <button type="submit" className="blueBtn w100" disabled={!file || submitting || extracting}
          style={{ justifyContent: 'center', padding: '11px 0' }}>
          {submitting ? 'Uploading…' : extracting ? 'Reading PDF…' : 'Start ingestion'}
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
