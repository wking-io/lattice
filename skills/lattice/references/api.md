# Lattice running-page API

Prefer WebMCP tools when the browser connection exposes them. Otherwise evaluate the supported API on the target local page:

```js
const context = await window.lattice.read()
const result = await window.lattice.batch(
  [
    { type: 'add', item: { kind: 'columns', count: 12, gutter: 20, margin: 20 } },
    { type: 'add', item: { kind: 'rows', count: 'auto', alignment: 'min', size: 8, gutter: 0 } },
  ],
  { expectedRevision: context.revision },
)
```

This adds both items as one undo step. Inspect `result.ok`, `applied`, `persisted`, `error`, and `context`; failed persistence can leave an edit applied in memory. Read before retrying uncertain operations.

`batch` operations: `add` with `item`; `update` with `id` and `changes`; `remove`, `duplicate`, `unlink`, or `updatePreset` with `id`; `applyPreset` with `presetId` from the catalog. Preserve unrequested items. Preset children cannot be edited until unlinked.

Item inputs:

- Columns/rows: `kind`, `name`, `count` (positive integer or `"auto"`), `alignment` (`stretch`, `min`, `center`, `max`), `gutter`, `margin`, `size`, `offset`, `color`, `opacity`, `visible`. Auto requires fixed-size alignment. Stretch uses margin; fixed alignment uses size and offset; center ignores offset.
- Individual: `kind: "individual"`, `axis: "vertical" | "horizontal"`, `position`, `unit: "px" | "%"`, `name`, `color`, `opacity`, `visible`.
- Colors use six-digit hex. Opacity is 0–1. Values are CSS pixels unless the individual unit is `%`.

Other actions use `window.lattice.execute(action, { expectedRevision })`:

```js
{ type: 'undo' } // or redo
{ type: 'visibility', grids: true, panel: false }
{ type: 'savePreset', name: 'Editorial', itemIds: ['selected-id'] }
{ type: 'savePreset', name: 'Updated', itemIds: ['selected-id'], presetId: 'file:existing-id' }
{ type: 'deletePreset', presetId: 'file:existing-id' }
{ type: 'resetQuery' } // removes current query override and resumes inheritance
```

Save writes the project file, then replaces selected items with one applied snapshot. Undo restores page items and keeps the definition. Delete is explicit and leaves applied snapshots intact. Inline and built-in catalog entries are read-only. A late save after navigation can return `saved: true, applied: false`; use the returned `presetId` to apply it deliberately.

`context.geometry.guides` is culled to the viewport and limited to 5,000 lines; check `truncated`. Grid formulas, dimensions, and all stored item settings remain available. Horizontal coordinates start at the document top; vertical coordinates start at the viewport left. Hidden UI does not disable the API.
