import { useCallback, useEffect, useRef, useState } from 'react'
import { createKb, deleteKb, listKbs } from './api/client'
import type { Kb } from './types'
import { LANGS } from './constants'
import { TopSelect } from './components/ui/TopSelect'
import Ingest from './pages/Ingest'
import Query from './pages/Query'
import Archive from './pages/Archive'
import './App.css'

type Page = 'query' | 'ingest' | 'archive'

const SIDEBAR_MIN = 220
const SIDEBAR_MAX = 600

export default function App() {
  const [kbs, setKbs]               = useState<Kb[]>([])
  const [activeKbId, setActiveKbId] = useState<string>(localStorage.getItem('skb_active_kb') ?? '')
  const [page, setPage]             = useState<Page>('query')
  const [lang, setLang]             = useState('en')
  const [sidebarWidth, setSidebarWidth] = useState(() => Math.round(window.innerWidth * 0.22))

  const [showCreate, setShowCreate] = useState(false)
  const [kbMenuOpen, setKbMenuOpen] = useState(false)

  const isDragging  = useRef(false)
  const mainGridRef = useRef<HTMLElement>(null)
  const kbMenuRef   = useRef<HTMLDivElement>(null)

  // ── Load KBs ──────────────────────────────────────────────────────────────────

  const loadKbs = useCallback(() =>
    listKbs().then(data => {
      setKbs(data)
      const saved = localStorage.getItem('skb_active_kb')
      if ((!activeKbId || !data.find(k => k.id === activeKbId)) && data.length > 0) {
        const id = (saved && data.find(k => k.id === saved)) ? saved : data[0].id
        setActiveKbId(id)
        localStorage.setItem('skb_active_kb', id)
      }
    }), [activeKbId])

  useEffect(() => { loadKbs() }, [])

  const selectKb = (id: string) => {
    setActiveKbId(id)
    localStorage.setItem('skb_active_kb', id)
    setKbMenuOpen(false)
    setPage('query')
  }

  // ── Splitter drag — exact GD Depth ─────────────────────────────────────────────

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!isDragging.current || !mainGridRef.current) return
      const rect = mainGridRef.current.getBoundingClientRect()
      setSidebarWidth(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, e.clientX - rect.left)))
    }
    function onUp() {
      if (isDragging.current) {
        isDragging.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [])

  // ── Close KB menu on outside click ────────────────────────────────────────────

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!kbMenuOpen) return
      if (kbMenuRef.current && !kbMenuRef.current.contains(e.target as Node)) setKbMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [kbMenuOpen])

  const activeKb = kbs.find(k => k.id === activeKbId) ?? null

  return (
    <div className="appRoot">

      {/* ══ TOP BAR — exact GD Depth ══════════════════════════════════════════ */}
      <header className="topBar">
        <div className="topBarInner">

          {/* Left: HORIBA logo — exact as GD Depth brandLeft */}
          <div className="brandLeft">
            <img className="brandHoriba" src="/screen logo Horiba.png" alt="HORIBA" />
          </div>

          {/* Centre: brand name — absolutely centred, exact GD Depth style */}
          <span className="brandName">Lab AI</span>

          {/* Right: language selector + KB selector — exact GD Depth topRight */}
          <div className="topRight">

            {/* Language selector — exact GD Depth TopSelect with language.png */}
            <TopSelect
              imgSrc="/language.png"
              value={lang}
              options={LANGS}
              onChange={setLang}
            />

            {/* KB selector */}
            <div className="topSelectWrap" ref={kbMenuRef}>
              <button className="topSelectBtn" onClick={() => setKbMenuOpen(o => !o)}>
                {activeKb && <span className="topSelectDot" style={{ background: activeKb.color }} />}
                <span className="topSelectLabel">KB:</span>
                <span className="topSelectValue">{activeKb?.name ?? 'None'}</span>
                <svg className="topSelectChevron" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
              {kbMenuOpen && (
                <div className="topSelectDropdown">
                  {kbs.map(kb => (
                    <button
                      key={kb.id}
                      className={`topSelectDropdownItem${kb.id === activeKbId ? ' topSelectDropdownItemActive' : ''}`}
                      onClick={() => selectKb(kb.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                    >
                      <span className="topSelectDot" style={{ background: kb.color }} />
                      {kb.name}
                      <span style={{ marginLeft: 'auto', fontSize: 12, color: '#9ca3af' }}>{kb.docCount}</span>
                    </button>
                  ))}
                  {kbs.length > 0 && <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '4px 0' }} />}
                  <button
                    className="topSelectDropdownItem"
                    style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#478cd0' }}
                    onClick={() => { setKbMenuOpen(false); setShowCreate(true) }}
                  >
                    ＋ New knowledge base…
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ══ MAIN GRID — exact GD Depth ════════════════════════════════════════ */}
      <main ref={mainGridRef} className="mainGrid" style={{ gridTemplateColumns: `${sidebarWidth}px auto 1fr` }}>

        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebarHeader">
            <span className="sidebarTitle">Knowledge Bases</span>
            <button className="iconBtn" title="New KB" onClick={() => setShowCreate(true)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 5v14M5 12h14"/>
              </svg>
            </button>
          </div>

          <div className="sidebarBody">
            {kbs.length === 0 && (
              <div className="sidebarEmpty">No knowledge bases yet.<br />Create one to get started.</div>
            )}
            {kbs.map(kb => (
              <div key={kb.id} className="projectGroup">
                <button
                  className={`kbRow${activeKbId === kb.id ? ' kbRowActive' : ''}`}
                  onClick={() => selectKb(kb.id)}
                >
                  <span className="kbDot" style={{ background: kb.color }} />
                  <span className="kbRowName">{kb.name}</span>
                  <span className="kbRowMeta">{kb.docCount}</span>
                  <div className="kbActions" onClick={e => e.stopPropagation()}>
                    <button
                      className="sidebarIconBtn sidebarIconBtnDanger"
                      title="Delete KB"
                      onClick={async () => {
                        if (!confirm(`Delete "${kb.name}"? This cannot be undone.`)) return
                        await deleteKb(kb.id)
                        if (activeKbId === kb.id) setActiveKbId('')
                        loadKbs()
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
                      </svg>
                    </button>
                  </div>
                </button>

                {activeKbId === kb.id && (
                  <>
                    {([ ['query','🔍','Query'], ['ingest','⬆','Ingest'], ['archive','📂','Archive'] ] as const).map(
                      ([id, icon, label]) => (
                        <button
                          key={id}
                          className={`navRow${page === id ? ' navRowActive' : ''}`}
                          onClick={() => setPage(id)}
                        >
                          <span style={{ fontSize: 13 }}>{icon}</span>
                          {label}
                        </button>
                      )
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </aside>

        {/* Splitter — exact GD Depth */}
        <div className="splitter" onMouseDown={() => {
          isDragging.current = true
          document.body.style.cursor = 'col-resize'
          document.body.style.userSelect = 'none'
        }}>
          <div className="splitterLine" />
        </div>

        {/* Content */}
        {!activeKb ? (
          <div className="chatCard">
            <div className="emptyState" style={{ flex: 1 }}>
              <div className="emptyIcon">📚</div>
              <div className="emptyTitle">No knowledge base selected</div>
              <div className="emptyText">Create one or select from the sidebar</div>
            </div>
          </div>
        ) : page === 'query' ? (
          <Query kbId={activeKbId} kbName={activeKb.name} lang={lang} />
        ) : (
          <div className="contentPanel">
            <div className="contentHeader">
              <span className="kbDot" style={{ background: activeKb.color }} />
              <div>
                <div className="contentTitle">{activeKb.name}</div>
                {activeKb.description && <div className="contentSub">{activeKb.description}</div>}
              </div>
              <span style={{ flex: 1 }} />
              <div className="flex gap8">
                {(['ingest', 'archive'] as const).map(id => (
                  <button key={id} className={page === id ? 'blueBtn' : 'ghostBtn'}
                    style={{ fontSize: 13, padding: '7px 12px' }} onClick={() => setPage(id)}>
                    {id.charAt(0).toUpperCase() + id.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="contentBody">
              {page === 'ingest'  && <Ingest  kbId={activeKbId} onDone={loadKbs} />}
              {page === 'archive' && <Archive kbId={activeKbId} />}
            </div>
          </div>
        )}
      </main>

      {/* ══ FOOTER — exact GD Depth ═══════════════════════════════════════════ */}
      <div className="footerNote">
        Lab AI — Scientific Knowledge Base — Powered by Gemini
      </div>

      {/* Create KB modal */}
      {showCreate && (
        <CreateKbModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { loadKbs(); setShowCreate(false) }}
        />
      )}
    </div>
  )
}

/* ─── Create KB modal ───────────────────────────────────────────────────────── */

function CreateKbModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName]       = useState('')
  const [desc, setDesc]       = useState('')
  const [color, setColor]     = useState('#478cd0')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true); setError('')
    try {
      await createKb(name.trim(), desc.trim(), color)
      onCreated()
    } catch (err) {
      setError((err as Error).message)
      setLoading(false)
    }
  }

  return (
    <div className="modalOverlay">
      <div className="modalBackdrop" onClick={onClose} />
      <div className="modalCard">
        <div className="modalTitle">New Knowledge Base</div>
        <div className="modalSub">Create an isolated graph for a set of documents</div>
        <form onSubmit={submit} className="flexCol gap12">
          <div>
            <label className="fieldLabel">Name *</label>
            <input className="authInput" value={name} onChange={e => setName(e.target.value)}
              placeholder="Materials ASTM, Organic Chemistry…" required autoFocus />
          </div>
          <div>
            <label className="fieldLabel">Description</label>
            <input className="authInput" value={desc} onChange={e => setDesc(e.target.value)}
              placeholder="Optional description" />
          </div>
          <div>
            <label className="fieldLabel">Color</label>
            <div className="flex gap8 itemsCenter">
              <input type="color" value={color} onChange={e => setColor(e.target.value)}
                style={{ width: 40, height: 40, border: '1px solid var(--border)', borderRadius: 8, padding: 2, cursor: 'pointer' }} />
              <span className="textSm textMuted">{color}</span>
            </div>
          </div>
          {error && <p style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>}
          <div className="flex gap8 mt8">
            <button type="button" className="ghostBtn w100" onClick={onClose}>Cancel</button>
            <button type="submit" className="blueBtn w100" disabled={loading || !name.trim()}>
              {loading ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
