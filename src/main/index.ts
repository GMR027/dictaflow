import { app, BrowserWindow, clipboard, ipcMain, Menu, Notification, screen, shell, Tray, nativeImage, type IpcMainInvokeEvent } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import appIcon from '../../build/icon.png?asset'
import type { HardwareInfo } from '@shared/types'
import type { IpcChannel, IpcReq, IpcRes } from '@shared/ipc'
import { detectHardware, listOllamaModels, recommend } from './hardware'
import { installOllama, startOllama } from './ollama-setup'
import { complete, generate, generateMinutes, pullOllamaModel, rewriteGuarded, testLLM, translate, warmLLM, type ContentAction } from './llm'
import { listOpencodeModels, resolveBin } from './cli'
import { PROVIDERS } from '@shared/providers'
import { clearNetEvents, getNetEvents } from './netlog'
import { exportNote, launchAgent, openFileDialog, pickDir, readProjectContext, saveFileDialog } from './tools'
import { fetchVoiceSample, installPiper, installVoice, removeVoice, synthesize, ttsStatus } from './tts'
import { voiceStatus } from './catalog/voices'
import { startSystemAudio, stopSystemAudio } from './sysaudio'
import { runUninstall, uninstallInfo } from './uninstall'
import { applyUpdate, checkUpdate } from './updater'
import { type Collection, dataDir, flushSettings, getCollection, getHistory, saveCollection, getSettings, hasSecret, saveHistory, saveSettings, setSecret } from './store'
import { getLibrary, getLibraryDoc, removeLibraryDoc, saveLibraryDoc, updateLibraryProgress } from './store'
import { applyDictionary, benchStt, downloadGgml, loadStt, sttStatus, stopStt, transcribe, transcribeDetailed } from './stt'
import { JobQueue } from './jobs/queue'
import { buildAudiobook, exportTextAsMp3, listAudiobooks, audiobooksDir } from './audio/export'
import { ensureDataDirs } from './paths'
import { diagnostics } from './diagnostics'
import { createBackup, restoreFromBuffer } from './backup'
import { generatePdf } from './pdf'
import { dueEventReminders, dueReminders, fromIcs, listEvents, listReminders, removeEvent, removeReminder, saveEvent, saveReminder, toIcs } from './calendar'
import { discardAudio, pushAudio, startAudio, stopAudio } from './meeting-audio'
import { listAutomations, removeAutomation, runAutomation, saveAutomation, STEP_INFO, type StepType } from './automations'
import {
  checkEngine, cloneEngineUrl, listGenerated, listPersonalVoices, listRecordings,
  readPersonalAudio, removeGenerated, removePersonalVoice, removeRecording, saveGenerated, savePersonalVoice,
  saveRecording, setCloneEngineUrl, synthesizePersonal
} from './personal-voices'

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

/** Cola de trabajos en segundo plano (audiolibros, exportaciones). */
const jobs = new JobQueue()

// El audiolibro: un capítulo por fichero, con progreso y sin cargarlo todo en memoria.
jobs.register('audiobook', async (job, report) => {  const p = job.payload ?? {}
  const doc = getLibraryDoc(String(p.docId))
  if (!doc) throw new Error('El documento ya no está en la biblioteca.')
  const dir = join(audiobooksDir(), doc.title.replace(/[^\w\s-]/g, '').trim().slice(0, 60) || 'audiolibro')
  const from = Number(job.resume?.chapter ?? 0)
  const r = await buildAudiobook({
    title: doc.title,
    chapters: doc.chapters,
    lang: (p.lang as 'es' | 'en') ?? 'es',
    voice: p.voice as string | undefined,
    dir,
    from,
    onProgress: report,
    shouldStop: () => jobs.isCancelled(job.id)
  })
  return { result: r.file, resume: { chapter: doc.chapters.length } }
})

