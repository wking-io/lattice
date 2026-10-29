import type { Operation } from '../domain.js'
import type { LatticeContext } from '../state.js'
import type { SavedPage, SavedPageSummary } from '../storage.js'
import { decode } from '../domain.js'
import { toolInputs, type Action } from './actions.js'
import schemas from '../generated/tool-schemas.json'

export type { Action } from './actions.js'
export interface RequestOptions {
  expectedRevision?: number
  signal?: AbortSignal
  timeoutMs?: number
}
export interface OperationResult {
  ok: boolean
  context: LatticeContext
  applied?: boolean
  persisted?: boolean
  saved?: boolean
  presetId?: string
  canceled?: boolean
  uncertain?: boolean
  error?: string
}
export interface LatticeAPI {
  version: 1
  read(): Promise<LatticeContext>
  listSavedPages(): Promise<readonly SavedPageSummary[]>
  readSavedPage(url: string): Promise<SavedPage>
  execute(action: Action, options?: RequestOptions): Promise<OperationResult>
  batch(operations: readonly Operation[], options?: RequestOptions): Promise<OperationResult>
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
      inputSchema: object
      annotations: Record<string, boolean>
      execute(input: unknown, context: { signal: AbortSignal }): Promise<string>
    },
    options: { signal: AbortSignal },
  ): Promise<unknown> | unknown
}
export async function registerWebMCP(api: LatticeAPI, signal: AbortSignal): Promise<void> {
  const modelContext = (document as Document & { modelContext?: WebMCPContext }).modelContext
  if (!modelContext?.registerTool) return
  const descriptions = {
    lattice_read:
      'Read the page grid before designing or aligning its layout, even when hidden. Returns configured items, geometry, dimensions, history, and presets. If empty, use lattice_pages to find similar saved pages and ask whether to add their grid or a suitable common preset.',
    lattice_edit:
      'Edit local page grids. Read first. Batch operations are atomic and one undo step; preserve unrequested items. Only individual guides move freely. This changes browser state, not repository files.',
    lattice_presets:
      'Save or delete shared preset definitions in the project JSON file. Save groups selected page items after writing the file; undo restores the page but keeps the definition. Verify saved, applied, and persisted separately. Built-in and inline presets are read-only.',
    lattice_pages:
      'Discover saved page grids in this browser origin and project. Omit url to list paths and item counts; supply a URL to read its saved settings, including hidden items and query inheritance. These are stored settings, not live geometry. Use the target page read after applying a chosen grid.',
  }
  for (const name of Object.keys(toolInputs) as (keyof typeof toolInputs)[]) {
    await modelContext.registerTool(
      {
        name,
        description: descriptions[name],
        inputSchema: schemas[name],
        annotations: {
          readOnlyHint: name === 'lattice_read' || name === 'lattice_pages',
          consequentialHint: name === 'lattice_presets',
          debugging: true,
        },
        execute: async (input, { signal: requestSignal }) => {
          if (requestSignal.aborted) throw new Error('Request canceled before execution.')
          switch (name) {
            case 'lattice_read':
              decode(toolInputs.lattice_read, input)
              return JSON.stringify(await api.read())
            case 'lattice_pages': {
              const { url } = decode(toolInputs.lattice_pages, input)
              return JSON.stringify(
                url === undefined ? await api.listSavedPages() : await api.readSavedPage(url),
              )
            }
            case 'lattice_edit': {
              const { action, expectedRevision } = decode(toolInputs.lattice_edit, input)
              return JSON.stringify(
                await api.execute(action, { expectedRevision, signal: requestSignal }),
              )
            }
            case 'lattice_presets': {
              const { action, expectedRevision } = decode(toolInputs.lattice_presets, input)
              return JSON.stringify(
                await api.execute(action, { expectedRevision, signal: requestSignal }),
              )
            }
          }
        },
      },
      { signal },
    )
  }
}
