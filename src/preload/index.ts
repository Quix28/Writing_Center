import { contextBridge, ipcRenderer } from 'electron'

const invoke = (channel: string) => (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)
const on = (channel: string) => (cb: (payload: any) => void) => {
  const listener = (_e: unknown, payload: unknown) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.off(channel, listener)
}

const api = {
  vault: {
    current: invoke('vault:current'),
    pick: invoke('vault:pick'),
    tree: invoke('vault:tree'),
    read: invoke('vault:read'),
    write: invoke('vault:write'),
    create: invoke('vault:create'),
    move: invoke('vault:move'),
    trash: invoke('vault:trash'),
    notes: invoke('vault:notes'),
    onEvent: on('vault:event')
  },
  claude: {
    models: invoke('claude:models'),
    review: invoke('claude:review'),
    suggest: invoke('claude:suggest'),
    write: invoke('claude:write'),
    abort: invoke('claude:abort'),
    inspire: invoke('claude:inspire'),
    aiTells: invoke('claude:aiTells'),
    status: invoke('claude:status'),
    login: invoke('claude:login'),
    setKey: invoke('claude:setKey'),
    disconnect: invoke('claude:disconnect'),
    useSubscription: invoke('claude:useSubscription'),
    onDelta: on('claude:delta')
  },
  gdocs: {
    meta: invoke('gdocs:meta'),
    list: invoke('gdocs:list'),
    create: invoke('gdocs:create'),
    pull: invoke('gdocs:pull'),
    push: invoke('gdocs:push'),
    signOut: invoke('gdocs:signOut'),
    status: invoke('gdocs:status'),
    saveClient: invoke('gdocs:saveClient'),
    connect: invoke('gdocs:connect')
  },
  detector: {
    status: invoke('detector:status'),
    score: invoke('detector:score')
  },
  files: {
    docx: invoke('files:docx'),
    pptx: invoke('files:pptx'),
    open: invoke('files:open'),
    reveal: invoke('files:reveal')
  },
  settings: {
    get: invoke('settings:get'),
    set: invoke('settings:set')
  }
}

contextBridge.exposeInMainWorld('api', api)
