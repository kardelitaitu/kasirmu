# todo-tablet-provisioned-workspaces-invisible-to-picker

> Two independent defects found on one freshly provisioned tablet. Either alone makes an
> offline install unusable; together they are a dead end. They are reported here together
> because one test pass produced both, not because one causes the other.
>
> 1. **Provisioned workspaces are invisible** — provisioning writes the global DB, the picker
>    reads a per-store DB. (A new instance of the known P0-4 split-brain.)
> 2. **Every tool locks, permanently — on ANY tablet install, not just `local`.** The
>    capabilities read requires a `tenant_subscription` row, and **no tablet code path can
>    write one**: provisioning writes none, `activate_license` is desktop-only and shell-guarded
>    off, the status poll only UPDATEs, sync does not carry the table, and the one INSERT path
>    (`store_subscription`) is reachable only after an activation the tablet cannot perform.
>    The gate itself works as designed and is pinned by a test; the gap is that nothing gives
>    the tablet a row. Round 4 scoped this to `local` mode; round 5 widened it to every install
>    and added the circular dependency that makes `linked` mode unreachable too — see §"No
>    tablet path can write the row".

<!-- Audit stamp: 2026-10-03 · DSH · status: MEASURED ON DEVICE (root cause proven, not yet repaired)
     Reproduced on Redmi 23073RPBFG (Android 15) with a debug build of `0.0.41` (mu.kasir.mobile),
     installed 2026-10-03 06:53, exercised over CDP. Every figure below was read off the device
     or its pulled SQLite files during this pass; nothing is inferred from source alone. -->

**Symptom.** A freshly provisioned tablet that chose **"Offline only"** on the setup wizard
lands on a home screen showing the EMPTY workspace picker — a single "Add Workspace" card —
even though provisioning created four active workspaces. The workspace grid therefore never
renders its populated branch, and the owner has no way into the app they just set up.

## What was measured

Provisioning reported success (the wizard advanced to the staff login screen), the owner could
log in, and `list_workspaces` returned `200`/ok at the IPC layer. Everything *looked* healthy.
The device DB says otherwise:

| Fact | Value | Source |
|---|---|---|
| `users` | 1 (`budi`, `role-owner`) | `kasir.db` |
| `provisioning` | 1 row, `mode='local'` | `kasir.db` |
| `workspace_instances` | **4, all `status='active'`** | `kasir.db` |
| their `location_id` | `loc-000000000000000018dadc902eb343820000` | `kasir.db` |
| `locations` | 1 (`Warung Uji`, `is_primary=1`) | `kasir.db` |

The four instances are `restaurant-pos`, `kds`, `warehouse`, `admin`. Running the picker's own
owner-bypass SQL against `kasir.db` returns all four:

```
SELECT wi.id, wi.type_key ... FROM workspace_instances wi
  JOIN workspace_types wt ON wi.type_key = wt.key
 WHERE wi.location_id = ?1 AND wi.status = 'active'   -- ?1 = 'loc-0000…820000'
--> 4 rows
```

## Root cause — the picker reads a DIFFERENT database than provisioning wrote

`provision_device` writes the location, the four workspaces, the owner and the roles **into the
global database** (`kasir.db`) — `crates/kasirmu-bridge/src/setup.rs:370` takes `ctx.lock_global()`
and hands that connection to `kasirmu_core::db::provisioning::provision_device`. It never opens a
store database.

`list_workspaces` reads them from a **per-store database** —
`crates/kasirmu-bridge/src/workspaces.rs:150` calls `ctx.db_manager.open_store(&store_id)`, and
`StoreDatabaseManager::open_store` (`platform/core/src/database/manager.rs:73`) treats `store_id`
as a **filename stem**, building `store-<store_id>.sqlite`.

`store_id` is resolved by `resolve_boot_store`, which returns the **primary location id** —
`loc-000000000000000018dadc902eb343820000` (confirmed by invoking the command on the device; it
returned exactly that string). `open_store` therefore looks for

```
store-loc-000000000000000018dadc902eb343820000.sqlite
```

which **did not exist**, so `open_store` **created it empty** and applied migrations. The picker
then queried an empty database and correctly reported zero workspaces. The device file listing
after the failed picker load shows the artefact of that creation:

```
store-default.sqlite                                  4096 B   (also empty)
store-default.sqlite-wal                           4062352 B
store-loc-000000000000000018dadc902eb343820000.sqlite   4096 B   <-- created by the read
store-loc-000000000000000018dadc902eb343820000.sqlite-wal 4062352 B
```

So the id is used as a **location id** on the write side and as a **database name** on the read
side, and the two never meet. The mismatch is silent in both directions: the write succeeds, the
read succeeds, and only the row count is wrong.

## Why this is a NEW INSTANCE of a KNOWN defect

`.agents/planning/review-backlog-codebase-review.md:54` already names the structural cause:

