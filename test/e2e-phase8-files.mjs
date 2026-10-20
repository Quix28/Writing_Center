// Headless e2e: every vault file is listed and common types open (PDF, images, .docx, .pptx).
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const target = process.env.WC_APP ? { executablePath: process.env.WC_APP, args: [] } : { args: ['.'] }
const vault = join(import.meta.dirname, '.tmp-vault/')
const userData = join(import.meta.dirname, '.tmp-userdata/')
const work = join(import.meta.dirname, '.tmp-work/')
for (const d of [vault, userData, work]) rmSync(d, { recursive: true, force: true })
cpSync(join(import.meta.dirname, '../test-vault/'), vault, { recursive: true })
mkdirSync(work)
const check = async (name, fn) => { await fn(); console.log('✔', name) }

// Real files made with macOS tools: textutil (.docx), cupsfilter (PDF), zip (.pptx), and a 1-pixel PNG.
writeFileSync(work + 'doc.html', '<h1>Quarterly letter</h1><p>Dear readers, <b>bold news</b> today.</p>')
execFileSync('/usr/bin/textutil', ['-convert', 'docx', work + 'doc.html', '-output', vault + 'Letter.docx'])
writeFileSync(work + 'a.txt', 'Hello PDF world')
writeFileSync(vault + 'Report.pdf', execFileSync('/usr/sbin/cupsfilter', [work + 'a.txt'], { stdio: ['ignore', 'pipe', 'ignore'] }))
writeFileSync(vault + 'pixel.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
mkdirSync(work + 'ppt/ppt/slides', { recursive: true })
const slide = (title, body) => `<p:sld xmlns:a="a" xmlns:p="p"><a:p><a:r><a:t>${title}</a:t></a:r></a:p><a:p><a:r><a:t>${body}</a:t></a:r></a:p></p:sld>`
writeFileSync(work + 'ppt/ppt/slides/slide1.xml', slide('Opening', 'Why we write'))
writeFileSync(work + 'ppt/ppt/slides/slide2.xml', slide('Method', 'Tom &amp; Jerry'))
execFileSync('/usr/bin/zip', ['-qr', vault + 'Talk.pptx', 'ppt'], { cwd: work + 'ppt' })
writeFileSync(vault + 'data.xyz', 'unknown')

const app = await electron.launch({ ...target, env: { ...process.env, WC_VAULT: vault, WC_HEADLESS: '1', WC_USER_DATA: userData } })
const page = await app.firstWindow()
page.on('pageerror', (e) => console.error('pageerror', e))
const open = (name) => page.locator('.tree-row', { hasText: name }).first().click()

await check('tree lists every file type', async () => {
  for (const n of ['Letter.docx', 'Report.pdf', 'pixel.png', 'Talk.pptx', 'data.xyz', 'Welcome']) await page.locator('.tree-row', { hasText: n }).first().waitFor()
})

await check('image renders from the vault protocol', async () => {
  await open('pixel.png')
  await page.waitForFunction(() => document.querySelector('.viewer-image')?.naturalWidth === 1)
})

await check('PDF opens in the built-in viewer', async () => {
  await open('Report.pdf')
  const frame = page.locator('.viewer-frame')
  await frame.waitFor()
  assert.match(await frame.getAttribute('src'), /^vault:\/\/f\/Report\.pdf$/)
  const type = await app.evaluate(async ({ net }) => (await net.fetch('vault://f/Report.pdf')).headers.get('content-type'))
  assert.match(type ?? '', /pdf/)
  await page.waitForTimeout(1500)
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT })
})

await check('.docx converts to formatted text in a sandboxed frame', async () => {
  await open('Letter.docx')
  const frame = page.frameLocator('.viewer-frame.paper')
  await frame.locator('text=Quarterly letter').waitFor()
  await frame.locator('b', { hasText: 'bold news' }).waitFor()
  assert.equal(await page.locator('.viewer-frame.paper').getAttribute('sandbox'), '')
})

await check('.pptx shows slide-by-slide text', async () => {
  await open('Talk.pptx')
  await page.locator('.slide-card', { hasText: 'Opening' }).waitFor()
  assert.equal(await page.locator('.slide-card').count(), 2)
  await page.locator('.slide-card', { hasText: 'Tom & Jerry' }).waitFor()
})

await check('unknown types offer the default app; vault protocol refuses paths outside the vault', async () => {
  await open('data.xyz')
  await page.locator('.viewer .empty button', { hasText: 'Open in default app' }).waitFor()
  for (const url of ['vault://f/..%2F..%2F..%2Fetc%2Fpasswd', 'vault://f/%2Fetc%2Fpasswd'])
    assert.equal(await app.evaluate(async ({ net }, u) => (await net.fetch(u)).status, url), 404, url)
})

await app.close()
for (const d of [vault, userData, work]) rmSync(d, { recursive: true, force: true })
console.log('Files e2e: all checks passed')
