// Rutas de datos. Sin efectos secundarios al importar: se puede usar en pruebas
// sin tocar el equipo del usuario.
import { mkdirSync } from 'fs'
import { app } from 'electron'
import { homedir } from 'os'
import { join } from 'path'

/** Carpeta del usuario, con reserva si Electron no está disponible (pruebas). */
const home = ((): string => {
  try {
    return app?.getPath?.('home') ?? homedir()
  } catch {
    return homedir()
  }
})()

/** Carpeta donde se guardan ajustes, modelos, voces y bibliotecas. */
export const dataDir = join(home, '.local', 'share', 'dictaflow')

/** Carpeta de los modelos de voz descargados. */
export const modelsDir = join(dataDir, 'models')

/** Crea las carpetas que hacen falta. Se llama al arrancar la aplicación. */
export function ensureDataDirs(): void {
  for (const dir of [modelsDir, join(dataDir, 'voices'), join(dataDir, 'tmp')]) {
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      /* si no se puede crear, la app lo dirá al escribir */
    }
  }
}
