import { protocol, net, shell } from 'electron'
import { execFile } from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { pathFor } from './vault'

const run = promisify(execFile)
const MAX_OUTPUT = 50 * 1024 * 1024

/** vault://f/<path> serves files from inside the vault only (images, PDFs) to the renderer. */
export const VAULT_SCHEME = { scheme: 'vault', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }

export function registerVaultProtocol() {
  protocol.handle('vault', async (req) => {
    try {
      const rel = decodeURIComponent(new URL(req.url).pathname.replace(/^\//, ''))
      return net.fetch(pathToFileURL(await pathFor(rel)).toString())
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

/** .docx → HTML with macOS's built-in textutil (no extra dependencies). Shown in a sandboxed frame. */
export async function docxHtml(rel: string): Promise<string> {
  const { stdout } = await run('/usr/bin/textutil', ['-convert', 'html', '-stdout', await pathFor(rel)], { maxBuffer: MAX_OUTPUT })
  return stdout
}

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&')

/** .pptx → text outline per slide, read from the zip with macOS's unzip. */
export async function pptxOutline(rel: string): Promise<{ slide: number; lines: string[] }[]> {
  const file = await pathFor(rel)
  const { stdout: list } = await run('/usr/bin/unzip', ['-Z1', file], { maxBuffer: MAX_OUTPUT })
  const slides = list
    .split('\n')
    .map((n) => /^ppt\/slides\/slide(\d+)\.xml$/.exec(n.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .sort((a, b) => +a[1] - +b[1])
  const out: { slide: number; lines: string[] }[] = []
  for (const m of slides) {
    const { stdout: xml } = await run('/usr/bin/unzip', ['-p', file, m[0]], { maxBuffer: MAX_OUTPUT })
    const lines = [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)]
      .map((p) => decode([...p[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => t[1]).join('')).trim())
      .filter(Boolean)
    out.push({ slide: +m[1], lines })
  }
  return out
}

/** Documents and media the default app may open. Anything else (.app, .command, .pkg, scripts…) could run code. */
const OPENABLE = /\.(md|txt|rtf|pdf|png|jpe?g|gif|webp|heic|bmp|tiff?|svg|docx?|pptx?|xlsx?|csv|odt|ods|odp|pages|key|numbers|epub|mp3|m4a|wav|mp4|mov)$/i

export const canOpen = (rel: string) => OPENABLE.test(rel)

export async function openExternal(rel: string): Promise<void> {
  // Judge what macOS will actually open: the symlink's real target, and only a regular file (an .app is a folder).
  const target = await realpath(await pathFor(rel))
  if (!canOpen(rel) || !canOpen(target) || !(await stat(target)).isFile())
    throw new Error('For safety, Writing Centre only opens documents and media. Use Show in Finder for other files.')
  const error = await shell.openPath(target)
  if (error) throw new Error(error)
}

/** Reveals any vault file in Finder without opening it. */
export async function reveal(rel: string): Promise<void> {
  shell.showItemInFolder(await pathFor(rel))
}
