---
num: 58
area: licensing
title: "ADR #58: Pre-Expiry Re-Authentication, Manual Revocation, and the Locked State"
status: Partially implemented (2026-10-04; status re-audited 2026-09-22) — the Revoked state, the session lock, the export twin command, the ride-along and the per-device renewal refusal are IMPLEMENTED; the export twin has NO UI caller, so §2.6's promise is not reachable in the product, and §2.3's window ships as a UI poll gate rather than the session obligation its pseudocode specifies
---

# ADR #58: Pre-Expiry Re-Authentication, Manual Revocation, and the Locked State

**Status: Partially implemented** (2026-10-04; status re-audited 2026-09-22). **Updated
2026-09-21: §2.1 (`Revoked`), §2.4a.2 (the device verdict), §2.5 (the session lock), §4a Q-A's
export twin command, §2.3's poll gate (§4a Q-B option B) and §4a Q1 option B (the ride-along) are
all IMPLEMENTED.**

**Three corrections from the 2026-09-22 re-audit, each verified against the tree:**

1. **§2.5 IS built.** §4a Q-A's implementation note claimed *"§2.5 remains unbuilt, so no merchant
   is locked out of anything today"*; that was false. `create_session` refuses a `Revoked`
   subscription (`crates/kasirmu-bridge/src/auth.rs:645`) and `invalidate_all_sessions` (`:883`)
   sweeps live ones. §2.5's own note and this status line were right; Q-A's was stale, and is
   corrected there.
2. **The export twin has no UI caller, so §2.6's promise is NOT yet reachable.** The command exists
   and is registered, but nothing in `ui/` invokes it — the export wizard still uses the gated
   `export_data` (`ui/src/features/settings/hooks/useExportWizard.ts:104` →
   `ui/src/api/data.ts:283`) — and the tablet registers only the gated command
   (`apps/mobile-tauri/src/lib.rs:585`). Recorded as an **open gap** at §4a Q-A: §2.5's
   prerequisite is not discharged in product terms until the twin is reachable with no session.
3. **§2.3's window ships as a poll GATE, not as the session obligation its pseudocode describes.**
   `shouldPollLicense` (`ui/src/features/settings/LicenseSettings.tsx:109`) decides whether to arm
   the timer; nothing requires, prompts or blocks re-authentication, and there is no Rust-side
   window gate. §2.5's pseudocode marks that arm `[new]`, and that marker remains the accurate one.

The
great majority of the pipeline below is **already
implemented and tested**; the decision was about *one* new lifecycle state and *one* new
timestamp, plus the policy that surrounds them. Both halves are now built — see the §Q1 and §Q-B
implementation notes for what shipped, and for the correction that the ride-along needed no new
wire field. IMPLEMENTED and TO BUILD are marked per item.
**Date:** 2026-10-04 (implementation recorded 2026-10-05)
**Recorded against:** branch `0.0.39` @ `2c30e735c` (anchors and the poll interval re-measured at `f5eccee27` in audit pass 2 — see §1.3a and §2.3)
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
| Admin revoke endpoint | `apps/license-server/admin_tenant_lifecycle.go:384` `handleAdminRevokeDevice`, idempotent `:400`, logged `:409` | IMPLEMENTED |
| Revocation record | `tenant_machines.revoked_at` (`:404`) | IMPLEMENTED |
| Admin auth on the endpoint | `adminAuth(app, e)` (`:386`) | IMPLEMENTED |
| Server returns `revoked` | `:410`; tested `dashboard_api_test.go:203,682-728` | IMPLEMENTED |
| Per-tier grace set server-side | `grace_until` — `admin_tenant_lifecycle.go:557`, `activate.go:983`, `admin_dashboard.go:309` | IMPLEMENTED |
| Grace surfaced to needs-attention | `admin_stats.go:581-616` | IMPLEMENTED |
| Client pulls authoritative status | `license.rs:501` `check_license_status()` → `:530` transport call, then core `apply_license_verdict_to_cache` (`license_verification.rs:690-715`) | IMPLEMENTED |
| Status written to the local row | `license_verification.rs:811-815` (`UPDATE tenant_subscription SET status = ?1`) | IMPLEMENTED |
| Session creation re-reads and gates | `auth.rs:612-632` — clock-rollback `:614`, signature `:619`, entitlement `:622` | IMPLEMENTED |
| Live sessions are in-memory | `auth.rs:225-272` (lazy prune `:259`, `MAX_SESSIONS = 256` `:272`) | IMPLEMENTED |
| Fail-open when the server is unreachable | **UI layer** — `ui/src/features/settings/LicenseSettings.tsx:206-215` catches the error, increments `pollFailures`, and only surfaces the "offline" string after `MAX_POLL_FAILURES = 3` (`:79`); it never locks. The cache-write `warn` (`crates/kasirmu-core/src/license_verification.rs:700`) is NOT this — see §1.3a | IMPLEMENTED |
| Per-tier offline grace values | `subscription.rs:338`; Free 7 / Plus 14 / Pro 14 / Premium 30 / Enterprise 60 | IMPLEMENTED |

#### 1.3a The fail-open is in the UI, not in the bridge's status cache write — corrected 2026-10-04

An earlier revision cited the bridge's subscription-cache `tracing::warn` for *"fail-open when the
server is unreachable."* **The citation points at the wrong layer — and, since the 2026-09-22 re-audit,
at the wrong FILE.** Read in sequence:

```rust
// crates/kasirmu-bridge/src/license.rs:530-532 — transport failure → Err
let resp = core_check_license_status(&api_key, &machine_id)
    .await
    .map_err(|e| BridgeError::Internal(e.to_string()))?;

// crates/kasirmu-core/src/license_verification.rs:690-715 — apply_license_verdict_to_cache
if let Err(e) = <the cache write> {
    tracing::warn!("failed to refresh subscription status cache: {e}");  // :700
}
```

**The anchor moved because this record was IMPLEMENTED.** `kasirmu-bridge/src/license.rs` no
longer calls `refresh_subscription_status_from_server` at all: the three local effects of a verdict
were extracted into the core function `apply_license_verdict_to_cache`
(`crates/kasirmu-core/src/license_verification.rs:690-715`), which the ride-along also uses (§4a
Q1), so the screen-driven and daemon-driven paths cannot drift. The `warn` string now lives at
`:700`, not at the bridge's `:535`.

**The argument is unaffected, and it is the point of this section.** That `tracing::warn` is a
**local SQLite write failure** reached only **after** a successful server response. Transport
failure is not swallowed: the bridge maps it to `Err(BridgeError::Internal)` at `:530-532`. So at
this layer the behaviour is the *opposite* of fail-open — an unreachable server is an error
returned to the caller.

