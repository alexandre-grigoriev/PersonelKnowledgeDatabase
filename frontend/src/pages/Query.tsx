import { useEffect, useRef, useState } from 'react'
import { queryKb } from '../api/client'
import type { QueryResult } from '../types'
import { WELCOME } from '../constants'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'

interface Message {
  id:         string
  role:       'user' | 'assistant'
  text:       string
  timestamp:  string
  sources?:   QueryResult['sources']
  subQueries?: string[]
}

function makeId() { return Math.random().toString(36).slice(2) + Date.now().toString(36) }
function now()    { return new Date().toISOString() }
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function fmtScore(s: number) { return `${(s * 100).toFixed(0)}%` }

export default function Query({
  kbId, kbName, lang,
}: {
  kbId:   string
  kbName: string
  lang:   string
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput]       = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const speech    = useSpeechRecognition(lang)

  // Auto-scroll on new messages — exact GD Depth behaviour
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
      setMessages(prev => [...prev, {
        id:         makeId(),
        role:       'assistant',
        text:       result.answer,
        timestamp:  now(),
        sources:    result.sources,
        subQueries: result.queryPlan.subQueries,
      }])
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

      {/* Header — exact GD Depth chatHeader */}
      <div className="chatHeader">
        <div className="chatTitle">{kbName}</div>
        <div className="chatSub">Ask anything. Get cited answers.</div>
      </div>

      {/* Body — exact GD Depth chatBody */}
      <div className="chatBody">
        <div className="chatScroll" ref={scrollRef}>

          {/* Welcome message — uses language from WELCOME map */}
          {messages.length === 0 && !isThinking && (
            <div className="msgRow msgRowAsst">
              <div className="msgMeta">
                <span className="msgRole">ASSISTANT</span>
              </div>
              <div className="msgBubble msgBubbleAsst">
                {WELCOME[lang] ?? WELCOME.en}
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

                {/* Sub-query chips */}
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

          {/* Thinking dots — exact GD Depth */}
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

        {/* Input row — exact GD Depth: send.png when text, microphone.png when empty */}
        <div className="chatInputRow">
          <input
            className="chatInput"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && input.trim() && !isThinking) send() }}
            placeholder={isThinking ? 'Thinking…' : 'Type your question…'}
            disabled={isThinking}
          />

          {input.trim() ? (
            /* Send button — shows send.png, exact GD Depth */
            <button
              className="chatInputIconBtn"
              onClick={() => send()}
              disabled={isThinking}
              title="Send"
            >
              <img src="/send.png" alt="Send" className="chatInputIcon" style={{ width: 24, height: 24 }} />
            </button>
          ) : (
            /* Microphone button — hold to speak, exact GD Depth */
            <button
              className={`chatInputIconBtn${speech.isRecording ? ' chatMicRecording' : ''}`}
              title={speech.supported ? (speech.isRecording ? 'Release to send' : 'Hold to speak') : 'Voice not supported in this browser'}
              onPointerDown={e => { e.preventDefault(); if (!isThinking && speech.supported) speech.start(text => send(text)) }}
              onPointerUp={e => { e.preventDefault(); speech.stop() }}
              onPointerLeave={e => { e.preventDefault(); if (speech.isRecording) speech.stop() }}
              onPointerCancel={e => { e.preventDefault(); if (speech.isRecording) speech.stop() }}
              disabled={!speech.supported || isThinking}
            >
              {speech.isRecording ? (
                /* Red mic SVG when recording */
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                  stroke="#e53e3e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
                </svg>
              ) : (
                <img src="/microphone.png" alt="Mic" className="chatInputIcon" style={{ width: 24, height: 24 }} />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
