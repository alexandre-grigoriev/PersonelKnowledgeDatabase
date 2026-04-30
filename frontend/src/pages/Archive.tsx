import { useEffect, useState } from 'react'
import { listArchive, deleteDocument } from '../api/client'
import type { ArchivedDoc } from '../types'

function fmtSize(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 ** 2).toFixed(1)} MB`
}

const STATUS_CLASS: Record<string, string> = {
  done:       'badgeDone',
  pending:    'badgePending',
  processing: 'badgeProcessing',
  error:      'badgeError',
}

export default function Archive({ kbId }: { kbId: string }) {
  const [docs, setDocs]       = useState<ArchivedDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [error, setError]     = useState('')

  useEffect(() => {
    setLoading(true); setError('')
    listArchive(kbId)
      .then(setDocs)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [kbId])

  const handleDelete = async (doc: ArchivedDoc) => {
    if (!confirm(`Delete "${doc.title || doc.sha256}"?\nThis removes it from the archive and the graph.`)) return
    try {
      await deleteDocument(kbId, doc.sha256)
      setDocs(d => d.filter(x => x.sha256 !== doc.sha256))
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
    <div className="flexCol gap16">
      {/* Search bar */}
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
          <div className="thinkingDots">
            <div className="thinkingDot" />
            <div className="thinkingDot" />
            <div className="thinkingDot" />
          </div>
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
                <tr key={doc.sha256}>
                  <td style={{ maxWidth: 260 }}>
                    <div className="truncate fontMedium">{doc.title || '—'}</div>
                    {doc.doi && <div className="textXs textMuted truncate" style={{ fontFamily: 'monospace', marginTop: 2 }}>{doc.doi}</div>}
                  </td>
                  <td style={{ maxWidth: 180 }}>
                    <div className="truncate textSm textMuted">{doc.authors?.join(', ') || '—'}</div>
                  </td>
                  <td className="textSm textMuted">{doc.year ?? '—'}</td>
                  <td className="textSm textMuted">{fmtSize(doc.fileSizeBytes)}</td>
                  <td>
                    <span className={`badge ${STATUS_CLASS[doc.status] ?? 'badgeDefault'}`}>
                      {doc.status}
                    </span>
                  </td>
                  <td>
                    <button
                      className="sidebarIconBtn sidebarIconBtnDanger"
                      title="Delete document"
                      onClick={() => handleDelete(doc)}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
  )
}
