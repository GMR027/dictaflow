// Lectura de WAV en el proceso principal.
// Piper y los servicios de audio devuelven WAV PCM16; el codificador MP3
// necesita las muestras, no el fichero completo en memoria.

export interface DecodedWav {
  pcm: Float32Array
  sampleRate: number
  channels: number
}

/** Lee un WAV PCM16 (o PCM32 float) y devuelve sus muestras. */
export function decodeWav(bytes: Uint8Array): DecodedWav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (o: number): string => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('El audio no es un WAV válido.')

  let offset = 12
  let sampleRate = 22050
  let channels = 1
  let bits = 16
  let format = 1
  let data: { start: number; length: number } | null = null

  while (offset + 8 <= bytes.byteLength) {
    const id = tag(offset)
    const size = view.getUint32(offset + 4, true)
    const start = offset + 8
    if (id === 'fmt ') {
      format = view.getUint16(start, true)
      channels = view.getUint16(start + 2, true)
      sampleRate = view.getUint32(start + 4, true)
      bits = view.getUint16(start + 14, true)
    } else if (id === 'data') {
      data = { start, length: Math.min(size, bytes.byteLength - start) }
    }
    offset = start + size + (size % 2)
  }
  if (!data) throw new Error('El WAV no tiene datos de audio.')

  const frames = Math.floor(data.length / (channels * (bits / 8)))
  const pcm = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let v = 0
    for (let c = 0; c < channels; c++) {
      const o = data.start + (i * channels + c) * (bits / 8)
      if (format === 3 && bits === 32) v += view.getFloat32(o, true) / channels
      else if (bits === 16) v += view.getInt16(o, true) / 32768 / channels
      else if (bits === 32) v += view.getInt32(o, true) / 2147483648 / channels
      else if (bits === 8) v += (view.getUint8(o) - 128) / 128 / channels
    }
    pcm[i] = Math.max(-1, Math.min(1, v))
  }
  return { pcm, sampleRate, channels }
}