// Una automatización: una secuencia de pasos sobre un texto.
jobs.register('automation', async (job, report) => {
  const p = job.payload ?? {}
  const a = listAutomations().find((x) => x.id === String(p.automationId))
  if (!a) throw new Error('Esa automatización ya no existe.')
  report(5, 'Empezando')
  const r = await runAutomation(a, {
    title: String(p.title ?? 'Automatización'),
    text: String(p.text ?? ''),
    lang: (p.lang as 'es' | 'en') ?? 'es',
    dir: join(dataDir, 'automatizaciones')
  })
  report(100, r.steps.map((s) => s.detail).join(' · '))
  return { result: r.files.join('\n') || r.text.slice(0, 200) }
})

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
  handle('stt:transcribe', (_e, req) => transcribe(req.pcm, req.lang, req.priority))
  handle('stt:detailed', (_e, req) => transcribeDetailed(req.pcm, req.lang, req.timestamps, req.priority))
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
  handle('llm:minutes', (_e, req) => generateMinutes(req.text, req.lang))
  handle('llm:test', () => testLLM())
  handle('llm:models', async (_e, req) => {
    if (req.kind === 'opencode') return listOpencodeModels()
    if (req.kind === 'ollama') {
      const r = await listOllamaModels(getSettings().llm.baseUrl)
      return {
        bin: resolveBin('ollama'), models: r.models, providers: ['ollama'],
        error: r.running ? undefined : 'Ollama no está en marcha. Arráncalo para ver sus modelos.'
      }
    }
    if (req.kind === 'claude-cli') {
      return { bin: resolveBin('claude'), models: PROVIDERS['claude-cli'].models ?? [], providers: ['anthropic'] }
    }
    return { bin: null, models: PROVIDERS[req.kind].models ?? [], providers: [] }
  })

  handle('col:get', (_e, req) => getCollection(req.name))
  handle('col:save', (_e, req) => saveCollection(req.name, req.items))

  handle('library:list', () => getLibrary())
  handle('library:get', (_e, req) => getLibraryDoc(req.id))
  handle('library:save', (_e, req) => saveLibraryDoc(req.doc))
  handle('library:progress', (_e, req) => updateLibraryProgress(req.id, req.progress))
  handle('library:remove', (_e, req) => removeLibraryDoc(req.id))

  handle('jobs:list', () => jobs.list())
  handle('jobs:cancel', (_e, req) => jobs.cancel(req.id))
  handle('jobs:clear', () => jobs.clearFinished())
  handle('audio:export', (_e, req) => exportTextAsMp3(req.text, req.lang, req.voice, join(dataDir, 'exportaciones'), req.name))
  handle('audio:audiobook', (_e, req) => {
    const doc = getLibraryDoc(req.docId)
    if (!doc) throw new Error('El documento ya no está en la biblioteca.')
    return jobs.enqueue('audiobook', `Audiolibro: ${doc.title}`, {
      docId: req.docId, lang: req.lang, voice: req.voice
    })
  })
  handle('audio:audiobooks', () => listAudiobooks())

  handle('diagnostics:report', () => diagnostics(sttStatus()))
  handle('backup:create', async (_e, req) => {
    const dest = req.dest ?? join(app.getPath('downloads'), `dictaflow-copia-${new Date().toISOString().slice(0, 10)}.zip`)
    return createBackup(dest)
  })
  handle('backup:restore', (_e, req) => restoreFromBuffer(Buffer.from(req.data)))

  handle('pdf:generate', async (_e, req) => {
    const name = req.name ?? 'documento'
    const dest = join(app.getPath('downloads'), `${name.replace(/[^\w\s-]/g, '').trim() || 'documento'}.pdf`)
    return generatePdf(req.title, req.body, dest)
  })

  handle('cal:list', () => listEvents())
  handle('cal:save', (_e, req) => saveEvent(req.event))
  handle('cal:remove', (_e, req) => removeEvent(req.id))
  handle('cal:export', (_e, req) => {
    const dest = join(app.getPath('downloads'), 'dictaflow-calendario.ics')
    writeFileSync(dest, toIcs(listEvents()), 'utf8')
    return dest
  })
  handle('cal:import', (_e, req) => {
    const evs = fromIcs(req.data)
    for (const e of evs) {
      saveEvent({
        id: crypto.randomUUID(),
        title: e.title,
        notes: e.notes,
        start: e.start,
        durationMin: e.durationMin,
        location: e.location,
        reminder: false,
        remindBeforeMin: 0
      })
    }
    return evs.length
  })
  handle('rem:list', () => listReminders())
  handle('rem:save', (_e, req) => saveReminder(req.reminder))
  handle('rem:remove', (_e, req) => removeReminder(req.id))

  handle('meeting:audio-start', (_e, req) => startAudio(req.sessionId))
  handle('meeting:audio-chunk', (_e, req) => { pushAudio(req.sessionId, req.pcm) })
  handle('meeting:audio-stop', (_e, req) => stopAudio(req.sessionId))
  handle('meeting:audio-discard', (_e, req) => { discardAudio(req.sessionId) })

  handle('pv:list', () => listPersonalVoices())
  handle('pv:save', (_e, req) => savePersonalVoice(req.voice))
  handle('pv:remove', (_e, req) => removePersonalVoice(req.id))
  handle('pv:recordings', () => listRecordings())
  handle('pv:add-recording', (_e, req) => saveRecording(req.name, req.data, req.speaker, req.durationSec))
  handle('pv:remove-recording', (_e, req) => removeRecording(req.id))
  handle('pv:generated', () => listGenerated())
  handle('pv:remove-generated', (_e, req) => removeGenerated(req.id))
  handle('pv:audio', (_e, req) => readPersonalAudio(req.path))
  handle('pv:engine', async () => {
    const r = await checkEngine()
    return { ...r, url: cloneEngineUrl() }
  })
  handle('pv:engine-url', (_e, req) => { setCloneEngineUrl(req.url) })
  handle('au:list', () => listAutomations())
  handle('au:save', (_e, req) => { saveAutomation(req.automation) })
  handle('au:remove', (_e, req) => { removeAutomation(req.id) })
  handle('au:steps', () => Object.entries(STEP_INFO).map(([type, v]) => ({ type: type as StepType, label: v.label, detail: v.detail })))
  handle('au:run', (_e, req) => {
    const a = listAutomations().find((x) => x.id === req.id)
    if (!a) throw new Error('Esa automatización ya no existe.')
    return jobs.enqueue('automation', a.name, { automationId: a.id, title: req.title, text: req.text, lang: req.lang })
  })

  handle('pv:synthesize', async (_e, req) => {
    const voice = listPersonalVoices().find((v) => v.id === req.voiceId)
    if (!voice) throw new Error('Esa voz no existe.')
    const { audio, durationSec } = await synthesizePersonal(voice, req.text)
    const dir = join(dataDir, 'voces', 'generados')
    mkdirSync(dir, { recursive: true })
    const id = crypto.randomUUID()
    const path = join(dir, `${id}.wav`)
    writeFileSync(path, audio)
    saveGenerated({ id, voiceId: voice.id, voiceName: voice.name, text: req.text, path, createdAt: Date.now(), durationSec })
    return { path, durationSec }
  })

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
  ensureDataDirs()
  registerIpc()
  createWindow()
  createPill()
  createTray()
  handleArgs(process.argv)
  // Los cambios de la cola se avisan a la interfaz.
  jobs.onChange((list) => win?.webContents.send('jobs:changed', list))
  startReminderWatcher()
})

/**
 * Avisa de los recordatorios que tocan. Se mira cada 30 s: los avisos salen
 * como notificaciones del sistema y no salen del equipo.
 */
function startReminderWatcher(): void {
  const check = (): void => {
    for (const r of dueReminders()) {
      if (Notification.isSupported()) new Notification({ title: 'DictaFlow · Recordatorio', body: r.text, silent: false }).show()
      else console.log('Recordatorio:', r.text)
    }
    for (const e of dueEventReminders()) {
      const body = e.remindBeforeMin > 0 ? `Empieza en ${e.remindBeforeMin} minutos` : 'Empieza ahora'
      if (Notification.isSupported()) new Notification({ title: `DictaFlow · ${e.title}`, body, silent: false }).show()
    }
  }
  check()
  setInterval(check, 30_000)
}

app.on('before-quit', () => { quitting = true; flushSettings(); stopStt(); stopSystemAudio() })
app.on('window-all-closed', () => { if (!tray) app.quit() })

export type { HardwareInfo }
