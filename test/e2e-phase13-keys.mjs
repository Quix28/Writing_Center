// Headless e2e: ⌘F find in the note (from the editor or elsewhere), ⌃Tab / ⌃⇧Tab to cycle tabs (terminal included).
import { _electron as electron } from 'playwright'
import { chmodSync, cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const target = process.env.WC_APP ? { executablePath: process.env.WC_APP, args: [] } : { args: ['.'] }
const tmp = (n) => join(import.meta.dirname, `.tmp-${n}/`)
for (const n of ['vault', 'userdata', 'bin']) rmSync(tmp(n), { recursive: true, force: true })
cpSync(join(import.meta.dirname, '../test-vault/'), tmp('vault'), { recursive: true })
writeFileSync(tmp('vault') + 'Essay.md', '# Essay\n\nThe cat sat. The cat slept. A dog barked at the cat.\n')
mkdirSync(tmp('bin'))
writeFileSync(tmp('bin') + 'claude', '#!/bin/sh\nprintf "\\033[?2004h"\necho READY\nsleep 60\n')
chmodSync(tmp('bin') + 'claude', 0o755)
const check = async (name, fn) => { await fn(); console.log('✔', name) }

const app = await electron.launch({ ...target, env: { ...process.env, WC_VAULT: tmp('vault'), WC_HEADLESS: '1', WC_USER_DATA: tmp('userdata'), WC_CLAUDE_BIN: tmp('bin') + 'claude' } })
const page = await app.firstWindow()
page.on('pageerror', (e) => console.error('pageerror', e))
const activeTab = () => page.locator('.tab.active:not(.view-tab)').innerText()

await check('⌘F opens find in the note and highlights every match', async () => {
  await page.locator('.tree-row', { hasText: 'Essay' }).click()
  await page.locator('.cm-content').click()
  await page.keyboard.press('Meta+f')
  await page.locator('.cm-search input[name=search]').waitFor()
  await page.keyboard.type('cat')
  await page.waitForFunction(() => document.querySelectorAll('.cm-searchMatch').length === 3)
  await page.keyboard.press('Enter')
  await page.locator('.cm-searchMatch-selected').waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.cm-search').waitFor({ state: 'detached' })
})

await check('⌘F also works when the focus is outside the editor', async () => {
  await page.locator('.ribbon [aria-label="Backlinks"]').click()
  await page.keyboard.press('Meta+f')
  await page.locator('.cm-search input[name=search]').waitFor()
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('name')), 'search')
  await page.keyboard.press('Escape')
})

await check('⌃Tab / ⌃⇧Tab cycle through open tabs and wrap around', async () => {
  for (const n of ['Welcome', 'Second']) await page.locator('.tree-row', { hasText: n }).first().click()
  assert.equal(await activeTab(), 'Second')
  await page.keyboard.press('Control+Tab')
  assert.equal(await activeTab(), 'Essay')
  await page.keyboard.press('Control+Tab')
  assert.equal(await activeTab(), 'Welcome')
  await page.keyboard.press('Control+Shift+Tab')
  assert.equal(await activeTab(), 'Essay')
})

await check('⌃Tab works from inside the Claude Code terminal too', async () => {
  await page.locator('.ribbon [aria-label="Claude Code"]').click()
  await page.waitForFunction(() => document.querySelector('.claude-term .xterm-rows')?.innerText.includes('READY'))
  await page.locator('.claude-term .xterm').click()
  await page.keyboard.press('Control+Tab')
  assert.equal(await activeTab(), 'Welcome')
})

await app.close()
for (const n of ['vault', 'userdata', 'bin']) rmSync(tmp(n), { recursive: true, force: true })
console.log('Keys e2e: all checks passed')
