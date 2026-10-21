import { test } from 'node:test'
import assert from 'node:assert/strict'
import { placeComments, type DocComment } from '../src/shared/comments.ts'

const c = (id: string, quote: string): DocComment => ({ id, author: 'A', content: 'x', created: '', resolved: false, quote, replies: [] })

test('comments land on the passage they quote, ignoring markdown, case and line wrapping', () => {
  const doc = '---\ngdoc_id: "x"\n---\nRight was on the **fader**; left was\nholding the intercom.\n\nAnother paragraph.'
  const { placed, unplaced } = placeComments(doc, [c('a', 'the fader; left was holding'), c('b', 'Another Paragraph'), c('c', 'not in this tab'), c('d', '')])
  assert.deepEqual(placed.map((p) => [p.id, doc.slice(p.from, p.to)]), [['a', 'the **fader**; left was\nholding'], ['b', 'Another paragraph']])
  assert.deepEqual(unplaced.map((u) => u.id), ['c', 'd'])
})
