package expo.modules.godbotnative

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Runs the JavaScript task `GodbotKeepAlive` (src/team/keepalive-task.ts), starting React
 * Native without a screen when none is up. The task holds the link and returns at once; the
 * link then lives on in this process. Android holds a wake lock while a task runs, so the
 * timeout bounds a task that never returns.
 */
class KeepAliveTaskService : HeadlessJsTaskService() {
  companion object {
    const val TASK = "GodbotKeepAlive"
    private const val TIMEOUT_MS = 60_000L
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    HeadlessJsTaskConfig(TASK, Arguments.createMap(), TIMEOUT_MS, true)
}
