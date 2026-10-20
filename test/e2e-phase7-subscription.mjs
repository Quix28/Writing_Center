// Headless e2e for subscription mode (requests through Claude Code), using test/fake-claude.mjs.
import { _electron as electron } from 'playwright'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const target = process.env.WC_APP ? { executablePath: process.env.WC_APP, args: [] } : { args: ['.'] }
const tmp = (n) => join(import.meta.dirname, `.tmp-${n}/`)
for (const n of ['vault', 'userdata', 'bin']) rmSync(tmp(n), { recursive: true, force: true })
cpSync(join(import.meta.dirname, '../test-vault/'), tmp('vault'), { recursive: true })
writeFileSync(tmp('vault') + 'Essay.md', '# Essay\n\nThings are kind of important in many ways for lots of people.\n\nA second paragraph that is fine.\n')
mkdirSync(tmp('bin'))
writeFileSync(tmp('bin') + 'claude', `#!/bin/sh\nexec "${process.execPath}" "${join(import.meta.dirname, 'fake-claude.mjs')}" "$@"\n`)
chmodSync(tmp('bin') + 'claude', 0o755)
const calls = () => readFileSync(tmp('bin') + 'calls.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const check = async (name, fn) => { await fn(); console.log('✔', name) }

const env = { ...process.env, WC_VAULT: tmp('vault'), WC_HEADLESS: '1', WC_USER_DATA: tmp('userdata'), FAKE_CLAUDE_DIR: tmp('bin'), PATH: `${tmp('bin')}:${process.env.PATH}`, ANTHROPIC_API_KEY: 'sk-ant-should-not-leak' }
const app = await electron.launch({ ...target, env })
const page = await app.firstWindow()
page.on('pageerror', (e) => console.error('pageerror', e))
const doc = () => page.evaluate(() => window.wcView().state.doc.toString())
const claude = page.locator('.sheet .service').nth(0)

await check('"Use my Claude subscription" signs Claude Code in and connects', async () => {
  await page.locator('.statusbar button').first().click()
  await claude.locator('button', { hasText: 'Use my Claude subscription' }).click()
  await claude.locator('.pill', { hasText: 'Connected with your Claude subscription' }).waitFor()
  await claude.locator('text=writer@example.com (pro plan)').waitFor()
  assert.deepEqual(calls()[0].args, ['auth', 'login'])
  assert.equal(JSON.parse(readFileSync(tmp('userdata') + 'settings.json', 'utf8')).model, 'sonnet')
  await page.keyboard.press('Escape')
})

await check('review runs through `claude -p` with isolated settings and no API key', async () => {
  await page.locator('.tree-row', { hasText: 'Essay' }).click()
  await page.locator('.side-tabs button', { hasText: 'Assistant' }).click()
  await page.locator('.model-picker option', { hasText: 'Sonnet (latest)' }).waitFor({ state: 'attached' })
  await page.locator('.cm-content').focus()
  await page.keyboard.press('Meta+p')
  await page.keyboard.type('review content')
  await page.keyboard.press('Enter')
  await page.locator('.finding').first().waitFor()
  const c = calls().at(-1)
  for (const flag of ['-p', '--setting-sources=', '--strict-mcp-config', '--no-session-persistence', '--tools=', '--json-schema']) assert(c.args.includes(flag), flag)
  assert.equal(c.args[c.args.indexOf('--model') + 1], 'sonnet')
  assert.deepEqual(c.leakedEnv, [])
  assert(c.stdin.includes('<current_file path="Essay.md">'))
})

await check('write mode streams the plan\'s output into the editor', async () => {
  await page.locator('.side-tabs button', { hasText: 'Assistant' }).click()
  await page.locator('.mode-toggle button', { hasText: 'Write' }).click()
  await page.evaluate(() => { const v = window.wcView(); v.dispatch({ selection: { anchor: v.state.doc.toString().indexOf('A second') } }) })
  await page.locator('.chat-input textarea').fill('Rewrite')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.wcView().state.doc.toString().includes('Rewritten'))
  await page.locator('.msg.assistant', { hasText: 'I rewrote the passage' }).waitFor()
  const d = await doc()
  assert(d.includes('Rewritten on the plan.') && !d.includes('A second paragraph') && d.includes('Things are kind of important'), 'only the paragraph under the cursor is rewritten')
})

await check('Clawd does not review on his own in subscription mode, but does when clicked', async () => {
  const n = calls().length
  await page.locator('.cm-content').focus()
  await page.keyboard.press('Meta+ArrowDown')
  await page.keyboard.type(' More.')
  await sleep(9500)
  assert.equal(calls().length, n, 'no automatic review')
  await page.locator('.clawd-body').click()
  await page.locator('.clawd-bubble', { hasText: "This is where I'd change" }).waitFor()
  assert.equal(calls().length, n + 1)
})

await check('Find inspiration uses Claude Code WebSearch and drops unsourced items', async () => {
  await page.locator('.clawd-actions button', { hasText: 'Find inspiration' }).click()
  await page.locator('.inspo-item').first().waitFor()
  const hrefs = await page.locator('.inspo-item a').evaluateAll((as) => as.map((a) => a.getAttribute('href')))
  assert.deepEqual(hrefs, ['https://real.example/a', 'https://real.example/b'])
  const c = calls().at(-1)
  assert(c.args.includes('--tools=WebSearch') && c.args.includes('--allowedTools=WebSearch'))
})

await check('a plan usage limit shows a clear toast', async () => {
  await page.locator('.side-tabs button', { hasText: 'Assistant' }).click()
  await page.locator('.mode-toggle button', { hasText: 'Suggest' }).click()
  await page.locator('.chat-input textarea').fill('LIMIT test')
  await page.keyboard.press('Enter')
  await page.locator('.toast', { hasText: 'usage limit' }).waitFor()
})

await app.close()
rmSync(tmp('bin'), { recursive: true, force: true })
console.log('Subscription e2e: all checks passed')
