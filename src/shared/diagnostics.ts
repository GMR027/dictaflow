// Tipos del informe de diagnóstico y de las copias de seguridad.
// Viven en `shared` para que la interfaz los muestre sin depender del proceso
// principal.

export interface Diagnostics {
  app: { version: string; electron: string; node: string }
  system: { platform: string; release: string; arch: string; cpu: string; cores: number; ramGB: number; freeGB: number; gpu: string }
  hardware: {
    cpu: string
    cores: number
    cpuFlags: { avx: boolean; avx2: boolean; avx512: boolean }
    arch: string
    ramGB: number
    gpu: string
    gpuVendor: 'nvidia' | 'amd' | 'intel' | 'none'
    diskFreeGB: number
    ollama: { installed: boolean; running: boolean; models: string[] }
    clis: { claude: boolean; opencode: boolean }
  }
  paths: { data: string; models: string; voices: string; writable: boolean }
  engines: {
    whisper: { models: string[]; active: string; fallbackReason: string | null }
    whispercpp: { binary: string; model: string; models: { id: string; installed: boolean }[] }
    piper: { installed: boolean; voices: string[] }
    ollama: { installed: boolean; running: boolean; models: string[] }
  }
  storage: { dataMB: number; modelsMB: number; voicesMB: number; audiobooks: number }
  network: { events: number }
  settings: { strictOffline: boolean; sttProvider: string; ttsProvider: string; sttEngine: string }
}

export interface BackupInfo {
  file: string
  createdAt: number
  sizeMB: number
  contents: string[]
}