> **P0-4 … Two-database split-brain: The tablet writes sales to the global file and nearly
> everything about those sales to per-store files.**

This report adds a sixth symptom to that family, and the first one observed on hardware: the
tablet **provisions into the global file** and **reads the picker from a per-store file**.

ADR-56 anticipated that workspaces live in the store database —
`docs/decisions/2026-09-21-adr56-first-run-provisioning.md:321-322` states "`'default'` is what
this store database calls 'the one tenant it holds'". Two deviations from that intent compound
here:

1. `provision_device` writes to the **global** db, not the store db.
2. ADR-56 §2.6 option **B** creates a **generated** location id
   (`crates/kasirmu-core/src/db/provisioning.rs:462` `let location_id = new_id();`, `:738`
   `format!("loc-{nanos:032x}{seq:04x}")`), so the install's primary location is no longer the
   `'default'` id the read path was written against.

## Acceptance for a repair

A device provisioned via "Offline only" must show its four workspaces on the home screen, and
`store-<generated-location-id>.sqlite` must not be created at all. Either the write side must
target the store db, or the read side must read the db the write side uses — the choice belongs
to P0-4's owner, not to this report. The reproduction is cheap: install a debug APK, `pm clear`,
provision offline, log in, and count `.workspace-grid > *` over CDP — it is `1` today and must
become `5` (4 workspaces + the add card).


---

# SECOND DEFECT (same test pass) — NO tablet install can obtain the
# subscription row the capabilities read requires, so every tool locks

<!-- Audit stamp: 2026-10-03 · DSH · status: MEASURED ON DEVICE + CAUSE CONFIRMED BY
     EXPERIMENT. Independent of the defect above: this one is a mode that cannot obtain a
     licence row, not a database split. Both were observed on the same provisioned tablet,
     and either alone is enough to make a fresh install unusable. The first draft of this
     section mis-diagnosed it as a missing write and proposed a fix that would have broken a
     deliberate security test; the text below is the corrected reading and says so. -->

**Symptom.** Every one of the home screen's 17 tool cards renders locked — `aria-disabled="true"`,
`data-testid="workspace-tool-card-locked"`, each captioned "Subscription inactive". The owner
cannot open Topology Editor, Staff Management, Settings, Data, or anything else. Combined with
the defect above the install is a dead end: no workspaces to enter AND no tool to create one.

## What was measured

`get_subscription_capabilities`, invoked on the device, returned:

```json
{"tier":"free","status":"unavailable","state":"unavailable","features":{},
 "maxLocations":1,"maxPosInstances":1,"maxWarehouses":0,"maxKdsScreens":0,"maxStaffUsers":1}
```

and the device database agrees — the table is empty:

| Table | Rows |
|---|---|
| `tenant_subscription` | **0** |
| `tenant_plans` | 0 |
| `settings` | 17 (none subscription- or licence-related) |
| `workspace_instances` | 4 |
| `users` | 1 |

## Root cause — an inconsistency between two readers of the same absent row

There are two readings of the same fact, and they disagree. On an offline (`local`) install no
subscription row is expected — the licence server writes it, and no client-side command ever
does. What matters is how each reader handles that absence.

**Reading 1 — session creation and workspace listing treat "no row" as Free.** Four separate
production sites use the same shape, and it is sharper than "fall back on any failure": the
`?` on `TenantSubscription::load(...)` propagates a READ error, and `unwrap_or_else` fires only on
`Ok(None)` — a genuinely ABSENT row. A tampered row loads as `Ok(Some)` and is then rejected by
the `verify_signature()?` on the next line. So these four sites DO distinguish absent from
tampered:

| Site | Behaviour on a missing row |
|---|---|
| `crates/kasirmu-bridge/src/auth.rs:672-675` | `bootstrap_free()` — session created |
| `apps/mobile-tauri/src/commands/auth.rs:518-521` | `bootstrap_free()` — session created |
| `crates/kasirmu-bridge/src/workspaces.rs:294-297` | `bootstrap_free()` — workspaces listed |
| `crates/kasirmu-bridge/src/workspaces.rs:726` | `bootstrap_free()` — workspaces listed |

This is why logging in works on the broken device: the session path compensates.

**Reading 2 — the capabilities path treats "no row" as `unavailable`.**
`crates/kasirmu-bridge/src/subscription.rs:210-239` has no such fallback. It builds entitlements
through `build_entitlements`, whose first statement is:

```rust
let Some(sub) = loader.load_verified_subscription() else {
    return Entitlements::fail_closed(usage);   // tier: Free, state: Unavailable, loaded: false
};
```

(`crates/kasirmu-core/src/entitlements.rs:372-373`; `fail_closed` is `:116-126`.) It then
separately sets the DTO's status string to `"unavailable"` when the row is absent
(`subscription.rs:226-229`), and `lifecycle_state_at` maps any unrecognized status to
`Unavailable` (`crates/kasirmu-core/src/subscription.rs:760`).

