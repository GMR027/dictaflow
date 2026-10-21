// Automatizaciones: secuencias de pasos que se pueden guardar y volver a
// ejecutar sobre cualquier texto (un dictado, una reunión, un capítulo).
//
// Los pasos usan los mismos servicios que el resto de la aplicación: nada de
// lógica duplicada.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Lang } from '@shared/types'
import type { Automation, AutomationStep, StepType } from '@shared/automation'

export type { Automation, AutomationStep, StepType }
import { dataDir } from './paths'
import { generate } from './llm'
import { exportNote } from './tools'
import { generatePdf } from './pdf'
import { saveEvent } from './calendar'
import { synthesize } from './tts'


export interface AutomationInput {
  title: string
  text: string
  lang: Lang
  /** Dónde se dejan los ficheros. */
  dir: string
}

export interface AutomationResult {
  /** Texto final tras los pasos de IA. */
  text: string
  /** Ficheros producidos. */
  files: string[]
  /** Lo que hizo cada paso. */
  steps: { type: StepType; detail: string }[]
}

const file = join(dataDir, 'automations.json')

export const listAutomations = (): Automation[] => {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Automation[]) : []
  } catch {
    return []
  }
}

export const saveAutomation = (a: Automation): void => {
  mkdirSync(dataDir, { recursive: true })
  const all = listAutomations()
  const i = all.findIndex((x) => x.id === a.id)
  if (i >= 0) all[i] = a
  else all.unshift(a)
  writeFileSync(file, JSON.stringify(all, null, 2), { mode: 0o600 })
}

export const removeAutomation = (id: string): void => {
  writeFileSync(file, JSON.stringify(listAutomations().filter((a) => a.id !== id), null, 2), { mode: 0o600 })
}

/** Nombres y descripción de los pasos disponibles. */
export const STEP_INFO: Record<StepType, { label: string; detail: string }> = {
  summary: { label: 'Resumir', detail: 'Resume el texto con la IA.' },
  notes: { label: 'Convertir en notas', detail: 'Convierte el texto en notas estructuradas en Markdown.' },
  minutes: { label: 'Generar acta', detail: 'Genera el acta con resumen, decisiones y tareas.' },
  pdf: { label: 'Guardar como PDF', detail: 'Escribe el texto en un PDF.' },
  note: { label: 'Guardar como nota', detail: 'Guarda el texto como nota Markdown en tu carpeta de notas.' },
  event: { label: 'Crear evento', detail: 'Crea un evento en la agenda con el texto como descripción.' },
  tts: { label: 'Leer en voz alta', detail: 'Genera el audio del texto con la voz elegida.' }
}

/**
 * Ejecuta una automatización. Los pasos que usan la IA se encadenan: el
 * resultado de uno es la entrada del siguiente.
 */
export async function runAutomation(a: Automation, input: AutomationInput): Promise<AutomationResult> {
  const steps: { type: StepType; detail: string }[] = []
  const files: string[] = []
  let text = input.text
  mkdirSync(input.dir, { recursive: true })

  for (const step of a.steps) {
    switch (step.type) {
      case 'summary': {
        text = await generate('summary', text, input.lang)
        steps.push({ type: step.type, detail: 'Resumen generado' })
        break
      }
      case 'notes': {
        text = await generate('notes', text, input.lang)
        steps.push({ type: step.type, detail: 'Notas generadas' })
        break
      }
      case 'minutes': {
        text = await generate('meeting', text, input.lang)
        steps.push({ type: step.type, detail: 'Acta generada' })
        break
      }
      case 'pdf': {
        const dest = join(input.dir, `${input.title.replace(/[^\w\s-]/g, '').trim().slice(0, 60) || 'documento'}.pdf`)
        files.push(await generatePdf(input.title, text, dest))
        steps.push({ type: step.type, detail: `PDF: ${dest}` })
        break
      }
      case 'note': {
        const f = exportNote(step.text || input.title, text, ['automatización'])
        files.push(f)
        steps.push({ type: step.type, detail: `Nota: ${f}` })
        break
      }
      case 'event': {
        const start = Date.now() + (step.inMinutes ?? 60) * 60000
        saveEvent({
          id: crypto.randomUUID(),
          title: step.text || input.title,
          notes: text.slice(0, 2000),
          start,
          durationMin: step.minutes ?? 30,
          location: '',
          reminder: true,
          remindBeforeMin: 10
        })
        steps.push({ type: step.type, detail: 'Evento creado en la agenda' })
        break
      }
      case 'tts': {
        const wav = await synthesize(text, input.lang)
        const dest = join(input.dir, `${input.title.replace(/[^\w\s-]/g, '').trim().slice(0, 60) || 'audio'}.wav`)
        writeFileSync(dest, wav)
        files.push(dest)
        steps.push({ type: step.type, detail: `Audio: ${dest}` })
        break
      }
    }
  }
  return { text, files, steps }
}
