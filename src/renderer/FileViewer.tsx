import { useEffect, useState } from 'react'
import { api, errorText } from './api'
import { Icon } from './icons'

/** Mirrors the main process allowlist; the main process enforces it. */
export const OPENABLE = /\.(md|txt|rtf|pdf|png|jpe?g|gif|webp|heic|bmp|tiff?|svg|docx?|pptx?|xlsx?|csv|odt|ods|odp|pages|key|numbers|epub|mp3|m4a|wav|mp4|mov)$/i
export const IMAGE = /\.(png|jpe?g|gif|webp|bmp|svg|heic)$/i
export const vaultUrl = (path: string) => `vault://f/${path.split('/').map(encodeURIComponent).join('/')}`
export const fileKind = (path: string) =>
  IMAGE.test(path) ? 'image' : /\.pdf$/i.test(path) ? 'pdf' : /\.docx?$/i.test(path) ? 'docx' : /\.pptx$/i.test(path) ? 'pptx' : 'other'

function Docx({ path }: { path: string }) {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setHtml(null)
    api.files.docx(path).then(setHtml, (e) => setError(errorText(e)))
  }, [path])
  if (error) return <p className="muted viewer-note">Could not convert this document: {error}</p>
  if (html === null) return <p className="muted viewer-note">Converting…</p>
  // sandbox with no permissions: the converted document can show text and styles but never run scripts.
  return <iframe className="viewer-frame paper" sandbox="" srcDoc={html} title={path} />
}

function Pptx({ path }: { path: string }) {
  const [slides, setSlides] = useState<{ slide: number; lines: string[] }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setSlides(null)
    api.files.pptx(path).then(setSlides, (e) => setError(errorText(e)))
  }, [path])
  if (error) return <p className="muted viewer-note">Could not read this presentation: {error}</p>
  if (!slides) return <p className="muted viewer-note">Reading slides…</p>
  return (
    <div className="slides">
      <p className="muted small">Text of each slide. Open the file in Keynote or PowerPoint to see the design.</p>
      {slides.map((s) => (
        <section key={s.slide} className="slide-card">
          <span className="slide-number">Slide {s.slide}</span>
          {s.lines.length ? s.lines.map((l, i) => (i === 0 ? <h3 key={i}>{l}</h3> : <p key={i}>{l}</p>)) : <p className="muted">No text on this slide.</p>}
        </section>
      ))}
    </div>
  )
}

/** Read-only view for anything that isn't a note or canvas, with a way out to the default app. */
export function FileViewer({ path }: { path: string }) {
  const kind = fileKind(path)
  const name = path.split('/').pop()!
  return (
    <div className="viewer">
      <div className="viewer-bar">
        <span className="viewer-name">{name}</span>
        {OPENABLE.test(path) ? (
          <button onClick={() => api.files.open(path).catch((e) => alert(errorText(e)))}>Open in default app</button>
        ) : (
          <button onClick={() => api.files.reveal(path)}>Show in Finder</button>
        )}
      </div>
      <div className="viewer-body">
        {kind === 'image' && <img className="viewer-image" src={vaultUrl(path)} alt={name} />}
        {kind === 'pdf' && <iframe className="viewer-frame" src={vaultUrl(path)} title={name} />}
        {kind === 'docx' && <Docx path={path} />}
        {kind === 'pptx' && <Pptx path={path} />}
        {kind === 'other' && (
          <div className="empty">
            <Icon name="file" size={28} />
            <p>Writing Centre can't preview this kind of file{OPENABLE.test(path) ? '.' : ", and won't open it directly in case it is a program."}</p>
            {OPENABLE.test(path) ? (
              <button className="primary" onClick={() => api.files.open(path)}>Open in default app</button>
            ) : (
              <button className="primary" onClick={() => api.files.reveal(path)}>Show in Finder</button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
