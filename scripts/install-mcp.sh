#!/usr/bin/env bash
# Install the Pupila MCP server. Curl|bash entry point hosted as a GitHub
# release asset. Idempotent — re-running updates the clone and refreshes
# the client config(s).
#
# Usage:
#   curl -sSf https://raw.githubusercontent.com/ogarciarevett/job-hunt/main/scripts/install-mcp.sh | bash
#   # or, if you've cloned the repo already:
#   bash scripts/install-mcp.sh
#
# Env overrides:
#   PUPILA_HOME    - install location (default: $HOME/.pupila)
#   PUPILA_REPO    - git URL (default: https://github.com/ogarciarevett/job-hunt.git)
#   PUPILA_REF     - branch/tag/commit to checkout (default: main)
#   PUPILA_DRY_RUN - if set to 1, print intended actions and exit
#
# Exit codes:
#   0   success (server registered with at least one MCP client)
#   1   missing prerequisite
#   2   git clone/update failed
#   3   pnpm install failed
#   4   no supported MCP client detected
#   5   client config merge failed

set -euo pipefail

PUPILA_HOME="${PUPILA_HOME:-$HOME/.pupila}"
PUPILA_REPO="${PUPILA_REPO:-https://github.com/ogarciarevett/job-hunt.git}"
PUPILA_REF="${PUPILA_REF:-main}"
PUPILA_DRY_RUN="${PUPILA_DRY_RUN:-0}"

# ANSI helpers — degrade gracefully when stdout is not a tty.
if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
else
  BOLD=''; DIM=''; RED=''; GREEN=''; YELLOW=''; BLUE=''; RESET=''
fi

log()    { printf '%s[mcp-install]%s %s\n' "$BLUE" "$RESET" "$*"; }
warn()   { printf '%s[mcp-install]%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
err()    { printf '%s[mcp-install]%s %s\n' "$RED" "$RESET" "$*" >&2; }
ok()     { printf '%s[mcp-install]%s %s\n' "$GREEN" "$RESET" "$*"; }
say()    { printf '%s%s%s\n' "$BOLD" "$*" "$RESET"; }
dryrun() { [ "$PUPILA_DRY_RUN" = "1" ]; }

run() {
  if dryrun; then
    printf '%s  $ %s%s\n' "$DIM" "$*" "$RESET"
  else
    "$@"
  fi
}

# -----------------------------------------------------------------------------
# Prereq check — we FAIL FAST and tell the user how to fix.  Auto-installing
# Node/pnpm from a curl|bash script is where install scripts become monsters.
# -----------------------------------------------------------------------------

require_cmd() {
  local cmd="$1"; local hint="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "missing prerequisite: $cmd"
    err "  $hint"
    exit 1
  fi
}

check_node_version() {
  local major
  major=$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')
  if [ "$major" -lt 22 ]; then
    err "node $major detected; pupila requires Node 22 or newer"
    err "  install via fnm/nvm/asdf/volta and re-run"
    exit 1
  fi
  log "node $(node --version) ok"
}

detect_clients() {
  # Returns the list of MCP clients found on this machine. Stored as space-
  # separated string for portability across bash versions.
  local clients=""
  if command -v claude >/dev/null 2>&1; then clients="$clients claude_cli"; fi

  # Claude Desktop config locations (no CLI to check, only the config file).
  case "$(uname -s)" in
    Darwin)
      if [ -d "$HOME/Library/Application Support/Claude" ]; then
        clients="$clients claude_desktop_mac"
      fi
      ;;
    Linux)
      if [ -d "$HOME/.config/Claude" ]; then
        clients="$clients claude_desktop_linux"
      fi
      ;;
  esac

  if [ -d "$HOME/.cursor" ]; then clients="$clients cursor"; fi
  echo "$clients"
}

# -----------------------------------------------------------------------------
# Steps
# -----------------------------------------------------------------------------

say "Pupila MCP server installer"
echo "  Install dir:  $PUPILA_HOME"
echo "  Repo:         $PUPILA_REPO"
echo "  Ref:          $PUPILA_REF"
dryrun && warn "DRY RUN — no filesystem changes will be made"
echo

# Prereqs
require_cmd git "install via Xcode CLT (macOS) or your package manager"
require_cmd node "install Node 22 LTS from https://nodejs.org or via fnm/nvm"
require_cmd pnpm "enable via 'corepack enable' (bundled with Node 22), or npm i -g pnpm"
check_node_version

# Detect clients before any disk work — exit early if none found.
CLIENTS=$(detect_clients)
if [ -z "$CLIENTS" ]; then
  err "no supported MCP client detected"
  err "  install one of:"
  err "    - Claude Code CLI: https://github.com/anthropics/claude-code"
  err "    - Claude Desktop:  https://claude.ai/download"
  err "    - Cursor:          https://cursor.com"
  err "  then re-run this installer"
  exit 4
