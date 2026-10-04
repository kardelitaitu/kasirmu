package mu.kasir.mobile

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

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
  private var bridgeInstalled = false

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    hideSystemBars()
    keepScreenOn()
    installBackGuard()
    window.decorView.post {
      attachBridgeIfFound()
    }
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

  private fun attachBridgeIfFound() {
    if (bridgeInstalled) return
    val webView = findWebView(window.decorView)
    if (webView != null) {
      webView.addJavascriptInterface(KasirmuNativeBridge(this), "__kasirmuNative")
      bridgeInstalled = true
    }
  }

  /**
   * Forward runtime permission results to the WebView so the React hardware
   * setup screen updates immediately without polling or requiring an app restart.
   */
  override fun onRequestPermissionsResult(
    requestCode: Int,
    permissions: Array<out String>,
    grantResults: IntArray
  ) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    if (requestCode == BT_PERMISSION_REQUEST_CODE) {
      val allGranted = grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }
      val webView = findWebView(window.decorView)
      webView?.evaluateJavascript(
        "(function() { window.dispatchEvent(new CustomEvent('kasirmu:bluetoothPermissionResult', { detail: { granted: $allGranted } })); })()",
        null
      )
    }
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
    if (hasFocus) {
      hideSystemBars()
      attachBridgeIfFound()
    }
  }

  /**
   * Initial screen-on setting on launch. Dynamic screen retention is governed
   * by `TabletAppShell` via `KasirmuNativeBridge.setKeepScreenOn`.
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

  /**
   * Native bridge exposed to the WebView under `window.__kasirmuNative`.
   *
   * Provides:
   * 1. Dynamic screen-on management (`setKeepScreenOn`): kept awake while the
   *    cashier session is active and unlocked; allowed to sleep when locked.
   * 2. Bluetooth permissions & device enumeration for ESC/POS receipt printers.
   */
  class KasirmuNativeBridge(private val activity: MainActivity) {
    @JavascriptInterface
    fun setKeepScreenOn(enabled: Boolean) {
      activity.runOnUiThread {
        if (enabled) {
          activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
          activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
      }
    }

    @JavascriptInterface
    fun hasBluetoothPermissions(): Boolean {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val connectGranted = ContextCompat.checkSelfPermission(
          activity,
          Manifest.permission.BLUETOOTH_CONNECT
        ) == PackageManager.PERMISSION_GRANTED
        val scanGranted = ContextCompat.checkSelfPermission(
          activity,
          Manifest.permission.BLUETOOTH_SCAN
        ) == PackageManager.PERMISSION_GRANTED
        return connectGranted && scanGranted
      }
      return true
    }

    @JavascriptInterface
    fun requestBluetoothPermissions() {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val permissions = arrayOf(
          Manifest.permission.BLUETOOTH_CONNECT,
          Manifest.permission.BLUETOOTH_SCAN
        )
        activity.runOnUiThread {
          ActivityCompat.requestPermissions(activity, permissions, BT_PERMISSION_REQUEST_CODE)
        }
      }
    }

    @JavascriptInterface
    fun getPairedBluetoothDevices(): String {
      if (!hasBluetoothPermissions()) return "[]"
      return try {
        val adapter = BluetoothAdapter.getDefaultAdapter() ?: return "[]"
        val bonded = adapter.bondedDevices ?: return "[]"
        val list = JSONArray()
        for (device in bonded) {
          val obj = JSONObject()
          val name = try { device.name } catch (_: SecurityException) { null }
          obj.put("name", name ?: device.address)
          obj.put("address", device.address)
          list.put(obj)
        }
        list.toString()
      } catch (_: Exception) {
        "[]"
      }
    }

    @JavascriptInterface
    fun canRequestPackageInstalls(): Boolean {
      return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        activity.packageManager.canRequestPackageInstalls()
      } else {
        true
      }
    }

    @JavascriptInterface
    fun openInstallPermissionSettings() {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
          data = Uri.parse("package:${activity.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        activity.startActivity(intent)
      }
    }

    @JavascriptInterface
    fun launchPackageInstaller(apkFilePath: String): Boolean {
      return try {
        val file = File(apkFilePath)
        if (!file.exists()) return false

        val apkUri = FileProvider.getUriForFile(
          activity,
          "${activity.packageName}.fileprovider",
          file
        )

        val intent = Intent(Intent.ACTION_VIEW).apply {
          setDataAndType(apkUri, "application/vnd.android.package-archive")
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        activity.startActivity(intent)
        true
      } catch (e: Exception) {
        false
      }
    }
  }

  companion object {
    /** How long a second BACK press still counts as confirmation. */
    private const val BACK_CONFIRM_WINDOW_MS = 2000L
    /** Request code for Bluetooth runtime permissions (BLUETOOTH_CONNECT + BLUETOOTH_SCAN). */
    private const val BT_PERMISSION_REQUEST_CODE = 1001
  }
}
