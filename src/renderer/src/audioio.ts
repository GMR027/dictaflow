import { SAMPLE_RATE } from './audio'

/** Decodifica cualquier formato que soporte Chromium (mp3, wav, ogg, flac, m4a, webm…) a 16 kHz mono. */
export async function decodeToMono16k(bytes: Uint8Array): Promise<Float32Array> {
  const ctx = new AudioContext()
  const buf = await ctx.decodeAudioData(bytes.slice().buffer)
  await ctx.close()
  const frames = Math.ceil(buf.duration * SAMPLE_RATE)
  const off = new OfflineAudioContext(1, frames, SAMPLE_RATE)
  const src = off.createBufferSource()
  src.buffer = buf
  src.connect(off.destination) // la mezcla a mono la hace el propio destino de 1 canal
  src.start()
  return (await off.startRendering()).getChannelData(0)
}

export function encodeWav(pcm: Float32Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2))
  const str = (o: number, s: string): void => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF'); out.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ')
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true)
  out.setUint32(24, sampleRate, true); out.setUint32(28, sampleRate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true)
  str(36, 'data'); out.setUint32(40, pcm.length * 2, true)
  for (let i = 0; i < pcm.length; i++) out.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767), true)
  return new Uint8Array(out.buffer)
}

/** WAV (de Piper o la nube) → PCM float + frecuencia, para concatenar o convertir a MP3. */
export async function wavToPcm(wav: Uint8Array): Promise<{ pcm: Float32Array; rate: number }> {
  const ctx = new AudioContext()
  const buf = await ctx.decodeAudioData(wav.slice().buffer)
  await ctx.close()
  return { pcm: buf.getChannelData(0).slice(), rate: buf.sampleRate }
}

export const fmtTime = (sec: number): string => {
  const s = Math.floor(sec)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

const srtTime = (t: number, sep: string): string => {
  const ms = Math.round(t * 1000)
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}`
}

export function toSubtitles(segs: { start: number; end: number; text: string }[], kind: 'srt' | 'vtt'): string {
  const body = segs
    .map((s, i) => `${kind === 'srt' ? `${i + 1}\n` : ''}${srtTime(s.start, kind === 'srt' ? ',' : '.')} --> ${srtTime(Math.max(s.end, s.start + 0.5), kind === 'srt' ? ',' : '.')}\n${s.text}\n`)
    .join('\n')
  return kind === 'vtt' ? `WEBVTT\n\n${body}` : body
}
