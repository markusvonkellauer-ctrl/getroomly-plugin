import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Lib mode does not auto-replace process.env.NODE_ENV — React's UMD-style
  // dev/prod fork still references it, so we must define it for the browser.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': '{}',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    lib: {
      entry: './src/shadow-entry.tsx',
      name: 'GetRoomlyPlugin',
      fileName: 'plugin',
      formats: ['es']
    },
    rollupOptions: {
      output: {
        entryFileNames: 'plugin.js'
      }
    }
  }
})
