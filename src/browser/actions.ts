import { Schema } from 'effect'
import { decode, Operations } from '../domain.js'

export const EditAction = Schema.Union([
  Schema.Struct({ type: Schema.Literals(['undo', 'redo', 'resetQuery', 'resetPage']) }),
  Schema.Struct({ type: Schema.Literal('batch'), operations: Operations }),
  Schema.Struct({
    type: Schema.Literal('visibility'),
    grids: Schema.optionalKey(Schema.Boolean),
    panel: Schema.optionalKey(Schema.Boolean),
  }),
])
export const PresetAction = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('savePreset'),
    name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
    itemIds: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
    presetId: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ type: Schema.Literal('deletePreset'), presetId: Schema.String }),
])
export const Action = Schema.Union([
  Schema.Struct({ type: Schema.Literals(['read', 'copyContext']) }),
  EditAction,
  PresetAction,
])
export type Action = typeof Action.Type
const revision = Schema.optionalKey(
  Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
)
export const toolInputs = {
  lattice_read: Schema.Record(Schema.String, Schema.Never),
  lattice_edit: Schema.Struct({ action: EditAction, expectedRevision: revision }),
  lattice_presets: Schema.Struct({ action: PresetAction, expectedRevision: revision }),
  lattice_pages: Schema.Struct({ url: Schema.optionalKey(Schema.String) }),
}
export const validateAction = (input: unknown): Action => decode(Action, input)
