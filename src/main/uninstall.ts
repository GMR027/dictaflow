import { execFile, spawn } from 'child_process'
import { app, dialog } from 'electron'
import { existsSync, rmSync } from 'fs'
import { promisify } from 'util'
import { dataDir } from './store'

const run = promisify(execFile)
const PKG = 'dictaflow'

export type InstallKind = 'appimage' | 'deb' | 'rpm' | 'pacman' | 'portable' | 'dev'

export interface UninstallInfo {
  kind: InstallKind
  /** comando que el usuario puede ejecutar a mano */
  command: string
  /** true si la app puede ejecutarlo por sí sola */
  runnable: boolean
  dataPaths: string[]
  dataSizeMB: number
}

async function owns(cmd: string, args: string[]): Promise<boolean> {
  try {
    await run(cmd, args)
    return true
  } catch {
    return false
  }
}

async function detectKind(): Promise<InstallKind> {
  if (!app.isPackaged) return 'dev'
  if (process.env.APPIMAGE) return 'appimage'
  const exe = process.execPath
  if (await owns('dpkg', ['-S', exe])) return 'deb'
  if (await owns('rpm', ['-qf', exe])) return 'rpm'
  if (await owns('pacman', ['-Qo', exe])) return 'pacman'
  return 'portable'
}

const dataPaths = (): string[] => [dataDir, app.getPath('userData')].filter((p, i, a) => existsSync(p) && a.indexOf(p) === i)

async function sizeMB(paths: string[]): Promise<number> {
  let kb = 0
  for (const p of paths) {
    try { kb += Number((await run('du', ['-sk', p])).stdout.split('\t')[0]) } catch { /* ignorar */ }
  }
  return Math.round(kb / 1024)
}

function commandFor(kind: InstallKind): string {
  switch (kind) {
    case 'deb': return `sudo apt remove ${PKG}`
    case 'rpm': return `sudo dnf remove ${PKG}   # openSUSE: sudo zypper remove ${PKG}`
    case 'pacman': return `sudo pacman -R ${PKG}`
    case 'appimage': return `rm "${process.env.APPIMAGE}"`
    case 'portable': return `rm -rf "${process.execPath.replace(/\/[^/]+$/, '')}"`
    case 'dev': return 'Versión de desarrollo: borra la carpeta del proyecto.'
  }
}

export async function uninstallInfo(): Promise<UninstallInfo> {
  const kind = await detectKind()
  const paths = dataPaths()
  return { kind, command: commandFor(kind), runnable: kind !== 'dev' && kind !== 'portable', dataPaths: paths, dataSizeMB: await sizeMB(paths) }
}

function privileged(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    // pkexec muestra el diálogo de contraseña del sistema; la app nunca la ve
    const child = spawn('pkexec', [cmd, ...args], { stdio: 'ignore' })
    child.on('error', (e) => reject(new Error(`No se pudo lanzar pkexec: ${e.message}`)))
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(code === 126 || code === 127 ? 'Desinstalación cancelada o sin permisos.' : `La desinstalación terminó con código ${code}.`))))
  })
}

export async function runUninstall(removeData: boolean): Promise<'done' | 'cancelled'> {
  const info = await uninstallInfo()
  if (!info.runnable && !removeData) throw new Error('Este tipo de instalación no se puede quitar desde la app. Usa el comando indicado.')

  const what = [
    info.runnable ? `• La aplicación (${info.kind === 'appimage' ? process.env.APPIMAGE : `paquete «${PKG}»`})` : '',
    removeData ? `• Tus datos (${info.dataSizeMB} MB): modelos, voces, ajustes, biblioteca y reuniones\n   ${info.dataPaths.join('\n   ')}` : '• Tus datos se conservarán'
  ].filter(Boolean).join('\n')
  const { response } = await dialog.showMessageBox({
    type: 'warning', title: 'Desinstalar DictaFlow', buttons: ['Cancelar', 'Desinstalar'], defaultId: 0, cancelId: 0,
    message: '¿Seguro que quieres desinstalar DictaFlow?', detail: `Se eliminará:\n\n${what}\n\nEsto no se puede deshacer.`
  })
  if (response !== 1) return 'cancelled'

  // Primero la app: si el usuario cancela la contraseña, sus datos no se tocan
  if (info.runnable) {
    if (info.kind === 'deb') await privileged('apt-get', ['remove', '-y', PKG])
    else if (info.kind === 'rpm') await privileged('rpm', ['-e', PKG])
    else if (info.kind === 'pacman') await privileged('pacman', ['-R', '--noconfirm', PKG])
    else if (info.kind === 'appimage' && process.env.APPIMAGE) rmSync(process.env.APPIMAGE, { force: true })
  }
  if (removeData) for (const p of info.dataPaths) rmSync(p, { recursive: true, force: true })
  setTimeout(() => app.exit(0), 300)
  return 'done'
}
