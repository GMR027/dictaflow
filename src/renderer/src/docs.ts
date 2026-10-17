import JSZip from 'jszip'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { LibraryDoc } from '@shared/types'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

type Chapters = LibraryDoc['chapters']

async function parsePdf(bytes: Uint8Array): Promise<Chapters> {
  const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise
  const pages: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent()
    let lastY: number | null = null
    let line = ''
    const lines: string[] = []
    for (const it of content.items as { str: string; transform: number[] }[]) {
      const y = it.transform[5]
      if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(line); line = '' }
      line += it.str
      lastY = y
    }
    lines.push(line)
    // une líneas del mismo párrafo; los saltos dobles marcan párrafo
    pages.push(lines.map((l) => l.trim()).filter(Boolean).join(' ').replace(/(\S)- (\p{Ll})/gu, '$1$2'))
  }
  const total = pages.join('').length
  if (total < pdf.numPages * 20) throw new Error('Este PDF parece escaneado (solo imágenes). El OCR aún no está disponible.')
  const out: Chapters = []
  const GROUP = 5
  for (let i = 0; i < pages.length; i += GROUP) {
    out.push({ title: `Páginas ${i + 1}–${Math.min(i + GROUP, pages.length)}`, text: pages.slice(i, i + GROUP).join('\n\n') })
  }
  return out
}

async function parseEpub(bytes: Uint8Array): Promise<Chapters> {
  const zip = await JSZip.loadAsync(bytes)
  const read = async (p: string): Promise<string> => {
    const f = zip.file(decodeURIComponent(p))
    if (!f) throw new Error(`EPUB inválido: falta ${p}`)
    return f.async('string')
  }
  const xml = (s: string): Document => new DOMParser().parseFromString(s, 'application/xml')
  const container = xml(await read('META-INF/container.xml'))
  const opfPath = container.querySelector('rootfile')?.getAttribute('full-path')
  if (!opfPath) throw new Error('EPUB inválido: sin archivo OPF')
  const opf = xml(await read(opfPath))
  const baseDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
  const manifest = new Map<string, string>()
  opf.querySelectorAll('manifest > item').forEach((i) => manifest.set(i.getAttribute('id') ?? '', i.getAttribute('href') ?? ''))
  const out: Chapters = []
  for (const ref of Array.from(opf.querySelectorAll('spine > itemref'))) {
    const href = manifest.get(ref.getAttribute('idref') ?? '')
    if (!href) continue
    const html = new DOMParser().parseFromString(await read(baseDir + href.split('#')[0]), 'text/html')
    const title = html.querySelector('h1,h2,h3,title')?.textContent?.trim() ?? ''
    const paras = Array.from(html.querySelectorAll('p,h1,h2,h3,h4,li,blockquote'))
      .map((n) => (n.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    const text = paras.join('\n\n')
    if (text.length > 80) out.push({ title: title || `Capítulo ${out.length + 1}`, text })
  }
  if (!out.length) throw new Error('No se encontró texto legible en el EPUB.')
  return out
}

function parseText(raw: string, markdown: boolean): Chapters {
  if (markdown && /^#{1,2} /m.test(raw)) {
    return raw.split(/^(?=#{1,2} )/m).filter((c) => c.trim()).map((c, i) => ({
      title: c.match(/^#{1,2} (.+)/)?.[1] ?? `Sección ${i + 1}`,
      text: c.replace(/^#{1,2} .+\n?/, '').replace(/[*_`>#]/g, '').trim()
    })).filter((c) => c.text)
  }
  const chunks: Chapters = []
  const paras = raw.split(/\n{2,}/)
  let cur = ''
  for (const p of paras) {
    if (cur.length > 8000) { chunks.push({ title: `Parte ${chunks.length + 1}`, text: cur }); cur = '' }
    cur += (cur ? '\n\n' : '') + p
  }
  if (cur.trim()) chunks.push({ title: `Parte ${chunks.length + 1}`, text: cur })
  return chunks
}

export async function importDocument(name: string, bytes: Uint8Array): Promise<LibraryDoc> {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const kind = (['pdf', 'epub', 'txt', 'md'] as const).find((k) => k === ext)
  if (!kind) throw new Error('Formato no soportado. Usa PDF, EPUB, TXT o MD.')
  const chapters =
    kind === 'pdf' ? await parsePdf(bytes) :
    kind === 'epub' ? await parseEpub(bytes) :
    parseText(new TextDecoder().decode(bytes), kind === 'md')
  return { id: crypto.randomUUID(), title: name.replace(/\.[^.]+$/, ''), kind, chapters, addedAt: Date.now(), progress: { chapter: 0, paragraph: 0 } }
}
