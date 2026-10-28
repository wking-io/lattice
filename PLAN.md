# Lattice plan

Status: product planning. No runtime implementation yet.
Updated: 2026-10-28.
Project name: Lattice. Public repository: `wking-io/lattice`.
The published package name and license remain to be selected.

## Purpose

Build an installable library that adds visual grid guides to a running web project during local development. People and agents can inspect and configure the same guides. The overlay does not control the application's layout.

The library must contribute no JavaScript or CSS to deployed production bundles. A runtime visibility switch alone does not satisfy this requirement.

## Confirmed v1 decisions

### Development integration

Vite is the first installation target. Effect v4 and Foldkit are the requested implementation stack; the upstream manifests support this combination. [Architecture discussion](ARCHITECTURE.md) records the proposed design, compatibility evidence, and remaining technical decisions.

### Items and ownership

Every rendered line belongs to a preset, column, row, or individual item. A page can contain any number of these items.

| Item | Behavior |
| --- | --- |
| Preset | An applied snapshot containing column, row, and individual items. Its lines cannot be dragged. Unlink it to release its underlying items. |
| Columns | A generated column grid with Figma-style settings. Change its settings to change the grid; its boundaries cannot be dragged. |
| Rows | A generated row grid with Figma-style settings. Change its settings to change the grid; its boundaries cannot be dragged. |
| Individual | One horizontal or vertical guide with a pixel or percentage position. It can be dragged. |

Items support editable names with automatic defaults. Agent context includes names and stable IDs; duplicate names must not make item identity ambiguous.

Only individual guides can be dragged. Option/Alt-drag duplicates an individual guide. Dragging does not automatically unlink a preset or convert a column or row item into individual guides. Such conversion is outside v1 and should be revisited only if actual usage calls for it.

### Column and row settings

Match the relevant Figma layout-guide settings:

- Count, including automatic count.
- Gutter.
- Alignment: left/center/right/stretch for columns; top/center/bottom/stretch for rows.
- Fixed column width or row height where applicable.
- Offset for applicable fixed alignments, and margins for stretch alignment.
- Color and opacity.

