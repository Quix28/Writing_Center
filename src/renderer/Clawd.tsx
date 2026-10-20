import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { api, errorText, type Finding } from './api'
import { toast } from './ui'
import { getView, typingListeners } from './Editor'
import { setSpans } from './cm/spans'
import { inReview, isWriting, propose } from './cm/suggest'

type Mode = 'idle' | 'typing' | 'walking' | 'pointing' | 'thinking' | 'hanging' | Trick | 'sleep' | 'happy'
/** Little idle tricks, each a short CSS animation, after which Clawd settles back to idle. */
type Trick = 'hop' | 'wave' | 'dance' | 'look'
const TRICK_MS: Record<Trick, number> = { hop: 1000, wave: 1700, dance: 2200, look: 2000 }
/** Modes Clawd can be pulled out of (by typing or a new idle action) without interrupting anything. */
const RESTING = new Set<Mode>(['idle', 'typing', 'hop', 'wave', 'dance', 'look', 'sleep', 'happy'])
type Spot = Finding & { at: number }

const IDLE_REVIEW_MS = 8000
const MIN_GAP_MS = 60_000
const WALK_MS = 1200
const SIZE = 48
/** Idle life: once you pause, Clawd does something every few seconds, and naps after a long quiet stretch. */
const QUIET_BEFORE_WANDER_MS = 10_000
const WANDER_EVERY_MS = [5_000, 10_000] as const
const SLEEP_AFTER_MS = 90_000
const HAPPY_MS = 2600
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Original pixel-art crab on a 16×13 grid. Groups are animated from clawd.css. */
function Sprite() {
  const r = (x: number, y: number, w = 1, h = 1) => <rect x={x} y={y} width={w} height={h} />
  return (
    <svg viewBox="0 0 16 13" width={SIZE} height={(SIZE * 13) / 16} shapeRendering="crispEdges" aria-hidden="true">
      <g className="sprite">
        <g className="claw claw-l">{r(0, 1)}{r(2, 1)}{r(0, 2, 3, 2)}{r(3, 4)}</g>
        <g className="claw claw-r">{r(13, 1)}{r(15, 1)}{r(13, 2, 3, 2)}{r(12, 4)}</g>
        <g className="shell">{r(4, 3, 8, 1)}{r(3, 4, 10, 5)}</g>
        <g className="eyes">{r(5, 5, 1, 2)}{r(10, 5, 1, 2)}</g>
        <g className="cheeks">{r(4, 7)}{r(11, 7)}</g>
        <g className="mouth">{r(6, 7)}{r(9, 7)}{r(7, 8, 2, 1)}</g>
        <g className="legs legs-a">{r(3, 9, 1, 2)}{r(10, 9, 1, 2)}</g>
        <g className="legs legs-b">{r(5, 9, 1, 2)}{r(12, 9, 1, 2)}</g>
      </g>
      <g className="dots">{r(6, -3)}{r(8, -3)}{r(10, -3)}</g>
      <g className="heart">{r(6, -6, 2, 1)}{r(9, -6, 2, 1)}{r(6, -5, 5, 1)}{r(7, -4, 3, 1)}{r(8, -3)}</g>
      <g className="zzz">
        <g className="z z1">{r(12, -5, 4, 1)}{r(14, -4)}{r(13, -3)}{r(12, -2, 4, 1)}</g>
        <g className="z z2">{r(16, -10, 3, 1)}{r(17, -9)}{r(16, -8, 3, 1)}</g>
      </g>
    </svg>
  )
}

/** Keeps editor focus: buttons inside Clawd's bubble act on mousedown without taking focus. */
const noFocus = (e: MouseEvent) => e.preventDefault()

