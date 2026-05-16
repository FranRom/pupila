# MCP server invariants

Scoped guidance for `src/mcp/`. Auto-loaded by Claude Code when working in this dir. For the **procedural** side (how to add a tool, schema/runner/registration steps), see the `pupila-mcp-tools` skill.

This file is **invariants only** — must-obey rules. Breaking any of these breaks the JSON-RPC channel, leaks paths, or corrupts the queue. No exceptions.

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

## When something changes

- **README tool-reference table is hand-maintained.** Every tool change MUST update the `## MCP server` section in `README.md`. There is no codegen. See `openspec/changes/mcp-server-readme-docs/`.
- **CI smoke check** (when DEV-84 lands): `pnpm run mcp:smoke` will spawn the server, send `tools/list`, assert all expected tools present.

## Related

- **Procedural how-to:** `pupila-mcp-tools` skill (4-step recipe for adding a tool).
- `scripts/install-mcp.sh` — user-facing installer; idempotent.
- `tests/mcp/integration.test.ts` — wire-level test pattern via `InMemoryTransport.createLinkedPair`.
