import { useEffect, useState } from 'react'
import { api, errorText, type Finding } from './api'
import { toast } from './ui'
import { getView } from './Editor'
import { setSpans } from './cm/spans'
import { propose } from './cm/suggest'

type Located = Finding & { found: boolean }

export function ReviewPanel({ path, trigger }: { path: string | null; trigger: number }) {
  const [result, setResult] = useState<{ path: string; findings: Located[] } | null>(null)
  const [busy, setBusy] = useState(false)

  const highlight = (findings: Located[]) => {
    const view = getView()
    if (!view) return
    const doc = view.state.doc.toString()
    const spans = findings.flatMap((f) => {
      const i = doc.indexOf(f.quote)
      return i < 0 ? [] : [{ from: i, to: i + f.quote.length, title: `${f.category}: ${f.issue}` }]
    })
    view.dispatch({ effects: setSpans.of(spans) })
  }

  const run = async () => {
    const view = getView()
    if (!view || !path?.endsWith('.md')) return toast('Open a note to review it.')
    setBusy(true)
    try {
      const doc = view.state.doc.toString()
      const findings = (await api.claude.review(path, doc)).map((f) => ({ ...f, found: !!f.quote && doc.includes(f.quote) }))
      setResult({ path, findings })
      highlight(findings)
    } catch (e) {
      toast(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (trigger) run()
  }, [trigger])

  useEffect(() => {
    if (result && result.path === path) setTimeout(() => highlight(result.findings), 50)
  }, [path])

  const jump = (f: Located) => {
    const view = getView()
    const i = view?.state.doc.toString().indexOf(f.quote) ?? -1
    if (!view || i < 0) return toast('That text is no longer in the note.')
    view.dispatch({ selection: { anchor: i, head: i + f.quote.length }, scrollIntoView: true })
    view.focus()
  }

  const fix = (f: Located) => {
    const view = getView()
    const doc = view?.state.doc.toString() ?? ''
    const i = doc.indexOf(f.quote)
    if (!view || i < 0) return toast('That text is no longer in the note.')
    if (!propose(view, doc.slice(0, i) + f.replacement + doc.slice(i + f.quote.length))) toast('Finish the open suggestion first.')
  }

  const findings = result?.path === path ? result.findings : null
  return (
    <div className="review">
      <button onClick={run} disabled={busy}>{busy ? 'Reviewing…' : 'Review content'}</button>
      {findings && !findings.length && <p className="muted">No findings. Nice.</p>}
      {findings?.map((f, i) => (
        <div key={i} className={`finding ${f.found ? '' : 'stale'}`}>
          <span className="badge">{f.category}</span>
          <blockquote onClick={() => jump(f)} title="Show in editor">{f.quote}</blockquote>
          <p>{f.issue}</p>
          <p className="muted">{f.suggestion}</p>
          {f.found ? <button onClick={() => fix(f)}>Propose fix</button> : <p className="muted">Quoted text not found in the note.</p>}
        </div>
      ))}
    </div>
  )
}
