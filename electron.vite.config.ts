import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Main-process deps are bundled so the packaged .app needs no node_modules.
  main: { build: { externalizeDeps: false } },
  preload: {
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } }
  },
  renderer: {
    plugins: [react()],
    worker: { format: 'es' }
  }
})
