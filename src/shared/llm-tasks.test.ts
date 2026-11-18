import { describe, expect, it } from 'vitest'
import { createLlmTasks, parseMinutes, splitForChunks, type Complete } from './llm-tasks'
import type { ChatMsg } from './types'

/** Modelo simulado: responde en orden lo que se le dé y guarda lo que se le pidió. */
function fake(...answers: string[]): { complete: Complete; calls: { system: string; msgs: ChatMsg[]; temperature?: number }[] } {
  const calls: { system: string; msgs: ChatMsg[]; temperature?: number }[] = []
  const complete: Complete = async (system, msgs, temperature) => {
    calls.push({ system, msgs, temperature })
    return answers[Math.min(calls.length - 1, answers.length - 1)]
  }
  return { complete, calls }
}

const settings = { dictionary: [{ from: 'dicta flow', to: 'DictaFlow' }], guardNumbers: true }

describe('tareas de IA compartidas', () => {
  it('la redacción incluye el tono y los términos del diccionario', async () => {
    const m = fake('Hola, prueba.')
    const t = createLlmTasks({ complete: m.complete, settings: () => settings })
    expect(await t.rewrite({ text: 'hola eh prueba', lang: 'es', tone: 'formal', mode: 'rewrite' })).toBe('Hola, prueba.')
    expect(m.calls[0].system).toContain('tono formal')
    expect(m.calls[0].system).toContain('DictaFlow')
    expect(m.calls[0].temperature).toBe(0.4)
  })

  it('si el modelo cambia cifras, reintenta y al final conserva lo dictado', async () => {
    const m = fake('Nos vemos a las 11.', 'Nos vemos a las 11.')
    const t = createLlmTasks({ complete: m.complete, settings: () => settings })
    const r = await t.rewriteGuarded({ text: 'nos vemos a las 10', lang: 'es', tone: 'neutral', mode: 'rewrite' })
    expect(r).toEqual({ text: 'nos vemos a las 10', reverted: true })
    expect(m.calls).toHaveLength(2)
    expect(m.calls[1].temperature).toBe(0.1)
  })

  it('parte los textos largos según los límites de la plataforma y une las partes', async () => {
    const m = fake('resumen parcial', 'resumen final')
    const limits = { chunkChars: 30, maxChars: 40, minutesChars: 20 }
    const t = createLlmTasks({ complete: m.complete, settings: () => settings, limits })
    const text = ['a'.repeat(25), 'b'.repeat(25), 'c'.repeat(25)].join('\n\n')
    expect(await t.generate('summary', text, 'es')).toBe('resumen final')
    expect(m.calls).toHaveLength(4) // 3 partes + la unión
    expect(m.calls[0].system).toContain('parte 1 de 3')

    await t.generateMinutes('x'.repeat(100), 'es')
    expect(m.calls[4].msgs[0].content).toBe(`Transcripción:\n${'x'.repeat(20)}`)
  })

  it('trocea por párrafos sin partirlos', () => {
    expect(splitForChunks('uno\n\ndos\n\ntres', 8)).toEqual(['uno\n\ndos', 'tres'])
  })

  it('lee el acta del JSON del modelo o devuelve null', () => {
    const acta = parseMinutes('Claro: {"summary":"S","topics":["T"],"tasks":[{"text":"Enviar","owner":"Ana"},{"text":""}]}')
    expect(acta).toEqual({ summary: 'S', topics: ['T'], decisions: [], agreements: [], tasks: [{ text: 'Enviar', owner: 'Ana', due: '', done: false }] })
    expect(parseMinutes('no sé')).toBeNull()
  })
})
