import { Effect, Schema } from 'effect'
import { Command, Port, Runtime, Subscription } from 'foldkit'
import type { Return as UpdateReturn } from 'foldkit/update'
import { applySaved, batch, capturePreset, context, edit, history, type State } from '../state.js'
import {
  clone,
  equal,
  errorMessage,
  uid,
  type Catalog,
  type Dimensions,
  type Individual,
  type Items,
  type Operation,
} from '../domain.js'
import { type PageState } from '../storage.js'
import type { Action, OperationResult, Request } from './api.js'
import type { PresetMutation } from '../server/preset-repository.js'
import { view } from './view.js'
import { validateAction } from './actions.js'

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
  queue: readonly Request[]
  drag: Drag | null
  panelX: number
  panelY: number
}
export type Event =
  | { type: 'request'; request: Request }
  | { type: 'drain' }
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
const eventSchema = Schema.declare<Event>(
  (value): value is Event => !!value && typeof value === 'object' && 'type' in value,
)
const modelSchema = Schema.declare<Model>(
  (value): value is Model =>
    !!value && typeof value === 'object' && 'page' in value && 'revision' in value,
)
export const ports = {
  inbound: { event: Port.inbound(eventSchema) },
  outbound: {
    result: Port.outbound(
      Schema.declare<{ id: string; result: OperationResult }>(
        (v): v is { id: string; result: OperationResult } =>
          !!v && typeof v === 'object' && 'id' in v,
      ),
    ),
  },
}
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
}
const jobSchema = Schema.declare<Job>(
  (value): value is Job => !!value && typeof value === 'object' && 'request' in value,
)
const doneSchema = Schema.TaggedStruct('Done', {})
const messageSchema = Schema.TaggedStruct('Event', { event: eventSchema })
const Reply = Command.define('Reply', {
  args: {
    id: Schema.String,
    result: Schema.declare<OperationResult>(
      (v): v is OperationResult => !!v && typeof v === 'object' && 'ok' in v,
    ),
  },
  messages: [doneSchema],
  execute: ({ id, result }) =>
    Effect.as(Port.emit(ports.outbound.result, { id, result }), { _tag: 'Done' as const }),
})
const Drain = Command.define('Drain', {
  messages: [messageSchema],
  execute: Effect.succeed(message({ type: 'drain' }) as Extract<Message, { _tag: 'Event' }>),
})

export const uiRequest = (model: Model, action: Action): Message =>
  message({ type: 'request', request: { id: `ui-${uid()}`, scope: model.page.identity, action } })
