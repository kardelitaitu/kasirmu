---
num: 58
area: licensing
title: "ADR #58: Pre-Expiry Re-Authentication, Manual Revocation, and the Locked State"
status: Proposed (2026-10-04) — mechanism largely implemented, one state to add
---

# ADR #58: Pre-Expiry Re-Authentication, Manual Revocation, and the Locked State

**Status:** Proposed (2026-10-04). The great majority of the pipeline below is **already
implemented and tested**; the decision is about *one* new lifecycle state and *one* new
timestamp, plus the policy that surrounds them. IMPLEMENTED and TO BUILD are marked per item.
**Date:** 2026-10-04
**Recorded against:** branch `0.0.39` @ `2c30e735c`
**Supersedes (in part):** ADR #41 §2.1 "State B: Registered / Enrolled Device" — specifically its
"**Offline-First (Zero Internet Required)**" clause. See §1.5.
**Related:** ADR #57 (client tamper resistance — shares the fail-open policy and the
`BOOTSTRAP_FREE` constraint), ADR #56 (first-run provisioning — a `local`-mode install has no
server to heartbeat to; see §3.4).
**Tags:** licensing, revocation, ban, grace, lifecycle, offline, admin, heartbeat

> Cite this record by filename, not by number (`docs/decisions/README.md`: numbering has collided
> before — #43 — and filename-plus-number is the only safe citation form).

## 1. Context

### 1.1 The requirement, as stated

Three rules were given, and they are the spine of this record:

1. **A paid tenant must re-authenticate within the last 3 days before its subscription expires.**
   Outside that window it operates on its locally stored signed subscription; Free tenants are
   never asked to re-authenticate (§2.3).
2. **A late paid tenant drops to Free** until they subscribe again — *automatically*.
   **Revocation is always a manual admin act.**
3. **A revoked Free tenant is locked — no access at all.**

### 1.2 The distinction the rules turn on

Rules 2 and 3 describe **two different mechanisms that must not share a state**:

| Mechanism | Trigger | Actor | Outcome | Reversible |
|---|---|---|---|---|
| **Downgrade** | Paid period lapses / expires | **Automatic** (billing) | → Free entitlements; **can still sell** | Yes — pay again |
| **Revocation** | Abuse / fraud / chargeback | **Manual** (owner, from admin) | → **Locked**; no app access | Yes — manual un-revoke |

Today both collapse into one lifecycle state (`subscription.rs:934`):

```rust
"canceled" | "revoked" => return SubscriptionLifecycleState::Canceled,
```

The current behaviour is **correct for downgrade** and documented as intentional —
`subscription.rs:980-982`: *"Canceled/Paused revert entitlements to Free (Free can still sell)"*,
and the fail-closed rule *"targets administrative features, not the operational sale path."*
That is the right call for a lapsed subscription. **It is the wrong call for a revocation**, which
is an abuse verdict rather than a billing outcome. That is the gap this record closes.

### 1.3 What already exists (the pipeline is real)

The ban path is substantially built. Each row is evidence.

| Piece | Evidence | Status |
|---|---|---|
| Admin revoke endpoint | `apps/license-server/admin_tenant_lifecycle.go:229` `handleAdminRevokeDevice`, idempotent `:245`, logged `:254` | IMPLEMENTED |
| Revocation record | `tenant_machines.revoked_at` (`:249`) | IMPLEMENTED |
| Admin auth on the endpoint | `adminAuth(app, e)` (`:231`) | IMPLEMENTED |
| Server returns `revoked` | `:246,255`; tested `dashboard_api_test.go:203,682-728` | IMPLEMENTED |
| Per-tier grace set server-side | `grace_until` — `admin_tenant_lifecycle.go:368`, `activate.go:983`, `admin_dashboard.go:309` | IMPLEMENTED |
| Grace surfaced to needs-attention | `admin_stats.go:576-605` | IMPLEMENTED |
| Client pulls authoritative status | `license.rs:515` → `check_license_status()`, then `:525` `refresh_subscription_status_from_server` | IMPLEMENTED |
| Status written to the local row | `license_verification.rs:690` (`UPDATE ... SET status = ?1`) | IMPLEMENTED |
| Session creation re-reads and gates | `auth.rs:610-630` — clock-rollback `:612`, signature `:617`, entitlement `:620` | IMPLEMENTED |
| Live sessions are in-memory | `auth.rs:251-257` (LRU + lazy prune) | IMPLEMENTED |
| Fail-open when the server is unreachable | **UI layer** — `LicenseSettings.tsx:157-166` catches the error, increments `pollFailures`, and only surfaces the "offline" string after `MAX_POLL_FAILURES = 3` (`:73`); it never locks. `license.rs:531` is NOT this — see §1.3a | IMPLEMENTED |
| Per-tier offline grace values | `subscription.rs:338`; Free 7 / Plus 14 / Pro 14 / Premium 30 / Enterprise 60 | IMPLEMENTED |

#### 1.3a The fail-open is in the UI, not in `license.rs:531` — corrected 2026-10-04

An earlier revision cited `license.rs:531` for *"fail-open when the server is unreachable."*
**The citation points at the wrong layer.** Read in sequence,
`crates/kasirmu-bridge/src/license.rs:515-533`:

```rust
let resp = core_check_license_status(&api_key)
    .await
    .map_err(|e| BridgeError::Internal(e.to_string()))?;   // :515-517  transport failure → Err
// ...
if let Err(e) = refresh_subscription_status_from_server(  // :525
    &conn, "default", &resp.status, resp.expires_at.as_deref(),
) {
    tracing::warn!("failed to refresh subscription status cache: {e}");  // :531
}
```

`:531` is a `tracing::warn` for a **local SQLite write failure** inside
`refresh_subscription_status_from_server` — reached only **after** a successful server response
(`resp` already exists at `:528-529`). Transport failure is not swallowed there: `:515-517` maps it
to `Err(BridgeError::Internal)`. So at this layer the behaviour is the *opposite* of fail-open — an
unreachable server is an error returned to the caller.

**The real fail-open is one layer up, in the UI.** `ui/src/features/settings/LicenseSettings.tsx:150`
calls `checkLicenseStatus()` and `:157-166` catches every rejection: it increments
`pollFailures` and, only once `next >= MAX_POLL_FAILURES` (`:73`, the value `3`), sets the
"offline" indicator string. There is **no lock path anywhere in that handler** — a device that can
never reach the licence server keeps operating, which is the fail-open §2.4 wants.

**Why this matters beyond the citation:** §2.4's marker rests on it. The fail-open is not a tested
property of the Rust path; it is an *absence of a lock in a React error handler*. That is a much
weaker guarantee, and §2.4 now records it as such.

**Conclusion: "ban from admin.kasir.mu" largely already works.** What is missing is that a
revoked *Free* tenant is currently indistinguishable from a downgraded one, so the ban does not
actually lock anything.

### 1.4 The failure the current mapping produces

Walk a revoked Free tenant through the existing code:

1. Admin sets `revoked_at` → server returns `status: "revoked"`.
2. Client refreshes → local row `status = "revoked"`.
3. `lifecycle_state_at` maps it to `Canceled` (`subscription.rs:934`).
4. `Canceled` reverts entitlements to **Free**, which can still sell (`:980-982`).
5. Free is ***always* within grace** (`:640-643`) and active forever (`:942-943`).

**Net effect: the ban changes nothing observable on the device.** The tenant keeps selling. This is
not a bug in any single line — it is the consequence of one state serving two meanings.

### 1.5 The contract this changes

ADR #41 §2.1 states, for State B (an enrolled device):

> **Network Requirement:** **Offline-First (Zero Internet Required).**
> *"All transactional capabilities … execute 100% locally."*

**This record supersedes that clause, but narrowly.** A paid device is required to reach the
licence server only **inside the final 3 days before `expires_at`** (§2.3), and a Free device is
never required to. Outside that window the sale path remains fully local — so the practical change
to "zero internet required" is confined to the renewal window, and it is a change to *when a check
is owed*, not a continuous heartbeat.

This is a deliberate reversal of an accepted ADR and is recorded as such rather than left as an
inconsistency between a document and a binary. ADR #41 §2.1 should be amended to point here.

### 1.6 Why "fail-open" and rule 1 are not in conflict

Fail-open (rule 3 of the previous round; §2.4) and "must connect to the internet" (rule 1) sound
contradictory. They are not, because they answer different questions:

- **Fail-open** governs the response to **transport failure** — *we could not reach the server.*
  The device must not be punished for our outage.
- **The 3-day window** governs when a check is *required at all* — inside it, the device must
  reach us; outside it, no check is owed.

A device inside the window whose requests fail because *our* server is down does not lock: §2.4
keeps the register open and the obligation unsatisfied-but-not-violated. The consequence is that a
tenant in that window who is genuinely offline continues on the stored subscription past
`expires_at`, into the §2.2 grace rules — which is the correct direction, because the alternative
is locking a merchant's till for an outage that is ours.

## 2. Decision

### 2.1 `Revoked` becomes a distinct lifecycle state

**TO BUILD.** Add a variant to `SubscriptionLifecycleState` (`subscription.rs:1043`), separate from
`Canceled`:

```rust
/// Revoked by an administrator — an abuse verdict, not a billing outcome.
/// Never within grace, never downgraded: the register is locked. See ADR #58.
Revoked,
```

with `as_str() -> "revoked"` (`:1063`) and the mapping at `:934` split:

```rust
"canceled"      => return SubscriptionLifecycleState::Canceled,  // downgrade → Free, can sell
"revoked"       => return SubscriptionLifecycleState::Revoked,   // lock, no access
```

**Blast radius is measured, and the compiler is weaker than it looks — corrected 2026-10-04.** An
earlier revision claimed *"`Canceled` has 4 uses across `subscription.rs`, `entitlements.rs`,
`availability.rs` and their test files"* and that *"the compiler enforces that"*. **Both halves were
wrong.**

```
$ grep -rn "Canceled" --include=*.rs | grep -v target
crates/kasirmu-core/src/subscription.rs          6
crates/kasirmu-core/src/subscription_tests.rs    5
crates/kasirmu-core/src/entitlements_tests.rs    1     → 12 sites, 3 files, ZERO in
crates/kasirmu-core/src/entitlements.rs          —       entitlements.rs or availability.rs
crates/kasirmu-core/src/availability.rs          —
```

The two files an earlier revision named are exactly the two that **never name the variant**. Both
compare against the allow-list instead:

- `crates/kasirmu-core/src/entitlements.rs:115-120` — `addon_grant_flows()` returns
  `matches!(self.state, SubscriptionLifecycleState::Active | SubscriptionLifecycleState::Grace)`.
- `crates/kasirmu-core/src/availability.rs:383-386` — `explain_availability()` computes
  `lifecycle_denies = !matches!(facts.state, Active | Grace)`.

A `matches!` against an allow-list is exhaustive **today and stays exhaustive when a variant is
added** — the new `Revoked` arm falls into the `false`/`denies` branch with no compile error, no
warning and no test failure. So the new variant does **not** force a decision at the two
security-relevant predicates; it silently inherits their answer.

**Required, in place of the deleted reassurance:** an explicit audit of those two sites as part of
this change, recording the answer to *"does a revoked tenant flow the add-on analytics grant /
pass the lifecycle arm of the availability verdict?"* — and a test at each. The remaining ten sites
in `subscription.rs` and the two test files are ordinary compile-error work, because they do name
the variant.

### 2.2 The two mechanisms, made explicit

| Condition | State | Tier answer | Session | Selling |
|---|---|---|---|---|
| Paid, within period | `Active` | paid | granted | yes |
| Paid, past expiry, within grace | `Grace` | paid | granted | yes |
| Paid, past grace / lapsed | `Expired` | **Free** | granted | **yes** |
| Explicitly canceled by server | `Canceled` | **Free** | granted | **yes** |
| Paused by server | `Paused` | per tier | granted | yes |
| **Revoked by admin** | **`Revoked`** | **locked** | **refused** | **no** |
| Missing / tampered | `Unavailable` | Free (fail closed on gates) | granted | yes |

**Revocation is tier-independent.** A revoked Premium tenant is locked exactly as a revoked Free
tenant is: revocation is a verdict about the *tenant*, not a statement about billing. This is
deliberate — "revoked Pro → just Free" would let a fraudster keep selling after a ban, which
defeats the mechanism.

### 2.3 Re-authentication is required only in the last 3 days before expiry

**TO BUILD — and corrected 2026-10-04: there is no NEW heartbeat, but there IS a 30-second poll
today.** An earlier revision read *"There is no periodic heartbeat … the device makes no licence call
at all."* **That is false against the tree.** `ui/src/features/settings/LicenseSettings.tsx:69-70`
defines `POLL_INTERVAL_MS = 30_000` and `:205-219` starts it with
`setInterval(pollTick, POLL_INTERVAL_MS)` once a payload is loaded; each tick (`:150`) calls
`checkLicenseStatus()`, whose bridge path is `crates/kasirmu-bridge/src/license.rs:515` →
`POST /api/v1/license/status`. **A 30-second licence call ships today, whenever the Settings screen
is open.**

What this record adds is therefore a *re-authentication obligation* — the rule below — not a
transport. The decision that remains is what happens to that existing poll; it is taken explicitly
at **§4a Q-B**, and the answer there is binding on this section.

The rule as specified: a paid tenant is asked to re-authenticate **only inside the final 3 days
before `expires_at`**. Outside that window no *new* call is owed and the device operates on its
locally stored signed subscription.

The client already holds the value this needs. `expires_at` is a field on the local row
(`subscription.rs:382`) and is refreshed from the server on every status call
(`license_verification.rs:692`), so the window is computable **offline**, with no new timestamp and
no new column.

### The rule

```
if   tier is Free                        → no re-auth ever required
elif expires_at is NULL                  → no re-auth ever required (perpetual / lifetime)
elif now_ledger < expires_at - 3 days    → no re-auth required (operate locally)
elif now_ledger <= expires_at            → REQUIRE a successful status check
else                                     → past expiry: per §2.2
```

**The `NULL` arm is not decoration — added 2026-10-04.** `expires_at` is nullable by schema:
`crates/kasirmu-core/migrations/20260813_init.sql:901` declares it `expires_at TEXT NULL, -- ISO
timestamp (NULL = lifetime/free)`, and `crates/kasirmu-core/src/subscription.rs:945-947` returns
`SubscriptionLifecycleState::Active` for it with the comment *"perpetual / lifetime"*. A perpetual
paid licence therefore **owes no re-authentication check at all**: there is no expiry for a 3-day
window to precede. Whatever reaches it must still be a *session* gate — §2.1's `Revoked` arm and
§2.4a.2's device check apply to a lifetime licence exactly as they do to any other, and §4a Q-D
carries the region question — but the §2.3 window obligation is vacuous for it. Without this arm
the pseudocode has no defined answer for a legal row shape.

**On clock tampering, stated accurately — corrected 2026-10-04.** An earlier revision said the rule
is *"evaluated against the monotonic ledger timestamp … so moving the OS clock forward does not
create an obligation, and moving it back does not evade one."* The ledger choice is right; the
reasoning for the rollback half was redundant at the chokepoint named in §2.5. `create_session`
calls `TenantSubscription::validate_clock_rollback` **first** — `crates/kasirmu-bridge/src/auth.rs:612`,
before `verify_signature()` at `:617` — and that function
(`crates/kasirmu-core/src/subscription.rs:572-593`) compares `compute_max_ledger_timestamp` against
`chrono::Utc::now()` (the **wall clock**, `:579`) and hard-fails
`CoreError::SystemClockTampered` when the ledger runs more than `CLOCK_SKEW_TOLERANCE_SECONDS`
ahead (`:584-591`). A rolled-back clock therefore does not merely fail to evade the window rule —
**it fails the session outright**, before the window rule is reached. The ledger timestamp's real
job in §2.3 is the forward case: moving the clock *forward* cannot manufacture an obligation, and
the window is computed against a value that only moves with real activity.

### Why this is better than a fixed heartbeat

An earlier revision of this section proposed the conventional design: a **fixed interval** (e.g.
hourly) plus a separate offline tolerance, requiring a new `license.last_verified_at` column and a
background timer. **The expiry-window rule supersedes it**, for four reasons:

| | Fixed heartbeat | 3-day expiry window |
|---|---|---|
| Licence calls from a healthy tenant | Every interval, forever | **None owed.** (One 30s poll already ships while the Settings screen is open — `LicenseSettings.tsx:70` — and §4a Q-B decides its fate; this column is about the *obligation*, which is zero.) |
| Server load | Scales with fleet size × interval, unbounded by lifecycle | Scales with tenants *near renewal* — a small fraction. The surviving poll in Q-B option A re-introduces fleet-wide load, which is why Q-B recommends B |
| New state required | New timestamp column, new timer, migration | **None** — `expires_at` already exists |
| Interacts with grace | Two clocks to reconcile | One clock: `expires_at` |

**The load difference is the decisive one.** A heartbeat asks every device to check in
continuously in order to catch the rare case of a ban. The expiry-window rule asks *nothing* of a
device that is not near renewal, and concentrates all the checking exactly where a decision is
already required. It also removes §2.4's tension almost entirely: there is only one clock.

### Consequence for ban latency, stated honestly

Revocation is a **manual admin act** (§1.1) and this rule does not change that. A revoked paid
tenant that is *not* in its final 3 days before expiry continues operating on its existing signed
subscription until either:

1. it enters the 3-day window and its required check returns `revoked` (§2.4), or
2. its subscription expires, at which point §2.2 applies.

**This is a deliberate trade, not an oversight.** It bounds ban latency for a paid tenant by the
expiry date, which for an annual subscription could be months. Three options exist, and this record
recommends the third:

| Option | Ban latency | Cost |
|---|---|---|
| **A. Heartbeat every interval** | Minutes | The load and state cost above; contradicts the rule as given |
| **B. Window only** (as specified) | Until expiry — potentially months | Nothing; a banned tenant keeps selling |
| **C. Window + a revocation check when the device is online anyway** | Minutes for reachable devices, expiry-bound for offline | Reuses calls the device already makes (sync, status, pairing) |

**Decision: C — window plus a revocation check on any authenticated call** (confirmed in §4 Q1).

A device making *any* authenticated call to us — sync push, terminal pairing, an in-app status read
— carries back the current `status` at no extra cost, because the response envelope already exists.
That gives prompt revocation for connected devices without reintroducing a heartbeat, and leaves an
offline device on the expiry bound.

**Option B remains coherent if C is ever rejected**, and is recorded here so the fallback is
explicit: B is simply a weaker guarantee, and ban latency for paid tenants would then have to be
stated in the merchant-facing terms rather than assumed to be immediate.

**The same call carries ADR #57's build fingerprint** (§Q5 there). One envelope change serves both
records.

### 2.4 Fail-open on transport, fail-closed on an explicit verdict

**IMPLEMENTED for transport — but by the UI, not by a guard, and only incidentally
(corrected 2026-10-04; see §1.3a).** The old citation `license.rs:531` was a local-database write
warning after a *successful* response; the Rust path returns `Err` on transport failure
(`license.rs:515-517`). What actually keeps a till open is `LicenseSettings.tsx:157-166` having no
lock branch. **Treatment as a pinned, tested rule is TO BUILD** — the distinction is behavioural and
must be tested, not merely inherited from an error handler's omission:

| Server response | Client behaviour |
|---|---|
| `status = "revoked"` | Lock, immediately, regardless of grace |
| `status = "active"` / `"grace_period"` | Normal operation; the obligation is satisfied |
| Transport failure, timeout, 5xx | **Operate within grace.** Never lock on this |
| 4xx other than an explicit verdict | Treat as transport-class; do not lock |
| Check was *required* (§2.3) but failed | Treat as transport-class — the obligation is unmet, not violated. The device continues into §2.2 grace and locks only when that lapses |

**Rationale, stated as the asymmetry it is:** locking on transport failure converts one of our
deployments into a fleet-wide till outage. Locking on an explicit verdict is a decision we made and
can stand behind. The test that pins this must drive a rejecting HTTP client and assert the
register stays open.

### 2.4a Renewal, revocation and un-revocation — corrected against the server

> **Correction (2026-10-04, found on review of `apps/license-server/`).** An earlier revision of
> this section asserted that there is no `revoked` check in the renew path and that "the ban would
> be undone by the act of paying". **That was wrong.** The renew path does refuse a non-active
> tenant (§2.4a.1 below), so the laundering risk described does not exist. Reviewing the server to
> prove it surfaced **two different defects that the original text missed** (§2.4a.2 and §2.4a.3),
> both more consequential than the one it claimed. The text is replaced rather than annotated,
> because the section's conclusion was inverted.

#### 2.4a.1 Renewal already refuses a non-active tenant — IMPLEMENTED

`apps/license-server/renew.go:76-81`:

```go
tenant, err := findTenantByAPIKey(app, req.APIKey)
if err != nil || tenant.GetString("status") != "active" {
    return e.JSON(http.StatusUnauthorized, map[string]any{
        "error": "invalid api_key or tenant is not active",
    })
}
```

A revoked tenant is not `"active"`, so renewal is refused. A revoked Tenant therefore **cannot**
obtain a fresh signed subscription, which is the property ADR #57 §2.5 depends on for its
fingerprint-mismatch consequence.

**The guard is generic rather than revocation-specific**, and that is worth knowing rather than
fixing: it refuses `canceled`, `suspended`, `revoked` and anything else that is not `"active"` with
one message. For the ban's purpose this is sufficient; the cost is that the client cannot
distinguish "you are banned" from "your account lapsed", so §2.4's client-side rule must not
depend on that distinction (it does not — both are non-active and both mean no session).

**What this changes in the records:** ADR #57 §2.5's "refuse renewal" consequence is already
serviceable and needs no server work. The requirement table that stood here is **deleted, not
deferred** — it specified a change that is not needed.

#### 2.4a.2 Device revocation has no enforcement — TO BUILD, and this is the real gap

`handleAdminRevokeDevice` (`admin_tenant_lifecycle.go:225-257`) sets `tenant_machines.revoked_at`
for **one device**. It does **not** touch `tenants.status`.

Consequence, traced through the gate this record specifies:

1. Admin revokes a device → `tenant_machines.revoked_at` is set.
2. `tenants.status` remains `"active"`.
3. `create_session` (`auth.rs:610-630`) reads the *tenant* subscription, sees `active`.
4. **The session is granted. The app keeps working.**

The revoked device is never consulted, because nothing reads `tenant_machines.revoked_at` on the
session path. **The admin action appears to succeed and changes nothing observable on the device.**

This is the same *class* of defect §1.4 describes — a state written but not honoured — though the
cause is different from §1.4's (there, two meanings shared one enum variant; here, the enforcement
point reads a different table from the one the action writes).

