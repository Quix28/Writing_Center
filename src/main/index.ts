import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, shell, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import * as vault from './vault'
import { loadSettings, saveSettings, type Settings } from './settings'
import * as claude from './claude'
import * as gdocs from './gdocs'
import * as files from './files'
import * as detector from './detector'
import * as terminal from './terminal'

if (process.env.WC_USER_DATA) app.setPath('userData', process.env.WC_USER_DATA)
protocol.registerSchemesAsPrivileged([files.VAULT_SCHEME])
/** Tests run with WC_HEADLESS=1: window never shown, no Dock icon, never takes focus. */
const headless = process.env.WC_HEADLESS === '1'
// Tests must never touch the user's real Keychain (or trigger its password prompt).
if (headless) app.commandLine.appendSwitch('use-mock-keychain')

let win: BrowserWindow

async function openVault(dir: string) {
  await vault.openVault(dir, (e) => win.webContents.send('vault:event', e))
  saveSettings({ vault: dir })
  return dir
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#1e1e1e',
    title: 'Writing Centre',
    show: !headless,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  // Right-click: macOS spelling suggestions (used for non-English notes) plus the usual edit commands.
  win.webContents.on('context-menu', (_e, params) => {
    const items: MenuItemConstructorOptions[] = params.dictionarySuggestions.map((word) => ({ label: word, click: () => win.webContents.replaceMisspelling(word) }))
    if (params.misspelledWord) {
      if (!items.length) items.push({ label: 'No suggestions', enabled: false })
      items.push({ label: 'Add to Dictionary', click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) }, { type: 'separator' })
    }
    if (params.isEditable) items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' })
    else if (params.selectionText) items.push({ role: 'copy' })
    if (!items.length) return
    // Headless tests must never show a native menu (it would appear on the user's screen); they read it from here instead.
    if (headless) (globalThis as { wcLastMenu?: unknown }).wcLastMenu = { word: params.misspelledWord, items: items.map((i) => i.label ?? i.role ?? i.type) }
    else Menu.buildFromTemplate(items).popup({ window: win })
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

const handle = (channel: string, fn: (...args: any[]) => unknown) =>
  ipcMain.handle(channel, (_e, ...args) => fn(...args))

handle('vault:current', async () => {
  const dir = process.env.WC_VAULT ?? loadSettings().vault
  if (!dir) return null
  return openVault(dir).catch(() => null)
})
handle('vault:pick', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
  return r.canceled ? null : openVault(r.filePaths[0])
})
handle('vault:tree', vault.tree)
handle('vault:read', vault.read)
handle('vault:write', vault.write)
handle('vault:create', vault.create)
handle('vault:move', vault.move)
handle('vault:trash', async (rel: string) => shell.trashItem(await vault.pathFor(rel)))
handle('vault:notes', vault.readAllNotes)
handle('files:docx', files.docxHtml)
handle('files:pptx', files.pptxOutline)
handle('files:open', files.openExternal)
handle('files:reveal', files.reveal)
handle('settings:get', loadSettings)
/** The renderer may change only these; the vault changes through the native folder picker, auth through Connections. */
handle('settings:set', (patch: Partial<Settings>) => {
  const allowed: Partial<Settings> = {}
  if (typeof patch?.model === 'string' && /^[a-z0-9][a-z0-9.-]{0,63}$/i.test(patch.model)) allowed.model = patch.model
  if (typeof patch?.clawd === 'boolean') allowed.clawd = patch.clawd
  return saveSettings(allowed)
})
handle('claude:models', claude.listModels)
handle('claude:review', claude.review)
handle('claude:suggest', claude.suggest)
handle('claude:write', (id: string, args) => claude.write(id, args, (text) => win.webContents.send('claude:delta', { id, text })))
handle('claude:abort', claude.abort)
handle('claude:inspire', claude.inspire)
handle('claude:aiTells', claude.aiTells)
handle('detector:status', detector.status)
handle('detector:score', detector.score)
ipcMain.handle('term:start', (e, size: { cols: number; rows: number }) => terminal.start(e.sender, size))
handle('term:write', terminal.write)
handle('term:resize', terminal.resize)
handle('term:kill', terminal.kill)
handle('gdocs:meta', gdocs.meta)
handle('gdocs:list', gdocs.list)
handle('gdocs:create', gdocs.create)
handle('gdocs:pull', gdocs.pull)
handle('gdocs:push', gdocs.push)
handle('gdocs:signOut', gdocs.signOut)
handle('gdocs:status', gdocs.status)
handle('gdocs:saveClient', gdocs.saveClient)
handle('gdocs:connect', gdocs.connect)
handle('claude:status', claude.status)
handle('claude:login', claude.browserLogin)
handle('claude:setKey', claude.setKey)
handle('claude:disconnect', claude.disconnect)
handle('claude:useSubscription', claude.useSubscription)

app.whenReady().then(() => {
  if (headless && process.platform === 'darwin') app.setActivationPolicy('accessory')
  files.registerVaultProtocol()
  createWindow()
})
app.on('window-all-closed', () => app.quit())
