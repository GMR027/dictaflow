import { createHash } from 'crypto'
import { chmodSync, createWriteStream, renameSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { app, dialog, shell, type WebContents } from 'electron'
import { ASSET_BY_KIND, isNewer, sha256For, type UpdateInfo } from '@shared/update'
import { netFetch } from './netlog'
import { detectKind } from './uninstall'

const REPO = 'GMR027/dictaflow'
const PAGE = `https://github.com/${REPO}/releases/latest`

interface Release { tag_name: string; body?: string; html_url: string; assets: { name: string; browser_download_url: string }[] }

/** La consulta a la API de GitHub va sin autenticar: 60 peticiones por hora y por IP. */
const cache: { at: number; info: UpdateInfo | null } = { at: 0, info: null }
const CACHE_MS = 5 * 60 * 1000

export async function checkUpdate(): Promise<UpdateInfo> {
  if (cache.info && Date.now() - cache.at < CACHE_MS) return cache.info
  const res = await netFetch('github:update-check', `https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json' } })
  if (res.status === 403 || res.status === 429) {
    throw new Error('GitHub está limitando las consultas desde esta conexión (60 por hora). Inténtalo más tarde o descarga la versión desde la página de la aplicación.')
  }
  if (!res.ok) throw new Error(`No se pudo consultar las versiones (GitHub ${res.status}).`)
  const rel = (await res.json()) as Release
  const kind = await detectKind()
  const current = app.getVersion()
  const latest = rel.tag_name.replace(/^v/i, '')
  const name = ASSET_BY_KIND[kind]
  const asset = rel.assets.find((a) => a.name === name)
  let sha256: string | null = null
  const sums = rel.assets.find((a) => a.name === 'SHA256SUMS.txt')
  if (asset && sums) {
    const r = await netFetch('github:update-sums', sums.browser_download_url)
    if (r.ok) sha256 = sha256For(await r.text(), asset.name)
  }
  const info: UpdateInfo = {
    current, latest, available: isNewer(latest, current), notes: (rel.body ?? '').trim().slice(0, 2000),
    pageUrl: rel.html_url || PAGE, kind, asset: asset ? { name: asset.name, url: asset.browser_download_url } : null, sha256
  }
  cache.info = info
  cache.at = Date.now()
  return info
}

async function download(info: UpdateInfo, dest: string, sender: WebContents): Promise<void> {
  const res = await netFetch('github:update-download', info.asset!.url)
  if (!res.ok || !res.body) throw new Error(`No se pudo descargar la actualización (${res.status}).`)
  const total = Number(res.headers.get('content-length') ?? 0)
  const hash = createHash('sha256')
  let got = 0
  const src = Readable.fromWeb(res.body as never)
  src.on('data', (c: Buffer) => {
    hash.update(c)
    got += c.length
    if (total) sender.send('update:progress', Math.round((got / total) * 100))
  })
  try {
    await pipeline(src, createWriteStream(dest))
  } catch (e) {
    rmSync(dest, { force: true })
    throw e
  }
  // Sin hash publicado no se instala nada: así nadie recibe un archivo corrupto o alterado
  if (!info.sha256) { rmSync(dest, { force: true }); throw new Error('La release no publica la suma de verificación; descarga la actualización manualmente.') }
  if (hash.digest('hex') !== info.sha256) { rmSync(dest, { force: true }); throw new Error('La descarga no coincide con la suma de verificación (SHA-256). Se descartó.') }
}

export async function applyUpdate(sender: WebContents): Promise<'relaunching' | 'downloaded' | 'opened' | 'cancelled'> {
  const info = await checkUpdate()
  if (!info.available) throw new Error('Ya tienes la última versión.')
  if (!info.asset) {
    await shell.openExternal(info.pageUrl)
    return 'opened'
  }
  const { response } = await dialog.showMessageBox({
    type: 'question', title: 'Actualizar DictaFlow', buttons: ['Cancelar', 'Actualizar'], defaultId: 1, cancelId: 0,
    message: `Actualizar de ${info.current} a ${info.latest}`,
    detail: info.kind === 'appimage'
      ? 'Se descargará la nueva versión, se reemplazará este AppImage y la app se reiniciará. Tus datos no se tocan.'
      : 'Se descargará el paquete en tu carpeta de Descargas y se abrirá el instalador del sistema, que te pedirá permiso. Tus datos no se tocan.'
  })
  if (response !== 1) return 'cancelled'

  if (info.kind === 'appimage') {
    const target = process.env.APPIMAGE!
    const tmp = join(dirname(target), `.${info.asset.name}.new`)
    await download(info, tmp, sender)
    chmodSync(tmp, 0o755)
    renameSync(tmp, target)
    app.relaunch({ execPath: target })
    setTimeout(() => app.exit(0), 300)
    return 'relaunching'
  }
  const file = join(app.getPath('downloads'), info.asset.name)
  await download(info, file, sender)
  const err = await shell.openPath(file)
  if (err) throw new Error(`Descargado en ${file}, pero no se pudo abrir el instalador: ${err}`)
  return 'downloaded'
}
