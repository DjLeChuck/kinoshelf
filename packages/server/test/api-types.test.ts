import { readFile, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import openapiTS, { astToString } from 'openapi-typescript';
import type { OpenAPI3 } from 'openapi-typescript';
import { cleanup, harness } from './harness.js';

afterEach(cleanup);

// The web reads the API through types it writes by hand; this file is the API's own, generated
// from its schemas. `packages/web/test/api-types.check.ts` ties the two together at compile time,
// so a field that changes on one side breaks the build instead of the page.
// Regenerate with `UPDATE_API_TYPES=1 pnpm test`.
const FILE = new URL('../../web/src/lib/api-schema.d.ts', import.meta.url);

describe('the API types the web checks itself against', () => {
  it('match the schemas the server declares', async () => {
    const h = await harness();
    const spec = h.app.swagger() as unknown as OpenAPI3;
    const generated =
      "// Generated from the server's schemas by packages/server/test/api-types.test.ts: do not edit.\n" +
      astToString(await openapiTS(spec));
    if (process.env.UPDATE_API_TYPES) {
      await writeFile(FILE, generated);
    }
    expect(await readFile(FILE, 'utf8')).toBe(generated);
  });
});
