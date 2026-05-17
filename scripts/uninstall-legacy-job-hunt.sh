#!/usr/bin/env bash
# One-shot cleanup of legacy `job-hunt`-tagged launchd/cron entries left over
# from before the pupila rename. Safe to run multiple times.
#
# Removes ONLY entries whose tag/label matches:
#   - dev.$USER.job-hunt.aggregate
#   - dev.$USER.job-hunt.review
#   - # job-hunt:aggregate:<repo-root>
#   - # job-hunt:review:<repo-root>
#
# Anchored patterns — never bulk-deletes anything containing "job-hunt" as
# substring elsewhere in user crontab or LaunchAgents.

set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(pwd)}"
removed=0

uname_s="$(uname -s)"

cleanup_launchd() {
  local agg_label="dev.${USER}.job-hunt.aggregate"
  local rev_label="dev.${USER}.job-hunt.review"
  local agg_plist="$HOME/Library/LaunchAgents/${agg_label}.plist"
  local rev_plist="$HOME/Library/LaunchAgents/${rev_label}.plist"

  for label in "$agg_label" "$rev_label"; do
    if launchctl list | awk '{print $3}' | grep -Fxq "$label"; then
      launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/${label}.plist" 2>/dev/null || \
        launchctl unload "$HOME/Library/LaunchAgents/${label}.plist" 2>/dev/null || true
      echo "✓ Unloaded legacy launchd agent: $label"
      removed=$((removed+1))
    fi
  done

  for plist in "$agg_plist" "$rev_plist"; do
    if [ -f "$plist" ]; then
      rm -f "$plist"
      echo "✓ Removed legacy plist: $plist"
      removed=$((removed+1))
    fi
  done
}

cleanup_cron() {
  local agg_tag="# job-hunt:aggregate:${REPO_ROOT}"
  local rev_tag="# job-hunt:review:${REPO_ROOT}"

  if ! command -v crontab >/dev/null 2>&1; then
    echo "ℹ︎ crontab not found; skipping cron cleanup"
    return
  fi

  local current
  current="$(crontab -l 2>/dev/null || true)"
  if [ -z "$current" ]; then
    return
  fi

  # Strip any cron line whose inline tag matches our agg/rev legacy tag.
  local filtered
  filtered="$(printf '%s\n' "$current" | grep -vF "$agg_tag" | grep -vF "$rev_tag" || true)"

  if [ "$current" != "$filtered" ]; then
    printf '%s\n' "$filtered" | crontab -
    echo "✓ Removed legacy cron entries for $REPO_ROOT"
    removed=$((removed+1))
  fi
}

case "$uname_s" in
  Darwin) cleanup_launchd; cleanup_cron ;;
  Linux)  cleanup_cron ;;
  *) echo "ℹ︎ Unsupported OS: $uname_s — only Darwin/Linux supported"; exit 0 ;;
esac

if [ "$removed" -eq 0 ]; then
  echo "Nothing to clean — no legacy job-hunt entries found."
else
  echo "Done. Removed $removed legacy entries."
fi
