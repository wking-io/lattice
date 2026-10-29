import { Schema } from 'effect'
import { decode } from '../domain.js'
import type { Action } from './api.js'

const actionSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literals(['read', 'undo', 'redo', 'resetQuery', 'resetPage', 'copyContext']),
  }),
  Schema.Struct({ type: Schema.Literal('batch'), operations: Schema.Array(Schema.Unknown) }),
  Schema.Struct({
    type: Schema.Literal('visibility'),
    grids: Schema.optional(Schema.Boolean),
    panel: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    type: Schema.Literal('savePreset'),
    name: Schema.String,
    itemIds: Schema.Array(Schema.String),
    presetId: Schema.optional(Schema.String),
  }),
  Schema.Struct({ type: Schema.Literal('deletePreset'), presetId: Schema.String }),
])
export const validateAction = (input: unknown): Action => decode(actionSchema, input) as Action
