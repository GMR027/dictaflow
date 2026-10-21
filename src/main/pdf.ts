// Generación de documentos PDF.
//
// Convierte texto con Markdown sencillo (títulos, listas, negrita, cursiva,
// código y citas) en un PDF legible, con la tipografía estándar que no
// necesita incrustar fuentes.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type Color } from 'pdf-lib'
import { writeFileSync } from 'fs'
import { mkdirSync } from 'fs'
import { dirname } from 'path'

const MARGIN = 56
const SIZE = 11
const LEADING = 15

interface Style { font: PDFFont; size: number; spaceBefore: number; spaceAfter: number; color: Color; indent?: number }

interface Block {
  kind: 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'quote' | 'code' | 'rule'
  text: string
}

/** Parte el texto en bloques, respetando el Markdown sencillo. */
export function parseBlocks(text: string): Block[] {
  const out: Block[] = []
  let inCode = false
  let code: string[] = []
  const paras = text.split(/\n{2,}/)
  for (const para of paras) {
    const lines = para.split('\n')
    if (lines[0]?.trim().startsWith('```')) {
      const rest = lines.slice(1)
      const end = rest.findIndex((l) => l.trim().startsWith('```'))
      const body = end >= 0 ? rest.slice(0, end) : rest
      out.push({ kind: 'code', text: body.join('\n') })
      inCode = false
      code = []
      continue
    }
    if (inCode) { code.push(para); continue }
    for (const line of lines) {
      const t = line.trim()
      if (!t) continue
      if (t.startsWith('```')) { inCode = true; code = []; continue }
      if (t.startsWith('### ')) out.push({ kind: 'h3', text: t.slice(4) })
      else if (t.startsWith('## ')) out.push({ kind: 'h2', text: t.slice(3) })
      else if (t.startsWith('# ')) out.push({ kind: 'h1', text: t.slice(2) })
      else if (/^[-*+] /.test(t)) out.push({ kind: 'li', text: t.replace(/^[-*+] /, '') })
      else if (/^>\s?/.test(t)) out.push({ kind: 'quote', text: t.replace(/^>\s?/, '') })
      else if (/^(-{3,}|\*{3,})$/.test(t)) out.push({ kind: 'rule', text: '' })
      else out.push({ kind: 'p', text: t })
    }
  }
  return out
}

/** Quita las marcas de Markdown y devuelve los trozos con su estilo. */
function inline(text: string): { text: string; bold: boolean; italic: boolean; code: boolean }[] {
  const out: { text: string; bold: boolean; italic: boolean; code: boolean }[] = []
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index), bold: false, italic: false, code: false })
    const t = m[0]
    if (t.startsWith('**')) out.push({ text: t.slice(2, -2), bold: true, italic: false, code: false })
    else if (t.startsWith('`')) out.push({ text: t.slice(1, -1), bold: false, italic: false, code: true })
    else out.push({ text: t.slice(1, -1), bold: false, italic: true, code: false })
    last = m.index! + t.length
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false, italic: false, code: false })
  return out
}

/** Parte un texto en líneas que caben en el ancho dado. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const probe = cur ? `${cur} ${w}` : w
    if (font.widthOfTextAtSize(probe, size) > maxWidth && cur) {
      lines.push(cur)
      cur = w
    } else {
      cur = probe
    }
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : ['']
}

/**
 * Genera un PDF y lo guarda. Devuelve la ruta del fichero.
 */
