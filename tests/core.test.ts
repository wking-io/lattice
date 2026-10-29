import { describe, expect, it } from 'vitest'
import { leaf, transact, type Catalog } from '../src/domain.js'
import { gridGeometry, resolve } from '../src/geometry.js'
import { builtins, catalogEntries } from '../src/presets.js'
import { applySaved, batch, capturePreset, history, type State } from '../src/state.js'
import { loadPage, persistPage, type StorageLike } from '../src/storage.js'

class MemoryStorage implements StorageLike {
  data = new Map<string, string>()
  getItem(key: string) {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.data.set(key, value)
  }
  removeItem(key: string) {
    this.data.delete(key)
  }
}
const catalog: Catalog = { revision: 'test', presets: catalogEntries('builtin', builtins) }
const dimensions = { width: 1200, height: 2400, viewportHeight: 800, scrollY: 0 }
const initial = (storage = new MemoryStorage(), url = 'http://localhost/products'): State => ({
  page: loadPage(storage, url, 'test'),
  catalog,
  dimensions,
  revision: 0,
  undo: [],
  redo: [],
  preferences: { grids: true, panel: true },
})

describe('geometry', () => {
  it('resolves stretch and fixed alignments without rounding source geometry', () => {
    const columns = leaf({ kind: 'columns', count: 12, margin: 20, gutter: 20 })
    if (columns.kind === 'individual') throw new Error('Unexpected type')
    expect(gridGeometry(columns, 1200)).toMatchObject({ start: 20, size: 940 / 12, count: 12 })
    expect(gridGeometry({ ...columns, alignment: 'center', count: 2, size: 100 }, 1000).start).toBe(
      390,
    )
    expect(
      gridGeometry({ ...columns, alignment: 'max', count: 2, size: 100, offset: 30 }, 1000).start,
    ).toBe(750)
    expect(gridGeometry(columns, 100).warning).toBeTruthy()
    expect(
      gridGeometry(
        { ...columns, count: 'auto', alignment: 'center', size: 100, gutter: 0, offset: 200 },
        1000,
      ).count,
    ).toBe(10)
  })
  it('renders baseline boundaries once, culls long documents, and resolves percentage guides', () => {
    const items = [
      leaf({ kind: 'rows', count: 'auto', alignment: 'min', size: 8, gutter: 0, offset: 0 }),
      leaf({ kind: 'individual', axis: 'horizontal', unit: '%', position: 50 }),
    ]
    const result = resolve(items, dimensions)
    expect(result.guides.filter((g) => g.leafId === items[0]!.id)).toHaveLength(301)
    expect(result.guides.at(-1)?.position).toBe(1200)
    const large = resolve(items, { ...dimensions, height: 10_000_000, scrollY: 200_000 }, true)
    expect(large.guides.length).toBeLessThan(110)
    expect(large.grids[0]?.count).toBe(1_250_000)
  })
  it('rejects unsupported Auto stretch and invalid numbers', () => {
    expect(() => leaf({ kind: 'rows', count: 'auto' })).toThrow('fixed-size')
    expect(() => leaf({ kind: 'columns', gutter: -1 })).toThrow()
    expect(() => leaf({ kind: 'individual', position: Infinity })).toThrow()
  })
  it('bounds rendering work for extremely dense grids', () => {
    const dense = resolve(
      [leaf({ kind: 'rows', count: 'auto', alignment: 'min', size: 0.00001, gutter: 0 })],
      dimensions,
      true,
    )
    expect(dense.truncated).toBe(true)
    expect(dense.guides.length).toBeLessThanOrEqual(5000)
  })
})
describe('shared editing and history', () => {
  it('batches atomically, preserves other items, and restores IDs on redo', () => {
    const start = initial()
    const next = batch(start, [
      { type: 'add', item: { kind: 'columns', count: 12, gutter: 20, margin: 20 } },
      { type: 'add', item: { kind: 'rows', count: 'auto', alignment: 'min', size: 8, gutter: 0 } },
    ])
    expect(next.page.items).toHaveLength(2)
    expect(next.undo).toHaveLength(1)
    const undo = history(next, 'undo')
    expect(undo.page.items).toHaveLength(0)
    expect(history(undo, 'redo').page.items).toEqual(next.page.items)
    expect(() =>
      batch(next, [
        { type: 'remove', id: next.page.items[0]!.id },
        { type: 'update', id: 'missing', changes: { name: 'oops' } },
      ]),
    ).toThrow('not found')
    expect(next.page.items).toHaveLength(2)
  })
  it('protects presets, flattens on save, and keeps their definitions after undo', () => {
    let state = batch(initial(), [
      { type: 'applyPreset', presetId: 'builtin:columns-12' },
      { type: 'add', item: { kind: 'individual' } },
    ])
    const preset = state.page.items[0]!
    expect(() =>
      transact(
        state.page.items,
        [{ type: 'update', id: preset.id, changes: { items: [] } }],
        catalog,
      ),
    ).toThrow('Unlink')
    const definition = capturePreset(
      state,
      state.page.items.map((i) => i.id),
      'My layout',
      'my-layout',
    )
    expect(definition.items.map((i) => i.kind)).toEqual(['columns', 'individual'])
    const updatedCatalog = {
      ...catalog,
      presets: [...catalog.presets, ...catalogEntries('file', [definition])],
    }
    const before = state.page.items
    state = applySaved(
      state,
      updatedCatalog,
      'file:my-layout',
      before.map((i) => i.id),
    )
    expect(state.page.items).toHaveLength(1)
    const undone = history(state, 'undo')
    expect(undone.page.items).toEqual(before)
    expect(undone.catalog.presets.some((p) => p.id === 'file:my-layout')).toBe(true)
    const unlinked = batch(state, [{ type: 'unlink', id: state.page.items[0]!.id }])
    expect(unlinked.page.items.map((i) => i.kind)).toEqual(['columns', 'individual'])
  })
})
describe('URL persistence', () => {
  it('forks query edits, can undo the fork, and excludes history from storage', () => {
    const storage = new MemoryStorage()
    const before = initial(storage),
      base = batch(before, [{ type: 'add', item: { kind: 'individual', position: 100 } }])
    persistPage(storage, before.page, base.page)
    const query = initial(storage, 'http://localhost/products?b=2&a=1#ignored')
    expect(query.page.items).toEqual(base.page.items)
    expect(query.page.queryKey).toContain('?a=1&b=2')
    const fork = batch(query, [
      { type: 'update', id: query.page.items[0]!.id, changes: { position: 200 } },
    ])
    persistPage(storage, query.page, fork.page)
    expect(loadPage(storage, 'http://localhost/products', 'test').items).toEqual(base.page.items)
    expect(initial(storage, 'http://localhost/products?a=1&b=2').page.items).toEqual(
      fork.page.items,
    )
    const undone = history(fork, 'undo')
    persistPage(storage, fork.page, undone.page)
    expect(loadPage(storage, query.page.url, 'test').override).toBe(false)
    expect([...storage.data.values()].join()).not.toContain('undo')
  })
  it('creates a base on the first edit at a query URL and isolates projects', () => {
    const storage = new MemoryStorage(),
      state = initial(storage, 'http://localhost/products?first=1')
    const next = batch(state, [{ type: 'add', item: { kind: 'individual' } }])
    persistPage(storage, state.page, next.page)
    expect(next.page.override).toBe(false)
    expect(loadPage(storage, 'http://localhost/products', 'test').items).toHaveLength(1)
    expect(loadPage(storage, 'http://localhost/products', 'another-project').items).toHaveLength(0)
  })
})
