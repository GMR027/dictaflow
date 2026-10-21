import { describe, expect, it } from 'vitest'
import { extractJson } from './json'

describe('extractJson', () => {
  it('saca un objeto JSON limpio', () => {
    expect(extractJson<{ a: number }>('{"a": 1}')).toEqual({ a: 1 })
  })

  it('saca el JSON de un bloque de código', () => {
    expect(extractJson<{ a: number }>('```json\n{"a": 2}\n```')).toEqual({ a: 2 })
  })

  it('ignora el texto que venga antes y después', () => {
    expect(extractJson<{ a: number }>('Aquí tienes el acta:\n{"a": 3}\nEspero que sirva.')).toEqual({ a: 3 })
  })

  it('respeta las llaves dentro de las cadenas', () => {
    const r = extractJson<{ texto: string }>('{"texto": "una llave } dentro"}')
    expect(r?.texto).toBe('una llave } dentro')
  })

  it('respeta las comillas escapadas', () => {
    const r = extractJson<{ texto: string }>('{"texto": "dice \\"hola\\" y {esto}"}')
    expect(r?.texto).toBe('dice "hola" y {esto}')
  })

  it('devuelve null si no hay JSON', () => {
    expect(extractJson('no hay json aquí')).toBeNull()
    expect(extractJson('')).toBeNull()
  })

  it('devuelve null si el JSON está incompleto', () => {
    expect(extractJson('{"a": 1')).toBeNull()
  })

  it('devuelve null si el JSON está mal formado', () => {
    expect(extractJson('{"a": }')).toBeNull()
  })

  it('coge el primer objeto cuando hay varios', () => {
    expect(extractJson<{ a: number }>('{"a": 1} y luego {"a": 2}')).toEqual({ a: 1 })
  })
})
