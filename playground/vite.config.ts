import { defineConfig } from 'vite'
import { lattice } from '../dist/vite.js'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [
    lattice({
      ...(process.env.LATTICE_TESTS ? { presetsFile: '.lattice-test-presets.json' } : {}),
      presets: [
        {
          id: 'editorial',
          name: 'Editorial',
          items: [
            { kind: 'columns', count: 6, gutter: 24, margin: 48 },
            {
              kind: 'rows',
              count: 'auto',
              alignment: 'min',
              size: 8,
              gutter: 0,
              color: '#00D9FF',
              opacity: 0.35,
            },
          ],
        },
      ],
    }),
  ],
  server: { host: '127.0.0.1', port: process.env.LATTICE_TESTS ? 5197 : 5173, strictPort: true },
})
