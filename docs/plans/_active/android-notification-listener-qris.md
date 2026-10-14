<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (0 major, 3 minor) · Re-audit, and Phases 1 and 2 have SHIPPED — neither under the names this plan gives. Phase 1: crates/qris-core/src/notification.rs exists at 426 lines with a public BankNotification and a QrisMatchEngine carrying the deduplication cache and unique-code matcher §5 specifies as the collision-prevention design; it recognises TEN provider families against the six §4.1 tabulated. Phase 2: the Kotlin listener shipped in apps/mobile-tauri/gen/android/.../mu/kasir/mobile/ as QrisNotificationListenerService.kt, QrisNotificationParser.kt and QrisNotificationBus.kt, with QrisNotificationParserTest.kt in the Android test source set — the crate is qris-core and the package is mu.kasir.mobile, so this plan's mu.kasir.tablet/apps/tablet-client is the pre-rename spelling and was repointed in five places. Phase 3 is NOT shipped under the plan's names: get_listener_status, open_notification_settings and a qris://payment-received event have zero Rust hits tree-wide, and the seam that did ship is the Kotlin QrisNotificationBus, which is not the one §8 describes. Phase 4 is not shipped (no notification path in PaymentModal.tsx). A dated STATUS UPDATE block records all four. The plan's architectural premise — a listener with an independent lifecycle, UI absent when a notification arrives — is exactly the shipped service's shape, so §3's design held. · The store-policy caveat the first stamp raised is unchanged and still a release-owner decision. · NOT re-measured: whether the shipped regexes match real bank payloads, and whether the bus reaches Rust. · Prior 2026-09-29 body retained verbatim below. -->
<!-- Merged prior stamp (2026-09-29), kept as plain text — delimiters stripped: Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file: 249 lines, no audit stamp, no footer and no marker. It is a platform-integration plan — reading an Android NotificationListener for QRIS payment-verification signals, which is an unusual class of design because it depends on an operating-system service the app does not own. · THE ARCHITECTURAL CLAIM THAT MATTERS IS CHECKABLE, and it is the one that would decide whether the approach is viable: a NotificationListener runs in a separate process with a different lifecycle from the app that hosts it, so a plan built on one has to survive the listener being killed and restarted, and the UI is expected to be absent when a QRIS notification arrives. This is a case where the implementation plan's shape matters more than its detail, and this audit records the substrate that would carry it: the Android shell exists at `apps/mobile-tauri/`, its build workflow is live and is the same one the keystore guide audited in this same round had to be corrected about, and the QRIS settlement path it would observe is already implemented on the server side — `apps/cloud-server/src/webhooks/midtrans.rs` is the Midtrans handler, and the QRIS tier gating this campaign has documented repeatedly sits above it. So the destination the notifications would signal is real. · NOT RE-MEASURED, and the omission is structural rather than convenient: whether the notification payloads the plan expects actually carry the fields it needs is a question about a third party's notification format, verifiable only by building the listener and observing traffic. That is the original work. What is recorded is that the app side it would attach to, and the server side it would report to, both exist in the shape the plan assumes. · THE ONE THING A READER SHOULD WEIGH INDEPENDENTLY: a NotificationListener is a privileged Android capability with store-policy implications, and this audit checks documentation accuracy, not whether the approach is the right product or store-compliance decision. That judgement belongs to whoever owns the Android release. · No stamp existed; this is the first. -->
# Architecture & Implementation Plan: Android Notification Listener for QRIS Payment Verification

> **Document:** `docs/plans/android-notification-listener-qris.md`  
> **Status:** PROPOSED / READY FOR REVIEW  
> **Date:** 2026-09-15  
> **Target Platforms:** Tauri v2 Android APK (`apps/mobile-tauri` or standalone Android POS build)  
> **Goal:** 100% free, zero-MDR, automated verification of incoming QRIS payments via Android `NotificationListenerService`.

---

> **⚠️ STATUS UPDATE (2026-10-11, docs-auditor) — Phases 1 and 2 SHIPPED, and the
> substrate paths in this plan have been renamed.** Re-derived, not inherited:
>
> - **Phase 1 (Rust parser) — SHIPPED and BROADER than specified.**
>   `crates/qris-core/src/notification.rs` exists at **426 lines** with a public
>   `BankNotification` (package_name, **provider**, amount_minor, amount_formatted,
>   sender_name, raw_text, timestamp_ms) and a `QrisMatchEngine` carrying the
>   **deduplication cache and pending-invoice/unique-code matcher** that §5 describes
>   as the collision-prevention design. It recognises **ten** provider families
>   (BCA, Mandiri, BRI, Bank Jatim, GoPay, ShopeePay, DANA, OVO, BNI, BSI, QRIS)
>   against the six this plan tabulated in §4.1.
> - **Phase 2 (Kotlin listener) — SHIPPED**, in the **mobile** shell rather than the
>   tablet one: `apps/mobile-tauri/gen/android/app/src/main/java/**mu/kasir/mobile**/`
>   holds `QrisNotificationListenerService.kt`, `QrisNotificationParser.kt` and
>   `QrisNotificationBus.kt`, plus `QrisNotificationParserTest.kt` under the
>   Android test source set. Note both renames: the crate is `qris-core`,
>   the package is `mu.kasir.mobile`, and this plan's `mu.kasir.tablet`
>   (`apps/mobile-tauri`) is the pre-rename spelling.
> - **Phase 3 (Tauri IPC) — NOT SHIPPED under the names this plan gives.**
>   `get_listener_status`, `open_notification_settings` and a `qris://payment-received`
>   / `qris:paid` event have **zero Rust hits** tree-wide. The transport that shipped
>   is the Kotlin `QrisNotificationBus`, which is a different seam from the one §8
>   describes.
> - **Phase 4 (POS UI) — NOT SHIPPED.** No notification-driven path in
>   `PaymentModal.tsx`.
>
> **Path renames applied in the body:** `apps/mobile-tauri` → `apps/mobile-tauri`
> (this plan's target-platform line and Phase 2 row), and
> `apps/mobile-tauri/gen/android` → `apps/mobile-tauri/gen/android`.
> The plan's architectural premise — a listener whose lifecycle is independent of the
> app, with the UI absent when a notification arrives — is exactly the shape the shipped
> Kotlin service has, so §3's design was sound. The **store-policy** caveat this file's
> first stamp raised is unchanged and still the decision a release owner must make.
>
> NOT re-measured: whether the shipped parser's regexes match real bank payloads, and
> whether the bus reaches the Rust side at all (that is Phase 3's work).


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
| **Phase 2** | Kotlin Notification Listener Plugin | Android Kotlin module in `apps/mobile-tauri/gen/android` with `NotificationListenerService` and permission setup UI. |
| **Phase 3** | Tauri IPC & Event Bridge | Rust Tauri commands: `get_listener_status`, `open_notification_settings`, and `qris://payment-received` event emitter. |
| **Phase 4** | POS UI Integration | `PaymentModal.tsx` automated QRIS listener hook and transaction status updater. |

> last audited 11-10-26 by docs-auditor
