import { app, type WebContents } from 'electron'
import * as pty from 'node-pty'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { getRoot } from './vault'
import { CLAUDE_DIRS, findClaude } from './claudecode'

/**
 * The terminal tab: your own login shell in the vault folder, so PATH and settings match Terminal.app. The chat
 * buttons run `claude` first and drop back to the same shell when it exits.
 */
const sessions = new Map<string, pty.IPty>()
/** Single-quoted for the shell, so any path is passed through literally. */
const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

function cleanEnv(claudeDir: string | null) {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^(ELECTRON_|CLAUDECODE|CLAUDE_CODE_ENTRYPOINT|WC_)/.test(k)) env[k] = v
  // Opened from Finder, the app has a bare PATH; give Claude Code (and the tools it runs) the usual places.
  const path = [...new Set([claudeDir, ...CLAUDE_DIRS(), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].filter(Boolean))].join(':')
  return { ...env, PATH: path, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'WritingCentre' }
}

/** How the session starts: a plain shell, a new chat, the folder's most recent chat, or Claude Code's own picker of past chats. */
const MODES = { shell: null, new: '', continue: ' --continue', resume: ' --resume' } as const
export type StartMode = keyof typeof MODES

export function start(sender: WebContents, size: { cols: number; rows: number }, mode: StartMode = 'shell'): string {
  if (!Object.hasOwn(MODES, mode)) throw new Error('Unknown start mode.')
  const cwd = getRoot()
  if (!cwd) throw new Error('Open a vault first.')
  const shell = process.env.SHELL || '/bin/zsh'
  const flags = MODES[mode]
  // Test hook: WC_CLAUDE_BIN runs a stand-in instead of `claude`.
  const claude = flags === null ? null : (process.env.WC_CLAUDE_BIN ?? findClaude())
  if (flags !== null && !claude) throw new Error("Claude Code isn't installed (no `claude` found in ~/.local/bin, Homebrew or your PATH). Install it from claude.com/code, then try again.")
  const id = randomUUID()
  const args = claude ? ['-l', '-i', '-c', `${shellQuote(claude)}${flags}; exec ${shellQuote(shell)} -l -i`] : ['-l', '-i']
  const p = pty.spawn(shell, args, { name: 'xterm-256color', cols: size.cols, rows: size.rows, cwd, env: cleanEnv(claude ? dirname(claude) : null) })
  sessions.set(id, p)
  p.onData((data) => !sender.isDestroyed() && sender.send('term:data', { id, data }))
  p.onExit(({ exitCode }) => {
    sessions.delete(id)
    if (!sender.isDestroyed()) sender.send('term:exit', { id, exitCode })
  })
  return id
}

export const write = (id: string, data: string) => sessions.get(id)?.write(data)

export function resize(id: string, cols: number, rows: number) {
  if (cols > 0 && rows > 0) sessions.get(id)?.resize(Math.floor(cols), Math.floor(rows))
}

export function kill(id: string) {
  sessions.get(id)?.kill()
  sessions.delete(id)
}

app.on('will-quit', () => sessions.forEach((p) => p.kill()))
