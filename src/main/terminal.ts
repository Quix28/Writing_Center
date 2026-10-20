import { app, type WebContents } from 'electron'
import * as pty from 'node-pty'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { getRoot } from './vault'
import { CLAUDE_DIRS, findClaude } from './claudecode'

/**
 * The Claude Code tab: your own interactive `claude`, in a real terminal, in the vault folder. Started through
 * your login shell so PATH and settings match Terminal.app; `exec` means it is only ever `claude`, never a shell.
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

export function start(sender: WebContents, size: { cols: number; rows: number }): string {
  const cwd = getRoot()
  if (!cwd) throw new Error('Open a vault first.')
  // Test hook: WC_CLAUDE_BIN runs a stand-in instead of `claude`.
  const claude = process.env.WC_CLAUDE_BIN ?? findClaude()
  if (!claude) throw new Error("Claude Code isn't installed (no `claude` found in ~/.local/bin, Homebrew or your PATH). Install it from claude.com/code, then press Restart.")
  const id = randomUUID()
  const shell = process.env.SHELL || '/bin/zsh'
  const p = pty.spawn(shell, ['-l', '-c', `exec ${shellQuote(claude)}`], { name: 'xterm-256color', cols: size.cols, rows: size.rows, cwd, env: cleanEnv(dirname(claude)) })
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
