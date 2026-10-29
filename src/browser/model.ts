import { uid, type Catalog, type Dimensions, type Individual, type Items } from '../domain.js'
import type { State } from '../state.js'
import type { PageState } from '../storage.js'
import type { Action, Request } from './api.js'
import type { PresetMutation } from '../server/preset-repository.js'

export interface Drag {
  item: Individual
  offset: number
  duplicate: boolean
  position: number
}
export interface Model extends State {
  selected: string | null
  checked: readonly string[]
  saveOpen: boolean
  saveName: string
  pickedPreset: string
  drafts: Readonly<Record<string, string>>
  error: string | null
  notice: string | null
  busy: boolean
  activeRequest: Request | null
  cancelRequested: boolean
  queue: readonly Request[]
  drag: Drag | null
  panelX: number
  panelY: number
}
export type Event =
  | { type: 'request'; request: Request }
  | { type: 'drain' }
  | { type: 'cancel'; id: string }
  | { type: 'io'; job: Job; value?: unknown; error?: string }
  | { type: 'measure'; dimensions: Dimensions }
  | { type: 'navigate'; page: PageState }
  | { type: 'catalog'; catalog: Catalog }
  | { type: 'select'; id: string }
  | { type: 'draft'; key: string; value: string }
  | { type: 'saveDialog'; open: boolean }
  | { type: 'saveName' | 'pickPreset'; value: string }
  | { type: 'check'; id: string }
  | { type: 'error'; error: string }
  | { type: 'dragStart'; id: string; coordinate: number; duplicate: boolean }
  | { type: 'dragMove'; coordinate: number }
  | { type: 'dragEnd' | 'dragCancel' }
  | { type: 'panelMove'; x: number; y: number }
export type Message = { readonly _tag: 'Event'; readonly event: Event } | { readonly _tag: 'Done' }
export const message = (event: Event): Message => ({ _tag: 'Event', event })
export type Job =
  | {
      type: 'persist'
      request: Request
      before: PageState
      after: PageState
      saved?: boolean
      presetId?: string
    }
  | { type: 'preferences'; request: Request; preferences: State['preferences'] }
  | {
      type: 'preset'
      request: Request
      mutation: PresetMutation
      revision: number
      page: PageState
    }
  | { type: 'reset'; request: Request; page: PageState; queryOnly: boolean }
  | { type: 'copy'; request: Request; text: string }
export interface Services {
  perform(job: Job): Promise<unknown>
  currentScope(): string
  isCanceled(id: string): boolean
}
export const uiRequest = (model: Model, action: Action): Message =>
  message({ type: 'request', request: { id: `ui-${uid()}`, scope: model.page.identity, action } })
export function displayedItems(model: Model): Items {
  if (!model.drag) return model.page.items
  const preview = { ...model.drag.item, position: model.drag.position }
  return model.drag.duplicate
    ? [...model.page.items, preview]
    : model.page.items.map((i) => (i.id === preview.id ? preview : i))
}
