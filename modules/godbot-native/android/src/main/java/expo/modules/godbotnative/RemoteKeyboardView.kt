package expo.modules.godbotnative

import android.content.Context
import android.view.Gravity
import android.view.KeyEvent
import android.widget.TextView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/** Delivers hardware keys only while this small, explicitly focused view owns them. */
class RemoteKeyboardView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onHardwareKey by EventDispatcher<Map<String, Any>>()
  private val onKeyboardBlur by EventDispatcher<Unit>()
  private val pad = TextView(context).apply {
    gravity = Gravity.CENTER
    setTextColor(0xffe9eee7.toInt())
    setBackgroundColor(0xff293129.toInt())
    isFocusableInTouchMode = true
    setOnClickListener { requestFocus() }
    setOnFocusChangeListener { _, focused -> if (!focused) onKeyboardBlur(Unit) }
    setOnKeyListener { _, key, event ->
      val code = domCode(key)
      if (code == null || event.device?.isVirtual != false ||
          (event.action != KeyEvent.ACTION_DOWN && event.action != KeyEvent.ACTION_UP)) {
        false
      } else {
        onHardwareKey(mapOf("code" to code, "down" to (event.action == KeyEvent.ACTION_DOWN)))
        true
      }
    }
  }
  init { addView(pad, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)) }
  fun setLabel(value: String) { pad.text = value; pad.contentDescription = value }

  private fun domCode(key: Int): String? = when(key) {
    in KeyEvent.KEYCODE_A..KeyEvent.KEYCODE_Z -> "Key" + ('A' + (key - KeyEvent.KEYCODE_A))
    in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9 -> "Digit" + (key - KeyEvent.KEYCODE_0)
    in KeyEvent.KEYCODE_F1..KeyEvent.KEYCODE_F12 -> "F" + (key - KeyEvent.KEYCODE_F1 + 1)
    KeyEvent.KEYCODE_CTRL_LEFT -> "ControlLeft"
    KeyEvent.KEYCODE_CTRL_RIGHT -> "ControlRight"
    KeyEvent.KEYCODE_ALT_LEFT -> "AltLeft"
    KeyEvent.KEYCODE_ALT_RIGHT -> "AltRight"
    KeyEvent.KEYCODE_META_LEFT -> "MetaLeft"
    KeyEvent.KEYCODE_META_RIGHT -> "MetaRight"
    KeyEvent.KEYCODE_SHIFT_LEFT -> "ShiftLeft"
    KeyEvent.KEYCODE_SHIFT_RIGHT -> "ShiftRight"
    KeyEvent.KEYCODE_ENTER -> "Enter"
    KeyEvent.KEYCODE_TAB -> "Tab"
    KeyEvent.KEYCODE_DEL -> "Backspace"
    KeyEvent.KEYCODE_FORWARD_DEL -> "Delete"
    KeyEvent.KEYCODE_ESCAPE -> "Escape"
    KeyEvent.KEYCODE_SPACE -> "Space"
    KeyEvent.KEYCODE_MOVE_HOME -> "Home"
    KeyEvent.KEYCODE_MOVE_END -> "End"
    KeyEvent.KEYCODE_DPAD_UP -> "ArrowUp"
    KeyEvent.KEYCODE_DPAD_LEFT -> "ArrowLeft"
    KeyEvent.KEYCODE_DPAD_DOWN -> "ArrowDown"
    KeyEvent.KEYCODE_DPAD_RIGHT -> "ArrowRight"
    KeyEvent.KEYCODE_PAGE_UP -> "PageUp"
    KeyEvent.KEYCODE_PAGE_DOWN -> "PageDown"
    KeyEvent.KEYCODE_MINUS -> "Minus"
    KeyEvent.KEYCODE_EQUALS -> "Equal"
    KeyEvent.KEYCODE_COMMA -> "Comma"
    KeyEvent.KEYCODE_PERIOD -> "Period"
    KeyEvent.KEYCODE_SLASH -> "Slash"
    KeyEvent.KEYCODE_BACKSLASH -> "Backslash"
    KeyEvent.KEYCODE_GRAVE -> "Backquote"
    KeyEvent.KEYCODE_LEFT_BRACKET -> "BracketLeft"
    KeyEvent.KEYCODE_RIGHT_BRACKET -> "BracketRight"
    KeyEvent.KEYCODE_APOSTROPHE -> "Quote"
    KeyEvent.KEYCODE_SEMICOLON -> "Semicolon"
    else -> null
  }
}
