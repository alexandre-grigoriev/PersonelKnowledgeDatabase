import { useEffect, useRef, useState } from 'react'
import { ingestPdf, ingestText, getJobStatus, extractAbstract } from '../api/client'
import type { IngestJob } from '../types'
import { extractPdfMeta } from '../utils/pdfMetaExtract'

interface Props { kbId: string; onDone?: () => void }

type FileKind = 'pdf' | 'text' | 'image' | null

const IMAGE_TYPES = new Set(['image/png','image/jpeg','image/webp','image/gif','image/bmp','image/tiff'])
const IMAGE_EXTS  = ['.png','.jpg','.jpeg','.webp','.gif','.bmp','.tiff']

function isImageFile(f: File) {
  return IMAGE_TYPES.has(f.type) || IMAGE_EXTS.some(e => f.name.toLowerCase().endsWith(e))
}

/** Extract title from the first # heading in markdown text */
function mdTitle(text: string): string | undefined {
  const m = text.match(/^#\s+(.+)/m)
  return m?.[1]?.trim()
}

/** Extract first meaningful paragraph from markdown as abstract */
function mdAbstract(text: string): string {
  const lines = text.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('!'))
  return lines.slice(0, 3).join(' ').slice(0, 800)
}

export default function Ingest({ kbId, onDone }: Props) {
  const [file, setFile]           = useState<File | null>(null)
  const [fileKind, setFileKind]   = useState<FileKind>(null)
  const [fileText, setFileText]   = useState('')          // content of MD/TXT file
  const [extracting, setExtracting] = useState(false)

  // Shared fields
  const [title, setTitle]     = useState('')
  const [year, setYear]       = useState('')
  const [doi, setDoi]         = useState('')              // DOI or Source URL
  const [abstract, setAbstract] = useState('')

  // PDF-only fields
  const [authors, setAuthors] = useState('')
  const [astmCode, setAstmCode] = useState('')
  const [journal, setJournal] = useState('')

  const [dragging, setDragging]     = useState(false)
  const [job, setJob]               = useState<IngestJob | null>(null)
  const [error, setError]           = useState('')
  const [submitting, setSubmitting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const resetFields = () => {
    setTitle(''); setAuthors(''); setYear(''); setDoi('')
    setAstmCode(''); setJournal(''); setAbstract('')
    setFileText(''); setJob(null); setError('')
  }

  const pickFile = async (f: File) => {
    resetFields()

    const isPdf  = f.type === 'application/pdf' || f.name.endsWith('.pdf')
    const isMd   = f.name.endsWith('.md') || f.name.endsWith('.txt') || f.type === 'text/markdown' || f.type === 'text/plain'
    const isImg  = isImageFile(f)

    if (!isPdf && !isMd && !isImg) return

    setFile(f)
    const kind: FileKind = isPdf ? 'pdf' : isImg ? 'image' : 'text'
    setFileKind(kind)

    if (isPdf) {
      setExtracting(true)
      try {
        const meta = await extractPdfMeta(f)
        if (meta.title)           setTitle(meta.title)
        if (meta.authors?.length) setAuthors(meta.authors.join(', '))
        if (meta.year)            setYear(String(meta.year))
        if (meta.doi)             setDoi(meta.doi)
        if (meta.astmCode)        setAstmCode(meta.astmCode)
        if (meta.journal)         setJournal(meta.journal)
        if (meta.abstract)        setAbstract(meta.abstract)

        // Gemini-powered abstract cleanup (runs after regex pass)
        if (meta.rawText) {
          try {
            const { abstract: aiAbstract } = await extractAbstract(
              meta.rawText,
              meta.sourceType === 'astm_standard',
            )
            if (aiAbstract) setAbstract(aiAbstract)
          } catch { /* non-fatal — keep regex result */ }
        }
      } catch { /* non-fatal */ }
      finally { setExtracting(false) }
    } else if (isMd) {
      const text = await f.text()
      setFileText(text)
      const t = mdTitle(text) ?? f.name.replace(/\.[^.]+$/, '')
      setTitle(t)
      setAbstract(mdAbstract(text))
    } else {
      // Image — pre-fill title from filename, leave other fields blank for user
      setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '))
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
    if (!file || !fileKind) return
    setSubmitting(true); setError(''); setJob(null)
    try {
      let r: IngestJob
      if (fileKind === 'image') {
        // Build a Markdown document from the image metadata.
        // The actual image is referenced by filename; OCR will be added in a future step.
        const mdText = [
          `# ${title || file.name}`,
          '',
          `![${title || file.name}](${file.name})`,
          '',
          abstract ? `## Description\n${abstract}` : '',
          doi      ? `## Source\n${doi}` : '',
        ].filter(Boolean).join('\n')
        r = await ingestText(kbId, mdText, {
          title:    title  || file.name,
          doi:      doi    || undefined,
          year:     year   ? parseInt(year) : undefined,
          pageUrl:  doi    || undefined,
          abstract: abstract || undefined,
        })
      } else if (fileKind === 'pdf') {
        r = await ingestPdf(kbId, file, {
          title:    title  || file.name,
          authors:  authors ? authors.split(',').map(a => a.trim()).filter(Boolean) : [],
          doi:      doi     || undefined,
          year:     year    ? parseInt(year) : undefined,
          astmCode: astmCode || undefined,
          journal:  journal  || undefined,
          abstract: abstract || undefined,
          sourceType: astmCode ? 'astm_standard' : 'publication',
        })
      } else {
        r = await ingestText(kbId, fileText, {
          title:   title  || file.name,
          doi:     doi    || undefined,
          year:    year   ? parseInt(year) : undefined,
          pageUrl: doi    || undefined,
          abstract: abstract || undefined,
        })
      }
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

  const isPdf  = fileKind === 'pdf'
  const isText = fileKind === 'text'
  const isImg  = fileKind === 'image'

  return (
    <>
      <form onSubmit={submit}>
        <div className="presForm">

          {/* Drop zone — accepts PDF and MD/TXT */}
          <div className="presFieldRow">
            <div
              className={`dropZone${dragging ? ' dropZoneActive' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => {
                e.preventDefault(); setDragging(false)
                const f = e.dataTransfer.files[0]; if (f) pickFile(f)
              }}
              onClick={() => document.getElementById('ingest-file-input')?.click()}
            >
              {file ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 20 }}>
                    {isPdf ? '📄' : isImg ? '🖼️' : '🌐'}
                  </span>
                  <div>
                    <p style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14 }}>{file.name}</p>
                    <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                      {isText
                        ? `${fileText.length.toLocaleString()} characters`
                        : `${(file.size / 1024 / 1024).toFixed(2)} MB`}
                      {isImg && <span style={{ marginLeft: 8, color: '#478cd0' }}>· OCR coming soon</span>}
                      {extracting && <span style={{ marginLeft: 8, color: '#478cd0' }}>· Extracting metadata…</span>}
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <p className="dropZoneText">Drop a file here, or click to browse</p>
                  <p className="dropZoneHint">PDF · MD · TXT · PNG · JPG · WEBP · GIF — metadata extracted automatically</p>
                </>
              )}
              <input id="ingest-file-input" type="file"
                accept=".pdf,.md,.txt,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tiff,text/plain,text/markdown,image/*"
                style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f) }} />
            </div>
          </div>

          {/* Title */}
          <div className="presFieldRow">
            <div className="presFieldLabel">Title</div>
            <input className="presFieldInput" value={title} onChange={e => setTitle(e.target.value)}
              placeholder={isText ? 'Page or article title' : isImg ? 'Image title or caption' : 'Document title'} />
          </div>

          {/* ASTM designation — PDF only, only if detected or filled */}
          {isPdf && (
            <div className="presFieldRow">
              <div className="presFieldLabel">
                ASTM designation
                <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 13 }}> (leave blank if not an ASTM standard)</span>
              </div>
              <input className="presFieldInput" value={astmCode} onChange={e => setAstmCode(e.target.value)}
                placeholder="ASTM E2911-23" />
            </div>
          )}

          {/* Authors — PDF only */}
          {isPdf && (
            <div className="presFieldRow">
              <div className="presFieldLabel">Authors (comma-separated)</div>
              <input className="presFieldInput" value={authors} onChange={e => setAuthors(e.target.value)}
                placeholder="Smith J., Doe A." />
            </div>
          )}

          {/* Year + DOI/URL */}
          <div className="presFieldRow" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
            <div>
              <div className="presFieldLabel">Year</div>
              <input className="presFieldInput" type="number" value={year} onChange={e => setYear(e.target.value)}
                placeholder="2024" min="1900" max="2100" />
            </div>
            <div>
              <div className="presFieldLabel">{isText ? 'Source URL' : 'DOI / URL'}</div>
              <input className="presFieldInput" value={doi} onChange={e => setDoi(e.target.value)}
                placeholder={isText ? 'https://…' : '10.1016/j.msea.2024.xxx or https://…'} />
            </div>
          </div>

          {/* Journal — PDF, non-ASTM only */}
          {isPdf && !astmCode && (
            <div className="presFieldRow">
              <div className="presFieldLabel">Journal / Conference</div>
              <input className="presFieldInput" value={journal} onChange={e => setJournal(e.target.value)}
                placeholder="Journal of Materials Science" />
            </div>
          )}

          {/* Abstract / Summary */}
          <div className="presFieldRow" style={{ marginBottom: 0 }}>
            <div className="presFieldLabel">
              {isText ? 'Summary' : 'Abstract'}
              <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 13 }}> (optional — auto-extracted)</span>
            </div>
            <textarea className="presFieldInput" value={abstract} onChange={e => setAbstract(e.target.value)}
              placeholder={isText ? 'Brief description of the page…' : 'Abstract text…'}
              rows={3} style={{ resize: 'vertical', fontFamily: 'inherit' }} />
          </div>

          {error && <p style={{ color: '#dc2626', fontSize: 13, marginTop: 12 }}>{error}</p>}
        </div>

        {/* Footer — same style as Settings Save */}
        <div className="presFooter">
          <button type="submit" className="presSubmitBtn"
            disabled={!file || submitting || extracting}>
            {submitting ? 'Processing…' : extracting ? 'Reading file…' : 'Ingest'}
          </button>
        </div>
      </form>

      {/* Job status */}
      {job && (
        <div style={{ margin: '16px 0', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
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
            <p style={{ color: '#16a34a', fontSize: 13, marginTop: 8 }}>✓ Document ingested — {job.chunksDone} chunks created</p>
          )}
          {job.status === 'failed' && (
            <p style={{ color: '#dc2626', fontSize: 13, marginTop: 8 }}>✗ {job.error}</p>
          )}
          {job.jobId && <p className="textXs textMuted mt8" style={{ fontFamily: 'monospace' }}>{job.jobId}</p>}
        </div>
      )}
    </>
  )
}
