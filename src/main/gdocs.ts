import { app, safeStorage, shell } from 'electron'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CodeChallengeMethod, OAuth2Client, type Credentials } from 'google-auth-library'
import { docs } from '@googleapis/docs'
import { drive } from '@googleapis/drive'
import { patchDoc } from './mdToDocs'
import { findTab, flattenTabs, tabToMarkdown, type TabInfo } from './docsToMd'
import { checkSecret, KEYCHAIN_DENIED, loadSecrets } from './secrets'
import { loadSettings, saveSettings } from './settings'

const SCOPES = ['https://www.googleapis.com/auth/documents', 'https://www.googleapis.com/auth/drive.readonly']
const SIGN_IN_TIMEOUT_MS = 5 * 60_000
/** Test hooks: point the APIs at a local mock and skip OAuth. Unset in normal use. */
const rootUrl = process.env.WC_GOOGLE_API_ROOT
const testToken = process.env.WC_GOOGLE_TEST_TOKEN

const tokenFile = () => join(app.getPath('userData'), 'google-token.bin')
let clientPromise: Promise<OAuth2Client> | null = null

function newClient(redirectUri?: string) {
  const { clientId, clientSecret } = clientConfig()
  if (!clientId) throw new Error('Google is not set up yet. Open Connections and add your OAuth client ID.')
  return new OAuth2Client({ clientId, clientSecret, redirectUri })
}

function clientConfig() {
  const s = { ...loadSecrets(), ...loadSettings() }
  return {
    clientId: s.googleClientId ?? checkSecret('GOOGLE_CLIENT_ID', process.env.GOOGLE_CLIENT_ID),
    clientSecret: s.googleClientSecret ?? checkSecret('GOOGLE_CLIENT_SECRET', process.env.GOOGLE_CLIENT_SECRET)
  }
}

/** The refresh token is encrypted with the OS keychain (Electron safeStorage); never stored in plain text. */
function saveTokens(tokens: Credentials) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error(KEYCHAIN_DENIED)
  writeFileSync(tokenFile(), safeStorage.encryptString(JSON.stringify(tokens)), { mode: 0o600 })
}

function loadTokens(): Credentials | null {
  try {
    return JSON.parse(safeStorage.decryptString(readFileSync(tokenFile())))
  } catch {
    return null
  }
}

function persistRefreshes(c: OAuth2Client) {
  c.on('tokens', (t) => {
    try {
      saveTokens({ ...c.credentials, ...t })
    } catch {
      /* keep working with the in-memory token */
    }
  })
  return c
}

/** Loopback OAuth with PKCE: the browser redirects to a one-shot server on 127.0.0.1. */
async function signIn(): Promise<OAuth2Client> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const redirectUri = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  try {
    const c = newClient(redirectUri)
    const { codeVerifier, codeChallenge } = await c.generateCodeVerifierAsync()
    const state = randomUUID()
    const url = c.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES, state, code_challenge: codeChallenge, code_challenge_method: CodeChallengeMethod.S256 })
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Google sign-in timed out.')), SIGN_IN_TIMEOUT_MS)
      server.on('request', (req, res) => {
        const u = new URL(req.url ?? '/', redirectUri)
        if (u.pathname !== '/') return void res.writeHead(404).end()
        const ok = u.searchParams.get('state') === state && u.searchParams.get('code')
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(ok ? '<p>Writing Centre is connected to Google. You can close this tab.</p>' : '<p>Sign-in failed. You can close this tab.</p>')
        clearTimeout(timer)
        if (ok) resolve(ok)
        else reject(new Error(`Google sign-in failed: ${u.searchParams.get('error') ?? 'invalid response'}`))
      })
      shell.openExternal(url)
    })
    const { tokens } = await c.getToken({ code, codeVerifier, redirect_uri: redirectUri })
    c.setCredentials(tokens)
    saveTokens(tokens)
    return persistRefreshes(c)
  } finally {
    server.close()
  }
}

async function auth(): Promise<OAuth2Client> {
  if (testToken) {
    const c = new OAuth2Client()
    c.setCredentials({ access_token: testToken, expiry_date: Date.now() + 3600_000 })
    return c
  }
  const saved = loadTokens()
  if (saved?.refresh_token) {
    const c = newClient()
    c.setCredentials(saved)
    return persistRefreshes(c)
  }
  return signIn()
}

