// Genera i JSON Schema in spec/schemas/ a partire dagli schemi zod.
import { writeFileSync, mkdirSync } from 'node:fs';
import { schemas } from '../src/index.ts';
const out = new URL('../../../spec/schemas/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const [name, make] of Object.entries(schemas)) {
  writeFileSync(new URL(`${name}.schema.json`, out), JSON.stringify(make(), null, 2) + '\n');
  console.log(`spec/schemas/${name}.schema.json`);
}
