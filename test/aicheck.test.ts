import { test } from 'node:test'
import assert from 'node:assert/strict'
import { band, findDetectorPara, findPara, paragraphsOf } from '../src/shared/aicheck.ts'

const doc = '---\ngdoc_id: "x"\n---\n# Title\n\nFirst paragraph here,\nstill the first.\n\n## Section\n\nSecond paragraph. It has two sentences that are long enough.\n'

test('paragraphsOf skips frontmatter and headings and keeps document offsets', () => {
  const ps = paragraphsOf(doc)
  assert.deepEqual(ps.map((p) => p.text), ['First paragraph here,\nstill the first.', 'Second paragraph. It has two sentences that are long enough.'])
  for (const p of ps) assert.equal(doc.slice(p.from, p.to), p.text)
})

test('paragraph lookup tolerates whitespace and detector merging', () => {
  const ps = paragraphsOf(doc)
  assert.equal(findPara(ps, 'first paragraph here, still'), 0)
  assert.equal(findDetectorPara(ps, '## Section Second paragraph. It has two sentences that are long enough.'), 1)
  assert.equal(findPara(ps, 'not there'), -1)
  assert.deepEqual([band(10), band(40), band(75)], ['low', 'mid', 'high'])
})
