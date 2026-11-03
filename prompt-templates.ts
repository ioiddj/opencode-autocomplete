// Shared prompt templates used by both generations so autocomplete and
// spellcheck behave identically regardless of which OpenCode generation loads
// the plugin.

/** Ask the model to continue a partial prompt. Returns the completion text only. */
export function completePrompt(partial: string): string {
  return `Complete the following prompt; reply with ONLY the completion text, no quotes:\n${partial}`
}

/** Ask the model to correct only spelling, preserving meaning and formatting. */
export function spellcheckPrompt(text: string): string {
  return `Correct only spelling in the following text, preserving meaning and formatting. Reply with ONLY the corrected text, no quotes:\n${text}`
}
