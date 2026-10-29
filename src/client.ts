import { Runtime } from 'foldkit'
import { errorMessage, uid, type Catalog, type Dimensions } from './domain.js'
import { context, type State } from './state.js'
import {
  loadPage,
  loadPreferences,
  persistPage,
  preferenceKey,
  scope,
  type PageState,
  type Preferences,
} from './storage.js'
import { makeProgram, type Event, type Job } from './browser/program.js'
import { registerWebMCP, type LatticeAPI, type OperationResult } from './browser/api.js'

interface ClientConfig {
  projectId: string
  endpoint: string
  token: string
}
interface HotContext {
  on(event: string, callback: () => void): void
  off(event: string, callback: () => void): void
  dispose(callback: () => void): void
}
let cancelStarting: (() => void) | undefined
export async function start(config: ClientConfig, hot?: HotContext): Promise<void> {
  if (
    window !== window.top ||
    !(
      location.hostname === 'localhost' ||
      location.hostname.endsWith('.localhost') ||
      location.hostname === '[::1]' ||
      /^127\./.test(location.hostname)
    )
  )
    return
  cancelStarting?.()
  window.lattice?.dispose()
  const lifetime = new AbortController(),
    toolLifetime = new AbortController()
  cancelStarting = () => lifetime.abort()
  hot?.dispose(() => lifetime.abort())
  let disposed = false
  const currentScope = () => scope(location.href, config.projectId).identity
  const readPage = (url = location.href): PageState => {
    try {
      return loadPage(localStorage, url, config.projectId)
    } catch (error) {
      return {
        ...scope(url, config.projectId),
        items: [],
        override: false,
        baseExists: false,
        loadError: errorMessage(error),
      }
    }
  }
  const measurements = (): Dimensions => ({
    width: document.documentElement.clientWidth,
    height: Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
      document.documentElement.clientHeight,
    ),
    viewportHeight: document.documentElement.clientHeight,
    scrollY: window.scrollY,
  })
  const fetchCatalog = async (mutation?: unknown): Promise<Catalog> => {
    const response = await fetch(config.endpoint, {
      method: mutation ? 'POST' : 'GET',
      credentials: 'same-origin',
      signal: lifetime.signal,
      headers: {
        'X-Lattice-Token': config.token,
        ...(mutation ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(mutation ? { body: JSON.stringify(mutation) } : {}),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error ?? `Preset request failed (${response.status}).`)
    return result as Catalog
  }
  let catalog: Catalog
  try {
    catalog = await fetchCatalog()
  } catch (error) {
    catalog = { revision: '', presets: [], error: errorMessage(error) }
  }
  if (lifetime.signal.aborted) return
  cancelStarting = undefined
  let preferences: Preferences = { grids: true, panel: true }
  try {
    preferences = loadPreferences(localStorage, config.projectId)
  } catch {
    /* Page persistence reports storage failures on edit. */
  }
  const initial: State = {
    page: readPage(),
    preferences,
    catalog,
    dimensions: measurements(),
    revision: 0,
    undo: [],
    redo: [],
  }
  const host = document.createElement('lattice-overlay')
  host.setAttribute('data-lattice', '')
  const shadow = host.attachShadow({ mode: 'open' }),
    container = document.createElement('div')
  container.id = `lattice-${uid()}`
  shadow.append(container)
  document.body.append(host)
  const perform = async (job: Job): Promise<unknown> => {
    switch (job.type) {
      case 'persist':
        persistPage(localStorage, job.before, job.after)
        return undefined
      case 'preferences':
        localStorage.setItem(preferenceKey(config.projectId), JSON.stringify(job.preferences))
        return undefined
      case 'preset':
        return fetchCatalog(job.mutation)
      case 'copy':
        return navigator.clipboard.writeText(job.text)
      case 'reset': {
        if (job.queryOnly && job.page.queryKey) localStorage.removeItem(job.page.queryKey)
        else {
          localStorage.removeItem(
            job.page.override && job.page.queryKey ? job.page.queryKey : job.page.baseKey,
          )
          // An unreadable query record may not have been decoded enough to set override.
          if (job.page.loadError && job.page.queryKey) localStorage.removeItem(job.page.queryKey)
        }
        return readPage(job.page.url)
      }
    }
  }
  const handle = Runtime.embed(makeProgram(container, initial, { perform, currentScope }))
  const send = (event: Event) => {
    if (!disposed) handle.ports.event.send(event)
  }
  const pending = new Map<
    string,
    {
      resolve(result: OperationResult): void
      reject(error: Error): void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  const unsubscribe = handle.ports.result.subscribe(({ id, result }) => {
    const request = pending.get(id)
    if (request) {
      clearTimeout(request.timer)
      request.resolve(result)
    }
    pending.delete(id)
  })
  const api: LatticeAPI = {
    version: 1,
    read: async () => {
      const result = await api.execute({ type: 'read' })
      if (!result.ok) throw new Error(result.error)
      return result.context
    },
    execute(action, options = {}) {
      if (disposed) return Promise.reject(new Error('Lattice was disposed.'))
      const id = uid()
      return new Promise((resolve, reject) => {
        const clonedAction = structuredClone(action)
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(
            new Error(
              'Lattice did not acknowledge the request within 15 seconds. Its outcome is uncertain; inspect the page and preset file before retrying.',
            ),
          )
        }, 15000)
        pending.set(id, { resolve, reject, timer })
        send({
          type: 'request',
          request: {
            id,
            scope: currentScope(),
            action: clonedAction,
            expectedRevision: options.expectedRevision,
          },
        })
      })
    },
    batch: (operations, options) => api.execute({ type: 'batch', operations }, options),
    dispose: () => cleanup(),
  }
  window.lattice = api
  const execute = (action: Parameters<LatticeAPI['execute']>[0]) => {
    void api.execute(action).catch((error) => {
      if (!disposed) send({ type: 'error', error: errorMessage(error) })
    })
  }

  let frame = 0,
    knownScope = initial.page.identity
  const navigate = () => {
    if (currentScope() === knownScope) return
    knownScope = currentScope()
    send({ type: 'navigate', page: readPage() })
    measure()
  }
  const measure = () => {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0
        send({ type: 'measure', dimensions: measurements() })
      })
  }
  const resizeObserver = new ResizeObserver(measure)
  resizeObserver.observe(document.documentElement)
  resizeObserver.observe(document.body)
  const mutationObserver = new MutationObserver(measure)
  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  })
  window.addEventListener('resize', measure, { signal: lifetime.signal })
  window.addEventListener('scroll', measure, { signal: lifetime.signal, passive: true })
  window.addEventListener('popstate', navigate, { signal: lifetime.signal })
  const originalPush = history.pushState,
    originalReplace = history.replaceState
  const push: History['pushState'] = function (...args) {
    originalPush.apply(history, args)
    navigate()
  }
  const replace: History['replaceState'] = function (...args) {
    originalReplace.apply(history, args)
    navigate()
  }
  history.pushState = push
  history.replaceState = replace
  const navigationTimer = setInterval(navigate, 250)
  let catalogGeneration = 0
  const reloadCatalog = () => {
    const generation = ++catalogGeneration
    void fetchCatalog().then(
      (next) => {
        if (generation === catalogGeneration) {
          catalog = next
          send({ type: 'catalog', catalog })
        }
      },
      (error) => {
        if (generation === catalogGeneration && !disposed)
          send({ type: 'catalog', catalog: { ...catalog, error: errorMessage(error) } })
      },
    )
  }
  hot?.on('lattice:catalog', reloadCatalog)
  hot?.dispose(() => api.dispose())

  let pointer: { id: number; axis: string } | null = null
  let panelDrag: { id: number; x: number; y: number } | null = null
  shadow.addEventListener(
    'pointerdown',
    ((event: PointerEvent) => {
      if (event.button !== 0) return
      const path = event.composedPath(),
        target = path.find(
          (node) => node instanceof HTMLElement && node.hasAttribute('data-guide'),
        ) as HTMLElement | undefined
      if (target && !event.metaKey && !event.ctrlKey) {
        event.preventDefault()
        event.stopPropagation()
        target.focus()
        pointer = { id: event.pointerId, axis: target.dataset.axis! }
        send({
          type: 'dragStart',
          id: target.dataset.guide!,
          coordinate: pointer.axis === 'vertical' ? event.clientX : event.clientY + window.scrollY,
          duplicate: event.altKey,
        })
        return
      }
      if (
        !path.some((node) => node instanceof HTMLButtonElement) &&
        path.some((node) => node instanceof HTMLElement && node.hasAttribute('data-panel-drag'))
      ) {
        const rect = shadow.querySelector('.panel')!.getBoundingClientRect()
        panelDrag = {
          id: event.pointerId,
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        }
        event.preventDefault()
      }
    }) as EventListener,
    { signal: lifetime.signal },
  )
  window.addEventListener(
    'pointermove',
    (event) => {
      if (pointer?.id === event.pointerId) {
        event.preventDefault()
        send({
          type: 'dragMove',
          coordinate: pointer.axis === 'vertical' ? event.clientX : event.clientY + window.scrollY,
        })
      }
      if (panelDrag?.id === event.pointerId)
        send({ type: 'panelMove', x: event.clientX - panelDrag.x, y: event.clientY - panelDrag.y })
    },
    { signal: lifetime.signal, capture: true, passive: false },
  )
  window.addEventListener(
    'pointerup',
    (event) => {
      if (pointer?.id === event.pointerId) {
        send({ type: 'dragEnd' })
        pointer = null
      }
      if (panelDrag?.id === event.pointerId) panelDrag = null
    },
    { signal: lifetime.signal, capture: true },
  )
  const cancelDrag = () => {
    pointer = null
    panelDrag = null
    host.removeAttribute('data-bypass')
    send({ type: 'dragCancel' })
  }
  window.addEventListener('pointercancel', cancelDrag, { signal: lifetime.signal })
  window.addEventListener('blur', cancelDrag, { signal: lifetime.signal })
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.metaKey || event.ctrlKey) host.setAttribute('data-bypass', '')
      const target = event.composedPath()[0]
      const typing =
        target instanceof HTMLElement &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
      if (event.code === 'Escape' && (pointer || panelDrag)) {
        cancelDrag()
        return
      }
      if (typing || event.repeat) return
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyG') {
        event.preventDefault()
        void api
          .read()
          .then((state) =>
            execute(
              event.shiftKey
                ? { type: 'visibility', panel: !state.visibility.panel }
                : { type: 'visibility', grids: !state.visibility.grids },
            ),
          )
        return
      }
      const ownFocus = event.composedPath().includes(host)
      if (
        ownFocus &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        (event.code === 'KeyZ' || (event.ctrlKey && event.code === 'KeyY'))
      ) {
        event.preventDefault()
        event.stopPropagation()
        execute({ type: event.shiftKey || event.code === 'KeyY' ? 'redo' : 'undo' })
      }
      if (
        target instanceof HTMLElement &&
        target.dataset.guide &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Delete', 'Backspace'].includes(
          event.code,
        )
      ) {
        event.preventDefault()
        const id = target.dataset.guide
        if (event.code === 'Delete' || event.code === 'Backspace')
          execute({ type: 'batch', operations: [{ type: 'remove', id }] })
        else
          void api.read().then((state) => {
            const item = state.items.find((i) => i.id === id)
            if (item?.kind !== 'individual') return
            const delta =
              (event.code === 'ArrowLeft' || event.code === 'ArrowUp' ? -1 : 1) *
              (event.shiftKey ? 10 : 1)
            execute({
              type: 'batch',
              operations: [{ type: 'update', id, changes: { position: item.position + delta } }],
            })
          })
      }
    },
    { signal: lifetime.signal, capture: true },
  )
  window.addEventListener(
    'keyup',
    (event) => {
      if (!event.metaKey && !event.ctrlKey) host.removeAttribute('data-bypass')
    },
    { signal: lifetime.signal },
  )
  void registerWebMCP(api, toolLifetime.signal).catch((error) => {
    toolLifetime.abort()
    if (!disposed)
      send({
        type: 'error',
        error: `WebMCP unavailable; window.lattice is ready. ${errorMessage(error)}`,
      })
  })
  function cleanup() {
    if (disposed) return
    disposed = true
    lifetime.abort()
    toolLifetime.abort()
    resizeObserver.disconnect()
    mutationObserver.disconnect()
    clearInterval(navigationTimer)
    cancelAnimationFrame(frame)
    if (history.pushState === push) history.pushState = originalPush
    if (history.replaceState === replace) history.replaceState = originalReplace
    hot?.off('lattice:catalog', reloadCatalog)
    unsubscribe()
    handle.dispose()
    host.remove()
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(
        new Error(
          'Lattice disposed before the request completed. A pending preset save may have reached the server; check the catalog before retrying.',
        ),
      )
    }
    pending.clear()
    if (window.lattice === api) delete window.lattice
  }
  // Ensure the port subscription is ready before advertising initial state to callers.
  await api.read()
}
