import { describe, expect, it } from 'vitest'
import { applyFormatting, matchCommand } from './commands'

describe('matchCommand', () => {
  it('reconoce una frase que es solo un comando, con o sin «Flow»', () => {
    expect(matchCommand('Redacta.')?.spec.id).toBe('rewrite')
    expect(matchCommand('Flow, copia.')?.spec.id).toBe('copy')
    expect(matchCommand('Oye Flow, más formal')?.spec.id).toBe('formal')
    expect(matchCommand('Nuevo párrafo.')).toMatchObject({ spec: { id: 'paragraph' }, rest: '' })
  })
  it('ejecuta el comando final tras «Flow» y conserva el texto previo', () => {
    expect(matchCommand('Mañana te mando el informe. Flow, redacta.')).toMatchObject({ spec: { id: 'rewrite' }, rest: 'Mañana te mando el informe.' })
    expect(matchCommand('Hola a todos, oye flow copia')).toMatchObject({ spec: { id: 'copy' }, rest: 'Hola a todos' })
  })
  it('no confunde el final de una frase normal con un comando', () => {
    expect(matchCommand('Necesito que lo hagas más corto')).toBeNull()
    expect(matchCommand('La app se llama flow y es genial')).toBeNull()
    expect(matchCommand('Hola mundo')).toBeNull()
  })
})

describe('applyFormatting', () => {
  it('convierte los comandos de formato dentro del texto', () => {
    expect(applyFormatting('Gracias por todo punto y aparte saludos')).toBe('Gracias por todo\n\nSaludos')
    expect(applyFormatting('Primera, nuevo párrafo. Segunda')).toBe('Primera\n\nSegunda')
    expect(applyFormatting('Uno salto de línea dos')).toBe('Uno\nDos')
  })
  it('deja el salto al final para la siguiente frase', () => {
    expect(applyFormatting('Hasta luego. Punto y aparte.')).toBe('Hasta luego.\n\n')
  })
  it('no toca «nueva línea» dentro de una frase normal', () => {
    expect(applyFormatting('Abrimos una nueva línea de productos')).toBe('Abrimos una nueva línea de productos')
  })
})