**Anchor re-measured 2026-10-04 (audit pass 2).** An earlier revision of this record cited the
transport call as `:515` and the warn as `:531`, and typed the first argument list as
`core_check_license_status(&api_key)` — a single argument. **All three readings are stale:** the
device-revocation work this record itself specified (§2.4a.2) added `machine_id` as a second
argument, which shifted the call to `:519-521` and the warn to `:535`. The *argument* below is
unaffected; only the anchors moved, and they moved because this ADR was implemented.

**The real fail-open is one layer up, in the UI.** `ui/src/features/settings/LicenseSettings.tsx:153`
calls `checkLicenseStatus()` and `:162-171` catches every rejection: it increments
`pollFailures` and, only once `next >= MAX_POLL_FAILURES` (`:78`, the value `3`), sets the
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

**The decision below shipped 2026-10-05 — see the note at the end of this section.** Add a variant
to `SubscriptionLifecycleState` (`subscription.rs:1079`; `Revoked` at `:1095`, `Canceled` at
`:1089`), separate from `Canceled`:

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
crates/kasirmu-core/src/subscription.rs          7
crates/kasirmu-core/src/subscription_tests.rs    4
crates/kasirmu-core/src/availability_tests.rs    2
crates/kasirmu-core/src/entitlements_tests.rs    1     → 14 sites, 4 files, ZERO in
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

#### IMPLEMENTED 2026-10-05 — §2.1 and §2.5 shipped together

The variant and the enforcement landed in one change, because either alone is inert: a `Revoked`
state nothing consumes changes no behaviour, and an enforcement point with no distinct state cannot
tell a ban from a billing lapse.

| # | What | Where |
|---|---|---|
| 1 | `SubscriptionLifecycleState::Revoked`, split from `Canceled` | `crates/kasirmu-core/src/subscription.rs` — the `"canceled" | "revoked"` arm is now two arms |
| 2 | The tenant arm: no new session on `Revoked` | `create_session`, beside §2.4a.2's device check |
| 3 | Live sessions invalidated on the verdict | `invalidate_all_sessions`, called from `check_license_status` when `status == "revoked"` OR `device_revoked` |

**The required audit was performed, and it found one thing the ADR did not name.** §2.1 told this
change to audit `entitlements.rs:115-120` and `availability.rs:383-386` because both use
`matches!` allow-lists that swallow a new variant silently. Both answers are correct — a revoked
tenant flows neither the add-on grant nor the availability gate — and each now has an explicit test
so the answer is PINNED rather than inherited.

**The finding: `is_within_grace_period_at` short-circuited only on `"canceled"`.** A `revoked` row
therefore reported `is_within_grace_period() == true` for the whole offline window, which directly
contradicts §2.1's *"Never within grace, never downgraded"*. Grace exists to keep a paying-but-lapsed
merchant trading while they settle up; applying it to an abuse verdict would keep a banned register
operating for up to 60 days. Fixed, with `a_revoked_row_is_never_within_grace` as the regression
test. **This was not in the ADR's audit list** — it was found by asking what the new state's
documented properties actually require, rather than by reading the sites the record names.

**Why the session sweep sits where it does.** `create_session` refusing NEW sessions is not enough:
a ban that only gates the next login leaves the revoked tenant selling for up to the session TTL
(24 hours). The sweep therefore runs in `check_license_status` — the chokepoint where the server's
verdict actually arrives — and it runs AFTER the cache write, so a session created in the window
between the two reads fails closed on the cached verdict instead of slipping through.

**Verification run:** `cargo test -p kasirmu-core --lib` → **3143 passed, 0 failed**;
`cargo test -p kasirmu-bridge --lib` → **1345 passed, 0 failed**; the `ui` licence-settings suite →
**119 passed**.

> **Unreconciled 2026-09-22.** §2.4a.2 records the same two suites at **3112** (core) and **1360**
> (bridge), and the `ui` licence-settings suite at **52**, for a run in the same session. Neither
> pair is reproducible without re-running the suites, and two counts for one suite inside one record
> cannot both be current. Read both as "green at the time", not as today's count.

**Code-side residue left by this change, recorded rather than fixed (this was a doc-only pass).**
Two doc comments in `crates/kasirmu-core/src/subscription.rs` still describe the pre-split state:
`:1088`'s `Canceled` doc reads *"Canceled or revoked server-side"*, and the lifecycle-contract doc
at `:924` lists `loading/active/grace/expired/canceled/paused/unavailable` and omits `revoked`.
Both are comments, so neither affects behaviour — they are named here because a reader of that file
would otherwise learn the old model. Fixing them is a code change, and belongs to whoever next
touches that file. New tests: `create_session_denies_a_revoked_tenant`,
`create_session_allows_a_canceled_tenant` (the counterpart that stops the two states being
re-merged), `invalidate_all_sessions_drops_every_live_session`,
`a_revoked_row_is_never_within_grace`, `the_revoked_state_round_trips_its_wire_name`, and the two
audit cases above.

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

**IMPLEMENTED (2026-09-21) — see §4a Q-B.** The window gate ships as
`shouldPollLicense` and the pre-expiry re-authentication prompt in `ui/src/features/settings/LicenseSettings.tsx`
(with `usePreExpiryReauth` in `ui/src/contexts/SubscriptionContext.tsx`), and the ride-along that
makes the gate safe ships in `platform/sync/src/daemon_tick.rs`. Every arm of the rule below is
pinned by a test. The historical note follows, because it records what the tree looked like when
the decision was taken.

**Corrected 2026-10-04: there is no NEW heartbeat, but a background poll ships
today.** An earlier revision read *"There is no periodic heartbeat … the device makes no licence call
at all."* **That is false against the tree.** `ui/src/features/settings/LicenseSettings.tsx:69-75`
defines `POLL_INTERVAL_MS` and `:210-224` starts it with
`setInterval(pollTick, POLL_INTERVAL_MS)` once a payload is loaded; each tick (`:153`) calls
`checkLicenseStatus()`, whose bridge path is `crates/kasirmu-bridge/src/license.rs:497` →
`POST /api/v1/license/status`. **A licence call ships today, on a timer, whenever the Settings
screen is open.**

