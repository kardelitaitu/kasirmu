<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major, 2 minor) · MAJOR: the prior stamp's operative conclusion — 'the central function is not implemented … none of it is built' — is now misleading, because the anti-abuse lock SHIPPED between passes at coordinates the spec does not name. Verified: `apps/license-server/trial.go` (287 lines) registers a fingerprint on `POST /api/v1/license/trial` and answers `403 TRIAL_ALREADY_CLAIMED`; `enforceTrialLock` (`activate.go`) repeats the gate at mint time; `trial_test.go` pins both; the `trial_registrations` collection exists in `pb_schema.json` with exactly §3.1's field set; and the client side is real but in `crates/kasirmu-bridge/src/license/machine.rs` (`generate_machine_id` + `generate_hardware_fingerprint`, split from `license.rs` 2026-09-27), not `kasirmu-security`. The literal `compute_hardware_fingerprint` in §2.2 still does not exist — both grep hits for it are inside this file. MINOR: the shipped error code is `TRIAL_ALREADY_CLAIMED`, not the spec's `TRIAL_EXPIRED_ON_THIS_DEVICE`, and the lock is permanent rather than expiry-scoped; the `trial_vertical`/`email` claim-tie fields are additions the spec lacks. Added a dated audit note under the existing re-scope note; body and Target Module line left as the record of intent. NOT re-measured: the §5 clock-tamper boot check and `local_settings.json` cache, which remain unimplemented. -->

<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — superseded bodies kept verbatim:
> Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file: 165 lines, no audit stamp, no footer, no marker. Its Status line is honest and specific — Active Draft, with an inline re-scope note — and that framing is what makes the audit result readable. · THE CENTRAL FUNCTION IS NOT IMPLEMENTED, which is correct for a draft and is recorded so nobody reads the spec as a description of the system. A repository-wide search for `compute_hardware_fingerprint` returns nothing; the specification defines the algorithm (§2.2, a SHA-256 over motherboard UUID, CPU processor ID and primary disk serial, prefixed `hw_`) and the PocketBase collection and endpoints around it, and none of it is built. What IS built is the module it targets: `crates/kasirmu-security` exists, and the spec's Target Module line already names the CURRENT paths (`crates/kasirmu-security`, `apps/desktop-tauri/src/commands/license.rs`) rather than pre-restructure ones — unusual, and worth noting, because a spec written in July usually carries July's names. · THE RE-SCOPE NOTE IS THE MOST USEFUL THING IN THE FILE and it is correctly handled. It records that the flat 90-day trial this spec is written around has been superseded — the Free tier is now free forever, and paid trials are segmented by signup vertical — while confirming that the hardware-fingerprint anti-abuse MECHANISM still applies to the segmented trials, and pointing at `subscription-tiers.md` §4 for the current rules plus `docs/plans/todo.md` C2.1 for tracking. That target document is the 895-line `docs/guides/user/subscription-tiers.md`, audited in a later position of this queue. This is exactly the pattern that keeps a superseded spec usable: it says which parts died, which parts survived, and where the replacement lives. · NOT REPAIRED, and the reason is worth stating: §4.1 and §4.2 still describe 90-day responses including `days_remaining: 90` and a `TRIAL_EXPIRED_ON_THIS_DEVICE` message naming the 90-day trial. Those are internally consistent with a document the re-scope note already qualifies, and editing them would contradict the note. The note is the operative statement; the body is the record of what was specified. · One stale detail left as written: the license auth server is named `license.ozpos.my.id`, a domain the product has moved off (the worker is now kasir.mu — see the admin-login audit, round 10). · Stamp and footer added; the file had neither.
-->

# Technical Specification: Hardware Fingerprint Anti-Abuse Trial Lock

**Specification ID:** SPEC-2026-TRIAL-LOCK  
**Status:** Active Draft — ⚠️ trial definition re-scoped (see note)  
**Target Module:** `crates/kasirmu-security`, `apps/desktop-tauri/src/commands/license.rs`, License Auth Server (PocketBase)  
**Date:** 2026-07-20  

