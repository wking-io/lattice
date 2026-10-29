# Changelog

## 0.1.0 — 2026-10-29

Initial release of `@riff-refine/lattice`, an MIT-licensed visual grid overlay for local Vite development.

- Layer column grids, row grids, individual pixel/percentage guides, and preset snapshots. Lines render at 1 CSS pixel; column/row controls support stretch and fixed layouts, gutters, margins, offsets, and automatic counts.
- Drag individual guides, use Alt/Option-drag to duplicate, and undo or redo page edits. Toggle the floating panel and grid visibility independently with keyboard shortcuts.
- Persist page configurations by URL, with query inheritance and independent query overrides. Applied presets remain stable until explicitly updated or unlinked.
- Use six built-in presets, read-only inline presets, and shared JSON presets. Save selected items to the project file through the local Vite server.
- Let agents inspect hidden grids, discover saved configurations, and edit through WebMCP or the JavaScript API. Shared preset writes use a separate tool; requests support cancellation and bounded waits.
- Keep the runtime out of production builds. Serve compressed development assets and enforce build-time size budgets.

### Installation

```sh
npm install --save-dev @riff-refine/lattice@0.1.0
```

```ts
import { lattice } from '@riff-refine/lattice/vite'

// Add to the plugins array in vite.config.ts:
plugins: [lattice()]
```

Requires Node 22.12 or newer and Vite 7 or 8; Node 24 LTS is used for release validation.

### Verification and limits

- Automated coverage includes Chromium, Firefox, and Playwright WebKit; packaged installs are checked on Vite 7 and 8.
- Native WebMCP is tested with Chromium's WebMCP feature flag. Other connections can use `window.lattice` when tools are unavailable.
- Desktop browser zoom, emulated pinch zoom, transformed page roots, hidden context, cancellation, and zero production footprint are covered.
- Real Safari and physical touch gestures remain manual checks. Full-page grids and loopback development hosts are supported; element grids, breakpoints, and cross-tab reconciliation remain deferred.
