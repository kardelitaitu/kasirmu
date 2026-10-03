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

### The fix is NOT "treat None as Free" — None is three different facts

`SubscriptionLoader::load_verified_subscription` deliberately collapses three distinct cases into
one `None` (`crates/kasirmu-core/src/entitlements.rs:324-344`), and the doc comment on the trait
says so (`:306-308`, "missing/tampered/unreadable"):

1. `Ok(None)` — **no row**: the fresh-install case that should read Free-active.
2. `verify_signature()` failed — **tampered**: must stay locked. `fail_closed` is the whole point.
3. `TenantSubscription::load` errored — **unreadable**: must stay locked.

Only case 1 is the defect, and the trait erases the distinction before either reader can act on
it. A repair that maps `None` to `bootstrap_free()` would hand cases 2 and 3 the same Free-active
answer and turn a tampered row from locked into usable — the exact downgrade `entitlements.rs:113-114`
("a missing/tampered row must project a payload that locks every gate") exists to prevent. The
capabilities path therefore needs to learn WHICH of the three it hit, which is why this is a
design change on the trait rather than a one-line fallback.

## Why the migration comment does not resolve it

`crates/kasirmu-core/migrations/20260813_init.sql:1512-1520` says the removed `BOOTSTRAP_FREE`
subscription is "now created by `provision_device`'s single transaction". It is not — that
transaction has six steps and none touch the table (`provisioning.rs:434-528`): roles `:443`,
location `:462`, workspaces `:509`, owner `:514`, settings `:520`, marker `:523`. A grep for
`tenant_subscription` across `provisioning.rs` returns no matches. A grep across the whole tree
finds `INSERT INTO tenant_subscription` only in migrations and in cloud-server TESTS — there is
**no client-side write path at all**, so the comment describes work that does not exist in any
form.

ADR-56 §2.6 is more careful than the migration comment and does not promise a local write: it
retires the sentinel on the grounds that "a provisioned terminal gets a real signed subscription"
(`docs/decisions/2026-09-21-adr56-first-run-provisioning.md:667-668`) — i.e. the signed row is
expected from the licence server. That is coherent for a `linked` install and leaves the
question these four-versus-one readers disagree about only for `local`.

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
(`:425`) is ever reached. The measured `features: {}` also shows the tier carries no entitlements
at all, so even a repair of the state would leave `maxWarehouses: 0` / `maxKdsScreens: 0`
blocking two of the four provisioned workspaces.

## Note on intent

ADR-56 §2.4 (§2.4 at `docs/decisions/2026-09-21-adr56-first-run-provisioning.md:580`) makes the
`local` tier the **default**, not a fallback, precisely so a merchant without connectivity can
still run. A `local` install that locks all 17 tools is the opposite of that decision, so the
missing row reads as an un-implemented step rather than a deliberate denial.

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
