import { uid } from '../domain.js'
import type { Action, OperationResult, RequestOptions } from './api.js'
import type { Event } from './model.js'

/** Correlates requests, cancellation and replies without owning application state. */
export function createBridge(send: (event: Event) => void, currentScope: () => string) {
  let disposed = false
  const controllers = new Map<string, AbortController>()
  const pending = new Map<
    string,
    { resolve(value: OperationResult): void; reject(error: Error): void; cleanup(): void }
  >()
  const controller = (id: string) => {
    let value = controllers.get(id)
    if (!value) {
      value = new AbortController()
      controllers.set(id, value)
    }
    return value
  }
  return {
    signal: (id: string) => controller(id).signal,
    isCanceled: (id: string) => controllers.get(id)?.signal.aborted ?? false,
    accept({ id, result }: { id: string; result: OperationResult }) {
      const request = pending.get(id)
      if (request) {
        request.cleanup()
        request.resolve(result)
        pending.delete(id)
      }
      controllers.delete(id)
    },
    async execute(action: Action, options: RequestOptions = {}): Promise<OperationResult> {
      if (disposed) return Promise.reject(new Error('Lattice was disposed.'))
      const timeout = options.timeoutMs ?? 15000
      if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 2147483647)
        return Promise.reject(new Error('timeoutMs must be a positive finite timer duration.'))
      const id = uid()
      const cloned = structuredClone(action)
      const control = controller(id)
      return new Promise((resolve, reject) => {
        let grace: ReturnType<typeof setTimeout> | undefined
        const cancel = () => {
          if (control.signal.aborted) return
          control.abort()
          send({ type: 'cancel', id })
          // Normally the update loop acknowledges cancellation immediately. A stalled
          // runtime must still release the caller, without claiming a rollback.
          grace = setTimeout(() => {
            const request = pending.get(id)
            if (!request) return
            request.cleanup()
            pending.delete(id)
            reject(
              new Error(
                'Cancellation was requested but not acknowledged. The outcome is uncertain; inspect the page and preset catalog before retrying.',
              ),
            )
          }, 1000)
        }
        const timer = setTimeout(cancel, timeout)
        const cleanup = () => {
          clearTimeout(timer)
          if (grace) clearTimeout(grace)
          options.signal?.removeEventListener('abort', cancel)
        }
        pending.set(id, { resolve, reject, cleanup })
        options.signal?.addEventListener('abort', cancel, { once: true })
        if (options.signal?.aborted) cancel()
        send({
          type: 'request',
          request: {
            id,
            scope: currentScope(),
            action: cloned,
            expectedRevision: options.expectedRevision,
          },
        })
      })
    },
    dispose() {
      disposed = true
      for (const value of controllers.values()) value.abort()
      controllers.clear()
      for (const request of pending.values()) {
        request.cleanup()
        request.reject(
          new Error(
            'Lattice disposed before completion. A preset write may have reached the server; inspect the catalog before retrying.',
          ),
        )
      }
      pending.clear()
    },
  }
}
