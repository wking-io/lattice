import type { Plugin, ViteDevServer } from 'vite'
import { readFile } from 'node:fs/promises'
import { createHash, randomBytes } from 'node:crypto'
import { realpathSync } from 'node:fs'
import {
  PresetConflict,
  PresetRepository,
  type PresetMutation,
} from './server/preset-repository.js'
import { errorMessage, type PresetDefinition } from './domain.js'

export interface LatticeOptions {
  builtInPresets?: boolean
  presets?: readonly PresetDefinition[]
  presetsFile?: string
  /** Stable browser-storage identity. Defaults to a hash of the real project path. */
  projectId?: string
}
export function isLoopback(host: string): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '[::1]' ||
    /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(host)
  )
}
export function lattice(options: LatticeOptions = {}): Plugin {
  let server: ViteDevServer | undefined,
    repository: PresetRepository,
    base = '/',
    projectId = ''
  const token = randomBytes(32).toString('hex')
  return {
    name: 'lattice',
    apply: 'serve',
    configResolved(config) {
      base = config.base
      if (!base.startsWith('/')) throw new Error('Lattice requires a relative Vite base path.')
      projectId =
        options.projectId ??
        createHash('sha256').update(realpathSync(config.root)).digest('hex').slice(0, 16)
      repository = new PresetRepository(
        config.root,
        options.presetsFile,
        options.presets,
        options.builtInPresets,
      )
    },
    configureServer(devServer) {
      server = devServer
      const prefix = `${base}__lattice/`
      const changed = (file: string) => {
        if (file === repository.file)
          devServer.ws.send({ type: 'custom', event: 'lattice:catalog', data: {} })
      }
      devServer.watcher.add(repository.file)
      devServer.watcher.on('add', changed).on('change', changed).on('unlink', changed)
      devServer.httpServer?.once('close', () => {
        devServer.watcher.off('add', changed).off('change', changed).off('unlink', changed)
        server = undefined
      })
      devServer.middlewares.use(async (request, response, next) => {
        const pathname = (request.url ?? '').split('?')[0]!
        if (!pathname.startsWith(prefix)) return next()
        response.setHeader('Cache-Control', 'no-store')
        response.setHeader('X-Content-Type-Options', 'nosniff')
        try {
          const host = request.headers.host ?? ''
          if (!isLoopback(new URL(`http://${host}`).hostname))
            throw new Error('Lattice is available on loopback hosts only.')
          if (request.headers.origin && new URL(request.headers.origin).host !== host)
            throw new Error('Cross-origin Lattice access is disabled.')
          if (request.headers['sec-fetch-site'] === 'cross-site')
            throw new Error('Cross-site Lattice access is disabled.')
          if (pathname === `${prefix}client.licenses.txt` && request.method === 'GET') {
            response.setHeader('Content-Type', 'text/plain; charset=utf-8')
            response.end(await readFile(new URL('./client.licenses.txt', import.meta.url)))
            return
          }
          if (pathname === `${prefix}client.js` && request.method === 'GET') {
            response.setHeader('Content-Type', 'text/javascript')
            const encoding = clientEncoding(request.headers['accept-encoding'] ?? '')
            response.setHeader('Vary', 'Accept-Encoding')
            if (encoding) response.setHeader('Content-Encoding', encoding)
            response.end(
              await readFile(
                new URL(
                  `./client.js${encoding ? `.${encoding === 'gzip' ? 'gz' : 'br'}` : ''}`,
                  import.meta.url,
                ),
              ),
            )
            return
          }
          if (request.headers['x-lattice-token'] !== token) {
            response.statusCode = 403
            throw new Error('Invalid Lattice token.')
          }
          response.setHeader('Content-Type', 'application/json')
          if (pathname !== `${prefix}presets`) {
            response.statusCode = 404
            throw new Error('Unknown Lattice endpoint.')
          }
          if (request.method === 'GET') {
            response.end(JSON.stringify(await repository.catalog()))
            return
          }
          if (request.method !== 'POST') {
            response.statusCode = 405
            throw new Error('Method not allowed.')
          }
          if (!request.headers['content-type']?.startsWith('application/json'))
            throw new Error('JSON content type required.')
          let body = '',
            size = 0
          for await (const chunk of request) {
            size += Buffer.byteLength(chunk)
            if (size > 1024 * 1024) {
              response.statusCode = 413
              throw new Error('Request exceeds 1 MiB.')
            }
            body += chunk
          }
          const catalog = await repository.mutate(JSON.parse(body) as PresetMutation)
          response.end(JSON.stringify(catalog))
          devServer.ws.send({ type: 'custom', event: 'lattice:catalog', data: {} })
        } catch (error) {
          if (response.statusCode === 200)
            response.statusCode = error instanceof PresetConflict ? 409 : 400
          response.setHeader('Content-Type', 'application/json')
          response.end(JSON.stringify({ error: errorMessage(error) }))
        }
      })
    },
    transformIndexHtml() {
      if (!server) return
      const config = JSON.stringify({
        projectId,
        endpoint: `${base}__lattice/presets`,
        token,
      }).replaceAll('<', '\\u003c')
      return [
        {
          tag: 'script',
          attrs: { type: 'module' },
          injectTo: 'body',
          children: `import { start } from ${JSON.stringify(`${base}__lattice/client.js`)}; import { createHotContext } from ${JSON.stringify(`${base}@vite/client`)}; start(${config}, createHotContext(${JSON.stringify(`${base}__lattice/bootstrap`)}));`,
        },
      ]
    },
  }
}
export default lattice

export function clientEncoding(header: string): 'br' | 'gzip' | undefined {
  const weights = new Map(
    header
      .toLowerCase()
      .split(',')
      .map((entry) => {
        const [name, ...parameters] = entry.trim().split(';')
        const quality = parameters.find((value) => value.trim().startsWith('q='))
        return [name!, quality ? Number(quality.trim().slice(2)) : 1] as const
      }),
  )
  const quality = (name: string) => weights.get(name) ?? weights.get('*') ?? 0
  const br = quality('br'),
    gzip = quality('gzip')
  return br > 0 && br >= gzip ? 'br' : gzip > 0 ? 'gzip' : undefined
}
