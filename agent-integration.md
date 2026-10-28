# Lattice agent integration draft

Bundle [the skill](skills/lattice/SKILL.md) with the development package. During setup, install it in the consuming project's skill directory and add the following pointer to its agent instructions, preserving existing content. For Codex, use `.agents/skills/lattice/SKILL.md`; see [skill discovery](https://learn.chatgpt.com/docs/build-skills).

```markdown
For Lattice page grid overlays, use `.agents/skills/lattice/SKILL.md`.
Prefer the running page's WebMCP tools whenever supported.
```

These are draft instructions. The runtime integration and setup command remain to be implemented.
