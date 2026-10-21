import { useEffect, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { MergeView } from '@codemirror/merge'
import { markdown } from '@codemirror/lang-markdown'
import { api, errorText, type DocMeta, type TabInfo } from './api'
import { toast } from './ui'
import { currentPath, getView, replaceDoc } from './Editor'
import { inReview, isWriting } from './cm/suggest'
import { bodyHash, getKey, setKeys, splitFrontmatter } from '../shared/frontmatter'

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
 * Whole document: Google's modifiedTime against the one recorded at the last sync. One tab: that time also moves
 * when any other tab is edited, so the tab's own content is compared with what it was at the last sync.
 */
async function remoteChanged(md: string, link: Link, remote: Remote) {
  if (link.tab) {
    const h = getKey(md, 'gdoc_remote_hash')
    return !h || h !== (await bodyHash(remote.markdown))
  }
  const synced = getKey(md, 'gdoc_synced_at')
  return !synced || Date.parse(remote.modifiedTime) > Date.parse(synced)
}

async function syncKeys(link: Link, syncedBody: string, remote: Remote) {
  return {
    gdoc_synced_at: remote.modifiedTime,
    gdoc_hash: await bodyHash(syncedBody),
    ...(link.tab ? { gdoc_remote_hash: await bodyHash(remote.markdown) } : {})
  }
}

async function record(path: string, link: Link, syncedBody: string, remote: Remote) {
  replaceDoc(path, setKeys(latest(), await syncKeys(link, syncedBody, remote)))
}

async function doPush(path: string, link: Link) {
  const { body } = noteFor(path)
  const { modifiedTime } = await api.gdocs.push(link.id, body, link.tab)
  // For a tab, remember how Google now holds it, so the next sync can tell whether someone edited it.
  const remote = link.tab ? await api.gdocs.pull(link.id, link.tab) : { markdown: '', modifiedTime }
  await record(path, link, body, remote)
  toast('Pushed to Google Docs.', 'ok')
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
      if (!link.tab && !(await remoteChanged(md, link, { markdown: '', modifiedTime: (await api.gdocs.meta(link.id)).modifiedTime }))) return doPush(path, link)
      const remote = await api.gdocs.pull(link.id, link.tab)
      if (link.tab && !(await remoteChanged(md, link, remote))) return doPush(path, link)
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

  signOut: () => api.gdocs.signOut().then(() => toast('Signed out of Google.', 'ok'))
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
  return (
    <>
      {conflict && <ConflictDialog c={conflict} done={(choice) => (setConflict(null), conflict.resolve(choice))} />}
      {picker && <Picker done={(d) => (setPicker(null), picker.resolve(d))} />}
      {tabPicker && <TabPicker p={tabPicker} done={(t) => (setTabPicker(null), tabPicker.resolve(t))} />}
    </>
  )
}
