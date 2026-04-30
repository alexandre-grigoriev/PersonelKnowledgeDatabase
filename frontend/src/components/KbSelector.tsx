import { useEffect, useState } from 'react'
import { listKbs } from '../api/client'
import type { Kb } from '../types'

const STORAGE_KEY = 'skb_active_kb'

export function useActiveKb() {
  const [kbs, setKbs]         = useState<Kb[]>([])
  const [activeId, setActiveId] = useState<string>(localStorage.getItem(STORAGE_KEY) ?? '')

  useEffect(() => {
    listKbs().then(data => {
      setKbs(data)
      if (!activeId && data.length > 0) setActiveId(data[0].id)
    }).catch(() => {})
  }, [activeId])

  const select = (id: string) => {
    setActiveId(id)
    localStorage.setItem(STORAGE_KEY, id)
  }

  const active = kbs.find(k => k.id === activeId) ?? null
  return { kbs, active, activeId, select, reload: () => listKbs().then(setKbs) }
}

export default function KbSelector() {
  const { kbs, activeId, select } = useActiveKb()

  if (kbs.length === 0) {
    return <span className="text-xs text-gray-400">No knowledge bases</span>
  }

  return (
    <select
      value={activeId}
      onChange={e => select(e.target.value)}
      className="text-sm border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
    >
      {kbs.map(kb => (
        <option key={kb.id} value={kb.id}>
          {kb.name}
        </option>
      ))}
    </select>
  )
}
