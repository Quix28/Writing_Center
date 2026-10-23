import { useEffect, useState } from 'react'
import type { ConnectionState } from './Connections'
import { docListeners, selectionListeners } from './Editor'
import { Icon } from './icons'
import { LiveBadge, gdocs } from './GDocs'

const countWords = (text: string) => (text.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length

function WordCount() {
  const [words, setWords] = useState<number | null>(null)
  const [selected, setSelected] = useState(0)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const update = (text: string | null) => {
      clearTimeout(timer)
      timer = setTimeout(() => setWords(text === null ? null : countWords(text)), 250)
    }
    const select = (text: string) => setSelected(countWords(text))
    docListeners.add(update)
    selectionListeners.add(select)
    return () => {
      clearTimeout(timer)
      docListeners.delete(update)
      selectionListeners.delete(select)
    }
  }, [])
  if (words === null) return null
  const label = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'word' : 'words'}`
  return <span className="status-item muted">{selected ? `${selected.toLocaleString()} of ${label(words)} selected` : label(words)}</span>
}

export function StatusBar(p: { conn: ConnectionState; clawdOn: boolean; onClawd: () => void; onConnections: () => void; onPalette: () => void }) {
  const claude = p.conn.claude
  const google = p.conn.google
  const dot = (ok: boolean | undefined) => <span className={`dot ${ok === undefined ? 'pending' : ok ? 'ok' : 'off'}`} />
  return (
    <footer className="statusbar">
      <button className="status-item" onClick={p.onConnections} title="Open Connections">
        {dot(claude?.ok)} Claude{claude && !claude.ok ? (claude.method === 'none' ? ': not connected' : ': needs attention') : ''}
      </button>
      <button className="status-item" onClick={p.onConnections} title="Open Connections">
        {dot(google?.connected)} Google Docs{google && !google.connected ? ': not connected' : ''}
      </button>
      <LiveBadge onClick={gdocs.toggleLive} />
      <span className="status-spacer" />
      <WordCount />
      <button className="status-item clawd-toggle" onClick={p.onClawd} aria-pressed={p.clawdOn} title="Show or hide Clawd, the review companion">
        Clawd {p.clawdOn ? 'on' : 'off'}
      </button>
      <button className="status-item" onClick={p.onPalette} title="Command palette">
        <Icon name="command" size={13} /> P
      </button>
    </footer>
  )
}
