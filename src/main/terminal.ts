import { app, type WebContents } from 'electron'
import * as pty from 'node-pty'
import { randomUUID } from 'node:crypto'
import { getRoot } from './vault'

/**
 * The Claude Code tab: your own interactive `claude`, in a real terminal, in the vault folder. Started through
 * your login shell so PATH and settings match Terminal.app; `exec` means it is only ever `claude`, never a shell.
 */
const sessions = new Map<string, pty.IPty>()
/** Test hook: run a stand-in instead of `claude`. */
const command = process.env.WC_CLAUDE_BIN ? `exec ${JSON.stringify(process.env.WC_CLAUDE_BIN)}` : 'exec claude'

function cleanEnv() {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^(ELECTRON_|CLAUDECODE|CLAUDE_CODE_ENTRYPOINT|WC_)/.test(k)) env[k] = v
  return { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'WritingCentre' }
}

export function start(sender: WebContents, size: { cols: number; rows: number }): string {
  const cwd = getRoot()
  if (!cwd) throw new Error('Open a vault first.')
  const id = randomUUID()
  const shell = process.env.SHELL || '/bin/zsh'
  const p = pty.spawn(shell, ['-l', '-c', command], { name: 'xterm-256color', cols: size.cols, rows: size.rows, cwd, env: cleanEnv() })
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
