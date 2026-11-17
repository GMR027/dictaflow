// Compila la interfaz de escritorio (src/renderer) para Android: misma app React, pero con
// `window.api` implementado sobre Tauri (src/renderer/src/platform/tauri.ts).
//   npm run android:ui   → android/ui-dist/
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

const root = resolve(__dirname, '..')

/** Cambia la entrada por la de Android y quita la CSP del HTML: en Tauri la pone tauri.conf.json. */
const androidHtml = (): Plugin => ({
  name: 'dictaflow-android-html',
  // `pre`: antes de que Vite lea las entradas del HTML; si no, se empaqueta la de escritorio.
  transformIndexHtml: {
    order: 'pre',
    handler: (html) =>
      html
        .replace('/src/main.tsx', '/src/main-android.ts')
        .replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
  }
})

export default defineConfig({
  root: resolve(root, 'src/renderer'),
  base: './',
  plugins: [react(), androidHtml()],
  resolve: { alias: { '@shared': resolve(root, 'src/shared'), '@': resolve(root, 'src/renderer/src') } },
  build: {
    outDir: resolve(__dirname, 'ui-dist'),
    emptyOutDir: true,
    rollupOptions: { input: resolve(root, 'src/renderer/index.html') }
  }
})
