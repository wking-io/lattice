import { expect, it } from 'vitest'
import { build } from 'vite'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { lattice } from '../src/vite.js'

it('produces identical application files with and without the plugin', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-production-'))
  try {
    await writeFile(
      path.join(root, 'index.html'),
      '<html><body><h1>Fixture</h1><script type="module" src="/app.js"></script></body></html>',
    )
    await writeFile(path.join(root, 'app.js'), 'document.body.dataset.ready = "yes"')
    const outputs: Record<string, string>[] = []
    for (const enabled of [false, true]) {
      const outDir = enabled ? 'with' : 'without'
      await build({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: enabled ? [lattice()] : [],
        build: { outDir },
      })
      const directory = path.join(root, outDir),
        files: Record<string, string> = {}
      for (const file of await readdir(directory, { recursive: true, withFileTypes: true })) {
        if (file.isFile()) {
          const full = path.join(file.parentPath, file.name)
          files[path.relative(directory, full)] = await readFile(full, 'utf8')
        }
      }
      outputs.push(files)
    }
    expect(outputs[1]).toEqual(outputs[0])
    expect(JSON.stringify(outputs[1])).not.toMatch(/lattice|foldkit|__lattice/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 20000)
