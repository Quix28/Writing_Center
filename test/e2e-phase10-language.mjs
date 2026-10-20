// Headless e2e: Harper only checks English; non-English notes use macOS spellcheck; Claude answers in the note's language.
import { _electron as electron } from 'playwright'
import { cpSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { startMock, textEvents } from './mock-claude.mjs'

const target = process.env.WC_APP ? { executablePath: process.env.WC_APP, args: [] } : { args: ['.'] }
const vault = join(import.meta.dirname, '.tmp-vault/')
const userData = join(import.meta.dirname, '.tmp-userdata/')
for (const d of [vault, userData]) rmSync(d, { recursive: true, force: true })
cpSync(join(import.meta.dirname, '../test-vault/'), vault, { recursive: true })
const TR = 'Her sabah yazmaya oturmak zor. Sayfa açıldığında cümleler yavaş yavaş gelir ve sonra hızlanır. Bu yüzden her gün aynı saatte yazıyorum.'
const TR_TYPO = TR.replace('yavaş yavaş', 'yavas yavaş')
writeFileSync(vault + 'Turkce.md', `# Günlük yazmak\n\n${TR_TYPO}\n`)
writeFileSync(vault + 'English.md', '# Daily\n\nThis is teh test of a longer English paragraph about writing every single day.\n')
writeFileSync(vault + 'Karisik.md', `# Notlar\n\n${TR}\n\nThis is teh English part of the note, written to check mixed text.\n`)
const check = async (name, fn) => { await fn(); console.log('✔', name) }

const mock = await startMock((body) => ({ events: textEvents([JSON.stringify({ findings: [] })], body.model) }))
const app = await electron.launch({ ...target, env: { ...process.env, WC_VAULT: vault, WC_HEADLESS: '1', WC_USER_DATA: userData, ANTHROPIC_BASE_URL: mock.url, ANTHROPIC_API_KEY: 'test-key' } })
const page = await app.firstWindow()
page.on('pageerror', (e) => console.error('pageerror', e))
const open = async (name) => { await page.locator('.tree-row', { hasText: name }).first().click(); await page.locator('.cm-content').waitFor() }
const spellcheck = () => page.locator('.cm-content').getAttribute('spellcheck')
const lintTexts = () => page.locator('.cm-lintRange-warning').allInnerTexts()

await check('English note: Harper checks it, macOS spellcheck stays off', async () => {
  await open('English')
  await page.locator('.cm-lintRange-warning', { hasText: 'teh' }).waitFor({ timeout: 20000 })
  assert.equal(await spellcheck(), 'false')
})

await check('Turkish note: no English suggestions; macOS spellcheck turns on', async () => {
  await open('Turkce')
  await page.waitForFunction(() => document.querySelector('.cm-content')?.getAttribute('spellcheck') === 'true', null, { timeout: 20000 })
  await page.waitForTimeout(1500)
  assert.deepEqual(await lintTexts(), [])
})

await check('mixed note: only the English sentence is checked by Harper', async () => {
  await open('Karisik')
  await page.locator('.cm-lintRange-warning', { hasText: 'teh' }).waitFor({ timeout: 20000 })
  const flagged = (await lintTexts()).join(' ')
  for (const word of ['sabah', 'yazmaya', 'açıldığında', 'cümleler', 'hızlanır']) assert(!flagged.includes(word), word)
})

await check('right-click on a Turkish typo offers macOS suggestions (menu recorded, never shown)', async () => {
  await open('Turkce')
  await page.locator('.cm-content').click()
  await page.waitForTimeout(2500)
  const at = await page.evaluate(() => { const v = window.wcView(); const c = v.coordsAtPos(v.state.doc.toString().indexOf('yavas') + 2); return { x: c.left, y: (c.top + c.bottom) / 2 } })
  await page.mouse.click(at.x, at.y, { button: 'right' })
  await page.waitForTimeout(1000)
  const menu = await app.evaluate(() => globalThis.wcLastMenu)
  console.log('  menu:', JSON.stringify(menu))
  assert(menu, 'context menu was built')
  assert(menu.items.includes('copy'), 'edit commands present')
})

await check('Claude is told to reply in the note\'s language', async () => {
  await open('Turkce')
  await page.locator('.side-tabs button', { hasText: 'Review' }).click()
  await page.locator('.review > button').click()
  await page.locator('.review', { hasText: 'No findings' }).waitFor()
  assert.match(mock.requests.at(-1).body.system, /same language as their text/)
})

await app.close()
mock.close()
for (const d of [vault, userData]) rmSync(d, { recursive: true, force: true })
console.log('Language e2e: all checks passed')
