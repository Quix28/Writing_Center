// Headless e2e: link a note to ONE tab of a tabbed Google Doc; push/pull touch only that tab (mock Google).
import { _electron as electron } from 'playwright'
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { startGoogleMock } from './mock-google.mjs'

const target = process.env.WC_APP ? { executablePath: process.env.WC_APP, args: [] } : { args: ['.'] }
const vault = join(import.meta.dirname, '.tmp-vault/')
const userData = join(import.meta.dirname, '.tmp-userdata/')
for (const d of [vault, userData]) rmSync(d, { recursive: true, force: true })
cpSync(join(import.meta.dirname, '../test-vault/'), vault, { recursive: true })
writeFileSync(vault + 'Essay.md', '')
writeFileSync(vault + 'Whole.md', '---\ngdoc_id: "uni"\n---\nWhole doc link.\n')
const disk = (f) => readFileSync(vault + f, 'utf8')
const fm = (md, key) => /^---\n([\s\S]*?)\n---/.exec(md)?.[1].match(new RegExp(`^${key}: "?(.*?)"?$`, 'm'))?.[1]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const check = async (name, fn) => { await fn(); console.log('✔', name) }

const g = await startGoogleMock()
g.docs.set('uni', {
  name: 'Çağlar Uni App', markdown: 'ALL TABS EXPORT', modifiedTime: '2026-10-21T10:00:00.000Z',
  tabs: [
    { id: 't.instr', title: 'Instructions', paras: [{ text: 'How to use this document', style: 'HEADING_1' }, { text: 'Make a copy first.', style: 'NORMAL_TEXT' }] },
    { id: 't.essay', title: 'US Personal Essay', paras: [{ text: 'Right was on the fader.', style: 'NORMAL_TEXT' }], children: [{ id: 't.screw', title: 'Screwdriver', paras: [{ text: 'Draft two.', style: 'NORMAL_TEXT' }] }] }
  ]
})
const app = await electron.launch({ ...target, env: { ...process.env, WC_VAULT: vault, WC_HEADLESS: '1', WC_USER_DATA: userData, WC_GOOGLE_API_ROOT: g.url, WC_GOOGLE_TEST_TOKEN: 't' } })
const page = await app.firstWindow()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))
const command = async (label) => { await page.locator('.cm-content').focus(); await page.keyboard.press('Meta+p'); await page.keyboard.type(label); await page.keyboard.press('Enter') }
const ok = (text) => page.locator('.toast.ok', { hasText: text }).last().waitFor()
const typeAtEnd = async (t) => { await page.locator('.cm-content').focus(); await page.keyboard.press('Meta+ArrowDown'); await page.keyboard.type(t); await sleep(800) }

await check('linking a tabbed Doc asks which tab, and pulls only that tab', async () => {
  await page.locator('.tree-row', { hasText: 'Essay' }).click()
  await command('link to an existing doc')
  await page.locator('.palette li', { hasText: 'Çağlar Uni App' }).click()
  const picker = page.locator('.tab-list')
  await picker.waitFor()
  assert.deepEqual(await picker.locator('li').allInnerTexts(), ['Instructions', 'US Personal Essay', 'Screwdriver'])
  await picker.locator('li', { hasText: 'US Personal Essay' }).click()
  await ok('Pulled')
  await sleep(800)
  const md = disk('Essay.md')
  assert.equal(fm(md, 'gdoc_tab'), 't.essay')
  assert.equal(fm(md, 'gdoc_tab_title'), 'US Personal Essay')
  assert(md.includes('Right was on the fader.') && !md.includes('Make a copy first') && !md.includes('Draft two'), 'only the chosen tab')
})

await check('push replaces only that tab; every request targets it', async () => {
  await typeAtEnd('\n\nNew paragraph from the app.')
  await command('push note')
  await ok('Pushed')
  assert.match(g.tabText('uni', 't.essay'), /New paragraph from the app\./)
  assert.equal(g.tabText('uni', 't.instr'), 'How to use this document\nMake a copy first.')
  const reqs = g.calls.filter((c) => c.path.endsWith(':batchUpdate')).at(-1).body.requests
  for (const r of reqs) assert.equal((Object.values(r)[0].location ?? Object.values(r)[0].range).tabId, 't.essay')
})