So the SAME absent row yields **Free + active** to the session reader and **Free + unavailable** to
the capabilities reader. The UI trusts the second one, and `unavailable` is not in the open set —
hence the lock-out. The two readers disagreeing, not the absence itself, is the defect.

### The constraint any repair must respect: `None` is three different facts

Recorded because the first draft of this report got it wrong and proposed exactly the change
this forbids. `SubscriptionLoader::load_verified_subscription` deliberately collapses three
distinct cases into one `None` (`crates/kasirmu-core/src/entitlements.rs:324-344`), and the
trait's doc comment says so (`:306-308`, "missing/tampered/unreadable"):

1. `Ok(None)` — **no row**.
2. `verify_signature()` failed — **tampered**: must stay locked.
3. `TenantSubscription::load` errored — **unreadable**: must stay locked.

The section below **refutes the first draft's conclusion** that case 1 is simply a bug: for the
`local` mode there is no row BY DESIGN, and
`capabilities_fail_closed_when_subscription_row_missing` pins the lock-out deliberately. So the
defect is not that the capabilities path fails closed.

The collapse matters as a constraint, not as the bug: because a single `None` cannot say which
of the three it was, no repair may map `None` to `bootstrap_free()`. Doing so would hand the
tampered and unreadable cases the same Free-active answer and turn a tampered row from locked
into usable — the exact downgrade `entitlements.rs:113-114` ("a missing/tampered row must
project a payload that locks every gate") exists to prevent. **Any** change here must first
teach the read which case it hit.

## Where a subscription row can come from — and why a `local` install never gets one

Every writer of this table, and who can reach it:

| Writer | Operation | Reached by |
|---|---|---|
| `licensed_subscription::store_subscription` (`license_verification.rs:728-764`) | **INSERT OR REPLACE**, a *real signed* row | an activation or renewal against the licence server — the `linked` path |
| `refresh_subscription_status_from_server` (`:785-802`) | **UPDATE only** | the `/license/status` poll; no-ops when no row exists |
| `seed_provisioned_baseline` (`migrations.rs:530-546`) | INSERT with the `BOOTSTRAP_FREE` sentinel | **TESTS ONLY** — verified in round 3, no production caller |
| `provision_device` | **nothing** | — |

Two consequences:

- **`linked` works.** Licence activation writes a genuine signed row; the sentinel is indeed
  retired for that path, exactly as ADR-56 §2.6 intends.
- **`local` can never obtain one.** It has no activation (that needs the network it opted out of),
  no sync path (`tenant_subscription` is absent from the sync entity set), and the migration seed
  was deleted in the same change. So `state` is `unavailable` for the life of the install, and
  every tool stays locked.

The migration comment at `20260813_init.sql:1519` ("They are now created by `provision_device`'s
single transaction") is therefore **not accurate**: that transaction has six steps and none touch
the table (`provisioning.rs:434-528` — roles `:443`, location `:462`, workspaces `:509`, owner
`:514`, settings `:520`, marker `:523`), and a grep for `tenant_subscription` across
`provisioning.rs` returns no matches. Line 1520 of the same comment is the accurate half — the
sentinel really is retired in favour of a signed row — but nothing then gives a `local` install
one.

## No tablet path can write the row — checked six ways (round 5)

Round 4 concluded that `local` mode could never obtain a subscription row. Chasing the same
question on the tablet's own command surface shows the reach is wider: **the tablet has no route
to a `tenant_subscription` row at all**, in either provisioning mode. Each candidate was
falsified separately rather than inferred from the first one that failed:

| Route | Verdict | Evidence |
|---|---|---|
| Provisioning (`local` **and** `linked`) | writes nothing | `provisioning.rs:434-528`; the submit at `ProvisioningFlow.tsx:543-563` calls `provisionDevice` only, passing `tenant_id`/`device_credential_id` but never activating |
| `activate_license` | **not registered on the tablet** | `apps/mobile-tauri/src/lib.rs:974-975` registers only `get_license_status` + `check_license_status`; `LicenseActivationScreen.tsx:271-287` guards the call with `if (!isTabletShell())` |
| `check_license_status` | read-only, and errors first | `license.rs:448-452` returns `"No license activated. Activate first."` when no API key is stored; no INSERT anywhere in the body |
| `refresh_subscription_status_from_server` | **UPDATE only** | `license_verification.rs:792-799` — `UPDATE tenant_subscription ... WHERE tenant_id = ?`; a no-op without an existing row |
| Sync | table not carried | `tenant_subscription` is absent from the sync entity set (grepped `platform/sync` and the core sync modules) |
| Migration seed | removed; fixture-only | `20260813_init.sql:1512-1522`; `seed_provisioned_baseline` has no production caller |

The module doc states the policy rather than leaving it to inference —
`apps/mobile-tauri/src/commands/license.rs:9-13`:

> **READ-ONLY ON PURPOSE.** `activate_license`, `renew_license`, `pause_subscription`,
> `resume_subscription`, `test_auth_connection` and every `*_scoped` twin stay desktop-only:
> activation and billing management are back-office actions, not tablet ones.

### The circular dependency that also sinks `linked` mode

`linked` mode was the plausible escape: link the device to an account and let the server grant a
subscription. It cannot, and the reason is a cycle. Every device-link command —
`link_device_google` (`desktop_link.rs:27`), `link_device_email_request` (`:60`) and
`link_device_email_consume` (`:76`) — begins by calling
`kasirmu_bridge::license::stored_credentials`, and that function refuses without an existing
activation
(`crates/kasirmu-bridge/src/license.rs:228-232`):

```rust
match api_key {
    Some(key) if !key.is_empty() => Ok((key, machine_id)),
    _ => Err(BridgeError::Invalid(
        "this device is not activated yet".to_string(),
    )),
}
```

So: linking needs an activation, activation is desktop-only, and provisioning writes no row to
break the cycle. A tablet that has never been touched by the desktop cannot reach a licensed
state through its own UI — which is a stronger statement than "offline mode is unsupported", and
it is the reason this is reported rather than patched: the intended acquisition path for a tablet's
subscription is not visible anywhere in this checkout.

### Corroborated on the device

The device agrees with the source on every point. Its `settings` table holds exactly the 17 keys
`write_provisioning_settings` and normal operation write, and **no licence key of any kind** — a
grep for `%license%`, `%machine%`, `%hardware%`, `%api%` returns nothing:

```
currency.default, feature.* (x10), popularity.* (x5), store.preset, sync_server_url
license-related setting: NONE
```

That absence is the runtime signature of the cycle above — no `license.api_key` means
`stored_credentials` refuses, which means no link, which means no activation.

### The ADR notices the missing screen but not the dead end

ADR-54 §1.5 records the missing activation screen as a PLACEMENT concern rather than a licensing
one (`docs/decisions/2026-09-19-adr54-google-sign-in.md:107-111`):

> `ui/src/app/tablet/TabletAppShell.tsx` mounts the **same** `SetupWizard` ... and never imports
> `LicenseActivationScreen` **at all**; its gate is `StaffLoginScreen` then the wizard. So any
> Google control placed in the wizard ships to Android unless it is excluded deliberately...

The sentence is about where a *Google button* may appear. It states the same fact this report
measures — no activation screen on the tablet — without drawing the consequence, because the
section's question was widget placement. §1.4 is the section that names activation as the
prerequisite ("the wizard runs *after* activation"), and it is written for the desktop.

So the tablet's licensing model is not documented anywhere in this checkout. That is the gap.

### CORRECTION (round 8): the tablet DOES have a licence gate — and bypasses it

Round 7's table recorded the tablet's licence gate, activation screen and `bootAllowed` as
**absent**. That was wrong, and the error matters because the true structure is what makes the
defect explainable. Measured this round:

| Piece | Desktop | Tablet |
|---|---|---|
| `bootAllowed` state | `AppShell.tsx:117` | **`TabletAppShell.tsx:114`** |
| licence gate render | `AppShell.tsx:553` | **`:327`** |
| `LicenseActivationScreen` | `AppShell.tsx:900` | **`:330`** |
| registered `activate_license` | `lib.rs:1435` | still **absent** |

ADR-56 §5 Q2 decided this on purpose and marks it IMPLEMENTED
(`docs/decisions/2026-09-21-adr56-first-run-provisioning.md:945-970`): *"both shells converge on
the desktop's order (activate → identify → provision → login)"*, with the reasoning that *"the
tablet's absence of this gate is the bug, not a design"*, and the shipped note that *"Existing
installs bypass the gate via `setupCompleted || installExisting`".*

That bypass is the seam. `TabletAppShell.tsx:196-199`:

```ts
const licenceUsable =
  licenseRes.ok && (licenseRes.value.isActive || licenseRes.value.status === 'gracePeriod');
const installExisting = usersRes.ok && usersRes.value.has_users;
setBootAllowed(licenceUsable || setupCompleted || installExisting);
```

`setupCompleted` becomes true the moment provisioning writes its marker — which provisioning does
**regardless of any licence**. So a freshly provisioned tablet sets `bootAllowed = true`, walks past
the activation screen, reaches the home screen, and is locked out there instead, because
`WorkspaceHome` reads `subscriptionState` (`unavailable`) and not `bootAllowed`.

**Two shipped components therefore disagree about the same install**: the boot gate says "this
device may proceed", the home screen says "this device is unlicensed". That is the same class
ADR-56 §1.4 named — *"same install, opposite verdicts"* (`:943`) — which Q2 was written to
eliminate and replaced with a new instance. The bypass is doing the work the gate was built to do.

#### Confirmed on the device (round 8)

The three gate inputs were read from the device's own database and agree with the analysis:

| Gate input (`TabletAppShell.tsx:196-199`) | Device value | Contribution |
|---|---|---|
| `licenceUsable` | false — no subscription row, state `unavailable` | none |
| **`setupCompleted`** | **true** — a `provisioning` row exists, `mode='local'` | **`bootAllowed = true`** |
| `installExisting` | true — 1 row in `users` | `bootAllowed = true` |

Two independent bypasses, and the second one is not even licence-related: any device with a staff
account skips activation forever. The observable consequence matches — the tablet currently renders
`staff-login-screen` and **not** the activation screen (`onActivation: false`), so it never offers the
operator the one action that would license it.

### What ADR-56 decided about this exact case, in its own words

This is the answer the report had been asking for, and it was in the ADR all along:

- **`:960-961`** — *"a tablet that cannot activate a licence also cannot link an identity, cannot
  sync, and cannot be sold. **The tablet's absence of this gate is the bug, not a design."***
- **`:988-992`** — *"`Free` is a **permanent** tier, not a trial... A `local` terminal is therefore
  *already* a legitimate steady state — it is a Free terminal that has not yet linked — not a
  degraded one waiting for rescue."*

So the intended behaviour is not ambiguous: a provisioned `local` tablet is a **Free terminal**, it
is a legitimate steady state, and it must be usable. The shipped behaviour denies all three. No
product decision is outstanding after all — the ADR made it, and the implementation diverges from
it. That also means the earlier "A is the ADR-conformant direction" framing understated it: A was
not a proposal, it was **already decided and marked implemented**, and this is a regression or an
incomplete implementation of it.

### The asymmetry that explains how this shipped

`provision_device` is **shared** by both shells (`apps/desktop-tauri/src/commands/setup.rs:89`,
`apps/mobile-tauri/src/commands/setup.rs`), and as a shared function it is CORRECT — because the
two shells reach it by different routes:

| | Desktop | Tablet |
|---|---|---|
| imports `LicenseActivationScreen` | **yes** — `ui/src/app/AppShell.tsx:29`, rendered `:900` | **no** — ADR-54 §1.5 |
| registers `activate_license` | **yes** — `apps/desktop-tauri/src/lib.rs:1435` | **no** — only `get_license_status`/`check_license_status` |
| order | activation, **then** the wizard (ADR-54 §1.4: "the wizard runs *after* activation") | wizard only |
| subscription row at first run | present | **absent** |

On the desktop the row is written before provisioning, so nothing downstream notices that
`provision_device` does not write one — and no test notices either, because the fixture seeds it.
The tablet runs the same provisioning without the step that precedes it, so it arrives at the same
function with a precondition that is not met and no signal that it is not. **This is why the defect
is invisible from either file read alone**: each side is internally consistent and the mismatch
lives in the ordering between them.

That also bounds the fix: the desktop must keep working exactly as it does, so whatever closes this
belongs on the tablet side (or in a shared precondition check), not in an edit to the ordering the
desktop depends on.

### The module doc asserts the invariant the code breaks

`crates/kasirmu-core/src/db/provisioning.rs` states two things this report measures as false, and
they are worth quoting because they are what a reader would trust:

- **`:16-17`** — *"The row is written LAST inside one transaction (§2.2), so its presence proves
  the **licence**, location and owner were all written."* The location and owner are written;
  the licence is never written by this transaction (no `tenant_subscription` reference exists in
  the file). So the marker proves two of the three things it names, and the third is exactly the
  one the picker needs.
- **`:35`** — the `Local` variant is documented as *"No network: a **working OS and a sellable
  terminal**."* Measured, a `local` install renders 17 of 17 tool cards locked (see the
  re-verification below), which is neither working nor sellable.

The user-facing claim is wrong in the same direction — the wizard's success toast is
`setup-provision-success = This terminal is ready.` (`shared-ui/locales/settings.ftl:117`), shown
at the moment this report's screenshot shows every tool disabled. **Nothing anywhere tells the
operator that the install cannot be used**, which is why the two defects went unreported: the
product says it succeeded.

### The missing piece is small — the capability already exists

The blocker is NOT a missing implementation. `kasirmu_bridge::license::activate_license`
(`crates/kasirmu-bridge/src/license.rs:95-104`) is fully implemented, shell-agnostic, and takes
only a `BridgeCtx` and its arguments: it calls the licence server, encrypts the returned API key
against the machine id, stores it, and (through `store_subscription`) writes the
`tenant_subscription` row this report is about. Nothing in it is desktop-specific.

The desktop's command is a **12-line shim** over it (`apps/desktop-tauri/src/commands/license.rs:42-65`
— take `state.bridge_ctx()`, forward the seven arguments, map the error). A tablet equivalent would
be the same shape, and its absence is the whole gap:

