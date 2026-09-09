import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

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
      formats: ['es'],
    },
    rollupOptions: {
      // Vite's lib mode defaults this to 'strict', which guarantees the
      // entry keeps an exact static export/import shape — needed for a
      // library another bundler will `import` from, not for this widget,
      // which is loaded via a plain <script type="module"> for its side
      // effects only. Left at the default, adding a single dynamic import()
      // anywhere in the graph (e.g. heic.ts's lazy HEIC converter) makes
      // Rollup hoist the *entire* entry's own code out into a same-sized
      // sibling chunk and leave plugin.js as a near-empty facade that
      // immediately static-imports it — the opposite of what chunking is
      // for here: it turns one clean request into two on every single page
      // load, just to keep a stable export shape nothing consumes. false
      // keeps plugin.js the substantive file, splitting off only code
      // genuinely reachable exclusively through a dynamic import.
      preserveEntrySignatures: false,
      output: {
        entryFileNames: 'plugin.js',
        // Lazily-imported code (e.g. the HEIC→JPEG converter in src/lib/heic.ts)
        // lands in its own chunk under a predictable path, content-hashed so it
        // can be cached forever. The plugin runs as an ES module — dynamic
        // import() inside it resolves relative to plugin.js's own URL
        // (per the ES module spec), not the embedding host page's origin, so
        // this always resolves back to GetRoomly's CDN regardless of what site
        // the widget is embedded on. nginx has a matching /chunks/ allowlist
        // entry (see Dockerfile) — without it this 404s in production despite
        // working in every local build.
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
});
