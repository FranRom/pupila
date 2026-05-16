---
name: pupila-mcp-tools
description: How to add, modify, or test a tool exposed by the MCP server in this repo. Use when extending the MCP server's tool list, exposing a new capability to Claude Code/Desktop/Cursor over JSON-RPC, writing Zod schemas for MCP inputs, or wiring a tool runner to src/lib/* functions.
metadata:
  scope: pupila / job-hunt
---

The MCP server lives at `src/mcp/` and exposes 17 typed tools (v1) to any MCP client. Entry point is `pnpm run mcp` → `tsx src/mcp/index.ts`. Tools call directly into `src/lib/*` — same code path the UI and apply-worker use. **No HTTP shim, no subprocess layer.**

**Companion invariants:** `src/mcp/CLAUDE.md` (auto-loaded when working in `src/mcp/`) — HARD rules that must not be broken (stdout JSON-RPC, JOB_ID_REGEX, single-flight locks, worker separation, error envelopes). Read those first; this skill covers the procedural side.

## Add a new tool (4 steps)

Every new tool needs exactly 4 touchpoints:

### 1. Zod schema → `src/mcp/schemas/<name>.ts`

Define the raw input shape. Reuse `jobIdSchema` from `_constants.ts` for any `jobId` field — that's what enforces `^[a-f0-9]{40}$` (mirrors `isValidJobId` from `src/lib/apply-queue.ts`).

```ts
import { z } from 'zod';
import { jobIdSchema } from './_constants.ts';

export const fooInputShape = {
  jobId: jobIdSchema,
  // ...
};
export const fooInputSchema = z.object(fooInputShape);
export type FooInput = z.infer<typeof fooInputSchema>;
```

### 2. Tool implementation → `src/mcp/tools/<name>.ts`

Export both `run<Name>` (the runner — dependency-inject paths for testability) and `register<Name>` (the SDK wiring).

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeHandler, toolJson } from '../errors.ts';
import { defaultPaths, type Paths } from '../paths.ts';
import { fooInputShape, type FooInput } from '../schemas/foo.ts';

export async function runFoo(input: FooInput, paths: Paths = defaultPaths()) {
  // call into src/lib/* — same functions UI middleware uses
  return toolJson({ ok: true, ... });
}

export function registerFoo(server: McpServer) {
  server.tool(
    'foo',
    'one-line description shown to clients',
    fooInputShape,
    safeHandler<FooInput>('foo', (input) => runFoo(input)),
  );
}
```

### 3. Register → `src/mcp/server.ts`

Import and call `registerFoo(server)` inside `createMcpServer()`. Keep registrations grouped by category (Read / Applied / Queue / Aux / Long-running) — order matches the README tool-reference table.

### 4. Tests → `tests/mcp/<name>.test.ts`

Test `run<Name>` directly with the path-injection escape hatch (faster, deterministic). For full wire coverage, also add a case to `tests/mcp/integration.test.ts` (uses the real SDK `Client` over `InMemoryTransport.createLinkedPair`).

## Hard invariants (refresher)

These come from `src/mcp/CLAUDE.md`. Worth re-stating because new-tool work bumps into them often:

- **Never `console.log`** anywhere in tool code or in any `src/lib/*` function reachable from a tool. `src/mcp/lib/stdout-guard.ts` patches `console.log/info/warn` → stderr on import, but `process.stdout.write` from a fresh dep would still corrupt JSON-RPC framing. Audit imports.
- **Every `jobId` parameter validates via `jobIdSchema`** at the Zod layer (defense against path-traversal payloads — `data/applications/<jobId>.md` writes are real).
- **`SOURCES` tuple in `src/mcp/schemas/_constants.ts` is exhaustive** vs the `Source` union in `src/types.ts`. Adding a new fetcher source without mirroring it here is a typecheck error (`_SourcesExhaustive` at the bottom of `_constants.ts`).
- **`APPLICATION_STATUSES` in `src/types.ts` is the single source of truth** — `VALID_STATUSES` in `ui/plugins/_shared.ts` re-wraps the same const tuple. New status = one edit in `types.ts`, both UI and MCP pick it up.
- **Single-flight locks** on `trigger_fetch` (`src/lib/fetch-runner.ts`) and `regenerate_profile` (module-scope in the tool file). Second concurrent call returns an error envelope — never queued.
- **Worker separation**: `enqueue_apply` writes a queue row but does NOT spawn the worker. If the worker isn't running, return a structured warning, not an error.
- **Error envelopes, never thrown rejections**. `safeHandler` wraps every handler; `describeUnknown` sanitizes absolute filesystem paths from error messages (defense in depth against `$HOME` leakage).

## After landing a tool change

1. **Update the README tool-reference table** in `## MCP server` (hand-maintained — no codegen). The OpenSpec proposal at `openspec/changes/mcp-server-readme-docs/` documents the obligation.
2. **Verify locally**: `pnpm run mcp` in one terminal, hit it from a connected client (Claude Code/Desktop/Cursor). Or use the in-process integration test.
3. **CI smoke check** (when DEV-84 lands): `pnpm run mcp:smoke` will spawn the server, send `tools/list`, assert all expected tools present.

## File map (current)

```
src/mcp/
  index.ts            # stdio entrypoint; imports lib/stdout-guard.ts FIRST
  server.ts           # createMcpServer() factory — every tool registered here
  paths.ts            # REPO_ROOT via import.meta.url (mirror of ui/plugins/_paths.ts)
  errors.ts           # safeHandler + toolError/toolJson envelopes
  lib/
    stdout-guard.ts   # console.* → stderr (MUST be first import)
    worker-probe.ts   # probes data/apply-worker.pid for liveness
    fetch-runner.ts   # singleton state machine for trigger_fetch
  schemas/
    _constants.ts     # JOB_ID_REGEX, SOURCES exhaustive tuple, jobIdSchema
    <name>.ts         # per-tool raw shape
  tools/
    <name>.ts         # run<Name> + register<Name>
```

## Related

- `src/mcp/CLAUDE.md` — invariants (auto-loaded in src/mcp/).
- `tests/mcp/integration.test.ts` — wire-level test pattern.
- `scripts/install-mcp.sh` — user-facing installer; rarely needs edits when adding tools.
