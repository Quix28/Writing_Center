export type Inspiration = { title: string; url: string; why: string }

type Block = { type: string; content?: unknown; citations?: object[] | null }

const norm = (url: string) => url.trim().replace(/#.*$/, '').replace(/\/+$/, '')

/** Every URL that actually came back from the web search tool, or that Claude cited from it. */
export function sourcedUrls(blocks: Block[]): Set<string> {
  const urls = new Set<string>()
  for (const b of blocks) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content))
      for (const r of b.content as { url?: string }[]) if (r.url) urls.add(norm(r.url))
    if (b.type === 'text') for (const c of (b.citations ?? []) as { url?: string }[]) if (c.url) urls.add(norm(c.url))
  }
  return urls
}

/** URLs listed in Claude Code's WebSearch tool results (`Links: [{"title":…,"url":…}]`). */
export function urlsInToolResults(results: string[]): Set<string> {
  const urls = new Set<string>()
  for (const r of results) for (const m of r.matchAll(/"url"\s*:\s*"(https?:\/\/[^"\s]+)"/g)) urls.add(norm(m[1]))
  return urls
}

/** Pulls the last {"items": [...]} JSON object out of Claude's reply, even with prose around it. */
export function parseItems(text: string): Inspiration[] {
  const end = text.lastIndexOf('}')
  for (let i = text.lastIndexOf('{', end); i >= 0; i = i === 0 ? -1 : text.lastIndexOf('{', i - 1)) {
    try {
      const items = JSON.parse(text.slice(i, end + 1)).items
      if (Array.isArray(items)) return items.filter((x) => x && typeof x.url === 'string' && typeof x.title === 'string')
    } catch {
      /* not the JSON object yet, keep widening */
    }
  }
  return []
}

/** Drops anything whose URL was not in the search results: an inspiration item never ships without a real source. */
export function onlySourced(items: Inspiration[], urls: Set<string>): Inspiration[] {
  const seen = new Set<string>()
  return items.filter((i) => {
    const u = norm(i.url)
    if (!/^https?:\/\//.test(u) || !urls.has(u) || seen.has(u)) return false
    seen.add(u)
    return true
  })
}
