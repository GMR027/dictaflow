// Protección contra redacciones que cambian cifras, horas o cantidades.
// Compara los valores numéricos del texto dictado con los del redactado (dígitos y números en español).

const UNITS: Record<string, number> = {
  cero: 0, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13,
  catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21,
  veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28,
  veintinueve: 29, cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400,
  cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700, setecientas: 700,
  ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900
}
const TENS: Record<string, number> = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 }
/** «un/uno/una» solos son artículos casi siempre: solo cuentan dentro de un número («treinta y uno», «un millón»). */
const ONE = new Set(['un', 'uno', 'una'])

const strip = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

function digitValue(raw: string): number {
  if (/^\d{1,3}([.,]\d{3})+$/.test(raw)) return Number(raw.replace(/[.,]/g, ''))
  return Number(raw.replace(',', '.'))
}

/** Valores numéricos del texto, en orden; el 1 se ignora porque «un/una» es ambiguo. */
export function numberValues(text: string): number[] {
  const tokens = strip(text).match(/\d+(?:[.,]\d+)*|[a-zñ]+|[^\sa-zñ\d]/g) ?? []
  const out: number[] = []
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    if (/^\d/.test(t)) {
      let v = digitValue(t)
      const next = tokens[i + 1]
      if (next === 'mil') { v *= 1000; i++ } else if (next === 'millon' || next === 'millones') { v *= 1e6; i++ }
      out.push(v)
      i++
      continue
    }
    const isWord = (w: string | undefined): boolean => !!w && (w in UNITS || w in TENS || ONE.has(w) || w === 'mil' || w === 'millon' || w === 'millones')
    if (!isWord(t)) { i++; continue }
    let big = 0, total = 0, cur = 0, prevTens = false, words = 0
    for (; i < tokens.length; i++) {
      const w = tokens[i]
      if (w === 'y' && prevTens && isWord(tokens[i + 1]) && !['mil', 'millon', 'millones'].includes(tokens[i + 1])) { prevTens = false; continue }
      if (w in UNITS) { cur += UNITS[w]; prevTens = false }
      else if (w in TENS) { cur += TENS[w]; prevTens = true }
      else if (ONE.has(w)) { cur += 1; prevTens = false }
      else if (w === 'mil') { total += (cur || 1) * 1000; cur = 0; prevTens = false }
      else if (w === 'millon' || w === 'millones') { big += (total + cur || 1) * 1e6; total = 0; cur = 0; prevTens = false }
      else break
      words++
    }
    // un «un/una» suelto (sin más palabras numéricas) es un artículo
    if (words === 1 && cur === 1 && total === 0 && big === 0) continue
    out.push(big + total + cur)
  }
  return out.filter((v) => v !== 1)
}

/** true si el texto redactado conserva exactamente los mismos valores numéricos que el original. */
export function numbersPreserved(original: string, rewritten: string): boolean {
  const a = numberValues(original).sort((x, y) => x - y)
  const b = numberValues(rewritten).sort((x, y) => x - y)
  return a.length === b.length && a.every((v, i) => v === b[i])
}
