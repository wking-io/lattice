import { build } from 'esbuild'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { gzipSync, brotliCompressSync, constants } from 'node:zlib'
import { minify } from 'terser'
import { generateToolSchemas } from './tool-schemas.mjs'
await generateToolSchemas()
await mkdir('dist', { recursive: true })
const browser = await build({
  entryPoints: ['src/client.ts'],
  outfile: 'dist/client.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  minify: true,
  write: false,
  metafile: true,
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env.DEV': 'false',
    'import.meta.env.PROD': 'true',
    'import.meta.hot': 'undefined',
  },
})
const optimized = await minify(browser.outputFiles[0].text, {
  module: true,
  compress: { passes: 3 },
  mangle: true,
  format: { comments: false },
})
const client = Buffer.from(
  '/*! Bundled dependency licenses: ./client.licenses.txt */\n' + optimized.code,
)
const inputs = browser.metafile.outputs['dist/client.js'].inputs
const packages = [
  ...new Set(
    Object.entries(inputs)
      .filter(([name, info]) => name.startsWith('node_modules/') && info.bytesInOutput)
      .map(([name]) => name.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)/)[1]),
  ),
]
const notices = await Promise.all(
  packages.map(async (name) => {
    const license = await readFile(`node_modules/${name}/LICENSE`, 'utf8')
    const vendored =
      name === 'foldkit'
        ? await readFile('node_modules/foldkit/THIRD-PARTY-NOTICES.md', 'utf8')
        : ''
    return `${name}\n${license}\n${vendored}`
  }),
)
const gzip = gzipSync(client, { level: 9 })
const brotli = brotliCompressSync(client, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } })
const sizes = { minified: client.length, gzip: gzip.length, brotli: brotli.length }
const budget = { minified: 650000, gzip: 205000, brotli: 175000 }
for (const key of Object.keys(sizes)) {
  if (sizes[key] > budget[key])
    throw new Error(`Browser ${key} budget exceeded: ${sizes[key]} > ${budget[key]} bytes`)
}
await Promise.all([
  writeFile('dist/client.js', client),
  writeFile('dist/client.js.gz', gzip),
  writeFile('dist/client.js.br', brotli),
  writeFile('dist/client.licenses.txt', notices.join('\n\n')),
  writeFile(
    'dist/bundle-report.json',
    JSON.stringify(
      { sizes, budget, inputs: browser.metafile.outputs['dist/client.js'].inputs },
      null,
      2,
    ) + '\n',
  ),
])
console.log(`Browser bundle: ${sizes.minified} bytes; gzip ${sizes.gzip}; Brotli ${sizes.brotli}.`)
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
