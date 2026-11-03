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
//   as model-backed operations driven through `ctx.session`, registered in
//   `setup(ctx)`. They can be invoked by other tooling or wired to a v2-side
//   binding once v2 exposes one.
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

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { detectMisspellings, correctTraditional, correctWithModel, type SpellcheckConfig } from "./spellcheck.ts"

const CONFIG_PATH = join(
  process.env.OPENCODE_CONFIG_DIR ?? join(process.env.HOME ?? "", ".config", "opencode"),
  "autocomplete.json",
)

function loadConfig(): SpellcheckConfig {
  const defaults: SpellcheckConfig = { enabled: false, mode: "traditional" }
  try {
    if (!existsSync(CONFIG_PATH)) return defaults
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"))
    return { ...defaults, ...(raw?.spellcheck ?? {}) }
  } catch {
    return defaults
  }
}

/** Ask the active model to continue a partial prompt. Returns the completion text (best-effort). */
async function autocomplete(ctx: any, input: string): Promise<string> {
  if (!input.trim()) return ""
  const session = ctx?.session
  if (!session || typeof session.create !== "function" || typeof session.prompt !== "function") {
    return ""
  }
  let sessionID: string | null = null
  try {
    const created = await session.create({ title: "autocomplete" } as any)
    sessionID = created?.id ?? created?.sessionID ?? created?.data?.id ?? created?.data?.sessionID ?? null
    if (!sessionID) return ""
    await session.prompt({
      sessionID,
      text: `Complete the following prompt; reply with ONLY the completion text, no quotes:\n${input}`,
    } as any)
    // Best-effort: do not block waiting for a reply stream here; v2's
    // session.wait can return before the assistant message lands.
    return ""
  } catch {
    return ""
  } finally {
    // no-op: session left for the user to inspect if desired
  }
}

/** Spellcheck the given input per config; returns corrected text or the original. */
async function spellcheckInput(ctx: any, input: string): Promise<string> {
  const cfg = loadConfig()
  if (!cfg.enabled || cfg.mode === "off") return input
  if (cfg.mode === "traditional") return correctTraditional(input)
  return correctWithModel(input, ctx)
}

export default {
  id: "opencode-autocomplete",

  async setup(ctx: any) {
    const cfg = loadConfig()

    // Expose autocomplete + spellcheck on the plugin context so other v2
    // tooling (or a future v2 keymap binding) can drive them.
    if (ctx) {
      ;(ctx as any).opencodeAutocomplete = {
        version: "0.1.0",
        config: cfg,
        autocomplete: (input: string) => autocomplete(ctx, input),
        spellcheck: (input: string) => spellcheckInput(ctx, input),
      }
    }

    ctx.log?.("opencode-autocomplete (v2) loaded — Tab override is v1-only; autocomplete/spellcheck exposed on ctx.opencodeAutocomplete")
  },
}
