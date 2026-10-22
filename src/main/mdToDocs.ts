import { parser as commonmark, Strikethrough, Table } from '@lezer/markdown'
import type { SyntaxNode } from '@lezer/common'
import type { docs_v1 } from '@googleapis/docs'
import { splitFrontmatter } from '../shared/frontmatter.ts'
import { isOrdered } from './docsToMd.ts'

type Request = docs_v1.Schema$Request
type Marks = { bold?: boolean; italic?: boolean; strike?: boolean; link?: string }
type Run = Marks & { start: number; end: number }
type ListKind = 'BULLET' | 'NUMBER'
export type Para = { text: string; style: string; list?: ListKind; depth: number; runs: Run[]; listId?: number }

const parser = commonmark.configure([Strikethrough, Table])
const WIKILINK = /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g
const PRESET: Record<ListKind, string> = { BULLET: 'BULLET_DISC_CIRCLE_SQUARE', NUMBER: 'NUMBERED_DECIMAL_ALPHA_ROMAN' }
const MARK_FIELDS = 'bold,italic,strikethrough,link'
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
function trim(p: Para) {
  const lead = p.text.length - p.text.trimStart().length
  p.text = p.text.trim()
  p.runs = p.runs
    .map((r) => ({ ...r, start: Math.max(r.start - lead, 0), end: Math.min(r.end - lead, p.text.length) }))
    .filter((r) => r.end > r.start)
}

function markStyle(r: Marks): { textStyle: docs_v1.Schema$TextStyle; fields: string } {
  const textStyle: docs_v1.Schema$TextStyle = {}
  const fields: string[] = []
  if (r.bold) (textStyle.bold = true), fields.push('bold')
  if (r.italic) (textStyle.italic = true), fields.push('italic')
  if (r.strike) (textStyle.strikethrough = true), fields.push('strikethrough')
  if (r.link) (textStyle.link = { url: r.link }), fields.push('link')
  return { textStyle, fields: fields.join(',') }
}

/**
 * Requests inserting `paras` as new paragraphs at index `at`. `lead`/`trail` are the newline that splits them off the
 * paragraph they are inserted into; `atEnd` means they end at the segment's final newline, which ranges must not include.
 */
function insertParas(paras: Para[], at: number, lead = '', trail = '', atEnd = true): Request[] {
  const base = at + lead.length
  const starts: number[] = []
  let text = ''
  for (const p of paras) {
    if (starts.length) text += '\n'
    starts.push(base + text.length + (p.list ? p.depth : 0))
    text += '\t'.repeat(p.list ? p.depth : 0) + p.text
  }
  /** Index of the newline closing the last inserted paragraph. */
  const end = base + text.length
  const range = (startIndex: number, endIndex: number) => ({ startIndex, endIndex: atEnd ? Math.min(endIndex, end) : endIndex })
  const requests: Request[] = [
    { insertText: { location: { index: at }, text: lead + text + trail } },
    { deleteParagraphBullets: { range: range(base, end) } },
    { updateTextStyle: { range: range(base, end), textStyle: {}, fields: MARK_FIELDS } }
  ]
  paras.forEach((p, i) => {
    const lineStart = starts[i] - (p.list ? p.depth : 0)
    requests.push({
      updateParagraphStyle: { range: range(lineStart, starts[i] + p.text.length + 1), paragraphStyle: { namedStyleType: p.style }, fields: 'namedStyleType' }
    })
    for (const r of p.runs) requests.push({ updateTextStyle: { range: range(starts[i] + r.start, starts[i] + r.end), ...markStyle(r) } })
  })
  // Bullets last and back-to-front: the request strips the leading tabs, which shifts every later index.
  const groups: { from: number; to: number; kind: ListKind }[] = []
  paras.forEach((p, i) => {
    if (!p.list) return
    const lineStart = starts[i] - p.depth
    const last = groups[groups.length - 1]
    if (last && paras[i - 1]?.listId === p.listId) last.to = starts[i] + p.text.length
    else groups.push({ from: lineStart, to: starts[i] + p.text.length, kind: p.list })
  })
  for (const g of groups.reverse()) requests.push({ createParagraphBullets: { range: range(g.from, g.to + 1), bulletPreset: PRESET[g.kind] } })
  return requests
}

/** Requests that fill an EMPTY document body (or tab) with the markdown. */
export function mdToDocs(markdown: string, tabId?: string): Request[] {
  const paras = parseParas(markdown)
  return inTab(paras.length ? insertParas(paras, 1) : [], tabId)
}

/** A paragraph of the Doc with real text, plus where each of its characters sits in the Doc. */
type Block = Para & { start: number; end: number; elem: number; raw: string; at: number[] }
type Elem = { start: number; end: number; kind: 'block' | 'empty' | 'other' | 'nonParagraph' }

