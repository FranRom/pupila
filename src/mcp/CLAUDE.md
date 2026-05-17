# MCP server invariants

Scoped guidance for `src/mcp/`. Auto-loaded by Claude Code when working in this dir. Covers must-obey invariants AND the recipe for adding a new tool.

The hard invariants below are **must-obey** rules. Breaking any of them breaks the JSON-RPC channel, leaks paths, or corrupts the queue. No exceptions.

---

## Hard invariants. Do not break.

### 1. `stdout` is the JSON-RPC channel

A single stray `console.log` corrupts the framing and the MCP client silently drops the connection. `src/mcp/lib/stdout-guard.ts` patches `console.log/info/warn` → stderr **on import**, BEFORE any other module loads (it's the first import in `index.ts`).

- **Never write `console.log`** in tool code.
- **Never write `process.stdout.write`** outside the SDK.
- If you import a new lib that didn't exist when this was last verified, audit it for direct stdout writes.

### 2. Every `jobId` validates at the Zod layer

`JOB_ID_REGEX = /^[a-f0-9]{40}$/` in `src/mcp/schemas/_constants.ts` mirrors `isValidJobId` from `src/lib/apply-queue.ts` exactly. Use `jobIdSchema` from `_constants.ts` for every `jobId` field. Defense against path-traversal payloads — `data/applications/<jobId>.md` writes are real.

### 3. `SOURCES` tuple is compile-time-exhaustive

`SOURCES` in `src/mcp/schemas/_constants.ts` must match the `Source` union in `src/types.ts`. Adding a new fetcher source without mirroring it here is a typecheck error — see `_SourcesExhaustive` at the bottom of that file. **Do not delete that assertion** — it's the only thing keeping the two in sync.

### 4. `APPLICATION_STATUSES` lives in `src/types.ts`

Single source of truth. `VALID_STATUSES` in `ui/plugins/_shared.ts` is a `ReadonlySet<string>` wrapping the same const tuple. Adding a new status: edit `types.ts`, both UI and MCP pick it up. Don't fork.

### 5. Single-flight locks are load-bearing

- `trigger_fetch` — one aggregator run at a time, enforced in `src/lib/fetch-runner.ts`.
- `regenerate_profile` — one LLM regen at a time, enforced at module scope in `src/mcp/tools/regenerate-profile.ts`.

Second concurrent call returns an error envelope, **not** a queued/blocked promise. Don't refactor either to queue.

### 6. Worker separation is intentional

`enqueue_apply` adds a row to `data/apply-queue.json` but **does not** spawn the apply-worker — that's still `pnpm run apply-worker` in a separate terminal. If the worker isn't running, `enqueue_apply` returns a structured **warning** (NOT an error — the row is still queued, just won't drain).

Decoupling is intentional: a crashed worker can't take down the MCP server.

### 7. Error envelopes, never thrown rejections

Zod validation failures, precondition failures, and unknown-tool calls all come back as `{ isError: true, content: [{ type: 'text', text: ... }] }`.

- `safeHandler()` in `src/mcp/errors.ts` wraps every handler.
- `describeUnknown()` sanitizes absolute filesystem paths from error messages before they hit the client (defense in depth against `$HOME` leakage).

Never let an exception escape a handler.

---

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

## File map

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

## When something changes

- **README tool-reference table is hand-maintained.** Every tool change MUST update the `## MCP server` section in `README.md`. There is no codegen. See `openspec/changes/mcp-server-readme-docs/`.
- **Verify locally**: `pnpm run mcp` in one terminal, hit it from a connected client (Claude Code/Desktop/Cursor). Or use the in-process integration test.
- **CI smoke check** (when DEV-84 lands): `pnpm run mcp:smoke` will spawn the server, send `tools/list`, assert all expected tools present.

## Related

- `scripts/install-mcp.sh` — user-facing installer; idempotent.
- `tests/mcp/integration.test.ts` — wire-level test pattern via `InMemoryTransport.createLinkedPair`.
