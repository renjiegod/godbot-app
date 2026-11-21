// Godbot: "Keep connected in background". A foreground service (modules/godbot-native)
// keeps the app's process alive, and linkManager keeps the encrypted link open in it, so
// notices from the computer become notifications. The link does not depend on the screens:
// it stays when the person swipes the app away from Recents, and the service brings it back
// after a reboot, an app update, or Android restarting the killed process (keepalive-task.ts).
// Off by default; Android shows an ongoing notification.
import { GodbotNative } from '../../modules/godbot-native/index.ts'
import { loadComputer, loadIdentity, readPrefs, writePrefs } from '../store.ts'
import { t } from '../ui/i18n.ts'
import { linkManager } from './link.ts'
import { ensureChannels } from './notify.ts'

let keepAliveGeneration = 0

export const keepAliveSupported = (): boolean => GodbotNative !== null

export const keepAliveRunning = (): boolean => GodbotNative?.isKeepAliveRunning() ?? false

export async function keepAliveWanted(): Promise<boolean> {
  return (await readPrefs()).keepAlive === 'on'
}

/** Starts or stops the service to match the setting. Runs while the app is on screen. */
export async function syncKeepAlive(computerName?: string): Promise<boolean> {
  if (GodbotNative === null) return false
  const generation = keepAliveGeneration
  const wanted = await keepAliveWanted()
  if (generation !== keepAliveGeneration) return false
  if (!wanted) {
    pauseKeepAlive()
    return false
  }
  await ensureChannels().catch(() => {})
  if (generation !== keepAliveGeneration) return false
  const text = computerName ? t('Connected to {name}', { name: computerName }) : t('Keeping the link to your computer open')
  // The service saves the wish and the two lines, so a reboot starts it again as it was.
  GodbotNative.startKeepAlive(t('Godbot is connected'), text)
  return true
}

export async function setKeepAlive(on: boolean, computerName?: string): Promise<boolean> {
  await writePrefs({ keepAlive: on ? 'on' : 'off' })
  return syncKeepAlive(computerName)
}

/** No computer to keep a link to (the last one was forgotten): the service stops, the setting stays. */
export function pauseKeepAlive(): void {
  keepAliveGeneration += 1
  linkManager.releaseKeepAlive()
  // Always clear the native preference, even between a start request and the service running.
  GodbotNative?.stopKeepAlive()
}

/**
 * The service runs (the switch, a reboot, Android restarting it): hold the link to the active
 * computer, with or without screens. False when there is nothing to hold.
 */
export async function holdKeepAliveLink(): Promise<boolean> {
  // The demo team has no computer behind it.
  if (process.env.EXPO_PUBLIC_GODBOT_DEMO === '1') return false
  const generation = keepAliveGeneration
  const wanted = await keepAliveWanted()
  if (generation !== keepAliveGeneration) return false
  if (!wanted) {
    pauseKeepAlive()
    return false
  }
  const computer = await loadComputer()
  if (generation !== keepAliveGeneration) return false
  if (computer === undefined) { pauseKeepAlive(); return false }
  const identity = await loadIdentity()
  if (generation !== keepAliveGeneration) return false
  linkManager.holdForKeepAlive(computer, identity)
  return true
}
