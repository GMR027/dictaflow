// Proceso Node independiente (ELECTRON_RUN_AS_NODE): onnxruntime-node no es seguro dentro del
// proceso principal de Electron (buffers externos prohibidos por V8 -> crash). Aquí corre aislado.
type Asr = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string; chunks?: { timestamp: [number, number | null]; text: string }[] }>

type Msg =
  | { id: number; type: 'load'; model: string; cacheDir: string; allowRemote: boolean }
  | { id: number; type: 'transcribe'; pcm: Float32Array; language?: string; timestamps?: boolean }

const importEsm = new Function('s', 'return import(s)') as (s: string) => Promise<any>
let asr: Asr | null = null
let loadedModel = ''

const reply = (m: Record<string, unknown>): void => void process.send?.(m)

async function load(msg: Extract<Msg, { type: 'load' }>): Promise<void> {
  if (asr && loadedModel === msg.model) return
  const tf = await importEsm('@huggingface/transformers')
  tf.env.cacheDir = msg.cacheDir
  tf.env.allowRemoteModels = msg.allowRemote
  asr = (await tf.pipeline('automatic-speech-recognition', msg.model, {
    dtype: 'q8',
    progress_callback: (p: unknown) => reply({ type: 'progress', payload: p })
  })) as Asr
  loadedModel = msg.model
}

process.on('message', async (msg: Msg) => {
  try {
    if (msg.type === 'load') {
      await load(msg)
      reply({ id: msg.id, ok: true })
    } else {
      if (!asr) throw new Error('El modelo de voz no está cargado')
      const opts: Record<string, unknown> = { task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 }
      if (msg.language) opts.language = msg.language
      if (msg.timestamps) opts.return_timestamps = true
      const out = await asr(msg.pcm, opts)
      reply({ id: msg.id, ok: true, text: out.text.trim(), chunks: out.chunks })
    }
  } catch (e) {
    reply({ id: msg.id, ok: false, error: (e as Error).message })
  }
})
