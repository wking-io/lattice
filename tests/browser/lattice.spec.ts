import { chromium, expect, test, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
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
  await page.mouse.move(622, 700, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => (await read(page)).items[0]).toMatchObject({ position: 620 })
  expect((await read(page)).history.undo).toBe(beforeHistory + 1)
  await page.keyboard.down('Alt')
  await page.mouse.move(620, 700)
  await page.mouse.down()
  await page.mouse.move(701, 700, { steps: 5 })
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

test('reads bypass a pending save and canceled queued edits never run', async ({ page }) => {
  await execute(page, { type: 'batch', operations: [{ type: 'add', item: { kind: 'columns' } }] })
  const id = (await read(page)).items[0]!.id
  let release!: () => void
  let entered!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const intercepted = new Promise<void>((resolve) => {
    entered = resolve
  })
  await page.route('**/__lattice/presets', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    entered()
    await blocked
    await route.continue()
  })
  const saving = execute(page, { type: 'savePreset', name: 'Queue test', itemIds: [id] })
  await intercepted
  const during = await page.evaluate(async () =>
    Promise.race([
      window.lattice!.read(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Read blocked behind save')), 500),
      ),
    ]),
  )
  expect(during.items[0]!.id).toBe(id)
  const canceled = await page.evaluate(async () => {
    const controller = new AbortController()
    const pending = window.lattice!.batch(
      [{ type: 'add', item: { kind: 'individual', name: 'Must not exist' } }],
      { signal: controller.signal },
    )
    await window.lattice!.read() // Flushes the preceding request into the queue.
    controller.abort()
    return pending
  })
  expect(canceled).toMatchObject({ ok: false, canceled: true, applied: false, uncertain: false })
  const expired = await page.evaluate(() =>
    window.lattice!.batch([{ type: 'add', item: { kind: 'rows' } }], { timeoutMs: 50 }),
  )
  expect(expired).toMatchObject({ canceled: true, applied: false, uncertain: false })
  release()
  expect((await saving).saved).toBe(true)
  expect((await read(page)).items).toHaveLength(1)
})

test('a lost preset response releases the queue and reports uncertainty', async ({ page }) => {
  await execute(page, { type: 'batch', operations: [{ type: 'add', item: { kind: 'columns' } }] })
  await page.route('**/__lattice/presets', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    // A response may be lost after the server accepted a write.
    await route.fetch()
    await route.abort('failed')
  })
  const result = await page.evaluate(async () => {
    const context = await window.lattice!.read()
    return window.lattice!.execute(
      { type: 'savePreset', name: 'Lost response', itemIds: [context.items[0]!.id] },
      { timeoutMs: 500 },
    )
  })
  expect(result).toMatchObject({ ok: false, applied: false, uncertain: true })
  expect(result.presetId).toMatch(/^file:/)
  await page.unroute('**/__lattice/presets')
  expect(
    (
      await execute(page, {
        type: 'batch',
        operations: [{ type: 'add', item: { kind: 'individual' } }],
      })
    ).ok,
  ).toBe(true)
  expect((await read(page)).items).toHaveLength(2)
})

test('aborting an active preset request cancels its fetch and releases queued work', async ({
  page,
}) => {
  await execute(page, { type: 'batch', operations: [{ type: 'add', item: { kind: 'columns' } }] })
  let entered!: () => void
  let release!: () => void
  const intercepted = new Promise<void>((resolve) => {
    entered = resolve
  })
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/__lattice/presets', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    entered()
    await blocked
    // WebKit may already have released the route when fetch is aborted.
    await route.abort().catch(() => {})
  })
  // Keep the controller in the page so the abort happens after fetch starts.
  const saving = page.evaluate(async () => {
    const controller = new AbortController()
    Object.assign(window, { abortLatticeSave: () => controller.abort() })
    const context = await window.lattice!.read()
    return window.lattice!.execute(
      { type: 'savePreset', name: 'Canceled active write', itemIds: [context.items[0]!.id] },
      { signal: controller.signal },
    )
  })
  await intercepted
  const queued = execute(page, {
    type: 'batch',
    operations: [{ type: 'add', item: { kind: 'individual' } }],
  })
  await page.evaluate(() => (window as unknown as { abortLatticeSave(): void }).abortLatticeSave())
  const result = await saving
  expect(result).toMatchObject({ ok: false, canceled: true, applied: false, uncertain: true })
  expect(result.presetId).toMatch(/^file:/)
  expect((await queued).ok).toBe(true)
  release()
  await page.unroute('**/__lattice/presets')
  expect((await read(page)).items).toHaveLength(2)
})

