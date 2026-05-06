import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { listArchive, deleteDocument } from '../api/client'
import type { ArchivedDoc } from '../types'

function fmtSize(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 ** 2).toFixed(1)} MB`
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
}

const STATUS_CLASS: Record<string, string> = {
  done:       'badgeDone',
  pending:    'badgePending',
  processing: 'badgeProcessing',
  error:      'badgeError',
}

interface PreviewData {
  previewText:  string
  chunkCount:   number
  lastIngested: string | null
}

// ── Document detail popup ─────────────────────────────────────────────────────

function DocPopup({
  doc, kbId, preview, previewLoading, onClose,
}: {
  doc: ArchivedDoc
  kbId: string
  preview: PreviewData | null
  previewLoading: boolean
  onClose: () => void
}) {
  const [mdContent, setMdContent]   = useState<string | null>(null)
  const [mdLoading, setMdLoading]   = useState(true)

  useEffect(() => {
    setMdContent(null); setMdLoading(true)
    fetch(`/api/kb/${kbId}/archive/${doc.sha256}/md`)
      .then(r => r.ok ? r.json() : null)
      .then(data => setMdContent(data?.md ?? null))
      .catch(() => setMdContent(null))
      .finally(() => setMdLoading(false))
  }, [kbId, doc.sha256])

  // Rewrite relative image URLs to the backend endpoint
  const imageBase = `/api/kb/${kbId}/archive/${doc.sha256}/images/`
  const mdForRender = mdContent?.replace(
    /!\[([^\]]*)\]\(images\/([^)]+)\)/g,
    (_, alt, fname) => `![${alt}](${imageBase}${fname})`,
  ) ?? ''

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {/* Backdrop */}
      <div
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}
        onClick={onClose}
      />

      {/* Popup card */}
      <div style={{
        position: 'relative',
        width: 'min(1100px, 95vw)',
        height: '88vh',
        background: '#fff',
        borderRadius: 16,
        boxShadow: '0 40px 80px rgba(0,0,0,0.28)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 12,
          padding: '20px 24px 16px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#111827', lineHeight: 1.35, marginBottom: 6 }}>
              {doc.title || '—'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span className={`badge ${STATUS_CLASS[doc.status] ?? 'badgeDefault'}`}>{doc.status}</span>
              {doc.year && <span style={{ fontSize: 13, color: '#6b7280' }}>{doc.year}</span>}
              {doc.pageCount && <span style={{ fontSize: 13, color: '#6b7280' }}>{doc.pageCount} pages</span>}
              <span style={{ fontSize: 13, color: '#6b7280' }}>{fmtSize(doc.fileSizeBytes)}</span>
              {preview && <span style={{ fontSize: 13, color: '#6b7280' }}>{preview.chunkCount} chunks</span>}
              {preview?.lastIngested && (
                <span style={{ fontSize: 13, color: '#6b7280' }}>ingested {fmtDate(preview.lastIngested)}</span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#6b7280', padding: 4, display: 'flex', borderRadius: 6, flexShrink: 0 }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>

          {/* Left: metadata */}
          <div style={{
            width: 300, flexShrink: 0,
            borderRight: '1px solid var(--border)',
            overflowY: 'auto',
            padding: '20px 20px 20px',
            display: 'flex', flexDirection: 'column', gap: 18,
          }}>

            {(doc.authors?.length ?? 0) > 0 && (
              <MetaBlock label="Authors">
                {doc.authors.join(', ')}
              </MetaBlock>
            )}

            {doc.doi && (
              <MetaBlock label="DOI">
                <a
                  href={`https://doi.org/${doc.doi}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 13, fontFamily: 'monospace', color: '#478cd0', wordBreak: 'break-all' }}
                >
                  {doc.doi}
                </a>
              </MetaBlock>
            )}

            {doc.abstract ? (
              <MetaBlock label="Abstract">
                <span style={{ fontSize: 13, lineHeight: 1.7, color: '#374151', wordBreak: 'break-word' }}>
                  {doc.abstract}
                </span>
              </MetaBlock>
            ) : !previewLoading ? (
              <MetaBlock label="Abstract">
                <span style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic' }}>
                  No abstract — add one when re-ingesting the document.
                </span>
              </MetaBlock>
            ) : (
              <div style={{ fontSize: 13, color: '#9ca3af' }}>Loading…</div>
            )}
          </div>

          {/* Right: MD viewer or PDF fallback */}
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', background: '#fafafa' }}>
            {mdLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9ca3af', fontSize: 14 }}>
                Loading document…
              </div>
            ) : mdContent ? (
              <div style={{ padding: '28px 36px', maxWidth: 860, margin: '0 auto' }}>
                <div className="mdContent" style={{ fontSize: 15, lineHeight: 1.75 }}>
                  <ReactMarkdown
                    components={{
                      img: ({ src, alt }) => (
                        <img src={src} alt={alt ?? ''} style={{ maxWidth: '100%', height: 'auto', borderRadius: 6, margin: '16px 0', display: 'block' }} />
                      ),
                    }}
                  >
                    {mdForRender}
                  </ReactMarkdown>
                </div>
              </div>
            ) : (
              <iframe
                src={`/api/kb/${kbId}/archive/${doc.sha256}/pdf`}
                style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                title={doc.title || 'Document preview'}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function MetaBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
        {label}
      </div>
      <div>{children}</div>
    </div>
  )
}

