// Drives the built app headless: `npm run build && node test/e2e-phase2.mjs`
import { _electron as electron } from 'playwright'
import { cpSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'

/** WC_APP=<path to the .app's executable> runs the suite against the packaged app instead of the dev build. */
const target = process.env.WC_APP ? { executablePath: process.env.WC_APP, args: [] } : { args: ['.'] }

const vault = join(import.meta.dirname, '.tmp-vault/')
const userData = join(import.meta.dirname, '.tmp-userdata/')
rmSync(vault, { recursive: true, force: true })
rmSync(userData, { recursive: true, force: true })
cpSync(join(import.meta.dirname, '../test-vault/'), vault, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const launch = () => electron.launch({ ...target, env: { ...process.env, WC_VAULT: vault, WC_HEADLESS: '1', WC_USER_DATA: userData } })
const check = async (name, fn) => { await fn(); console.log('✔', name) }
const canvasJson = () => JSON.parse(readFileSync(vault + 'Map.canvas', 'utf8'))

let app = await launch()
let page = await app.firstWindow()
page.on('pageerror', (e) => console.error('pageerror', e))

await check('palette creates a canvas', async () => {
  await page.locator('.tree').waitFor()
  await page.keyboard.press('Meta+p')
  await page.keyboard.type('new canvas')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Map')
  await page.keyboard.press('Enter')
  await page.locator('.react-flow__pane').waitFor()
  assert.deepEqual(canvasJson(), { nodes: [], edges: [] })
})

await check('drag files from tree onto canvas', async () => {
  const pane = page.locator('.react-flow__pane')
  const box = await pane.boundingBox()
  await page.locator('.tree-row', { hasText: 'Second' }).dragTo(pane, { targetPosition: { x: box.width * 0.25, y: box.height * 0.3 } })
  await page.locator('.tree-row', { hasText: 'Welcome' }).dragTo(pane, { targetPosition: { x: box.width * 0.65, y: box.height * 0.3 } })
  assert.equal(await page.locator('.cv-file').count(), 2)
})

await check('double-click empty space adds a text node', async () => {
  const box = await page.locator('.react-flow__pane').boundingBox()
  await page.mouse.dblclick(box.x + box.width * 0.4, box.y + box.height * 0.75)
  await page.locator('.cv-text textarea').waitFor()
  await page.keyboard.type('Idea')
  await page.mouse.click(box.x + 20, box.y + box.height - 20)
  await page.locator('.cv-text', { hasText: 'Idea' }).waitFor()
})

await check('draw an edge between two nodes', async () => {
  const from = page.locator('.react-flow__node', { has: page.locator('.cv-title', { hasText: /^Second$/ }) }).locator('.react-flow__handle-right')
  const to = page.locator('.react-flow__node', { has: page.locator('.cv-title', { hasText: /^Welcome$/ }) }).locator('.react-flow__handle-left')
  const a = await from.boundingBox(), b = await to.boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 })
  await page.mouse.up()
  await page.locator('.react-flow__edge').first().waitFor({ state: 'attached' })
})

let saved
await check('saved as valid JSON Canvas', async () => {
  await sleep(900)
  saved = canvasJson()
  assert.equal(saved.nodes.length, 3)
  assert.equal(saved.edges.length, 1)
  for (const n of saved.nodes) {
    assert.equal(typeof n.id, 'string')
    for (const k of ['x', 'y', 'width', 'height']) assert(Number.isInteger(n[k]), `${k} not integer`)
  }
  assert.deepEqual(saved.nodes.filter((n) => n.type === 'file').map((n) => n.file).sort(), ['Second.md', 'Welcome.md'])
  assert.equal(saved.nodes.find((n) => n.type === 'text').text, 'Idea')
  const byId = Object.fromEntries(saved.nodes.map((n) => [n.id, n]))
  const e = saved.edges[0]
  assert.equal(byId[e.fromNode].file, 'Second.md')
  assert.equal(byId[e.toNode].file, 'Welcome.md')
  assert.equal(e.fromSide, 'right')
  assert.equal(e.toSide, 'left')
})

await check('double-click file node opens the note', async () => {
  await page.locator('.cv-file', { has: page.locator('.cv-title', { hasText: /^Second$/ }) }).dblclick()
  await page.locator('.tab.active', { hasText: 'Second' }).waitFor()
  await page.locator('.cm-content').waitFor()
})

await check('same nodes and edges after restart; file not rewritten on open', async () => {
  await app.close()
  const before = readFileSync(vault + 'Map.canvas', 'utf8')
  app = await launch()
  page = await app.firstWindow()
  await page.locator('.tree-row', { hasText: 'Map.canvas' }).click()
  await page.locator('.react-flow__edge').first().waitFor({ state: 'attached' })
  assert.equal(await page.locator('.react-flow__node').count(), 3)
  assert.equal(await page.locator('.react-flow__edge').count(), 1)
  await sleep(900)
  assert.equal(readFileSync(vault + 'Map.canvas', 'utf8'), before)
})

await check('graph view builds nodes and edges from wikilinks', async () => {
  await page.locator('.tree-toolbar button', { hasText: 'Graph' }).click()
  await page.locator('.graph-node').first().waitFor()
  assert.equal(await page.locator('.graph-node').count(), 3)
  await page.waitForFunction(() => document.querySelectorAll('.view-root.view-graph .react-flow__edge').length === 3)
  await page.locator('.graph-node', { hasText: 'Ideas' }).click()
  await page.locator('.tab.active', { hasText: 'Ideas' }).waitFor()
})

await app.close()
console.log('Phase 2 e2e: all checks passed')
