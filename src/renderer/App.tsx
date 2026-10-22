import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, errorText, type TreeNode } from './api'
import { Overlays, ask, toast } from './ui'
import { FileTree } from './FileTree'
import { Palette, type Command } from './Palette'
import { Backlinks } from './Backlinks'
import { ReviewPanel } from './ReviewPanel'
import { AssistantPanel } from './AssistantPanel'
import { isWriting } from './cm/suggest'
import { Clawd } from './Clawd'
import { InspirationPanel, type InspirationState } from './InspirationPanel'
import './clawd.css'
import { GDocsDialogs, gdocs, live } from './GDocs'
import { Editor, applyExternal, closeDoc, configureEditor, flush, flushAll, forgetDoc, hasPending, isPending, openFind, renameDocs } from './Editor'
import { resolveLink } from '../shared/links'
import { Canvas } from './Canvas'
import { Graph } from './Graph'
import { Connections, type ConnectionState } from './Connections'
import { StatusBar } from './StatusBar'
import { Icon } from './icons'
import { FileViewer } from './FileViewer'
import { AiCheckPanel } from './AiCheckPanel'
import { ClaudeTerminal } from './ClaudeTerminal'
import { CommentsPanel } from './CommentsPanel'
import { iconFor } from './FileTree'
import { LayoutView, Ribbon, ViewSlot, viewEl, type Ops, type RibbonItem } from './Workspace'
import { activate, addTab, dropTab, isView, pane, paneById, paneWith, panes, parseLayout, removeTab, renameTabs, resize, type Node, type Tab } from './layout'
import type { IconName } from './icons'

const VIEWS: (RibbonItem & { full?: boolean })[] = [
  { tab: 'view:graph', label: 'Graph', icon: 'graph', full: true },
  { tab: 'view:backlinks', label: 'Backlinks', icon: 'link' },
  { tab: 'view:review', label: 'Review', icon: 'review' },
  { tab: 'view:comments', label: 'Comments', icon: 'comment' },
  { tab: 'view:aicheck', label: 'AI check', icon: 'gauge' },
  { tab: 'view:claude', label: 'Claude Code', icon: 'terminal', full: true },
  { tab: 'view:assistant', label: 'Assistant', icon: 'sparkle' },
  { tab: 'view:inspiration', label: 'Inspiration', icon: 'bulb' }
]
const viewDef = (t: Tab) => VIEWS.find((v) => v.tab === t)
const layoutKey = (vault: string) => `wc.layout:${vault}`
const loadLayout = (vault: string): Node => {
  try {
    return parseLayout(localStorage.getItem(layoutKey(vault))) ?? pane()
  } catch {
    return pane()
  }
}
const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* the layout just won't be remembered */
  }
}

const writeGuard = () => {
  if (isWriting()) toast('Claude is still writing. Wait or press Stop.')
  return isWriting()
}
const flatten = (nodes: TreeNode[]): string[] => nodes.flatMap((n) => (n.dir ? flatten(n.children ?? []) : [n.path]))
const under = (p: string, base: string) => p === base || p.startsWith(base + '/')
const filesRef: { current: string[] } = { current: [] }
const openLinkRef: { current: (target: string) => void } = { current: () => {} }

configureEditor({ files: () => filesRef.current, openLink: (t) => openLinkRef.current(t) })