> **Re-scope note (2026-08-17):** the flat **90-day free trial** referenced
> throughout this spec is superseded by `subscription-tiers.md` §4 — the Free
> tier is now **free forever**, and paid trials are segmented by signup
> vertical (14-day Plus trial general, 14-day Pro trial restaurant/cafe,
> 30-day Pro trial enterprise-referral). This spec's hardware-fingerprint
> anti-abuse mechanism (one trial per physical device) still applies to the
> segmented trials to prevent reset abuse; the expiry/lock wording should be
> read against the trial types in `subscription-tiers.md` §4 rather than a
> single 90-day window. Tracked by `docs/plans/_active/todo.md` C2.1.

> **Audit note (2026-10-11): the mechanism SHIPPED, at different coordinates than this spec
> names.** The 2026-09-29 stamp read "the central function is not implemented", and for the
> *literal* function it named that is still true — there is no `compute_hardware_fingerprint` in
> `crates/kasirmu-security`. But the anti-abuse lock it describes is live end-to-end, which
> reverses the practical conclusion:
>
> - **Server (implemented).** `apps/license-server/trial.go` (287 lines) registers a fingerprint on
>   `POST /api/v1/license/trial` and answers `403 TRIAL_ALREADY_CLAIMED` on every later attempt;
>   the same gate is enforced at mint time by `enforceTrialLock` in `activate.go`, so a client
>   that skips the endpoint is still locked. `trial_test.go` pins both. The
>   `trial_registrations` PocketBase collection exists (`pb_schema.json`) with exactly the field
>   set §3.1 specifies — `hardware_fingerprint`, `first_seen_at`, `trial_expires_at`,
>   `platform`, `app_version`, `ip_address` (plus `tenant_id`).
> - **Client (implemented, different crate).** `generate_machine_id` + `generate_hardware_fingerprint`
>   live in `crates/kasirmu-bridge/src/license/machine.rs` (split out of `license.rs` on
>   2026-09-27), not in `kasirmu-security`. The `hw_<hex>` form §2.2 specifies is emitted from
>   there, and the OS probes match §2.1 (motherboard UUID via `wmic csproduct`, Windows
>   MachineGuid via `reg`, `/etc/machine-id` + dbus on Linux).
> - **What the spec gets wrong now, beyond the crate name:** the error it names,
>   `TRIAL_EXPIRED_ON_THIS_DEVICE`, is not the shipped code — the server returns
>   `TRIAL_ALREADY_CLAIMED`, and the lock is permanent rather than expiry-scoped (waiting does not
>   beat it). The `trial_vertical`/`email` claim-tie fields (§4.1's payload) are additions the
>   spec does not describe.
> - **The Target Module line is therefore stale in its first element** (`crates/kasirmu-security`);
>   its second (`apps/desktop-tauri/src/commands/license.rs`) resolves. The line is left as
>   written, as a spec's record of where it intended the code to go.
>
> Still unimplemented: nothing in §2.2's literal `SecurityError`-returning function, the
> `CLOCK_TAMPER_DETECTED` boot check against `max(sales.created_at)`, and the
> `local_settings.json` token cache (§5). The 90-day response bodies in §4.1/§4.2 remain
> superseded by the re-scope note above.

---

## 1. Executive Summary

This specification defines the architecture, cryptographic hardware fingerprinting algorithm, API endpoints, PocketBase collection schemas, and client-side enforcement logic required to prevent trial abuse (e.g. reinstalling the application to reset the 90-day free trial).

---

## 2. Hardware Fingerprint Generation (`kasirmu-security`)

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
   - If the system clock is manipulated backward (e.g. set to year 2020), `kasirmu-security` compares system time against last known transaction timestamps (`sales.created_at`). If `system_time < max(sales.created_at)`, a `CLOCK_TAMPER_DETECTED` lock is triggered.
4. **Lock Screen State**:
   - If `NOW() > trial_expires_at` or server returns `403 Forbidden`, the UI switches to the **Trial Expired Lock Screen**.
   - All checkout functions (`complete_sale`) return `AppError::LicenseExpired`.

---

## 6. Verification Plan

### Automated Unit Tests
- `cargo test -p kasirmu-security` for hardware fingerprint determinism and Sha256 hashing.
- Mock tests verifying RSA signature verification and clock tamper detection.

### Integration Testing
- Verify PocketBase Go hook `POST /api/v1/license/trial` rejects duplicate hardware IDs after `trial_expires_at`.
- Verify UI locks out checkout actions when trial status is expired.

> last audited 11-10-26 by docs-auditor
