import { app, BrowserWindow, clipboard, ipcMain, Menu, Notification, screen, shell, Tray, nativeImage } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import appIcon from '../../build/icon.png?asset'
import type { ChatMsg, HardwareInfo, Lang, TransLang, PillState, RewriteRequest, SecretName, Settings } from '@shared/types'
import { detectHardware, listOllamaModels, recommend } from './hardware'
import { installOllama, startOllama } from './ollama-setup'
import { complete, generate, pullOllamaModel, rewriteGuarded, testLLM, translate, warmLLM, type ContentAction } from './llm'
import { clearNetEvents, getNetEvents } from './netlog'
import { exportNote, launchAgent, openFileDialog, pickDir, readProjectContext, saveFileDialog } from './tools'
import { installPiper, installVoice, synthesize, ttsStatus, VOICES } from './tts'
import { startSystemAudio, stopSystemAudio } from './sysaudio'
import { runUninstall, uninstallInfo } from './uninstall'
import { applyUpdate, checkUpdate } from './updater'
import { type Collection, dataDir, getCollection, getHistory, saveCollection, getSettings, hasSecret, saveHistory, saveSettings, setSecret } from './store'
import { applyDictionary, benchStt, downloadGgml, loadStt, sttStatus, stopStt, transcribe, transcribeDetailed } from './stt'

// AppImage no puede instalar chrome-sandbox con setuid. Si el sistema restringe los user namespaces
// (Ubuntu 24.04+, Debian) Chromium abortaría al arrancar, así que solo en ese caso se desactiva su sandbox.
function userNamespacesRestricted(): boolean {
  const read = (f: string): string => { try { return readFileSync(f, 'utf8').trim() } catch { return '' } }
  return read('/proc/sys/kernel/apparmor_restrict_unprivileged_userns') === '1' || read('/proc/sys/kernel/unprivileged_userns_clone') === '0'
}
if (process.env.APPIMAGE && userNamespacesRestricted()) app.commandLine.appendSwitch('no-sandbox')

let win: BrowserWindow | null = null
let pill: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

// Una sola instancia: `dictaflow --toggle` (atajo de GNOME) alterna el dictado de la instancia viva.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => handleArgs(argv))
}

function handleArgs(argv: string[]): void {
  if (argv.includes('--toggle')) win?.webContents.send('dictation:toggle')
  else showWindow()
}

function showWindow(): void {
  if (!win) return
  win.show()
  win.focus()
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1100, height: 820, minWidth: 820, minHeight: 600, show: false,
    title: 'DictaFlow', backgroundColor: '#1f1f1f', icon: appIcon,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true }
  })
  win.setMenuBarVisibility(false)
  win.once('ready-to-show', () => { if (!process.argv.includes('--toggle')) win?.show() })
  win.on('close', (e) => {
    if (!quitting && tray) { e.preventDefault(); win?.hide() }
  })
  win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' } })
  load(win, 'index.html')
}