**The server already emits the verdict — the client discards it (found 2026-10-04).** This makes
the fix smaller than the shape below first suggested, and it also explains *why* the gap survived:

- `apps/license-server/status.go:107,151,175` computes `deviceRevoked` and returns it as
  `"device_revoked"` on `POST /api/v1/license/status`.
- `crates/kasirmu-core/src/license_verification.rs:264-293` — `LicenseStatusResponse` has **no
  `device_revoked` field**. Serde ignores the unknown key, so the server's answer is parsed and
  **thrown away**. The verdict is already on the wire; nothing reads it.

**The device row also documents the intent the code does not implement.** `pb_schema.json:859`
describes `tenant_machines.revoked_at` as: *"When set, the machine has been revoked by the tenant
admin and **should not be allowed to activate**."* That is the behaviour §2.4a.2 asks for, written
in the schema before it was written here.

**Decision: enforce at `create_session`, per device**, with the check placed beside the existing
entitlement gate. `create_session` **already receives `args.terminal_id`** (`auth.rs:636`), so no
new plumbing is needed:

```
create_session → load subscription → verify_signature()   [existing :617]
              → tenant_machines[terminal_id].revoked_at?  → refuse   [new]
              → check Revoked (§2.1)                     [new]
              → check allows_workspace_type()            [existing :620]
```

