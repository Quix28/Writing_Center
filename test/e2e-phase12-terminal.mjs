// Headless e2e: Claude Code terminal tab (with a stand-in `claude`), tabs keep their state, AI check highlights every band.
import { _electron as electron } from 'playwright'
import { createServer } from 'node:http'
import { chmodSync, cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { startMock, textEvents } from './mock-claude.mjs'

const target = process.env.WC_APP ? { executablePath: process.env.WC_APP, args: [] } : { args: ['.'] }
const tmp = (n) => join(import.meta.dirname, `.tmp-${n}/`)
for (const n of ['vault', 'userdata', 'bin']) rmSync(tmp(n), { recursive: true, force: true })
cpSync(join(import.meta.dirname, '../test-vault/'), tmp('vault'), { recursive: true })
const PARA = 'I burned the toast again this morning, which my cat took personally. She sat on the windowsill and refused to look at me.'
writeFileSync(tmp('vault') + 'Essay.md', `# Essay\n\n${PARA}\n`)
mkdirSync(tmp('bin'))
// Stand-in for interactive `claude`: says hello, echoes each line it receives, shows the folder it runs in.
// Like Claude Code, it turns bracketed paste on at its prompt; "menu" turns it off, as a permission prompt would.
writeFileSync(tmp('bin') + 'claude', '#!/bin/sh\nprintf "\\033[?2004h"\necho "FAKE CLAUDE in $(pwd) args:[$*]"\nwhile IFS= read -r line; do echo "got: $line"; case "$line" in *menu*) printf "\\033[?2004l";; *done*) printf "\\033[?2004h";; esac; done\n')
chmod(tmp('bin') + 'claude')
function chmod(p) { chmodSync(p, 0o755) }
const check = async (name, fn) => { await fn(); console.log('✔', name) }

const claudeApi = await startMock((body) => ({ events: textEvents([JSON.stringify({ overall_score: 10, summary: 'Reads human.', paragraphs: [{ opening: 'I burned the toast again', score: 10 }], tells: [] })], body.model) }))
const detector = createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' })
    if (req.url === '/api/engines') return res.end('[]')
    res.end(JSON.stringify({ paragraphs: [{ index: 0, text: PARA, char_count: 120, score: 12, verdict: 'clean', confidence: 'low' }], overall_score: 12, overall_verdict: 'clean', paragraph_count: 1, ai_paragraph_count: 0 }))
  })
})
await new Promise((r) => detector.listen(0, '127.0.0.1', r))

const env = { ...process.env, WC_VAULT: tmp('vault'), WC_HEADLESS: '1', WC_USER_DATA: tmp('userdata'), WC_CLAUDE_BIN: tmp('bin') + 'claude', ANTHROPIC_BASE_URL: claudeApi.url, ANTHROPIC_API_KEY: 'test-key', WC_DETECTOR_URL: `http://127.0.0.1:${detector.address().port}` }
const app = await electron.launch({ ...target, env })
const page = await app.firstWindow()
page.on('pageerror', (e) => console.error('pageerror', e))
const tab = (label) => page.locator('.ribbon [aria-label="' + label + '"]').click()
const screen = () => page.locator('.claude-term .xterm-rows').innerText()

await check('Claude Code does not start until its tab is opened', async () => {
  await page.locator('.tree-row', { hasText: 'Essay' }).click()
  await page.waitForTimeout(1500)
  assert.equal(await page.locator('.claude-term').count(), 0)
})

await check('Claude Code tab runs claude in the vault folder, in a real terminal', async () => {
  await tab('Claude Code')
  await page.waitForFunction(() => document.querySelector('.claude-term .xterm-rows')?.innerText.includes('FAKE CLAUDE'), null, { timeout: 15000 })
  assert((await screen()).replace(/\s+/g, '').includes(tmp('vault').replace(/\/$/, '').replace(/\s+/g, '')), 'runs in the vault')
  await page.waitForTimeout(1600) // Clawd glides to his new spot over 1.2s
  const clawd = await page.locator('.clawd-body').boundingBox()
  const center = await page.locator('.pane-body', { has: page.locator('.cm-editor') }).boundingBox()
  assert(clawd.x + clawd.width <= center.x + center.width + 1, 'Clawd stays inside the editor area after the panel widens')
})

