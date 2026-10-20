// Headless e2e for the Connections sheet: `npm run build && node test/e2e-phase6-connections.mjs`
import { _electron as electron } from 'playwright'
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { startMock } from './mock-claude.mjs'

const target = process.env.WC_APP ? { executablePath: process.env.WC_APP, args: [] } : { args: ['.'] }
const tmp = (n) => join(import.meta.dirname, `.tmp-${n}/`)
for (const n of ['vault', 'userdata', 'bin']) rmSync(tmp(n), { recursive: true, force: true })
cpSync(join(import.meta.dirname, '../test-vault/'), tmp('vault'), { recursive: true })
mkdirSync(tmp('bin'))
// Stand-in for Anthropic's CLI: records its arguments instead of opening a browser.
writeFileSync(tmp('bin') + 'ant', `#!/bin/sh\necho "$@" >> "${tmp('bin')}calls.txt"\nexit 0\n`)
chmodSync(tmp('bin') + 'ant', 0o755)
const check = async (name, fn) => { await fn(); console.log('✔', name) }

const mock = await startMock(() => ({ events: [] }))
const env = { ...process.env, WC_VAULT: tmp('vault'), WC_HEADLESS: '1', WC_USER_DATA: tmp('userdata'), ANTHROPIC_BASE_URL: mock.url, PATH: `${tmp('bin')}:${process.env.PATH}` }
delete env.ANTHROPIC_API_KEY
delete env.ANTHROPIC_AUTH_TOKEN
const app = await electron.launch({ ...target, env })
const page = await app.firstWindow()
page.on('pageerror', (e) => console.error('pageerror', e))
const sheet = page.locator('.sheet')
const claude = sheet.locator('.service').nth(0)
const google = sheet.locator('.service').nth(1)

await check('status bar shows both services disconnected and opens Connections', async () => {
  await page.locator('.statusbar', { hasText: 'Claude: not connected' }).waitFor()
  await page.locator('.statusbar', { hasText: 'Google Docs: not connected' }).waitFor()
  await page.locator('.statusbar button').first().click()
  await sheet.waitFor()
  await claude.locator('.pill', { hasText: 'Not connected' }).waitFor()
  await google.locator('.pill', { hasText: 'Not set up' }).waitFor()
})

await check('a pasted placeholder key is rejected with a clear message', async () => {
  await claude.locator('summary').click()
  await claude.locator('input[type=password]').fill('…')
  await claude.locator('button', { hasText: 'Save key' }).click()
  await claude.locator('.error-text', { hasText: 'characters a real key never has' }).waitFor()
})

await check('a real-looking key connects, is stored encrypted, and lights the status bar', async () => {
  await claude.locator('input[type=password]').fill('sk-ant-test-key')
  await claude.locator('button', { hasText: 'Save key' }).click()
  await claude.locator('.pill', { hasText: 'Connected with your API key' }).waitFor()
  await claude.locator('text=2 models available').waitFor()
  assert(!readFileSync(tmp('userdata') + 'secrets.bin').toString('latin1').includes('sk-ant-test-key'), 'key must not be stored in plain text')
  await page.locator('.statusbar .dot.ok').first().waitFor()
})

await check('disconnect forgets the key', async () => {
  await claude.locator('button', { hasText: 'Disconnect' }).click()
  await claude.locator('.pill', { hasText: 'Not connected' }).waitFor()
})

await check('browser sign-in runs `ant auth login` into the app\'s own profile', async () => {
  if (!(await claude.locator('details').evaluate((d) => d.open))) await claude.locator('summary').click()
  await claude.locator('button', { hasText: 'Sign in with browser' }).click()
  await claude.locator('.pill', { hasText: /Connected with browser sign-in|Connection failed/ }).waitFor()
  assert.equal(readFileSync(tmp('bin') + 'calls.txt', 'utf8').trim(), 'auth login --profile writing-centre')
})

await check('Google client is saved; a "…" client ID is rejected', async () => {
  await google.locator('input').first().fill('…')
  await google.locator('button', { hasText: 'Save client' }).click()
  await google.locator('.error-text', { hasText: 'characters a real key never has' }).waitFor()
  await google.locator('input').first().fill('1234-abc.apps.googleusercontent.com')
  await google.locator('input[type=password]').fill('GOCSPX-test')
  await google.locator('button', { hasText: 'Save client' }).click()
  await google.locator('.pill', { hasText: 'Not signed in' }).waitFor()
  await google.locator('button', { hasText: 'Sign in with Google' }).waitFor()
})

await app.close()
mock.close()
for (const n of ['bin']) rmSync(tmp(n), { recursive: true, force: true })
console.log('Connections e2e: all checks passed')
