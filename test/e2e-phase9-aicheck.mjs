// Headless e2e for the AI check: Claude score (mock API) + local detector score (mock or real, WC_REAL_DETECTOR=1).
import { _electron as electron } from 'playwright'
import { createServer } from 'node:http'
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { startMock, textEvents } from './mock-claude.mjs'

const target = process.env.WC_APP ? { executablePath: process.env.WC_APP, args: [] } : { args: ['.'] }
const vault = join(import.meta.dirname, '.tmp-vault/')
const userData = join(import.meta.dirname, '.tmp-userdata/')
for (const d of [vault, userData]) rmSync(d, { recursive: true, force: true })
cpSync(join(import.meta.dirname, '../test-vault/'), vault, { recursive: true })
const HUMAN = 'I burned the toast again this morning, which my cat took personally. She sat on the windowsill and refused to look at me.'
const AI = "In today's fast-paced world, it is important to note that writing is a multifaceted journey that unlocks endless possibilities and fosters growth."
writeFileSync(vault + 'Essay.md', `# Essay\n\n${HUMAN}\n\n${AI}\n`)
const check = async (name, fn) => { await fn(); console.log('✔', name) }

const claude = await startMock((body) => {
  if (!body.output_config?.format?.schema?.properties?.tells) return { events: textEvents(['{}'], body.model) }
  return { events: textEvents([JSON.stringify({
    overall_score: 52, summary: 'One paragraph is concrete and personal; the other is generic.',
    paragraphs: [{ opening: 'I burned the toast again this', score: 8 }, { opening: "In today's fast-paced world, it is", score: 91 }],
    tells: [{ quote: 'multifaceted journey', pattern: 'Stock vocabulary', explanation: 'A cliché that says nothing specific.', replacement: 'slow, daily practice' }]
  })], body.model) }
})
let detectorUrl = null
let detectorServer = null
if (!process.env.WC_REAL_DETECTOR) {
  detectorServer = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' })
      if (req.url === '/api/engines') return res.end('[]')
      const text = JSON.parse(raw).text
      assert(text.includes(HUMAN) && !text.includes('gdoc_id'))
      res.end(JSON.stringify({ paragraphs: [
        { index: 0, text: '# Essay ' + HUMAN, char_count: 130, score: 22.4, verdict: 'clean', confidence: 'low' },
        { index: 1, text: AI, char_count: 140, score: 77.9, verdict: 'ai', confidence: 'medium' }
      ], overall_score: 50.3, overall_verdict: 'mixed', paragraph_count: 2, ai_paragraph_count: 1 }))
    })
  })
  await new Promise((r) => detectorServer.listen(0, '127.0.0.1', r))
  detectorUrl = `http://127.0.0.1:${detectorServer.address().port}`
}

const env = { ...process.env, WC_VAULT: vault, WC_HEADLESS: '1', WC_USER_DATA: userData, ANTHROPIC_BASE_URL: claude.url, ANTHROPIC_API_KEY: 'test-key', ...(detectorUrl ? { WC_DETECTOR_URL: detectorUrl } : {}) }
const app = await electron.launch({ ...target, env })
const page = await app.firstWindow()
page.on('pageerror', (e) => console.error('pageerror', e))

await check('AI check shows two separate scores', async () => {
  await page.locator('.tree-row', { hasText: 'Essay' }).click()
  await page.locator('.cm-content').focus()
  await page.keyboard.press('Meta+p')
  await page.keyboard.type('ai check')
  await page.keyboard.press('Enter')
  const cards = page.locator('.score-card')
  await cards.nth(0).locator('.score-value').waitFor({ timeout: 300000 })
  await cards.nth(1).locator('.score-value').waitFor({ timeout: 300000 })
  console.log('  Claude:', (await cards.nth(0).locator('.score-value').innerText()).replace('\n', ''), '| detector:', (await cards.nth(1).locator('.score-value').innerText()).replace('\n', ''), await cards.nth(1).locator('.score-band').innerText())
  if (!process.env.WC_REAL_DETECTOR) {
    assert.match(await cards.nth(0).innerText(), /52/)
    assert.match(await cards.nth(1).innerText(), /50/)
  }
})

await check('each paragraph gets both scores and the higher one is highlighted', async () => {
  const rows = page.locator('.para-scores li')
  assert.equal(await rows.count(), 2)
  const second = await rows.nth(1).innerText()
  assert.match(second, /C 91/)
  if (!process.env.WC_REAL_DETECTOR) assert.match(second, /D 78/)
  await page.locator('.cm-ai-high, .cm-ai-mid').first().waitFor({ state: 'attached' })
  await page.locator('.color-by button', { hasText: 'Claude' }).click()
  await page.locator('.cm-ai-high', { hasText: 'fast-paced' }).waitFor({ state: 'attached' })
})

await check('a Claude tell becomes a suggest-mode rewrite', async () => {
  await page.locator('.aicheck .finding button', { hasText: 'Propose rewrite' }).click()
  await page.locator('.review-bar').waitFor()
  await page.locator('.review-bar button', { hasText: 'Reject remaining' }).click()
})

await app.close()
claude.close()
detectorServer?.close()
for (const d of [vault, userData]) rmSync(d, { recursive: true, force: true })
console.log('AI check e2e: all checks passed')
