import type { TreeNode, VaultEvent } from '../main/vault'
import type { Settings } from '../main/settings'
import type { AiTells, ChatTurn, ClaudeStatus, Edit, Finding, Inspiration } from '../main/claude'
import type { DetectorResult } from '../main/detector'
import type { DocMeta, GoogleStatus } from '../main/gdocs'

export type { TreeNode, VaultEvent, Settings, ChatTurn, Edit, Finding, Inspiration, DocMeta, ClaudeStatus, GoogleStatus, AiTells, DetectorResult }

type Api = {
  vault: {
    current(): Promise<string | null>
    pick(): Promise<string | null>
    tree(): Promise<TreeNode[]>
    read(path: string): Promise<string>
    write(path: string, content: string): Promise<void>
    create(path: string, dir: boolean): Promise<void>
    move(from: string, to: string): Promise<void>
    trash(path: string): Promise<void>
    notes(): Promise<Record<string, string>>
    onEvent(cb: (e: VaultEvent) => void): () => void
  }
  claude: {
    models(): Promise<{ id: string; name: string }[]>
    review(path: string, text: string, withLinks?: boolean): Promise<Finding[]>
    suggest(a: { path: string; text: string; selection?: string; instruction: string; history: ChatTurn[] }): Promise<{ reply: string; edits: Edit[] }>
    write(id: string, a: { path: string; text: string; target: string; instruction: string; history: ChatTurn[] }): Promise<string>
    abort(id: string): Promise<void>
    inspire(a: { passage: string; issue: string }): Promise<Inspiration[]>
    aiTells(text: string): Promise<AiTells>
    status(): Promise<ClaudeStatus>
    login(): Promise<ClaudeStatus>
    setKey(key: string): Promise<ClaudeStatus>
    disconnect(): Promise<ClaudeStatus>
    useSubscription(): Promise<ClaudeStatus>
    onDelta(cb: (d: { id: string; text: string }) => void): () => void
  }
  gdocs: {
    meta(id: string): Promise<DocMeta>
    list(query: string): Promise<DocMeta[]>
    create(title: string): Promise<string>
    pull(id: string): Promise<{ markdown: string; modifiedTime: string }>
    push(id: string, markdown: string): Promise<{ modifiedTime: string }>
    signOut(): Promise<void>
    status(): Promise<GoogleStatus>
    saveClient(clientId: string, clientSecret: string): Promise<GoogleStatus>
    connect(): Promise<GoogleStatus>
  }
  term: {
    start(size: { cols: number; rows: number }): Promise<string>
    write(id: string, data: string): Promise<void>
    resize(id: string, cols: number, rows: number): Promise<void>
    kill(id: string): Promise<void>
    onData(cb: (d: { id: string; data: string }) => void): () => void
    onExit(cb: (d: { id: string; exitCode: number }) => void): () => void
  }
  detector: {
    status(): Promise<{ installed: boolean; running: boolean; firstRun: boolean }>
    score(text: string): Promise<DetectorResult>
  }
  files: {
    docx(path: string): Promise<string>
    pptx(path: string): Promise<{ slide: number; lines: string[] }[]>
    open(path: string): Promise<void>
    reveal(path: string): Promise<void>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
}

export const api = (window as unknown as { api: Api }).api

export const errorText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
