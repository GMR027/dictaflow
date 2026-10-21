/**
 * Divide un texto en trozos sintetizables, sin partir palabras a mitad.
 * Lo usan la interfaz (lectura en voz alta) y el proceso principal
 * (exportación y audiolibros): una sola implementación para los dos.
 */
export function splitText(text: string, max = 400): string[] {
  const out: string[] = []
  for (const para of text.split(/\n{2,}|\r\n{2,}/)) {
    const p = para.replace(/\s+/g, ' ').trim()
    if (!p) continue
    let cur = ''
    for (const sentence of p.match(/[^.!?…]+[.!?…]*\s*/g) ?? [p]) {
      if ((cur + sentence).length > max && cur) { out.push(cur.trim()); cur = '' }
      cur += sentence
      while (cur.length > max * 1.5) { out.push(cur.slice(0, max)); cur = cur.slice(max) }
    }
    if (cur.trim()) out.push(cur.trim())
  }
  return out
}
