## Tasks

### 1. `mcp:smoke` script

- [ ] Add `"mcp:smoke": "node scripts/mcp-smoke.mjs"` to `package.json` scripts.
- [ ] Create `scripts/mcp-smoke.mjs`. The script spawns `pnpm run mcp`, writes a single line `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}\n` to its stdin, reads stdout until it sees a JSON-RPC response on a line starting with `{`, parses it, and asserts:
  - [ ] `data.result.tools` is an array of length ≥ 17.
  - [ ] Every name in the expected list appears in the response: `list_jobs`, `get_job_detail`, `get_brief`, `mark_applied`, `update_status`, `clear_applied`, `enqueue_apply`, `cancel_apply`, `skip_job`, `queue_status`, `worker_status`, `run_summary`, `get_ai_review`, `list_ai_reviews`, `trigger_fetch`, `get_fetch_status`, `regenerate_profile`.
- [ ] Wall-clock timeout: 30 seconds. On timeout, kill the child + exit 1 with a clear `[mcp-smoke] timed out` message.
- [ ] Exit 0 only when assertions pass; exit non-zero on parse failure, missing tool, or timeout.
- [ ] Verify locally on a working tree WITHOUT `data/jobs.json` / `config/profile.json` / `config/candidate-brief.md` — the smoke MUST pass on a fresh checkout.

### 2. CI step in `check.yml`

- [ ] After the `Vite — build UI bundle (ui/dist/)` step and before `lint:bundle-size`, add a new step:
  ```yaml
  - name: MCP — smoke test (tools/list over stdio)
    run: pnpm run mcp:smoke
    timeout-minutes: 1
  ```
- [ ] No matrix changes — runs once on the existing `ubuntu-latest` runner.

### 3. Dependabot grouping

- [ ] Edit `.github/dependabot.yml`. Within the existing `npm` ecosystem block, add a `groups:` entry:
  ```yaml
  groups:
    mcp-deps:
      patterns:
        - "@modelcontextprotocol/sdk"
        - "zod"
      update-types:
        - "minor"
        - "patch"
  ```
- [ ] Leave existing groups (if any) intact.
- [ ] Major version bumps stay ungrouped — those need individual review.

### 4. Validation

- [ ] `pnpm run mcp:smoke` exits 0 locally with the current 17 tools.
- [ ] Locally simulate a regression: temporarily remove one tool from `src/mcp/server.ts`, re-run smoke, confirm exit 1 with a clear "missing tool: <name>" message; revert.
- [ ] Open the PR; CI's new `MCP smoke` step appears green.
- [ ] Confirm in Dependabot's next refresh that SDK + zod bumps would land as one grouped PR. (Cannot validate this without waiting for the cycle — document the expected behavior in the PR description.)
