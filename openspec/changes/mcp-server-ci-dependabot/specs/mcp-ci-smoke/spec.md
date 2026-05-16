## ADDED Requirements

### Requirement: CI runs an MCP smoke check on every push and PR

The `.github/workflows/check.yml` workflow SHALL execute a `MCP smoke` step on every push to `main` and every pull request. The step invokes `pnpm run mcp:smoke`, which boots `pnpm run mcp`, sends a single `tools/list` JSON-RPC request, and validates the response.

#### Scenario: A push to main runs the smoke check

- **GIVEN** a commit is pushed to `main`
- **WHEN** the check workflow runs
- **THEN** the `MCP smoke` step executes after the UI build
- **AND** the workflow fails IF the step exits non-zero

#### Scenario: The smoke check has a hard timeout

- **GIVEN** the MCP server hangs during startup
- **WHEN** `pnpm run mcp:smoke` runs
- **THEN** it MUST exit non-zero within 30 wall-clock seconds, even if the server never responds

### Requirement: Smoke check works without any user data

The smoke script SHALL succeed on a fresh checkout with no `data/jobs.json`, no `config/profile.json`, no `config/candidate-brief.md`. The check validates server boot + tool registration ONLY — not tool execution against real data.

#### Scenario: A fresh CI runner with no data files

- **GIVEN** an `ubuntu-latest` runner with the repo just cloned (no gitignored files materialized)
- **WHEN** `pnpm run mcp:smoke` runs
- **THEN** it exits 0
- **AND** the response is asserted against the canonical 17-tool list

### Requirement: Every registered tool appears in the smoke check expected list

The smoke script SHALL maintain an explicit list of expected tool names. Whenever a new tool is registered in `src/mcp/server.ts`, the smoke script's expected list MUST be updated in the same PR.

#### Scenario: A new tool is added without updating the smoke

- **GIVEN** a PR adds `register<NewTool>()` to `src/mcp/server.ts` but does NOT update `scripts/mcp-smoke.mjs`
- **WHEN** the smoke runs in CI
- **THEN** the check passes (the new tool is extra, not missing) — but CI does NOT enforce parity in this direction; reviewer responsibility

#### Scenario: A tool is removed without updating the smoke

- **GIVEN** a PR removes `registerListJobs()` from `src/mcp/server.ts` but leaves it in `scripts/mcp-smoke.mjs` expected list
- **WHEN** the smoke runs in CI
- **THEN** the check FAILS with `[mcp-smoke] missing tool: list_jobs`

### Requirement: Dependabot groups MCP runtime deps

The `.github/dependabot.yml` SHALL define an `mcp-deps` group containing `@modelcontextprotocol/sdk` and `zod`. Minor and patch updates for these packages SHALL land as a single grouped PR.

#### Scenario: SDK and zod both have patch releases the same week

- **GIVEN** `@modelcontextprotocol/sdk@1.29.1` and `zod@4.4.4` both publish before the weekly refresh
- **WHEN** Dependabot opens its next batch of PRs
- **THEN** exactly one PR exists with the title `Bump the mcp-deps group ...`
- **AND** it contains both updates

#### Scenario: A major-version bump arrives

- **GIVEN** `@modelcontextprotocol/sdk@2.0.0` publishes
- **WHEN** Dependabot processes it
- **THEN** the major bump opens as its OWN ungrouped PR — major versions are explicitly excluded from the group's `update-types` filter