| Piece | Desktop | Tablet |
|---|---|---|
| bridge `activate_license` | present | present (**shared**) |
| shell command registering it | `lib.rs:1435` | **absent** |
| licence gate (`bootAllowed`) | `AppShell.tsx:553`, `:898` | **absent** |
| activation screen rendered | `AppShell.tsx:900` | **absent** |

So the tablet shell is not *missing a screen and a command because the design says activation
happens elsewhere* — it has the bridge function it would call, in the same crate graph, one shim
away from being reachable. That is what makes this worth raising: the distance between the shipped
state and a working one is a registered command plus the screen the shared `ui/` already contains.

It is still a product decision rather than a patch, because *whether a tablet should be able to
activate itself* is a licensing-model choice this report cannot make — but the cost estimate the
decision needs is now known, and it is small.

### What would settle it

One question this checkout cannot answer: **how is a tablet meant to become licensed?** If the
answer is "the operator runs the desktop app once against the same account", then the tablet's
first-run experience needs to say so instead of offering modes that cannot complete. If the
answer is "it should activate itself", then the missing piece is a tablet-side activation path,
which does not exist in the shell's command list. Either way the fix is a product decision about
the tablet's licensing model, not a local patch — which is why this round adds evidence rather
than code.

## ROOT CAUSE (round 8) — two commands disagree because only ONE has a debug arm

