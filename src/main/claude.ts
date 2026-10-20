import Anthropic from '@anthropic-ai/sdk'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadSettings, saveSettings } from './settings'
import { checkSecret, loadSecrets, saveSecrets } from './secrets'
import * as vault from './vault'
import { extractLinks, resolveLink } from '../shared/links'
import { onlySourced, parseItems, sourcedUrls, urlsInToolResults, type Inspiration } from '../shared/inspiration'
import * as code from './claudecode'

/** ponytail: ~4 chars per token estimate instead of count_tokens; cap ≈ 100k tokens of linked-file context. */
const CONTEXT_CHAR_CAP = 400_000
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5'])
const DYNAMIC_SEARCH = /^claude-(opus-5|opus-4-[678]|sonnet-5|sonnet-4-6|fable|mythos)/

let client: Anthropic | null = null
const active = new Map<string, { abort: () => void }>()

const model = () => loadSettings().model

function friendly(e: unknown): Error {
  if (e instanceof Anthropic.AuthenticationError) return new Error('Claude rejected the API key. Set ANTHROPIC_API_KEY and restart.')
  if (e instanceof Anthropic.NotFoundError) return new Error(`Model "${model()}" is not available to this API key. Pick another model.`)
  if (e instanceof Anthropic.RateLimitError) return new Error('Claude rate limit reached. Try again in a minute.')
  if (e instanceof Anthropic.APIConnectionError) return new Error('Network error: could not reach Claude.')
  if (e instanceof Anthropic.APIUserAbortError) return new Error('Cancelled.')
  if (e instanceof Anthropic.APIError) return new Error(`Claude API error ${e.status ?? ''}: ${e.message}`)
  const message = e instanceof Error ? e.message : String(e)
  if (/terminated|socket|ECONN|ETIMEDOUT|ENOTFOUND|fetch failed|network/i.test(message)) return new Error('Network error: the connection to Claude was interrupted.')
  return e instanceof Error ? e : new Error(message)
}

/** Browser sign-in goes through Anthropic's own CLI into a dedicated profile, so it never touches your other logins. */
const PROFILE = 'writing-centre'
type Method = 'subscription' | 'key' | 'browser' | 'env' | 'none'

function method(): Method {
  if (loadSettings().claudeAuth === 'subscription') return 'subscription'
  if (loadSecrets().anthropicKey) return 'key'
  if (loadSettings().claudeAuth === 'browser') return 'browser'
  return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? 'env' : 'none'
}

function getClient(): Anthropic {
  if (client) return client
  const m = method()
  if (m === 'none') throw new Error('Claude is not connected. Open Connections (status bar, bottom left) to sign in.')
  try {
    if (m === 'key') return (client = new Anthropic({ apiKey: loadSecrets().anthropicKey }))
    if (m === 'browser') return (client = new Anthropic({ profile: PROFILE }))
    checkSecret('ANTHROPIC_API_KEY', process.env.ANTHROPIC_API_KEY)
    checkSecret('ANTHROPIC_AUTH_TOKEN', process.env.ANTHROPIC_AUTH_TOKEN)
    return (client = new Anthropic())
  } catch (e) {
    throw new Error(`Claude is not configured: ${(e as Error).message}`)
  }
}

/** Finder-launched apps get a minimal PATH, so look where Homebrew installs too. */
function findAnt(): string | null {
  const dirs = [...(process.env.PATH ?? '').split(':'), '/opt/homebrew/bin', '/usr/local/bin']
  return dirs.map((d) => join(d, 'ant')).find((p) => existsSync(p)) ?? null
}

function runAnt(args: string[], timeoutMs: number): Promise<void> {
  const ant = findAnt()
  if (!ant) return Promise.reject(new Error("Anthropic's CLI (ant) is not installed. Install it with: brew install anthropics/tap/ant"))
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  return new Promise((resolve, reject) => {
    const child = spawn(ant, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (d) => (output += d))
    child.stderr.on('data', (d) => (output += d))
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.on('error', (e) => (clearTimeout(timer), reject(e)))
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(output.trim().split('\n').slice(-3).join(' ') || `ant exited with code ${code}`))
    })
  })
}

export type ClaudeStatus = { method: Method; ok: boolean; detail: string }

export async function status(): Promise<ClaudeStatus> {
  const m = method()
  if (m === 'none') return { method: m, ok: false, detail: 'Not connected.' }
  if (m === 'subscription') {
    try {
      const a = await code.authStatus()
      if (!a.loggedIn) return { method: m, ok: false, detail: 'Claude Code is not signed in. Click "Use my Claude subscription" to sign in.' }
      if (a.authMethod !== 'claude.ai') return { method: m, ok: false, detail: `Claude Code is signed in with ${a.authMethod}, not a Claude subscription. Run "claude auth login" in Terminal to switch.` }
      return { method: m, ok: true, detail: `Claude Code signed in as ${a.email ?? 'you'}${a.subscriptionType ? ` (${a.subscriptionType} plan)` : ''}` }
    } catch (e) {
      return { method: m, ok: false, detail: (e as Error).message }
    }
  }
  try {
    const models = await listModels()
    return { method: m, ok: true, detail: `${models.length} models available` }
  } catch (e) {
    return { method: m, ok: false, detail: (e as Error).message }
  }
}

