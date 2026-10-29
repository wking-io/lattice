import { expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { installSkill } from '../src/setup.js'

it('installs agent guidance idempotently while preserving existing instructions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-setup-'))
  try {
    await writeFile(path.join(root, 'AGENTS.md'), 'Keep these instructions.\n')
    await installSkill(root)
    await installSkill(root)
    const instructions = await readFile(path.join(root, 'AGENTS.md'), 'utf8')
    expect(instructions).toContain('Keep these instructions.')
    expect(instructions.match(/SKILL.md/g)).toHaveLength(1)
    expect(await readFile(path.join(root, '.agents/skills/lattice/SKILL.md'), 'utf8')).toContain(
      'WebMCP',
    )
    await writeFile(path.join(root, '.agents/skills/lattice/SKILL.md'), 'Custom guidance')
    await expect(installSkill(root)).rejects.toThrow('merge it manually')
    expect(await readFile(path.join(root, '.agents/skills/lattice/SKILL.md'), 'utf8')).toBe(
      'Custom guidance',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