fi
log "detected MCP client(s):$CLIENTS"

# Clone or update.
if [ -d "$PUPILA_HOME/.git" ]; then
  log "updating existing clone at $PUPILA_HOME"
  run git -C "$PUPILA_HOME" fetch --tags origin
  run git -C "$PUPILA_HOME" checkout "$PUPILA_REF"
  run git -C "$PUPILA_HOME" pull --ff-only origin "$PUPILA_REF" || true
else
  log "cloning $PUPILA_REPO → $PUPILA_HOME"
  run git clone --branch "$PUPILA_REF" --depth 1 "$PUPILA_REPO" "$PUPILA_HOME" \
    || { err "git clone failed"; exit 2; }
fi
ok "repo ready"

# Install JS deps.
log "running pnpm install (this can take a minute on first run)"
if dryrun; then
  printf '%s  $ pnpm --dir %s install --prefer-frozen-lockfile%s\n' "$DIM" "$PUPILA_HOME" "$RESET"
else
  pnpm --dir "$PUPILA_HOME" install --prefer-frozen-lockfile \
    || { err "pnpm install failed"; exit 3; }
fi
ok "dependencies installed"

# Build the command spec we'll register with every detected client.
# Using `pnpm exec tsx` so we don't need a build step.
MERGE_HELPER="$PUPILA_HOME/scripts/_merge-mcp-config.mjs"
SERVER_NAME="pupila"
# JSON-stringified value: { command, args, cwd }. Cwd is essential — the MCP
# client's working directory varies; without `cwd` the server's relative
# `pnpm` lookup can fail.
SERVER_ENTRY_JSON=$(cat <<EOF
{"command":"pnpm","args":["--dir","$PUPILA_HOME","exec","tsx","src/mcp/index.ts"],"cwd":"$PUPILA_HOME"}
EOF
)

register_with_node_helper() {
  local config_path="$1"
  if dryrun; then
    printf '%s  $ node %s %s %s '\''<server-spec>'\''%s\n' \
      "$DIM" "$MERGE_HELPER" "$config_path" "$SERVER_NAME" "$RESET"
    return
  fi
  node "$MERGE_HELPER" "$config_path" "$SERVER_NAME" "$SERVER_ENTRY_JSON" \
    || { err "failed to merge into $config_path"; exit 5; }
}

# Register with each detected client.
for client in $CLIENTS; do
  case "$client" in
    claude_cli)
      log "registering with Claude Code CLI"
      if dryrun; then
        printf '%s  $ claude mcp add %s pnpm --dir %s exec tsx src/mcp/index.ts%s\n' \
          "$DIM" "$SERVER_NAME" "$PUPILA_HOME" "$RESET"
      else
        # Remove existing entry first so re-runs don't fail with "already exists".
        claude mcp remove "$SERVER_NAME" >/dev/null 2>&1 || true
        claude mcp add "$SERVER_NAME" \
          --cwd "$PUPILA_HOME" \
          -- pnpm --dir "$PUPILA_HOME" exec tsx src/mcp/index.ts \
          || warn "claude mcp add failed — you can run it manually later"
      fi
      ok "  → registered in Claude Code"
      ;;
    claude_desktop_mac)
      log "registering with Claude Desktop (macOS)"
      register_with_node_helper "$HOME/Library/Application Support/Claude/claude_desktop_config.json"
      ok "  → updated claude_desktop_config.json (restart Claude Desktop to load)"
      ;;
    claude_desktop_linux)
      log "registering with Claude Desktop (Linux)"
      register_with_node_helper "$HOME/.config/Claude/claude_desktop_config.json"
      ok "  → updated claude_desktop_config.json (restart Claude Desktop to load)"
      ;;
    cursor)
      log "registering with Cursor"
      register_with_node_helper "$HOME/.cursor/mcp.json"
      ok "  → updated Cursor MCP config"
      ;;
  esac
done

echo
say "Done."
echo
echo "Next steps:"
echo "  1. Run the first job aggregation:  pnpm --dir $PUPILA_HOME run dev"
echo "  2. Drop a CV (in the UI or via:    pnpm --dir $PUPILA_HOME run setup-brief --file ~/cv.pdf)"
echo "  3. Verify the server is wired:"
echo "     - Claude Code: claude mcp list   (look for 'pupila')"
echo "     - Claude Desktop/Cursor: restart the app, check the tools panel"
echo
echo "Optional — start the apply-worker in a separate terminal so the"
echo "swipe-to-apply queue can drain in the background:"
echo "    pnpm --dir $PUPILA_HOME run apply-worker"
echo
