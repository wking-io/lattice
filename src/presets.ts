import { decode, leaf, type CatalogPreset, type PresetDefinition } from './domain.js'
import { Schema } from 'effect'

export const presetFileSchema = Schema.Struct({
  version: Schema.Literal(1),
  presets: Schema.Array(
    Schema.Struct({ id: Schema.String, name: Schema.String, items: Schema.Array(Schema.Unknown) }),
  ),
})
export function definitions(value: unknown): PresetDefinition[] {
  const parsed = decode(presetFileSchema, value)
  const ids = new Set<string>()
  return parsed.presets.map((preset) => {
    if (!/^[\w-]{1,100}$/.test(preset.id) || ids.has(preset.id))
      throw new Error(`Invalid or duplicate preset ID: ${preset.id}`)
    if (!preset.name.trim() || preset.name.length > 120 || !preset.items.length)
      throw new Error('Presets need a name and at least one item.')
    ids.add(preset.id)
    return {
      ...preset,
      items: preset.items.map((item, index) =>
        leaf(item as Parameters<typeof leaf>[0], `item-${index}`),
      ),
    }
  })
}
// Stable content fingerprint for snapshots; the server uses SHA-256 for file concurrency.
export function fingerprint(value: unknown): string {
  let hash = 2166136261
  for (const char of JSON.stringify(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return (hash >>> 0).toString(16)
}
export function catalogEntries(
  source: CatalogPreset['source'],
  presets: readonly PresetDefinition[],
): CatalogPreset[] {
  return definitions({ version: 1, presets }).map((p) => ({
    id: `${source}:${p.id}`,
    localId: p.id,
    source,
    writable: source === 'file',
    name: p.name,
    items: p.items.map((i, n) => leaf(i, `item-${n}`)),
    revision: fingerprint(p),
  }))
}
export const builtins: readonly PresetDefinition[] = [
  ...[4, 8, 12, 16].map((count) => ({
    id: `columns-${count}`,
    name: `${count} columns`,
    items: [
      {
        kind: 'columns' as const,
        count,
        gutter: count === 4 || count === 16 ? 16 : 24,
        margin: count === 4 || count === 16 ? 16 : 24,
      },
    ],
  })),
  ...[4, 8].map((size) => ({
    id: `baseline-${size}`,
    name: `${size}px baseline`,
    items: [
      {
        kind: 'rows' as const,
        count: 'auto' as const,
        alignment: 'min' as const,
        size,
        gutter: 0,
        margin: 0,
        offset: 0,
        color: '#00D9FF',
        opacity: 0.5,
      },
    ],
  })),
]