const docStyle = (s?: string | null) => (s === 'TITLE' ? 'HEADING_1' : s === 'SUBTITLE' ? 'HEADING_2' : s || 'NORMAL_TEXT')
/** Nested list items are compared by depth only: markdown can't tell a bulleted sub-list of a numbered list apart. */
const shape = (p: Para) => (p.list ? `${p.depth}${p.depth ? '' : p.list}` : '')
const marksKey = (p: Para) => {
  const per = Array<string>(p.text.length).fill('')
  for (const r of p.runs)
    for (let i = r.start; i < r.end; i++) if (/\S/.test(p.text[i])) per[i] = `${r.bold ? 'b' : ''}${r.italic ? 'i' : ''}${r.strike ? 's' : ''}${r.link ? '@' + r.link : ''}`
  return per.join('|')
}
const key = (p: Para) => [shape(p), p.style, p.text, marksKey(p)].join('\u0001')

function readTab(tab: docs_v1.Schema$DocumentTab) {
  const lists = tab.lists ?? {}
  const elems: Elem[] = []
  const blocks: Block[] = []
  for (const el of tab.body?.content ?? []) {
    const start = el.startIndex ?? 0
    const end = el.endIndex ?? 0
    if (end <= 1) continue // the section break that opens every body
    if (!el.paragraph) {
      elems.push({ start, end, kind: 'nonParagraph' })
      continue
    }
    const b: Block = { text: '', raw: '', at: [], style: docStyle(el.paragraph.paragraphStyle?.namedStyleType), depth: 0, runs: [], start, end, elem: elems.length }
    let objects = false
    for (const e of el.paragraph.elements ?? []) {
      if (!e.textRun) {
        objects = true
        continue
      }
      const s = e.textRun.textStyle ?? {}
      const from = b.raw.length
      ;(e.textRun.content ?? '').split('').forEach((ch, k) => {
        const index = (e.startIndex ?? 0) + k
        if (index >= end - 1) return
        b.raw += ch
        b.at.push(index)
      })
      if ((s.bold || s.italic || s.strikethrough || s.link?.url) && b.raw.length > from)
        b.runs.push({ start: from, end: b.raw.length, bold: !!s.bold, italic: !!s.italic, strike: !!s.strikethrough, link: s.link?.url ?? undefined })
    }
    b.text = b.raw
    trim(b)
    const bullet = el.paragraph.bullet
    if (bullet) Object.assign(b, { list: isOrdered(lists, bullet) ? 'NUMBER' : 'BULLET', depth: bullet.nestingLevel ?? 0 })
    elems.push({ start, end, kind: b.text ? 'block' : objects ? 'other' : 'empty' })
    if (b.text) blocks.push(b)
  }
  return { elems, blocks, end: elems.at(-1)?.end ?? 1 }
}

