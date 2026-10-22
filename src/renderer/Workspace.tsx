import { useEffect, useLayoutEffect, useRef, useState, type DragEvent as ReactDragEvent, type ReactNode } from 'react'
import { DRAG_TYPE } from './FileTree'
import { Icon, type IconName } from './icons'
import { isView, type Node, type Pane, type Tab, type Zone } from './layout'

/** Drag payload for tabs and ribbon views; file-tree rows use DRAG_TYPE. Both carry a tab name. */
export const TAB_DRAG = 'application/x-wc-tab'
const draggedTab = (e: DragEvent | ReactDragEvent) => e.dataTransfer?.getData(TAB_DRAG) || e.dataTransfer?.getData(DRAG_TYPE) || ''
const isTabDrag = (e: DragEvent | ReactDragEvent) => !!e.dataTransfer && [TAB_DRAG, DRAG_TYPE].some((t) => e.dataTransfer!.types.includes(t))

/**
 * Views (Graph, Claude Code, Assistant…) are rendered once into their own DOM node, and that node is moved into
 * whichever pane shows the view. Moving or rearranging panes therefore never restarts the terminal or clears a chat.
 */
const viewEls = new Map<Tab, HTMLDivElement>()
export function viewEl(tab: Tab, className: string) {
  let el = viewEls.get(tab)
  if (!el) viewEls.set(tab, (el = document.createElement('div')))
  el.className = className
  return el
}

export function ViewSlot({ tab }: { tab: Tab }) {
  const slot = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = viewEls.get(tab)
    const host = slot.current
    if (!el || !host) return
    host.appendChild(el)
    return () => void (el.parentElement === host && host.removeChild(el))
  }, [tab])
  return <div className="view-slot" ref={slot} />
}

export type Ops = {
  label: (t: Tab) => string
  icon: (t: Tab) => IconName
  body: (t: Tab, pane: Pane) => ReactNode
  focused: string | null
  onFocus: (paneId: string) => void
  onActivate: (paneId: string, t: Tab) => void
  onClose: (t: Tab) => void
  onDrop: (paneId: string, zone: Zone, t: Tab) => void
  onResize: (splitId: string, sizes: number[]) => void
  /** A file dropped in the middle of this tab is handled by the tab itself (a canvas adds it as a card). */
  ownsFileDrop: (t: Tab) => boolean
}

type Rect = { x: number; y: number; w: number; h: number }
type Divider = { split: Extract<Node, { type: 'split' }>; i: number; at: Rect; box: Rect }

/** Where every pane and divider goes, as fractions of the workspace. */
function place(n: Node, r: Rect, panesOut: [Pane, Rect][], dividers: Divider[]) {
  if (n.type === 'pane') return void panesOut.push([n, r])
  let offset = 0
  n.children.forEach((c, i) => {
    const row = n.dir === 'row'
    const part = row ? { ...r, x: r.x + offset * r.w, w: n.sizes[i] * r.w } : { ...r, y: r.y + offset * r.h, h: n.sizes[i] * r.h }
    if (i > 0) dividers.push({ split: n, i, at: row ? { ...part, w: 0 } : { ...part, h: 0 }, box: r })
    place(c, part, panesOut, dividers)
    offset += n.sizes[i]
  })
}
const pct = (f: number) => `${f * 100}%`

/**
 * Panes are laid out flat, absolutely positioned from the split tree, so splitting or moving panes never remounts
 * a pane: editors keep their scroll and Clawd keeps whatever he was doing.
 */
export function LayoutView({ node, ops }: { node: Node; ops: Ops }) {
  const box = useRef<HTMLDivElement>(null)
  const placed: [Pane, Rect][] = []
  const dividers: Divider[] = []
  place(node, { x: 0, y: 0, w: 1, h: 1 }, placed, dividers)

  const startResize = (e: React.MouseEvent, d: Divider) => {
    e.preventDefault()
    const rect = box.current!.getBoundingClientRect()
    const row = d.split.dir === 'row'
    const total = row ? rect.width * d.box.w : rect.height * d.box.h
    const start = row ? e.clientX : e.clientY
    const sizes = d.split.sizes
    const [a, b] = [sizes[d.i - 1], sizes[d.i]]
    const min = Math.min(0.08, (a + b) / 2)
    document.body.classList.add(row ? 'resizing-row' : 'resizing-col')
    const move = (ev: MouseEvent) => {
      const delta = ((row ? ev.clientX : ev.clientY) - start) / total
      const next = Math.min(Math.max(a + delta, min), a + b - min)
      ops.onResize(d.split.id, sizes.map((s, j) => (j === d.i - 1 ? next : j === d.i ? a + b - next : s)))
    }
    const up = () => {
      document.body.classList.remove('resizing-row', 'resizing-col')
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div ref={box} className="layout">
      {placed.map(([p, r]) => (
        <div key={p.id} className="pane-slot" style={{ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) }}>
          <PaneView pane={p} ops={ops} />
        </div>
      ))}
      {dividers.map((d) => (
        <div
          key={`${d.split.id}:${d.i}`}
          className={`divider ${d.split.dir}`}
          style={d.split.dir === 'row' ? { left: pct(d.at.x), top: pct(d.at.y), height: pct(d.at.h) } : { top: pct(d.at.y), left: pct(d.at.x), width: pct(d.at.w) }}
          onMouseDown={(e) => startResize(e, d)}
          title="Drag to resize"
        />
      ))}
    </div>
  )
}

