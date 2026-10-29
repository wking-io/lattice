import { Schema } from 'effect'

const finite = Schema.Number.check(Schema.isFinite())
const nonnegative = finite.check(Schema.isGreaterThanOrEqualTo(0))
const positive = finite.check(Schema.isGreaterThan(0))
const identifier = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,100}$/))
const name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120))
const color = Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/))
const common = {
  id: identifier,
  name,
  visible: Schema.Boolean,
  color,
  opacity: finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
}
const generated = {
  ...common,
  count: Schema.Union([
    positive.check(Schema.isInt(), Schema.isLessThanOrEqualTo(10000)),
    Schema.Literal('auto'),
  ]),
  alignment: Schema.Literals(['stretch', 'min', 'center', 'max']),
  gutter: nonnegative,
  margin: nonnegative,
  size: positive,
  offset: finite,
}
export const Columns = Schema.Struct({ ...generated, kind: Schema.Literal('columns') })
export const Rows = Schema.Struct({ ...generated, kind: Schema.Literal('rows') })
export const Individual = Schema.Struct({
  ...common,
  kind: Schema.Literal('individual'),
  axis: Schema.Literals(['vertical', 'horizontal']),
  unit: Schema.Literals(['px', '%']),
  position: finite,
})
export const Leaf = Schema.Union([Columns, Rows, Individual])
export type Leaf = typeof Leaf.Type
export type Individual = typeof Individual.Type
export const AppliedPreset = Schema.Struct({
  id: identifier,
  name,
  visible: Schema.Boolean,
  kind: Schema.Literal('preset'),
  sourceId: Schema.String,
  sourceRevision: Schema.String,
  items: Schema.Array(Leaf),
})
export const Item = Schema.Union([Leaf, AppliedPreset])
export type Item = typeof Item.Type
export const Items = Schema.Array(Item)
export type Items = typeof Items.Type
const optionalFields = <F extends Schema.Struct.Fields>(fields: F) =>
  Object.fromEntries(
    Object.entries(fields).map(([key, field]) => [key, Schema.optionalKey(field)]),
  ) as {
    [K in keyof F]: Schema.optionalKey<F[K]>
  }
export const LeafInput = Schema.Union([
  Schema.Struct({ ...optionalFields(generated), kind: Schema.Literal('columns') }),
  Schema.Struct({ ...optionalFields(generated), kind: Schema.Literal('rows') }),
  Schema.Struct({ ...optionalFields(Individual.fields), kind: Schema.Literal('individual') }),
])
export type LeafInput = typeof LeafInput.Type
export interface PresetDefinition {
  id: string
  name: string
  items: readonly LeafInput[]
}
export interface CatalogPreset {
  id: string
  localId: string
  name: string
  source: 'builtin' | 'inline' | 'file'
  writable: boolean
  revision: string
  items: readonly Leaf[]
}
export interface Catalog {
  revision: string
  presets: readonly CatalogPreset[]
  error?: string
}
export interface Dimensions {
  width: number
  height: number
  viewportHeight: number
  scrollY: number
}
export const palette = ['#FF3873', '#00D9FF', '#A178FF', '#BEF548', '#FFB52E', '#FF66E8'] as const
export const uid = () => crypto.randomUUID()
export const clone = <T>(value: T): T => structuredClone(value)
export const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

