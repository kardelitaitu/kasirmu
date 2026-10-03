# todo-tablet-provisioned-workspaces-invisible-to-picker

> Two independent defects found on one freshly provisioned tablet. Either alone makes an
> offline install unusable; together they are a dead end. They are reported here together
> because one test pass produced both, not because one causes the other.
>
> 1. **Provisioned workspaces are invisible** — provisioning writes the global DB, the picker
>    reads a per-store DB. (A new instance of the known P0-4 split-brain.)
> 2. **Every tool locks** — provisioning writes no `tenant_subscription` row, so the
>    fail-closed gate locks all 17 tools. (A documented contract the code does not honour.)

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

# SECOND DEFECT (same test pass) — provisioning writes no subscription row,
# so every tool locks on a fresh offline install

<!-- Audit stamp: 2026-10-03 · DSH · status: MEASURED ON DEVICE. Independent of the defect
     above: this one is a missing write, not a database split. Both were observed on the same
     provisioned tablet, and either alone is enough to make a fresh install unusable. -->

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

## Where a subscription row can come from — and why `local` never gets one

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

## Note on intent

ADR-56 §2.4 (§2.4 at `docs/decisions/2026-09-21-adr56-first-run-provisioning.md:580`) makes the
`local` tier the **default**, not a fallback, precisely so a merchant without connectivity can
still run. A `local` install that locks all 17 tools is the opposite of that decision, so the
missing row reads as an un-implemented step rather than a deliberate denial.

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

**The device was left in this state deliberately.** It is a reproducibility aid, not a fix: the
row is a hand-inserted sentinel on one tablet, invisible to any build, and a `pm clear` removes it.
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

## Evidence retention

Device-side files pulled during this pass: `kasir.db` (+wal) and `store-default.sqlite` (+wal) in
the host temp dir, and the CDP evaluation transcripts quoted above.
