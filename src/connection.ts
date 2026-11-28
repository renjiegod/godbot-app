import { Platform } from 'react-native'
// Modified for Godbot. See NOTICE.
import { RelayTransport, RpcClient, SecureTransport } from '../godbot/link/index.ts'
import type { PhoneIdentity, SavedComputer } from './store.ts'
import type { ConnectorsView } from './team/connectors.ts'

type BotResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

export type FailoverTrigger = 'timeout' | 'network' | 'authentication' | 'quota' | 'agent'
export interface FailoverPolicy {
  triggers: FailoverTrigger[]
  agents: string[]
  bots: string[]
  timeoutSeconds: number | null
}
export interface FailoverEvent {
  id: string
  kind: 'agent' | 'bot'
  sessionId: string
  status: 'switched' | 'queued' | 'running' | 'completed' | 'failed' | 'exhausted' | 'stopped'
  trigger: FailoverTrigger
  from: string
  at: number
  target?: string
  targetBotId?: string
  targetSessionId?: string
  roomId?: string
}

// An option a local agent's model offers besides its thinking level, as the computer
// describes it for every agent alike (dsh-godbot core/local-agents/model-options.js).
export interface ModelOption {
  id: string
  type: 'select' | 'toggle'
  name?: string
  description?: string
  values?: { id: string; name?: string; description?: string }[]
  defaultValue?: string | boolean
}

export interface Bot {
  id: string
  name: string
  role?: string
  // The DSH permission preset the Bot runs with; unset runs on the default one.
  permission?: string
  // A credential or balance failure that stops the Bot until the user fixes it (turns.js).
  blocked?: { code: string; status?: number; provider?: string; at?: number }
  color?: string
  avatar?: { shape?: string; image?: string; imageRef?: string }
  model?: string
  appliedModel?: string
  engine?: string
  accountProfileId?: string
  sandboxKind?: string
  capabilities?: string[]
  browser?: boolean
  effort?: string
  // Picks for the model's other options by option id (speed and the like); unset ones
  // follow the agent's own setting.
  modelOptions?: Record<string, string | boolean>
  workDir?: string
  main?: boolean
  private?: boolean
  instructions?: string
  failover?: FailoverPolicy | null
  failoverHistory?: FailoverEvent[]
  sessionId?: string
  parts?: string[]
  partOrder?: string[]
  openParts?: { sessionId: string; startedAt?: number; parts?: string[] }[]
  waiting?: boolean
  pinned?: boolean
  hidden?: boolean
  sectionId?: string
  createdAt?: number
  lastAt?: number
  preview?: string
}

export interface Room {
  id: string
  name: string
  preview?: string
  lastAt?: number
  members?: string[]
  admin?: string
  mode?: string
  notice?: string
  named?: boolean
  sessionId?: string
  pinned?: boolean
  hidden?: boolean
  sectionId?: string
  createdAt?: number
}

export interface Question {
  id: string
  question: string
  detail?: string
  options?: { label: string }[]
  multiSelect?: boolean
}

export interface Approval {
  id: string
  sessionId: string
  botId: string
  roomId?: string
  at?: number
  tool: string
  reason: string
  detail?: { text?: string; code?: string }
  answerable?: boolean
}

export interface SecretRequest {
  id: string
  name?: string
  scope?: string | string[]
  status?: string
}

export interface ConnectorRequest {
  id: string
  connectorId: string
  name?: string
  purpose?: string
  callId?: string
  sessionId?: string
  status?: string
}

export interface CapabilityStatus { state?: string; error?: string }

export interface CapabilityItem {
  name: string; description?: string; kind?: string; transport?: string
  command?: string; args?: string[]; env?: Record<string, string>
  url?: string; headers?: Record<string, string>
  content?: string; items?: string[]; status?: string; approved?: boolean
}

export interface BotGoal {
  id: string
  objective: string
  acceptance: string
  sessionId?: string
  status: 'active' | 'paused' | 'blocked' | 'completed' | 'stopped'
  activity: 'queued' | 'running' | 'waiting' | null
  // Turns this goal has started. A goal has no turn or time budget.
  turns: number
  revision: number
  reason?: string
  checkpoint?: { summary: string; evidence?: string; next?: string }
}

export interface DeliveryProgress { at: number; text: string; blocked: boolean }
export interface DelegatedWork {
  turn: number
  since: number
  count: number
  lastActivityAt: number
  tool?: string
  progress?: DeliveryProgress
}