function getClient() {
  clientPromise ??= auth().catch((e) => {
    clientPromise = null
    throw e
  })
  return clientPromise
}

function friendly(e: unknown): Error {
  const err = e as { message?: string; code?: string | number; status?: number; response?: { status?: number; data?: { error?: string | { message?: string } } } }
  const status = err.response?.status ?? err.status
  const detail = typeof err.response?.data?.error === 'object' ? err.response.data.error.message : err.response?.data?.error
  if (detail === 'invalid_grant' || /invalid_grant/.test(err.message ?? '')) {
    signOut()
    return new Error('Google access expired or was revoked. Run the command again to sign in.')
  }
  if (status === 400 && /revision/i.test(detail ?? '')) return new Error('The Google Doc changed while pushing, so nothing was changed. Push again.')
  if (status === 404) return new Error('That Google Doc no longer exists or you lost access to it.')
  if (status === 401 || status === 403) return new Error(`Google refused access (${status}): ${detail ?? err.message}`)
  if (status) return new Error(`Google API error ${status}: ${detail ?? err.message}`)
  if (/ENOTFOUND|ECONN|ETIMEDOUT|socket|network/i.test(`${err.code} ${err.message}`)) return new Error('Network error: could not reach Google.')
  return e instanceof Error ? e : new Error(String(e))
}

async function apis() {
  const auth = await getClient()
  return { docsApi: docs({ version: 'v1', auth, rootUrl }), driveApi: drive({ version: 'v3', auth, rootUrl }) }
}

const guarded =
  <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
  async (...a: A): Promise<R> => {
    try {
      return await fn(...a)
    } catch (e) {
      throw friendly(e)
    }
  }

export type DocMeta = { id: string; name: string; modifiedTime: string }

export const meta = guarded(async (id: string): Promise<DocMeta> => {
  const { driveApi } = await apis()
  const { data } = await driveApi.files.get({ fileId: id, fields: 'id,name,modifiedTime', supportsAllDrives: true })
  return { id: data.id!, name: data.name!, modifiedTime: data.modifiedTime! }
})

/** The Doc's current revision ID: it changes with every edit, so live sync polls it instead of the content. */
export const revision = guarded(async (id: string): Promise<string> => {
  const { docsApi } = await apis()
  const { data } = await docsApi.documents.get({ documentId: id, fields: 'revisionId' })
  return data.revisionId ?? ''
})

export const list = guarded(async (query: string): Promise<DocMeta[]> => {
  const { driveApi } = await apis()
  const name = query.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const { data } = await driveApi.files.list({
    q: `mimeType='application/vnd.google-apps.document' and trashed=false${name ? ` and name contains '${name}'` : ''}`,
    orderBy: 'modifiedTime desc',
    pageSize: 25,
    fields: 'files(id,name,modifiedTime)'
  })
  return (data.files ?? []).map((f) => ({ id: f.id!, name: f.name!, modifiedTime: f.modifiedTime! }))
})

export const create = guarded(async (title: string): Promise<string> => {
  const { docsApi } = await apis()
  const { data } = await docsApi.documents.create({ requestBody: { title } })
  return data.documentId!
})

export type { TabInfo }
export type { DocComment } from '../shared/comments'

/** The Doc's comments with replies (read-only), via the Drive API; needs no scope beyond drive.readonly. */
export const comments = guarded(async (id: string): Promise<import('../shared/comments').DocComment[]> => {
  const { driveApi } = await apis()
  const out: import('../shared/comments').DocComment[] = []
  let pageToken: string | undefined
  do {
    const { data } = await driveApi.comments.list({
      fileId: id,
      pageSize: 100,
      pageToken,
      fields: 'nextPageToken,comments(id,content,createdTime,resolved,deleted,author(displayName),quotedFileContent(value),replies(content,createdTime,deleted,author(displayName)))'
    })
    for (const c of data.comments ?? [])
      if (!c.deleted)
        out.push({
          id: c.id ?? '',
          author: c.author?.displayName ?? 'Someone',
          content: c.content ?? '',
          created: c.createdTime ?? '',
          resolved: !!c.resolved,
          quote: c.quotedFileContent?.value ?? '',
          replies: (c.replies ?? []).filter((r) => !r.deleted && r.content).map((r) => ({ author: r.author?.displayName ?? 'Someone', content: r.content ?? '', created: r.createdTime ?? '' }))
        })
    pageToken = data.nextPageToken ?? undefined
  } while (pageToken)
  return out
})

