## Why

The MCP feature added two runtime deps (`@modelcontextprotocol/sdk@1.29.0`, `zod@4.4.3`) on a fast version cadence. The existing `.github/workflows/check.yml` runs `pnpm typecheck` / `pnpm test` / `pnpm run lint` — but those gates exercise tool runners directly via Vitest, NOT the protocol round-trip. A regression in the SDK or in our stdio bootstrap (e.g., a stray `console.log` from a freshly-imported lib corrupting the JSON-RPC frame) would slip past CI today.

Separately, Dependabot opens weekly grouped npm PRs but has no group for the MCP deps. Without grouping, an SDK bump and a zod bump arrive as two PRs that BOTH need review of the same surface — wasteful.

## What Changes

- Add an `mcp:smoke` script to `package.json` that pipes a single `tools/list` JSON-RPC request to `pnpm run mcp` via stdin and asserts the response contains all 17 expected tool names. Pure black-box check — no Vitest, no SDK Client; verifies the framing + registration end-to-end.
- Add an `MCP smoke` step to `.github/workflows/check.yml` after `pnpm run ui:build` and before `pnpm run lint:bundle-size`. Runs `pnpm run mcp:smoke` with a hard 30s timeout.
- Add an `mcp-deps` group to `.github/dependabot.yml` containing `@modelcontextprotocol/sdk` and `zod`. Weekly cadence (matches the existing config). Patch + minor bumps land in one PR.

The smoke test MUST work on a fresh CI checkout — no `data/jobs.json`, no `config/profile.json`, no `config/candidate-brief.md`. Tools that depend on those files already return clean empty/error responses on missing files (verified by existing unit tests), so the smoke check only validates that the SERVER itself boots and registers tools.

## Capabilities

### New Capabilities

- `mcp-ci-smoke`: A CI gate that boots `pnpm run mcp`, sends a single `tools/list` JSON-RPC request, and fails the job if the response is missing any of the 17 registered tools — independent of Vitest's in-process integration suite.

### Modified Capabilities

_None — `dependabot.yml` is configuration, not a capability spec._

## Impact

- **Files touched:** `package.json` (one new script), `.github/workflows/check.yml` (one new step), `.github/dependabot.yml` (one new group entry).
- **CI runtime:** +5–15s for the smoke step (server boot + one request + teardown).
- **Affected APIs:** none — read-only check.
- **Risk:** the smoke script must NOT depend on user data files; broken if it does. Failure modes covered by the smoke check today are already covered by the in-process integration suite (`tests/mcp/integration.test.ts`) — the smoke adds value as a defense against environment-level regressions (Node version mismatch, missing executable bit on tsx, SDK API drift) that an in-process test can't catch.
- **Dependabot:** existing PRs already in flight will not be re-grouped; the change takes effect for the next refresh cycle.
