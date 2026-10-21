export type DocReply = { author: string; content: string; created: string }
export type DocComment = { id: string; author: string; content: string; created: string; resolved: boolean; quote: string; replies: DocReply[] }
export type PlacedComment = DocComment & { from: number; to: number }

/** Markdown markers that are absent from Google's plain quoted text. */
const MARKUP = new Set(['*', '_', '`'])

/** The note as plain text with whitespace collapsed, plus where each kept character sits in the original. */
function normalize(doc: string) {
  let text = ''
  const at: number[] = []
  for (let i = 0; i < doc.length; i++) {
    const ch = doc[i]
    if (MARKUP.has(ch)) continue
    if (/\s/.test(ch)) {
      if (text.endsWith(' ') || !text) continue
      text += ' '
    } else text += ch.toLowerCase()
    at.push(i)
  }
  return { text, at }
}

/**
 * Places each Google Docs comment on the passage it quotes. Matching is by text (whitespace, case and markdown
 * markers ignored) because the Docs API does not say which tab a comment belongs to.
 */
export function placeComments(doc: string, comments: DocComment[]): { placed: PlacedComment[]; unplaced: DocComment[] } {
  const n = normalize(doc)
  const placed: PlacedComment[] = []
  const unplaced: DocComment[] = []
  for (const c of comments) {
    const q = normalize(c.quote).text.trim()
    const i = q ? n.text.indexOf(q) : -1
    if (i < 0) unplaced.push(c)
    else placed.push({ ...c, from: n.at[i], to: n.at[i + q.length - 1] + 1 })
  }
  return { placed: placed.sort((a, b) => a.from - b.from), unplaced }
}
