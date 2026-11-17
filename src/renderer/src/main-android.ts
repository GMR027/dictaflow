// Entrada de la interfaz en Android: instala `window.api` (Tauri) antes de montar la app.
import './platform/tauri'

// En Android no hay consola a la vista: un error de arranque se muestra en pantalla en vez de
// dejarla en blanco.
const mostrar = (msg: string): void => {
  const root = document.getElementById('root')
  // Con la app ya montada, los errores los muestra la propia interfaz: aquí solo se registran.
  if (!root || (root.childElementCount && !root.querySelector('pre[data-arranque]'))) return console.error(msg)
  if (!root.childElementCount) root.innerHTML = '<pre data-arranque style="white-space:pre-wrap;padding:16px;color:#c01c28"></pre>'
  root.querySelector('pre[data-arranque]')!.textContent += `${msg}\n`
}
window.addEventListener('error', (e) => mostrar(`Error: ${e.message}`))
window.addEventListener('unhandledrejection', (e) => mostrar(`Error: ${(e.reason as Error)?.message ?? String(e.reason)}`))

void import('./main')