function zoneAt(el: HTMLElement, e: DragEvent): Zone {
  const r = el.getBoundingClientRect()
  const x = (e.clientX - r.left) / r.width
  const y = (e.clientY - r.top) / r.height
  const edge = Math.min(x, 1 - x, y, 1 - y)
  if (edge > 0.22) return 'center'
  return edge === x ? 'left' : edge === 1 - x ? 'right' : edge === y ? 'top' : 'bottom'
}

function PaneView({ pane, ops }: { pane: Pane; ops: Ops }) {
  const box = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const [zone, setZone] = useState<Zone | null>(null)
  const opsRef = useRef(ops)
  opsRef.current = ops
  const paneRef = useRef(pane)
  paneRef.current = pane

  // Native listeners: views are portals, so their events don't bubble through React's pane tree.
  useEffect(() => {
    const el = body.current!
    const outer = box.current!
    const zoneFor = (e: DragEvent): Zone | null => {
      if (!isTabDrag(e)) return null
      const z = zoneAt(el, e)
      const fileDrag = !e.dataTransfer!.types.includes(TAB_DRAG)
      const active = paneRef.current.active
      return z === 'center' && fileDrag && active && opsRef.current.ownsFileDrop(active) ? null : z
    }
    const over = (e: DragEvent) => {
      const z = zoneFor(e)
      setZone(z)
      if (z) e.preventDefault()
    }
    const leave = (e: DragEvent) => !el.contains(e.relatedTarget as globalThis.Node) && setZone(null)
    const drop = (e: DragEvent) => {
      const z = zoneFor(e)
      setZone(null)
      const tab = draggedTab(e)
      if (!z || !tab) return
      e.preventDefault()
      e.stopPropagation()
      opsRef.current.onDrop(paneRef.current.id, z, tab)
    }
    const focus = () => opsRef.current.onFocus(paneRef.current.id)
    el.addEventListener('dragover', over)
    el.addEventListener('dragleave', leave)
    el.addEventListener('drop', drop)
    outer.addEventListener('mousedown', focus, true)
    outer.addEventListener('focusin', focus)
    return () => {
      el.removeEventListener('dragover', over)
      el.removeEventListener('dragleave', leave)
      el.removeEventListener('drop', drop)
      outer.removeEventListener('mousedown', focus, true)
      outer.removeEventListener('focusin', focus)
    }
  }, [])

  return (
    <section ref={box} className={`pane ${ops.focused === pane.id ? 'focused' : ''}`} data-pane={pane.id}>
      <div
        className="tabs"
        onDragOver={(e) => isTabDrag(e) && e.preventDefault()}
        onDrop={(e) => {
          const tab = draggedTab(e)
          if (!tab) return
          e.preventDefault()
          ops.onDrop(pane.id, 'center', tab)
        }}
      >
        {pane.tabs.map((t) => (
          <div
            key={t}
            className={`tab ${t === pane.active ? 'active' : ''} ${isView(t) ? 'view-tab' : ''}`}
            draggable
            onDragStart={(e) => e.dataTransfer.setData(TAB_DRAG, t)}
            onClick={() => ops.onActivate(pane.id, t)}
            title={isView(t) ? `${ops.label(t)}: drag to move` : `${t}: drag to move`}
          >
            <Icon name={ops.icon(t)} size={14} />
            <span>{ops.label(t)}</span>
            <button onClick={(e) => (e.stopPropagation(), ops.onClose(t))} aria-label={`Close ${ops.label(t)}`}><Icon name="close" size={12} /></button>
          </div>
        ))}
      </div>
      <div ref={body} className="pane-body">
        {pane.active ? ops.body(pane.active, pane) : <div className="empty"><p>Drop a file or a view from the left bar here, or press ⌘P.</p></div>}
        {zone && <div className={`drop-zone ${zone}`} />}
      </div>
    </section>
  )
}

export type RibbonItem = { tab: Tab; label: string; icon: IconName }

/** The thin left bar: click a view to open it, or drag it onto any pane (edge = split, middle = new tab). */
export function Ribbon(p: { items: RibbonItem[]; visible: (t: Tab) => boolean; onOpen: (t: Tab) => void; treeOpen: boolean; onTree: () => void; onPalette: () => void; onConnections: () => void }) {
  return (
    <nav className="ribbon" aria-label="Views">
      <button className={p.treeOpen ? 'on' : ''} onClick={p.onTree} aria-label="Files" title="Show or hide the file list"><Icon name="sidebar" /></button>
      <span className="ribbon-rule" />
      {p.items.map((i) => (
        <button
          key={i.tab}
          className={p.visible(i.tab) ? 'on' : ''}
          draggable
          onDragStart={(e) => e.dataTransfer.setData(TAB_DRAG, i.tab)}
          onClick={() => p.onOpen(i.tab)}
          aria-label={i.label}
          title={`${i.label}: click to open, or drag onto a pane`}
        >
          <Icon name={i.icon} />
        </button>
      ))}
      <span className="ribbon-spacer" />
      <button onClick={p.onPalette} aria-label="Command palette" title="Command palette (⌘P)"><Icon name="command" /></button>
      <button onClick={p.onConnections} aria-label="Connections" title="Connections: Claude and Google sign-in"><Icon name="plug" /></button>
    </nav>
  )
}
