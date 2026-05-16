## Tasks

### 1. README — MCP server section

- [ ] Open `README.md`. Find the existing "Local UI" / "AI per-job review" sections — model the new `## MCP server` heading on their depth (≤ 80 lines total, code-blocks-and-tables heavy).
- [ ] Add the one-line install command at the top of the section: `bash scripts/install-mcp.sh` (note: must be run from a cloned repo, not via curl|bash — the script is repo-coupled).
- [ ] Add the **Verifying the install** subsection with expected `claude mcp list` output showing `pupila` registered, plus a "restart Claude Desktop / Cursor to load" note.
- [ ] Add the **Tool reference** table grouped by category. Five columns: tool name, category, input fields, returns, UI equivalent. All 17 tools — copy the live `description` fields from `src/mcp/tools/*.ts`.
- [ ] Add the **Troubleshooting** subsection covering exactly six failure modes:
  - [ ] `claude mcp list` does not show `pupila` after install (Claude Desktop / Cursor not restarted)
  - [ ] `enqueue_apply` returns warning "Apply worker is not running" (start `pnpm run apply-worker` in another terminal)
  - [ ] `regenerate_profile` returns precondition error (run `pnpm run setup-brief --file ~/cv.pdf` first)
  - [ ] `list_jobs` returns `total: 0` on a fresh clone (run `pnpm run dev` once to seed `data/jobs.json`)
  - [ ] User sees garbled output in their MCP client (a tool somewhere logged to stdout — file a bug citing `src/mcp/lib/stdout-guard.ts`)
  - [ ] `scripts/install-mcp.sh` exits 1 with "missing prerequisite" (install node 22 / pnpm / git per the prereq-check failure message; **never** auto-install)
- [ ] Add the **Architecture** paragraph at the bottom of the section: "The MCP server is the fourth direct consumer of `src/lib/*` (alongside Vite middleware, apply-worker, and `pnpm run ai-review`). Tools live in `src/mcp/tools/`, shared logic in `src/lib/`." Link to `src/mcp/`.

### 2. CLAUDE.md — MCP server subsection

- [ ] Add a new `## MCP server` section after `## AI per-job review`, modeled on the existing `## Jinder (swipe-to-apply)` depth.
- [ ] Cover: repo layout (`src/mcp/{index,server,paths,errors}.ts`, `src/mcp/{schemas,tools,lib}/`), entry point (`pnpm run mcp` / `tsx src/mcp/index.ts`), stdio-transport invariant (no `console.log` ever — `src/mcp/lib/stdout-guard.ts` is the guardrail), the single-flight invariants for `trigger_fetch` and `regenerate_profile`, and the fact that `enqueue_apply` does NOT replace `pnpm run apply-worker`.
- [ ] Add the explicit obligation: "Every future MCP tool change MUST update the README tool-reference table — there is no codegen for it."
- [ ] Update `## Repo layout` to include the new `src/mcp/` tree and `scripts/install-mcp.sh` / `scripts/_merge-mcp-config.mjs`.

### 3. Validation

- [ ] `pnpm typecheck`, `pnpm test`, `pnpm run lint` all unchanged (this is doc-only — no regressions possible).
- [ ] Hand-review the README rendering on GitHub web (no `pnpm run` for README preview — eyeball it on the PR diff).
- [ ] Cross-check the tool-reference table against `pnpm run mcp | tools/list` to make sure every registered tool is documented.
