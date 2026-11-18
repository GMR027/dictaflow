// Mantiene la pantalla encendida mientras se graba una reunión o se traduce en vivo: si el teléfono
// se bloquea, Android suspende la app y el micrófono deja de llegar. Si el sistema lo suelta (p. ej. al
// cambiar de app) se vuelve a pedir al regresar.

type Sentinel = { release: () => Promise<void> }
type WakeNav = Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Sentinel> } }

/** Pide la pantalla encendida; la función devuelta la suelta. Sin soporte, no hace nada. */
export function keepAwake(): () => void {
  const nav = navigator as WakeNav
  let lock: Sentinel | null = null
  let on = true
  const acquire = async (): Promise<void> => {
    if (!on || !nav.wakeLock || document.visibilityState !== 'visible') return
    try { lock = await nav.wakeLock.request('screen') } catch { lock = null }
  }
  const onVis = (): void => { if (document.visibilityState === 'visible') void acquire() }
  document.addEventListener('visibilitychange', onVis)
  void acquire()
  return () => {
    on = false
    document.removeEventListener('visibilitychange', onVis)
    void lock?.release().catch(() => undefined)
    lock = null
  }
}
