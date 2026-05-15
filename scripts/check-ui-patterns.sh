#!/usr/bin/env bash
# Backstop enforcement for the rules in ui/CLAUDE.md.
#
# Biome catches inline /api fetches via noRestrictedGlobals (see biome.json
# overrides). This script catches the patterns Biome can't easily match:
# string-literal classNames and any /api fetch that slips past Biome's scope.
# Run by `pnpm run lint:ui-patterns` and the simple-git-hooks pre-commit.
#
# Exit 0 = clean. Exit 1 = violation; prints offending lines.

set -euo pipefail

fail=0

# --- (1) String-literal classNames in JSX ---
# Every class should come from a *.module.css import; see ui/CLAUDE.md §1.
className_hits=$(grep -rEn 'className="' ui/src --include='*.tsx' 2>/dev/null || true)
if [ -n "$className_hits" ]; then
  echo "✗ String-literal classNames violate ui/CLAUDE.md §1 (use *.module.css imports):"
  echo "$className_hits" | sed 's/^/  /'
  fail=1
fi

# --- (2) Inline /api fetch() outside ui/src/lib/api/ ---
# Biome already enforces this via noRestrictedGlobals; this is a backstop in
# case the override scope drifts. See ui/CLAUDE.md §2.
fetch_hits=$(grep -rEn "fetch[[:space:]]*\\(['\"\\\`]/api" ui/src --include='*.tsx' --include='*.ts' 2>/dev/null | grep -v '^ui/src/lib/api/' || true)
if [ -n "$fetch_hits" ]; then
  if [ "$fail" -eq 0 ]; then echo ""; fi
  echo "✗ Inline /api fetch() violates ui/CLAUDE.md §2 (use ui/src/lib/api/):"
  echo "$fetch_hits" | sed 's/^/  /'
  fail=1
fi

if [ "$fail" -eq 1 ]; then
  echo ""
  echo "See ui/CLAUDE.md for the canonical patterns and anti-patterns."
  exit 1
fi
