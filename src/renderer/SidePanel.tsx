import { useMemo, useState, type ReactNode } from 'react'
import { extractLinks, resolveLink } from '../shared/links'

export type PanelTab = { id: string; label: string; render: () => ReactNode }

export function Backlinks({ active, notes, files, onOpen }: { active: string | null; notes: Record<string, string>; files: string[]; onOpen: (p: string) => void }) {
  const sources = useMemo(
    () => (active ? Object.keys(notes).filter((f) => f !== active && extractLinks(notes[f]).some((t) => resolveLink(t, files) === active)) : []),
    [active, notes, files]
  )
  if (!active) return <p className="muted">No file open.</p>
  if (!sources.length) return <p className="muted">No backlinks to this note.</p>
  return (
    <ul className="link-list">
      {sources.map((s) => (
        <li key={s}>
          <a onClick={() => onOpen(s)}>{s.replace(/\.md$/, '')}</a>
        </li>
      ))}
    </ul>
  )
}

export function SidePanel({ tabs, selected, onSelect }: { tabs: PanelTab[]; selected?: string; onSelect?: (id: string) => void }) {
  const [own, setOwn] = useState(tabs[0]?.id)
  const id = selected ?? own
  const tab = tabs.find((t) => t.id === id) ?? tabs[0]
  return (
    <aside className="side">
      <div className="side-tabs">
        {tabs.map((t) => (
          <button key={t.id} className={t.id === tab?.id ? 'active' : ''} onClick={() => (onSelect ?? setOwn)(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="side-body">{tab?.render()}</div>
    </aside>
  )
}
