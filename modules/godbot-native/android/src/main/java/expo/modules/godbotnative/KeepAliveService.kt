package expo.modules.godbotnative

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.FileProvider

/**
 * A foreground service with nothing to do but exist: while it runs, Android keeps the app's
 * process, and so its JavaScript and the WebSocket to the relay, alive in the background.
 * The person starts and stops it with a switch in Settings; it is never restarted on its own.
 */
class KeepAliveService : Service() {
  companion object {
    const val CHANNEL_ID = "connection"
    const val NOTIFICATION_ID = 7301
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"

    @Volatile
    var running = false
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Godbot"
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: ""
    ensureChannel()
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val open = launch?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(text)
      .setSmallIcon(R.drawable.godbot_status)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setContentIntent(open)
      .build()
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
    ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
    running = true
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    running = false
    super.onDestroy()
  }

  // The JS side creates the channel with a translated name first; this is the fallback.
  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL_ID) == null) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Connection", NotificationManager.IMPORTANCE_LOW))
    }
  }
}

/** Its own class, so its authority never collides with another library's FileProvider. */
class GodbotFileProvider : FileProvider()
