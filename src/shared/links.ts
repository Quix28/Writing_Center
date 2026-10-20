const WIKILINK = /\[\[([^\]|#\n]+)(?:[#|][^\]\n]*)?\]\]/g

export function extractLinks(text: string): string[] {
  return [...text.matchAll(WIKILINK)].map((m) => m[1].trim())
}

/** Obsidian-style: exact path first, then path suffix, then basename, all case-insensitive. */
export function resolveLink(target: string, files: string[]): string | undefined {
  const t = target.toLowerCase().replace(/\.md$/, '')
  const md = files.filter((f) => f.endsWith('.md'))
  const stem = (f: string) => f.toLowerCase().slice(0, -3)
  return (
    md.find((f) => stem(f) === t) ??
    md.find((f) => stem(f).endsWith('/' + t)) ??
    md.find((f) => stem(f).split('/').pop() === t.split('/').pop())
  )
}