await check('Continue last chat and Past chats restart claude with --continue / --resume', async () => {
  assert((await screen()).includes('args:[]'), 'a new chat has no flags')
  await page.locator('.term-bar button', { hasText: 'Continue last chat' }).click()
  await page.waitForFunction(() => document.querySelector('.claude-term .xterm-rows')?.innerText.includes('args:[--continue]'))
  await page.locator('.term-bar button', { hasText: 'Past chats' }).click()
  await page.waitForFunction(() => document.querySelector('.claude-term .xterm-rows')?.innerText.includes('args:[--resume]'))
  await page.locator('.term-bar button', { hasText: 'New chat' }).click()
  await page.waitForFunction(() => document.querySelector('.claude-term .xterm-rows')?.innerText.includes('args:[]'))
})

await check('typing goes to Claude; "Ask about this note" mentions the open note', async () => {
  await page.locator('.claude-term .xterm').click()
  await page.keyboard.type('hello there')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('.claude-term .xterm-rows').innerText.includes('got: hello there'))
  await page.locator('.term-bar button', { hasText: 'Ask about this note' }).click()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('.claude-term .xterm-rows').innerText.includes('got: @Essay.md'))
})

await check('buttons insert nothing while Claude Code shows a prompt or menu', async () => {
  await page.locator('.claude-term .xterm').click()
  await page.keyboard.type('menu')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('.claude-term .xterm-rows').innerText.includes('got: menu'))
  await page.locator('.term-bar button', { hasText: 'Ask about this note' }).click()
  await page.locator('.claude-term [role=status]', { hasText: 'Answer it first' }).waitFor()
  await page.keyboard.type('done')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('.claude-term .xterm-rows').innerText.includes('got: done'))
  assert(!(await screen()).includes('got: @Essay.md @Essay.md'), 'nothing was typed into the prompt')
})

await check('switching tabs keeps the terminal session and the Assistant draft', async () => {
  await tab('Assistant')
  await page.locator('.chat-input textarea').fill('my unfinished question')
  await tab('Backlinks')
  await tab('Assistant')
  assert.equal(await page.locator('.chat-input textarea').inputValue(), 'my unfinished question')
  await tab('Claude Code')
  assert((await screen()).includes('got: hello there'), 'same session, history intact')
})

await check('AI check highlights paragraphs even when they score low, and survives tab switches', async () => {
  await tab('AI check')
  await page.locator('.aicheck > button.primary').click()
  await page.locator('.score-card .score-value').nth(1).waitFor()
  await page.locator('.cm-ai-low').first().waitFor({ state: 'attached' })
  await tab('Backlinks')
  await tab('AI check')
  await page.locator('.score-card .score-value').nth(1).waitFor()
  await page.locator('.cm-ai-low').first().waitFor({ state: 'attached' })
})

await app.close()

await check('opened like from Finder (bare PATH), it still finds claude in ~/.local/bin', async () => {
  const home = tmp('home')
  mkdirSync(home + '.local/bin', { recursive: true })
  writeFileSync(home + '.local/bin/claude', '#!/bin/sh\necho "FOUND IN LOCAL BIN"\nsleep 30\n')
  chmod(home + '.local/bin/claude')
  const bare = { HOME: home, USER: process.env.USER, SHELL: '/bin/zsh', TMPDIR: process.env.TMPDIR, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', WC_VAULT: tmp('vault'), WC_HEADLESS: '1', WC_USER_DATA: tmp('userdata') }
  const finderApp = await electron.launch({ ...target, env: bare })
  const p = await finderApp.firstWindow()
  await p.locator('.tree-row', { hasText: 'Essay' }).click()
  await p.locator('.ribbon [aria-label="Claude Code"]').click()
  await p.waitForFunction(() => document.querySelector('.claude-term .xterm-rows')?.innerText.includes('FOUND IN LOCAL BIN'), null, { timeout: 15000 })
  await finderApp.close()
  rmSync(home, { recursive: true, force: true })
})

claudeApi.close()
detector.close()
for (const n of ['vault', 'userdata', 'bin']) rmSync(tmp(n), { recursive: true, force: true })
console.log('Terminal e2e: all checks passed')
