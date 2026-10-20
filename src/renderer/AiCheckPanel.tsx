import { useEffect, useState } from 'react'
import { api, errorText, type AiTells, type DetectorResult } from './api'
import { toast } from './ui'
import { getView } from './Editor'
import { setSpans } from './cm/spans'
import { propose } from './cm/suggest'
import { splitFrontmatter } from '../shared/frontmatter'
import { BAND_LABEL, band, findDetectorPara, findPara, paragraphsOf, type Para } from '../shared/aicheck'

type Load<T> = { state: 'idle' } | { state: 'loading' } | { state: 'done'; data: T } | { state: 'error'; error: string }
type Source = 'claude' | 'detector'

function scoresFor(paras: Para[], claude?: AiTells, detector?: DetectorResult) {
  const out = paras.map(() => ({ claude: undefined as number | undefined, detector: undefined as number | undefined }))
  for (const p of claude?.paragraphs ?? []) {
    const i = findPara(paras, p.opening)
    if (i >= 0) out[i].claude = p.score
  }
  for (const p of detector?.paragraphs ?? []) {
    const i = findDetectorPara(paras, p.text)
    if (i >= 0) out[i].detector = Math.round(p.score)
  }
  return out
}

function ScoreCard({ title, source, load, score, note, children }: { title: string; source: string; load: Load<unknown>; score?: number; note?: string; children?: React.ReactNode }) {
  return (
    <div className={`score-card ${score !== undefined ? `band-${band(score)}` : ''}`}>
      <div className="score-title">{title}</div>
      {load.state === 'loading' && <p className="muted small">{note ?? 'Checking…'}</p>}
      {load.state === 'error' && <p className="error-text">{load.error}</p>}
      {load.state === 'idle' && <p className="muted small">Not run yet.</p>}
      {score !== undefined && (
        <>
          <div className="score-value">{score}<span>/100</span></div>
          <div className="score-band">{BAND_LABEL[band(score)]}</div>
        </>
      )}
      {children}
      <div className="score-source muted">{source}</div>
    </div>
  )
}

