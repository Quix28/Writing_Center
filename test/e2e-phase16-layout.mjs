// Headless e2e: the left view bar and the drag-and-drop pane layout — four notes side by side, Claude Code docked
// under one of them, moved without restarting, resized, and restored after a restart.
import { _electron as electron } from 'playwright'
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const target = process.env.WC_APP ? { executablePath: process.env.WC_APP, args: [] } : { args: ['.'] }
const tmp = (n) => join(import.meta.dirname, `.tmp-${n}/`)
for (const n of ['vault', 'userdata', 'bin']) rmSync(tmp(n), { recursive: true, force: true })
cpSync(join(import.meta.dirname, '../test-vault/'), tmp('vault'), { recursive: true })
writeFileSync(tmp('vault') + 'Essay.md', '# Essay\n\nA short essay.\n')
mkdirSync(tmp('bin'))
writeFileSync(tmp('bin') + 'claude', '#!/bin/sh\nprintf "\\033[?2004h"\necho READY\nwhile read l; do echo "got: $l"; done\n')
chmodSync(tmp('bin') + 'claude', 0o755)
const check = async (name, fn) => { await fn(); console.log('✔', name) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const launch = () => electron.launch({ ...target, env: { ...process.env, WC_VAULT: tmp('vault'), WC_HEADLESS: '1', WC_USER_DATA: tmp('userdata'), WC_CLAUDE_BIN: tmp('bin') + 'claude' } })
let app = await launch()
let page = await app.firstWindow()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))
await page.setViewportSize({ width: 1600, height: 900 })

const paneOf = (label) => page.locator('.pane', { has: page.locator('.tab.active', { hasText: label }) })
/** Drags `source` onto a pane, at an edge ('left' | 'right' | 'top' | 'bottom') or the middle. */
const dropOn = async (source, pane, zone) => {
  const b = await pane.locator('.pane-body').boundingBox()
  const at = { left: [8, b.height / 2], right: [b.width - 8, b.height / 2], top: [b.width / 2, 8], bottom: [b.width / 2, b.height - 8], center: [b.width / 2, b.height / 2] }[zone]
  await source.dragTo(pane.locator('.pane-body'), { targetPosition: { x: at[0], y: at[1] } })
  await sleep(300)
}
const screen = () => page.locator('.claude-term .xterm-rows').innerText()

await check('the left bar lists the views and the side panel is gone', async () => {
  for (const label of ['Files', 'Graph', 'Backlinks', 'Review', 'Comments', 'AI check', 'Claude Code', 'Assistant', 'Inspiration']) await page.locator(`.ribbon [aria-label="${label}"]`).waitFor()
  assert.equal(await page.locator('.side').count(), 0)
})

await check('four notes side by side, each in its own editor', async () => {
  await page.locator('.tree-row', { hasText: 'Welcome' }).click()
  for (const [n, next] of [['Welcome', 'Second'], ['Second', 'Ideas'], ['Ideas', 'Essay']]) await dropOn(page.locator('.tree-row', { hasText: next }), paneOf(n), 'right')
  assert.equal(await page.locator('.pane').count(), 4)
  assert.equal(await page.locator('.cm-editor').count(), 4)
  const xs = await page.locator('.pane').evaluateAll((ps) => ps.map((p) => Math.round(p.getBoundingClientRect().x)))
  assert.equal(new Set(xs).size, 4, 'side by side')
})

await check('typing in any pane edits and saves that note', async () => {
  await paneOf('Second').locator('.cm-content').click()
  await page.keyboard.press('Meta+ArrowDown')
  await page.keyboard.type(' Typed in pane two.')
  await sleep(900)
  assert(readFileSync(tmp('vault') + 'Second.md', 'utf8').includes('Typed in pane two.'))
  assert(!readFileSync(tmp('vault') + 'Welcome.md', 'utf8').includes('Typed in pane two.'))
})

await check('Claude Code dragged from the bar docks under a note', async () => {
  await dropOn(page.locator('.ribbon [aria-label="Claude Code"]'), paneOf('Ideas'), 'bottom')
  await page.waitForFunction(() => document.querySelector('.claude-term .xterm-rows')?.innerText.includes('READY'), null, { timeout: 15000 })
  const ideas = await paneOf('Ideas').boundingBox()
  const term = await page.locator('.claude-term').boundingBox()
  assert(term.y > ideas.y + ideas.height - 2 && Math.abs(term.x - ideas.x) < 20, 'terminal sits under Ideas')
  await page.locator('.claude-term .xterm').click()
  await page.keyboard.type('first message')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('.claude-term .xterm-rows').innerText.replace(/\n/g, '').includes('got: first message'))
})

await check('moving the terminal to another pane keeps the same session', async () => {
  await dropOn(page.locator('.tab', { hasText: 'Claude Code' }), paneOf('Welcome'), 'center')
  await paneOf('Claude Code').waitFor()
  assert((await screen()).replace(/\n/g, '').includes('got: first message'), 'scrollback survived the move')
  await page.locator('.claude-term .xterm').click()
  await page.keyboard.type('second message')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('.claude-term .xterm-rows').innerText.replace(/\n/g, '').includes('got: second message'))
})

await check('dividers resize neighbouring panes', async () => {
  const divider = page.locator('.divider.row').first()
  const before = (await page.locator('.pane-slot').first().boundingBox()).width
  const d = await divider.boundingBox()
  await page.mouse.move(d.x + d.width / 2, d.y + 40)
  await page.mouse.down()
  await page.mouse.move(d.x + 120, d.y + 40, { steps: 5 })
  await page.mouse.up()
  const after = (await page.locator('.pane-slot').first().boundingBox()).width
  assert(after > before + 80, `pane grew from ${before} to ${after}`)
})

await check('closing a pane\'s last tab removes the pane', async () => {
  await paneOf('Essay').locator('.tab button[aria-label="Close Essay"]').click()
  // Welcome's pane now shows Claude Code; Second and Ideas keep their editors.
  await page.waitForFunction(() => document.querySelectorAll('.cm-editor').length === 2)
})

await check('the layout comes back after a restart', async () => {
  await sleep(600)
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  page.on('pageerror', (e) => pageErrors.push(String(e)))
  await page.waitForFunction(() => document.querySelectorAll('.cm-editor').length === 2)
  for (const n of ['Welcome', 'Second', 'Ideas']) await page.locator('.tab', { hasText: n }).waitFor()
  await page.locator('.tab', { hasText: 'Claude Code' }).waitFor()
})

assert.deepEqual(pageErrors, [], 'no errors in the window')
await app.close()
for (const n of ['vault', 'userdata', 'bin']) rmSync(tmp(n), { recursive: true, force: true })
console.log('Layout e2e: all checks passed')
