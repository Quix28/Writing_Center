// Minimal stand-in for the Docs v1 + Drive v3 endpoints Writing Centre uses. Docs are stored as plain markdown.
import { createServer } from 'node:http'

export function startGoogleMock() {
  const docs = new Map()
  const calls = []
  let fail = null
  let clock = Date.parse('2026-10-19T10:00:00.000Z')
  const tick = () => new Date((clock += 60_000)).toISOString()
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const u = new URL(req.url, 'http://x')
      const body = raw ? JSON.parse(raw) : null
      calls.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), body, auth: req.headers.authorization })
      const json = (status, data) => (res.writeHead(status, { 'content-type': 'application/json' }), res.end(JSON.stringify(data)))
      if (fail && fail.test(req.method + ' ' + u.pathname)) return fail.drop ? res.destroy() : json(500, { error: { code: 500, message: 'backend error' } })
      let m
      if (req.method === 'POST' && u.pathname === '/v1/documents') {
        const id = `doc${docs.size + 1}`
        docs.set(id, { name: body.title, markdown: '', modifiedTime: tick() })
        return json(200, { documentId: id, title: body.title })
      }
      if ((m = /^\/v1\/documents\/([^/:]+)$/.exec(u.pathname))) {
        const d = docs.get(m[1])
        return d ? json(200, { body: { content: [{ endIndex: 1 }, { endIndex: d.markdown.length + 2 }] } }) : json(404, { error: { code: 404, message: 'not found' } })
      }
      if ((m = /^\/v1\/documents\/([^/:]+):batchUpdate$/.exec(u.pathname))) {
        const d = docs.get(m[1])
        const insert = body.requests.find((r) => r.insertText)
        d.markdown = insert ? insert.insertText.text : ''
        d.modifiedTime = tick()
        d.lastRequests = body.requests
        return json(200, { documentId: m[1], replies: [] })
      }
      if ((m = /^\/drive\/v3\/files\/([^/]+)\/export$/.exec(u.pathname))) {
        res.writeHead(200, { 'content-type': 'text/markdown' })
        return res.end(docs.get(m[1]).markdown)
      }
      if ((m = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname))) {
        const d = docs.get(m[1])
        return d ? json(200, { id: m[1], name: d.name, modifiedTime: d.modifiedTime }) : json(404, { error: { code: 404, message: 'not found' } })
      }
      if (u.pathname === '/drive/v3/files') return json(200, { files: [...docs].map(([id, d]) => ({ id, name: d.name, modifiedTime: d.modifiedTime })) })
      json(404, { error: { code: 404, message: `no route ${u.pathname}` } })
    })
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        url: `http://127.0.0.1:${server.address().port}/`,
        docs,
        calls,
        /** Simulates someone editing the Doc in the browser. */
        editRemote: (id, markdown) => Object.assign(docs.get(id), { markdown, modifiedTime: tick() }),
        failOn: (pattern, drop = false) => (fail = pattern && Object.assign(pattern, { drop })),
        close: () => server.close()
      })
    )
  )
}