**Interval re-measured 2026-10-04 (audit pass 2).** This record's first revision read the constant
as `30_000` and reasoned from it. Commit `f5eccee27` (`fix(ui): poll the licence status every five
minutes instead of every thirty seconds`) changed it to `300_000` — **five minutes**, not thirty
*(hash corrected 2026-09-22: this read `f5eccee27`, whose subject is `test(license-server): assert
the status lane's own cap instead of the shared bucket` and which touches only `handler_test.go`)*
seconds. The *shape* of every argument below is unaffected, and one of them is materially
reinforced: the constant's own doc comment now gives the reason as *"the licence server meters a
shared credential lane (~5 requests/hour) and licence state simply does not change that fast, so a
30-second poll spent ~120 requests/hour to learn nothing."* That is §2.3's load argument and §4a
Q-B's option-B rationale, arrived at independently in code. Read `30_000`/`30s`/§2.3's load
sentences below accordingly: the figure is now five minutes, and the argument for gating the poll
to the window survives *because* the interval was reduced for the same reason.

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
| Licence calls from a healthy tenant | Every interval, forever | **None owed.** (One background poll already ships while the Settings screen is open — `LicenseSettings.tsx:75`, now 5 min after `f5eccee27` — and §4a Q-B decides its fate; this column is about the *obligation*, which is zero.) |
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

**The same call carries ADR #57's build fingerprint** (§Q5 there) — the licence server's
authenticated call, per the correction at §Q1 below. One scheduling change served both records in
practice: the field rides the call the ride-along already makes, so no new wire surface is added
twice.

### 2.4 Fail-open on transport, fail-closed on an explicit verdict

**IMPLEMENTED for transport — but by the UI, not by a guard, and only incidentally
(corrected 2026-10-04; see §1.3a; anchors re-measured 2026-10-04, audit pass 2).** The old citation
of a bridge cache-write warn pointed at a local-database write after a *successful* response; the
Rust path returns `Err` on transport failure (`crates/kasirmu-bridge/src/license.rs:530-532`).
What actually keeps a till open is `ui/src/features/settings/LicenseSettings.tsx:206-215` having no
lock branch. **Treatment as a pinned, tested rule is TO BUILD** — the distinction is behavioural
and must be tested, not merely inherited from an error handler's omission. *(Re-verified
2026-09-22: no such test exists — a search for a rejecting-HTTP-client fail-open test across
`crates/kasirmu-core/src/license_verification_tests.rs` and
`crates/kasirmu-bridge/src/license_tests.rs` returns nothing, so this marker is accurate rather
than stale.):*

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

> **Corrections (2026-10-04).** This section has been wrong twice, in opposite directions, and both
> errors are recorded rather than erased.
>
> 1. The original text asserted there is no `revoked` check in the renew path and that "the ban
>    would be undone by the act of paying". **Wrong** — `renew.go:82-87` refuses a non-active tenant
>    (§2.4a.1).
> 2. The repair pass then claimed two further defects (§2.4a.2, §2.4a.3). **One of those was also
>    wrong**: §2.4a.3 described the grant flip as a bug when it is documented, tested intent
>    (withdrawn there). §2.4a.2's *conclusion* survived but its *diagnosis* did not — the device path
>    is dead at both ends, not merely unread at one.
>
> **The lesson, recorded because it caused both errors:** a defect claim about *intent* needs the
> doc comment, the test, and the git history checked — not just the line. Checking only the line is
> how a working feature gets reported as a bug.

#### 2.4a.1 Renewal already refuses a non-active tenant — IMPLEMENTED

`apps/license-server/renew.go:82-87`:

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

#### 2.4a.2 Device revocation is dead at BOTH ends — corrected 2026-10-04

> **CORRECTED.** An earlier revision of this section said the server *"already emits the verdict"*
> and the client *"discards it"*, implying the fix was to add one field to `LicenseStatusResponse`.
> **That was wrong, and the error was mine.** The verdict is never *produced* either: the client
> sends no `machine_id`, so the server's device lookup never runs and `deviceRevoked` is
> **always false**. The path is dead at both ends, not one. The corrected finding is larger and is
> recorded below.

**What the admin action writes.** `handleAdminRevokeDevice` (`admin_tenant_lifecycle.go:229-257`,
route `main.go:362`) sets `tenant_machines.revoked_at` for one device. It does not touch
`tenants.status`.

> **The three "end" subsections below describe the state as found on 2026-10-04, before the fix.**
> They are the evidence for the decision, not a current description — the shipped implementation is
> recorded under **IMPLEMENTED 2026-10-04** at the end of this section. Read them in the past tense.
>
> **Their anchors are as-of 2026-10-04 too, and have since drifted** (the code they cite moved).
> Re-measured 2026-09-22: `status.go:94` → `:103`, `:95-104` → `:106-133`, `:88`/`:107` → `:91`/`:119`,
> `:151`/`:175` → `:179`/`:203`; `license_verification.rs:564-572` → `:601-627`, `:264-293` →
> `:276-302` (`device_revoked` at `:296`); `pb_schema.json:859` → `:873`; `main.go:362` → `:417`;
> `admin_tenant_lifecycle.go:225` → `:380`. The findings these anchors support are unchanged — only
> the line numbers moved.

**End one — the client never asked.** `check_license_status` (`license_verification.rs:564-572`)
POSTed with `.bearer_auth(api_key)` and **no request body**:

```rust
let resp = client
    .post(&url)
    .bearer_auth(api_key)
    .timeout(std::time::Duration::from_secs(15))
    .send()
```

**End two — the server therefore could not answer.** `status.go:94` populated its device fields
only from a decoded body:

```go
if err := json.NewDecoder(e.Request.Body).Decode(&statusReq); err == nil && statusReq.MachineID != "" {
```

With no body the decode errored, `MachineID` stayed empty, the `tenant_machines` lookup at
`:95-104` never ran, and `deviceRevoked` (`:88`, `:107`) remained `false` on every response.
`status.go` still *returned* `"device_revoked"` (`:151`, `:175`) — always `false`.

**End three — nothing could read it anyway.** `LicenseStatusResponse` (`license_verification.rs:264-293`)
had no `device_revoked` field, and no consumer of the value existed anywhere: a repo-wide search for
`device_revoked`/`deviceRevoked` returned **zero** matches in `crates/` and in
`apps/cloud-server/`. Serde would have dropped the key even if the server had set it.

**Net effect as found, traced through the gate this record specifies:**

1. Admin revokes a device → `tenant_machines.revoked_at` is set.
2. `tenants.status` stayed `"active"`; the client sent no `machine_id`.
3. `create_session` (`auth.rs:612-632`) read the *tenant* subscription, saw `active`.
4. **The session was granted. The app kept working.**

All four steps now behave as the design intended; step 3 gained the device gate at `auth.rs:644-659`.

