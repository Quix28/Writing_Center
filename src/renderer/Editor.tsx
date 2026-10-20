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
import { spansField } from './cm/spans'
import { finishReview, inReview, isWriting, minimalChange, quiet, savedText, suggestExtensions } from './cm/suggest'

export { minimalChange }

const SAVE_DELAY = 500
const states = new Map<string, EditorState>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let view: EditorView | null = null
let current: string | null = null
let extensions: Extension[] = []
let notifyReview: (on: boolean) => void = () => {}
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
export const currentPath = () => current

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
    suggestExtensions,
    EditorView.updateListener.of((u) => {
      const review = inReview(u.state)
      notifyReview(review)
      if (u.docChanged) notifyDoc(savedText(u.state))
      if (u.transactions.some((t) => t.isUserEvent('input') || t.isUserEvent('delete'))) typingListeners.forEach((f) => f())
      if (current && u.transactions.some((t) => !t.annotation(quiet) && (t.docChanged || (review && t.effects.length)))) schedule(current)
    }),
    ...(opts.extra ?? [])
  ]
}

const stateOf = (path: string) => (path === current && view ? view.state : states.get(path))

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
  if (timers.has(path) || inReview(s) || (path === current && isWriting())) {
    toast(`${path} changed on disk while you were editing. Keeping the version in the app.`)
    return
  }
  const spec = {
    changes: minimalChange(s.doc.toString(), content),
    annotations: [quiet.of(true), Transaction.addToHistory.of(false)]
  }
  if (path === current && view) view.dispatch(spec)
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
  if (current && (current === from || current.startsWith(from + '/'))) current = to + current.slice(from.length)
}

/** Replaces the doc from outside the editor (e.g. Google Docs pull) as one undoable, autosaved change. */
export function replaceDoc(path: string, content: string) {
  const s = stateOf(path)
  if (!s) return
  const spec = { changes: minimalChange(s.doc.toString(), content) }
  if (path === current && view) view.dispatch(spec)
  else {
    states.set(path, s.update(spec).state)
    schedule(path)
  }
}

async function show(path: string) {
  if (current && view) states.set(current, view.state)
  if (!states.has(path)) states.set(path, EditorState.create({ doc: await api.vault.read(path), extensions }))
  current = path
  view?.setState(states.get(path)!)
  notifyReview(inReview(states.get(path)!))
  notifyDoc(savedText(states.get(path)!))
  view?.focus()
}

export function Editor({ path }: { path: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [reviewing, setReviewing] = useState(false)
  notifyReview = setReviewing

  useEffect(() => {
    view = new EditorView({ parent: host.current! })
    return () => {
      if (current && view) states.set(current, view.state)
      current = null
      notifyDoc(null)
      view?.destroy()
      view = null
    }
  }, [])

  useEffect(() => {
    show(path).catch((e) => toast(`Could not open ${path}: ${errorText(e)}`))
  }, [path])

  return (
    <>
      {reviewing && (
        <div className="review-bar">
          Reviewing Claude's suggestions. Nothing is saved until you accept.
          <button onClick={() => view && finishReview(view, 'all')}>Accept all</button>
          <button onClick={() => view && finishReview(view, 'accepted')}>Reject remaining</button>
        </div>
      )}
      <div className="editor" ref={host} />
    </>
  )
}
