#!/usr/bin/env bash
# shellcheck shell=bash
# Install OpenCode autocomplete for v1, v2, or both.
# Backups preserve the pre-install state; uninstall restores that baseline.
set -Eeuo pipefail

V1_CONFIG_DIR=${OCA_V1_CONFIG_DIR:-${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}}
V2_CONFIG_DIR=${OCA_V2_CONFIG_DIR:-$HOME/.opencode}
BACKUP_ROOT=${OCA_BACKUP_ROOT:-$HOME/.local/share/opencode-autocomplete}
OCA_BASE_URL=${OCA_BASE_URL:-}
DRY_RUN=false
MODE=both

usage() {
  cat <<'USAGE'
Usage: install.sh [both|v1|v2|uninstall] [--dry-run]

Install from a checkout, or pipe this script from a host and set OCA_BASE_URL
in the receiving shell to that host's directory of raw repository files.

Environment:
  OCA_BASE_URL        Base URL for raw files when not run from a checkout
  OCA_V1_CONFIG_DIR   v1 config directory (default ~/.config/opencode)
  OCA_V2_CONFIG_DIR   v2 config directory (default ~/.opencode)
  OCA_BACKUP_ROOT     backup state directory

Examples:
  ./install.sh --dry-run
  ./install.sh v1
  OCA_BASE_URL=https://host/repo/main curl -fsSL https://host/repo/main/install.sh | \\
    OCA_BASE_URL=https://host/repo/main bash -s -- both
  ./install.sh uninstall
USAGE
}

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }
on_error() {
  local status=$1 line=$2
  log "ERROR: failed at line $line (exit $status); install may be partial; rerun installer or uninstall"
  exit "$status"
}
trap 'on_error "$?" "$LINENO"' ERR

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --help|-h) usage; exit 0 ;;
    both|v1|v2|uninstall)
      if [[ "$MODE" != both ]]; then die "multiple modes specified"; fi
      MODE=$arg ;;
    *) die "unknown argument: $arg (try --help)" ;;
  esac
done

# Find a checked-out repository only when the required files exist beside this
# script. With curl|bash, stdin has no reliable filesystem path: use OCA_BASE_URL.
SCRIPT_SOURCE=${BASH_SOURCE[0]:-$0}
SCRIPT_DIR=""
if SCRIPT_DIR=$(cd -- "$(dirname -- "$SCRIPT_SOURCE")" 2>/dev/null); then
  SCRIPT_DIR=$(cd -- "$SCRIPT_DIR" && pwd -P)
fi
REPO_ROOT=""
if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/tui-plugin.ts" ]]; then
  REPO_ROOT=$SCRIPT_DIR
fi

if [[ "$MODE" != uninstall && -z "$REPO_ROOT" && -z "$OCA_BASE_URL" ]]; then
  die "no checkout detected; set OCA_BASE_URL to the raw repository directory (see --help)"
fi

# Immutable first-install baseline. A later reinstall never overwrites it.
STATE_DIR="$BACKUP_ROOT/install-state"
STATE_ENTRIES="$STATE_DIR/entries"

source_for() {
  local relative=$1
  if [[ -n "$REPO_ROOT" ]]; then
    printf '%s\n' "$REPO_ROOT/$relative"
    return
  fi
  local destination="$STATE_DIR/downloads/$relative"
  if [[ "$DRY_RUN" == true ]]; then
    log "DRY-RUN: would download ${OCA_BASE_URL%/}/$relative"
    printf '%s\n' "$destination"
    return
  fi
  mkdir -p "$(dirname "$destination")"
  curl --fail --silent --show-error --location \
    "${OCA_BASE_URL%/}/$relative" --output "$destination"
  printf '%s\n' "$destination"
}

# Save original path plus its original state exactly once per destination.
backup_once() {
  local destination=$1 entry pathfile index=0
  if [[ "$DRY_RUN" == true ]]; then
    if [[ -e "$destination" || -L "$destination" ]]; then
      log "DRY-RUN: would back up $destination"
    else
      log "DRY-RUN: $destination did not exist; uninstall would remove it"
    fi
    return
  fi
  mkdir -p "$STATE_ENTRIES"
  while :; do
    entry="$STATE_ENTRIES/$index"
    pathfile="$entry/path"
    if [[ ! -e "$pathfile" ]]; then
      mkdir -p "$entry"
      printf '%s' "$destination" > "$pathfile"
      if [[ -L "$destination" ]]; then
        printf symlink > "$entry/kind"
        cp -a -- "$destination" "$entry/original"
      elif [[ -d "$destination" ]]; then
        printf directory > "$entry/kind"
        cp -a -- "$destination" "$entry/original"
      elif [[ -f "$destination" ]]; then
        printf file > "$entry/kind"
        cp -a -- "$destination" "$entry/original"
      else
        printf absent > "$entry/kind"
      fi
      return
    fi
    if [[ "$(cat "$pathfile")" == "$destination" ]]; then return; fi
    ((index += 1))
  done
}

install_file() {
  local relative=$1 destination=$2 source
  source=$(source_for "$relative")
  if [[ "$DRY_RUN" == true ]]; then
    log "DRY-RUN: would install $relative -> $destination"
    return
  fi
  [[ -f "$source" ]] || die "source file missing: $source"
  backup_once "$destination"
  mkdir -p "$(dirname "$destination")"
  cp -- "$source" "$destination"
}

