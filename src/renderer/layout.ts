/**
 * The workspace layout: a tree of splits whose leaves are panes of tabs. A tab is a vault file path or `view:<id>`
 * (Graph, Claude Code…). Each tab lives in at most one pane. Every function here is pure and returns a new tree.
 */
export type Tab = string
export type Pane = { type: 'pane'; id: string; tabs: Tab[]; active: Tab | null }
export type Split = { type: 'split'; id: string; dir: 'row' | 'col'; children: Node[]; sizes: number[] }
export type Node = Pane | Split
export type Zone = 'center' | 'left' | 'right' | 'top' | 'bottom'

export const VIEW = 'view:'
export const isView = (t: Tab) => t.startsWith(VIEW)

let seq = 0
const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`
export const pane = (tabs: Tab[] = [], active: Tab | null = tabs[0] ?? null): Pane => ({ type: 'pane', id: newId('p'), tabs, active })

export const panes = (n: Node): Pane[] => (n.type === 'pane' ? [n] : n.children.flatMap(panes))
export const paneWith = (root: Node, tab: Tab) => panes(root).find((p) => p.tabs.includes(tab))
export const paneById = (root: Node, id: string) => panes(root).find((p) => p.id === id)

/** Rebuilds the tree through `f` (null drops a pane), dropping empty splits and merging same-direction nesting. */
function mapPanes(n: Node, f: (p: Pane) => Node | null): Node | null {
  if (n.type === 'pane') return f(n)
  const children: Node[] = []
  const sizes: number[] = []
  n.children.forEach((c, i) => {
    const m = mapPanes(c, f)
    if (!m) return
    if (m.type === 'split' && m.dir === n.dir) {
      const total = m.sizes.reduce((a, b) => a + b, 0)
      m.children.forEach((cc, j) => (children.push(cc), sizes.push((n.sizes[i] * m.sizes[j]) / total)))
    } else children.push(m), sizes.push(n.sizes[i])
  })
  if (!children.length) return null
  if (children.length === 1) return children[0]
  const total = sizes.reduce((a, b) => a + b, 0)
  return { ...n, children, sizes: sizes.map((s) => s / total) }
}

const withPanes = (root: Node, f: (p: Pane) => Node | null): Node => mapPanes(root, f) ?? pane()

/** Closes a tab; a pane left empty disappears unless it is the last one. */
export function removeTab(root: Node, tab: Tab): Node {
  const solo = panes(root).length === 1
  return withPanes(root, (p) => {
    const i = p.tabs.indexOf(tab)
    if (i < 0) return p
    const tabs = p.tabs.filter((t) => t !== tab)
    if (!tabs.length && !solo) return null
    return { ...p, tabs, active: p.active === tab ? tabs[Math.min(i, tabs.length - 1)] ?? null : p.active }
  })
}

export const activate = (root: Node, paneId: string, tab: Tab): Node => withPanes(root, (p) => (p.id === paneId && p.tabs.includes(tab) ? { ...p, active: tab } : p))

/** Moves (or opens) a tab into a pane as its active tab. */
export function addTab(root: Node, paneId: string, tab: Tab): Node {
  if (paneWith(root, tab)?.id === paneId) return activate(root, paneId, tab)
  const target = paneById(root, paneId)
  if (!target) return root
  const rest = removeTab(root, tab)
  // The target may have been the sole empty pane, rebuilt by removeTab; find it again by id or fall back to the root.
  const id = paneById(rest, paneId)?.id ?? panes(rest)[0].id
  return withPanes(rest, (p) => (p.id === id ? { ...p, tabs: [...p.tabs, tab], active: tab } : p))
}

/** Drops a tab on a pane: the middle adds it as a tab, an edge splits the pane and gives the tab its own pane. */
export function dropTab(root: Node, paneId: string, zone: Zone, tab: Tab): Node {
  if (zone === 'center') return addTab(root, paneId, tab)
  const source = paneWith(root, tab)
  if (source?.id === paneId && source.tabs.length === 1) return root
  const rest = removeTab(root, tab)
  if (!paneById(rest, paneId)) return root
  const fresh = pane([tab])
  const next = withPanes(rest, (p) => {
    if (p.id !== paneId) return p
    const before = zone === 'left' || zone === 'top'
    return { type: 'split', id: newId('s'), dir: zone === 'left' || zone === 'right' ? 'row' : 'col', children: before ? [fresh, p] : [p, fresh], sizes: [0.5, 0.5] }
  })
  return evenAround(next, fresh.id)
}

/** Drops a tab on the outer edge of the workspace: it gets its own pane spanning the whole side. */
export function dropAtRoot(root: Node, zone: Exclude<Zone, 'center'>, tab: Tab): Node {
  if (panes(root).length === 1 && panes(root)[0].tabs.length === 1 && panes(root)[0].tabs[0] === tab) return root
  const rest = removeTab(root, tab)
  const fresh = pane([tab])
  const before = zone === 'left' || zone === 'top'
  const split: Node = { type: 'split', id: newId('s'), dir: zone === 'left' || zone === 'right' ? 'row' : 'col', children: before ? [fresh, rest] : [rest, fresh], sizes: [0.5, 0.5] }
  return evenAround(withPanes(split, (p) => p), fresh.id)
}

/** Panes side by side share their row (or column) equally, so four notes dropped in a row get a quarter each. */
function evenAround(n: Node, paneId: string): Node {
  if (n.type === 'pane') return n
  const children = n.children.map((c) => evenAround(c, paneId))
  const sizes = n.children.some((c) => c.type === 'pane' && c.id === paneId) ? n.children.map(() => 1 / n.children.length) : n.sizes
  return { ...n, children, sizes }
}

export function resize(n: Node, splitId: string, sizes: number[]): Node {
  if (n.type === 'pane') return n
  return { ...n, sizes: n.id === splitId ? sizes : n.sizes, children: n.children.map((c) => resize(c, splitId, sizes)) }
}

export const renameTabs = (root: Node, f: (t: Tab) => Tab): Node =>
  withPanes(root, (p) => ({ ...p, tabs: p.tabs.map(f), active: p.active && f(p.active) }))

/** Loads a saved layout, or null when it is missing or malformed. */
export function parseLayout(json: string | null): Node | null {
  const ok = (n: any): boolean =>
    n?.type === 'pane'
      ? typeof n.id === 'string' && Array.isArray(n.tabs) && n.tabs.every((t: unknown) => typeof t === 'string')
      : n?.type === 'split' && (n.dir === 'row' || n.dir === 'col') && Array.isArray(n.children) && n.children.length === n.sizes?.length && n.children.every(ok)
  try {
    const n = JSON.parse(json ?? '')
    return ok(n) ? n : null
  } catch {
    return null
  }
}
