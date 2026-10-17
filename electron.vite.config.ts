import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts'), 'stt-worker': resolve('src/main/stt-worker.ts') } } }
  },
  preload: { plugins: [externalizeDepsPlugin()], resolve: { alias: shared } },
  renderer: {
    plugins: [react()],
    resolve: { alias: { ...shared, '@': resolve('src/renderer/src') } },
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html'), pill: resolve('src/renderer/pill.html') }
      }
    }
  }
})
