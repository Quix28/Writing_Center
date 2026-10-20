import { app } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Subscription mode: every request runs through the user's own Claude Code (`claude -p`, its documented
 * headless mode), so usage counts against their Claude plan instead of API billing.
 */

const active = new Map<string, () => void>()

function findClaude(): string | null {
  const dirs = [...(process.env.PATH ?? '').split(':'), join(homedir(), '.local/bin'), join(homedir(), '.claude/local'), '/opt/homebrew/bin', '/usr/local/bin']
  return dirs.map((d) => join(d, 'claude')).find((p) => existsSync(p)) ?? null
}

/** No API keys and no parent Claude Code session leak in: those would switch Claude Code off the subscription. */
function cleanEnv() {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) if (!/^(ANTHROPIC_|CLAUDECODE|CLAUDE_CODE_)/.test(k)) env[k] = v
  return env
}

/** Empty working folder, so no project CLAUDE.md is picked up. */
function workdir() {
  const dir = join(app.getPath('userData'), 'claude-code-workdir')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** `finished()` lets a caller end the run once its result arrived: hooks or plugins in a full session can keep the process alive. */
function runClaude(args: string[], opts: { stdin?: string; id?: string; onLine?: (line: string) => void; finished?: () => boolean; timeoutMs?: number; cwd?: string } = {}) {
  const bin = findClaude()
  if (!bin) return Promise.reject(new Error('Claude Code is not installed. Install it from claude.com/code, then sign in.'))
  return new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd ?? workdir(), env: cleanEnv(), stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    let buffer = ''
    let aborted = false
    let settled = false
    if (opts.id) active.set(opts.id, () => ((aborted = true), child.kill()))
    const timer = opts.timeoutMs ? setTimeout(() => child.kill(), opts.timeoutMs) : undefined
    child.stdout.on('data', (d: Buffer) => {
      out += d
      if (!opts.onLine) return
      buffer += d
      const lines = buffer.split('\n')
      buffer = lines.pop()!
      for (const line of lines) if (line.trim()) opts.onLine(line)
      if (!settled && opts.finished?.()) {
        settled = true
        if (opts.id) active.delete(opts.id)
        clearTimeout(timer)
        resolve(out)
        child.kill()
      }
    })
    child.stderr.on('data', (d) => (err += d))
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      if (settled) return
      if (opts.id) active.delete(opts.id)
      if (aborted) return reject(new Error('Cancelled.'))
      if (buffer.trim()) opts.onLine?.(buffer)
      if (code === 0 || out.trim()) resolve(out)
      else reject(new Error(err.trim().split('\n').slice(-2).join(' ') || `Claude Code exited with code ${code}`))
    })
    child.stdin.end(opts.stdin ?? '')
  })
}

export const abort = (id: string) => active.get(id)?.()

export type CodeAuth = { loggedIn: boolean; authMethod?: string; email?: string; subscriptionType?: string }

export async function authStatus(): Promise<CodeAuth> {
  return JSON.parse(await runClaude(['auth', 'status'], { timeoutMs: 20_000 }))
}

/** Claude Code's own sign-in: opens claude.ai in the browser. */
export async function login(): Promise<CodeAuth> {
  await runClaude(['auth', 'login'], { timeoutMs: 6 * 60_000 })
  return authStatus()
}

export type CodeResult = { text: string; structured?: unknown; toolResults: string[] }

function friendly(message: string): Error {
  if (/invalid api key|please run \/login|not logged in|authentication/i.test(message)) return new Error('Claude Code is not signed in. Open Connections and click "Sign in with Claude".')
  if (/usage limit|rate limit|limit reached|resets? (at|in)/i.test(message)) return new Error(`Your Claude plan's usage limit was reached: ${message}`)
  return new Error(message)
}

/** Your full Claude Code: global CLAUDE.md, user settings, plugins, hooks and skills, with only the tools listed here. Always runs in the app's empty folder. */
export type FullSession = { tools: string[] }

/** The app's own output rules, stated with operator authority so personal response-format rules don't end up in a note. */
const OUTPUT_CONTRACT =
  'OUTPUT CONTRACT (from the Writing Centre app; it overrides any response-format rule such as required prefixes, "Answer:", or terse/caveman styles): what you return is shown to the writer or inserted into their document as is. Write normal prose, with no prefix, label or preamble.'

/**
 * One headless Claude Code turn. By default isolated (no tools or only WebSearch; your settings, hooks and
 * CLAUDE.md left out). With `full`, it runs as your normal Claude Code session.
 */
export async function run(req: { model: string; system: string; prompt: string; schema?: object; web?: boolean; id?: string; onText?: (t: string) => void; full?: FullSession }): Promise<CodeResult> {
  const tools = req.full ? req.full.tools : req.web ? ['WebSearch'] : []
  const args = [
    '-p',
    '--model', req.model,
    // Full sessions load only the user's own settings: never project settings (hooks!) from a folder the app didn't create.
    ...(req.full ? ['--setting-sources=user'] : ['--setting-sources=', '--disable-slash-commands']),
    '--strict-mcp-config',
    '--no-session-persistence',
    `--tools=${tools.join(',')}`,
    ...(tools.length ? [`--allowedTools=${tools.join(',')}`] : []),
    ...(req.full ? ['--append-system-prompt', `${req.system}\n\n${OUTPUT_CONTRACT}`] : ['--system-prompt', req.system]),
    '--output-format', 'stream-json',
    '--verbose',
    ...(req.onText ? ['--include-partial-messages'] : []),
    ...(req.schema ? ['--json-schema', JSON.stringify(req.schema)] : [])
  ]
  const toolResults: string[] = []
  const done: { event?: { is_error?: boolean; subtype?: string; result?: string; structured_output?: unknown; errors?: string[] } } = {}
  await runClaude(args, {
    stdin: req.prompt,
    id: req.id,
    finished: () => !!done.event,
    onLine: (line) => {
      let ev: any
      try {
        ev = JSON.parse(line)
      } catch {
        return
      }
      if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta' && ev.event.delta?.type === 'text_delta') req.onText?.(ev.event.delta.text)
      if (ev.type === 'user')
        for (const block of ev.message?.content ?? []) if (block.type === 'tool_result') toolResults.push(typeof block.content === 'string' ? block.content : JSON.stringify(block.content))
      if (ev.type === 'result') done.event = ev
    }
  }).catch((e) => {
    throw friendly((e as Error).message)
  })
  const r = done.event
  if (!r) throw new Error('Claude Code ended without a result.')
  if (r.is_error || r.subtype !== 'success') throw friendly(r.result || r.errors?.join(' ') || `Claude Code failed (${r.subtype}).`)
  return { text: r.result ?? '', structured: r.structured_output, toolResults }
}

/** Claude Code accepts these aliases for the latest model in each family. */
export const MODELS = [
  { id: 'sonnet', name: 'Sonnet (latest)' },
  { id: 'opus', name: 'Opus (latest)' },
  { id: 'haiku', name: 'Haiku (latest)' }
]
