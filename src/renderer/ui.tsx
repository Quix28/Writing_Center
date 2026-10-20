import { useEffect, useRef, useState } from 'react'

type Toast = { id: number; text: string; kind: 'error' | 'ok' }
type Ask = { label: string; initial: string; resolve: (v: string | null) => void }

let pushToast: (text: string, kind: Toast['kind']) => void = () => {}
let pushAsk: (a: Ask) => void = () => {}

export const toast = (text: string, kind: Toast['kind'] = 'error') => pushToast(text, kind)
export const ask = (label: string, initial = '') => new Promise<string | null>((resolve) => pushAsk({ label, initial, resolve }))

export function Overlays() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [question, setQuestion] = useState<Ask | null>(null)
  const input = useRef<HTMLInputElement>(null)

  pushToast = (text, kind) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000)
  }
  pushAsk = setQuestion

  useEffect(() => {
    input.current?.select()
  }, [question])

  const answer = (v: string | null) => {
    question?.resolve(v)
    setQuestion(null)
  }

  return (
    <>
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>{t.text}</div>
        ))}
      </div>
      {question && (
        <div className="modal-backdrop" onMouseDown={() => answer(null)}>
          <form
            className="modal"
            onMouseDown={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault()
              answer(input.current!.value.trim() || null)
            }}
          >
            <label>{question.label}</label>
            <input ref={input} defaultValue={question.initial} autoFocus onKeyDown={(e) => e.key === 'Escape' && answer(null)} />
          </form>
        </div>
      )}
    </>
  )
}
