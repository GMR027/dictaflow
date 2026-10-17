import { spawn } from 'child_process'
import { dialog, type WebContents } from 'electron'
import { getSettings } from './store'
import { listOllamaModels } from './hardware'

// Instalador oficial de Ollama (https://ollama.com/download/linux). Necesita root para
// escribir en /usr/local y registrar el servicio; pkexec pide la contraseña en un diálogo del sistema.
const INSTALL_CMD = 'curl -fsSL https://ollama.com/install.sh | sh'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function waitForServer(seconds: number): Promise<boolean> {
  for (let i = 0; i < seconds; i++) {
    if ((await listOllamaModels()).running) return true
    await wait(1000)
  }
  return false
}

export async function installOllama(sender: WebContents): Promise<'installed' | 'cancelled'> {
  if (getSettings().strictOffline) throw new Error('El modo offline estricto está activo: desactívalo en Privacidad para descargar Ollama.')

  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: 'Instalar Ollama',
    message: 'Se descargará e instalará Ollama en tu sistema.',
    detail: `Se ejecutará con permisos de administrador (te pedirá tu contraseña):\n\n${INSTALL_CMD}\n\nEs el instalador oficial de ollama.com.`,
    buttons: ['Cancelar', 'Instalar'],
    defaultId: 0, cancelId: 0
  })
  if (response !== 1) return 'cancelled'

  const log = (line: string): void => sender.send('ollama:install-log', line)
  await new Promise<void>((resolve, reject) => {
    const child = spawn('pkexec', ['sh', '-c', INSTALL_CMD], { stdio: ['ignore', 'pipe', 'pipe'] })
    const forward = (d: Buffer): void => d.toString().split(/\r|\n/).filter(Boolean).forEach(log)
    child.stdout.on('data', forward)
    child.stderr.on('data', forward)
    child.on('error', (e) => reject(new Error(`No se pudo lanzar el instalador: ${e.message}`)))
    child.on('close', (code) => {
      if (code === 0) resolve()
      else if (code === 126 || code === 127) reject(new Error('Instalación cancelada o sin permisos.'))
      else reject(new Error(`El instalador terminó con código ${code}.`))
    })
  })

  log('Esperando a que el servicio de Ollama arranque…')
  if (!(await waitForServer(20))) await startOllama()
  return 'installed'
}

/** Arranca `ollama serve` como proceso del usuario (sin root) si está instalado pero parado. */
export async function startOllama(): Promise<boolean> {
  if ((await listOllamaModels()).running) return true
  const child = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' })
  child.on('error', () => undefined)
  child.unref()
  return waitForServer(15)
}