export function displayedItems(model: Model): Items {
  if (!model.drag) return model.page.items
  const preview = { ...model.drag.item, position: model.drag.position }
  return model.drag.duplicate
    ? [...model.page.items, preview]
    : model.page.items.map((i) => (i.id === preview.id ? preview : i))
}
export function makeProgram(container: HTMLElement, initial: State, services: Services) {
  const Perform = Command.define('Perform', {
    args: { job: jobSchema },
    messages: [messageSchema],
    execute: ({ job }) =>
      Effect.tryPromise({ try: () => services.perform(job), catch: errorMessage }).pipe(
        Effect.match({
          onSuccess: (value) =>
            message({ type: 'io', job, value }) as Extract<Message, { _tag: 'Event' }>,
          onFailure: (error) =>
            message({ type: 'io', job, error }) as Extract<Message, { _tag: 'Event' }>,
        }),
      ),
  })
  type Return = UpdateReturn<Model, Message>
  const finish = (
    model: Model,
    request: Request,
    extra: Partial<OperationResult> = {},
  ): Return => ({
    model: {
      ...model,
      busy: false,
      error: extra.error ?? (request.action?.type === 'read' ? model.error : null),
    },
    commands: [
      Reply({
        id: request.id,
        result: { ok: !extra.error, context: clone(context(model)), ...extra },
      }),
      Drain(),
    ],
  })
  const persist = (
    before: Model,
    after: Model,
    request: Request,
    extra: { saved?: boolean; presetId?: string } = {},
  ): Return => {
    if (before.page === after.page) return finish(after, request, { applied: false, ...extra })
    return {
      model: { ...after, busy: true, drag: null, drafts: {}, error: null },
      commands: [
        Perform({
          job: { type: 'persist', request, before: before.page, after: after.page, ...extra },
        }),
      ],
    }
  }
  const run = (model: Model, request: Request): Return => {
    try {
      if (request.scope !== model.page.identity || request.scope !== services.currentScope())
        throw new Error(
          'The page changed before the operation could run. Read the current page and retry.',
        )
      if (request.expectedRevision !== undefined && request.expectedRevision !== model.revision)
        throw new Error('Page revision changed. Read the current grid and retry.')
      const action = validateAction(request.action)
      switch (action.type) {
        case 'read':
          return finish(model, request)
        case 'batch':
          return persist(model, { ...model, ...batch(model, action.operations) }, request)
        case 'undo':
        case 'redo':
          return persist(model, { ...model, ...history(model, action.type) }, request)
        case 'visibility': {
          if (
            (action.grids !== undefined && typeof action.grids !== 'boolean') ||
            (action.panel !== undefined && typeof action.panel !== 'boolean')
          )
            throw new Error('Visibility values must be booleans.')
          const preferences = {
            grids: action.grids ?? (action.panel === true ? true : model.preferences.grids),
            panel: action.panel ?? model.preferences.panel,
          }
          return {
            model: { ...model, preferences, busy: true, drag: null },
            commands: [Perform({ job: { type: 'preferences', request, preferences } })],
          }
        }
        case 'savePreset': {
          if (model.catalog.error) throw new Error(model.catalog.error)
          if (
            action.presetId &&
            !model.catalog.presets.some((p) => p.id === action.presetId && p.writable)
          )
            throw new Error(
              'Only existing file presets may be replaced; omit presetId to create one.',
            )
          const preset = capturePreset(
            model,
            action.itemIds,
            action.name,
            action.presetId?.slice(5) ?? uid(),
          )
          return {
            model: { ...model, busy: true, drag: null },
            commands: [
              Perform({
                job: {
                  type: 'preset',
                  request,
                  mutation: { type: 'save', preset, expectedRevision: model.catalog.revision },
                  revision: model.revision,
                  page: model.page,
                },
              }),
            ],
          }
        }
        case 'deletePreset': {
          if (!model.catalog.presets.some((p) => p.id === action.presetId && p.writable))
            throw new Error('Only file presets can be deleted.')
          return {
            model: { ...model, busy: true },
            commands: [
              Perform({
                job: {
                  type: 'preset',
                  request,
                  mutation: {
                    type: 'delete',
                    id: action.presetId.slice(5),
                    expectedRevision: model.catalog.revision,
                  },
                  revision: model.revision,
                  page: model.page,
                },
              }),
            ],
          }
        }
        case 'resetQuery':
        case 'resetPage':
          if (action.type === 'resetQuery' && !model.page.override)
            return finish(model, request, { applied: false })
          return {
            model: { ...model, busy: true, drag: null },
            commands: [
              Perform({
                job: {
                  type: 'reset',
                  request,
                  page: model.page,
                  queryOnly: action.type === 'resetQuery',
                },
              }),
            ],
          }
        case 'copyContext':
          return {
            model: { ...model, busy: true },
            commands: [
              Perform({
                job: { type: 'copy', request, text: JSON.stringify(context(model), null, 2) },
              }),
            ],
          }
        default:
          throw new Error('Unknown Lattice action.')
      }
    } catch (error) {
      return finish({ ...model, drag: null }, request, {
        error: errorMessage(error),
        applied: false,
      })
    }
  }
  const update = (model: Model, msg: Message): Return => {
    if (msg._tag === 'Done') return { model }
    const event = msg.event
    switch (event.type) {
      case 'request':
        return model.busy || model.queue.length
          ? { model: { ...model, queue: [...model.queue, event.request] } }
          : run(model, event.request)
      case 'drain': {
        if (model.busy || !model.queue.length) return { model }
        const [request, ...queue] = model.queue
        return run({ ...model, queue }, request!)
      }
      case 'io': {
        const { job } = event
        if (event.error)
          return finish(model, job.request, {
            error: event.error,
            ...(job.type === 'persist'
              ? { applied: true, persisted: false, saved: job.saved, presetId: job.presetId }
              : {}),
          })
        if (job.type === 'preset') {
          const catalog = event.value as Catalog
          const next = { ...model, catalog }
          if (job.mutation.type === 'delete') return finish(next, job.request, { saved: true })
          const presetId = `file:${job.mutation.preset.id}`
          if (
            job.page.identity !== model.page.identity ||
            job.page.identity !== services.currentScope() ||
            job.revision !== model.revision
          )
            return finish(next, job.request, {
              saved: true,
              applied: false,
              presetId,
              error: 'Preset saved, but page changed. Apply it from the catalog when ready.',
            })
          const action = job.request.action as Extract<Action, { type: 'savePreset' }>
          const after = {
            ...next,
            ...applySaved(next, catalog, presetId, action.itemIds),
            saveOpen: false,
            notice: 'Preset saved to the project file.',
          }
          return persist(next, after, job.request, { saved: true, presetId })
        }
        if (job.type === 'reset') {
          const current = job.page.identity === model.page.identity
          return finish(
            current
              ? {
                  ...model,
                  page: event.value as PageState,
                  undo: [],
                  redo: [],
                  revision: model.revision + 1,
                  drafts: {},
                  selected: null,
                }
              : model,
            job.request,
            { persisted: true, applied: current },
          )
        }
        if (job.type === 'copy')
          return finish({ ...model, notice: 'Grid context copied.' }, job.request)
        return finish(model, job.request, {
          applied: true,
          persisted: true,
          ...(job.type === 'persist' ? { saved: job.saved, presetId: job.presetId } : {}),
        })
      }
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
        const dimension =
          item.axis === 'vertical' ? model.dimensions.width : model.dimensions.height
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
        const dimension =
          item.axis === 'vertical' ? model.dimensions.width : model.dimensions.height
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
        return run(
          { ...model, drag: null },
          { id: `ui-${uid()}`, scope: model.page.identity, action: { type: 'batch', operations } },
        )
      }
      case 'dragCancel':
        return { model: { ...model, drag: null } }
    }
  }
  return Runtime.makeElement({
    Model: modelSchema,
    container,
    ports,
    devTools: false,
    update,
    view,
    init: () => ({
      model: {
        ...initial,
        selected: null,
        checked: [],
        saveOpen: false,
        saveName: '',
        pickedPreset: '',
        drafts: {},
        error: initial.page.loadError ?? null,
        notice: null,
        busy: false,
        queue: [],
        drag: null,
        panelX: 16,
        panelY: 16,
      },
    }),
    subscriptions: Subscription.make<Model, Message>()(() => ({
      events: Port.subscriptionEntry(ports.inbound.event, message),
    })),
  })
}