**Two ways to feed it, and the choice is ADR #59's to make.** The verdict can be read from the local
`tenant_machines` row (already present) or carried on the status response the client already
receives. §4a Q-D already decides the *shape* — cache it alongside `tenant_subscription` rather
than a network call inside `create_session`, which §2.7 forbids from being able to brick a
register. Whichever source, the check is a local lookup at the gate.

**Why per-device and not "revoking a device sets the tenant's status":** the admin UI action is
labelled *revoke this device* (`admin_tenant_lifecycle.go:225`), and its blast radius should match
its label. Flipping `tenants.status` would make a stolen-tablet action end an entire multi-terminal
business — the exact asymmetry §4 Q2 resolves in favour of the smaller radius.

**Also required:** a live session on a revoked device must be invalidated, not merely refused on
next login. The session store is in-memory (`auth.rs:251-257`) and already prunes expired entries,
so revocation invalidation extends an existing path.

**Sequencing, stated because two records depend on it:** the client-side `device_revoked` field is
a wire change (`LicenseStatusResponse` gains a field) and the server half already exists. Adding
the field is therefore additive and backward-compatible — an older server that omits it parses as
`false`, which is the pre-existing behaviour, not a new lockout.

#### 2.4a.3 A manual grant silently un-revokes — TO BUILD, a guard

