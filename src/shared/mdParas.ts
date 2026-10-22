import { parser as commonmark, Strikethrough, Table } from '@lezer/markdown'
import type { SyntaxNode } from '@lezer/common'
import { splitFrontmatter } from './frontmatter.ts'

export type Marks = { bold?: boolean; italic?: boolean; strike?: boolean; link?: string }
type Run = Marks & { start: number; end: number }
export type ListKind = 'BULLET' | 'NUMBER'
export type Para = { text: string; style: string; list?: ListKind; depth: number; runs: Run[]; listId?: number }

const parser = commonmark.configure([Strikethrough, Table])
const WIKILINK = /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g
const kids = (n: SyntaxNode) => {
  const out: SyntaxNode[] = []
  for (let c = n.firstChild; c; c = c.nextSibling) out.push(c)
  return out
}

/** Markdown → paragraphs with headings, bold, italic, strikethrough, links and (nested) lists; tables are left out. */
export function parseParas(markdown: string): Para[] {
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
      if ((m.bold || m.italic || m.strike || m.link) && text) p.runs.push({ start, end: p.text.length, ...m })
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
        case 'Strikethrough':
          nextMarks = { ...marks, strike: true }
          marksOnly('StrikethroughMark')
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

  function block(node: SyntaxNode, list?: { kind: ListKind; depth: number; id: number }) {
    const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(node.name)
    if (heading || node.name === 'Paragraph') {
      const p: Para = { text: '', style: heading ? `HEADING_${heading[1]}` : 'NORMAL_TEXT', depth: list?.depth ?? 0, runs: [], list: list?.kind, listId: list?.id }
      inline(node, node.from, node.to, {}, p)
      trim(p)
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
      // Tables stay as they are in Google Docs: the API can't rebuild one from text without losing it.
      case 'Table':
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
  return paras
}

/** Trims the paragraph text, keeping mark runs on the same characters. */
export function trim(p: Para) {
  const lead = p.text.length - p.text.trimStart().length
  p.text = p.text.trim()
  p.runs = p.runs
    .map((r) => ({ ...r, start: Math.max(r.start - lead, 0), end: Math.min(r.end - lead, p.text.length) }))
    .filter((r) => r.end > r.start)
}

/** Longest common subsequence of two key lists, as matched index pairs. */
export function lcs(a: string[], b: string[]): [number, number][] {
  // ponytail: O(n·m) table, fine for essays and long notes (a few thousand paragraphs); switch to Myers diff beyond that.
  const t = Array.from({ length: a.length + 1 }, () => new Int32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1])
  const out: [number, number][] = []
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) out.push([i++, j++])
    else if (t[i + 1][j] >= t[i][j + 1]) i++
    else j++
  }
  return out
}

/** What a Google Doc can hold of the markdown: paragraph text, styles, lists and marks (not its syntax or blank lines). */
const content = (md: string) => JSON.stringify(parseParas(md).filter((p) => p.text).map(({ text, style, list, depth, runs }) => ({ text, style, list, depth, runs })))
export const sameContent = (a: string, b: string) => content(a) === content(b)

/** Top-level markdown blocks (paragraph, heading, whole list, table…) with their source text. */
function blocks(md: string) {
  const out: { source: string; key: string }[] = []
  for (let n = parser.parse(md).topNode.firstChild; n; n = n.nextSibling) {
    const source = md.slice(n.from, n.to)
    const paras = content(source)
    out.push({ source, key: paras === '[]' ? 'raw:' + source.trim() : paras })
  }
  return out
}

/**
 * Brings a Google Doc's edits into an unchanged note: blocks the Doc still holds as they were keep the note's own
 * source (wikilinks, emphasis style, list markers); only blocks that differ come in as Google's markdown.
 */
export function mergeRemote(local: string, remote: string): string {
  const mine = blocks(local)
  const theirs = blocks(remote)
  const kept = new Map(lcs(mine.map((b) => b.key), theirs.map((b) => b.key)).map(([i, j]) => [j, mine[i].source]))
  return theirs.map((b, j) => kept.get(j) ?? b.source).join('\n\n') + '\n'
}
