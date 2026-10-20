import { useEffect, useRef, useState } from 'react'
import { api, errorText, type ChatTurn } from './api'
import { toast } from './ui'
import { getView } from './Editor'
import { applyEdits, propose, streamInto, targetRange } from './cm/suggest'

type Msg = ChatTurn & { note?: string }

export function ModelPicker() {
  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  const [model, setModel] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api.settings.get().then((s) => setModel(s.model))
    api.claude.models().then(setModels, (e) => setError(errorText(e)))
  }, [])
  const options = models.some((m) => m.id === model) ? models : [{ id: model, name: model }, ...models]
  if (error)
    return (
      <div className="connect-hint">
        <p>Connect Claude to use the assistant.</p>
        <button className="primary" onClick={() => window.dispatchEvent(new Event('wc:open-connections'))}>Connect Claude</button>
      </div>
    )
  return (
    <label className="model-picker" title="Claude model used by every AI feature">
      Model
      <select
        value={model}
        onChange={(e) => {
          setModel(e.target.value)
          api.settings.set({ model: e.target.value })
        }}
      >
        {options.map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
    </label>
  )
}

export function AssistantPanel({ path }: { path: string | null }) {
  const [mode, setMode] = useState<'suggest' | 'write'>('suggest')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const log = useRef<HTMLDivElement>(null)
  useEffect(() => {
    log.current?.scrollTo(0, log.current.scrollHeight)
  }, [msgs])

  const send = async () => {
    const view = getView()
    const instruction = input.trim()
    if (!instruction || busy) return
    if (!view || !path?.endsWith('.md')) return toast('Open a note first.')
    const history: ChatTurn[] = msgs.map(({ role, content }) => ({ role, content }))
    const doc = view.state.doc.toString()
    const id = crypto.randomUUID()
    setInput('')
    setMsgs((m) => [...m, { role: 'user', content: instruction }])
    setBusy(id)
    try {
      if (mode === 'suggest') {
        const sel = view.state.selection.main
        const r = await api.claude.suggest({ path, text: doc, selection: sel.empty ? undefined : view.state.sliceDoc(sel.from, sel.to), instruction, history })
        const { text, missed } = applyEdits(doc, r.edits)
        const notes: string[] = []
        if (r.edits.length > missed) notes.push(propose(view, text) ? `${r.edits.length - missed} change(s) shown in the editor: accept or reject each.` : 'Could not show the changes: the note changed or another suggestion is open.')
        if (missed) notes.push(`${missed} edit(s) skipped because their text was not found.`)
        setMsgs((m) => [...m, { role: 'assistant', content: r.reply, note: notes.join(' ') }])
      } else {
        const { from, to } = targetRange(view.state)
        const target = view.state.sliceDoc(from, to)
        await streamInto(view, from, to, async (onText) => {
          const off = api.claude.onDelta((d) => d.id === id && onText(d.text))
          try {
            return await api.claude.write(id, { path, text: doc, target, instruction, history })
          } finally {
            off()
          }
        })
        setMsgs((m) => [...m, { role: 'assistant', content: 'I rewrote the passage in the editor.', note: '⌘Z reverts the whole rewrite.' }])
      }
    } catch (e) {
      toast(errorText(e))
      setMsgs((m) => m.slice(0, -1))
      setInput(instruction)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="assistant">
      <ModelPicker />
      <div className="mode-toggle" role="radiogroup" aria-label="Assistant mode">
        <button className={mode === 'suggest' ? 'active' : ''} onClick={() => setMode('suggest')} aria-checked={mode === 'suggest'} role="radio">Suggest</button>
        <button className={mode === 'write' ? 'active' : ''} onClick={() => setMode('write')} aria-checked={mode === 'write'} role="radio">Write</button>
      </div>
      <p className="muted small">
        {mode === 'suggest' ? 'Claude proposes changes as a diff; it never edits the file.' : 'Claude rewrites the selection, or the section under the cursor.'}
      </p>
      <div className="chat-log" ref={log}>
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div>{m.content}</div>
            {m.note && <div className="muted small">{m.note}</div>}
          </div>
        ))}
        {busy && <div className="msg assistant muted">Thinking…</div>}
      </div>
      <div className="chat-input">
        <textarea
          rows={3}
          placeholder={mode === 'suggest' ? 'Ask for suggestions…' : 'How should Claude rewrite it?'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        {busy && mode === 'write' ? <button onClick={() => api.claude.abort(busy)}>Stop</button> : <button onClick={send} disabled={!!busy}>Send</button>}
      </div>
    </div>
  )
}
