---
name: lattice
description: Read and edit Lattice page grid overlays in local development through WebMCP. Use for columns, rows, individual guides, presets, and grid context, rather than CSS layout implementation.
---

# Lattice

Prefer the target page's WebMCP tools. If unavailable through the browser connection, use the library's documented JavaScript API, then panel controls. Copy context is a read-only fallback.

- Discover actual tool names and schemas; do not assume availability.
- Read the current URL, storage scope, dimensions, and grid state before editing. Address items by stable ID; names may repeat.
- Preserve unrequested items and settings. Batch related edits when supported.
- Use library operations, not direct DOM or storage writes, so persistence and undo remain consistent.
- Preset saves write the shared JSON file; verify server acknowledgment. Built-in and inline definitions are read-only.
- Columns use browser content width; rows use full document height. Preserve individual guides' pixel or percentage units.
- Only individual lines move freely. Edit columns and rows through their settings. Unlink presets before editing their contents; refresh applied presets through the explicit update action.
- Read state after editing to verify the result. Check uncertain outcomes before retrying additions.

Operate on local development pages. Keep grid tooling out of production builds. Editing visual guides does not imply changing the website's layout.
