---
name: lattice
description: Read and edit Lattice page grid overlays in local development through WebMCP. Use for columns, rows, individual guides, presets, and grid context, rather than CSS layout implementation.
---

# Lattice

Prefer the target page's WebMCP tools (`lattice_read`, `lattice_edit`). If unavailable through the browser connection, use `await window.lattice.read()` and `await window.lattice.execute(action)`, then panel controls. Copy context is a read-only fallback. Read [API examples](references/api.md) when using the JavaScript fallback.

- Discover actual tool names and schemas; do not assume availability.
- Read the current URL, storage scope, dimensions, and grid state before editing. Address items by stable ID; names may repeat.
- Preserve unrequested items and settings. Batch related edits when supported.
- Use library operations, not direct DOM or storage writes, so persistence and undo remain consistent.
- Preset saves write the shared JSON file; verify `ok`, `saved`, `applied`, and `persisted`. Undo keeps the definition. Built-in and inline definitions are read-only.
- Columns use browser content width; rows use full document height. Preserve individual guides' pixel or percentage units.
- Only individual lines move freely. Edit columns and rows through their settings. Unlink presets before editing their contents; refresh applied presets through the explicit update action.
- Read state after editing to verify the result. Check uncertain outcomes before retrying additions.

Operate on local development pages. Keep grid tooling out of production builds. Editing visual guides does not imply changing the website's layout.
