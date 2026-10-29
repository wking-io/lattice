import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PresetRepository } from '../src/server/preset-repository.js'
import { isLoopback } from '../src/vite.js'

const folders: string[] = []
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-test-'))
  folders.push(root)
  return { root, repository: new PresetRepository(root) }
}
afterEach(async () => {
  await Promise.all(folders.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const preset = { id: 'custom', name: 'Custom', items: [{ kind: 'columns' as const, count: 12 }] }
describe('repository presets', () => {
  it('creates the file, retries safely, detects stale writes, and loads manual changes', async () => {
    const { repository } = await fixture()
    const before = await repository.catalog()
    const operation = { type: 'save' as const, preset, expectedRevision: before.revision }
    const saved = await repository.mutate(operation)
    expect(saved.presets).toHaveLength(7)
    expect(await repository.mutate(operation)).toEqual(saved)
    await expect(
      repository.mutate({ ...operation, preset: { ...preset, name: 'Other' } }),
    ).rejects.toThrow('changed')
    const file = JSON.parse(await readFile(repository.file, 'utf8'))
    file.presets[0].name = 'Manually edited'
    await writeFile(repository.file, JSON.stringify(file))
    expect((await repository.catalog()).presets.at(-1)?.name).toBe('Manually edited')
  })
  it('preserves invalid files and prevents concurrent servers from clobbering changes', async () => {
    const { root, repository } = await fixture()
    const second = new PresetRepository(root)
    const before = await repository.catalog()
    const results = await Promise.allSettled([
      repository.mutate({ type: 'save', preset, expectedRevision: before.revision }),
      second.mutate({
        type: 'save',
        preset: { ...preset, id: 'another' },
        expectedRevision: before.revision,
      }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    await writeFile(repository.file, '{invalid')
    await expect(
      repository.mutate({ type: 'save', preset, expectedRevision: before.revision }),
    ).rejects.toThrow()
    expect(await readFile(repository.file, 'utf8')).toBe('{invalid')
  })
  it('keeps inline presets read-only and disabled built-ins out of the catalog', async () => {
    const { root } = await fixture()
    const repository = new PresetRepository(root, undefined, [preset], false)
    expect((await repository.catalog()).presets).toMatchObject([
      { id: 'inline:custom', writable: false },
    ])
    await expect(
      repository.mutate({
        type: 'delete',
        id: 'inline:custom',
        expectedRevision: (await repository.catalog()).revision,
      }),
    ).rejects.toThrow('file-local')
  })
  it('rejects traversal and symbolic-link targets', async () => {
    const { root, repository } = await fixture()
    expect(() => new PresetRepository(root, '../outside.json')).toThrow('inside')
    await symlink('/tmp', path.join(root, 'linked'))
    await expect(new PresetRepository(root, 'linked/presets.json').catalog()).rejects.toThrow(
      'symbolic',
    )
    await symlink('/tmp/unused-lattice-file.json', repository.file)
    await expect(repository.catalog()).rejects.toThrow('symbolic')
  })
  it('accepts only loopback host names', () => {
    expect(['localhost', 'app.localhost', '127.0.0.1', '[::1]'].every(isLoopback)).toBe(true)
    expect(['example.com', 'localhost.example.com', '192.168.1.1'].some(isLoopback)).toBe(false)
  })
})