/** Opens platform.claude.com in the browser via `ant auth login`; resolves once you approve. */
export async function browserLogin(): Promise<ClaudeStatus> {
  await runAnt(['auth', 'login', '--profile', PROFILE], 6 * 60_000)
  saveSecrets({ anthropicKey: null })
  saveSettings({ claudeAuth: 'browser' })
  client = null
  return status()
}

/** Routes every AI request through the user's own Claude Code, billed to their Claude plan. Signs in first if needed. */
export async function useSubscription(): Promise<ClaudeStatus> {
  const a = await code.authStatus().catch(() => ({ loggedIn: false }) as code.CodeAuth)
  if (!a.loggedIn) await code.login()
  const current = loadSettings().model
  saveSettings({ claudeAuth: 'subscription', model: code.MODELS.some((m) => m.id === current) ? current : 'sonnet' })
  return status()
}

export async function setKey(key: string): Promise<ClaudeStatus> {
  const apiKey = checkSecret('API key', key)
  if (!apiKey) throw new Error('Paste an API key first.')
  saveSecrets({ anthropicKey: apiKey })
  if (loadSettings().claudeAuth === 'subscription') saveSettings({ claudeAuth: undefined })
  client = null
  return status()
}

export async function disconnect(): Promise<ClaudeStatus> {
  if (loadSettings().claudeAuth === 'browser') await runAnt(['auth', 'logout', '--profile', PROFILE], 30_000).catch(() => {})
  saveSecrets({ anthropicKey: null })
  saveSettings({ claudeAuth: undefined })
  client = null
  return status()
}

/** Every call goes through here: picked model, refusal fallbacks where supported, refusal check, friendly errors. */
async function run(
  params: Omit<Anthropic.Beta.MessageCreateParamsNonStreaming, 'model' | 'max_tokens'> & { max_tokens?: number },
  opts: { id?: string; onText?: (t: string) => void } = {}
): Promise<Anthropic.Beta.BetaMessage> {
  const m = model()
  const fallback = FALLBACK_MODELS.has(m) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}
  try {
    const stream = getClient().beta.messages.stream({ max_tokens: 64000, ...params, ...fallback, model: m })
    if (opts.id) active.set(opts.id, { abort: () => stream.abort() })
    if (opts.onText) stream.on('text', opts.onText)
    const msg = await stream.finalMessage()
    if (msg.stop_reason === 'refusal') throw new Error('Claude declined this request.')
    return msg
  } catch (e) {
    throw friendly(e)
  } finally {
    if (opts.id) active.delete(opts.id)
  }
}

const textOf = (msg: Anthropic.Beta.BetaMessage) =>
  msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('')

function json<T>(msg: Anthropic.Beta.BetaMessage): T {
  try {
    return JSON.parse(textOf(msg))
  } catch {
    throw new Error(msg.stop_reason === 'max_tokens' ? 'Claude ran out of output space. Try a shorter file or selection.' : 'Claude returned malformed JSON.')
  }
}

export const abort = (id: string) => (active.get(id)?.abort(), code.abort(id))

export async function listModels(): Promise<{ id: string; name: string }[]> {
  if (method() === 'subscription') return code.MODELS
  try {
    const out: { id: string; name: string }[] = []
    for await (const m of getClient().models.list()) out.push({ id: m.id, name: m.display_name })
    return out
  } catch (e) {
    throw friendly(e)
  }
}

/** The current file plus the notes it links to, until the context cap is reached. */
export async function buildContext(path: string, text: string): Promise<string> {
  let out = `<current_file path="${path}">\n${text}\n</current_file>`
  const files = vault.flatFiles(await vault.tree())
  for (const target of new Set(extractLinks(text))) {
    const linked = resolveLink(target, files)
    if (!linked || linked === path) continue
    const chunk = `\n<linked_file path="${linked}">\n${await vault.read(linked).catch(() => '')}\n</linked_file>`
    if (out.length + chunk.length <= CONTEXT_CHAR_CAP) out += chunk
  }
  return out
}

const CATEGORIES = ['clarity', 'argument strength', 'structure', 'repetition', 'tone'] as const
export type Finding = { category: (typeof CATEGORIES)[number]; quote: string; issue: string; suggestion: string; replacement: string }

const findingsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'quote', 'issue', 'suggestion', 'replacement'],
        properties: {
          category: { type: 'string', enum: [...CATEGORIES] },
          quote: { type: 'string', description: 'Exact, verbatim span copied from the current file (a phrase or sentence).' },
          issue: { type: 'string', description: 'What is wrong, in one or two sentences.' },
          suggestion: { type: 'string', description: 'How to fix it, in one sentence.' },
          replacement: { type: 'string', description: 'Text that should replace the quote, ready to paste.' }
        }
      }
    }
  }
}

const viaCode = () => method() === 'subscription'

/** Claude Code takes one prompt, so earlier chat turns are folded into it. */
const fold = (messages: ChatTurn[]) =>
  messages.map((m) => (m.role === 'user' ? m.content : `<your_previous_reply>\n${m.content}\n</your_previous_reply>`)).join('\n\n')

/** The Assistant runs as the writer's own Claude Code session (CLAUDE.md, skills, hooks) in the vault folder. */
const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep', 'Skill', 'WebSearch', 'WebFetch']
const session = (tools: string[]): code.FullSession | undefined => {
  const root = vault.getRoot()
  return root ? { cwd: root, tools } : undefined
}

async function structured<T>(system: string, messages: ChatTurn[], schema: { [key: string]: unknown }, full?: code.FullSession): Promise<T> {
  if (viaCode()) {
    const r = await code.run({ model: model(), system, prompt: fold(messages), schema, full })
    if (r.structured === undefined) throw new Error('Claude returned no structured result. Try again.')
    return r.structured as T
  }
  return json<T>(await run({ system, messages, output_config: { format: { type: 'json_schema', schema } } }))
}

async function streamed(id: string, system: string, messages: ChatTurn[], onText: (t: string) => void, full?: code.FullSession): Promise<string> {
  if (viaCode()) return (await code.run({ model: model(), system, prompt: fold(messages), id, onText, full })).text
  const res = await run({ system, messages }, { id, onText })
  if (res.stop_reason === 'max_tokens') throw new Error('Claude ran out of output space before finishing.')
  return textOf(res)
}

const QUOTE_RULES =
  'Every quote must be copied character-for-character from <current_file> (never from linked files), short (a phrase or a sentence), and must not span markdown syntax you would not reproduce exactly.'

/** `withLinks: false` is Clawd's cheap path: only the visible passage, no linked notes. */
export async function review(path: string, text: string, limit?: number, withLinks = true): Promise<Finding[]> {
  const system = `You are a demanding but fair writing editor. Review the content of <current_file> for clarity, argument strength, structure, repetition and tone. Linked files are background only. ${QUOTE_RULES}${limit ? ` Report only the ${limit} weakest spots, most important first.` : ''} Return no findings rather than inventing weak ones.`
  const content = withLinks ? await buildContext(path, text) : `<current_file path="${path}">\n${text}\n</current_file>`
  return (await structured<{ findings: Finding[] }>(system, [{ role: 'user', content }], findingsSchema)).findings
}

export type ChatTurn = { role: 'user' | 'assistant'; content: string }
export type Edit = { find: string; replace: string }

const editsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'edits'],
  properties: {
    reply: { type: 'string', description: 'Short explanation for the writer.' },
    edits: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['find', 'replace'],
        properties: {
          find: { type: 'string', description: 'Exact, verbatim text from the current file to replace. Must be unique in the file.' },
          replace: { type: 'string' }
        }
      }
    }
  }
}

function withContext(history: ChatTurn[], context: string, instruction: string): ChatTurn[] {
  return [...history, { role: 'user', content: `${context}\n\n<request>\n${instruction}\n</request>` }]
}

/** Suggest mode: Claude only proposes edits; the renderer shows them as a diff and the writer decides. */
export async function suggest(a: { path: string; text: string; selection?: string; instruction: string; history: ChatTurn[] }) {
  const focus = a.selection ? `\n\nThe writer has selected this passage; focus on it:\n<selection>\n${a.selection}\n</selection>` : ''
  return structured<{ reply: string; edits: Edit[] }>(
    `You are a writing assistant working inside the writer's notes app. You never edit the file yourself: you propose edits that the writer will review one by one. Propose edits only when they help with the request; questions can be answered with an empty edits list. ${QUOTE_RULES.replace('Every quote', 'Every "find"')}`,
    withContext(a.history, await buildContext(a.path, a.text), a.instruction + focus),
    editsSchema,
    session(READ_ONLY_TOOLS)
  )
}

