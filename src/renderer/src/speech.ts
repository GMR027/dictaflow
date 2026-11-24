import type { Lang } from '@shared/types'

/** Reproduce voz sintetizada (Piper local o nube) con cola, pausa y cancelación. */
export class Speaker {
  private audio: HTMLAudioElement | null = null
  private cancelled = false
  private idle: ReturnType<typeof setTimeout> | null = null
  playing = false

  async synth(text: string, lang: Lang): Promise<Uint8Array> {
    this.cancelRelease()
    return window.api.synthesize(text, lang)
  }

  /** Libera la voz local tras un rato sin usarla (Supertonic ocupa bastante RAM). */
  private scheduleRelease(): void {
    this.cancelRelease()
    this.idle = setTimeout(() => {
      this.idle = null
      void window.api.releaseTts().catch(() => undefined)
    }, 120_000)
  }

  private cancelRelease(): void {
    if (this.idle) clearTimeout(this.idle)
    this.idle = null
  }

  /** Al desmontar la pantalla: para el audio y devuelve la RAM del motor. */
  async dispose(): Promise<void> {
    this.stop()
    this.cancelRelease()
    await window.api.releaseTts().catch(() => undefined)
  }

  private playBytes(bytes: Uint8Array): Promise<void> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }))
      const a = new Audio(url)
      this.audio = a
      a.onended = a.onerror = () => { URL.revokeObjectURL(url); resolve() }
      void a.play().catch(() => resolve())
    })
  }

  /** Lee los párrafos en orden sintetizando el siguiente mientras suena el actual. */
  async readAll(paras: string[], lang: Lang, from: number, onPara: (i: number) => void): Promise<void> {
    this.cancelled = false
    this.playing = true
    try {
      let next: Promise<Uint8Array> | null = paras[from] ? this.synth(paras[from], lang) : null
      for (let i = from; i < paras.length && !this.cancelled; i++) {
        const cur = await next
        next = i + 1 < paras.length ? this.synth(paras[i + 1], lang) : null
        if (this.cancelled || !cur) break
        onPara(i)
        await this.playBytes(cur)
      }
    } finally {
      this.playing = false
      this.scheduleRelease()
    }
  }

  async say(text: string, lang: Lang): Promise<void> {
    this.cancelled = false
    this.playing = true
    try { await this.playBytes(await this.synth(text, lang)) } finally {
      this.playing = false
      this.scheduleRelease()
    }
  }

  pause(): void { this.audio?.pause() }
  resume(): void { void this.audio?.play() }
  stop(): void {
    this.cancelled = true
    this.audio?.pause()
    this.audio?.dispatchEvent(new Event('ended'))
    this.audio = null
  }
}
