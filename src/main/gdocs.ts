import { app, safeStorage, shell } from 'electron'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CodeChallengeMethod, OAuth2Client, type Credentials } from 'google-auth-library'
import { docs } from '@googleapis/docs'
import { drive } from '@googleapis/drive'
import { mdToDocs } from './mdToDocs'
import { checkSecret, loadSecrets, saveSecrets } from './secrets'

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
  const s = loadSecrets()
  return {
    clientId: s.googleClientId ?? checkSecret('GOOGLE_CLIENT_ID', process.env.GOOGLE_CLIENT_ID),
    clientSecret: s.googleClientSecret ?? checkSecret('GOOGLE_CLIENT_SECRET', process.env.GOOGLE_CLIENT_SECRET)
  }
}

/** The refresh token is encrypted with the OS keychain (Electron safeStorage); never stored in plain text. */
function saveTokens(tokens: Credentials) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS keychain encryption is unavailable, so the Google token was not stored.')
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

/** Doc → markdown via Drive's native Markdown export. */
export const pull = guarded(async (id: string): Promise<{ markdown: string; modifiedTime: string }> => {
  const { driveApi } = await apis()
  // Read the time first: an edit landing mid-export then shows up as newer on the next sync instead of being missed.
  const { modifiedTime } = await meta(id)
  const res = await driveApi.files.export({ fileId: id, mimeType: 'text/markdown' }, { responseType: 'text' })
  return { markdown: String(res.data), modifiedTime }
})

/** Markdown → Doc: one atomic batchUpdate that clears the body and rebuilds it, so a failure leaves the Doc as it was. */
export const push = guarded(async (id: string, markdown: string): Promise<{ modifiedTime: string }> => {
  const { docsApi } = await apis()
  const { data } = await docsApi.documents.get({ documentId: id, fields: 'body(content(endIndex))' })
  const endIndex = data.body?.content?.at(-1)?.endIndex ?? 1
  const requests = [...(endIndex > 2 ? [{ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } }] : []), ...mdToDocs(markdown)]
  if (requests.length) await docsApi.documents.batchUpdate({ documentId: id, requestBody: { requests } })
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
  saveSecrets({ googleClientId: checkSecret('Client ID', clientId) ?? null, googleClientSecret: checkSecret('Client secret', clientSecret) ?? null })
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
