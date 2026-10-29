// Run after `npm pack --pack-destination /tmp`; uses an isolated consumer checkout.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { chromium } from '@playwright/test'
import { get } from 'node:http'
import { gunzipSync, brotliDecompressSync } from 'node:zlib'
const run = promisify(execFile)
const tarball = path.resolve(process.argv[2] ?? '/tmp/lattice-0.1.0.tgz')
// Vite 7/Rollup compares real entry paths with root; macOS /var aliases /private/var.
const root = await realpath(await mkdtemp(path.join(tmpdir(), 'lattice-consumer-')))
let server, preview, browser
try {
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      devDependencies: {
        lattice: `file:${tarball}`,
        vite: process.env.LATTICE_TEST_VITE ?? '8.3.5',
      },
    }),
  )
  await writeFile(
    path.join(root, 'index.html'),
    '<!doctype html><html><head><title>Consumer</title></head><body><h1>Consumer project</h1></body></html>',
  )
  await run('npm', ['install', '--no-audit', '--no-fund'], { cwd: root })
  await run(process.execPath, [path.join(root, 'node_modules/.bin/lattice'), 'setup'], {
    cwd: root,
  })
  assert.match(await readFile(path.join(root, 'AGENTS.md'), 'utf8'), /WebMCP/)
  assert.match(
    await readFile(path.join(root, '.agents/skills/lattice/references/api.md'), 'utf8'),
    /window.lattice/,
  )
  const vite = await import(
    pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')).href
  )
  const { lattice } = await import(
    pathToFileURL(path.join(root, 'node_modules/lattice/dist/vite.js')).href
  )
  const options = {
    builtInPresets: false,
    presets: [{ id: 'fixture', name: 'Fixture', items: [{ kind: 'columns', count: 6 }] }],
  }
  server = await vite.createServer({
    root,
    configFile: false,
    base: '/nested/',
    plugins: [lattice(options)],
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  const originalClient = await readFile(path.join(root, 'node_modules/lattice/dist/client.js'))
  for (const encoding of ['br', 'gzip', 'identity']) {
    const response = await new Promise((resolve, reject) => {
      get(
        new URL('__lattice/client.js', server.resolvedUrls.local[0]),
        { headers: { 'Accept-Encoding': encoding } },
        (response) => {
          const chunks = []
          response.on('data', (chunk) => chunks.push(chunk))
          response.on('end', () =>
            resolve({
              headers: response.headers,
              body: Buffer.concat(chunks),
              status: response.statusCode,
            }),
          )
          response.on('error', reject)
        },
      ).on('error', reject)
    })
    assert.equal(response.status, 200)
    assert.equal(response.headers.vary, 'Accept-Encoding')
    assert.equal(
      response.headers['content-encoding'],
      encoding === 'identity' ? undefined : encoding,
    )
    const decoded =
      encoding === 'br'
        ? brotliDecompressSync(response.body)
        : encoding === 'gzip'
          ? gunzipSync(response.body)
          : response.body
    assert.deepEqual(decoded, originalClient)
  }
  browser = await chromium.launch()
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(server.resolvedUrls.local[0])
  await page.waitForFunction(() => !!window.lattice)
  const initial = await page.evaluate(() => window.lattice.read())
  assert.equal(initial.catalog.presets.length, 1)
  assert.equal(initial.catalog.presets[0].id, 'inline:fixture')
  const changed = await page.evaluate(() =>
    window.lattice.batch([
      { type: 'applyPreset', presetId: 'inline:fixture' },
      { type: 'add', item: { kind: 'individual', position: 500 } },
    ]),
  )
  assert.equal(changed.ok, true)
  const saved = await page.evaluate(
    (ids) => window.lattice.execute({ type: 'savePreset', name: 'Packaged', itemIds: ids }),
    changed.context.items.map((item) => item.id),
  )
  assert.equal(saved.saved, true)
  assert.equal(saved.persisted, true)
  assert.equal(
    JSON.parse(await readFile(path.join(root, 'lattice.presets.json'), 'utf8')).presets[0].name,
    'Packaged',
  )
  await vite.build({
    root,
    configFile: false,
    base: '/nested/',
    plugins: [lattice(options)],
    logLevel: 'silent',
  })
  for (const entry of await readdir(path.join(root, 'dist'), {
    recursive: true,
    withFileTypes: true,
  })) {
    if (entry.isFile())
      assert.doesNotMatch(
        await readFile(path.join(entry.parentPath, entry.name), 'utf8'),
        /lattice|foldkit|__lattice/i,
      )
  }
  preview = await vite.preview({
    root,
    configFile: false,
    base: '/nested/',
    plugins: [lattice(options)],
    logLevel: 'silent',
    preview: { host: '127.0.0.1', port: 0 },
  })
  await page.goto(preview.resolvedUrls.local[0])
  assert.equal(await page.evaluate(() => !!window.lattice), false)
  assert.equal(await page.locator('lattice-overlay').count(), 0)
  const endpoint = await page.request.post(`${preview.resolvedUrls.local[0]}__lattice/presets`, {
    data: { type: 'delete' },
  })
  assert.ok(endpoint.status() >= 400)
  assert.deepEqual(errors, [])
  console.log(
    `Packed install passed on Vite ${vite.version}: compressed delivery, nested Vite base, disabled built-ins, inline/file presets, agent setup, zero production footprint, and no preview runtime or write route.`,
  )
} finally {
  await browser?.close()
  await server?.close()
  if (preview) await new Promise((resolve) => preview.httpServer.close(resolve))
  await rm(root, { recursive: true, force: true })
}
