# Lattice agent integration

Run `npx --no-install lattice setup` in a consuming project after installing the package. It installs [the skill](skills/lattice/SKILL.md) and [API reference](skills/lattice/references/api.md), then adds this pointer to `AGENTS.md`:

```markdown
Before designing or changing page layouts, and when editing Lattice grids, read `.agents/skills/lattice/SKILL.md`. Use the page's configured grid even when hidden. If none is configured, ask whether to add one, recommending a verified grid from a similar project page or a suitable common preset. Prefer the running page's WebMCP tools when available.
```

Existing instructions are preserved. The command refuses to overwrite a differing skill or reference. A package's internal skill is not assumed to be automatically discoverable.

The skill applies to page layout work as well as overlay editing. Agents read configured grids regardless of visibility, align the page's CSS to them, and verify against measured geometry without changing visibility or the grid. When a page has no grid, agents inspect comparable project pages and offer a verified existing grid first, otherwise an appropriate common preset, plus alternatives and the option to proceed without one. Creating a grid waits for the user's choice. Comparable pages must be read in the same browser profile to access their saved configurations; the API currently reads one running page at a time.

## Access order

1. Discover `lattice_read` and `lattice_edit` through the target page's WebMCP connection. Read their actual schemas.
2. If unavailable, evaluate `await window.lattice.read()` and supported edits through `window.lattice.execute` or `.batch` on that page.
3. Use panel controls if browser evaluation is unavailable. **Copy agent context** is a read-only fallback.

All mutations share the Foldkit update flow, validation, history, and persistence. Inspect results rather than treating a queued request as success. `expectedRevision` provides optional stale-page protection. A grouped edit validates completely before changing the page.

Tools register only when `document.modelContext.registerTool` exists. Abort signals remove registrations on disposal. Cancellation is checked before dispatch; an already dispatched save can finish. JavaScript requests time out after 15 seconds with an explicitly uncertain result; timeout does not undo a write.

## Verification boundary

The JavaScript fallback has been tested against the running page. Browser tests exercise WebMCP registration, calls, and cleanup through a harness. Native WebMCP discovery from an external agent connection remains a release check; registration alone does not establish that every browser tool can discover it.