/** Write mode: streams replacement text for one passage. */
export async function write(
  id: string,
  a: { path: string; text: string; target: string; instruction: string; history: ChatTurn[] },
  onText: (t: string) => void
): Promise<string> {
  return streamed(
    id,
    'You are a writing assistant that rewrites one passage of the writer\'s markdown note. Output ONLY the new markdown for the passage in <target>: no preamble, no code fences, no commentary. Keep headings and links unless asked to change them. Match the writer\'s voice.',
    withContext(a.history, await buildContext(a.path, a.text), `${a.instruction}\n\n<target>\n${a.target}\n</target>`),
    onText,
    // No tools in Write mode: narration between tool calls would otherwise stream into the note.
    session([])
  )
}

export function webSearchTool() {
  return { type: DYNAMIC_SEARCH.test(model()) ? 'web_search_20260209' : 'web_search_20250305', name: 'web_search', max_uses: 5 } as Anthropic.Beta.BetaToolUnion
}

export type { Inspiration }

/** Web-searched examples for one weak passage. Items whose URL did not come back from the search are dropped. */
const INSPIRE_SYSTEM =
  'A writer is stuck on the passage below. Use web search to find 3 to 5 concrete, relevant examples, techniques, or sources that show how skilled writers handle this issue. Only include pages that appeared in your search results, and copy each URL exactly as the results gave it. Finish with only this JSON: {"items":[{"title":"…","url":"…","why":"one sentence on how it helps"}]}'

export async function inspire(a: { passage: string; issue: string }): Promise<Inspiration[]> {
  const prompt = `<passage>\n${a.passage}\n</passage>\n<issue>\n${a.issue}\n</issue>`
  if (viaCode()) {
    const r = await code.run({ model: model(), system: INSPIRE_SYSTEM, prompt, web: true })
    const items = onlySourced(parseItems(r.text), urlsInToolResults(r.toolResults)).slice(0, 5)
    if (!items.length) throw new Error('Claude found no inspiration with a verifiable source. Try again later.')
    return items
  }
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: prompt }]
  const blocks: Anthropic.Beta.BetaContentBlock[] = []
  let msg: Anthropic.Beta.BetaMessage | null = null
  for (let turn = 0; turn < 4; turn++) {
    msg = await run({
      max_tokens: 16000,
      system: INSPIRE_SYSTEM,
      messages,
      tools: [webSearchTool()]
    })
    blocks.push(...msg.content)
    if (msg.stop_reason !== 'pause_turn') break
    messages.push({ role: 'assistant', content: msg.content })
  }
  const items = onlySourced(parseItems(textOf(msg!)), sourcedUrls(blocks)).slice(0, 5)
  if (!items.length) throw new Error('Claude found no inspiration with a verifiable source. Try again later.')
  return items
}

export type AiTells = {
  overall_score: number
  summary: string
  paragraphs: { opening: string; score: number }[]
  tells: { quote: string; pattern: string; explanation: string; replacement: string }[]
}

const aiTellsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['overall_score', 'summary', 'paragraphs', 'tells'],
  properties: {
    overall_score: { type: 'integer', description: '0 = reads entirely human, 100 = reads entirely like AI-generated text.' },
    summary: { type: 'string', description: 'Two sentences on the overall impression.' },
    paragraphs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['opening', 'score'],
        properties: {
          opening: { type: 'string', description: 'The first 6 to 10 words of the paragraph, copied exactly.' },
          score: { type: 'integer', description: '0 to 100, as for overall_score.' }
        }
      }
    },
    tells: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['quote', 'pattern', 'explanation', 'replacement'],
        properties: {
          quote: { type: 'string', description: 'Exact, verbatim span from the text.' },
          pattern: { type: 'string', description: 'Short name of the AI-writing pattern.' },
          explanation: { type: 'string' },
          replacement: { type: 'string', description: 'A more natural rewrite of the quote, ready to paste.' }
        }
      }
    }
  }
}

/**
 * Claude's read on how AI-generated the prose *sounds*: stylistic tells, not proof of authorship.
 * Runs in the cheap isolated mode in subscription use.
 */
export async function aiTells(text: string): Promise<AiTells> {
  return structured<AiTells>(
    `You assess how much a piece of prose reads like AI-generated text, based on known stylistic tells: inflated significance ("a testament to", "pivotal"), "not just X but Y" contrasts, reflexive groups of three, em-dash overuse, vague attributions, promotional or stock vocabulary ("delve", "tapestry", "foster", "multifaceted"), filler transitions ("It's important to note"), tidy summarizing closers, uniform sentence rhythm, and generic claims with no concrete detail. Concrete specifics, personal voice, irregular rhythm and small imperfections read human. Score every prose paragraph (skip headings). List the 3 to 8 clearest tells. ${QUOTE_RULES.replace('<current_file>', 'the text')} This is a style signal, not proof of who wrote it, so calibrate: ordinary competent writing should score low.`,
    [{ role: 'user', content: `<text>\n${text}\n</text>` }],
    aiTellsSchema
  )
}
