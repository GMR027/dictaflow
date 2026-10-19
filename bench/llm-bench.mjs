// Latencia de la redacción vía Ollama con el mismo prompt que src/main/llm.ts (modo rewrite).
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
// guard.ts es ESM en un paquete CommonJS: se le quitan los tipos y se importa como módulo (Node ≥ 22.13)
const { numbersPreserved } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(readFileSync(new URL('../src/shared/guard.ts', import.meta.url), 'utf8'))).toString('base64'))
// Uso: node bench/llm-bench.mjs <modelo> [num_ctx] [keep_alive]
import { performance } from 'node:perf_hooks'
const [model, numCtx = '8192', keep = '5m'] = process.argv.slice(2)
const system = ['Reescribe el texto dictado en español con mejor redacción: tono neutro y claro.',
  'Elimina muletillas y repeticiones, corrige puntuación y gramática, conserva el significado y no añadas información.',
  ...(process.env.NO_NUM_RULE ? [] : ['Conserva exactamente las cifras, horas, cantidades y nombres propios dichos; no los conviertas ni los cambies.']),
  'Responde SOLO con el texto reescrito, sin comillas ni explicaciones.'].join('\n')
const texts = [
  'eh hola quería decirte que mañana a las cinco y media nos vemos en la oficina de Juan Pérez para revisar el contrato de veinte mil euros',
  'entonces el servidor de postgres se cae cuando hay más de cien conexiones y no sé si es por el pool de pgbouncer o por la memoria',
  'o sea que vamos a tener que mover la reunión del martes al jueves porque María no puede y bueno también está el tema del presupuesto que hay que cerrar antes del viernes de esta semana que viene'
]
async function run(text) {
  const t = performance.now()
  const r = await fetch('http://127.0.0.1:11434/api/chat', { method: 'POST', body: JSON.stringify({ model, stream: false, keep_alive: keep, options: { temperature: 0.4, num_ctx: +numCtx }, messages: [{ role: 'system', content: system }, { role: 'user', content: `Texto dictado:\n${text}` }] }) })
  const j = await r.json()
  return { ms: Math.round(performance.now() - t), load: Math.round(j.load_duration / 1e6), evalTok: j.eval_count, out: j.message.content.trim() }
}
console.log(model, 'num_ctx', numCtx)
for (const t of texts) { const r = await run(t); console.log(JSON.stringify({ ms: r.ms, tok: r.evalTok, cifrasOK: numbersPreserved(t, r.out) }), '\n  ', r.out) }
