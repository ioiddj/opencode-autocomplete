// opencode-autocomplete — TUI plugin (OpenCode v2 variant)
// UNVERIFIED: written against the documented v2 plugin API shape; no v2 runtime
// is installed on this host to validate it.

import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "opencode-autocomplete",
  async setup(ctx) {
    // v2 API differs: hooks receive a single mutable event draft.
    // Tab override + prompt autocomplete to be ported from tui-plugin.ts.
    ctx.log?.("opencode-autocomplete (v2) loaded")
  },
})