export function AiCheckPanel({ path, trigger, visible }: { path: string | null; trigger: number; visible: boolean }) {
  const [claude, setClaude] = useState<Load<AiTells>>({ state: 'idle' })
  const [detector, setDetector] = useState<Load<DetectorResult>>({ state: 'idle' })
  const [colorBy, setColorBy] = useState<Source>('detector')
  const [checkedPath, setCheckedPath] = useState<string | null>(null)
  const [firstRun, setFirstRun] = useState(false)

  const claudeData = claude.state === 'done' ? claude.data : undefined
  const detectorData = detector.state === 'done' ? detector.data : undefined
  const doc = getView()?.state.doc.toString() ?? ''
  const paras = checkedPath === path ? paragraphsOf(doc) : []
  const scores = scoresFor(paras, claudeData, detectorData)

  useEffect(() => {
    const view = getView()
    if (!view || checkedPath !== path) return
    const source = colorBy === 'detector' && detectorData ? 'detector' : 'claude'
    const spans = paras.flatMap((p, i) => {
      const s = scores[i][source]
      if (s === undefined) return []
      return [{ from: p.from, to: p.to, cls: `cm-ai-${band(s)}`, title: `Claude ${scores[i].claude ?? '–'}, detector ${scores[i].detector ?? '–'}` }]
    })
    view.dispatch({ effects: setSpans.of(spans) })
    // Re-applied when the tab is shown again: Review and Clawd use the same highlight layer.
  }, [claudeData, detectorData, colorBy, checkedPath, path, visible])

  const run = async () => {
    const view = getView()
    if (!view || !path?.match(/\.(md|txt)$/)) return toast('Open a note to check it.')
    const body = splitFrontmatter(view.state.doc.toString()).body
    if (body.trim().length < 50) return toast('Write at least a few sentences first; both checks need more text.')
    setCheckedPath(path)
    setClaude({ state: 'loading' })
    setDetector({ state: 'loading' })
    api.detector.status().then((s) => setFirstRun(s.firstRun), () => {})
    api.claude.aiTells(body).then((data) => setClaude({ state: 'done', data }), (e) => setClaude({ state: 'error', error: errorText(e) }))
    api.detector.score(body).then((data) => setDetector({ state: 'done', data }), (e) => setDetector({ state: 'error', error: errorText(e) }))
  }

  useEffect(() => {
    if (trigger) run()
  }, [trigger])

  const jump = (from: number, to: number) => {
    const view = getView()
    if (!view) return
    view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true })
    view.focus()
  }

  const rewrite = (quote: string, replacement: string) => {
    const view = getView()
    const text = view?.state.doc.toString() ?? ''
    const i = text.indexOf(quote)
    if (!view || i < 0) return toast('That text is no longer in the note.')
    if (!propose(view, text.slice(0, i) + replacement + text.slice(i + quote.length))) toast('Finish the open suggestion first.')
  }

  const busy = claude.state === 'loading' || detector.state === 'loading'
  const stale = checkedPath !== null && checkedPath !== path
  return (
    <div className="aicheck">
      <button className="primary" onClick={run} disabled={busy}>{busy ? 'Checking…' : 'Check this note'}</button>
      {stale && <p className="muted small">These results are for {checkedPath}. Check again for this note.</p>}
      {checkedPath && !stale && (
        <>
          <div className="score-cards">
            <ScoreCard title="Claude" source="Style reading by Claude" load={claude} score={claudeData?.overall_score} />
            <ScoreCard
              title="Local detector"
              source="SlopTotal, on this Mac"
              load={detector}
              score={detectorData ? Math.round(detectorData.overall_score) : undefined}
              note={firstRun ? 'Starting the detector. The very first check downloads its models and can take a few minutes.' : 'Starting the detector and scoring…'}
            />
          </div>
          {claudeData && <p className="aicheck-summary">{claudeData.summary}</p>}

          {paras.length > 0 && (claudeData || detectorData) && (
            <>
              <div className="color-by">
                <span className="muted small">Highlight paragraphs by</span>
                <div className="mode-toggle">
                  <button className={colorBy === 'claude' ? 'active' : ''} onClick={() => setColorBy('claude')}>Claude</button>
                  <button className={colorBy === 'detector' ? 'active' : ''} onClick={() => setColorBy('detector')} disabled={!detectorData}>Detector</button>
                </div>
              </div>
              <ol className="para-scores">
                {paras.map((p, i) => (
                  <li key={p.from} onClick={() => jump(p.from, p.to)} title="Show in the note">
                    <span className="para-text">{p.text.slice(0, 90)}</span>
                    <span className={`chip band-${scores[i].claude === undefined ? 'none' : band(scores[i].claude!)}`} title="Claude">C {scores[i].claude ?? '–'}</span>
                    <span className={`chip band-${scores[i].detector === undefined ? 'none' : band(scores[i].detector!)}`} title="Local detector">D {scores[i].detector ?? '–'}</span>
                  </li>
                ))}
              </ol>
            </>
          )}

          {claudeData?.tells.length ? (
            <>
              <h4 className="aicheck-heading">What reads as AI-written</h4>
              {claudeData.tells.map((t, i) => (
                <div key={i} className="finding">
                  <span className="badge">{t.pattern}</span>
                  <blockquote onClick={() => { const at = doc.indexOf(t.quote); if (at >= 0) jump(at, at + t.quote.length) }}>{t.quote}</blockquote>
                  <p>{t.explanation}</p>
                  {doc.includes(t.quote) && <button onClick={() => rewrite(t.quote, t.replacement)}>Propose rewrite</button>}
                </div>
              ))}
            </>
          ) : null}
          <p className="muted small">Neither score proves who wrote something. Both misfire on short passages, and detectors often flag formal or non-native English as AI.</p>
        </>
      )}
      {!checkedPath && <p className="muted small">Scores the open note twice: once by Claude, reading for AI-writing style, and once by SlopTotal, a detector running on this Mac. The two disagree often; that's useful.</p>}
    </div>
  )
}
