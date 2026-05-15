## ADDED Requirements

### Requirement: README documents the MCP server install path

The `README.md` SHALL include a top-level `## MCP server` section that, at minimum, presents the one-line install command (`bash scripts/install-mcp.sh`) AND the verification command (`claude mcp list`).

#### Scenario: A new user installs the MCP server from the README

- **GIVEN** a user has cloned the repo
- **WHEN** they read `README.md` linearly
- **THEN** they find the `## MCP server` heading within the document
- **AND** the section contains the literal string `bash scripts/install-mcp.sh`
- **AND** the section contains the literal string `claude mcp list`

### Requirement: README documents every registered MCP tool

The `README.md` `## MCP server` section SHALL include a tool reference covering every tool registered by `createMcpServer()` in `src/mcp/server.ts`. Each tool documented MUST appear in the live `tools/list` JSON-RPC response.

#### Scenario: A reader counts tools in the README

- **GIVEN** the README's tool-reference table
- **WHEN** counted against the names returned by `tools/list` from `pnpm run mcp`
- **THEN** the two sets match exactly (no missing, no extra)

#### Scenario: A new tool is added to the server

- **GIVEN** a new file under `src/mcp/tools/` calling `server.registerTool(...)`
- **WHEN** the PR adding it is opened
- **THEN** the PR MUST also update the README tool-reference table — the obligation is documented in `CLAUDE.md`

### Requirement: README documents at least six troubleshooting scenarios

The `## MCP server` section SHALL include a "Troubleshooting" subsection covering at minimum:
1. MCP client does not list `pupila` after install
2. `enqueue_apply` returns a worker-not-running warning
3. `regenerate_profile` returns a precondition error
4. `list_jobs` returns zero rows on a fresh clone
5. Garbled output / JSON-RPC framing corruption
6. `scripts/install-mcp.sh` exits on missing prereq

#### Scenario: A user hits a failure not in the troubleshooting list

- **GIVEN** a documented failure mode missing from the section
- **WHEN** a user files an issue
- **THEN** the maintainer adds the failure mode to the README before closing — the section is a living rolodex, not a one-shot doc

### Requirement: CLAUDE.md documents the MCP server architecture

The hand-maintained `CLAUDE.md` SHALL include a `## MCP server` section paralleling the existing Settings / Jobs / Jinder documentation depth, covering the repo layout under `src/mcp/`, the stdio-transport invariant (no `console.log`), and the per-tool single-flight invariants.

#### Scenario: A future Claude Code session reads CLAUDE.md

- **GIVEN** a future agent navigating `src/mcp/` for the first time
- **WHEN** they read `CLAUDE.md` end-to-end
- **THEN** they find the architecture rationale, the stdio invariant, and the single-flight locks WITHOUT reading any source code
