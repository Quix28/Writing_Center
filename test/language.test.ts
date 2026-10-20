import { test } from 'node:test'
import assert from 'node:assert/strict'
import { looksEnglish } from '../src/shared/language.ts'

test('looksEnglish tells short English notes from Turkish ones', () => {
  assert.equal(looksEnglish('# Second\n\nBack to [[Welcome]].\n\nThis is teh test.'), true)
  assert.equal(looksEnglish('This is teh English part of the note, written to check mixed text.'), true)
  assert.equal(looksEnglish('# Notlar\n\nBugün çok yorgunum ama yazacağım.'), false)
  assert.equal(looksEnglish('Her sabah yazmaya oturmak zor ama bunu yapmak gerekiyor.'), false)
  assert.equal(looksEnglish('Her sabah yazmaya oturmak zor. Sayfa açıldığında cümleler yavaş yavaş gelir ve sonra hızlanır.'), false)
  assert.equal(looksEnglish('Hi'), true)
})
