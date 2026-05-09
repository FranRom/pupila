#!/usr/bin/env bash
# Install two launchd agents on macOS:
#
#   1. dev.${USER}.job-hunt.aggregate — runs `pnpm run dev` (fetch + filter
#      + score + write data/jobs.json + JOBS.md + feed.xml). No LLM needed.
#
#   2. dev.${USER}.job-hunt.review    — runs `pnpm run ai-review` (per-job
#      LLM verdict via your local CLI: claude / codex / gemini / opencode).
#      Skipped via --no-review for users without an LLM CLI installed.
#
# Default schedule: aggregate at 07:00, review at 07:15. Both run daily.
# launchd's StartCalendarInterval catches up missed runs after wake.
#
# Usage:
#   ./scripts/install-launchd.sh                                # both, defaults
#   ./scripts/install-launchd.sh --aggregate-time 06:30
#   ./scripts/install-launchd.sh --review-time 09:00
#   ./scripts/install-launchd.sh --no-review                    # aggregator only
#   ./scripts/install-launchd.sh --uninstall                    # remove both

set -euo pipefail

LABEL_BASE="dev.${USER}.job-hunt"
LAUNCH_DIR="$HOME/Library/LaunchAgents"
AGG_LABEL="${LABEL_BASE}.aggregate"
REV_LABEL="${LABEL_BASE}.review"
AGG_PLIST="$LAUNCH_DIR/${AGG_LABEL}.plist"
REV_PLIST="$LAUNCH_DIR/${REV_LABEL}.plist"

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
  --no-review              Don't install the review agent (aggregator only)
  --uninstall              Remove both agents
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

unload_and_remove() {
  local plist="$1"
  local label="$2"
  if [[ -f "$plist" ]]; then
    launchctl unload "$plist" 2>/dev/null || true
    rm -f "$plist"
    echo "  ✓ Removed $label"
  fi
}

if [[ "$UNINSTALL" == "1" ]]; then
  echo "Uninstalling launchd agents..."
  unload_and_remove "$AGG_PLIST" "$AGG_LABEL"
  unload_and_remove "$REV_PLIST" "$REV_LABEL"
  echo "Done."
  exit 0
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PNPM="$(command -v pnpm || true)"
if [[ -z "$PNPM" ]]; then
  echo "✗ pnpm not on PATH. Install pnpm first." >&2
  exit 1
fi

mkdir -p "$LAUNCH_DIR"

write_plist() {
  local plist="$1"
  local label="$2"
  local script="$3"
  local hour="$4"
  local minute="$5"
  local log_prefix="$6"

  cat > "$plist" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>WorkingDirectory</key>
  <string>${REPO_ROOT}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${PNPM}</string>
    <string>run</string>
    <string>${script}</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${hour}</integer>
    <key>Minute</key>
    <integer>${minute}</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${REPO_ROOT}/data/${log_prefix}.out.log</string>
  <key>StandardErrorPath</key>
  <string>${REPO_ROOT}/data/${log_prefix}.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
PLIST_EOF

  launchctl unload "$plist" 2>/dev/null || true
  launchctl load "$plist"
}

read AGG_HOUR AGG_MINUTE <<< "$(parse_time "$AGG_TIME")"
read REV_HOUR REV_MINUTE <<< "$(parse_time "$REV_TIME")"

echo "Installing launchd agents..."

write_plist "$AGG_PLIST" "$AGG_LABEL" "dev" "$AGG_HOUR" "$AGG_MINUTE" "launchd-aggregate"
echo "  ✓ ${AGG_LABEL} — pnpm run dev @ ${AGG_TIME} daily"

if [[ "$NO_REVIEW" == "1" ]]; then
  unload_and_remove "$REV_PLIST" "$REV_LABEL"
  echo "  · Skipped review agent (--no-review)"
else
  write_plist "$REV_PLIST" "$REV_LABEL" "ai-review" "$REV_HOUR" "$REV_MINUTE" "launchd-review"
  echo "  ✓ ${REV_LABEL} — pnpm run ai-review @ ${REV_TIME} daily"
fi

cat <<EOF

Logs:
  ${REPO_ROOT}/data/launchd-aggregate.{out,err}.log
  ${REPO_ROOT}/data/launchd-review.{out,err}.log

Trigger now:
  launchctl start ${AGG_LABEL}
  launchctl start ${REV_LABEL}

Status:
  launchctl list | grep job-hunt

Uninstall:
  $0 --uninstall
EOF
