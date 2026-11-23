// Godbot: signing in a local agent CLI on the computer from the phone. A Bot that runs
// on Claude Code or Codex stops with LOCAL_AGENT_SIGNIN when that CLI is signed out;
// the computer runs the CLI's own login (dsh-godbot's local-agents/sign-in.js) and
// hands the phone its link and code. The CLI keeps the credential; neither the phone
// nor Godbot sees it.
import { t } from '../ui/i18n.ts'

/** The capability a computer announces in `hello` once it has the sign-in endpoints. */
export const LOGIN_CAPABILITY = 'local-agent-login'

/**
 * The CLIs a phone can sign in, and how. Claude Code shows the sign-in page's code to
 * paste back (its other link returns to the computer's loopback, which a phone cannot
 * reach); Codex uses its device code. Other CLIs sign in through their own screen in a
 * terminal, which only the computer's Godbot shows.
 */
export const PHONE_METHODS: Record<string, string> = {
  'local-claude-code': 'browser',
  'local-codex-cli': 'device',
}

/** The engine names, for a CLI the team's model list does not name. */
const NAMES: Record<string, string> = {
  'local-claude-code': 'Claude Code',
  'local-codex-cli': 'Codex CLI',
  'local-gemini-cli': 'Gemini CLI',
  'local-antigravity': 'Antigravity',
}

export interface LoginView {
  loginId: string
  route: string
  name?: string
  state: 'starting' | 'waiting' | 'verifying' | 'exited' | 'done' | 'failed' | 'canceled'
  kind: 'pipe' | 'terminal'
  version: number
  method?: string
  methods?: string[]
  url?: string
  autoUrl?: string
  code?: string
  paste?: 'code' | 'callback'
  verified?: boolean
  error?: { reason?: string; detail?: string }
}

export const ACTIVE_STATES = new Set(['starting', 'waiting', 'verifying', 'exited'])

/** A built-in local agent route; not a custom ACP agent or a sandbox account. */
export const isLocalAgentRoute = (route: string | undefined): route is string =>
  typeof route === 'string' && /^local-(?!acp-|sandbox-)/u.test(route)

export const agentNameOf = (route: string, named?: string) => named || NAMES[route] || route.replace(/^local-/u, '')

/**
 * Where a Bot blocked on its CLI's sign-in can sign in: here on the phone, on the
 * computer's Godbot (a CLI that signs in in a terminal), or nowhere until the
 * computer's Godbot is updated.
 */
export function signInPlace(route: string | undefined, capabilities: readonly string[] | undefined): 'phone' | 'computer' | 'update-godbot' | null {
  if (!isLocalAgentRoute(route)) return null
  if (!(capabilities ?? []).includes(LOGIN_CAPABILITY)) return 'update-godbot'
  return Object.hasOwn(PHONE_METHODS, route) ? 'phone' : 'computer'
}

export type PhoneStep =
  | { kind: 'starting' }
  | { kind: 'device'; link?: string; code: string; verifying: boolean }
  | { kind: 'code'; link?: string; verifying: boolean }
  | { kind: 'computer' }
  | { kind: 'done'; verified: boolean }
  | { kind: 'failed'; reason?: string; detail?: string }
  | { kind: 'canceled' }

/** What the phone shows for a sign-in view from the computer. */
export function phoneStep(view: LoginView | null): PhoneStep {
  if (view === null) return { kind: 'starting' }
  if (view.state === 'done') return { kind: 'done', verified: view.verified !== false }
  if (view.state === 'failed') return { kind: 'failed', reason: view.error?.reason, detail: view.error?.detail }
  if (view.state === 'canceled') return { kind: 'canceled' }
  if (view.kind === 'terminal') return { kind: 'computer' }
  if (view.state === 'starting') return { kind: 'starting' }
  const verifying = view.state === 'verifying'
  if (view.code !== undefined) return { kind: 'device', link: view.url, code: view.code, verifying }
  // Only the printed link: the other one returns to the computer's loopback address.
  if (view.url === undefined) return { kind: 'starting' }
  return { kind: 'code', link: view.url, verifying }
}

/** The words for a sign-in that ended without one. */
export function signInFailureText(reason: string | undefined, agent: string): string {
  switch (reason) {
    case 'timeout': return t('The sign-in took too long and was stopped.')
    case 'still-signed-out': return t('{agent} finished, but still says it is not signed in.', { agent })
    case 'outdated': return t('This version of {agent} cannot sign in this way. Update it, then try again.', { agent })
    case 'spawn': return t('{agent} could not start.', { agent })
    default: return t('{agent} could not sign in.', { agent })
  }
}
