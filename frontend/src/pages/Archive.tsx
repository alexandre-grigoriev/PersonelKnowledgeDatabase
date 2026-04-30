import { useEffect, useState } from 'react'
import { listKbs, listArchive, deleteDocument } from '../api/client'
import type { Kb, ArchivedDoc } from '../types'

function fmt(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    done:       'bg-green-100 text-green-700',
    pending:    'bg-yellow-100 text-yellow-700',
    processing: 'bg-blue-100 text-blue-700',
    error:      'bg-red-100 text-red-700',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}

export default function Archive() {
  const [kbs, setKbs]         = useState<Kb[]>([])
  const [kbId, setKbId]       = useState('')
  const [docs, setDocs]       = useState<ArchivedDoc[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch]   = useState('')
  const [error, setError]     = useState('')

  useEffect(() => {
    listKbs().then(data => {
      setKbs(data)
      const saved = localStorage.getItem('skb_active_kb')
      const id = (saved && data.find(k => k.id === saved)) ? saved : data[0]?.id ?? ''
      setKbId(id)
    })
  }, [])

  useEffect(() => {
    if (!kbId) return
    setLoading(true); setError('')
    listArchive(kbId)
      .then(setDocs)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [kbId])

  const handleDelete = async (doc: ArchivedDoc) => {
    if (!confirm(`Delete "${doc.title || doc.sha256}"?`)) return
    try {
      await deleteDocument(kbId, doc.sha256)
      setDocs(d => d.filter(x => x.sha256 !== doc.sha256))
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const filtered = docs.filter(d =>
    !search || d.title.toLowerCase().includes(search.toLowerCase()) ||
    d.doi?.includes(search) || d.authors?.join(' ').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Archive</h1>

      <div className="flex gap-3 flex-wrap">
        <select
          value={kbId}
          onChange={e => setKbId(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">Select KB…</option>
          {kbs.map(kb => <option key={kb.id} value={kb.id}>{kb.name}</option>)}
        </select>

        <input
          type="search"
          placeholder="Search title, author, DOI…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-48 border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />

        <span className="text-sm text-gray-500 self-center">
          {filtered.length} / {docs.length} documents
        </span>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-400">{docs.length === 0 ? 'No documents ingested yet.' : 'No results for this search.'}</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Title', 'Authors', 'Year', 'Size', 'Status', ''].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-4 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(doc => (
                <tr key={doc.sha256} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 max-w-xs">
                    <p className="font-medium text-gray-800 truncate" title={doc.title}>{doc.title || '—'}</p>
                    {doc.doi && <p className="text-xs text-gray-400 font-mono truncate">{doc.doi}</p>}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 max-w-[180px]">
                    <p className="truncate">{doc.authors?.join(', ') || '—'}</p>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{doc.year ?? '—'}</td>
                  <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{fmt(doc.fileSizeBytes)}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={doc.status} /></td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => handleDelete(doc)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Delete
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
