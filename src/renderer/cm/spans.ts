import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'

export type Span = { from: number; to: number; title?: string; cls?: string }

export const setSpans = StateEffect.define<Span[]>()

/** Highlights for review findings and Clawd's spots; ranges follow edits until replaced. */
export const spansField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects)
      if (e.is(setSpans))
        deco = Decoration.set(
          e.value
            .filter((s) => s.to > s.from)
            .map((s) => Decoration.mark({ class: s.cls ?? 'cm-finding', attributes: s.title ? { title: s.title } : {} }).range(s.from, s.to)),
          true
        )
    return deco
  },
  provide: (f) => EditorView.decorations.from(f)
})
