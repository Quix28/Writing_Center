import { useEffect, useRef, useState } from 'react'
import { EditorState, Transaction, type Extension } from '@codemirror/state'
import { EditorView, drawSelection, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { completionKeymap } from '@codemirror/autocomplete'
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { api, errorText } from './api'
import { toast } from './ui'
import { livePreview, markdownStyle } from './cm/livePreview'
import { wikilinkClick, wikilinkCompletion } from './cm/wikilinks'
import { harperLinter } from './cm/harper'
import { commentSpansField, spansField } from './cm/spans'
import { finishReview, inReview, isWriting, minimalChange, quiet, savedText, suggestExtensions } from './cm/suggest'

export { minimalChange }

const SAVE_DELAY = 500
const states = new Map<string, EditorState>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
/** Every mounted editor (one per pane showing a note) and the note it shows. */
const shown = new Map<EditorView, string>()
const reviewSetters = new Map<EditorView, (on: boolean) => void>()
/** The editor of the note the user is working in: Clawd, the panels and the commands act on it. */
let view: EditorView | null = null
let extensions: Extension[] = []
/** Fired on every keystroke-driven edit; Clawd taps along and restarts its idle timer. */
export const typingListeners = new Set<() => void>()
/** Receives the current note's text after each change (null when no note is shown); drives the word count. */
export const docListeners = new Set<(text: string | null) => void>()
const notifyDoc = (text: string | null) => docListeners.forEach((f) => f(text))

export const getView = () => view
/** ⌘F from anywhere in the app: opens find & replace in the open note. */
export const openFind = () => !!view && openSearchPanel(view)
/** Lets the headless e2e tests read the live document. */
Object.assign(window, { wcView: getView })
export const currentPath = () => (view && shown.get(view)) ?? null
const viewOf = (path: string) => [...shown].find(([, p]) => p === path)?.[0]

export function configureEditor(opts: { files: () => string[]; openLink: (target: string) => void; extra?: Extension[] }) {
  extensions = [
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    markdown({ base: markdownLanguage }),
    markdownStyle,
    livePreview,
    wikilinkCompletion(opts.files),
    wikilinkClick(opts.openLink),
    search({ top: true }),
    highlightSelectionMatches(),
    keymap.of([...completionKeymap, ...searchKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
    harperLinter,
    spansField,
    commentSpansField,
    suggestExtensions,
    EditorView.updateListener.of((u) => {
      const review = inReview(u.state)
      const path = shown.get(u.view)
      reviewSetters.get(u.view)?.(review)
      if (u.docChanged && u.view === view) notifyDoc(savedText(u.state))
      if (u.view === view && u.transactions.some((t) => t.isUserEvent('input') || t.isUserEvent('delete'))) typingListeners.forEach((f) => f())
      if (path && u.transactions.some((t) => !t.annotation(quiet) && (t.docChanged || (review && t.effects.length)))) schedule(path)
    }),
    ...(opts.extra ?? [])
  ]
}

const stateOf = (path: string) => viewOf(path)?.state ?? states.get(path)

function schedule(path: string) {
  clearTimeout(timers.get(path))
  timers.set(path, setTimeout(() => save(path), SAVE_DELAY))
}

async function save(path: string) {
  clearTimeout(timers.get(path))
  timers.delete(path)
  const s = stateOf(path)
  if (!s) return
  try {
    await api.vault.write(path, savedText(s))
  } catch (e) {
    toast(`Could not save ${path}: ${errorText(e)}. Your text is still in the editor.`)
    schedule(path)
  }
}

export const flush = (path: string) => (timers.has(path) ? save(path) : Promise.resolve())
/** Other views (canvas) register their pending saves here so window close flushes them too. */
export const extraFlushers = new Set<() => Promise<void>>()
export const flushAll = () => Promise.all([...[...timers.keys()].map(save), ...[...extraFlushers].map((f) => f())])
export const hasPending = () => timers.size > 0 || extraFlushers.size > 0
export const isPending = (path: string) => timers.has(path)
export const forgetDoc = (path: string) => states.delete(path)

export function applyExternal(path: string, content: string) {
  const s = stateOf(path)
  if (!s || s.doc.toString() === content) return
  const v = viewOf(path)
  if (timers.has(path) || inReview(s) || (v === view && isWriting())) {
    toast(`${path} changed on disk while you were editing. Keeping the version in the app.`)
    return
  }
  const spec = {
    changes: minimalChange(s.doc.toString(), content),
    annotations: [quiet.of(true), Transaction.addToHistory.of(false)]
  }
  if (v) v.dispatch(spec)
  else states.set(path, s.update(spec).state)
}

export async function closeDoc(path: string) {
  await flush(path)
  states.delete(path)
}

export async function renameDocs(from: string, to: string) {
  for (const p of [...states.keys(), ...timers.keys()]) if (p === from || p.startsWith(from + '/')) await flush(p)
  for (const [p, s] of [...states]) {
    if (p !== from && !p.startsWith(from + '/')) continue
    states.delete(p)
    states.set(to + p.slice(from.length), s)
  }
  for (const [v, p] of shown) if (p === from || p.startsWith(from + '/')) shown.set(v, to + p.slice(from.length))
}

/** Replaces the doc from outside the editor (e.g. Google Docs pull) as one undoable, autosaved change. */
export function replaceDoc(path: string, content: string) {
  const s = stateOf(path)
  if (!s) return
  const spec = { changes: minimalChange(s.doc.toString(), content) }
  const v = viewOf(path)
  if (v) v.dispatch(spec)
  else {
    states.set(path, s.update(spec).state)
    schedule(path)
  }
}

async function show(v: EditorView, path: string, focus: boolean) {
  const before = shown.get(v)
  if (before) states.set(before, v.state)
  if (!states.has(path)) states.set(path, EditorState.create({ doc: await api.vault.read(path), extensions }))
  shown.set(v, path)
  v.setState(states.get(path)!)
  reviewSetters.get(v)?.(inReview(v.state))
  if (v === view) notifyDoc(savedText(v.state))
  if (focus) v.focus()
}

/** One pane's editor. `active`: this pane holds the note the user is working in. */
export function Editor({ path, active }: { path: string; active: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const own = useRef<EditorView | null>(null)
  const [reviewing, setReviewing] = useState(false)

  useEffect(() => {
    const v = new EditorView({ parent: host.current! })
    own.current = v
    reviewSetters.set(v, setReviewing)
    return () => {
      const p = shown.get(v)
      if (p) states.set(p, v.state)
      shown.delete(v)
      reviewSetters.delete(v)
      if (view === v) {
        view = null
        notifyDoc(null)
      }
      v.destroy()
    }
  }, [])

  useEffect(() => {
    show(own.current!, path, active).catch((e) => toast(`Could not open ${path}: ${errorText(e)}`))
  }, [path])

  useEffect(() => {
    if (!active) return
    view = own.current
    if (shown.get(view!) === path) notifyDoc(savedText(view!.state))
  }, [active, path])

  return (
    <>
      {reviewing && (
        <div className="review-bar">
          Reviewing Claude's suggestions. Nothing is saved until you accept.
          <button onClick={() => own.current && finishReview(own.current, 'all')}>Accept all</button>
          <button onClick={() => own.current && finishReview(own.current, 'accepted')}>Reject remaining</button>
        </div>
      )}
      <div className="editor" ref={host} />
    </>
  )
}
