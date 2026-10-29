import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { catalogEntries, builtins, definitions } from '../presets.js'
import { equal, type Catalog, type PresetDefinition } from '../domain.js'

export class PresetConflict extends Error {}
export type PresetMutation =
  | { type: 'save'; preset: PresetDefinition; expectedRevision: string }
  | { type: 'delete'; id: string; expectedRevision: string }
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'
export class PresetRepository {
  readonly file: string
  private readonly fixed
  constructor(
    readonly root: string,
    file = 'lattice.presets.json',
    inline: readonly PresetDefinition[] = [],
    includeBuiltins = true,
  ) {
    this.file = path.resolve(root, file)
    const relative = path.relative(root, this.file)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
      throw new Error('presetsFile must be a file inside the Vite project root.')
    this.fixed = [
      ...(includeBuiltins ? catalogEntries('builtin', builtins) : []),
      ...catalogEntries('inline', inline),
    ]
  }
  private async checkPath(): Promise<void> {
    const root = await realpath(this.root)
    let current = this.root
    for (const segment of path.relative(this.root, this.file).split(path.sep)) {
      current = path.join(current, segment)
      try {
        if ((await lstat(current)).isSymbolicLink())
          throw new Error('Preset file paths must not contain symbolic links.')
        const actual = await realpath(current)
        if (actual !== root && !actual.startsWith(root + path.sep))
          throw new Error('Preset file is outside the project root.')
      } catch (error) {
        if (!missing(error)) throw error
      }
    }
  }
  private async read() {
    await this.checkPath()
    let raw: string | null = null
    try {
      raw = await readFile(this.file, 'utf8')
    } catch (error) {
      if (!missing(error)) throw error
    }
    if (raw && Buffer.byteLength(raw) > 1024 * 1024) throw new Error('Preset file exceeds 1 MiB.')
    return {
      raw,
      revision: hash(raw ?? 'missing'),
      presets: raw === null ? [] : definitions(JSON.parse(raw)),
    }
  }
  async catalog(): Promise<Catalog> {
    const file = await this.read()
    return {
      revision: file.revision,
      presets: [...this.fixed, ...catalogEntries('file', file.presets)],
    }
  }
  async mutate(operation: PresetMutation): Promise<Catalog> {
    if (!operation || typeof operation.expectedRevision !== 'string')
      throw new Error('An expected catalog revision is required.')
    if (operation.type !== 'save' && operation.type !== 'delete')
      throw new Error('Unknown preset operation.')
    if (
      Object.keys(operation).some(
        (k) =>
          !(
            operation.type === 'save'
              ? ['type', 'preset', 'expectedRevision']
              : ['type', 'id', 'expectedRevision']
          ).includes(k),
      )
    )
      throw new Error('Unknown preset operation field.')
    const preset =
      operation.type === 'save'
        ? definitions({ version: 1, presets: [operation.preset] })[0]!
        : undefined
    if (operation.type === 'delete' && !/^[\w-]{1,100}$/.test(operation.id))
      throw new Error('Only file-local preset IDs may be deleted.')
    await this.checkPath()
    await mkdir(path.dirname(this.file), { recursive: true })
    await this.checkPath()
    const lockPath = `${this.file}.lock`
    let lock
    try {
      lock = await open(lockPath, 'wx', 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new PresetConflict(
          'Preset file is locked by another writer. Retry after it finishes; a crashed server may leave a .lock file.',
        )
      throw error
    }
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      const current = await this.read()
      // Stable IDs make a retried save safe when its first response was lost.
      const existing = current.presets.find((p) => p.id === preset?.id)
      if (preset && equal(existing, preset)) return this.catalog()
      if (current.revision !== operation.expectedRevision)
        throw new PresetConflict('Preset file changed. Reload the catalog before saving again.')
      const next = preset
        ? [...current.presets.filter((p) => p.id !== preset.id), preset]
        : current.presets.filter((p) => p.id !== (operation as { id: string }).id)
      const contents = JSON.stringify({ version: 1, presets: next }, null, 2) + '\n'
      if (Buffer.byteLength(contents) > 1024 * 1024)
        throw new Error('Preset file would exceed 1 MiB.')
      const file = await open(temporary, 'wx', 0o600)
      try {
        await file.writeFile(contents)
        await file.sync()
      } finally {
        await file.close()
      }
      await this.checkPath()
      if ((await this.read()).revision !== current.revision)
        throw new PresetConflict('Preset file changed during the save. Retry after reloading.')
      await rename(temporary, this.file)
      return await this.catalog()
    } finally {
      try {
        await unlink(temporary).catch((error) => {
          if (!missing(error)) throw error
        })
      } finally {
        await lock.close()
        await unlink(lockPath)
      }
    }
  }
}