// ── Main Archive component ────────────────────────────────────────────────────

export default function Archive({ kbId, onDelete, refreshKey }: { kbId: string; onDelete?: () => void; refreshKey?: number }) {
  const [docs, setDocs]                     = useState<ArchivedDoc[]>([])
  const [loading, setLoading]               = useState(true)
  const [search, setSearch]                 = useState('')
  const [error, setError]                   = useState('')
  const [selected, setSelected]             = useState<ArchivedDoc | null>(null)
  const [preview, setPreview]               = useState<PreviewData | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  useEffect(() => {
    setLoading(true); setError('')
    listArchive(kbId)
      .then(setDocs)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [kbId, refreshKey])

  const openDoc = async (doc: ArchivedDoc) => {
    setSelected(doc)
    setPreview(null)
    setPreviewLoading(true)
    try {
      const res = await fetch(`/api/kb/${kbId}/archive/${doc.sha256}/preview`)
      if (res.ok) setPreview(await res.json())
    } catch { /* non-fatal */ }
    finally { setPreviewLoading(false) }
  }

  const handleDelete = async (doc: ArchivedDoc) => {
    if (!confirm(`Delete "${doc.title || doc.sha256}"?\nThis removes it from the archive and the graph.`)) return
    try {
      await deleteDocument(kbId, doc.sha256)
      setDocs(d => d.filter(x => x.sha256 !== doc.sha256))
      setSelected(null)
      onDelete?.()
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const filtered = docs.filter(d => {
    if (!search) return true
    const s = search.toLowerCase()
    return d.title.toLowerCase().includes(s) ||
           (d.doi ?? '').toLowerCase().includes(s) ||
           (d.authors ?? []).join(' ').toLowerCase().includes(s)
  })

  return (
    <>
      {/* List view — always rendered */}
      <div className="flexCol gap16">
        <div className="flex gap12 itemsCenter">
          <input
            className="authInput"
            style={{ maxWidth: 360 }}
            type="search"
            placeholder="Search by title, author, or DOI…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <span className="textSm textMuted">
            {filtered.length} / {docs.length} documents
          </span>
        </div>

        {error && <p style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>}

        {loading ? (
          <div className="emptyState">
            <span className="thinkingDot" /><span className="thinkingDot" /><span className="thinkingDot" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="emptyState">
            <div className="emptyIcon">📂</div>
            <div className="emptyTitle">
              {docs.length === 0 ? 'No documents ingested yet' : 'No results for this search'}
            </div>
            <div className="emptyText">
              {docs.length === 0 ? 'Go to Ingest to add your first PDF' : 'Try a different search term'}
            </div>
          </div>
        ) : (
          <div className="cardLite" style={{ overflow: 'hidden' }}>
            <table className="dataTable">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Authors</th>
                  <th>Year</th>
                  <th>Size</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map(doc => (
                  <tr key={doc.sha256} style={{ cursor: 'pointer' }} onClick={() => openDoc(doc)}>
                    <td style={{ maxWidth: 260 }}>
                      <div className="truncate fontMedium" style={{ color: '#478cd0' }}>{doc.title || '—'}</div>
                      {doc.abstract && (
                        <div className="textXs textMuted truncate" style={{ marginTop: 3 }}>{doc.abstract}</div>
                      )}
                      {doc.doi && (
                        <div className="textXs textMuted truncate" style={{ fontFamily: 'monospace', marginTop: 2 }}>{doc.doi}</div>
                      )}
                    </td>
                    <td style={{ maxWidth: 160 }}>
                      <div className="truncate textSm textMuted">{doc.authors?.join(', ') || '—'}</div>
                    </td>
                    <td className="textSm textMuted">{doc.year ?? '—'}</td>
                    <td className="textSm textMuted">{fmtSize(doc.fileSizeBytes)}</td>
                    <td>
                      <span className={`badge ${STATUS_CLASS[doc.status] ?? 'badgeDefault'}`}>{doc.status}</span>
                    </td>
                    <td>
                      <button
                        className="sidebarIconBtn sidebarIconBtnDanger"
                        title="Delete"
                        onClick={e => { e.stopPropagation(); handleDelete(doc) }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail popup */}
      {selected && (
        <DocPopup
          doc={selected}
          kbId={kbId}
          preview={preview}
          previewLoading={previewLoading}
          onClose={() => { setSelected(null); setPreview(null) }}
        />
      )}
    </>
  )
}
