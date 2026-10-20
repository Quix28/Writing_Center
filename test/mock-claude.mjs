// Minimal stand-in for the Anthropic Messages API (SSE) so e2e tests never hit the network.
import { createServer } from 'node:http'

const sse = (res, events, delay = 0) =>
  (async () => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const e of events) {
      if (e === 'DROP') return res.destroy()
      res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
      if (delay) await new Promise((r) => setTimeout(r, delay))
    }
    res.end()
  })()

export function textEvents(chunks, model = 'claude-opus-5-5', { drop = false } = {}) {
  const deltas = chunks.map((text) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }))
  return [
    { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ...deltas,
    ...(drop ? ['DROP'] : []),
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } },
    { type: 'message_stop' }
  ]
}

/** Non-text blocks (server_tool_use, web_search_tool_result) arrive whole; text blocks are streamed. */
export function blockEvents(blocks, model = 'claude-opus-5-5') {
  const out = [{ type: 'message_start', message: { id: 'msg_2', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } }]
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      out.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } })
      out.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: b.text } })
    } else out.push({ type: 'content_block_start', index, content_block: b })
    out.push({ type: 'content_block_stop', index })
  })
  out.push({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }, { type: 'message_stop' })
  return out
}

/** `respond(body, headers)` returns { events, delay } or { status, json }. All requests are recorded. */
export function startMock(respond) {
  const requests = []
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        const data = [
          { type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-01-01T00:00:00Z' },
          { type: 'model', id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', created_at: '2026-01-01T00:00:00Z' }
        ]
        return res.end(JSON.stringify({ data, has_more: false, first_id: data[0].id, last_id: data[1].id }))
      }
      const body = JSON.parse(raw || '{}')
      requests.push({ url: req.url, headers: req.headers, body })
      const r = respond(body, req.headers)
      if (r.status) {
        res.writeHead(r.status, { 'content-type': 'application/json' })
        return res.end(JSON.stringify(r.json))
      }
      sse(res, r.events, r.delay)
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() })))
}
