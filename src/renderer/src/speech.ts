import type { Lang } from '@shared/types'

/** Reproduce voz sintetizada (Piper local o nube) con cola, pausa y cancelación. */
export class Speaker {
  private audio: HTMLAudioElement | null = null
  private cancelled = false
  playing = false

  async synth(text: string, lang: Lang): Promise<Uint8Array> {
    return window.api.synthesize(text, lang)
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
    }
  }

  async say(text: string, lang: Lang): Promise<void> {
    this.cancelled = false
    this.playing = true
    try { await this.playBytes(await this.synth(text, lang)) } finally { this.playing = false }
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
