# Security policy

`pupila` is a local-first tool — it runs entirely on your machine, has no hosted backend, and the UI is bound to `127.0.0.1` only. That said, the code touches user data (CV, application history, candidate brief) and parses HTML/JSON/RSS from third-party sources, so a few classes of issue do matter.

## Supported versions

Only the latest commit on `main` is supported. There are no tagged releases or LTS branches — pull the latest before reporting.

## Reporting a vulnerability

For most issues, open a GitHub issue at **https://github.com/FranRom/pupila/issues** with a `[security]` prefix in the title. Since pupila is a local-first tool with no hosted backend, there's no production deployment to coordinate around — public discussion is fine for the vast majority of reports.

For coordinated disclosure (when public discussion before a fix would be genuinely risky — e.g. an active exploitation pattern not obvious from reading the source), use GitHub's **private vulnerability reporting** at **https://github.com/FranRom/pupila/security/advisories/new**. The filing stays private until a fix is published.

Either way, include:

- A description of the issue and the impact (data exfiltration, code execution, privilege escalation, etc.).
- Steps to reproduce — ideally a minimal patch / repo state that triggers the behavior.
- Any suggested remediation.

Solo-maintained project — responses are best-effort, not a contractual SLA. I aim to acknowledge within 7 days and ship a fix (or a written rationale for why it's not actionable) within 30 days.

## In scope

- The aggregator pipeline (`src/`) — fetchers, normalizers, filters, dedup, render, feed.
- The MCP server (`src/mcp/`) — tool surface, JSON-RPC handling, path traversal, command injection.
- The local UI (`ui/`) and its Vite dev-server middleware (`/api/*` endpoints).
- The apply-worker and apply-queue lock semantics (`src/lib/apply-queue.ts`, `scripts/apply-worker.ts`).
- The CV parsing path (`mammoth` / `pdfjs-dist` integration in `src/lib/cv-parser.ts`).
- Install scripts (`scripts/install-launchd.sh`, `install-cron.sh`, `install-mcp.sh`).

Examples of in-scope issues:

- An upstream source returning a `javascript:` / `data:` / `file:` URL that escapes the `isSafeUrl` gate.
- HTML-attribute escaping bypass in `JOBS.md` or the RSS feed.
- A malicious LLM-CLI response that triggers path traversal in `data/applications/<job-id>.md` writes.
- Apply-queue lock race conditions that drop or duplicate work.
- A malformed CV that crashes or hangs the parser unrecoverably.
- MCP tool-input validation gaps that let a client read or write outside `data/` / `config/`.

## Out of scope

- Vulnerabilities in upstream sources themselves (Ashby, Greenhouse, Lever, RSS feeds, etc.). Report to the upstream operator.
- Vulnerabilities in the local LLM CLIs (`claude`, `codex`, `gemini`, `opencode`). Report to the respective vendor.
- Issues that require the attacker to already have local code execution on your machine — at that point they own everything anyway.
- Exposing the UI publicly. The dev server binds to `127.0.0.1:5173` by design; running it on a public interface is a configuration mistake, not a vulnerability.
- Committing `config/applied.json` or `config/candidate-brief.md` to a public fork. Both are gitignored; the user has to explicitly opt in to track them.
- Dependency CVEs already flagged by `pnpm audit` in CI — those are tracked in the open.

## Hall of fame

Reporters who responsibly disclose actionable issues will be credited here (with their consent). Mention it in your issue or advisory if you'd like to be named.
