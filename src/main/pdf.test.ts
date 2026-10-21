import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generatePdf, parseBlocks } from './pdf'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dfpdf-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const MARKDOWN = `# Título del documento

Un párrafo normal con **negrita**, *cursiva* y \`código\`.

## Sección

- Primera viñeta
- Segunda viñeta

> Una cita

\`\`\`
linea de codigo
\`\`\`
`

describe('parseBlocks', () => {
  it('reconoce títulos, listas, citas y código', () => {
    const b = parseBlocks(MARKDOWN)
    expect(b[0]).toEqual({ kind: 'h1', text: 'Título del documento' })
    expect(b.some((x) => x.kind === 'h2')).toBe(true)
    expect(b.filter((x) => x.kind === 'li')).toHaveLength(2)
    expect(b.some((x) => x.kind === 'quote')).toBe(true)
    expect(b.some((x) => x.kind === 'code' && x.text.includes('linea de codigo'))).toBe(true)
  })
})

describe('generatePdf', () => {
  it('escribe un PDF válido', async () => {
    const dest = join(dir, 'salida.pdf')
    const r = await generatePdf('Mi documento', MARKDOWN, dest)
    expect(r).toBe(dest)
    expect(existsSync(dest)).toBe(true)
    const bytes = readFileSync(dest)
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
    expect(statSync(dest).size).toBeGreaterThan(800)
  })

  it('acepta un cuerpo vacío', async () => {
    const dest = join(dir, 'vacio.pdf')
    await generatePdf('Solo título', '', dest)
    expect(readFileSync(dest).subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('parte el texto largo en varias páginas', async () => {
    const largo = Array.from({ length: 400 }, (_, i) => `Línea número ${i} con texto suficiente para ocupar espacio.`).join('\n\n')
    const dest = join(dir, 'largo.pdf')
    await generatePdf('Largo', largo, dest)
    const bytes = readFileSync(dest)
    // Cada página nueva adds un objeto: el fichero crece claramente.
    expect(bytes.length).toBeGreaterThan(4000)
  })

  it('el texto del PDF se puede leer de verdad', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const dest = join(dir, 'legible.pdf')
    await generatePdf('Informe', '# Apartado\n\nTexto con **negrita** y una lista:\n\n- uno\n- dos\n', dest)
    const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(dest)) }).promise
    let text = ''
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      text += content.items.map((it) => (it as { str: string }).str).join(' ')
    }
    expect(text).toContain('Informe')
    expect(text).toContain('Apartado')
    expect(text).toContain('negrita')
    expect(text).toContain('uno')
  })
})
