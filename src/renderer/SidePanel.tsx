import { useMemo, useState, type ReactNode } from 'react'
import { extractLinks, resolveLink } from '../shared/links'

export type PanelTab = { id: string; label: string; render: (visible: boolean) => ReactNode }

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

/** A tab is created the first time it is opened, then kept (just hidden), so chats, results and the terminal survive switching tabs. */
export function SidePanel({ tabs, selected, onSelect, hidden, width, onResize }: { tabs: PanelTab[]; selected?: string; onSelect?: (id: string) => void; hidden?: boolean; width: number; onResize: (w: number) => void }) {
  const [own, setOwn] = useState(tabs[0]?.id)
  const [dragging, setDragging] = useState(false)
  const id = selected ?? own
  const current = tabs.find((t) => t.id === id) ?? tabs[0]
  const [opened, setOpened] = useState<Set<string>>(() => new Set())
  if (current && !opened.has(current.id)) setOpened(new Set(opened).add(current.id))

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    const move = (ev: MouseEvent) => onResize(Math.min(Math.max(window.innerWidth - ev.clientX, 280), Math.max(window.innerWidth - 600, 280)))
    const up = () => {
      setDragging(false)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <aside className="side" hidden={hidden} style={{ width }}>
      <div className={`side-resize ${dragging ? 'dragging' : ''}`} onMouseDown={startDrag} title="Drag to resize" />
      <div className="side-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === current?.id} className={t.id === current?.id ? 'active' : ''} onClick={() => (onSelect ?? setOwn)(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="side-body">
        {tabs.map((t) =>
          opened.has(t.id) || t.id === current?.id ? (
            <div key={t.id} className="side-pane" hidden={t.id !== current?.id}>
              {t.render(!hidden && t.id === current?.id)}
            </div>
          ) : null
        )}
      </div>
    </aside>
  )
}
