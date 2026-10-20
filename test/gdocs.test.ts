import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bodyHash, getKey, setKeys, splitFrontmatter } from '../src/shared/frontmatter.ts'
import { mdToDocs } from '../src/main/mdToDocs.ts'

test('frontmatter keys are set without touching other lines or the body', async () => {
  const md = '---\ntags: [a, b]\ngdoc_id: "old"\n---\n# Title\n\nBody.\n'
  const out = setKeys(md, { gdoc_id: 'abc', gdoc_synced_at: '2026-10-19T10:00:00.000Z' })
  assert.equal(out, '---\ntags: [a, b]\ngdoc_id: "abc"\ngdoc_synced_at: "2026-10-19T10:00:00.000Z"\n---\n# Title\n\nBody.\n')
  assert.equal(getKey(out, 'gdoc_id'), 'abc')
  assert.equal(getKey('# no frontmatter', 'gdoc_id'), undefined)
  assert.equal(setKeys('Body', { gdoc_id: 'x' }), '---\ngdoc_id: "x"\n---\nBody')
  assert.equal(splitFrontmatter(out).body, '# Title\n\nBody.\n')
  assert.equal(await bodyHash('Body\n'), await bodyHash('Body'))
  assert.notEqual(await bodyHash('Body'), await bodyHash('Body!'))
})

/** Applies insertText + bullet tab stripping like Docs would, to check indices line up with the text. */
function render(requests: any[]) {
  let text = requests[0].insertText.text as string
  const at = (r: { startIndex: number; endIndex: number }) => ('\n' + text).slice(r.startIndex, r.endIndex)
  const styled = requests.filter((r) => r.updateTextStyle && r.updateTextStyle.fields !== 'bold,italic,link').map((r) => [at(r.updateTextStyle.range), r.updateTextStyle.textStyle])
  const paras = requests.filter((r) => r.updateParagraphStyle).map((r) => [at(r.updateParagraphStyle.range).replace(/\n$/, ''), r.updateParagraphStyle.paragraphStyle.namedStyleType])
  const bullets = requests.filter((r) => r.createParagraphBullets).map((r) => [at(r.createParagraphBullets.range), r.createParagraphBullets.bulletPreset])
  return { text, styled, paras, bullets }
}

test('mdToDocs keeps headings, bold, italic, links and lists with correct indices', () => {
  const md = '---\ngdoc_id: "x"\n---\n# Big *idea*\n\nSome **bold** and *italic* with [a link](https://ex.com) and [[Note|alias]].\n\n- one\n- **two**\n  - nested\n\n1. first\n2. second\n'
  const r = render(mdToDocs(md))
  assert.equal(r.text, 'Big idea\nSome bold and italic with a link and alias.\none\ntwo\n\tnested\nfirst\nsecond')
  assert.deepEqual(r.paras.slice(0, 2), [['Big idea', 'HEADING_1'], ['Some bold and italic with a link and alias.', 'NORMAL_TEXT']])
  assert.deepEqual(r.styled, [
    ['idea', { italic: true }],
    ['bold', { bold: true }],
    ['italic', { italic: true }],
    ['a link', { link: { url: 'https://ex.com' } }],
    ['two', { bold: true }]
  ])
  assert.deepEqual(r.bullets, [['first\nsecond', 'NUMBERED_DECIMAL_ALPHA_ROMAN'], ['one\ntwo\n\tnested\n', 'BULLET_DISC_CIRCLE_SQUARE']])
})

test('every range stays before the final newline', () => {
  const reqs = mdToDocs('# T\n\n- a\n- b\n\n```\ncode\n\n```\n')
  const end = 1 + reqs[0].insertText!.text!.length
  for (const r of reqs.slice(1)) {
    const range = Object.values(r)[0].range
    assert(range.endIndex <= end && range.startIndex < range.endIndex, JSON.stringify(r))
  }
})

test('mdToDocs on an empty note does nothing', () => {
  assert.deepEqual(mdToDocs('---\na: 1\n---\n'), [])
})
