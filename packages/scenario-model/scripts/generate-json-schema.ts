/**
 * Emit `schema/scenario.v1.schema.json` from the zod schema.
 *
 * Run with `pnpm --filter @scenario-studio/scenario-model schema`. The output is
 * committed, and `src/__tests__/json-schema.test.ts` fails if it drifts — so the
 * JSON Schema can never quietly fall behind the zod source of truth.
 *
 * `io: 'input'` because the file describes what may be *written* to disk, where
 * defaulted keys (`entities`, the reserved blocks, `meta.description`) are
 * optional. The serializer always writes them; hand-authored files need not.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildJsonSchema, JSON_SCHEMA_PATH } from '../src/json-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', JSON_SCHEMA_PATH);

writeFileSync(out, `${JSON.stringify(buildJsonSchema(), null, 2)}\n`);
process.stdout.write(`wrote ${out}\n`);
