# todo-tablet-provisioned-workspaces-invisible-to-picker

> Two independent defects found on one freshly provisioned tablet. Either alone makes an
> offline install unusable; together they are a dead end. They are reported here together
> because one test pass produced both, not because one causes the other.
>
> 1. **Provisioned workspaces are invisible** — provisioning writes the global DB, the picker
>    reads a per-store DB. (A new instance of the known P0-4 split-brain.)
> 2. **Every tool locks, permanently — on a provisioned install with no licence row, on BOTH
>    shells.** The capabilities read requires a `tenant_subscription` row and fails closed to
>    `unavailable` without one, while the boot gate is satisfied by `setupCompleted` — so the
>    install is admitted and then tier-locked. No tablet code path can write the row
>    (provisioning writes none; `activate_license` is desktop-only and shell-guarded off; the
>    status poll only UPDATEs; sync does not carry the table; `store_subscription` needs an
>    activation the tablet cannot perform).
>
>    **Scope was corrected twice and the earlier framings should not be trusted.** Round 4
>    scoped this to `local` mode (too narrow); round 5 widened it to "every tablet install"
>    (also wrong); round 10 established it is **not tablet-specific at all** — the desktop
>    reaches the same state by the same route, and the two shells' `debug_upgrade` argument is
>    orthogonal because `apply_debug_upgrade` requires `state == Active`. See §"CORRECTION
>    (round 10): this is a SHARED defect".

<!-- Audit stamp: 2026-10-03 · DSH · status: MEASURED ON DEVICE (both defects proven, neither fixed)
     Reproduced on Redmi 23073RPBFG (Android 15) with a debug build of `0.0.41` (mu.kasir.mobile),
     installed 2026-10-03 06:53, exercised over CDP. Every figure below was read off the device
     or its pulled SQLite files; nothing is inferred from source alone.

     READ THE CORRECTIONS, NOT THE FIRST DRAFT. Three claims in this document were revised after
     further measurement, and each revision is left in place rather than silently edited:
       - the second defect's SCOPE (round 4: `local` mode -> round 5: all tablets -> round 10:
         BOTH shells; it is not tablet-specific),
       - the tablet's boot gates (round 7 said absent; round 8 found them present and bypassed),
       - the proposed FIX (round 7 proposed a tablet toast, reverted in round 8 as unverifiable
         and aimed at the wrong layer; round 10 established the debug arms must NOT be removed
         because `license_tests.rs` pins them as deliberate hazards).
     The device-level reproductions were unaffected by any of the three. -->

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
| gate bypass on `setupCompleted`/`installExisting` | `AppShell.tsx:286` | `TabletAppShell.tsx:199` |
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

Unchanged: **neither defect is fixed, and no source was modified by this pass.** The blocking
question remains the one §"The two owner rulings this case falls between" frames (R2 vs R11, and
therefore whether an absent row means "Free, active" or "unlicensed"). It now has a
device-measured role axis alongside it, which removes "roles" from the list of suspects.
