// PDF en el escritorio: se genera con @shared/pdf y se escribe en disco.
import { mkdirSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { buildPdf } from '@shared/pdf'

export { parseBlocks } from '@shared/pdf'

/** Genera un PDF y lo guarda. Devuelve la ruta del fichero. */
export async function generatePdf(title: string, body: string, dest: string): Promise<string> {
  const bytes = await buildPdf(title, body)
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, bytes)
  return dest
}
