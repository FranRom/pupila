#!/usr/bin/env bash
# Bundle-size budget gate. Fails the build when the UI's first-paint chunks
# (main JS + CSS) exceed the budget in `.bundle-budget.json`.
#
# Why first-paint only: lazy-loaded chunks (Onboarding/Profile/Settings/
# SwipeDeck) grow with features and shouldn't gate every PR. The chunk the
# user actually downloads to see the Jobs table is what matters for perceived
# performance.
#
# Requires a fresh `pnpm run ui:build` — the runner does that before calling.
# Run via `pnpm run lint:bundle-size`.
#
# Exit 0 = within budget. Exit 1 = over budget; prints sizes + budget.

set -euo pipefail

DIST=ui/dist/assets
BUDGET_FILE=.bundle-budget.json

if [ ! -d "$DIST" ]; then
  echo "✗ No build output at $DIST. Run \`pnpm run ui:build\` first."
  exit 1
fi
if [ ! -f "$BUDGET_FILE" ]; then
  echo "✗ Missing $BUDGET_FILE"
  exit 1
fi

main_js_budget=$(node -e "console.log(require('./$BUDGET_FILE').mainJsBytes)")
main_css_budget=$(node -e "console.log(require('./$BUDGET_FILE').mainCssBytes)")

# Vite hashes filenames: `index-AbCdEf12.js`. Glob for the entry-point file.
main_js=$(ls "$DIST"/index-*.js 2>/dev/null | head -1 || true)
main_css=$(ls "$DIST"/index-*.css 2>/dev/null | head -1 || true)

if [ -z "$main_js" ]; then echo "✗ No main JS chunk found in $DIST"; exit 1; fi
if [ -z "$main_css" ]; then echo "✗ No main CSS chunk found in $DIST"; exit 1; fi

js_size=$(wc -c < "$main_js" | tr -d ' ')
css_size=$(wc -c < "$main_css" | tr -d ' ')

fail=0
if [ "$js_size" -gt "$main_js_budget" ]; then
  echo "✗ Main JS chunk $js_size bytes exceeds budget $main_js_budget bytes ($(basename "$main_js"))"
  fail=1
fi
if [ "$css_size" -gt "$main_css_budget" ]; then
  echo "✗ Main CSS chunk $css_size bytes exceeds budget $main_css_budget bytes ($(basename "$main_css"))"
  fail=1
fi

if [ "$fail" -eq 1 ]; then
  echo ""
  echo "Either split more code via React.lazy() (see ui/CLAUDE.md §5) or"
  echo "raise the budget in $BUDGET_FILE if the growth is intentional."
  exit 1
fi

js_pct=$(node -e "console.log(Math.round($js_size / $main_js_budget * 100))")
css_pct=$(node -e "console.log(Math.round($css_size / $main_css_budget * 100))")
echo "✓ Main JS:  $js_size / $main_js_budget bytes (${js_pct}% of budget)"
echo "✓ Main CSS: $css_size / $main_css_budget bytes (${css_pct}% of budget)"
