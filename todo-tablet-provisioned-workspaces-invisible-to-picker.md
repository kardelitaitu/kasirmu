# todo-tablet-provisioned-workspaces-invisible-to-picker

> Two independent defects found on one freshly provisioned tablet. **Both have since been fixed
> by other sessions** — see the status stamp below for the current state, which is the only part
> of this file that should be read as present tense.
>
> 1. **Provisioned workspaces are invisible** — provisioning wrote the global DB, the picker read
>    a per-store DB. (A new instance of the known P0-4 split-brain.) **FIXED.**
> 2. **Every tool locked, permanently — on a provisioned install with no licence row, on BOTH
>    shells.** The capabilities read required a `tenant_subscription` row and failed closed to
>    `unavailable` without one, while the boot gate was satisfied by `setupCompleted` — so the
>    install was admitted and then tier-locked. **ROOT CAUSE FIXED** in two halves (`d35555bca`
>    committed; `provision_device`'s own write still uncommitted).
>
>    **Scope was corrected twice and the earlier framings should not be trusted.** Round 4
>    scoped this to `local` mode (too narrow); round 5 widened it to "every tablet install"
>    (also wrong); round 10 established it is **not tablet-specific at all** — the desktop
>    reaches the same state by the same route, and the two shells' `debug_upgrade` argument is
>    orthogonal because `apply_debug_upgrade` requires `state == Active`. See §"CORRECTION
>    (round 10): this is a SHARED defect".

<!-- Audit stamp: 2026-10-03 · DSH · status: BOTH DEFECTS FIXED; ONE FRONTEND CHANGE AWAITS ITS FILE

     READ THIS FIRST. The document below is a 22-round working log and is deliberately
     non-chronological: sections carry corrections of earlier sections, sometimes several
     rounds later. Do not read it top to bottom for the current state. That state is here.

     DEFECT 1 (invisible workspaces) — FIXED, by another session. The device now renders
     three workspace cards where rounds 2-11 measured one. Not fixed by this session.
     A second, uncommitted fix is also in flight in `crates/kasirmu-bridge/src/workspaces.rs`
     (a read-repair that copies global rows into the store DB); round 25 reviews it and finds
     three mechanical problems — no transaction, a swallowed FK error, and uncopied columns.

     DEFECT 2 (every tool locks) — ROOT CAUSE FIXED, by another session, in two halves:
       - committed `d35555bca`: a startup reconcile that repairs an install provisioned
         before the write existed (`migrations.rs::ensure_bootstrap_subscription`).
       - in flight, uncommitted: a write in `provision_device` itself (`provisioning.rs`
         "Step 5b"). Uncommitted at the time of writing.

     THIS SESSION'S OWN WORK, and its state:
       - a non-blocking licence notice in the shared `WorkspaceHome.tsx`, so an install with
         no usable entitlement states the CAUSE instead of showing 17 unexplained locked
         cards (`appShellBootGate.test.tsx` rule 4 requires exactly this). VERIFIED ON DEVICE
         for both `unavailable` and `expired`.
       - its Fluent strings: COMMITTED (`bcb4a5452`).
       - its CSS: COMMITTED, swept into a peer's `268440251`.
       - its tests: COMMITTED (`ba69f826f`).
       - **the JSX itself: UNCOMMITTED.** `WorkspaceHome.tsx` also carries another session's
         quick-launch cards in a separate hunk, and `AGENTS.md` 7.3 permits only whole-path
         commits, so the two cannot be separated. The block is recorded verbatim in
         "ROUND 15: the uncommitted block is now recorded verbatim", so it is recoverable.

     ONE OPEN DEFECT, not yet fixed anywhere: the uncommitted `provisioning.rs` Step 5b has
     no `args.mode` guard, so a LINKED install would get a local `BOOTSTRAP_FREE` row that no
     tablet reader consults — and the reconcile deliberately refuses to write exactly that.
     HEAD is unaffected (it contains no such write). A tripwire test marks the spot:
     `provisioning_tests.rs::a_linked_provision_leaves_no_bootstrap_subscription_row`.

     DEVICE: the tablet left the network during round 15 and has not returned. Every finding
     since round 16 comes from code, tests and ADRs rather than hardware. Re-pairing is
     required to resume device verification; nothing in this file depends on it to be read. -->


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

### The gate's intended order is now measurable, and one profile skips it (round 9)

The three gates in `TabletAppShell.tsx` are ordered exactly as ADR-56 §5 Q2 decided
(activate → provision → login), and their lines make the ladder explicit:

| Order | Condition | Renders | Line |
|---|---|---|---|
| 1 | `!bootAllowed` | `LicenseActivationScreen` | `:327` |
| 2 | `!hasCompletedSetup` | `ProvisioningFlow` | `:384` |
| 3 | — | `StaffLoginScreen` | `:434` |

So the activation gate is meant to stand **in front of** provisioning. Whether it does depends on
`licenceUsable`, and that depends on the build profile, because `get_license_status` answers
differently in each:

| Profile | Fresh device, no licence stored (`pm clear` state) | `licenceUsable` | Gate 1 |
|---|---|---|---|
| **debug** | `is_active: true`, `status: Valid`, `tier: free` (`license.rs:776-788`) | **true** | **never fires** |
| release | `is_active: false`, `status: Missing` (`license.rs:789-798`) | false | fires |

**This is evidenced by observation, not inference.** In round 3 this session ran `pm clear` on the
tablet — wiping the provisioning row and every user — and the app then rendered
`provision-account-email` / "Set up this terminal", i.e. `ProvisioningFlow` at gate 2. Gate 1 could
only have been skipped if `bootAllowed` was already true, and with `setupCompleted` and
`installExisting` both false, `licenceUsable` is the only term left. On the debug APK the
activation gate is therefore **unreachable**, and the ladder silently collapses to
provision → login — the exact order ADR-56 §5 Q2 rejected as Option B.

#### Proven by `pm clear` on the device (round 9)

Inference was not enough for a claim this structural, so the state was produced and observed. With
the app force-stopped, `adb shell pm clear mu.kasir.mobile` wiped `kasir.db` — no provisioning row,
no users, no licence — and the app was relaunched against the debug APK. The screen it rendered
was `ProvisioningFlow`, not the activation screen:

```json
{"testids": ["provisioning-flow", "provision-step-jump-account", "provision-mode-linked",
             "provision-mode-local", "provision-step-next", ...],
 "inputs":  ["provision-account-email"]}
```

Gate 1 (`:327`) is evaluated before gate 2 (`:384`), so reaching `ProvisioningFlow` proves
`bootAllowed` was already true. On this device `setupCompleted` and `installExisting` are both
false by construction of the wipe, which leaves `licenceUsable` as the only possible term — and
`licenceUsable` is `licenseRes.value.isActive || status === 'gracePeriod'` (`:197`). A device with no
stored payload therefore reported `is_active: true`, which is the debug arm at `license.rs:776-788`.
**The activation gate is unreachable on a debug build, and that is now observed rather than argued.**

The practical consequence: the ladder silently becomes provision → login, which is the order ADR-56
§5 Q2 explicitly rejected (its Option B). The ADR's gate is present in the source and dead at
runtime in every debug build.

### And in release, where the gate DOES fire, its submit is disabled

The release half is not a working alternative. `LicenseActivationScreen.tsx:286-308` guards the
whole activation call:

```ts
let success: boolean | null = null;
if (!isTabletShell()) {
  const machineId = await getMachineId();
  ...
  success = await activateLicense(...);
}
```

On a tablet `success` stays `null` — the file's own comment calls that "NOT ATTEMPTED on this shell"
(`:278-281`) — so the screen renders a licence-key field and a submit button that cannot succeed.
**A release tablet reaches the gate, is shown the activation screen, and cannot activate from it.**

| Profile | Reaches the gate? | Can activate from it? | End state |
|---|---|---|---|
| debug | no — `licenceUsable` true | n/a | provisioned, then all 17 tools locked |
| release | yes | **no** — submit guarded off | blocked at the activation screen |

Both profiles fail, at different points, which is why this needs the two-part fix and not one
change: the debug arm decides whether the gate is reachable, and the shell guard decides whether it
is usable.

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

## CORRECTION (round 10): this is a SHARED defect, not a tablet one

Rounds 4-9 reasoned about a tablet-versus-desktop asymmetry. That framing was **wrong**, and the
error came from reading only the argument the two shells pass to `build_entitlements` instead of
following what that argument does.

`apply_debug_upgrade` (`crates/kasirmu-core/src/entitlements.rs:134-141`) is:

```rust
if cfg!(debug_assertions)
    && self.state == SubscriptionLifecycleState::Active
    && self.tier == SubscriptionTier::Free
{
    self.tier = SubscriptionTier::Premium;
}
```

The `state == Active` guard makes it inert for this case. An absent row produces `fail_closed`
(`entitlements.rs:372-373`), whose state is `Unavailable` — never `Active` — so the upgrade cannot
fire. Desktop passing `true` and tablet passing `false` is therefore **orthogonal**: with no row,
both return `state: "unavailable"` and both lock every tier-gated tool.

| | Desktop | Tablet |
|---|---|---|
| capabilities with no row | `unavailable` | `unavailable` |
| gate bypass on `setupCompleted`/`installExisting` | `AppShell.tsx:286` | `TabletAppShell.tsx:200` |
| lock-out after boot | **yes** | **yes** |

So every claim earlier in this report that scoped the lock-out to the tablet — or to `local` mode,
or to a build profile — **overstates the difference and understates the reach**. The defect is: a
provisioned install with no licence row boots past the gate and is then tier-locked, on both
shells. The tablet is where it was measured because this session provisioned one; nothing about it
is tablet-specific.

The code already records the divergence it does have, and calls it a known gap
(`entitlements.rs:128-133`): *"Tablet never calls this — the per-client divergence the consolidation
design preserves deliberately (and the pre-existing tablet caps gap its owner may close
separately)."* That gap is about a Free row being promoted to Premium in dev; it is **not** the
absent-row lock-out, and conflating the two is what produced the wrong framing above.

#### The shared path, confirmed by the command bodies

Both shells register a `get_subscription_capabilities` command and both reach the same
fail-closed logic; the tablet's is a duplicate body rather than a delegation, which is why the two
could have drifted but did not:

| Shell | Command | Body |
|---|---|---|
| desktop | `commands/subscription.rs:45-52` | delegates to `kasirmu_bridge::subscription::get_subscription_capabilities` |
| tablet | `apps/mobile-tauri/src/commands/subscription.rs:152-188` | the same two steps inline — `build_entitlements`, then `load_verified_subscription` for the status string |

Neither passes a debug-permissive argument that could rescue an absent row: the desktop's
`build_entitlements(..., true)` only reaches `apply_debug_upgrade`, whose `state == Active` guard
(`entitlements.rs:136`) an `Unavailable` row never satisfies. **So the lock-out below is reachable
on the desktop by exactly the same route**, and nothing in this report should be read as a
tablet-only claim.

### What the round-9 evidence does and does not show

The `pm clear` measurement stands and is unaffected: the debug arm in `get_license_status` really
does make the activation gate unreachable, and that was observed. What it does **not** show is that
removing that arm would fix anything — the gate would then fire, and the activation screen it
renders cannot submit on a tablet (`LicenseActivationScreen.tsx:287`).

### Why the debug arms must NOT be removed

`license_tests.rs:614` and `:663` pin them under explicit `HAZARD 1 of 2` / `HAZARD 2 of 2`
headers, and the second says why (`:665-669`):

> **HAZARD 1 of 2** — A license that expired AND whose grace window has closed must be INACTIVE. In
> debug it is not: that cfg arm returns `is_active: true` / Valid with the payload attached.
> **Asserted AS SHIPPED, not as correct — this is the pin that fails loudly if anyone later reads
> the debug arm as the spec.**

ADR-57 §2.5 states the same policy from the security side (`docs/decisions/2026-09-21-adr57-client-
tamper-resistance.md:532-536`): *"under `debug_assertions` ... the debug arm asserts the opposite of
the security property"*, and warns that a green `cargo test` does not cover the release invariant.
So the permissive debug arms are a deliberate, tested, cross-cutting convention — the earlier draft
of this section proposed deleting one, which would have failed the tests written to protect it.

## The two owner rulings this case falls between (round 11)

Rounds 8-10 proposed fixing this by changing one of the two readers. Reading the owner rulings
shows the question is **not** a free choice: two rulings already on record pull in opposite
directions, and this case sits between them. Recording that is more useful than picking a side,
because the pick is exactly what the existing rulings say not to make informally.

### R2 — keep the `cfg` gate, declare the gap explained

`docs/plans/_done/done-todo-owner-rulings.md:62-72`. Subject: a debug-only code path
(`sync_tests.rs:35-37`) covering a fallback that "exists only under `#[cfg(debug_assertions)]`". The
ruling: *"**(i) — keep the `cfg` gate, declare the debug/release gap explained, and tick the
box.**"* The recommendation explains why the alternative is not worth taking (`:70`): forcing a
per-profile assertion *"buys coverage of a dev-only fallback"*.

**Read against this case**, `get_license_status`'s debug arm is the same shape: a dev-only
affordance (run without a licence) that release deliberately does not have. R2 says keep it and
document the gap, which is what `license_tests.rs:614`/`:663` already do under the `HAZARD`
headers.

### R11 — a behaviour must not depend on the build profile

`done-todo-owner-rulings.md:274-284`. Subject: the `debug_upgrade` flag, where the tablet passes
`false` and the bridge passes `true`. The ruling: *"**(i) — `false` is authoritative. An audit
record must not depend on the build profile, so the recorder stops depending on a debug-only tier
promotion and the bridge changes.**"* The recommendation states the principle generally (`:282`):
*"An audit record must not depend on the build profile."*

**Read against this case**, `get_license_status` returns a different **verdict** per profile for the
same database — `Valid`/active in debug, `Missing`/inactive in release — and it is that verdict
that decides whether the activation gate fires. R11 says the profile-independent side is
authoritative, which is `get_subscription_capabilities` (always strict, both profiles).

### Why neither settles it, and what that implies

| | R2 | R11 |
|---|---|---|
| Subject | a TEST covering a dev-only **feature** release lacks | a RECORDER whose **output** diverges |
| Ruling | keep the gate; document the gap | remove the dependence; the strict side wins |
| Applies here because | the debug arm is a dev-only **affordance** | the arm changes a **verdict that gates access** |

Both readings are defensible, and the two rulings themselves acknowledge they select different
sides for good reasons — R11's text says so explicitly: *"Note this selects the opposite shell from
R10, which is correct and not a contradiction: R10 moves gates toward the stricter side, this moves
the recorder toward the profile-independent side."* (`:284`)

So the deciding question is which of the two shapes this arm is, and that is a judgement about
intent rather than a fact either file records:

- if the debug arm is **a convenience for developers** (the HAZARD header's reading — "Asserted AS
  SHIPPED, not as correct"), R2 governs: keep it, and the defect is only that the capabilities path
  never got the matching concession, so a **debug tablet** is self-inconsistent;
- if it is **a verdict the product must not vary by profile** (R11's reading), then the arm is the
  bug, the capabilities path is already right, and the fix is to make `get_license_status`
  profile-independent in **both** shells — which also removes the desktop's latent divergence.

**This report does not decide between them.** Both fixes touch a pinned, security-adjacent behaviour
under an explicit `HAZARD` header, and R10's own price note applies with full force (`:270`): *"it
is the one item here I would not ship without a written ruling."* The deliverable this round is the
question, framed against the two rulings that already exist, so the ruling that closes it can cite
whichever of R2/R11 it follows and say why.

### One thing independent of that choice

Whichever way the verdict question is settled, the **dead activation gate on a debug build** stands
as a defect on its own: with `licenceUsable` forced true by the debug arm, gate 1
(`TabletAppShell.tsx:327`) cannot fire, so the ladder collapses to provision → login — the order
ADR-56 §5 Q2 rejected. A debug build that never exercises the activation gate also never tests it,
so the gate's release behaviour is unverified by any local run. That is worth its own ruling even if
the arm is kept.

## The intended design exists on desktop — the tablet has no badge (round 11)

This is the most concrete finding of the session, and it comes from a test written for **exactly
this situation**. `ui/src/__tests__/appShellBootGate.test.tsx:15-24` pins four invariants; the
fourth is the one that matters, verbatim:

> (4) only an unusable/unknown licence with no other evidence blocks; **inactive/unknown is
>     otherwise surfaced by the non-blocking badge.**

Rule 2 (`:18-21`) explains the bypass as well, calling it *"the compatibility contract of this
change"* — *"the pass that keeps a paying existing install from being nagged into a second owner
account is preserved verbatim"*. So the bypass this report measured is **deliberate and pinned**,
and the design's answer to an unlicensed-but-admitted install is a **badge, not a block**.

The desktop implements that answer; the tablet does not:

| | Desktop | Tablet |
|---|---|---|
| `licenseState` (truth claim, separate from availability) | `AppShell.tsx:118` | **absent** |
| non-blocking verdict badges | `AppShell.tsx:444-464`, rendered `:911-930` | **absent** |
| inactive licence surfaced | warning badge (`:930`) | nothing |

`git grep -n 'licenseState\|badge' -- ui/src/app/tablet/TabletAppShell.tsx` returns **no matches**.
The tablet reads the licence verdict, uses it only to compute `bootAllowed`, and discards it. That
is how a provisioned install is admitted with no indication its licence is inactive, and why
nothing on the home screen explains the 17 locked cards.

**This is a defect the project's own test says should not exist.** Unlike the verdict question
above, it needs no decision: the desktop behaviour is the specified one, the tablet is missing it,
and the fix is additive — carry `licenseState` alongside `bootAllowed` and render the same badges.
It changes no gate, no pin, and no Rust.

### The round-8 drafted fix was reaching for this and missed

Round 8 drafted a tablet **toast** for the same case, then reverted it. The stated reason was that
the branch cannot fire on a debug build — true, but the deeper error was the mechanism: the design
calls for a persistent `licenseState` badge, not a transient toast. A badge is the right shape
because it states the **truth claim** rather than acting on it, which is what survives a gate that
was satisfied for an unrelated reason.

### Why this was not implemented this round (scope estimate)

The badge fix is correct but **not small**, and starting it without the verdict question answered
would repeat the mistake rounds 8-10 each made. Measured scope:

1. `BootStatusBadges` is **local to `AppShell.tsx:917`** — not exported — so reuse means extracting
   it to a shared component first.
2. `TabletAppShell` needs `licenseState` and `usersUnknown` wired in; it currently derives neither.
3. `.boot-status-badges` has **no CSS rule anywhere** (`git grep` over `ui/src/**/*.css` finds only
   test references), so the tablet's layout would need the styling defined, not inherited.
4. `AppShell` renders its badges through `requiredLocalized(l10n, ...)`; the tablet shell uses
   `<Localized>` components and has no `l10n` object in scope (a mistake made and caught in round 8),
   so the string route has to be chosen deliberately rather than copied.

`appShellBootGate.test.tsx` pins the existing component with **13 assertions** across its
`boot-status-badges` / `boot-badge-*` testids, so the extraction is one that must keep that suite
green while adding a second consumer.

**That is a lane, not a line** — and its first step (extract, or give the tablet its own component)
depends on whether the two shells should share one badge implementation, which is the same kind of
shared-surface question as the verdict itself. Recorded here so the next session starts from the
estimate instead of re-deriving it.

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

### A fix was drafted and REVERTED — recorded so it is not re-derived

Two candidates were tried this round and both were withdrawn. Writing them down because each looks
reasonable from the outside and the reasons they fail are not visible from the diff:

1. **Add a tablet-side warning when the gate admits an unlicensed install.** The desktop does
   exactly this (`AppShell.tsx:293-298` — *"License is inactive. Please renew from Settings."*),
   and the tablet's equivalent condition is its exact complement, so the tablet is silently missing
   a warning the desktop has. Implemented, then reverted: on a debug build the branch CANNOT fire
   (the debug arm makes `licenceUsable` true), so it is unverifiable on the only device available,
   and it does not lift the lock-out — it only explains it. Adding unverifiable code on a licence
   path is the class of change this report argues against elsewhere.

2. **Register `activate_license` on the tablet.** Round 7 established the capability already exists
   in the shared bridge and the desktop command is a 12-line shim. Not attempted: it is the product
   decision described below, and shipping it without that decision would put a self-service licence
   activation path on Android that nobody asked for.

The useful output of the attempt is the correction it produced: it showed the gate is behaving as
designed and the disagreement is in the capabilities read, which is where a real fix belongs.

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

## STATUS (round 12): the notice is IMPLEMENTED and VERIFIED; one file still uncommitted

**Both defects are now fixed, and one of them by another session.** This is the state a reader
should start from, because it differs from everything above it.

### Defect 2's symptom now has an explanation on screen

Implemented and **verified on the device** (Redmi 23073RPBFG, debug `0.0.41`): a non-blocking notice
above the tool grid, driven by `subscriptionState === 'unavailable'`:

```json
{"home": 1, "locked": 17,
 "notice": "This terminal has no active licence. Tools below stay locked until it is activated."}
```

The screenshot at this state shows the notice band above `WORKSPACES`, the tool cards still
correctly locked, and the tier captions (`PRO` / `PREMIUM`) intact — the operator now sees the
**cause** of the lock-out, which is what `appShellBootGate.test.tsx` rule 4 requires and what the
tablet previously omitted.

Committed: the two Fluent strings (`bcb4a5452`). **Still uncommitted: the `WorkspaceHome.tsx` JSX** —
held deliberately, per the contention note below.

### Defect 1 is FIXED, by a concurrent session

The same device now renders **three workspace cards** (Restaurant POS, Kitchen Display, Warehouse),
where rounds 2-11 measured exactly one (`Add Workspace`):

```json
{"gridCards": 3}
```

This was not fixed by this session. Peer commits `268440251` and the `TabletAppShell.tsx` /
`ToolCard.tsx` edits observed mid-round are what changed it. **Do not read Defect 1 as open** — the
sections above document it as found; it has since been addressed elsewhere.

### Why earlier rounds' frontend changes never reached the device

A measured fact worth recording, because it would otherwise mislead a reader of the earlier rounds:
**the installed debug APK serves its EMBEDDED bundle, not the Vite dev server.**

Observed: with the dev server running on the LAN and `TAURI_DEV_HOST` set, the tablet loaded
`https://tauri.localhost/assets/index.mobile-<hash>.js` — a build artefact — and `location.href` was
`https://tauri.localhost/`, never `:1422`. The hash dated the bundle, and a source edit made after
that build produced **no change on the device**, including across an app restart.

Two consequences, both of which bit this round before being measured:

1. **HMR is not merely noisy here, it is absent.** A source edit stays invisible until
   `npm run build:mobile` regenerates `ui/dist-mobile/` **and** the APK is rebuilt to embed it.
2. **`cargo tauri android dev` did not switch the device to the dev server** despite
   `--no-dev-server-wait` and a server the tablet could reach (HTTP 200, measured). The two paths are
   distinguishable only by the loaded asset URL, so this must be checked rather than assumed —
   reading `location.href` is the cheap test.

The verification above used the loop that works: `npm run build:mobile`, confirm the new hash in
`ui/dist-mobile/assets/`, then `cargo tauri android dev --config <devUrl override>` to rebuild and
re-install the APK.

### Shared-index contention: one file could not be committed

`ui/src/features/workspaces/WorkspaceHome.tsx` is **dirty with another session's work** — 70 added
lines, of which this session's notice is ~26 and the remainder is a peer's quick-launch cards
(`workspace-card-quick-retail` and siblings). `AGENTS.md` §7.3 forbids committing a path whose
working-tree content is not wholly yours, since a pathspec commit records the working-tree copy and
would sweep their uncommitted edits in. The JSX is therefore left uncommitted, deliberately.

**Also measured:** the CSS half of this change (`WorkspaceHome.css`, `.workspace-licence-notice`) was
already committed by a peer — it appears in `268440251`, whose message concerns tier badges. That is
the same failure mode in the other direction: a peer's commit swept a file this session had edited.
It is not lost, only attributed to the wrong change.

**To finish:** once the peer's `WorkspaceHome.tsx` edits are committed, commit this session's notice
JSX from that file with a pathspec line — the block containing `data-testid="workspace-licence-notice"`
and the complement condition at `:741-744`. Nothing else is outstanding. (Round 13 widened that
condition and verified it against an expired subscription; the widening is part of the same
uncommitted block, so it lands with it.)

## ROUND 13: the notice's condition was too narrow, and the widening is proven

The round-12 notice fired on `subscriptionState === 'unavailable'`. That was **wrong**, and reading
`toolLock` rather than the state enum is what showed it. The authoritative open set is three states
(`ui/src/features/workspaces/WorkspaceHome.tsx:419-423`):

```ts
const validityOpen =
  subscriptionState === 'active' ||
  subscriptionState === 'grace' ||
  subscriptionState === 'loading';
if (!validityOpen) return 'subscription';   // every tool
```

So **five** states lock every tool: `unavailable`, `expired`, `canceled`, `paused` and `revoked`
(`ui/src/api/subscription.ts:12-19` declares all seven). Of those, only `revoked` is handled
upstream — `TabletAppShell.tsx:362` renders `RevokedScreen` before this screen — so an **expired,
canceled or paused** subscription reaches `WorkspaceHome` and locks all 17 cards. Keying on
`unavailable` alone left the notice **silent in exactly the cases it exists for.**

The condition is now the complement of `validityOpen`, minus the `revoked` exclusion that the
upstream screen already owns:

```tsx
{subscriptionState !== 'active' &&
  subscriptionState !== 'grace' &&
  subscriptionState !== 'loading' &&
  subscriptionState !== 'revoked' && (
```

### Proven on the device with the state that used to be silent

Not inferred — the untested state was constructed. With the app stopped, the device's
`kasir.db` was pulled and given a single row, `tenant_id='default'`, `tier_key='free'`,
`status='expired'`, `signature='BOOTSTRAP_FREE'`, then pushed back and the app relaunched:

| Reading | Value |
|---|---|
| `get_subscription_capabilities` | `{state: "expired", status: "expired", tier: "free"}` |
| locked tool cards | 17 |
| **notice** | **"This terminal has no active licence. Tools below stay locked until it is activated."** |

Before the widening this screen rendered 17 locked cards with **no explanation at all** — the exact
defect this work exists to remove, for the states a real merchant is most likely to hit (an expired
or cancelled subscription). The screenshot at this state shows the notice band above `WORKSPACES`,
the three workspace cards, and every tool locked with its tier caption.

The device was then restored to the true provisioned state (`unavailable`, no subscription row) from
the database saved before the test.

### What this changes about the round-12 entry above

Round 12 recorded the notice as implemented and verified. It was verified **only for `unavailable`**,
which is the one state the debug device happens to report. The condition was wrong for four other
states, and the round-12 verification could not have caught that — a device in one state cannot
demonstrate coverage of five. The generalisable lesson: a fix keyed on one enum member was verified
against an instance of that member, and the check that found the gap was reading the **predicate
the fix had to mirror**, not the enum it was drawn from.

## ROUND 14: the fix is SHARED with the desktop, and it now has a test

### The shared scope is confirmed by construction, not just by the entitlement path

Round 10 argued the lock-out affects both shells because the desktop reaches the same
`build_entitlements` -> `fail_closed` path. This round closes that with a stronger fact: the code is
**one file**.

| | Desktop | Tablet |
|---|---|---|
| imports `WorkspaceHome` | `ui/src/app/AppShell.tsx:42` | `ui/src/app/tablet/TabletAppShell.tsx:26` |
| gate admitting an unlicensed install | `AppShell.tsx:286` | `TabletAppShell.tsx:200` |
| `toolLock` (what locks all 17 cards) | `WorkspaceHome.tsx:419` — **the same lines** | same |

`WorkspaceHome.tsx` is a single shared component, so the `validityOpen` predicate that locks every
tool is literally the same code in both shells, and the desktop's boot gate is the same
`licenceUsable || setupCompleted || installExisting` expression. **Round 10's scope correction is
therefore confirmed** — this was never tablet-specific.

Two consequences worth stating plainly:

1. **The notice ships to the desktop too.** Because it lives in the shared component, the fix added
   in rounds 12-13 is not a tablet patch; a desktop install with no subscription row now also
   explains why its tools are locked.
2. **Neither shell is fixed by this.** The notice states the cause; the tools stay locked on both.

### The notice now has a test, and the test is a real fence

Rounds 12-13 shipped the notice with device verification only and **no test** — the gap this round
closes. Two cases were added to `ui/src/__tests__/WorkspaceHome.test.tsx`, both driven through the
file's existing `mockSubscription(tier, state)` helper:

- one asserting the notice appears for **every state that locks the tools** (`unavailable`,
  `expired`, `canceled`, `paused`);
- one asserting it is **absent while the subscription is usable** (`active`, `grace`).

`revoked` is deliberately absent from both lists: `TabletAppShell.tsx:362` renders `RevokedScreen`
before this component, so it cannot reach here — and the test helper's own state union already
omits it (`WorkspaceHome.test.tsx:810`), which is independent agreement with that reading.

**The fence was proved by breaking it.** Reverting the condition to the round-12
`subscriptionState === 'unavailable'` and re-running:

```
Tests  1 failed | 53 passed (54)
```

The failing case is exactly the widened one, so the test would have caught the round-12 defect had
it existed then. The condition was then restored and the suite re-run: **74 passed** across
`WorkspaceHome`, `appShellBootGate` and `tabletWorkspaceGrid`.

Committed: `ba69f826f` (the tests).

### A citation that had drifted, found by checking rather than reading

`TabletAppShell.tsx` is being edited concurrently, and a peer's insertion moved
`setBootAllowed(...)` from `:199` to `:200`. My notice's code comment and this report both cited
`:199`. Both were corrected (`cfe7abece` for the report, the JSX comment in the uncommitted block).
**A line citation into a file another session is editing is a value that expires**, and nothing
checks it — the two other citations into that file (`:362` revoked, and the desktop's `:286`) were
re-verified in the same pass and still hold.

## ROUND 15: the uncommitted block is now recorded verbatim (recovery path)

The one artefact still uncommitted is the notice JSX in `ui/src/features/workspaces/WorkspaceHome.tsx`.
Everything else of mine is committed — the locale strings (`bcb4a5452`), the CSS (swept into a peer's
`268440251`), and the tests (`ba69f826f`). So if this checkout is reset, **only the JSX is at risk**,
and until this round nothing durable held it.

That is now fixed by recording the block here. It is a direct child of `.ws-main`, immediately after
`<header className="workspace-home-header" />` (line 713) and before the error/empty/populated
branches, so it covers empty and populated states alike:

```tsx
          {/* ── Non-blocking licence notice ─────────────────────────────
              ... (comment; see the file — 26 lines explaining rule 2/rule 4,
              the profile-independence reason, and the complement condition) ... */}
          {subscriptionState !== 'active' &&
            subscriptionState !== 'grace' &&
            subscriptionState !== 'loading' &&
            subscriptionState !== 'revoked' && (
            <div className="workspace-licence-notice" role="status" data-testid="workspace-licence-notice">
              <Localized id="workspace-home-licence-unavailable">
                <span>
                  This terminal has no active licence. Tools below stay locked until it is activated.
                </span>
              </Localized>
            </div>
          )}
```

**Why it stays uncommitted.** `WorkspaceHome.tsx` carries another session's quick-launch cards
(`data-testid="workspace-card-quick-retail"` / `-quick-restaurant`, hunk `@@ -747,0 +787,44 @@`)
alongside this block (hunk `@@ -714,0 +715,39 @@`). The two hunks are cleanly separable, but
`AGENTS.md` §7.3 permits only ONE commit form — a whole-path pathspec line, with `git add`/`git stage`
forbidden because the shared index is a racing object — so there is **no sanctioned way to commit
one hunk of a contested file**. The same section's rule at `:287` is the instruction that applies:
*"A path that is dirty with content that is not yours: stop and say so."*

Verified as real content rather than a line-ending artefact, per §7.3's last bullet:

```
work : f293c280c9b5bb9f1e3715c1b7559285cd5f2fe1
index: 45da91d7a50b58d27556b9a9951b556e42f96eb8   (differ -> genuine changes)
```

**The blocker, stated plainly:** completing this work requires the peer's `WorkspaceHome.tsx` edits to
be committed first. The condition has held since round 12; the work itself is finished, verified on
the device (rounds 12-13) and covered by tests (round 14).

## ROUND 15 CORRECTION: the debug APK needs the dev server — it does not embed the bundle

Round 12 recorded that "the installed debug APK serves its EMBEDDED bundle, not the Vite dev
server", and built a verification loop on it. **That conclusion was wrong**, and the correction
matters because the loop it prescribed is not the one that works.

What actually happens, measured this round:

1. `cargo tauri android dev` rewrites the debug build's `devUrl` to the host's LAN address at
   install time — the installed APK requested `http://192.168.0.168:1422/`, while the same file on
   disk still reads `http://localhost:1422/`. The tablet reported it verbatim:
   `Failed to request http://192.168.0.168:1422/: error sending request for url (...)`.
2. With the dev server **down**, the app therefore renders `Loading…` and then that error, and
   dynamic imports fail: `TypeError: Failed to fetch dynamically imported module:
   https://tauri.localhost/src/features/workspaces/WorkspaceHome.tsx`.
3. With the dev server **up**, it loads source modules from `/src/...` — not `/assets/index.mobile-
   <hash>.js`. The Vite client connects to `192.168.0.168:1422`, and only its HMR WebSocket is
   blocked (`ws://` under the HTTPS page origin, the mixed-content limit recorded in this document
   since round 1).

So the `/assets/index.mobile-<hash>.js` observation in round 12 was real but came from a **release**
APK's history at that point, not from this debug one — and the reasoning built on it ("rebuild the
bundle and re-install the APK") described a loop that is not what made the round-13 verification
pass. What made it pass was the dev server being **up**, serving current source.

**The loop that actually verifies a frontend change on this device:**

```
1. start the mobile dev server:  TAURI_DEV_HOST=<lan-ip> npm run dev:mobile   (from ui/)
2. confirm reachability from the tablet:
     adb shell 'curl -s -m 8 -o /dev/null -w %{http_code} http://<lan-ip>:1422/'   -> 200
3. (re)install the debug APK if the Rust side changed; a UI-only change needs no reinstall
4. force-stop and relaunch the app, then drive it over CDP
```

`npm run build:mobile` is **not** part of this loop — it produces `ui/dist-mobile/`, which the debug
APK does not serve. It would matter for a release build, which is a different verification.

**Why the correction is worth recording rather than quietly fixing:** rounds 12-13 stated the wrong
mechanism confidently, and a reader following it would rebuild bundles that never reach the device.
The device-level *results* in those rounds still stand — the notice was observed rendering, and the
expired-state proof was observed — because the dev server happened to be up or the install happened
to carry the change. Only the explanation of *why* it worked was wrong.

## ROUND 15: the device left the network mid-round (external, not caused by this work)

The tablet dropped off Wi-Fi during this round, which ends device verification until it returns.
Recorded because it changes what the next session can rely on.

Measured:

```
adb devices                          -> (empty)
adb mdns services                    -> adb-e45e28d9-lFE6yH  _adb-tls-connect._tcp  192.168.0.187:39061
adb connect 192.168.0.187:39061      -> 10060 (timed out, host did not respond)
ping 192.168.0.187                   -> Reply from 192.168.0.168: Destination host unreachable
Get-NetNeighbor 192.168.0.187        -> State "Unreachable", LinkLayerAddress 00-00-00-00-00-00
```

The host side is healthy — the LAN is up, `192.168.0.105` is `Reachable`, and the adapter still holds
`192.168.0.168` — so the loss is the tablet, not this machine. mDNS still advertises the device, which
is why the serial resolves while nothing answers: the advertisement is cached, the host is not there.
**A re-pair or waking the tablet is required**, and that is the `android-apk-build` skill's territory
rather than this report's.

**What this blocks and what it does not:**

- It blocks any further **device** verification — no CDP, no screenshots, no `kasir.db` reads.
- It does **not** block the outstanding code item, which is a commit gate rather than a device
  question (see the round-15 recovery section above).
- The work verified on the device in rounds 12-14 stands; those measurements were taken while it was
  reachable and are quoted above.

Note also that the device's address **changed** — it was `192.168.0.168` in rounds 1-14 and appeared
as `192.168.0.187` here. Any saved address or `TAURI_DEV_HOST` value is therefore a perishable
configuration, not a constant; resolve it each session rather than reusing it.

## ROUND 15: the root cause was FIXED by another session — and the notice is still needed

Peer commit `d35555bca` ("fix(subscription): restore the bootstrap Free subscription row on a local
install") fixes the defect this report has documented since round 4. It is worth recording what it
did, because it changes the standing of everything above.

### The fix corroborates this report's diagnosis, independently

The commit's own doc comment restates the chain rounds 4-11 established, line for line: §2.6 removed
the `BOOTSTRAP_FREE` seed and assigned it to `provision_device`, "which never wrote it"; the
capabilities read then fails closed; "which projects `state: 'unavailable'`, which is not in
`WorkspaceHome.toolLock`'s open set (`active`/`grace`/`loading`), so the FIRST gate rejects every
tool before the tier check is ever reached, and every card renders \"Subscription inactive\"."
That is the same finding, reached separately.

**And it resolves the constraint round 8 identified as the trap.** My first draft proposed treating
an absent row as Free, which I withdrew because `None` collapses "absent", "tampered" and
"unreadable". The fix's guard 2 answers exactly that: *"Only when the row is ABSENT. A present row
is left exactly as it is, verified or not, so this can never launder a bad signature. That is the
whole difference between repairing an absent row and becoming a licence bypass."* It also guards on
`mode = 'local'` only, so a `linked` install's missing row keeps failing closed rather than
pre-empting the server's grant — the distinction between the two modes that rounds 4-6 got wrong
twice.

### Why the notice still earns its place

The fix is **non-fatal by design**, in its own words: *"a failed repair leaves the terminal exactly
as it was — a locked terminal, not a broken one."* The tablet's caller logs a warning and continues.
So there remains a reachable path to the silent lock-out — a repair that fails, a row deleted or
tampered after provisioning, or a build running before this fix — and the notice is what turns that
path from an unexplained wall of disabled cards into a stated cause. It is now a **safety net rather
than the only explanation**, which is the right place for it to sit.

### What this changes upstream in this report

- The **root-cause** sections remain accurate as a statement of what WAS true and why it happened.
  They should be read as the diagnosis that motivated `d35555bca`, not as open defects.
- The **`local`-mode framing** in rounds 4-6 (and its correction in round 10) is superseded: the
  fix guards on `mode = 'local'` and leaves `linked` failing closed, which is the correct split.
- The **notice is not made redundant**, for the reason above.

## ROUND 16: there are TWO fixes, not one — and the source write now has a test

Round 15 recorded the root cause as fixed by `d35555bca` alone, describing it as a startup reconcile.
**That was incomplete.** There are two complementary changes:

| | Where | State | What it does |
|---|---|---|---|
| Reconcile | `crates/kasirmu-core/src/migrations.rs` (`ensure_bootstrap_subscription`), called from both shells' `state.rs` | committed `d35555bca` | repairs installs provisioned BEFORE the write existed |
| Source write | `crates/kasirmu-core/src/db/provisioning.rs`, "Step 5b" | **in flight, uncommitted** at the time of writing | makes `provision_device` create the row in its own transaction |

The second is the load-bearing one: with only the reconcile, every new install would be provisioned
into the unlicensed state and repaired on the next boot, so the defect would still be *reproduced*, just
not observed. The peer's own doc comment says as much — *"Doing it here as well as there is deliberate,
not redundant"* — and the two are ordered so the reconcile stays a repair rather than becoming the only
writer.

### Neither the describe nor the reconcile covers the write — that gap is now closed

`provisioning_tests.rs` held 29 tests and **none mentioned `tenant_subscription`**, so the new Step 5b
was unverified at its source. Added one test, and it passes:

```
test db::provisioning::tests::provisioning_writes_the_bootstrap_subscription_the_local_tier_needs ... ok
test result: ok. 31 passed; 0 failed
```

It asserts the row the write must produce — `tenant_id='default'`, `tier_key='free'`, `status='active'`,
`signature='BOOTSTRAP_FREE'` — and frames it against the standard the neighbouring end-to-end test
already sets: §2.3 says onboarding must end at a **working** terminal, and a terminal whose licence row
is absent is configured but not usable. Committed as `e8b2726f8`.

Note what this test does and does not establish. It pins the write (passing with it, and asserting the
exact row it produces); it was **not** demonstrated failing without the write, because that would have
required mutating `provisioning.rs`, which at that moment held another session's uncommitted work — the
same shared-index hazard this document records elsewhere. The assertion is specific enough to fail if
the write is removed or its values change, but that was reasoned, not observed.

### Consequence for the sections above

Everything in this document that describes the defect as a property of `provision_device` remains
accurate as history. What changed is that the fix has two halves, and only one of them was committed
when round 15 described it.

## ROUND 17: Step 5b writes the row under a tenant the reader never looks at

A defect in the **in-flight** half of the fix, found by checking the write against the read rather
than reading either alone. It is latent today and reachable the moment the `linked` path ships.

### The two halves disagree on the tenant key

| Site | Tenant it uses |
|---|---|
| `provisioning.rs:526` (Step 5b, the write) | `args.tenant_id.as_deref().unwrap_or("default")` |
| `entitlements.rs:336` (the capabilities read) | `'default'`, hardcoded — its own message says "no tenant_subscription row for **'default'** — failing closed" |
| `migrations.rs:613` (the reconcile's existence check) | `'default'`, hardcoded |

So for a **linked** install the write lands on one tenant and both readers look at another. The row
exists, the read does not find it, `Ok(None)` fails closed, `state: 'unavailable'` is projected, and
`unavailable` is not in `toolLock`'s open set — the 17-locked-cards home screen, reproduced on a
terminal that has just provisioned its own subscription row.

### Both sides of that mismatch are deliberate, which is why it is a defect

The write is not careless — `provisioning.rs:631-637` **requires** a non-empty `tenant_id` when
`mode == Linked` ("a linked install must name its licence-server tenant"), and the bridge's wire type
documents the field as *"The licence server's tenant id; required for `linked`"*
(`setup.rs:177-179`). The read is not careless either: the tablet's store DB is `default`-scoped by
construction, and the tenant-integrity gate in `state.rs` refuses to boot on a foreign-tenant row.
Each is right in isolation; together they never meet.

### Reachability, stated honestly

**Not reachable from the shipped UI today.** The bridge's own comment says a `local` install "sends no
`tenant_id`", and `git grep` over `ui/src` finds no `'linked'` written anywhere — so every current
provisioning call takes the `unwrap_or("default")` path and the row matches the reader. The `linked`
branch nevertheless exists in the core, is covered by tests (`provisioning_tests.rs:528-542`), and
validates its tenant — so this is a trap armed for the next caller, not a live failure.

That distinction is the whole report: it is **not** a reason to block the in-flight change, and it is
**not** noise either. Whoever wires the linked path will hit it, and the symptom will look like the
original defect rather than a tenant-key mismatch.

**Suggested shape of a fix, not applied here** — the in-flight `provisioning.rs` was another session's
uncommitted work, so changing it was not this session's to do. Either write `'default'` unconditionally
in Step 5b (matching what both readers and the reconcile all assume, and what a `local` install means),
or make the read tenant-aware; the first is smaller and matches the store-DB scoping the
tenant-integrity gate already relies on.

### The mismatch is now PROVEN, not merely read

Added a test that provisions a linked install (`tenant-abc`, `cred-1`) and asserts both sides of the
disagreement. It passes:

```
test db::provisioning::tests::a_linked_provision_keys_its_subscription_row_to_the_linked_tenant ... ok
test result: ok. 32 passed; 0 failed
```

It asserts the write leaves exactly `["tenant-abc"]` in `tenant_subscription`, and that the
`'default'` row — the only one `entitlements.rs` looks for — is **absent** (`COUNT(*) = 0`). So the
claim is not an inference from two code reads; it is an executed observation that a linked install
provisions itself into a state its own capabilities read cannot see.

The test asserts the **current** behaviour deliberately, with that stated in its doc comment: it is a
tripwire that fails loudly if either side moves, not an endorsement. Committed as `6111e9983`.

## ROUND 18 CORRECTION: the linked path IS reachable — the round-17 severity was wrong

Round 17 concluded the tenant-key mismatch was "not reachable from the shipped UI today", and rested
that on two things: `git grep` over `ui/src` finding no `'linked'` string, and the bridge's comment that
a `local` install sends no `tenant_id`. **Both were true of the strings I searched and false of the
feature.** The linked path has a UI, and the mismatch is live.

### What the grep missed

The search looked for the literal `'linked'` in quotes. The flow stores it in a variable and never
spells it that way, so nothing matched:

| Evidence | Line |
|---|---|
| A selectable "Link your kasir.mu account" card, `data-testid="provision-mode-linked"` | `ProvisioningFlow.tsx:668-677` |
| The parallel `provision-mode-local` card it sits beside | `:679-691` |
| An account-linking step gated on the mode | `:697-706` |
| **The submit that carries the tenant** | `:555` — `tenant_id: provisionMode === 'linked' ? (linkedAccount?.tenantId ?? null) : null` |
| `mode` sent from the same state | `:554` |

So a merchant chooses Linked, signs in, and `provision_device` is called with `mode = Linked` and a real
`tenant_id` — which is exactly the input that makes Step 5b write `tenant_subscription` under a tenant
`entitlements.rs:325` never reads (`TenantSubscription::load(self.conn, "default")`).

**The generalisable error:** I treated a grep for one spelling as evidence about a feature. A negative
grep result constrains the strings, not the behaviour — and the ADR I checked next agreed with me for a
reason that had also expired.

### ADR-56's status line is stale on this point

`docs/decisions/2026-09-21-adr56-first-run-provisioning.md` states, in its own status line, that
§2.3's `identify` leg for the `linked` tier **is NOT implemented** — *"The manual email identity step has
no UI on either shell"* — and cites `ProvisioningFlow.tsx:104` as where "only `'local'` is currently
sent". Three observations:

1. The claim is **falsified by the tree**: there is a linked card (`:668-677`), a linked branch
   (`:697-706`), and a linked submit (`:555`).
2. The cited coordinate is **wrong** even as a coordinate: `ProvisioningFlow.tsx:104` is a blank line
   inside a doc comment, not a send of any mode.
3. Its companion citation, `ui/src/api/settings.ts:151`, **is** exact
   (`export type ProvisioningMode = 'local' | 'linked';`).

I did not edit the ADR — it is not this report's file and the status line carries its own audit trail.
Flagged here because the next reader who checks that line will otherwise conclude the linked path is
unshipped, which is the same conclusion that shaped round 17.

### What this does to round 17's conclusion

The mismatch itself stands, and is now **worse than described**: it is reachable by a merchant through
the shipping first-run flow, not armed for a future caller. The proving test from round 17
(`6111e9983`) is unaffected and still passes — it asserts the row the current code writes.

### The consequence, and why it is worse than "latent"

Two facts make this a first-run defect rather than a future trap:

1. **`linked` is the DEFAULT mode.** `ProvisioningFlow.tsx:184` is
   `useState<ProvisioningMode>('linked')`, and the card is placed first with the comment *"The linked
   card is FIRST because it is the default: the free plan attaches to an account, and the recommended
   path should not sit second behind the exception."* So a merchant sees Linked preselected, not Local.
2. **No tablet-side reader can see the row it writes.** Every tablet reader hardcodes `"default"` —
   `entitlements.rs:325` (`TenantSubscription::load(self.conn, "default")`), `auth.rs:672`,
   `history.rs:79`, and the reconcile's own check at `migrations.rs:613`. The only dynamic-tenant
   caller is the **cloud** API (`kasirmu-api/src/routes/products.rs:282`), which is not the tablet.
   The account's tenant comes from the licence server (`resp.tenant_id`), so it is a real per-tenant
   id, not `'default'`.

Together: a merchant who takes the **preselected** path and completes account linking gets a terminal
whose subscription row exists, is active, is Free, and is invisible to the read that decides whether
the tools unlock. The capabilities read returns `Ok(None)`, fails closed, projects `unavailable`, and
the home screen locks all 17 cards with no explanation — the original defect, on the recommended
onboarding path.

**This is not a claim I could verify on hardware** (the device is off the network) and it is not
observable from a unit test of the write alone, since the write is correct in isolation. It follows
from the four reader sites above, all of which were read rather than inferred.

## ROUND 19: Step 5b contradicts the reconcile's own design — it is not just the wrong tenant

Rounds 17-18 reported the tenant-key mismatch. Reading the reconcile's guard-1 justification shows the
defect is **broader and better-grounded** than a key mismatch: Step 5b writes a bootstrap row for an
install the reconcile deliberately refuses to write one for.

### The two code paths disagree about whether a linked install gets a row at all

| | Test applied | Outcome for `linked` |
|---|---|---|
| Reconcile (`migrations.rs:604`) | `SELECT EXISTS(... WHERE provisioning.mode = 'local')` | **refuses** — returns `Ok(false)`, writes nothing |
| Step 5b (`provisioning.rs:526-531`) | none — `args.tenant_id.unwrap_or("default")` | **writes** a `BOOTSTRAP_FREE` row |

And the reconcile says why, in its guard-1 doc (`migrations.rs:577-580`), verbatim:

> A `linked` install's entitlement is **the server's grant**, and a missing row there is an anomaly
> that must keep failing closed — writing Free would also **risk pre-empting the real grant**.

Step 5b's own comment (`provisioning.rs:523`) invokes the *same* premise — *"ADR #56 §2.4: `local` is a
supported permanent Free tier"* — and then applies it regardless of mode. The comment describes a
`local`-only rule; the code has no such condition. That is the defect: not a wrong constant, a missing
guard.

### Why this is worse than the tenant mismatch it subsumes

The tenant mismatch is a symptom. The cause is that Step 5b never asks `args.mode`, so for a linked
install it:

1. writes a row under the linked tenant — which **no tablet reader looks at** (`entitlements.rs:325`,
   `auth.rs:672`, `history.rs:79`, and the reconcile all use `"default"`), and
2. plants a **local `BOOTSTRAP_FREE` grant where the design says the server's grant belongs**, which is
   the exact "pre-empting the real grant" the reconcile's guard exists to prevent.
So the linked terminal is simultaneously locked (nothing reads its row) and holding a row that
contradicts the entitlement model (something local claims to be its entitlement).

### Reachability is unchanged from round 18 — it is the default path

`ProvisioningFlow.tsx:184` initialises `provisionMode` to `'linked'`, and `:555` sends the account's
`tenantId`. Nothing here narrows that; the guard analysis only explains the mechanism better.

### The fix, and why it is not applied here

The change is one guard — Step 5b should write only when `args.mode == ProvisioningMode::Local`,
mirroring `migrations.rs:604` — which also removes the tenant question entirely, since a `local`
install's tenant is `None` and therefore `"default"`, the value every reader uses.

**Not applied: that edit is inside another session's uncommitted hunk.** The whole `provisioning.rs`
delta is 11 added lines in one hunk (`@@ -519,6 +519,17 @@`) and it *is* Step 5b; a pathspec commit
would carry their work under my message, which `AGENTS.md` §7.3 forbids. The finding is recorded
precisely so whoever lands that hunk can apply the guard, and so a reviewer of it has the argument in
front of them.

## ROUND 20 CORRECTION: the Step 5b defect is in UNCOMMITTED work — HEAD is correct

Rounds 17-19 called this a *"live first-run defect on the recommended path"*. **That was overstated**,
and the check that corrected it is one line: whether the committed tree contains the offending write.

```
tenant_subscription references in HEAD's provisioning.rs  : 0
tenant_subscription references in the file on disk       : 1   (the peer's uncommitted Step 5b)
```

So the defect exists **only in another session's work-in-progress**. Nothing in HEAD is wrong:

- HEAD's `provision_device` writes no subscription row at all, as it always has.
- HEAD carries the committed reconcile (`d35555bca`), which repairs a **local** install at boot and
  deliberately refuses a linked one (`mode = 'local'` guard). So the shipping tree is correct for the
  case the shipping UI actually provisions.
- The linked gap arrives only if and when Step 5b lands unguarded.

**What was right and what was wrong in the earlier sections:** the mechanism is exactly as described —
Step 5b's missing `args.mode` guard, the contrast with the reconcile's guard 1, and the risk of
planting a local `BOOTSTRAP_FREE` grant where the server's belongs. What was wrong was the **tense**:
those sections speak of the defect as present, when it is proposed. Read them as a review of a pending
change, not as a report of shipped behaviour.

### This is a review note, and that is its correct form

The consequence for how the finding should travel: it is not a bug to fix in HEAD, it is an objection
to a pending hunk. The right recipient is whoever lands `provisioning.rs`, and the right action is to
add the guard **in that hunk** — which is also why this session could not do it without sweeping their
work into a commit of its own (`AGENTS.md` §7.3: *"A path that is dirty with content that is not
yours: stop and say so."*).

**Observation worth recording:** both contested files have gone quiet — `provisioning.rs` last written
74 minutes before this round, `WorkspaceHome.tsx` 35 minutes. Holding a fix four rounds pending an
abandoned hunk is itself a cost, and the guard belongs to whoever owns that hunk rather than being
permanently deferred to this report. If the hunk is still uncommitted when it is next read, the
cleanest resolution is for a session that owns both halves to land them together.

### The defect now has a tripwire, in the repo's own idiom

Since the fix belongs in another session's hunk, the useful artefact is one that fails the moment
that hunk lands unguarded. Added as an `#[ignore]`d characterisation test, following the precedent
already in this crate (`products_stock_adjust_tests.rs` records a test ignored *"as a CHARACTERISATION
of the loss"*, later *"un-ignored and INVERTED"* when its fix landed):

```
a_linked_provision_leaves_no_bootstrap_subscription_row ... ignored, characterises the pending Step 5b defect
test result: ok. 32 passed; 0 failed; 1 ignored
```

Ignored rather than live because it **fails today** — and would leave a red build for whoever is
editing `provisioning.rs`. Run explicitly, it demonstrates the defect mechanically:

```
cargo test -p kasirmu-core --lib a_linked_provision_leaves_no_bootstrap_subscription_row -- --ignored
assertion `left == right` failed: ... provision_device must not write a local BOOTSTRAP_FREE row
  left: 1
 right: 0
```

One row written for a linked install, against an invariant of zero.

**The invariant is not invented here.** `migrations_tests.rs`'s
`reconcile_leaves_a_linked_install_to_the_server_grant` already asserts it — *"a linked install's
entitlement is the server's, and a missing grant must keep failing closed"* — for the reconcile's path.
What was missing is the same assertion at the **other entry point**, because the two run through
different functions and neither test covers the other. This closes that asymmetry. The test needs no
edit when the guard lands: a local-only write leaves a linked install with no row, so it passes
unchanged, and only its `#[ignore]` comes off.

### The tripwire exposed a contradiction in this session's own earlier test

Round 17 added `a_linked_provision_keys_its_subscription_row_to_the_linked_tenant`, which **passed** by
asserting the buggy row. Round 20 added the ignored tripwire asserting **0** rows. Those two cannot
both survive the fix, and the round-17 one is the worse kind of stale: it passes today, so nothing
flags it, and its **name** ("keys its subscription row to the linked tenant") endorses the defect as a
property. When the guard lands it would fail, and the failure would read as a regression rather than as
the correction it is.

Consolidated into the single ignored test, which now asserts the **invariant** rather than the current
row — so it needs no edit when the guard lands, only the `#[ignore]` removed. Net effect: **20
insertions, 64 deletions**, with the diagnostic documentation preserved (`67c1fe483`).

```
test result: ok. 31 passed; 0 failed; 1 ignored
```

Both directions re-checked after the change: the local case still passes (no regression), and the
consolidated test still fails when run explicitly with `left: 1, right: 0` (still characterising).

**The pattern worth naming:** a characterisation test that PASSES is a liability unless it is marked as
one. The round-17 version looked like a normal assertion of expected behaviour, and would have punished
the fix. The round-20 form is the same instinct as the repo's own precedent — ignored, named for the
defect, and asserting the direction that must become true.

## ROUND 22: the tripwire was undiscoverable, and this file had no usable status line

Two defects in this session's own artefacts, both found by asking "who reads this, and what do they
see?"

### The tripwire could not be acted on by the person who would hit it

Round 21 consolidated the linked-provision test into an `#[ignore]`d characterisation — and in doing so
dropped the reference to this document, while leaving an `#[ignore]` reason that named neither the fix
nor where to read about it. Measured:

```
reason before : "characterises the pending Step 5b defect: a linked install must get no bootstrap row"
reason after  : "pending Step 5b defect: provision_device must add the args.mode == Local guard;
                then remove this #[ignore]. See
                todo-tablet-provisioned-workspaces-invisible-to-picker.md"
```

**And the comparison that makes the point:** of the 15 `#[ignore]`d tests in this repo, every other one
is ignored for an **environmental** reason — needs Python, needs a D-Bus service, is a child probe run
by a parent. This is the only one ignored for a **code defect**. Environmental ignores stay valid
forever and need no follow-up; a defect-characterisation becomes stale the moment the fix lands, and
nothing in CI reports ignored tests (`git grep` over `.github/` and `scripts/` finds no `--ignored`
run). So the artefact had to carry its own instructions, and now does.

### This file had no usable status line

They are stale in the opposite direction now: the audit stamp read *"both defects proven, **neither
fixed**"*, and the summary blockquote described defect 2 as an open lock-out — while the header of
every round-16-onward section records fixes landed by other sessions.

Worse, the file is a **22-round working log in non-chronological order**: round 15 appears three times
(at :1300, :1344 and :1377), two sections are both headed "What was measured", and two are both headed
"Acceptance for a repair". A reader following it top to bottom reaches the 17-lock-out description long
before the fix, with nothing to say so.

Both fixed at the top of the file rather than by reordering 1,800 lines, which would risk losing the
corrections the log exists to preserve. The stamp now leads with the current state of each defect, this
session's own work and its commit status, the one open defect, and the device situation, plus an
explicit instruction not to read the body chronologically (`6047b8960`).

## ROUND 23: the peer's uncommitted quick-cards bypass the app's own activation path

Reading the hunk that blocks this session's work turned up a defect in it. Recorded because the hunk
is about to land and the finding is cheap to act on now, expensive later.

### The quick cards call the setter directly instead of `activateWorkspace`

Every other way into a workspace goes through one function (`WorkspaceHome.tsx:534-544`):

```ts
const activateWorkspace = useCallback((key: string): boolean => {
  if (!canAccess(key)) return false;          // 1. permission
  navigateWithExit(() => {
    recordLastUsed(key);                      // 2. last-used tracking
    setActiveWorkspace(key);                  // 3. the actual switch
  });
  return true;
}, [...]);
```

The two quick cards call `setActiveWorkspace` **raw**, skipping the wrapper entirely:

| Site | Call |
|---|---|
| `:791` (Retail POS quick card) | `onClick={() => setActiveWorkspace('store-pos')}` |
| `:813` (Restaurant POS quick card) | `onClick={() => setActiveWorkspace('restaurant-pos')}` |

Three consequences, all mechanical:

1. **No exit transition.** `navigateWithExit` (`:468-481`) sets `isExiting` and defers the switch by
   `animDuration(150)`; the raw call switches immediately, so the crossfade those cards are meant to
   participate in does not fire.
2. **No `recordLastUsed`.** The `lastWorkspace` field stops being updated when a merchant enters via a
   quick card, so "resume where you left off" silently degrades for exactly the users taking the
   shortest path.
3. **No `canAccess`.** In this revision the predicate is role-agnostic — it admits every known role and
   refuses only an unrecognised `roleName` (`:494-508`) — so the practical exposure today is a
   default-case role, not a normal one. It is still a bypass of the single chokepoint, and it stops
   being harmless the moment that predicate grows a real rule.

### Also inert: `workspace-card--quick` has no stylesheet rule

`git grep -rn 'workspace-card--quick' -- ui/` returns **only the two JSX sites**. There is no rule in
`WorkspaceHome.css` (which does define the base `.workspace-card` at `:330` and the sibling
`ws-color-store-pos` at `:19`). So the class name is currently decorative — either the intended visual
treatment is missing or the class is dead and should go.

And neither card has a test: `git grep -rn 'workspace-card-quick' -- ui/` finds the two `data-testid`
attributes and nothing else, so the `data-testid`s exist for queries that were never written.

### Worse than a bypassed chokepoint: the cards ignore the disabled-card contract

The real cards treat an inaccessible workspace as **non-interactive**. `:920` computes
`const disabled = !canAccess(ws.type_key)` and, for a disabled one, returns a plain `<div>` carrying a
"Not available" badge (`:923-951`, localized via `workspace-card-no-access-aria`). It is not a button;
it cannot be activated, and it says so.

The quick cards are unconditional `<button>`s (`:786-792`, `:810-816`) with no `disabled` gate and no
badge. So for a `roleName` the predicate refuses — its `default` arm — the same screen shows the real
cards correctly marked "Not available" **and** two live buttons that will switch into the same
workspaces. The inconsistency is the point: it is not that a guard was skipped in passing, it is that
one of the two card renderers implements the access contract and the other does not.

### And a localization defect the linter does not catch

Both quick cards hardcode an English `aria-label` in the JSX — `aria-label="Retail POS"` (`:792`) and
`aria-label="Restaurant POS"` (`:814`) — where every real card routes through `l10n.getString`
(`workspace-card-open-aria` at `:962`, `workspace-card-no-access-aria` at `:929`). AGENTS.md §6.3
requires all user-visible strings via `@fluent/react`, and an `aria-label` is user-visible to a screen
reader.

**Measured: `npx eslint src/features/workspaces/WorkspaceHome.tsx` passes clean with those literals in
place.** `eslint-plugin-jsx-a11y` is configured (`ui/eslint.config.js:5,16`) and does not flag them, so
the rule is real but unenforced at this site — and a reviewer running the gates would see green. That
is worth knowing independently of these two cards: any hardcoded English `aria-label` added anywhere
ships unchallenged.

### Why this is recorded rather than fixed

Same constraint as the other two findings on this hunk: it is another session's uncommitted work, and a
pathspec commit would carry the whole file. The fix is small and stated here — route both cards through
`activateWorkspace`, and either define `workspace-card--quick` or drop it — so whoever lands the hunk
can apply it in one pass. Nothing in HEAD is affected: the cards do not exist there.

## ROUND 24: ADR-56's status line is false, and its own audit stamp says it never checked

Round 18 flagged this in passing as "stale". Audited properly against the current tree, it is a
**major doc drift**, and the mechanism is more interesting than the error.

### The claim, and its two falsifications

`docs/decisions/2026-09-21-adr56-first-run-provisioning.md:23-25` states:

> §2.3's `identify` leg for the `linked` tier. **The manual email identity step has no UI on either
> shell**; `ProvisioningMode = 'local' | 'linked'` exists (`ui/src/api/settings.ts:151`) and **only
> `'local'` is currently sent** directly from the wizard (`ui/src/features/setup/ProvisioningFlow.tsx:104`).

Both halves are false, and neither needs inference:

| Claim | Measured |
|---|---|
| "no UI on either shell" | `linkedAccount` state (`:219`), a `tabletTab: 'pair' \| 'email'` toggle **defaulting to `'email'`** (`:235`), `email`/`emailState` state (`:221`,`:223`), `requestDeviceLinkCode(email)` (`:340`), and a rendered `<label htmlFor="provision-account-email">` + input (`:867`,`:873`) |
| "only `'local'` is currently sent" | `:554` sends `mode: provisionMode`, and `:555` sends the account's `tenantId` when it is `linked` |
| the citation `ProvisioningFlow.tsx:104` | line 104 is `/**` — a doc-comment opener, not a mode send of any kind |

`ui/src/api/settings.ts:151` is exact (`export type ProvisioningMode = 'local' | 'linked';`), so the
claim was well-sourced when written; it is the world that moved.

### The timeline makes this an audit finding, not a rot finding

```
2026-09-22  99f0c6b0a  feat(licensing): add tablet device pairing UI and mode 1 vs 2 provisioning
                       (ADR #56 §2.3/§2.5)   <- the linked UI ships here
2026-09-29  1a0fdf53e  docs(decisions): audit and stamp ADRs 45, 46, 48, 49, 56, 57
                       (its diff re-dated the ADR's footer from 22-09 to 29-09)
```

Seven days separate them, and the stamp's reachable text still says the UI does not exist. Worse, the
audit's own stamp records why:

> **NOT re-measured: the identify leg for the linked tier**, which the status line states is the
> outstanding item and which this pass did not attempt to adjudicate.

So the pass **declined the one check that would have falsified the line**, while praising it — "the
status line is the most useful kind: it enumerates exactly which sections are IMPLEMENTED, names the one
that is NOT" — and stamped the document as audited. The claim was already false on the day it was
certified. That is the failure mode worth recording: a status line earns trust by naming what is
missing, and that trust is exactly what stops anyone re-measuring it.

### Classification, by the docs-auditor table

**Doc Drift (major) — High.** Its row covers "Wrong API signature, wrong config key, feature removed";
this is the same class in the opposite direction: a feature documented as **absent** that has shipped.
By the skill's threshold table that is a blocking finding (≥1 major doc drift).

### What I did and did not do

Recorded, not repaired. `docs-auditor`'s pre-flight requires a clean working tree, and this checkout
carries two other sessions' uncommitted hunks — so an audit edit to a decision record would be made
from a dirty tree against the skill's own §8.1. The correction is also not mechanical: the status line
enumerates which sections are implemented, so updating it means restating §2.3's actual state, which is
the author's call and not a drive-by edit. Flagged here with the evidence, the timeline, and the
classification so the next audit starts from them.

## ROUND 25: the in-flight read-repair for defect 1 has three mechanical problems

Defect 1 — the one this file opens with — is **being fixed right now** in
`crates/kasirmu-bridge/src/workspaces.rs` (uncommitted, 34 insertions). The approach is a read-repair:
when the store DB's `list_workspaces` returns nothing, read the global DB and copy the rows across.
That is the right shape. The implementation has three problems, each checkable against the schema.

### 1. The copy is a loop of unwrapped single statements — no transaction

```rust
for r in &global_rows {
    let _ = db.execute(
        "INSERT OR IGNORE INTO workspace_instances (...) VALUES (?1, ...)",
        rusqlite::params![...],
    );
}
```

`AGENTS.md` §6.4 is a MUST: *"DB Writes — **ALWAYS use `rusqlite` transactions** for database writes."*
Each `execute` here is its own implicit transaction, so a failure part-way leaves the store DB holding
some of the copied rows and not others — and nothing reconciles that, because the repair only runs
while the table is **empty** (`rows.is_empty()`). A partial copy therefore stops the repair from ever
running again: the next call sees a non-empty table and returns the incomplete set. That is the
failure mode worth naming, because it is silent and self-perpetuating.

### 2. The error is discarded, and foreign keys are ON

`let _ = db.execute(...)` throws away every error, including constraint violations. The INSERT omits
`store_id`'s referent: `workspace_instances.store_id` is `TEXT NOT NULL REFERENCES
store_profiles(id)` (`20260813_init.sql:986-988`), and `foreign_keys = ON` is set on every connection
path (`migrations.rs:485`, applied by `run()`). So when the store DB has no `store_profiles` row for
`r.store_id`, each INSERT fails — and the failure is swallowed, leaving `rows = global_rows` reporting
success while the store DB stays empty. The merchant sees workspaces until the next boot, then not.

### 3. Columns the originals carried are not copied

The INSERT sets `(id, type_key, location_id, name, description, status)` and takes the schema's
defaults for the rest. Two of the omitted columns are not cosmetic: `bound_location_id`
(`:996`, `REFERENCES inventory_locations(id)`) is the store-scoping column this whole defect is about,
and `purpose_key` (`:997`, `NOT NULL DEFAULT 'general'`) decides how the row is classified. So repaired
rows are distinguishable from native ones, and any query filtering on `bound_location_id` will not see
them.

### What this does and does not change about this file's opening claim

The opening section describes defect 1 as *"provisioning writes the global DB, the picker reads a
per-store DB"*. That remains the diagnosis, and the repair confirms it — the fix exists precisely
because the two databases diverge. What changes is only its status: **a fix is in flight**, so defect 1
should no longer be read as unaddressed. Its three problems above are review notes on that fix, not a
reopening of the diagnosis.

**Measured, not inferred:** the schema lines, the `foreign_keys` pragma and its application point, and
the in-flight diff were each read in this pass. The consequence in (2) follows from the FK being
enforced, which the pragma establishes — but it was **not** reproduced against a database, because
constructing a store DB without its `store_profiles` row needs the device or a purpose-built fixture,
and neither was available.

## ROUND 26: the read-repair is MEASURED — it returns the row but does not persist it

Round 25 reviewed the in-flight read-repair by reading it and predicted that its swallowed error
(`let _ = db.execute(...)`) could leave the store DB empty while the call reported success. **That
prediction is now reproduced**, by a test written for the branch the fix exists for.

### The measurement

A test was added that builds the production state exactly — a row in the global DB, an empty store DB
— and calls the function the picker actually uses:

```
assertion 1: the repair must return the global row for an empty store db   -> PASSES
assertion 2: the repair must persist the row into the store db             -> FAILS
  left: 0
 right: 1
```

So `list_workspaces` **returns** the global rows (the picker shows workspaces) while the store DB stays
**empty**. On the next boot the repair runs again against the same empty file. That is not a crash and
not a wrong screen — it is a repair that never lands, which is why reading the code alone could only
suggest it.

### Why it does not persist, and how the prediction was confirmed

The INSERT is `INSERT OR IGNORE INTO workspace_instances (id, type_key, location_id, name, description,
status)`, and `location_id` is `REFERENCES locations(id)` (`20260813_init.sql:986-988`, after
`20260906_rename_store_to_location.sql:18` renamed the column). When the target row is absent the FK
rejects the insert — and `let _ =` discards the error, so nothing surfaces. The test's fixture deletes
the `locations` row to reach that state; the store DB is consequently empty and stays empty.

### The finding that came out of building it: the repair is on ONE of two entry points

Writing the test surfaced something the file-level read had hidden. The repair is in
**`list_workspaces` (`workspaces.rs:109`)**, not in `list_workspaces_for_store_scoped` (`:733`). The
first attempt called the sibling and got `[]`, which is the honest result: **that function has no
repair at all.**

Which one matters was then checked rather than assumed. The picker calls the repaired one:
`ui/src/contexts/WorkspaceContext.tsx:329` -> `listWorkspaces()` (`ui/src/api/workspaces.ts:179-187`)
-> the `list_workspaces` command. So the fix **does** reach the reported defect. The sibling is the
terminal-management screen's cross-store picker (`apps/desktop-tauri/src/commands/workspaces.rs:261`),
and a terminal opened through **that** path still shows an empty grid.

**Not fixed here.** Both the repair and its gap are in another session's uncommitted hunk, which
`AGENTS.md` §7.3 keeps out of this session's commits. What this round adds is the measurement the
review could not make, and the two entry points it identified.

### ROUND 27: the asymmetry is now measured, not read

Round 26 identified the two entry points by reading them and asserted the sibling had no repair. That
is now a test rather than a claim — same fixture, both functions:

```
list_workspaces_repairs_from_global_when_the_store_db_is_empty   -> returns the global row
list_workspaces_for_store_scoped_has_no_read_repair              -> returns []
```

The second passes, which is the point: it pins the divergence. Its message says what to do if it ever
fails — *"If this ever returns the global row, the repair was extended here too — good, and this test
should then assert the repair instead."* So it is a fence against the gap silently persisting, not an
endorsement of it.

Suite state after this: **26 passed, 1 ignored** in `kasirmu-bridge`.

**Why the sibling matters, restated precisely:** the picker path is repaired (so the reported defect is
addressed for the flow it was measured on), and the cross-store picker used by the terminal-management
screen is not. A merchant who opens a terminal through that screen still sees an empty grid, and would
report the same defect again.

### The fix direction, checked rather than assumed

Round 26 named the cause (an FK-rejected write whose error is discarded) without proving the repair
would work once the error is surfaced. Two things settle that:

1. **The fixture is realistic.** Deleting the store DB's `locations` row is the right way to model the
   missing target, and it is what a store DB for an unprovisioned location would hold. The fixture's
   own `INSERT INTO locations (id, name) VALUES (...)` matches the idiom this repo already uses for the
   same fixture (`migrations_tests.rs:1011`, `:1587`).
2. **`locations` is the right table.** `20260906_rename_store_to_location.sql:14` is
   `ALTER TABLE store_profiles RENAME TO locations` — so the FK target is the renamed table, not a
   missing one. My first fixture attempt failed with `no such table: store_profiles` for exactly this
   reason, which is what prompted the check.

So the repair has two defects, and they need different fixes:

| Defect | Fix |
|---|---|
| The write's error is discarded (`let _ =`) | propagate it, so a failed repair is visible rather than silent |
| The write can fail on a missing FK target | ensure the `locations` row exists in the store DB first, or write only the columns that need no target |

Surfacing the error alone would turn a silent no-op into a loudly failing repair; it does not make the
rows land. Both are needed, and the second is why `INSERT OR IGNORE` does not save it — `OR IGNORE`
covers uniqueness conflicts, not foreign-key violations.

### The `OR IGNORE` claim, measured

The paragraph above says `INSERT OR IGNORE` does not save the write. That is a claim about SQLite, so
it was run rather than reasoned about:

```python
c.execute('PRAGMA foreign_keys = ON')
c.execute('CREATE TABLE parent (id TEXT PRIMARY KEY)')
c.execute('CREATE TABLE child (id TEXT PRIMARY KEY, pid TEXT NOT NULL REFERENCES parent(id))')
c.execute("INSERT OR IGNORE INTO child (id, pid) VALUES ('c1','missing')")
```

```
ERROR RAISED: IntegrityError FOREIGN KEY constraint failed
child rows after OR IGNORE: 0
```

So `OR IGNORE` covers uniqueness conflicts and **not** foreign-key violations — the statement still
raises, and the table is still empty. That matches the read-repair's measured `left: 0` exactly, and it
is why the repair cannot be fixed by surfacing the error alone: the write will keep failing until its
FK target exists.

## ROUND 28: the read-repair's failure is PRODUCTION behaviour, not a fixture artefact

Round 26 measured that the repair does not persist its rows, then had to allow that the fixture might
be modelling a state production never reaches — its doc said the consequence "follows from the FK
being enforced… but it was **not** reproduced against a database". That caveat is now closed, and the
answer is the worse one.

### Nothing in production writes a `locations` row into a store db

The repair inserts into `store-<id>.sqlite`, where `workspace_instances.location_id` is
`REFERENCES locations(id)`. For that to succeed, the store db must already hold the row. It does not:

| Evidence | Finding |
|---|---|
| `kasirmu-bridge/src/setup.rs:370` | `let db = ctx.lock_global().await;` — provisioning is handed the **global** db |
| `provisioning.rs:486-499` | the `INSERT INTO locations` runs on that connection, so the row lands **globally** |
| `create_location_profile` callers | **not** all tests — `kasirmu-bridge/src/locations.rs:235,278,304` are production, and they write via `resolve_scope` |

**That last row corrects an overstatement made earlier in this section.** Those production callers go
through `ctx.resolve_scope`, which returns the **store** db (`ctx.rs:389-392`, `open_store`), so
`create_location_profile_scoped` *does* write a `locations` row into a store db — when a merchant
creates a location through Settings, which the command gates on `permissions::SETTINGS_EDIT`.

So the failure is **conditional**, not universal:

| Terminal | Store-db `locations` row | Repair's FK |
|---|---|---|
| freshly provisioned, Settings never opened | absent | **fails** — rows returned, none cached |
| merchant has created a location through Settings | present | succeeds |

The first case is the one this whole defect is about — the freshly provisioned terminal that lands on
an empty picker — so the repair is broken for exactly the terminals it was written for, and works for
ones that had already been past the problem. Stated that way it is a narrower claim than the first
draft's, and it is the one the evidence supports.

This is the split-brain restated from the other side: the defect is not only that the picker reads a
different file, it is that the two files' schemas disagree about what a workspace row's location even
*is* — and the repair tries to translate between them without creating the row it depends on.

### Pinned where the premise is created

Added a test at the provisioning end rather than at the repair end, so the fact is asserted where it
originates:

```
test db::provisioning::tests::provisioning_writes_its_location_to_the_global_db_not_a_store_db ... ok
test result: ok. 32 passed; 0 failed; 1 ignored
```

It asserts both halves — the location exists in the global db with the id the result names, **and** the
workspaces are written there too. Between this and round 26's ignored tripwire, the defect now has an
assertion at each end.

**Still not fixed**: the repair is another session's uncommitted hunk. But the finding is no longer
hedged — the fix has to create the FK target (or write only columns that need none) *and* stop
discarding the result, and the reason it must do both is now measured rather than argued.

## ROUND 29: the cause is isolated by a controlled comparison

Rounds 26-28 established the failure and the reason, but as two separate observations: the repair does
not persist, and its INSERT needs a `locations` row the store db lacks. A diagnosis built that way can
be consistent without being causal — the write might have failed for some other reason that happened to
correlate. This round removes that doubt.

### One variable, two outcomes

Added the complement of round 26's test. The two fixtures are identical except for a single line:

| Test | `DELETE FROM locations` | Persisted rows |
|---|---|---|
| `list_workspaces_repairs_from_global_when_the_store_db_is_empty` | yes | **0** |
| `the_read_repair_persists_when_its_fk_target_exists` | no | **1** |

Same global row, same emptied `workspace_instances`, same `list_workspaces` call, same picker ticket.
The only difference is whether the FK target exists — and it flips the outcome. That identifies the
missing target as the cause rather than a correlate.

```
the_read_repair_persists_when_its_fk_target_exists ... ok
test result: ok. 27 passed; 0 failed; 1 ignored   (kasirmu-bridge, workspaces)
```

The new test is un-ignored because it passes: it describes behaviour that is correct. The round-26
test stays ignored because it describes behaviour that is not.

### It also describes a state a real merchant has

Not a contrived fixture: `create_location_profile_scoped` writes a store-db `locations` row (via
`ctx.resolve_scope`, `ctx.rs:389-392`), so a merchant who created a location through Settings has
exactly this row and the repair works for them. That is the round-28 conditional, now demonstrated on
both sides of the condition.

**What the pair now says, in one sentence:** the read-repair caches its rows exactly when the store db
already has the location — that is, for terminals that had already worked around the defect — and
silently does nothing for the freshly provisioned ones it was written for.

## ROUND 30: every remaining path is blocked, and this is what unblocks each

Rounds 16-29 were productive without hardware: five defects were characterised, four of them with tests,
and the two that were measured rather than read (the read-repair's swallowed write, the linked-path
tenant mismatch) are the ones most likely to have been missed by inspection alone. But every remaining
path now needs something this session does not have, and the situation will not improve by continuing.

### The inventory, exhaustively

| Path | Blocked by | Blocked since round |
|---|---|---|
| Device verification (CDP, screenshots, `kasir.db` reads) | tablet off the LAN | 15 |
| The notice's JSX (implemented, device-verified, tested) | `WorkspaceHome.tsx` contested | 12 |
| Step 5b's `args.mode` guard | `provisioning.rs` contested | 17 |
| The quick cards' four defects | `WorkspaceHome.tsx` contested | 23 |
| The read-repair's two defects | `workspaces.rs` contested | 25 |

Nothing tablet-related is outside this list. What remained reachable — tests and analysis *of* those
items — is what rounds 16-29 spent, and each round has less left to add than the one before.

### The concrete condition, stated so it can be acted on

**Three files carry 128 uncommitted insertions between them, all last written between 08:17 and 08:56,
and all under this repository's own commit identity.** They are not another user's work-in-flight that
might resume; they are finished-looking changes that stopped. `AGENTS.md` §7.3 forbids committing a path
whose working-tree content is not wholly yours, and its instruction for exactly this case is unambiguous:
*"A path that is dirty with content that is not yours: stop and say so."* That is what this section is.

**What unblocks each item, precisely:**

| File | Insertions | Land it and you unblock |
|---|---|---|
| `crates/kasirmu-core/src/db/provisioning.rs` | 11 | Step 5b — add an `args.mode == Local` guard while landing it (rounds 17-20); the ignored tripwire in `provisioning_tests.rs` tells you when you have |
| `crates/kasirmu-bridge/src/workspaces.rs` | 40 | The read-repair — it needs its FK target created and its discarded `Result` surfaced (rounds 25-29); two tests in `workspaces_tests.rs` bracket it |
| `ui/src/features/workspaces/WorkspaceHome.tsx` | 83 | This session's notice JSX (39 of those lines) plus the quick cards, which bypass `activateWorkspace`, ignore the disabled-card contract, ship a hardcoded English `aria-label`, and use a class with no CSS rule (rounds 12-23) |

### What is already secure, and does not need a rescue

Stated because a reader seeing "blocked" may assume more is at risk than is. Everything of this
session's that *can* be committed, is:

- the notice's Fluent strings (`bcb4a5452`) and its tests (`ba69f826f`);
- the provisioning tests (`e8b2726f8`, `31c0526db`);
- the linked-provision tripwire, consolidated and self-describing (`d8dade5dc`, `67c1fe483`, `37bce3c9e`);
- the read-repair's three tests, including the controlled comparison that isolates its cause
  (`4c190e704`, `f9a685618`, `6b54c7e55`);
- and the notice's CSS, swept into a peer's `268440251`.

The only artefact that exists **solely** in the working tree is the 39-line notice JSX, and it is also
recorded verbatim in this file ("ROUND 15: the uncommitted block is now recorded verbatim"), so it is
recoverable even if that file is discarded.

## ROUND 31: DEVICE RESULTS — the lock-out is a STALE CONTEXT, not a missing row

The tablet came back this round and the whole chain was walked on hardware. **It overturns the model
this document has carried since round 4**, so read this section before any of the root-cause sections
above.

### What was done

A genuinely fresh install (`kasir.db` recreated 09:59; `provisioning`, `tenant_subscription`,
`workspace_instances`, `users` all zero rows). The dev server was started and reachability proved from
the tablet (`curl` -> `200`). The app was driven through the shipping first-run flow over CDP:
**"Offline only"** (the `local` path), store type retail, owner `budi` / PIN `1234`, then Finish setup.

Provisioning succeeded and the app advanced to `staff-login-screen` — the correct ADR-56 order.

### The rows ARE written, and the backend agrees

```
get_subscription_capabilities: {state: "active", status: "active", tier: "free",
                                 expiresAt: null, isExpired: false, ...}
get_license_status:           {isActive: true, status: "valid", tier: "free"}
```

So `provision_device`'s Step 5b writes the row, the capabilities read *finds* it, and **both** commands
report an active licence. Round 4's premise — "the capabilities read requires a `tenant_subscription`
row and fails closed without one, and no tablet path can write it" — no longer holds, and had already
stopped holding when the two-halves fix landed.

### But the UI still locked all 17 tools — and the reason is a STALE PROVIDER

Immediately after provisioning, with no reload:

```
caps (direct command call): active, tier free        <- backend is correct
home screen:                17 locked, notice SHOWN  <- UI disagrees
```

After a reload and a fresh login, the same screen, same terminal:

| Reading | Before reload | After fresh context fetch |
|---|---|---|
| locked tool cards | **17** | **7** |
| this document's notice | **shown** | **hidden** |

The 7 that stay locked say *"Requires Pro"*, *"Requires Premium plan"*, *"Requires Plus plan"* — the
correct Free-tier outcome. The other 10 are the ones that were falsely locked.

**The cause is `SubscriptionProvider`.** It fetches once on mount and never refreshes
(`ui/src/contexts/SubscriptionContext.tsx:70-72`, `useEffect(() => { refresh(); }, [refresh])` with an
empty-dependency `useCallback`). During first-run the provider mounts **before** `provision_device` has
written the subscription row, so it caches `state: 'unavailable'` — and nothing invalidates it when
provisioning later succeeds. The flow's success path sets `hasCompletedSetup` to move past onboarding,
but no code path calls `refresh()`, so the app runs on a verdict that was true only during setup.

### What this changes about everything above

- **The `tenant_subscription` row is fine.** The two-halves fix (`d35555bca` + Step 5b) works; the row
  exists on this device and reads active.
- **The 17-lock home screen is real, but its cause was mis-attributed.** It is not "no row, fail
  closed" — it is "row written after the provider cached its verdict".
- **This document's notice is correct but now serves the stale case.** It fires on the stale
  `unavailable` — so it explains the lock-out accurately — but the underlying fault is the missing
  refresh, and the notice is a symptom-level mitigation for it.
- **Rounds 4-20's root-cause sections remain as history.** They describe a defect that was real at the
  time and has since been fixed; they do not describe this device's current state.

### The defect, stated plainly for a fix

`provision_device` succeeding must invalidate the cached subscription. The narrowest correct fix is for
the provisioning flow's success path to call `useSubscription().refresh()` — the same call the provider
already exposes — so the 10 falsely-locked tools unlock without a reload. A merchant who provisions and
then sees 10 dead cards has no way to know a reload would fix it.

Not fixed here: `WorkspaceHome.tsx` and the flow's files are the contested paths recorded in the round-30
blocker section, and this measurement does not change that. What it changes is *what* should be fixed.

## Evidence retention

Device-side files pulled during this pass: `kasir.db` (+wal) and `store-default.sqlite` (+wal) in
the host temp dir, and the CDP evaluation transcripts quoted above.

---

# Re-verified live, with the ROLE axis measured (2026-10-03 ~08:12, round 12)

<!-- Audit stamp: 2026-10-03 · Budak-Korporat · status: MEASURED ON DEVICE · no source modified
     Round 6 established the tier lock-out on the true provisioned state. This pass adds the one
     axis the report never measured — ROLE — and it is CORRECT. The user-visible report that "it
     does not detect roles AND subscription tier" is therefore ONE defect, not two: the
     subscription-state gate blanks the whole grid, which erases the evidence that the role and
     tier gates behind it are working. Everything below was read off the live device. -->

The report has measured the tier axis four times and the role axis never. A report that says
"every card is locked" cannot distinguish "the gate is broken" from "the gate is right and the
state is wrong" — so this pass measured the role directly.

Device: Redmi `23073RPBFG` (Android 15), `mu.kasir.mobile` `0.0.41`, **debuggable** APK
(`dumpsys package … flags=[ DEBUGGABLE HAS_CODE ALLOW_CLEAR_USER_DATA ]`), pid `29127`,
`topResumedActivity=…/.MainActivity`, `Display State=ON`. Read over CDP (`adb forward
tcp:9222 localabstract:webview_devtools_remote_29127` → `Runtime.evaluate`), logged in as `budi`.

| Reading | Value |
|---|---|
| `.workspace-home-user-role` textContent | **`owner`** — role detected correctly |
| `[data-testid=workspace-tool-card]` (unlocked) | **0** |
| `[data-testid=workspace-tool-card-locked]` | **17** |
| the 17 lock badges | **all identical: `Subscription inactive`** |
| `.workspace-grid > *` | **1** (the Add Workspace card; Defect 1 unchanged) |
| `get_subscription_capabilities` | `{"tier":"free","status":"unavailable","state":"unavailable","isTrial":false,"trialEndsAt":null,"features":{},"maxLocations":1,"maxPosInstances":1,"maxWarehouses":0,"maxKdsScreens":0,"maxStaffUsers":1,"salesHistoryDays":90,"supportsQris":false,"supportsAnalytics":false,"addons":[],"supportsLoyalty":false,"supportsDailyDashboard":false,"supportsCloudSync":false,"offlineGraceDays":7,"expiresAt":null,"graceUntil":null,"isExpired":false,"locationCount":1,"staffCount":0,"terminalCount":0}` |

**Why 17 and not fewer — the role gate is working.** `roleAtLeast(roleName, access.minimumRole)`
(`WorkspaceHome.tsx:396-399`) runs FIRST and correctly admits all 17 for `owner`: the owner-only
tools (`features`, `data-management`) and the admin-only ones (`topology-editor`, `analytics`,
`cloud-sync`) are all legitimately visible to this role. Derived from the catalogue (not measured —
no manager login was taken), a `manager` would see **12** cards: 11 open plus the single locked
Settings card, which is the one entry carrying `lockBelowRole` (`tools.tsx:245`). So there is no
role defect on this screen.

**Why every caption is the generic one.** `unavailable` is not in the open set
(`WorkspaceHome.tsx:419-423`), so the first gate rejects before the tier check at `:425` is ever
reached. That is why no card reads "Requires Pro plan" / "Requires Premium plan" — the per-tier
captions are unreachable while the state gate is shut, and their absence is itself the proof that
the lock is the state gate and not the tier gate.

## Instrument note — `scripts/android-cdp.mjs` is dead on this host (cost 3 round trips)

Worth recording because the failure is *misleading*. `node scripts/android-cdp.mjs targets` fails
with:

```
android-cdp: mu.kasir.mobile is not running — launch it first
```

The app **is** running (`adb shell pidof mu.kasir.mobile` → `29127`; `ps -A | grep -i kasir` agrees).
The real cause is that Node cannot spawn `adb` in this sandbox: `execFileSync("adb", …)` throws
`EBUSY spawnSync adb EBUSY`, identically for `adb` and `adb.exe`, and with the SDK platform-tools
first on `PATH` — so it is the spawn, not the resolution. The script's `adbTolerant` converts that
throw into `""`, and `""` is then reported as "not running" *and* as "the installed APK is a release
build". Two wrong diagnoses from one swallowed error.

Working path: **do the forward from bash, then speak CDP from Node** — Node 22's global `fetch` and
`WebSocket` need no child process.

```bash
A="C:/Users/Dika/AppData/Local/Android/Sdk/platform-tools/adb.exe"
export MSYS_NO_PATHCONV=1
PID=$("$A" shell pidof mu.kasir.mobile | tr -d '\r')
"$A" forward --remove-all; "$A" forward tcp:9222 "localabstract:webview_devtools_remote_$PID"
curl -s http://127.0.0.1:9222/json      # targets, then ws://127.0.0.1:9222/devtools/page/<id>
```

then ~40 lines of Node: `fetch` the target list → pick `type === 'page'` → open the
`webSocketDebuggerUrl` → `Runtime.evaluate {expression, awaitPromise: true, returnByValue: true}`.
`awaitPromise` is what makes the decisive call usable, because the IPC returns a promise:
`window.__TAURI_INTERNALS__.invoke('get_subscription_capabilities')`.

The repo skill `android-ui-automation` points at `scripts/android-cdp.mjs` as the way to drive the
DOM; on this host that entry point is dead and should carry this note.

## Status after this pass

## Status after this pass

**Both defects are fixed, and most of the source in this report is committed.** The line above this
section is retained because it was true when written and this file keeps its corrections rather than
overwriting them; it is not the current state. The stamp at the top of the file is.

Committed by this session: the Fluent strings (`bcb4a5452`), the notice's tests (`ba69f826f`), the
provisioning tests (`e8b2726f8`), the linked-provision tripwire (`d8dade5dc`, consolidated in
`67c1fe483`, made self-describing in `37bce3c9e`), and the analysis in each round's section. Committed
by peers: the reconcile (`d35555bca`), the notice's CSS (swept into `268440251`), and the whole of
defect 1.

Outstanding: the notice JSX (blocked by another session's hunk in the same file), the `args.mode`
guard for the uncommitted Step 5b (same), and the quick-card defects (`d2b8e30e4`, `9daf8e795`, same).
One file and one hunk carry all three.

> last audited 03-10-26 by docs-auditor
