// Drives the built app: `npm run build && node test/e2e-phase1.mjs`
import { _electron as electron } from 'playwright'
import { cpSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import assert from 'node:assert/strict'

/** WC_APP=<path to the .app's executable> runs the suite against the packaged app instead of the dev build. */
const target = process.env.WC_APP ? { executablePath: process.env.WC_APP, args: [] } : { args: ['.'] }
import { join } from 'node:path'

const vault = join(import.meta.dirname, '.tmp-vault/')
const userData = join(import.meta.dirname, '.tmp-userdata/')
rmSync(vault, { recursive: true, force: true })
rmSync(userData, { recursive: true, force: true })
cpSync(join(import.meta.dirname, '../test-vault/'), vault, { recursive: true })
const disk = (f) => readFileSync(vault + f, 'utf8')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const launch = () => electron.launch({ ...target, env: { ...process.env, WC_VAULT: vault, WC_HEADLESS: '1', WC_USER_DATA: userData } })

let app = await launch()
let page = await app.firstWindow()
page.on('pageerror', (e) => console.error('pageerror', e))
const check = async (name, fn) => { await fn(); console.log('✔', name) }
const doc = () => page.locator('.cm-content').innerText()

await check('tree lists vault files', async () => {
  await page.getByText('Welcome', { exact: true }).click()
  await page.locator('.cm-content').waitFor()
})

await check('typing autosaves to disk after debounce', async () => {
  await page.locator('.cm-content').click()
  await page.keyboard.press('Meta+ArrowDown')
  await page.keyboard.type('\nTyped in app.')
  await sleep(200)
  assert(!disk('Welcome.md').includes('Typed in app.'), 'saved before debounce')
  await sleep(700)
  assert(disk('Welcome.md').includes('Typed in app.'))
})

await check('external edit reloads in the editor', async () => {
  writeFileSync(vault + 'Welcome.md', disk('Welcome.md') + '\nEdited outside.\n')
  await page.waitForFunction(() => document.querySelector('.cm-content').innerText.includes('Edited outside.'), null, { timeout: 5000 })
})

await check('wikilink autocomplete inserts link', async () => {
  await page.keyboard.press('Meta+ArrowDown')
  await page.keyboard.type('\nSee [[Sec')
  await page.locator('.cm-tooltip-autocomplete').getByText('Second').waitFor()
  await page.keyboard.press('Enter')
  await sleep(800)
  assert(disk('Welcome.md').includes('See [[Second]]'))
})

await check('cmd+click wikilink opens target; backlinks show source', async () => {
  const link = page.locator('.cm-wikilink', { hasText: 'Second' }).first()
  await link.click({ modifiers: ['Meta'] })
  await page.locator('.tab.active', { hasText: 'Second' }).waitFor()
  await page.locator('.side .link-list', { hasText: 'Welcome' }).waitFor()
})

await check('live preview hides markdown off the cursor line', async () => {
  await page.getByText('Welcome', { exact: true }).first().click()
  await page.keyboard.press('Meta+ArrowDown')
  const text = await doc()
  assert(text.includes('Some bold and italic text.'), text)
  assert(!text.includes('# Welcome'))
})

await check('create + rename via IPC stay in vault; escape rejected', async () => {
  const r = await page.evaluate(async () => {
    const out = {}
    try { await window.api.vault.write('../escape.md', 'x'); out.escape = 'allowed' } catch { out.escape = 'rejected' }
    try { await window.api.vault.create('/tmp/abs.md', false); out.abs = 'allowed' } catch { out.abs = 'rejected' }
    out.vaultAfterSet = (await window.api.settings.set({ vault: '/', claudeAuth: 'browser', clawd: false })).vault
    await window.api.vault.create('folder/New.md', false)
    await window.api.vault.move('folder/New.md', 'folder/Renamed.md')
    return out
  })
  assert.equal(r.vaultAfterSet, vault, 'renderer must not be able to move the vault root')
  delete r.vaultAfterSet
  assert.deepEqual(r, { escape: 'rejected', abs: 'rejected' })
  assert.equal(JSON.parse(readFileSync(userData + 'settings.json', 'utf8')).claudeAuth, undefined)
  assert(!existsSync(vault + '../escape.md') && existsSync(vault + 'folder/Renamed.md'))
})

await check('pending edit is flushed when window closes', async () => {
  await page.locator('.cm-content').click()
  await page.keyboard.type(' Last words.')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await app.waitForEvent('close', { timeout: 5000 }).catch(() => {})
  assert(disk('Welcome.md').includes('Last words.'))
})

await check('reopens with saved content after restart', async () => {
  app = await launch()
  page = await app.firstWindow()
  await page.getByText('Welcome', { exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.cm-content')?.innerText.includes('Last words.'))
  await app.close()
})
console.log('Phase 1 e2e: all checks passed')
