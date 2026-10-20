// Headless e2e: Clawd shows every finding (no cap), says "All good" when there are none, and stays lively when idle.
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
const sentences = ['First sentence is somewhat vague here.', 'Second one repeats the first idea.', 'Third makes a claim without proof.', 'Fourth drifts away from the topic.', 'Fifth ends on a cliché, as they say.']
writeFileSync(vault + 'Draft.md', `# Draft\n\n${sentences.join(' ')}\n`)
const check = async (name, fn) => { await fn(); console.log('✔', name) }

let findings = sentences.map((quote, i) => ({ category: 'clarity', quote, issue: `Issue ${i + 1}`, suggestion: `Fix ${i + 1}`, replacement: `Better ${i + 1}.` }))
const mock = await startMock((body) => ({ events: textEvents([JSON.stringify({ findings })], body.model) }))
const launch = () => electron.launch({ ...target, env: { ...process.env, WC_VAULT: vault, WC_HEADLESS: '1', WC_USER_DATA: userData, ANTHROPIC_BASE_URL: mock.url, ANTHROPIC_API_KEY: 'test-key' } })

let app = await launch()
let page = await app.firstWindow()
page.on('pageerror', (e) => console.error('pageerror', e))
const openDraft = async () => { await page.locator('.tree-row', { hasText: 'Draft' }).click(); await page.locator('.clawd').waitFor() }

await check('all 5 findings are shown, not just 3', async () => {
  await openDraft()
  await page.locator('.clawd-body').click()
  await page.locator('.clawd-bubble', { hasText: '1 of 5' }).waitFor()
  for (let i = 2; i <= 5; i++) {
    await page.locator('.clawd-actions button', { hasText: 'Dismiss' }).click()
    if (i <= 5) await page.locator('.clawd-bubble', { hasText: `${i} of 5` }).waitFor()
  }
  assert.match(mock.requests.at(-1).body.system, /Never pad the list/)
})

await app.close()
findings = []
app = await launch()
page = await app.firstWindow()

await check('no findings: Clawd says All good, smiles and hops with a heart', async () => {
  await openDraft()
  await page.locator('.clawd-body').click()
  await page.locator('.clawd-bubble', { hasText: 'All good!' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.clawd').classList.contains('mode-happy'))
  assert.equal(await page.locator('.clawd .heart').evaluate((e) => getComputedStyle(e).animationName), 'clawd-heart')
  await page.waitForFunction(() => document.querySelector('.clawd').classList.contains('mode-idle'), null, { timeout: 5000 })
})

await check('idle Clawd keeps doing different things (walk, hang, hop, wave, dance, look)', async () => {
  const seen = new Set()
  for (let i = 0; i < 100 && seen.size < 3; i++) {
    const m = (await page.locator('.clawd').getAttribute('class')).match(/mode-(\w+)/)[1]
    if (!['idle', 'typing', 'happy'].includes(m)) seen.add(m)
    await page.waitForTimeout(500)
  }
  console.log('  seen:', [...seen].join(', '))
  assert(seen.size >= 3, `only saw ${[...seen].join(', ')}`)
})

await app.close()
mock.close()
for (const d of [vault, userData]) rmSync(d, { recursive: true, force: true })
console.log('Clawd e2e: all checks passed')
