// Renders build/icon.icns from an inline SVG of Clawd. Run with: npx electron scripts/make-icon.mjs
import { app, BrowserWindow } from 'electron'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const rects = [
  [0, 1, 1, 1, 'claw'], [2, 1, 1, 1, 'claw'], [0, 2, 3, 2, 'claw'], [3, 4, 1, 1, 'claw'],
  [13, 1, 1, 1, 'claw'], [15, 1, 1, 1, 'claw'], [13, 2, 3, 2, 'claw'], [12, 4, 1, 1, 'claw'],
  [4, 3, 8, 1, 'shell'], [3, 4, 10, 5, 'shell'],
  [5, 5, 1, 2, 'eye'], [10, 5, 1, 2, 'eye'],
  [3, 9, 1, 2, 'leg'], [10, 9, 1, 2, 'leg'], [5, 9, 1, 2, 'leg'], [12, 9, 1, 2, 'leg']
]
const fill = { claw: '#c4623f', shell: '#d97757', eye: '#16181b', leg: '#9e4a2e' }
const sprite = rects.map(([x, y, w, h, k]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill[k]}"/>`).join('')
const html = `<html><body style="margin:0;background:transparent">
<div style="position:absolute;left:100px;top:100px;width:824px;height:824px;border-radius:185px;
  background:linear-gradient(160deg,#2a2f37 0%,#1a1d21 100%);box-shadow:inset 0 0 0 2px #3a404899">
  <div style="position:absolute;left:112px;right:112px;bottom:170px;height:6px;border-radius:3px;background:#9bb8d8;opacity:.55"></div>
  <svg viewBox="0 0 16 13" width="600" height="487" shape-rendering="crispEdges" style="position:absolute;left:112px;top:150px">${sprite}</svg>
</div></body></html>`

const out = join(import.meta.dirname, '..', 'build')
app.dock?.hide()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 400))
  const png = join(out, 'icon-1024.png')
  writeFileSync(png, (await win.webContents.capturePage()).toPNG())
  const set = join(out, 'icon.iconset')
  rmSync(set, { recursive: true, force: true })
  mkdirSync(set)
  for (const size of [16, 32, 128, 256, 512]) {
    execFileSync('sips', ['-z', String(size), String(size), png, '--out', join(set, `icon_${size}x${size}.png`)])
    execFileSync('sips', ['-z', String(size * 2), String(size * 2), png, '--out', join(set, `icon_${size}x${size}@2x.png`)])
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', join(out, 'icon.icns')])
  rmSync(set, { recursive: true })
  app.quit()
})
