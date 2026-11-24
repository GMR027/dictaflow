// Estado del modal de complementos: cualquier herramienta puede pedir «esto necesita
// la IA / una voz / el dictado» y esperar a que el usuario lo active o descargue.
//
// Se guarda en un store para que el modal viva una sola vez en `App` y para que la
// acción original (leer, grabar, redactar…) continúe cuando el usuario termina.
import { create } from 'zustand'
import type { Lang } from '@shared/types'
import type { ServiceId } from '@shared/features'

export interface SetupRequest {
  service: ServiceId
  lang?: Lang
  /** El servicio ya está instalado, pero el usuario lo había desactivado. */
  disabled?: boolean
  /** Opción que el usuario acaba de elegir en un selector y aún no está instalada. */
  prefer?: string
  /** Dictado para transcribir archivos o reuniones: hace falta Whisper, no vale solo el motor del teléfono. */
  requireModel?: boolean
}

interface SetupState {
  request: (SetupRequest & { resolve: (ok: boolean) => void }) | null
  ask: (req: SetupRequest) => Promise<boolean>
  finish: (ok: boolean) => void
}

export const useSetup = create<SetupState>((set, get) => ({
  request: null,
  ask: (req) => new Promise<boolean>((resolve) => {
    // Si ya había una petición abierta, se cancela: solo hay un modal.
    get().request?.resolve(false)
    set({ request: { ...req, resolve } })
  }),
  finish: (ok) => {
    const req = get().request
    set({ request: null })
    req?.resolve(ok)
  }
}))
