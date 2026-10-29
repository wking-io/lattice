import type { Html, HtmlBuilder } from 'foldkit/html'
import { palette, type Item, type Operation } from '../domain.js'
import { resolve } from '../geometry.js'
import { displayedItems, message, uiRequest, type Message, type Model } from './program.js'
import { styles } from './styles.js'

export function view(model: Model, h: HtmlBuilder<Message>): Html {
  const request = (action: Parameters<typeof uiRequest>[1]) => uiRequest(model, action)
  const ops = (...operations: Operation[]) => request({ type: 'batch', operations })
  const button = (label: string, msg: Message, disabled = false, className = '') =>
    h.button([h.Type('button'), h.Class(className), h.Disabled(disabled), h.OnClick(msg)], [label])
  const text = (value: string, className = 'muted') => h.div([h.Class(className)], [value])
  const edit = (item: Item, changes: Record<string, unknown>) =>
    ops({ type: 'update', id: item.id, changes })
  const field = (item: Item, label: string, key: string, value: string | number, numeric = false) =>
    h.label(
      [h.Class('field')],
      [
        label,
        h.input([
          h.Type('text'),
          h.Attribute('inputmode', numeric ? 'decimal' : 'text'),
          h.AriaLabel(label),
          h.Value(model.drafts[`${item.id}:${key}`] ?? String(value)),
          h.OnInput((value) => message({ type: 'draft', key: `${item.id}:${key}`, value })),
          h.OnChange((value) =>
            edit(item, {
              [key]: numeric
                ? key === 'count' && value === 'auto'
                  ? 'auto'
                  : value.trim() === ''
                    ? NaN
                    : Number(value)
                : value,
            }),
          ),
        ]),
      ],
    )
  const select = (
    item: Item,
    label: string,
    key: string,
    value: string,
    choices: readonly (readonly [string, string])[],
  ) =>
    h.label(
      [h.Class('field')],
      [
        label,
        h.select(
          [h.AriaLabel(label), h.Value(value), h.OnChange((value) => edit(item, { [key]: value }))],
          choices.map(([id, label]) => h.option([h.Value(id)], [label])),
        ),
      ],
    )
  const editor = (item: Item): Html =>
    h.div(
      [h.Class('section stack'), h.Key(`edit-${item.id}`)],
      [
        field(item, 'Name', 'name', item.name),
        ...(item.kind === 'preset'
          ? [
              text(`${item.items.length} underlying items · ${item.sourceId}`),
              text(
                model.catalog.presets.some((p) => p.id === item.sourceId)
                  ? 'A saved snapshot. Update explicitly to use source changes.'
                  : 'Source unavailable. This snapshot still works.',
              ),
              h.div(
                [h.Class('row')],
                [
                  button('Unlink', ops({ type: 'unlink', id: item.id }), model.busy),
                  button(
                    'Update from preset',
                    ops({ type: 'updatePreset', id: item.id }),
                    model.busy || !model.catalog.presets.some((p) => p.id === item.sourceId),
                  ),
                ],
              ),
            ]
          : [
              h.div(
                [h.Class('fields')],
                item.kind === 'individual'
                  ? [
                      select(item, 'Direction', 'axis', item.axis, [
                        ['vertical', 'Vertical'],
                        ['horizontal', 'Horizontal'],
                      ]),
                      select(item, 'Unit', 'unit', item.unit, [
                        ['px', 'Pixels'],
                        ['%', 'Percent'],
                      ]),
                      field(item, 'Position', 'position', item.position, true),
                    ]
                  : [
                      field(item, 'Count (or auto)', 'count', item.count, true),
                      select(item, 'Alignment', 'alignment', item.alignment, [
                        ['stretch', 'Stretch'],
                        ['min', item.kind === 'columns' ? 'Left' : 'Top'],
                        ['center', 'Center'],
                        ['max', item.kind === 'columns' ? 'Right' : 'Bottom'],
                      ]),
                      field(item, 'Gutter', 'gutter', item.gutter, true),
                      ...(item.alignment === 'stretch'
                        ? [field(item, 'Margin', 'margin', item.margin, true)]
                        : [
                            field(
                              item,
                              item.kind === 'columns' ? 'Width' : 'Height',
                              'size',
                              item.size,
                              true,
                            ),
                            ...(item.alignment === 'center'
                              ? []
                              : [field(item, 'Offset', 'offset', item.offset, true)]),
                          ]),
                    ],
              ),
              h.div(
                [h.Class('fields')],
                [
                  h.label(
                    [h.Class('field')],
                    [
                      'Color',
                      h.input([
                        h.Type('color'),
                        h.AriaLabel('Custom color'),
                        h.Value(item.color),
                        h.OnChange((value) => edit(item, { color: value })),
                      ]),
                    ],
                  ),
                  field(item, 'Opacity (0–1)', 'opacity', item.opacity, true),
                ],
              ),
              h.div(
                [h.Class('row')],
                palette.map((color) =>
                  h.button(
                    [
                      h.Type('button'),
                      h.Class('swatch'),
                      h.AriaLabel(`Color ${color}`),
                      h.Style({ background: color }),
                      h.OnClick(edit(item, { color })),
                    ],
                    [],
                  ),
                ),
              ),
            ]),
        h.div(
          [h.Class('row')],
          [
            button('Duplicate', ops({ type: 'duplicate', id: item.id }), model.busy),
            button('Delete item', ops({ type: 'remove', id: item.id }), model.busy, 'danger'),
          ],
        ),
      ],
    )
  const geometry = resolve(displayedItems(model), model.dimensions, true)
  const picked =
    model.catalog.presets.find((p) => p.id === model.pickedPreset) ?? model.catalog.presets[0]
  const selected = model.page.items.find((i) => i.id === model.selected)
  return h.div(
    [],
    [
      h.style([], [styles]),
      model.preferences.grids
        ? h.div(
            [h.Class('overlay'), h.AriaLabel('Lattice grid overlay')],
            geometry.guides.map((guide) => {
              const vertical = guide.axis === 'vertical',
                position = guide.position - (vertical ? 0 : model.dimensions.scrollY)
              const key = `${guide.itemId}:${guide.leafId}:${guide.axis}:${guide.draggable ? 'guide' : guide.position}`
              return guide.draggable
                ? h.button(
                    [
                      h.Key(key),
                      h.Type('button'),
                      h.Class(`guide ${guide.axis}`),
                      h.Attribute('data-guide', guide.itemId),
                      h.Attribute('data-axis', guide.axis),
                      h.AriaLabel(
                        `${guide.axis} guide at ${Math.round(guide.position * 100) / 100}px`,
                      ),
                      h.Style(
                        vertical
                          ? { left: `${position - 4}px`, top: '0' }
                          : { top: `${position - 4}px`, left: '0' },
                      ),
                    ],
                    [
                      h.span(
                        [
                          h.Class('stroke'),
                          h.Style({ background: guide.color, opacity: String(guide.opacity) }),
                        ],
                        [],
                      ),
                    ],
                  )
                : h.div(
                    [
                      h.Key(key),
                      h.Class('line'),
                      h.Style({
                        background: guide.color,
                        opacity: String(guide.opacity),
                        ...(vertical
                          ? { left: `${position}px`, top: '0', width: '1px', height: '100%' }
                          : { top: `${position}px`, left: '0', height: '1px', width: '100%' }),
                      }),
                    ],
                    [],
                  )
            }),
          )
        : null,
      model.preferences.grids && model.preferences.panel
        ? h.section(
            [
              h.Class('panel'),
              h.AriaLabel('Lattice panel'),
              h.Style({
                left: `${Math.max(8, Math.min(model.panelX, model.dimensions.width - 312))}px`,
                top: `${Math.max(8, Math.min(model.panelY, model.dimensions.viewportHeight - 100))}px`,
              }),
            ],
            [
              h.div(
                [h.Class('heading'), h.Attribute('data-panel-drag', '')],
                [
                  h.strong([], ['Lattice']),
                  h.span([h.Class('badge')], ['LOCAL']),
                  button('Hide', request({ type: 'visibility', panel: false }), false, 'quiet'),
                ],
              ),
              h.div(
                [h.Class('section stack')],
                [
                  h.div(
                    [h.Class('row')],
                    [
                      button('Undo', request({ type: 'undo' }), model.busy || !model.undo.length),
                      button('Redo', request({ type: 'redo' }), model.busy || !model.redo.length),
                      button(
                        'Hide grids',
                        request({ type: 'visibility', grids: false }),
                        false,
                        'grow',
                      ),
                    ],
                  ),
                  h.div(
                    [h.Class('row')],
                    [
                      button(
                        '+ Columns',
                        ops({ type: 'add', item: { kind: 'columns' } }),
                        model.busy,
                      ),
                      button(
                        '+ Rows',
                        ops({
                          type: 'add',
                          item: {
                            kind: 'rows',
                            alignment: 'min',
                            count: 'auto',
                            size: 8,
                            gutter: 0,
                            margin: 0,
                            color: '#00D9FF',
                          },
                        }),
                        model.busy,
                      ),
                      button(
                        '+ Guide',
                        ops({ type: 'add', item: { kind: 'individual' } }),
                        model.busy,
                      ),
                    ],
                  ),
                  h.div(
                    [h.Class('row')],
                    [
                      h.select(
                        [
                          h.AriaLabel('Preset'),
                          h.Class('grow'),
                          h.Value(picked?.id ?? ''),
                          h.OnChange((value) => message({ type: 'pickPreset', value })),
                        ],
                        model.catalog.presets.map((p) =>
                          h.option([h.Value(p.id)], [`${p.name} · ${p.source}`]),
                        ),
                      ),
                      button(
                        'Apply',
                        ops({ type: 'applyPreset', presetId: picked?.id ?? '' }),
                        model.busy || !picked,
                      ),
                    ],
                  ),
                  ...(picked?.writable
                    ? [
                        button(
                          'Delete selected file preset',
                          request({ type: 'deletePreset', presetId: picked.id }),
                          model.busy,
                          'danger',
                        ),
                      ]
                    : []),
                ],
              ),
              h.div(
                [h.Class('section')],
                [
                  text('Page items', 'eyebrow'),
                  ...(!model.page.items.length
                    ? [text('Add a layout or a guide to get started.', 'empty')]
                    : model.page.items.map((item) =>
                        h.div(
                          [
                            h.Key(item.id),
                            h.Class(`item ${model.selected === item.id ? 'selected' : ''}`),
                          ],
                          [
                            h.input([
                              h.Type('checkbox'),
                              h.Checked(item.visible),
                              h.AriaLabel(`Show ${item.name}`),
                              h.OnChange(() => edit(item, { visible: !item.visible })),
                            ]),
                            h.span(
                              [
                                h.Class('dot'),
                                h.Style({
                                  background: item.kind === 'preset' ? '#bec6d8' : item.color,
                                }),
                              ],
                              [],
                            ),
                            h.button(
                              [
                                h.Type('button'),
                                h.Class('quiet grow'),
                                h.OnClick(message({ type: 'select', id: item.id })),
                                h.AriaLabel(`Edit ${item.name}`),
                              ],
                              [item.name],
                            ),
                            h.span(
                              [h.Class('muted')],
                              [
                                item.kind === 'individual'
                                  ? `${Math.round(item.position * 100) / 100}${item.unit}`
                                  : item.kind,
                              ],
                            ),
                          ],
                        ),
                      )),
                  h.div([h.Class('divider')], []),
                  button(
                    'Save preset…',
                    message({ type: 'saveDialog', open: true }),
                    model.busy || !model.page.items.length,
                  ),
                ],
              ),
              model.saveOpen
                ? h.div(
                    [h.Class('section stack save')],
                    [
                      text('Save selected items', 'eyebrow'),
                      h.input([
                        h.AriaLabel('Preset name'),
                        h.Placeholder('Preset name'),
                        h.Value(model.saveName),
                        h.OnInput((value) => message({ type: 'saveName', value })),
                      ]),
                      ...model.page.items.map((item) =>
                        h.label(
                          [h.Class('check-label')],
                          [
                            h.input([
                              h.Type('checkbox'),
                              h.Checked(model.checked.includes(item.id)),
                              h.OnChange(() => message({ type: 'check', id: item.id })),
                            ]),
                            item.name,
                          ],
                        ),
                      ),
                      text(
                        'Writes the project preset file. Undo restores page items and keeps the saved definition.',
                      ),
                      h.div(
                        [h.Class('row')],
                        [
                          button(
                            'Save to project',
                            request({
                              type: 'savePreset',
                              name: model.saveName,
                              itemIds: model.checked,
                            }),
                            model.busy || !model.saveName.trim() || !model.checked.length,
                            'primary',
                          ),
                          button('Cancel', message({ type: 'saveDialog', open: false })),
                        ],
                      ),
                    ],
                  )
                : null,
              selected ? editor(selected) : null,
              h.div(
                [h.Class('section stack')],
                [
                  text(
                    `${Math.round(model.dimensions.width)}px wide · ${Math.round(model.dimensions.height)}px document`,
                  ),
                  text(
                    model.page.override
                      ? 'Query-specific grid'
                      : model.page.queryKey && model.page.baseExists
                        ? 'Inherits base path; edits create a query override.'
                        : 'Base-path grid',
                  ),
                  ...(model.page.override
                    ? [button('Reset to base grid', request({ type: 'resetQuery' }), model.busy)]
                    : []),
                  button('Copy agent context', request({ type: 'copyContext' }), model.busy),
                  ...(model.page.loadError
                    ? [
                        button(
                          'Reset unreadable page storage',
                          request({ type: 'resetPage' }),
                          model.busy,
                          'danger',
                        ),
                      ]
                    : []),
                  ...(model.busy ? [text('Saving…')] : []),
                  ...(model.error || model.catalog.error
                    ? [text(model.error ?? model.catalog.error!, 'error')]
                    : []),
                  ...(model.notice ? [text(model.notice, 'notice')] : []),
                  ...geometry.grids
                    .filter((g) => g.warning)
                    .map((g) => text(g.warning!, 'warning')),
                  ...(geometry.truncated
                    ? [
                        text(
                          'This viewport is too dense to draw every line. Increase spacing or hide some items.',
                          'warning',
                        ),
                      ]
                    : []),
                ],
              ),
              h.div(
                [h.Class('footer')],
                [
                  'Alt G: grids · Alt Shift G: panel',
                  h.br([]),
                  'Alt drag: duplicate · Ctrl/⌘: click through',
                  h.br([]),
                  'Undo/redo while Lattice is focused.',
                ],
              ),
            ],
          )
        : null,
    ],
  )
}
