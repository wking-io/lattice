import { expect, test, type Page } from '@playwright/test'
import { readFile, rm, writeFile } from 'node:fs/promises'
import type { Action } from '../../src/browser/api.js'
const presetFile = new URL('../../playground/.lattice-test-presets.json', import.meta.url)
const read = (page: Page) => page.evaluate(() => window.lattice!.read())
const execute = (page: Page, action: Action) =>
  page.evaluate((action) => window.lattice!.execute(action), action)
const ready = async (page: Page) => {
  await page.waitForFunction(() => !!window.lattice)
  await expect(page.getByRole('region', { name: 'Lattice panel' })).toBeVisible()
}
test.beforeAll(async () => {
  await rm(presetFile, { force: true })
})
test.afterAll(async () => {
  await rm(presetFile, { force: true })
})
test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await ready(page)
})

test('agent batch, undo/redo, refresh, resizing, and navigation preserve intended state', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const height = (await read(page)).dimensions.height
  const result = await execute(page, {
    type: 'batch',
    operations: [
      { type: 'add', item: { kind: 'columns', count: 12, gutter: 20, margin: 20 } },
      { type: 'add', item: { kind: 'rows', count: 'auto', alignment: 'min', size: 8, gutter: 0 } },
      { type: 'add', item: { kind: 'individual', axis: 'vertical', unit: '%', position: 50 } },
    ],
  })
  expect(result.ok).toBe(true)
  expect(result.persisted).toBe(true)
  expect(result.context.items).toHaveLength(3)
  expect(result.context.history.undo).toBe(1)
  expect((await read(page)).dimensions.height).toBe(height)
  await execute(page, { type: 'undo' })
  expect((await read(page)).items).toHaveLength(0)
  await execute(page, { type: 'redo' })
  expect((await read(page)).items).toEqual(result.context.items)
  await page.setViewportSize({ width: 1000, height: 800 })
  await expect.poll(async () => (await read(page)).dimensions.width).toBe(1000)
  expect(
    (await read(page)).geometry.guides.find((g) => g.itemId === result.context.items[2]!.id)
      ?.position,
  ).toBe(500)
  await page.reload()
  await ready(page)
  expect((await read(page)).history).toEqual({ undo: 0, redo: 0 })
  expect((await read(page)).items).toEqual(result.context.items)
  await page.evaluate(() => history.pushState({}, '', '/next'))
  await expect.poll(async () => (await read(page)).items.length).toBe(0)
  await page.evaluate(() => history.back())
  await expect.poll(async () => (await read(page)).items.length).toBe(3)
  expect((await read(page)).history.undo).toBe(0)
  expect(errors).toEqual([])
})

test('hidden grids remain readable for layout alignment after refresh and resize', async ({
  page,
}) => {
  const added = await execute(page, {
    type: 'batch',
    operations: [
      { type: 'applyPreset', presetId: 'builtin:columns-12' },
      { type: 'add', item: { kind: 'individual', unit: '%', position: 50, visible: false } },
    ],
  })
  await execute(page, {
    type: 'batch',
    operations: [{ type: 'update', id: added.context.items[0]!.id, changes: { visible: false } }],
  })
  await expect(page.locator('.line, .guide')).toHaveCount(0)
  const configured = await read(page)
  expect(configured.geometry.grids[0]).toMatchObject({ count: 12, start: 24, visible: false })
  expect(configured.geometry.guides.at(-1)).toMatchObject({ position: 640, visible: false })
  await execute(page, { type: 'visibility', grids: false })
  const hidden = await read(page)
  expect(hidden.geometry).toEqual(configured.geometry)
  expect(hidden.items).toEqual(configured.items)
  expect(hidden.history).toEqual(configured.history)
  await expect(page.locator('.overlay, .panel')).toHaveCount(0)

  await page.reload()
  await page.waitForFunction(() => !!window.lattice)
  expect((await read(page)).items).toEqual(configured.items)
  await page.setViewportSize({ width: 1000, height: 800 })
  await expect.poll(async () => (await read(page)).dimensions.width).toBe(1000)
  const resized = await read(page)
  expect(resized.geometry.guides.at(-1)?.position).toBe(500)
  expect(resized.geometry.grids[0]?.size).toBe((1000 - 48 - 11 * 24) / 12)
  expect(resized.visibility).toEqual({ grids: false, panel: false })
  expect(resized.history).toEqual({ undo: 0, redo: 0 })
  await expect(page.locator('.overlay, .panel')).toHaveCount(0)
})

