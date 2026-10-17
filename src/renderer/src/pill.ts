import type { PillState } from '@shared/types'
import type { Api } from '../../preload'

const api = (window as unknown as { api: Api }).api
const el = document.getElementById('pill') as HTMLDivElement
const colors: Record<PillState['state'], string> = {
  idle: '#64748b', listening: '#ef4444', working: '#f59e0b', done: '#22c55e', error: '#ef4444'
}

el.style.cssText =
  'display:flex;align-items:center;gap:10px;margin:6px;padding:10px 16px;border-radius:999px;' +
  'background:rgba(15,17,21,.94);color:#e5e7eb;font:500 14px system-ui,sans-serif;' +
  'box-shadow:0 4px 18px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.08)'

api.onPill((s) => {
  el.innerHTML = ''
  const dot = document.createElement('span')
  dot.style.cssText = `width:10px;height:10px;border-radius:50%;background:${colors[s.state]};` +
    (s.state === 'listening' || s.state === 'working' ? 'animation:p 1s infinite' : '')
  const text = document.createElement('span')
  text.textContent = s.message
  el.append(dot, text)
})

const style = document.createElement('style')
style.textContent = '@keyframes p{50%{opacity:.25}}'
document.head.append(style)