`admin_tenant_lifecycle.go:382-388`:

```go
// A tenant that just paid must not stay revoked/suspended.
if tenant.GetString("status") != "active" {
    tenant.Set("status", "active")
    ...
}
```

The comment states the intent — a tenant who paid should not remain locked out — and the intent is
right. The implementation is **unconditional**: any `grant-subscription` call clears *any*
non-active status, including a revocation whose reason was abuse.

**The failure this produces:** an operator issues a goodwill credit, extends a subscription as a
support fix, or corrects a billing mistake — and a previously revoked tenant silently becomes
active again. Nothing in the response or the log distinguishes "this grant also lifted a ban" from
"this grant extended a subscription". The revocation is undone by an action taken for an unrelated
reason.

**The two statuses are ALREADY distinct — corrected 2026-10-04.** An earlier revision of this
section proposed adding a `revocation_reason` field so the flip could "clear `suspended` but not
`revoked`". That field is **not needed**: the production schema already carries both values on one
select field.

`apps/license-server/pb_schema.json:399-400` (the `tenants` collection):

```json
"values": ["active", "suspended", "revoked"]
```

So the distinction this section asks for exists; what is missing is only that the **flip ignores
it**. The fix is a guard, not a schema change:

```go
// admin_tenant_lifecycle.go:383 — currently flips ANY non-active status
if tenant.GetString("status") == "suspended" {   // was: != "active"
    tenant.Set("status", "active")
}
```

| Option | Pros | Cons |
|---|---|---|
| **A. A one-line guard** (chosen) | No schema change, no migration, no new field; the enum already means what it should | A future third status must be considered at this line |
| **B. A `revocation_reason` field** as well | Records *why* a tenant was revoked, for audit | Not the fix — the enum already separates the two; adds a field and a write path for an audit nicety |
| **C. A separate un-revoke endpoint for `revoked`** | Makes un-revoke a deliberate act (§1.1 rule 2) rather than a side effect | More surface; can follow later |

**Decision: A now, with C as the end state.** A closes the hole with one line and no migration.
**B is demoted from "the fix" to "an optional audit improvement"** — worth having for the incident
question "why was this tenant revoked?", but it does not change the behaviour and must not be
described as the guard. C is the right destination once un-revoke needs its own operator action,
because today `revoked` has no un-revoke route at all (only the grant flip, which is the bug).

**A regression test is required, not optional.** This is the one change in the record whose failure
is **silent** — the ban is lifted with no error, no log line distinguishing it from a normal grant,
and no user-visible symptom until the abuse recurs. The test must drive `grant-subscription`
against a `revoked` tenant and assert the status **stays** `revoked`, and separately against a
`suspended` tenant and assert it becomes `active`.

