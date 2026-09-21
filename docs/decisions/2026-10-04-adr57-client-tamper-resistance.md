---
num: 57
area: security
title: "ADR #57: Client Tamper Resistance Without Play Integrity — signature pinning, a bounded grace ceiling, and server-side detection"
status: Proposed (2026-10-04) — the grace ceiling, the sentinel guard and the fingerprint VERDICT are implemented; the client reporting, the pin store and server-side detection are not
---

# ADR #57: Client Tamper Resistance Without Play Integrity

**Status:** Proposed (2026-10-04). **Updated 2026-10-05:** §2.2's verdict rule now has an
implementation (`kasirmu_core::build_fingerprint`), §2.6's required test was found to ALREADY EXIST
and was verified under `--release`, and §2.3's grace ceiling was already implemented. **Still to
build: §2.1's client half** (the Android APK signing-certificate computation and its reporting),
the `release_channels` pin store §Q-B decided, and §2.4's server-side detection — which is where
§Q3's human assignment blocks. Some controls below are **already implemented and verified**
(marked IMPLEMENTED with evidence); the rest are **to build** (marked TO BUILD). No control is
claimed that this record does not either cite or name as work.
**Date:** 2026-10-04
**Recorded against:** branch `0.0.39` @ `2c30e735c`
**Related:** ADR #50 (sync auth hardening), ADR #55 (server origin model), ADR #56 (first-run
provisioning — this record supplies the integrity inputs its §2.1 provisioning row can carry).
**Tags:** security, tamper-resistance, entitlements, licensing, android, quarantine, quota

