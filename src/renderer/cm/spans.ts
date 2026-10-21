import { StateEffect, StateField, type StateEffectType } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'

export type Span = { from: number; to: number; title?: string; cls?: string }

/** One highlight layer; ranges follow edits until replaced. Separate layers don't overwrite each other. */
function layer(defaultClass: string): { set: StateEffectType<Span[]>; field: StateField<DecorationSet> } {
  const set = StateEffect.define<Span[]>()
  const field = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(deco, tr) {
      deco = deco.map(tr.changes)
      for (const e of tr.effects)
        if (e.is(set))
          deco = Decoration.set(
            e.value
              // Ranges computed against another note (e.g. while switching notes) are dropped instead of crashing.
              .filter((s) => s.to > s.from && s.from >= 0 && s.to <= tr.state.doc.length)
              .map((s) => Decoration.mark({ class: s.cls ?? defaultClass, attributes: s.title ? { title: s.title } : {} }).range(s.from, s.to)),
            true
          )
      return deco
    },
    provide: (f) => EditorView.decorations.from(f)
  })
  return { set, field }
}

/** Review findings, Clawd's spots and AI check scores. */
const main = layer('cm-finding')
export const setSpans = main.set
export const spansField = main.field

/** Google Docs comments, kept apart so they stay visible alongside the other highlights. */
const comments = layer('cm-gcomment')
export const setCommentSpans = comments.set
export const commentSpansField = comments.field