Rounds 4-7 measured the lock-out through the capabilities read and inferred the cause from the
absent database row. That inference was **incomplete**, and the device proved it this round:
`get_license_status` and `get_subscription_capabilities`, asked about the SAME device, answer
oppositely.

```json
get_license_status            -> {isActive: true,  status: "valid",       tier: "free"}
get_subscription_capabilities -> {tier: "free", status: "unavailable", state: "unavailable"}
```

The boot gate asks the FIRST question (`TabletAppShell.tsx:203-204`), so it is satisfied and admits
the device. The home screen asks the SECOND (`WorkspaceHome.tsx:419-423`), gets `unavailable`, and
locks all 17 tools. **That is why the device boots happily and then cannot be used** — not a missing
row at boot, but two readers of the same install disagreeing, which is ADR-56 §1.4's
*"same install, opposite verdicts"* in its purest form.

### The mechanism: a debug short-circuit that only one side has

`get_license_status` carries a `#[cfg(debug_assertions)]` arm for the no-licence case
(`crates/kasirmu-bridge/src/license.rs:776-788`):

```rust
} else {
    // -- No stored payload/signature --------------------
    #[cfg(debug_assertions)]
    {
        tracing::debug!("No license payload found in debug mode -- returning Valid (free tier)");
        Ok(LicenseStatusDto {
            is_active: true, status: LicenseVerificationStatus::Valid,
            tier: Some("free".to_string()), payload: None, message: None,
        })
    }
```

