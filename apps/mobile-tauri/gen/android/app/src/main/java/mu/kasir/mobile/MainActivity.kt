package mu.kasir.mobile

import android.os.Bundle
import android.os.SystemClock
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

import android.view.View
import android.view.ViewGroup
import android.webkit.WebView

/**
 * Immersive, edge-to-edge host for the tablet POS shell.
 *
 * `enableEdgeToEdge()` alone only makes the system bars *transparent* — it
 * still reserves their space. A tablet in the field therefore showed the
 * Android status bar (clock, wifi, battery) across the top of the setup
 * wizard and the navigation bar along the bottom, which is not what a
 * full-screen POS terminal looks like. This activity additionally HIDES both.
 *
 * The behaviour is the "game" one rather than a bare hide:
 * `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE` lets a swipe in from an edge reveal
 * the bars as a translucent overlay that auto-hides again. So the clock and
 * notifications stay reachable, without the bars permanently occupying the top
 * strip of the screen.
 *
 * The WebView is `viewport-fit=cover` (`ui/index.mobile.html`), so hiding the
 * bars hands their space to the layout; whatever insets remain (a display
 * cutout) are read by the shell and keep content clear of it.
 *
 * Where they are read moved on 2026-09-20 (`4734ce5cb`) and this comment
 * followed it: `env(safe-area-inset-*)` is now read in exactly ONE place,
 * `ui/src/theme/tokens.css` — declared once as `--inset-top/right/bottom/left`
 * — and the sheets consume the token (`ui/src/app/tablet/tablet.css`), rather
 * than each re-deriving `env()` for itself. Keeping the declaration in the
 * token layer is what `themeTokenCompliance` counts, so a sheet that restates
 * `env()` is the thing that guard refuses.
 */
class MainActivity : TauriActivity() {
  private var backPressedAtMs = 0L

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    hideSystemBars()
    keepScreenOn()
    installBackGuard()
  }

  override fun onNewIntent(intent: android.content.Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    hideSystemBars()
  }

  private fun findWebView(view: View): WebView? {
    if (view is WebView) return view
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) {
        val result = findWebView(view.getChildAt(i))
        if (result != null) return result
      }
    }
    return null
  }

  /**
   * A BACK press must not silently drop a cashier out of a sale.
   *
   * First consult the WebView's `window.__onAndroidBackPressed()` bridge:
   * if a modal, hash route, or active workspace can be closed/backed out of,
   * the WebView consumes the event and returns `true`.
   *
   * Only when JS returns `false` (or the WebView cannot be resolved) does the
   * native double-tap exit guard take over, prompting "Press back again to exit".
   */
  private fun installBackGuard() {
    onBackPressedDispatcher.addCallback(
      this,
      object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
          val webView = findWebView(window.decorView)
          if (webView != null) {
            webView.evaluateJavascript(
              "(function() { return (typeof window.__onAndroidBackPressed === 'function') ? window.__onAndroidBackPressed() === true : false; })()"
            ) { result ->
              if (result == "true") {
                // Handled in JS (e.g. dismissed modal, navigated back to picker, etc.)
                return@evaluateJavascript
              }
              handleNativeExitGuard()
            }
            return
          }
          handleNativeExitGuard()
        }

        private fun handleNativeExitGuard() {
          val now = SystemClock.elapsedRealtime()
          if (now - backPressedAtMs > BACK_CONFIRM_WINDOW_MS) {
            backPressedAtMs = now
            Toast.makeText(this@MainActivity, "Press back again to exit", Toast.LENGTH_SHORT).show()
            return
          }
          finish()
        }
      },
    )
  }

  /**
   * The bars come back whenever the window regains focus — a system dialog, the
   * app switcher, a permission prompt — so re-hide instead of assuming the
   * `onCreate` state survived. Swiping the transient bars in does NOT change
   * window focus, so this cannot fight the user's own reveal.
   */
  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) hideSystemBars()
  }

  /**
   * A POS terminal must not sleep under a cashier who is mid-transaction.
   *
   * `FLAG_KEEP_SCREEN_ON` is the whole fix: it is a window flag, so it needs no
   * permission, no foreground service and no Tauri plugin, and the platform
   * clears it on its own when the activity is no longer foregrounded — which is
   * exactly the lifetime wanted here. A `WakeLock` would have asked for
   * `WAKE_LOCK`, held the CPU awake (battery) beyond the visible screen, and
   * still done nothing about the Low Memory Killer reaping the process.
   *
   * Set on the window in `onCreate`, after `super` has attached it.
   */
  private fun keepScreenOn() {
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
  }

  private fun hideSystemBars() {
    val controller = WindowInsetsControllerCompat(window, window.decorView)
    controller.systemBarsBehavior =
      WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    controller.hide(WindowInsetsCompat.Type.systemBars())
  }

  companion object {
    /** How long a second BACK press still counts as confirmation. */
    private const val BACK_CONFIRM_WINDOW_MS = 2000L
  }
}