await check('an edit in ANOTHER tab is not a conflict for this note', async () => {
  g.editTab('uni', 't.instr', [{ text: 'Instructions were edited by someone.', style: 'NORMAL_TEXT' }])
  await typeAtEnd(' More.')
  await command('push note')
  await ok('Pushed')
  assert.equal(await page.locator('.modal.conflict').count(), 0)
})

await check('an edit in THIS tab is pulled in, or shown as a conflict', async () => {
  g.editTab('uni', 't.essay', [{ text: 'Edited in Google Docs.', style: 'NORMAL_TEXT' }])
  await command('pull doc')
  await ok('Pulled')
  await sleep(800)
  assert(disk('Essay.md').includes('Edited in Google Docs.'))
  g.editTab('uni', 't.essay', [{ text: 'Edited again in Google.', style: 'NORMAL_TEXT' }])
  await command('push note')
  await page.locator('.modal.conflict', { hasText: 'Google Doc changed' }).waitFor()
  await page.locator('.modal.conflict button', { hasText: 'Cancel' }).click()
})

await check('comments: this tab\'s comments are listed and highlighted; other tabs and resolved ones are not', async () => {
  const doc = g.docs.get('uni')
  doc.comments = [
    { id: 'c1', content: 'hata yapmaktan korkmamak', createdTime: '2026-10-19T11:50:00Z', resolved: false, author: { displayName: 'Çağlar Ayyıldız' }, quotedFileContent: { value: 'Edited again in Google' }, replies: [{ content: 'Good point', createdTime: '2026-10-19T12:00:00Z', author: { displayName: 'Mentor' } }] },
    { id: 'c2', content: 'on another tab', createdTime: '2026-10-19T11:51:00Z', resolved: false, author: { displayName: 'X' }, quotedFileContent: { value: 'Instructions were edited by someone' } },
    { id: 'c3', content: 'already fixed', createdTime: '2026-10-19T11:52:00Z', resolved: true, author: { displayName: 'Y' }, quotedFileContent: { value: 'Edited again' } }
  ]
  await page.locator('.tree-row', { hasText: 'Essay' }).click()
  await command('pull doc')
  await ok('Pulled')
  await sleep(800)
  await page.locator('.ribbon [aria-label="Comments"]').click()
  await page.locator('.gcomment').first().waitFor()
  assert.equal(await page.locator('.gcomment').count(), 1)
  const card = await page.locator('.gcomment').innerText()
  assert(card.includes('hata yapmaktan korkmamak') && card.includes('Good point'))
  assert.match(await page.locator('.comments').innerText(), /1 other comment\(s\) in this Doc are on other tabs/)
  await page.locator('.cm-gcomment', { hasText: 'Edited again in Google' }).waitFor({ state: 'attached' })
  await page.locator('.comments-bar input[type=checkbox]').check()
  assert.equal(await page.locator('.gcomment').count(), 2)
  assert(!disk('Essay.md').includes('hata yapmaktan'), 'comments are never written into the note')
})

await check('a whole-document link on a tabbed Doc is refused, never mixing tabs', async () => {
  await page.locator('.tree-row', { hasText: 'Whole' }).click()
  await page.locator('.cm-content').waitFor()
  const instr = g.tabText('uni', 't.instr')
  await command('push note')
  await page.locator('.toast.error', { hasText: 'several tabs' }).waitFor()
  assert.equal(g.tabText('uni', 't.instr'), instr)
})

assert.deepEqual(pageErrors, [], 'no errors in the window')
await app.close()
g.close()
for (const d of [vault, userData]) rmSync(d, { recursive: true, force: true })
console.log('Google Docs tabs e2e: all checks passed')
