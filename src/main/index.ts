import { app, BrowserWindow, clipboard, ipcMain, Menu, Notification, screen, shell, Tray, nativeImage, type IpcMainInvokeEvent } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import appIcon from '../../build/icon.png?asset'
import type { HardwareInfo } from '@shared/types'
import type { IpcChannel, IpcReq, IpcRes } from '@shared/ipc'
import { detectHardware, listOllamaModels, recommend } from './hardware'
import { installOllama, startOllama } from './ollama-setup'
import { complete, generate, pullOllamaModel, rewriteGuarded, testLLM, translate, warmLLM, type ContentAction } from './llm'
import { clearNetEvents, getNetEvents } from './netlog'
import { exportNote, launchAgent, openFileDialog, pickDir, readProjectContext, saveFileDialog } from './tools'
import { fetchVoiceSample, installPiper, installVoice, removeVoice, synthesize, ttsStatus } from './tts'
import { voiceStatus } from './catalog/voices'
import { startSystemAudio, stopSystemAudio } from './sysaudio'
import { runUninstall, uninstallInfo } from './uninstall'
import { applyUpdate, checkUpdate } from './updater'
import { type Collection, dataDir, flushSettings, getCollection, getHistory, saveCollection, getSettings, hasSecret, saveHistory, saveSettings, setSecret } from './store'
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

/**
 * Registra un canal IPC con su firma. El nombre del canal y la forma de los
 * argumentos salen de `src/shared/ipc.ts`: si no coinciden, no compila.
 */
function handle<K extends IpcChannel>(
  channel: K,
  fn: (e: IpcMainInvokeEvent, req: IpcReq<K>) => IpcRes<K> | Promise<IpcRes<K>>
): void {
  ipcMain.handle(channel, (e, req) => fn(e, req as IpcReq<K>))
}

function registerIpc(): void {
  handle('settings:get', () => getSettings())
  handle('settings:save', (_e, patch) => saveSettings(patch))
  handle('secret:set', (_e, { name, value }) => setSecret(name, value))
  handle('secret:has', (_e, { name }) => hasSecret(name))

  handle('hw:detect', async () => {
    const hw = await detectHardware()
    return { hw, recs: recommend(hw) }
  })
  handle('ollama:list', (_e, req) => listOllamaModels(req?.base))
  handle('ollama:install', (e) => installOllama(e.sender))
  handle('ollama:start', () => startOllama())
  handle('ollama:pull', async (e, req) => {
    await pullOllamaModel(req.name, (pct, status) => e.sender.send('ollama:pull-progress', { name: req.name, pct, status }))
  })

  handle('stt:load', async (e) => {
    await loadStt((p) => e.sender.send('stt:progress', p))
  })
  handle('stt:status', () => sttStatus())
  handle('stt:bench', () => benchStt())
  handle('stt:download-ggml', (e, req) => downloadGgml(req.id, (p) => e.sender.send('stt:progress', p)))
  handle('stt:transcribe', (_e, req) => transcribe(req.pcm, req.lang))
  handle('stt:detailed', (_e, req) => transcribeDetailed(req.pcm, req.lang, req.timestamps))
  handle('dict:apply', (_e, { text }) => applyDictionary(text))

  handle('llm:rewrite', (e, req) => {
    const st = getSettings()
    // Modo programador: el contexto del repo y el destino los resuelve el proceso principal
    if (req.mode !== 'rewrite') req = { ...req, target: st.promptTarget, projectContext: readProjectContext(st.projectDir) || undefined }
    return rewriteGuarded(req).then((r) => {
      if (r.reverted) e.sender.send('llm:notice', 'La redacción cambiaba cifras u horas: se conservó el texto dictado.')
      return r.text
    })
  })
  handle('llm:warm', () => warmLLM().catch(() => undefined))
  handle('llm:chat', (_e, req) => complete(req.system, req.msgs, 0.6))
  handle('llm:translate', (_e, req) => translate(req.text, req.to))
  handle('llm:generate', (_e, req) => generate(req.action as ContentAction, req.text, req.lang))
  handle('llm:test', () => testLLM())

  handle('col:get', (_e, req) => getCollection(req.name))
  handle('col:save', (_e, req) => saveCollection(req.name, req.items))

  handle('tts:status', () => ({ ...ttsStatus(), catalog: voiceStatus() }))
  handle('tts:install-piper', (e) => installPiper((what, pct) => e.sender.send('tts:progress', { what, pct })))
  handle('tts:install-voice', (e, req) => installVoice(req.id, (what, pct) => e.sender.send('tts:progress', { what, pct })))
  handle('tts:remove-voice', (_e, req) => removeVoice(req.id))
  handle('tts:sample', (_e, req) => fetchVoiceSample(req.id))
  handle('tts:synth', async (_e, req) => new Uint8Array(await synthesize(req.text, req.lang, req.voice)))

  handle('project:pick', async () => {
    const dir = await pickDir('Carpeta del proyecto')
    if (dir) saveSettings({ projectDir: dir })
    return dir
  })
  handle('vault:pick', async () => {
    const dir = await pickDir('Carpeta de notas (Obsidian, Logseq…)')
    if (dir) saveSettings({ vaultDir: dir })
    return dir
  })
  handle('project:context', () => readProjectContext(getSettings().projectDir))
  handle('agent:launch', (_e, req) => launchAgent(req.agent, getSettings().projectDir, req.prompt))
  handle('note:export', (_e, req) => exportNote(req.title, req.body, req.tags))
  handle('file:save', (_e, req) => saveFileDialog(req.name, typeof req.data === 'string' ? req.data : Buffer.from(req.data)))
  handle('file:open', async (_e, req) => {
    const f = await openFileDialog(req.title, req.exts)
    return f ? { name: f.name, data: new Uint8Array(f.data) } : null
  })
  handle('sysaudio:start', (e) => startSystemAudio(e.sender))
  handle('sysaudio:stop', () => stopSystemAudio())

  handle('history:get', () => getHistory())
  handle('history:save', (_e, req) => saveHistory(req.items))

  handle('net:events', () => ({ events: getNetEvents(), dataDir }))
  handle('net:clear', () => clearNetEvents())
  handle('app:launch-cmd', () => {
    if (process.env.APPIMAGE) return `"${process.env.APPIMAGE}" --toggle` // execPath cambia en cada ejecución del AppImage
    if (!app.isPackaged) return `"${process.execPath}" "${app.getAppPath()}" --toggle`
    return existsSync('/usr/bin/dictaflow') ? 'dictaflow --toggle' : `"${process.execPath}" --toggle`
  })
  handle('update:check', () => checkUpdate())
  handle('update:apply', (e) => applyUpdate(e.sender))
  handle('app:version', () => app.getVersion())
  handle('uninstall:info', () => uninstallInfo())
  handle('uninstall:run', (_e, req) => runUninstall(req.removeData))
  handle('app:open-data-dir', () => shell.openPath(dataDir))

  handle('clipboard:write', (_e, { text }) => clipboard.writeText(text))
  handle('notify', (_e, { title, body }) => {
    if (Notification.isSupported()) new Notification({ title, body, silent: true }).show()
  })
  handle('pill:set', (_e, req) => {
    if (!pill) return
    pill.webContents.send('pill:state', req.state)
    if (req.state.state === 'idle') pill.hide()
    else pill.showInactive()
    if (req.state.state === 'done' || req.state.state === 'error') setTimeout(() => pill?.hide(), 2200)
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

app.on('before-quit', () => { quitting = true; flushSettings(); stopStt(); stopSystemAudio() })
app.on('window-all-closed', () => { if (!tray) app.quit() })

export type { HardwareInfo }
