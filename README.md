# opencode-autocomplete

Cursor-style `Tab` autocomplete for OpenCode prompts, with an optional
configurable spellchecker.

## Generations

| Generation | File | Mechanism | Tab override |
|------------|------|-----------|--------------|
| OpenCode v1 | `tui-plugin.ts` | `@opencode-ai/plugin/tui` (`TuiPlugin`) | ✅ via `api.keymap.registerLayer` binding `tab` → `autocomplete.tab` |
| OpenCode v2 | `tui-plugin.v2/tui.ts` | `@opencode/plugin/tui` TUI plugin | ✅ Tab override via `ctx.keymap.layer` with `bind: "tab"`; completion surfaced via dialog (v2 TUI has no documented prompt-input ref for inline insertion) |

## What it does (v1)

- Captures the prompt input ref (home + session) via the `home_prompt` /
  `session_prompt` slots.
- Registers a keymap layer binding `Tab` to an `autocomplete.tab` command,
  overriding the default `Tab` behavior.
- On Tab, takes the current partial prompt and asks the active model to produce
  a continuation via the stateless `/api/experimental/generate/text` route
  (`generate.ts`), then inserts the completion into the prompt input.
- `autocomplete.spellcheck` palette command spellchecks the current prompt input
  and updates it when corrected.

## Inference route (both generations)

Autocomplete and model-assisted spellcheck use OpenCode's experimental stateless
generation route (`POST /api/experimental/generate/text`, body `{prompt, model}`),
implemented in `generate.ts` with a raw `fetch`. The server URL + password are
resolved the same way the measured v2 attack plugin does:
1. `OPENCODE_SERVER_URL` + `OPENCODE_SERVER_PASSWORD` env vars
2. `service.json` (`url` + `password`) — config dir, local-state dir, bounded search
3. localhost fallbacks (v1 `45998`, v2 `49374`, SDK default `4096`)

Auth is `Authorization: Basic base64("opencode:" + password)`, matching the
v2 service's own client calls. The installed `@opencode-ai/sdk` does not yet
expose `experimental.generate.text`, so `generate.ts` calls the route directly.
Response shape is not pinned in the installed types, so several text fields are
read (`text`, `completion`, `result`, `message`) with a raw-text fallback.

## Spellcheck (both generations)

Configurable via `~/.config/opencode/autocomplete.json`:

```json
{ "spellcheck": { "enabled": true, "mode": "model" } }
```

Modes:
- `off` — disabled
- `traditional` — aspell/hunspell detection (best-effort correction)
- `model` — traditional (aspell/hunspell) to detect misspellings, then a
  lightweight model via `/api/experimental/generate/text` to correct in context
  before submission

## Status

Best-effort recreation of Cursor's tab completion within OpenCode's plugin API.
Ghost-text rendering and streaming acceptance are limited by the available
prompt surface; this implementation performs a completion pass on Tab and
inserts the result at the end of the input (cursor position is not tracked from
the TUI ref). In v2 the Tab binding is registered via `ctx.keymap.layer` with
`bind: "tab"`, but the v2 TUI API surface does not document reading or writing
the live prompt input, so the completion is surfaced in a dialog for the user
to copy rather than inserted inline.

## Install

From a checkout:

```sh
./install.sh --dry-run     # inspect planned changes
./install.sh both          # install v1 and v2
./install.sh v1            # or just v1
./install.sh v2            # or just v2
./install.sh uninstall     # restore the pre-install state
```

The installer backs up original files/config once, is safe to rerun, and
`uninstall` restores the saved baseline. It supports `OCA_V1_CONFIG_DIR`,
`OCA_V2_CONFIG_DIR`, and `OCA_BACKUP_ROOT` overrides. Restart OpenCode after
installing.

For a hosted `curl | bash` install, set `OCA_BASE_URL` to the raw directory
containing this repository's files:

```sh
export OCA_BASE_URL=https://raw.githubusercontent.com/OWNER/REPOSITORY/BRANCH
curl -fsSL "$OCA_BASE_URL/install.sh" | bash -s -- both
```

Replace the example URL with the project's published location. This repository
does not currently have a configured Git remote, so there is not yet a real
project URL to put in that command. Inspect the installer before piping it into
a shell.
