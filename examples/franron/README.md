# Worked example — Fran's profile

This is the original `job-hunt` configuration written by [@ogarciarevett](https://github.com/ogarciarevett), who built this project for himself: **a senior frontend engineer based in Spain, focused on web3 + AI roles, remote-EMEA / remote-worldwide**.

It's preserved here as a real, battle-tested reference so anyone who clones this repo can:

1. See how the various tuning knobs interact in practice (weights, keyword lists, exclusions).
2. Copy/paste the bits that match their profile and tweak the rest.
3. Understand what "tuned" looks like vs. the deliberately neutral defaults shipped at `/config`.

## Files

| File | Counterpart in `/config` | Notes |
|---|---|---|
| [`profile.json`](./profile.json) | [`config/profile.json`](../../config/profile.json) | Frontend-leaning weights + `titleExcludedSpecialties` list (rejects backend / SRE / data / etc. titles). |
| [`slugs.json`](./slugs.json) | [`config/slugs.json`](../../config/slugs.json) | The full ~50-company web3 + AI tier-S list. |
| [`candidate-brief.md`](./candidate-brief.md) | [`config/candidate-brief.md`](../../config/candidate-brief.md) | Fran's hand-written candidate description. |
| [`applied.json`](./applied.json) | `config/applied.json` (gitignored in the generic template) | Real application history through 2026-05. |

## How to use

To run the repo with Fran's exact config:

```bash
cp examples/franron/profile.json config/profile.json
cp examples/franron/slugs.json config/slugs.json
cp examples/franron/candidate-brief.md config/candidate-brief.md
cp examples/franron/applied.json config/applied.json
pnpm run dev
```

To borrow just one file (e.g. you're also a frontend engineer but want to keep your own slug list), copy only that file.

## Why a frontend example specifically?

The original repo was tuned over months of real job-hunting, so the keyword lists and weights reflect signals that actually worked: which body phrases predicted real frontend roles (`design system`, `ship components`, `accessibility`), which compound titles look like engineering but aren't (`solutions engineer`, `forward deployed engineer`), and which web3/AI stack mentions are reliable indicators. If your role is similar, this file gives you a head start.

If your role is **not** similar (you're a backend, mobile, infra, or data engineer), don't use this file as-is — set every `frontendTitle` / `frontendBody` / `web3*` / `aiStack` weight to `0` and rebuild the keyword lists for your own domain. The neutral defaults in `/config/profile.json` are a better starting point.
