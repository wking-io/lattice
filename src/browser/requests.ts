import { Effect, Schema } from 'effect'
import { Command, Port } from 'foldkit'
import type { Return as UpdateReturn } from 'foldkit/update'
import { applySaved, batch, capturePreset, context, history } from '../state.js'
import { clone, errorMessage, uid, type Catalog } from '../domain.js'
import type { PageState } from '../storage.js'
import type { OperationResult, Request, Action } from './api.js'
import { message, type Model, type Message, type Event, type Job, type Services } from './model.js'
import { validateAction } from './actions.js'
const eventSchema = Schema.declare<Event>(
  (value): value is Event => !!value && typeof value === 'object' && 'type' in value,
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

export function requestUpdate(services: Services) {
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
  const answer = (
    model: Model,
    request: Request,
    extra: Partial<OperationResult> = {},
  ): Return => ({
    model,
    commands: [
      Reply({
        id: request.id,
        result: { ok: !extra.error, context: clone(context(model)), ...extra },
      }),
    ],
  })
  const finish = (
    model: Model,
    request: Request,
    extra: Partial<OperationResult> = {},
  ): Return => ({
    model: {
      ...model,
      busy: false,
      activeRequest: null,
      cancelRequested: false,
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
      if (services.isCanceled(request.id))
        return finish(model, request, {
          canceled: true,
          applied: false,
          uncertain: false,
          error: 'Request canceled before execution.',
        })
      if (request.scope !== model.page.identity || request.scope !== services.currentScope())
        throw new Error(
          'The page changed before the operation could run. Read the current page and retry.',
        )
      if (request.expectedRevision !== undefined && request.expectedRevision !== model.revision)
        throw new Error('Page revision changed. Read the current grid and retry.')
      const action = validateAction(request.action)
      model = { ...model, activeRequest: request, cancelRequested: false }
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
  return (
    model: Model,
    event: Extract<Event, { type: 'request' | 'drain' | 'io' | 'cancel' }>,
  ): Return => {
    switch (event.type) {
      case 'request': {
        if (services.isCanceled(event.request.id))
          return answer(model, event.request, {
            canceled: true,
            applied: false,
            uncertain: false,
            error: 'Request canceled before execution.',
          })
        if (event.request.action?.type === 'read') {
          try {
            validateAction(event.request.action)
            if (
              event.request.scope !== model.page.identity ||
              event.request.scope !== services.currentScope()
            )
              throw new Error('Page changed. Read the current page again.')
            if (
              event.request.expectedRevision !== undefined &&
              event.request.expectedRevision !== model.revision
            )
              throw new Error('Page revision changed. Read the current grid and retry.')
            return answer(model, event.request)
          } catch (error) {
            return answer(model, event.request, { error: errorMessage(error) })
          }
        }
        return model.busy || model.queue.length
          ? { model: { ...model, queue: [...model.queue, event.request] } }
          : run(model, event.request)
      }
      case 'cancel': {
        const queued = model.queue.find((request) => request.id === event.id)
        if (queued)
          return answer(
            { ...model, queue: model.queue.filter((request) => request.id !== event.id) },
            queued,
            {
              canceled: true,
              applied: false,
              uncertain: false,
              error: 'Queued request canceled before execution.',
            },
          )
        return model.activeRequest?.id === event.id
          ? { model: { ...model, cancelRequested: true } }
          : { model }
      }
      case 'drain': {
        if (model.busy || !model.queue.length) return { model }
        const [request, ...queue] = model.queue
        return run({ ...model, queue }, request!)
      }
      case 'io': {
        const { job } = event
        if (model.activeRequest?.id !== job.request.id) return { model }
        // Aborting fetch can deliver IO before the queued cancel message.
        const canceled = model.cancelRequested || services.isCanceled(job.request.id)
        if (event.error)
          return finish(model, job.request, {
            error: event.error,
            ...(canceled ? { canceled: true } : {}),
            ...(job.type === 'copy' ? { uncertain: true, applied: false } : {}),
            ...(job.type === 'preset'
              ? {
                  uncertain: true,
                  applied: false,
                  ...(job.mutation.type === 'save'
                    ? { presetId: `file:${job.mutation.preset.id}` }
                    : {}),
                }
              : {}),
            ...(job.type === 'persist'
              ? { applied: true, persisted: false, saved: job.saved, presetId: job.presetId }
              : {}),
          })
        if (job.type === 'preset') {
          const catalog = event.value as Catalog
          const next = { ...model, catalog }
          if (canceled)
            return finish(next, job.request, {
              canceled: true,
              saved: true,
              applied: false,
              uncertain: false,
              ...(job.mutation.type === 'save'
                ? { presetId: `file:${job.mutation.preset.id}` }
                : {}),
              error: 'Preset write completed before cancellation; page application was canceled.',
            })
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
    }
  }
}
