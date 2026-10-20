import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Main-process deps are bundled so the packaged .app needs no node_modules.
  // node-pty is a native module, so it stays external and ships in the app's node_modules (see scripts/make-app.sh).
  main: { build: { externalizeDeps: false, rollupOptions: { external: ['node-pty'] } } },
  preload: {
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } }
  },
  renderer: {
    plugins: [react()],
    worker: { format: 'es' }
  }
})
