import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findTab, flattenTabs, tabToMarkdown } from '../src/main/docsToMd.ts'

const run = (content: string, textStyle = {}) => ({ textRun: { content, textStyle } })
const para = (elements: object[], namedStyleType = 'NORMAL_TEXT', bullet?: object) => ({ paragraph: { elements, paragraphStyle: { namedStyleType }, ...(bullet ? { bullet } : {}) } })

test('a Google Docs tab converts to markdown', () => {
  const tab = {
    lists: { L1: { listProperties: { nestingLevels: [{ glyphSymbol: '●' }, { glyphSymbol: '○' }] } }, L2: { listProperties: { nestingLevels: [{ glyphType: 'DECIMAL' }] } } },
    body: {
      content: [
        { sectionBreak: {} },
        para([run('US Personal Essay\n')], 'HEADING_1'),
        para([run('Right was on the '), run('fader', { bold: true }), run('; left was '), run('holding ', { italic: true }), run('the '), run('intercom', { link: { url: 'https://ex.com' } }), run('.\n')]),
        para([run('\n')]),
        para([run('one\n')], 'NORMAL_TEXT', { listId: 'L1', nestingLevel: 0 }),
        para([run('nested\n')], 'NORMAL_TEXT', { listId: 'L1', nestingLevel: 1 }),
        para([run('first\n')], 'NORMAL_TEXT', { listId: 'L2', nestingLevel: 0 }),
        { table: { columns: 2, tableRows: [{ tableCells: [{ content: [para([run('School\n')])] }, { content: [para([run('Deadline\n')])] }] }, { tableCells: [{ content: [para([run('Brown\n')])] }, { content: [para([run('Jan 3\n')])] }] }] } }
      ]
    }
  }
  assert.equal(
    tabToMarkdown(tab),
    '# US Personal Essay\n\nRight was on the **fader**; left was *holding* the [intercom](https://ex.com).\n\n- one\n  - nested\n1. first\n\n| School | Deadline |\n| --- | --- |\n| Brown | Jan 3 |\n'
  )
})

test('tabs flatten in reading order with depth, and can be found by id', () => {
  const tabs = [
    { tabProperties: { tabId: 't.1', title: 'Instructions' } },
    { tabProperties: { tabId: 't.2', title: 'US Personal Essay' }, childTabs: [{ tabProperties: { tabId: 't.3', title: 'Screwdriver' } }] }
  ]
  assert.deepEqual(flattenTabs(tabs), [
    { id: 't.1', title: 'Instructions', depth: 0 },
    { id: 't.2', title: 'US Personal Essay', depth: 0 },
    { id: 't.3', title: 'Screwdriver', depth: 1 }
  ])
  assert.equal(findTab(tabs, 't.3')?.tabProperties?.title, 'Screwdriver')
})
