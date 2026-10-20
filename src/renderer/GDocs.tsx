import { useEffect, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { MergeView } from '@codemirror/merge'
import { markdown } from '@codemirror/lang-markdown'
import { api, errorText, type DocMeta } from './api'
import { toast } from './ui'
import { currentPath, getView, replaceDoc } from './Editor'
import { inReview, isWriting } from './cm/suggest'
import { bodyHash, getKey, setKeys, splitFrontmatter } from '../shared/frontmatter'

type Choice = 'local' | 'remote' | null
type Conflict = { local: string; remote: string; reason: string; resolve: (c: Choice) => void }
type Pick = { resolve: (d: DocMeta | null) => void }

let showConflict: (c: Conflict) => void = () => {}
let showPicker: (p: Pick) => void = () => {}
let syncing = false

const askConflict = (c: Omit<Conflict, 'resolve'>) => new Promise<Choice>((resolve) => showConflict({ ...c, resolve }))
const pickDoc = () => new Promise<DocMeta | null>((resolve) => showPicker({ resolve }))

function noteFor(path: string) {
  const view = getView()
  if (!view || currentPath() !== path) throw new Error('Open the note in the editor first.')
  if (inReview(view.state) || isWriting()) throw new Error('Finish the open Claude suggestion or rewrite first.')
  const md = view.state.doc.toString()
  return { md, body: splitFrontmatter(md).body, id: getKey(md, 'gdoc_id') || undefined }
}

const latest = () => getView()!.state.doc.toString()
const same = (a: string, b: string) => a.trim() === b.trim()

/** Hash, not file mtime, detects local edits: writing the sync metadata itself would bump the mtime. */
async function localChanged(md: string) {
  const h = getKey(md, 'gdoc_hash')
  return !h || h !== (await bodyHash(splitFrontmatter(md).body))
}

/** The Doc's own modifiedTime (Google's clock) against the one recorded at the last sync. */
function remoteChanged(md: string, modifiedTime: string) {
  const synced = getKey(md, 'gdoc_synced_at')
  return !synced || Date.parse(modifiedTime) > Date.parse(synced)
}

async function record(path: string, syncedBody: string, modifiedTime: string) {
  replaceDoc(path, setKeys(latest(), { gdoc_synced_at: modifiedTime, gdoc_hash: await bodyHash(syncedBody) }))
}

async function doPush(path: string, id: string) {
  const { body } = noteFor(path)
  const { modifiedTime } = await api.gdocs.push(id, body)
  await record(path, body, modifiedTime)
  toast('Pushed to Google Docs.', 'ok')
}

async function doPull(path: string, id: string, remote: { markdown: string; modifiedTime: string }) {
  const { fm } = splitFrontmatter(latest())
  const next = setKeys((fm !== null ? `---\n${fm}\n---\n` : '') + remote.markdown, {
    gdoc_id: id,
    gdoc_synced_at: remote.modifiedTime,
    gdoc_hash: await bodyHash(remote.markdown)
  })
  replaceDoc(path, next)
  toast('Pulled from Google Docs. ⌘Z undoes it.', 'ok')
}

async function resolve(path: string, id: string, remote: { markdown: string; modifiedTime: string }, reason: string) {
  const choice = await askConflict({ local: noteFor(path).body, remote: remote.markdown, reason })
  if (choice === 'local') await doPush(path, id)
  if (choice === 'remote') await doPull(path, id, remote)
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
      const { md, body, id } = noteFor(path)
      if (!id) return toast('Link this note to a Google Doc first.')
      const { modifiedTime } = await api.gdocs.meta(id)
      if (!remoteChanged(md, modifiedTime)) return doPush(path, id)
      const remote = await api.gdocs.pull(id)
      if (same(remote.markdown, body)) return record(path, body, remote.modifiedTime)
      const reason = (await localChanged(md))
        ? 'Both this note and the Google Doc changed since the last sync.'
        : 'The Google Doc changed since the last sync. Pushing would overwrite those changes.'
      await resolve(path, id, remote, reason)
    }),

  pull: (path: string) =>
    run(async () => {
      const { md, body, id } = noteFor(path)
      if (!id) return toast('Link this note to a Google Doc first.')
      const remote = await api.gdocs.pull(id)
      if (!(await localChanged(md))) return doPull(path, id, remote)
      if (same(remote.markdown, body)) return record(path, body, remote.modifiedTime)
      const reason = remoteChanged(md, remote.modifiedTime)
        ? 'Both this note and the Google Doc changed since the last sync.'
        : 'This note changed since the last sync. Pulling would overwrite those changes.'
      await resolve(path, id, remote, reason)
    }),

  linkNew: (path: string) =>
    run(async () => {
      const { md, id: old } = noteFor(path)
      if (old && !confirm('This note is already linked to a Google Doc. Link it to a new one instead?')) return
      const id = await api.gdocs.create(path.split('/').pop()!.replace(/\.md$/, ''))
      replaceDoc(path, setKeys(md, { gdoc_id: id, gdoc_synced_at: '', gdoc_hash: '' }))
      await doPush(path, id)
    }),

  linkExisting: (path: string) =>
    run(async () => {
      const { id: old } = noteFor(path)
      if (old && !confirm('This note is already linked to a Google Doc. Link it to a different one?')) return
      const doc = await pickDoc()
      if (!doc) return
      replaceDoc(path, setKeys(noteFor(path).md, { gdoc_id: doc.id, gdoc_synced_at: '', gdoc_hash: '' }))
      const { body } = noteFor(path)
      const remote = await api.gdocs.pull(doc.id)
      if (!body.trim()) return doPull(path, doc.id, remote)
      if (!remote.markdown.trim()) return doPush(path, doc.id)
      if (same(remote.markdown, body)) return record(path, body, remote.modifiedTime)
      await resolve(path, doc.id, remote, `First sync with “${doc.name}”: choose which version to keep.`)
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

export function GDocsDialogs() {
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [picker, setPicker] = useState<Pick | null>(null)
  showConflict = setConflict
  showPicker = setPicker
  return (
    <>
      {conflict && <ConflictDialog c={conflict} done={(choice) => (setConflict(null), conflict.resolve(choice))} />}
      {picker && <Picker done={(d) => (setPicker(null), picker.resolve(d))} />}
    </>
  )
}