test('pre-aborted requests and stale reads fail without editing the page', async ({ page }) => {
  const canceled = await page.evaluate(() =>
    window.lattice!.batch([{ type: 'add', item: { kind: 'rows' } }], {
      signal: AbortSignal.abort(),
    }),
  )
  expect(canceled).toMatchObject({ ok: false, canceled: true, applied: false, uncertain: false })
  expect((await read(page)).items).toEqual([])
  const stale = await page.evaluate(() =>
    window.lattice!.execute({ type: 'read' }, { expectedRevision: 999 }),
  )
  expect(stale.error).toContain('revision changed')
})

test('a stalled clipboard request cannot keep later edits blocked after cancellation', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => new Promise<void>(() => {}) },
    })
    const copying = window.lattice!.execute({ type: 'copyContext' }, { timeoutMs: 50 })
    const queued = window.lattice!.batch([{ type: 'add', item: { kind: 'individual' } }])
    return { copying: await copying, queued: await queued }
  })
  expect(result.copying).toMatchObject({ ok: false, canceled: true, uncertain: true })
  expect(result.queued).toMatchObject({ ok: true, persisted: true })
  expect((await read(page)).items).toHaveLength(1)
})

test('saved-page discovery reads hidden configurations without navigation or mutation', async ({
  page,
}) => {
  await execute(page, {
    type: 'batch',
    operations: [{ type: 'add', item: { kind: 'columns', count: 8, visible: false } }],
  })
  await page.evaluate(() => history.pushState({}, '', '/similar'))
  await expect.poll(async () => (await read(page)).items.length).toBe(0)
  const result = await page.evaluate(async () => ({
    list: await window.lattice!.listSavedPages(),
    source: await window.lattice!.readSavedPage('/?view=other'),
  }))
  expect(result.list).toEqual([expect.objectContaining({ itemCount: 1, kind: 'base' })])
  expect(result.source).toMatchObject({
    inherited: true,
    items: [expect.objectContaining({ count: 8, visible: false })],
  })
  expect((await read(page)).items).toEqual([])
  expect(page.url()).toContain('/similar')
  expect(
    await page.evaluate(() =>
      window.lattice!.readSavedPage('https://example.com').then(
        () => false,
        () => true,
      ),
    ),
  ).toBe(true)
})

test('transformed document roots do not shift or scale guide coordinates', async ({ page }) => {
  await execute(page, {
    type: 'batch',
    operations: [{ type: 'add', item: { kind: 'individual', position: 400 } }],
  })
  await page.evaluate(() => {
    document.documentElement.style.transform = 'translate(80px, 40px) scale(0.8)'
    document.body.style.transform = 'translate(50px, 30px) scale(0.9)'
  })
  const stroke = page.locator('.guide .stroke')
  await expect.poll(async () => (await stroke.boundingBox())?.x).toBeCloseTo(400, 1)
  expect((await stroke.boundingBox())!.width).toBeCloseTo(1, 2)
  await page.mouse.move(400, 700)
  await page.mouse.down()
  await page.mouse.move(500, 700)
  await page.mouse.up()
  await expect.poll(async () => (await read(page)).items[0]).toMatchObject({ position: 500 })
})

