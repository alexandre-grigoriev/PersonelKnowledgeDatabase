import { useRef, useState } from 'react'
import { queryKb } from '../api/client'
import type { QueryResult } from '../types'

function fmt(score: number) { return `${(score * 100).toFixed(0)}%` }

export default function Query({ kbId }: { kbId: string }) {
  const [question, setQuestion] = useState('')
  const [loading, setLoading]   = useState(false)
  const [result, setResult]     = useState<QueryResult | null>(null)
  const [error, setError]       = useState('')
  const [history, setHistory]   = useState<string[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const submit = async () => {
    const q = question.trim()
    if (!q || loading) return
    setLoading(true); setError(''); setResult(null)
    try {
      const r = await queryKb(kbId, q)
      setResult(r)
      setHistory(h => [q, ...h.filter(x => x !== q)].slice(0, 10))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
  }

  return (
    <div className="flexCol gap20" style={{ height: '100%' }}>
      {/* Input */}
      <div className="queryInputRow">
        <textarea
          ref={textareaRef}
          className="queryInput"
          placeholder="Ask a question about your documents… (Enter to send, Shift+Enter for new line)"
          value={question}
          rows={1}
          onChange={e => {
            setQuestion(e.target.value)
            e.target.style.height = 'auto'
            e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`
          }}
          onKeyDown={onKey}
        />
        <button
          className="blueBtn"
          style={{ borderRadius: 999, padding: '8px 18px' }}
          onClick={submit}
          disabled={!question.trim() || loading}
        >
          {loading ? '…' : 'Ask'}
        </button>
      </div>

      {/* Thinking */}
      {loading && (
        <div className="answerCard">
          <div className="thinkingDots">
            <div className="thinkingDot" />
            <div className="thinkingDot" />
            <div className="thinkingDot" />
          </div>
        </div>
      )}

      {error && (
        <div className="card" style={{ padding: '14px 16px', borderColor: '#fecaca', background: '#fff5f5' }}>
          <span style={{ color: '#dc2626', fontSize: 14 }}>{error}</span>
        </div>
      )}

      {/* Answer */}
      {result && !loading && (
        <div className="flexCol gap12">
          <div className="answerCard">
            <div className="answerLabel">Answer</div>
            <div className="answerText">{result.answer}</div>
            {result.queryPlan.subQueries.length > 0 && (
              <div className="flex gap4 mt12" style={{ flexWrap: 'wrap' }}>
                {result.queryPlan.subQueries.map((q, i) => (
                  <span key={i} style={{
                    background: '#f3f4f6', color: '#6b7280',
                    borderRadius: 6, padding: '2px 8px', fontSize: 12
                  }}>{q}</span>
                ))}
              </div>
            )}
          </div>

          {result.sources.length > 0 && (
            <div className="flexCol gap8">
              <div className="answerLabel">Sources</div>
              {result.sources.map((s, i) => (
                <div className="sourceCard" key={s.chunkId}>
                  <div className="flex gap8 itemsCenter">
                    <span style={{ background: '#e0e7ff', color: '#4338ca', borderRadius: 6, padding: '2px 7px', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                      [{i + 1}]
                    </span>
                    <span className="sourceTitle truncate">{s.title || 'Unknown'}</span>
                    <span className="sourceMeta" style={{ marginLeft: 'auto', flexShrink: 0 }}>{fmt(s.relevanceScore)}</span>
                  </div>
                  {(s.doi || s.year || s.section) && (
                    <div className="sourceMeta mt4">
                      {s.year && <span>{s.year}</span>}
                      {s.doi  && <span style={{ marginLeft: 8, fontFamily: 'monospace' }}>{s.doi}</span>}
                      {s.section && <span style={{ marginLeft: 8 }}>§ {s.section}</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* History */}
      {history.length > 0 && !loading && !result && (
        <div className="flexCol gap4">
          <div className="answerLabel">Recent questions</div>
          {history.map((q, i) => (
            <button
              key={i}
              className="ghostBtn"
              style={{ justifyContent: 'flex-start', borderRadius: 8, padding: '9px 12px' }}
              onClick={() => { setQuestion(q); textareaRef.current?.focus() }}
            >
              <span style={{ fontSize: 13, color: 'var(--text)' }} className="truncate">{q}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
