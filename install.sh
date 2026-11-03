#!/usr/bin/env bash
# install.sh — install opencode-autocomplete for OpenCode v1 and/or v2.
#
# Usage:
#   curl -fsSL <install.sh> | sh            # install both generations
#   curl -fsSL <install.sh> | sh -s v1      # install v1 only
#   curl -fsSL <install.sh> | sh -s v2      # install v2 only
#   curl -fsSL <install.sh> | sh -s uninstall   # remove both generations
#
# Idempotent and reversible: backs up any file it touches; `uninstall` restores
# the previous state from backups. All plugin source lives in this repo, which
# is expected to be served at the same URL as this script (nothing else is
# downloaded).
#
# Environment overrides:
#   OCA_V1_CONFIG_DIR   default ~/.config/opencode
#   OCA_V2_CONFIG_DIR   default ~/.opencode
#   OCA_BACKUP_ROOT     default ~/.local/share/opencode-autocomplete/backups
#   OCA_DRY_RUN=1       print the plan without mutating
set -euo pipefail

log()  { printf '%s\n' "$*" >&2; }
err()  { printf 'install.sh: %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }
note() { printf '  -> %s\n' "$*" >&2; }

DRY_RUN=${OCA_DRY_RUN:-0}

do_cmd() {
  if [ "$DRY_RUN" = "1" ]; then
    note "[dry-run] $*"
  else
    note "$*"
    eval "$@"
  fi
}

# Back up a file (or record its absence) under a timestamped backup dir.
# Returns the backup path. Respects DRY_RUN (skips the actual copy).
backup_file() {
  local src="$1" bakdir="$2"
  mkdir -p "$bakdir"
  local rel="${src#"$HOME"/}"
  local bak="$bakdir/$rel"
  mkdir -p "$(dirname "$bak")"
  # record the absolute original path so uninstall restores/deletes the right file
  # (env overrides may point outside $HOME).
  printf '%s\n' "$src" > "$bak.orig"
  if [ -e "$src" ] || [ -L "$src" ]; then
    if [ ! -e "$bak" ]; then
      if [ "$DRY_RUN" = "1" ]; then
        note "[dry-run] cp -a $src $bak"
      else
        cp -a "$src" "$bak"
      fi
    fi
    : > "$bak.exists"
  else
    : > "$bak.absent"
  fi
  echo "$bak"
}

###############################################################################
# Paths
###############################################################################

V1_CONFIG_DIR="${OCA_V1_CONFIG_DIR:-$HOME/.config/opencode}"
V2_CONFIG_DIR="${OCA_V2_CONFIG_DIR:-$HOME/.opencode}"

V1_TUI_PLUGINS="$V1_CONFIG_DIR/tui-plugins"
V1_TUI_JSON="$V1_CONFIG_DIR/tui.json"
V2_PLUGINS="$V2_CONFIG_DIR/plugins"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# install.sh lives at the repo root.
REPO_ROOT="$SCRIPT_DIR"

V1_FILES=(tui-plugin.ts spellcheck.ts generate.ts prompt-templates.ts)
V2_FILES=(tui-plugin.v2/tui.ts spellcheck.ts generate.ts prompt-templates.ts)

BACKUP_ROOT="${OCA_BACKUP_ROOT:-$HOME/.local/share/opencode-autocomplete/backups}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

###############################################################################
# v1 install
###############################################################################

install_v1() {
  log "=== OpenCode v1 (tui-plugins) ==="
  [ -d "$V1_TUI_PLUGINS" ] || { log "skip: $V1_TUI_PLUGINS does not exist (v1 TUI not configured)"; return 0; }

  local bak="$BACKUP_ROOT/$TIMESTAMP/v1"
  do_cmd "mkdir -p $bak"

  for f in "${V1_FILES[@]}"; do
    local src="$REPO_ROOT/$f"
    local dst="$V1_TUI_PLUGINS/$f"
    [ -e "$src" ] || { err "missing source $src"; continue; }
    backup_file "$dst" "$bak" >/dev/null
    do_cmd "cp $src $dst"
  done

  # Register tui-plugin.ts in the tui.json plugin array (idempotent, text edit,
  # never re-serialize — the file is JSON-with-comments).
  if [ -f "$V1_TUI_JSON" ]; then
    backup_file "$V1_TUI_JSON" "$bak" >/dev/null
    if grep -q 'tui-plugins/tui-plugin.ts' "$V1_TUI_JSON"; then
      note "tui-plugin.ts already registered in $V1_TUI_JSON"
    else
      do_cmd_insert_tui_json
    fi
  else
    note "no $V1_TUI_JSON — plugin files copied but not registered; add manually:"
    note "  \"$V1_TUI_PLUGINS/tui-plugin.ts\" to tui.json plugin array"
  fi

  log "v1 installed. Restart OpenCode to load the TUI plugin."
}

# Insert tui-plugin.ts into the tui.json plugin array. The plugin array's last
# element carries either an inline closing `]` (`"path"],`) or a standalone `]`
# on the next line. We add a comma to the last element, append our entry, then
# close the array. Comments between elements are preserved.
do_cmd_insert_tui_json() {
  local pluginpath="$V1_TUI_PLUGINS/tui-plugin.ts"
  local tmp
  tmp="$(mktemp)"
  awk -v pluginpath="$pluginpath" '
    BEGIN { in_plugin=0; pending="" }
    { line=$0 }
    /"plugin"\s*:/ { in_plugin=1 }
    {
      if (in_plugin && line ~ /^\s*"[\/~]/) {
        if (line ~ /\]/) {
          # last element carries the inline closing bracket
          sub(/\].*$/, "", line)
          sub(/,"*\s*$/, "", line)
          if (line !~ /,\s*$/) line = line ","
          print line
          print "    \"" pluginpath "\",  // ocx:component opencode-autocomplete"
          print "  ]"
          pending=""
          next
        }
        # not the last: flush any earlier pending first, then buffer this one
        if (pending != "") {
          if (pending !~ /,\s*$/) pending = pending ","
          print pending
        }
        pending=line
        next
      }
      # non-element line inside the array: flush pending first
      if (in_plugin && pending != "") {
        if (pending !~ /,\s*$/) pending = pending ","
        print pending
        pending=""
      }
      # standalone closing bracket of the array
      if (in_plugin && line ~ /^\s*\]/) {
        print "    \"" pluginpath "\",  // ocx:component opencode-autocomplete"
        print line
        pending=""
        next
      }
      print
    }
  ' "$V1_TUI_JSON" > "$tmp" || true
  if grep -q 'tui-plugins/tui-plugin.ts' "$tmp"; then
    do_cmd "mv $tmp $V1_TUI_JSON"
  else
    rm -f "$tmp"
    err "could not locate plugin array in $V1_TUI_JSON; not registered"
  fi
}