**The intent is documented in three places, none of which the code honoured** (until this record's
fix landed — see the IMPLEMENTED block below). `pb_schema.json:859` describes
`tenant_machines.revoked_at` as *"When set, the machine has been revoked by the tenant admin and
**should not be allowed to activate**."* `status.go:83-87` calls the mechanism *"P8-2:
Machine-level revocation — checked and performed via the status endpoint."* And the revoke route is
registered and admin-authenticated (`main.go:362`). **It was a capability designed, built at both
endpoints, and never joined up.**

**Decision: the fix is a three-part protocol completion, not a field addition.** Recorded as a
decision with options because the smallest patch would leave the path half-dead again:

| Option | What it takes | Trade-off |
|---|---|---|
| **A. Complete the protocol** (recommended) | (1) `check_license_status` sends `{"machine_id": …}`; (2) `LicenseStatusResponse` gains `device_revoked: bool` (default false); (3) `create_session` refuses when the cached verdict is set | Three coupled changes, and (1) means the client now depends on `MACHINE_ID` being resolvable before the call |
| **B. Delete the dead path** | Remove `status.go:83-119`, the `device_revoked` response keys, the `tenant_machines.revoked_at` field and the revoke route | Honest and smaller, but removes an admin capability the schema documents; a stolen tablet could then only be stopped by revoking the whole tenant |
| **C. Leave it dead and document it** | No code change; record the capability as non-functional | Cheapest, but ships a route that appears to work and silently does nothing — the exact failure §1.4 describes |

**Recommendation: A.** Option B removes a real capability (the per-device blast radius §4 Q2
deliberately chose over tenant-wide), and option C preserves a lie in the admin surface. A is the
only option that makes the documented behaviour true.

**Why per-device and not "revoking a device sets the tenant's status":** the admin action is
labelled *revoke this device* (`admin_tenant_lifecycle.go:225`), and its blast radius should match
its label. Flipping `tenants.status` would make a stolen-tablet action end an entire multi-terminal
business — the asymmetry §4 Q2 resolves in favour of the smaller radius.

**Enforcement point:** `create_session` beside the existing entitlement gate. It **already
receives `args.terminal_id`** (`auth.rs:636`), so the gate itself needs no new plumbing:

```
create_session → load subscription → verify_signature()   [existing :619]
              → cached device verdict set?  → refuse      [new]
              → check Revoked (§2.1)                     [new]
              → check allows_workspace_type()            [existing :622]
```

**Where the verdict is cached is §4a Q-D's decision** — it rules for a local cache beside
`tenant_subscription` rather than a network call inside `create_session`, which §2.7 forbids from
being able to brick a register.

#### IMPLEMENTED 2026-10-04 — option A shipped

All three points of the protocol are now wired, and each was verified by running the tests, not by
inspection:

| # | Change | Evidence |
|---|---|---|
| 1 | `check_license_status` sends `{"machine_id": …}` | `crates/kasirmu-core/src/license_verification.rs` — signature gained `machine_id: &str`, body added to the POST. `machine_id` was **already resolved** by the bridge wrapper for API-key decryption (`license.rs:496-501`), so no new plumbing was needed |
| 2 | `LicenseStatusResponse` + `ServerLicenseStatusDto` carry `device_revoked` | `#[serde(default)]` on the core type, so a server predating the field parses as `false` — additive, never a new lockout |
| 3 | `create_session` refuses on the cached verdict | `crates/kasirmu-bridge/src/auth.rs`, beside the entitlement gate |

**Cache key: `device.revoked` (`keys::DEVICE_REVOKED`), deliberately not `license.*`.** The
credential-family gate (`settings_tests.rs` `is_credential_family`, marker `"LICENSE_"`) classifies
any such name as a secret and demands it be denied on the export surface. Both halves of that are
wrong here — it is a boolean, not a credential, and denying it from export buys nothing because it
is re-derived from the server on the next status check. The name was chosen to avoid a false
classification rather than to satisfy it.

**Fail-open, and tested as such.** An absent or unparseable value reads as *not revoked*. Two
regression tests pin both directions:
`create_session_denies_a_revoked_device` and `create_session_allows_a_device_when_the_verdict_is_absent`.

**Verification run:** `cargo test -p kasirmu-bridge --lib` → **1360 passed, 0 failed**;
`cargo test -p kasirmu-core --lib` → **3112 passed, 0 failed**;
`go test ./...` in `apps/license-server` → **ok (161s)**, including the pre-existing
`TestStatusHandler_RevokeMachine` (`handler_test.go:4381`) that the server half already had;
`npm run typecheck` and the `LicenseSettings` suite (52 tests) in `ui/`.

**What shipped with it:** §4a Q-C option B, the clearing path. The device check is *enforcing*, so
shipping it alone would have left an active tenant with locked tills; both landed in one change
(`clearTenantDeviceRevocations` + `TestAdminGrantSubscription_ClearsDeviceRevocations`). Q-C's
option A (a per-device un-revoke endpoint) remains unbuilt and covers the case this path cannot:
a tenant that is already active with one revoked device.

**Also required:** a live session on a revoked device must be invalidated, not merely refused on
next login. The session store is in-memory (`auth.rs:225-272`) and already prunes expired entries.

**Related, and separately enforced:** the *tenant*-level revoke route (`main.go:357`,
`handleAdminRevoke` at `admin_dashboard.go:347`) does set `tenants.status = "revoked"`
(`admin_dashboard.go:356`), and renewal already refuses a non-active tenant (§2.4a.1). What is
missing there is the session-side lock, which §2.1 supplies. So the two revoke scopes fail
differently: tenant-level is enforced at renewal but not at session creation; device-level is
enforced nowhere.

#### 2.4a.3 The grant flip re-activates a revoked tenant — DELIBERATE, not a defect

> **WITHDRAWN 2026-10-04.** An earlier revision of this section called the grant flip a defect
> ("a manual grant silently un-revokes") and proposed guarding it so only `suspended` was cleared.
> **That recommendation was wrong and must not be implemented.** Verification against the tree found
> the flip is **documented intent with a test that asserts it**; the proposed guard would have
> **broken a passing test** to fix behaviour that is working as designed. The section is retained,
> inverted, because the next reader will otherwise re-derive the same wrong conclusion.

**What the code actually says.** `handleAdminGrantSubscription` (`admin_tenant_lifecycle.go:276`)
carries this doc comment (`:271-275`):

> creates a fully signed subscription record … Refuses to stack on an active subscription (use
> renew/tier-override instead) **and re-activates a revoked/suspended tenant.**

and the flip itself is commented (`:382`): *"A tenant that just paid must not stay
revoked/suspended."*

**What the tests assert.** `admin_lifecycle_test.go:327` seeds a tenant with status **`"revoked"`**,
grants a subscription, and `:363-367` asserts:

