import {
  applied,
  equal,
  flatten,
  transact,
  type Catalog,
  type Dimensions,
  type Items,
  type Operation,
  type PresetDefinition,
} from './domain.js'
import { resolve } from './geometry.js'
import { editedPage, type PageState, type Preferences } from './storage.js'

export interface State {
  page: PageState
  catalog: Catalog
  dimensions: Dimensions
  preferences: Preferences
  revision: number
  undo: readonly PageState[]
  redo: readonly PageState[]
}
export function edit(state: State, items: Items): State {
  if (state.page.loadError)
    throw new Error(
      'Stored page could not be loaded. Reset page storage explicitly before editing.',
    )
  if (equal(items, state.page.items)) return state
  return {
    ...state,
    page: editedPage(state.page, items),
    revision: state.revision + 1,
    undo: [...state.undo, state.page].slice(-100),
    redo: [],
  }
}
export function batch(state: State, operations: readonly Operation[]): State {
  return edit(state, transact(state.page.items, operations, state.catalog))
}
export function history(state: State, direction: 'undo' | 'redo'): State {
  const from = state[direction],
    previous = from.at(-1)
  if (!previous) return state
  const other = direction === 'undo' ? 'redo' : 'undo'
  return {
    ...state,
    page: previous,
    [direction]: from.slice(0, -1),
    [other]: [...state[other], state.page].slice(-100),
    revision: state.revision + 1,
  }
}
export function capturePreset(
  state: State,
  ids: readonly string[],
  name: string,
  id: string,
): PresetDefinition {
  if (!ids.length || new Set(ids).size !== ids.length)
    throw new Error('Select at least one item, without duplicate selections.')
  const selected = state.page.items.filter((i) => ids.includes(i.id))
  if (selected.length !== ids.length) throw new Error('One or more selected items are missing.')
  if (!name.trim() || name.trim().length > 120)
    throw new Error('Preset name must be between 1 and 120 characters.')
  return { id, name: name.trim(), items: flatten(selected) }
}
export function applySaved(
  state: State,
  catalog: Catalog,
  presetId: string,
  ids: readonly string[],
): State {
  const preset = catalog.presets.find((p) => p.id === presetId)
  if (!preset) throw new Error('Saved preset is missing from the catalog.')
  const first = state.page.items.findIndex((i) => ids.includes(i.id))
  const remaining = state.page.items.filter((i) => !ids.includes(i.id))
  remaining.splice(first, 0, applied(preset))
  return edit({ ...state, catalog }, remaining)
}
export function context(state: State) {
  const geometry = resolve(state.page.items, state.dimensions, {
    viewportOnly: true,
    includeHidden: true,
  })
  return {
    version: 1 as const,
    revision: state.revision,
    url: state.page.url,
    scope: {
      kind: state.page.override ? 'query' : 'base',
      key: state.page.override ? state.page.queryKey : state.page.baseKey,
      inherited: !!state.page.queryKey && !state.page.override && state.page.baseExists,
    },
    dimensions: state.dimensions,
    items: state.page.items,
    visibility: {
      grids: state.preferences.grids,
      panel: state.preferences.grids && state.preferences.panel,
    },
    history: { undo: state.undo.length, redo: state.redo.length },
    catalog: state.catalog,
    geometry: {
      ...geometry,
      includesHidden: true as const,
      guidesScope: 'viewport' as const,
      coordinates: 'CSS pixels; x from viewport left, y from document top',
    },
    ...(state.page.loadError ? { error: state.page.loadError } : {}),
  }
}
export type LatticeContext = ReturnType<typeof context>
