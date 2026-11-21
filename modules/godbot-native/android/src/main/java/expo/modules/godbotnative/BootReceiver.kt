package expo.modules.godbotnative

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Brings "Keep connected in background" back after a reboot and after an app update (which
 * ends the old process), if the person had it on. Both broadcasts let an app start a
 * foreground service from the background.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> KeepAliveService.startIfWanted(context)
    }
  }
}
