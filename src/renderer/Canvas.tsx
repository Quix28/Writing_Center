import { createContext, useCallback, useContext, useEffect, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  NodeResizer,
  Position,
  ConnectionMode,
  MarkerType,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { api, errorText } from './api'
import { toast } from './ui'
import { DRAG_TYPE } from './FileTree'
import { extraFlushers } from './Editor'

/** JSON Canvas 1.0 (https://jsoncanvas.org), the format Obsidian reads. Unknown fields are carried through untouched. */
type Side = 'top' | 'right' | 'bottom' | 'left'
type CNode = { id: string; type: string; x: number; y: number; width: number; height: number; text?: string; file?: string; [k: string]: unknown }
type CEdge = { id: string; fromNode: string; toNode: string; fromSide?: Side; toSide?: Side; [k: string]: unknown }
type CanvasDoc = { nodes?: CNode[]; edges?: CEdge[]; [k: string]: unknown }
type Data = { c: CNode }

const SIDES: Side[] = ['top', 'right', 'bottom', 'left']
const POSITION = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left }
const SAVE_DELAY = 500
const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16)

type Ctx = { open: (path: string) => void; notes: Record<string, string>; setText: (id: string, text: string) => void }
const CanvasCtx = createContext<Ctx>({ open: () => {}, notes: {}, setText: () => {} })

const Handles = () => SIDES.map((s) => <Handle key={s} id={s} type="source" position={POSITION[s]} />)

function FileNode({ data, selected }: NodeProps<Node<Data>>) {
  const { open, notes } = useContext(CanvasCtx)
  const file = data.c.file ?? ''
  const body = notes[file]
  return (
    <div className="cv-wrap" onDoubleClick={() => open(file)} title="Double-click to open">
      <NodeResizer isVisible={selected} minWidth={120} minHeight={50} />
      <Handles />
      <div className={`cv-node cv-file ${body === undefined && file.endsWith('.md') ? 'missing' : ''}`}>
        <div className="cv-title">{file.split('/').pop()?.replace(/\.md$/, '')}</div>
        {body !== undefined && <div className="cv-preview">{body.slice(0, 400)}</div>}
      </div>
    </div>
  )
}

function TextNode({ id, data, selected }: NodeProps<Node<Data>>) {
  const { setText } = useContext(CanvasCtx)
  const [editing, setEditing] = useState(!data.c.text && data.c.type === 'text')
  const label = data.c.text ?? (data.c.url as string) ?? (data.c.label as string) ?? data.c.type
  return (
    <div className="cv-wrap" onDoubleClick={() => data.c.type === 'text' && setEditing(true)}>
      <NodeResizer isVisible={selected} minWidth={80} minHeight={40} />
      <Handles />
      <div className="cv-node cv-text">
      {editing ? (
        <textarea
          className="nodrag"
          autoFocus
          defaultValue={data.c.text}
          onBlur={(e) => {
            setText(id, e.target.value)
            setEditing(false)
          }}
          onKeyDown={(e) => e.key === 'Escape' && (e.target as HTMLTextAreaElement).blur()}
        />
      ) : (
        <div className="cv-body">{label}</div>
      )}
      </div>
    </div>
  )
}

const nodeTypes = { file: FileNode, text: TextNode }

const toFlowNode = (c: CNode): Node<Data> => ({
  id: c.id,
  type: c.type === 'file' ? 'file' : 'text',
  position: { x: c.x, y: c.y },
  width: c.width,
  height: c.height,
  data: { c }
})

const toFlowEdge = (c: CEdge): Edge => ({
  id: c.id,
  source: c.fromNode,
  target: c.toNode,
  sourceHandle: c.fromSide ?? null,
  targetHandle: c.toSide ?? null,
  markerEnd: { type: MarkerType.ArrowClosed },
  label: c.label as string | undefined,
  data: { c }
})

function serialize(base: CanvasDoc, nodes: Node<Data>[], edges: Edge[]): string {
  const doc: CanvasDoc = {
    ...base,
    nodes: nodes.map((n) => ({
      ...n.data.c,
      id: n.id,
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
      width: Math.round(n.width ?? n.measured?.width ?? n.data.c.width),
      height: Math.round(n.height ?? n.measured?.height ?? n.data.c.height)
    })),
    edges: edges.map((e) => {
      const c: CEdge = { ...((e.data?.c as CEdge) ?? {}), id: e.id, fromNode: e.source, toNode: e.target }
      if (e.sourceHandle) c.fromSide = e.sourceHandle as Side
      if (e.targetHandle) c.toSide = e.targetHandle as Side
      return c
    })
  }
  return JSON.stringify(doc, null, '\t')
}

