// Servicio de exportación de audio.
//
// Lo usan el texto a voz, el lector y los audiolibros: una sola ruta para
// sintetizar, codificar y guardar. El audio se escribe a disco a medida que se
// genera, así que un libro entero no cabe nunca en memoria.

import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import type { Lang } from '@shared/types'
import { splitText } from '@shared/text'
import { dataDir } from '../paths'
import { synthesize } from '../tts'
import { Mp3Writer, wavToPcm } from './encode'

/** Divide un texto en trozos sintetizables, sin partir palabras. */
export { splitText } from '@shared/text'

const slug = (t: string): string =>
  t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'audio'

/** Carpeta donde se dejan los audiolibros generados. */
export const audiobooksDir = (): string => join(dataDir, 'audiolibros')

/**
 * Escribe un texto como MP3 y devuelve la ruta del fichero.
 * `destDir` permite elegir dónde se guarda.
 */
export async function exportTextAsMp3(text: string, lang: Lang, voice: string | undefined, destDir: string, name: string): Promise<string> {
  mkdirSync(destDir, { recursive: true })
  const dest = join(destDir, `${slug(name)}.mp3`)
  const units = splitText(text)
  if (!units.length) throw new Error('No hay texto que convertir en audio.')

  // La frecuencia de salida la fija el motor; se usa la del primer fragmento.
  const first = wavToPcm(await synthesize(units[0], lang, voice))
  const writer = new Mp3Writer(dest, first.rate)
  writer.push(first.pcm, first.rate)
  for (let i = 1; i < units.length; i++) {
    const r = wavToPcm(await synthesize(units[i], lang, voice))
    writer.push(r.pcm, r.rate)
  }
  await writer.finish()
  return dest
}

/** Une varios MP3 en uno solo (los fotogramas MP3 se pueden concatenar). */
export function joinMp3(files: string[], dest: string): string {
  mkdirSync(join(dest, '..'), { recursive: true })
  const out = createWriteStream(dest)
  for (const f of files) createReadStream(f).pipe(out, { end: false })
  out.end()
  return dest
}

export interface AudiobookChapter {
  title: string
  text: string
}

export interface AudiobookOptions {
  title: string
  chapters: AudiobookChapter[]
  lang: Lang
  voice?: string
  /** Dónde se dejan los ficheros. */
  dir: string
  /** Capítulo por el que se empieza (para reanudar). */
  from?: number
  /** Se avisa del progreso: porcentaje y texto. */
  onProgress?: (percent: number, detail: string) => void
  /** Se avisa de que hay que parar. */
  shouldStop?: () => boolean
}

/**
 * Convierte un libro en audio, un capítulo por fichero.
 *
 * Cada capítulo va a su propio MP3: así el trabajo se puede reanudar (los
 * capítulos ya hechos se saltan) y el usuario puede escuchar solo una parte.
 * Al final se unen en un solo fichero.
 */
export async function buildAudiobook(opts: AudiobookOptions): Promise<{ file: string; chapters: string[] }> {
  const { title, chapters, lang, voice, dir, from = 0 } = opts
  mkdirSync(dir, { recursive: true })
  const files: string[] = []
  const total = chapters.length || 1

  for (let i = from; i < chapters.length; i++) {
    if (opts.shouldStop?.()) throw new Error('Cancelado por el usuario.')
    const ch = chapters[i]
    const name = `${String(i + 1).padStart(3, '0')}-${slug(ch.title)}.mp3`
    const dest = join(dir, name)
    files.push(dest)
    if (existsSync(dest) && statSync(dest).size > 0) {
      opts.onProgress?.(Math.round((i / total) * 100), `Capítulo ${i + 1} de ${total}: ya estaba hecho`)
      continue
    }
    opts.onProgress?.(Math.round((i / total) * 100), `Capítulo ${i + 1} de ${total}: ${ch.title}`)
    const units = splitText(ch.text, 350)
    if (!units.length) continue
    const first = wavToPcm(await synthesize(units[0], lang, voice))
    const writer = new Mp3Writer(dest, first.rate)
    writer.push(first.pcm, first.rate)
    for (let u = 1; u < units.length; u++) {
      if (opts.shouldStop?.()) {
        await writer.finish()
        rmSync(dest, { force: true })
        throw new Error('Cancelado por el usuario.')
      }
      const r = wavToPcm(await synthesize(units[u], lang, voice))
      writer.push(r.pcm, r.rate)
      opts.onProgress?.(
        Math.round(((i + u / units.length) / total) * 100),
        `Capítulo ${i + 1} de ${total}: párrafo ${u + 1} de ${units.length}`
      )
    }
    await writer.finish()
  }

  const final = join(dir, `${slug(title)}.mp3`)
  joinMp3(files, final)
  return { file: final, chapters: files }
}

/** Los audiolibros ya generados en este equipo. */
export function listAudiobooks(): { title: string; dir: string; files: number; sizeMB: number }[] {
  const root = audiobooksDir()
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const dir = join(root, e.name)
      const files = readdirSync(dir).filter((f) => f.endsWith('.mp3'))
      const sizeMB = files.reduce((n, f) => n + statSync(join(dir, f)).size, 0) / 1048576
      return { title: e.name, dir, files: files.length, sizeMB: Math.round(sizeMB * 10) / 10 }
    })
}