> Cite this record by filename, not by number (`docs/decisions/README.md`: numbering has collided
> before — #43 — and filename-plus-number is the only safe citation form).

## 1. Context

### 1.1 The question this record answers

"How does a Free user not modify the APK and use more than they are given?"

The honest answer has three parts, and this record is structured to keep them separate rather than
blur them into a single claim:

1. **What is mathematically impossible** — obtaining entitlements that were never issued.
2. **What is economically discouraging** — raising the cost of tampering above its value.
3. **What is bounded by policy** — capping an attacker ceiling even when the client is fully
   compromised.

### 1.2 The platform constraint that shapes every control

`apps/mobile-tauri/tauri.conf.json:44` sets `minSdkVersion: 26` (Android 8.0, 2017). Distribution
is sideloaded APKs (`apps/mobile-tauri/AGENTS.md`, Build section:
`cargo tauri android build --apk` → `adb install`).

**This rules out Play Integrity, which an earlier draft of this record proposed.** Two independent
reasons, either sufficient:

- **Play Services version floor.** The classic SafetyNet/Integrity API and its `IntegrityManager`
  replacement require Play Services versions that are not guaranteed on devices this project
  explicitly targets. A control that is absent on some of the supported fleet is not a control;
  it is a fleet split.
- **Distribution.** Play Integrity returns meaningful verdicts only for Play-distributed builds.
  A sideloaded APK reports `UNRECOGNIZED_VERSION` **by design**, which is indistinguishable from
  the tampering this record exists to detect. It would flag every legitimate install.

That decision is recorded here so it is not re-proposed: **no Play-Integrity dependency will be
introduced while `minSdkVersion` is 26 and distribution is sideload.** Reversing it requires
changing both facts, and is a product decision, not a security one.

### 1.3 Attacker model

| # | Attacker | Capability | Motivation | In scope |
|---|---|---|---|---|
| A1 | **Casual Free user** | Decompiles/re-signs an APK with a public toolchain; no crypto skill | Use paid features free | **Yes — primary** |
| A2 | **Free user exceeding quotas** | Same as A1, or simply uses the app past its caps | More products/staff/locations than paid for | **Yes — primary** |
| A3 | **Organised piracy** | Patches client, redistributes modified APK | Sell access to others | **Yes — bounded, see §1.5** |
| A4 | **Physical device thief** | Full hardware access, no key extraction | Their own data | Out of scope — this is their device |
| A5 | **Server compromise** | Full control of the licence server | Everything | Out of scope — total compromise, not defensible from the client |
| A6 | **Nation-state / zero-day** | Root exploit, key extraction | — | Out of scope — no client control survives it |

**A1–A3 are the threat this record defends against.** A4–A6 are named as out of scope rather than
quietly omitted: a security record that does not name its exclusions invites the reader to assume
there are none.

### 1.4 The architectural asymmetry that already wins

The single most important fact in this record: **the tier is not a client-side value.** It derives
from an RSA-2048 PKCS1v15/SHA-256 signature minted by the licence server, whose private key never
ships.

- `crates/kasirmu-core/src/license_verification.rs:393` — `verify_license_signature(payload,`
  `signature_base64)`, keyed on a build-embedded public key.
- `crates/kasirmu-core/src/subscription.rs:517` — `TenantSubscription::verify_signature()`.
- `crates/kasirmu-core/src/entitlements.rs:35,78,86` — the fail-closed projection: an unreadable,
  tampered or unknown row resolves to `SubscriptionTier::Free`.

**Consequence, and this is the claim that can be defended without qualification:** an attacker can
patch an APK to *claim* Premium, but cannot produce a payload that *verifies* as Premium, because
forging it requires the licence server private key. Patching the check out locally does not
create the entitlement — the fail-closed arm and the signature gate sit *underneath* every
consumer, at `crates/kasirmu-bridge/src/auth.rs:617`, `inventory.rs:112` and `history.rs:76`.

### 1.5 What the existing controls already cover

Each row is evidence, not intent. Verified against the tree on the date above.

| Control | Evidence | Status |
|---|---|---|
| Signed subscriptions, verified before trust | `license_verification.rs:393,501,544` | IMPLEMENTED |
| Verification at *every* consumer, not just boot | `auth.rs:617`, `inventory.rs:112`, `history.rs:76` | IMPLEMENTED |
| Fail-closed tier projection | `entitlements.rs:35,78,86` — unknown/absent/tampered → Free | IMPLEMENTED |
| Canceled never in grace; out-of-grace reverts to Free | `subscription.rs:7` module findings, `:665` | IMPLEMENTED |
| Clock-rollback detection, ledger-based | `subscription.rs:572`, `:534`; tolerance 30s (`:28`) | IMPLEMENTED |
| Read-only lock, failing closed on an unreadable ledger | `subscription.rs:991-995` (`Err(_) => true`) | IMPLEMENTED |
| Per-tier bounded offline grace | `subscription.rs:338`; Free 7 / Plus 14 / Pro 14 / Premium 30 / Enterprise 60 (`subscription_tests.rs:1168-1175`) | IMPLEMENTED |
| Quota gates on every capped dimension | **7 bridge call sites**, e.g. `bridge/products.rs:701`, `staff.rs:1084`, `locations.rs:259`, `terminals.rs:455`, `workspaces.rs:324`, plus `inventory.rs:127`. The gate *definitions* live in `kasirmu-core/src/db/*.rs` (`enforce_product_quota`, `enforce_staff_quota`, …); what this row counts is the bridge call sites that invoke them | IMPLEMENTED |
| Secrets/device keys denied in settings and export | `platform/core/src/settings/keys.rs:265,295`, gate-pinned at `:263` | IMPLEMENTED |
| API key sealed to machine identity | Encrypt: `license.rs:141` (`encrypt_api_key(&resp.api_key, &machine_id_for_encryption)`). Decrypt: `license.rs:188` (`sealed_api_key` → `decrypt_api_key` at `:191`). Both halves are `crates/kasirmu-bridge/src/license.rs` | IMPLEMENTED |
| Server-origin attestation, no debug shortcut | `attestation.rs:12-14,205-260`; echo-nonce check `:255` | IMPLEMENTED |

**The existing posture is strong.** This record extends it; it does not replace it.

## 2. Decision

### 2.1 The deployed-build fingerprint is pinned, and verified server-side

**TO BUILD.** The APK signing-certificate fingerprint is computed at runtime and reported to
the licence/sync server, which compares it against the fingerprint(s) *it* holds for that tenant
release channel.

The signing key already exists and is controlled: `gen/android/app/build.gradle.kts:40-46` reads
`keyAlias`/`password`/`storeFile` from the gitignored `gen/android/keystore.properties`, and the
release build config attaches it (`:63-64`). No new key material is required.

| Property | Why it matters |
|---|---|
| **Works on minSdk 26** | `PackageManager.getPackageInfo(..., GET_SIGNATURES)` predates API 26; no Play Services needed |
| **Targets A1/A3 directly** | A re-signed APK carries a *different* certificate, which is exactly the observable change |
| **Judged server-side** | The client reports; the server decides. Patching the client comparison does not change the server |
| **Cheap** | One IPC + one field on an existing sync call |

**Residual, stated plainly:** an attacker can patch out the client *reporting*. This control does
not make tampering impossible; it makes tampering *visible to the server* unless the attacker also
neuters the report — and a client that omits the field is itself distinguishable from one that
reports a valid fingerprint (§2.2).

### 2.2 Absence of a verdict is treated as a verdict

**TO BUILD.** A missing, malformed, or unparseable fingerprint is classified `unknown` and is
**never** treated as `valid`. This mirrors the discipline the repo already applies to boot reads
(`AppShell.tsx:235-240`: "unknown is not no users") and to attestation (`attestation.rs:12-14`:
no debug shortcut where a credential departure is decided).

Without this clause the control in §2.1 is trivially bypassed by deleting the reporting line — the
exact failure mode that would make the control decorative.

### 2.3 The grace window *is* the ceiling, and it is bounded per tier

**IMPLEMENTED — the point of this section is to name it as a deliberate bound rather than an
accident.**

For A1–A3, the maximum value obtainable from a fully compromised client is bounded by the offline
grace window of the tier they legitimately hold: 14 days (Plus/Pro), 30 (Premium),
60 (Enterprise).

> **Correction (2026-10-04, found on review).** An earlier revision of this section listed
> "7 days (Free)" in the sequence above. That was wrong. `subscription.rs:640-643` returns
> `true` for Free *unconditionally* ("Free tier — always within grace"), and `:942-943` marks a
> Free tier `Active` forever. `Free.offline_grace_days()` returns 7, but the value is **never
> consumed for the `Free` variant** because the function returns before reaching it (`:665`). The
> qualifier matters for one variant: `SubscriptionTier::OneTime` maps to `"free"`
> (`subscription.rs:140`) and, not being the `Free` variant, is *not* caught by the `:641`
> short-circuit — it reaches `:665` and **its 7-day value is consumed**. This is inert in practice
> because nothing seeds a `one_time` row (the bootstrap row is `free`, `subscription.rs:673`), but
> the blanket word "never" would have been a false claim about the code. **Free is
> permanent, not time-bounded**, so there is no Free clock to exhaust — which is why this
> record's ceiling claim applies to a *lapsed paid* subscription, not to a Free user.
> A Free user's exposure is a quota question, not a grace question: see §2.4.

Grace is evaluated against the **monotonic ledger timestamp**
(`compute_max_ledger_timestamp`, `subscription.rs:534`) — `MAX` over `sales.created_at` and
`audit_log.created_at` — not wall-clock, so rolling the OS clock back does not extend it; it trips
`validate_clock_rollback` (`:572`) instead.

**Therefore the defensible security claim of this record is:**

> A tampered client cannot obtain entitlements it was not issued. For a **paid** tier, its maximum
> gain is bounded by that tier's grace window, after which it reverts to Free or read-only. For a
> **Free** tenant there is no window to exhaust, so the binding constraint is the Free quota
> ceiling (§2.4) — which is why server-side detection, not the grace clock, is what bounds them.

That is a materially stronger and more honest claim than "the APK cannot be modified", and it is
the one this record asks to be held to.

### 2.4 Server-side detection, because effects are observable and claims are not

**TO BUILD.** Quota enforcement is local — **6 bridge call sites** invoke the core quota gates
(`bridge/products.rs:701` `enforce_product_quota`, `staff.rs:1084` `enforce_staff_quota`,
`locations.rs:259` `enforce_location_quota`, `terminals.rs:455` `enforce_terminal_quota`,
`workspaces.rs:324` `enforce_instance_quota`, `inventory.rs:127` `enforce_warehouse_quota`; the gate
definitions are in `kasirmu-core/src/db/*.rs`, and named siblings such as
`bridge/subscription.rs:598` are doc-comments, not call sites). A patched binary skips them.

> **Corrected 2026-10-04 (audit pass 2): the count is 6, not 7.** The list beneath the original
> sentence named **six** paths, so the number and its own evidence disagreed. Every one of the six
> was re-grepped and confirmed as an enforcing call; no seventh call site exists. If a seventh gate
> is added later, this number is the thing to update — not the list.

Detection therefore cannot rely on the client *claim* — it must read the *effect* from data the
client already syncs.

| Signal | Meaning |
|---|---|
| Product/staff/location/terminal counts above the tenant tier cap | Quota gate bypassed |
| A tier whose `max_pos_instances` is exceeded by observed terminals | Same, on the paid axis |
| Fingerprint mismatch, or `unknown`, for a tenant | §2.1/§2.2 fired |
| Subscription read failures clustered in time | Tampering, or a genuine corruption incident |

**Why this is the strongest control in the record:** it is immune to client tampering *by
construction*, because it observes server-held data rather than client-reported state. It also
reuses infrastructure that exists — the sync service already receives this data, and
`capabilities`/admin surfaces already compute the usage counts.

**Response policy — deliberately conservative.** A detected violation should flag and notify, not
auto-terminate. False positives are plausible (a legitimate support correction, a restore from
backup, a tier change mid-sync), and cutting off a merchant till on a heuristic is worse than the
revenue it protects. Termination stays a human decision; the system job is to make it *makeable*.

### 2.5 A quarantine state exists for the fingerprint mismatch

**TO BUILD.** Response is graded rather than binary, and the grades already exist as states:

| Verdict | Response |
|---|---|
| `valid` | Normal operation |
| `unknown` (absent/malformed report) | Normal operation, but recorded; escalate on repetition (§Q4) |
| `mismatch` (re-signed APK) | Refuse **renewal**; continue on the current signed entitlement until it expires or lapses |
| `revoked` (ADR #58) | **Locked** — no new sessions. Strictly stronger than `mismatch`; see the precedence rule below |
| Repeated mismatch + quota overrun | Flag tenant for review; surface in admin |

Refusing *renewal* rather than access is the correct severity for a **mismatch**: it denies the
attacker persistence without locking a legitimate merchant out mid-shift on a false positive.

**Where the refusal actually happens — corrected against the tree.** Renewal refusal is
**server-side**, and it is already built: `apps/license-server/renew.go:76-81` refuses any tenant
whose `status != "active"`. That guard is generic — it is not fingerprint-aware today, so a
fingerprint mismatch reaches it only once §2.4's detection work marks the tenant. It is **not**
`TenantSubscription::enforce_pos_writable` (`subscription.rs:1011`): that is a **selling** gate
whose callers are the POS checkout paths (`bridge/pos.rs:1755`, `pos.rs:1975`, `offline.rs:236`,
`core/src/db/sales_checkout.rs:206`, `core/src/db/sales_lifecycle.rs:176`). Wiring renewal refusal
into it would refuse *sales*, not renewal. This record's earlier revision named it as the renewal
mechanism, which would send an implementer one gate too deep. The two gates are unrelated and must
stay so: `enforce_pos_writable` protects revenue collection, the server guard protects renewal.

#### Precedence: `mismatch` (this record) vs the 3-day window (ADR #58 §2.3)

These two rules meet on the same device — a re-signed APK on a paid tenant approaching expiry —
and an earlier revision of the two records did not say which wins. The order is:

```
1. status == "revoked"                    → LOCK        (ADR #58 §2.1/§2.5; always wins)
2. inside the 3-day window AND check fails → operate, do NOT lock
                                              (ADR #58 §2.4: unmet obligation ≠ violation)
3. fingerprint == "mismatch"              → refuse RENEWAL, keep operating until expiry
4. otherwise                              → normal operation
```

**Why `revoked` outranks `mismatch`:** `revoked` is a human verdict about the tenant and is
served by an authoritative signed status; a fingerprint mismatch is a *signal* that may be a false
positive (an enterprise rebuild). A signal never overrides a verdict.

**Why a failed check does not lock:** locking on transport failure converts one of our outages into
a fleet-wide till outage. This record's §3.2 already accepts that risk for *revocation*; it must not
be extended to *check failures*.

**Why `mismatch` does not lock either, despite being positive evidence:** the attacker's ceiling is
already bounded (§2.3) and the renewal refusal removes persistence. Locking would trade a bounded
risk for an unbounded false-positive risk against legitimate merchants.

#### IMPLEMENTED 2026-10-05 — §2.2's verdict is real; §2.1's client half is not

`kasirmu_core::build_fingerprint` now classifies a reported fingerprint into three verdicts, which is
what makes §2.2 enforceable rather than aspirational:

| Input | Verdict | Why it is not something else |
|---|---|---|
| absent (`None`) | `Unknown` | §2.2: absence is a verdict, never `valid` |
| present but not 64 hex digits | `Unknown` | Unusable is the same class as absent — the device made no usable claim |
| a SHA-256 the channel does not hold | `Mismatch` | Positive evidence: the re-signed APK |
| a SHA-256 the channel holds | `Valid` | Matched against the SET §Q-B decided, so rotation is an ordinary write |
| anything, when the channel holds NO pin | `Unknown` | A channel nobody pinned has made no claim; calling it a mismatch would refuse renewal for every tenant on it |

**The `Unknown`/`Mismatch` split is the whole point, and it is pinned by a test.**
`only_a_mismatch_counts_as_positive_evidence` asserts the predicate is true for exactly one verdict,
because §2.5 refuses *renewal* on a mismatch and does nothing on an `Unknown`. Collapsing silence
into evidence is the failure §2.2 names, and its consequence is a merchant lockout rather than a
security hole — which is why the conservative direction is the default here.

**Normalisation is not cosmetic and has its own test.** `keytool` prints a SHA-256 uppercase and
colon-separated; Android's `PackageManager` returns it lowercase and bare. A fingerprint pasted into
the admin surface in the first form must not mismatch a build that is perfectly correct, so both
spellings are folded before comparison.

**What is NOT built, stated so the table above is not misread.** This is the *classification* half:
a pure function over a value the caller obtained. Missing: (a) the Android-side computation and
reporting of the APK signing certificate, (b) the `release_channels` record §Q-B decided holds the
pin set, and (c) the writer for it. §2.1's client leg therefore has no implementation yet, while the
rule it feeds — including the §2.2 clause that keeps it from being bypassable by deleting one line —
does.

**Verification run:** `cargo test -p kasirmu-core --lib` → **3151 passed, 0 failed** (7 of them in
`build_fingerprint`). The §2.6 release-profile check is recorded at that section.

### 2.6 `BOOTSTRAP_FREE` is constrained to Free, permanently

**IMPLEMENTED, and the test §2.6 asked for ALREADY EXISTED — verified 2026-10-05.** `subscription.rs:518`:

```rust
if self.signature == BOOTSTRAP_FREE_SIGNATURE && self.tier.tier_key() == "free" {
    return Ok(());
}
```

The sentinel is accepted without cryptography, gated to a Free-tier row. It is harmless *today* —
a Free row confers Free entitlements, which the user already has. It is nonetheless an oracle, and
the risk is not the current branch but a future one: any edit that lets a non-Free tier reach this
return is a full bypass.

**THE TEST ALREADY EXISTS — this item is DONE, verified by running it rather than by reading it.**
`sentinel_does_not_carry_a_paid_tier` (`subscription_tests.rs:196`) already asserts exactly what this
section asks for, and it is **stronger** than the section specifies: it writes an `Enterprise` tier
onto a sentinel-signed row and asserts rejection in release / the legacy permissive arm in debug, so
a future widening of the guard shows up rather than passing silently.

**One correction to this section's instruction to add the test.** The instruction was written as if
the test were absent; it is present. What is worth recording instead is the release-profile proof,
because the debug assertion cannot demonstrate the invariant: under `debug_assertions` the
`verify_license_signature` short-circuit accepts the sentinel for ANY payload BY DESIGN, so the
debug arm asserts the opposite of the security property.

```text
cargo test -p kasirmu-core --lib --release -- sentinel_does_not_carry_a_paid_tier  → ok
```

That run is what makes the claim true rather than the `#[cfg]` looking correct. **It is not part of
any default test invocation** — `cargo test` in debug takes the other arm — so the invariant is
unverified by the ordinary local loop and by any CI leg that does not pass `--release`. Recorded here
because a reader should not assume a green `cargo test` covers it.

**A comment pinning it as an invariant was added** at `subscription.rs:517-527`, naming the
`tier_key()` half as the only thing preventing a 14-byte forgery from claiming a paid tier, and
naming the debug short-circuit as the reason the test must not target `verify_license_signature`.

> **Scope, stated explicitly, because the obvious target is the wrong one.** The test must target
> `TenantSubscription::verify_signature` (`subscription.rs:517`) — the release-path policy where the
> sentinel is gated to a Free row. It must **not** target `verify_license_signature`
> (`license_verification.rs:393`): that function carries a `#[cfg(debug_assertions)]` short-circuit
> at `:408-411` which returns `Ok(())` for `BOOTSTRAP_FREE` on **any** payload in a debug build. A
> test written against it would assert an invariant the test build violates by design, and would
> fail on the debug profile while saying nothing about release. `subscription.rs:513-516` states the
> same split in the code's own words — debug behaviour there is "deliberately unchanged".

## 3. Consequences

### 3.1 Positive

- **The primary threat (A1/A2: a Free user patching for paid features) is already defeated**
  cryptographically, and this record documents *why* so the property is not lost to a refactor.
- **The attacker ceiling is explicit and bounded** — a per-tier number, not an aspiration.
- **Detection does not depend on the client behaving.** §2.4 observes effects.
- **No Play Services, no new key material, no distribution change.** Everything works on
  `minSdkVersion: 26` and on sideloaded APKs.
- **Reuses existing states** — `SubscriptionReadOnly`, the grace machinery, the sync channel, the
  admin surfaces — rather than inventing a parallel security subsystem.

### 3.2 Negative

- **Fingerprint reporting is patchable.** §2.1 raises cost and creates a signal; it does not
  prevent tampering. Stated here so it cannot be over-claimed later.
- **Server-side detection needs a home and an owner.** A signal with no response policy is
  noise; §2.4 conservative policy needs someone accountable for acting on it.
- **New IPC + wire field.** The registration gate (`registration_gate_debt.generated.rs`) and the
  IPC parity allowlist both move, on both shells.
- **Build fingerprint must be *stable*.** If the release keystore is rotated or lost, every
  pinned fingerprint changes at once. Rotating it is therefore a coordinated operation, not a
  local one — and it must be recorded as such.

### 3.3 Residual risk, stated

| Residual | Bound — **as of today, not as designed** |
|---|---|
| A2 exceeds local quota gates | **Unbounded today.** §2.4's server-side detection is deferred (Q3), so a patched client that skips a local gate is not caught. The bound arrives with §2.4 |
| A1/A3 patch out fingerprint reporting | **Unbounded today** for the same reason — §2.2's `unknown` classification only has force once §2.4 reads it |
| A3 redistributes a working tampered APK | Bounded by the tier's grace window; the forged APK cannot renew (§2.3, and renewal refusal is already enforced — ADR #58 §2.4a.1) |
| A4 physical access, A5 server compromise, A6 platform exploit | **Out of scope** (§1.3) — no client control addresses these |

- **No control in this record makes client-side modification impossible, and none is claimed to.**
- **The two "detected server-side" rows are the ones that will be misread.** They describe the design,
  not the shipped state: §2.4 is deferred on Q3's prerequisites. Until it is built, the honest
  position is that **tampering is not detected at all**, and the only bound in force is §2.3's grace
  window for a paid tier. Recording this here because a residual table that describes intent rather
  than reality is the failure mode this whole record exists to avoid.

## 4. Explicitly Rejected

| Option | Why rejected |
|---|---|
| **Play Integrity API** | Requires Play Services versions unavailable across the `minSdkVersion: 26` fleet, and reports `UNRECOGNIZED_VERSION` for every sideloaded build — flagging legitimate installs. See §1.2. |
| **SafetyNet Attestation** | Deprecated by Google; same fleet problem. |
| **Obfuscation as a security control** | R8 already runs; it raises cost and is worth keeping, but it is not a control and is not counted as one. |
| **Hardware keystore / StrongBox binding** | Not uniformly available at API 26; would split the fleet exactly as §1.2 forbids. |
| **Hard-blocking on fingerprint mismatch** | Rejected in favour of refusing renewal (§2.5): locks out legitimate merchants on false positives. |
| **Client-side-only detection** | Rejected: it is the thing being attacked. |

## 5. Decisions on the Former Open Questions

**Status: DECIDED** (2026-10-04). Each item carries its options, the tradeoff, and a binding
decision with rationale. `[blocking]` meant the answer changes §2's mechanism; `[policy]` meant it
needs a human owner. Both are settled except where an owner must still be *named* (§Q3), which is
an assignment rather than a design choice.

### Q1 — Is the release keystore permanent, or rotated per release? `[was blocking]` — DECIDED

§2.1 pins a fingerprint, so its stability is load-bearing.

| Option | Pros | Cons |
|---|---|---|
| **A. One long-lived release key**, fingerprint pinned per tenant channel | Pinning works forever; simple | Key compromise is unrecoverable — every install must be re-keyed |
| **B. Rotate per major version**, pin a set of accepted fingerprints | Limits blast radius of a key leak | Every pin must accept N fingerprints; rotation is a coordinated server change |

**Decision: A — one long-lived release key, fingerprint pinned per tenant release channel.**

Android constrains this more than preference does: an installed app **cannot be updated by a
differently-signed build**, so rotating the release key forces every existing install to be
uninstalled and re-installed. That is already a disruptive, coordinated operation regardless of
what this record decides, which removes most of option B's attraction.

**What option A obliges us to do instead:** write the rotation procedure down *before* it is
needed, because the failure mode it guards against — a lost or leaked release keystore — is
unrecoverable for existing installs. That procedure belongs in `apps/mobile-tauri/AGENTS.md`, which
already documents the signing configuration at `:40-46`, not here.

**If the key is ever compromised:** option B becomes mandatory retroactively, and every tenant's
pin set must accept both fingerprints during the migration. Recording this now is cheaper than
discovering it during an incident.

### Q2 — Does a fingerprint mismatch refuse renewal silently or notify the tenant? `[was policy]` — DECIDED

| Option | Pros | Cons |
|---|---|---|
| **A. Silent** — refuse renewal, no in-app message | Attacker learns nothing; no support burden | A legitimate re-signed build (e.g. an enterprise rebuild) fails with no explanation |
| **B. Notify in-app** — "this installation failed an integrity check" | Legitimate cases are diagnosable | Tells the attacker precisely what tripped |

**Decision: A — silent to the device, diagnosed from the admin side.**

The asymmetry decides it: telling the device tells the attacker precisely which control fired, and
therefore what to patch. Telling the *operator* costs nothing and serves every legitimate case,
because a genuine enterprise rebuild is diagnosed by a human who already has admin access — not by
a message on the affected terminal.

**Consistent with how the repo already handles boot reads** (`AppShell.tsx:235-240`): the device
learns only what it must act on, and the reason lives in logs and admin surfaces. The refusal
remains visible to the merchant as a failed renewal, which is enough for them to open a support
conversation.

### Q3 — Who owns the server-side violation queue, and what is the SLA? `[was policy]` — DECIDED (build deferred)

**Decision: the queue is the existing admin "needs attention" surface. §2.4's detection work is
DEFERRED until two prerequisites hold, and the deferral is deliberate rather than an omission.**

The destination is settled, because the infrastructure already exists and is proven:
`apps/license-server/admin_stats.go:576-605` computes a `NeedsAttention` list today, including a
`grace_period` category. Quota and fingerprint violations become two more rows in that list — no
new UI, the signal lands where an operator is already looking, and §2.4's response policy (flag,
never auto-terminate) is a human reading a queue.

**Why the build is deferred rather than scheduled.** Two prerequisites must both hold first, and
neither does today:

| Prerequisite | State | Why it gates the build |
|---|---|---|
| A named person who reads `NeedsAttention` on a stated cadence | **Not assigned** | A queue with no reader is the exact failure §2.4 warns about |
| The fingerprint field actually shipping (Q5) | **Not built** | Detection has nothing to detect until the field exists on a sync payload |

**The argument for deferring rather than assigning a role title:** a queue is only a control if
someone acts on it. Naming an owner who does not operationally exist would let this record *claim*
coverage it does not have — which is worse than an honest deferral, because the next reader would
treat the gap as closed. Detection built before an owner exists creates the *appearance* of
protection while providing none.

**Trigger to revisit, so this is not deferred forever:** build §2.4 when (a) someone is named and
reading the surface on a cadence, and (b) Q5's fingerprint field is on a shipped sync payload.
Until both hold, the honest statement is that the server does not detect tampering — §3.3 carries
that as a residual rather than this section implying otherwise.

### Q4 — Is `unknown` allowed to operate indefinitely, or does it escalate? `[was policy]` — DECIDED

| Option | Pros | Cons |
|---|---|---|
| **A. Operate indefinitely**, record only | No false-positive risk at all | An attacker who patches out reporting is never inconvenienced |
| **B. Escalate to `mismatch` treatment after N consecutive `unknown` reports** | Closes the obvious bypass of §2.1 | A network/serialisation bug that drops the field would lock out legitimate users |

**Decision: B — escalate after N consecutive `unknown` reports, routed to the operator queue (§Q3),
never to an automatic lockout.**

Option A leaves §2.1's most obvious bypass permanently open, which would make the fingerprint
control decorative: an attacker who simply deletes the reporting line is never inconvenienced. That
is the entire reason §2.2 exists.

**The failure mode is chosen deliberately.** A serialization bug, a field rename, or a partially
rolled-out client would each produce `unknown` reports from legitimate devices. Routing escalation
to a human queue means the worst outcome is a support ticket — whereas an automatic lockout on the
same bug would dark every till running the affected build. **ADR #58 §2.7** forbids the latter for
the same reason ("Enforcement never depends on the local DB refusing to open",
`2026-10-04-adr58-online-licence-heartbeat-and-revocation.md:440-447`). This record has no §2.7;
the earlier citation pointed at a section that does not exist here.

**Suggested N: 7 consecutive reports**, which at one report per sync cycle separates a broken client
from an intermittent failure while staying inside a working day. The number is a tuning parameter,
not a security boundary; the routing to a human *is* the boundary.

### Q5 — Does the fingerprint field ride an existing sync call, or need a new command? `[was blocking]` — DECIDED

| Option | Pros | Cons |
|---|---|---|
| **A. Add to an existing sync/heartbeat payload** | No new IPC, no registration-gate churn, no parity allowlist entry | Couples the signal to the sync path; absent when sync is unconfigured |
| **B. New `report_build_integrity` command** | Explicit, testable, callable without sync | Moves both gates (`registration_gate_debt.generated.rs`, IPC allowlist) on both shells |

**Decision: A — add the fingerprint to an existing authenticated sync payload.**

The sync path already carries terminal provenance and is already authenticated (ADR #50), so a
second command would duplicate an existing surface for one field — and would move both the
registration gate and the IPC parity allowlist on both shells, which A avoids entirely.

**The apparent gap is not a gap.** Under A the signal is absent for a tenant with sync disabled —
which is exactly the `local` tier of ADR #56 §2.4, where there is no server, no credential, and
therefore nothing to protect. ADR #58 §3.4 reaches the identical conclusion from the revocation
side: a `local` install is exempt because there is no authority over it to exercise. The two
records agree, and that agreement is what makes option A correct rather than merely cheaper.

**Implementation note:** if ADR #58 §2.3's option C is adopted (ride any authenticated call), the
fingerprint field travels on the same calls at no additional cost. The two records should therefore
be implemented together.


---

## 5b. Decisions the Repairs Require

**Status: DECIDED** (2026-10-04, repair round). The defects above are corrected in place; four of
them exposed questions the record had not actually answered. Each carries options, the tradeoff, and
a binding decision with rationale. `[blocking]` means the answer changes §2's mechanism or its
storage shape and must be settled before the build starts; `[deferrable]` means it can be settled at
implementation time without re-opening §2.

### Q-A — Is the pinned fingerprint one value, or a SET of accepted fingerprints? `[blocking]` — DECIDED

§2.1 speaks of "the fingerprint(s) it holds"; §5 Q1 option B speaks of "a set of accepted
fingerprints"; and the same Q1 records that **if the key is ever compromised, every tenant's pin set
must accept both fingerprints during the migration** (:340-342). Those three statements only agree if
the column is a set. The question is whether that is decided now or discovered later.

| Option | Pros | Cons |
|---|---|---|
| **A. Single scalar column**, migrate to a set on the first rotation | Simpler reads; one comparison | The emergency path becomes a **schema migration during an incident** — the worst possible moment, and it is the path Q1 already committed to |
| **B. A set from day one**, stored as a bounded list | The Q1 rotation path is a data write, not a DDL change; the "accept both" clause is expressible | A set membership check instead of equality; needs a cap and an ordering rule to stay bounded |
| **C. Keep single-valued, treat rotation as out-of-band re-pin** | No set logic at all | Contradicts Q1's stated mitigation, and cannot express a transition window during which both old and new installs must be accepted |

**Decision: B — the pin is a set (a bounded list of accepted fingerprints) from the first schema
write, not retrofitted.**

The deciding evidence is **already in this record**: Q1 (:340-342) commits to a migration in which
"every tenant's pin set must accept both fingerprints". Option A makes that committed path a schema
change; B makes it an ordinary write. §3.2 already names keystore rotation as a coordinated operation
rather than a local one — a set is the data shape that operation requires. Option A would ship a
scalar and pay for it in an incident.

**Bound and rule:** the set is capped (a small N, e.g. 4) and ordered, so it does not become an
unbounded allow-list — an attacker who could append to it would have defeated §2.1. Membership is
checked in constant time against the reported value; the cap is a security property, not a storage
convenience.

### Q-B — Where does the pinned fingerprint live server-side, and who writes it? `[blocking]` — DECIDED

§2.1 says the server "compares it against the fingerprint(s) *it* holds for that tenant release
channel". The phrase **"tenant release channel" appears nowhere else in the repository** — a
repo-wide search for `release_channel` / `releaseChannel` returns **zero matches**, so this record is
the only place the concept exists. No store, no table and no writer is named, so as written §2.1
specifies a comparison against data that nothing in the system produces.

| Option | Pros | Cons |
|---|---|---|
| **A. A `release_channels` collection**, keyed by channel, holding the accepted pin set | One pin serves every tenant on the channel; rotation is one write; matches the "channel" language already used | A new collection and a new admin write path; today there is exactly **one** release channel (one keystore, `gen/android/app/build.gradle.kts:40-46`), so the indirection must earn its keep |
| **B. A field on the tenant record** (a per-tenant pin) | No new collection; the admin surface that already acts on a tenant writes it | Contradicts the word "channel": N tenants on one build need N identical writes, and Q1's rotation becomes an N-row coordinated update rather than one |
| **C. Derive it from a hosted build artifact** at report time | The pin cannot drift from the shipped APK | Requires the server to hold and hash build artifacts — a release-pipeline dependency this record does not otherwise need, and a new failure mode when the artifact is unavailable |

**Decision: A — a `release_channels` record holding the bounded pin set from Q-A, written by the
admin surface and read by the sync server; with the honest note that today there is exactly one
channel.**

The language in §2.1 and Q1 is already channel-scoped, and the deciding fact is operational: this
project has **one** long-lived release keystore (`gen/android/app/build.gradle.kts:40-46`, Q1), so the
channel is a set of one — but the *rotation* story Q1 commits to is precisely the case where a
per-tenant field (B) becomes an N-tenant coordinated write. A channel record makes rotation one
write. Option C is rejected because it adds a release-pipeline dependency to the server for a value
that only changes when a human rotates a key.

**Who writes it, concretely:** the same admin surface that already owns tenant lifecycle actions
(`admin_tenant_lifecycle.go`), because that is where an operator with the authority to rotate a
keystore already lives. **If a single channel is all that ever ships, A and B behave identically —
A is chosen because it is the shape that does not need a migration on the day a second channel
exists, and because the record's own vocabulary is already channel-based.**

### Q-C — Are the 7 "consecutive" `unknown` reports sync cycles, or calendar days? `[deferrable]` — DECIDED

§5 Q4 (:413-415) fixes N at 7 and reasons "at one report per sync cycle". That unit is unstated as a
decision, and the two readings differ by **roughly three orders of magnitude** for a real tenant: a
device syncing every 5 minutes produces 7 reports in ~35 minutes, while a tenant syncing daily
produces them over a week. A threshold whose meaning swings that far is not a threshold.

| Option | Pros | Cons |
|---|---|---|
| **A. 7 consecutive sync cycles** | Trivial to count; no clock involved; tightest response for a fast-syncing device | For a sparse tenant it is ~7 days, so a broken client sits unreported for a week; and "cycle" is undefined when sync is disabled or irregular |
| **B. 7 consecutive calendar days** | A fixed, human-readable span; matches how the operator queue is read (§Q3) | Slow for a fast-syncing attacker; a device that syncs once a day needs 7 days of reports — the same week as A's worst case |
| **C. A time-bounded window** — at least K reports inside a rolling window (e.g. ≥7 in 7 days) | Bounded in *both* directions; a burst escalates immediately and a trickle still escalates within a week | Two parameters instead of one; needs a defined behaviour when the window slides |

**Decision: C — a bounded window: ≥ 7 `unknown` reports within a rolling 7-day window, evaluated per
tenant, not per cycle.**

It is the only option that fixes *both* failure directions this record already acknowledges: Q4's
stated fear is a network/serialisation bug producing `unknown` from legitimate devices (which argues
for a *loose* trigger), while §2.4's whole purpose is to catch an attacker who deletes the reporting
line (which argues against an unbounded window). A is rejected because "cycle" has no defined meaning
for the sync-disabled tenant that ADR #56 §2.4 exempts, and B because it can never escalate faster
than a week even for a device reporting hourly.

**Aligned with the §Q3 cadence, which is the point.** The escalation lands in the
`NeedsAttention` queue (`admin_stats.go:574-611`), whose existing entries are **date-stamped and
day-scale** — the grace-period category carries a `grace_until` date at :599-603. A trigger measured
in calendar time is the unit that queue is read in, so the 7-day window is also the cadence at which
a human can actually act. Counting cycles would put a sub-hour signal into a day-scale queue and
invite it to be triaged as noise.

**N and the window stay tuning parameters, not security boundaries** — as Q4 already says, the
routing to a human is the boundary. Changing 7/7 is an operational decision; this entry fixes only
the *unit*, which was the defect.

### Q-D — Must the renewal-refusal response body be opaque? `[deferrable]` — DECIDED

§2.5 makes a fingerprint `mismatch` refuse **renewal**. The response body for that refusal is a
security decision, not a formatting one: §5 Q2 (:344-361) already decided that a mismatch is
**silent to the device** — "telling the device tells the attacker precisely which control fired, and
therefore what to patch". A refusal body that names the fingerprint check would undo Q2 in the one
place the client can actually read it.

| Option | Pros | Cons |
|---|---|---|
| **A. Reuse ADR #58 §2.4a.1's single generic message** ("invalid api_key or tenant is not active", `renew.go:76-81`) | One code path, one message, no new string to leak; consistent with ADR #58's deliberate genericness (`2026-10-04-adr58-online-licence-heartbeat-and-revocation.md:289-293`); a fingerprint refusal is indistinguishable from a lapsed account | The *operator* cannot tell a fingerprint refusal from a billing lapse in that response — mitigated because diagnosis is admin-side by Q2 |
| **B. A distinct message** ("this installation failed an integrity check") | Operator/merchant diagnostics | Exactly what Q2 rejected: it tells the attacker the control fired |
| **C. A distinct message visible only to the admin surface**, generic on the wire | Diagnosis without disclosure | Requires the admin surface to join the refusal to the tenant, i.e. §2.4's detection to already be built (deferred on Q3) |

**Decision: A — reuse ADR #58 §2.4a.1's generic non-active message; deliberately do not depart.**

ADR #58 §2.4a.1 already returns **one** message for every non-active status by design, and its own
text names the cost — a client "cannot distinguish \"you are banned\" from \"your account lapsed\""
— and accepts it (`2026-10-04-adr58-online-licence-heartbeat-and-revocation.md:289-293`). This record's
Q2 reached the identical conclusion from the integrity side. Reusing the string makes the two records
agree on the wire rather than merely in prose, and it means a fingerprint refusal is
**indistinguishable from an ordinary lapse** — which is the property Q2 asks for. Option C is the
right end state once Q3's queue exists, and is recorded here so it is not re-derived later; it is not
adopted now because its prerequisite (server detection) is explicitly deferred.

**Implementation note:** because the guard at `renew.go:76-81` is keyed on `status`, serving A
requires only that §2.4's detection mark the tenant rather than add a new response path — the
refusal then arrives through the existing generic branch with no new wire surface.

## 6. Non-Goals

- **Not anti-piracy DRM.** The goal is that tampering costs more than it returns, not that it is
  prevented.
- **Not a replacement for the signed-subscription model.** §1.4 remains the load-bearing control.
- **Not a change to quota limits or tier definitions** — `docs/guides/subscription-tiers.md` is
  FINAL and authoritative.
- **Not device attestation of the server.** That is ADR #55, and it protects the opposite
  direction (a credential leaving toward a lapsed host).
- **Not a promise of perfect security.** See §1.3 exclusions and §3.3 residuals.
