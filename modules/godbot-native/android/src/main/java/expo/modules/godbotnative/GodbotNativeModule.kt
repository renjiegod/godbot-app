package expo.modules.godbotnative

import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.os.bundleOf
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.lang.ref.WeakReference
import java.security.MessageDigest

/** The background keep-alive, file hashing and APK install the JS side cannot do itself. */
class GodbotNativeModule : Module() {
  companion object {
    private const val TICK_EVENT = "onKeepAliveTick"

    @Volatile
    private var current: WeakReference<GodbotNativeModule>? = null

    /** Hands the keep-alive beat to JavaScript; false when no JavaScript is running yet. */
    fun tick(reason: String): Boolean {
      val module = current?.get() ?: return false
      return try {
        module.sendEvent(TICK_EVENT, bundleOf("reason" to reason))
        true
      } catch (_: Throwable) {
        false
      }
    }

    // Where phone makers let apps start on their own, newest first per maker. Pages move
    // between system versions, so each is tried in turn (the manifest lists their packages).
    private val AUTO_START_PAGES = listOf(
      // Xiaomi, Redmi, POCO (MIUI, HyperOS)
      ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),
      // Huawei (EMUI, HarmonyOS)
      ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
      ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"),
      ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity"),
      // Honor (MagicOS)
      ComponentName("com.hihonor.systemmanager", "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
      // OPPO, realme, OnePlus (ColorOS)
      ComponentName("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"),
      ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
      ComponentName("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"),
      // vivo, iQOO (OriginOS, Funtouch OS)
      ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
      ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"),
      ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"),
      // OnePlus (OxygenOS)
      ComponentName("com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity"),
      // Samsung (One UI): battery limits per app
      ComponentName("com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity"),
    )
  }

  private val context: Context
    get() = appContext.reactContext?.applicationContext
      ?: throw CodedException("ERR_NO_CONTEXT", "The app context is not available", null)

  override fun definition() = ModuleDefinition {
    Name("GodbotNative")

    Events(TICK_EVENT)

    OnCreate { current = WeakReference(this@GodbotNativeModule) }

    OnDestroy { if (current?.get() === this@GodbotNativeModule) current = null }

    Function("startKeepAlive") { title: String, text: String ->
      KeepAliveService.remember(context, title, text)
      ContextCompat.startForegroundService(context, Intent(context, KeepAliveService::class.java))
      true
    }

    Function("stopKeepAlive") {
      KeepAliveService.forget(context)
      context.stopService(Intent(context, KeepAliveService::class.java))
    }

    Function("isKeepAliveRunning") {
      KeepAliveService.running
    }

    Function("isIgnoringBatteryOptimizations") {
      val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
      power?.isIgnoringBatteryOptimizations(context.packageName) == true
    }

    Function("requestIgnoreBatteryOptimizations") {
      // The system dialog for this app; the list of all apps where the dialog is not offered.
      open(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + context.packageName)))
        || open(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
    }

    Function("openAutoStartSettings") {
      if (AUTO_START_PAGES.any { page -> open(Intent().setComponent(page)) }) {
        "maker"
      } else {
        open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.packageName)))
        "app"
      }
    }

    AsyncFunction("sha256File") { path: String ->
      val digest = MessageDigest.getInstance("SHA-256")
      FileInputStream(fileOf(path)).use { input ->
        val buffer = ByteArray(64 * 1024)
        while (true) {
          val read = input.read(buffer)
          if (read < 0) break
          digest.update(buffer, 0, read)
        }
      }
      digest.digest().joinToString("") { "%02x".format(it) }
    }

    Function("canInstallPackages") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.packageManager.canRequestPackageInstalls() else true
    }

    Function("openInstallPermission") {
      val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.packageName))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    Function("installApk") { path: String ->
      val file = fileOf(path)
      val uri = FileProvider.getUriForFile(context, context.packageName + ".godbot.files", file)
      val intent = Intent(Intent.ACTION_VIEW)
        .setDataAndType(uri, "application/vnd.android.package-archive")
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }
  }

  // Starts a system page; false when this phone has no such page or does not let us open it.
  private fun open(intent: Intent): Boolean {
    // From the screen when there is one, so Back returns to the app.
    val activity = appContext.currentActivity
    return try {
      if (activity != null) activity.startActivity(intent)
      else context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    } catch (_: ActivityNotFoundException) {
      false
    } catch (_: SecurityException) {
      false
    }
  }

  private fun fileOf(path: String): File {
    val clean = if (path.startsWith("file://")) Uri.parse(path).path ?: path else path
    val file = File(clean)
    if (!file.isFile) throw CodedException("ERR_NO_FILE", "No file at $clean", null)
    return file
  }
}
