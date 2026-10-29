---
name: lattice
description: Use a page's Lattice grid when designing, implementing, or adjusting its layout in local development, and read or edit grid overlays, guides, and presets. Prefer WebMCP.
---

# Lattice

Prefer the target page's WebMCP tools: `lattice_read` for context, `lattice_pages` for saved grids, `lattice_edit` for page edits, and `lattice_presets` for shared file writes. If unavailable through the browser connection, use `window.lattice`, then panel controls. Copy context is a read-only fallback. Read [API examples](references/api.md) when using the JavaScript fallback.

## Page layout

- Before layout work, read the target page's grid even when the overlay, panel, or individual items are hidden. Visibility is a viewing preference, not evidence that no grid exists. Preserve visibility while reading and aligning.
- If the page has configured items, use their settings and resolved coordinates to align the page's layout. Change the page's CSS, preserving the grid unless the user requests grid changes. Measure relevant element edges against the grid, then reread and verify after layout changes, scrolling, or resizing; document height can affect rows and percentage guides.
- If the page has no configured items, use `lattice_pages` to list saved grids, then read a few comparable pages (shared template or purpose) in this origin and project. No navigation is needed. These are saved settings, not live geometry. Recommend a verified existing grid first, naming the source page and settings. A catalog entry alone does not prove a page uses it.
- Ask whether to add a grid and offer concrete options: the recommended existing grid or a suitable common preset, an alternative, and proceeding without a grid. With no suitable existing grid, favor a common preset appropriate to the page, such as 12 columns for a desktop layout or 4 for a narrow layout; offer a baseline when useful. Use actual catalog settings and IDs. If built-ins are disabled, describe equivalent custom settings rather than referencing an unavailable preset.
- Wait for the user's choice before creating a grid or doing grid-dependent layout work; honor an earlier choice without asking again. Reusing another page's grid copies its underlying configuration into the target page and leaves the source intact. An unavailable API or a storage load error is not an empty grid; report the limitation rather than inventing a configuration.

## Grid edits

- Discover actual tool names and schemas; do not assume availability.
- Read the current URL, storage scope, dimensions, and grid state before editing. Address items by stable ID; names may repeat.
- Preserve unrequested items and settings. Batch related edits when supported.
- Use library operations, not direct DOM or storage writes, so persistence and undo remain consistent.
- Preset saves write the shared JSON file; verify `ok`, `saved`, `applied`, and `persisted`. Undo keeps the definition. Built-in and inline definitions are read-only.
- Columns use browser content width; rows use full document height. Preserve individual guides' pixel or percentage units.
- Only individual lines move freely. Edit columns and rows through their settings. Unlink presets before editing their contents; refresh applied presets through the explicit update action.
- Read state after editing to verify the result. Canceling queued work prevents execution; a dispatched file write may still finish. For `uncertain` results, inspect the catalog and returned `presetId` before retrying additions.

Operate on local development pages. Keep grid tooling out of production builds. The overlay itself never changes the website's layout.
