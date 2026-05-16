# Known upstream issues

Snapshot as of 2026-04. Update this file when issues are resolved or new ones surface.

## Sources currently degraded / silently empty

- **`cryptojobslist.com`** — fully Cloudflare-challenged for HTML. The `api.cryptojobslist.com/jobs.rss` endpoint returns an empty channel. Fetcher returns `[]`; will pick up again if upstream restores the feed. **Don't remove from the source list** — comes back from time to time.
- **`hn-jobs`** routinely keeps 0–2 entries because YC company posts rarely match the senior+stack signal threshold. Working as intended.

## Markup-driven scrapers (silent break risk)

- **`web3.career`** and **`aijobs.net`** (formerly `ai-jobs.net`) removed RSS — both scraped from HTML via small inline regex parsers. Markup changes upstream silently break them.
  - Diagnostic: if a fetcher returns 0 for several days, eyeball the HTML for new selectors.
  - **`aijobs.net`** is dominated by spam-aggregator listings (one posting cloned to 50 cities). Fetcher dedups by base ID via the `-idNNNNN-` slug pattern. Don't be alarmed at low kept count.

## Web3 tier-S coverage notes

All 5 web3 holdouts now covered:

- `morpho`, `magiceden`, `li.fi` → public Ashby (added to `config/slugs.json#ashby`)
- `aave` → scraped via Next.js `__NEXT_DATA__` (`src/fetchers/aave.ts`)
- `chainlink-labs` → Ashby's private `non-user-graphql` endpoint (`src/fetchers/ashby-private.ts`)

The Greenhouse stale-slug list was reduced 14 → 8. A 100-candidate sweep across web3/AI/dev-tools tier-S companies turned up no other Ashby-private orgs — chainlink-labs appears unique. The fetcher is config-driven anyway.

## Debugging "why is X showing 0?"

1. Check the source-health 🚨 banner in `JOBS.md` — auto-flags any fetcher with `fetched === 0` OR `errors > 0`.
2. Re-run with `pnpm run dev` and inspect `data/raw/<source>-<YYYY-MM-DD>.json` (gitignored per-source dump).
3. Eyeball the upstream URL in a browser / curl. 404 vs Cloudflare vs schema change have different fixes.
4. Most legitimate breaks fall into: (a) ATS slug deleted upstream, (b) HTML markup changed, (c) Cloudflare ratchet, (d) source genuinely had no new senior remote roles that day.
