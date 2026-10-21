#!/usr/bin/env node
// Comprueba el paquete construido: que no lleve ficheros que no hacen falta
// y que los que sí necesita estén.
//
// Uso:  node tools/check-package.mjs [carpeta release/linux-unpacked]
//
// Se ejecuta en la CI después de `npm run dist:dir`.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? 'release/linux-unpacked')
const resources = join(root, 'resources')
const asar = join(resources, 'app.asar')
const unpacked = join(resources, 'app.asar.unpacked')

if (!existsSync(asar)) {
  console.error(`No hay paquete en ${root}. Ejecuta primero: npm run dist:dir`)
  process.exit(1)
}

const problems = []

/** Lee la cabecera del asar y devuelve la lista de ficheros que contiene. */
function asarFiles(path) {
  const fd = readFileSync(path)
  // 4 bytes de tamaño, 4 de alineación, 4 de tamaño del header, 4 de cabecera, luego el JSON.
  const headerSize = fd.readUInt32LE(12)
  const header = fd.subarray(16, 16 + headerSize).toString('utf8')
  const files = []
  const walk = (node, prefix) => {
    for (const [name, child] of Object.entries(node.files ?? {})) {
      const p = `${prefix}/${name}`
      if (child.files) walk(child, p)
      else files.push({ path: p, size: child.size ?? 0, unpacked: !!child.unpacked })
    }
  }
  walk(JSON.parse(header), '')
  return files
}

const files = asarFiles(asar)

// 1. Nada de onnxruntime-web (141 MB de compilación para navegador que no se usa).
const web = files.filter((f) => f.path.includes('/onnxruntime-web/'))
if (web.length) {
  problems.push(`El paquete incluye onnxruntime-web (${web.length} ficheros, ${(web.reduce((n, f) => n + f.size, 0) / 1048576).toFixed(0)} MB). No debe estar.`)
}

// 2. Los proveedores de GPU no se empaquetan: el motor funciona con CPU.
for (const gpu of ['libonnxruntime_providers_cuda.so', 'libonnxruntime_providers_tensorrt.so']) {
  const found = files.filter((f) => f.path.endsWith(gpu))
  if (found.length) problems.push(`El paquete incluye ${gpu} (${(found[0].size / 1048576).toFixed(0)} MB).`)
}

// 3. El worker de voz tiene que estar: sin él no hay dictado.
if (!files.some((f) => f.path.endsWith('/out/main/stt-worker.js'))) {
  problems.push('Falta out/main/stt-worker.js: el dictado no funcionaría.')
}

// 4. Los binarios nativos deben estar fuera del asar para poder cargarse.
const native = ['onnxruntime_binding.node', 'libonnxruntime.so.1']
for (const n of native) {
  if (!files.some((f) => f.path.endsWith(n) && f.unpacked)) {
    problems.push(`${n} no está descomprimido (unpacked): el motor no cargaría.`)
  }
}

const sizeOf = (p) => (existsSync(p) ? statSync(p).size : 0)
const unpackedSize = existsSync(unpacked) ? dirSize(unpacked) : 0
function dirSize(dir) {
  let n = 0
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    n += e.isDirectory() ? dirSize(p) : statSync(p).size
  }
  return n
}

console.log(`Paquete: ${root}`)
console.log(`  app.asar            ${(sizeOf(asar) / 1048576).toFixed(1)} MB (${files.length} ficheros)`)
console.log(`  app.asar.unpacked   ${(unpackedSize / 1048576).toFixed(1)} MB`)
console.log(`  total               ${((sizeOf(asar) + unpackedSize) / 1048576).toFixed(1)} MB`)

if (problems.length) {
  console.error('\nProblemas del paquete:')
  for (const p of problems) console.error(`  ✗ ${p}`)
  process.exit(1)
}
console.log('\n✓ El paquete no lleva ficheros innecesarios y trae lo que necesita.')
