# Lattice

Visual grid guides for local web development, configurable by people and agents.

Lattice is in planning. This repository contains the product plan and agent guidance; the installable library is not implemented yet.

## Planned capabilities

- 1px overlays with bright preset colors and custom colors.
- Figma-style column and row grids, plus draggable pixel or percentage guides.
- Reusable presets that can be combined, unlinked, and explicitly updated.
- A floating panel and separate shortcuts for panel and grid visibility.
- Browser storage that remembers grids by URL.
- Agent reads and edits through WebMCP, with a documented JavaScript API fallback.
- Local development integration that adds no JavaScript or CSS to production bundles.

The guides are visual overlays and do not change the page's layout.

## Project documents

- [Plan and open decisions](PLAN.md)
- [Compact agent skill](skills/lattice/SKILL.md)
- [Agent integration guidance](agent-integration.md)

Package naming, the initial development integration, and licensing are still open decisions. No package has been published.
