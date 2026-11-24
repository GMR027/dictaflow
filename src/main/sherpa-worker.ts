// Proceso Node aparte (ELECTRON_RUN_AS_NODE) con sherpa-onnx: texto en vivo (Kroko streaming) y
// voces Kokoro/Supertonic. Igual que stt-worker, no corre dentro de Electron: los búferes externos
// de los módulos nativos no se permiten en su V8.
//
// Se arrancan dos copias, una por tarea (`role`), para que leer en voz alta no frene el texto en
// vivo. Las peticiones de cada copia se atienden de una en una.
//
// Es la versión de escritorio de android/src-tauri/src/vivo.rs y tts.rs (cargar_kokoro).

/* eslint-disable @typescript-eslint/no-explicit-any */
export {}
type Msg =
  | { id: number; type: 'live-start'; files: string[] }
  | { id: number; type: 'live-feed'; session: number; pcm: Float32Array }
  | { id: number; type: 'live-reset'; session: number }
  | { id: number; type: 'live-stop'; session: number }
  | {
      id: number; type: 'kokoro'; model: string; voices: string; tokens: string; lexicon?: string
      phonemeCodepoints?: number[]; sid: number; text: string; speed: number; threads: number
    }
  | {
      id: number; type: 'supertonic'; durationPredictor: string; textEncoder: string
      vectorEstimator: string; vocoder: string; ttsJson: string; unicodeIndexer: string
      voiceStyle: string; lang: string; sid: number; text: string; speed: number; threads: number
    }

let sherpa: any = null
const lib = (): any => (sherpa ??= require('sherpa-onnx-node'))

const reply = (m: Record<string, unknown>): void => void process.send?.(m)

// ── Texto en vivo ──────────────────────────────────────────────────────────────────────────
interface Session { stream: any; previous: string }
let recognizer: { key: string; rec: any } | null = null
const sessions = new Map<number, Session>()
let nextSession = 1

function recognizerFor(files: string[]): any {
  const key = files.join('\0')
  if (recognizer?.key === key) return recognizer.rec
  recognizer = null
  sessions.clear()
  const [encoder, decoder, joiner, tokens] = files
  const rec = new (lib().OnlineRecognizer)({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: { transducer: { encoder, decoder, joiner }, tokens, numThreads: 2, provider: 'cpu' },
    decodingMethod: 'greedy_search',
    // El modelo cierra tramos tras una pausa: así el flujo no crece sin fin si la interfaz tarda en cerrar la frase.
    enableEndpoint: 1,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 1.0,
    rule3MinUtteranceLength: 25
  })
  recognizer = { key, rec }
  return rec
}

function session(id: number): Session {
  const s = sessions.get(id)
  if (!s) throw new Error('La sesión de texto en vivo ya terminó.')
  return s
}

function feed(id: number, pcm: Float32Array): string {
  const s = session(id)
  const rec = recognizer!.rec
  s.stream.acceptWaveform({ samples: pcm, sampleRate: 16000 })
  while (rec.isReady(s.stream)) rec.decode(s.stream)
  const current = String(rec.getResult(s.stream).text ?? '').trim()
  const join = (a: string, b: string): string => `${a} ${b}`.trim()
  if (rec.isEndpoint(s.stream)) {
    if (current) s.previous = join(s.previous, current)
    rec.reset(s.stream)
    return s.previous
  }
  return join(s.previous, current)
}

// ── Voz (Kokoro y Supertonic) ──────────────────────────────────────────────────────────────
let tts: { key: string; engine: any } | null = null

function engine(key: string, config: Record<string, unknown>): any {
  if (tts?.key === key) return tts.engine
  tts = null
  const next = new (lib().OfflineTts)(config)
  tts = { key, engine: next }
  return next
}

function kokoro(m: Extract<Msg, { type: 'kokoro' }>): { samples: Float32Array; sampleRate: number } {
  const config = {
    model: {
      kokoro: { model: m.model, voices: m.voices, tokens: m.tokens, lexicon: m.lexicon ?? '', lengthScale: 1 },
      numThreads: m.threads,
      provider: 'cpu'
    },
    maxNumSentences: 1,
    silenceScale: 0.2
  }
  const t = engine(['kokoro', m.model, m.lexicon ?? ''].join('\0'), config)
  const req = { text: m.text, sid: m.sid, speed: m.speed, enableExternalBuffer: false }
  const audio = m.phonemeCodepoints?.length
    ? t.generate({ ...req, generationConfig: { phonemeCodepoints: [m.phonemeCodepoints] } })
    : t.generate(req)
  // Copia propia: el búfer que devuelve el módulo nativo no se puede mandar entre procesos.
  return { samples: Float32Array.from(audio.samples as Float32Array), sampleRate: audio.sampleRate }
}

function supertonic(m: Extract<Msg, { type: 'supertonic' }>): { samples: Float32Array; sampleRate: number } {
  const key = ['supertonic', m.durationPredictor, m.textEncoder, m.vectorEstimator, m.vocoder, m.ttsJson, m.unicodeIndexer, m.voiceStyle].join('\0')
  const config = {
    model: {
      supertonic: {
        durationPredictor: m.durationPredictor,
        textEncoder: m.textEncoder,
        vectorEstimator: m.vectorEstimator,
        vocoder: m.vocoder,
        ttsJson: m.ttsJson,
        unicodeIndexer: m.unicodeIndexer,
        voiceStyle: m.voiceStyle
      },
      numThreads: m.threads,
      provider: 'cpu'
    },
    maxNumSentences: 1,
    silenceScale: 0.2
  }
  const t = engine(key, config)
  const audio = t.generate({
    text: m.text,
    enableExternalBuffer: false,
    generationConfig: { sid: m.sid, numSteps: 8, speed: m.speed, extra: { lang: m.lang } }
  })
  return { samples: Float32Array.from(audio.samples as Float32Array), sampleRate: audio.sampleRate }
}

async function handle(msg: Msg): Promise<Record<string, unknown>> {
  switch (msg.type) {
    case 'live-start': {
      const rec = recognizerFor(msg.files)
      const id = nextSession++
      sessions.set(id, { stream: rec.createStream(), previous: '' })
      return { session: id }
    }
    case 'live-feed':
      return { text: feed(msg.session, msg.pcm) }
    case 'live-reset': {
      const s = session(msg.session)
      recognizer!.rec.reset(s.stream)
      s.previous = ''
      return {}
    }
    case 'live-stop':
      sessions.delete(msg.session)
      return {}
    case 'kokoro':
      return kokoro(msg)
    case 'supertonic':
      return supertonic(msg)
  }
}

let chain: Promise<void> = Promise.resolve()

process.on('message', (msg: Msg) => {
  chain = chain
    .then(async () => reply({ id: msg.id, ok: true, ...(await handle(msg)) }))
    .catch((e) => reply({ id: msg.id, ok: false, error: (e as Error).message }))
})
