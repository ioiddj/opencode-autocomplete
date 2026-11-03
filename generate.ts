// generate.ts — stateless inference via OpenCode's experimental generate routes.
//
// POST {prompt, model} to /api/experimental/generate/text and return the
// assistant text. No session is created, so this is far lighter than
// session.create + session.prompt — ideal for autocomplete and spellcheck.
//
// The server URL + password are resolved the same way the measured v2
// attack plugin does (see targets/attack/plugins/attack.v2.ts):
//   1. OPENCODE_SERVER_URL + OPENCODE_SERVER_PASSWORD env vars
//   2. service.json (url + password) — config dir, local-state dir, bounded search
//   3. fall back to localhost defaults
//
// Auth is `Authorization: Basic base64("opencode:" + password)`, matching the
// v2 service's own client calls.
//
// NOTE: the installed @opencode-ai/sdk does not yet expose
// experimental.generate.text, so this uses a raw fetch. The response shape
// (GenerateTextResponse) is not pinned in the installed types, so we read
// several possible text fields and fall back to the raw body.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

interface ServiceInfo {
  url: string
  password: string
}

let cached: ServiceInfo | null | undefined = undefined

function defaultBaseUrls(): string[] {
  // v1 service listens on 45998; v2 on whatever service.json says (often 49374).
  // Try both so the same module works in either generation.
  return ["http://localhost:45998", "http://127.0.0.1:49374", "http://localhost:4096"]
}

function parseServiceJson(raw: string): ServiceInfo | null {
  try {
    const p = JSON.parse(raw)
    if (p?.url && p?.password) return { url: String(p.url), password: String(p.password) }
  } catch { /* ignore */ }
  return null
}

function readServiceJson(path: string): ServiceInfo | null {
  try {
    if (existsSync(path)) return parseServiceJson(readFileSync(path, "utf8"))
  } catch { /* ignore */ }
  return null
}

function findServiceJson(): ServiceInfo | null {
  const candidates: string[] = [
    // v2 local-state service.json (has url + password)
    join(process.env.XDG_STATE_HOME || "", "opencode", "service.json"),
    join(homedir(), ".local", "state", "opencode", "service.json"),
    join(process.env.XDG_STATE_HOME || "", "opencode-v2-home", "service.json"),
    join(homedir(), ".local", "state", "opencode-v2-home", "service.json"),
    // v1 config dir service.json (password only usually, but try)
    join(process.env.OPENCODE_CONFIG_DIR || join(homedir(), ".config", "opencode"), "service.json"),
    join(homedir(), ".config", "opencode", "service.json"),
  ]
  for (const c of candidates) {
    const info = readServiceJson(c)
    if (info) return info
  }
  // Bounded drilldown for service.json carrying url+password
  const roots = [homedir(), "/tmp", "/mnt/data"]
  const found: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth <= 0 || found.length >= 6) return
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
    for (const e of entries) {
      if (e === "node_modules" || e === ".git") continue
      const full = join(dir, e)
      try {
        const st = statSync(full)
        if (st.isFile() && e === "service.json") {
          found.push(full)
          if (found.length >= 6) return
        } else if (st.isDirectory()) {
          walk(full, depth - 1)
        }
      } catch { /* skip */ }
    }
  }
  for (const root of roots) {
    if (root && existsSync(root)) walk(root, 3)
  }
  for (const p of found) {
    const info = readServiceJson(p)
    if (info) return info
  }
  return null
}

export function getServiceInfo(): ServiceInfo | null {
  if (cached !== undefined) return cached
  // 1. env
  const url = process.env.OPENCODE_SERVER_URL
  const pw = process.env.OPENCODE_SERVER_PASSWORD
  if (url && pw) { cached = { url, password: pw }; return cached }
  // 2. service.json
  const fromFile = findServiceJson()
  if (fromFile) { cached = fromFile; return cached }
  // 3. nothing resolvable
  cached = null
  return null
}

export function getServiceBaseUrl(): string | null {
  const info = getServiceInfo()
  return info ? info.url : null
}

export function getServicePassword(): string | null {
  const info = getServiceInfo()
  return info ? info.password : null
}

export function serviceAuthHeaders(): HeadersInit {
  const pw = getServicePassword()
  if (pw) {
    const token = Buffer.from(`opencode:${pw}`).toString("base64")
    return { Authorization: `Basic ${token}` }
  }
  if (process.env.OPENCODE_API_KEY) {
    return { Authorization: `Bearer ${process.env.OPENCODE_API_KEY}` }
  }
  return {}
}

interface GenerateTextOptions {
  prompt: string
  model?: string | null
  baseUrl?: string
}

export async function generateText(opts: GenerateTextOptions): Promise<string> {
  const base = opts.baseUrl ?? getServiceBaseUrl() ?? defaultBaseUrls()[0]
  const url = `${base.replace(/\/$/, "")}/api/experimental/generate/text`
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...Object.fromEntries(Object.entries(serviceAuthHeaders())),
  }
  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt: opts.prompt, model: opts.model ?? null }),
      signal: AbortSignal.timeout(20000),
    })
  } catch {
    // Try the deprecated /api/experimental/generate path as a fallback.
    try {
      const fallback = `${base.replace(/\/$/, "")}/api/experimental/generate`
      res = await fetch(fallback, {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt: opts.prompt, model: opts.model ?? null }),
        signal: AbortSignal.timeout(20000),
      })
    } catch {
      return ""
    }
  }
  if (!res.ok) return ""
  const ct = res.headers.get("content-type") ?? ""
  if (ct.includes("application/json")) {
    try {
      const data = await res.json()
      if (typeof data?.text === "string") return data.text
      if (typeof data?.completion === "string") return data.completion
      if (typeof data?.result === "string") return data.result
      if (typeof data?.message === "string") return data.message
      if (data && typeof data === "object") {
        for (const k of Object.keys(data)) {
          if (typeof (data as any)[k] === "string") return (data as any)[k]
        }
      }
    } catch { /* fall through to raw text */ }
  }
  try {
    return await res.text()
  } catch {
    return ""
  }
}
