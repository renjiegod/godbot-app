// Godbot: checking for, downloading and installing a new APK of this app.
import Constants from 'expo-constants'
import { Directory, File, Paths } from 'expo-file-system'
import { GodbotNative } from '../../modules/godbot-native/index.ts'
import { t } from '../ui/i18n.ts'
import { isNewer, manifestUrl, parseManifest, type AppManifest } from './app-update.ts'

export type UpdatePhase = 'downloading' | 'verifying' | 'installing'

export const currentVersionCode = (): number => Number(Constants.expoConfig?.android?.versionCode ?? 0)
export const currentVersionName = (): string => String(Constants.expoConfig?.version ?? '')

export async function checkAppUpdate(server: string): Promise<{ manifest: AppManifest; newer: boolean }> {
  const url = manifestUrl(server)
  if (url === null) throw new Error(t('This Server address has no update page.'))
  let response: Response
  try {
    response = await fetch(url, { headers: { accept: 'application/json' } })
  } catch {
    throw new Error(t('Could not reach the Server to check for updates.'))
  }
  if (response.status === 404) throw new Error(t('This Server offers no app updates.'))
  if (!response.ok) throw new Error(t('The Server answered {status} to the update check.', { status: response.status }))
  const manifest = parseManifest(await response.json(), url)
  return { manifest, newer: isNewer(manifest, currentVersionCode()) }
}

export async function installAppUpdate(manifest: AppManifest, onPhase: (phase: UpdatePhase) => void): Promise<void> {
  const native = GodbotNative
  if (native === null) throw new Error(t('Updates install only on Android.'))
  if (!native.canInstallPackages()) {
    native.openInstallPermission()
    throw new Error(t('Allow Godbot to install apps, then try again.'))
  }
  const dir = new Directory(Paths.cache, 'updates')
  if (!dir.exists) dir.create({ intermediates: true })
  for (const old of dir.list()) old.delete()
  const target = new File(dir, `godbot-${manifest.versionCode}.apk`)
  onPhase('downloading')
  const file = await File.downloadFileAsync(manifest.url, target, { idempotent: true })
  onPhase('verifying')
  const hash = await native.sha256File(file.uri)
  if (file.size !== manifest.size || hash !== manifest.sha256) {
    file.delete()
    throw new Error(t('The download does not match the update information. Try again.'))
  }
  onPhase('installing')
  native.installApk(file.uri)
}
