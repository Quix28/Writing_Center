import { parser } from '@lezer/markdown'
import type { SyntaxNode } from '@lezer/common'
import type { docs_v1 } from '@googleapis/docs'
import { splitFrontmatter } from '../shared/frontmatter.ts'

type Run = { start: number; end: number; bold?: boolean; italic?: boolean; link?: string }
type Para = { text: string; style: string; list?: 'BULLET' | 'NUMBER'; depth: number; runs: Run[]; listId?: number }
type Marks = { bold?: boolean; italic?: boolean; link?: string }

const WIKILINK = /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g
const kids = (n: SyntaxNode) => {
  const out: SyntaxNode[] = []
  for (let c = n.firstChild; c; c = c.nextSibling) out.push(c)
  return out
}

/**
 * Converts markdown into Google Docs batchUpdate requests that fill an empty document body.
 * Keeps headings, bold, italic, links and (nested) lists; everything else becomes plain paragraphs.
 */
export function mdToDocs(markdown: string, tabId?: string): docs_v1.Schema$Request[] {
  const md = splitFrontmatter(markdown).body.replace(WIKILINK, (_, target: string, alias?: string) => alias ?? target)
  const tree = parser.parse(md)
  const paras: Para[] = []
  let listCounter = 0

  function inline(node: SyntaxNode, from: number, to: number, marks: Marks, p: Para) {
    let pos = from
    const emit = (raw: string, m: Marks) => {
      const text = raw.replace(/\n/g, ' ')
      const start = p.text.length
      p.text += text
      if ((m.bold || m.italic || m.link) && text) p.runs.push({ start, end: p.text.length, ...m })
    }
    for (const c of kids(node)) {
      if (c.to <= from || c.from >= to) continue
      if (c.from > pos) emit(md.slice(pos, c.from), marks)
      const marksOnly = (skip: string) => {
        let a = c.from
        for (const k of kids(c)) {
          if (k.name !== skip) continue
          if (k.from > a) inline(c, a, k.from, nextMarks, p)
          a = k.to
        }
        if (a < c.to) inline(c, a, c.to, nextMarks, p)
      }
      let nextMarks = marks
      switch (c.name) {
        case 'StrongEmphasis':
          nextMarks = { ...marks, bold: true }
          marksOnly('EmphasisMark')
          break
        case 'Emphasis':
          nextMarks = { ...marks, italic: true }
          marksOnly('EmphasisMark')
          break
        case 'Link': {
          const marksIn = kids(c).filter((k) => k.name === 'LinkMark')
          const url = kids(c).find((k) => k.name === 'URL')
          const labelFrom = marksIn[0]?.to ?? c.from
          const labelTo = marksIn[1]?.from ?? c.to
          inline(c, labelFrom, labelTo, url ? { ...marks, link: md.slice(url.from, url.to) } : marks, p)
          break
        }
        case 'URL':
        case 'Autolink': {
          const url = md.slice(c.from, c.to).replace(/^<|>$/g, '')
          emit(url, { ...marks, link: url })
          break
        }
        case 'Escape':
          emit(md.slice(c.from + 1, c.to), marks)
          break
        case 'InlineCode':
          emit(md.slice(c.from, c.to).replace(/^`+|`+$/g, ''), marks)
          break
        case 'Image': {
          const alt = kids(c).filter((k) => k.name === 'LinkMark')
          emit(md.slice(alt[0]?.to ?? c.from, alt[1]?.from ?? c.to), marks)
          break
        }
        case 'HardBreak':
          p.text += '\u000b'
          break
        case 'EmphasisMark':
        case 'HeaderMark':
        case 'QuoteMark':
        case 'ListMark':
          break
        default:
          inline(c, Math.max(c.from, from), Math.min(c.to, to), marks, p)
      }
      pos = c.to
    }
    if (pos < to) emit(md.slice(pos, to), marks)
  }

  function block(node: SyntaxNode, list?: { kind: 'BULLET' | 'NUMBER'; depth: number; id: number }) {
    const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(node.name)
    if (heading || node.name === 'Paragraph') {
      const p: Para = { text: '', style: heading ? `HEADING_${heading[1]}` : 'NORMAL_TEXT', depth: list?.depth ?? 0, runs: [], list: list?.kind, listId: list?.id }
      inline(node, node.from, node.to, {}, p)
      const lead = p.text.length - p.text.trimStart().length
      p.text = p.text.trim()
      p.runs = p.runs
        .map((r) => ({ ...r, start: Math.max(r.start - lead, 0), end: Math.min(r.end - lead, p.text.length) }))
        .filter((r) => r.end > r.start)
      paras.push(p)
      return
    }
    switch (node.name) {
      case 'BulletList':
      case 'OrderedList': {
        const kind = node.name === 'BulletList' ? 'BULLET' : 'NUMBER'
        const depth = list ? list.depth + 1 : 0
        const id = list?.id ?? ++listCounter
        for (const item of kids(node)) for (const c of kids(item)) if (c.name !== 'ListMark') block(c, { kind: list?.kind ?? kind, depth, id })
        return
      }
      case 'FencedCode':
      case 'CodeBlock': {
        const code = kids(node).find((k) => k.name === 'CodeText')
        for (const line of (code ? md.slice(code.from, code.to) : '').split('\n'))
          paras.push({ text: line, style: 'NORMAL_TEXT', depth: 0, runs: [] })
        return
      }
      case 'HorizontalRule':
      case 'LinkReference':
        return
      case 'Blockquote':
        for (const c of kids(node)) if (c.name !== 'QuoteMark') block(c, list)
        return
      default:
        if (node.firstChild && node.name !== 'HTMLBlock') for (const c of kids(node)) block(c, list)
        else paras.push({ text: md.slice(node.from, node.to).trim(), style: 'NORMAL_TEXT', depth: 0, runs: [] })
    }
  }

  for (const c of kids(tree.topNode)) block(c)
  while (paras.length && !paras[paras.length - 1].text) paras.pop()
  if (!paras.length) return []

  const requests: docs_v1.Schema$Request[] = []
  const starts: number[] = []
  let text = ''
  for (const p of paras) {
    if (text) text += '\n'
    starts.push(text.length + 1 + (p.list ? p.depth : 0))
    text += '\t'.repeat(p.list ? p.depth : 0) + p.text
  }
  /** Index of the document's final newline; ranges stop before it, as the Docs API requires. */
  const end = 1 + text.length
  const range = (startIndex: number, endIndex: number) => ({ startIndex, endIndex: Math.min(endIndex, end) })
  requests.push({ insertText: { location: { index: 1 }, text } })
  requests.push({ deleteParagraphBullets: { range: range(1, end) } })
  requests.push({ updateTextStyle: { range: range(1, end), textStyle: {}, fields: 'bold,italic,link' } })
  paras.forEach((p, i) => {
    const lineStart = starts[i] - (p.list ? p.depth : 0)
    requests.push({
      updateParagraphStyle: { range: range(lineStart, starts[i] + p.text.length + 1), paragraphStyle: { namedStyleType: p.style }, fields: 'namedStyleType' }
    })
    for (const r of p.runs) {
      const textStyle: docs_v1.Schema$TextStyle = {}
      const fields: string[] = []
      if (r.bold) (textStyle.bold = true), fields.push('bold')
      if (r.italic) (textStyle.italic = true), fields.push('italic')
      if (r.link) (textStyle.link = { url: r.link }), fields.push('link')
      requests.push({ updateTextStyle: { range: range(starts[i] + r.start, starts[i] + r.end), textStyle, fields: fields.join(',') } })
    }
  })
  // Bullets last and back-to-front: the request strips the leading tabs, which shifts every later index.
  const groups: { from: number; to: number; kind: 'BULLET' | 'NUMBER' }[] = []
  paras.forEach((p, i) => {
    if (!p.list) return
    const lineStart = starts[i] - p.depth
    const last = groups[groups.length - 1]
    if (last && paras[i - 1]?.listId === p.listId) last.to = starts[i] + p.text.length
    else groups.push({ from: lineStart, to: starts[i] + p.text.length, kind: p.list })
  })
  for (const g of groups.reverse())
    requests.push({
      createParagraphBullets: { range: range(g.from, g.to + 1), bulletPreset: g.kind === 'BULLET' ? 'BULLET_DISC_CIRCLE_SQUARE' : 'NUMBERED_DECIMAL_ALPHA_ROMAN' }
    })
  return tabId ? requests.map((r) => inTab(r, tabId)) : requests
}

/** Points every location and range of a request at one document tab, so other tabs are never touched. */
function inTab(request: docs_v1.Schema$Request, tabId: string): docs_v1.Schema$Request {
  const out: Record<string, Record<string, unknown>> = {}
  for (const [kind, body] of Object.entries(request) as [string, Record<string, unknown>][]) {
    const b = { ...body }
    if (b.location) b.location = { ...(b.location as object), tabId }
    if (b.range) b.range = { ...(b.range as object), tabId }
    out[kind] = b
  }
  return out as docs_v1.Schema$Request
}
