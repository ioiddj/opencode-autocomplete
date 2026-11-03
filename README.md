# opencode-autocomplete

Cursor-style `Tab` autocomplete for OpenCode prompts, with an optional
configurable spellchecker.

## Generations

| Generation | File | Mechanism | Tab override |
|------------|------|-----------|--------------|
| OpenCode v1 | `tui-plugin.ts` | `@opencode-ai/plugin/tui` (`TuiPlugin`) | ✅ via `api.keymap.registerLayer` binding `tab` → `autocomplete.tab` |
| OpenCode v2 | `tui-plugin.v2.ts` | `@opencode/plugin` (`{ id, setup(ctx) }`) | ❌ v2 exposes no TUI/keymap plugin surface; autocomplete + spellcheck exposed on `ctx.opencodeAutocomplete` |

## What it does (v1)

- Captures the prompt input ref (home + session) via the `home_prompt` /
  `session_prompt` slots.
- Registers a keymap layer binding `Tab` to an `autocomplete.tab` command,
  overriding the default `Tab` behavior.
- On Tab, takes the current partial prompt and asks the active model to produce
  a continuation, then updates the prompt input.
- `autocomplete.spellcheck` palette command spellchecks the current prompt input
  and updates it when corrected.

## Spellcheck (both generations)

Configurable via `~/.config/opencode/autocomplete.json`:

```json
{ "spellcheck": { "enabled": true, "mode": "model" } }
```

Modes:
- `off` — disabled
- `traditional` — aspell/hunspell detection (best-effort correction)
- `model` — traditional to detect misspellings, then a lightweight model to
  correct in context before submission

## Status

Best-effort recreation of Cursor's tab completion within OpenCode's plugin API.
Ghost-text rendering and streaming acceptance are limited by the available
prompt surface; this implementation performs a completion pass on Tab. The v2
Tab override is not available because v2 exposes no keymap/TUI surface to
plugins.

## Install (v1)

Copy `tui-plugin.ts` (and `spellcheck.ts`) into `~/.config/opencode/tui-plugins/`
and add `tui-plugin.ts` to `tui.json`'s `plugin` array, then restart OpenCode.

## Install (v2)

Copy `tui-plugin.v2.ts` (and `spellcheck.ts`) into `~/.opencode/plugins/`. v2
globs that directory and calls `setup()` with no config entry required.
