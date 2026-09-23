# Architecture & Implementation Plan: Android Notification Listener for QRIS Payment Verification

> **Document:** `docs/plans/android-notification-listener-qris.md`  
> **Status:** PROPOSED / READY FOR REVIEW  
> **Date:** 2026-09-15  
> **Target Platforms:** Tauri v2 Android APK (`apps/tablet-client` or standalone Android POS build)  
> **Goal:** 100% free, zero-MDR, automated verification of incoming QRIS payments via Android `NotificationListenerService`.

---

## 1. Executive Summary & Problem Context

When merchants generate dynamic QRIS codes directly from their NMID / Merchant PAN using `qris-core`:
1. The customer scans the dynamic QRIS code and pays via any banking or e-wallet app (BCA, GoPay, OVO, Dana, ShopeePay, etc.).
2. The settlement goes directly to the merchant's bank account (e.g. Bank Jatim, BCA, Mandiri, BRI).
3. Unlike commercial payment gateways (Midtrans, Xendit) which charge **0.7% MDR** and send webhooks, direct bank settlements provide **no public cloud webhook API**.
4. However, the bank's mobile/merchant app installed on the store's Android POS device receives an **instant, free push notification** (within 1-2 seconds) upon settlement.

### The Solution
Embed an Android **`NotificationListenerService`** plugin directly into the kasir.mu Android APK.
When the bank's merchant app emits a notification matching a QRIS transaction, the service parses the amount, matches the pending invoice, and automatically transitions the POS checkout to **PAID** without requiring manual cashier verification.

---

## 2. System Architecture

```text
+-------------------------------------------------------------------------------+
|                               Android Device / Tablet                         |
|                                                                               |
|  +---------------------------+             +-------------------------------+  |
|  | Bank Merchant App         |             | kasir.mu Tauri v2 Android App   |  |
|  | (Bank Jatim / BCA / etc.) |             |                               |  |
|  +-------------+-------------+             |  +-------------------------+  |  |
|                |                           |  | Android Native (Kotlin) |  |  |
|                | Push Notification         |  | - NotificationListener  |  |  |
|                v                           |  | - Package Whitelist     |  |  |
|     [Android OS Status Bar]                |  +------------+------------+  |  |
|                |                           |               | JNI / Plugin  |  |
|                | onNotificationPosted()    |               v Channel       |  |
|                +-------------------------->|  +-------------------------+  |  |
|                                            |  | Rust Tauri Plugin       |  |  |
|                                            |  | - Amount Regex Engine   |  |  |
|                                            |  | - Pending Invoice Match |  |  |
|                                            |  +------------+------------+  |  |
|                                            |               | Tauri Event   |  |
|                                            |               v (qris:paid)   |  |
|                                            |  +-------------------------+  |  |
|                                            |  | React / TS POS UI       |  |  |
|                                            |  | - Auto-confirms payment |  |  |
|                                            |  | - Plays chime & prints  |  |  |
|                                            |  +-------------------------+  |  |
+-------------------------------------------------------------------------------+
```

---

## 3. Android Native Layer (Kotlin Plugin)

### 3.1 `AndroidManifest.xml` Declarations
To receive notifications from other apps on Android 5.0+ (API 21 to API 35), the service must be registered in the manifest with the `BIND_NOTIFICATION_LISTENER_SERVICE` permission:

```xml
<service
    android:name=".qris.QrisNotificationListener"
    android:label="kasir.mu QRIS Payment Listener"
    android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE"
    android:exported="true">
    <intent-filter>
        <action android:name="android.service.notification.NotificationListenerService" />
    </intent-filter>
</service>
```

### 3.2 Permission Request Flow (UX)
`NotificationListenerService` is a special protected system access permission. It cannot be granted via standard runtime dialogs (`requestPermissions`). The POS app must guide the merchant:
1. Check permission via:
   `NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)`.
2. If false, show an intuitive setup dialog:  
   *"Untuk mendeteksi pembayaran QRIS otomatis tanpa cek mutasi manual, aktifkan izin Notifikasi untuk kasir.mu di Pengaturan Android."*
3. Direct the merchant with an intent:
   ```kotlin
   val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
   context.startActivity(intent)
   ```

### 3.3 Kotlin Listener Implementation
```kotlin
package mu.kasir.tablet.qris

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.os.Bundle

class QrisNotificationListener : NotificationListenerService() {

    // Strict package whitelist to protect merchant privacy
    private val allowedPackages = setOf(
        "com.bankjatim.jatimmobile",
        "com.bca",
        "id.co.bri.brimo",
        "id.co.mandiri.livin",
        "com.gojek.gobiz",
        "com.shopeepay.merchant"
    )

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val sbn = sbn ?: return
        val packageName = sbn.packageName

        if (!allowedPackages.contains(packageName)) {
            return // Ignore all non-whitelisted notifications immediately
        }

        val extras: Bundle = sbn.notification.extras ?: return
        val title = extras.getString("android.title") ?: ""
        val text = extras.getCharSequence("android.text")?.toString() ?: ""
        val bigText = extras.getCharSequence("android.bigText")?.toString() ?: ""
        val postTime = sbn.postTime

        val fullBody = if (bigText.isNotEmpty()) "$title | $bigText" else "$title | $text"

        // Dispatch raw notification payload to Tauri Plugin bridge
        QrisNotificationBridge.dispatchNotification(packageName, fullBody, postTime)
    }
}
```

---

## 4. Parser & Regex Engine (Rust Layer)

