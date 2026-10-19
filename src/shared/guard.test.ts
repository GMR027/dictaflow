import { describe, expect, it } from 'vitest'
import { numberValues, numbersPreserved } from './guard'

describe('numberValues', () => {
  it('entiende dígitos con separadores', () => {
    expect(numberValues('son 20,000 euros y 3,5 kilos y 1.500')).toEqual([20000, 3.5, 1500])
  })
  it('entiende números en español', () => {
    expect(numberValues('veinte mil euros')).toEqual([20000])
    expect(numberValues('treinta y cinco personas')).toEqual([35])
    expect(numberValues('ciento veinte y doscientos')).toEqual([120, 200])
    expect(numberValues('dos millones trescientos mil')).toEqual([2300000])
    expect(numberValues('veintiún años')).toEqual([21])
  })
  it('«un/una» suelto es un artículo, pero «un millón» cuenta', () => {
    expect(numberValues('una casa y un perro')).toEqual([])
    expect(numberValues('un millón de personas')).toEqual([1000000])
    expect(numberValues('cuarenta y uno')).toEqual([41])
  })
  it('separa horas escritas con dos puntos', () => {
    expect(numberValues('a las 5:30')).toEqual([5, 30])
  })
})

describe('numbersPreserved', () => {
  it('acepta palabras ↔ dígitos del mismo valor', () => {
    expect(numbersPreserved('contrato de veinte mil euros', 'Contrato por 20.000 euros.')).toBe(true)
    expect(numbersPreserved('veinte mil', '20 mil')).toBe(true)
  })
  it('detecta cifras cambiadas, perdidas o inventadas', () => {
    expect(numbersPreserved('a las cinco y media', 'A las 5:30.')).toBe(false)
    expect(numbersPreserved('somos tres', 'Somos cuatro.')).toBe(false)
    expect(numbersPreserved('llama a las nueve', 'Llama.')).toBe(false)
    expect(numbersPreserved('hola qué tal', 'Hola, son las 10.')).toBe(false)
  })
  it('no se queja de textos sin números', () => {
    expect(numbersPreserved('hola eh qué tal', 'Hola, ¿qué tal?')).toBe(true)
  })
  it('cubre los casos medidos con qwen2.5:7b', () => {
    expect(numbersPreserved('a las cinco y media nos vemos en la oficina de Juan Pérez para revisar el contrato de veinte mil euros',
      'Mañana a las 5:30 nos encontramos en la oficina de Juan Pérez para revisar el contrato por 20,000 euros.')).toBe(false)
    expect(numbersPreserved('hay más de cien conexiones', 'Hay más de cien conexiones.')).toBe(true)
  })
})
