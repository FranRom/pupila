#!/usr/bin/env bash
# Append two crontab entries:
#
#   1. Aggregator (`pnpm run dev`)         — default 07:00 daily
#   2. AI per-job review (`pnpm run ai-review`) — default 07:15 daily,
#      shells out to your local LLM CLI (claude/codex/gemini/opencode).
#      Skipped via --no-review for users without an LLM CLI installed.
#
# Linux fallback for systems without launchd. macOS users should prefer
# install-launchd.sh (handles wake-from-sleep catch-up).
#
# Usage:
#   ./scripts/install-cron.sh                                # both, defaults
#   ./scripts/install-cron.sh --aggregate-time 06:30
#   ./scripts/install-cron.sh --review-time 09:00
#   ./scripts/install-cron.sh --no-review                    # aggregator only
#   ./scripts/install-cron.sh --uninstall                    # remove both

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAG_AGG="# pupila:aggregate:${REPO_ROOT}"
TAG_REV="# pupila:review:${REPO_ROOT}"

AGG_TIME="07:00"
REV_TIME="07:15"
NO_REVIEW=0
UNINSTALL=0

usage() {
  cat <<EOF
Usage: $0 [options]

Options:
  --aggregate-time HH:MM   Schedule for the aggregator (default 07:00)
  --review-time HH:MM      Schedule for the AI review (default 07:15)
  --no-review              Don't install the review entry (aggregator only)
  --uninstall              Remove both entries
  -h, --help               Show this help
EOF
}

parse_time() {
  local input="$1"
  if [[ ! "$input" =~ ^([0-9]{1,2}):([0-9]{2})$ ]]; then
    echo "✗ Invalid time format: $input (expected HH:MM)" >&2
    exit 1
  fi
  local h="${BASH_REMATCH[1]}"
  local m="${BASH_REMATCH[2]}"
  if (( 10#$h < 0 || 10#$h > 23 || 10#$m < 0 || 10#$m > 59 )); then
    echo "✗ Time out of range: $input" >&2
    exit 1
  fi
  printf '%d %d\n' "$((10#$h))" "$((10#$m))"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --aggregate-time) AGG_TIME="$2"; shift 2 ;;
    --review-time) REV_TIME="$2"; shift 2 ;;
    --no-review) NO_REVIEW=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

PNPM="$(command -v pnpm || true)"
if [[ -z "$PNPM" ]]; then
  echo "✗ pnpm not on PATH. Install pnpm first." >&2
  exit 1
fi

# Read current crontab (no error if empty), strip any existing pupila
# entries for this repo so re-running is idempotent.
CURRENT="$(crontab -l 2>/dev/null || true)"
CLEANED="$(printf '%s\n' "$CURRENT" | grep -vF "$TAG_AGG" | grep -vF "$TAG_REV" || true)"

if [[ "$UNINSTALL" == "1" ]]; then
  printf '%s\n' "$CLEANED" | crontab -
  echo "✓ Removed pupila cron entries for $REPO_ROOT"
  exit 0
fi

read AGG_HOUR AGG_MINUTE <<< "$(parse_time "$AGG_TIME")"
read REV_HOUR REV_MINUTE <<< "$(parse_time "$REV_TIME")"

LINE_AGG="${AGG_MINUTE} ${AGG_HOUR} * * * cd ${REPO_ROOT} && ${PNPM} run dev >> ${REPO_ROOT}/data/cron-aggregate.log 2>&1 ${TAG_AGG}"
LINE_REV="${REV_MINUTE} ${REV_HOUR} * * * cd ${REPO_ROOT} && ${PNPM} run ai-review >> ${REPO_ROOT}/data/cron-review.log 2>&1 ${TAG_REV}"

if [[ "$NO_REVIEW" == "1" ]]; then
  printf '%s\n%s\n' "$CLEANED" "$LINE_AGG" | crontab -
  echo "✓ Installed cron entry"
  echo "  Aggregator: ${AGG_TIME} daily → data/cron-aggregate.log"
  echo "  Review:     skipped (--no-review)"
else
  printf '%s\n%s\n%s\n' "$CLEANED" "$LINE_AGG" "$LINE_REV" | crontab -
  echo "✓ Installed cron entries"
  echo "  Aggregator: ${AGG_TIME} daily → data/cron-aggregate.log"
  echo "  Review:     ${REV_TIME} daily → data/cron-review.log"
fi

cat <<EOF

Inspect:   crontab -l
Uninstall: $0 --uninstall
EOF
