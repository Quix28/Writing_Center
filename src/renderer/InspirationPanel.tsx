import type { Inspiration } from './api'

export type InspirationState = { passage: string; items?: Inspiration[]; error?: string }

const domain = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function InspirationPanel({ state }: { state: InspirationState | null }) {
  if (!state) return <p className="muted">Ask Clawd to “Find inspiration” on a passage. Every item links to a page Claude actually found with web search.</p>
  return (
    <div className="inspiration">
      <blockquote className="muted">{state.passage}</blockquote>
      {!state.items && !state.error && <p className="muted">Searching the web…</p>}
      {state.error && <p className="muted">{state.error}</p>}
      {state.items?.map((i) => (
        <div key={i.url} className="inspo-item">
          <a href={i.url} target="_blank" rel="noreferrer">{i.title}</a>
          <span className="muted small">{domain(i.url)}</span>
          <p>{i.why}</p>
        </div>
      ))}
    </div>
  )
}
