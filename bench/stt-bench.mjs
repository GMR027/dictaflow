// Banco de pruebas STT reproducible: mismo pipeline que src/main/stt-worker.ts (Transformers.js, Whisper).
// Uso: node bench/stt-bench.mjs --data <dir fleurs> --model Xenova/whisper-small --dtype q8 --n 30 --cache <dir> --out <json>
//      [--chunk 30] [--stride 5] [--device cpu]
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const data = arg('data'), model = arg('model', 'Xenova/whisper-small'), dtype = arg('dtype', 'q8')
const n = +arg('n', 30), cache = arg('cache'), out = arg('out'), device = arg('device', 'cpu')
const repeat = +arg('repeat', 1) // pasadas completas sobre los mismos clips (prueba de estabilidad)
const chunk = +arg('chunk', 30), stride = +arg('stride', 5)
const maxSec = +arg('maxsec', 0) // >0: recorta cada clip (solo latencia; el WER deja de ser válido)

function readWav(path) {
  const b = readFileSync(path)
  const fmt = b.readUInt16LE(20), rate = b.readUInt32LE(24), bits = b.readUInt16LE(34)
  let o = 12
  while (o < b.length - 8 && b.toString('ascii', o, o + 4) !== 'data') o += 8 + b.readUInt32LE(o + 4)
  const bytes = bits >> 3
  const len = Math.floor(Math.min(b.readUInt32LE(o + 4), b.length - o - 8) / bytes)
  const f = new Float32Array(len)
  for (let i = 0; i < len; i++) f[i] = fmt === 3 ? b.readFloatLE(o + 8 + i * 4) : b.readInt16LE(o + 8 + i * 2) / 32768
  if (rate !== 16000 || (fmt !== 3 && bits !== 16)) throw new Error(`${path}: formato no soportado (${fmt}, ${bits} bit, ${rate} Hz)`)
  return f
}
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
function wer(ref, hyp) {
  const r = norm(ref), h = norm(hyp)
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)])
  for (let j = 0; j <= h.length; j++) d[0][j] = j
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1))
  return { errors: d[r.length][h.length], words: r.length }
}
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)] }
const rssMB = () => process.memoryUsage().rss / 1048576

const rows = readFileSync(join(data, 'test.tsv'), 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t'))
  .filter((c) => existsSync(join(data, 'test', c[1])))
// selección determinista repartida, de ~1 de cada k, sin repetir frase
const seen = new Set(), uniq = rows.filter((c) => !seen.has(c[3]) && seen.add(c[3]))
const pick = uniq.filter((_, i) => i % Math.max(1, Math.floor(uniq.length / n)) === 0).slice(0, n)

const tf = await import('@huggingface/transformers')
tf.env.cacheDir = cache
const t0 = performance.now()
const asr = await tf.pipeline('automatic-speech-recognition', model, { dtype, device })
const loadMs = performance.now() - t0
const rssLoaded = rssMB()
const opts = { task: 'transcribe', language: 'spanish', chunk_length_s: chunk, stride_length_s: stride, ...JSON.parse(arg('extra', '{}')) }

const w0 = performance.now()
await asr(readWav(join(data, 'test', pick[0][1])), opts)
const warmMs = performance.now() - w0

const res = [], rssByPass = []; let errs = 0, words = 0, peak = rssMB()
for (const c of Array.from({ length: repeat }, () => pick).flat()) {
  let pcm = readWav(join(data, 'test', c[1]))
  if (maxSec) pcm = pcm.subarray(0, maxSec * 16000)
  const s = performance.now()
  const o = await asr(pcm, opts)
  const ms = performance.now() - s
  const e = wer(c[3], o.text); errs += e.errors; words += e.words
  peak = Math.max(peak, rssMB())
  if (res.length % pick.length === pick.length - 1) rssByPass.push(Math.round(rssMB()))
  res.push({ file: c[1], sec: pcm.length / 16000, ms, ...e, ref: c[3], hyp: o.text.trim() })
}
const lat = res.map((r) => r.ms), tot = res.reduce((a, r) => a + r.sec, 0)
const summary = {
  model, dtype, device, chunk, stride, clips: res.length, audioSec: +tot.toFixed(1),
  loadMs: Math.round(loadMs), warmMs: Math.round(warmMs), rssAfterLoadMB: Math.round(rssLoaded), rssPeakMB: Math.round(peak),
  p50: Math.round(pct(lat, 50)), p95: Math.round(pct(lat, 95)), p99: Math.round(pct(lat, 99)),
  rtf: +(lat.reduce((a, b) => a + b, 0) / 1000 / tot).toFixed(3), wer: +(errs / words * 100).toFixed(2),
  rssByPassMB: rssByPass, lastPassP50: Math.round(pct(lat.slice(-pick.length), 50)), firstPassP50: Math.round(pct(lat.slice(0, pick.length), 50)),
  node: process.version, cpu: (await import('node:os')).cpus()[0].model
}
console.log(JSON.stringify(summary))
if (out) writeFileSync(out, JSON.stringify({ summary, res }, null, 1))
process.exit(0)
