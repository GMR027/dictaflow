// Frases para probar y clonar voces.
//
// Las frases de prueba cubren lo que delata una voz sintética: todas las vocales, consonantes
// difíciles (rr, ll/y, ñ, j, z/c, ch), diptongos, números, una pregunta y una exclamación.
// El guion de referencia (~30 s leído con calma) es lo que conviene grabar para clonar una voz:
// frases variadas, con distintas entonaciones, en un sitio silencioso.
import type { Lang } from './types'

export const TEST_PHRASES: Record<Lang, string[]> = {
  es: [
    'Hola, esta es una prueba de mi voz.',
    'El perro de San Roque no tiene rabo porque Ramón Ramírez se lo ha cortado.',
    '¿Me confirmas la reunión del jueves a las diez y media?',
    '¡Qué buena noticia! Mañana salimos temprano hacia la playa.',
    'El pingüino bebió agua junto a la cigüeña en el zoológico.',
    'Tengo doscientos cuarenta y ocho mensajes sin leer desde el lunes.',
    'Llueve en la ciudad y las calles brillan bajo la luz amarilla.',
    'Chelo encontró una jirafa de juguete en el cajón de la cocina.',
    'Por favor, recuérdame comprar pan, leche, huevos y café.',
    'La exposición de pintura abre el doce de octubre a las seis.',
    'Gracias por escucharme; nos vemos pronto.',
    'Cuéntame, ¿cómo te fue en el viaje a Guadalajara?'
  ],
  en: [
    'Hello, this is a test of my voice.',
    'The quick brown fox jumps over the lazy dog.',
    'Could you confirm Thursday’s meeting at half past ten?',
    'What great news! We are leaving early for the beach tomorrow.',
    'She sells seashells by the seashore on sunny Sundays.',
    'I have two hundred and forty-eight unread messages since Monday.',
    'Rain falls on the city and the streets shine under yellow lights.',
    'Please remind me to buy bread, milk, eggs and coffee.',
    'Thank you for listening; see you soon.',
    'How was your trip to Vancouver last weekend?'
  ]
}

export const REFERENCE_SCRIPT: Record<Lang, string> = {
  es:
    'Hola, esta es mi voz y estoy grabando una muestra corta. Hoy es un buen día para empezar algo nuevo. ' +
    '¿Sabes qué me gusta de las mañanas? El olor a café, la luz que entra por la ventana y el ruido lejano de la ciudad. ' +
    'A veces leo un rato, otras salgo a caminar por el parque. ' +
    'El año pasado viajé a Oaxaca, a Sevilla y a Buenos Aires; cada lugar tenía su ritmo y su forma de hablar. ' +
    '¡Qué sorpresa fue probar el chocolate caliente con churros! ' +
    'Si tengo que contar, digo: uno, dos, tres, quince, cuarenta y dos, cien. ' +
    'Gracias por escuchar; hasta pronto.',
  en:
    'Hello, this is my voice and I am recording a short sample. Today feels like a good day to start something new. ' +
    'Do you know what I like about mornings? The smell of coffee, the light through the window and the distant sound of the city. ' +
    'Sometimes I read for a while; other times I go for a walk in the park. ' +
    'Last year I travelled to Toronto, Lisbon and Melbourne, and each place had its own rhythm. ' +
    'What a surprise it was to taste real maple syrup! ' +
    'When I count, I say: one, two, three, fifteen, forty-two, one hundred. ' +
    'Thanks for listening; see you soon.'
}
