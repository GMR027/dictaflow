// Copia de seguridad y restauración.
//
// Se guarda todo lo que el usuario ha creado: ajustes, biblioteca, reuniones,
// prompts, historial, voces descargadas y modelos. El archivo es un ZIP que se
// puede guardar donde quiera y restaurar en otro equipo.
//
// Lo que NO se guarda: las claves de los servicios en la nube. Van cifradas con
// el llavero del sistema y ese cifrado no se puede portable; por seguridad no
// se incluyen en la copia y hay que volver a escribirlas al restaurar.
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import JSZip from 'jszip'
import { dataDir } from './paths'

/** Partes de la carpeta de datos que se guardan en la copia. */
const INCLUDED = ['settings.json', 'library.json', 'meetings.json', 'prompts.json', 'history.json', 'library', 'voices', 'models', 'audiolibros']
/** Ficheros que nunca se copian (contienen secretos cifrados con el llavero). */
const EXCLUDED = ['secrets.json', 'jobs.json']

export interface BackupInfo {
  file: string
  createdAt: number
  sizeMB: number
  contents: string[]
}

/** Crea una copia de seguridad y devuelve dónde está. */
export async function createBackup(dest: string, base = dataDir): Promise<BackupInfo> {
  const zip = new JSZip()
  const contents: string[] = []
  for (const name of INCLUDED) {
    const from = join(base, name)
    if (!existsSync(from)) continue
    const st = statSync(from)
    if (st.isDirectory()) {
      for (const f of readdirSync(from)) {
        const p = join(from, f)
        if (!statSync(p).isFile()) continue
        zip.file(`${name}/${f}`, readFileSync(p))
        contents.push(`${name}/${f}`)
      }
    } else {
      zip.file(name, readFileSync(from))
      contents.push(name)
    }
  }
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  mkdirSync(join(dest, '..'), { recursive: true })
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(dest)
    out.on('error', reject)
    out.on('close', () => resolve())
    out.end(buf)
  })
  return { file: dest, createdAt: Date.now(), sizeMB: Math.round((buf.length / 1048576) * 10) / 10, contents }
}

/**
 * Restaura una copia. Los ficheros que trae se copian a la carpeta de datos;
 * los que ya existen y no están en la copia no se tocan.
 */
export async function restoreBackup(file: string): Promise<{ restored: string[]; skipped: string[] }> {
  return restoreFromBuffer(readFileSync(file))
}

/** Restaura desde el contenido de un ZIP, sin tocar el disco antes. */
export async function restoreFromBuffer(buf: Buffer, base = dataDir): Promise<{ restored: string[]; skipped: string[] }> {
  const zip = await JSZip.loadAsync(buf)
  const restored: string[] = []
  const skipped: string[] = []
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name].dir) continue
    const base_ = name.split('/')[0]
    if (EXCLUDED.includes(base_) || EXCLUDED.includes(name)) { skipped.push(name); continue }
    const dest = join(base, name)
    mkdirSync(join(dest, '..'), { recursive: true })
    const content = await zip.files[name].async('nodebuffer')
    writeFileSync(dest, content)
    restored.push(name)
  }
  return { restored, skipped }
}

/** Borra los datos de DictaFlow (sin tocar lo que el usuario haya exportado). */
export function wipeData(): void {
  for (const name of [...INCLUDED, ...EXCLUDED, 'tmp', 'exportaciones']) {
    const p = join(dataDir, name)
    if (!existsSync(p)) continue
    rmSync(p, { recursive: true, force: true })
  }
}
