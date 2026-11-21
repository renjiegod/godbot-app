package expo.modules.godbotnative

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

/** The background keep-alive, file hashing and APK install the JS side cannot do itself. */
class GodbotNativeModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext
      ?: throw CodedException("ERR_NO_CONTEXT", "The app context is not available", null)

  override fun definition() = ModuleDefinition {
    Name("GodbotNative")

    Function("startKeepAlive") { title: String, text: String ->
      val intent = Intent(context, KeepAliveService::class.java)
        .putExtra(KeepAliveService.EXTRA_TITLE, title)
        .putExtra(KeepAliveService.EXTRA_TEXT, text)
      ContextCompat.startForegroundService(context, intent)
      true
    }

    Function("stopKeepAlive") {
      context.stopService(Intent(context, KeepAliveService::class.java))
    }

    Function("isKeepAliveRunning") {
      KeepAliveService.running
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

  private fun fileOf(path: String): File {
    val clean = if (path.startsWith("file://")) Uri.parse(path).path ?: path else path
    val file = File(clean)
    if (!file.isFile) throw CodedException("ERR_NO_FILE", "No file at $clean", null)
    return file
  }
}
