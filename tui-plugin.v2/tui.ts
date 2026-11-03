// opencode-autocomplete — OpenCode v2 TUI plugin
//
// Cursor-style Tab autocomplete + optional spellcheck for prompts.
//
// v2 TUI contract (measured from opencode.ai/v2/docs/build/plugins/cli and the
// installed work-display v2 plugin):
//
//   A v2 TUI plugin is a DIRECTORY whose entrypoint is `tui.ts` inside it.
//   Declaring it as a bare `.ts` file makes the loader resolve `<file>/tui`,
//   get ENOTDIR, and silently load NOTHING (measured failure mode).
//
//   import { Plugin } from "@opencode/plugin/tui"
//   export default Plugin.define({
//     id: "opencode-autocomplete",
//     setup(context) {
//       context.keymap.layer(() => ({
//         mode: "global",
//         commands: [{ id, title, bind: "tab", palette: true, run }],
//       }))
//     },
//   })
//
// The v2 TUI exposes `ctx.keymap.layer` with `bind`, so the Tab override IS
// available in v2.
//
// Inference uses `generateText` from ../generate.ts (raw POST to
// /api/experimental/generate/text, stateless, no session) — the same module the
// v1 plugin uses, so both generations behave identically.
//
// Limitation: reading the current uncommitted prompt input text is NOT
// documented in the v2 TUI API surface (there is no v1-style Prompt ref or
// prompt-input reader on `ctx`). So on Tab the plugin prompts the user to paste
// the partial text, generates a completion, and surfaces it in a dialog to copy.
// Inline insertion into the live prompt input is not implementable from the
// documented v2 TUI surface. The autocomplete + spellcheck operations are also
// exposed on `ctx.opencodeAutocomplete` for other v2 tooling to drive.

import { Plugin } from "@opencode/plugin/tui"
import { spellcheck } from "../spellcheck.ts"
import { generateText } from "../generate.ts"
import { completePrompt, spellcheckPrompt } from "../prompt-templates.ts"

// Narrowed view of the v2 TUI context — checked, never assumed (work-display
// pattern: only touch what we verify exists).
interface V2Ctx {
  keymap?: { layer?: (factory: () => unknown) => unknown }
  ui?: {
    toast?: { show?: (input: { variant?: string; title?: string; message: string }) => void }
    dialog?: {
      show?: (render: () => unknown) => unknown
      clear?: () => void
      prompt?: (input: { title: string; description?: () => unknown; value?: string; onConfirm?: (value: string) => void; onCancel?: () => void }) => unknown
    }
  }
}

function showDialog(c: V2Ctx, title: string, description: string, value?: string): void {
  c.ui?.dialog?.show?.(() => ({
    title,
    description,
    value,
  }))
}

export default {
  id: "opencode-autocomplete",

  async setup(ctx: unknown) {
    const c = (ctx ?? {}) as V2Ctx

    if (typeof c.keymap?.layer !== "function") {
      console.error(
        "[opencode-autocomplete] v2 context has no keymap.layer — Tab override NOT registered. " +
          "Check that @opencode/plugin/tui is the v2 runtime's TUI entry.",
      )
      return
    }

    c.keymap.layer(() => ({
      mode: "global",
      priority: 10,
      commands: [
        {
          id: "opencode-autocomplete.tab",
          title: "Autocomplete (Tab)",
          group: "Autocomplete",
          bind: "tab",
          palette: true,
          run: async () => {
            try {
              // v2 TUI cannot read the live prompt input, so ask the user for
              // the partial text, then generate a completion.
              const partial = await promptPartial(c)
              if (partial === undefined) return // cancelled
              if (!partial.trim()) {
                c.ui?.toast?.show?.({ variant: "info", title: "autocomplete", message: "nothing to complete" })
                return
              }
              const completion = await generateText({ prompt: completePrompt(partial), model: null })
              if (!completion) {
                c.ui?.toast?.show?.({ variant: "error", title: "autocomplete", message: "completion failed" })
                return
              }
              showDialog(c, "Autocomplete completion", completion.trim())
            } catch {
              c.ui?.toast?.show?.({ variant: "error", title: "autocomplete", message: "completion failed" })
            }
          },
        },
        {
          id: "opencode-autocomplete.spellcheck",
          title: "Spellcheck prompt",
          group: "Autocomplete",
          palette: true,
          run: async () => {
            try {
              const text = await promptPartial(c, "Paste the prompt text to spellcheck:")
              if (text === undefined) return
              if (!text.trim()) {
                c.ui?.toast?.show?.({ variant: "info", title: "spellcheck", message: "nothing to check" })
                return
              }
              const corrected = await spellcheck(text)
              if (corrected && corrected !== text) {
                showDialog(c, "Spellcheck result", corrected.trim())
              } else {
                c.ui?.toast?.show?.({ variant: "info", title: "spellcheck", message: "no corrections" })
              }
            } catch {
              c.ui?.toast?.show?.({ variant: "error", title: "spellcheck", message: "spellcheck unavailable" })
            }
          },
        },
      ],
    }))

    // Expose operations for other v2 tooling (or a future v2 keymap binding
    // that can read the live prompt input).
    ;(c as Record<string, unknown>).opencodeAutocomplete = {
      version: "0.1.0",
      autocomplete: (input: string) =>
        generateText({
          prompt: completePrompt(input),
          model: null,
        }),
      spellcheck: (input: string) => spellcheck(input),
    }

    c.ui?.toast?.show?.({
      variant: "success",
      title: "opencode-autocomplete",
      message: "v2 TUI plugin loaded (Tab override registered)",
    })
    console.error("[opencode-autocomplete] v2 TUI plugin loaded")
  },
}

/** Prompt the user for partial prompt text via DialogPrompt, or undefined on cancel. */
function promptPartial(c: V2Ctx, title = "Paste the partial prompt text to complete:"): Promise<string | undefined> {
  return new Promise((resolve) => {
    c.ui?.dialog?.prompt?.({
      title,
      onConfirm: (value: string) => resolve(value),
      onCancel: () => resolve(undefined),
    })
  })
}