export function App() {
  const [vault, setVault] = useState<string | null>(null)
  const [tree, setTree] = useState<TreeNode[]>([])
  const [layout, setLayoutState] = useState<Node>(() => pane())
  const layoutRef = useRef(layout)
  const setLayout = (next: Node) => {
    layoutRef.current = next
    setLayoutState(next)
  }
  const [focusedPane, setFocusedPane] = useState<string | null>(null)
  /** The note (or file) the user is working in: the panels, Clawd and the Google Docs commands act on it. */
  const [active, setActive] = useState<string | null>(null)
  const lastFilePane = useRef<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [palette, setPalette] = useState(false)
  const [treeOpen, setTreeOpen] = useState(() => {
    try {
      return localStorage.getItem('wc.treeOpen') !== '0'
    } catch {
      return true
    }
  })
  const [conn, setConn] = useState<ConnectionState>({})
  const [showConnections, setShowConnections] = useState(false)
  const [reviewTrigger, setReviewTrigger] = useState(0)
  const [aiTrigger, setAiTrigger] = useState(0)
  const [clawdOn, setClawdOn] = useState(false)
  const [inspo, setInspo] = useState<InspirationState | null>(null)
  const files = useMemo(() => flatten(tree), [tree])
  filesRef.current = files
  const allTabs = () => panes(layoutRef.current).flatMap((p) => p.tabs)

  const refresh = useCallback(async () => {
    setTree(await api.vault.tree())
    setNotes(await api.vault.notes())
  }, [])

  /** Makes a tab the one being worked in: files become the active note. */
  const focusTab = (paneId: string, tab: Tab) => {
    setFocusedPane(paneId)
    if (isView(tab)) return
    setActive(tab)
    lastFilePane.current = paneId
  }

  /** Opens a file or a view: where it already is, else files join the last note pane and views the view pane. */
  const open = useCallback((tab: Tab) => {
    if (writeGuard()) return
    const l = layoutRef.current
    const at = paneWith(l, tab)
    if (at) {
      setLayout(activate(l, at.id, tab))
      return focusTab(at.id, tab)
    }
    const all = panes(l)
    const target = isView(tab)
      ? all.find((p) => p.tabs.length && p.tabs.every(isView))
      : (lastFilePane.current && paneById(l, lastFilePane.current)) || all.find((p) => p.tabs.some((t) => !isView(t))) || all.find((p) => !p.tabs.length)
    const next = target ? addTab(l, target.id, tab) : dropTab(l, (all.find((p) => p.tabs.some((t) => !isView(t))) ?? all[0]).id, isView(tab) ? 'right' : 'left', tab)
    setLayout(next)
    focusTab(paneWith(next, tab)!.id, tab)
  }, [])

  const closeTab = useCallback(async (tab: Tab) => {
    if (writeGuard()) return
    if (!isView(tab)) await closeDoc(tab)
    const next = removeTab(layoutRef.current, tab)
    setLayout(next)
    setActive((a) => {
      if (a !== tab) return a
      const p = (lastFilePane.current && paneById(next, lastFilePane.current)) || panes(next).find((x) => x.active && !isView(x.active))
      return p?.active && !isView(p.active) ? p.active : null
    })
  }, [])

  openLinkRef.current = async (target) => {
    const hit = resolveLink(target, filesRef.current)
    if (hit) return open(hit)
    const path = `${target}.md`
    try {
      await api.vault.create(path, false)
      await refresh()
      open(path)
    } catch (e) {
      toast(errorText(e))
    }
  }

  useEffect(() => {
    api.settings.get().then((s) => setClawdOn(s.clawd))
    Promise.all([api.claude.status(), api.gdocs.status()]).then(([claude, google]) => setConn({ claude, google }))
    api.vault.current().then((v) => {
      setVault(v)
      if (v) refresh()
    })
    let timer: ReturnType<typeof setTimeout>
    const off = api.vault.onEvent((e) => {
      if (e.type === 'change') applyExternal(e.path, e.content)
      if (e.type === 'unlink' && paneWith(layoutRef.current, e.path)) {
        if (isPending(e.path)) toast(`${e.path} was deleted on disk; your unsaved text will recreate it.`)
        else {
          forgetDoc(e.path)
          closeTab(e.path)
        }
      }
      clearTimeout(timer)
      timer = setTimeout(refresh, 150)
    })
    const guard = (e: BeforeUnloadEvent) => {
      if (!hasPending()) return
      e.preventDefault()
      e.returnValue = false
      flushAll().then(() => window.close())
    }
    window.addEventListener('beforeunload', guard)
    return () => {
      off()
      window.removeEventListener('beforeunload', guard)
    }
  }, [refresh, closeTab])

  const pickVault = async () => {
    await flushAll()
    const v = await api.vault.pick()
    if (!v) return
    allTabs().filter((t) => !isView(t)).forEach(forgetDoc)
    setActive(null)
    setVault(v)
    refresh()
  }

  const newEntry = async (folder: string, dir: boolean, ext = '.md') => {
    const name = await ask(dir ? 'New folder name' : ext === '.canvas' ? 'New canvas name' : 'New note name')
    if (!name) return
    let path = folder ? `${folder}/${name}` : name
    if (!dir && !/\.(md|canvas)$/.test(path)) path += ext
    try {
      await api.vault.create(path, dir)
      if (path.endsWith('.canvas')) await api.vault.write(path, JSON.stringify({ nodes: [], edges: [] }, null, '\t'))
      await refresh()
      if (!dir) open(path)
    } catch (e) {
      toast(errorText(e))
    }
  }

  const rename = async (from: string) => {
    const to = await ask('Rename / move to (path inside the vault)', from)
    if (!to || to === from) return
    try {
      await Promise.all(allTabs().filter((t) => under(t, from)).map(flush))
      await api.vault.move(from, to)
      await renameDocs(from, to)
      const map = (p: string) => (under(p, from) ? to + p.slice(from.length) : p)
      setLayout(renameTabs(layoutRef.current, map))
      setActive((a) => (a ? map(a) : a))
      await refresh()
    } catch (e) {
      toast(errorText(e))
    }
  }

  const remove = async (path: string) => {
    if (!confirm(`Move "${path}" to the trash?`)) return
    try {
      for (const t of allTabs().filter((t) => under(t, path))) await closeTab(t)
      await api.vault.trash(path)
      await refresh()
    } catch (e) {
      toast(errorText(e))
    }
  }

  const toggleTree = () =>
    setTreeOpen((o) => {
      remember('wc.treeOpen', o ? '0' : '1')
      return !o
    })
  const focusedTab = () => paneById(layoutRef.current, focusedPane ?? '')?.active ?? null

  // Each vault remembers its own layout. Tabs of files that no longer exist are dropped once the file list is known.
  const pruned = useRef<string | null>(null)
  useEffect(() => {
    if (!vault) return
    pruned.current = null
    lastFilePane.current = null
    const l = loadLayout(vault)
    setLayout(l)
    const first = panes(l).find((p) => p.active && !isView(p.active))
    setActive(first?.active ?? null)
    setFocusedPane(first?.id ?? panes(l)[0].id)
    if (first) lastFilePane.current = first.id
  }, [vault])
  useEffect(() => {
    if (!vault || !tree.length || pruned.current === vault) return
    pruned.current = vault
    const gone = allTabs().filter((t) => !isView(t) && !files.includes(t))
    if (gone.length) setLayout(gone.reduce(removeTab, layoutRef.current))
  }, [vault, tree, files])
  useEffect(() => {
    if (vault) remember(layoutKey(vault), JSON.stringify(layout))
  }, [vault, layout])

  const toggleClawd = () => {
    setClawdOn(!clawdOn)
    api.settings.set({ clawd: !clawdOn })
  }

  const inspire = async (a: { passage: string; issue: string }) => {
    open('view:inspiration')
    setInspo({ passage: a.passage })
    try {
      setInspo({ passage: a.passage, items: await api.claude.inspire(a) })
    } catch (e) {
      setInspo({ passage: a.passage, error: errorText(e) })
      toast(errorText(e))
    }
  }

  const commands: Command[] = [
    { label: 'Open vault folder…', run: pickVault },
    { label: 'Connections: Claude and Google sign-in', run: () => setShowConnections(true) },
    { label: 'New note', run: () => newEntry('', false) },
    { label: 'New folder', run: () => newEntry('', true) },
    { label: 'New canvas (mind map)', run: () => newEntry('', false, '.canvas') },
    { label: 'Open graph view', run: () => open('view:graph') },
    { label: 'Toggle file list', run: () => toggleTree() },
    { label: 'Review content (Claude)', run: () => (open('view:review'), setReviewTrigger((n) => n + 1)) },
    { label: 'AI check: score this note (Claude + local detector)', run: () => (open('view:aicheck'), setAiTrigger((n) => n + 1)) },
    { label: 'Open writing assistant', run: () => open('view:assistant') },
    { label: 'Open Claude Code', run: () => open('view:claude') },
    ...VIEWS.filter((v) => !['view:graph', 'view:assistant', 'view:claude'].includes(v.tab)).map((v) => ({ label: `Open ${v.label}`, run: () => open(v.tab) })),
    { label: clawdOn ? 'Turn Clawd off' : 'Turn Clawd on', run: toggleClawd },
    ...(active?.endsWith('.md')
      ? [
          { label: 'Google Docs: Link to a new doc', run: () => gdocs.linkNew(active) },
          { label: 'Google Docs: Link to an existing doc…', run: () => gdocs.linkExisting(active) },
          { label: 'Google Docs: Push note → Doc', run: () => gdocs.push(active) },
          { label: 'Google Docs: Pull Doc → note', run: () => gdocs.pull(active) }
        ]
      : []),
    { label: live.on ? 'Google Docs: Turn live sync off' : 'Google Docs: Turn live sync on', run: gdocs.toggleLive },
    { label: 'Google Docs: Sign out', run: gdocs.signOut },
    ...(focusedTab() ? [{ label: 'Close tab', run: () => closeTab(focusedTab()!) }] : []),
    ...(active ? [{ label: 'Rename current file', run: () => rename(active) }] : []),
    ...files.map((f) => ({ label: `Open: ${f}`, run: () => open(f) }))
  ]

  /** ⌃Tab cycles the tabs of the focused pane; from a pane of views (e.g. the terminal), the notes pane's tabs. */
  const cycleTab = (step: 1 | -1) => {
    const l = layoutRef.current
    const focused = paneById(l, focusedPane ?? '')
    const p = (focused?.tabs.some((t) => !isView(t)) && focused) || paneById(l, lastFilePane.current ?? '') || focused || panes(l)[0]
    if (p.tabs.length < 2 || writeGuard()) return
    const next = p.tabs[(p.tabs.indexOf(p.active ?? '') + step + p.tabs.length) % p.tabs.length]
    setLayout(activate(layoutRef.current, p.id, next))
    focusTab(p.id, next)
  }
  const cycleTabRef = useRef(cycleTab)
  cycleTabRef.current = cycleTab

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setPalette((p) => !p)
      }
      // ⌃Tab / ⌃⇧Tab: next / previous tab, from anywhere (the terminal included).
      if (e.ctrlKey && !e.metaKey && e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        cycleTabRef.current(e.shiftKey ? -1 : 1)
      }
      // ⌘F outside the editor (side panel, terminal…) still finds in the open note; inside, CodeMirror handles it.
      if (e.metaKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f' && !(e.target as HTMLElement).closest?.('.cm-editor')) {
        if (openFind()) {
          e.preventDefault()
          e.stopPropagation()
        }
      }
    }
    const openConnections = () => setShowConnections(true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('wc:open-connections', openConnections)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('wc:open-connections', openConnections)
    }
  }, [])

  if (!vault)
    return (
      <div className="welcome">
        <div className="welcome-card">
          <h1>Writing Centre</h1>
          <p className="muted">Pick a folder of markdown notes to write in. An Obsidian vault works as is; nothing is copied or uploaded.</p>
          <button className="primary" onClick={pickVault}><Icon name="folderOpen" /> Open a vault folder</button>
        </div>
        <Overlays />
      </div>
    )

  const tabLabel = (t: Tab) => viewDef(t)?.label ?? t.split('/').pop()!.replace(/\.(md|canvas)$/, '')
  const tabIcon = (t: Tab): IconName => viewDef(t)?.icon ?? iconFor({ name: t })
  const isText = (t: string | null) => !!t && /\.(md|txt)$/i.test(t)
  const shownViews = new Set(panes(layout).map((p) => p.active).filter((t): t is Tab => !!t && isView(t)))

  const renderView = (t: Tab, visible: boolean) => {
    switch (t) {
      case 'view:graph': return <Graph notes={notes} files={files} onOpen={open} />
      case 'view:backlinks': return <Backlinks active={active} notes={notes} files={files} onOpen={open} />
      case 'view:review': return <ReviewPanel path={active} trigger={reviewTrigger} />
      case 'view:comments': return <CommentsPanel path={active} visible={visible} />
      case 'view:aicheck': return <AiCheckPanel path={active} trigger={aiTrigger} visible={visible} />
      case 'view:claude': return <ClaudeTerminal visible={visible} activePath={active} />
      case 'view:assistant': return <AssistantPanel path={active} authMethod={conn.claude?.method} />
      case 'view:inspiration': return <InspirationPanel state={inspo} />
    }
    return null
  }

  const ops: Ops = {
    label: tabLabel,
    icon: tabIcon,
    focused: focusedPane,
    body: (t, p) => {
      if (isView(t)) return <ViewSlot tab={t} />
      if (isText(t))
        return (
          <>
            <Editor key={p.id} path={t} active={t === active} />
            {t === active && clawdOn && <Clawd path={t} onInspire={inspire} autoReview={conn.claude?.method !== 'subscription'} />}
          </>
        )
      if (t.endsWith('.canvas')) return <Canvas path={t} notes={notes} onOpen={open} />
      return <FileViewer path={t} />
    },
    onFocus: (id) => {
      if (id === focusedPane) return
      const t = paneById(layoutRef.current, id)?.active
      if (t) focusTab(id, t)
      else setFocusedPane(id)
    },
    onActivate: (id, t) => {
      if (writeGuard()) return
      setLayout(activate(layoutRef.current, id, t))
      focusTab(id, t)
    },
    onClose: closeTab,
    onDrop: (id, zone, t) => {
      if (writeGuard()) return
      if (!isView(t) && !files.includes(t)) return
      const next = dropTab(layoutRef.current, id, zone, t)
      setLayout(next)
      const at = paneWith(next, t)
      if (at) focusTab(at.id, t)
    },
    onResize: (id, sizes) => setLayout(resize(layoutRef.current, id, sizes)),
    ownsFileDrop: (t) => t.endsWith('.canvas')
  }

  return (
    <div className={`shell ${treeOpen ? '' : 'no-tree'}`}>
      <Ribbon items={VIEWS} visible={(t) => shownViews.has(t)} onOpen={open} treeOpen={treeOpen} onTree={toggleTree} onPalette={() => setPalette(true)} onConnections={() => setShowConnections(true)} />
      {treeOpen && (
        <FileTree
          vaultName={vault.replace(/\/+$/, '').split('/').pop() || vault}
          onPickVault={pickVault}
          nodes={tree}
          active={active}
          onOpen={open}
          onNew={newEntry}
          onRename={rename}
          onDelete={remove}
          onGraph={() => open('view:graph')}
          onNewCanvas={() => newEntry('', false, '.canvas')}
        />
      )}
      <main className="workspace">
        <LayoutView node={layout} ops={ops} />
      </main>
      {panes(layout).flatMap((p) => p.tabs.filter(isView)).map((t) =>
        createPortal(renderView(t, shownViews.has(t)), viewEl(t, `view-root ${viewDef(t)?.full ? 'full' : ''} view-${t.slice(5)}`), t)
      )}
      <StatusBar conn={conn} clawdOn={clawdOn} onClawd={toggleClawd} onConnections={() => setShowConnections(true)} onPalette={() => setPalette(true)} />
      {palette && <Palette commands={commands} onClose={() => setPalette(false)} />}
      {showConnections && <Connections state={conn} onChange={setConn} onClose={() => setShowConnections(false)} />}
      <GDocsDialogs />
      <Overlays />
    </div>
  )
}
