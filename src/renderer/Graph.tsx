import { useMemo } from 'react'
import { ReactFlow, Background, Controls, type Edge, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { extractLinks, resolveLink } from '../shared/links'

type P = { x: number; y: number }

/** ponytail: naive O(n²) force layout, fine for a few hundred notes; swap in d3-force if vaults get large. */
export function forceLayout(ids: string[], links: [string, string][], iterations = 300): Map<string, P> {
  const pos = new Map<string, P>(ids.map((id, i) => [id, { x: Math.cos(i * 2.4) * 30 * Math.sqrt(i + 1), y: Math.sin(i * 2.4) * 30 * Math.sqrt(i + 1) }]))
  const k = 240
  for (let it = 0; it < iterations; it++) {
    const step = 20 * (1 - it / iterations) + 1
    const force = new Map<string, P>(ids.map((id) => [id, { x: 0, y: 0 }]))
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos.get(ids[i])!, b = pos.get(ids[j])!
        const dx = a.x - b.x, dy = a.y - b.y
        const d2 = Math.max(dx * dx + dy * dy, 1)
        const f = (k * k) / d2
        force.get(ids[i])!.x += dx * f; force.get(ids[i])!.y += dy * f
        force.get(ids[j])!.x -= dx * f; force.get(ids[j])!.y -= dy * f
      }
    for (const [s, t] of links) {
      const a = pos.get(s)!, b = pos.get(t)!
      const dx = a.x - b.x, dy = a.y - b.y
      const d = Math.max(Math.hypot(dx, dy), 1)
      const f = d / k
      force.get(s)!.x -= dx * f; force.get(s)!.y -= dy * f
      force.get(t)!.x += dx * f; force.get(t)!.y += dy * f
    }
    for (const id of ids) {
      const p = pos.get(id)!, f = force.get(id)!
      f.x -= p.x * 0.01; f.y -= p.y * 0.01
      const len = Math.max(Math.hypot(f.x, f.y), 1e-9)
      p.x += (f.x / len) * Math.min(len, step)
      p.y += (f.y / len) * Math.min(len, step)
    }
  }
  return pos
}

export function Graph({ notes, files, onOpen }: { notes: Record<string, string>; files: string[]; onOpen: (p: string) => void }) {
  const { nodes, edges } = useMemo(() => {
    const ids = Object.keys(notes)
    const seen = new Set<string>()
    const links: [string, string][] = []
    for (const src of ids)
      for (const t of extractLinks(notes[src])) {
        const dst = resolveLink(t, files)
        const key = `${src}->${dst}`
        if (dst && dst !== src && !seen.has(key)) {
          seen.add(key)
          links.push([src, dst])
        }
      }
    const pos = forceLayout(ids, links)
    const nodes: Node[] = ids.map((id) => ({
      id,
      position: pos.get(id)!,
      data: { label: id.split('/').pop()!.replace(/\.md$/, '') },
      className: 'graph-node',
      connectable: false
    }))
    const edges: Edge[] = links.map(([s, t]) => ({ id: `${s}->${t}`, source: s, target: t, type: 'straight' }))
    return { nodes, edges }
  }, [notes, files])

  return (
    <div className="canvas">
      <ReactFlow nodes={nodes} edges={edges} colorMode="dark" fitView nodesConnectable={false} onNodeDoubleClick={(_, n) => onOpen(n.id)} onNodeClick={(_, n) => onOpen(n.id)}>
        <Background />
        <Controls />
      </ReactFlow>
      <div className="canvas-hint muted">Built from [[wikilinks]] · click a note to open it</div>
    </div>
  )
}
