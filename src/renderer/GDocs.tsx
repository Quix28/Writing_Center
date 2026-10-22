import { useEffect, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { MergeView } from '@codemirror/merge'
import { markdown } from '@codemirror/lang-markdown'
import { api, errorText, type DocMeta, type TabInfo } from './api'
import { toast } from './ui'
import { currentPath, getView, replaceDoc, typingListeners } from './Editor'
import { inReview, isWriting } from './cm/suggest'
import { bodyHash, getKey, setKeys, splitFrontmatter } from '../shared/frontmatter'
import { mergeRemote, sameContent } from '../shared/mdParas'

type Choice = 'local' | 'remote' | null
type Conflict = { local: string; remote: string; reason: string; resolve: (c: Choice) => void }
type Pick = { resolve: (d: DocMeta | null) => void }
type TabPick = { docName: string; tabs: TabInfo[]; resolve: (t: TabInfo | undefined) => void }

let showConflict: (c: Conflict) => void = () => {}
let showPicker: (p: Pick) => void = () => {}
let showTabPicker: (p: TabPick) => void = () => {}
let syncing = false

const askConflict = (c: Omit<Conflict, 'resolve'>) => new Promise<Choice>((resolve) => showConflict({ ...c, resolve }))
const pickDoc = () => new Promise<DocMeta | null>((resolve) => showPicker({ resolve }))
const pickTab = (docName: string, tabs: TabInfo[]) => new Promise<TabInfo | undefined>((resolve) => showTabPicker({ docName, tabs, resolve }))

/** A note links to a whole Google Doc, or to one of its document tabs. */
type Link = { id: string; tab?: string }
type Remote = { markdown: string; modifiedTime: string }

function noteFor(path: string) {
  const view = getView()
  if (!view || currentPath() !== path) throw new Error('Open the note in the editor first.')
  if (inReview(view.state) || isWriting()) throw new Error('Finish the open Claude suggestion or rewrite first.')
  const md = view.state.doc.toString()
  const id = getKey(md, 'gdoc_id')
  const link: Link | undefined = id ? { id, tab: getKey(md, 'gdoc_tab') || undefined } : undefined
  return { md, body: splitFrontmatter(md).body, link }
}

const latest = () => getView()!.state.doc.toString()
const same = (a: string, b: string) => a.trim() === b.trim()

/** Hash, not file mtime, detects local edits: writing the sync metadata itself would bump the mtime. */
async function localChanged(md: string) {
  const h = getKey(md, 'gdoc_hash')
  return !h || h !== (await bodyHash(splitFrontmatter(md).body))
}

/**
 * The Doc's (or tab's) content against how it read at the last sync; Google's modifiedTime can't tell, as it also
 * moves when another tab is edited. Notes synced before the content hash existed fall back to that time.
 */
async function remoteChanged(md: string, link: Link, remote: Remote) {
  const h = getKey(md, 'gdoc_remote_hash')
  if (h) return h !== (await bodyHash(remote.markdown))
  const synced = getKey(md, 'gdoc_synced_at')
  return !!link.tab || !synced || Date.parse(remote.modifiedTime) > Date.parse(synced)
}

/** `stale`: the Doc had more in it than this sync accounts for, so the next sync must treat it as changed. */
async function syncKeys(_link: Link, syncedBody: string, remote: Remote, stale = false) {
  return {
    gdoc_synced_at: remote.modifiedTime,
    gdoc_hash: await bodyHash(syncedBody),
    gdoc_remote_hash: stale ? 'stale' : await bodyHash(remote.markdown)
  }
}

async function record(path: string, link: Link, syncedBody: string, remote: Remote, stale = false) {
  replaceDoc(path, setKeys(latest(), await syncKeys(link, syncedBody, remote, stale)))
}

async function doPush(path: string, link: Link, quiet = false) {
  const { body } = noteFor(path)
  await api.gdocs.push(link.id, body, link.tab)
  // Remember how Google now holds it, so the next sync can tell whether someone edited it. If someone typed in the
  // Doc right after the push, that text isn't in the note: mark it stale so it is pulled in, never pushed over.
  const remote = await api.gdocs.pull(link.id, link.tab)
  await record(path, link, body, remote, !sameContent(remote.markdown, body))
  if (!quiet) toast('Pushed to Google Docs.', 'ok')
}

async function doPull(path: string, link: Link, remote: Remote) {
  const { fm } = splitFrontmatter(latest())
  const next = setKeys((fm !== null ? `---\n${fm}\n---\n` : '') + remote.markdown, { gdoc_id: link.id, ...(await syncKeys(link, remote.markdown, remote)) })
  replaceDoc(path, next)
  toast('Pulled from Google Docs. ⌘Z undoes it.', 'ok')
}

async function resolve(path: string, link: Link, remote: Remote, reason: string) {
  const choice = await askConflict({ local: noteFor(path).body, remote: remote.markdown, reason })
  if (choice === 'local') await doPush(path, link)
  if (choice === 'remote') await doPull(path, link, remote)
  return choice
}

async function run(fn: () => Promise<void>) {
  if (syncing) return toast('A Google Docs sync is already running.')
  syncing = true
  try {
    await fn()
  } catch (e) {
    toast(errorText(e))
  } finally {
    syncing = false
  }
}

export const gdocs = {
  push: (path: string) =>
    run(async () => {
      const { md, body, link } = noteFor(path)
      if (!link) return toast('Link this note to a Google Doc first.')
      const remote = await api.gdocs.pull(link.id, link.tab)
      if (!(await remoteChanged(md, link, remote))) return doPush(path, link)
      if (same(remote.markdown, body)) return record(path, link, body, remote)
      const reason = (await localChanged(md))
        ? 'Both this note and the Google Doc changed since the last sync.'
        : 'The Google Doc changed since the last sync. Pushing would overwrite those changes.'
      await resolve(path, link, remote, reason)
    }),

  pull: (path: string) =>
    run(async () => {
      const { md, body, link } = noteFor(path)
      if (!link) return toast('Link this note to a Google Doc first.')
      const remote = await api.gdocs.pull(link.id, link.tab)
      if (!(await localChanged(md))) return doPull(path, link, remote)
      if (same(remote.markdown, body)) return record(path, link, body, remote)
      const reason = (await remoteChanged(md, link, remote))
        ? 'Both this note and the Google Doc changed since the last sync.'
        : 'This note changed since the last sync. Pulling would overwrite those changes.'
      await resolve(path, link, remote, reason)
    }),

  linkNew: (path: string) =>
    run(async () => {
      const { md, link: old } = noteFor(path)
      if (old && !confirm('This note is already linked to a Google Doc. Link it to a new one instead?')) return
      const id = await api.gdocs.create(path.split('/').pop()!.replace(/\.md$/, ''))
      replaceDoc(path, setKeys(md, { gdoc_id: id, gdoc_tab: '', gdoc_tab_title: '', gdoc_synced_at: '', gdoc_hash: '', gdoc_remote_hash: '' }))
      await doPush(path, { id })
    }),

  /** Picks a Google Doc and, when it has several document tabs, the one tab this note should mirror. */
  linkExisting: (path: string) =>
    run(async () => {
      const { link: old } = noteFor(path)
      if (old && !confirm('This note is already linked to a Google Doc. Link it to a different one?')) return
      const doc = await pickDoc()
      if (!doc) return
      const tabs = await api.gdocs.tabs(doc.id)
      const tab = tabs.length > 1 ? await pickTab(doc.name, tabs) : undefined
      if (tabs.length > 1 && !tab) return
      const link: Link = { id: doc.id, tab: tab?.id }
      replaceDoc(path, setKeys(noteFor(path).md, { gdoc_id: doc.id, gdoc_tab: tab?.id ?? '', gdoc_tab_title: tab?.title ?? '', gdoc_synced_at: '', gdoc_hash: '', gdoc_remote_hash: '' }))
      const { body } = noteFor(path)
      const remote = await api.gdocs.pull(link.id, link.tab)
      if (!body.trim()) return doPull(path, link, remote)
      if (!remote.markdown.trim()) return doPush(path, link)
      if (same(remote.markdown, body)) return record(path, link, body, remote)
      await resolve(path, link, remote, `First sync with “${doc.name}${tab ? ` › ${tab.title}` : ''}”: choose which version to keep.`)
    }),

  signOut: () => api.gdocs.signOut().then(() => toast('Signed out of Google.', 'ok')),

  toggleLive: () => {
    setLive(!live.on)
    toast(live.on ? 'Live sync on: linked notes and their Google Docs follow each other every few seconds.' : 'Live sync off.', 'ok')
  }
}

const LIVE_KEY = 'wc.gdocsLive'
const POLL_MS = 2000
/** Local edits go out once typing pauses this long, so the Doc isn't rewritten mid-word. */
const IDLE_MS = 1500
const readLive = () => {
  try {
    return localStorage.getItem(LIVE_KEY) === '1'
  } catch {
    return false
  }
}
export const live = { on: readLive(), listeners: new Set<(on: boolean) => void>() }
function setLive(on: boolean) {
  live.on = on
  try {
    localStorage.setItem(LIVE_KEY, on ? '1' : '')
  } catch {
    /* the setting just won't be remembered */
  }
  live.listeners.forEach((f) => f(on))
}
let lastTyped = 0
typingListeners.add(() => (lastTyped = Date.now()))
const seenRevision = new Map<string, string>()
let lastLiveError = ''

/**
 * One live-sync step for the open note: the Doc's revision ID is polled; when it moved, the Doc is read and its edits
 * are merged into an unchanged note; local edits are pushed once typing pauses. If both sides changed, the
 * side-by-side dialog decides, exactly like a manual sync. Nothing is ever overwritten silently.
 */
async function liveTick() {
  const path = currentPath()
  if (!live.on || syncing || !path?.endsWith('.md')) return
  let note: ReturnType<typeof noteFor>
  try {
    note = noteFor(path)
  } catch {
    return
  }
  const { md, body, link } = note
  if (!link) return
  const local = await localChanged(md)
  if (local && Date.now() - lastTyped < IDLE_MS) return
  syncing = true
  try {
    const revision = await api.gdocs.revision(link.id)
    if (!local && revision === seenRevision.get(path)) return
    const remote = await api.gdocs.pull(link.id, link.tab)
    // Typed while the Doc was being read: start over on the next tick with the new text.
    if (currentPath() !== path || latest() !== md) return
    const theirs = await remoteChanged(md, link, remote)
    if (!theirs && !local) seenRevision.set(path, revision)
    else if (!theirs) await doPush(path, link, true)
    else if (!local || sameContent(body, remote.markdown)) {
      const merged = local ? body : mergeRemote(body, remote.markdown)
      replaceDoc(path, setKeys(md.slice(0, md.length - body.length) + merged, await syncKeys(link, merged, remote)))
      seenRevision.set(path, revision)
    } else if (!(await resolve(path, link, remote, 'Live sync: this note and the Google Doc were both edited at the same time.'))) {
      setLive(false)
      toast('Live sync is paused. Turn it back on from ⌘P when you are ready.')
    }
    lastLiveError = ''
  } catch (e) {
    const message = errorText(e)
    if (message !== lastLiveError) toast(`Live sync: ${message}`)
    lastLiveError = message
  } finally {
    syncing = false
  }
}

export function LiveBadge({ onClick }: { onClick: () => void }) {
  const [on, setOn] = useState(live.on)
  useEffect(() => {
    live.listeners.add(setOn)
    return () => void live.listeners.delete(setOn)
  }, [])
  return on ? (
    <button className="status-item" onClick={onClick} title="Google Docs live sync is on. Click to turn it off.">
      <span className="dot ok" /> Live sync
    </button>
  ) : null
}

function ConflictDialog({ c, done }: { c: Conflict; done: (choice: Choice) => void }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const ro = [EditorState.readOnly.of(true), EditorView.editable.of(false), EditorView.lineWrapping, markdown()]
    const mv = new MergeView({ a: { doc: c.local, extensions: ro }, b: { doc: c.remote, extensions: ro }, parent: host.current!, gutter: true })
    return () => mv.destroy()
  }, [c])
  return (
    <div className="modal-backdrop">
      <div className="modal conflict" role="dialog" aria-label="Google Docs sync conflict">
        <strong>{c.reason}</strong>
        <p className="muted small">Nothing has been overwritten. Pick the version to keep; the other side will be replaced with it.</p>
        <div className="conflict-labels"><span>This note</span><span>Google Doc</span></div>
        <div className="conflict-diff" ref={host} />
        <div className="conflict-actions">
          <button onClick={() => done(null)}>Cancel</button>
          <button onClick={() => done('remote')}>Keep Google Doc (replace note)</button>
          <button onClick={() => done('local')}>Keep this note (replace Doc)</button>
        </div>
      </div>
    </div>
  )
}

