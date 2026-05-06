/**
 * Query.tsx — pure chat panel, exact GD Depth ChatPanel structure.
 * All state (messages, API calls) lives in App.tsx.
 */
import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import type { ChatMessage } from '../types'
import { WELCOME } from '../constants'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'

interface Props {
  kbName:        string
  lang:          string
  messages:      ChatMessage[]
  isThinking:    boolean
  input:         string
  onInputChange: (v: string) => void
  onSend:        (text?: string) => void
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function fmtScore(s: number) { return `${(s * 100).toFixed(0)}%` }

export default function Query({ kbName, lang, messages, isThinking, input, onInputChange, onSend }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLInputElement>(null)
  const speech    = useSpeechRecognition(lang)

  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [zoom, setZoom]               = useState(1)
  const ZOOM_STEP = 0.4, ZOOM_MAX = 6, ZOOM_MIN = 0.5

  useEffect(() => { setZoom(1) }, [lightboxUrl])
  useEffect(() => {
    if (!lightboxUrl) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setLightboxUrl(null); return }
      if (e.key === '+' || e.key === '=') setZoom(z => Math.min(z + ZOOM_STEP, ZOOM_MAX))
      if (e.key === '-') setZoom(z => Math.max(z - ZOOM_STEP, ZOOM_MIN))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxUrl])

  // Auto-scroll — exact GD Depth
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, isThinking])

  return (
    <>
    <div className="chatCard">

      {/* Header — exact GD Depth chatHeader */}
      <div className="chatHeader">
        <div className="chatTitle">{kbName}</div>
        <div className="chatSub">Ask anything. Get cited answers.</div>
      </div>

      {/* Body — exact GD Depth chatBody */}
      <div className="chatBody">
        <div className="chatScroll" ref={scrollRef}>

          {/* Welcome when empty */}
          {messages.length === 0 && !isThinking && (
            <div className="msgRow msgRowAsst">
              <div className="msgMeta"><span className="msgRole">ASSISTANT</span></div>
              <div className="msgBubble msgBubbleAsst">{WELCOME[lang] ?? WELCOME.en}</div>
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
                <div className="mdContent">
                  <ReactMarkdown
                    remarkPlugins={[remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                    components={{
                      img: ({ src, alt }) => src ? (
                        <figure className="msgImageFigure">
                          <img src={src} alt={alt ?? ''} className="msgImage" onClick={() => setLightboxUrl(src)} />
                          {alt && <figcaption className="msgImageCaption">{alt}</figcaption>}
                        </figure>
                      ) : null,
                    }}
                  >
                    {m.text}
                  </ReactMarkdown>
                </div>

                {m.subQueries && m.subQueries.length > 0 && (
                  <div className="subQueriesRow">
                    {m.subQueries.map((q, i) => (
                      <button
                        key={i}
                        type="button"
                        className="subQueryBtn"
                        onClick={() => {
                          if (isThinking) return
                          onInputChange(q)
                          inputRef.current?.focus()
                        }}
                        disabled={isThinking}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}

                {m.sources && m.sources.length > 0 && (() => {
                  // Deduplicate by docId — keep highest relevance score per document
                  const seen = new Map<string, typeof m.sources[0]>()
                  for (const s of m.sources) {
                    const key = s.docId || s.title
                    const prev = seen.get(key)
                    if (!prev || s.relevanceScore > prev.relevanceScore) seen.set(key, s)
                  }
                  const unique = [...seen.values()].sort((a, b) => b.relevanceScore - a.relevanceScore)
                  return (
                    <div className="sourcesSection">
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                        Sources ({unique.length})
                      </div>
                      {unique.map((s, i) => (
                        <div key={s.docId || s.chunkId} className="sourceRow">
                          <span className="sourcesBadge">[{i + 1}]</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="sourceRowTitle truncate">{s.title || 'Unknown'}</div>
                            <div className="sourceRowMeta">
                              {s.year && <span>{s.year}</span>}
                              {s.doi && <span style={{ marginLeft: 8, fontFamily: 'monospace' }}>{s.doi}</span>}
                            </div>
                          </div>
                          <span className="sourceRowScore">{fmtScore(s.relevanceScore)}</span>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </div>
            </div>
          ))}

          {/* Thinking dots — exact GD Depth */}
          {isThinking && (
            <div className="msgRow msgRowAsst">
              <div className="msgMeta"><span className="msgRole">ASSISTANT</span></div>
              <div className="msgBubble msgBubbleAsst msgBubbleThinking">
                <span className="thinkingDot" /><span className="thinkingDot" /><span className="thinkingDot" />
              </div>
            </div>
          )}
        </div>

        {/* Input — exact GD Depth: send.png / microphone.png */}
        <div className="chatInputRow">
          <input
            ref={inputRef}
            className="chatInput"
            value={input}
            onChange={e => onInputChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && input.trim() && !isThinking) onSend() }}
            placeholder={isThinking ? 'Thinking…' : 'Type your question…'}
            disabled={isThinking}
          />
          {input.trim() ? (
            <button className="chatInputIconBtn" onClick={() => onSend()} disabled={isThinking} title="Send">
              <img src="/send.png" alt="Send" className="chatInputIcon" />
            </button>
          ) : (
            <button
              className={`chatInputIconBtn${speech.isRecording ? ' chatMicRecording' : ''}`}
              title={speech.supported ? (speech.isRecording ? 'Release to send' : 'Hold to speak') : 'Voice not supported'}
              onPointerDown={e => { e.preventDefault(); if (!isThinking && speech.supported) speech.start(t => onSend(t)) }}
              onPointerUp={e => { e.preventDefault(); speech.stop() }}
              onPointerLeave={e => { e.preventDefault(); if (speech.isRecording) speech.stop() }}
              onPointerCancel={e => { e.preventDefault(); if (speech.isRecording) speech.stop() }}
              disabled={!speech.supported || isThinking}
            >
              {speech.isRecording
                ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#e53e3e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
                  </svg>
                : <img src="/microphone.png" alt="Mic" className="chatInputIcon" />
              }
            </button>
          )}
        </div>
      </div>
    </div>

      {/* Image lightbox */}
      {lightboxUrl && (
        <div
          className="imgLightbox"
          onClick={() => setLightboxUrl(null)}
          onWheel={e => { e.preventDefault(); setZoom(z => Math.min(Math.max(z - e.deltaY * 0.001, ZOOM_MIN), ZOOM_MAX)) }}
        >
          <figure className="imgLightboxFigure" onClick={e => e.stopPropagation()}>
            <img
              src={lightboxUrl}
              alt=""
              className="imgLightboxImg"
              style={{ transform: `scale(${zoom})`, transformOrigin: 'center', cursor: zoom < ZOOM_MAX ? 'zoom-in' : 'zoom-out' }}
              onClick={() => setZoom(z => z < ZOOM_MAX ? Math.min(z + ZOOM_STEP, ZOOM_MAX) : 1)}
            />
          </figure>
        </div>
      )}
    </>
  )
}
