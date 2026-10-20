import { test } from 'node:test'
import assert from 'node:assert/strict'
import { safePath } from '../src/main/vault.ts'
import { extractLinks, resolveLink } from '../src/shared/links.ts'

test('safePath rejects anything resolving outside the vault', () => {
  const root = '/v/vault'
  assert.equal(safePath(root, 'a/b.md'), '/v/vault/a/b.md')
  assert.equal(safePath(root, '..notes.md'), '/v/vault/..notes.md')
  for (const bad of ['../x.md', 'a/../../x.md', '/etc/passwd', '../vault2/x.md']) assert.throws(() => safePath(root, bad))
})

test('wikilinks extract and resolve like Obsidian', () => {
  assert.deepEqual(extractLinks('see [[A]] and [[b/C|alias]] and [[D#head]]'), ['A', 'b/C', 'D'])
  const files = ['A.md', 'b/C.md', 'x/D.md', 'map.canvas']
  assert.equal(resolveLink('a', files), 'A.md')
  assert.equal(resolveLink('b/C', files), 'b/C.md')
  assert.equal(resolveLink('D', files), 'x/D.md')
  assert.equal(resolveLink('map', files), undefined)
})
