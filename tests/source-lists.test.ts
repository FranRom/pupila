import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KNOWN_SOURCES } from '../src/lib/fetch-runner.js';
import { SOURCES as MCP_SOURCES } from '../src/mcp/schemas/_constants.js';
import { SOURCES } from '../src/types.js';

// The canonical source list lives in src/types.ts. Most consumers derive from it
// (so they can't drift), but two places keep a hand-written copy that the type
// system can't reach across project / boundary lines:
//   - the UI *client* `Source` union (ui/src/types.ts) — a deliberate mirror that
//     must NOT import from src/* (keeps the client build decoupled).
// This test is the guard for those: it fails the moment any copy diverges.

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const canonical = [...SOURCES].sort();

/** Pull the string-literal members out of an `export type X = 'a' | 'b';` union. */
function extractUnionMembers(relPath: string, typeName: string): string[] {
  const text = readFileSync(resolve(REPO, relPath), 'utf8');
  const block = text.match(new RegExp(`export type ${typeName} =([^;]*);`));
  if (!block?.[1]) throw new Error(`no \`export type ${typeName}\` union found in ${relPath}`);
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1] as string).sort();
}

describe('source-list consistency', () => {
  it('fetch-runner KNOWN_SOURCES matches the canonical Source list', () => {
    expect([...KNOWN_SOURCES].sort()).toEqual(canonical);
  });

  it('MCP source enum matches the canonical Source list', () => {
    expect([...MCP_SOURCES].sort()).toEqual(canonical);
  });

  it('UI client Source union (manual mirror) matches the canonical Source list', () => {
    expect(extractUnionMembers('ui/src/types.ts', 'Source')).toEqual(canonical);
  });
});
