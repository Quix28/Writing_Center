import { test } from 'node:test'
import assert from 'node:assert/strict'
import { onlySourced, parseItems, sourcedUrls } from '../src/shared/inspiration.ts'

test('inspiration items without a URL from the search results are dropped', () => {
  const blocks = [
    { type: 'server_tool_use' },
    { type: 'web_search_tool_result', content: [{ url: 'https://a.example/post/' }, { url: 'https://b.example/x' }] },
    { type: 'text', citations: [{ url: 'https://c.example/cited' }] },
    { type: 'web_search_tool_result', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } }
  ]
  const urls = sourcedUrls(blocks)
  const text = 'See {braces} first.\n{"items":[{"title":"A","url":"https://a.example/post","why":"x"},{"title":"Made up","url":"https://fake.example/","why":"y"},{"title":"C","url":"https://c.example/cited#top","why":"z"},{"title":"A again","url":"https://a.example/post/","why":"dup"},{"title":"Bad","url":"javascript:alert(1)","why":""}]}'
  assert.deepEqual(onlySourced(parseItems(text), urls).map((i) => i.title), ['A', 'C'])
})

test('parseItems survives prose and broken JSON', () => {
  assert.deepEqual(parseItems('no json here'), [])
  assert.deepEqual(parseItems('{"items": [{"title": 1}]}'), [])
})

test('URLs are read from Claude Code WebSearch tool results', async () => {
  const { urlsInToolResults } = await import('../src/shared/inspiration.ts')
  const result = 'Web search results for query: "x"\n\nLinks: [{"title":"A","url":"https://a.example/post/"},{"title":"B","url":"https://b.example/x"}]'
  assert.deepEqual([...urlsInToolResults([result])], ['https://a.example/post', 'https://b.example/x'])
})
