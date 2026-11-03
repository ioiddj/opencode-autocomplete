// opencode-autocomplete — TUI plugin
// Overrides the Tab key with Cursor-style inline prompt autocomplete.

import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { spellcheck } from "./spellcheck.ts"
import { generateText } from "./generate.ts"

const id = "opencode-autocomplete"

const plugin: TuiPlugin = async (api) => {
  let promptRef: { current: { input: string }; set: (p: { input: string; parts: any[] }) => void } | undefined

  const captureRef = (ref: any) => { if (ref) promptRef = ref }

  // Render a Prompt in the home + session slots so we can observe input.
  api.slots.register({
    name: "home_prompt",
    mode: "replace",
    render: () => api.ui.Prompt({ ref: captureRef }),
  } as any)

  async function complete() {
    const ref = promptRef
    if (!ref) return
    const current = ref.current?.input ?? ""
    if (!current.trim()) return
    try {
      // Stateless completion via the experimental generate route — no session
      // created, returns the assistant text directly.
      const completion = await generateText({
        prompt: `Complete the following prompt; reply with ONLY the completion text, no quotes:\n${current}`,
        model: null,
      })
      if (!completion) return
      // Cursor-style: insert the completion into the prompt input (append at
      // end; we do not track the cursor position from the TUI ref).
      ref.set({ input: current + " " + completion.trim(), parts: [{ type: "text", text: current + " " + completion.trim() }] })
    } catch {
      api.ui.toast({ variant: "error", message: "autocomplete failed", duration: 2000 })
    }
  }

  const dispose = api.keymap.registerLayer({
    commands: [
      {
        name: "autocomplete.tab",
        title: "Autocomplete (Tab)",
        category: "Autocomplete",
        namespace: "palette",
        run: () => { void complete() },
      },
      {
        name: "autocomplete.spellcheck",
        title: "Spellcheck prompt",
        category: "Autocomplete",
        namespace: "palette",
        run: () => {
          const ref = promptRef as any
          if (!ref) return
          const current = ref.current?.input ?? ""
          void spellcheck(current).then((corrected) => {
            if (corrected && corrected !== current) {
              ref.set({ input: corrected, parts: [{ type: "text", text: corrected }] })
            }
          })
        },
      },
    ],
    bindings: [
      { key: "tab", command: "autocomplete.tab" },
    ],
  } as any)

  api.lifecycle.onDispose(() => dispose())
}

const mod: TuiPluginModule = { id, tui: plugin }
export default mod
