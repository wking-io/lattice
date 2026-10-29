import type { Dimensions, Items, Leaf } from './domain.js'

export interface Guide {
  itemId: string
  leafId: string
  axis: 'vertical' | 'horizontal'
  position: number
  color: string
  opacity: number
  draggable: boolean
}
export interface ResolvedGrid {
  itemId: string
  leafId: string
  axis: 'vertical' | 'horizontal'
  count: number
  start: number
  size: number
  gutter: number
  warning?: string
}
export function gridGeometry(item: Exclude<Leaf, { kind: 'individual' }>, length: number) {
  const available = item.alignment === 'center' ? length : length - item.offset
  const count =
    item.count === 'auto'
      ? Math.max(0, Math.floor((Math.max(0, available) + item.gutter) / (item.size + item.gutter)))
      : item.count
  if (!Number.isSafeInteger(count))
    return {
      count: 0,
      start: 0,
      size: item.size,
      gutter: item.gutter,
      warning: 'Grid density exceeds numeric precision.',
    }
  const size =
    item.alignment === 'stretch'
      ? (length - item.margin * 2 - item.gutter * (count - 1)) / count
      : item.size
  const total = count * size + (count - 1) * item.gutter
  const start =
    item.alignment === 'stretch'
      ? item.margin
      : item.alignment === 'center'
        ? (length - total) / 2
        : item.alignment === 'max'
          ? length - item.offset - total
          : item.offset
  return {
    count,
    start,
    size,
    gutter: item.gutter,
    ...(size < 0 ? { warning: 'Margins and gutters exceed available space.' } : {}),
  }
}
export function resolve(
  items: Items,
  dimensions: Dimensions,
  visibleOnly = false,
): { guides: Guide[]; grids: ResolvedGrid[]; truncated: boolean } {
  const guides: Guide[] = [],
    grids: ResolvedGrid[] = []
  let truncated = false
  for (const owner of items) {
    if (!owner.visible) continue
    for (const item of owner.kind === 'preset' ? owner.items : [owner]) {
      if (!item.visible) continue
      const axis =
        item.kind === 'individual' ? item.axis : item.kind === 'columns' ? 'vertical' : 'horizontal'
      const length = axis === 'vertical' ? dimensions.width : dimensions.height
      const min = visibleOnly && axis === 'horizontal' ? dimensions.scrollY - 8 : 0
      const max =
        visibleOnly && axis === 'horizontal'
          ? dimensions.scrollY + dimensions.viewportHeight + 8
          : length
      const seen = new Set<number>()
      const emit = (position: number) => {
        const key = Math.round(position * 1e6)
        if (position < min || position > max || !Number.isFinite(position) || seen.has(key)) return
        if (guides.length >= 5000) {
          truncated = true
          return
        }
        seen.add(key)
        guides.push({
          itemId: owner.id,
          leafId: item.id,
          axis,
          position,
          color: item.color,
          opacity: item.opacity,
          draggable: owner.kind === 'individual',
        })
      }
      if (item.kind === 'individual') {
        emit(item.unit === '%' ? (length * item.position) / 100 : item.position)
        continue
      }
      const geometry = gridGeometry(item, length)
      grids.push({ itemId: owner.id, leafId: item.id, axis, ...geometry })
      if (geometry.size < 0 || !geometry.count) continue
      const step = geometry.size + geometry.gutter
      if (step <= 0) {
        emit(geometry.start)
        continue
      }
      const first = Math.max(0, Math.floor((min - geometry.start - geometry.size) / step))
      const last = Math.min(geometry.count - 1, Math.ceil((max - geometry.start) / step))
      if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) {
        truncated = true
        continue
      }
      // Bound work as well as DOM size for extremely dense or malformed dimensions.
      for (let index = first; index <= last; index++) {
        if (guides.length >= 5000 || index - first >= 10000) {
          truncated = true
          break
        }
        const start = geometry.start + index * step
        emit(start)
        emit(start + geometry.size)
      }
    }
  }
  return { guides, grids, truncated }
}