function load(w: BrowserWindow, page: string): void {
  if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${page}`)
  else void w.loadFile(join(__dirname, `../renderer/${page}`))
}

function createPill(): void {
  const { workArea } = screen.getPrimaryDisplay()
  pill = new BrowserWindow({
    width: 280, height: 56, x: workArea.x + Math.round((workArea.width - 280) / 2), y: workArea.y + 24,
    frame: false, transparent: true, resizable: false, focusable: false, alwaysOnTop: true, skipTaskbar: true, show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true }
  })
  pill.setAlwaysOnTop(true, 'screen-saver')
  load(pill, 'pill.html')
}

function createTray(): void {
  try {
    const icon = nativeImage.createFromPath(appIcon).resize({ width: 22, height: 22 })
    tray = new Tray(icon)
    tray.setToolTip('DictaFlow')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Mostrar DictaFlow', click: showWindow },
      { label: 'Dictar (alternar)', click: () => win?.webContents.send('dictation:toggle') },
      { type: 'separator' },
      { label: 'Salir', click: () => { quitting = true; app.quit() } }
    ]))
    tray.on('click', showWindow)
  } catch {
    tray = null
  }
}

function registerIpc(): void {
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_e, patch: Partial<Settings>) => saveSettings(patch))
  ipcMain.handle('secret:set', (_e, name: SecretName, value: string) => setSecret(name, value))
  ipcMain.handle('secret:has', (_e, name: SecretName) => hasSecret(name))

  ipcMain.handle('hw:detect', async () => {
    const hw = await detectHardware()
    return { hw, recs: recommend(hw) }
  })
  ipcMain.handle('ollama:list', (_e, base?: string) => listOllamaModels(base))
  ipcMain.handle('ollama:install', (e) => installOllama(e.sender))
  ipcMain.handle('ollama:start', () => startOllama())
  ipcMain.handle('ollama:pull', async (e, name: string) => {
    await pullOllamaModel(name, (pct, status) => e.sender.send('ollama:pull-progress', { name, pct, status }))
  })

  ipcMain.handle('stt:load', async (e) => {
    await loadStt((p) => e.sender.send('stt:progress', p))
  })
  ipcMain.handle('stt:status', () => sttStatus())
  ipcMain.handle('stt:bench', () => benchStt())
  ipcMain.handle('stt:download-ggml', (e, id: string) => downloadGgml(id, (p) => e.sender.send('stt:progress', p)))
  ipcMain.handle('stt:transcribe', (_e, pcm: Float32Array, lang: TransLang | 'auto') => transcribe(pcm, lang))

  ipcMain.handle('stt:detailed', (_e, pcm: Float32Array, lang: TransLang | 'auto', timestamps: boolean) => transcribeDetailed(pcm, lang, timestamps))
  ipcMain.handle('dict:apply', (_e, text: string) => applyDictionary(text))

  ipcMain.handle('llm:rewrite', (e, req: RewriteRequest) => {
    const st = getSettings()
    // Modo programador: el contexto del repo y el destino los resuelve el proceso principal
    if (req.mode !== 'rewrite') req = { ...req, target: st.promptTarget, projectContext: readProjectContext(st.projectDir) || undefined }
    return rewriteGuarded(req).then((r) => {
      if (r.reverted) e.sender.send('llm:notice', 'La redacción cambiaba cifras u horas: se conservó el texto dictado.')
      return r.text
    })
  })
  ipcMain.handle('llm:warm', () => warmLLM().catch(() => undefined))
  ipcMain.handle('llm:chat', (_e, system: string, msgs: ChatMsg[]) => complete(system, msgs, 0.6))
  ipcMain.handle('llm:translate', (_e, text: string, to: TransLang) => translate(text, to))
  ipcMain.handle('llm:generate', (_e, action: ContentAction, text: string, lang: Lang) => generate(action, text, lang))

  ipcMain.handle('col:get', (_e, name: Collection) => getCollection(name))
  ipcMain.handle('col:save', (_e, name: Collection, items: unknown[]) => saveCollection(name, items))

  ipcMain.handle('tts:status', () => ({ ...ttsStatus(), catalog: VOICES }))
  ipcMain.handle('tts:install-piper', (e) => installPiper((what, pct) => e.sender.send('tts:progress', { what, pct })))
  ipcMain.handle('tts:install-voice', (e, id: string) => installVoice(id, (what, pct) => e.sender.send('tts:progress', { what, pct })))
  ipcMain.handle('tts:synth', async (_e, text: string, lang: Lang) => new Uint8Array(await synthesize(text, lang)))

  ipcMain.handle('project:pick', async () => {
    const dir = await pickDir('Carpeta del proyecto')
    if (dir) saveSettings({ projectDir: dir })
    return dir
  })
  ipcMain.handle('vault:pick', async () => {
    const dir = await pickDir('Carpeta de notas (Obsidian, Logseq…)')
    if (dir) saveSettings({ vaultDir: dir })
    return dir
  })
  ipcMain.handle('project:context', () => readProjectContext(getSettings().projectDir))
  ipcMain.handle('agent:launch', (_e, agent: 'claude-code' | 'opencode', prompt: string) => launchAgent(agent, getSettings().projectDir, prompt))
  ipcMain.handle('note:export', (_e, title: string, body: string, tags: string[]) => exportNote(title, body, tags))
  ipcMain.handle('file:save', (_e, name: string, data: Uint8Array | string) => saveFileDialog(name, typeof data === 'string' ? data : Buffer.from(data)))
  ipcMain.handle('file:open', async (_e, title: string, exts: string[]) => {
    const f = await openFileDialog(title, exts)
    return f ? { name: f.name, data: new Uint8Array(f.data) } : null
  })
  ipcMain.handle('sysaudio:start', (e) => startSystemAudio(e.sender))
  ipcMain.handle('sysaudio:stop', () => stopSystemAudio())
  ipcMain.handle('llm:test', () => testLLM())

  ipcMain.handle('history:get', () => getHistory())
  ipcMain.handle('history:save', (_e, items) => saveHistory(items))

  ipcMain.handle('net:events', () => ({ events: getNetEvents(), dataDir }))
  ipcMain.handle('net:clear', () => clearNetEvents())
  ipcMain.handle('app:launch-cmd', () => {
    if (process.env.APPIMAGE) return `"${process.env.APPIMAGE}" --toggle` // execPath cambia en cada ejecución del AppImage
    if (!app.isPackaged) return `"${process.execPath}" "${app.getAppPath()}" --toggle`
    return existsSync('/usr/bin/dictaflow') ? 'dictaflow --toggle' : `"${process.execPath}" --toggle`
  })
  ipcMain.handle('update:check', () => checkUpdate())
  ipcMain.handle('update:apply', (e) => applyUpdate(e.sender))
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('uninstall:info', () => uninstallInfo())
  ipcMain.handle('uninstall:run', (_e, removeData: boolean) => runUninstall(removeData))
  ipcMain.handle('app:open-data-dir', () => shell.openPath(dataDir))

  ipcMain.handle('clipboard:write', (_e, text: string) => clipboard.writeText(text))
  ipcMain.handle('notify', (_e, title: string, body: string) => {
    if (Notification.isSupported()) new Notification({ title, body, silent: true }).show()
  })
  ipcMain.handle('pill:set', (_e, s: PillState) => {
    if (!pill) return
    pill.webContents.send('pill:state', s)
    if (s.state === 'idle') pill.hide()
    else pill.showInactive()
    if (s.state === 'done' || s.state === 'error') setTimeout(() => pill?.hide(), 2200)
  })
}

app.whenReady().then(() => {
  // Wayland: intenta usar ozone nativo; sin permisos extra ni atajos globales
  registerIpc()
  createWindow()
  createPill()
  createTray()
  handleArgs(process.argv)
})

app.on('before-quit', () => { quitting = true; stopStt(); stopSystemAudio() })
app.on('window-all-closed', () => { if (!tray) app.quit() })

export type { HardwareInfo }
