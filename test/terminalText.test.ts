import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clean, oneLine, paste } from '../src/shared/terminalText.ts'

test('text sent to the Claude Code terminal cannot end the paste or press Enter', () => {
  const evil = 'quote\x1b[201~\rrm -rf ~\r\x9b201~\x07'
  const pasted = paste(evil)
  assert.equal(pasted.split('\x1b[201~').length, 2, 'only the closing marker the app adds')
  assert(!pasted.includes('\r') && !pasted.includes('\x9b') && !pasted.includes('\x07'))
  assert.equal(clean('a\r\nb\tc'), 'a\nb\tc')
  assert.equal(oneLine('My\nNote\r.md'), 'My Note .md')
})
