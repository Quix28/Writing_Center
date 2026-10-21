import { useEffect, useState } from 'react'
import { api, errorText, type DocComment } from './api'
import { currentPath, getView } from './Editor'
import { setCommentSpans } from './cm/spans'
import { getKey } from '../shared/frontmatter'
import { placeComments, type PlacedComment } from '../shared/comments'

type Loaded = { path: string; placed: PlacedComment[]; unplaced: DocComment[]; tabbed: boolean }

const when = (iso: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

/** Google Docs comments for the linked Doc (or tab), shown read-only and highlighted on the passages they quote. */
export function CommentsPanel({ path, visible }: { path: string | null; visible: boolean }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showResolved, setShowResolved] = useState(false)
  const view = getView()
  const md = view?.state.doc.toString() ?? ''
  const docId = path?.match(/\.(md|txt)$/) ? getKey(md, 'gdoc_id') : undefined

  const load = async (attempt = 0): Promise<void> => {
    const v = getView()
    if (!v || !path || !docId) return setLoaded(null)
    // The editor loads a newly opened note a moment later; place comments only on that note's text.
    if (currentPath() !== path) return attempt < 20 ? void setTimeout(() => load(attempt + 1), 100) : undefined
    setBusy(true)
    setError(null)
    try {
      const text = v.state.doc.toString()
      const { placed, unplaced } = placeComments(text, await api.gdocs.comments(docId))
      setLoaded({ path, placed, unplaced, tabbed: !!getKey(text, 'gdoc_tab') })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (visible) load()
  }, [visible, path, docId])

  const shown = loaded?.path === path ? loaded : null
  const visibleComments = shown?.placed.filter((c) => showResolved || !c.resolved) ?? []

  useEffect(() => {
    if (currentPath() !== path) return
    getView()?.dispatch({ effects: setCommentSpans.of(visibleComments.map((c) => ({ from: c.from, to: c.to, title: `${c.author}: ${c.content}` }))) })
  }, [shown, showResolved])

  const jump = (c: PlacedComment) => {
    const v = getView()
    if (!v) return
    v.dispatch({ selection: { anchor: c.from, head: c.to }, scrollIntoView: true })
    v.focus()
  }

  if (!docId) return <p className="muted">Link this note to a Google Doc (⌘P → Google Docs) to see its comments here.</p>
  const resolvedCount = shown?.placed.filter((c) => c.resolved).length ?? 0
  return (
    <div className="comments">
      <div className="comments-bar">
        <button onClick={() => load()} disabled={busy}>{busy ? 'Loading…' : 'Refresh'}</button>
        {resolvedCount > 0 && (
          <label className="muted small">
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Show {resolvedCount} resolved
          </label>
        )}
      </div>
      {error && <p className="error-text">{error}</p>}
      {shown && !visibleComments.length && <p className="muted">No open comments on this {shown.tabbed ? 'tab' : 'document'}.</p>}
      {visibleComments.map((c) => (
        <div key={c.id} className={`gcomment ${c.resolved ? 'resolved' : ''}`}>
          <div className="gcomment-head">
            <strong>{c.author}</strong>
            <span className="muted small">{when(c.created)}{c.resolved ? ', resolved' : ''}</span>
          </div>
          <blockquote onClick={() => jump(c)} title="Show in the note">{c.quote}</blockquote>
          <p>{c.content}</p>
          {c.replies.map((r, i) => (
            <div key={i} className="gcomment-reply">
              <strong>{r.author}</strong> <span className="muted small">{when(r.created)}</span>
              <p>{r.content}</p>
            </div>
          ))}
        </div>
      ))}
      {shown && shown.unplaced.length > 0 && (
        <p className="muted small">
          {shown.tabbed
            ? `${shown.unplaced.length} other comment(s) in this Doc are on other tabs, or on text that has changed.`
            : `${shown.unplaced.length} comment(s) are on text that is no longer in this note.`}
        </p>
      )}
      <p className="muted small">Comments are read from Google Docs and never written into your note. Reply to them in Google Docs.</p>
    </div>
  )
}
