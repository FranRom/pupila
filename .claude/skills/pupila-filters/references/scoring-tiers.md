# Scoring tiers + signal regex catalog

Companion deep-dive for the `pupila-filters` skill. Open this only when you need the exact regex set or the tier multiplier maths.

## Tier multipliers (`tieredWeight`)

```
count = 0  → 0
count = 1  → floor(base * 0.5)
count 2-3  → base
count >= 4 → floor(base * 1.5)
```

Worked example with `base = 10` (stackPrimary):

| Matches | Weight |
|---|---|
| 0 | 0 |
| 1 | 5 |
| 2 | 10 |
| 3 | 10 |
| 4 | 15 |
| 5+ | 15 |

## Signal catalog (current — verify against `src/filters.ts` if uncertain)

| Signal | Type | Max | Regex group (global flag set) |
|---|---|---|---|
| `web3TitleBody` | binary | 20 | `web3`, `crypto`, `blockchain`, `defi`, `dao`, `nft`, `solana`, `ethereum`, ... |
| `web3Stack` | binary | 20 | stack-side web3 (libraries: viem, wagmi, ethers, solana/web3.js, ...) |
| `aiTitleBody` | binary | 20 | `ai`, `ml`, `llm`, `agent`, `genai`, `claude`, `openai`, `anthropic`, ... |
| `aiStack` | binary | 20 | stack-side AI (langchain, llamaindex, ollama, pytorch, ...) |
| `stackPrimary` | **tiered** | 10/5/15 | React, Next.js, TypeScript |
| `stackRn` | **tiered** | 5/2/7 | React Native, Expo |
| `stackOther` | **tiered** | 5/2/7 | GraphQL, Tailwind, Vite |
| `leadTitle` | binary | 15 | lead/staff/principal/head/director |
| `seniorTitle` | binary | 10 | senior/sr (matched only if `leadTitle` didn't fire) |
| `frontendTitle` | binary | 10 | frontend / fullstack / web / mobile in title |
| `frontendBody` | **tiered** | 10/5/15 | "design system", "ship components", "accessibility", "WCAG", "a11y" |
| `locationRemote` | binary | 10 | remote, EMEA, CET, Spain, anywhere, fully distributed |
| `freshness7d` | binary | 10 | postedAt within 7 days |
| `freshness14d` | binary | 5 | postedAt within 14 days (only if 7d didn't fire) |
| `usCentricPenalty` | binary | **-10** | body hints US-centric without remote-worldwide language (applied AFTER capping) |

The exact regex sources live in `config/profile.json#keywords.*`. The `_G` global-flag variants for tiered signals are built once at module scope from those lists via `compileKw(...kw, 'g')`.

## Cap behavior

`maxScore = 100`. Positives sum first, then clamp, then apply `usCentricPenalty`. So a job with rawTotal 120 and US-centric body lands at `100 - 10 = 90`, not `120 - 10 = 110` clamped.

## Boilerplate stripping (in `preparedScoringBody`)

Strips:

- EEO / equal-opportunity boilerplate
- Privacy / data-handling sections
- Accommodations / reasonable-adjustments
- "About us" / "About <company>" intros
- Truncates to `scoringBodyMaxChars` (default 1500) after stripping

Hard-drops still see the FULL body (the truncation is only for scoring keyword counts).

## When to update this file

- New positive signal added → append a row.
- Tier multipliers tweaked → update the worked example.
- New regex group → append to the catalog.

Don't let this file drift more than a commit behind `src/filters.ts`. If you tune scoring, update this in the same commit.
