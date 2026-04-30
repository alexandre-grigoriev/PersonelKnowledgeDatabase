import { useEffect, useState } from 'react'
import { listKbs, createKb, deleteKb, getKbStats } from '../api/client'
import type { Kb, KbStats } from '../types'

function fmt(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

function StatusDot({ status }: { status: Kb['status'] }) {
  const color =
    status === 'ready'      ? 'bg-green-400' :
    status === 'indexing'   ? 'bg-yellow-400' :
                              'bg-blue-400'
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
}

function KbCard({ kb, onDelete }: { kb: Kb; onDelete: () => void }) {
  const [stats, setStats] = useState<KbStats | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const loadStats = () => {
    if (!stats) getKbStats(kb.id).then(setStats).catch(() => {})
  }

  const handleDelete = async () => {
    if (!confirm(`Delete "${kb.name}"? This cannot be undone.`)) return
    setDeleting(true)
    await deleteKb(kb.id).catch(() => {})
    onDelete()
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50"
        onClick={() => { setExpanded(e => !e); loadStats() }}
      >
        <span className="w-3 h-3 rounded-full shrink-0" style={{ background: kb.color }} />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{kb.name}</p>
          {kb.description && (
            <p className="text-xs text-gray-500 truncate">{kb.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500 shrink-0">
          <StatusDot status={kb.status} />
          <span>{kb.docCount} docs</span>
          <span className="text-gray-300">|</span>
          <span>{kb.chunkCount} chunks</span>
        </div>
        <span className="text-gray-400 text-xs">{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
          {stats ? (
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-3">
              {[
                ['Documents', stats.docCount],
                ['Chunks', stats.chunkCount],
                ['Entities', stats.entityCount],
                ['Archive', fmt(stats.archiveSizeBytes)],
              ].map(([label, val]) => (
                <div key={label as string} className="bg-white rounded p-2 border border-gray-200">
                  <dt className="text-xs text-gray-500">{label}</dt>
                  <dd className="font-semibold text-gray-900">{val}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-xs text-gray-400 mb-3">Loading stats…</p>
          )}
          <p className="text-xs text-gray-400 font-mono mb-3">{kb.id}</p>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete knowledge base'}
          </button>
        </div>
      )}
    </div>
  )
}

export default function KbDashboard() {
  const [kbs, setKbs]       = useState<Kb[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName]     = useState('')
  const [desc, setDesc]     = useState('')
  const [color, setColor]   = useState('#3B8BD4')
  const [creating, setCreating] = useState(false)
  const [error, setError]   = useState('')

  const load = () => listKbs().then(setKbs).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    setError('')
    try {
      await createKb(name.trim(), desc.trim(), color)
      setName(''); setDesc('')
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Knowledge Bases</h1>

      {/* Create form */}
      <form onSubmit={handleCreate} className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 space-y-3">
        <h2 className="text-sm font-medium text-gray-700">New knowledge base</h2>
        <div className="flex gap-3 flex-wrap">
          <input
            type="text"
            placeholder="Name *"
            value={name}
            onChange={e => setName(e.target.value)}
            className="flex-1 min-w-40 border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            required
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={desc}
            onChange={e => setDesc(e.target.value)}
            className="flex-1 min-w-40 border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <input
            type="color"
            value={color}
            onChange={e => setColor(e.target.value)}
            title="Color"
            className="w-9 h-9 rounded border border-gray-300 cursor-pointer p-0.5"
          />
          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="bg-brand-600 text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>

      {/* List */}
      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : kbs.length === 0 ? (
        <p className="text-sm text-gray-400">No knowledge bases yet. Create one above.</p>
      ) : (
        <div className="space-y-2">
          {kbs.map(kb => (
            <KbCard key={kb.id} kb={kb} onDelete={load} />
          ))}
        </div>
      )}
    </div>
  )
}
