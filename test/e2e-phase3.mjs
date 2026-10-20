// Headless e2e for Harper + Claude features against a local mock API: `npm run build && node test/e2e-phase3.mjs`
import { _electron as electron } from 'playwright'
import { cpSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'

/** WC_APP=<path to the .app's executable> runs the suite against the packaged app instead of the dev build. */
const target = process.env.WC_APP ? { executablePath: process.env.WC_APP, args: [] } : { args: ['.'] }
import { startMock, textEvents } from './mock-claude.mjs'

const vault = join(import.meta.dirname, '.tmp-vault/')
const userData = join(import.meta.dirname, '.tmp-userdata/')
rmSync(vault, { recursive: true, force: true })
rmSync(userData, { recursive: true, force: true })
cpSync(join(import.meta.dirname, '../test-vault/'), vault, { recursive: true })
const disk = (f) => readFileSync(vault + f, 'utf8')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const check = async (name, fn) => { await fn(); console.log('✔', name) }

let next = null
const mock = await startMock((body) => {
  const schema = body.output_config?.format?.schema
  if (next) { const r = next; if (!r.sticky) next = null; return r(body) }
  if (schema?.properties?.findings) return { events: textEvents([JSON.stringify({ findings: [
    { category: 'clarity', quote: 'Some **bold** and *italic* text.', issue: 'Vague filler sentence.', suggestion: 'Say something specific.', replacement: 'Bold claims need evidence.' },
    { category: 'tone', quote: 'not in the note', issue: 'x', suggestion: 'y', replacement: 'z' }
  ] })], body.model) }
  if (schema?.properties?.edits) return { events: textEvents([JSON.stringify({ reply: 'Tightened the intro.', edits: [
    { find: 'This links to', replace: 'This note links to' }, { find: 'missing text', replace: 'nope' }
  ] })], body.model) }
  return { events: textEvents(['Rewritten ', 'passage ', 'by Claude.'], body.model), delay: 400 }
})

const app = await electron.launch({ ...target, env: { ...process.env, WC_VAULT: vault, WC_HEADLESS: '1', WC_USER_DATA: userData, ANTHROPIC_BASE_URL: mock.url, ANTHROPIC_API_KEY: 'test-key' } })
const page = await app.firstWindow()
page.on('pageerror', (e) => console.error('pageerror', e))
const doc = () => page.evaluate(() => window.wcView().state.doc.toString())
const openNote = async (name) => { await page.locator('.tree-row', { hasText: name }).first().click(); await page.locator('.cm-content').waitFor() }
const side = (label) => page.locator('.side-tabs button', { hasText: label }).click()
const toast = () => page.locator('.toast').last().innerText()

await check('harper underlines a grammar error locally and quick-fix applies it', async () => {
  await openNote('Second')
  await page.locator('.cm-content').click()
  await page.keyboard.press('Meta+ArrowDown')
  await page.keyboard.type('\n\nThis is teh test.')
  const range = page.locator('.cm-lintRange-warning', { hasText: 'teh' }).first()
  await range.waitFor({ timeout: 15000 })
  await range.hover()
  const action = page.locator('.cm-tooltip-lint .cm-diagnosticAction').first()
  await action.waitFor()
  await action.click()
  await page.waitForFunction(() => !document.querySelector('.cm-content').innerText.includes('teh test'))
  assert.equal(mock.requests.length, 0, 'harper must not call any API')
})

await check('model picker lists models from the API and persists the choice', async () => {
  await side('Assistant')
  const select = page.locator('.model-picker select')
  await page.locator('.model-picker option', { hasText: 'Claude Sonnet 5.5' }).waitFor({ state: 'attached' })
  await select.selectOption('claude-sonnet-5-5')
  await sleep(200)
  assert.equal(JSON.parse(readFileSync(userData + 'settings.json', 'utf8')).model, 'claude-sonnet-5-5')
  await select.selectOption('claude-opus-5-5')
})

await check('review content: findings render, spans highlighted, request is well-formed', async () => {
  await openNote('Welcome')
  await page.keyboard.press('Meta+p')
  await page.keyboard.type('review content')
  await page.keyboard.press('Enter')
  await page.locator('.finding').first().waitFor()
  assert.equal(await page.locator('.finding').count(), 2)
  assert.equal(await page.locator('.finding.stale').count(), 1)
  await page.locator('.cm-finding').first().waitFor()
  const req = mock.requests.at(-1)
  assert.equal(req.body.model, 'claude-opus-5-5')
  assert.equal(req.body.fallbacks, 'default')
  assert.match(req.headers['anthropic-beta'], /server-side-fallback-2026-07-01/)
  const ctx = req.body.messages[0].content
  assert(ctx.includes('<current_file path="Welcome.md">') && ctx.includes('<linked_file path="Second.md">') && ctx.includes('<linked_file path="notes/Ideas.md">'))
})

await check('propose fix shows a diff; disk untouched until the hunk is accepted', async () => {
  const before = disk('Welcome.md')
  await page.locator('.finding:not(.stale) button', { hasText: 'Propose fix' }).click()
  await page.locator('.review-bar').waitFor()
  await page.locator('.cm-deletedChunk').first().waitFor()
  await sleep(800)
  assert.equal(disk('Welcome.md'), before)
  await page.locator('.cm-chunkButtons button[name=accept]').first().click()
  await page.locator('.review-bar').waitFor({ state: 'detached' })
  await sleep(800)
  assert(disk('Welcome.md').includes('Bold claims need evidence.'))
  assert(!disk('Welcome.md').includes('Some **bold**'))
})

await check('suggest mode never edits the file; reject restores the text', async () => {
  await side('Assistant')
  const before = disk('Welcome.md')
  const docBefore = await doc()
  await page.locator('.chat-input textarea').fill('Tighten the intro')
  await page.keyboard.press('Enter')
  await page.locator('.msg.assistant', { hasText: 'Tightened the intro.' }).waitFor()
  const note = await page.locator('.msg.assistant .small').last().innerText()
  assert.match(note, /1 change\(s\) shown/)
  assert.match(note, /1 edit\(s\) skipped/)
  await page.locator('.review-bar').waitFor()
  await sleep(800)
  assert.equal(disk('Welcome.md'), before)
  await page.locator('.review-bar button', { hasText: 'Reject remaining' }).click()
  await page.locator('.review-bar').waitFor({ state: 'detached' })
  assert.equal(await doc(), docBefore)
  await sleep(800)
  assert.equal(disk('Welcome.md'), before)
})

await check('write mode streams into the editor, locks typing, and is one undo step', async () => {
  await page.locator('.mode-toggle button', { hasText: 'Write' }).click()
  const original = await doc()
  await page.locator('.cm-line', { hasText: 'Typed' }).count()
  await page.evaluate(() => { const v = window.wcView(); const i = v.state.doc.toString().indexOf('Bold claims'); v.dispatch({ selection: { anchor: i } }) })
  await page.locator('.chat-input textarea').fill('Make it punchier')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('.cm-content').innerText.includes('Rewritten'))
  const midway = await doc()
  assert(!midway.includes('by Claude.'), 'should see partial output while streaming')
  await page.locator('.cm-content').click()
  await page.keyboard.type('ZZZ')
  assert(!(await doc()).includes('ZZZ'), 'editor must be read-only while writing')
  await page.locator('.msg.assistant', { hasText: 'I rewrote the passage' }).waitFor()
  const after = await doc()
  assert(after.includes('Rewritten passage by Claude.') && !after.includes('Bold claims need evidence.'))
  await sleep(800)
  assert(disk('Welcome.md').includes('Rewritten passage by Claude.'))
  await page.locator('.cm-content').focus()
  await page.keyboard.press('Meta+z')
  assert.equal(await doc(), original)
  await sleep(800)
  assert.equal(disk('Welcome.md'), original)
})