The text received from merchant push notifications varies across banks and e-wallets. The parsing logic is isolated in Rust for unit testing, test-driven reliability, and cross-platform simulation.

### 4.1 Bank Notification Templates & Regex Patterns
| Bank / App | Package Name | Sample Notification Text | Amount Extracted |
|---|---|---|---|
| **Bank Jatim Mobile** | `com.bankjatim.jatimmobile` | `QRIS Diterima: Pembayaran sebesar Rp 35.000 dari BUDI SETIAWAN telah masuk.` | `35000` |
| **BCA Mobile** | `com.bca` | `QRIS Masuk: Rp 150.000 dari SITI NURHALIZA 15/09 11:20:05` | `150000` |
| **BRImo / BRI Merchant** | `id.co.bri.brimo` | `Transaksi Sukses: Terima dana QRIS Rp25.500 dari 081234567890.` | `25500` |
| **Livin by Mandiri** | `id.co.mandiri.livin` | `Pembayaran QRIS masuk sebesar Rp 75.000 berhasil diterima.` | `75000` |
| **GoBiz (GoPay Merchant)** | `com.gojek.gobiz` | `Yippee! Ada pembayaran masuk sebesar Rp 12.000 via GoPay.` | `12000` |
| **ShopeePay Merchant** | `com.shopeepay.merchant` | `Pembayaran diterima: Rp 45.000 dari Pelanggan ShopeePay.` | `45000` |

### 4.2 Rust Parser Implementation (`crates/qris-core/src/notification.rs`)
```rust
use regex::Regex;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BankNotification {
    pub package_name: String,
    pub amount_minor: u64,
    pub sender_name: Option<String>,
    pub timestamp_ms: u64,
}

pub fn parse_notification(package: &str, text: &str, timestamp_ms: u64) -> Option<BankNotification> {
    // Regex matches currency prefixes (Rp, IDR), digits, dots, commas
    let amount_regex = Regex::new(r#"(?i)(?:rp\.?|idr)\s*([\d\.,]+)"#).ok()?;
    let caps = amount_regex.captures(text)?;
    let raw_num = caps.get(1)?.as_str();

    // Clean formatting: "35.000,00" or "35.000" -> 35000
    let clean_num: String = raw_num
        .replace('.', "")
        .split(',')
        .next()?
        .chars()
        .filter(|c| c.is_ascii_digit())
        .collect();

    let amount_rupiah: u64 = clean_num.parse().ok()?;

    Some(BankNotification {
        package_name: package.to_string(),
        amount_minor: amount_rupiah,
        sender_name: extract_sender_name(text),
        timestamp_ms,
    })
}
```

---

## 5. Settlement Matching & Collision Prevention

In a busy store, two customers might pay similar amounts within the same minute. To ensure 100% deterministic matching:

1. **Deterministic Unique Code (Kode Unik)**:
   - When generating dynamic QRIS with `qris-core`, optionally add a 2-digit unique code (e.g. Total Rp 35.000 -> Dynamic QRIS Rp 35.012).
   - The customer scans and pays exact Rp 35.012.
   - The bank notification announces `Rp 35.012`.
   - Result: Guaranteed 1-to-1 match even if multiple customers pay simultaneously.

2. **Time Window Validation (TTL)**:
   - Match notifications only within the valid checkout window: `[invoice_created_at - 10s, invoice_created_at + 10m]`.
   - Notifications outside this window are ignored or queued for manual reconciliation.

3. **Deduplication LRU Cache**:
   - Store parsed notification signatures `hash(package, amount, timestamp)` in SQLite or in-memory LRU for 24 hours.
   - Prevents duplicate triggers if Android re-posts notifications upon device restart or screen unlock.

---

## 6. Frontend & POS UX Flow

```text
[Cashier: Select "QRIS Payment"]
                |
                v
[POS Modal: Dynamic QRIS displayed with Spinner]
       "Menunggu pembayaran pelanggan..."
                |
    Customer scans QRIS & pays
                |
                v
[Android Status Bar receives Bank Notification]
                |
                v
[QrisNotificationListener catches & parses amount]
                |
                v
[Tauri Event emitted: "qris://payment-received"]
                |
                v
[POS Modal: Auto-transitions to "LUNAS"]
  - Plays payment success chime
  - Automatically prints receipt to thermal printer
  - Dismisses modal and clears transaction cart
```

---

## 7. Security & Privacy Guarantees

1. **Strict Package Whitelist**: The service only inspects notifications from registered bank apps. Personal messages (WhatsApp, SMS, Telegram, Gmail) are rejected immediately in memory.
2. **Zero Credentials Required**: The POS never asks for or stores merchant bank usernames, passwords, mPINs, or 2FA tokens.
3. **100% Local Processing**: No notification body, sender name, or customer personal data is ever sent to external cloud servers. All processing happens entirely offline on the Android POS hardware.

---

## 8. Implementation Roadmap

| Phase | Milestone | Deliverables |
|---|---|---|
| **Phase 1** | Parser & Matching Core in `qris-core` | Add `crates/qris-core/src/notification.rs` with bank regexes and unit tests. |
| **Phase 2** | Kotlin Notification Listener Plugin | Android Kotlin module in `apps/tablet-client/gen/android` with `NotificationListenerService` and permission setup UI. |
| **Phase 3** | Tauri IPC & Event Bridge | Rust Tauri commands: `get_listener_status`, `open_notification_settings`, and `qris://payment-received` event emitter. |
| **Phase 4** | POS UI Integration | `PaymentModal.tsx` automated QRIS listener hook and transaction status updater. |
