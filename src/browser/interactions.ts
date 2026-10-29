import { equal, uid, type Operation } from '../domain.js'
import type { Action } from './api.js'
import type { Event, Model } from './model.js'
export type Interaction = Exclude<Event, { type: 'request' | 'drain' | 'io' | 'cancel' }>
export function interaction(model: Model, event: Interaction): { model: Model; action?: Action } {
  switch (event.type) {
    case 'measure':
      return equal(model.dimensions, event.dimensions)
        ? { model }
        : { model: { ...model, dimensions: event.dimensions } }
    case 'navigate':
      return {
        model: {
          ...model,
          page: event.page,
          undo: [],
          redo: [],
          revision: model.revision + 1,
          drag: null,
          selected: null,
          drafts: {},
          saveOpen: false,
          error: event.page.loadError ?? null,
          notice: null,
        },
      }
    case 'catalog':
      return { model: { ...model, catalog: event.catalog } }
    case 'select':
      return { model: { ...model, selected: event.id, drafts: {} } }
    case 'draft':
      return { model: { ...model, drafts: { ...model.drafts, [event.key]: event.value } } }
    case 'saveDialog':
      return {
        model: {
          ...model,
          saveOpen: event.open,
          checked: model.page.items.map((i) => i.id),
          saveName: '',
        },
      }
    case 'saveName':
      return { model: { ...model, saveName: event.value } }
    case 'pickPreset':
      return { model: { ...model, pickedPreset: event.value } }
    case 'check':
      return {
        model: {
          ...model,
          checked: model.checked.includes(event.id)
            ? model.checked.filter((i) => i !== event.id)
            : [...model.checked, event.id],
        },
      }
    case 'error':
      return { model: { ...model, error: event.error } }
    case 'panelMove':
      return { model: { ...model, panelX: event.x, panelY: event.y } }
    case 'dragStart': {
      const item = model.page.items.find((i) => i.id === event.id)
      if (
        model.busy ||
        !model.preferences.grids ||
        !item ||
        item.kind !== 'individual' ||
        !item.visible
      )
        return { model }
      const dimension = item.axis === 'vertical' ? model.dimensions.width : model.dimensions.height
      const absolute = item.unit === '%' ? (item.position / 100) * dimension : item.position
      return {
        model: {
          ...model,
          selected: item.id,
          drag: {
            item: event.duplicate ? { ...item, id: uid() } : item,
            duplicate: event.duplicate,
            offset: event.coordinate - absolute,
            position: item.position,
          },
        },
      }
    }
    case 'dragMove': {
      if (!model.drag) return { model }
      const { item } = model.drag
      const dimension = item.axis === 'vertical' ? model.dimensions.width : model.dimensions.height
      const position =
        item.unit === 'px'
          ? Math.round(event.coordinate - model.drag.offset)
          : ((event.coordinate - model.drag.offset) / Math.max(dimension, 1)) * 100
      return { model: { ...model, drag: { ...model.drag, position } } }
    }
    case 'dragEnd': {
      if (!model.drag) return { model }
      const { item, duplicate, position } = model.drag
      const operations: Operation[] = duplicate
        ? [{ type: 'add', item: { ...item, position } }]
        : [{ type: 'update', id: item.id, changes: { position } }]
      return { model: { ...model, drag: null }, action: { type: 'batch', operations } }
    }
    case 'dragCancel':
      return { model: { ...model, drag: null } }
  }
}
