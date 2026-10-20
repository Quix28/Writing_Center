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

function runClaude(args: string[], opts: { stdin?: string; id?: string; onLine?: (line: string) => void; timeoutMs?: number } = {}) {
  const bin = findClaude()
  if (!bin) return Promise.reject(new Error('Claude Code is not installed. Install it from claude.com/code, then sign in.'))
  return new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args, { cwd: workdir(), env: cleanEnv(), stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    let buffer = ''
    let aborted = false
    if (opts.id) active.set(opts.id, () => ((aborted = true), child.kill()))
    const timer = opts.timeoutMs ? setTimeout(() => child.kill(), opts.timeoutMs) : undefined
    child.stdout.on('data', (d: Buffer) => {
      out += d
      if (!opts.onLine) return
      buffer += d
      const lines = buffer.split('\n')
      buffer = lines.pop()!
      for (const line of lines) if (line.trim()) opts.onLine(line)
    })
    child.stderr.on('data', (d) => (err += d))
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
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

/** One headless Claude Code turn with no tools (or only WebSearch), your settings and hooks left out. */
export async function run(req: { model: string; system: string; prompt: string; schema?: object; web?: boolean; id?: string; onText?: (t: string) => void }): Promise<CodeResult> {
  const args = [
    '-p',
    '--model', req.model,
    '--setting-sources=',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
    `--tools=${req.web ? 'WebSearch' : ''}`,
    ...(req.web ? ['--allowedTools=WebSearch'] : []),
    '--system-prompt', req.system,
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
