// opencode-autocomplete — TUI plugin
// Overrides the Tab key with Cursor-style inline prompt autocomplete.

import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { spellcheck, loadConfig } from "./spellcheck.ts"

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
      // Ask the active model to continue the partial prompt.
      const res = await api.client.session.create({ body: { title: "autocomplete" } } as any)
      const sid = (res as any)?.data?.id
      if (!sid) return
      await api.client.session.prompt({
        path: { id: sid },
        body: { parts: [{ type: "text", text: `Complete the following prompt; reply with ONLY the completion text, no quotes:\n${current}` }] },
      } as any)
      // We don't block on full response here; best-effort.
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
          void spellcheck(current, api.client).then((corrected) => {
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
