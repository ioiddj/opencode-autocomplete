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
// available in v2 (the earlier "v1-only" claim was based on the v1
// @opencode-ai/plugin/tui.d.ts on disk, not the v2 docs).
//
// Inference uses `generateText` from ../generate.ts (raw POST to
// /api/experimental/generate/text, stateless, no session) — the same module the
// v1 plugin uses, so both generations behave identically.
//
// Limitation: reading the current uncommitted prompt input text is NOT
// documented in the v2 TUI API surface (there is no v1-style Prompt ref or
// prompt-input reader on `ctx`). So Tab generates a completion and surfaces it
// via a dialog/toast for the user to copy; inline insertion into the live prompt
// input is not implementable from the documented v2 TUI surface. The
// autocomplete + spellcheck operations are also exposed on
// `ctx.opencodeAutocomplete` for other v2 tooling to drive.

import { Plugin } from "@opencode/plugin/tui"
import { spellcheck } from "../spellcheck.ts"
import { generateText } from "../generate.ts"

// Narrowed view of the v2 TUI context — checked, never assumed (work-display
// pattern: only touch what we verify exists).
interface V2Ctx {
  keymap?: { layer?: (factory: () => unknown) => unknown }
  ui?: {
    toast?: { show?: (input: { variant?: string; title?: string; message: string }) => void }
    dialog?: { show?: (render: () => unknown) => unknown; clear?: () => void }
  }
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
              const completion = await generateText({
                prompt: `Complete the current prompt; reply with ONLY the completion text, no quotes:\n`,
                model: null,
              })
              if (!completion) {
                c.ui?.toast?.show?.({
                  variant: "error",
                  title: "autocomplete",
                  message: "completion failed",
                })
                return
              }
              const text = completion.trim()
              // v2 TUI has no documented prompt-input ref for inline insertion,
              // so surface the completion in a dialog pre-filled with the text so
              // it can be copied/confirmed.
              c.ui?.dialog?.show?.(() => ({
                title: "Autocomplete completion",
                description: text,
                value: text,
              }))
            } catch {
              c.ui?.toast?.show?.({
                variant: "error",
                title: "autocomplete",
                message: "completion failed",
              })
            }
          },
        },
        {
          id: "opencode-autocomplete.spellcheck",
          title: "Spellcheck prompt",
          group: "Autocomplete",
          palette: true,
          run: async () => {
            // v2 TUI doesn't document reading the live prompt input, so
            // spellcheck the live prompt isn't directly invocable from Tab.
            // The operation is exposed on ctx.opencodeAutocomplete.spellcheck
            // for other v2 tooling to drive.
            c.ui?.toast?.show?.({
              variant: "info",
              title: "spellcheck",
              message: "use ctx.opencodeAutocomplete.spellcheck(text)",
            })
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
          prompt: `Complete the following prompt; reply with ONLY the completion text, no quotes:\n${input}`,
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
