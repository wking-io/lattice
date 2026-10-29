import { build } from 'esbuild'
import { chmod, mkdir } from 'node:fs/promises'
await mkdir('dist', { recursive: true })
await build({
  entryPoints: ['src/client.ts'],
  outfile: 'dist/client.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  minify: true,
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env.DEV': 'false',
    'import.meta.env.PROD': 'true',
  },
})
await build({
  entryPoints: ['src/vite.ts', 'src/index.ts', 'src/setup.ts'],
  outdir: 'dist',
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: 'node22',
})
await chmod('dist/setup.js', 0o755)
