import { contextBridge, ipcRenderer } from 'electron'
import type { IpcEvents } from '@shared/ipc'
import { createApi, type Invoke, type On } from './api'

const invoke: Invoke = (channel, req) => ipcRenderer.invoke(channel, req) as never

const on: On = (channel, cb) => {
  const h = (_e: unknown, payload: IpcEvents[typeof channel]): void => cb(payload)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

contextBridge.exposeInMainWorld('api', createApi(invoke, on, 'linux'))
export type { Api } from './api'
