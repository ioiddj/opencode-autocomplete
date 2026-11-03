# opencode-autocomplete

A TUI plugin for OpenCode that overrides the `Tab` key with Cursor-style inline
prompt autocomplete.

## What it does

- Captures the prompt input ref (home + session) via the `home_prompt` /
  `session_prompt` slots.
- Registers a keymap layer binding `Tab` to an `autocomplete.tab` command.
- On Tab, takes the current partial prompt and asks the active model to produce
  a continuation, then updates the prompt input.

## Status

Best-effort recreation of Cursor's tab completion within OpenCode's TUI plugin
API. Ghost-text rendering and streaming acceptance are limited by the available
prompt surface; this implementation performs a completion pass on Tab.

## Install

Copy `tui-plugin.ts` into `~/.config/opencode/tui-plugins/` and add it to
`tui.json`'s `plugin` array, then restart OpenCode.
