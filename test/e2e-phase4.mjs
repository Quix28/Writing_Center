// Headless e2e for Clawd + Find inspiration against the mock API: `npm run build && node test/e2e-phase4.mjs`
import { _electron as electron } from 'playwright'
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'

/** WC_APP=<path to the .app's executable> runs the suite against the packaged app instead of the dev build. */
const target = process.env.WC_APP ? { executablePath: process.env.WC_APP, args: [] } : { args: ['.'] }
import { blockEvents, startMock, textEvents } from './mock-claude.mjs'

const vault = join(import.meta.dirname, '.tmp-vault/')
const userData = join(import.meta.dirname, '.tmp-userdata/')
rmSync(vault, { recursive: true, force: true })
rmSync(userData, { recursive: true, force: true })
cpSync(join(import.meta.dirname, '../test-vault/'), vault, { recursive: true })
writeFileSync(vault + 'Essay.md', '# Essay\n\nThings are kind of important in many ways for lots of people.\n\nIn conclusion, it is what it is and that is that.\n\nA third paragraph that is perfectly fine and clear.\n')
const disk = (f) => readFileSync(vault + f, 'utf8')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const check = async (name, fn) => { await fn(); console.log('✔', name) }
const requestAfter = async (n) => { for (let i = 0; i < 100 && mock.requests.length <= n; i++) await sleep(50); return mock.requests[n].body }

const REAL = ['https://real.example/show-dont-tell', 'https://writing.example/specific-claims']
const mock = await startMock((body) => {
  if (body.tools?.some((t) => t.name === 'web_search'))
    return { delay: 300, events: blockEvents([
      { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'vague writing fixes' } },
      { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: REAL.map((url, i) => ({ type: 'web_search_result', url, title: `Real ${i}`, encrypted_content: 'x', page_age: null })) },
      { type: 'text', text: JSON.stringify({ items: [
        { title: 'Show, don\'t tell', url: REAL[0], why: 'Concrete detail beats abstraction.' },
        { title: 'Invented source', url: 'https://made-up.example/never-searched', why: 'Should never be shown.' },
        { title: 'Make specific claims', url: REAL[1] + '/', why: 'Name who and how.' }
      ] }) }
    ], body.model) }
  return { delay: 300, events: textEvents([JSON.stringify({ findings: [
    { category: 'clarity', quote: 'Things are kind of important in many ways for lots of people.', issue: 'Vague.', suggestion: 'Say what matters and to whom.', replacement: 'Clean water matters most to rural families.' },
    { category: 'tone', quote: 'it is what it is and that is that.', issue: 'Cliché ending.', suggestion: 'End on your strongest point.', replacement: 'access to water decides who thrives.' }
  ] })], body.model) }
})

const app = await electron.launch({ ...target, env: { ...process.env, WC_VAULT: vault, WC_HEADLESS: '1', WC_USER_DATA: userData, ANTHROPIC_BASE_URL: mock.url, ANTHROPIC_API_KEY: 'test-key' } })
const page = await app.firstWindow()
page.on('pageerror', (e) => console.error('pageerror', e))
const clawd = page.locator('.clawd')
const editorFocused = () => page.evaluate(() => !!document.activeElement?.closest('.cm-editor'))
const mode = async () => (await clawd.getAttribute('class')).match(/mode-(\w+)/)[1]

await check('Clawd idles at home with blink/bob animation', async () => {
  await page.locator('.tree-row', { hasText: 'Essay' }).click()
  await page.locator('.cm-content').waitFor()
  await clawd.waitFor()
  assert.equal(await mode(), 'idle')
  assert.notEqual(await page.locator('.clawd .eyes').evaluate((e) => getComputedStyle(e).animationName), 'none')
})

let typedAt
await check('typing: Clawd taps along and never takes focus', async () => {
  await page.locator('.cm-content').click()
  await page.keyboard.press('Meta+ArrowDown')
  await page.keyboard.type('More text.')
  assert.equal(await mode(), 'typing')
  assert(await editorFocused())
  typedAt = Date.now()
  await page.waitForFunction(() => document.querySelector('.clawd').classList.contains('mode-idle'))
})

