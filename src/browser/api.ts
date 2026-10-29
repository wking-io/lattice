import type { Operation } from '../domain.js'
import type { LatticeContext } from '../state.js'

export type Action =
  | { type: 'read' | 'undo' | 'redo' | 'resetQuery' | 'resetPage' | 'copyContext' }
  | { type: 'batch'; operations: readonly Operation[] }
  | { type: 'visibility'; grids?: boolean; panel?: boolean }
  | { type: 'savePreset'; name: string; itemIds: readonly string[]; presetId?: string }
  | { type: 'deletePreset'; presetId: string }
export interface OperationResult {
  ok: boolean
  context: LatticeContext
  applied?: boolean
  persisted?: boolean
  saved?: boolean
  presetId?: string
  error?: string
}
export interface LatticeAPI {
  version: 1
  read(): Promise<LatticeContext>
  execute(action: Action, options?: { expectedRevision?: number }): Promise<OperationResult>
  batch(
    operations: readonly Operation[],
    options?: { expectedRevision?: number },
  ): Promise<OperationResult>
  dispose(): void
}
export interface Request {
  id: string
  scope: string
  action: Action
  expectedRevision?: number
}
declare global {
  interface Window {
    lattice?: LatticeAPI
  }
}

interface WebMCPContext {
  registerTool(
    tool: {
      name: string
      description: string
      inputSchema: Record<string, unknown>
      annotations: Record<string, unknown>
      execute(input: unknown, context: { signal: AbortSignal }): Promise<string>
    },
    options: { signal: AbortSignal },
  ): Promise<unknown> | unknown
}
export async function registerWebMCP(api: LatticeAPI, signal: AbortSignal): Promise<void> {
  const modelContext = (document as Document & { modelContext?: WebMCPContext }).modelContext
  if (!modelContext?.registerTool) return
  await modelContext.registerTool(
    {
      name: 'lattice_read',
      description:
        'Read Lattice page grid settings, item IDs, geometry, dimensions, history, and available presets. Prefer this over inspecting overlay DOM.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, debugging: true },
      execute: async () => JSON.stringify(await api.read()),
    },
    { signal },
  )
  await modelContext.registerTool(
    {
      name: 'lattice_edit',
      description:
        'Edit development page grids through Lattice. Read first. Batch operations are atomic and one undo step. Add preserves other items. Only individual guides move. savePreset writes the project JSON file, then groups selected items; undo keeps the file definition. Built-in and inline presets are read-only.',
      inputSchema: {
        type: 'object',
        required: ['action'],
        additionalProperties: false,
        properties: {
          expectedRevision: { type: 'integer', minimum: 0 },
          action: {
            oneOf: [
              {
                type: 'object',
                required: ['type', 'operations'],
                additionalProperties: false,
                properties: {
                  type: { const: 'batch' },
                  operations: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 500,
                    items: {
                      oneOf: [
                        {
                          type: 'object',
                          required: ['type', 'item'],
                          additionalProperties: false,
                          properties: {
                            type: { const: 'add' },
                            item: {
                              type: 'object',
                              required: ['kind'],
                              properties: {
                                kind: { enum: ['columns', 'rows', 'individual'] },
                                name: { type: 'string' },
                                count: {
                                  oneOf: [{ type: 'integer', minimum: 1 }, { const: 'auto' }],
                                },
                                alignment: { enum: ['stretch', 'min', 'center', 'max'] },
                                gutter: { type: 'number', minimum: 0 },
                                margin: { type: 'number', minimum: 0 },
                                size: { type: 'number', exclusiveMinimum: 0 },
                                offset: { type: 'number' },
                                axis: { enum: ['vertical', 'horizontal'] },
                                unit: { enum: ['px', '%'] },
                                position: { type: 'number' },
                                color: { type: 'string' },
                                opacity: { type: 'number', minimum: 0, maximum: 1 },
                                visible: { type: 'boolean' },
                              },
                              additionalProperties: false,
                            },
                          },
                        },
                        {
                          type: 'object',
                          required: ['type', 'id', 'changes'],
                          additionalProperties: false,
                          properties: {
                            type: { const: 'update' },
                            id: { type: 'string' },
                            changes: { type: 'object' },
                          },
                        },
                        {
                          type: 'object',
                          required: ['type', 'id'],
                          additionalProperties: false,
                          properties: {
                            type: { enum: ['remove', 'duplicate', 'unlink', 'updatePreset'] },
                            id: { type: 'string' },
                          },
                        },
                        {
                          type: 'object',
                          required: ['type', 'presetId'],
                          additionalProperties: false,
                          properties: {
                            type: { const: 'applyPreset' },
                            presetId: { type: 'string' },
                          },
                        },
                      ],
                    },
                  },
                },
              },
              {
                type: 'object',
                required: ['type'],
                additionalProperties: false,
                properties: { type: { enum: ['undo', 'redo', 'resetQuery', 'resetPage'] } },
              },
              {
                type: 'object',
                required: ['type'],
                additionalProperties: false,
                properties: {
                  type: { const: 'visibility' },
                  grids: { type: 'boolean' },
                  panel: { type: 'boolean' },
                },
              },
              {
                type: 'object',
                required: ['type', 'name', 'itemIds'],
                additionalProperties: false,
                properties: {
                  type: { const: 'savePreset' },
                  name: { type: 'string' },
                  itemIds: { type: 'array', items: { type: 'string' } },
                  presetId: {
                    type: 'string',
                    description: 'Optional file:ID to replace. Omit to create a new preset.',
                  },
                },
              },
              {
                type: 'object',
                required: ['type', 'presetId'],
                additionalProperties: false,
                properties: { type: { const: 'deletePreset' }, presetId: { type: 'string' } },
              },
            ],
          },
        },
      },
      annotations: { readOnlyHint: false, consequentialHint: true, debugging: true },
      execute: async (input, { signal: requestSignal }) => {
        if (requestSignal.aborted) throw new Error('Request canceled before execution.')
        const { action, expectedRevision } = input as { action: Action; expectedRevision?: number }
        return JSON.stringify(await api.execute(action, { expectedRevision }))
      },
    },
    { signal },
  )
}
