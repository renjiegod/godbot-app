// Godbot: after each handshake, give this computer the phone's push key and tell the
// relay where to push. Every step is optional: no Firebase, an older computer or a relay
// without push only means the phone gets nothing while the app is closed.
import type { RelayTransport, RpcClient } from '../../godbot/link/index.ts'
import { PUSH_KEY_METHOD } from '../../godbot/link/push.ts'
import { relayOf } from '../connection.ts'
import { listComputers, readPrefs } from '../store.ts'
import { fcmToken } from './fcm.ts'
import { ensurePushKey } from './push-keys.ts'

export type PushStatus = 'pending' | 'off' | 'no-fcm' | 'old-computer' | 'no-server' | 'on' | 'failed'
export interface PushState { status: PushStatus; code?: string }

let state: PushState = { status: 'pending' }
// The last link set up, so a change of the setting applies without reconnecting.
let last: { client: RpcClient; hostDeviceId: string } | null = null
const listeners = new Set<() => void>()

export const pushState = (): PushState => state
export function onPushState(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
function set(next: PushState): PushState {
  state = next
  listeners.forEach(listener => listener())
  return next
}

export async function setupPush(client: RpcClient, relay: RelayTransport | undefined, hostDeviceId: string): Promise<PushState> {
  const prefs = await readPrefs()
  if (prefs.push === 'off') {
    // Tell the relay to forget this phone's token, so nothing is pushed while it is off.
    if (relay?.pushAvailable === true) await relay.registerPush(null, [])
    return set({ status: 'off' })
  }
  const token = await fcmToken()
  if (token === null) return set({ status: 'no-fcm' })
  const key = await ensurePushKey(hostDeviceId)
  try {
    await client.rpc(PUSH_KEY_METHOD, { key })
  } catch (failure) {
    return set({ status: 'old-computer', code: String((failure as { code?: unknown })?.code ?? '') })
  }
  if (relay === undefined || !relay.pushAvailable) return set({ status: 'no-server' })
  const { computers } = await listComputers()
  const result = await relay.registerPush(token, computers.map(item => item.hostDeviceId))
  return set(result.ok ? { status: 'on' } : { status: 'failed', ...(result.code ? { code: result.code } : {}) })
}

/** setupPush with the relay socket the link was opened on. */
export function setupPushFor(client: RpcClient, hostDeviceId: string): Promise<PushState> {
  last = { client, hostDeviceId }
  return setupPush(client, relayOf(client), hostDeviceId)
}

/** Runs the setup again on the current link, after the push setting changed. */
export function setupPushAgain(): Promise<PushState> {
  if (last === null) return Promise.resolve(state)
  return setupPushFor(last.client, last.hostDeviceId).catch(() => state)
}

/** The push state in the person's words. */
export function pushStatusText(value: PushState, t: (key: string, params?: Record<string, string>) => string): string {
  switch (value.status) {
    case 'pending': return t('Not set up yet')
    case 'off': return t('Off')
    case 'no-fcm': return t('Needs Firebase in this build')
    case 'old-computer': return t('Update Godbot on the computer')
    case 'no-server': return t('The Server does not push')
    case 'on': return t('On')
    case 'failed': return t('Failed: {code}', { code: value.code ?? '' })
  }
}
