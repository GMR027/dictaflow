export type InstallKind = 'appimage' | 'deb' | 'rpm' | 'pacman' | 'portable' | 'dev'

export interface UpdateInfo {
  current: string
  latest: string
  available: boolean
  notes: string
  pageUrl: string
  kind: InstallKind
  /** archivo de la release que corresponde a esta instalación; null si hay que actualizar a mano */
  asset: { name: string; url: string } | null
  sha256: string | null
}

/** Nombre del archivo de la release para cada tipo de instalación (ver electron-builder.yml). */
export const ASSET_BY_KIND: Partial<Record<InstallKind, string>> = {
  appimage: 'dictaflow-linux-x86_64.AppImage',
  deb: 'dictaflow-linux-amd64.deb',
  rpm: 'dictaflow-linux-x86_64.rpm',
  pacman: 'dictaflow-linux-x86_64.pacman'
}

const parts = (v: string): number[] => v.replace(/^v/i, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0)

/** true si `latest` es una versión posterior a `current` (compara x.y.z; ignora sufijos de prerelease). */
export function isNewer(latest: string, current: string): boolean {
  const a = parts(latest)
  const b = parts(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

/** Lee un SHA256SUMS.txt («hash  archivo») y devuelve el hash del archivo pedido. */
export function sha256For(sums: string, file: string): string | null {
  for (const line of sums.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(line)
    if (m && m[2] === file) return m[1].toLowerCase()
  }
  return null
}
