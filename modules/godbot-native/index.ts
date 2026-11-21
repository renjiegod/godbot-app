import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core'

export interface GodbotNativeModule {
  /**
   * Starts the foreground service that keeps the link alive in the background, and saves
   * the wish with the two lines, so a reboot or an app update starts it again as it was.
   */
  startKeepAlive(title: string, text: string): boolean
  /** Stops the service and forgets the wish. */
  stopKeepAlive(): boolean
  isKeepAliveRunning(): boolean
  /** The service's beat: about every 30 s, and when the network comes back or the screen turns on. */
  addListener(event: 'onKeepAliveTick', listener: (event: { reason: string }) => void): EventSubscription
  /** Whether Android exempts this app from battery optimization (Doze, app standby). */
  isIgnoringBatteryOptimizations(): boolean
  /** Asks the person to exempt this app from battery optimization; false when no page could open. */
  requestIgnoreBatteryOptimizations(): boolean
  /**
   * Opens the phone maker's page where apps may start on their own (Xiaomi, Huawei, Honor,
   * OPPO, vivo, OnePlus, Samsung …), or this app's system settings when there is none.
   * Resolves which one opened: 'maker' or 'app'.
   */
  openAutoStartSettings(): string
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
