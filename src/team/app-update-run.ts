// Godbot: checking for, downloading and installing a new APK of this app.
import Constants from 'expo-constants'
import { Directory, File, Paths } from 'expo-file-system'
import { GodbotNative } from '../../modules/godbot-native/index.ts'
import { t } from '../ui/i18n.ts'
import { isNewer, manifestUrl, parseManifest, type AppManifest } from './app-update.ts'

export type AppUpdateInstall =
  | { status: 'downloading'; manifest: AppManifest; bytesWritten: number; bytesPerSecond: number }
  | { status: 'verifying'; manifest: AppManifest }

// There is one APK download for the whole app, including when About is reopened.
let activeInstall: AppUpdateInstall | null = null
const installListeners = new Set<() => void>()

export const getAppUpdateInstall = () => activeInstall
export function subscribeAppUpdateInstall(listener: () => void): () => void {
  installListeners.add(listener)
  return () => { installListeners.delete(listener) }
}

function setActiveInstall(install: AppUpdateInstall | null): void {
  activeInstall = install
  for (const listener of installListeners) listener()
}

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

async function downloadApk(manifest: AppManifest, target: File): Promise<File> {
  let bytesWritten = 0
  let lastBytes = 0
  let lastTime = performance.now()
  let lastSpeed = 0
  // Sample even if the server stops sending data so the displayed rate drops to zero.
  const timer = setInterval(() => {
    const now = performance.now()
    const bytesPerSecond = (bytesWritten - lastBytes) * 1000 / (now - lastTime)
    if (bytesWritten !== lastBytes || bytesPerSecond !== lastSpeed) {
      setActiveInstall({ status: 'downloading', manifest, bytesWritten, bytesPerSecond })
    }
    lastBytes = bytesWritten
    lastTime = now
    lastSpeed = bytesPerSecond
  }, 1250)
  try {
    return await File.downloadFileAsync(manifest.url, target, {
      idempotent: true,
      onProgress: progress => { bytesWritten = progress.bytesWritten },
    })
  } finally {
    clearInterval(timer)
  }
}

export async function installAppUpdate(manifest: AppManifest): Promise<boolean> {
  if (activeInstall !== null) return false
  const native = GodbotNative
  if (native === null) throw new Error(t('Updates install only on Android.'))
  if (!native.canInstallPackages()) {
    native.openInstallPermission()
    throw new Error(t('Allow Godbot to install apps, then try again.'))
  }
  setActiveInstall({ status: 'downloading', manifest, bytesWritten: 0, bytesPerSecond: 0 })
  try {
    const dir = new Directory(Paths.cache, 'updates')
    if (!dir.exists) dir.create({ intermediates: true })
    for (const old of dir.list()) old.delete()
    const target = new File(dir, `godbot-${manifest.versionCode}.apk`)
    const file = await downloadApk(manifest, target)
    setActiveInstall({ status: 'verifying', manifest })
    const hash = await native.sha256File(file.uri)
    if (file.size !== manifest.size || hash !== manifest.sha256) {
      file.delete()
      throw new Error(t('The download does not match the update information. Try again.'))
    }
    native.installApk(file.uri)
    return true
  } finally {
    setActiveInstall(null)
  }
}
