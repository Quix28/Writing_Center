import type { docs_v1 } from '@googleapis/docs'

type Tab = docs_v1.Schema$Tab
export type TabInfo = { id: string; title: string; depth: number }

/** All tabs of a Google Doc in reading order, with their nesting depth. */
export function flattenTabs(tabs: Tab[] = [], depth = 0): TabInfo[] {
  return tabs.flatMap((t) => [
    { id: t.tabProperties?.tabId ?? '', title: t.tabProperties?.title || 'Untitled tab', depth },
    ...flattenTabs(t.childTabs ?? [], depth + 1)
  ])
}

export function findTab(tabs: Tab[] = [], id: string): Tab | undefined {
  for (const t of tabs) {
    if (t.tabProperties?.tabId === id) return t
    const child = findTab(t.childTabs ?? [], id)
    if (child) return child
  }
}

/** Markdown for a run of text, keeping bold, italic, strikethrough and links; surrounding spaces stay outside the markers. */
function inline(elements: docs_v1.Schema$ParagraphElement[] = []): string {
  return elements
    .map((el) => {
      const run = el.textRun
      if (!run?.content) return ''
      const text = run.content.replace(/\n$/, '').replace(/\u000b/g, '  \n')
      const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!
      if (!core) return text
      const s = run.textStyle ?? {}
      let md = core
      if (s.strikethrough) md = `~~${md}~~`
      if (s.italic) md = `*${md}*`
      if (s.bold) md = `**${md}**`
      if (s.link?.url) md = `[${md}](${s.link.url})`
      return lead + md + trail
    })
    .join('')
}

const plain = (cell: docs_v1.Schema$TableCell) =>
  (cell.content ?? []).map((c) => inline(c.paragraph?.elements).trim()).filter(Boolean).join(' ').replace(/\|/g, '\\|')

/**
 * One Google Docs tab → markdown: headings, bold, italic, strikethrough, links, bulleted/numbered (nested) lists
 * and tables. Images, drawings, smart chips and footnotes are skipped.
 */
export function tabToMarkdown(tab: docs_v1.Schema$DocumentTab | undefined): string {
  const lists = tab?.lists ?? {}
  const blocks: string[] = []
  let listBlock: string[] | null = null
  const endList = () => {
    if (listBlock) blocks.push(listBlock.join('\n'))
    listBlock = null
  }
  for (const el of tab?.body?.content ?? []) {
    if (el.paragraph) {
      const p = el.paragraph
      const text = inline(p.elements).trimEnd()
      if (p.bullet) {
        const level = p.bullet.nestingLevel ?? 0
        const glyph = lists[p.bullet.listId ?? '']?.listProperties?.nestingLevels?.[level]?.glyphType
        const ordered = !!glyph && glyph !== 'GLYPH_TYPE_UNSPECIFIED' && glyph !== 'NONE'
        ;(listBlock ??= []).push(`${'  '.repeat(level)}${ordered ? '1.' : '-'} ${text.trim()}`)
        continue
      }
      endList()
      if (!text.trim()) continue
      const style = p.paragraphStyle?.namedStyleType ?? ''
      const heading = style === 'TITLE' ? 1 : style === 'SUBTITLE' ? 2 : Number(/^HEADING_(\d)$/.exec(style)?.[1] ?? 0)
      blocks.push(heading ? `${'#'.repeat(heading)} ${text.trim()}` : text.trim())
    } else if (el.table) {
      endList()
      const rows = (el.table.tableRows ?? []).map((r) => `| ${(r.tableCells ?? []).map(plain).join(' | ')} |`)
      if (rows.length) {
        const cols = el.table.columns ?? 1
        rows.splice(1, 0, `|${' --- |'.repeat(cols)}`)
        blocks.push(rows.join('\n'))
      }
    }
  }
  endList()
  return blocks.join('\n\n') + '\n'
}