`get_subscription_capabilities` has **no equivalent arm** — a grep for `debug_assertions` across
`subscription.rs`, the mobile `commands/subscription.rs` and `entitlements.rs` returns only
`entitlements.rs:135` (`apply_debug_upgrade`, which this client passes `false`). So on a debug
build:

| Build | `get_license_status`, no licence | `get_subscription_capabilities`, no licence |
|---|---|---|
| **debug** | `is_active: true`, `tier: "free"` | `unavailable` — locks every tool |
| release | `is_active: false`, `status: "Missing"` | `unavailable` — locks every tool |

**The two agree in a release build and disagree in every debug build.** That is the condition this
device is in, and it explains a fact rounds 4-7 could not: why the boot gate was satisfied on a
terminal with no subscription row.

Both arms are deliberate — the module doc calls the debug branches *"verbatim ports of the command
bodies"* (`license.rs:9-10`), so `get_license_status` is meant to let a developer run unlicensed.
The defect is that the concession was made in one reader and not the other, so a debug build
presents two contradictory verdicts to the same user in the same session.

### What this changes about the earlier analysis

- **The six-way proof in round 5 stands**: no tablet path writes the row, and that is still why
  `get_subscription_capabilities` has nothing to read.
- **The `local`-mode framing in rounds 4-6 was too narrow.** The lock-out needs no provisioning
  mode at all — any **debug** build shows it, because the arm that would have compensated
  (`get_license_status`) is the debug-only one.
- **The lock-out is NOT debug-only, and this session already measured that.** The first screenshot
  taken in round 1 was from the **release** build (`dumpsys package`: `flags=0x0`,
  `versionName=0.0.41`) recorded before the debug APK was installed, and it shows the same 17
  locked cards captioned "Subscription inactive". The debug arm changes only which of the two
  commands is satisfied at the gate — it cannot change the outcome, because the gate is an OR:
  with no licence, `licenceUsable` is false in both profiles, but `setupCompleted` is true as soon
  as provisioning writes its marker, and provisioning does not depend on the profile. So
  `bootAllowed` is satisfied either way and the home screen locks the tools either way.
