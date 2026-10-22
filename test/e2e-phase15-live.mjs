// Headless e2e: Google Docs live sync against the mock — Doc edits flow into the note, note edits flow out after a
// typing pause, and edits on both sides at once open the side-by-side dialog instead of overwriting anything.
import { _electron as electron } from 'playwright'
import { cpSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { startGoogleMock } from './mock-google.mjs'

const target = process.env.WC_APP ? { executablePath: process.env.WC_APP, args: [] } : { args: ['.'] }
const vault = join(import.meta.dirname, '.tmp-vault/')
const userData = join(import.meta.dirname, '.tmp-userdata/')
for (const d of [vault, userData]) rmSync(d, { recursive: true, force: true })
cpSync(join(import.meta.dirname, '../test-vault/'), vault, { recursive: true })
const disk = (f) => readFileSync(vault + f, 'utf8')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const check = async (name, fn) => { await fn(); console.log('✔', name) }
const until = async (what, fn, ms = 10000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) if (fn()) return
  assert.fail(`timed out waiting for ${what}`)
}

const g = await startGoogleMock()
const app = await electron.launch({ ...target, env: { ...process.env, WC_VAULT: vault, WC_HEADLESS: '1', WC_USER_DATA: userData, WC_GOOGLE_API_ROOT: g.url, WC_GOOGLE_TEST_TOKEN: 't' } })
const page = await app.firstWindow()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))
const command = async (label) => { await page.locator('.cm-content').focus(); await page.keyboard.press('Meta+p'); await page.keyboard.type(label); await page.keyboard.press('Enter') }
const typeAtEnd = async (t) => { await page.locator('.cm-content').focus(); await page.keyboard.press('Meta+ArrowDown'); await page.keyboard.type(t) }
const badge = page.locator('.statusbar button', { hasText: 'Live sync' })
let id

await check('live sync turns on from the palette and shows in the status bar', async () => {
  await page.locator('.tree-row', { hasText: 'Welcome' }).click()
  await command('link to a new doc')
  await page.locator('.toast.ok', { hasText: 'Pushed' }).waitFor()
  await until('the link saved', () => /gdoc_id: "doc/.test(disk('Welcome.md')))
  id = /gdoc_id: "(.*)"/.exec(disk('Welcome.md'))?.[1]
  assert(id)
  await command('turn live sync on')
  await badge.waitFor()
})

await check('an edit in the Google Doc appears in the note; untouched paragraphs keep their wikilinks', async () => {
  g.editRemote(id, g.docs.get(id).markdown.replace('Some **bold**', 'Some remote **bold**'))
  await until('the Doc edit in the note', () => disk('Welcome.md').includes('Some remote **bold**'))
  assert(disk('Welcome.md').includes('[[Second]]'), 'the unchanged paragraph keeps its [[wikilink]]')
})

await check('typing in the note reaches the Doc after a short pause', async () => {
  await typeAtEnd(' Typed in the app.')
  await until('the note edit in the Doc', () => g.docs.get(id).markdown.includes('Typed in the app.'))
  assert(g.docs.get(id).markdown.includes('Some remote'), 'the earlier Doc edit is still there')
})

await check('edits on both sides at once open the dialog; Cancel pauses live sync and changes nothing', async () => {
  await typeAtEnd(' Local words.')
  await sleep(300)
  const remote = g.docs.get(id).markdown.replace('# Welcome', '# Welcome back')
  g.editRemote(id, remote)
  const dialog = page.locator('.modal.conflict', { hasText: 'both edited at the same time' })
  await dialog.waitFor({ timeout: 10000 })
  await dialog.locator('button', { hasText: 'Cancel' }).click()
  await page.locator('.toast', { hasText: 'Live sync is paused' }).waitFor()
  assert.equal(await badge.count(), 0)
  await sleep(2500)
  assert.equal(g.docs.get(id).markdown, remote, 'the Doc was not overwritten')
  assert(!disk('Welcome.md').includes('Welcome back'), 'the note was not overwritten')
})

assert.deepEqual(pageErrors, [], 'no errors in the window')
await app.close()
g.close()
for (const d of [vault, userData]) rmSync(d, { recursive: true, force: true })
console.log('Google Docs live sync e2e: all checks passed')
