## Why

The MCP server now exposes 17 tools spanning every actionable UI surface (read / write / queue / aux / long-running). Today the only documentation is the inline tool `description` field — discoverable from inside an MCP client, but invisible to anyone deciding whether to install the server or troubleshooting a broken setup.

CLAUDE.md is explicit that `README.md` is **hand-maintained** — the pipeline never overwrites it. All MCP-facing docs must be authored as a manual edit, modeled on the existing README walkthrough sections.

This change sequences last in the v1 epic because the tool surface had to stabilize first; the 17 tools are now locked.

## What Changes

- New `## MCP server` section in `README.md` covering:
  - **One-line install** (`bash scripts/install-mcp.sh`) — the canonical entry point from a cloned repo.
  - **Verifying the install** — `claude mcp list` expected output + restart-required note for Claude Desktop and Cursor.
  - **Tool reference** — table of all 17 tools grouped by category (Read / Applied / Queue / Aux / Long-running), one-sentence description per tool, "called by" mapping to the UI control it mirrors.
  - **Troubleshooting** — six failure modes drawn from the build's risk notes: stale PID file, worker-not-running enqueue, no LLM CLI detected, `jobs.json` missing, JSON-RPC framing corruption from a stray `console.log`, install-script prereq failure.
  - **Architecture note** — one-paragraph "MCP server is the fourth direct consumer of `src/lib/*`" pointer to `src/mcp/`.
- Update `CLAUDE.md` with a new `## MCP server` subsection paralleling the existing Settings / Jobs / Jinder docs, listing the tool surface and pointing at `src/mcp/` for future Claude Code sessions.

This is **doc only** — no code changes, no test changes. README and CLAUDE.md are the only files touched.

## Capabilities

### New Capabilities

- `mcp-server-docs`: User-facing documentation for the MCP server feature — install flow, tool reference, troubleshooting. Lives in the hand-maintained `README.md` and the Claude-Code-facing `CLAUDE.md`.

### Modified Capabilities

_None — this is net-new documentation; no existing spec changes._

## Impact

- **Files touched:** `README.md`, `CLAUDE.md`. No code, no tests, no CI.
- **Affected APIs:** none.
- **Affected dependencies:** none.
- **Risk:** none on the runtime path. Sole risk is doc drift — every future MCP tool change must update the tool-reference table. Add a CLAUDE.md note to that effect to make the obligation explicit.
- **Audience:** any user installing the MCP server via `scripts/install-mcp.sh` + any future Claude Code session navigating `src/mcp/`.
