// Godbot: the handshake answer from the computer, and what the app makes of it.
// The phone sends the API versions it speaks; the computer answers with the one both
// speak (or null), its plugin's name and version, and the notice cursor.

/** The mobile API versions this app speaks (Godbot's core/mobile.js API_VERSION). */
export const SUPPORTED_API = [1]
/** The plugin a Godbot computer runs. */
export const GODBOT_PLUGIN = 'dsh-godbot'

export interface Hello {
  api: number | null
  apiMin?: number
  apiMax?: number
  capabilities: string[]
  boot: string
  seq: number
  plugin?: { name?: string; version?: string }
}

export type HelloVerdict =
  | { ok: true }
  /** The computer's Godbot is older than this app. */
  | { ok: false; reason: 'update-godbot' }
  /** This app is older than the computer's Godbot. */
  | { ok: false; reason: 'update-app' }
  /** The computer runs another plugin on the same link (DS Bot). */
  | { ok: false; reason: 'not-godbot'; name: string }

export const helloRequest = () => ({ api: SUPPORTED_API })

export function checkHello(answer: unknown): HelloVerdict {
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) return { ok: false, reason: 'update-godbot' }
  const hello = answer as Partial<Hello>
  const name = hello.plugin?.name
  if (typeof name === 'string' && name !== GODBOT_PLUGIN) return { ok: false, reason: 'not-godbot', name }
  if (name !== GODBOT_PLUGIN) return { ok: false, reason: 'update-godbot' }
  if (typeof hello.api === 'number' && SUPPORTED_API.includes(hello.api)) {
    if (typeof hello.boot !== 'string' || hello.boot === '' || typeof hello.seq !== 'number' || !Number.isSafeInteger(hello.seq) || hello.seq < 0 || !Array.isArray(hello.capabilities)) {
      return { ok: false, reason: 'update-godbot' }
    }
    return { ok: true }
  }
  const newest = Math.max(...SUPPORTED_API)
  if (typeof hello.apiMin === 'number' && hello.apiMin > newest) return { ok: false, reason: 'update-app' }
  return { ok: false, reason: 'update-godbot' }
}
