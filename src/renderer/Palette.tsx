import { useMemo, useState } from 'react'

export type Command = { label: string; run: () => void }

export function Palette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const matches = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return commands.filter((c) => words.every((w) => c.label.toLowerCase().includes(w))).slice(0, 50)
  }, [query, commands])

  const run = (c?: Command) => {
    if (!c) return
    onClose()
    c.run()
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          placeholder="Type a command or file name…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIndex(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            else if (e.key === 'ArrowDown') setIndex((i) => Math.min(i + 1, matches.length - 1))
            else if (e.key === 'ArrowUp') setIndex((i) => Math.max(i - 1, 0))
            else if (e.key === 'Enter') run(matches[index])
            else return
            e.preventDefault()
          }}
        />
        <ul>
          {matches.map((c, i) => (
            <li key={c.label} className={i === index ? 'selected' : ''} onMouseEnter={() => setIndex(i)} onClick={() => run(c)}>
              {c.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
