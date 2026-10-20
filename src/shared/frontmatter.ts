const FM = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

export function splitFrontmatter(md: string): { fm: string | null; body: string } {
  const m = FM.exec(md)
  return m ? { fm: m[1], body: md.slice(m[0].length) } : { fm: null, body: md }
}

const keyLine = (key: string) => new RegExp(`^${key}:[ \\t]*(.*)$`, 'm')

export function getKey(md: string, key: string): string | undefined {
  const { fm } = splitFrontmatter(md)
  const v = fm === null ? null : keyLine(key).exec(fm)?.[1].trim()
  return v ? v.replace(/^(["'])(.*)\1$/, '$2') : undefined
}

/** Sets top-level `key: "value"` lines, leaving every other frontmatter line untouched. */
export function setKeys(md: string, values: Record<string, string>): string {
  const { fm, body } = splitFrontmatter(md)
  let lines = fm ?? ''
  for (const [k, v] of Object.entries(values)) {
    const line = `${k}: ${JSON.stringify(v)}`
    lines = keyLine(k).test(lines) ? lines.replace(keyLine(k), line) : lines ? `${lines}\n${line}` : line
  }
  return `---\n${lines}\n---\n${body}`
}

/** Fingerprint of a note body at sync time; whitespace at the ends is ignored. */
export async function bodyHash(body: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.trim()))
  return [...new Uint8Array(bytes)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('')
}
