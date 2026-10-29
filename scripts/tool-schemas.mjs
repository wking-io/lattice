import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'

// Generate on Node so browsers do not pay for JSON Schema generation.
export async function generateToolSchemas() {
  const result = await build({
    stdin: {
      contents: `import { Schema } from 'effect';
        import { toolInputs } from './src/browser/actions.ts';
        export default Object.fromEntries(Object.entries(toolInputs).map(([name, input]) => {
          const document = Schema.toJsonSchemaDocument(input, { onExcessProperty: 'error' });
          return [name, { ...document.schema, ...(Object.keys(document.definitions).length ? { $defs: document.definitions } : {}) }];
        }));`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  })
  const { default: schemas } = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`
  )
  await mkdir('src/generated', { recursive: true })
  await writeFile('src/generated/tool-schemas.json', JSON.stringify(schemas) + '\n')
  return schemas
}