- **What the debug arm does change** is the *route* to the lock-out: on a debug build the gate is
  satisfied by a false `is_active: true`; on release it is satisfied by `setupCompleted`. Same
  endpoint, and the fix must address the capabilities read rather than the gate, because the gate
  is behaving as designed in both.

## Why the test suite never saw it

The gap is masked by the fixture. Every bridge subscription test builds its DB from
`crate::testing::temp_conn`, and that is `migrations::fresh_db()` **plus
`migrations::seed_provisioned_baseline(&conn)`** (`testing.rs:99-103`) — so **every test database
already contains the `BOOTSTRAP_FREE` row that production never writes**. The fixture's own doc
comment states the intent (`subscription_tests.rs:10-13`): the seed is included "so the seeded
baseline (ADR #56 §2.6: location, legal entity, workspace instances, BOOTSTRAP_FREE subscription)
is present", and that calling `fresh_db()` alone "would skip that seed and make every fail-closed
arm pass for the wrong reason".

The result is that the production state — **no row at all** — is reachable in tests only by
deliberately deleting the seed, which is exactly what
`capabilities_fail_closed_when_subscription_row_missing` does (`subscription_tests.rs:254-277`).
That test is correct and valuable; it is simply not the state a `local` install ships in.

## This behaviour is INTENTIONAL and PINNED — it is not a bug to patch away

This corrects the first draft of this section, which proposed treating a missing row as Free.
`capabilities_fail_closed_when_subscription_row_missing` asserts `state == "unavailable"`
deliberately, with the reason inline (`subscription_tests.rs:268-269`): "Fail closed: Free
entitlements — the debug Premium upgrade must not apply, so every tier gate locks even in dev
builds." The trait's own doc groups the three cases on purpose (`entitlements.rs:306-308`,
"missing/tampered/unreadable"), and `entitlements.rs:113-114` states the rule that a missing row
must lock every gate.

So the question is NOT "why does the capabilities path fail closed" — that is working as designed,
and the design is defensible. The question is **what a `local` install is supposed to be**, because
today that mode is provisioned into a state the product then treats as unlicensed.

### The open product question (needs an owner decision, not a patch)

The setup wizard's own copy promises the opposite of what ships —
`shared-ui/locales/settings.ftl:99`, the `local` mode card the owner chose:

> Keep this terminal completely offline. No account, no cloud sync — **a free starter workspace
> is created on the device.**

Measured against that sentence, the device delivers neither half: the starter workspaces exist
but are invisible (Defect 1), and every tool is locked (this defect). Three ways out, and they
are not equivalent — this is the decision the report cannot make:

| Option | What changes | Cost / risk |
|---|---|---|
| **A. `local` is a supported tier** | `provision_device` writes a Free row for `local` mode only, or the capabilities read treats an absent row as Free **for that mode** | Touches the pinned fail-closed contract; must keep `linked` and tampered-row behaviour exactly as tested |
| **B. `local` is genuinely unsupported** | Remove or reword the wizard option so nobody provisions into a locked state | Discards an offline-first deployment; ADR-56 §2.4 makes `local` the *default* tier |
| **C. The wizard copy is wrong** | Reword `setup-mode-local-desc` to stop promising a starter workspace | Cheapest, but leaves the install locked — it fixes the sentence, not the product |

**ADR-56 §2.4 rules out B, and it does so in terms this device fails.** It defines the tier
(`=local`, `docs/decisions/2026-09-21-adr56-first-run-provisioning.md:584-587`) as:

> **`local`** — store name + owner PIN, no network. **Produces a working OS and a sellable
> terminal.** This tier is the **default**, not the fallback...

A terminal that cannot open a single tool is not a sellable terminal, so the shipped behaviour
contradicts the ADR rather than merely disappointing the wizard copy. The same section also
confirms the absence is expected — line 604 records that "a `local` install holds no signed
subscription and therefore no expiry to approach" — so ADR-56 knew no row would exist and did
not say what should replace it in the capabilities path. That omission is the defect.

**So A is the ADR-conformant direction**, and the constraint above says how it must be done:
teach the read to distinguish absent from tampered rather than collapsing them.

## Why it locks every tool

The lock is the documented fail-closed behaviour, not a bug in the gate. The backend downgrades
missing subscription data to Free entitlements with `state: 'unavailable'`
(`ui/src/contexts/SubscriptionContext.tsx:40-46`), and `WorkspaceHome` treats only three states as
open (`ui/src/features/workspaces/WorkspaceHome.tsx:419-423`):

```ts
const validityOpen =
  subscriptionState === 'active' ||
  subscriptionState === 'grace' ||
  subscriptionState === 'loading';
if (!validityOpen) return 'subscription';   // every tool, including the free ones
```

