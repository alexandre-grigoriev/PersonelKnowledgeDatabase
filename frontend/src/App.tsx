import { useCallback, useEffect, useRef, useState } from 'react'
import { createKb, deleteKb, listKbs, queryKb } from './api/client'
import type { Kb, ChatMessage } from './types'
import { LANGS } from './constants'
import { TopSelect } from './components/ui/TopSelect'
import QueryPanel from './pages/Query'
import Ingest from './pages/Ingest'
import Archive from './pages/Archive'
import './App.css'

// ─── Local data types ─────────────────────────────────────────────────────────

interface Chat    { id: string; title: string }
interface Project { id: string; name: string; chats: Chat[] }

type MainPage = 'chat' | 'ingest' | 'archive'

function makeId() { return Math.random().toString(36).slice(2) + Date.now().toString(36) }
function now()    { return new Date().toISOString() }

const SIDEBAR_MIN = 220
const SIDEBAR_MAX = 600

// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  // KBs from backend
  const [kbs, setKbs]               = useState<Kb[]>([])
  const [activeKbId, setActiveKbId] = useState<string>(localStorage.getItem('skb_active_kb') ?? '')
  const [lang, setLang]             = useState('en')
  const [sidebarWidth, setSidebarWidth] = useState(() => Math.round(window.innerWidth * 0.22))

  // Projects / chats (in-memory, per KB)
  const [projectsByKb, setProjectsByKb] = useState<Record<string, Project[]>>({})
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [activeChatId, setActiveChatId]       = useState<string | null>(null)
  const [renamingChatId, setRenamingChatId]   = useState<string | null>(null)
  const [renameValue, setRenameValue]         = useState('')
  const [creatingProject, setCreatingProject] = useState(false)
  const [newProjectName, setNewProjectName]   = useState('')

  // Chat messages (per chatId)
  const [chatMessages, setChatMessages] = useState<Record<string, ChatMessage[]>>({})
  const [isThinking, setIsThinking]     = useState(false)
  const [input, setInput]               = useState('')

  // Page (when no chat selected, can show Ingest / Archive)
  const [mainPage, setMainPage] = useState<MainPage>('chat')

  // Header dropdowns
  const [kbMenuOpen, setKbMenuOpen]         = useState(false)
  const [settingsOpen, setSettingsOpen]     = useState(false)
  const [showCreate, setShowCreate]         = useState(false)
  const [showEdit, setShowEdit]             = useState(false)

  const isDragging   = useRef(false)
  const mainGridRef  = useRef<HTMLElement>(null)
  const kbMenuRef    = useRef<HTMLDivElement>(null)
  const settingsRef  = useRef<HTMLDivElement>(null)

  // ── Load KBs ────────────────────────────────────────────────────────────────

  const loadKbs = useCallback(() =>
    listKbs().then(data => {
      setKbs(data)
      const saved = localStorage.getItem('skb_active_kb')
      if ((!activeKbId || !data.find(k => k.id === activeKbId)) && data.length > 0) {
        const id = (saved && data.find(k => k.id === saved)) ? saved : data[0].id
        doSelectKb(id, data)
      }
    }), [activeKbId])

  useEffect(() => { loadKbs() }, [])

  function doSelectKb(id: string, kbList?: Kb[]) {
    setActiveKbId(id)
    localStorage.setItem('skb_active_kb', id)
    setKbMenuOpen(false)
    setSettingsOpen(false)
    setActiveChatId(null)
    setActiveProjectId(null)
    setMainPage('chat')
    setInput('')
    // Init default project for KB if none exist
    setProjectsByKb(prev => {
      if (prev[id] && prev[id].length > 0) return prev
      const defaultProject: Project = { id: makeId(), name: 'Default', chats: [] }
      return { ...prev, [id]: [defaultProject] }
    })
  }

  // ── Splitter drag (exact GD Depth) ──────────────────────────────────────────

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!isDragging.current || !mainGridRef.current) return
      const rect = mainGridRef.current.getBoundingClientRect()
      setSidebarWidth(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, e.clientX - rect.left)))
    }
    function onUp() {
      if (isDragging.current) { isDragging.current = false; document.body.style.cursor = ''; document.body.style.userSelect = '' }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [])

  // ── Close menus on outside click ─────────────────────────────────────────────

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (kbMenuOpen   && kbMenuRef.current   && !kbMenuRef.current.contains(e.target as Node))   setKbMenuOpen(false)
      if (settingsOpen && settingsRef.current && !settingsRef.current.contains(e.target as Node)) setSettingsOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [kbMenuOpen, settingsOpen])

  // ── Project / chat management ─────────────────────────────────────────────────

  function doCreateProject() {
    const name = newProjectName.trim() || 'New project'
    const project: Project = { id: makeId(), name, chats: [] }
    setProjectsByKb(prev => ({ ...prev, [activeKbId]: [...(prev[activeKbId] ?? []), project] }))
    setActiveProjectId(project.id)
    setActiveChatId(null)
    setCreatingProject(false)
    setNewProjectName('')
  }

  function doDeleteProject(projectId: string) {
    setProjectsByKb(prev => ({ ...prev, [activeKbId]: (prev[activeKbId] ?? []).filter(p => p.id !== projectId) }))
    if (activeProjectId === projectId) { setActiveProjectId(null); setActiveChatId(null) }
  }

  function doCreateChat(projectId: string) {
    const chat: Chat = { id: makeId(), title: 'New chat' }
    setProjectsByKb(prev => ({
      ...prev,
      [activeKbId]: (prev[activeKbId] ?? []).map(p => p.id === projectId ? { ...p, chats: [...p.chats, chat] } : p),
    }))
    setChatMessages(prev => ({ ...prev, [chat.id]: [] }))
    setActiveProjectId(projectId)
    setActiveChatId(chat.id)
    setMainPage('chat')
    setInput('')
  }

  function doDeleteChat(projectId: string, chatId: string) {
    setProjectsByKb(prev => ({
      ...prev,
      [activeKbId]: (prev[activeKbId] ?? []).map(p => p.id === projectId ? { ...p, chats: p.chats.filter(c => c.id !== chatId) } : p),
    }))
    setChatMessages(prev => { const n = { ...prev }; delete n[chatId]; return n })
    if (activeChatId === chatId) { setActiveChatId(null) }
  }

  function doRenameChat(projectId: string, chatId: string, title: string) {
    const t = title.trim()
    if (!t) return
    setProjectsByKb(prev => ({
      ...prev,
      [activeKbId]: (prev[activeKbId] ?? []).map(p =>
        p.id === projectId ? { ...p, chats: p.chats.map(c => c.id === chatId ? { ...c, title: t } : c) } : p
      ),
    }))
    setRenamingChatId(null)
  }

  // ── Send message ─────────────────────────────────────────────────────────────

  const send = useCallback(async (text?: string) => {
    const q = (text ?? input).trim()
    if (!q || isThinking || !activeChatId) return
    setInput('')

    // Auto-title chat from first message
    const msgs = chatMessages[activeChatId] ?? []
    if (msgs.length === 0) {
      const title = q.slice(0, 40)
      setProjectsByKb(prev => ({
        ...prev,
        [activeKbId]: (prev[activeKbId] ?? []).map(p => ({
          ...p, chats: p.chats.map(c => c.id === activeChatId ? { ...c, title } : c),
        })),
      }))
    }

    const userMsg: ChatMessage = { id: makeId(), role: 'user', text: q, timestamp: now() }
    setChatMessages(prev => ({ ...prev, [activeChatId]: [...(prev[activeChatId] ?? []), userMsg] }))
    setIsThinking(true)

    try {
      const result = await queryKb(activeKbId, q)
      const asstMsg: ChatMessage = {
        id: makeId(), role: 'assistant', text: result.answer, timestamp: now(),
        sources: result.sources, subQueries: result.queryPlan.subQueries,
      }
      setChatMessages(prev => ({ ...prev, [activeChatId!]: [...(prev[activeChatId!] ?? []), asstMsg] }))
    } catch (err) {
      setChatMessages(prev => ({
        ...prev,
        [activeChatId!]: [...(prev[activeChatId!] ?? []), {
          id: makeId(), role: 'assistant', text: `Error: ${(err as Error).message}`, timestamp: now(),
        }],
      }))
    } finally {
      setIsThinking(false)
    }
  }, [input, isThinking, activeChatId, activeKbId, chatMessages])

  // ── Delete active KB ─────────────────────────────────────────────────────────

  async function handleDeleteKb() {
    if (!activeKb || !confirm(`Delete "${activeKb.name}"? This cannot be undone.`)) return
    setSettingsOpen(false)
    await deleteKb(activeKb.id)
    setActiveKbId('')
    setProjectsByKb(prev => { const n = { ...prev }; delete n[activeKb.id]; return n })
    loadKbs()
  }

  // ── Derived ───────────────────────────────────────────────────────────────────

  const activeKb       = kbs.find(k => k.id === activeKbId) ?? null
  const projects       = projectsByKb[activeKbId] ?? []
  const activeMessages = activeChatId ? (chatMessages[activeChatId] ?? []) : []
  const activeChat     = projects.flatMap(p => p.chats).find(c => c.id === activeChatId) ?? null

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="appRoot">

      {/* ═══ TOP BAR — exact GD Depth ════════════════════════════════════════ */}
      <header className="topBar">
        <div className="topBarInner">

          <div className="brandLeft">
            <img className="brandHoriba" src="/screen logo Horiba.png" alt="HORIBA" />
          </div>

          <span className="brandName">Lab AI</span>

          <div className="topRight">
            {/* Language selector */}
            <TopSelect imgSrc="/language.png" value={lang} options={LANGS} onChange={setLang} />

            {/* KB list selector */}
            <div className="topSelectWrap" ref={kbMenuRef}>
              <button className="topSelectBtn" onClick={() => setKbMenuOpen(o => !o)}>
                {activeKb && <span className="kbDot" style={{ background: activeKb.color }} />}
                <span className="topSelectLabel">KB:</span>
                <span className="topSelectValue">{activeKb?.name ?? 'None'}</span>
                <svg className="topSelectChevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
              {kbMenuOpen && (
                <div className="topSelectDropdown">
                  {kbs.map(kb => (
                    <button key={kb.id}
                      className={`topSelectDropdownItem${kb.id === activeKbId ? ' topSelectDropdownItemActive' : ''}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                      onClick={() => doSelectKb(kb.id)}
                    >
                      <span className="kbDot" style={{ background: kb.color }} />
                      {kb.name}
                      <span style={{ marginLeft: 'auto', fontSize: 12, color: '#9ca3af' }}>{kb.docCount}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* KB settings gear */}
            <div className="topSelectWrap" ref={settingsRef}>
              <button className="iconBtn" onClick={() => setSettingsOpen(o => !o)} title="Knowledge base settings">
                {/* Gear icon */}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
              </button>
              {settingsOpen && (
                <div className="topSelectDropdown" style={{ right: 0, left: 'auto', minWidth: 220 }}>
                  <button className="topSelectDropdownItem" onClick={() => { setSettingsOpen(false); setShowCreate(true) }}>
                    New…
                  </button>
                  <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '2px 0' }} />
                  <button className="topSelectDropdownItem"
                    style={!activeKb ? { opacity: 0.4, pointerEvents: 'none' } : {}}
                    onClick={() => { if (activeKb) { setSettingsOpen(false); setShowEdit(true) } }}>
                    Edit selected KB…
                  </button>
                  <button className="topSelectDropdownItem"
                    style={{ color: activeKb ? '#dc2626' : '#9ca3af', ...(activeKb ? {} : { pointerEvents: 'none' as const }) }}
                    onClick={handleDeleteKb}>
                    Delete selected KB
                  </button>
                  <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '2px 0' }} />
                  <button className="topSelectDropdownItem"
                    style={!activeKb ? { opacity: 0.4, pointerEvents: 'none' } : {}}
                    onClick={() => { setSettingsOpen(false); alert('Export — coming soon') }}>
                    Export…
                  </button>
                  <button className="topSelectDropdownItem"
                    onClick={() => { setSettingsOpen(false); alert('Import — coming soon') }}>
                    Import…
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ═══ MAIN GRID — exact GD Depth ═════════════════════════════════════ */}
      <main ref={mainGridRef} className="mainGrid" style={{ gridTemplateColumns: `${sidebarWidth}px auto 1fr` }}>

        {/* ── Sidebar: "Projects" ── */}
        <aside className="sidebar">
          <div className="sidebarHeader">
            <span className="sidebarTitle">Projects</span>
            <button className="iconBtn" title="New project"
              onClick={() => { if (activeKb) setCreatingProject(true) }}
              style={!activeKb ? { opacity: 0.4, cursor: 'not-allowed' } : {}}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 5v14M5 12h14"/>
              </svg>
            </button>
          </div>

          {/* Inline "new project" form — exact GD Depth */}
          {creatingProject && (
            <div className="sidebarNewProject">
              <input className="sidebarInput" autoFocus placeholder="Project name…"
                value={newProjectName}
                onChange={e => setNewProjectName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') doCreateProject()
                  if (e.key === 'Escape') { setCreatingProject(false); setNewProjectName('') }
                }}
              />
              <div className="sidebarInputActions">
                <button className="blueBtn" style={{ padding: '6px 12px', fontSize: 13 }} onClick={doCreateProject}>Create</button>
                <button className="ghostBtn" style={{ padding: '6px 12px', fontSize: 13 }}
                  onClick={() => { setCreatingProject(false); setNewProjectName('') }}>Cancel</button>
              </div>
            </div>
          )}

          <div className="sidebarBody">
            {!activeKb && (
              <div className="sidebarEmpty">Select a knowledge base from the header to get started.</div>
            )}

            {/* Projects tree */}
            {projects.map(project => (
              <div key={project.id} className="projectGroup">
                <div
                  className={`projectRow${activeProjectId === project.id && !activeChatId ? ' projectRowActive' : ''}`}
                  onClick={() => { setActiveProjectId(project.id); setActiveChatId(null); setMainPage('chat') }}
                >
                  {/* Folder icon */}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                  <span className="projectName">{project.name}</span>
                  <div className="projectActions" onClick={e => e.stopPropagation()}>
                    <button className="sidebarIconBtn" title="New chat" onClick={() => doCreateChat(project.id)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
                    </button>
                    <button className="sidebarIconBtn sidebarIconBtnDanger" title="Delete project"
                      onClick={() => { if (confirm(`Delete project "${project.name}"?`)) doDeleteProject(project.id) }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
                    </button>
                  </div>
                </div>

                {/* Chats under this project */}
                {activeProjectId === project.id && project.chats.map(chat => (
                  <div
                    key={chat.id}
                    className={`chatRow${activeChatId === chat.id ? ' chatRowActive' : ''}`}
                    onClick={() => { if (renamingChatId !== chat.id) { setActiveChatId(chat.id); setActiveProjectId(project.id); setMainPage('chat') } }}
                  >
                    {/* Chat icon */}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                    {renamingChatId === chat.id ? (
                      <input className="chatRenameInput" autoFocus value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') doRenameChat(project.id, chat.id, renameValue)
                          if (e.key === 'Escape') setRenamingChatId(null)
                        }}
                        onBlur={() => doRenameChat(project.id, chat.id, renameValue)}
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <span className="chatRowTitle">{chat.title}</span>
                    )}
                    <button className="sidebarIconBtn" title="Rename (F2)"
                      onClick={e => { e.stopPropagation(); setRenamingChatId(chat.id); setRenameValue(chat.title) }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button className="sidebarIconBtn sidebarIconBtnDanger" title="Delete chat"
                      onClick={e => { e.stopPropagation(); doDeleteChat(project.id, chat.id) }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
                    </button>
                  </div>
                ))}
              </div>
            ))}

            {/* no utility links — Ingest and Archive are inside Edit KB modal */}
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

        {/* ── Main panel ── */}
        {!activeKb ? (
          <div className="chatCard">
            <div className="emptyState" style={{ flex: 1 }}>
              <div className="emptyIcon">📚</div>
              <div className="emptyTitle">No knowledge base selected</div>
              <div className="emptyText">Select one from the KB dropdown in the header, or create a new one with the ⚙ icon.</div>
            </div>
          </div>
        ) : activeChatId ? (
          <QueryPanel
            kbName={activeChat?.title ?? activeKb.name}
            lang={lang}
            messages={activeMessages}
            isThinking={isThinking}
            input={input}
            onInputChange={setInput}
            onSend={send}
          />
        ) : mainPage === 'ingest' ? (
          <div className="contentPanel">
            <div className="contentHeader">
              <span className="kbDot" style={{ background: activeKb.color }} />
              <div><div className="contentTitle">Ingest PDF</div><div className="contentSub">{activeKb.name}</div></div>
            </div>
            <div className="contentBody"><Ingest kbId={activeKbId} onDone={loadKbs} /></div>
          </div>
        ) : mainPage === 'archive' ? (
          <div className="contentPanel">
            <div className="contentHeader">
              <span className="kbDot" style={{ background: activeKb.color }} />
              <div><div className="contentTitle">Archive</div><div className="contentSub">{activeKb.name}</div></div>
            </div>
            <div className="contentBody"><Archive kbId={activeKbId} /></div>
          </div>
        ) : (
          /* No chat selected — prompt to start one */
          <div className="chatCard">
            <div className="emptyState" style={{ flex: 1 }}>
              <div className="emptyIcon">💬</div>
              <div className="emptyTitle">No chat selected</div>
              <div className="emptyText">Open a project in the sidebar and click <strong>+</strong> to start a new chat.</div>
            </div>
          </div>
        )}
      </main>

      {/* ═══ FOOTER — exact GD Depth ════════════════════════════════════════ */}
      <div className="footerNote">Lab AI — Scientific Knowledge Base — Powered by Gemini</div>

      {/* Modals */}
      {showCreate && (
        <KbModal onClose={() => setShowCreate(false)} onDone={() => { loadKbs(); setShowCreate(false) }} />
      )}
      {showEdit && activeKb && (
        <EditKbModal kb={activeKb} onClose={() => setShowEdit(false)} onDone={() => { loadKbs(); setShowEdit(false) }} />
      )}
    </div>
  )
}

// ─── Create KB modal (small, simple) ─────────────────────────────────────────

function KbModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
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
      onDone()
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

// ─── Edit KB modal — wide, tabbed (Astra Docs presModal pattern) ──────────────

function EditKbModal({ kb, onClose, onDone }: { kb: Kb; onClose: () => void; onDone: () => void }) {
  const [tab, setTab] = useState<'settings' | 'ingest' | 'archive'>('settings')

  // Settings tab state
  const [name, setName]       = useState(kb.name)
  const [desc, setDesc]       = useState(kb.description)
  const [color, setColor]     = useState(kb.color)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/kb/${kb.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: desc.trim(), color }),
      })
      if (!res.ok) throw new Error('Failed to update knowledge base')
      onDone()
    } catch (err) {
      setError((err as Error).message)
      setLoading(false)
    }
  }

  return (
    <div className="modalOverlay">
      <div className="modalBackdrop" onClick={onClose} />
      <div className="presModalWrap">
        <div className="presModal">
          {/* Close button */}
          <button className="presCloseBtn" onClick={onClose} title="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>

          {/* Header */}
          <div className="presModalHeader">
            <div className="presModalTitle" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="kbDot" style={{ background: color, width: 14, height: 14 }} />
              {kb.name}
            </div>
            <div className="presModalSubtitle">Knowledge base settings — ingest documents — browse archive</div>
          </div>

          {/* Tabs */}
          <div className="kbTabs">
            <button className={`kbTab${tab === 'settings' ? ' kbTabActive' : ''}`} onClick={() => setTab('settings')}>Settings</button>
            <button className={`kbTab${tab === 'ingest'   ? ' kbTabActive' : ''}`} onClick={() => setTab('ingest')}>Ingest</button>
            <button className={`kbTab${tab === 'archive'  ? ' kbTabActive' : ''}`} onClick={() => setTab('archive')}>Archive</button>
          </div>

          {/* Settings tab */}
          {tab === 'settings' && (
            <>
              <form onSubmit={saveSettings} className="presForm">
                <div className="presFieldRow">
                  <div className="presFieldLabel">Name <span style={{ color: '#ef4444' }}>*</span></div>
                  <input className="presFieldInput" value={name} onChange={e => setName(e.target.value)} required autoFocus />
                </div>
                <div className="presFieldRow">
                  <div className="presFieldLabel">Description</div>
                  <input className="presFieldInput" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Optional description" />
                </div>
                <div className="presFieldRow">
                  <div className="presFieldLabel">Color</div>
                  <div className="flex gap8 itemsCenter">
                    <input type="color" value={color} onChange={e => setColor(e.target.value)}
                      style={{ width: 40, height: 40, border: '1px solid var(--border)', borderRadius: 8, padding: 2, cursor: 'pointer' }} />
                    <span className="textSm textMuted">{color}</span>
                  </div>
                </div>
                {error && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 4 }}>{error}</div>}
              </form>
              <div className="presFooter">
                <button className="presCancelBtn" onClick={onClose}>Cancel</button>
                <button className="presSubmitBtn" disabled={loading || !name.trim()} onClick={saveSettings}>
                  {loading ? 'Saving…' : 'Save'}
                </button>
              </div>
            </>
          )}

          {/* Ingest tab */}
          {tab === 'ingest' && (
            <div style={{ marginTop: 16 }}>
              <Ingest kbId={kb.id} onDone={onDone} />
            </div>
          )}

          {/* Archive tab */}
          {tab === 'archive' && (
            <div style={{ marginTop: 16 }}>
              <Archive kbId={kb.id} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
