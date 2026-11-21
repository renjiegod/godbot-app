package expo.modules.godbotnative

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider

/**
 * A foreground service that keeps the app's process, and with it the JavaScript link manager
 * and its WebSocket to the relay, alive in the background. The person turns it on and off in
 * Settings; the wish is saved, so the service comes back by itself:
 * - after a reboot or an app update (BootReceiver);
 * - after Android kills the process (START_STICKY), when Android lets it start again.
 *
 * Each start runs the JavaScript side (KeepAliveTaskService), also with no screen up. While it
 * runs, it gives JavaScript a beat: React Native runs no JS timers in the background, so the
 * link manager checks the link and retries by the clock on each beat (src/team/link-manager.ts).
 */
class KeepAliveService : Service() {
  companion object {
    const val CHANNEL_ID = "connection"
    const val NOTIFICATION_ID = 7301
    private const val PREFS = "godbot.keepalive"
    private const val WANTED = "wanted"
    private const val TITLE = "title"
    private const val TEXT = "text"
    // The beat. The relay pings every 25 s, so 30 s of silence is worth a probe.
    private const val BEAT_MS = 30_000L
    // After the network or the screen comes back, one more beat checks the probe's answer.
    private const val FOLLOW_UP_MS = 10_000L

    @Volatile
    var running = false

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** The person turned it on: remember that, with the notification's two lines. */
    fun remember(context: Context, title: String, text: String) {
      prefs(context).edit().putBoolean(WANTED, true).putString(TITLE, title).putString(TEXT, text).apply()
    }

    /** The person turned it off. */
    fun forget(context: Context) {
      prefs(context).edit().putBoolean(WANTED, false).apply()
    }

    fun wanted(context: Context): Boolean = prefs(context).getBoolean(WANTED, false)

    /** Starts the service again if the person wants it (after a reboot or an app update). */
    fun startIfWanted(context: Context) {
      if (!wanted(context)) return
      try {
        ContextCompat.startForegroundService(context, Intent(context, KeepAliveService::class.java))
      } catch (_: Exception) {
        // Android refused a start from the background; opening the app starts it.
      }
    }
  }

  private val handler = Handler(Looper.getMainLooper())
  private val beat = object : Runnable {
    override fun run() {
      tick("beat")
      handler.postDelayed(this, BEAT_MS)
    }
  }
  private val followUp = Runnable { tick("beat") }
  private var networkCallback: ConnectivityManager.NetworkCallback? = null
  private var screenReceiver: BroadcastReceiver? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val saved = prefs(this)
    val title = saved.getString(TITLE, null) ?: "Godbot"
    val text = saved.getString(TEXT, null) ?: ""
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
    try {
      ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
    } catch (_: Exception) {
      // Android 12 and later refuse a foreground start from the background unless an exemption
      // applies (a boot, or battery optimization turned off for this app). Wait for the next one.
      stopSelf()
      return START_NOT_STICKY
    }
    // A restart after the person turned it off (a stale sticky start) ends here.
    if (!wanted(this)) {
      stopSelf()
      return START_NOT_STICKY
    }
    if (!running) {
      running = true
      listen()
    }
    startJavaScript()
    return START_STICKY
  }

  override fun onDestroy() {
    running = false
    handler.removeCallbacksAndMessages(null)
    networkCallback?.let { callback ->
      try { getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(callback) } catch (_: Exception) {}
    }
    networkCallback = null
    screenReceiver?.let { receiver -> try { unregisterReceiver(receiver) } catch (_: Exception) {} }
    screenReceiver = null
    super.onDestroy()
  }

  // Runs the headless task, which loads the JavaScript bundle when no screen did and holds the
  // link. With the process already in the foreground (this service), the start is allowed.
  private fun startJavaScript() {
    try {
      startService(Intent(this, KeepAliveTaskService::class.java))
    } catch (_: Exception) {
      // Nothing to do: the next beat tries again.
    }
  }

  private fun tick(reason: String) {
    if (!GodbotNativeModule.tick(reason)) startJavaScript()
  }

  // The network coming back and the screen turning on are the moments a dead link is likely.
  private fun soon(reason: String) {
    tick(reason)
    handler.removeCallbacks(followUp)
    handler.postDelayed(followUp, FOLLOW_UP_MS)
  }

  private fun listen() {
    handler.postDelayed(beat, BEAT_MS)
    val callback = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) {
        handler.post { soon("network") }
      }
    }
    try {
      getSystemService(ConnectivityManager::class.java)?.registerDefaultNetworkCallback(callback)
      networkCallback = callback
    } catch (_: Exception) {
      // The beat still runs.
    }
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        soon("screen")
      }
    }
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_SCREEN_ON)
      addAction(Intent.ACTION_USER_PRESENT)
    }
    ContextCompat.registerReceiver(this, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
    screenReceiver = receiver
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
