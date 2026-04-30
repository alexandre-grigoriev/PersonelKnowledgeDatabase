import { useCallback, useEffect, useRef, useState } from 'react'
import { createKb, deleteKb, listKbs } from './api/client'
import type { Kb } from './types'
import KbDashboard from './pages/KbDashboard'
import Ingest from './pages/Ingest'
import Query from './pages/Query'
import Archive from './pages/Archive'
import './App.css'

type Page = 'dashboard' | 'ingest' | 'query' | 'archive'

const NAV: { id: Page; label: string; icon: string }[] = [
  { id: 'query',   label: 'Query',    icon: '🔍' },
  { id: 'ingest',  label: 'Ingest',   icon: '⬆' },
  { id: 'archive', label: 'Archive',  icon: '📂' },
]

const SIDEBAR_DEFAULT = 260
const SIDEBAR_MIN     = 200
const SIDEBAR_MAX     = 440

export default function App() {
  const [kbs, setKbs]           = useState<Kb[]>([])
  const [activeKbId, setActiveKbId] = useState<string>(localStorage.getItem('skb_active_kb') ?? '')
  const [page, setPage]         = useState<Page>('query')
  const [sidebarW, setSidebarW] = useState(SIDEBAR_DEFAULT)
  const [dragging, setDragging] = useState(false)
  const [showCreate, setShowCreate] = useState(false)

  const dragRef = useRef<{ startX: number; startW: number } | null>(null)

  const loadKbs = useCallback(() =>
    listKbs().then(data => {
      setKbs(data)
      if (!activeKbId && data.length > 0) {
        const saved = localStorage.getItem('skb_active_kb')
        const id = (saved && data.find(k => k.id === saved)) ? saved : data[0].id
        setActiveKbId(id)
        localStorage.setItem('skb_active_kb', id)
      }
    }), [activeKbId])

  useEffect(() => { loadKbs() }, [])

  const selectKb = (id: string) => {
    setActiveKbId(id)
    localStorage.setItem('skb_active_kb', id)
    setPage('query')
  }

  // Splitter drag
  const onMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startW: sidebarW }
    setDragging(true)
    e.preventDefault()
  }
  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      const delta = e.clientX - dragRef.current.startX
      setSidebarW(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, dragRef.current.startW + delta)))
    }
    const onUp = () => setDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [dragging])

  const activeKb = kbs.find(k => k.id === activeKbId) ?? null

  return (
    <div className="appRoot" style={{ userSelect: dragging ? 'none' : undefined }}>
      {/* ── Top bar ── */}
      <header className="topBar">
        <span className="topBarBrand">Scientific KB</span>
        <span className="topBarSep" />
        <button className="blueBtn" style={{ fontSize: 13 }} onClick={() => setShowCreate(true)}>
          + New KB
        </button>
      </header>

      {/* ── Main grid ── */}
      <div
        className="mainGrid"
        style={{ gridTemplateColumns: `${sidebarW}px 18px 1fr` }}
      >
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebarHeader">
            <span className="sidebarTitle">Knowledge Bases</span>
            <button className="sidebarIconBtn" title="New KB" onClick={() => setShowCreate(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 5v14M5 12h14"/>
              </svg>
            </button>
          </div>

          <div className="sidebarBody">
            {kbs.length === 0 && (
              <div className="emptyState" style={{ padding: '24px 8px' }}>
                <div className="emptyText">No knowledge bases yet</div>
              </div>
            )}
            {kbs.map(kb => (
              <div key={kb.id}>
                <button
                  className={`kbRow ${activeKbId === kb.id ? 'kbRowActive' : ''}`}
                  onClick={() => selectKb(kb.id)}
                >
                  <span className="kbDot" style={{ background: activeKbId === kb.id ? '#fff' : kb.color }} />
                  <span className="kbRowName">{kb.name}</span>
                  <span className="kbRowMeta">{kb.docCount}</span>
                  <div className="kbActions" onClick={e => e.stopPropagation()}>
                    <button
                      className="sidebarIconBtn sidebarIconBtnDanger"
                      title="Delete"
                      onClick={async () => {
                        if (!confirm(`Delete "${kb.name}"?`)) return
                        await deleteKb(kb.id)
                        loadKbs()
                        if (activeKbId === kb.id) setActiveKbId('')
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
                      </svg>
                    </button>
                  </div>
                </button>

                {activeKbId === kb.id && (
                  <div>
                    {NAV.map(n => (
                      <button
                        key={n.id}
                        className={`navRow ${page === n.id ? 'navRowActive' : ''}`}
                        onClick={() => setPage(n.id)}
                      >
                        <span style={{ fontSize: 13 }}>{n.icon}</span>
                        {n.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </aside>

        {/* Splitter */}
        <div className="splitter" onMouseDown={onMouseDown}>
          <div className="splitterLine" />
        </div>

        {/* Content */}
        <div className="contentPanel">
          {activeKb ? (
            <>
              <div className="contentHeader">
                <span className="kbDot" style={{ background: activeKb.color }} />
                <div>
                  <div className="contentTitle">{activeKb.name}</div>
                  {activeKb.description && (
                    <div className="contentSub">{activeKb.description}</div>
                  )}
                </div>
                <span style={{ flex: 1 }} />
                <div className="flex gap8">
                  {NAV.map(n => (
                    <button
                      key={n.id}
                      className={page === n.id ? 'blueBtn' : 'ghostBtn'}
                      style={{ fontSize: 13, padding: '7px 12px' }}
                      onClick={() => setPage(n.id)}
                    >
                      {n.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="contentBody">
                {page === 'query'   && <Query   kbId={activeKbId} />}
                {page === 'ingest'  && <Ingest  kbId={activeKbId} onDone={loadKbs} />}
                {page === 'archive' && <Archive kbId={activeKbId} />}
              </div>
            </>
          ) : (
            <div className="emptyState" style={{ flex: 1 }}>
              <div className="emptyIcon">📚</div>
              <div className="emptyTitle">No knowledge base selected</div>
              <div className="emptyText">Create one or select from the sidebar</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Create KB modal ── */}
      {showCreate && (
        <CreateKbModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { loadKbs(); setShowCreate(false) }}
        />
      )}
    </div>
  )
}

function CreateKbModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName]     = useState('')
  const [desc, setDesc]     = useState('')
  const [color, setColor]   = useState('#478cd0')
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')

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
          <div className="flex gap8" style={{ marginTop: 8 }}>
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
