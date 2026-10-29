import { Schema } from 'effect'
import { Port, Runtime, Subscription } from 'foldkit'
import type { State } from '../state.js'
import { interaction } from './interactions.js'
import { requestUpdate, ports } from './requests.js'
import { message, uiRequest, type Model, type Message, type Services } from './model.js'
import { view } from './view.js'
const modelSchema = Schema.declare<Model>(
  (value): value is Model =>
    !!value && typeof value === 'object' && 'page' in value && 'revision' in value,
)
export function makeProgram(container: HTMLElement, initial: State, services: Services) {
  const requests = requestUpdate(services)
  const update = (model: Model, msg: Message) => {
    if (msg._tag === 'Done') return { model }
    const event = msg.event
    switch (event.type) {
      case 'request':
      case 'drain':
      case 'io':
      case 'cancel':
        return requests(model, event)
      default: {
        const next = interaction(model, event)
        if (!next.action) return next
        const request = uiRequest(next.model, next.action)
        return request._tag === 'Event' && request.event.type === 'request'
          ? requests(next.model, request.event)
          : { model: next.model }
      }
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
        activeRequest: null,
        cancelRequested: false,
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