function Inner({ path, notes, onOpen }: { path: string; notes: Record<string, string>; onOpen: (p: string) => void }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<Data>>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<{ fit: boolean } | null>(null)
  const base = useRef<CanvasDoc>({})
  const lastText = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pending = useRef<{ text: string; flush: () => Promise<void> } | null>(null)
  const { screenToFlowPosition } = useReactFlow()

  const load = useCallback((text: string) => {
    try {
      const doc: CanvasDoc = text.trim() ? JSON.parse(text) : {}
      const [ns, es] = [(doc.nodes ?? []).map(toFlowNode), (doc.edges ?? []).map(toFlowEdge)]
      base.current = doc
      lastText.current = serialize(doc, ns, es)
      setNodes(ns)
      setEdges(es)
      setLoaded((l) => l ?? { fit: ns.length > 0 })
      setError(null)
    } catch (e) {
      lastText.current = null
      setError(`This .canvas file is not valid JSON, so it is shown read-only: ${errorText(e)}`)
    }
  }, [setNodes, setEdges])

  useEffect(() => {
    lastText.current = null
    api.vault.read(path).then(load, (e) => setError(errorText(e)))
    const off = api.vault.onEvent((e) => {
      if (e.type === 'change' && e.path === path && !pending.current) load(e.content)
    })
    return () => {
      off()
      pending.current?.flush()
    }
  }, [path, load])

  useEffect(() => {
    if (lastText.current === null) return
    const text = serialize(base.current, nodes, edges)
    if (text === lastText.current || text === pending.current?.text) return
    clearTimeout(timer.current)
    const flush = async () => {
      clearTimeout(timer.current)
      extraFlushers.delete(flush)
      if (pending.current?.flush === flush) pending.current = null
      try {
        await api.vault.write(path, text)
        lastText.current = text
      } catch (e) {
        toast(`Could not save ${path}: ${errorText(e)}`)
      }
    }
    if (pending.current) extraFlushers.delete(pending.current.flush)
    pending.current = { text, flush }
    extraFlushers.add(flush)
    timer.current = setTimeout(flush, SAVE_DELAY)
  }, [nodes, edges, path])

  const addNode = (c: Omit<CNode, 'id'>) => setNodes((ns) => [...ns, toFlowNode({ id: newId(), ...c } as CNode)])

  const onDrop = (e: DragEvent) => {
    const file = e.dataTransfer.getData(DRAG_TYPE)
    if (!file) return
    e.preventDefault()
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    addNode({ type: 'file', file, x: Math.round(p.x), y: Math.round(p.y), width: 260, height: 140 })
  }

  const onPaneDoubleClick = (e: MouseEvent) => {
    if (!(e.target as HTMLElement).classList.contains('react-flow__pane')) return
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    addNode({ type: 'text', text: '', x: Math.round(p.x), y: Math.round(p.y), width: 250, height: 80 })
  }

  const setText = (id: string, text: string) =>
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { c: { ...n.data.c, text } } } : n)))

  const onConnect = (c: Connection) =>
    setEdges((es) => addEdge({ ...c, id: newId(), markerEnd: { type: MarkerType.ArrowClosed } }, es))

  if (error) return <div className="empty muted">{error}</div>
  if (!loaded) return null

  return (
    <CanvasCtx.Provider value={{ open: onOpen, notes, setText }}>
      <div className="canvas" onDragOver={(e) => e.preventDefault()} onDrop={onDrop} onDoubleClick={onPaneDoubleClick}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          connectionMode={ConnectionMode.Loose}
          zoomOnDoubleClick={false}
          colorMode="dark"
          fitView={loaded.fit}
          fitViewOptions={{ maxZoom: 1 }}
          deleteKeyCode={['Backspace', 'Delete']}
        >
          <Background />
          <Controls />
        </ReactFlow>
        <div className="canvas-hint muted">Drag notes here · double-click empty space for a text card · drag between handles to connect</div>
      </div>
    </CanvasCtx.Provider>
  )
}

export function Canvas(props: { path: string; notes: Record<string, string>; onOpen: (p: string) => void }) {
  return (
    <ReactFlowProvider>
      <Inner key={props.path} {...props} />
    </ReactFlowProvider>
  )
}
