# Technical Specification: Hardware Fingerprint Anti-Abuse Trial Lock

**Specification ID:** SPEC-2026-TRIAL-LOCK  
**Status:** Active Draft — ⚠️ trial definition re-scoped (see note)  
**Target Module:** `crates/oz-security`, `apps/desktop-tauri/src/commands/license.rs`, License Auth Server (PocketBase)  
**Date:** 2026-07-20  

> **Re-scope note (2026-08-17):** the flat **90-day free trial** referenced
> throughout this spec is superseded by `subscription-tiers.md` §4 — the Free
> tier is now **free forever**, and paid trials are segmented by signup
> vertical (14-day Plus trial general, 14-day Pro trial restaurant/cafe,
> 30-day Pro trial enterprise-referral). This spec's hardware-fingerprint
> anti-abuse mechanism (one trial per physical device) still applies to the
> segmented trials to prevent reset abuse; the expiry/lock wording should be
> read against the trial types in `subscription-tiers.md` §4 rather than a
> single 90-day window. Tracked by `docs/plans/todo.md` C2.1.

---

## 1. Executive Summary

This specification defines the architecture, cryptographic hardware fingerprinting algorithm, API endpoints, PocketBase collection schemas, and client-side enforcement logic required to prevent trial abuse (e.g. reinstalling the application to reset the 90-day free trial).

---

## 2. Hardware Fingerprint Generation (`oz-security`)

The hardware fingerprint MUST be deterministic, unique to the physical machine, and resilient against application uninstalls, disk formatting, or MAC address spoofing.

### 2.1 OS-Specific Hardware Attribute Extraction

| Platform | Attributes Collected | Extraction Command / API |
|---|---|---|
| **Windows** | 1. Motherboard UUID<br/>2. CPU Processor ID<br/>3. Primary Disk Serial | `wmic csproduct get uuid`<br/>`wmic cpu get processorid`<br/>`Get-Disk` (Number 0 SerialNumber) |
| **Android** | 1. Android Secure ID<br/>2. Build Serial | `Settings.Secure.getString(contentResolver, ANDROID_ID)`<br/>`Build.getSerial()` |
| **Linux** | 1. Machine ID<br/>2. System DMI UUID | `/etc/machine-id`<br/>`/sys/class/dmi/id/product_uuid` |

### 2.2 Fingerprint Hashing Algorithm

```rust
pub fn compute_hardware_fingerprint() -> Result<String, SecurityError> {
    let mb_uuid = get_motherboard_uuid()?;
    let cpu_id = get_cpu_processor_id()?;
    let disk_serial = get_primary_disk_serial()?;

    let raw_payload = format!("OZPOS-HW-V1:{}:{}:{}", mb_uuid, cpu_id, disk_serial);
    let mut hasher = Sha256::new();
    hasher.update(raw_payload.as_bytes());
    let hash_bytes = hasher.finalize();

    Ok(format!("hw_{}", hex::encode(hash_bytes)))
}
```

---

## 3. PocketBase License Auth Server Collection (`trial_registrations`)

The central license auth server (`license.ozpos.my.id`) maintains a `trial_registrations` collection.

### 3.1 Collection Schema

```json
{
  "id": "trial_registrations",
  "name": "trial_registrations",
  "type": "base",
  "schema": [
    {
      "name": "hardware_fingerprint",
      "type": "text",
      "required": true,
      "unique": true
    },
    {
      "name": "first_seen_at",
      "type": "date",
      "required": true
    },
    {
      "name": "trial_expires_at",
      "type": "date",
      "required": true
    },
    {
      "name": "platform",
      "type": "select",
      "options": ["windows", "android", "linux"],
      "required": true
    },
    {
      "name": "app_version",
      "type": "text",
      "required": true
    },
    {
      "name": "ip_address",
      "type": "text",
      "required": false
    }
  ]
}
```

---

## 4. API Endpoints & Verification Flow

### 4.1 `POST /api/v1/license/trial`

#### Request Payload (Client -> Server)
```json
{
  "hardware_fingerprint": "hw_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e",
  "platform": "windows",
  "app_version": "0.0.13"
}
```

#### Response Payload (Server -> Client)

##### Success Response (`200 OK` - Valid Trial Issued / Resumed)
```json
{
  "status": "active",
  "hardware_fingerprint": "hw_9f8e7d6c5b4a...",
  "trial_expires_at": "2026-10-18T00:00:00Z",
  "days_remaining": 90,
  "signed_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

##### Error Response (`403 Forbidden` - Trial Expired on Machine)
```json
{
  "code": "TRIAL_EXPIRED_ON_THIS_DEVICE",
  "message": "The 90-day trial for this hardware device has expired.",
  "expired_at": "2026-07-15T00:00:00Z"
}
```

---

## 5. Client Offline Signature Verification & Local Enforcement

1. **RSA Signed Token**: The server signs `{ hardware_fingerprint, trial_expires_at }` using its **RSA Private Key**.
2. **Local Storage**: The POS client caches the signed JWT token in `local_settings.json` and SQLite `system_state`.
3. **Clock-Tamper Resistance**:
   - On boot, the client verifies the token's RSA signature using the embedded **RSA Public Key**.
   - If the system clock is manipulated backward (e.g. set to year 2020), `oz-security` compares system time against last known transaction timestamps (`sales.created_at`). If `system_time < max(sales.created_at)`, a `CLOCK_TAMPER_DETECTED` lock is triggered.
4. **Lock Screen State**:
   - If `NOW() > trial_expires_at` or server returns `403 Forbidden`, the UI switches to the **Trial Expired Lock Screen**.
   - All checkout functions (`complete_sale`) return `AppError::LicenseExpired`.

---

## 6. Verification Plan

### Automated Unit Tests
- `cargo test -p oz-security` for hardware fingerprint determinism and Sha256 hashing.
- Mock tests verifying RSA signature verification and clock tamper detection.

### Integration Testing
- Verify PocketBase Go hook `POST /api/v1/license/trial` rejects duplicate hardware IDs after `trial_expires_at`.
- Verify UI locks out checkout actions when trial status is expired.
