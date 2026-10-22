import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, errorText, type TreeNode } from './api'
import { Overlays, ask, toast } from './ui'
import { FileTree } from './FileTree'
import { Palette, type Command } from './Palette'
import { Backlinks, SidePanel } from './SidePanel'
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

const GRAPH = '::graph'

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
  const [tabs, setTabs] = useState<string[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [palette, setPalette] = useState(false)
  const [sideOpen, setSideOpen] = useState(true)
  const [sideTab, setSideTab] = useState('backlinks')
  const [sideWidth, setSideWidthState] = useState(() => {
    try {
      return Number(localStorage.getItem('sideWidth')) || 360
    } catch {
      return 360
    }
  })
  const setSideWidth = (w: number) => {
    setSideWidthState(w)
    try {
      localStorage.setItem('sideWidth', String(w))
    } catch {
      /* width just won't be remembered */
    }
  }
  const selectSideTab = (id: string) => {
    setSideTab(id)
    // The terminal needs room for Claude Code's layout.
    if (id === 'claude' && sideWidth < 520) setSideWidth(Math.min(580, Math.max(window.innerWidth - 640, 360)))
  }
  const [conn, setConn] = useState<ConnectionState>({})
  const [showConnections, setShowConnections] = useState(false)
  const [reviewTrigger, setReviewTrigger] = useState(0)
  const [aiTrigger, setAiTrigger] = useState(0)
  const [clawdOn, setClawdOn] = useState(false)
  const [inspo, setInspo] = useState<InspirationState | null>(null)
  const files = useMemo(() => flatten(tree), [tree])
  filesRef.current = files
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs

  const refresh = useCallback(async () => {
    setTree(await api.vault.tree())
    setNotes(await api.vault.notes())
  }, [])

  const open = useCallback((path: string) => {
    if (writeGuard()) return
    setTabs((t) => (t.includes(path) ? t : [...t, path]))
    setActive(path)
  }, [])

  const closeTab = useCallback(async (path: string) => {
    if (writeGuard()) return
    await closeDoc(path)
    const rest = tabsRef.current.filter((t) => t !== path)
    setTabs(rest)
    setActive((a) => (a === path ? rest[rest.length - 1] ?? null : a))
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
      if (e.type === 'unlink' && tabsRef.current.includes(e.path)) {
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
    tabsRef.current.forEach(forgetDoc)
    setTabs([])
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
      await Promise.all(tabsRef.current.filter((t) => under(t, from)).map(flush))
      await api.vault.move(from, to)
      await renameDocs(from, to)
      const map = (p: string) => (under(p, from) ? to + p.slice(from.length) : p)
      setTabs((t) => t.map(map))
      setActive((a) => (a ? map(a) : a))
      await refresh()
    } catch (e) {
      toast(errorText(e))
    }
  }

  const remove = async (path: string) => {
    if (!confirm(`Move "${path}" to the trash?`)) return
    try {
      for (const t of tabsRef.current.filter((t) => under(t, path))) await closeTab(t)
      await api.vault.trash(path)
      await refresh()
    } catch (e) {
      toast(errorText(e))
    }
  }

  const toggleClawd = () => {
    setClawdOn(!clawdOn)
    api.settings.set({ clawd: !clawdOn })
  }

  const inspire = async (a: { passage: string; issue: string }) => {
    setSideOpen(true)
    setSideTab('inspiration')
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
    { label: 'Open graph view', run: () => open(GRAPH) },
    { label: 'Toggle side panel', run: () => setSideOpen((s) => !s) },
    { label: 'Review content (Claude)', run: () => (setSideOpen(true), setSideTab('review'), setReviewTrigger((n) => n + 1)) },
    { label: 'AI check: score this note (Claude + local detector)', run: () => (setSideOpen(true), setSideTab('aicheck'), setAiTrigger((n) => n + 1)) },
    { label: 'Open writing assistant', run: () => (setSideOpen(true), setSideTab('assistant')) },
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
    ...(active ? [{ label: 'Close tab', run: () => closeTab(active) }, { label: 'Rename current file', run: () => rename(active) }] : []),
    ...files.map((f) => ({ label: `Open: ${f}`, run: () => open(f) }))
  ]

  const cycleTab = (step: 1 | -1) => {
    const list = tabsRef.current
    if (list.length < 2 || writeGuard()) return
    setActive((a) => list[(list.indexOf(a ?? '') + step + list.length) % list.length])
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

  const tabLabel = (t: string) => (t === GRAPH ? 'Graph' : t.split('/').pop()!.replace(/\.(md|canvas)$/, ''))
  const tabIcon = (t: string) => (t === GRAPH ? 'graph' : iconFor({ name: t }))
  const isText = (t: string | null) => !!t && /\.(md|txt)$/i.test(t)

  return (
    <div className={`shell ${sideOpen ? '' : 'no-side'}`} style={{ gridTemplateColumns: sideOpen ? `252px minmax(0, 1fr) ${sideWidth}px` : '252px minmax(0, 1fr)' }}>
      <FileTree
        vaultName={vault.replace(/\/+$/, '').split('/').pop() || vault}
        onPickVault={pickVault}
        nodes={tree}
        active={active}
        onOpen={open}
        onNew={newEntry}
        onRename={rename}
        onDelete={remove}
        onGraph={() => open(GRAPH)}
        onNewCanvas={() => newEntry('', false, '.canvas')}
      />
      <main className="center">
        <div className="tabs">
          {tabs.map((t) => (
            <div key={t} className={`tab ${t === active ? 'active' : ''}`} onClick={() => !writeGuard() && setActive(t)} title={t}>
              <Icon name={tabIcon(t)} size={14} />
              <span>{tabLabel(t)}</span>
              <button onClick={(e) => (e.stopPropagation(), closeTab(t))} aria-label={`Close ${tabLabel(t)}`}><Icon name="close" size={12} /></button>
            </div>
          ))}
        </div>
        {isText(active) && <Editor path={active!} />}
        {active && active !== GRAPH && !isText(active) && !active.endsWith('.canvas') && <FileViewer path={active} />}
        {isText(active) && clawdOn && <Clawd path={active!} onInspire={inspire} autoReview={conn.claude?.method !== 'subscription'} />}
        {active?.endsWith('.canvas') && <Canvas path={active} notes={notes} onOpen={open} />}
        {active === GRAPH && <Graph notes={notes} files={files} onOpen={open} />}
        {!active && (
          <div className="empty">
            <p>Open a note from the sidebar, or press ⌘P to jump to any note or command.</p>
            <button onClick={() => newEntry('', false)}><Icon name="plus" size={14} /> New note</button>
          </div>
        )}
      </main>
      {vault && (
        <SidePanel
          hidden={!sideOpen}
          width={sideWidth}
          onResize={setSideWidth}
          selected={sideTab}
          onSelect={selectSideTab}
          tabs={[
            { id: 'backlinks', label: 'Backlinks', render: () => <Backlinks active={active} notes={notes} files={files} onOpen={open} /> },
            { id: 'review', label: 'Review', render: () => <ReviewPanel path={active} trigger={reviewTrigger} /> },
            { id: 'comments', label: 'Comments', render: (visible) => <CommentsPanel path={active} visible={visible} /> },
            { id: 'aicheck', label: 'AI check', render: (visible) => <AiCheckPanel path={active} trigger={aiTrigger} visible={visible} /> },
            { id: 'claude', label: 'Claude Code', render: (visible) => <ClaudeTerminal visible={visible} activePath={active} /> },
            { id: 'assistant', label: 'Assistant', render: () => <AssistantPanel path={active} authMethod={conn.claude?.method} /> },
            { id: 'inspiration', label: 'Inspiration', render: () => <InspirationPanel state={inspo} /> }
          ]}
        />
      )}
      <StatusBar conn={conn} clawdOn={clawdOn} onClawd={toggleClawd} onConnections={() => setShowConnections(true)} onPalette={() => setPalette(true)} />
      {palette && <Palette commands={commands} onClose={() => setPalette(false)} />}
      {showConnections && <Connections state={conn} onChange={setConn} onClose={() => setShowConnections(false)} />}
      <GDocsDialogs />
      <Overlays />
    </div>
  )
}
