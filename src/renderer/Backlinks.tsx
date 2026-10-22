import { useMemo } from 'react'
import { extractLinks, resolveLink } from '../shared/links'

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
