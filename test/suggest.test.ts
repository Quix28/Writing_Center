import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { applyEdits, minimalChange, targetRange } from '../src/renderer/cm/suggest.ts'

test('minimalChange produces the smallest replacement', () => {
  assert.deepEqual(minimalChange('hello world', 'hello brave world'), { from: 6, to: 6, insert: 'brave ' })
  assert.deepEqual(minimalChange('aaa', 'aaa'), { from: 3, to: 3, insert: '' })
  assert.deepEqual(minimalChange('abc', ''), { from: 0, to: 3, insert: '' })
})

test('applyEdits replaces exact text and counts misses', () => {
  const r = applyEdits('one two three', [{ find: 'two', replace: '2' }, { find: 'four', replace: '4' }, { find: '', replace: 'x' }])
  assert.deepEqual(r, { text: 'one 2 three', missed: 2 })
})

test('targetRange: selection, ## section, paragraph; # is the title, not a section', () => {
  const doc = '# A\n\nintro\n\n## B\n\nbody b\nmore b\n\n## C\n\nbody c\n'
  const at = (pos: number, head = pos) => targetRange(EditorState.create({ doc, selection: { anchor: pos, head } }))
  const slice = (r: { from: number; to: number }) => doc.slice(r.from, r.to)
  assert.equal(slice(at(doc.indexOf('body b'))), '## B\n\nbody b\nmore b')
  assert.equal(slice(at(doc.indexOf('intro'))), 'intro')
  assert.equal(slice(at(2, 4)), 'A\n')
  const plain = 'para one\nline two\n\npara two'
  const r = targetRange(EditorState.create({ doc: plain, selection: { anchor: 2 } }))
  assert.equal(plain.slice(r.from, r.to), 'para one\nline two')
})
