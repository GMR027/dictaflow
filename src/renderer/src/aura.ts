// Aura de audio (Android): un brillo en el borde de toda la pantalla que dice qué está pasando
// con el audio, sin tener que mirar un botón concreto.
//   • azul: el micrófono escucha o la app está hablando (lectura en voz alta);
//   • amarillo: se está transcribiendo o redactando lo que dijiste;
//   • verde: listo (unos segundos).
// Lo usan todas las herramientas de audio: el micrófono (audio.ts), la reproducción (cualquier
// <audio>) y las llamadas de transcripción/redacción (platform/tauri.ts).

export type AuraState = 'idle' | 'listen' | 'busy' | 'done'

let listening = 0
let busy = 0
let done = false
let doneTimer: ReturnType<typeof setTimeout> | null = null
let settleTimer: ReturnType<typeof setTimeout> | null = null
let pendingDone = false
const listeners = new Set<(s: AuraState) => void>()

/** Cuánto se queda el verde. */
export const DONE_MS = 2500
/** Espera antes del verde: entre transcribir y redactar hay un instante sin trabajo. */
const SETTLE_MS = 400

export function auraState(): AuraState {
  if (listening > 0) return 'listen'
  // También durante la breve espera antes del verde: si no, el borde parpadearía.
  if (busy > 0 || settleTimer) return 'busy'
  return done ? 'done' : 'idle'
}

function emit(): void {
  const s = auraState()
  for (const l of listeners) l(s)
}

export function onAura(cb: (s: AuraState) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function clearDone(): void {
  done = false
  if (doneTimer) clearTimeout(doneTimer)
  doneTimer = null
}

/** El micrófono o el altavoz empiezan; la función devuelta los da por terminados (una sola vez). */
export function auraListen(): () => void {
  listening++
  clearDone()
  emit()
  let open = true
  return () => {
    if (!open) return
    open = false
    listening = Math.max(0, listening - 1)
    emit()
  }
}

/**
 * Trabajo en curso (transcribir, redactar). Al terminar con `ok`, y si en un momento no queda nada
 * más pendiente, se muestra el verde.
 */
export function auraBusy(): (ok: boolean) => void {
  busy++
  clearDone()
  if (settleTimer) clearTimeout(settleTimer)
  emit()
  let open = true
  return (ok) => {
    if (!open) return
    open = false
    busy = Math.max(0, busy - 1)
    pendingDone ||= ok
    if (busy === 0) {
      if (settleTimer) clearTimeout(settleTimer)
      settleTimer = setTimeout(() => {
        settleTimer = null
        if (busy > 0) return
        if (pendingDone && listening === 0) {
          done = true
          doneTimer = setTimeout(() => { done = false; doneTimer = null; emit() }, DONE_MS)
        }
        pendingDone = false
        emit()
      }, SETTLE_MS)
    }
    emit()
  }
}

/** Envuelve una promesa como trabajo en curso. */
export async function withAura<T>(p: () => Promise<T>, success: (r: T) => boolean = () => true): Promise<T> {
  const end = auraBusy()
  try {
    const r = await p()
    end(success(r))
    return r
  } catch (e) {
    end(false)
    throw e
  }
}

/**
 * Cualquier <audio> que suene (lectura en voz alta, muestras de voces, grabaciones) pone el aura en
 * azul mientras suena. Se instala una vez, parcheando `play()`: los Audio() sueltos no están en el
 * documento y sus eventos no se pueden escuchar desde fuera.
 */
export function watchPlayback(): void {
  const proto = HTMLMediaElement.prototype as HTMLMediaElement & { __aura?: boolean }
  if (proto.__aura) return
  proto.__aura = true
  const play = proto.play
  proto.play = function (this: HTMLMediaElement): Promise<void> {
    const end = auraListen()
    const stop = (): void => {
      end()
      for (const ev of ['ended', 'pause', 'error', 'emptied'] as const) this.removeEventListener(ev, stop)
    }
    for (const ev of ['ended', 'pause', 'error', 'emptied'] as const) this.addEventListener(ev, stop)
    return play.call(this).catch((e: unknown) => { stop(); throw e })
  }
}
