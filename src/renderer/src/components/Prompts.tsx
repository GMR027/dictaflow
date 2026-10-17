import { useEffect, useMemo, useState } from 'react'
import type { ChatMsg, SavedPrompt } from '@shared/types'
import { useQuickDictation } from '../hooks'
import { useApp } from '../store'

const ARCHITECT = `Eres "Prompt Architect", un experto en escribir prompts de programación para agentes de IA.
El usuario te da ejemplos de prompts suyos que le han funcionado (referencias) y te pide uno nuevo.
- Imita la estructura, el nivel de detalle y el estilo de las referencias, sin copiar su contenido específico.
- Escribe el prompt final en un bloque Markdown claro. Si falta información importante, hazle como máximo 2 preguntas breves antes de escribirlo.
- No inventes rutas, nombres de archivos ni tecnologías que el usuario no haya mencionado.
- Responde en el idioma del usuario.`

const words = (t: string): Set<string> => new Set(t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]{4,}/g) ?? [])

/** Relevancia por solapamiento de palabras; suficiente para elegir referencias sin cargar todo el contexto. */
function relevant(all: SavedPrompt[], query: string, n: number): SavedPrompt[] {
  const q = words(query)
  return all
    .map((p) => {
      const w = words(p.title + ' ' + p.text + ' ' + p.tags.join(' '))
      let hit = 0
      q.forEach((x) => w.has(x) && hit++)
      return { p, score: hit + (p.rating > 0 ? 1 : 0) - (p.rating < 0 ? 5 : 0) }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => x.p)
}

const QUICK: Record<string, string> = {
  'Fusionar': 'Fusiona los prompts de referencia en uno solo que conserve lo mejor de cada uno.',
  'Crítica': 'Analiza los prompts de referencia: señala ambigüedades, información que falta y cómo mejorarlos.',
  'Plantilla': 'Extrae de los prompts de referencia una plantilla reutilizable con variables {{así}}.'
}

export function Prompts(): JSX.Element {
  const { settings } = useApp()
  const [items, setItems] = useState<SavedPrompt[]>([])
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [refs, setRefs] = useState<Set<string>>(new Set())
  const [chat, setChat] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dict = useQuickDictation((t) => setInput((x) => (x ? x + ' ' : '') + t))

  useEffect(() => { void window.api.getCollection<SavedPrompt>('prompts').then(setItems) }, [])
  const persist = (next: SavedPrompt[]): void => { setItems(next); void window.api.saveCollection('prompts', next) }
  const patch = (id: string, p: Partial<SavedPrompt>): void => persist(items.map((x) => (x.id === id ? { ...x, ...p } : x)))

  const shown = useMemo(() => {
    const t = q.toLowerCase()
    return items.filter((p) => !t || (p.title + p.text + p.tags.join(' ')).toLowerCase().includes(t))
  }, [items, q])

  const send = async (text = input): Promise<void> => {
    if (!text.trim() || busy) return
    setError('')
    const chosen = refs.size ? items.filter((p) => refs.has(p.id)) : relevant(items, text, 4)
    const context = chosen.length
      ? `\n\nPrompts de referencia (${chosen.length}):\n` + chosen.map((p, i) => `--- Referencia ${i + 1}: ${p.title} ---\n${p.text}`).join('\n\n')
      : '\n\n(No hay prompts de referencia seleccionados.)'
    const msgs: ChatMsg[] = [...chat, { role: 'user', content: chat.length ? text : text + context }]
    setChat(msgs)
    setInput('')
    setBusy(true)
    try {
      const reply = await window.api.chat(ARCHITECT, msgs)
      setChat([...msgs, { role: 'assistant', content: reply }])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const saveReply = (text: string): void =>
    persist([{ id: crypto.randomUUID(), title: text.replace(/[#*`\n]+/g, ' ').trim().slice(0, 60), text, tags: ['architect'], rating: 0, createdAt: Date.now() }, ...items])

  return (
    <div className="view split">
      <section className="card">
        <header><h2>📚 Biblioteca ({items.length})</h2></header>
        <input placeholder="Buscar por título, texto o etiqueta…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="list">
          {shown.length === 0 && <p className="muted">{items.length ? 'Sin resultados.' : 'Aún no hay prompts. Guarda uno desde Dictado con «💾 Guardar prompt».'}</p>}
          {shown.map((p) => (
            <div key={p.id} className="item">
              <div className="row tight">
                <input type="checkbox" checked={refs.has(p.id)} title="Usar como referencia para el agente"
                  onChange={() => setRefs((r) => { const n = new Set(r); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n })} />
                <input className="grow title" value={p.title} onChange={(e) => patch(p.id, { title: e.target.value })} />
                <button className={p.rating === 1 ? 'on' : ''} title="Funcionó" onClick={() => patch(p.id, { rating: p.rating === 1 ? 0 : 1 })}>👍</button>
                <button className={p.rating === -1 ? 'on' : ''} title="No funcionó" onClick={() => patch(p.id, { rating: p.rating === -1 ? 0 : -1 })}>👎</button>
                <button onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? '▲' : '▼'}</button>
              </div>
              {open === p.id && (
                <>
                  <textarea value={p.text} onChange={(e) => patch(p.id, { text: e.target.value })} />
                  <div className="row">
                    <input className="grow" placeholder="etiquetas separadas por coma" value={p.tags.join(', ')}
                      onChange={(e) => patch(p.id, { tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} />
                    <button onClick={() => void window.api.copy(p.text)}>📋</button>
                    <button className="danger" onClick={() => persist(items.filter((x) => x.id !== p.id))}>🗑</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <header>
          <h2>🏗 Prompt Architect</h2>
          <span className="muted">{refs.size ? `${refs.size} referencias elegidas` : 'Referencias automáticas (las 4 más relevantes)'}</span>
        </header>
        <p className="muted">Marca prompts de la biblioteca (☑) como referencia o deja que se elijan solos. Pide uno nuevo hablando o escribiendo. Modelo: {settings.llm.kind} · {settings.llm.model || 'por defecto'}</p>
        <div className="chat">
          {chat.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <pre>{i === 0 && m.role === 'user' ? m.content.split('\n\nPrompts de referencia')[0].split('\n\n(No hay')[0] : m.content}</pre>
              {m.role === 'assistant' && (
                <div className="row">
                  <button onClick={() => saveReply(m.content)}>💾 Guardar en biblioteca</button>
                  <button onClick={() => void window.api.copy(m.content)}>📋 Copiar</button>
                </div>
              )}
            </div>
          ))}
          {busy && <p className="muted">Pensando…</p>}
        </div>
        {error && <p className="warn" role="alert">{error}</p>}
        {dict.error && <p className="warn">{dict.error}</p>}
        <div className="row">
          {Object.entries(QUICK).map(([k, v]) => <button key={k} disabled={busy || chat.length > 0 || !items.length} onClick={() => void send(v)}>{k}</button>)}
          {chat.length > 0 && <button className="link" onClick={() => setChat([])}>Nueva conversación</button>}
        </div>
        <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ej.: quiero algo parecido a estos pero para migrar una API a FastAPI"
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send() }} />
        <div className="row">
          <button className={`mic ${dict.recording ? 'rec' : ''}`} onClick={() => void dict.toggle()}>
            {dict.recording ? '■ Detener' : dict.busy ? 'Transcribiendo…' : '🎤 Dictar'}
          </button>
          <button className="primary" onClick={() => void send()} disabled={busy || !input.trim()}>Enviar (Ctrl+Enter)</button>
        </div>
      </section>
    </div>
  )
}