/** `autoReview: false` (subscription mode) means Clawd only reviews when clicked, to spare plan usage limits. */
export function Clawd({ path, onInspire, autoReview = true }: { path: string; onInspire: (a: { passage: string; issue: string }) => Promise<void>; autoReview?: boolean }) {
  const [mode, setMode] = useState<Mode>('idle')
  const [pos, setPos] = useState<{ x: number; y: number; flip: boolean; home?: boolean } | null>(null)
  const posRef = useRef(pos)
  posRef.current = pos
  /** The first placement is instant; only later moves are animated (otherwise he slides in across the text). */
  const [placed, setPlaced] = useState(false)
  useEffect(() => {
    if (pos && !placed) requestAnimationFrame(() => requestAnimationFrame(() => setPlaced(true)))
  }, [pos, placed])
  const lastTyped = useRef(Date.now())
  const [spots, setSpots] = useState<Spot[]>([])
  const [index, setIndex] = useState(0)
  const [note, setNote] = useState<string | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const lastReview = useRef(0)
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const typingTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const modeRef = useRef(mode)
  modeRef.current = mode
  const spot = spots[index]
  const spotsRef = useRef(spots)
  spotsRef.current = spots

  const say = (text: string) => {
    setNote(text)
    setTimeout(() => setNote(null), 3000)
  }

  const place = useCallback((at: number) => {
    const view = getView()
    const area = host.current?.parentElement
    if (!view || !area) return null
    const c = view.coordsAtPos(Math.min(at, view.state.doc.length))
    if (!c) return null
    const a = area.getBoundingClientRect()
    const content = view.contentDOM.getBoundingClientRect()
    const left = content.left - a.left - SIZE - 12
    const flip = left < 4
    return { x: flip ? Math.min(content.right - a.left + 12, a.width - SIZE - 4) : left, y: Math.max(c.top - a.top - 6, 40), flip }
  }, [])

  const home = useCallback(() => {
    const a = host.current?.parentElement?.getBoundingClientRect()
    return a ? { x: a.width - SIZE - 24, y: a.height - SIZE - 24, flip: false, home: true } : null
  }, [])

  const goTo = useCallback(
    (list: Spot[], i: number) => {
      const view = getView()
      setIndex(i)
      if (!view || i >= list.length) {
        view?.dispatch({ effects: setSpans.of([]) })
        setSpots([])
        setPos(home())
        setMode('walking')
        setTimeout(() => modeRef.current === 'walking' && setMode('idle'), WALK_MS)
        return
      }
      const s = list[i]
      const at = view.state.doc.toString().indexOf(s.quote)
      if (at < 0) return goTo(list, i + 1)
      view.dispatch({ effects: setSpans.of([{ from: at, to: at + s.quote.length, cls: 'cm-clawd-spot' }]) })
      setPos(place(at))
      setMode('walking')
      setTimeout(() => setMode((m) => (m === 'walking' ? 'pointing' : m)), WALK_MS)
    },
    [place, home]
  )

  const review = useCallback(
    async (byClick: boolean) => {
      const view = getView()
      if (!view || modeRef.current === 'thinking' || modeRef.current === 'pointing' || spotsRef.current.length) return
      if (inReview(view.state) || isWriting()) return byClick ? say('Finish the open suggestion first.') : undefined
      const wait = MIN_GAP_MS - (Date.now() - lastReview.current)
      if (wait > 0) return byClick ? say(`Give me ${Math.ceil(wait / 1000)}s to rest my claws…`) : undefined
      const ranges = view.visibleRanges
      const from = view.state.doc.lineAt(ranges[0]?.from ?? 0).from
      const to = view.state.doc.lineAt(ranges[ranges.length - 1]?.to ?? 0).to
      const visible = view.state.sliceDoc(from, to)
      if (visible.trim().length < 40) return byClick ? say('Write a little more and I\'ll take a look.') : undefined
      lastReview.current = Date.now()
      setMode('thinking')
      try {
        const findings = await api.claude.review(path, visible, false)
        const doc = getView()?.state.doc.toString() ?? ''
        const found = findings
          .map((f) => ({ ...f, at: doc.indexOf(f.quote, from) >= 0 ? doc.indexOf(f.quote, from) : doc.indexOf(f.quote) }))
          .filter((f) => f.quote && f.at >= 0)
        if (!found.length) {
          setMode('happy')
          say("All good! Nothing I'd change here.")
          setTimeout(() => setMode((m) => (m === 'happy' ? 'idle' : m)), HAPPY_MS)
          return
        }
        setMode('idle')
        setSpots(found)
        goTo(found, 0)
      } catch (e) {
        setMode('idle')
        toast(errorText(e))
      }
    },
    [path, goTo]
  )

  useEffect(() => {
    const onType = () => {
      lastTyped.current = Date.now()
      clearTimeout(idleTimer.current)
      if (autoReview) idleTimer.current = setTimeout(() => review(false), IDLE_REVIEW_MS)
      if (!RESTING.has(modeRef.current)) return
      setMode('typing')
      clearTimeout(typingTimer.current)
      typingTimer.current = setTimeout(() => setMode((m) => (m === 'typing' ? 'idle' : m)), 500)
    }
    typingListeners.add(onType)
    return () => {
      typingListeners.delete(onType)
      clearTimeout(idleTimer.current)
      clearTimeout(typingTimer.current)
    }
  }, [review, autoReview])

  /** Somewhere to hang: the end of a random visible line, claws on the line, body dangling below. */
  const hangSpot = useCallback(() => {
    const view = getView()
    const area = host.current?.parentElement?.getBoundingClientRect()
    if (!view || !area) return null
    const doc = view.state.doc
    const lines: number[] = []
    for (const { from, to } of view.visibleRanges)
      for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) if (doc.line(n).text.trim().length > 12) lines.push(n)
    if (!lines.length) return null
    const line = doc.line(lines[Math.floor(Math.random() * lines.length)])
    const c = view.coordsAtPos(line.to)
    if (!c || c.bottom > area.bottom - SIZE || c.top < area.top + 40) return null
    return { x: Math.min(Math.max(c.left - area.left - SIZE / 2, 8), area.width - SIZE - 8), y: c.bottom - area.top - 3 }
  }, [])

  /** Somewhere to stroll: the side margins if the window is wide, otherwise along the bottom. */
  const wanderSpot = useCallback(() => {
    const view = getView()
    const area = host.current?.parentElement?.getBoundingClientRect()
    if (!view || !area) return null
    const content = view.contentDOM.getBoundingClientRect()
    const margin = content.left - area.left
    const rand = (a: number, b: number) => a + Math.random() * Math.max(b - a, 0)
    if (margin > SIZE + 24 && Math.random() < 0.6) {
      const left = Math.random() < 0.5
      return { x: left ? rand(8, margin - SIZE - 12) : rand(content.right - area.left + 12, area.width - SIZE - 8), y: rand(70, area.height - SIZE - 30) }
    }
    return { x: rand(16, area.width - SIZE - 16), y: area.height - SIZE - 24 }
  }, [])

  const walkTo = useCallback((target: { x: number; y: number }, then: Mode) => {
    const from = posRef.current
    setPos({ ...target, flip: !!from && target.x < from.x })
    setMode('walking')
    setTimeout(() => setMode((m) => (m === 'walking' ? then : m)), WALK_MS)
  }, [])

  const trick = useCallback((t: Trick) => {
    setMode(t)
    setTimeout(() => setMode((m) => (m === t ? 'idle' : m)), TRICK_MS[t])
  }, [])

  useEffect(() => {
    if (reducedMotion()) return
    let timer: ReturnType<typeof setTimeout>
    const act = () => {
      const quietFor = Date.now() - lastTyped.current
      const mode = modeRef.current
      const free = (RESTING.has(mode) || mode === 'hanging') && mode !== 'typing' && !spotsRef.current.length
      if (free && quietFor > SLEEP_AFTER_MS) {
        if (mode !== 'sleep' && mode !== 'hanging') setMode('sleep')
      } else if (free && quietFor > QUIET_BEFORE_WANDER_MS) {
        const roll = Math.random()
        // While hanging he only climbs down somewhere else; on the ground he also does tricks.
        if (mode === 'hanging' || roll < 0.5) {
          const hang = roll < 0.25 ? hangSpot() : null
          const target = hang ?? (roll < 0.45 || mode === 'hanging' ? wanderSpot() : home())
          if (target) walkTo(target, hang ? 'hanging' : 'idle')
        } else {
          trick((['hop', 'wave', 'dance', 'look'] as const)[Math.floor(Math.random() * 4)])
        }
      }
      timer = setTimeout(act, WANDER_EVERY_MS[0] + Math.random() * (WANDER_EVERY_MS[1] - WANDER_EVERY_MS[0]))
    }
    timer = setTimeout(act, WANDER_EVERY_MS[0])
    return () => clearTimeout(timer)
  }, [hangSpot, wanderSpot, home, walkTo, trick])

  useEffect(() => {
    setSpots([])
    setPos(home())
    setMode('idle')
    return () => getView()?.dispatch({ effects: setSpans.of([]) })
  }, [path])

  useEffect(() => {
    const view = getView()
    if (!view) return
    const follow = () => {
      if (!spot) {
        setMode((m) => (m === 'hanging' ? 'idle' : m))
        return setPos(home())
      }
      const at = view.state.doc.toString().indexOf(spot.quote)
      if (at >= 0) setPos(place(at))
    }
    view.scrollDOM.addEventListener('scroll', follow, { passive: true })
    // The editor area also changes size when the side panel is resized or widened for the terminal.
    const area = host.current?.parentElement
    const ro = new ResizeObserver(() => follow())
    if (area) ro.observe(area)
    return () => {
      view.scrollDOM.removeEventListener('scroll', follow)
      ro.disconnect()
    }
  }, [spot, place, home])

  const apply = () => {
    const view = getView()
    const doc = view?.state.doc.toString() ?? ''
    const at = doc.indexOf(spot.quote)
    if (!view || at < 0) return toast('That passage has changed since I looked at it.')
    if (!propose(view, doc.slice(0, at) + spot.replacement + doc.slice(at + spot.quote.length))) return toast('Accept or reject the open suggestion first.')
    goTo(spots, index + 1)
  }

  const inspire = async () => {
    setMode('thinking')
    await onInspire({ passage: spot.quote, issue: `${spot.issue} ${spot.suggestion}` })
    setMode('pointing')
  }

  const style = pos ? { transform: `translate(${pos.x}px, ${pos.y}px)` } : { visibility: 'hidden' as const }
  return (
    <div ref={host} className={`clawd mode-${mode} ${spot || !pos?.home ? 'away' : 'home'} ${pos?.flip ? 'flip' : ''} ${placed ? '' : 'unplaced'}`} style={style}>
      <button
        className="clawd-body"
        tabIndex={-1}
        onMouseDown={noFocus}
        onClick={() => {
          lastTyped.current = Date.now()
          review(true)
        }}
        title={autoReview ? "Clawd: click for a quick review of what's on screen" : "Clawd: click for a review of what's on screen (automatic reviews are off to save your plan's limits)"}
        aria-label={`Clawd is ${mode}. Click for a review.`}
      >
        <Sprite />
      </button>
      {mode === 'pointing' && spot && (
        <div className="clawd-bubble" role="status">
          <strong>This is where I'd change…</strong>
          <p>{spot.suggestion}</p>
          <div className="clawd-actions">
            <button tabIndex={-1} onMouseDown={noFocus} onClick={apply}>Apply</button>
            <button tabIndex={-1} onMouseDown={noFocus} onClick={() => goTo(spots, index + 1)}>Dismiss</button>
            <button tabIndex={-1} onMouseDown={noFocus} onClick={inspire}>Find inspiration</button>
          </div>
          <span className="muted small">{index + 1} of {spots.length}</span>
        </div>
      )}
      {note && mode !== 'pointing' && <div className="clawd-bubble small">{note}</div>}
    </div>
  )
}
