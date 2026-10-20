import { linter, type Action, type Diagnostic } from '@codemirror/lint'
import { Compartment } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { looksEnglish } from '../../shared/language'
import { Dialect, SuggestionKind, WorkerLinter } from 'harper.js'

/** The 20 MB wasm binary loads lazily on the first lint, so startup stays fast. */
let harper: Promise<WorkerLinter> | null = null
const getHarper = () =>
  (harper ??= import('harper.js/binary').then(async ({ binary }) => {
    const linter = new WorkerLinter({ binary, dialect: Dialect.American })
    // Sentence-case headings are a style choice, not a mistake.
    await linter.setLintConfig({ ...(await linter.getLintConfig()), UseTitleCase: false })
    return linter
  }))

/** Harper reports Unicode code point offsets; CodeMirror uses UTF-16 offsets. They differ only around emoji and other astral characters. */
export function codePointToUtf16(text: string): (i: number) => number {
  if (!/[\uD800-\uDBFF]/.test(text)) return (i) => i
  const map: number[] = []
  let u = 0
  for (const ch of text) {
    map.push(u)
    u += ch.length
  }
  map.push(u)
  return (i) => map[i] ?? u
}

/**
 * Harper only knows English. For a note in another language (Turkish, …) it stays quiet and the editor turns on
 * macOS's own spellchecker instead, which knows that language; right-click shows its suggestions.
 */
const nativeSpellcheck = new Compartment()
const spellcheckAttrs = (on: boolean) => EditorView.contentAttributes.of({ spellcheck: on ? 'true' : 'false' })

function useNativeSpellcheck(view: EditorView, on: boolean) {
  if ((view.contentDOM.getAttribute('spellcheck') === 'true') !== on) view.dispatch({ effects: nativeSpellcheck.reconfigure(spellcheckAttrs(on)) })
}

/** Local grammar/spelling check: runs in a Web Worker, no network. English sentences only. */
const harperLint = linter(
  async (view) => {
    const text = view.state.doc.toString()
    const harper = await getHarper()
    // English note: Harper checks everything. Otherwise macOS spellchecks it, and Harper only looks at English sentences.
    const english = looksEnglish(text) || (await harper.isLikelyEnglish(text))
    useNativeSpellcheck(view, !english)
    const lints = await harper.lint(text, { language: 'markdown', isolateEnglish: !english })
    const at = codePointToUtf16(text)
    return lints.map((l): Diagnostic => {
      const span = l.span()
      const actions: Action[] = l.suggestions().map((s) => {
        const insert = s.get_replacement_text()
        const kind = s.kind()
        return {
          name: kind === SuggestionKind.Remove ? 'Remove' : kind === SuggestionKind.InsertAfter ? `Insert “${insert}”` : `“${insert}”`,
          apply: (v, from, to) =>
            v.dispatch({ changes: kind === SuggestionKind.InsertAfter ? { from: to, insert } : { from, to, insert: kind === SuggestionKind.Remove ? '' : insert } })
        }
      })
      return { from: at(span.start), to: at(span.end), severity: 'warning', source: 'Harper', message: l.message(), actions }
    })
  },
  { delay: 400 }
)

export const harperLinter = [nativeSpellcheck.of(spellcheckAttrs(false)), harperLint]
