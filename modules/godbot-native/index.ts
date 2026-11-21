import { requireOptionalNativeModule } from 'expo-modules-core'

export interface GodbotNativeModule {
  /** Starts the foreground service that keeps the link alive in the background. */
  startKeepAlive(title: string, text: string): boolean
  stopKeepAlive(): boolean
  isKeepAliveRunning(): boolean
  /** Lowercase hex SHA-256 of a file, read in chunks so a large APK never sits in memory. */
  sha256File(path: string): Promise<string>
  /** Whether Android lets this app hand an APK to the installer. */
  canInstallPackages(): boolean
  /** Opens the system page where the person allows installs from this app. */
  openInstallPermission(): void
  /** Hands an APK in the cache's updates/ folder to the system installer. */
  installApk(path: string): void
}

// Null in demo builds run outside Android and in tests; callers treat it as "not available".
export const GodbotNative = requireOptionalNativeModule<GodbotNativeModule>('GodbotNative')