**Both changes are audited:** the refusal (2.4a.2) and the un-revoke (2.4a.3) must record actor and
reason like `handleAdminRevokeDevice` already does (`:254`). §2.5 requires it for the region
equivalent, and the same argument applies here — "why is this tenant active again" is the question
an incident review asks.

#### 2.4a.4 What remains true from the original text

**Fail-open does not apply to a revocation refusal.** §2.4's fail-open rule covers *transport
failure*; a server that answers "your account is not active" has answered. That is an explicit
verdict, and the client treats it exactly as `revoked`: lock.

**The renew path must evaluate revocation before any integrity verdict**, consistent with the
precedence order in ADR #57 §2.5. With 2.4a.1 already in place, the ordering is satisfied by the
existing guard and needs no change.

### 2.5 "Locked" means: no session, therefore no app

**TO BUILD**, using machinery that exists. Enforcement is at `create_session`
(`auth.rs:610-630`), beside the existing entitlement check:

```
create_session → load subscription → verify_signature()      [existing :617]
              → check Revoked                                [new, §2.1]
              → if inside the 3-day window: require a
                successful check (§2.3)                      [new]
              → check allows_workspace_type()                [existing :620]
```

**Only the `Revoked` arm locks.** The window arm (§2.3) does *not* refuse on a failed check — per
§2.4 it continues into §2.2 grace, because refusing there would let our own outage lock every till
approaching renewal. The window arm's purpose is to *make the check happen*, so that a
`revoked` verdict reaches the device at all.

Two consequences worth stating:

- **New sessions are refused**, so the device cannot get back in after its current session expires
  or is invalidated. Login is the chokepoint, and it is already the chokepoint.
- **Live sessions must be invalidated on revocation.** The session store is in-memory
  (`auth.rs:251-257`) and already prunes expired entries; revocation invalidation is a small
  extension of that path, so a ban lands without waiting for a TTL.
- **Every session-gated command becomes unreachable, export included** — `export_data`
  (`data.rs:374-375`) and its scoped twins resolve a session and require `SETTINGS_EDIT` like any
  other. §2.6's export promise is therefore satisfied only by the read-only local twin §4a Q-A
  option 3 adds; it is **not** satisfied by the existing command.

### 2.6 Locked tenants retain view and export

**Decision (delegated, per the prior round).** A revoked tenant keeps **read-only viewing and data
export**, and loses **all selling, mutation and sync**.

| Capability | Revoked |
|---|---|
| View existing sales / inventory / reports | **Yes** |
| Export data | **Yes — but only via the mechanism §4a Q-A decides**, not via the existing command |
| Sign out | **Yes** |
| New sales, refunds, stock movements | **No** |
| Sync / cloud writes | **No** |
| New sessions | **No** |

**Rationale:** the merchant business data is the merchant data, including when we have banned
them. Withholding it creates a dispute, a support escalation, and in some jurisdictions a legal
exposure — while providing no protection, since the data is already on their disk and readable by
anyone with the device. Refusing *new sessions* while permitting export is the balance: selling
stops immediately, data remains retrievable.

This mirrors the intent already recorded for `Expired` at `subscription.rs:972-978` — *"viewing,
data export, and sign-out remain available"* — and extends it to `Revoked` rather than replacing
it.

**The promise above was unreachable as written — corrected 2026-10-04; the path is now decided at
§4a Q-A.** An earlier revision simply granted export alongside §2.5's refusal of new sessions. But
export is **session-gated at the bridge**, so "no sessions" and "export works" cannot both hold:

- `crates/kasirmu-bridge/src/data.rs:374-375` — `export_data` calls
  `ctx.resolve_session(session_token)?` then `require_session_permission(&session, SETTINGS_EDIT)`.
- The scoped and alternate twins are the same: `data.rs:529-530` (`import_preview`),
  `data.rs:558-559` (`import_data`), `:796-797`, `:811-812`, `:835-836`.

Once §2.5 refuses sessions and invalidates live ones, **no caller can reach any of them**, so
"Export data: Yes" was a capability with no code path. A no-session twin *does* exist for the
neighbouring case — `("data::create_backup", "no_session_resolution")` in
`apps/desktop-tauri/src/commands/registration_gate_debt.generated.rs:22`, wired at
`apps/desktop-tauri/src/commands/data.rs:42-48` — but it is the *backup* command, not export, and
it is a published gate-debt row rather than a licence decision.

The three ways out, with their trade-offs, are taken as **§4a Q-A**, and Q-A's answer is binding on
this table. **Recommendation: Q-A option 3** — an unauthenticated local export twin beside
`create_backup`, reading local data only, with no sync and no mutation.

### 2.7 Enforcement never depends on the local DB refusing to open

**Constraint.** No control in this record may make the SQLite database unopenable or the app
unlaunchable. Revocation is enforced at **session creation**, not by bricking the client.

**Why:** a false-positive revocation, a bug in the check, or an unreadable row would otherwise
destroy a merchant business data with no recovery path — worse than the abuse it prevents, and
unrecoverable offline. Session refusal is reversible, diagnosable, and loses nothing.

## 3. Consequences

### 3.1 Positive

- **A manual ban actually bans.** Today it does not, for Free tenants (§1.4).
- **Downgrade and revocation stop sharing a state**, so a billing lapse never locks a merchant out
  and a ban never degrades into "Free but still selling".
- **Fast revocation when online, tolerance when not**, because the two clocks are separate (§2.3).
- **Our outages do not lock the fleet** (§2.4).
- **Reuses the existing pipeline** — the admin endpoint, `revoked_at`, the refresh call, the
  session gate and the in-memory session store are all already there (§1.3). The new client-side
  code is **one enum variant** (`Revoked`, §2.1) and the enforcement points that consume it; **no new
  timestamp is needed**, because `expires_at` already exists and is already refreshed from the server
  (§2.3, `license_verification.rs:692`). Add the two server-side gaps §2.4a.2/§2.4a.3 close — the
  per-device `revoked_at` check, and a one-line guard on the grant flip so it clears only
  `suspended` — plus the §2.6 export path §4a Q-A decides, and §2.7's constraint on all of them.
  An earlier revision said *"one enum variant, one timestamp"*: the timestamp was a leftover from
  the superseded fixed-heartbeat design, which §2.3 replaced. A later revision described §2.4a.3 as
  adding a `revocation_reason` field; the schema already separates `suspended` from `revoked`
  (`pb_schema.json:399-400`), so the fix is a guard, and the field is demoted to an optional audit
  improvement rather than part of the change.
- **Merchant data stays retrievable** (§2.6), so a ban is not a data hostage situation.

### 3.2 Negative

- **ADR #41 §2.1 is superseded, narrowly** (§1.5). A paid device owes a check only inside its
  final 3 days; Free devices owe none. Merchants on a connectivity-poor site will notice at
  renewal, and that should be communicated as a product change rather than shipped silently.
- **Ban latency for a paid tenant is bounded by expiry, not by minutes** (§2.3). On an annual plan
  that can be months unless §2.3 option C ("ride any authenticated call") is adopted. This is the
  largest *commercial* exposure the record accepts.
