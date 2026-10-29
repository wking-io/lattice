# Lattice agent integration

Run `npx --no-install lattice setup` in a consuming project after installing the package. It installs [the skill](skills/lattice/SKILL.md) and [API reference](skills/lattice/references/api.md), then adds this pointer to `AGENTS.md`:

```markdown
For Lattice page grid overlays, read `.agents/skills/lattice/SKILL.md`. Prefer the running page's WebMCP tools when available.
```

Existing instructions are preserved. The command refuses to overwrite a differing skill or reference. A package's internal skill is not assumed to be automatically discoverable.

## Access order

1. Discover `lattice_read` and `lattice_edit` through the target page's WebMCP connection. Read their actual schemas.
2. If unavailable, evaluate `await window.lattice.read()` and supported edits through `window.lattice.execute` or `.batch` on that page.
3. Use panel controls if browser evaluation is unavailable. **Copy agent context** is a read-only fallback.

All mutations share the Foldkit update flow, validation, history, and persistence. Inspect results rather than treating a queued request as success. `expectedRevision` provides optional stale-page protection. A grouped edit validates completely before changing the page.

Tools register only when `document.modelContext.registerTool` exists. Abort signals remove registrations on disposal. Cancellation is checked before dispatch; an already dispatched save can finish. JavaScript requests time out after 15 seconds with an explicitly uncertain result; timeout does not undo a write.

## Verification boundary

The JavaScript fallback has been tested against the running page. Browser tests exercise WebMCP registration, calls, and cleanup through a harness. Native WebMCP discovery from an external agent connection remains a release check; registration alone does not establish that every browser tool can discover it.