export function decode<A>(schema: Schema.Codec<A, unknown>, value: unknown): A {
  return Schema.decodeUnknownSync(schema, { onExcessProperty: 'error' })(value)
}
export function leaf(input: LeafInput, id = input.id ?? uid()): Leaf {
  const common = {
    id,
    name: input.kind === 'individual' ? 'Guide' : input.kind === 'columns' ? 'Columns' : 'Rows',
    visible: true,
    color: palette[0],
    opacity: 0.8,
  }
  const defaults =
    input.kind === 'individual'
      ? { ...common, axis: 'vertical', unit: 'px', position: 100 }
      : { ...common, count: 12, alignment: 'stretch', gutter: 24, margin: 24, size: 8, offset: 0 }
  const result = decode(Leaf, { ...defaults, ...input, id })
  if (result.kind !== 'individual' && result.count === 'auto' && result.alignment === 'stretch')
    throw new Error('Auto count requires fixed-size alignment (min, center, or max).')
  return result
}
export function validateItems(input: unknown): Items {
  const items = decode(Items, input)
  const ids = new Set<string>()
  for (const item of items) {
    for (const entry of item.kind === 'preset' ? [item, ...item.items] : [item]) {
      if (ids.has(entry.id)) throw new Error(`Duplicate item ID: ${entry.id}`)
      ids.add(entry.id)
      if (entry.kind !== 'preset') leaf(entry)
    }
  }
  return items
}
export function copyItem(item: Item, newId: string = uid()): Item {
  return item.kind === 'preset'
    ? { ...item, id: newId, items: item.items.map((i) => ({ ...i, id: uid() })) }
    : { ...item, id: newId }
}
export function flatten(items: Items): readonly Leaf[] {
  return items.flatMap((i) =>
    i.kind === 'preset'
      ? i.items.map((child) => ({ ...child, visible: i.visible && child.visible, id: uid() }))
      : [{ ...i, id: uid() }],
  )
}
export function applied(preset: CatalogPreset, id: string = uid()): Item {
  return {
    kind: 'preset',
    id,
    name: preset.name,
    visible: true,
    sourceId: preset.id,
    sourceRevision: preset.revision,
    items: preset.items.map((i) => ({ ...i, id: uid() })),
  }
}
export const OperationSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal('add'), item: LeafInput }),
  Schema.Struct({
    type: Schema.Literal('update'),
    id: identifier,
    changes: Schema.Record(Schema.String, Schema.Unknown),
  }),
  Schema.Struct({
    type: Schema.Literals(['remove', 'duplicate', 'unlink', 'updatePreset']),
    id: identifier,
  }),
  Schema.Struct({ type: Schema.Literal('applyPreset'), presetId: Schema.String }),
])
export type Operation = typeof OperationSchema.Type
export const Operations = Schema.Array(OperationSchema).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(500),
)
export function transact(items: Items, raw: unknown, catalog: Catalog): Items {
  const operations = decode(Operations, raw)
  if (!operations.length || operations.length > 500)
    throw new Error('Provide between 1 and 500 operations.')
  let next = [...items]
  for (const operation of operations) {
    if (operation.type === 'add') {
      next.push(leaf(operation.item as LeafInput))
      continue
    }
    if (operation.type === 'applyPreset') {
      const preset = catalog.presets.find((p) => p.id === operation.presetId)
      if (!preset) throw new Error('Preset is unavailable.')
      next.push(applied(preset))
      continue
    }
    const index = next.findIndex((i) => i.id === operation.id)
    if (index < 0) throw new Error(`Item not found: ${operation.id}`)
    const item = next[index]!
    switch (operation.type) {
      case 'remove':
        next.splice(index, 1)
        break
      case 'duplicate':
        next.splice(index + 1, 0, copyItem(item))
        break
      case 'update': {
        const changes = operation.changes
        if ('kind' in changes || 'id' in changes)
          throw new Error('Item kind and ID cannot be changed.')
        if (
          item.kind === 'preset' &&
          Object.keys(changes).some((k) => !['name', 'visible'].includes(k))
        )
          throw new Error('Unlink a preset before changing its underlying items.')
        next[index] = decode(Item, { ...item, ...changes })
        break
      }
      case 'unlink':
        if (item.kind !== 'preset') throw new Error('Only presets can be unlinked.')
        next.splice(
          index,
          1,
          ...item.items.map((i) => ({ ...i, visible: item.visible && i.visible })),
        )
        break
      case 'updatePreset': {
        if (item.kind !== 'preset') throw new Error('Select an applied preset.')
        const source = catalog.presets.find((p) => p.id === item.sourceId)
        if (!source) throw new Error('The preset source is unavailable; its snapshot is retained.')
        next[index] = { ...applied(source, item.id), visible: item.visible }
        break
      }
    }
  }
  return validateItems(next)
}
