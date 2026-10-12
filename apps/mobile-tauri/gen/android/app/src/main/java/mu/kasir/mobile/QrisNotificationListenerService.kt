package mu.kasir.mobile

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log

/**
 * Android NotificationListenerService that intercepts push notifications
 * from Indonesian banks and merchant apps to auto-settle QRIS transactions
 * without third-party MDR processing fees.
 */
class QrisNotificationListenerService : NotificationListenerService() {
    companion object {
        private const val TAG = "QrisNotifListener"
        var isConnected: Boolean = false
            private set
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        isConnected = true
        Log.i(TAG, "QrisNotificationListenerService connected")
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        isConnected = false
        Log.i(TAG, "QrisNotificationListenerService disconnected")
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        super.onNotificationPosted(sbn)
        if (sbn == null) return

        val packageName = sbn.packageName ?: return
        val extras = sbn.notification?.extras ?: return

        val title = extras.getCharSequence("android.title")?.toString()
        val text = extras.getCharSequence("android.text")?.toString()
        val bigText = extras.getCharSequence("android.bigText")?.toString()
        val content = when {
            !bigText.isNullOrBlank() -> "$title $bigText"
            !text.isNullOrBlank() -> "$title $text"
            else -> title ?: ""
        }

        val event = QrisNotificationParser.parse(
            packageName = packageName,
            title = title,
            content = content,
            postTime = sbn.postTime
        ) ?: return

        Log.i(TAG, "Parsed QRIS payment: provider=${event.provider}, amount=${event.amountMinor}")
        QrisNotificationBus.post(event)
    }
}
