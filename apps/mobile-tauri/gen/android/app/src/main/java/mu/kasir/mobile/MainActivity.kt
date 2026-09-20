package mu.kasir.mobile

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

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
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    hideSystemBars()
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

  private fun hideSystemBars() {
    val controller = WindowInsetsControllerCompat(window, window.decorView)
    controller.systemBarsBehavior =
      WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    controller.hide(WindowInsetsCompat.Type.systemBars())
  }
}