- **A fleet-wide outage no longer locks tills.** The earlier heartbeat design had this exposure;
  the 3-day window removes it for devices outside the window, and §2.4's fail-open covers devices
  inside it. The remaining exposure is a device in-window with no connectivity, which continues on
  its stored subscription into §2.2 grace.
- **A new lifecycle variant touches a security-critical mapping — and the compiler does not flag
  the two worst sites** (§2.1). `entitlements.rs:115-120` and `availability.rs:383-386` compare
  against `Active | Grace` without naming `Canceled`, so they stay exhaustively-typed while
  silently deciding `Revoked`. Both need an explicit audit and a test; the ten named sites in
  `subscription.rs` and the two test files are ordinary compile-error work.
- **Two enforcement gaps are open, both server-side** (§2.4a.2, §2.4a.3). Renewal refusal already
  works (§2.4a.1), so the sequencing warning that stood here is withdrawn. What remains:
  **device revocation is not enforced** (`create_session` never reads
  `tenant_machines.revoked_at`), and **a manual grant silently clears a revocation**
  (`admin_tenant_lifecycle.go:382-388`). Until the first is fixed, the admin "revoke device" action
  changes nothing on the device.
- **The §2.1 client gate and §2.4a.2's device check are independent** and can ship in either order:
  §2.1 handles a tenant-level `revoked` status, §2.4a.2 handles a device-level one. Neither depends
  on the other, which is why the earlier sequencing constraint was wrong.

### 3.3 Residual risk, stated

| Residual | Bound |
|---|---|
| Banned **paid** tenant keeps selling | Until its 3-day window opens or it expires — potentially months on an annual plan. Bounded promptly under §2.3 option C |
| Banned **Free** tenant keeps selling while offline | Up to the offline tolerance, then locked |
| Banned tenant patches the client to ignore `Revoked` | Next session creation refetches server-side; ADR #57 §2.4 detects the divergence |
| Wrongful revocation locks the merchant | Data export retained via the read-only local twin (§2.6, §4a Q-A option 3); un-revoke is a manual admin act. **Not** via the ordinary export command, which §2.5 makes unreachable |
| Extended outage of ours locks many tills | Fail-open on transport (§2.4) bounds it to the grace window; the exposure is the window itself |

### 3.4 Interaction with ADR #56

ADR #56 §2.4 defines a `local` provisioning tier for a terminal with no account. **A `local`
terminal has no tenant to revoke and no server to check against**, and it holds no signed
subscription with an `expires_at` for §2.3 to key on. It therefore cannot be covered by this
mechanism, and it must not be: a `local` install is out of scope here by construction, and
ADR #56 already scopes it as the offline-first path.

**DECIDED: `local` installs are explicitly exempt from revocation as stated policy.**

| Option | Pros | Cons |
|---|---|---|
| **A. Exempt explicitly** (chosen) | Coherent with the offline-first premise; a `local` install has no account, so there is nothing to revoke and no credential to withdraw; preserves ADR #56's design intact | A `local` install cannot be banned by any means |
| **B. Narrow the `local` tier** so every install has a tenant | Bans apply universally | Removes the offline-first path ADR #56 exists to provide; a merchant with no connectivity could not provision at all |

**Rationale for A:** the two records are consistent once the mechanism is stated correctly. An
install that has never linked an account holds **no signed subscription, no `expires_at`, and no
credential issued by us** — so there is nothing for a revocation to withdraw. Banning it would
require inventing an authority over a device that has never authenticated to us, which is a
different product than the one ADR #56 specifies.

**The exemption is honest, but it is NOT bounded — corrected 2026-10-04.** An earlier revision of
this paragraph claimed the exposure was *"the same Free-user exposure ADR #57 §2.4 bounds by
server-side detection."* **That bound does not exist:** ADR #57 §Q3 defers §2.4's detection until a
queue owner is named and the fingerprint field ships. Citing it made an unbounded hole read as a
managed one.

The accurate chain, now recorded in ADR #56 §2.4 as well:

