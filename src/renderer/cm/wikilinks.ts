import { autocompletion, type CompletionContext } from '@codemirror/autocomplete'
import { EditorView } from '@codemirror/view'

const LINK_AT = /\[\[([^\]|\n]+)(?:\|[^\]\n]*)?\]\]/g

export function wikilinkCompletion(files: () => string[]) {
  return autocompletion({
    override: [
      (ctx: CompletionContext) => {
        const m = ctx.matchBefore(/\[\[[^\]\n]*/)
        if (!m) return null
        const closed = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2) === ']]'
        return {
          from: m.from + 2,
          validFor: /^[^\]\n]*$/,
          options: files()
            .filter((f) => f.endsWith('.md'))
            .map((f) => {
              const stem = f.slice(0, -3)
              const name = stem.split('/').pop()!
              return { label: name, detail: stem.includes('/') ? stem : undefined, apply: closed ? name : `${name}]]` }
            })
        }
      }
    ]
  })
}

function linkAt(view: EditorView, pos: number): string | null {
  const line = view.state.doc.lineAt(pos)
  for (const m of line.text.matchAll(LINK_AT)) {
    const start = line.from + m.index!
    if (pos >= start && pos <= start + m[0].length) return m[1].trim()
  }
  return null
}

/** Cmd/Ctrl+click opens a link anywhere; a plain click opens it when it is rendered (cursor elsewhere). */
export function wikilinkClick(open: (target: string) => void) {
  return EditorView.domEventHandlers({
    mousedown(e, view) {
      const rendered = (e.target as HTMLElement).closest('.cm-wikilink')
      const pos = view.posAtCoords(e)
      if (pos === null || !(e.metaKey || e.ctrlKey || rendered)) return false
      const onCursorLine = view.state.doc.lineAt(view.state.selection.main.head).number === view.state.doc.lineAt(pos).number
      if (!(e.metaKey || e.ctrlKey) && onCursorLine) return false
      const target = linkAt(view, pos)
      if (!target) return false
      e.preventDefault()
      open(target)
      return true
    }
  })
}
