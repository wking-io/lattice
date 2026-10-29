# Lattice

Visual page grids for local web development. Layer columns, rows, and draggable guides over any Vite application. People and agents edit the same settings.

Built with **Effect 4 and Foldkit**, isolated in a shadow root. The host application can use any framework. The Vite plugin injects Lattice only during development; production builds contain no Lattice runtime, styles, or configuration.

The package is **`@riff-refine/lattice`**, licensed under [MIT](LICENSE). See the [0.1.0 release](https://github.com/wking-io/lattice/releases/tag/v0.1.0) for release artifacts and publication status.

## Try it

Use Node 24 LTS:

```sh
npm ci
npm run dev
```

Open the playground at `http://127.0.0.1:5173`. The panel starts visible with an empty page grid. Add items or apply a preset. Drag the panel by its heading.

## Install in another project

Install a published npm release:

```sh
npm install --save-dev @riff-refine/lattice@0.1.0
```

Alternatively, download the package tarball from the GitHub release or build one from this repository:

```sh
npm pack
```

In the consuming project:

```sh
npm install --save-dev /path/to/lattice/riff-refine-lattice-0.1.0.tgz
```

Add the plugin to `vite.config.ts`. Do not import the browser runtime into application code.

```ts
import { defineConfig } from 'vite'
import { lattice } from '@riff-refine/lattice/vite'

export default defineConfig({
  plugins: [lattice()],
})
```

Lattice supports loopback hosts (`localhost`, `*.localhost`, `127.x.x.x`, and `::1`). It is absent from production builds and Vite preview. LAN and remote development hosts are outside this version.

## Grids and guides

- **Columns:** count, gutter, stretch margins, or fixed width with left/center/right alignment.
- **Rows:** the same controls, measured against full document height. Auto count with fixed height and zero gutter makes a baseline grid.
- **Individual:** horizontal or vertical, in pixels or percent. Drag to move; Alt/Option-drag duplicates. Pixel drags snap to whole CSS pixels; percentage guides keep their units. Numeric entry accepts fractions.
- **Preset:** an independent snapshot of columns, rows, and individual guides. Unlink it before editing its contents. Use **Update from preset** to adopt source changes explicitly.

Every line is **1 CSS pixel**. Columns use viewport content width excluding the scrollbar. Vertical percentages use that width; horizontal percentages use document height. Resizing recalculates stretch and percentage geometry without changing saved values. Auto count requires fixed-size alignment; center ignores offset. Invalid stretch dimensions show a warning instead of reversed grids.

Only individual guides intercept pointer events. Generated grids have transparent interiors and draw both boundaries, deduplicating shared boundaries. Off-screen guides remain saved. Rendering is culled to the viewport and capped at 5,000 lines, with a visible warning for excessive density.

## Shortcuts

| Action                            | Shortcut                                        |
| --------------------------------- | ----------------------------------------------- |
| Toggle grids                      | Alt/Option + G                                  |
| Toggle panel                      | Alt/Option + Shift + G                          |
| Click through individual guides   | Hold Command on macOS, Control on Windows/Linux |
| Duplicate while dragging          | Alt/Option                                      |
| Undo                              | Command/Control + Z                             |
| Redo                              | Command/Control + Shift + Z; Control + Y        |
| Move a focused individual guide   | Arrow keys; Shift for 10 units                  |
| Delete a focused individual guide | Delete/Backspace                                |
| Cancel a drag                     | Escape                                          |

Grid hiding also hides the panel. Showing grids restores the panel's previous visibility; the panel shortcut can reveal both. A hidden panel leaves no launcher. Toggle shortcuts ignore text inputs. Undo/redo belongs to Lattice only while its controls or guides have focus; text controls retain native text undo.

History holds up to 100 edits, lasts for the current page session, and resets on refresh or navigation. One drag or agent batch is one step. Master visibility is a separate preference and is not an undo step.

## Project presets

```ts
lattice({
  builtInPresets: true, // false omits the six built-ins
  presetsFile: './lattice.presets.json', // relative to Vite's root
  projectId: 'my-project', // optional stable browser-storage namespace
  presets: [
    {
      id: 'editorial',
      name: 'Editorial',
      items: [
        { kind: 'columns', count: 12, gutter: 20, margin: 20 },
        { kind: 'rows', count: 'auto', alignment: 'min', size: 8, gutter: 0 },
      ],
    },
  ],
})
```

The six built-ins are 4-, 8-, 12-, and 16-column layouts plus 4px and 8px baselines. Built-ins and inline definitions are read-only in the panel. File presets can be created or deleted through the panel; agents can also replace an existing file definition. Sources are identified as `builtin:ID`, `inline:ID`, and `file:ID`; display names can repeat.

**Save preset** asks for a name and selected page items. It creates the JSON file if necessary, saves the definition, then groups the selected items into one applied preset. Included preset contents are copied, never nested. Undo restores previous page items and keeps the file definition. Delete a shared definition explicitly; applied snapshots remain usable.

The JSON file is ordinary repository configuration:

```json
{
  "version": 1,
  "presets": [
    {
      "id": "editorial",
      "name": "Editorial",
      "items": [{ "kind": "columns", "count": 12, "gutter": 20, "margin": 20 }]
    }
  ]
}
```

Manual file edits reload the catalog. Existing page snapshots stay unchanged. Invalid files and stale writes fail visibly; Lattice does not overwrite unreadable configuration. Preset files must be inside the Vite root with no symlinks in the configured relative path. Writes use a cross-process lock and atomic replacement. A crashed writer can leave a `.lock` file: remove it only after confirming no writer remains. External editors do not participate in the lock, so avoid editing the file at the same instant as a panel save.

Commit the preset file through your normal Git workflow to share it with teammates. Lattice does not create commits or synchronize working copies.

## Browser persistence

Applied page grids live in localStorage, scoped by project, origin, and path. The default project ID hashes the real Vite root; set `projectId` to keep browser state when moving the checkout. Query URLs inherit the base grid until edited, then get an independent override. The first edit without any saved base creates the base configuration. **Reset to base grid** removes the query override.

Query keys are sorted while repeated values retain their order. Hash fragments do not affect identity; hash routers and configurable URL matching are deferred. Master visibility is remembered separately. Panel position and undo history last only for the session. Storage failures are reported, with edits retained in memory and marked unpersisted.

## Agents

Install the included skill in a consuming project:

```sh
npx --no-install lattice setup
```

This copies the skill and API reference into `.agents/skills/lattice/` and appends a pointer to `AGENTS.md`, preserving existing instructions. Differing existing skill files require a manual merge.

The skill directs agents to read and align layouts to the page's configured grid even when it is hidden. If no grid exists, agents ask whether to add one, recommending a verified grid from a similar project page first, otherwise a suitable common preset. Grid creation waits for the user's choice; existing grids and visibility are preserved during layout work.

Prefer the running page's **WebMCP** tools: `lattice_read` for context, `lattice_pages` for saved-page discovery, `lattice_edit` for browser edits, and `lattice_presets` for shared file writes. Registration is feature-detected on `document.modelContext`. If the browser connection cannot discover them, use the JavaScript fallback:

```js
const before = await window.lattice.read()
const result = await window.lattice.batch(
  [
    { type: 'add', item: { kind: 'columns', count: 12, gutter: 20, margin: 20 } },
    { type: 'add', item: { kind: 'rows', count: 'auto', alignment: 'min', size: 8, gutter: 0 } },
  ],
  { expectedRevision: before.revision },
)
```

This is additive and creates one undo step. Results acknowledge model changes and storage outcomes; DOM painting follows on the browser's next frame. Check `ok`, `applied`, `persisted`, and `error`. Preset saves also report `saved` and `presetId`: a file save can succeed while page application or browser persistence fails. Read before retrying an uncertain result. The API remains available while all UI is hidden.

`window.lattice.listSavedPages()` lists stored grids for the current origin and project. `readSavedPage('/another-route')` reads their settings, including hidden items and query inheritance, without navigating. These are persisted settings rather than another page's live geometry.

Reads remain responsive during pending writes. `execute` and `batch` accept `{ signal, timeoutMs }` alongside `expectedRevision`; requests default to 15 seconds. Canceling queued work prevents execution. Aborting a dispatched preset request cannot guarantee the server did not write: check `canceled`, `uncertain`, and `presetId` before retrying. Completed changes are not rolled back by cancellation.

See [API examples and operations](skills/lattice/references/api.md), [agent integration](agent-integration.md), and the exported TypeScript types.

## Development and status

```sh
npm run check          # type checks, core/server tests, package build
npm run test:browser   # Chromium, Firefox, and WebKit integration tests
```

The packed-consumer check runs with `npm pack --pack-destination /tmp` followed by `node scripts/verify-package.mjs`. Set `LATTICE_TEST_VITE=7` for the second supported major; the default is Vite 8. It installs the tarball in a temporary project and checks compressed delivery, a nested Vite base, built-in omission, inline/file presets, agent setup, production output, and preview isolation.

Install test browsers with `npx playwright install chromium firefox webkit`. Browser tests use a separate port and test preset fixture. CI uses Node 24, all three engines on Linux, and packed consumers on Vite 7 and 8.

Verified locally across Chromium, Firefox, and WebKit: panel/API editing, dragging, shortcuts, persistence, navigation, preset writes/watch updates, cleanup, cancellation, saved-page discovery, and transformed root/body layouts. Chromium additionally covers native WebMCP through Playwright's external browser connection (with `--enable-features=WebMCP`), real desktop zoom through the browser extension API, and protocol-emulated pinch zoom. This does not verify every agent connection or physical touch gesture. Real Safari automation remains unchecked because its Remote Automation setting is disabled; WebKit coverage is separate.

The development client is approximately **636 KB minified, 196 KB gzip, or 167 KB Brotli**. The server negotiates precompressed assets. Production builds with and without Lattice still produce identical application files. Build-time size budgets and `dist/bundle-report.json` track regressions; [architecture](ARCHITECTURE.md#bundle-strategy) explains the remaining runtime cost. Shared browser-storage writes across tabs still use last write wins.

- [Product plan](PLAN.md)
- [Implementation architecture and handoff](ARCHITECTURE.md)
- [Public repository](https://github.com/wking-io/lattice)