await check('8s typing pause → thinking → walks → points at a weak spot', async () => {
  await page.waitForFunction(() => document.querySelector('.clawd').classList.contains('mode-thinking'), null, { timeout: 12000 })
  const waited = Date.now() - typedAt
  assert(waited >= 7500 && waited < 11000, `review fired after ${waited}ms`)
  const req = await requestAfter(0)
  assert.match(req.system, /3 weakest/)
  assert(!req.messages[0].content.includes('<linked_file'), 'Clawd sends only the visible text')
  await page.waitForFunction(() => document.querySelector('.clawd').classList.contains('mode-walking'))
  await page.waitForFunction(() => document.querySelector('.clawd').classList.contains('mode-pointing'))
  await page.locator('.clawd-bubble', { hasText: "This is where I'd change…" }).waitFor()
  await page.locator('.cm-clawd-spot', { hasText: 'Things are kind of important' }).waitFor()
  const c = await page.locator('.clawd-body').boundingBox()
  const line = await page.locator('.cm-line', { hasText: 'Things are kind of important' }).boundingBox()
  assert(Math.abs(c.y - line.y) < 40, `Clawd y ${c.y} vs paragraph y ${line.y}`)
  assert(await editorFocused())
})

await check('typing still works while Clawd points', async () => {
  await page.keyboard.type(' Still typing.')
  assert((await page.evaluate(() => window.wcView().state.doc.toString())).includes('More text. Still typing.'))
  assert(await editorFocused())
})

await check('Dismiss moves to the next spot without stealing focus', async () => {
  await page.locator('.clawd-actions button', { hasText: 'Dismiss' }).click()
  await page.locator('.clawd-bubble', { hasText: '2 of 2' }).waitFor()
  await page.locator('.cm-clawd-spot', { hasText: 'it is what it is' }).waitFor()
  assert(await editorFocused())
})

await check('Find inspiration: web search tool sent, only sourced URLs shown', async () => {
  const n = mock.requests.length
  await page.locator('.clawd-actions button', { hasText: 'Find inspiration' }).click()
  await page.waitForFunction(() => document.querySelector('.clawd').classList.contains('mode-thinking'))
  await page.locator('.inspo-item').first().waitFor()
  const req = await requestAfter(n)
  assert.equal(req.tools[0].type, 'web_search_20260209')
  const hrefs = await page.locator('.inspo-item a').evaluateAll((as) => as.map((a) => a.getAttribute('href')))
  assert.equal(hrefs.length, 2)
  assert(!hrefs.some((h) => h.includes('made-up')))
  await page.waitForFunction(() => document.querySelector('.clawd').classList.contains('mode-pointing'))
})

await check('Apply goes through the suggest diff; file untouched; Clawd walks home', async () => {
  await sleep(700)
  const before = disk('Essay.md')
  await page.locator('.clawd-actions button', { hasText: 'Apply' }).click()
  await page.locator('.review-bar').waitFor()
  await page.waitForFunction(() => document.querySelector('.clawd').classList.contains('home'))
  await sleep(800)
  assert.equal(disk('Essay.md'), before)
  await page.locator('.review-bar button', { hasText: 'Accept all' }).click()
  await sleep(800)
  assert(disk('Essay.md').includes('access to water decides who thrives.'))
})

await check('at most one review per 60s', async () => {
  const n = mock.requests.length
  await page.locator('.cm-content').focus()
  assert(await editorFocused())
  await page.locator('.clawd-body').click()
  await page.locator('.clawd-bubble', { hasText: /Give me \d+s/ }).waitFor()
  await sleep(500)
  assert.equal(mock.requests.length, n)
  assert(await editorFocused())
})

await check('Clawd can be turned off and the choice persists', async () => {
  await page.locator('.clawd-toggle').click()
  await clawd.waitFor({ state: 'detached' })
  await sleep(200)
  assert.equal(JSON.parse(readFileSync(userData + 'settings.json', 'utf8')).clawd, false)
})

await app.close()
mock.close()
console.log('Phase 4 e2e: all checks passed')
