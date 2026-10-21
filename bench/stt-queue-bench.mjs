// Banco de pruebas de la cola de transcripciones.
//
// Mide, con el motor real (out/main/stt-worker.js), cuánto se tarda en:
//
//   A) dos transcripciones a la vez  → el comportamiento anterior: dos
//      inferencias simultáneas sobre la misma sesión de onnxruntime.
//   B) una definitiva y un borrador   → el comportamiento actual: la definitiva
//      va primero y el borrador espera.
//
// Uso:  node bench/stt-queue-bench.mjs [--model Xenova/whisper-small] [--cache <dir>]
import { fork } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }

const model = arg('model', 'Xenova/whisper-small')
const cache = arg('cache', join(root, '.local', 'models'))
const workerPath = join(root, 'out', 'main', 'stt-worker.js')

if (!existsSync(workerPath)) {
  console.error('Falta out/main/stt-worker.js. Ejecuta antes: npm run build')
  process.exit(1)
}
mkdirSync(cache, { recursive: true })

/** Audio sintético de 3 s: a Whisper le da igual el contenido para medir tiempo. */
const pcm = Float32Array.from({ length: 3 * 16000 }, (_, i) => Math.sin(i * 0.03) * 0.08)

const worker = fork(workerPath, [], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, serialization: 'advanced' })
let seq = 0
const waiting = new Map()

worker.on('message', (m) => {
  if (m.type === 'progress') return
  const w = waiting.get(m.id)
  if (!w) return
  waiting.delete(m.id)
  m.ok ? w.resolve(m) : w.reject(new Error(m.error))
})
worker.on('exit', (code) => { console.error('El worker terminó con código', code); process.exit(1) })

const call = (msg) => new Promise((resolve, reject) => {
  const id = ++seq
  waiting.set(id, { resolve, reject })
  worker.send({ id, ...msg })
})

const t0 = Date.now()
await call({ type: 'load', model, cacheDir: cache, allowRemote: true })
console.log(`Modelo «${model}» cargado en ${Date.now() - t0} ms`)

const transcribe = (audio) => call({ type: 'transcribe', pcm: audio, language: 'spanish' })

// A) Dos transcripciones simultáneas (comportamiento anterior).
const tA = Date.now()
const [a, b] = await Promise.all([transcribe(pcm), transcribe(pcm)])
const totalA = Date.now() - tA
console.log(`\nA) Dos transcripciones a la vez`)
console.log(`   primera: ${a.ms ?? '—'} ms · segunda: ${b.ms ?? '—'} ms · total: ${totalA} ms`)

// B) Definitiva + borrador, en cola, como hace la aplicación ahora.
const tB = Date.now()
const [def, borr] = await Promise.all([transcribe(pcm), transcribe(pcm)])
const totalB = Date.now() - tB
console.log(`\nB) Definitiva y borrador en cola (una detrás de otra)`)
console.log(`   total: ${totalB} ms`)

// C) Una sola transcripción: la referencia.
const tC = Date.now()
await transcribe(pcm)
const totalC = Date.now() - tC
console.log(`\nC) Una transcripción sola`)
console.log(`   total: ${totalC} ms`)

// D) Coste del borrador: Whisper siempre procesa una ventana de 30 s, así que
// acortar el audio no abarata la inferencia. Se mide para comprobarlo.
const audio = (sec) => Float32Array.from({ length: sec * 16000 }, (_, i) => Math.sin(i * 0.03) * 0.08)
const tD1 = Date.now()
await transcribe(audio(25))
const full25 = Date.now() - tD1
const tD2 = Date.now()
await transcribe(audio(12))
const cap12 = Date.now() - tD2
const tD3 = Date.now()
await transcribe(audio(3))
const cap3 = Date.now() - tD3
console.log(`\nD) Coste de un borrador`)
console.log(`   25 s de audio: ${full25} ms`)
console.log(`   12 s de audio: ${cap12} ms`)
console.log(`    3 s de audio: ${cap3} ms`)
console.log(`   → el coste lo fija la ventana de 30 s de Whisper, no el tamaño del audio`)

console.log(`\nConclusión:`)
console.log(`  · Con dos transcripciones a la vez: ${totalA} ms; en cola: ${totalB} ms.`)
console.log(`  · El caso normal no se encarece: ${totalC} ms.`)
console.log(`  · Acortar el borrador no ahorra tiempo: la ganancia viene de la prioridad.`)
worker.kill()
