// Ejecución de herramientas CLI instaladas por el usuario (opencode, claude…).
//
// Las aplicaciones lanzadas desde el escritorio no heredan el PATH de la
// terminal: en Ubuntu/GNOME, `~/.opencode/bin` no está en el PATH del proceso.
// Por eso aquí se resuelve el binario en una lista de carpetas habituales y se
// ejecuta con un PATH ampliado. Sin esto, opencode funciona en la terminal pero
// la app dice que no está instalado.
import { execFile, spawn } from 'child_process'
import { existsSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { delimiter, join } from 'path'
import { mkdtempSync } from 'fs'
import { promisify } from 'util'

const run = promisify(execFile)

/** Carpetas donde suelen vivir los CLI instalados por el usuario. */
export const extraCliPaths = (): string[] => [
  join(homedir(), '.opencode', 'bin'),
  join(homedir(), '.local', 'bin'),
  join(homedir(), '.bun', 'bin'),
  join(homedir(), '.npm-global', 'bin'),
  '/usr/local/bin',
  '/snap/bin'
]

/** PATH que se usa al buscar y ejecutar CLI. */
export function cliPath(pathEnv = process.env.PATH ?? ''): string {
  const dirs = [...extraCliPaths(), ...pathEnv.split(delimiter)]
  return Array.from(new Set(dirs.filter(Boolean))).join(delimiter)
}

/** Entorno para los procesos CLI, con el PATH ampliado. */
export const cliEnv = (): NodeJS.ProcessEnv => ({ ...process.env, PATH: cliPath() })

/** Ruta absoluta de un binario, o null si no se encuentra. */
export function resolveBin(bin: string, pathEnv = cliPath()): string | null {
  if (bin.includes('/')) return existsSync(bin) ? bin : null
  for (const dir of pathEnv.split(delimiter).filter(Boolean)) {
    const candidate = join(dir, bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** ¿Existe el binario? Se usa en Diagnóstico y en Ajustes. */
export async function whichCli(bin: string): Promise<boolean> {
  if (resolveBin(bin)) return true
  try {
    await run('which', [bin], { env: cliEnv() })
    return true
  } catch {
    return false
  }
}

/** Quita secuencias ANSI de la salida de un CLI. */
export const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')

export interface CliRunOptions {
  /** Texto que se escribe en la entrada estándar. `null` la cierra vacía. */
  input?: string | null
  timeoutMs?: number
  cwd?: string
}

/**
 * Ejecuta un CLI y devuelve su salida estándar. Si el binario no existe, el
 * mensaje dice exactamente qué falta y dónde se buscó.
 */
export function runCli(bin: string, args: string[], opts: CliRunOptions = {}): Promise<string> {
  const exe = resolveBin(bin)
  if (!exe) {
    return Promise.reject(new Error(
      `No se encontró «${bin}». Instálalo o añade su carpeta al PATH (se buscó en ${extraCliPaths().join(', ')}).`
    ))
  }
  const { input = null, timeoutMs = 180_000, cwd } = opts
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd: cwd ?? mkdtempSync(join(tmpdir(), 'dictaflow-')),
      env: cliEnv(),
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let out = ''
    let err = ''
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, timeoutMs)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`No se pudo ejecutar «${bin}»: ${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) return reject(new Error(`«${bin}» tardó demasiado (${Math.round(timeoutMs / 1000)} s) y se detuvo.`))
      if (code === 0) return resolve(stripAnsi(out).trim())
      reject(new Error(stripAnsi(err).trim() || `${bin} terminó con código ${code}`))
    })
    child.stdin.end(input ?? undefined)
  })
}

/** Interpreta la salida JSON por líneas de `opencode run --format json`. */
export function parseOpencodeRun(output: string): string {
  const texts: string[] = []
  let lastError = ''
  for (const line of stripAnsi(output).split(/\r?\n/)) {
    const raw = line.trim()
    if (!raw.startsWith('{')) continue
    let j: { type?: string; part?: { text?: string }; error?: { message?: string } }
    try {
      j = JSON.parse(raw) as typeof j
    } catch {
      continue
    }
    if (j.type === 'error') lastError = j.error?.message ?? 'opencode devolvió un error.'
    if (j.type === 'text' && typeof j.part?.text === 'string') texts.push(j.part.text)
  }
  const text = texts.join('').trim()
  if (text) return text
  if (lastError) throw new Error(`opencode: ${lastError}`)
  // Algunas versiones no usan --format json: se devuelve la salida tal cual.
  const plain = stripAnsi(output).trim()
  if (plain && !plain.startsWith('{')) return plain
  throw new Error('opencode no devolvió texto. Revisa que el modelo elegido esté disponible.')
}

/** Lista de modelos de `opencode models`, sin líneas de adorno. */
export function parseOpencodeModels(output: string): string[] {
  const seen = new Set<string>()
  for (const line of stripAnsi(output).split(/\r?\n/)) {
    const id = line.trim()
    // Formato: proveedor/modelo (puede llevar :tag o #variante). Sin espacios.
    if (!id || id.startsWith('>') || /\s/.test(id)) continue
    if (!/^[^/]+\/[^/]+$/.test(id)) continue
    seen.add(id)
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}

export interface OpencodeModels {
  /** Ruta del binario; null si no está instalado. */
  bin: string | null
  models: string[]
  providers: string[]
  error?: string
}

/** Modelos disponibles y proveedores que opencode tiene configurados. */
export async function listOpencodeModels(): Promise<OpencodeModels> {
  const bin = resolveBin('opencode')
  if (!bin) {
    return {
      bin: null,
      models: [],
      providers: [],
      error: `No se encontró opencode. Instálalo o añade ${join(homedir(), '.opencode', 'bin')} al PATH.`
    }
  }
  let lastError = ''
  // `opencode models` puede salir con código 0 y sin salida mientras su
  // servicio interno termina de arrancar o de refrescar el catálogo. Se
  // reintenta, primero contra el servicio y luego con un servidor privado.
  for (const extra of [[], ['--standalone']] as string[][]) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const out = await runCli('opencode', ['models', ...extra], { timeoutMs: 45_000, cwd: homedir() })
        const models = parseOpencodeModels(out)
        if (models.length) {
          const providers = [...new Set(models.map((m) => m.split('/')[0]))].sort()
          return { bin, models, providers }
        }
        lastError = 'opencode no devolvió ningún modelo. Revisa `opencode auth list`.'
      } catch (e) {
        lastError = (e as Error).message
      }
      await new Promise((r) => setTimeout(r, 1500))
    }
  }
  return { bin, models: [], providers: [], error: lastError }
}

/** Ejecuta un prompt con opencode y devuelve solo el texto del modelo. */
export async function runOpencode(prompt: string, model?: string): Promise<string> {
  const args = ['run', '--format', 'json', ...(model ? ['-m', model] : []), prompt]
  return parseOpencodeRun(await runCli('opencode', args, { timeoutMs: 180_000 }))
}

/** Ejecuta un prompt con Claude Code y devuelve solo el texto. */
export async function runClaude(prompt: string, system: string, model?: string): Promise<string> {
  const args = [
    '-p', '--system-prompt', system,
    '--disallowedTools', 'Bash', 'Edit', 'Write', 'Read', 'WebFetch', 'WebSearch', 'Glob', 'Grep', 'Task',
    ...(model ? ['--model', model] : [])
  ]
  return runCli('claude', args, { input: prompt, timeoutMs: 180_000 })
}
