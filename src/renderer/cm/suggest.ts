import { Annotation, Compartment, EditorState, StateEffect, StateField, Transaction, type Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { getChunks, getOriginalDoc, unifiedMergeView } from '@codemirror/merge'

/** Transactions marked quiet are never autosaved (diff setup/teardown, partial streaming output). */
export const quiet = Annotation.define<boolean>()
const noHistory = Transaction.addToHistory.of(false)
const merge = new Compartment()
const lock = new Compartment()
const setReview = StateEffect.define<string | null>()

/** Holds the pre-suggestion document while a suggest-mode diff is on screen. */
export const reviewField = StateField.define<string | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setReview)) v = e.value
    return v
  }
})

export const inReview = (s: EditorState) => s.field(reviewField, false) != null

/** What goes to disk: during a review only the accepted hunks, never the raw proposal. */
export const savedText = (s: EditorState) => (inReview(s) ? getOriginalDoc(s).toString() : s.doc.toString())

/** Smallest single replacement turning `a` into `b`, so cursor and undo history survive. */
export function minimalChange(a: string, b: string) {
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  let s = 0
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
  return { from: p, to: a.length - s, insert: b.slice(p, b.length - s) }
}

/** Shows `proposed` as an inline diff with Accept/Reject per hunk. The file on disk is untouched until hunks are accepted. */
export function propose(view: EditorView, proposed: string): boolean {
  if (inReview(view.state) || writing) return false
  const doc0 = view.state.doc.toString()
  if (doc0 === proposed) return false
  view.dispatch({
    changes: minimalChange(doc0, proposed),
    effects: [setReview.of(doc0), merge.reconfigure(unifiedMergeView({ original: doc0, gutter: true, allowInlineDiffs: true, mergeControls: true }))],
    annotations: [noHistory, quiet.of(true)]
  })
  return true
}

/** Leaves the diff. Accepted changes land as one undoable edit. */
export function finishReview(view: EditorView, take: 'all' | 'accepted') {
  const s = view.state
  const doc0 = s.field(reviewField, false)
  if (doc0 == null) return
  const final = take === 'all' ? s.doc.toString() : getOriginalDoc(s).toString()
  view.dispatch({
    changes: minimalChange(s.doc.toString(), doc0),
    effects: [setReview.of(null), merge.reconfigure([])],
    annotations: [noHistory, quiet.of(true)]
  })
  if (final !== doc0) view.dispatch({ changes: minimalChange(doc0, final) })
}

const autoFinish = EditorView.updateListener.of((u) => {
  if (!inReview(u.state) || getChunks(u.state)?.chunks.length !== 0) return
  setTimeout(() => {
    if (inReview(u.view.state) && getChunks(u.view.state)?.chunks.length === 0) finishReview(u.view, 'accepted')
  })
})

export const suggestExtensions = [merge.of([]), lock.of([]), reviewField, autoFinish]

let writing = false
export const isWriting = () => writing

/**
 * Write mode: streams Claude's text over [from, to) live, then collapses it into a single undoable
 * transaction. On failure the original passage is restored, so nothing is lost.
 */
export async function streamInto(view: EditorView, from: number, to: number, run: (onText: (t: string) => void) => Promise<string>) {
  if (writing || inReview(view.state)) throw new Error('Finish the current suggestion or rewrite first.')
  writing = true
  const original = view.state.sliceDoc(from, to)
  let end = to
  let started = false
  const quietly = { annotations: [noHistory, quiet.of(true)] }
  view.dispatch({ effects: lock.reconfigure(EditorState.readOnly.of(true)) })
  try {
    const final = await run((t) => {
      view.dispatch({ changes: started ? { from: end, insert: t } : { from, to: end, insert: t }, ...quietly })
      end = (started ? end : from) + t.length
      started = true
    })
    view.dispatch({ changes: { from, to: end, insert: original }, ...quietly })
    view.dispatch({ changes: { from, to, insert: final }, selection: { anchor: from, head: from + final.length } })
  } catch (e) {
    view.dispatch({ changes: { from, to: end, insert: original }, ...quietly })
    throw e
  } finally {
    writing = false
    view.dispatch({ effects: lock.reconfigure([]) })
  }
}

/** Selection if any, else the ##-or-deeper section under the cursor, else the paragraph. A # heading is the note's title, not a section. */
export function targetRange(state: EditorState): { from: number; to: number } {
  const sel = state.selection.main
  if (!sel.empty) return { from: sel.from, to: sel.to }
  const doc: Text = state.doc
  const line = doc.lineAt(sel.head)
  const level = (n: number) => /^(#{1,6})\s/.exec(doc.line(n).text)?.[1].length ?? 0
  let start = line.number
  while (start > 1 && !level(start)) start--
  if (level(start) >= 2) {
    let next = start + 1
    while (next <= doc.lines && !(level(next) && level(next) <= level(start))) next++
    let last = next - 1
    while (last > start && !doc.line(last).text.trim()) last--
    return { from: doc.line(start).from, to: doc.line(last).to }
  }
  let a = line.number
  let b = line.number
  while (a > 1 && doc.line(a - 1).text.trim()) a--
  while (b < doc.lines && doc.line(b + 1).text.trim()) b++
  return { from: doc.line(a).from, to: doc.line(b).to }
}

/** Applies Claude's find/replace edits in order; edits whose text is not found are counted, not guessed. */
export function applyEdits(doc: string, edits: { find: string; replace: string }[]): { text: string; missed: number } {
  let text = doc
  let missed = 0
  for (const e of edits) {
    const i = e.find ? text.indexOf(e.find) : -1
    if (i < 0) missed++
    else text = text.slice(0, i) + e.replace + text.slice(i + e.find.length)
  }
  return { text, missed }
}
