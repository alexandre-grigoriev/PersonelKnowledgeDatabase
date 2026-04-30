import { useEffect, useRef, useState } from 'react'
import { queryKb } from '../api/client'
import type { QueryResult } from '../types'

interface Message {
  id:        string
  role:      'user' | 'assistant'
  text:      string
  timestamp: string
  sources?:  QueryResult['sources']
  subQueries?: string[]
}

function makeId() { return Math.random().toString(36).slice(2) + Date.now().toString(36) }
function now()    { return new Date().toISOString() }
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function fmtScore(s: number) { return `${(s * 100).toFixed(0)}%` }

export default function Query({ kbId, kbName }: { kbId: string; kbName: string }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput]       = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, isThinking])

  // Reset conversation when KB changes
  useEffect(() => { setMessages([]) }, [kbId])

  const send = async (text?: string) => {
    const q = (text ?? input).trim()
    if (!q || isThinking) return
    setInput('')

    const userMsg: Message = { id: makeId(), role: 'user', text: q, timestamp: now() }
    setMessages(prev => [...prev, userMsg])
    setIsThinking(true)

    try {
      const result = await queryKb(kbId, q)
      const asstMsg: Message = {
        id:         makeId(),
        role:       'assistant',
        text:       result.answer,
        timestamp:  now(),
        sources:    result.sources,
        subQueries: result.queryPlan.subQueries,
      }
      setMessages(prev => [...prev, asstMsg])
    } catch (err) {
      setMessages(prev => [...prev, {
        id: makeId(), role: 'assistant',
        text: `Error: ${(err as Error).message}`,
        timestamp: now(),
      }])
    } finally {
      setIsThinking(false)
    }
  }

  return (
    <div className="chatCard">
      {/* Header — same as GD Depth chatHeader */}
      <div className="chatHeader">
        <div className="chatTitle">{kbName}</div>
        <div className="chatSub">Ask anything. Get cited answers.</div>
      </div>

      {/* Body */}
      <div className="chatBody">
        <div className="chatScroll" ref={scrollRef}>

          {/* Welcome message when empty */}
          {messages.length === 0 && !isThinking && (
            <div className="msgRow msgRowAsst">
              <div className="msgMeta">
                <span className="msgRole">ASSISTANT</span>
              </div>
              <div className="msgBubble msgBubbleAsst">
                Hello! Ask me anything about the documents in <strong>{kbName}</strong>.
                I'll search the knowledge graph and provide cited answers.
              </div>
            </div>
          )}

          {/* Messages */}
          {messages.map(m => (
            <div key={m.id} className={`msgRow ${m.role === 'user' ? 'msgRowUser' : 'msgRowAsst'}`}>
              <div className="msgMeta">
                <span className="msgRole">{m.role === 'user' ? 'YOU' : 'ASSISTANT'}</span>
                <span className="msgTime">{fmtTime(m.timestamp)}</span>
              </div>
              <div className={`msgBubble ${m.role === 'user' ? 'msgBubbleUser' : 'msgBubbleAsst'}`}>
                {m.text}

                {/* Sub-queries chips */}
                {m.subQueries && m.subQueries.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 10 }}>
                    {m.subQueries.map((q, i) => (
                      <span key={i} style={{ background: '#f3f4f6', color: '#6b7280', borderRadius: 6, padding: '2px 8px', fontSize: 12 }}>
                        {q}
                      </span>
                    ))}
                  </div>
                )}

                {/* Sources */}
                {m.sources && m.sources.length > 0 && (
                  <div className="sourcesSection">
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                      Sources
                    </div>
                    {m.sources.map((s, i) => (
                      <div key={s.chunkId} className="sourceRow">
                        <span className="sourcesBadge">[{i + 1}]</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="sourceRowTitle truncate">{s.title || 'Unknown'}</div>
                          {(s.doi || s.year || s.section) && (
                            <div className="sourceRowMeta">
                              {s.year && <span>{s.year}</span>}
                              {s.doi && <span style={{ marginLeft: 8, fontFamily: 'monospace' }}>{s.doi}</span>}
                              {s.section && <span style={{ marginLeft: 8 }}>§ {s.section}</span>}
                            </div>
                          )}
                        </div>
                        <span className="sourceRowScore">{fmtScore(s.relevanceScore)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Thinking indicator */}
          {isThinking && (
            <div className="msgRow msgRowAsst">
              <div className="msgMeta">
                <span className="msgRole">ASSISTANT</span>
              </div>
              <div className="msgBubble msgBubbleAsst msgBubbleThinking">
                <span className="thinkingDot" />
                <span className="thinkingDot" />
                <span className="thinkingDot" />
              </div>
            </div>
          )}
        </div>

        {/* Input row — pill shape, exact GD Depth */}
        <div className="chatInputRow">
          <input
            className="chatInput"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && input.trim() && !isThinking) send() }}
            placeholder="Type your question…"
            disabled={isThinking}
          />
          <button
            className="chatInputIconBtn"
            onClick={() => send()}
            disabled={!input.trim() || isThinking}
            title="Send"
          >
            {/* Send arrow icon */}
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#478cd0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
