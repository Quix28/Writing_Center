import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api, errorText } from './api'
import { getView } from './Editor'
import { oneLine, paste } from '../shared/terminalText'

const THEME = {
  background: '#16181b', foreground: '#e6e3dc', cursor: '#9bb8d8', cursorAccent: '#16181b', selectionBackground: '#33465c',
  black: '#272b31', red: '#e2847a', green: '#82c095', yellow: '#d9b45f', blue: '#9bb8d8', magenta: '#c4a7e7', cyan: '#8ccfcf', white: '#e6e3dc',
  brightBlack: '#5c626b', brightRed: '#ef9a90', brightGreen: '#9fd4ae', brightYellow: '#e8c878', brightBlue: '#b0c8e3', brightMagenta: '#d4bdf0', brightCyan: '#a8dede', brightWhite: '#ffffff'
}

/**
 * Your real Claude Code, running in the vault folder. Stays alive while you switch tabs or notes;
 * edits it makes to notes show up in the editor right away.
 */
export function ClaudeTerminal({ visible, activePath }: { visible: boolean; activePath: string | null }) {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const session = useRef<string | null>(null)
  const [state, setState] = useState<'starting' | 'running' | 'exited'>('starting')
  const [error, setError] = useState<string | null>(null)

  const start = async (mode: 'new' | 'continue' | 'resume' = 'new') => {
    const t = term.current!
    setError(null)
    setState('starting')
    t.reset()
    try {
      fit.current?.fit()
      session.current = await api.term.start({ cols: t.cols, rows: t.rows }, mode)
      setState('running')
    } catch (e) {
      setError(errorText(e))
      setState('exited')
    }
  }

  useEffect(() => {
    const t = new Terminal({ theme: THEME, fontFamily: '"SF Mono", Menlo, monospace', fontSize: 12.5, lineHeight: 1.15, cursorBlink: true, allowProposedApi: false, macOptionIsMeta: true, scrollback: 5000 })
    const f = new FitAddon()
    t.loadAddon(f)
    t.open(host.current!)
    term.current = t
    fit.current = f
    t.onData((data) => session.current && api.term.write(session.current, data))
    const offData = api.term.onData(({ id, data }) => id === session.current && t.write(data))
    const offExit = api.term.onExit(({ id, exitCode }) => {
      if (id !== session.current) return
      session.current = null
      setState('exited')
      t.write(`\r\n\x1b[2m[Claude Code exited${exitCode ? ` with code ${exitCode}` : ''}. Press Continue last chat or New chat.]\x1b[0m\r\n`)
    })
    const ro = new ResizeObserver(() => {
      if (!host.current?.offsetWidth) return
      f.fit()
      if (session.current) api.term.resize(session.current, t.cols, t.rows)
    })
    ro.observe(host.current!)
    start()
    return () => {
      ro.disconnect()
      offData()
      offExit()
      if (session.current) api.term.kill(session.current)
      t.dispose()
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    requestAnimationFrame(() => {
      fit.current?.fit()
      if (session.current && term.current) api.term.resize(session.current, term.current.cols, term.current.rows)
      term.current?.focus()
    })
  }, [visible])

  const [notice, setNotice] = useState<string | null>(null)

  /**
   * Inserts text as a paste, and only while Claude Code accepts pastes (bracketed-paste mode on). When a menu or
   * permission prompt is open that mode is off, and typed characters could answer it ("1" = Yes), so nothing is sent.
   */
  const insert = (text: string) => {
    const t = term.current
    if (!session.current || !t) return
    if (!t.modes.bracketedPasteMode) {
      setNotice('Claude Code is showing a prompt or menu right now. Answer it first, then try again.')
      setTimeout(() => setNotice(null), 4000)
      t.focus()
      return
    }
    api.term.write(session.current, paste(text))
    t.focus()
  }

  const restart = (mode: 'new' | 'continue' | 'resume') => {
    if (session.current) api.term.kill(session.current)
    session.current = null
    start(mode)
  }

  const askAboutNote = () => {
    if (!activePath) return
    const path = oneLine(activePath)
    insert(/\s/.test(path) ? `the note "${path}" ` : `@${path} `)
  }

  const sendSelection = () => {
    const view = getView()
    const sel = view?.state.selection.main
    if (!view || !sel || sel.empty) return
    insert(`From ${oneLine(activePath ?? 'the open note')}:\n"""\n${view.state.sliceDoc(sel.from, sel.to)}\n"""\n`)
  }

  return (
    <div className="claude-term">
      <div className="term-bar">
        <button onClick={askAboutNote} disabled={!activePath || state !== 'running'} title="Mention the open note in your message">Ask about this note</button>
        <button onClick={sendSelection} disabled={state !== 'running'} title="Paste the text selected in the editor into your message">Send selection</button>
        <span className="status-spacer" />
        <button className="quiet" onClick={() => restart('continue')} title="Reopen the most recent Claude Code chat in this vault (claude --continue)">Continue last chat</button>
        <button className="quiet" onClick={() => restart('resume')} title="Choose any earlier Claude Code chat in this vault (claude --resume)">Past chats…</button>
        <button className="quiet" onClick={() => restart('new')} title="Start a fresh Claude Code session">New chat</button>
      </div>
      {error && <p className="error-text term-error">{error}</p>}
      {notice && <p className="muted small term-error" role="status">{notice}</p>}
      <div className="term-host" ref={host} />
    </div>
  )
}