```go
// Revoked tenant flipped to active.
if updated.GetString("status") != "active" {
    t.Errorf("tenant status = %q, want active after grant", updated.GetString("status"))
}
```

**What the history says.** `git log -L` over both the comment and the flip resolves to a single
commit — `0f6881663 feat(licensing): tenant lifecycle admin endpoints` — so the comment and the
behaviour were written together. This is not drift between a doc and code.

**Why the "silent un-revoke" scenario does not hold.** The earlier text argued that "an operator
issues a goodwill credit … and a previously revoked tenant silently becomes active again". But a
`grant-subscription` call is an **explicit admin action against one tenant, requiring a mandatory
`reason`** (`admin_tenant_lifecycle.go:292-294` rejects an empty one). The operator issuing it is
the same actor who can revoke — so there is no privilege escalation and no accidental path. The
"silently" framing was the error: the action is deliberate, authenticated, and audited by reason.

**The residual that IS real, stated narrowly.** The flip is **unconditional**, so it clears
`revoked` and `suspended` alike, and the log line (`:389-390`) records the grant and its reason
but does not say *"this also lifted a revocation"*. An incident review reconstructing "why is this
tenant active again" therefore has the reason but not the classification. That is an **audit
clarity** gap, not an enforcement hole.

| Option | Pros | Cons |
|---|---|---|
| **A. Leave as-is** (chosen) | Behaviour is intended, documented and tested; no code change; no test broken | The audit log does not distinguish "granted" from "granted, and a ban was lifted" |
| **B. A `revocation_reason` field for audit only** | Answers "why was this tenant revoked?" independently of the grant log | A field and a write path for a question the mandatory `reason` already answers |
| **C. Guard the flip so only `suspended` clears** | — | **Rejected: breaks `admin_lifecycle_test.go:363-367` and contradicts the handler's own doc comment. This is the withdrawn recommendation.** |

**Decision: A — no change.** The withdrawn option C is recorded so it is not re-proposed. If the
audit-clarity gap is judged worth closing, B is the additive form, and it must be introduced as a
*new* field on the revoke path (`handleAdminRevokeDevice`) rather than as a guard on the grant
path, so the existing behaviour and its test are untouched.

**Lesson carried into this record's other sections:** a defect claim about *intent* needs the doc
comment, the test and the history checked, not just the line. §2.4a.2 below was re-verified the same
way, and its conclusion changed as a result.

#### 2.4a.4 What remains true from the original text

**Fail-open does not apply to a revocation refusal.** §2.4's fail-open rule covers *transport
failure*; a server that answers "your account is not active" has answered. That is an explicit
verdict, and the client treats it exactly as `revoked`: lock.

**The renew path must evaluate revocation before any integrity verdict**, consistent with the
precedence order in ADR #57 §2.5. With 2.4a.1 already in place, the ordering is satisfied by the
existing guard and needs no change.

### 2.5 "Locked" means: no session, therefore no app

**The session-lock half IMPLEMENTED 2026-10-05; the §2.3 window arm is NOT built.** §2.5's own
pseudocode below marks the window arm `[new]`, and that marker is accurate: the window ships as a UI
poll gate (`ui/src/features/settings/LicenseSettings.tsx:109`), not as a session-creation
obligation, and there is no Rust-side window gate. Enforcement of the `Revoked` state is at
`create_session` (`crates/kasirmu-bridge/src/auth.rs:645`), beside the existing entitlement check:

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
  (`auth.rs:225-272`) and already prunes expired entries; revocation invalidation is a small
  extension of that path, so a ban lands without waiting for a TTL.
- **Every session-gated command becomes unreachable, export included** — `export_data`
  (`data.rs:374-375`) and its scoped twins resolve a session and require `SETTINGS_EDIT` like any
  other. §2.6's export promise is therefore satisfied only by the read-only local twin §4a Q-A
  option 3 adds; it is **not** satisfied by the existing command.

#### IMPLEMENTED 2026-10-05 — all three consequences hold

| Consequence | Status |
|---|---|
| New sessions refused | `create_session` returns `Invalid` on a `Revoked` subscription, tested by `create_session_denies_a_revoked_tenant` |
| Live sessions invalidated | `invalidate_all_sessions` sweeps the store from `check_license_status`; tested by `invalidate_all_sessions_drops_every_live_session` |
| Every session-gated command becomes unreachable, export included | True, and it is WHY the twin exists — `export_data_without_session` is the only export that survives this section (see §4a Q-A above) |

**The two arms are one chokepoint, not two.** A revoked TENANT and a revoked DEVICE both deny at
`create_session`, and both now sweep live sessions from the same command. They stay separate
checks because their blast radius differs and §2.4a.2 chose the smaller one deliberately: revoking
one tablet must not end a multi-terminal business.

**What this section does NOT do, and §2.7 is why:** it does not stop the app launching, opening its
database, or reading local data. Enforcement is at session creation. A false-positive revocation is
therefore recoverable and diagnosable rather than destructive, which is the constraint §2.7 states.

### 2.6 Locked tenants retain view and export

**Decision (delegated, per the prior round).** A revoked tenant keeps **read-only viewing and data
export**, and loses **all selling, mutation and sync**.

| Capability | Revoked |
|---|---|
| View existing sales / inventory / reports | **Yes** |
| Export data | **Yes in principle — but NOT reachable today.** §4a Q-A option 3 shipped as the command `export_data_without_session`, and nothing in `ui/` calls it (see the corrected note at §4a Q-A), so the existing command is session-gated and the twin is unreachable: the promise holds on paper only |
| Sign out | **Yes** |
| New sales, refunds, stock movements | **No** |
| Sync / cloud writes | **No** |
| New sessions | **No** |

**Rationale:** the merchant business data is the merchant data, including when we have banned
them. Withholding it creates a dispute, a support escalation, and in some jurisdictions a legal
exposure — while providing no protection, since the data is already on their disk and readable by
anyone with the device. Refusing *new sessions* while permitting export is the balance: selling
stops immediately, data remains retrievable.

This mirrors the intent already recorded for `Expired` at `subscription.rs:1008-1021` — *"viewing,
data export, and sign-out remain available"* — and extends it to `Revoked` rather than replacing
it.

**The promise above was unreachable as written — corrected 2026-10-04; the path is now decided at
§4a Q-A.** An earlier revision simply granted export alongside §2.5's refusal of new sessions. But
export is **session-gated at the bridge**, so "no sessions" and "export works" cannot both hold:

- `crates/kasirmu-bridge/src/data.rs:374-375` — `export_data` calls
  `ctx.resolve_session(session_token)?` then `require_session_permission(&session, SETTINGS_EDIT)`.
