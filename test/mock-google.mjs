// Minimal stand-in for the Docs v1 + Drive v3 endpoints Writing Centre uses. Docs are stored as plain markdown.
import { createServer } from 'node:http'

/** Tabs are stored as { id, title, paras: [{ text, style }], children } and served in the Docs API shape. */
const allTabs = (tabs = []) => tabs.flatMap((t) => [t, ...allTabs(t.children)])
function tabJson(t, index) {
  let at = 1
  const content = [{ sectionBreak: {}, endIndex: 1 }, ...t.paras.map((p) => ({ startIndex: at, endIndex: (at += p.text.length + 1), paragraph: { elements: [{ textRun: { content: p.text + '\n', textStyle: {} } }], paragraphStyle: { namedStyleType: p.style } } }))]
  return { tabProperties: { tabId: t.id, title: t.title, index }, documentTab: { body: { content }, lists: {} }, childTabs: (t.children ?? []).map(tabJson) }
}

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
      if ((m = /^\/v1\/documents\/([^/:]+)$/.exec(u.pathname)) && docs.get(m[1])?.tabs && u.searchParams.get('includeTabsContent') === 'true') {
        return json(200, { tabs: docs.get(m[1]).tabs.map(tabJson) })
      }
      if ((m = /^\/v1\/documents\/([^/:]+)$/.exec(u.pathname))) {
        const d = docs.get(m[1])
        return d ? json(200, { body: { content: [{ endIndex: 1 }, { endIndex: d.markdown.length + 2 }] } }) : json(404, { error: { code: 404, message: 'not found' } })
      }
      if ((m = /^\/v1\/documents\/([^/:]+):batchUpdate$/.exec(u.pathname))) {
        const d = docs.get(m[1])
        const insert = body.requests.find((r) => r.insertText)
        const tabId = insert?.insertText.location.tabId ?? body.requests[0]?.deleteContentRange?.range.tabId
        if (tabId) {
          const tab = allTabs(d.tabs).find((t) => t.id === tabId)
          tab.paras = (insert ? insert.insertText.text : '').split('\n').map((text) => ({ text, style: 'NORMAL_TEXT' }))
          let at = 1
          const starts = tab.paras.map((p) => { const s = at; at += p.text.length + 1; return s })
          for (const r of body.requests) if (r.updateParagraphStyle) { const i = starts.indexOf(r.updateParagraphStyle.range.startIndex); if (i >= 0) tab.paras[i].style = r.updateParagraphStyle.paragraphStyle.namedStyleType }
        } else d.markdown = insert ? insert.insertText.text : ''
        d.modifiedTime = tick()
        d.lastRequests = body.requests
        return json(200, { documentId: m[1], replies: [] })
      }
      if ((m = /^\/drive\/v3\/files\/([^/]+)\/comments$/.exec(u.pathname))) {
        if (!u.searchParams.get('fields')) return json(400, { error: { code: 400, message: 'fields is required for comments' } })
        return json(200, { comments: docs.get(m[1])?.comments ?? [] })
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
        /** Simulates someone editing one tab in the browser. */
        editTab: (id, tabId, paras) => {
          allTabs(docs.get(id).tabs).find((t) => t.id === tabId).paras = paras
          docs.get(id).modifiedTime = tick()
        },
        tabText: (id, tabId) => allTabs(docs.get(id).tabs).find((t) => t.id === tabId).paras.map((p) => p.text).join('\n'),
        failOn: (pattern, drop = false) => (fail = pattern && Object.assign(pattern, { drop })),
        close: () => server.close()
      })
    )
  )
}
