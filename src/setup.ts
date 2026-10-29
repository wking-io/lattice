#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { realpathSync } from 'node:fs'

export async function installSkill(
  root: string,
  packageRoot = fileURLToPath(new URL('..', import.meta.url)),
): Promise<void> {
  const destination = path.join(root, '.agents/skills/lattice')
  const source = await readFile(path.join(packageRoot, 'skills/lattice/SKILL.md'), 'utf8')
  await mkdir(destination, { recursive: true })
  const skill = path.join(destination, 'SKILL.md')
  try {
    await writeFile(skill, source, { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    if ((await readFile(skill, 'utf8')) !== source)
      throw new Error(`Existing Lattice skill differs; merge it manually: ${skill}`)
  }
  const reference = await readFile(
    path.join(packageRoot, 'skills/lattice/references/api.md'),
    'utf8',
  )
  await mkdir(path.join(destination, 'references'), { recursive: true })
  const referencePath = path.join(destination, 'references/api.md')
  try {
    await writeFile(referencePath, reference, { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    if ((await readFile(referencePath, 'utf8')) !== reference)
      throw new Error(`Existing Lattice API reference differs; merge it manually: ${referencePath}`)
  }
  const agentsFile = path.join(root, 'AGENTS.md')
  let existing = ''
  try {
    existing = await readFile(agentsFile, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (!existing.includes('.agents/skills/lattice/SKILL.md'))
    await writeFile(
      agentsFile,
      `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}\nBefore designing or changing page layouts, and when editing Lattice grids, read \`.agents/skills/lattice/SKILL.md\`. Use the page's configured grid even when hidden. If none is configured, ask whether to add one, recommending a verified grid from a similar project page or a suitable common preset. Prefer the running page's WebMCP tools when available.\n`,
    )
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== 'setup' || process.argv.length > 4) {
    console.error('Usage: lattice setup [project-directory]')
    process.exitCode = 1
  } else {
    installSkill(path.resolve(process.argv[3] ?? '.'))
      .then(() => console.log('Installed the Lattice agent skill and added its AGENTS.md pointer.'))
      .catch((error) => {
        console.error(error.message)
        process.exitCode = 1
      })
  }
}
