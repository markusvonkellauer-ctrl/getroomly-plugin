import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { copyFileSync, existsSync } from 'fs'

const FRONTEND_PUBLIC = path.resolve(
  __dirname,
  '../GetRoomly Frontend/public/plugin.js'
)

/** Copies dist/plugin.js to the frontend's public folder after each build */
function copyPluginToFrontend() {
  return {
    name: 'copy-plugin-to-frontend',
    closeBundle() {
      const src = path.resolve(__dirname, 'dist/plugin.js')
      if (existsSync(src)) {
        try {
          copyFileSync(src, FRONTEND_PUBLIC)
          console.log(`✅ Copied plugin.js → ${FRONTEND_PUBLIC}`)
        } catch (err) {
          console.warn('⚠️ Could not copy plugin.js to frontend:', err)
        }
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), copyPluginToFrontend()],
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