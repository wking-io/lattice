# Lattice running-page API

Prefer WebMCP tools when the browser connection exposes them. Otherwise evaluate the supported API on the target local page:

```js
const context = await window.lattice.read()
```

Read before layout work, regardless of visibility. `context.items` contains all configured items, including hidden items and applied preset snapshots. An empty list with no load error means this page has no grid. Ask the user to choose a grid before adding one; inspect comparable running pages in the same project and browser profile to recommend their saved configurations. There is no cross-page listing API: identify comparable routes from the project or its navigation and read those pages. If you cannot inspect them, say so and offer a suitable catalog preset. Do not write browser storage directly.

`context.geometry` includes hidden items; each guide and resolved grid has `visible`, the combined item/preset visibility before the master toggle. This flag does not affect its use for layout alignment. Grid starts and sizes are CSS pixels: vertical guides use x from the viewport left; horizontal guides use y from the document top. Compare element `getBoundingClientRect()` x coordinates directly; add `scrollY` to its y coordinates. Resolved grid `start`, `size`, `gutter`, and `count` describe tracks; track n starts at `start + n * (size + gutter)`. Preserve fractional track geometry. Read again after layout changes or viewport changes.

After the user chooses to create a grid, for example:

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

To reuse a comparable page's grid, read that page first, then apply matching catalog presets on the target only if their definitions match the saved snapshots. Otherwise copy underlying columns, rows, and individual settings with `add` operations, omitting IDs and preset metadata; the library assigns fresh IDs. Do not change the source page or save a shared preset unless requested.

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

`context.geometry.guides` is culled to the viewport and limited to 5,000 lines; check `truncated`. Use grid formulas and stored individual positions to resolve off-screen coordinates; absence from this list does not mean no grid. Dimensions and all stored item settings remain available. Hidden UI does not disable the API, and reading never reveals it.
