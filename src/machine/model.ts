import type { RpcClient } from '../../godbot/link/index.ts'
import type { SavedComputer } from '../store.ts'

export type Mode = 'desktop' | 'terminal'
// A Wayland screen or input chooser can stay open for 80 seconds on the target.
export const DESKTOP_CONSENT_TIMEOUT_MS = 110_000
export interface ComputerHello {
  version: 1
  kind: 'computer'
  name: string
  os: string
  account: string
  desktop: boolean
  control: boolean
  terminal: boolean
  desktopReason?: string
}
export interface SavedMachine extends SavedComputer {
  kind: 'machine'
  os: string
  account: string
  desktop: boolean
  terminal: boolean
  lastConnected: number
}
export interface Session {
  sessionId: string
  mode: Mode
  state: 'pending' | 'approved' | 'denied' | 'closed'
  control: boolean
  controlPending?: boolean
  controlReason?: string | null
  expiresAt: number
  reason?: string
  iceGeneration?: number
  iceServers?: { urls: string | string[]; username?: string; credential?: string }[]
}
export interface Display {
  id: string
  name: string
  width: number
  height: number
  revision: number
}

export async function machineHello(client: RpcClient): Promise<ComputerHello> {
  const hello = await client.rpc<ComputerHello>('computer.hello', {}, { timeoutMs: 8000 })
  if (
    hello?.kind !== 'computer' ||
    hello.version !== 1 ||
    typeof hello.name !== 'string' ||
    typeof hello.os !== 'string' ||
    typeof hello.account !== 'string'
  )
    throw new Error('Incompatible computer host')
  return hello
}

const sessionEndLabels: Readonly<Record<string, string>> = {
  revoked: 'Access ended by the computer',
  denied: 'Request declined on the computer',
  local_management: 'Sharing paused for a private prompt',
  local_approval: 'Sharing paused for a private prompt',
  expired: 'Connection lost',
  disconnected: 'Connection lost',
  host_stopped: 'Connection lost',
  input_failed: 'Desktop input unavailable',
  desktop_failed: 'Desktop connection failed',
  desktop_ended: 'Desktop session ended',
  pty_failed: 'Terminal session failed',
  closed: 'Session ended',
}

export function machineEndReason(reason?: string): string {
  if (!reason) return 'Access ended by the computer'
  return Object.hasOwn(sessionEndLabels, reason) ? sessionEndLabels[reason] : reason
}

export function machineError(error: unknown): string {
  const code = String((error as { code?: unknown })?.code ?? '')
  if (code === 'HOST_OFFLINE') return 'Computer offline'
  if (code === 'INPUT_REVOKED') return 'Remote control permission was revoked. You can still view the screen.'
  if (code === 'INPUT_DENIED') return 'The computer declined control. You can still view its screen.'
  if (code === 'NOT_PAIRED' || code === 'DEVICE_REVOKED') return 'Pair again with a fresh offer from this computer.'
  if (code === 'RPC_TIMEOUT' || code === 'SERVER_UNREACHABLE') return 'Connection timed out'
  if (code === 'TRANSPORT_CLOSED' || code === 'CLIENT_CLOSED') return 'Connection lost'
  return error instanceof Error ? error.message : String(error)
}
