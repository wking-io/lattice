import { validateItems, type Items } from './domain.js'

export interface PageState {
  url: string
  identity: string
  baseKey: string
  queryKey: string | null
  override: boolean
  baseExists: boolean
  items: Items
  loadError?: string
}
export interface Preferences {
  grids: boolean
  panel: boolean
}
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}
export function scope(url: string, projectId: string) {
  const parsed = new URL(url)
  parsed.searchParams.sort()
  const baseKey = `lattice:v1:${projectId}:${parsed.origin}${parsed.pathname}`
  const queryKey = parsed.search ? `${baseKey}${parsed.search}` : null
  return { url, identity: queryKey ?? baseKey, baseKey, queryKey }
}
function parse(text: string): Items {
  const value = JSON.parse(text)
  if (value?.version !== 1 || Object.keys(value).some((k) => !['version', 'items'].includes(k)))
    throw new Error('Unsupported page storage format.')
  return validateItems(value.items)
}
export function loadPage(storage: StorageLike, url: string, projectId: string): PageState {
  const keys = scope(url, projectId)
  const base = storage.getItem(keys.baseKey)
  const query = keys.queryKey ? storage.getItem(keys.queryKey) : null
  return {
    ...keys,
    override: query !== null,
    baseExists: base !== null,
    items: query !== null ? parse(query) : base !== null ? parse(base) : [],
  }
}
export function editedPage(page: PageState, items: Items): PageState {
  return {
    ...page,
    items,
    override: page.override || (page.queryKey !== null && page.baseExists),
    baseExists: true,
  }
}
export function persistPage(storage: StorageLike, before: PageState, after: PageState): void {
  const text = JSON.stringify({ version: 1, items: after.items })
  if (after.override && after.queryKey) storage.setItem(after.queryKey, text)
  else if (before.override && after.queryKey) storage.removeItem(after.queryKey)
  else storage.setItem(after.baseKey, text)
}
export function preferenceKey(projectId: string) {
  return `lattice:v1:${projectId}:preferences`
}
export function loadPreferences(storage: StorageLike, projectId: string): Preferences {
  const value = storage.getItem(preferenceKey(projectId))
  if (value) {
    const parsed = JSON.parse(value)
    if (typeof parsed.grids === 'boolean' && typeof parsed.panel === 'boolean')
      return { grids: parsed.grids, panel: parsed.panel }
  }
  return { grids: true, panel: true }
}

export interface SavedPage {
  url: string
  kind: 'base' | 'query'
  inherited: boolean
  items: Items
  error?: string
}
export type SavedPageSummary = Omit<SavedPage, 'items' | 'inherited'> & { itemCount: number }
interface IndexedStorage extends StorageLike {
  readonly length: number
  key(index: number): string | null
}
export function readSavedPage(
  storage: StorageLike,
  url: string,
  currentUrl: string,
  projectId: string,
): SavedPage {
  const parsed = new URL(url, currentUrl)
  if (parsed.origin !== new URL(currentUrl).origin)
    throw new Error('Saved grids are limited to this origin and project.')
  parsed.hash = ''
  parsed.searchParams.sort()
  try {
    const page = loadPage(storage, parsed.href, projectId)
    return {
      url: parsed.href,
      kind: page.override ? 'query' : 'base',
      inherited: !!page.queryKey && !page.override && page.baseExists,
      items: page.items,
    }
  } catch (error) {
    return {
      url: parsed.href,
      kind: parsed.search ? 'query' : 'base',
      inherited: false,
      items: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
export function listSavedPages(
  storage: IndexedStorage,
  currentUrl: string,
  projectId: string,
): SavedPageSummary[] {
  const origin = new URL(currentUrl).origin
  const projectPrefix = `lattice:v1:${projectId}:`
  const prefix = `${projectPrefix}${origin}/`
  const pages: SavedPageSummary[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (!key?.startsWith(prefix)) continue
    const url = key.slice(projectPrefix.length)
    const page = readSavedPage(storage, url, currentUrl, projectId)
    pages.push({
      url: page.url,
      kind: page.kind,
      itemCount: page.items.length,
      ...(page.error ? { error: page.error } : {}),
    })
  }
  return pages.sort((a, b) => a.url.localeCompare(b.url))
}
