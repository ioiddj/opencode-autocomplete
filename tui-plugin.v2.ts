// opencode-autocomplete — OpenCode v2 plugin
//
// Cursor-style tab autocomplete + optional spellcheck for prompts.
//
// IMPORTANT LIMITATION (measured against the v2 plugin contract):
//
//   OpenCode v2 exposes NO TUI/keymap plugin surface to plugins — there is no
//   `api.keymap.registerLayer`, no `api.ui.Prompt`, and no prompt-slot
//   replacement. Therefore the Tab key override and inline ghost-text are
//   v1-only (see tui-plugin.ts). In v2, autocomplete and spellcheck are exposed
//   as model-backed operations driven through `generateText` (the experimental
//   generate route), registered on `ctx.opencodeAutocomplete`. They can be
//   invoked by other tooling or wired to a v2-side binding once v2 exposes one.
//
//   v2 plugin contract (measured, 2.0.24 / 2.1.4):
//     export default { id, server?, setup(ctx) }
//     ctx.tool.hook("execute.before", handler) | ctx.tool.transform(editor)
//     ctx.session.hook("context", handler) | ctx.session.create / prompt / get / wait / move
//     ctx.agent.transform / ctx.skill.transform
//
// This file follows the measured plain-object shape (a `Plugin.define` wrapper
// is optional — see dual-gen.v2.ts). It imports only Node builtins plus
// `@opencode/plugin`, so it loads in a bare v2 tree with no node_modules.

import { spellcheck } from "./spellcheck.ts"
import { generateText } from "./generate.ts"

/** Ask the active model to continue a partial prompt. Returns the completion text (best-effort). */
async function autocomplete(input: string): Promise<string> {
  if (!input.trim()) return ""
  try {
    return await generateText({
      prompt: `Complete the following prompt; reply with ONLY the completion text, no quotes:\n${input}`,
      model: null,
    })
  } catch {
    return ""
  }
}

/** Spellcheck the given input per config; returns corrected text or the original. */
async function spellcheckInput(input: string): Promise<string> {
  return spellcheck(input)
}

export default {
  id: "opencode-autocomplete",

  async setup(ctx: any) {
    // Expose autocomplete + spellcheck on the plugin context so other v2
    // tooling (or a future v2 keymap binding) can drive them.
    if (ctx) {
      ;(ctx as any).opencodeAutocomplete = {
        version: "0.1.0",
        autocomplete: (input: string) => autocomplete(input),
        spellcheck: (input: string) => spellcheckInput(input),
      }
    }

    ctx.log?.("opencode-autocomplete (v2) loaded — Tab override is v1-only; autocomplete/spellcheck exposed on ctx.opencodeAutocomplete")
  },
}
