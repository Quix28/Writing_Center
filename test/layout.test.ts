import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addTab, dropTab, pane, paneWith, panes, parseLayout, removeTab, renameTabs, type Node } from '../src/renderer/layout.ts'

const shape = (n: Node): unknown => (n.type === 'pane' ? n.tabs : { [n.dir]: n.children.map(shape) })

test('four notes side by side, then Claude Code under the last one', () => {
  let root: Node = pane(['a.md', 'b.md', 'c.md', 'd.md'])
  const first = root.type === 'pane' ? root.id : ''
  for (const t of ['b.md', 'c.md', 'd.md']) root = dropTab(root, panes(root).at(-1)!.id, 'right', t)
  assert.deepEqual(shape(root), { row: [['a.md'], ['b.md'], ['c.md'], ['d.md']] })
  assert.equal(panes(root)[0].id, first)
  assert.deepEqual(root.type === 'split' && root.sizes, [0.25, 0.25, 0.25, 0.25])
  root = dropTab(root, paneWith(root, 'd.md')!.id, 'bottom', 'view:claude')
  assert.deepEqual(shape(root), { row: [['a.md'], ['b.md'], ['c.md'], { col: [['d.md'], ['view:claude']] }] })
})

test('moving a pane\'s last tab away closes the pane; a pane cannot be split by its only tab', () => {
  let root: Node = pane(['a.md', 'view:graph'])
  root = dropTab(root, panes(root)[0].id, 'left', 'view:graph')
  assert.deepEqual(shape(root), { row: [['view:graph'], ['a.md']] })
  assert.equal(dropTab(root, paneWith(root, 'a.md')!.id, 'top', 'a.md'), root)
  root = addTab(root, paneWith(root, 'view:graph')!.id, 'a.md')
  assert.deepEqual(shape(root), ['view:graph', 'a.md'])
})

test('closing tabs keeps the last pane and picks a neighbour as active', () => {
  let root: Node = pane(['a.md', 'b.md', 'c.md'], 'b.md')
  root = removeTab(root, 'b.md')
  assert.equal(root.type === 'pane' && root.active, 'c.md')
  root = removeTab(removeTab(root, 'a.md'), 'c.md')
  assert.deepEqual(shape(root), [])
})

test('renames follow tabs, and saved layouts are validated', () => {
  const root = renameTabs(pane(['notes/a.md', 'b.md']), (t) => t.replace('notes/', 'old/'))
  assert(paneWith(root, 'old/a.md'))
  assert.deepEqual(parseLayout(JSON.stringify(root)), root)
  assert.equal(parseLayout('{"type":"split","dir":"row","children":[],"sizes":[1]}'), null)
  assert.equal(parseLayout('nope'), null)
})