export async function generatePdf(title: string, body: string, dest: string): Promise<string> {
  const doc = await PDFDocument.create()
  doc.setTitle(title)
  doc.setCreator('DictaFlow')
  const pageSize: [number, number] = [595.28, 841.89] // A4
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique)
  const mono = await doc.embedFont(StandardFonts.Courier)

  const styles: Record<Block['kind'], Style> = {
    h1: { font: bold, size: 20, spaceBefore: 0, spaceAfter: 10, color: rgb(0.1, 0.1, 0.12) },
    h2: { font: bold, size: 15, spaceBefore: 14, spaceAfter: 6, color: rgb(0.15, 0.15, 0.2) },
    h3: { font: bold, size: 12.5, spaceBefore: 10, spaceAfter: 4, color: rgb(0.2, 0.2, 0.25) },
    p: { font: regular, size: SIZE, spaceBefore: 0, spaceAfter: 8, color: rgb(0.12, 0.12, 0.14) },
    li: { font: regular, size: SIZE, spaceBefore: 0, spaceAfter: 4, color: rgb(0.12, 0.12, 0.14), indent: 16 },
    quote: { font: italic, size: SIZE, spaceBefore: 4, spaceAfter: 8, color: rgb(0.3, 0.3, 0.35), indent: 16 },
    code: { font: mono, size: SIZE - 1, spaceBefore: 4, spaceAfter: 8, color: rgb(0.15, 0.15, 0.2) },
    rule: { font: regular, size: SIZE, spaceBefore: 6, spaceAfter: 10, color: rgb(0.8, 0.8, 0.85) }
  }

  let page: PDFPage = doc.addPage(pageSize)
  let y = pageSize[1] - MARGIN

  const newPage = (): void => {
    page = doc.addPage(pageSize)
    y = pageSize[1] - MARGIN
  }

  const writeLine = (text: string, style: Style, indent = 0): void => {
    const x = MARGIN + indent
    if (y < MARGIN + style.size) newPage()
    page.drawText(text, { x, y, size: style.size, font: style.font, color: style.color })
    y -= LEADING * (style.size / SIZE)
  }

  // Título del documento
  if (title) {
    for (const line of wrap(title, bold, 20, pageSize[0] - MARGIN * 2)) writeLine(line, styles.h1)
    y -= 4
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: pageSize[0] - MARGIN, y },
      thickness: 0.8,
      color: rgb(0.85, 0.85, 0.9)
    })
    y -= 12
  }

  for (const block of parseBlocks(body)) {
    const style = styles[block.kind]
    y -= style.spaceBefore
    if (block.kind === 'rule') {
      if (y < MARGIN + 20) newPage()
      page.drawLine({ start: { x: MARGIN, y }, end: { x: pageSize[0] - MARGIN, y }, thickness: 0.8, color: rgb(0.85, 0.85, 0.9) })
      y -= style.spaceAfter
      continue
    }
    if (block.kind === 'code') {
      for (const line of block.text.split('\n')) writeLine(line, style, style.indent ?? 0)
      y -= style.spaceAfter
      continue
    }
    // Se parte el texto en trozos con estilo y luego en líneas que caben.
    const pieces = inline(block.text)
    let line = ''
    let lineStyle = style
    for (const piece of pieces) {
      const font = piece.code ? mono : piece.bold ? bold : piece.italic ? italic : style.font
      const text = piece.code ? piece.text : piece.text
      const words = text.split(/\s+/).filter((w) => w !== '')
      for (const w of words) {
        const probe = line ? `${line} ${w}` : w
        if (font.widthOfTextAtSize(probe, style.size) > pageSize[0] - MARGIN * 2 - (style.indent ?? 0) && line) {
          writeLine(line, { ...style, font: lineStyle.font })
          line = ''
        }
        if (piece.code) line += (line ? ' ' : '') + w
        else line = line ? `${line} ${w}` : w
        lineStyle = { ...style, font }
      }
    }
    if (line) writeLine(line, { ...style, font: lineStyle.font })
    if (block.kind === 'li') writeLine('', style, 0)
    y -= style.spaceAfter
  }

  // Número de página
  const pages = doc.getPages()
  pages.forEach((p, i) => {
    p.drawText(`${i + 1} / ${pages.length}`, { x: pageSize[0] - MARGIN - 40, y: 30, size: 9, font: regular, color: rgb(0.5, 0.5, 0.55) })
  })

  const bytes = await doc.save()
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, bytes)
  return dest
}
