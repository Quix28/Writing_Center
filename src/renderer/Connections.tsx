import { useEffect, useState } from 'react'
import { api, errorText, type ClaudeStatus, type GoogleStatus } from './api'
import { Icon } from './icons'

export type ConnectionState = { claude?: ClaudeStatus; google?: GoogleStatus }

const CLAUDE_LABEL: Record<ClaudeStatus['method'], string> = {
  subscription: 'your Claude subscription',
  browser: 'browser sign-in',
  key: 'your API key',
  env: 'the ANTHROPIC_API_KEY variable',
  none: ''
}

function Pill({ ok, text }: { ok?: boolean; text: string }) {
  return (
    <span className={`pill ${ok === undefined ? 'pending' : ok ? 'ok' : 'off'}`}>
      <span className="dot" />
      {text}
    </span>
  )
}

const ext = (href: string, text: string) => (
  <a href={href} target="_blank" rel="noreferrer">{text}</a>
)

export function Connections({ state, onChange, onClose }: { state: ConnectionState; onChange: (s: ConnectionState) => void; onClose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<{ where: 'claude' | 'google'; text: string } | null>(null)
  const [key, setKey] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const { claude, google } = state

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const act = async <T,>(label: string, where: 'claude' | 'google', fn: () => Promise<T>, apply: (r: T) => ConnectionState) => {
    setBusy(label)
    setError(null)
    try {
      onChange(apply(await fn()))
    } catch (e) {
      setError({ where, text: errorText(e) })
    } finally {
      setBusy(null)
    }
  }
  const claudeAct = (label: string, fn: () => Promise<ClaudeStatus>) => act(label, 'claude', fn, (c) => ({ ...state, claude: c }))
  const googleAct = (label: string, fn: () => Promise<GoogleStatus>) => act(label, 'google', fn, (g) => ({ ...state, google: g }))

  const claudeText = !claude ? 'Checking…' : claude.ok ? `Connected with ${CLAUDE_LABEL[claude.method]}` : claude.method === 'none' ? 'Not connected' : 'Connection failed'
  const googleText = !google ? 'Checking…' : google.connected ? 'Connected' : google.configured ? 'Not signed in' : 'Not set up'

  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <div className="sheet" role="dialog" aria-label="Connections" onMouseDown={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>Connections</h2>
          <button className="icon-button" onClick={onClose} disabled={!!busy} aria-label="Close"><Icon name="close" /></button>
        </header>

        <section className="service">
          <div className="service-head">
            <h3>Claude</h3>
            <Pill ok={claude && claude.ok} text={claudeText} />
          </div>
          <p className="muted">Powers Review, the writing assistant, Clawd and Find inspiration.</p>
          {claude && claude.method !== 'none' && <p className={claude.ok ? 'muted small' : 'error-text'}>{claude.detail}.</p>}

          <div className={`option ${claude?.method === 'subscription' ? 'chosen' : ''}`}>
            <h4>Use my Claude subscription</h4>
            <p className="muted small">
              Runs through Claude Code on this Mac and counts against your plan's usage limits, with no extra charges. Clawd only reviews when you click him, to save your limits. If
              Claude Code isn't signed in yet, your browser opens claude.ai.
            </p>
            <div className="actions">
              <button className="primary" disabled={!!busy} onClick={() => claudeAct('claude-sub', api.claude.useSubscription)}>
                {busy === 'claude-sub' ? 'Waiting for Claude Code…' : claude?.method === 'subscription' ? 'Check again' : 'Use my Claude subscription'}
              </button>
            </div>
          </div>

          <details className={`option alt ${claude?.method === 'browser' || claude?.method === 'key' ? 'chosen' : ''}`} open={claude?.method === 'browser' || claude?.method === 'key'}>
            <summary>Pay as you go with the Claude API instead</summary>
            <p className="muted small">Billed to your Claude Console account, separately from any subscription.</p>
            <div className="actions">
              <button disabled={!!busy} onClick={() => claudeAct('claude-login', api.claude.login)}>
                {busy === 'claude-login' ? 'Waiting for you to approve in the browser…' : 'Sign in with browser'}
              </button>
            </div>
            <form
              className="field-row"
              onSubmit={(e) => {
                e.preventDefault()
                claudeAct('claude-key', () => api.claude.setKey(key)).then(() => setKey(''))
              }}
            >
              <input type="password" placeholder="or paste an API key (sk-ant-…)" value={key} onChange={(e) => setKey(e.target.value)} aria-label="Claude API key" autoComplete="off" spellCheck={false} />
              <button type="submit" disabled={!!busy || !key.trim()}>{busy === 'claude-key' ? 'Checking…' : 'Save key'}</button>
            </form>
            <p className="muted small">Create a key in the {ext('https://platform.claude.com/settings/keys', 'Claude Console')}. It is stored encrypted in your macOS Keychain.</p>
          </details>

          {claude && claude.method !== 'none' && (
            <div className="actions">
              <button disabled={!!busy} onClick={() => claudeAct('claude-test', api.claude.status)}>{busy === 'claude-test' ? 'Testing…' : 'Test connection'}</button>
              <button className="quiet" disabled={!!busy} onClick={() => claudeAct('claude-off', api.claude.disconnect)}>Disconnect</button>
            </div>
          )}
          {error?.where === 'claude' && <p className="error-text" role="alert">{error.text}</p>}
        </section>

        <section className="service">
          <div className="service-head">
            <h3>Google Docs</h3>
            <Pill ok={google && google.connected} text={googleText} />
          </div>
          <p className="muted">Lets you link notes to Google Docs and push or pull changes.</p>
          {google?.connected && <p className="muted small">{google.detail}.</p>}
          {google && google.configured && !google.connected && google.detail !== 'Not signed in.' && <p className="error-text">{google.detail}</p>}

          {google?.configured && (
            <div className="actions">
              <button className="primary" disabled={!!busy} onClick={() => googleAct('google-login', api.gdocs.connect)}>
                {busy === 'google-login' ? 'Waiting for you to approve in the browser…' : google.connected ? 'Sign in again' : 'Sign in with Google'}
              </button>
              {google.connected && (
                <button className="quiet" disabled={!!busy} onClick={() => googleAct('google-off', () => api.gdocs.signOut().then(api.gdocs.status))}>Disconnect</button>
              )}
            </div>
          )}

          <details className="alt" open={!!google && !google.configured}>
            <summary>{google?.configured ? 'Change OAuth client' : 'Set up Google access (one time, about 5 minutes)'}</summary>
            <p className="muted small">Google only lets an app sign you in through an OAuth client that belongs to a Google Cloud project, so you create one for yourself:</p>
            <ol className="steps">
              <li>In {ext('https://console.cloud.google.com/projectcreate', 'Google Cloud')}, create a project (or pick one), then enable the {ext('https://console.cloud.google.com/apis/library/docs.googleapis.com', 'Google Docs API')} and the {ext('https://console.cloud.google.com/apis/library/drive.googleapis.com', 'Google Drive API')}.</li>
              <li>Open {ext('https://console.cloud.google.com/auth/overview', 'Google Auth Platform')} and click Get started: app name Writing Centre, your email, audience External.</li>
              <li>Under {ext('https://console.cloud.google.com/auth/audience', 'Audience')}, add your own Google account as a test user.</li>
              <li>Under {ext('https://console.cloud.google.com/auth/clients', 'Clients')}, create a client of type Desktop app, then paste its ID and secret here. Google may only show the secret once.</li>
            </ol>
            <form
              className="field-stack"
              onSubmit={(e) => {
                e.preventDefault()
                googleAct('google-client', () => api.gdocs.saveClient(clientId, clientSecret)).then(() => (setClientId(''), setClientSecret('')))
              }}
            >
              <input placeholder="Client ID (…apps.googleusercontent.com)" value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Google OAuth client ID" spellCheck={false} />
              <input type="password" placeholder="Client secret" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} aria-label="Google OAuth client secret" spellCheck={false} />
              <button type="submit" disabled={!!busy || !clientId.trim()}>Save client</button>
            </form>
          </details>
          {error?.where === 'google' && <p className="error-text" role="alert">{error.text}</p>}
        </section>
      </div>
    </div>
  )
}