| Mechanism | Applies to a `local` install? |
|---|---|
| Revocation (§2.1, §2.4a.2) | **No** — no tenant, no credential of ours |
| The pre-expiry check (§2.3) | **No** — no `expires_at` to key on |
| Server-side detection (ADR #57 §2.4) | **No** — and it is deferred anyway |

So a `local` install is outside **every** server-side control this system has. That is a property of
the design rather than a defect, and the Free quota ceiling (§2.2) still applies — but it applies
*locally*, inside a binary the merchant controls, which is the thing ADR #57 exists because we
cannot rely on.

**If that is unacceptable for a deployment, the answer is to require linking at provisioning** —
ADR #56 Q3 option B — and that is a **product decision to revisit**, not something either record
may decide by omission.

**Recorded so it cannot be discovered as a bug:** "a ban does not reach a `local` install" is now
a stated property of the system, and any future change that links such an install must re-evaluate
it.

## 4. Decisions on the Former Open Questions

**Status: DECIDED** (2026-10-04). One item was resolved by the rule as given and is marked so; the
other carries options and a binding decision.

> **Repair pass (2026-10-04).** A second audit round found seven defects in this record and put
> four further questions to it. All are resolved in place: §1.3a (fail-open is UI-layer, not
> `license.rs:531`), §2.1 (the compiler does not flag `entitlements.rs`/`availability.rs`), §2.3
> (a 30s poll ships today; the `NULL` expiry arm; the clock-rollback reasoning), §2.4 (the
> fail-open marker), §2.5/§2.6 (export is session-gated — the path is decided at §4a Q-A), §3.1 (the
> superseded "one timestamp"). The four new questions are decided at **§4a**. Sections §2.4a.1-.3
> were re-verified as true and are unchanged.

### Q1 — ~~What is the online check interval?~~ **RESOLVED**

There is no interval check. The rule is the **3-day pre-expiry window** (§2.3), so the question
this slot originally asked no longer applies.

One sub-decision remains inside it, and it is a **product choice rather than a design**:

| Option | Ban latency for a paid tenant | Cost |
|---|---|---|
| **A. Window only** | Until expiry — potentially months on an annual plan | None |
| **B. Window + ride any authenticated call** (§2.3 option C) | Minutes for a connected device; expiry-bound when offline | None — the response already exists |

**Decision: B — ride any authenticated call; no separate heartbeat.**

It restores prompt revocation for connected devices without reintroducing a heartbeat, and it is
strictly additive: a device that makes no call behaves exactly as A. There is no cost to accept —
the device already calls us for sync push/pull, terminal pairing, and in-app status reads, and the
response envelope already exists.

**Implementation note tying the two records together:** ADR #57 §Q5 places its fingerprint field on
the same authenticated calls. Both fields ride one change to the sync/status envelope, so the two
records must be implemented together or a field will be added twice.

**The residual, stated:** a device that is offline and outside its window still cannot be reached,
so its ban latency remains expiry-bound. Option B narrows the exposure to offline devices rather
than eliminating it. §3.3 carries this as a bounded residual, and it is the correct trade against
locking tills on unreachable servers.

### Q2 — Is revoking a single-device or whole-tenant act? `[was policy]` — DECIDED

`handleAdminRevokeDevice` (`admin_tenant_lifecycle.go:229`) revokes **one device**
(`tenant_machines.revoked_at`). A tenant with five terminals of which one is fraudulent would
need the other four left alone — or the whole account suspended.

| Option | Pros | Cons |
|---|---|---|
| **A. Per-device** (what exists) | Precise; a stolen tablet does not end the account | A fraudster on a second device is unaffected |
| **B. Per-tenant** — lock every terminal | Complete for account-level abuse | Destroys an innocent multi-terminal business for one bad device |
| **C. Both**, chosen at ban time | Matches intent to severity | Slightly more admin surface and a confirm step |

**Decision: C — both scopes, chosen explicitly at ban time, defaulting to per-device.**

The existing endpoint is already per-device (`handleAdminRevokeDevice`,
`admin_tenant_lifecycle.go:229`, writing `tenant_machines.revoked_at`), so C is additive: the
per-tenant scope is a new admin action that revokes every `tenant_machines` row for a tenant, not a
rewrite of what exists.

**Two properties make C the right shape rather than merely the most flexible:**

- **The default must be per-device.** The overwhelming majority of revocations are one stolen or
  abused terminal, and the blast radii are wildly asymmetric: a wrong per-tenant revocation ends a
  multi-terminal business, while a wrong per-device revocation inconveniences one register. A
  default should fail toward the smaller blast radius.
- **The choice must be forced, not inferred.** The admin UI should require selecting the scope with
  its consequence stated, because "revoke" that silently means "revoke everything" is how an
  operator ends an innocent account.

**Audit requirement:** both scopes write the actor, the reason, and the scope to `audit_log`. A
revocation with no recorded reason is unreviewable, and §2.6's data-export concession only makes
sense if a mistaken ban can be reconstructed after the fact.

**Consistency with ADR #57 §2.4:** the `NeedsAttention` surface that record adopts for its
violation queue is the natural place for a pending-revocation review step, should one be wanted
later. Neither record requires it today.

## 4a. Audit questions raised against this record (2026-10-04)

**Status: DECIDED.** Four questions were put to this record by the repair audit. Two were
**blocking** — they contradicted text already written above (Q-A against §2.6/§2.5, Q-B against
§2.3) — and two are **deferrable** (Q-C, Q-D), decided here so they cannot be discovered later as
assumed behaviour. Each carries options, a trade-off per option, and a binding decision.

### Q-A — What happens to a LIVE session on revocation, and is there an export carve-out? `[blocking]` — DECIDED

This is the **§2.6 defect, folded here.** §2.5 refuses new sessions and invalidates live ones; §2.6
promised export. But every export command resolves a session and requires `SETTINGS_EDIT` —
`data.rs:374-375`, `:529-530`, `:558-559`, `:796-797`, `:811-812`, `:835-836` — so once §2.5
holds, **no export path is reachable at all**. The promise needs a mechanism, not a sentence.

| Option | How it works | Trade-off |
|---|---|---|
| **1. Invalidate all; export only pre-revocation** | Keep §2.5 exactly as written. A merchant who wants their data must export *before* the ban lands, or after a manual un-revoke. | **No new mechanism** — the smallest change, and the state machine stays pure. But it makes the data hostage to ban timing: a ban issued while the merchant is away is unrecoverable without an operator, which is precisely the dispute §2.6 exists to avoid. It also cannot be honoured for a device revoked *before* it next signs in. |
| **2. A "locked-export" session capability mask** | A session grants a reduced mask — view + export, no mutation — instead of full or nothing. | **Genuinely new machinery**: the session model, `require_session_permission`, and every scoped twin must learn a partial-grant state, and a mis-set mask is a new way to grant selling rights to a banned tenant. The blast radius is the whole permission system. Rejected as disproportionate to one command family. |
| **3. An unauthenticated local export twin, read-only** (recommended) | A `no_session_resolution` twin of `export_data` beside the existing `create_backup`, reading only the local database, with no network and no mutation. `create_backup` already proves the shape: `("data::create_backup", "no_session_resolution")` — `apps/desktop-tauri/src/commands/registration_gate_debt.generated.rs:22`, wired `apps/desktop-tauri/src/commands/data.rs:42-48`. | **Matches the backup precedent exactly** rather than inventing a session state, so the gate-debt ledger already has a home for the row. The cost is a deliberate, recorded widening of the local read surface — it must be **read-only and local-only** (no sync, no import), and it must be added to the registration-gate ledger as a new `no_session_resolution` entry, which is a published ceiling rather than a silent exception. |

**Decision: 3 — an unauthenticated, read-only, local-only export twin.**

**Why 3 over 1:** §2.6's rationale is that withholding a banned merchant's data buys no protection
(the data is on their disk already) while creating legal exposure. Option 1 reinstates exactly that
hostage problem whenever a ban lands before an export does — so option 1 fails the rationale the
section was written to serve. **Why 3 over 2:** option 2 rebuilds the session model to serve one
command family, and its failure mode (a mask mis-set toward permissive) is *grant selling rights to
a banned tenant* — the one outcome this record exists to prevent. Option 3's failure mode cannot
sell; it can only read.

**Bindings this decision places on §2.5 and §2.6:**

- §2.5 is **unchanged**: new sessions are refused, live sessions are invalidated. Q-A does not
  re-open it.
- The export twin must be **read-only** — export only. `import_preview` / `import_data`
  (`:529-530`, `:558-559`) mutate and stay session-gated.
- The twin must be **local-only** — it may not sync or reach the licence server, which keeps §2.7
  intact (no network path can gate opening the app).
- The twin is a new row in `registration_gate_debt.generated.rs`, and its gate-debt ceiling is a
  decision to record, not to slip in.

**Sequencing — the twin ships WITH the session lock, never after it.** This is not a deferral, it is
an ordering constraint, and it is the one thing in this section that can produce a merchant-visible
incident:

| Order | What ships | State of the product |
|---|---|---|
| Today | Export is reachable through the ordinary session path | §2.6's promise is *accidentally* kept |
| **Wrong order** — §2.5 first, twin later | Sessions refused and invalidated, no twin | **A revoked merchant cannot retrieve their own data.** The promise breaks, and §2.6's whole rationale (data is theirs; withholding it is legal exposure) is inverted |
| **Correct order** — twin and §2.5 together | Both land in one change | The promise holds by construction |

**Therefore:** the export twin is a **prerequisite of §2.5's enforcement**, not a follow-up to it.
Any plan that sequences "enforce revocation" before "add the export twin" is wrong and should be
rejected at review. Note this is the *opposite* of §2.4a.2's device check, which is independently
safe to ship — the difference is that the device check removes a capability nobody was promised,
while the session lock removes one §2.6 explicitly grants.

### Q-B — Does the 30-second Settings poll survive §2.3, and who removes it? `[blocking]` — DECIDED

**The conflict this closes:** §2.3 asserts no licence call is made outside the window, but
`LicenseSettings.tsx:69-70` defines `POLL_INTERVAL_MS = 30_000` and `:205-219` runs it while the
Settings screen is open, calling `checkLicenseStatus()` (`:150`) each tick. The two cannot both
stand as written. **The poll is also the only path by which a CONNECTED device learns it is
revoked today** — §2.3 option C rebuilds that, so removing the poll before C ships would *remove*
the only working revocation signal.

| Option | What changes | Trade-off |
|---|---|---|
| **A. Keep the poll; re-describe §2.3 as "no NEW heartbeat"** | §2.3 text is corrected (done above); nothing in the UI changes. | **Zero code, zero risk**, and it preserves the only live revocation signal. But it keeps fleet-scale load that scales with *screens left open* rather than tenant lifecycle, which is the exact cost §2.3 argues against — and it leaves the poll's fate undocumented in code. |
| **B. Gate the poll to the 3-day window** (recommended) | The interval runs only when `now_ledger >= expires_at - 3 days`; outside it, the initial load stands and no timer is armed. | **Matches the rule exactly** — load then scales with tenants near renewal, as §2.3 claims. Cost: it is a real UI change, it must read `expires_at` from the payload already in scope (`LicenseSettings.tsx:174-192`), and **it must not ship before §2.3 option C** or a connected device loses its only revocation signal in the window's absence. |
| **C. Remove the poll entirely** | Delete `POLL_INTERVAL_MS` and the effect. | Simplest code, and cheapest server. But it **deletes the only current revocation-notice path for connected devices** and must not be done until §2.3 option C's "ride any authenticated call" lands — otherwise a ban stops reaching any device until its window opens, silently widening §3.3's first residual. |

**Decision: B — gate the poll to the 3-day window.**

**Who removes it — the answer to the question asked:** the **licensing UI area
(`ui/src/features/settings/`)** owns it, in the same change that corrects §2.3, and the change is
**sequenced after §2.3 option C's envelope work** so no interval of time exists in which a
connected device has neither the poll nor the ride-along status. Option A is the safe interim:
until B ships, the corrected §2.3 text above already scopes the claim to *"no new call is owed"*,
which is true of the poll as it stands.

### Q-C — Does an existing `revoked_at` on a DEVICE outlive a tenant un-revoke? `[deferrable]` — DECIDED

**The gap:** §2.4a.2 adds a per-device check (`tenant_machines[terminal_id].revoked_at` → refuse) and
§2.4a.3 un-revokes at the **tenant** level (`admin_tenant_lifecycle.go:382-388` flips
`tenants.status`). **Nothing clears a device row.** So un-revoking a tenant leaves every device
revoked at step §2.4a.2, and the tenant is active but the tills still refuse sessions — a ban that
outlives its own reversal.

| Option | How it works | Trade-off |
|---|---|---|
| **A. A matching per-device un-revoke endpoint** | Admin clears one `tenant_machines.revoked_at`. | **Symmetric and precise** — mirrors `handleAdminRevokeDevice` exactly, so the two device actions pair. Cost: the un-revoke of a tenant then does not un-revoke its devices, so an operator must issue N calls and can miss one, leaving the tenant half-locked with no signal that anything is wrong. |
| **B. Tenant un-revoke clears all device rows** (recommended) | The §2.4a.3 un-revoke path also clears `revoked_at` on every `tenant_machines` row for the tenant. | **Matches operator intent** — "un-revoke this tenant" plainly means the whole account, and it cannot leave a half-locked tenant. Cost: it broadens a per-device action's reach, so a *deliberately* device-revoked tablet (a stolen one) is un-revoked with the tenant unless option A also exists to re-flag it. |
| **C. State that device revocation is permanent** | No clearing path; a revoked device stays revoked. | **Simplest** — no new code, no ambiguity. But it makes a false-positive device revocation **unrecoverable in the field**, which contradicts §2.6's own concession (a mistaken ban must be reconstructable and correctable) and is not a policy a support desk can operate. |

**Decision: B — tenant un-revoke clears all device rows, with A offered later.**

B closes the half-locked hole now, at the one place that already exists, and A is **strictly
additive** when it is wanted (re-revoking a stolen tablet after an un-revoke is a single call with
the endpoint §2.4a.2 already requires). C is rejected outright: a permanent, field-unrecoverable
device ban is a worse failure than the abuse it deters.

**Audit binding, consistent with Q2 and §2.4a.3:** the clearing path writes actor, reason and the
**count of device rows cleared** to `audit_log`. A tenant un-revoke that silently released five
revoked terminals is exactly the class of change that must be reconstructable.

### Q-D — Which region server answers the §2.4a.2 device check once ADR #59 lands? `[deferrable]` — DECIDED

**The gap:** once ADR #59 makes tenant identity `(home_region, tenant_id)`
(`docs/decisions/2026-10-04-adr59-regional-topology-and-modular-delivery.md:134`), the §2.4a.2 check —
`tenant_machines[terminal_id].revoked_at` — has to be answered by *some* server, and the answer
depends on which region holds that device's rows. Calling it directly inside `create_session`
would put a network round-trip on the session path, which **§2.7 forbids from being able to brick a
register**: an unreachable region would refuse a sale at the till.

| Option | How it works | Trade-off |
|---|---|---|
| **A. A region network call inside `create_session`** | The gate resolves the region and queries it live. | Always current, no staleness. But it puts the network on the session path — a regional outage or a routing failure locks tills, which is the one thing §2.7 exists to prevent, and it kills offline operation for every device. **Rejected on §2.7.** |
| **B. Cache it alongside `tenant_subscription`** (recommended) | The device check is fetched on the same authenticated call that already refreshes `tenant_subscription`, then read **locally** at `create_session`. | **Consistent with the whole record**: one envelope change carries §2.1's status, §2.4a.2's device flag, and ADR #57 §Q5's fingerprint — the "one envelope" note in §4 Q1. Cost: the cached device verdict can be stale between refreshes, so a freshly revoked *device* may open sessions until its next authenticated call — the same expiry-bounded latency §3.3 already accepts for a paid tenant's ban, and it is bounded now by option C's ride-along rather than by expiry. |
| **C. Let the tenant-level `Revoked` state carry it** | Drop the per-device check; enforce only §2.1. | No region question at all. But it silently reverts §2.4a.2 to the defect it closes — a device revocation that changes nothing — and it makes §4 Q2's per-device default unenforceable. **Rejected.** |

**Decision: B — cache the device verdict alongside `tenant_subscription`, read it locally at
`create_session`.**

It is the only option that answers the region question *and* keeps §2.7's "no network on the
session path" constraint intact. **Binding on ADR #59:** the region is part of the credential
(ADR #59 §2.1) and the region server is the authority for its own `tenant_machines` rows, so the
cache is written by whichever region the device is homed in — the client does not choose a server,
and it never routes a device check cross-region.

## 5. Non-Goals

- **Not an automatic fraud detector.** Revocation is manual by rule (§1.1). Detection (ADR #57
  §2.4) may *inform* a human; it must not ban.
- **Not a change to downgrade.** A lapsed paid tier keeps dropping to Free with full selling
  rights (§2.2). That behaviour is correct and is preserved.
- **Not a change to tier limits or grace values** — `docs/guides/subscription-tiers.md` is FINAL.
- **Not a client-side brick.** §2.7 forbids making the app or its database unopenable.
- **Not coverage of `local` installs** — see §3.4, where the exemption is now a stated decision rather than an open question.