The supported combinations and automatic-count behavior must be checked against the current [Figma layout-grid API](https://developers.figma.com/docs/plugins/api/LayoutGrid/) and [layout-guide documentation](https://help.figma.com/hc/en-us/articles/360040450513-Create-layout-guides) during implementation. Do not infer that every setting applies to every alignment.

### Dimensions and resizing

- Columns use the visible browser width and respond to browser zoom.
- Rows use full document height, not visible window height.
- Individual positions can be pixels or percentages.
- Grids cover the page in v1; attachment to individual elements is deferred.
- There are no breakpoint-specific configurations or automatic switches between desktop/mobile presets in v1.
- Preserve the configured values on resize. Stretch grids and percentage guides still resolve against their current dimensions; fixed pixel values remain fixed in their coordinate system.

Exact coordinate conventions and zoom rendering are proposed below rather than treated as settled requirements.

### Appearance

- Lines are 1px thick.
- Provide bright preset colors and a custom-color option.
- Supply common built-in grid presets and support user-created presets.
- Exact palettes, built-in preset contents, and the meaning of 1px under zoom remain to be selected.

### Presets

Presets can contain any number of column, row, and individual items. They remain one level deep: including an existing preset when saving a new preset copies its underlying items rather than nesting a preset reference.

Saving a preset:

1. Open a save dialog with a name field and item checklist.
2. Check all current items by default; allow the user to uncheck items.
3. Save the selected configuration as a reusable preset.
4. Replace the selected page items with one applied preset, preserving their appearance. Unselected items remain separate.

An applied preset retains the version it was created from. Editing a saved preset does not automatically modify existing applications. Provide an explicit **Update from preset** action.

**Unlink preset** releases its underlying items. Column and row items remain generated grids after unlinking and still cannot have their individual boundaries dragged.

### Panel, visibility, and interaction

Use a floating panel. A keyboard shortcut shows or hides it. When hidden, it leaves no visible launcher, handle, or other panel remnant.

There is a separate shortcut for grid visibility. The allowed states are:

| Grids | Panel | Allowed |
| --- | --- | --- |
| Visible | Visible | Yes |
| Visible | Hidden | Yes |
| Hidden | Hidden | Yes |
| Hidden | Visible | No |

Hiding all grids always hides the panel. Showing grids again restores the panel's previous visibility. Hiding only the panel leaves the grids visible.

Support visibility for individual items. Include a modifier paired with clicking that lets the user ignore visible grid lines and interact with the underlying page. The exact shortcuts and modifier are not selected yet.

### Persistence and URLs

Save configurations in browser storage so refresh does not lose the page's grids.

Query parameters are ignored initially: a query URL inherits an existing configuration for its base path. When that inherited configuration is edited on a query URL, create a fully independent copy for that query URL. Future base-path edits do not flow into that copy.

Example:

| URL/action | Result |
| --- | --- |
| Configure `/products` | Save the base configuration. |
| Visit `/products?sort=price` | Use the base configuration until edited. |
| Edit a grid on `?sort=price` | Save an independent query-specific configuration; leave the base unchanged. |
| Visit `/products?sort=name` without an override | Continue using the base configuration. |
| Reset the `?sort=price` override | Remove it and restore inheritance from the base. |

Provide **Reset to base configuration**. Changing an individual item's visibility counts as a configuration edit and can create a query override. The master visibility toggle is a separately remembered viewing preference and does not create an override.

Hash routing, query normalization, and initial creation on a query URL without an existing base configuration are still open.

### Agent access and editing

Agents should directly read and edit the running page. Prefer WebMCP whenever supported by the browser and the agent's connection. Retain the documented browser JavaScript API, panel interaction, and **Copy context** as fallbacks; copying context is a read fallback, not a mutation mechanism.

Agent capabilities should include reading state, creating and editing items, naming items, deleting items, managing presets, and controlling visibility. All access paths should call the same underlying operations so they follow the same item, preset, persistence, and visibility rules.

Expose saved configuration and current resolved geometry, including stable IDs, names, units, URL, storage scope, browser/document dimensions, and visibility. Agents need enough information to interpret a coordinate and verify an edit.

Example user request: “Make a 12-column grid with 20px gap and margin and an 8px vertical baseline.” The intended interpretation to support is a stretch column item with count 12, 20px gutters and margins, plus horizontal baseline guides spaced every 8px. Baseline terminology should be clarified if the user's intended orientation is ambiguous.

The compact [agent skill](skills/lattice/SKILL.md) guides agents toward WebMCP, then supported fallbacks. [Agent integration guidance](agent-integration.md) contains the project-instructions pointer. Bundle the skill with the development tooling and offer setup into the consuming project's skill location; do not assume that a skill inside an npm dependency is automatically discovered.

WebMCP is an evolving integration. Check the [current imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api), feature-detect supported capabilities, and verify discovery and invocation from the intended agent. Registering tools in a browser and making them available to an external agent are separate checks.

## Recommended implementation defaults to confirm

These suggestions were discussed but were not individually finalized:

- Use CSS pixels for coordinates and strokes, with browser content width excluding the scrollbar. Resolve vertical percentages against that width and horizontal percentages against document height; use left/top origins.
- Recalculate when zoom, viewport dimensions, or document content size changes. A horizontal percentage guide or stretch row can move when content expands. The overlay must not increase the document dimensions it measures.
- Draw both boundaries of columns and rows with transparent interiors. Avoid visually thickening coincident boundaries.
- Give thin draggable lines a wider invisible hit area and expose precise numeric editing, deletion, duplication, and undo/redo.
- Preserve the unit when dragging an individual percentage guide. Preserve saved guides that move off-screen after resize.
- Store configurations by origin and path, and make user presets reusable across that origin. Decide whether local host/port changes should be handled specially.
- Keep the agent API available while the panel or grid lines are hidden.
- Support atomic multi-item edits as one undoable change, followed by reading the resulting state. Default agent additions to preserving existing items unless replacement is requested; this default still needs confirmation.

## Remaining decisions

Resolve these before the implementation slice that depends on them:

| Area | Decision |
| --- | --- |
| Packaging | Published package name and license. Lattice and the public `wking-io/lattice` repository are confirmed; npm name availability has not been checked. |
| Installation | Vite is selected. Decide supported browsers and verify the development-only injection mechanism guarantees zero production bundle footprint. |
| Local development | Supported local hostnames, loopback/LAN access, and how development mode is identified. |
| Geometry | CSS-pixel versus device-pixel strokes, origins, scrollbar treatment, fractional positions, and pinch-zoom expectations. |
| Preset inventory | Built-in grids, default counts/gutters/margins, bright palette, and color/opacity scope. |
| Editing UI | Individual-guide creation, numeric editing, selection of overlapping lines, keyboard editing, and undo/redo scope. |
| Shortcuts | Exact keys, click-through modifier, and behavior when the panel shortcut is used while all grids are hidden. |
| Initial state | First-load panel/grid visibility, default grid items, and panel-position persistence. |
| URL identity | Query parameter ordering, hashes, query creation with no base state, and optional custom key handling. |
| Preset lifecycle | Editing/deleting a saved preset, name collisions, and update behavior after its source is removed. |
| Agent contract | Final tool/API schemas, add-versus-replace defaults, batch results, and the first verified browser/agent combination. |

## Backlog

- Element- or container-based grids.
- Breakpoint-specific configurations and responsive preset switching.
- Converting generated column/row boundaries into individual guides, only if a real workflow calls for it.
- Snapping guides to page elements.
- Touch-specific editing.
- Cross-device or team synchronization.
- Nested presets, only if independent copies prove insufficient.

## Implementation sequence

1. **Repository and integration foundation.** The public repository and initial Vite target are selected. Verify the Effect/Foldkit embedding and prove that an empty development integration contributes nothing to a production build before adding the full overlay.
2. **First usable slice.** Define item identity and state operations; render a column item and an individual guide; connect them to a basic floating panel and documented read API.
3. **Geometry and persistence.** Add complete row/column settings, individual units, zoom/document-size updates, browser storage, base/query inheritance, and reset behavior.
4. **Editing and visibility.** Add dragging, duplication, naming, item controls, panel/grid shortcuts, click-through interaction, and the three-state visibility model.
5. **Preset lifecycle.** Add built-in presets, selective save-and-apply, flattening existing presets into copied items, unlinking, and explicit updates.
6. **Agent integration.** Add shared edit operations, WebMCP registration, context export, and skill setup. Validate the example grid-creation workflow from an actual agent connection.
7. **Release preparation.** Complete installation documentation and the supported-environment matrix, verify production exclusion, and finalize package metadata and license before publishing.

## Validation targets

Use focused automated checks for state and geometry, plus browser checks for interaction and integration:

- Correct column/row geometry for supported alignments, count modes, gutters, margins, and offsets.
- Expected pixel/percentage and stretch behavior under resize, zoom, scrolling, and document-height changes.
- Overlay rendering does not alter layout or document dimensions.
- Only individual guides drag; Option/Alt duplicates them; preset boundaries remain protected.
- Saving presets replaces only selected items; copied contents are flat; unlinking preserves item types; updates are explicit.
- Refresh restores state; query edits fork independently; reset restores inheritance; item and master visibility have different persistence effects.
- Panel/grid visibility transitions obey the agreed state model; hidden panels leave no visible control; click-through works on the page underneath.
- Panel, JavaScript API, and WebMCP produce equivalent state changes. Verify agent reads and edits against the same live page.
- Unsupported WebMCP connections use the available fallback without reporting false success.
- Production outputs contain none of the library's JavaScript or CSS.

## Current artifacts

- [Architecture discussion](ARCHITECTURE.md): selected technology direction and proposed design; discussion in progress.
- [Compact agent skill](skills/lattice/SKILL.md): drafted and format-checked.
- [Agent setup guidance](agent-integration.md): drafted.
- This plan: conversation decisions consolidated; implementation has not started.