export interface TeamState {
  revision: number
  unchanged?: boolean
  liveKey?: string
  bots: Bot[]
  rooms?: Room[]
  mainBotId?: string | null
  mainBotIds?: string[]
  models?: { ref: string; name: string; id?: string; provider?: string; providerName?: string; needsKey?: boolean; options?: ModelOption[] }[]
  modelsKey?: string
  defaultModel?: string | null
  permissions?: { options?: { value: string; name: string }[]; defaultPreset?: string } | null
  readOnly?: string | null
  partsRunning?: Record<string, boolean>
  newSessions?: Record<string, 'opening' | 'empty'>
  emptyParts?: Record<string, string[]>
  // Each part of a Bot's own chat by the first thing the user asked in it (part-titles.js).
  // Sent by a host whose Bot chats go on in the background while another part is open.
  partTitles?: Record<string, string>
  // DSH's session-list timestamp by part. It can change without a team revision.
  partActivity?: Record<string, number>
  sections?: { id: string; name: string; collapsed?: boolean; color?: string; description?: string }[]
  memory?: boolean
  botGoals?: Record<string, BotGoal>
  /** Live queue reason keyed by goal ID. It can change without a team revision. */
  botGoalWaits?: Record<string, string>
  questions?: Record<string, Question>
  views?: Record<string, ShownView>
  secretRequests?: Record<string, SecretRequest[]>
  connectorRequests?: Record<string, ConnectorRequest[]>
  connectors?: ConnectorsView
  capabilities?: CapabilityItem[]
  browserHolds?: Record<string, { by?: string; reason?: string; note?: string; callId?: string }>
  btwCards?: Record<string, { id: string; partId?: string; question?: string; answer?: string; failure?: string; status?: string }[]>
  sideChats?: Record<string, { chatId: string; entries?: { id: string; question?: string; answer?: string; status?: string; failure?: string }[] }[]>
  capabilityStatuses?: Record<string, Record<string, CapabilityStatus> | CapabilityStatus>
  workspace?: string
  dataPath?: string
  version?: string
  work?: {
    // `since`: when the turn began (as `turns` keys it per Session); `roomId`: the work
    // runs in that group chat, not in the Bot's own chat.
    bots?: Record<string, { tool?: string; said?: string; note?: string; target?: string; switching?: boolean; folder?: boolean; since?: number; roomId?: string }>
    // A member at work in a group: `sessionId` and `turn` name its group Session and the
    // turn it runs there, which the member's work sheet reads; `count` the tools it ran.
    rooms?: Record<string, { botId: string; tool?: string; said?: string; note?: string; target?: string; sessionId?: string; turn?: number; since?: number; count?: number }[]>
    approvals?: Approval[]
    waiting?: Record<string, { bots?: string[]; rooms?: string[] }>
    turns?: Record<string, number>
    delegated?: Record<string, DelegatedWork>
  }
  activity?: Record<string, { tool?: string; said?: string; note?: string; target?: string; switching?: boolean }>
  exchangeTurns?: Record<string, number[]>
  prefs?: { theme?: string; accent?: string; layout?: string; width?: number; flatWidth?: number }
}

function phoneName(): string {
  const constants = Platform.constants as { Manufacturer?: string; Model?: string }
  return [constants.Manufacturer, constants.Model].filter(Boolean).join(' ') || 'Android phone'
}

/** A card as the computer keeps it: `view` is the root node of the blueprint. */
export interface ShownView { id?: string; title?: string; view?: unknown }

// The relay under each link, for push registration and background liveness checks.
const relays = new WeakMap<RpcClient, { transport: RelayTransport; receivedFrames: () => number }>()
export const relayOf = (client: RpcClient): RelayTransport | undefined => relays.get(client)?.transport
export const relayFramesReceived = (client: RpcClient): number => relays.get(client)?.receivedFrames() ?? 0

/**
 * Opens the encrypted link to the computer. The pairing code goes only with the first
 * connection. `onClient` gets the client before the handshake, so the caller can close an
 * attempt that never finishes (in the background no JS timer fires to time it out).
 */
export async function openLink(computer: SavedComputer, identity: PhoneIdentity, pairingCode?: string, onClient?: (client: RpcClient) => void): Promise<RpcClient> {
  let receivedFrames = 0
  const relay = new RelayTransport(computer.server, {
    deviceId: identity.deviceId,
    identityKey: identity.publicKey,
    accessToken: identity.accessToken,
    targetDeviceId: computer.hostDeviceId,
    // Offer Godbot's push extension; it is used only when the relay supports it.
    push: true,
    createSocket(url) {
      const socket = new WebSocket(url)
      // The transport's byte counter only tracks ciphertext. Heartbeats are control frames.
      socket.addEventListener('message', () => { receivedFrames += 1 })
      return socket
    },
  })
  const secure = new SecureTransport(relay, identity, { deviceId: computer.hostDeviceId, identityKey: computer.hostKey }, {
    hello: { name: phoneName(), ...(pairingCode === undefined ? {} : { pairingCode }) },
  })
  const client = new RpcClient(secure)
  relays.set(client, { transport: relay, receivedFrames: () => receivedFrames })
  onClient?.(client)
  await client.connect()
  return client
}

/** Calls one Godbot team endpoint on the computer, the same one its window calls. */
export async function callBot<T>(client: RpcClient, endpoint: string, payload: unknown = {}, signal?: AbortSignal): Promise<T> {
  const result = await client.rpc<BotResult<T>>('bot', { endpoint, payload }, { signal })
  if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code })
  return result.value
}

/**
 * Same call, but the request carries `state` (the payload the `state` endpoint
 * would take). A write that moved the team answers with the new state in the
 * same reply, so the phone needs no second round trip.
 */
export async function callBotState<T>(client: RpcClient, endpoint: string, payload: unknown, state: unknown, signal?: AbortSignal): Promise<{ value: T; state?: TeamState }> {
  const result = await client.rpc<BotResult<T> & { state?: TeamState }>('bot', { endpoint, payload, state }, { signal })
  if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code })
  return { value: result.value, state: result.state }
}
