import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mdToDocs, parseParas, patchDoc } from '../src/main/mdToDocs.ts'
import { tabToMarkdown } from '../src/main/docsToMd.ts'
// @ts-expect-error plain JS test helper
import { apply, makeDoc, toTab } from './docsSim.mjs'

const FONT = { weightedFontFamily: { fontFamily: 'Times New Roman' }, fontSize: { magnitude: 12, unit: 'PT' } }
const INDENT = { indentFirstLine: { magnitude: 36, unit: 'PT' }, lineSpacing: 200 }

/** An essay as people format it in Google Docs: custom font, indents, double spacing, blank lines, a title. */
const essay = () =>
  makeDoc([
    { text: 'US Personal Essay', style: 'TITLE', s: FONT },
    { text: '', s: FONT },
    { text: '\tRight was on the fader; left was holding the intercom.', s: FONT, extra: INDENT },
    { text: '', s: FONT },
    { text: 'Here I was again, commuting for another 5 hours.', s: FONT, extra: INDENT },
    { text: '', s: FONT },
    { text: 'The show ended. Nobody did.', s: FONT, extra: INDENT }
  ])

/** The markdown a pull gives back for this markdown: lists merged, blank lines normalised. */
const canonical = (md: string) => tabToMarkdown(toTab(apply(makeDoc(), mdToDocs(md))))

function push(chars: any[], edit: (md: string) => string) {
  const md = canonical(edit(tabToMarkdown(toTab(chars))))
  const requests = patchDoc(toTab(chars), md)
  apply(chars, requests)
  return { md, requests, after: tabToMarkdown(toTab(chars)) }
}
const paragraph = (chars: any[], starts: string) => {
  const text = chars.map((c) => c.ch).join('')
  const i = text.indexOf(starts)
  return { chars: chars.slice(i, text.indexOf('\n', i) + 1), nl: chars[text.indexOf('\n', i)] }
}

test('pushing an unchanged note sends nothing', () => {
  const { requests } = push(essay(), (md) => md)
  assert.deepEqual(requests, [])
})

test('an edited sentence changes only its own words; fonts, indents and blank lines survive', () => {
  const doc = essay()
  const { md, after, requests } = push(doc, (md) => md.replace('5 hours', 'five long hours'))
  assert.equal(after, md)
  assert(!requests.some((r) => r.updateParagraphStyle), 'no paragraph is restyled')
  assert.equal(requests.filter((r) => r.deleteContentRange || r.insertText).length, 2)
  for (const c of doc) assert.deepEqual(c.s.weightedFontFamily, FONT.weightedFontFamily, `"${c.ch}" kept its font`)
  assert.deepEqual(paragraph(doc, 'Here I was').nl.p.extra, INDENT)
  assert.equal(paragraph(doc, 'US Personal').nl.p.style, 'TITLE', 'the title stays a Title')
  assert.equal(doc.map((c: any) => c.ch).join('').split('\n').slice(0, -1).filter((l: string) => !l).length, 3, 'blank lines kept')
  assert(doc.map((c: any) => c.ch).join('').includes('\tRight was'), 'first-line tab kept')
})

test('added, removed and restyled paragraphs, lists and marks round-trip', () => {
  const doc = essay()
  const { md, after } = push(doc, (md) =>
    md
      .replace('The show ended. Nobody did.', 'The show ended. **Nobody** did.\n\n## Afterwards\n\n- one\n- two\n  - nested\n\nA closing line with a [link](https://ex.com).')
      .replace('Here I was again, commuting for another 5 hours.\n\n', '')
      .replace('US Personal Essay', 'New opening line.\n\n# US Personal Essay')
  )
  assert.equal(after, md)
  assert.deepEqual(paragraph(doc, 'Afterwards').nl.p.style, 'HEADING_2')
  assert.equal(paragraph(doc, 'nested').nl.p.bullet.nesting, 1)
  assert.equal(paragraph(doc, 'Nobody').chars.find((c: any) => c.ch === 'N' && c.s.bold) !== undefined, true)
  assert.deepEqual(paragraph(doc, 'Right was').nl.p.extra, INDENT, 'untouched paragraph keeps its indent')
})

test('the last paragraph and every paragraph can be deleted; the final newline stays', () => {
  const doc = essay()
  const { md, after } = push(doc, (md) => md.replace('\n\nThe show ended. Nobody did.', ''))
  assert.equal(after, md)
  const all = push(doc, () => 'Only this.\n')
  assert.equal(all.after, 'Only this.\n')
})

test('inline objects (images, chips) outside the edited words are kept', () => {
  const doc = makeDoc([{ text: 'Before ￼ after the image.' }])
  const { md, after } = push(doc, (md) => md.replace('after the image', 'after that image'))
  assert.equal(after, md)
  assert(doc.some((c: any) => c.ch === '￼'))
})

test('an empty Doc is filled from scratch', () => {
  const doc = makeDoc()
  const { md, after } = push(doc, () => '# Title\n\nBody with *style*.\n')
  assert.equal(after, md)
})

test('random edits always round-trip and never break a request', () => {
  let seed = 7
  const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n)
  const words = ['alpha', 'beta', '**bold**', '*it*', 'gamma', 'delta', 'çağlar', 'ışık']
  const para = () => Array.from({ length: 1 + rand(6) }, () => words[rand(words.length)]).join(' ')
  const block = () => (rand(5) === 0 ? `## ${para()}` : rand(5) === 0 ? `- ${para()}\n- ${para()}` : para())
  for (let round = 0; round < 200; round++) {
    const doc = round % 2 ? makeDoc() : makeDoc(Array.from({ length: 1 + rand(6) }, (_, i) => [{ text: '' }, { text: `${i} ${para().replace(/\*/g, '')}`, s: FONT }]).flat().slice(1))
    if (round % 2) push(doc, () => Array.from({ length: 1 + rand(6) }, block).join('\n\n') + '\n')
    for (let step = 0; step < 6; step++) {
      const { md, after } = push(doc, (md) => {
        const blocks = md.trim().split('\n\n')
        const i = rand(blocks.length + 1)
        const op = rand(3)
        if (op === 0) blocks.splice(i, 0, block())
        else if (op === 1 && blocks.length > 1) blocks.splice(i, 1)
        else blocks[Math.min(i, blocks.length - 1)] = block()
        return blocks.join('\n\n') + '\n'
      })
      // Same paragraphs, styles, lists and marks; blank lines may differ (e.g. between paragraphs that became list items).
      const content = (m: string) => parseParas(m).map(({ text, style, list, depth, runs }) => ({ text, style, list, depth, runs }))
      assert.deepEqual(content(after), content(md), `round ${round} step ${step}`)
    }
  }
})