/** Longest common subsequence of two key lists, as matched index pairs. */
function lcs(a: string[], b: string[]): [number, number][] {
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

/**
 * Requests that turn a Doc tab into the markdown while touching only what changed: unchanged paragraphs keep every bit
 * of their Google Docs formatting (fonts, sizes, colours, spacing, alignment, images), and an edited paragraph only
 * gets its changed words replaced. Tables, images-only paragraphs and blank lines are left in place.
 */
export function patchDoc(tab: docs_v1.Schema$DocumentTab, markdown: string, tabId?: string): Request[] {
  const news = parseParas(markdown).filter((p) => p.text)
  const { elems, blocks, end: bodyEnd } = readTab(tab)
  if (!blocks.length) return inTab(news.length ? insertParas(news, bodyEnd > 2 ? bodyEnd - 1 : 1, bodyEnd > 2 ? '\n' : '') : [], tabId)

  const isPara = (e?: Elem) => !!e && e.kind !== 'nonParagraph'
  const blankLines = elems.some((e, i) => e.kind === 'empty' && elems[i - 1]?.kind === 'block' && elems[i + 1]?.kind === 'block')
  const blank = (): Para => ({ text: '', style: 'NORMAL_TEXT', depth: 0, runs: [] })
  /** New paragraphs, with blank lines between them when the Doc separates paragraphs that way. */
  const spaced = (ps: Para[], leading: boolean, trailing: boolean) => {
    const out: Para[] = leading ? [blank()] : []
    ps.forEach((p, i) => {
      if (i && blankLines && !(ps[i - 1].list && p.list)) out.push(blank())
      out.push(p)
    })
    return trailing ? [...out, blank()] : out
  }
  /** A blank line separates `at` from its neighbour on side `dir` (and isn't just the Doc's trailing empty line). */
  const blankBeside = (at: number, dir: 1 | -1) => elems[at + dir]?.kind === 'empty' && isPara(elems[at + 2 * dir])
  /** `prev` is what the anchor paragraph will be after this push (it may be edited too). */
  const insertAfter = (a: Block, prev: Para, ps: Para[]) =>
    insertParas(spaced(ps, blankBeside(a.elem, 1) && !(prev.list && ps[0].list), false), a.end - 1, '\n', '', a.end === bodyEnd)
  const insertBefore = (b: Block, ps: Para[]) => insertParas(spaced(ps, false, blankBeside(b.elem, -1) && !(ps.at(-1)!.list && b.list)), b.start, '', '\n', false)

  function remove(b: Block): Request[] {
    const next = elems[b.elem + 1]
    if (isPara(next)) {
      // Take one blank separator line along, unless it is the one guarding a table (that newline can't go).
      const to = blankLines && next.kind === 'empty' && isPara(elems[b.elem + 2]) ? next.end : b.end
      return [{ deleteContentRange: { range: { startIndex: b.start, endIndex: to } } }]
    }
    // Last paragraph, or one right before a table: its newline must stay, so empty it instead.
    const range = { startIndex: b.start, endIndex: b.end - 1 }
    return [
      ...(b.list ? [{ deleteParagraphBullets: { range } }] : []),
      ...(b.style !== 'NORMAL_TEXT' ? [{ updateParagraphStyle: { range, paragraphStyle: { namedStyleType: 'NORMAL_TEXT' }, fields: 'namedStyleType' } }] : []),
      { deleteContentRange: { range } }
    ]
  }

  function edit(b: Block, n: Para): Request[] {
    const requests: Request[] = []
    const lead = b.raw.length - b.raw.trimStart().length
    const old = b.text
    const at = b.at.slice(lead, lead + old.length)
    const neu = n.text
    let p = 0
    while (p < old.length && p < neu.length && old[p] === neu[p]) p++
    let s = 0
    while (s < old.length - p && s < neu.length - p && old[old.length - 1 - s] === neu[neu.length - 1 - s]) s++
    const from = p < old.length ? at[p] : at[old.length - 1] + 1
    const to = old.length - s > p ? at[old.length - s - 1] + 1 : from
    const inserted = neu.slice(p, neu.length - s)
    if (to > from) requests.push({ deleteContentRange: { range: { startIndex: from, endIndex: to } } })
    if (inserted) requests.push({ insertText: { location: { index: from }, text: inserted } })
    const delta = inserted.length - (to - from)
    const range = { startIndex: b.start, endIndex: b.end - 1 + delta }
    const pos = (i: number) => (i < p ? at[i] : i < neu.length - s ? from + i - p : at[i - neu.length + old.length] + delta)
    if (b.style !== n.style) requests.push({ updateParagraphStyle: { range, paragraphStyle: { namedStyleType: n.style }, fields: 'namedStyleType' } })
    if (inserted || marksKey(b) !== marksKey(n)) {
      requests.push({ updateTextStyle: { range, textStyle: {}, fields: MARK_FIELDS } })
      for (const r of n.runs) requests.push({ updateTextStyle: { range: { startIndex: pos(r.start), endIndex: pos(r.end - 1) + 1 }, ...markStyle(r) } })
    }
    if (shape(b) !== shape(n)) {
      if (b.list) requests.push({ deleteParagraphBullets: { range } })
      if (n.list) {
        if (n.depth) requests.push({ insertText: { location: { index: b.start }, text: '\t'.repeat(n.depth) } })
        requests.push({ createParagraphBullets: { range: { startIndex: b.start, endIndex: range.endIndex + n.depth }, bulletPreset: PRESET[n.list] } })
      }
    }
    return requests
  }

  // Walk the changed stretches between matching paragraphs from the end of the Doc backwards, so the indices of
  // everything still to be edited stay valid.
  const matches = lcs(blocks.map(key), news.map(key))
  const requests: Request[] = []
  for (let r = matches.length; r >= 0; r--) {
    const [oi, ni] = matches[r] ?? [blocks.length, news.length]
    const [po, pn] = r > 0 ? matches[r - 1].map((x) => x + 1) : [0, 0]
    const olds = blocks.slice(po, oi)
    const fresh = news.slice(pn, ni)
    const pairs = Math.min(olds.length, fresh.length)
    if (fresh.length > pairs) {
      const anchor = pairs ? olds[pairs - 1] : blocks[po - 1]
      const rest = fresh.slice(pairs)
      requests.push(...(anchor ? insertAfter(anchor, pairs ? fresh[pairs - 1] : anchor, rest) : insertBefore(blocks[oi], rest)))
    }
    for (let i = olds.length - 1; i >= pairs; i--) requests.push(...remove(olds[i]))
    for (let i = pairs - 1; i >= 0; i--) requests.push(...edit(olds[i], fresh[i]))
  }
  return inTab(requests, tabId)
}

/** Points every location and range of the requests at one document tab, so other tabs are never touched. */
function inTab(requests: Request[], tabId?: string): Request[] {
  if (!tabId) return requests
  return requests.map((request) => {
    const out: Record<string, Record<string, unknown>> = {}
    for (const [kind, body] of Object.entries(request) as [string, Record<string, unknown>][]) {
      const b = { ...body }
      if (b.location) b.location = { ...(b.location as object), tabId }
      if (b.range) b.range = { ...(b.range as object), tabId }
      out[kind] = b
    }
    return out as Request
  })
}
