/**
 * Audio para Rust: muestras de 16 bits en base64. Por el puente de Android un cuerpo binario llega
 * como lista JSON de bytes (unos 16 caracteres por muestra); así son menos de 3.
 */
export function pcmToB64(pcm: Float32Array): string {
  const bytes = new Uint8Array(pcm.length * 2)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.max(-1, Math.min(1, Number.isFinite(pcm[i]) ? pcm[i] : 0))
    view.setInt16(i * 2, Math.round(v < 0 ? v * 32768 : v * 32767), true)
  }
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export { whisperPrompt } from '@shared/whisper-prompt'
