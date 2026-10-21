import { spawn } from 'child_process'
import { app, dialog } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import type { PromptTarget } from '@shared/types'
import { dataDir, getSettings } from './store'

const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '__pycache__', '.venv', 'venv', 'target', '.cache'])

function tree(dir: string, depth: number, prefix = '', lines: string[] = []): string[] {
  if (lines.length > 150) return lines
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((e) => !IGNORE.has(e.name) && !e.name.startsWith('.'))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
  for (const e of entries) {
    lines.push(`${prefix}${e.name}${e.isDirectory() ? '/' : ''}`)
    if (e.isDirectory() && depth > 1) tree(join(dir, e.name), depth - 1, prefix + '  ', lines)
  }
  return lines
}

const head = (file: string, n: number): string => (existsSync(file) ? readFileSync(file, 'utf8').slice(0, n) : '')

/**
 * Contexto ligero del repositorio para que el prompt mencione rutas y tecnologías
 * reales. Se memoriza unos segundos: el contexto solo cambia si el proyecto cambia,
 * y recorrer el árbol en cada redacción era un desperdicio de disco y de red.
 */
let contextCache: { dir: string; at: number; value: string } | null = null
const CONTEXT_TTL_MS = 15_000

export function readProjectContext(dir: string): string {
  if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) return ''
  if (contextCache && contextCache.dir === dir && Date.now() - contextCache.at < CONTEXT_TTL_MS) return contextCache.value
  const value = buildProjectContext(dir)
  contextCache = { dir, at: Date.now(), value }
  return value
}

function buildProjectContext(dir: string): string {
  const parts = [`Proyecto: ${basename(dir)}`, `Estructura:\n${tree(dir, 2).join('\n')}`]
  const pkg = join(dir, 'package.json')
  if (existsSync(pkg)) {
    try {
      const j = JSON.parse(readFileSync(pkg, 'utf8')) as { dependencies?: object; devDependencies?: object; scripts?: object }
      parts.push(`package.json → dependencias: ${Object.keys({ ...j.dependencies, ...j.devDependencies }).slice(0, 40).join(', ')}; scripts: ${Object.keys(j.scripts ?? {}).join(', ')}`)
    } catch { /* package.json inválido */ }
  }
  for (const f of ['CLAUDE.md', 'README.md']) {
    const t = head(join(dir, f), 1800)
    if (t) parts.push(`${f} (inicio):\n${t}`)
  }
  return parts.join('\n\n')
}

export async function pickDir(title: string): Promise<string> {
  const r = await dialog.showOpenDialog({ title, properties: ['openDirectory', 'createDirectory'] })
  return r.canceled ? '' : r.filePaths[0]
}

export async function saveFileDialog(defaultName: string, data: Buffer | string): Promise<string> {
  const r = await dialog.showSaveDialog({ defaultPath: join(app.getPath('documents'), defaultName) })
  if (r.canceled || !r.filePath) return ''
  writeFileSync(r.filePath, data)
  return r.filePath
}

export async function openFileDialog(title: string, exts: string[]): Promise<{ name: string; data: Buffer } | null> {
  const r = await dialog.showOpenDialog({ title, properties: ['openFile'], filters: [{ name: 'Archivos', extensions: exts }] })
  if (r.canceled) return null
  return { name: basename(r.filePaths[0]), data: readFileSync(r.filePaths[0]) }
}

const slug = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'nota'

/** Escapa un valor para el frontal YAML: un salto de línea rompería el archivo. */
const yamlString = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')}"`

/** Pipeline de notas: guarda Markdown con frontmatter en la carpeta (vault) del usuario. */
export function exportNote(title: string, body: string, tags: string[]): string {
  const dir = getSettings().vaultDir || join(app.getPath('documents'), 'DictaFlow-Notas')
  mkdirSync(dir, { recursive: true })
  const now = new Date()
  const file = join(dir, `${now.toISOString().slice(0, 10)}-${slug(title)}.md`)
  const clean = tags.map((t) => t.replace(/[",\n]/g, ' ').trim()).filter(Boolean)
  const front = `---\ntitle: ${yamlString(title)}\ndate: ${now.toISOString()}\ntags: [${clean.join(', ')}]\nsource: dictaflow\n---\n\n`
  writeFileSync(file, front + body + '\n', { flag: existsSync(file) ? 'a' : 'w' })
  return file
}

/** Abre una terminal en el proyecto con el agente CLI y el prompt. Siempre tras confirmación del usuario. */
export async function launchAgent(agent: Extract<PromptTarget, 'claude-code' | 'opencode'>, dir: string, prompt: string): Promise<'launched' | 'cancelled'> {
  if (!dir || !existsSync(dir)) throw new Error('Elige primero la carpeta del proyecto.')
  const bin = agent === 'claude-code' ? 'claude' : 'opencode'
  const { response } = await dialog.showMessageBox({
    type: 'question', title: `Enviar a ${bin}`, buttons: ['Cancelar', 'Abrir terminal'], defaultId: 0, cancelId: 0,
    message: `Se abrirá una terminal en ${dir} y se ejecutará ${bin} con tu prompt.`,
    detail: `El agente podrá leer y modificar archivos de ese proyecto según sus propios permisos.\n\nPrompt:\n${prompt.slice(0, 400)}${prompt.length > 400 ? '…' : ''}`
  })
  if (response !== 1) return 'cancelled'
  const tmp = join(dataDir, 'tmp')
  mkdirSync(tmp, { recursive: true })
  const file = join(tmp, `prompt-${Date.now()}.txt`)
  writeFileSync(file, prompt, { mode: 0o600 })
  // El prompt viaja por archivo y argumentos posicionales, nunca interpolado en el comando
  const script = `cd "$1" && ${bin} "$(cat "$2")"; exec bash`
  spawn('gnome-terminal', ['--', 'bash', '-lc', script, '_', dir, file], { detached: true, stdio: 'ignore' }).unref()
  return 'launched'
}
