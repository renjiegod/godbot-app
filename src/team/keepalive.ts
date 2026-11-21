// Godbot: "Keep connected in background". A foreground service (modules/godbot-native)
// keeps the app's process alive, so the encrypted link stays open and notices from the
// computer become notifications. Off by default; Android shows an ongoing notification.
import { GodbotNative } from '../../modules/godbot-native/index.ts'
import { readPrefs, writePrefs } from '../store.ts'
import { t } from '../ui/i18n.ts'
import { ensureChannels } from './notify.ts'

export const keepAliveSupported = (): boolean => GodbotNative !== null

export const keepAliveRunning = (): boolean => GodbotNative?.isKeepAliveRunning() ?? false

export async function keepAliveWanted(): Promise<boolean> {
  return (await readPrefs()).keepAlive === 'on'
}

/** Starts or stops the service to match the setting. Runs while the app is on screen. */
export async function syncKeepAlive(computerName?: string): Promise<boolean> {
  if (GodbotNative === null) return false
  if (!(await keepAliveWanted())) {
    if (GodbotNative.isKeepAliveRunning()) GodbotNative.stopKeepAlive()
    return false
  }
  await ensureChannels().catch(() => {})
  const text = computerName ? t('Connected to {name}', { name: computerName }) : t('Keeping the link to your computer open')
  GodbotNative.startKeepAlive(t('Godbot is connected'), text)
  return true
}

export async function setKeepAlive(on: boolean, computerName?: string): Promise<boolean> {
  await writePrefs({ keepAlive: on ? 'on' : 'off' })
  return syncKeepAlive(computerName)
}