test('panel edits, pixel dragging, Alt duplication, and focus-owned keyboard undo', async ({
  page,
}) => {
  await page.getByRole('button', { name: '+ Guide', exact: true }).click()
  await page.getByRole('button', { name: 'Edit Guide', exact: true }).click()
  await page.getByRole('textbox', { name: 'Position', exact: true }).fill('500.25')
  await page.getByRole('textbox', { name: 'Position', exact: true }).press('Tab')
  await expect.poll(async () => (await read(page)).items[0]).toMatchObject({ position: 500.25 })
  const beforeHistory = (await read(page)).history.undo
  await page.mouse.move(502, 700)
  await page.mouse.down()
  await page.mouse.move(621.4, 700, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => (await read(page)).items[0]).toMatchObject({ position: 620 })
  expect((await read(page)).history.undo).toBe(beforeHistory + 1)
  await page.keyboard.down('Alt')
  await page.mouse.move(620, 700)
  await page.mouse.down()
  await page.mouse.move(700.6, 700, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up('Alt')
  await expect.poll(async () => (await read(page)).items.length).toBe(2)
  expect((await read(page)).items[1]).toMatchObject({ position: 701 })
  await page.keyboard.press('Meta+z')
  await expect.poll(async () => (await read(page)).items.length).toBe(1)
  await page.keyboard.press('Meta+Shift+z')
  await expect.poll(async () => (await read(page)).items.length).toBe(2)
  await page.getByRole('textbox', { name: 'Host input' }).fill('hello')
  const count = (await read(page)).history.undo
  await page.keyboard.press('Meta+z')
  expect((await read(page)).history.undo).toBe(count)
})

test('visibility shortcuts leave no launcher and Command-click passes through a guide', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Hide', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Lattice panel' })).toHaveCount(0)
  await page.keyboard.press('Alt+KeyG')
  await expect
    .poll(async () => (await read(page)).visibility)
    .toEqual({ grids: false, panel: false })
  await page.keyboard.press('Alt+KeyG')
  await expect
    .poll(async () => (await read(page)).visibility)
    .toEqual({ grids: true, panel: false })
  await page.keyboard.press('Alt+Shift+KeyG')
  await expect(page.getByRole('region', { name: 'Lattice panel' })).toBeVisible()
  await page.getByRole('button', { name: 'Host button', exact: true }).scrollIntoViewIfNeeded()
  const rect = await page.getByRole('button', { name: 'Host button', exact: true }).boundingBox()
  const x = rect!.x + rect!.width / 2,
    y = rect!.y + rect!.height / 2
  await execute(page, {
    type: 'batch',
    operations: [{ type: 'add', item: { kind: 'individual', position: x } }],
  })
  await execute(page, { type: 'visibility', panel: false })
  await expect(page.getByRole('region', { name: 'Lattice panel' })).toHaveCount(0)
  await expect(page.locator('.guide')).toHaveCount(1)
  await page.keyboard.down('Meta')
  await page.mouse.click(x, y)
  await page.keyboard.up('Meta')
  await expect(page.locator('#click-count')).toHaveText('1 clicks')
  expect((await read(page)).items).toHaveLength(1)
})

test('query changes fork only when an inherited grid is edited', async ({ page }) => {
  await execute(page, {
    type: 'batch',
    operations: [{ type: 'add', item: { kind: 'individual', position: 400 } }],
  })
  await page.evaluate(() => history.pushState({}, '', '/?view=alternate'))
  await expect.poll(async () => (await read(page)).scope.inherited).toBe(true)
  await execute(page, { type: 'visibility', grids: false })
  expect((await read(page)).scope.kind).toBe('base')
  const id = (await read(page)).items[0]!.id
  await execute(page, {
    type: 'batch',
    operations: [{ type: 'update', id, changes: { visible: false } }],
  })
  expect((await read(page)).scope.kind).toBe('query')
  await execute(page, { type: 'resetQuery' })
  expect((await read(page)).items[0]?.visible).toBe(true)
  expect((await read(page)).scope.inherited).toBe(true)
})

test('save selected items, undo grouping, manual catalog updates, and explicit preset refresh', async ({
  page,
}) => {
  await execute(page, {
    type: 'batch',
    operations: [
      { type: 'applyPreset', presetId: 'builtin:columns-12' },
      { type: 'add', item: { kind: 'individual', name: 'Keep separate', position: 700 } },
    ],
  })
  await page.getByRole('button', { name: 'Save preset…', exact: true }).click()
  await page.getByRole('textbox', { name: 'Preset name' }).fill('Browser test layout')
  await page.getByRole('checkbox', { name: 'Keep separate', exact: true }).uncheck()
  await page.getByRole('button', { name: 'Save to project', exact: true }).click()
  await expect
    .poll(async () =>
      (await read(page)).catalog.presets.some((p) => p.name === 'Browser test layout'),
    )
    .toBe(true)
  const state = await read(page),
    saved = state.items[0]!
  expect(saved).toMatchObject({ kind: 'preset', name: 'Browser test layout' })
  expect(state.items[1]?.name).toBe('Keep separate')
  const file = JSON.parse(await readFile(presetFile, 'utf8'))
  expect(file.presets[0].items).toHaveLength(1)
  expect(file.presets[0].items[0].kind).toBe('columns')
  await execute(page, { type: 'undo' })
  expect((await read(page)).items[0]?.name).toBe('12 columns')
  expect(JSON.parse(await readFile(presetFile, 'utf8')).presets).toHaveLength(1)
  await execute(page, { type: 'redo' })
  file.presets[0].items[0].count = 6
  await writeFile(presetFile, JSON.stringify(file, null, 2))
  await expect
    .poll(
      async () =>
        (await read(page)).catalog.presets.find((p) => p.name === 'Browser test layout')?.items[0],
    )
    .toMatchObject({ count: 6 })
  expect((await read(page)).items[0]).toMatchObject({ kind: 'preset', items: [{ count: 12 }] })
  await execute(page, { type: 'batch', operations: [{ type: 'updatePreset', id: saved.id }] })
  expect((await read(page)).items[0]).toMatchObject({ kind: 'preset', items: [{ count: 6 }] })
})

