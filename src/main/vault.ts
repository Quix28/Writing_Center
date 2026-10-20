import { mkdir, readdir, readFile, realpath, rename, writeFile, access } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'

export type TreeNode = { name: string; path: string; dir: boolean; children?: TreeNode[] }
export type VaultEvent = { type: 'tree' } | { type: 'change'; path: string; content: string } | { type: 'unlink'; path: string }

/** Files the app opens as text; everything else (PDF, images, Office files…) is only viewed. */
export const TEXT_FILE = /\.(md|txt|canvas)$/i

let root: string | null = null
let watcher: FSWatcher | null = null
const lastWritten = new Map<string, string>()

const outside = (r: string) => r === '..' || r.startsWith('..' + sep) || isAbsolute(r)

export function safePath(vaultRoot: string, rel: string): string {
  const abs = resolve(vaultRoot, rel)
  if (outside(relative(vaultRoot, abs))) throw new Error(`Path outside vault: ${rel}`)
  return abs
}

/** Hidden paths (.claude/, .git/, .obsidian/…) are config, not notes: the renderer may never create or write them. */
const hidden = (rel: string) => rel.split(/[\\/]/).some((seg) => seg.startsWith('.') && seg !== '.' && seg !== '..')

async function writableInVault(rel: string): Promise<string> {
  if (hidden(rel)) throw new Error(`Refusing to write hidden path: ${rel}`)
  return resolveInVault(rel)
}

/** Also rejects paths that escape through a symlink inside the vault. */
async function resolveInVault(rel: string, allowRoot = false): Promise<string> {
  if (!root) throw new Error('No vault open')
  const abs = safePath(root, rel)
  if (!allowRoot && abs === resolve(root)) throw new Error('Refusing to operate on the vault root')
  const realRoot = await realpath(root)
  for (let p = abs; ; p = dirname(p)) {
    try {
      if (outside(relative(realRoot, await realpath(p)))) throw new Error(`Path outside vault: ${rel}`)
      return abs
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
  }
}

export const getRoot = () => root

export async function openVault(dir: string, onEvent: (e: VaultEvent) => void) {
  await watcher?.close()
  root = resolve(dir)
  lastWritten.clear()
  watcher = watch(root, {
    ignored: (p) => p !== root && basename(p).startsWith('.'),
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 }
  })
  const rel = (p: string) => relative(root!, p).split(sep).join('/')
  watcher.on('add', () => onEvent({ type: 'tree' }))
  watcher.on('addDir', () => onEvent({ type: 'tree' }))
  watcher.on('unlinkDir', () => onEvent({ type: 'tree' }))
  watcher.on('unlink', (p) => {
    onEvent({ type: 'unlink', path: rel(p) })
    onEvent({ type: 'tree' })
  })
  watcher.on('change', async (p) => {
    const path = rel(p)
    if (!TEXT_FILE.test(path)) return
    const content = await readFile(p, 'utf8').catch(() => null)
    if (content === null || lastWritten.get(path) === content) return
    onEvent({ type: 'change', path, content })
  })
}

async function walk(dir: string, rel: string): Promise<TreeNode[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nodes: TreeNode[] = []
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const path = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) nodes.push({ name: e.name, path, dir: true, children: await walk(join(dir, e.name), path) })
    else nodes.push({ name: e.name, path, dir: false })
  }
  return nodes.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
}

export async function tree(): Promise<TreeNode[]> {
  return root ? walk(root, '') : []
}

export function flatFiles(nodes: TreeNode[]): string[] {
  return nodes.flatMap((n) => (n.dir ? flatFiles(n.children ?? []) : [n.path]))
}

export async function read(rel: string): Promise<string> {
  return readFile(await resolveInVault(rel), 'utf8')
}

/** Atomic write: temp file + rename, so a crash mid-write never leaves a half-written note. */
export async function write(rel: string, content: string): Promise<void> {
  const abs = await writableInVault(rel)
  const tmp = join(dirname(abs), `.${basename(abs)}.${process.pid}.tmp`)
  lastWritten.set(rel, content)
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, abs)
}

export async function create(rel: string, dir: boolean): Promise<void> {
  const abs = await writableInVault(rel)
  if (dir) await mkdir(abs)
  else {
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, '', { flag: 'wx' })
  }
}

export async function move(from: string, to: string): Promise<void> {
  const [a, b] = [await resolveInVault(from), await writableInVault(to)]
  const exists = await access(b).then(() => true, () => false)
  if (exists) throw new Error(`${to} already exists`)
  await rename(a, b)
}

export const pathFor = (rel: string) => resolveInVault(rel)

/** ponytail: re-reads every note per call; cache by mtime if vaults reach thousands of files. */
export async function readAllNotes(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const f of flatFiles(await tree()).filter((f) => f.endsWith('.md'))) out[f] = await read(f)
  return out
}