###############################################################################
# v2 install
###############################################################################

install_v2() {
  log "=== OpenCode v2 (plugins/) ==="
  [ -d "$V2_CONFIG_DIR" ] || { log "skip: $V2_CONFIG_DIR does not exist (v2 not configured)"; return 0; }

  local bak="$BACKUP_ROOT/$TIMESTAMP/v2"
  do_cmd "mkdir -p $bak"

  # v2 discovers local plugins from .opencode/plugins/; the TUI entrypoint is
  # the directory tui-plugin.v2/ containing tui.ts.
  local dst_dir="$V2_PLUGINS/tui-plugin.v2"
  backup_file "$dst_dir" "$bak" >/dev/null
  do_cmd "mkdir -p $dst_dir"
  for f in "${V2_FILES[@]}"; do
    local src="$REPO_ROOT/$f"
    local dst="$V2_CONFIG_DIR/plugins/$f"
    [ -e "$src" ] || { err "missing source $src"; continue; }
    mkdir -p "$(dirname "$dst")" 2>/dev/null || true
    do_cmd "cp $src $dst"
  done

  log "v2 installed. v2 discovers plugins from .opencode/plugins/ automatically."
}

###############################################################################
# uninstall (restore most recent backups)
###############################################################################

uninstall_all() {
  log "=== uninstall opencode-autocomplete ==="
  if [ ! -d "$BACKUP_ROOT" ]; then
    log "no backups found at $BACKUP_ROOT; nothing to undo"
    return 0
  fi
  for gen in v1 v2; do
    local latest
    latest="$(ls -1d "$BACKUP_ROOT"/*/$gen 2>/dev/null | sort | tail -n1 || true)"
    [ -n "$latest" ] || { log "no $gen backup to undo"; continue; }
    log "restoring $gen from $latest"
    while IFS= read -r -d '' marker; do
      local rel="${marker#"$latest"/}"
      rel="${rel%.exists}"
      rel="${rel%.absent}"
      local orig_file="${marker%.exists}"
      orig_file="${orig_file%.absent}"
      local orig
      orig="$(cat "$orig_file.orig" 2>/dev/null || true)"
      [ -n "$orig" ] || orig="$HOME/$rel"
      if [ "${marker##*.}" = "exists" ]; then
        local copy="${marker%.exists}"
        if [ -e "$copy" ]; then
          do_cmd "mkdir -p $(dirname "$orig")"
          do_cmd "cp -a \"$copy\" \"$orig\"" || true
        fi
      else
        # original was absent -> remove the file/dir we created
        if [ -e "$orig" ]; then
          if [ -d "$orig" ] && [ ! -L "$orig" ]; then
            do_cmd "rm -rf \"$orig\"" || true
          else
            do_cmd "rm -f \"$orig\"" || true
          fi
        fi
      fi
    done < <(find "$latest" \( -name '*.exists' -o -name '*.absent' \) -print0 2>/dev/null || true)
  done
  log "uninstall complete. Restart OpenCode."
}

###############################################################################
# Main
###############################################################################

MODE="${1:-both}"
case "$MODE" in
  v1)   install_v1 ;;
  v2)   install_v2 ;;
  both) install_v1; install_v2 ;;
  uninstall|undo) uninstall_all ;;
  *)
    die "usage: $0 [v1|v2|both|uninstall]"
    ;;
esac
