import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../web',
    emptyOutDir: true,
  },
  server: {
    port: 43118,
    proxy: {
      '/v1': 'http://127.0.0.1:43117',
      '/health': 'http://127.0.0.1:43117',
    },
  },
})