- The scoped and alternate twins are the same: `data.rs:572` (`import_preview`),
  `data.rs:601` (`import_data`), `:839`, `:854`, `:878`. *(Anchors re-measured 2026-09-22; they read
  `:529-530`, `:558-559`, `:796-797`, `:811-812`, `:835-836` before the `_direct` refactor.)*

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
  (§2.3, `license_verification.rs:692`). Add the one server-side gap §2.4a.2 identifies — the
  `device_revoked` protocol completed at all three points (client sends `machine_id`, response
  carries the flag, `create_session` honours it) — plus the §2.6 export path §4a Q-A decides, and
  §2.7's constraint on all of them. **§2.4a.3 adds nothing**: its recommended guard was withdrawn
  as wrong, and the grant flip stays as designed.
  An earlier revision said *"one enum variant, one timestamp"*: the timestamp was a leftover from
  the superseded fixed-heartbeat design, which §2.3 replaced. A later revision described §2.4a.3 as
  adding a `revocation_reason` field; the schema already separates `suspended` from `revoked`
  (`pb_schema.json:398-400`), so no field is needed and it is demoted to an optional audit
  improvement rather than part of the change. **Corrected 2026-09-22:** that sentence went on to say
  "the fix is a guard", which contradicts §2.4a.3's own decision. §2.4a.3 decided **A — no change**;
  the guard was withdrawn because it breaks `admin_lifecycle_test.go:363-367`, so no guard ships
  either.
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
- **The device-revocation gap is CLOSED — corrected 2026-09-22.** This bullet read *"device
  revocation is dead at both ends … the admin 'revoke device' action changes nothing on the
  device"*, which was the state as found on 2026-10-04, before §2.4a.2's fix. It shipped the same
  day: the client sends `machine_id` (`crates/kasirmu-core/src/license_verification.rs:617`), the
  response carries `device_revoked` (`:296`), and `create_session` refuses on the cached verdict
  (`crates/kasirmu-bridge/src/auth.rs:668`), pinned by `create_session_denies_a_revoked_device`
  (`auth_tests.rs:413`). Renewal refusal works (§2.4a.1) and the grant flip is **not** a defect
  (§2.4a.3, withdrawn). **What remains open is only §4a Q-C's option A** — a tenant that is already
  active with one revoked device cannot be un-revoked per device.
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
server-side detection."* **That bound does not exist:** ADR #57 §Q3 defers §2.4's detection until
the fingerprint field ships **and a violation notification exists** (gate (a) rewritten 2026-09-21
from "a named queue owner" — the reader already exists in code, so naming one changed nothing).
Citing it made an unbounded hole read as a managed one.

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
> the bridge's cache-write `warn`), §2.1 (the compiler does not flag `entitlements.rs`/`availability.rs`), §2.3
> (a background poll ships today; the `NULL` expiry arm; the clock-rollback reasoning), §2.4 (the
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

> **Correction (2026-09-21) — the `sync/status envelope` named above is the wrong carrier for the
> REVOCATION half, and the revocation half is now BUILT.**
>
> Reading the candidate carrier in the tree showed it cannot hold a licence verdict:
>
> - The sync snapshot is built and cached by the **cloud server**
>   (`apps/cloud-server/src/sync_api.rs`): the JSON is serialised once and served from a
>   Redis-backed cache keyed by an ETag version. A verdict placed there would be served **stale for
>   the cache's whole lifetime**, or would have to bust the ETag on every heartbeat — turning a bulk
>   data cache into a per-request recompute.
> - The cloud server holds **no licence-VERDICT knowledge**, which is the claim this argument
>   needs. It *does* own plan rows and plan gating — the `tenant_plans` table and
>   `OZ_ENFORCE_PLANS` (`apps/cloud-server/src/config.rs:71,189`) — so "no licence knowledge at all"
>   overstated it. What it cannot do is **author a revocation verdict**, because the signed
>   subscription and every licence verdict are minted by the licence server. *(Corrected
>   2026-09-22.)*
>
> No new field is needed anywhere. `LicenseStatusResponse`
> (`crates/kasirmu-core/src/license_verification.rs`) **already carries** `status`,
> `device_revoked`, `expires_at` and `grace_until`, and the licence server already authors them.
> The only thing missing was **when** the call fires.
>
> **What shipped, therefore, was not a wire change but a scheduling change.** The sole caller of
> `check_license_status` was the Settings screen's poll — `LicenseSettings.tsx` arms a timer on
> mount and tears it down on unmount — so a device whose Settings screen was never opened never
> learned it had been revoked. The call now also runs from the background sync daemon
> (`platform/sync/src/daemon_tick.rs` `run_license_ride_along`, phase 5), which ticks every
> 60–120s for every configured terminal regardless of UI. The three local effects of a verdict were
> extracted into one core function, `apply_license_verdict_to_cache`, so this path and the
> screen-driven path cannot drift apart; the write-then-sweep ordering §2.5 depends on is that
> function's contract.
>
> The residual this leaves is narrower than §3.3's and stated there: a device that is powered off,
> or running no daemon, is still unreachable — unchanged by this work.

**The residual, stated:** a device that is offline and outside its window still cannot be reached,
so its ban latency remains expiry-bound. Option B narrows the exposure to offline devices rather
than eliminating it. §3.3 carries this as a bounded residual, and it is the correct trade against
locking tills on unreachable servers.

### Q2 — Is revoking a single-device or whole-tenant act? `[was policy]` — DECIDED

`handleAdminRevokeDevice` (`admin_tenant_lifecycle.go:384`) revokes **one device**
(`tenant_machines.revoked_at`). A tenant with five terminals of which one is fraudulent would
need the other four left alone — or the whole account suspended.

| Option | Pros | Cons |
|---|---|---|
| **A. Per-device** (what exists) | Precise; a stolen tablet does not end the account | A fraudster on a second device is unaffected |
| **B. Per-tenant** — lock every terminal | Complete for account-level abuse | Destroys an innocent multi-terminal business for one bad device |
| **C. Both**, chosen at ban time | Matches intent to severity | Slightly more admin surface and a confirm step |

**Decision: C — both scopes, chosen explicitly at ban time, defaulting to per-device.**

The existing endpoint is already per-device (`handleAdminRevokeDevice`,
`admin_tenant_lifecycle.go:384`, writing `tenant_machines.revoked_at`), so C is additive: the
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

**Status, re-audited 2026-09-22: both scopes exist, by a different MECHANISM than this section
describes.** Per-device is `POST /api/v1/admin/tenants/{id}/devices/{deviceId}/revoke`
(`apps/license-server/main.go:417` → `handleAdminRevokeDevice`, `admin_tenant_lifecycle.go:384`).
Tenant-wide is `POST /api/v1/admin/tenants/{id}/revoke` (`main.go:412` → `handleAdminRevoke`,
`admin_dashboard.go:347`), and it sets `tenants.status = "revoked"` rather than revoking every
`tenant_machines` row as the paragraph above states — which now locks every session anyway, via
§2.1. The admin UI offers both (`website/public/admin/admin.js:583-590` per device, `:612-614`
tenant-wide behind a confirm). So C's intent holds and no new endpoint is owed; what the text gets
wrong is the mechanism, and the missing `audit_log` scope/actor binding is still owed.

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

#### IMPLEMENTED 2026-10-05, CORRECTED 2026-09-22 — the twin exists, but its half is not finished

`export_data_without_session` exists and is registered — and **§2.5's enforcement also shipped**,
so this block's original claim (*"§2.5 remains unbuilt… no merchant is locked out of anything
today"*) was false when it was written. §2.5 is enforced at `crates/kasirmu-bridge/src/auth.rs:645`
(the `Revoked` arm), with `invalidate_all_sessions` (`:883`) sweeping live sessions.

**That makes the sequencing gap real rather than avoided, and it is OPEN:**

> **The twin is a Tauri command with no UI caller, so §2.6's promise is not reachable in the
> product.** Nothing in `ui/` invokes it — a grep for
> `export_data_without_session`/`exportDataWithoutSession`/`without_session` under `ui/` returns
> zero hits, and the export wizard still calls the gated path
> (`ui/src/features/settings/hooks/useExportWizard.ts:104` → `ui/src/api/data.ts:283`). The tablet
> registers only the gated command (`apps/mobile-tauri/src/lib.rs:585`). So with §2.5 locking
> sessions, **no export is reachable by any user** — precisely the state the table above labels
> "Wrong order" and this section calls the one thing that can produce a merchant-visible incident.

**Commit order did honour the constraint; order alone was not the requirement.** The twin landed
before §2.5's enforcement, but the constraint exists so that a revoked merchant can still retrieve
their data, and a registered command nobody can call does not do that. **Discharging it means:**
giving the ungated read-only export a surface that exists **while sessions are refused** (the lock
or activation screen — a product decision, not yet taken), and registering the command on the
tablet, which currently exposes only the gated one. Until then §2.6's "Export data: Yes" row is a
capability with no code path — the defect this section was written to catch, one layer further out.

| # | What | Where |
|---|---|---|
| 1 | The ungated twin, sharing one body with the gated command | `kasirmu_bridge::data::export_data_without_session` beside `export_data`, both delegating to a private `export_data_direct` |
| 2 | The IPC command | `commands::data::export_data_without_session`, registered in the desktop handler list |
| 3 | The ledger row | `("data::export_data_without_session", "no_session_resolution")`, regenerated rather than hand-added |

**The precedent is followed rather than re-invented.** `create_backup` already ships as an
unauthenticated twin beside its gated sibling, sharing a `_direct` body and emitting a warning that
the permission was not checked. This command copies that shape exactly, including the `warn!` event
(`export_ungated_no_session`), so an operator reading the logs sees the same signal the backup path
has always produced.

**What makes it safe is asserted, not assumed.** Two tests pin the READ-ONLY half of the ADR's
binding: one drives the twin with NO token and requires a readable package, and one asserts the
module contains no `import_data_without_session` / `import_preview_without_session`. A refactor that
routed an import through the ungated body would turn a data-hostage remedy into a write primitive,
so the absence is pinned rather than commented.

**Verification run:** `cargo test -p kasirmu-bridge --lib` → **1344 passed, 0 failed**;
the desktop registration ratchet → **14/14**
(`apps/desktop-tauri/src/commands/registration_gate_tests.rs`; re-counted 2026-09-22 — 14 `#[test]`
functions, so the figure is a named test file's count, not a repo-wide debt total).

### Q-B — Does the background Settings poll survive §2.3, and who gates it? `[blocking]` — DECIDED

**The conflict this closes:** §2.3 asserts no licence call is made outside the window, but
`LicenseSettings.tsx:69-75` defines `POLL_INTERVAL_MS` (5 min since `f5eccee27`; it read `30_000`
when this question was first written) and `:210-224` runs it while the Settings screen is open,
calling `checkLicenseStatus()` (`:153`) each tick. The two cannot both stand as written. **The
poll is also the only path by which a CONNECTED device learns it is revoked today** — §2.3 option C
rebuilds that, so removing the poll before C ships would *remove* the only working revocation
signal.

| Option | What changes | Trade-off |
|---|---|---|
| **A. Keep the poll; re-describe §2.3 as "no NEW heartbeat"** | §2.3 text is corrected (done above); nothing in the UI changes. | **Zero code, zero risk**, and it preserves the only live revocation signal. But it keeps fleet-scale load that scales with *screens left open* rather than tenant lifecycle, which is the exact cost §2.3 argues against — and it leaves the poll's fate undocumented in code. |
| **B. Gate the poll to the 3-day window** (recommended) | The interval runs only when `now_ledger >= expires_at - 3 days`; outside it, the initial load stands and no timer is armed. | **Matches the rule exactly** — load then scales with tenants near renewal, as §2.3 claims. Cost: it is a real UI change, it must read `expires_at` from the payload already in scope (`LicenseSettings.tsx:138`), and **it must not ship before §2.3 option C** or a connected device loses its only revocation signal in the window's absence. Note the interval was already *reduced* to 5 min in `f5eccee27` for the same load reason; B is the structural version of that fix, not a reversal of it. |
| **C. Remove the poll entirely** | Delete `POLL_INTERVAL_MS` and the effect. | Simplest code, and cheapest server. But it **deletes the only current revocation-notice path for connected devices** and must not be done until §2.3 option C's "ride any authenticated call" lands — otherwise a ban stops reaching any device until its window opens, silently widening §3.3's first residual. |

**Decision: B — gate the poll to the 3-day window.**

**Who removes it — the answer to the question asked:** the **licensing UI area
(`ui/src/features/settings/`)** owns it, in the same change that corrects §2.3, and the change is
**sequenced after §2.3 option C's envelope work** so no interval of time exists in which a
connected device has neither the poll nor the ride-along status. Option A is the safe interim:
until B ships, the corrected §2.3 text above already scopes the claim to *"no new call is owed"*,
which is true of the poll as it stands.

> **IMPLEMENTED (2026-09-21).** Both halves of the sequencing are now satisfied, and in the order
> this section requires:
>
> 1. **The ride-along landed first** (`platform/sync/src/daemon_tick.rs`
>    `run_license_ride_along`), so a connected device learns its verdict from the daemon's
>    60–120s tick with no screen open. See the §Q1 correction note for why this is a scheduling
>    change rather than a new envelope field.
> 2. **Then the poll was gated.** `ui/src/features/settings/LicenseSettings.tsx` now calls
>    `shouldPollLicense(payload, Date.now())` before arming the interval and returns early when it
>    is `false`, so no timer exists outside the window. The rule is §2.3's, arm for arm: free tier
>    → never; absent/unparseable `expires_at` → never (§2.3's `NULL` arm, failing open rather
>    than manufacturing an obligation); outside the last 3 days → never; inside → poll.
>
> **The test that used to prove the opposite was inverted, not deleted.** The Settings fixtures
> defaulted to a far-future `expires_at`, which is now *outside* the window and therefore arms no
> timer at all; two polling tests failed on the change, correctly. The fixture now defaults to
> in-window (expires in ~1 day) so the existing poll tests still exercise the poll, and seven new
> tests pin each arm of the gate — including one asserting `setInterval` is **not** called and
> `checkLicenseStatus` is **not** invoked for a licence 90 days out.
>
> 3. **Merchant-facing pre-expiry prompt.** `ui/src/features/settings/LicenseSettings.tsx` renders a
>    prominent warning banner (`.settings-license-reauth-banner`) when a paid tenant is inside the
>    3-day pre-expiry window, informing the merchant that online re-authentication is required with a
>    one-click "Verify Online Now" manual refresh trigger. A shared hook `usePreExpiryReauth()` in
>    `ui/src/contexts/SubscriptionContext.tsx` exposes the window status and days remaining for UI gates.

### Q-C — Does an existing `revoked_at` on a DEVICE outlive a tenant un-revoke? `[deferrable]` — DECIDED

**The gap — re-scoped 2026-10-04, because §2.4a.3's premise changed.** The original text said
§2.4a.3 "un-revokes at the tenant level". §2.4a.3 has since been **withdrawn as wrong**: the grant
flip is deliberate behaviour, not a defect. That does not remove this question — it sharpens it,
because the flip is now the *only* tenant-level un-revoke path, and it is the one an operator will
actually use.

**The gap, restated — as it stood when this question was written:** if §2.4a.2's per-device check
ships, `tenant_machines.revoked_at` becomes enforcing for the first time — and **nothing cleared
that row.** The grant flip (`admin_tenant_lifecycle.go:580-597`) set `tenants.status = "active"`
and did not touch `tenant_machines`. So the ordinary un-revoke path — *a tenant pays, an admin
grants* — left every device still revoked at step §2.4a.2: **the tenant is active but its tills
refuse sessions.** A ban that outlives its own reversal, produced by the record's own recommended
flow. (The past tense is deliberate: option B below has since shipped — see the IMPLEMENTED note
that follows.)

**This is the interaction §2.4a.2's fix creates**, and it is the reason the two cannot be shipped
independently: adding the device check without a clearing path converts a working un-revoke into a
half-locked account.

**IMPLEMENTED 2026-10-04 — option B shipped with the device check, not after it.** §2.4a.2's
per-device verdict is now *enforced*, so a clearing path is not optional: without one, "the tenant
paid" would leave an active account whose tills refuse sessions. Both halves landed together.

**The implementation:** `clearTenantDeviceRevocations` (`admin_tenant_lifecycle.go`), called from
the grant flip at the moment it re-activates a tenant. It clears `revoked_at` on every
`tenant_machines` row for that tenant, **selectively** — rows without a timestamp are skipped, so
the clear never writes a field it did not own — and best-effort per row, so one failing save cannot
leave the rest revoked. A partial failure is logged with its count.

**Tested:** `TestAdminGrantSubscription_ClearsDeviceRevocations` seeds one revoked device and one
untouched device, grants a subscription, and asserts the revoked row is cleared **and** the
untouched row is not disturbed.

**Residual, and it is option A's job.** The clear runs only on the re-activation branch, so a tenant
that is **already active** with a revoked device cannot use this path — `grant-subscription` refuses
to stack on an active subscription (`admin_tenant_lifecycle.go:517-519`). Clearing that case needs the
per-device un-revoke endpoint (option A), which remains additive and unbuilt. Recorded here so the
limit is known rather than discovered.

| Option | How it works | Trade-off |
|---|---|---|
| **A. A matching per-device un-revoke endpoint** | Admin clears one `tenant_machines.revoked_at`. | **Symmetric and precise** — mirrors `handleAdminRevokeDevice` exactly, so the two device actions pair. Cost: the un-revoke of a tenant then does not un-revoke its devices, so an operator must issue N calls and can miss one, leaving the tenant half-locked with no signal that anything is wrong. |
| **B. Tenant un-revoke clears all device rows** (recommended) | The grant flip (`admin_tenant_lifecycle.go:580-597`) also clears `revoked_at` on every `tenant_machines` row for the tenant (`clearTenantDeviceRevocations` `:424`). | **Matches operator intent** — "un-revoke this tenant" plainly means the whole account, and it cannot leave a half-locked tenant. Cost: it broadens a per-device action's reach, so a *deliberately* device-revoked tablet (a stolen one) is un-revoked with the tenant unless option A also exists to re-flag it. |
| **C. State that device revocation is permanent** | No clearing path; a revoked device stays revoked. | **Simplest** — no new code, no ambiguity. But it makes a false-positive device revocation **unrecoverable in the field**, which contradicts §2.6's own concession (a mistaken ban must be reconstructable and correctable) and is not a policy a support desk can operate. |

**Decision: B — tenant un-revoke clears all device rows, with A offered later.**

B closes the half-locked hole now, at the one place that already exists, and A is **strictly
additive** when it is wanted (re-revoking a stolen tablet after an un-revoke is a single call with
the endpoint §2.4a.2 already requires). C is rejected outright: a permanent, field-unrecoverable
device ban is a worse failure than the abuse it deters.

**Audit binding, consistent with Q2:** the clearing path writes actor, reason and the
**count of device rows cleared** to `audit_log`. A tenant un-revoke that silently released five
revoked terminals is exactly the class of change that must be reconstructable.

### Q-D — Which region server answers the §2.4a.2 device check once ADR #59 lands? `[deferrable]` — DECIDED

**The gap:** once ADR #59 makes tenant identity `(home_region, tenant_id)`
(`docs/decisions/2026-10-04-adr59-regional-topology-and-modular-delivery.md:113`, restated at `:195`), the §2.4a.2 check —
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

> last audited 22-09-26 by docs-auditor
