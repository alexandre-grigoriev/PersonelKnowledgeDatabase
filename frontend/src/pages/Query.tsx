import { useEffect, useState } from 'react'
import { listKbs, queryKb } from '../api/client'
import type { Kb, QueryResult } from '../types'

function SourceCard({ s, i }: { s: QueryResult['sources'][0]; i: number }) {
  return (
    <div className="border border-gray-200 rounded p-3 text-sm space-y-1">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-gray-800">[{i + 1}] {s.title || 'Unknown'}</span>
        <span className="text-xs text-gray-400 shrink-0">{(s.relevanceScore * 100).toFixed(0)}%</span>
      </div>
      {(s.doi || s.year) && (
        <p className="text-xs text-gray-500">
          {s.year && <span>{s.year}</span>}
          {s.doi  && <span className="ml-2 font-mono">{s.doi}</span>}
        </p>
      )}
      {s.section && <p className="text-xs text-gray-400">§ {s.section}</p>}
    </div>
  )
}

export default function Query() {
  const [kbs, setKbs]           = useState<Kb[]>([])
  const [kbId, setKbId]         = useState('')
  const [question, setQuestion] = useState('')
  const [loading, setLoading]   = useState(false)
  const [result, setResult]     = useState<QueryResult | null>(null)
  const [error, setError]       = useState('')
  const [history, setHistory]   = useState<{ q: string; r: QueryResult }[]>([])

  useEffect(() => {
    listKbs().then(data => {
      setKbs(data)
      if (data.length > 0) setKbId(localStorage.getItem('skb_active_kb') ?? data[0].id)
    })
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!question.trim() || !kbId) return
    setLoading(true); setError(''); setResult(null)
    try {
      const r = await queryKb(kbId, question.trim())
      setResult(r)
      setHistory(h => [{ q: question.trim(), r }, ...h.slice(0, 9)])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-xl font-semibold">Query</h1>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex gap-2">
          <select
            value={kbId}
            onChange={e => setKbId(e.target.value)}
            className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 shrink-0"
          >
            <option value="">KB…</option>
            {kbs.map(kb => <option key={kb.id} value={kb.id}>{kb.name}</option>)}
          </select>

          <textarea
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e) } }}
            placeholder="Ask a question about your documents… (Enter to submit)"
            rows={2}
            className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-500"
          />

          <button
            type="submit"
            disabled={!question.trim() || !kbId || loading}
            className="bg-brand-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors shrink-0"
          >
            {loading ? '…' : 'Ask'}
          </button>
        </div>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
          <p className="text-sm text-gray-400 animate-pulse">Searching knowledge base…</p>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {/* Answer */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Answer</p>
            <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{result.answer}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {result.queryPlan.subQueries.map((q, i) => (
                <span key={i} className="text-xs bg-gray-100 text-gray-600 rounded px-2 py-0.5">{q}</span>
              ))}
            </div>
          </div>

          {/* Sources */}
          {result.sources.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Sources</p>
              <div className="space-y-2">
                {result.sources.map((s, i) => <SourceCard key={s.chunkId} s={s} i={i} />)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* History */}
      {history.length > 1 && (
        <div>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Previous questions</p>
          <div className="space-y-1">
            {history.slice(1).map(({ q }, i) => (
              <button
                key={i}
                onClick={() => setQuestion(q)}
                className="block w-full text-left text-sm text-gray-600 hover:text-gray-900 px-2 py-1 rounded hover:bg-gray-100 truncate"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
