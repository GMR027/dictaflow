#!/usr/bin/env node
// Genera src/main/catalog/manifest.json: para cada voz y para el motor Piper,
// la URL, el tamaño exacto y el SHA-256 del fichero.
//
// Las fuentes son las oficiales:
//   - voces:  https://huggingface.co/rhasspy/piper-voices  (el campo lfs.oid es el SHA-256)
//   - motor:   https://github.com/rhasspy/piper/releases     (la API no publica digest, se calcula aquí)
//
// Uso:  node tools/build-manifest.mjs [--check]
//   --check  no escribe: solo verifica que el manifiesto del repositorio está al día (para CI)
//
// Las descargas del motor se cachean en tools/.cache para no repetirlas.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', 'src', 'main', 'catalog', 'manifest.json')
const cache = join(here, '.cache')
const HF = 'https://huggingface.co/rhasspy/piper-voices'
const HF_API = 'https://huggingface.co/api/models/rhasspy/piper-voices'
const PIPER_RELEASE = 'https://api.github.com/repos/rhasspy/piper/releases/tags/2023.11.14-2'
const PIPER_ASSET = 'piper_linux_x86_64.tar.gz'

/** Voces del catálogo: ruta dentro de rhasspy/piper-voices. */
const VOICES = [
  'es/es_ES/davefx/medium',
  'es/es_ES/sharvard/medium',
  'es/es_MX/ald/medium',
  'es/es_MX/ald/x_low',
  'es/es_MX/claude/high',
  'en/en_US/lessac/medium',
  'en/en_US/amy/medium',
  'en/en_US/kristin/medium',
  'en/en_US/hfc_female/medium',
  'en/en_US/ryan/high',
  'en/en_GB/alan/medium'
]

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

async function get(url, binary = false) {
  const res = await fetch(url, { headers: { 'user-agent': 'dictaflow-manifest' } })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return binary ? Buffer.from(await res.arrayBuffer()) : res.json()
}

/** Una voz: .onnx (LFS, el oid es su sha256) + .onnx.json (fichero pequeño, se descarga y se hashea). */
async function voiceEntry(dir) {
  const tree = await get(`${HF_API}/tree/main/${dir}?expand=true`)
  const model = tree.find((f) => f.path.endsWith('.onnx') && !f.path.endsWith('.onnx.json'))
  const config = tree.find((f) => f.path.endsWith('.onnx.json'))
  if (!model || !config) throw new Error(`voz incompleta: ${dir}`)
  const modelSha = model.lfs?.oid
  if (!modelSha) throw new Error(`sin hash LFS para ${model.path}`)
  const cfgBuf = Buffer.from(await get(`${HF}/resolve/main/${config.path}`, true))
  // La muestra solo existe en algunas voces: se comprueba antes de anunciarla.
  const samplePath = 'samples/speaker_0.mp3'
  const sampleRes = await fetch(`${HF}/resolve/main/${dir}/${samplePath}`, { method: 'HEAD' })
  return {
    id: model.path.split('/').pop().replace(/\.onnx$/, ''),
    dir,
    model: {
      url: `${HF}/resolve/main/${model.path}`,
      size: model.lfs.size,
      sha256: modelSha
    },
    config: {
      // `config.path` ya es la ruta completa dentro del repositorio.
      url: `${HF}/resolve/main/${config.path}`,
      size: config.size,
      sha256: sha256(cfgBuf)
    },
    sample: sampleRes.ok ? `${HF}/resolve/main/${dir}/${samplePath}` : null
  }
}

/** El motor Piper: el asset de la release, hasheado aquí (la API no publica digest). */
async function piperEntry() {
  const release = await get(PIPER_RELEASE)
  const asset = release.assets.find((a) => a.name === PIPER_ASSET)
  if (!asset) throw new Error('no se encuentra el asset de Piper')
  const file = join(cache, PIPER_ASSET)
  let buf
  if (existsSync(file)) buf = readFileSync(file)
  else {
    buf = await get(asset.browser_download_url, true)
    mkdirSync(cache, { recursive: true })
    writeFileSync(file, buf)
  }
  return {
    id: 'piper-linux-x86_64',
    url: asset.browser_download_url,
    size: buf.length,
    sha256: sha256(buf),
    declaredSize: asset.size
  }
}

const manifest = { generated: new Date().toISOString().slice(0, 10), piper: await piperEntry(), voices: [] }
for (const dir of VOICES) manifest.voices.push(await voiceEntry(dir))

const json = JSON.stringify(manifest, null, 2) + '\n'
const check = process.argv.includes('--check')
if (check) {
  const current = existsSync(out) ? readFileSync(out, 'utf8') : ''
  // `generated` cambia cada día: se compara el contenido sin ese campo.
  const strip = (s) => s.replace(/^\s*"generated":.*$/m, '')
  if (strip(current) !== strip(json)) {
    console.error('El manifiesto está desactualizado. Ejecuta: node tools/build-manifest.mjs')
    process.exit(1)
  }
  console.log('Manifiesto al día.')
} else {
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, json)
  console.log(`Manifiesto escrito: ${out} (${manifest.voices.length} voces)`)
}