register_v1() {
  local config=$V1_CONFIG_DIR/tui.json plugin_path=$V1_CONFIG_DIR/tui-plugins/tui-plugin.ts
  backup_once "$config"
  if [[ "$DRY_RUN" == true ]]; then
    log "DRY-RUN: would add $plugin_path to $config plugin array"
    return
  fi
  python3 - "$config" "$plugin_path" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
plugin = sys.argv[2]
text = path.read_text() if path.exists() else '{\n  "plugin": []\n}\n'

# JSONC-aware scan for the root-level "plugin" array. We skip comments and
# quoted strings while locating it; insert the new path as the first item so
# existing comments/bytes and commas remain untouched.
i, n, depth, target = 0, len(text), 0, None
while i < n:
    if text.startswith('//', i):
        end = text.find('\n', i + 2)
        i = n if end < 0 else end + 1
        continue
    if text.startswith('/*', i):
        end = text.find('*/', i + 2)
        if end < 0:
            raise SystemExit('invalid tui.json: unterminated block comment')
        i = end + 2
        continue
    ch = text[i]
    if ch == '"':
        start = i
        i += 1
        escaped = False
        while i < n:
            if escaped:
                escaped = False
            elif text[i] == '\\':
                escaped = True
            elif text[i] == '"':
                i += 1
                break
            i += 1
        else:
            raise SystemExit('invalid tui.json: unterminated string')
        raw = text[start:i]
        if depth == 1:
            try:
                key = json.loads(raw)
            except Exception:
                key = None
            if key == 'plugin':
                j = i
                while j < n and text[j].isspace(): j += 1
                if j >= n or text[j] != ':': continue
                j += 1
                while j < n and text[j].isspace(): j += 1
                if j < n and text[j] == '[':
                    target = j
                    break
        continue
    if ch == '{': depth += 1
    elif ch == '}': depth -= 1
    i += 1

if target is None:
    raise SystemExit('cannot find root-level "plugin" array in tui.json')

# Check for an existing exact JSON string anywhere inside the selected array.
j, k, nested, strings = target + 1, target + 1, 0, []
while j < n:
    if text.startswith('//', j):
        end = text.find('\n', j + 2)
        j = n if end < 0 else end + 1
        continue
    if text.startswith('/*', j):
        end = text.find('*/', j + 2)
        if end < 0: raise SystemExit('invalid tui.json: unterminated block comment')
        j = end + 2
        continue
    if text[j] == '"':
        start = j
        j += 1
        escaped = False
        while j < n:
            if escaped: escaped = False
            elif text[j] == '\\': escaped = True
            elif text[j] == '"':
                j += 1
                break
            j += 1
        try: strings.append(json.loads(text[start:j]))
        except Exception: pass
        continue
    if text[j] == '[': nested += 1
    elif text[j] == ']':
        if nested == 0: break
        nested -= 1
    j += 1
if plugin in strings:
    raise SystemExit(0)

encoded = json.dumps(plugin)
# Add as first item. Trailing commas are valid in OpenCode's JSONC config.
updated = text[:target + 1] + '\n    ' + encoded + ',' + text[target + 1:]
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(updated)
PY
}

install_v1() {
  log 'Installing OpenCode v1 TUI plugin'
  [[ "$DRY_RUN" == true ]] || mkdir -p "$V1_CONFIG_DIR/tui-plugins"
  install_file tui-plugin.ts "$V1_CONFIG_DIR/tui-plugins/tui-plugin.ts"
  install_file spellcheck.ts "$V1_CONFIG_DIR/tui-plugins/spellcheck.ts"
  install_file generate.ts "$V1_CONFIG_DIR/tui-plugins/generate.ts"
  install_file prompt-templates.ts "$V1_CONFIG_DIR/tui-plugins/prompt-templates.ts"
  register_v1
}

install_v2() {
  log 'Installing OpenCode v2 TUI plugin'
  install_file tui-plugin.v2/tui.ts "$V2_CONFIG_DIR/plugins/tui-plugin.v2/tui.ts"
  install_file spellcheck.ts "$V2_CONFIG_DIR/plugins/spellcheck.ts"
  install_file generate.ts "$V2_CONFIG_DIR/plugins/generate.ts"
  install_file prompt-templates.ts "$V2_CONFIG_DIR/plugins/prompt-templates.ts"
}

uninstall() {
  if [[ ! -d "$STATE_ENTRIES" ]]; then
    log 'No install baseline found; nothing to restore.'
    return
  fi
  if [[ "$DRY_RUN" == true ]]; then
    log 'DRY-RUN: would restore the original files/config saved in install-state'
    return
  fi
  local entry destination kind
  for entry in "$STATE_ENTRIES"/*; do
    [[ -d "$entry" ]] || continue
    destination=$(cat "$entry/path")
    kind=$(cat "$entry/kind")
    case "$kind" in
      absent)
        if [[ -f "$destination" || -L "$destination" ]]; then rm -f -- "$destination"
        elif [[ -d "$destination" ]]; then rmdir -- "$destination" 2>/dev/null || true
        fi ;;
      file|directory|symlink)
        rm -rf -- "$destination"
        mkdir -p "$(dirname "$destination")"
        cp -a -- "$entry/original" "$destination" ;;
    esac
    log "Restored $destination ($kind)"
  done
  rm -rf -- "$STATE_DIR"
  log 'Uninstall complete. Restart OpenCode to unload the plugin.'
}

case "$MODE" in
  v1) install_v1 ;;
  v2) install_v2 ;;
  both) install_v1; install_v2 ;;
  uninstall) uninstall ;;
esac

if [[ "$MODE" != uninstall ]]; then
  log "Install plan complete. Restart OpenCode to load the plugin."
fi
