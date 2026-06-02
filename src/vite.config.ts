import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../dist-web',
    emptyOutDir: true,
    target: 'es2020',
    reportCompressedSize: false,
    sourcemap: false,
    rollupOptions: {
      input: path.resolve(__dirname, 'index.html'),
      output: {
        manualChunks(id) {
          if (id.includes('react-syntax-highlighter')) {
            return 'syntax-highlighter'
          }
          if (id.includes('react') || id.includes('zustand') || id.includes('scheduler')) {
            return 'react-vendor'
          }
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
})
