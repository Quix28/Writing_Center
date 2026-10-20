import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * SlopTotal: an open-source AI-text detector running entirely on this Mac (installed by
 * scripts/install-detector.sh). Started on demand on 127.0.0.1, stopped when idle or on quit.
 */
const DIR = process.env.WC_DETECTOR_DIR ?? join(homedir(), 'Library/Application Support/writing-centre/sloptotal')
const PYTHON = join(DIR, '.venv/bin/python')
const IDLE_STOP_MS = 10 * 60_000
const START_TIMEOUT_MS = 180_000
/** Test hook: use an already running detector (e.g. a mock) instead of starting one. */
const fixedUrl = process.env.WC_DETECTOR_URL

let child: ChildProcess | null = null
let url: string | null = null
let starting: Promise<string> | null = null
let idleTimer: ReturnType<typeof setTimeout> | undefined

export type DetectorParagraph = { index: number; text: string; char_count: number; score: number; verdict: string; confidence: string }
export type DetectorResult = { paragraphs: DetectorParagraph[]; overall_score: number; overall_verdict: string; paragraph_count: number; ai_paragraph_count: number }

export const installed = () => !!fixedUrl || (existsSync(PYTHON) && existsSync(join(DIR, 'app/main.py')))

export function status() {
  return { installed: installed(), running: !!url, firstRun: !fixedUrl && !existsSync(join(DIR, 'models')) }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port
      s.close(() => resolve(port))
    })
  })
}

async function waitUntilUp(base: string) {
  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (!child) throw new Error('The local detector stopped while starting.')
    const ok = await fetch(`${base}/api/engines`).then((r) => r.ok, () => false)
    if (ok) return
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('The local detector did not start in time.')
}

async function start(): Promise<string> {
  if (fixedUrl) return fixedUrl
  if (!installed()) throw new Error('The local detector is not installed. Run scripts/install-detector.sh in the project folder.')
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  child = spawn(PYTHON, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: DIR,
    env: { ...process.env, SLOPTOTAL_PROFILE: 'lite', HF_HOME: join(DIR, 'models'), SLOPTOTAL_DATA_DIR: join(DIR, 'data') },
    stdio: 'ignore'
  })
  child.on('exit', () => {
    child = null
    url = null
  })
  try {
    await waitUntilUp(base)
  } catch (e) {
    stop()
    throw e
  }
  return (url = base)
}

export function stop() {
  clearTimeout(idleTimer)
  child?.kill()
  child = null
  url = null
}

app.on('will-quit', stop)

/** Per-paragraph AI-likelihood scores (0–100) from the local detector. Text never leaves the Mac. */
export async function score(text: string): Promise<DetectorResult> {
  clearTimeout(idleTimer)
  const base = url ?? (await (starting ??= start().finally(() => (starting = null))))
  try {
    const res = await fetch(`${base}/api/paragraph-score`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error ? `Local detector: ${body.error}` : `Local detector error ${res.status}`)
    return body as DetectorResult
  } finally {
    if (!fixedUrl) idleTimer = setTimeout(stop, IDLE_STOP_MS)
  }
}