test('WebMCP adapter invokes the same operations and unregisters on disposal', async ({ page }) => {
  await page.addInitScript(() => {
    const tools = new Map<
      string,
      { execute(input: unknown, context: { signal: AbortSignal }): Promise<string> }
    >()
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: {
        registerTool(
          tool: {
            name: string
            execute(input: unknown, context: { signal: AbortSignal }): Promise<string>
          },
          options: { signal: AbortSignal },
        ) {
          tools.set(tool.name, tool)
          options.signal.addEventListener('abort', () => tools.delete(tool.name))
        },
      },
    })
    Object.assign(window, { testWebMCP: tools })
  })
  await page.reload()
  await ready(page)
  const result = await page.evaluate(async () => {
    const tools = (
      window as unknown as {
        testWebMCP: Map<
          string,
          { execute(input: unknown, context: { signal: AbortSignal }): Promise<string> }
        >
      }
    ).testWebMCP
    return JSON.parse(
      await tools.get('lattice_edit')!.execute(
        {
          action: {
            type: 'batch',
            operations: [
              { type: 'add', item: { kind: 'columns', count: 12, gutter: 20, margin: 20 } },
              {
                type: 'add',
                item: { kind: 'rows', alignment: 'min', count: 'auto', size: 8, gutter: 0 },
              },
            ],
          },
        },
        { signal: new AbortController().signal },
      ),
    )
  })
  expect(result.ok).toBe(true)
  expect(result.context.items).toHaveLength(2)
  await page.evaluate(() => window.lattice!.dispose())
  await expect(page.locator('lattice-overlay')).toHaveCount(0)
  expect(
    await page.evaluate(
      () => (window as unknown as { testWebMCP: Map<string, unknown> }).testWebMCP.size,
    ),
  ).toBe(0)
  expect(await page.evaluate(() => window.lattice)).toBeUndefined()
})

test('storage failures and invalid batches return honest errors without partial mutations', async ({
  page,
}) => {
  const failed = await execute(page, {
    type: 'batch',
    operations: [
      { type: 'add', item: { kind: 'individual' } },
      { type: 'remove', id: 'missing' },
    ],
  })
  expect(failed.ok).toBe(false)
  expect((await read(page)).items).toHaveLength(0)
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Full', 'QuotaExceededError')
    }
  })
  const unsaved = await execute(page, {
    type: 'batch',
    operations: [{ type: 'add', item: { kind: 'individual' } }],
  })
  expect(unsaved.ok).toBe(false)
  expect(unsaved.applied).toBe(true)
  expect(unsaved.persisted).toBe(false)
})

test('a delayed preset save cannot apply to a newly navigated page', async ({ page }) => {
  await execute(page, {
    type: 'batch',
    operations: [{ type: 'add', item: { kind: 'individual', position: 600 } }],
  })
  const id = (await read(page)).items[0]!.id
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let intercepted!: () => void
  const reached = new Promise<void>((resolve) => {
    intercepted = resolve
  })
  await page.route('**/__lattice/presets', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    intercepted()
    await gate
    await route.continue()
  })
  const saving = execute(page, { type: 'savePreset', name: 'Navigation race', itemIds: [id] })
  await reached
  await page.evaluate(() => history.pushState({}, '', '/new-page'))
  release()
  const result = await saving
  expect(result.saved).toBe(true)
  expect(result.applied).toBe(false)
  expect((await read(page)).items).toHaveLength(0)
  expect((await read(page)).catalog.presets.some((p) => p.name === 'Navigation race')).toBe(true)
})

test('concurrent agent edits serialize and dev endpoints reject unauthenticated writes', async ({
  page,
  request,
}) => {
  const results = await page.evaluate(() =>
    Promise.all([
      window.lattice!.batch([{ type: 'add', item: { kind: 'individual', position: 400 } }]),
      window.lattice!.batch([{ type: 'add', item: { kind: 'individual', position: 800 } }]),
    ]),
  )
  expect(results.every((r) => r.ok && r.persisted)).toBe(true)
  expect((await read(page)).items).toHaveLength(2)
  expect((await read(page)).history.undo).toBe(2)
  const response = await request.post('/__lattice/presets', {
    data: { type: 'delete', id: 'missing', expectedRevision: '' },
  })
  expect(response.status()).toBe(403)
  const malformed = await page.evaluate(() => window.lattice!.execute(null as never))
  expect(malformed.ok).toBe(false)
  expect((await read(page)).items).toHaveLength(2)
})