function Picker({ done }: { done: (d: DocMeta | null) => void }) {
  const [query, setQuery] = useState('')
  const [docs, setDocs] = useState<DocMeta[] | null>(null)
  useEffect(() => {
    const t = setTimeout(() => api.gdocs.list(query).then(setDocs, (e) => (toast(errorText(e)), done(null))), 300)
    return () => clearTimeout(t)
  }, [query])
  return (
    <div className="modal-backdrop" onMouseDown={() => done(null)}>
      <div className="modal palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          placeholder="Search your Google Docs…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') done(null)
            if (e.key === 'Enter' && docs?.[0]) done(docs[0])
          }}
        />
        {!docs && <p className="muted">Loading… (a browser window may open to sign in)</p>}
        <ul>
          {docs?.map((d) => (
            <li key={d.id} onClick={() => done(d)}>
              {d.name} <span className="muted small">{new Date(d.modifiedTime).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function TabPicker({ p, done }: { p: TabPick; done: (t: TabInfo | undefined) => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={() => done(undefined)}>
      <div className="modal palette" role="dialog" aria-label="Choose a tab" onMouseDown={(e) => e.stopPropagation()}>
        <strong>“{p.docName}” has tabs. Which one should this note mirror?</strong>
        <p className="muted small">Push and pull will only touch that tab; the other tabs stay as they are.</p>
        <ul className="tab-list">
          {p.tabs.map((t) => (
            <li key={t.id} style={{ paddingLeft: 10 + t.depth * 18 }} onClick={() => done(t)}>
              {t.title}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function GDocsDialogs() {
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [picker, setPicker] = useState<Pick | null>(null)
  const [tabPicker, setTabPicker] = useState<TabPick | null>(null)
  showConflict = setConflict
  showPicker = setPicker
  showTabPicker = setTabPicker
  useEffect(() => {
    const timer = setInterval(liveTick, POLL_MS)
    return () => clearInterval(timer)
  }, [])
  return (
    <>
      {conflict && <ConflictDialog c={conflict} done={(choice) => (setConflict(null), conflict.resolve(choice))} />}
      {picker && <Picker done={(d) => (setPicker(null), picker.resolve(d))} />}
      {tabPicker && <TabPicker p={tabPicker} done={(t) => (setTabPicker(null), tabPicker.resolve(t))} />}
    </>
  )
}
