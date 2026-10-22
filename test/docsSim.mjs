// A small Google Docs body simulator for tests: applies batchUpdate requests the way the Docs API documents them
// and rejects the ranges the API rejects. Index i in the Docs API is chars[i - 1]; every '\n' carries its paragraph.

const OBJECT = '￼'

/** paras: [{ text, style?, bullet?: { nesting, preset }, s?: textStyle, extra?: paragraphStyle }]; OBJECT in text = an inline object. */
export function makeDoc(paras = [{ text: '' }]) {
  const chars = []
  for (const p of paras) {
    for (const ch of p.text.split('')) chars.push({ ch, s: { ...p.s } })
    chars.push({ ch: '\n', s: { ...p.s }, p: { style: p.style ?? 'NORMAL_TEXT', bullet: p.bullet, extra: p.extra } })
  }
  return chars
}

function paragraphs(chars) {
  const out = []
  let start = 0
  chars.forEach((c, i) => {
    if (c.ch !== '\n') return
    out.push({ start, nl: i })
    start = i + 1
  })
  return out
}

export function apply(chars, requests) {
  const check = (r) => {
    if (!(r.startIndex >= 1 && r.startIndex < r.endIndex && r.endIndex <= chars.length)) throw new Error(`invalid range ${JSON.stringify(r)} (doc length ${chars.length})`)
  }
  const overlapping = (r) => paragraphs(chars).filter((p) => p.start <= r.endIndex - 2 && p.nl >= r.startIndex - 1)
  for (const req of requests) {
    const [kind, b] = Object.entries(req)[0]
    if (kind === 'insertText') {
      const i = b.location.index - 1
      if (i < 0 || i >= chars.length) throw new Error(`invalid insert index ${b.location.index}`)
      const before = i > 0 && chars[i - 1].ch !== '\n' ? chars[i - 1] : chars[i]
      const host = chars[paragraphs(chars).find((p) => p.nl >= i).nl].p
      chars.splice(i, 0, ...b.text.split('').map((ch) => (ch === '\n' ? { ch, s: { ...before.s }, p: structuredClone(host) } : { ch, s: { ...before.s } })))
    } else if (kind === 'deleteContentRange') {
      check(b.range)
      chars.splice(b.range.startIndex - 1, b.range.endIndex - b.range.startIndex)
    } else if (kind === 'updateParagraphStyle') {
      check(b.range)
      for (const p of overlapping(b.range)) chars[p.nl].p.style = b.paragraphStyle.namedStyleType
    } else if (kind === 'updateTextStyle') {
      check(b.range)
      for (let i = b.range.startIndex - 1; i < b.range.endIndex - 1; i++)
        for (const f of b.fields.split(',')) {
          if (b.textStyle[f] === undefined) delete chars[i].s[f]
          else chars[i].s[f] = b.textStyle[f]
        }
    } else if (kind === 'deleteParagraphBullets') {
      check(b.range)
      for (const p of overlapping(b.range)) delete chars[p.nl].p.bullet
    } else if (kind === 'createParagraphBullets') {
      check(b.range)
      for (const p of overlapping(b.range).reverse()) {
        let tabs = 0
        while (chars[p.start + tabs].ch === '\t') tabs++
        chars[p.nl].p.bullet = { nesting: tabs, preset: b.bulletPreset }
        chars.splice(p.start, tabs)
      }
    } else throw new Error(`unsupported request ${kind}`)
  }
  return chars
}

/** The Docs API `documentTab` shape for the simulated body. */
export function toTab(chars) {
  const content = [{ endIndex: 1, sectionBreak: {} }]
  const lists = {}
  for (const { start, nl } of paragraphs(chars)) {
    const elements = []
    for (let i = start; i <= nl; i++) {
      const c = chars[i]
      const last = elements.at(-1)
      if (c.ch === OBJECT) elements.push({ startIndex: i + 1, endIndex: i + 2, inlineObjectElement: { inlineObjectId: 'obj' } })
      else if (last?.textRun && JSON.stringify(last.textRun.textStyle) === JSON.stringify(c.s)) (last.textRun.content += c.ch), last.endIndex++
      else elements.push({ startIndex: i + 1, endIndex: i + 2, textRun: { content: c.ch, textStyle: { ...c.s } } })
    }
    const { style, bullet, extra } = chars[nl].p
    const paragraph = { elements, paragraphStyle: { namedStyleType: style, ...extra } }
    if (bullet) {
      paragraph.bullet = { listId: bullet.preset, nestingLevel: bullet.nesting }
      lists[bullet.preset] = { listProperties: { nestingLevels: Array.from({ length: 9 }, () => ({ glyphType: bullet.preset.startsWith('NUMBERED') ? 'DECIMAL' : undefined })) } }
    }
    content.push({ startIndex: start + 1, endIndex: nl + 2, paragraph })
  }
  return { body: { content }, lists }
}

export const toParas = (chars) =>
  paragraphs(chars).map(({ start, nl }) => ({ text: chars.slice(start, nl).map((c) => c.ch).join(''), style: chars[nl].p.style, bullet: chars[nl].p.bullet }))
