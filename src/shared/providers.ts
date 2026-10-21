import type { LLMKind, SecretName, Settings } from './types'

export interface ProviderInfo {
  label: string
  /** frase corta y sin tecnicismos para la tarjeta */
  summary: string
  hint: string
  secret?: SecretName
  defaultModel: string
  defaultUrl?: string
  /** modelos sugeridos (el campo admite otros) */
  models?: string[]
  /** true si el texto sale del equipo */
  cloud: boolean
}

/**
 * Modelo de opencode que se propone al conectar el servicio. Es uno de los
 * modelos gratuitos que opencode sirve directamente; el usuario puede cambiar
 * a cualquier otro de la lista o dejar el predeterminado de su CLI.
 */
const OPENCODE_DEFAULT = 'opencode/deepseek-v4.1-flash-free'

export const PROVIDERS: Record<LLMKind, ProviderInfo> = {
  ollama: { label: 'Ollama (local)', summary: 'Funciona en tu equipo, sin enviar datos fuera.', hint: 'Modelo local, sin enviar datos fuera.', defaultModel: 'qwen2.5:7b', defaultUrl: 'http://127.0.0.1:11434', cloud: false },
  anthropic: { label: 'Claude (API key)', summary: 'Claude con tu clave de Anthropic.', hint: 'Usa tu API key de Anthropic. El texto se envía a Anthropic.', secret: 'anthropic', defaultModel: 'claude-sonnet-5-5', models: ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], cloud: true },
  'claude-cli': { label: 'Claude (CLI con tu suscripción)', summary: 'Claude con tu suscripción, usando el comando `claude` ya iniciado.', hint: 'Ejecuta el comando `claude` ya iniciado en tu equipo, sin herramientas ni acceso a archivos.', defaultModel: '', models: ['', 'sonnet', 'opus', 'haiku'], cloud: true },
  opencode: { label: 'opencode (CLI)', summary: 'Los modelos que ya tengas configurados en opencode.', hint: 'Elige uno de los modelos que opencode tiene disponibles o deja el predeterminado de tu CLI.', defaultModel: OPENCODE_DEFAULT, cloud: true },
  'openai-compat': { label: 'Compatible con OpenAI', summary: 'LM Studio, OpenRouter y servicios similares.', hint: 'LM Studio, OpenRouter, etc. Indica la URL base y la clave.', secret: 'openai-compat', defaultModel: '', defaultUrl: 'http://127.0.0.1:1234/v1', cloud: true }
}

/** Ajustes a guardar al conectar un servicio: lo marca como disponible y como activo con sus valores por defecto. */
export function connectPatch(settings: Pick<Settings, 'enabledProviders'>, kind: LLMKind): Pick<Settings, 'enabledProviders' | 'llm'> {
  const d = PROVIDERS[kind]
  return {
    enabledProviders: Array.from(new Set([...settings.enabledProviders, kind])),
    llm: { kind, model: d.defaultModel, baseUrl: d.defaultUrl }
  }
}

/** Modelos que ofrece un proveedor, tal como los devuelve su CLI o su API local. */
export interface ProviderModels {
  /** Ruta del CLI encontrado; null si no está instalado. */
  bin: string | null
  models: string[]
  providers: string[]
  error?: string
}

/**
 * Un modelo de opencode se guarda como `proveedor/modelo` (puede llevar
 * `#variante`). El nombre visible («MiniMax M3.1 Flash Free») no sirve: el CLI
 * lo rechaza. Vacío significa «el predeterminado de opencode».
 */
export const isOpencodeModel = (model: string): boolean =>
  !model.trim() || /^[^/\s]+\/[^\s]+$/.test(model.trim())

/** Corrige valores viejos que guardaban el nombre visible en vez del ID. */
export function normalizeModel(kind: LLMKind, model: string): string {
  if (kind !== 'opencode') return model
  if (!model.trim()) return ''
  return isOpencodeModel(model) ? model.trim() : OPENCODE_DEFAULT
}

export type ServiceStatus = 'active' | 'ready' | 'needs-key'

/** Estado mostrado en la tarjeta de cada servicio. */
export function serviceStatus(kind: LLMKind, active: LLMKind, keys: Partial<Record<SecretName, boolean>>): ServiceStatus {
  const secret = PROVIDERS[kind].secret
  if (secret && !keys[secret]) return 'needs-key'
  return kind === active ? 'active' : 'ready'
}
