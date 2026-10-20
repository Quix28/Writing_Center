#!/usr/bin/env node
// Stand-in for the `claude` CLI in subscription-mode tests: records every call, replies in stream-json.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.env.FAKE_CLAUDE_DIR
const args = process.argv.slice(2)
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')
const loggedIn = () => existsSync(join(dir, 'logged-in'))

if (args[0] === 'auth' && args[1] === 'status') {
  out({ loggedIn: loggedIn(), authMethod: loggedIn() ? 'claude.ai' : undefined, email: 'writer@example.com', subscriptionType: 'pro' })
  process.exit(0)
}
if (args[0] === 'auth' && args[1] === 'login') {
  writeFileSync(join(dir, 'logged-in'), '')
  appendFileSync(join(dir, 'calls.jsonl'), JSON.stringify({ args }) + '\n')
  process.exit(0)
}

const stdin = readFileSync(0, 'utf8')
const leakedEnv = Object.keys(process.env).filter((k) => /^(ANTHROPIC_|CLAUDECODE|CLAUDE_CODE_)/.test(k))
appendFileSync(join(dir, 'calls.jsonl'), JSON.stringify({ args, stdin, leakedEnv }) + '\n')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const result = (o) => out({ type: 'result', subtype: 'success', is_error: false, ...o })
out({ type: 'system', subtype: 'init', apiKeySource: 'none' })

if (stdin.includes('LIMIT')) {
  out({ type: 'result', subtype: 'success', is_error: true, result: "You've hit your usage limit · resets 6pm" })
} else if (args.includes('--json-schema')) {
  const schema = JSON.parse(args[args.indexOf('--json-schema') + 1])
  const quote = 'Things are kind of important in many ways for lots of people.'
  const structured = schema.properties.findings
    ? { findings: [{ category: 'clarity', quote, issue: 'Vague.', suggestion: 'Name what matters.', replacement: 'Clean water matters most.' }] }
    : { reply: 'Proposed one change.', edits: [{ find: quote, replace: 'Clean water matters most.' }] }
  result({ result: JSON.stringify(structured), structured_output: structured })
} else if (args.includes('--tools=WebSearch')) {
  out({ type: 'user', message: { content: [{ type: 'tool_result', content: 'Links: [{"title":"Real","url":"https://real.example/a"},{"title":"Real 2","url":"https://real.example/b"}]' }] } })
  result({ result: JSON.stringify({ items: [{ title: 'Real A', url: 'https://real.example/a', why: 'x' }, { title: 'Invented', url: 'https://invented.example/', why: 'y' }, { title: 'Real B', url: 'https://real.example/b', why: 'z' }] }) })
} else {
  for (const t of ['Rewritten ', 'on the ', 'plan.']) {
    out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } } })
    await sleep(300)
  }
  result({ result: 'Rewritten on the plan.' })
}
