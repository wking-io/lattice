# Lattice agent integration

Run `npx --no-install lattice setup` in a consuming project after installing the package. It installs [the skill](skills/lattice/SKILL.md) and [API reference](skills/lattice/references/api.md), then adds this pointer to `AGENTS.md`:

```markdown
Before designing or changing page layouts, and when editing Lattice grids, read `.agents/skills/lattice/SKILL.md`. Use the page's configured grid even when hidden. If none is configured, ask whether to add one, recommending a verified grid from a similar project page or a suitable common preset. Prefer the running page's WebMCP tools when available.
```

Existing instructions are preserved. The command refuses to overwrite a differing skill or reference. A package's internal skill is not assumed to be automatically discoverable.

The skill applies to page layout work as well as overlay editing. Agents read configured grids regardless of visibility, align the page's CSS to them, and verify against measured geometry without changing visibility or the grid. When a page has no grid, agents inspect comparable saved pages and offer a verified existing grid first, otherwise an appropriate common preset, plus alternatives and the option to proceed without one. Creating a grid waits for the user's choice. Saved-page discovery is read-only, stays within the current origin/project/browser profile, and needs no navigation. It returns stored settings, not other pages' live geometry.

## Access order

1. Discover `lattice_read`, `lattice_pages`, `lattice_edit`, and `lattice_presets` through the target page's WebMCP connection. Read their actual schemas. Shared file writes use the separate consequential `lattice_presets` tool.
2. If unavailable, use `window.lattice.read()`, `.listSavedPages()`, `.readSavedPage(url)`, and supported edits through `.execute` or `.batch` on that page.
3. Use panel controls if browser evaluation is unavailable. **Copy agent context** is a read-only fallback.

All mutations share the Foldkit update flow, validation, history, and persistence. Inspect results rather than treating a queued request as success. `expectedRevision` provides optional stale-page protection. A grouped edit validates completely before changing the page.

Tools register only when `document.modelContext.registerTool` exists. Abort signals remove registrations on disposal. Tool cancellation reaches the same request bridge as JavaScript `{ signal, timeoutMs }` options. Reads bypass pending writes. Queued cancellation prevents execution; active fetches abort, but accepted server writes may finish. The default request deadline is 15 seconds, with a separate 10-second fetch bound. Inspect `canceled`, `uncertain`, `saved`, `applied`, and `persisted` instead of assuming rollback. Inspect the returned preset ID before retrying a potentially accepted create.

## Verification boundary

The JavaScript fallback is tested in Chromium, Firefox, and WebKit. Tests cover both a registration harness and native WebMCP discovery/invocation through Playwright's external browser connection, including tool separation and disposal. Chromium requires `--enable-features=WebMCP` in this test environment; registration remains feature-detected. This does not establish support in every agent's browser connection, so keep the fallback order.
