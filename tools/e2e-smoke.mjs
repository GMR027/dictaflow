#!/usr/bin/env node
// Prueba de humo real sobre la aplicación Electron.
//
// Arranca la app con el puerto de depuración, se conecta por CDP y ejecuta los
// flujos importantes (voces, STT, IA, mis voces, calendario, biblioteca…) sin
// depender de clics manuales. Sirve tanto para el build de desarrollo como
// para la app instalada:
//
//   node tools/e2e-smoke.mjs --dev
//   node tools/e2e-smoke.mjs --exe /opt/DictaFlow/dictaflow
//
// Sale con código 1 si algo falla.
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const args = process.argv.slice(2)
const dev = args.includes('--dev')
const exeIdx = args.indexOf('--exe')
const exe = exeIdx >= 0 ? args[exeIdx + 1] : dev ? 'node_modules/.bin/electron' : '/opt/DictaFlow/dictaflow'
const appArgs = dev ? ['.', '--remote-debugging-port=9222'] : ['--remote-debugging-port=9222']
const PORT = 9222

const results = []
const problems = []
const pass = (name, detail = '') => { results.push({ ok: true, name, detail }); console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`) }
const fail = (name, error) => { results.push({ ok: false, name, error }); problems.push(`${name}: ${error}`); console.log(`  ✗ ${name} — ${error}`) }
const check = async (name, fn) => {
  try { pass(name, await fn()) } catch (e) { fail(name, e?.message ?? String(e)) }
}

console.log(`\nDictaFlow · prueba de humo (${dev ? 'desarrollo' : exe})\n`)
const child = spawn(exe, appArgs, {
  cwd: process.cwd(),
  env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':0' },
  stdio: ['ignore', 'ignore', 'pipe']
})
let stderr = ''
child.stderr.on('data', (d) => { stderr += d })
child.on('exit', (code) => { if (code && code !== 0) console.error(`La app terminó con código ${code}`) })

let ws
let seq = 0
const pending = new Map()
const pageErrors = []

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params }))
})

async function connect() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((resolve, reject) => {
          ws.onopen = resolve
          ws.onerror = () => reject(new Error('No se pudo abrir CDP'))
        })
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data)
          if (m.id && pending.has(m.id)) {
            const p = pending.get(m.id)
            pending.delete(m.id)
            m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result)
            return
          }
          if (m.method === 'Runtime.exceptionThrown') {
            pageErrors.push(m.params?.exceptionDetails?.exception?.description ?? 'excepción')
          }
          if (m.method === 'Log.entryAdded' && m.params?.entry?.level === 'error') {
            pageErrors.push(m.params.entry.text)
          }
        }
        await send('Runtime.enable')
        await send('Log.enable')
        return
      }
    } catch { /* aún arrancando */ }
    await sleep(250)
  }
  throw new Error('La app no abrió el puerto de depuración')
}

async function evalInPage(expression, timeoutMs = 240_000) {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }),
    sleep(timeoutMs).then(() => { throw new Error(`Tiempo agotado (${Math.round(timeoutMs / 1000)} s)`) })
  ])
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result?.value
}

try {
  await connect()
  // La ventana puede tardar en montar React.
  for (let i = 0; i < 60; i++) {
    const ready = await evalInPage('!!(window.api && document.querySelector("nav"))', 5_000).catch(() => false)
    if (ready) break
    await sleep(250)
  }
  pass('La interfaz arranca', await evalInPage('document.querySelector("h1")?.innerText ?? ""'))

  await check('Ajustes y versión', async () => {
    const r = await evalInPage('(async()=>({s:await window.api.getSettings(),v:await window.api.appVersion()}))()')
    if (!r?.s) throw new Error('sin ajustes')
    return `v${r.v} · idioma ${r.s.primaryLang}`
  })

  await check('Catálogo de voces', async () => {
    const st = await evalInPage('window.api.ttsStatus()')
    if (st.catalog.length !== 11) throw new Error(`catálogo con ${st.catalog.length} voces`)
    return `${st.catalog.length} voces · piper ${st.piperInstalled ? 'instalado' : 'ausente'}`
  })

  await check('Descarga de voz (config + modelo, SHA-256)', async () => {
    const r = await evalInPage(`(async()=>{
      const before = await window.api.ttsStatus()
      await window.api.installVoice('es_MX-ald-x_low')
      const after = await window.api.ttsStatus()
      return { before: before.voices.includes('es_MX-ald-x_low'), after: after.voices.includes('es_MX-ald-x_low') }
    })()`)
    if (!r.after) throw new Error('la voz no aparece instalada tras la descarga')
    return r.before ? 'ya estaba' : 'descargada y verificada'
  })

  await check('Síntesis de voz (WAV)', async () => {
    const r = await evalInPage(`(async()=>{
      const b = await window.api.synthesize('Hola, esto es una prueba de voz.', 'es', 'es_MX-ald-x_low')
      return { n: b.length, riff: String.fromCharCode(b[0],b[1],b[2],b[3]) }
    })()`)
    if (r.riff !== 'RIFF' || r.n < 1000) throw new Error(`WAV inválido (${r.riff}, ${r.n} bytes)`)
    return `${r.n} bytes`
  })

  await check('Muestra de voz', async () => {
    const n = await evalInPage(`(async()=>(await window.api.voiceSample('es_ES-davefx-medium')).length)()`)
    if (n < 1000) throw new Error(`muestra de ${n} bytes`)
    return `${n} bytes`
  })

  await check('Modelo de voz a texto listo', async () => {
    const r = await evalInPage(`(async()=>{
      let st = await window.api.sttStatus()
      if (!st.modelInstalled) { await window.api.loadStt(); st = await window.api.sttStatus() }
      return { installed: st.modelInstalled, model: st.engine }
    })()`)
    if (!r.installed) throw new Error('el modelo no quedó instalado')
    return `${r.model} · descargado`
  })

  await check('Transcripción ida y vuelta (TTS → STT)', async () => {
    const r = await evalInPage(`(async()=>{
      const wav = await window.api.synthesize('Hola, esto es una prueba de transcripción.', 'es', 'es_MX-ald-x_low')
      const ctx = new AudioContext()
      const buf = await ctx.decodeAudioData(wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength))
      await ctx.close()
      const off = new OfflineAudioContext(1, Math.ceil(buf.duration * 16000), 16000)
      const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start()
      const pcm = (await off.startRendering()).getChannelData(0)
      const out = await window.api.transcribe(pcm, 'es')
      return { text: out.text, ms: out.ms }
    })()`, 300_000)
    if (!r.text || !/prueba|transcripci/i.test(r.text)) throw new Error(`texto inesperado: "${r.text}"`)
    return `"${r.text.slice(0, 60)}" · ${r.ms} ms`
  })

  await check('OpenCode: modelos disponibles', async () => {
    const m = await evalInPage(`window.api.listModels('opencode')`)
    if (!m.bin) throw new Error(m.error || 'opencode no encontrado')
    if (!m.models.length) throw new Error(m.error || 'sin modelos')
    return `${m.models.length} modelos · ${m.providers.join(', ')}`
  })

  await check('OpenCode: conexión y redacción', async () => {
    const r = await evalInPage(`(async()=>{
      await window.api.saveSettings({ llm: { kind: 'opencode', model: 'opencode/deepseek-v4.1-flash-free' } })
      return await window.api.testLLM()
    })()`, 240_000)
    if (!r || !r.trim()) throw new Error('respuesta vacía')
    return `"${r.replace(/\\s+/g, ' ').slice(0, 60)}"`
  })

  await check('Claude CLI: conexión y redacción', async () => {
    const m = await evalInPage(`window.api.listModels('claude-cli')`)
    if (!m.bin) throw new Error('claude no encontrado')
    const r = await evalInPage(`(async()=>{
      await window.api.saveSettings({ llm: { kind: 'claude-cli', model: '' } })
      return await window.api.testLLM()
    })()`, 240_000)
    if (!r || !r.trim()) throw new Error('respuesta vacía')
    return `"${r.replace(/\\s+/g, ' ').slice(0, 60)}"`
  })

  await check('Ollama: conexión y redacción', async () => {
    const m = await evalInPage(`window.api.listModels('ollama')`)
    if (!m.models.length) throw new Error(m.error || 'sin modelos')
    const r = await evalInPage(`(async()=>{
      await window.api.saveSettings({ llm: { kind: 'ollama', model: 'qwen2.5:7b', baseUrl: 'http://127.0.0.1:11434' } })
      return await window.api.testLLM()
    })()`, 240_000)
    if (!r || !r.trim()) throw new Error('respuesta vacía')
    return `${m.models.length} modelos · "${r.replace(/\\s+/g, ' ').slice(0, 50)}"`
  })

  await check('Traducción y resumen con IA', async () => {
    await evalInPage(`window.api.saveSettings({ llm: { kind: 'opencode', model: 'opencode/deepseek-v4.1-flash-free' } })`)
    const tr = await evalInPage(`window.api.translate('Hola, ¿cómo estás?', 'en')`, 240_000)
    const sum = await evalInPage(`window.api.generate('summary', 'La reunión trató del presupuesto. Se decidió aplazar la compra.', 'es')`, 240_000)
    if (!tr || !sum) throw new Error('respuesta vacía')
    return `traducción "${tr.slice(0, 40)}" · resumen ${sum.length} caracteres`
  })

  await check('Mis voces: grabación, voz local, prueba y reproducción', async () => {
    const r = await evalInPage(`(async()=>{
      const wav = await window.api.synthesize('Grabación de prueba para Mis voces.', 'es', 'es_MX-ald-x_low')
      const rec = await window.api.addRecording('e2e-prueba.wav', wav, 'E2E', 2)
      const voice = await window.api.savePersonalVoice({
        id: crypto.randomUUID(), name: 'E2E voz local', engine: 'piper', lang: 'es',
        sampleId: rec.id, piperVoice: 'es_MX-ald-x_low',
        consent: { authorizedBy: 'E2E', date: Date.now(), notes: 'prueba' },
        createdAt: Date.now(), testPhrase: 'Esta es una prueba de mi voz.', available: false
      })
      const audio = await window.api.synthesizePersonal(voice.id, voice.testPhrase)
      const gen = await window.api.personalAudio(audio.path)
      const back = await window.api.personalAudio(rec.path)
      const generated = await window.api.listGenerated()
      await window.api.removePersonalVoice(voice.id)
      await window.api.removeRecording(rec.id)
      for (const g of generated.filter((x) => x.voiceId === voice.id)) await window.api.removeGenerated(g.id)
      return { available: voice.available, riff: String.fromCharCode(gen[0],gen[1],gen[2],gen[3]), rec: back.length }
    })()`, 240_000)
    if (!r.available) throw new Error('la voz quedó no disponible')
    if (r.riff !== 'RIFF' || r.rec < 1000) throw new Error('audio generado o grabación inválidos')
    return 'guardada, sintetizada y reproducida'
  })

  await check('Calendario y recordatorios', async () => {
    const r = await evalInPage(`(async()=>{
      const now = Date.now()
      await window.api.saveEvent({ id: 'e2e-evento', title: 'E2E', start: now + 3600000, durationMin: 60, notes: '', location: '', reminder: false, remindBeforeMin: 0 })
      const events = await window.api.listEvents()
      const ics = await window.api.exportCalendar()
      await window.api.saveReminder({ id: 'e2e-rec', text: 'E2E', at: now + 3600000, done: false })
      const rems = await window.api.listReminders()
      await window.api.removeEvent('e2e-evento')
      await window.api.removeReminder('e2e-rec')
      return { event: events.some((e) => e.id === 'e2e-evento'), ics: typeof ics === 'string' && ics.endsWith('.ics'), rem: rems.some((x) => x.id === 'e2e-rec') }
    })()`)
    if (!r.event || !r.ics || !r.rem) throw new Error(JSON.stringify(r))
    return 'evento, ICS y recordatorio'
  })

  await check('Biblioteca y prompts', async () => {
    const r = await evalInPage(`(async()=>{
      const doc = { id: 'e2e-doc', title: 'E2E', kind: 'txt', addedAt: Date.now(), chapters: [{ title: 'Uno', text: 'Hola mundo' }], progress: { chapter: 0, paragraph: 0 } }
      await window.api.saveLibraryDoc(doc)
      const got = await window.api.getLibraryDoc('e2e-doc')
      await window.api.removeLibraryDoc('e2e-doc')
      await window.api.saveCollection('prompts', [{ id: 'e2e-p', title: 'E2E', text: 'x', tags: [], rating: 0, createdAt: Date.now() }])
      const prompts = await window.api.getCollection('prompts')
      return { doc: got?.title, prompt: prompts.some((p) => p.id === 'e2e-p') }
    })()`)
    if (r.doc !== 'E2E' || !r.prompt) throw new Error(JSON.stringify(r))
    return 'documento y prompt guardados'
  })

  await check('PDF y diagnóstico', async () => {
    const r = await evalInPage(`(async()=>{
      const file = await window.api.generatePdf('E2E', 'Contenido de prueba', 'e2e')
      const d = await window.api.diagnostics()
      return { file, diag: !!d }
    })()`, 120_000)
    if (!r.file || !r.diag) throw new Error(JSON.stringify(r))
    return r.file.split('/').pop()
  })

  await check('Todas las secciones renderizan', async () => {
    const views = await evalInPage(`(async()=>{
      const buttons = [...document.querySelectorAll('nav button')]
      const out = []
      for (const b of buttons) {
        b.click()
        await new Promise((r) => setTimeout(r, 250))
        out.push({ label: b.innerText.trim(), main: document.querySelector('main')?.innerText.trim().length ?? 0 })
      }
      return out
    })()`, 120_000)
    const empty = views.filter((v) => v.main < 10)
    if (empty.length) throw new Error(`secciones vacías: ${empty.map((v) => v.label).join(', ')}`)
    return `${views.length} secciones`
  })

  await check('Actualizador', async () => {
    const r = await evalInPage(`window.api.checkUpdate()`, 60_000)
    return `instalada ${r.current} · última ${r.latest}`
  })

  if (pageErrors.length) {
    fail('Sin errores de consola', pageErrors.slice(0, 5).join(' | '))
  } else {
    pass('Sin errores de consola')
  }
} catch (e) {
  fail('Prueba de humo', e?.message ?? String(e))
} finally {
  try { ws?.close() } catch { /* ignorar */ }
  child.kill('SIGTERM')
  await sleep(1500)
  if (child.exitCode === null) child.kill('SIGKILL')
  if (stderr.trim()) console.error(`\nstderr de la app:\n${stderr.trim().split('\n').slice(-15).join('\n')}`)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas`)
if (problems.length) {
  console.log('\nFallos:')
  for (const p of problems) console.log(` - ${p}`)
  process.exit(1)
}