test('native WebMCP tools are discoverable and callable from an external browser connection', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Native WebMCP test requires Chromium testing flag.')
  await expect.poll(async () => (await page.webmcp.tools()).length).toBe(4)
  const tools = await page.webmcp.tools()
  expect(
    tools.find((tool) => tool.name === 'lattice_edit')?.annotations?.consequential ?? false,
  ).toBe(false)
  expect(tools.find((tool) => tool.name === 'lattice_presets')?.annotations?.consequential).toBe(
    true,
  )
  const added = (await page.webmcp.callTool('lattice_edit', {
    action: {
      type: 'batch',
      operations: [{ type: 'add', item: { kind: 'columns', count: 12, gutter: 20, margin: 20 } }],
    },
  })) as { ok: boolean }
  expect(added.ok).toBe(true)
  const context = (await page.webmcp.callTool('lattice_read', {})) as { items: unknown[] }
  expect(context.items).toHaveLength(1)
  const pages = (await page.webmcp.callTool('lattice_pages', {})) as unknown[]
  expect(pages).toHaveLength(1)
  await expect(
    page.webmcp.callTool('lattice_edit', { action: { type: 'deletePreset', presetId: 'file:no' } }),
  ).rejects.toThrow()
  await page.evaluate(() => window.lattice!.dispose())
  await expect.poll(async () => (await page.webmcp.tools()).length).toBe(0)
})

test('pinch zoom preserves CSS-space guide geometry', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Browser protocol pinch emulation requires Chromium.')
  await execute(page, {
    type: 'batch',
    operations: [{ type: 'add', item: { kind: 'individual', unit: '%', position: 50 } }],
  })
  const before = await read(page)
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.5 })
  expect(await page.evaluate(() => window.visualViewport!.scale)).toBeCloseTo(1.5)
  const after = await read(page)
  expect(after.items).toEqual(before.items)
  expect(after.geometry.guides).toEqual(before.geometry.guides)
  expect((await page.locator('.guide .stroke').boundingBox())!.x).toBeCloseTo(
    before.dimensions.width / 2,
    1,
  )
  await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })
  await session.detach()
})

test('desktop browser zoom recalculates CSS coordinates without changing settings', async ({
  browserName,
  baseURL,
}) => {
  test.skip(browserName !== 'chromium', 'Uses Chromium extension zoom API, not viewport emulation.')
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-zoom-'))
  await writeFile(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Lattice zoom test',
      version: '1.0',
      permissions: ['tabs'],
      background: { service_worker: 'worker.js' },
    }),
  )
  await writeFile(path.join(root, 'worker.js'), 'chrome.runtime.onInstalled.addListener(() => {});')
  const context = await chromium.launchPersistentContext(path.join(root, 'profile'), {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  })
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
    const page = await context.newPage()
    await page.goto(baseURL!)
    await ready(page)
    await execute(page, {
      type: 'batch',
      operations: [{ type: 'add', item: { kind: 'individual', unit: '%', position: 50 } }],
    })
    const before = await read(page)
    const ratio = await page.evaluate(() => devicePixelRatio)
    await worker.evaluate(async (url) => {
      const tabs = (
        globalThis as unknown as {
          chrome: {
            tabs: {
              query(query: object): Promise<{ id: number; url?: string }[]>
              setZoom(id: number, zoom: number): Promise<void>
            }
          }
        }
      ).chrome.tabs
      const tab = (await tabs.query({})).find((tab) => tab.url?.startsWith(url))!
      await tabs.setZoom(tab.id, 1.25)
    }, baseURL!)
    await expect
      .poll(async () => (await read(page)).dimensions.width)
      .toBeLessThan(before.dimensions.width)
    expect(await page.evaluate(() => devicePixelRatio)).toBeCloseTo(ratio * 1.25, 2)
    const after = await read(page)
    expect(after.items).toEqual(before.items)
    expect(after.geometry.guides[0]?.position).toBe(after.dimensions.width / 2)
    expect((await page.locator('.guide .stroke').boundingBox())!.x).toBeCloseTo(
      after.dimensions.width / 2,
      1,
    )
    expect((await page.locator('.guide .stroke').boundingBox())!.width).toBeCloseTo(1, 2)
  } finally {
    await context.close()
    await rm(root, { recursive: true, force: true })
  }
})
