import { syntaxTree, HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import type { Range } from '@codemirror/state'
import { tags as t } from '@lezer/highlight'

/** CSS-hidden instead of Decoration.replace: replaced ranges add widget buffers that create stray line breaks. */
const hide = Decoration.mark({ class: 'cm-hidden' })
const frontmatterLine = Decoration.line({ class: 'cm-frontmatter' })
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/
const wikilink = Decoration.mark({ class: 'cm-wikilink' })
const WIKILINK = /\[\[([^\]|\n]+?)(\|[^\]\n]*)?\]\]/g
const HIDDEN_MARKS = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark', 'LinkMark', 'URL', 'LinkTitle'])

function activeLines(view: EditorView): Set<number> {
  const lines = new Set<number>()
  for (const r of view.state.selection.ranges) {
    const [a, b] = [view.state.doc.lineAt(r.from).number, view.state.doc.lineAt(r.to).number]
    for (let n = a; n <= b; n++) lines.add(n)
  }
  return lines
}

/** Obsidian-style live preview: markdown syntax is hidden everywhere except the lines holding the cursor. */
function build(view: EditorView): DecorationSet {
  const decos: Range<Decoration>[] = []
  const active = activeLines(view)
  const doc = view.state.doc
  const isActive = (pos: number) => active.has(doc.lineAt(pos).number)
  // YAML frontmatter (e.g. gdoc_id) would otherwise parse as a setext heading; show it as plain metadata.
  const fmEnd = FRONTMATTER.exec(doc.sliceString(0, 5000))?.[0].length ?? 0
  for (let pos = 0; pos < fmEnd; ) {
    const line = doc.lineAt(pos)
    decos.push(frontmatterLine.range(line.from))
    pos = line.to + 1
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name === 'FencedCode' || node.to <= fmEnd) return false
        if (isActive(node.from)) return
        if (node.name === 'HeaderMark') {
          const end = doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to
          decos.push(hide.range(node.from, end))
        } else if (HIDDEN_MARKS.has(node.name) && node.to > node.from) {
          const parent = node.node.parent?.name
          if ((node.name === 'URL' || node.name === 'LinkMark' || node.name === 'LinkTitle') && parent !== 'Link') return
          decos.push(hide.range(node.from, node.to))
        }
      }
    })
    const text = doc.sliceString(from, to)
    for (const m of text.matchAll(WIKILINK)) {
      const start = from + m.index!
      const end = start + m[0].length
      if (start < fmEnd) continue
      if (isActive(start)) {
        decos.push(wikilink.range(start, end))
        continue
      }
      const labelFrom = m[2] ? start + 2 + m[1].length + 1 : start + 2
      decos.push(hide.range(start, labelFrom), wikilink.range(labelFrom, end - 2), hide.range(end - 2, end))
    }
  }
  return Decoration.set(decos, true)
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = build(view)
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state))
        this.decorations = build(u.view)
    }
  },
  { decorations: (v) => v.decorations }
)

export const markdownStyle = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.heading1, fontSize: '1.75em', fontWeight: '600', fontFamily: 'var(--ui)', letterSpacing: '-0.01em' },
    { tag: t.heading2, fontSize: '1.38em', fontWeight: '600', fontFamily: 'var(--ui)' },
    { tag: t.heading3, fontSize: '1.15em', fontWeight: '600', fontFamily: 'var(--ui)' },
    { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '600', fontFamily: 'var(--ui)' },
    { tag: t.strong, fontWeight: '700' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.strikethrough, textDecoration: 'line-through' },
    { tag: t.link, color: 'var(--accent)' },
    { tag: t.url, color: 'var(--muted)' },
    { tag: t.monospace, fontFamily: 'var(--mono)', color: 'var(--code)' },
    { tag: t.quote, color: 'var(--muted)', fontStyle: 'italic' },
    { tag: [t.processingInstruction, t.meta], color: 'var(--muted)' }
  ])
)
