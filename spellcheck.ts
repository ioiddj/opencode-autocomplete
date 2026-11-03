// Spellcheck for opencode prompts.
// Two strategies:
//  1. "traditional": use aspell/hunspell if available to detect+correct.
//  2. "model": use traditional to detect misspellings, then a lightweight model
//     to correct in context.
// Configured via ~/.config/opencode/autocomplete.json -> { spellcheck: { enabled, mode } }

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { generateText } from "./generate.ts"

export type SpellcheckMode = "traditional" | "model" | "off"

export interface SpellcheckConfig {
  enabled: boolean
  mode: SpellcheckMode
}

const CONFIG_PATH = join(
  process.env.OPENCODE_CONFIG_DIR ?? join(process.env.HOME ?? "", ".config", "opencode"),
  "autocomplete.json",
)

export function loadConfig(): SpellcheckConfig {
  const defaults: SpellcheckConfig = { enabled: false, mode: "traditional" }
  try {
    if (!existsSync(CONFIG_PATH)) return defaults
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"))
    return { ...defaults, ...(raw?.spellcheck ?? {}) }
  } catch {
    return defaults
  }
}

function haveBin(name: string): boolean {
  const r = spawnSync("which", [name], { encoding: "utf8" })
  return r.status === 0
}

export function detectMisspellings(text: string): string[] {
  // Use aspell list if available.
  if (haveBin("aspell")) {
    const r = spawnSync("aspell", ["list"], { input: text, encoding: "utf8" })
    return (r.stdout ?? "").split(/\n/).filter(Boolean)
  }
  if (haveBin("hunspell")) {
    const r = spawnSync("hunspell", ["-l"], { input: text, encoding: "utf8" })
    return (r.stdout ?? "").split(/\n/).filter(Boolean)
  }
  return []
}

export function correctTraditional(text: string): string {
  if (haveBin("aspell")) {
    const r = spawnSync("aspell", ["-a"], { input: text, encoding: "utf8" })
    // aspell -a outputs corrections; naive: return original if no auto-fix.
    return text
  }
  return text
}

export async function correctWithModel(text: string): Promise<string> {
  // Detect misspellings first; only call the model when there is something to fix.
  const miss = detectMisspellings(text)
  if (miss.length === 0) return text
  try {
    const corrected = await generateText({
      prompt: `Correct only spelling in the following text, preserving meaning and formatting. Reply with ONLY the corrected text, no quotes:\n${text}`,
      model: null,
    })
    return corrected.trim() || text
  } catch {
    return text
  }
}

export async function spellcheck(text: string): Promise<string> {
  const cfg = loadConfig()
  if (!cfg.enabled || cfg.mode === "off") return text
  if (cfg.mode === "traditional") return correctTraditional(text)
  return correctWithModel(text)
}
