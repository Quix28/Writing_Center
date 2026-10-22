// Headless e2e for Google Docs sync against a local mock: `npm run build && node test/e2e-phase5.mjs`
import { _electron as electron } from 'playwright'
import { cpSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'

/** WC_APP=<path to the .app's executable> runs the suite against the packaged app instead of the dev build. */
const target = process.env.WC_APP ? { executablePath: process.env.WC_APP, args: [] } : { args: ['.'] }
import { startGoogleMock } from './mock-google.mjs'

const vault = join(import.meta.dirname, '.tmp-vault/')
const userData = join(import.meta.dirname, '.tmp-userdata/')
rmSync(vault, { recursive: true, force: true })
rmSync(userData, { recursive: true, force: true })
cpSync(join(import.meta.dirname, '../test-vault/'), vault, { recursive: true })
const disk = (f) => readFileSync(vault + f, 'utf8')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const check = async (name, fn) => { await fn(); console.log('✔', name) }
const fm = (md, key) => /^---\n([\s\S]*?)\n---/.exec(md)?.[1].match(new RegExp(`^${key}: "?(.*?)"?$`, 'm'))?.[1]
const body = (md) => md.replace(/^---\n[\s\S]*?\n---\n/, '')

const g = await startGoogleMock()
const app = await electron.launch({ ...target, env: { ...process.env, WC_VAULT: vault, WC_HEADLESS: '1', WC_USER_DATA: userData, WC_GOOGLE_API_ROOT: g.url, WC_GOOGLE_TEST_TOKEN: 'test-token' } })
const page = await app.firstWindow()
page.on('pageerror', (e) => console.error('pageerror', e))
const command = async (label) => {
  await page.locator('.cm-content').focus()
  await page.keyboard.press('Meta+p')
  await page.keyboard.type(label)
  await page.keyboard.press('Enter')
}
const okToast = (text) => page.locator('.toast.ok', { hasText: text }).last().waitFor()
const typeAtEnd = async (text) => { await page.locator('.cm-content').focus(); await page.keyboard.press('Meta+ArrowDown'); await page.keyboard.type(text); await sleep(800) }
const dialog = page.locator('.modal.conflict')
let id

await check('link to a new doc: creates it, pushes headings/bold/italic/links, stores gdoc_id', async () => {
  await page.locator('.tree-row', { hasText: 'Welcome' }).click()
  await page.locator('.cm-content').waitFor()
  await command('link to a new doc')
  await okToast('Pushed')
  await sleep(800)
  const md = disk('Welcome.md')
  id = fm(md, 'gdoc_id')
  assert.equal(id, 'doc1')
  assert.equal(g.docs.get(id).name, 'Welcome')
  assert.equal(fm(md, 'gdoc_synced_at'), g.docs.get(id).modifiedTime)
  assert.match(fm(md, 'gdoc_hash'), /^[0-9a-f]{16}$/)
  const reqs = g.docs.get(id).lastRequests
  assert(!reqs[0].deleteContentRange, 'empty doc needs no delete')
  assert(!reqs[0].insertText.text.includes('gdoc_id'), 'frontmatter is not pushed')
  assert(reqs.some((r) => r.updateParagraphStyle?.paragraphStyle.namedStyleType === 'HEADING_1'))
  assert(reqs.some((r) => r.updateTextStyle?.textStyle.bold) && reqs.some((r) => r.updateTextStyle?.textStyle.italic))
  assert(g.calls.every((c) => c.auth === 'Bearer test-token'))
})

await check('push with only local changes goes straight through, sending only the change', async () => {
  await typeAtEnd('\nLocal edit one.')
  await command('push note')
  await okToast('Pushed')
  assert(g.docs.get(id).markdown.includes('Local edit one.'))
  const reqs = g.docs.get(id).lastRequests
  assert(!reqs.some((r) => r.deleteContentRange), 'nothing already in the Doc is deleted')
  assert.equal(reqs.filter((r) => r.insertText).map((r) => r.insertText.text).join('').trim(), 'Local edit one.')
  await sleep(800)
  assert.equal(fm(disk('Welcome.md'), 'gdoc_synced_at'), g.docs.get(id).modifiedTime)
})

await check('pull with only remote changes replaces the body and keeps frontmatter', async () => {
  g.editRemote(id, '# Welcome\n\nEdited in Google Docs.\n')
  await command('pull doc')
  await okToast('Pulled')
  await sleep(800)
  const md = disk('Welcome.md')
  assert.equal(body(md), '# Welcome\n\nEdited in Google Docs.\n')
  assert.equal(fm(md, 'gdoc_id'), id)
  assert.equal(fm(md, 'gdoc_synced_at'), g.docs.get(id).modifiedTime)
})

await check('remote-only change + Push: diff shown instead of overwriting the Doc', async () => {
  g.editRemote(id, '# Welcome\n\nSomeone else wrote this.\n')
  const pushes = g.calls.filter((c) => c.path.endsWith(':batchUpdate')).length
  await command('push note')
  await dialog.waitFor()
  assert.match(await dialog.innerText(), /Google Doc changed since the last sync/)
  await dialog.locator('button', { hasText: 'Cancel' }).click()
  await sleep(300)
  assert.equal(g.calls.filter((c) => c.path.endsWith(':batchUpdate')).length, pushes)
  assert.equal(g.docs.get(id).markdown, '# Welcome\n\nSomeone else wrote this.\n')
})

await check('both changed: side-by-side diff; Cancel changes nothing on either side', async () => {
  await typeAtEnd('\nMy local paragraph.')
  const before = disk('Welcome.md')
  await command('pull doc')
  await dialog.waitFor()
  assert.match(await dialog.innerText(), /Both this note and the Google Doc changed/)
  assert.equal(await dialog.locator('.cm-mergeView .cm-editor').count(), 2)
  assert(await dialog.innerText().then((t) => t.includes('Someone else wrote this.') && t.includes('My local paragraph.')))
  await dialog.locator('button', { hasText: 'Cancel' }).click()
  await sleep(800)
  assert.equal(disk('Welcome.md'), before)
  assert.equal(g.docs.get(id).markdown, '# Welcome\n\nSomeone else wrote this.\n')
})

await check('both changed: "Keep this note" pushes the note over the Doc', async () => {
  await command('push note')
  await dialog.waitFor()
  await dialog.locator('button', { hasText: 'Keep this note' }).click()
  await okToast('Pushed')
  assert(g.docs.get(id).markdown.includes('My local paragraph.'))
  assert(!g.docs.get(id).markdown.includes('Someone else'))
})

await check('local-only change + Pull: diff shown; "Keep Google Doc" replaces the note', async () => {
  await typeAtEnd('\nUnpushed local line.')
  await command('pull doc')
  await dialog.waitFor()
  assert.match(await dialog.innerText(), /This note changed since the last sync/)
  await dialog.locator('button', { hasText: 'Keep Google Doc' }).click()
  await okToast('Pulled')
  await sleep(800)
  assert(!disk('Welcome.md').includes('Unpushed local line.'))
})

await check('network failure during push: toast, note and sync metadata untouched', async () => {
  await typeAtEnd('\nWill fail to push.')
  const before = disk('Welcome.md')
  const remoteBefore = g.docs.get(id).markdown
  g.failOn(/:batchUpdate$/, true)
  await command('push note')
  await page.locator('.toast.error').last().waitFor()
  g.failOn(null)
  await sleep(800)
  assert.equal(disk('Welcome.md'), before)
  assert.equal(g.docs.get(id).markdown, remoteBefore)
  console.log('  toast:', await page.locator('.toast.error').last().innerText())
})

await check('API error during pull: toast, note untouched', async () => {
  const before = disk('Welcome.md')
  g.failOn(/\/export$/)
  await command('pull doc')
  await page.locator('.toast.error', { hasText: /Google API error 500/ }).last().waitFor({ timeout: 30000 })
  g.failOn(null)
  await sleep(800)
  assert.equal(disk('Welcome.md'), before)
})

await check('link to an existing doc: picker lists Docs, first sync asks which version to keep', async () => {
  await page.locator('.tree-row', { hasText: 'Second' }).click()
  await page.locator('.cm-content').waitFor()
  await command('link to an existing doc')
  await page.locator('.palette li', { hasText: 'Welcome' }).click()
  await dialog.waitFor()
  assert.match(await dialog.innerText(), /First sync/)
  await dialog.locator('button', { hasText: 'Keep Google Doc' }).click()
  await okToast('Pulled')
  await sleep(800)
  assert.equal(fm(disk('Second.md'), 'gdoc_id'), id)
})

await app.close()
g.close()
console.log('Phase 5 e2e: all checks passed')