await check('network failure mid-stream: toast, original text restored, file intact', async () => {
  const before = disk('Welcome.md')
  const docBefore = await doc()
  next = (body) => ({ events: textEvents(['Partial '], body.model, { drop: true }), delay: 200 })
  await page.locator('.chat-input textarea').fill('Rewrite again')
  await page.keyboard.press('Enter')
  await page.locator('.toast').first().waitFor({ timeout: 20000 })
  await page.waitForFunction((d) => window.wcView().state.doc.toString() === d, docBefore)
  await sleep(800)
  assert.equal(disk('Welcome.md'), before)
  assert.match(await toast(), /Network error/)
})

await check('API error (500) shows a toast and changes nothing', async () => {
  const before = disk('Welcome.md')
  next = Object.assign(() => ({ status: 500, json: { type: 'error', error: { type: 'api_error', message: 'boom' } } }), { sticky: true })
  await page.locator('.mode-toggle button', { hasText: 'Suggest' }).click()
  await page.locator('.chat-input textarea').fill('Anything')
  await page.keyboard.press('Enter')
  await page.locator('.toast', { hasText: /Claude API error 500/ }).first().waitFor({ timeout: 30000 })
  next = null
  assert.equal(disk('Welcome.md'), before)
})

await app.close()
mock.close()
console.log('Phase 3 e2e: all checks passed')
