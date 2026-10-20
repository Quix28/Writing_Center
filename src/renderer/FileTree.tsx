import { useState } from 'react'
import type { TreeNode } from './api'
import { Icon, type IconName } from './icons'
import { fileKind } from './FileViewer'

type Props = {
  nodes: TreeNode[]
  active: string | null
  onOpen: (path: string) => void
  onNew: (folder: string, dir: boolean) => void
  onRename: (path: string) => void
  onDelete: (path: string) => void
  onGraph?: () => void
  onNewCanvas?: () => void
}

export const DRAG_TYPE = 'application/x-vault-path'

const label = (n: TreeNode) => (n.dir ? n.name : n.name.replace(/\.md$/, ''))

export function iconFor(node: { name: string; dir?: boolean }, open = false): IconName {
  if (node.dir) return open ? 'folderOpen' : 'folder'
  if (/\.(md|txt)$/i.test(node.name)) return 'note'
  if (node.name.endsWith('.canvas')) return 'canvas'
  return ({ image: 'image', pdf: 'pdf', docx: 'note', pptx: 'slides', other: 'file' } as const)[fileKind(node.name)]
}

function Row({ node, depth, ...p }: Props & { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(true)
  const icon = iconFor(node, open)
  return (
    <>
      <div
        className={`tree-row ${p.active === node.path ? 'active' : ''} ${node.dir ? 'dir' : ''}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        draggable={!node.dir}
        onDragStart={(e) => e.dataTransfer.setData(DRAG_TYPE, node.path)}
        onClick={() => (node.dir ? setOpen(!open) : p.onOpen(node.path))}
        title={node.path}
      >
        <Icon name={icon} size={15} />
        <span className="tree-name">{label(node)}</span>
        <span className="tree-actions" onClick={(e) => e.stopPropagation()}>
          {node.dir && (
            <>
              <button title="New note in this folder" aria-label="New note in this folder" onClick={() => p.onNew(node.path, false)}><Icon name="plus" size={13} /></button>
              <button title="New folder inside" aria-label="New folder inside" onClick={() => p.onNew(node.path, true)}><Icon name="newFolder" size={13} /></button>
            </>
          )}
          <button title="Rename or move" aria-label="Rename or move" onClick={() => p.onRename(node.path)}><Icon name="pencil" size={13} /></button>
          <button title="Move to Trash" aria-label="Move to Trash" onClick={() => p.onDelete(node.path)}><Icon name="trash" size={13} /></button>
        </span>
      </div>
      {node.dir && open && node.children?.map((c) => <Row key={c.path} {...p} node={c} depth={depth + 1} />)}
    </>
  )
}

export function FileTree(p: Props & { vaultName: string; onPickVault: () => void }) {
  return (
    <nav className="tree" aria-label="Vault files">
      <div className="vault-head">
        <button className="vault-name" onClick={p.onPickVault} title={`${p.vaultName}: open a different vault folder`}>
          <Icon name="vault" />
          <span>{p.vaultName}</span>
        </button>
      </div>
      <div className="tree-toolbar">
        <button onClick={() => p.onNew('', false)} title="New note"><Icon name="plus" size={14} /> Note</button>
        <button onClick={() => p.onNew('', true)} title="New folder"><Icon name="newFolder" size={14} /> Folder</button>
        <button onClick={p.onNewCanvas} title="New canvas (mind map)"><Icon name="canvas" size={14} /> Canvas</button>
        <button onClick={p.onGraph} title="Graph of wikilinks"><Icon name="graph" size={14} /> Graph</button>
      </div>
      <div className="tree-list">
        {p.nodes.length ? p.nodes.map((n) => <Row key={n.path} {...p} node={n} depth={0} />) : <p className="muted empty-hint">This vault is empty. Create your first note above.</p>}
      </div>
    </nav>
  )
}