`unavailable` is not in that set, so the FIRST gate rejects all 17 tools before the tier check
(`:425`) is ever reached — the state alone accounts for the blanked-out tools, which the
experiment below confirms rather than assumes. The measured `features: {}` is a separate and
genuine fact about this tier, not part of this lock: it is why `maxWarehouses: 0` and
`maxKdsScreens: 0`, and those caps are what the 7 remaining locks report after the state is
repaired (see the experiment's second point).

## Confirmed by experiment on the device (2026-10-03)

The diagnosis above was tested rather than argued. With the app force-stopped, the device's
`kasir.db` was pulled, a single row was inserted mirroring what `seed_provisioned_baseline`
writes (`tier_key='free'`, `status='active'`, `signature='BOOTSTRAP_FREE'`), the WAL was
checkpointed, and the file was pushed back. Nothing else changed. The app was then relaunched and
logged in.

| Reading | No row (as provisioned) | With the sentinel row |
|---|---|---|
| `get_subscription_capabilities.status` | `"unavailable"` | **`"active"`** |
| `…state` | `"unavailable"` | **`"active"`** |
| `…tier` | `free` | `free` (unchanged) |
| `…features` | `{}` | `{}` (unchanged) |
| locked tool cards | **17 of 17** | **7 of 17** |
| unlocked tool cards | 0 | **10** |

Two things this settles:

1. **The state string is what locks.** `tier` and `features` are identical in both readings, so
   the 10 tools that unlocked did so purely because `state` moved `unavailable` -> `active`. The
   gate at `WorkspaceHome.tsx:419-423` reads the state, not the tier, and the fix belongs on the
   capabilities path.
2. **The remaining 7 locks are correct.** They render specific tier captions — "Requires Pro
   plan" (Memos, Analytics, Reports), "Requires Premium plan" (Promotions, Audit Log), "Requires
   Plus plan" (Cloud Sync), and Data — rather than the blanket "Subscription inactive". That is
   Free behaving as Free, and it is the control showing the experiment did not simply unlock
   everything.

**Topology Editor unlocked in this state**, which matters: it is the one tool that can create the
workspaces Defect 1 hides. So the two defects are not merely co-located — repairing this one
restores the operator's only route around the other.

**The device was left in that state at the end of round 3** as a reproducibility aid — the row
was a hand-inserted sentinel on one tablet, invisible to any build, and a `pm clear` would have
removed it. **Round 6 removed it**, so the device now carries the true provisioned state and the
table above records the re-measurement. Read the round-3 column as "the mechanism, isolated by
adding one row", not as what a merchant receives.

## Acceptance for a repair

Two behaviours must BOTH hold, and the second is the one that keeps the fix safe:

1. **The lock lifts.** On a device provisioned offline, the home screen renders tool cards that
   are NOT `workspace-tool-card-locked` for at least the free-tier tools, and
   `get_subscription_capabilities` reports a state other than `unavailable`.
2. **A tampered row still locks.** A row whose `signature` does not verify must still yield
   `unavailable` and keep every tool locked. This is the regression risk of the obvious fix:
   collapsing "absent" back onto "tampered" would trade a visible lock-out for an invisible
   licence bypass, which is strictly worse and would not fail any test that only checks case 1.

Reproduction is cheap for both — the assertion is one IPC call plus one DOM count:

```
get_subscription_capabilities -> state must not be 'unavailable'
document.querySelectorAll('[data-testid=workspace-tool-card-locked]').length -> must fall
```

## Re-verified on the TRUE provisioned state (2026-10-03, round 6)

Rounds 3 and 4 measured the lock-out after hand-inserting a sentinel row to prove the mechanism,
which left the device in an artificial state. This pass **removed that row** (restoring exactly
what `provision_device` produces) and re-measured, so the headline evidence is no longer taken
from a modified device:

| Reading | True provisioned state | With a hand-inserted sentinel (round 3) |
|---|---|---|
| `tenant_subscription` rows | **0** | 1 |
| `workspace_instances` rows | 4 | 4 |
| logged in successfully | yes | yes |
| `workspace-home` mounted | 1 | 1 |
| **locked tool cards** | **17 of 17** | 7 of 17 |
| **unlocked tool cards** | **0** | 10 |
| **`.workspace-grid > *`** | **1** (the add card) | 1 |

Both defects therefore reproduce on an **unmodified** device, and the earlier round-3 comparison
gains a control it did not have: the same device, the same session, differing only in that one row.
The lock-out is total when the row is absent and partial when it is present, which is the
attribution the fix decision rests on.

The screen at this state shows both defects at once — the `WORKSPACES` section holding only an
"Add Workspace" card, and every tool card captioned "Subscription inactive", Topology Editor
among them. **Topology Editor is the one tool that can create the workspaces Defect 1 hides, so a
fresh install denies the operator both the destination and the route to it.**

**The device is left in this true state**, not the round-3 modified one.

## Evidence retention

Device-side files pulled during this pass: `kasir.db` (+wal) and `store-default.sqlite` (+wal) in
the host temp dir, and the CDP evaluation transcripts quoted above.
