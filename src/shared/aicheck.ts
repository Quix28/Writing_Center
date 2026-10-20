import { splitFrontmatter } from './frontmatter.ts'

/** A prose paragraph of the note, with its offsets in the full document. Headings and blank lines are skipped. */
export type Para = { from: number; to: number; text: string }

export function paragraphsOf(doc: string): Para[] {
  const offset = doc.length - splitFrontmatter(doc).body.length
  const out: Para[] = []
  const re = /[^\n]+(?:\n(?!\s*\n)[^\n]+)*/g
  for (const m of splitFrontmatter(doc).body.matchAll(re)) {
    const text = m[0]
    if (!text.trim() || /^\s*#{1,6}\s/.test(text) || /^\s*(---|\*\*\*|```)/.test(text)) continue
    out.push({ from: offset + m.index!, to: offset + m.index! + text.length, text })
  }
  return out
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/** Index of the paragraph containing `snippet` (whitespace and case insensitive), or -1. */
export function findPara(paras: Para[], snippet: string): number {
  const n = norm(snippet)
  return n ? paras.findIndex((p) => norm(p.text).includes(n)) : -1
}

/** The detector merges short paragraphs and truncates at 500 chars, so match on its first full sentence. */
export function findDetectorPara(paras: Para[], text: string): number {
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (sentence.trim().length < 20) continue
    const i = findPara(paras, sentence)
    if (i >= 0) return i
  }
  return findPara(paras, text.slice(0, 60))
}

export type Band = 'low' | 'mid' | 'high'
export const band = (score: number): Band => (score >= 60 ? 'high' : score >= 35 ? 'mid' : 'low')
export const BAND_LABEL: Record<Band, string> = { low: 'Reads human', mid: 'Mixed signals', high: 'Reads AI-generated' }