/** The document's tabs (Google Docs "document tabs"), in reading order. */
export const tabs = guarded(async (id: string): Promise<TabInfo[]> => {
  const { docsApi } = await apis()
  const props = 'tabProperties(tabId,title,index)'
  const { data } = await docsApi.documents.get({ documentId: id, includeTabsContent: true, fields: `tabs(${props},childTabs(${props},childTabs(${props},childTabs(${props}))))` })
  return flattenTabs(data.tabs ?? [])
})

/** Without a tab, Google reads and writes only the first tab, so a whole-document link would mix tabs up. */
async function refuseIfTabbed(id: string) {
  if ((await tabs(id)).length > 1)
    throw new Error('This Google Doc has several tabs. Link the note to one tab: ⌘P → "Google Docs: Link to an existing doc…", then pick the tab.')
}

/** One tab's content; without a tab ID, the first tab (the whole document, for a Doc without tabs). */
async function getTab(id: string, tabId?: string) {
  const { docsApi } = await apis()
  const { data } = await docsApi.documents.get({ documentId: id, includeTabsContent: true })
  const tab = tabId ? findTab(data.tabs ?? [], tabId) : data.tabs?.[0]
  if (!tab?.documentTab) throw new Error('That tab no longer exists in the Google Doc. Link the note again to pick another tab.')
  return tab.documentTab
}

/**
 * Doc → markdown, converted from the tab's content (the same converter push compares against, so a Doc that matches
 * the note reads back as matching).
 */
export const pull = guarded(async (id: string, tabId?: string): Promise<{ markdown: string; modifiedTime: string }> => {
  if (!tabId) await refuseIfTabbed(id)
  const { modifiedTime } = await meta(id)
  return { markdown: tabToMarkdown(await getTab(id, tabId)), modifiedTime }
})

/**
 * Markdown → Doc: one atomic batchUpdate that changes only the paragraphs that differ, so the Doc keeps its own
 * formatting. It only applies to the revision it was computed from; an edit landing in between fails it untouched.
 */
export const push = guarded(async (id: string, markdown: string, tabId?: string): Promise<{ modifiedTime: string }> => {
  const { docsApi } = await apis()
  if (!tabId) await refuseIfTabbed(id)
  const { data } = await docsApi.documents.get({ documentId: id, includeTabsContent: true })
  const tab = tabId ? findTab(data.tabs ?? [], tabId) : data.tabs?.[0]
  if (!tab?.documentTab) throw new Error('That tab no longer exists in the Google Doc. Link the note again to pick another tab.')
  const requests = patchDoc(tab.documentTab, markdown, tabId)
  if (requests.length)
    await docsApi.documents.batchUpdate({ documentId: id, requestBody: { requests, ...(data.revisionId ? { writeControl: { requiredRevisionId: data.revisionId } } : {}) } })
  return { modifiedTime: (await meta(id)).modifiedTime }
})

export type GoogleStatus = { configured: boolean; connected: boolean; detail: string }

export async function status(): Promise<GoogleStatus> {
  const configured = !!clientConfig().clientId || !!testToken
  if (!configured) return { configured, connected: false, detail: 'Add your OAuth client ID to connect.' }
  if (!testToken && !loadTokens()?.refresh_token) return { configured, connected: false, detail: 'Not signed in.' }
  try {
    const { driveApi } = await apis()
    const { data } = await driveApi.about.get({ fields: 'user(displayName,emailAddress)' })
    return { configured, connected: true, detail: `Signed in as ${data.user?.emailAddress ?? data.user?.displayName ?? 'your Google account'}` }
  } catch (e) {
    return { configured, connected: false, detail: friendly(e).message }
  }
}

export function saveClient(clientId: string, clientSecret: string): Promise<GoogleStatus> {
  saveSettings({ googleClientId: checkSecret('Client ID', clientId), googleClientSecret: checkSecret('Client secret', clientSecret) })
  signOut()
  return status()
}

/** Opens Google's consent page in the browser (loopback redirect), then reports who is signed in. */
export async function connect(): Promise<GoogleStatus> {
  signOut()
  clientPromise = signIn().catch((e) => {
    clientPromise = null
    throw friendly(e)
  })
  await clientPromise
  return status()
}

export function signOut() {
  clientPromise = null
  rmSync(tokenFile(), { force: true })
}
