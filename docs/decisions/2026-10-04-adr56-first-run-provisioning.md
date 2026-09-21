---
num: 56
area: topology
title: "ADR #56: First-Run Provisioning — identity-first onboarding, one provisioning transaction, and the retirement of the multi-boolean boot gate"
status: Partially implemented (2026-10-04; status re-audited 2026-09-22) — §2.1, §2.2, §2.6 and the `local` tier of §2.3/§2.4 are IMPLEMENTED; §2.3's `identify` leg, §2.5 pairing and §5 Q2's tablet licence gate are NOT
---

# ADR #56: First-Run Provisioning

**Status: Partially implemented** (2026-10-04; status re-audited 2026-09-22). **Updated
2026-10-05: §2.1, §2.2 and §2.6 are now IMPLEMENTED**, and §2.3's critical path is replaced — the
`local` tier provisions a working terminal end to end.

**Not implemented — the complete list, and it is THREE, where an earlier revision of this block
named only the first two:**

1. **§2.3's `identify` leg.** The `linked` tier's identity step has no UI on either shell;
   `ProvisioningMode = 'local' | 'linked'` exists (`ui/src/api/settings.ts:151`) and only
   `'local'` is ever sent (`ui/src/features/setup/ProvisioningFlow.tsx:104`).
2. **§2.5 pairing** — §5 Q1's *chosen* answer. The claim code and poll endpoint do not exist in
   `apps/license-server`.
3. **§5 Q2's convergence of both shells on the desktop boot order.** Its accepted cost was "the
   tablet gains a licence-activation gate it has never had"; the tablet still has no such gate
   (`ui/src/app/AppShell.tsx:230` and `:827` are the only consumers of `get_license_status`
   and `LicenseActivationScreen`, both desktop).

Three, not two, matters because item 3 was a `[was blocking]` decision: a tablet that cannot
activate a licence also cannot link (§1.6), so it cannot reach a sync credential either. That is
the same unfinished leg, and a status block that names two thirds of it invites the reading that
the tablet is one UI screen away from the linked tier.

*Clock note: the `last audited` stamp at the foot of this record carries the host clock's date,
2026-09-22, which trails this record's own 2026-10-05 revision notes. The stamp is the machine's
date and not a claim about the order the work landed in.*

The implemented halves were each verified by running tests, and the evidence is recorded per
section rather than claimed here. Section 1 is measurement
against the tree as it stood when the decision was taken; §2 is the decision; §3 is the consequence
list and §4 the non-goals.
**Date:** 2026-10-04 (implementation recorded 2026-10-05)
**Recorded against:** branch `0.0.39` @ `2c30e735c` (the commit the measurements were taken at;
`HEAD` has since advanced to `e6e254881` — "fix(license-server): key rate limits on the real
client IP" — which touches none of the files cited below, so every §1 reading still holds. Re-derive
any single one before relying on it; the citations are line-anchored, not commit-pinned.)
**Supersedes (in part):** ADR #41 §2.1 ("Device Lifecycle & First-Run Onboarding") — see §1.2.
**Extends:** ADR #54 (`2026-09-19-adr54-google-sign-in.md`), whose §1.4 already defers the
boot-gate reorder to "a different record (non-goal)". **This is that record.**
**Tags:** lifecycle, onboarding, provisioning, setup-wizard, identity, tablet, desktop-tauri, boot-gate

> Cite this record by filename, not by number. `docs/decisions/README.md` records that numbering
> in this directory has collided before (#43) and that filename-plus-number is the only safe
> citation form.

## 1. Context

### 1.1 The trigger: two shells, two contradictory first-run contracts

The desktop and tablet shells run the **same** `SetupWizard` from the shared `ui/` tree, but gate
it at **opposite** points in the boot ladder.

Desktop (`ui/src/app/AppShell.tsx`):

| Order | Condition | Screen |
|---|---|---|
| 1 | `isLocked && session` | `SessionLockScreen` (`:498-500`) |
| 2 | `loading` | `AppBootSplash` (`:502-507`) |
| 3 | `!bootAllowed` | `ActivationFlow` — licence activation (`:509-516`) |
| 4 | `!session` | `CreatePinScreen` when `hasAnyUsers === false`, else `StaffLoginScreen` (`:518-546`) |
| 5 | `!setupKnownComplete` | `SetupWizard` (`:548-557`) |

Tablet (`ui/src/app/tablet/TabletAppShell.tsx`):

| Order | Condition | Screen |
|---|---|---|
| 1 | `isLocked && session` | `SessionLockScreen` (`:208-214`) |
| 2 | `loading` | `AppBootSplash` (`:216-220`) |
| 3 | `!hasCompletedSetup` | `SetupWizard` (`:259-265`) |
| 4 | `!session` | `CreatePinScreen` when `hasAnyUsers === false`, else `StaffLoginScreen` (`:267-293`) |

The wizard sits **after** authentication on desktop and **before** it on tablet. The tablet has no
licence-activation gate at all — it never imports `LicenseActivationScreen`, a fact ADR #54 §1.5
already records ("its gate is `StaffLoginScreen` then the wizard").

Neither order is accidental; both are argued in place. `TabletAppShell.tsx:222-258` cites
ADR #41 §2.1 explicitly for the ordering, and the desktop order follows ADR #54 §1.4. **The
disagreement is between two accepted ADRs, not between two programmers.**

### 1.2 ADR #41 §2.1 describes a device that does not exist

ADR #41's State A is specified as: online account creation with OTP email verification → mint
device identity ("unique hardware-bound `device_id` and ECDSA sync keypair") → download the
compiled store topology from the control plane → mark the local DB `Enrolled`. Its pre-condition
names `device_credentials` as the enrolment marker.

Three measurements against the tree:

1. **There is no `device_credentials` table.** `crates/kasirmu-core/migrations/20260813_init.sql`
   declares 92 tables; `device_credentials` is not among them. The string does not appear in any
   migration.
2. **There is no ECDSA sync keypair.** Terminal credentials are issued as a bearer-style
   `device_secret` (`crates/kasirmu-core/src/desktop_link.rs:76-85`), hash-stored server-side.
3. **Topology is not downloaded during onboarding.** `workspace_instances` are instead seeded
   *unconditionally at migration time* — five rows, before any user or tenant exists
   (`20260813_init.sql:1505-1510`): `default-restaurant-pos`, `default-store-pos`,
   `default-warehouse`, `default-admin`, `default-kds`, all pointing at
   `store_id = 'default'` (the column these rows are seeded into is renamed to `location_id` by
   `20260906_rename_store_to_location.sql:18`; the literal `'default'` survives both). A
   `tenant_subscription` row is seeded beside them at
   `20260813_init.sql:1513-1514` with tier `free` and the sentinel signature
   `'BOOTSTRAP_FREE'`.

That last sentinel is not inert. `crates/kasirmu-bridge/src/auth.rs:614` verifies the subscription
signature before trusting the tier (via `TenantSubscription::validate_clock_rollback`), and the
tests are explicit that the migration seed never verified (`auth_tests.rs:958`:
"migration-seeded BOOTSTRAP_FREE signature never verified"). So a fresh install ships a subscription
row whose signature is known-invalid by design.

> **Anchors re-measured 2026-10-04 (audit pass 2).** Both citations above originally read
> `auth.rs:617` and `auth_tests.rs:892`; the lines moved as later work landed. The claim is
> unchanged and both new anchors were read directly.

**The referenced store, unlike the tenant, is real.** The migration seeds one row for it:
`INSERT OR IGNORE INTO store_profiles (id, name, is_primary) VALUES ('default', 'Default Store', 0);`
(`20260813_init.sql:1400-1401`), and `20260906_rename_store_to_location.sql:14` renames
`store_profiles` → `locations`, so that row is a `locations` row today. The five
`workspace_instances` at `:1505-1510` carry `store_id = 'default'` (`location_id` after
`:18`), which **resolves** against it. What onboarding never does is **name, promote or own** that
row: its name is the placeholder `Default Store`, its `is_primary` is `0`, and its
`tenant_id` is the column default `'default'` (`20260907_add_location_tenant_id.sql:14`) — the
sentinel §3.3 rejects for `provisioning`. The workspaces are not dangling; they are attached to a
placeholder the merchant never chose.

**Conclusion: "new device" is not a state this codebase can reach.** A fresh install already has
workspaces, a subscription, an inventory location — and a `locations` row — whether or not the
merchant exists. The wizard's job is therefore not to *create* a store, but **to decide the fate of
the one the migration already created** (the new decision in §2.6) and to write feature toggles
against the rest of the fiction already on disk.

### 1.3 What `complete_setup` actually persists

`apps/mobile-tauri/src/commands/setup.rs` → `write_setup` (`:110`) → one `rusqlite` transaction
writing: the feature rows, the pruned stale feature rows, the preset name, the default currency,
and the completion flag. Nothing else.

It does **not** write a store, a location, a terminal, a workspace instance, a subscription, or a
user. `apps/mobile-tauri/src/commands/setup.rs:32-36` documents a deliberate divergence from the
bridge twin: the tablet body omits the bridge's leading `seed_default_roles()`
(`crates/kasirmu-bridge/src/setup.rs:99`), on the reasoning that `bootstrap_owner` seeds roles
anyway. That reasoning holds — `kasirmu-bridge/src/staff.rs:1329` calls `seed_default_roles()`
inside `run_bootstrap_owner` — but it means the roles exist only *after* owner bootstrap, i.e.
after the wizard.

### 1.4 First-run state is three independently-read booleans

The gate is computed from three IPC reads issued in parallel and settled independently:

- `get_license_status` → `bootAllowed` (desktop only)
- `get_setup_status` → `setup.completed` / `hasCompletedSetup`
- `has_users` → `hasAnyUsers`

`AppShell.tsx:160-186` documents the resulting trust rules at length, and they are not the same
rules on both shells:

| Read fails | Desktop verdict | Tablet verdict |
|---|---|---|
| `get_setup_status` | **not first-run** → falls through to login (`AppShell.tsx:242-244` writes `true` only on an answered `completed`) | **first-run** → wizard (`TabletAppShell.tsx:129-132` pins `false`) |
| `has_users` | `null` → login; `false` alone opens bootstrap (`:235-240`, `:524`) | `null` → login; `false` alone opens bootstrap (`:133-136`, `:275`) |

Both directions are individually defensible and both are pinned by tests
(`appShellBootGate.test.tsx`, `TabletAppShell.test.tsx`). The defect is that **the same physical
install answers the same failed read in two opposite ways depending on which shell is running.**
On a tablet a transient IPC failure during boot drops the merchant into the wizard; on the desktop
the identical failure drops them at a login screen.

The Android retry wrapper exists specifically because of this: `ui/src/utils/boot-retry.ts`,
cited at `TabletAppShell.tsx:119-123` — "on Android, invokes issued while the backend is still
initialising can be answered into the void (Rust resolves; the response never reaches the
WebView), and without re-issuing the gate hung on the splash forever on a fresh install."
**The retry is a workaround for a gate that cannot tolerate an unanswered read.**

### 1.5 Skip is a trapdoor, not an escape hatch

`SetupWizard.tsx:533-541` offers "Skip setup" on step 0. `TabletAppShell.tsx:186-189`:

```ts
const handleSkip = useCallback(() => {
  dismissSetupWizard().catch(console.error);
  setHasCompletedSetup(true);
}, []);
```

The flag is set **regardless of whether `dismissSetupWizard` resolves**, and nothing is
provisioned. The merchant lands on `StaffLoginScreen` (`TabletAppShell.tsx:288-292`) with zero
users and no way to create one, because `CreatePinScreen` renders only inside the
`!session` branch *and* only when `hasAnyUsers === false` (`:275`). `TabletAppShell.tsx:249-258`
records this as a known consequence and defends `onSkip` as "recoverable" on the grounds that it
reaches login — but that is precisely the state the same comment block calls a dead end three
lines earlier ("a completed wizard with zero users dead-ended on a login that could never
succeed"). **Skip and "complete the wizard without bootstrapping" produce the same unrecoverable
state; only one of them is guarded.**

### 1.6 The identity machinery is built and already deferred

This is the part that changes the shape of the fix. ADR #54 is largely **shipped**, not proposed:

- Server: `apps/license-server/desktop_link_google.go` (`/start`, `/callback`, `/consume`),
  `desktop_link_email.go` (`/email/request`, `/email/consume`), `identities.go`
  (`resolveIdentity`), `web_oauth_google.go`, and the `tenant_identities` collection.
- Client: `crates/kasirmu-core/src/desktop_link.rs` — PKCE + the four calls; the loopback
  listener and orchestration in `crates/kasirmu-bridge/src/desktop_link.rs`.
- UI: `StepAccount.tsx` — rendered at `SetupWizard.tsx:501` as `{step === 7 && <StepAccount />}`,
  i.e. the **8th** of 9 steps (`STEPS`, `SetupWizard.tsx:37-47`, ends `'Account', 'Review'`), never
  the 9th. The component itself carries no number; the count comes from the array.

And the credential it produces is already the enrolment object this ADR needs —
`desktop_link.rs:74-99`:

```rust
pub struct TerminalCredential { issued, terminal_id, device_secret, reason }
pub struct LinkedAccount { tenant_id, provider, email, terminal: Option<TerminalCredential> }
pub struct VerifiedAccount { tenant_id, email, verified, terminal: Option<TerminalCredential> }
```

`LinkedAccount.tenant_id` is a tenant id obtained **before** any local provisioning has happened.
That is the missing keystone: identity resolution already returns the one value from which plan,
store and workspaces can be derived rather than guessed.

Two constraints on using it, both measured:

- **Activation must precede linking.** `crates/kasirmu-bridge/src/license.rs:206-217`
  (`stored_credentials`) returns `Invalid("this device is not activated yet")` when no sealed
  `api_key` exists, and `start_desktop_link` documents the same
  (`desktop_link.rs:122-124`: "the server also requires `machine_id` to be registered to it,
  which is why an un-activated device cannot link"). So the live order is
  **activate machine → link identity**, two sequential steps, not two alternatives.
- **The tablet cannot use the Google browser path.** ADR #54 §1.7 and §2.5 settle this on upstream
  policy (embedded webviews prohibited; custom schemes unsupported on Android; loopback redirect on
  mobile deprecated). `StepAccount.tsx:29-32` implements the consequence: the tablet renders the
  emailed-code control, and a prop could re-enable Google on tablet, "which is exactly what §2.7
  excludes, so the split reads the shell flag instead."

So an identity-first flow on tablet means **the emailed code**, or a pairing variant (§2.5) that
lets the phone do the Google half.

### 1.7 Why now

The project is in early development and no install base exists. The cost of this change is
therefore bounded by the code it deletes, not by a migration of live data — which is the only
window in which "replace the gate" is cheaper than "repair the gate".

**Window status, re-measured 2026-09-22: it has started to close, and the evidence is a migration
this record did not originally name.**
`crates/kasirmu-core/migrations/20261008_provisioning_legacy_backfill.sql` backfills a
`provisioning` row for every device the PRE-#56 wizard had already set up, because
`20261007_provisioning.sql` created the table with no backfill and such a device otherwise reads
`Unprovisioned` and is sent to onboarding on every boot. That is a migration over live data — the
exact cost this section said did not exist — and it is the correct mechanism for the population
§2.6's option C cannot reach: C edits `init.sql`, which fixes fresh installs and only fresh
installs, because the re-applied statements are `INSERT OR IGNORE` and removing one leaves the
rows an existing database already holds. §2.6's decision stands unchanged; what changes is that
the window it relied on is no longer open-ended, so this paragraph is added rather than the
section left to read as still-wide.

## 2. Decision

### 2.1 First-run state is one derived value, not three booleans

Replace the three parallel reads with a single provisioning record and a single derived state.

New table `provisioning` (SQLite source of truth; PG via
`scripts/generate-pg-migration.py`) — **keyed per terminal**, per §5 Q4:

| Column | Notes |
|---|---|
| `terminal_id` | `PRIMARY KEY`; matches `terminals.device_id` (`20260813_init.sql:929`, `UNIQUE`) |
| `tenant_id` | from `LinkedAccount` / `VerifiedAccount`, or `NULL` (§3.3) |
| `location_id` | the `locations` row this terminal belongs to (§2.6 decides remove-or-reuse) |
| `owner_user_id` | the bootstrapped owner |
| `device_id` | credential id from `TerminalCredential.terminal_id` |
| `mode` | `'local'` or `'linked'` — which tier of §2.4 was used |
| `home_region` | **residency** — which server holds this tenant's data; a mirror of the organization-level fact, `'global'` initially (ADR #59 §2.1) |
| `provisioned_at` | audit |

#### Residency is not market, and the table carries only residency

Two facts that this table must not collapse into one column, per the repository's own ruling:
`crates/kasirmu-core/migrations/20260919_regional_configuration.sql:13-19` states verbatim that
`legal_entities.country_code` is *"the MARKET anchor (ISO-3166 alpha-2) ... It is deliberately NOT
named `region` and it is NOT data residency: residency is where the data is STORED ... market is
how it is TRADED. The two must not collapse into one column."* And
`docs/security/data-residency-and-retention.md:35-42` records residency as *"a property of the
deployment ... selected at organization creation ... decided, not implemented."*

| Fact | Level | Where it lives | Drives |
|---|---|---|---|
| **Market** — how you trade | Legal Entity | `legal_entities.country_code` (`20260919:42-43`), with `locale`/`timezone`/`currency` defaults at `:45-52` | tax, fiscalization, numbering, receipts |
| **Residency** — where data is stored | Organization | The server's `tenants.region` (authoritative); `provisioning.home_region` mirrors it | which server serves this tenant, credential routing |

So **`provisioning.home_region` mirrors the organization's residency and nothing else.** It is not
a market anchor, it is not a country code, and it must not be read as one: a tenant resident in
`global` may trade in Indonesia, and the column that says so is `legal_entities.country_code`,
not this one. Writing a market value here would be the collapse the migration comment forbids.

**`home_region` is a cache, not an authority.** ADR #59 §2.1a/Q5 decides that the license server's
`tenants.region` is authoritative and this column is a local copy written only from a server
response — the same relationship the subscription row already has, where
`refresh_subscription_status_from_server` (`license_verification.rs:682`) writes the
server-authoritative value into a local row that is never the source of truth. The column exists
here so a device with no network can still show and reason about its own region.

#### The two copies of `tenant_id`, reconciled

`tenant_id` appears in this schema as literal `'default'` in more than one place, and the
reconciliation must be explicit or the upgrade path silently writes a value that means something
else:

| Copy | Value | Status |
|---|---|---|
| `locations.tenant_id` | `'default'` — the column default (`20260907_add_location_tenant_id.sql:14`, whose header at `:9-11` says `'default'` "preserves single-tenant store-DB semantics") | A **local literal**, not a licence-server id. It means "this store DB is single-tenant by construction" |
| `tenant_subscription.tenant_id` | `'default'` — the seeded row (`20260813_init.sql:1513-1514`) | Same local literal; the subscription this ADR retires (§2.6) |
| `provisioning.tenant_id` | The **licence server's** tenant id from `LinkedAccount.tenant_id` (`desktop_link.rs:171`) | Only written by a `linked` install; `NULL` otherwise (§3.3) |

**The rule: the local literal and the licence-server id are different namespaces and must not be
compared.** `'default'` is what this store database calls "the one tenant it holds"; the licence
server's id is the globally unique tenant. They are related only by **being written at the same
provisioning event**: when `linked` provisioning writes `provisioning.tenant_id = <server id>`, the
`locations` row it settles (step 3 of §2.2) must be given that same server id in its
`tenant_id` — otherwise the location stays in the local namespace while the terminal claims the
server one, and a cloud RLS read of the location (the reason `20260907` added the column at all,
per its header `:3-7`) sees `'default'`. **This is a required part of step 3, not an
implementation detail**, and it is why §2.6's location decision cannot be taken without naming
which `tenant_id` the surviving row carries.

**Schema scope, stated because two records need it:** this table is ADR #56's. ADR #59 Q4
additionally decides a `region` column on `legal_entities` (the legal fact, distinct from this
routing fact) — that column is a **core migration owned by ADR #59, not by this record**, and is
named here only so the two do not appear to contradict each other. `country_code` on
`legal_entities` already exists and is the market anchor; it is not this record's to change.

The gate is `EXISTS(SELECT 1 FROM provisioning WHERE terminal_id = ?)`, an indexed local lookup —
not a network call, and not the singleton existence check an earlier draft proposed (§5 Q4).

The gate becomes one pure function over local state:

| Derived | Condition | Render |
|---|---|---|
| `Unprovisioned` | no `provisioning` row for this terminal | Provisioning flow (§2.3) |
| `Provisioned`, no session | row present, no session | `StaffLoginScreen` / `CreatePinScreen` |
| `Provisioned`, session | row present, session | Workspace routing |

**The row cannot exist unless the licence, the store and the owner were written in one
transaction** (§2.2), so "setup completed but nothing provisioned" — the state `onSkip` reaches
today — becomes unrepresentable rather than merely guarded.

A failed read can no longer forge a verdict, because there is no boolean to forge: an unreadable
DB yields no row, and the shell stays in `Unprovisioned`. This is what retires `boot-retry.ts`'s
lost-response workaround (§1.4) — a retry becomes an ordinary idempotent re-read.

#### IMPLEMENTED 2026-10-05 — §2.1 shipped

The table, the record and the derived state are real, and the gate is wired on both shells.

| # | What | Where |
|---|---|---|
| 1 | `provisioning` table, keyed per terminal | `crates/kasirmu-core/migrations/20261007_provisioning.sql` — the 127th table, a measured pin in `migrations_tests.rs` |
| 2 | `ProvisioningRecord`, `ProvisioningMode`, `FirstRunState` | `crates/kasirmu-core/src/db/provisioning.rs` |
| 3 | The bridge read + wire shape | `kasirmu_bridge::setup::get_first_run_state` → `FirstRunStateDto`, a tagged enum whose two states are mutually exclusive at the type level |
| 4 | The IPC command on both shells | `commands::setup::get_first_run_state`, registered in both `lib.rs` handler lists |
| 5 | Both boot gates read the row | `ui/src/app/AppShell.tsx` and `ui/src/app/tablet/TabletAppShell.tsx` — `state === 'provisioned'` replaces `completed` |
| 6 | The legacy backfill, added after this record and not named in its first revision | `crates/kasirmu-core/migrations/20261008_provisioning_legacy_backfill.sql` — see §1.7: it backfills a row for devices the pre-#56 wizard already set up, so an already-set-up install is not re-routed into onboarding on every boot |

**The three booleans are gone.** `get_setup_status` and `dismiss_setup_wizard` were removed from
the bridge and both shells (§2.2's deletion), and `SHOW_SETUP_WIZARD` / `SETUP_COMPLETE` are no
longer written by any provisioning path. §1.4's `boot-retry.ts` lost-response workaround survives
as a retry around the two pre-auth reads, which is now safe in both directions because the read is
idempotent rather than because re-issuing a write is harmless.

**One override the implementation required, recorded because it narrows the gate.** The desktop
`AppShell` has always treated an unknown setup read as "not first-run" and fallen through to login,
while the tablet pins a failed read to the first-run flow. That asymmetry is KEPT, and it is now
safer than it was: the tablet's direction can no longer strand a terminal, because the flow it
reaches is the one that provisions it, whereas the old wizard's `onSkip` could mark setup complete
with nothing provisioned. Both directions are pinned by tests
(`TabletAppShell.test.tsx`, `appShellBootGate.test.tsx`).

**Verification run:** `ui` — 601 files, **10233 passed, 0 failed**, including the 16-case boot-gate
file that drives the converted read and the 29-case tablet shell; `cargo test -p kasirmu-core --lib`
→ **3141 passed**; `cargo test -p kasirmu-bridge --lib` → **1360 passed**.

### 2.2 Provisioning is one idempotent transaction

`provision_device(args)` writes, inside one `rusqlite` transaction, in this order:

1. Guard: if a `provisioning` row exists **for this `terminal_id`**, return it as success —
   idempotent, not an error. This is what makes a retry after a crash, a lost Android IPC response,
   or a re-polled pairing claim (§5 Q1) safe: the same device can never mint two terminals.
2. `seed_default_roles()` — moved here from `run_bootstrap_owner`'s implicit slot so roles exist
   *before* the owner that references them, matching the bridge's ordering
   (`kasirmu-bridge/src/setup.rs:99`).
3. Settle the `locations` row the seeded `workspace_instances` already point at — the row exists
   (`20260813_init.sql:1400-1401`, renamed at `20260906:14`), so this step is **a promotion or a
   replacement, never a first insert**. Writing a second row here would leave the five
   `default-*` workspaces pointing at the placeholder while the real one sits unused. The choice
   between the two is §2.6's new decision; either way it happens *before* step 6 so the marker
   never outlives a half-settled location.
4. `run_bootstrap_owner`'s user creation, in the same transaction rather than a later screen.
5. Persist feature rows + preset + default currency — the *effective content* of today's
   `write_setup`, unchanged in meaning.
6. Write the `provisioning` row last, so its presence is the commit marker.

Reuse over invention: steps 2, 4 and 5 call existing functions
(`Store::seed_default_roles`, `run_bootstrap_owner`'s inner store calls, `write_setup`'s
statement list). The new code is the guard, the location row, and the marker.

**Deletion follows:** `get_setup_status`, `dismiss_setup_wizard` and the `setup.completed`
setting key lose their reason to exist. All three ADR #49-ported doors in
`apps/mobile-tauri/src/commands/setup.rs` are affected: `get_enabled_features` (`:93`),
`dismiss_setup_wizard` (`:209`) and `get_setup_status` (`:226`); the two this ADR removes are the
latter pair. Removing them moves the registration ratchet and the
`registration_gate_debt.generated.rs` ledger — the doors are rows at `:101`, `:102` and `:113`
of that generated file — and `get_enabled_features`'s ledger row at `:100` is what the feature-read
replacement of §2.1 keeps alive.

#### IMPLEMENTED 2026-10-05 — §2.2 shipped, in both halves

`provision_device` is one transaction over the six steps above, in that order, with the marker
written last (`crates/kasirmu-core/src/db/provisioning.rs`). The deletion follows it, as stated.

**Two implementation notes that changed the code rather than the decision:**

- **Step 4 calls `create_user_in_tx`, not `create_user`.** The latter opens its OWN transaction, so
  calling it here was a nested `BEGIN` — "cannot start a transaction within a transaction". That is
  the identical defect `create_user_in_tx` documents having caused for staff-with-profile creation
  on 2026-08-31, so the existing helper was reused rather than re-derived.
- **Step 3's `is_primary` is conditional.** The schema allows exactly one primary row
  (`idx_locations_primary`, a partial UNIQUE from `20260906:22-23`), so writing `1` unconditionally
  made provisioning a SECOND terminal fail with a constraint violation. A second terminal now
  shares its merchant's primary instead of promoting itself.

**The deletion, measured:** `get_setup_status` and `dismiss_setup_wizard` are gone from
`kasirmu-bridge/src/setup.rs`, from both shells' command modules and from both `lib.rs` handler
lists. The registration ledgers were REGENERATED rather than hand-edited (`setup::get_first_run_state`
and `setup::provision_device` replaced the two rows). Both carry `no_session_resolution` deliberately:

> provisioning creates the FIRST owner, so it must be reachable before any session exists — the same
> structural property `setup::complete_setup` has carried since it was registered.

That reasoning is recorded in the ledger's own pin block (`registration_gate_tests.rs`, the
`REGISTERED_FLOOR` history) rather than only here, because the ratchet forces the next person to
re-measure it.

**Verification run:** `cargo test -p kasirmu-core --lib` → **3141 passed, 0 failed** (21 of them in
`db::provisioning`, covering the guard, the replay, the rollback and both schema CHECKs);
`cargo test -p kasirmu-bridge --lib` → **1360 passed**; both registration ratchets → **10/10**.

### 2.3 Identity-first, and the wizard collapses to what cannot be derived

The provisioning flow is ordered by dependency, not by topic:

```
activate machine  (existing, unchanged — required before linking, §1.6)
  → identify        Google (desktop) / emailed code (tablet)  → tenant_id
  → store           pick or name the location this terminal belongs to
  → owner           display name + PIN
  → provision_device(...)   [one transaction]
  → working terminal
```

The nine-step wizard's remaining steps — Payments, Products, Hardware, Business Rules — become
**in-app settings on a working terminal**. (`STEPS` at `SetupWizard.tsx:37-47` has 9 entries and
`TOTAL_STEPS = STEPS.length` at `:51`; the "8-step" docstring at `:315` is stale and lists only
the steps up to Review. The array is the authority.) They are not deleted from the product; they are removed
from the critical path, because each one asks the merchant to configure a system they have not yet
used.

The preset survives as a *derived default*: `tenant_id` → plan (`GET /api/v1/tenants/me/plan`,
`crates/kasirmu-core/src/sync_auth.rs:47`) → allowed feature set, intersected with the store type
chosen in step 3. `PRESET_FEATURES` (`SetupWizard.tsx:186-259`) becomes the store-type→features
map it already is, evaluated instead of interrogated.

**Rationale, stated as the principle:** onboarding must end at a working terminal, not at a
configured one. Today's wizard ends at neither — it ends at a login screen with zero users
(`onSkip`) or at a feature-toggle write against a store that does not exist (§1.3).

#### PART IMPLEMENTED 2026-10-05 — the critical path is replaced; the identity leg is not

**Built:** `ui/src/features/setup/ProvisioningFlow.tsx` is now what both shells render on the
unprovisioned path, replacing `SetupWizard` there. It asks three things — store type, shop name,
and owner (name, login, PIN) — and then calls `provision_device`. The wizard component itself is
KEPT, because §2.3 removes its steps from the critical path rather than from the product: its
later stages are the in-app settings a provisioned terminal now reaches.

**Two deliberate omissions from the flow, both from this section rather than from scope:**

- **No currency or timezone field.** The flow sends the preset's defaults. §2.3's "evaluated,
  not interrogated" rule is the reason: the merchant answers a business question (what kind of
  shop is this) rather than a technical one. A later slice resolves them from the scope chain.
- **No account step.** A `local` install is the default (§2.4), so linking is an action on a
  WORKING terminal rather than step 8 of a gate.

**NOT built, and this is the honest gap: the `identify` leg.** The §2.3 diagram starts with
`identify → tenant_id`, and there is no UI for it on either shell. What ships today is the `local`
tier end to end; the `linked` tier's bridge contract exists (`ProvisionDeviceArgs.mode = 'linked'`
with its tenant and credential ids, plus the schema CHECK that refuses a linked row without them)
but nothing calls it. §2.5's tablet pairing flow is likewise unbuilt. Recorded here rather than in
§3.3 so the two tiers' status cannot be misread from the diagram.

**One thing the collapse removed that the ADR did not name:** `onSkip`. The wizard's Skip button
and the `dismiss_setup_wizard` command behind it are both gone, because §1.5's trapdoor has no
meaning once the marker is a row instead of a flag — there is nothing to skip PAST. The wizard
component still exposes `onSkip` as an optional prop for its remaining callers; neither shell
passes it.

**Verification run:** `ui` — **601 files, 10233 passed, 0 failed**, including the layout, touch-
target, focus-visible and theme-token walkers over the new sheet, and `screenExtraction.test.ts`
(which forced a `SCREENS` entry for `ProvisioningFlow.css` — a new stylesheet may not join the
shrink-only uncited list). `npm run lint` → 0 errors; `npm run lint:i18n` → no issues, keys in both
bundles; `npx tsc --noEmit` → clean.

### 2.4 Two tiers, because offline-first cannot require the network

`mode` in §2.1 is not decoration:

- **`local`** — store name + owner PIN, no network. Produces a working OS and a sellable terminal.
  This tier is the **default**, not the fallback, because the target deployment includes merchants
  with unreliable connectivity and because ADR #41 §2.1's "Internet Connection is Mandatory" would
  make those merchants unable to open the app at all.
- **`linked`** — the §2.3 identity step, adding `tenant_id`, sync, topology and multi-terminal.

A `local` terminal upgrades to `linked` in-app when the merchant links their account, by writing
the `tenant_id`/`device_id` columns and re-running the idempotent step-1 guard. **This is the
mechanism that makes ADR #54's optional Account step unnecessary**: the same action moves from
"step 8 of setup" to "an action on a provisioned terminal", and it stops being skippable because
it is no longer part of a linear gate.

#### The `local` tier's exposure, stated as a chain rather than a footnote

A `local` install is deliberately exempt from two enforcement mechanisms, and the combination has
a consequence this record must not leave implicit:

| Mechanism | Applies to `local`? | Why |
|---|---|---|
| Revocation (ADR #58 §2.1, §2.4a.2) | **No** | ADR #58 §3.4 exempts it: there is no tenant to revoke and no credential of ours to withdraw |
| The pre-expiry check (ADR #58 §2.3) | **No** | §2.3 keys on `expires_at`; a `local` install holds no signed subscription and therefore no expiry to approach |
| Server-side tamper/quota detection (ADR #57 §2.4) | **No** | It observes server-held data; a `local` install sends none |

**ADR #58 §3.4 justified the revocation exemption by pointing at ADR #57 §2.4** — *"its abuse
exposure is the same Free-user exposure ADR #57 §2.4 bounds by server-side detection."* **That
mitigation does not exist**: ADR #57 §Q3 defers §2.4's detection until a queue owner is named and
the fingerprint field ships. So the chain currently terminates with **no bound at all**, not the
"same as a Free user" the earlier text assumed.

**This does not change the decision to ship `local` as the default.** Q3's reasoning stands — a
first-run that demands connectivity fails the merchant who most needs the product, and Free is a
permanent tier. What it changes is that the exemption is now stated as **unbounded** rather than
bounded-by-a-control-that-is-deferred.

**Two consequences the implementation must carry:**

- **A `local` install is not a compliance or abuse control surface.** It cannot be banned, checked,
  or quota-audited remotely. That is a property of the design, and it belongs in the merchant-facing
  terms rather than in an internal note.
- **The upgrade to `linked` is the only route to enforcement.** A merchant who never links is
  outside every server-side control this system has. If that is unacceptable for a deployment, the
  answer is to require linking at provisioning — which is Q3 option B, and a product decision this
  record declines to make by omission.

**Recorded so it cannot be rediscovered as a bug**, and cross-referenced to ADR #57 §3.3, which
carries the same unbounded residual from the tamper side.

### 2.5 Tablet Google requires pairing, not a browser

Per §1.6 the tablet cannot complete a Google flow in a WebView. Two candidate answers were
weighed, and **§5 Q1 decides in favour of the first**:

1. **Device-code pairing (preferred).** The tablet displays a short code and a QR. The merchant
   opens `kasir.mu` on their phone — where ADR #54 §2.4's web Google flow **is** shipped — and
   enters the code against their account, choosing the store. The tablet polls and receives the
   same `LinkedAccount` shape. This reuses `resolveIdentity`, the `tenant_identities`
   collection, and `register_terminal`; it adds a claim code with a TTL and a poll endpoint, and
   it is the only route that gives the tablet Google sign-in *and* a real store picker.
2. **Emailed code only (rejected).** What `StepAccount.tsx` does today, moved to position 1 of
   the flow. Cheaper; the merchant types an email on a tablet, and the store picker has no better
   home than the device. Rejected in §5 Q1: re-running full identity on every additional terminal
   makes the paid upgrade worse than the initial signup, and `subscription-tiers.md` sells exactly
   that axis (`max_pos_instances`).

§2.3 is satisfiable by either, and the provisioning transaction is identical under both — which is
why the decision could be taken on product grounds alone rather than on plumbing.

### 2.6 The migration stops seeding fiction

The five default `workspace_instances` (`20260813_init.sql:1505-1510`), the
`'BOOTSTRAP_FREE'` subscription row (`:1513-1514`) and the "Default Inventory" /
"In Transit" `inventory_locations` (`:1517-1527`) are split by what they actually are:

- **Genuine fixtures** — the two `inventory_locations` are system-managed pseudo-locations
  (`transit` is explicitly so, per its own `INSERT` comment). They stay.
- **Fiction** — the five default workspaces and the sentinel subscription are replaced by rows
  created *in* `provision_device`, alongside the `locations` row they reference. A store with no
  merchant should have no workspaces.
- **Neither** — the seeded `locations` row (`20260813_init.sql:1400-1401`). It is not a fixture
  like `transit`, and it is not the same kind of fiction as the workspaces: it is a placeholder the
  five workspaces **already reference**, and it is the row §2.2 step 3 must settle. Its fate is the
  decision immediately below, not a categorisation.

The `'BOOTSTRAP_FREE'` sentinel is retired rather than signed: a provisioned terminal gets a real
signed subscription (`auth.rs:617`), and an unprovisioned one has no subscription row to verify.

#### Decision — the seeded `Default Store` location is REMOVED, not reused

`20260813_init.sql:1400-1401` seeds `('default', 'Default Store', 0)`, and the five workspaces at
`:1505-1510` reference it by `store_id = 'default'` (:18 of `20260906` renames the column to
`location_id`; the literal survives). **The row must be removed at migration time and created by
`provision_device` instead** — i.e. it takes the same C treatment as the five workspaces and the
sentinel subscription, and §2.2 step 3 becomes a genuine insert for fresh installs.

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. REUSE and promote** | Keep `:1400-1401`; provisioning `UPDATE locations SET name = ?, is_primary = 1 WHERE id = 'default'` | Smallest change — no row churn, the five `default-*` workspaces keep resolving throughout; no second row to orphan | **Perpetuates the fiction under a new name.** `id = 'default'` remains the install's primary location forever, so every fresh install's location is a recycled placeholder id no merchant chose; the migration still ships a store for a merchant who does not exist, which is the exact §1.2 defect this section exists to remove; and `is_primary` promotion must contend with the partial unique index (`20260906:22-23`) if a `local → linked` upgrade adds a second location |
| **B. REMOVE, and create in provisioning** | Drop `:1400-1401`; `provision_device` step 3 inserts the real row and points the five workspaces at it | The schema stops shipping a store nobody asked for; a store with no merchant has no location, matching the workspaces; the row's id, name, `is_primary` and `tenant_id` are all written by the one transaction that knows them | The five `default-*` workspaces must be re-pointed (or themselves removed per the bullet above), so their seeding is coupled to provisioning too; slightly larger diff than A |

**Decision: B — remove, for the same reason the workspaces are removed.** A is not merely
inferior; it leaves the defect half-fixed. §1.2's finding is that a fresh install ships a store the
merchant never chose, and A answers that by *renaming* the unchosen store and marking it primary —
the placeholder becomes the answer rather than the problem. B is also the only option that lets
`locations.tenant_id` be written correctly: under A the `'default'` literal
(`20260907:14`) survives as the primary location's tenant, which the two-copies reconciliation in
§2.1 forbids for a `linked` install. **The honest cost of B is coupling:** removing the location
means the five workspaces cannot be left pointing at a row that no longer exists, so their removal
(already decided above) and the location's removal are one change, not two.

#### How the seeded rows are removed — the mechanism must be chosen, not assumed

Both sets of rows live in `crates/kasirmu-core/migrations/20260813_init.sql`. That file is **not
generated** — it is the checked-in v1 baseline, and its header is a historical provenance note
recording that it was consolidated from earlier migrations, not a statement that a tool writes it
today. The one artifact in this pair that **is** generated is its PostgreSQL twin:
`scripts/generate-pg-migration.py:78` writes `20260813_init.pg.sql`, hand-editing which AGENTS.md
forbids. The runner records a **checksum** per applied migration (`schema_migrations.checksum`,
`migrations.rs:401`). Three mechanisms exist and they are not equivalent:

| Option | How | Valid when |
|---|---|---|
| **A. A new migration deletes the rows** | Additive `DELETE FROM workspace_instances WHERE id LIKE 'default-%'` plus the subscription row and the seeded location | **Always**, but with no reach: see below |
| **B. Edit `init.sql` in place** | Remove the `INSERT OR IGNORE` statements | Only while **no install has applied it** |
| **C. Stop seeding in `init.sql`** and let `provision_device` create them | Requires regenerating `20260813_init.pg.sql` | Same window as B, plus a PG regeneration |

**The real constraint on C is reach, not detection.** The obvious hazard — that editing an applied
migration is what `schema_migrations.checksum` exists to catch — is **not** what happens here.
`platform/core/src/database/migrations.rs:74-102` intercepts the mismatch, logs
*"migration definition drift detected — re-applying SQL and updating checksum (DB-02)"*
(`:92-98`), re-runs the script through `reapply_for_drift` (`:99`, defined at `:368`) and then
`update_checksum`s it (`:100`, *"drift auto-patched — checksum updated"*). A definition edit is
therefore **absorbed, not refused**.

That is why C's true limitation is different and must be stated: **C changes what a *fresh* install
seeds; it cannot remove rows from a database that already has them.** The newly-edited `init.sql`
is re-run against an existing DB, and its statements are `INSERT OR IGNORE` — removing one from
the file leaves the row it already inserted untouched. C fixes fresh installs and only fresh
installs.

**Decision: C, while the window is open; A is the fallback if it closes.** §1.7 records that no
install base exists, which is what makes C available — and it is the only option that leaves the
schema *honest*, since A would ship a migration whose whole purpose is to undo a previous one, and
B would leave the fiction in the file for anyone reading it. §1.7 is also what makes C's limitation
inert rather than disqualifying: **the population C cannot reach is empty**, because there is no
provisioned database for it to miss. **The window closes the first time a merchant's database is
provisioned**, so this is a change to make now rather than later.

**The obligation this creates:** C touches `init.sql`, so `scripts/generate-pg-migration.py` must
re-run and `20260813_init.pg.sql` must be re-staged. Pre-commit step 5 and
`dev-ci.yml#static-gates` fail on drift (§3.2), which is the guard working as intended rather than
an obstacle.

**What must NOT be removed:** the two `inventory_locations` rows (`20260813_init.sql:1517-1527`).
They are system-managed pseudo-locations — `transit` is explicitly so in its own `INSERT` comment —
and are genuine fixtures rather than fiction.

#### IMPLEMENTED 2026-10-05 — §2.6 option C shipped, and the coupling proved real

The three fiction seeds are gone from `crates/kasirmu-core/migrations/20260813_init.sql` (the
`Default Store` profile, the five `default-*` workspace instances, and the `BOOTSTRAP_FREE`
subscription) and `20260813_init.pg.sql` was regenerated — its seed count dropped 11 → 7, which is
the drift guard confirming the edit reached the twin. The two `inventory_locations` rows are
untouched, as §2.6 requires.

**The coupling §2.6 predicted was exactly as large as predicted, and it is worth stating plainly:**
removing the seeds broke **117 `kasirmu-core` tests and 114 `kasirmu-bridge` tests**. Every one was
a FIXTURE that read a row the baseline no longer ships, not a product defect. The fix was one
shared helper —

```rust
kasirmu_core::migrations::seed_provisioned_baseline(&conn)
```

— which rebuilds the rows `provision_device` now creates, called from each test module's own
`fresh()`/`store()` constructor and from the bridge harness's `temp_conn()`. It is deliberately NOT
part of `fresh_db()`: a test of first-run behaviour must see an UNPROVISIONED database, and seeding
there by default would re-introduce the fiction this section removes.

**Three assertions were INVERTED rather than deleted**, because the guarantee is worth more than the
row: `seed_data_bootstraps_essential_rows` now asserts the locations table is EMPTY and that no
sentinel subscription exists, and the store→location rename test asserts zero FK violations with no seeded
rows left to hide behind. A deleted assertion would have let the fiction creep back silently; an
inverted one fails if it does.

**What the removal did NOT touch:** `legal_entities` rows are still created by
`20260908_legal_entities.sql` from whatever tenants its `UNION` finds — with no seeded location and
no seeded subscription, a fresh install now yields NO legal entity, and the migration's own
`UPDATE locations SET legal_entity_id = ...` has no row to update. That is correct arithmetic, not
an omission: provisioning creates the location and the entity together.

**Verification run:** `cargo test -p kasirmu-core --lib` → **3141 passed, 0 failed**;
`cargo test -p kasirmu-bridge --lib` → **1360 passed, 0 failed**;
`python scripts/generate-pg-migration.py --check` → clean.

## 3. Consequences

### 3.1 Positive

- **One gate, both shells.** Desktop and tablet derive the same value from the same row, so a
  failed read can no longer produce opposite verdicts on the same install (§1.4).
- **`onSkip`'s dead end becomes unrepresentable** rather than guarded (§1.5).
- **Onboarding ends at a working terminal** (§2.3).
- **Real deletion:** `get_setup_status`, `dismiss_setup_wizard`, the `setup.completed` key, the
  wizard's nine steps, `boot-retry.ts`'s lost-response workaround, the footer docstring that says
  eight (`SetupWizard.tsx:315`), and five seeded workspace rows plus the seeded
  `Default Store` location.
- **The tablet stops being a data-entry device** under §2.5.1 — the store picker moves to a phone
  or desktop, where picking a branch from a list is an ordinary interaction.
- **Idempotent provisioning is retry-safe by construction**, which is the property the Android
  void-response problem actually needed.

### 3.2 Negative

- **Schema change.** A new table plus PG regeneration (`scripts/generate-pg-migration.py`) and
  `reset-dev-pg.sh`. Pre-commit step 5 and `dev-ci.yml#static-gates` fail on drift, so this is
  the least forgiving surface in the change.
- **Deleting ADR #49-ported doors moves gates.** `get_setup_status` and `dismiss_setup_wizard`
  are ported doors with ledger rows — `apps/mobile-tauri/src/commands/registration_gate_debt.generated.rs:101`
  and `:113` — so the registration totals in that generated file change. No separate proof
  artifact moves with them: the `verify-body-parity.py` those doors' doc comments cite
  (`setup.rs:29`) **does not exist in the tree** (`**/verify-body-parity*` → 0 hits), so the
  ledger is the only machine-readable record of these doors.
- **The wizard's step count is load-bearing for tests.** `SetupWizard.test.tsx` carries **27
  `it()`** across three `describe` blocks (`ui/src/__tests__/SetupWizard.test.tsx`):
  `StepAccount — shell split` (3, `:102`–`:121`), `SetupWizard — OTP login flow` (21, `:149`–`:419`)
  and `SetupWizard — QRIS gate` (3, `:456`–`:489`). The 21 in the middle block are the ones the
  step-count change moves; the other six move only if their surface does. Also moving:
  `SetupWizardRender.test.tsx`, the a11y suites, `touchTargetSizing.test.tsx:221`, and the
  `@/features/setup/SetupWizard` mocks in `AppShell.test.tsx`, `TabletAppShell.test.tsx`,
  `MemoBannerMount.test.tsx` and others.
- **`StepAccount`'s "optional by design" is load-bearing for ADR #54's completion claim.**
  ADR #54 §2.5 records shipping the wizard step; this ADR relocates it. #54 should be amended to
  point here rather than left to disagree.
- **QRIS's tier gate loses its host.** `QrisSetupRow` renders inside wizard step 1
  (`SetupWizard.tsx:499`), gating the onboarding surface on `supports_qris()`. Removing the steps
  orphans it; it needs a home in Settings or the upsell surface silently disappears — the one
  consequence here with revenue impact.
- **Pairing (§2.5.1) is new server surface** — a claim code, a poll endpoint, TTL and rate limits.
  It is not free, and it is the largest single addition this ADR proposes.
- **A `local` install is outside every server-side control** (§2.4). It cannot be revoked, cannot be
  made to check in, and is not covered by ADR #57 §2.4's detection — which is itself deferred. The
  chain terminates with no bound, and this is the largest *policy* exposure in the record, accepted
  because Q3's offline-first reasoning outweighs it.

### 3.3 Neutral / to decide during implementation

- ~~Whether `local` mode writes a `tenant_id` sentinel or leaves the column null.~~
  **Decided: `NULL`, no new sentinel — and this is ADR #56's own decision.**
  ADR #59 §2.1a/Q5 settles `tenants.region` against `provisioning.home_region`; it says nothing
  about `provisioning.tenant_id`, and this record previously credited it with a decision it does
  not make. The rationale is this record's, and it has two legs: (i) #59's cache discipline —
  *"written only from a server response, never from user input or a default"*
  (`2026-10-04-adr59-...:501-502`) — applies to the tenant key for the same reason it applies to the
  region, since both are values only the licence server can mint; a `local` install has no server
  response by definition, so there is nothing to cache; and (ii) §2.2's guard keys on `terminal_id`,
  so no query anywhere needs a sentinel to find an unlinked terminal. The sentinel alternative would
  make "not linked" *look* like a value.
- **There is already a sentinel in this schema, and it is `locations.tenant_id`.** Its column
  default is the literal `'default'` (`20260907_add_location_tenant_id.sql:14`), deliberately, so
  cloud RLS can scope a single-tenant store DB (header `:9-11`). Rejecting a *new* sentinel
  therefore does not make the schema sentinel-free — it leaves exactly one, on the `locations` row
  §2.2 step 3 settles. **The two positions are consistent only because the namespaces differ:**
  `'default'` is the local database's own name for "the one tenant I hold", while
  `provisioning.tenant_id` holds the licence server's globally unique id — see §2.1's two-copies
  table. The consequence is a required step, not a note: on a `linked` install, step 3 must write
  the **server** id into the surviving location, or the location stays in the local namespace while
  the terminal claims the server one. On a `local` install `'default'` is correct and stays:
  the location genuinely belongs to the single-tenant DB, and `provisioning.tenant_id` is `NULL`
  beside it.
- Whether the store/location step creates a row in `locations` or discards the concept. This was
  written as an open question against `store_profiles`; **that reading was stale and is corrected
  here.** `20260906_rename_store_to_location.sql:14` renames `store_profiles` → `locations`, `:18`
  renames `workspace_instances.store_id` → `location_id`, `:19` renames
  `terminals.bound_store_id` → `bound_location_id`, and `20260907_add_location_tenant_id.sql:14`
  adds `locations.tenant_id`, defaulting it to the `'default'` literal (the sentinel §3.3 now names).
  So the anchor already exists, is already tenant-scoped, and already
  carries the `is_primary` uniqueness index (`20260906:22-23`). The remaining question is therefore
  only whether provisioning *writes* the row the wizard currently never writes — not which table
  should hold it. **That half is now decided: §2.6 removes the seeded placeholder and has
  `provision_device` step 3 insert the real row**, so the answer is "writes it", with the row's
  `tenant_id` following §2.1's two-copies rule.
- ~~Whether `provisioning` is one row or keyed per terminal.~~ **Decided: per terminal, see §5 Q4.**
  The evidence that settled it: `terminals` carries `bound_location_id`, `bound_instance_id` and
  `binding_signature` (`20260813_init.sql:936`, renamed at `20260906:19`), so a terminal is bound to
  a *workspace instance* rather than to an install; and the quota that makes multi-terminal a
  licensed capability, not a hypothetical, is already schema-side —
  `tenant_subscription.max_pos_instances` (`:903`, "Per-store register limit").

## 4. Non-Goals

- **Not a redesign of ADR #54's identity resolution.** `resolveIdentity`, the five outcomes and
  the `identity_events` trail are consumed as-is.
- **Not a change to the licence-activation step.** It stays first and stays mandatory (§1.6).
- **Not a multi-tenant or multi-terminal *model*.** ADR #40 owns the peer model. This record makes
  the *schema* capable of several provisioning rows (§5 Q4) without defining how terminals
  coordinate — that remains ADR #40's, and nothing here implements it.
- **Not a rewrite of the workspace/topology editor.** ADR #22 owns it; §2.6 only stops the
  migration from pre-creating its rows.
- **Not an implementation plan.** This record fixes the shape; the ordering and staging of the work
  belong in a plan document alongside it.

## 5. Decisions on the former Open Questions

**Status: DECIDED** (2026-10-04, sole maintainer delegation). The four questions below were open
in the first revision of this record. Each now carries its options, the benchmark that separates
them, and a binding decision. `[blocking]` meant the answer changes §2; `[deferrable]` meant it
does not. Both classes are now settled.

The benchmark throughout is **how shipped offline-first POS SaaS operates** (Square, Toast, SumUp,
Shopify POS, Stripe Terminal), read against this repo's own constraints (§1) and its commercial
model (`docs/guides/subscription-tiers.md`, FINAL 2026-08-17: five tiers, Free permanent at one
location/one terminal, Phase D1 per-tenant signed overrides).

### Q1 — Tablet identity: pairing, or emailed-code only? `[was deferrable]` — DECIDED

| Option | Pros | Cons |
|---|---|---|
| **A. Device-code pairing (§2.5.1)** — tablet shows code + QR, phone does Google, tablet polls | Gives tablet Google sign-in despite ADR #54 §1.7; the store picker moves to a phone where choosing a branch is ordinary; reuses `resolveIdentity`, `tenant_identities`, `register_terminal`; scales to terminal #2..#N | New server surface (claim code, poll endpoint, TTL, rate limits); new UI state ("waiting for your phone") with its own failure mode; a merchant who never completes pairing is stranded in a waiting state if local mode is absent |
| **B. Emailed code only (§2.5.2)** — what `StepAccount.tsx` does today, moved to position 1 | Already built and shipped on both shells; no new endpoints; one screen | Merchant types an email on a 10-inch touchscreen; no Google on tablet at all; the store picker has no better home than the device; pairing-shaped friction returns for terminal #2 |

**Decision: A — device-code pairing is the target, and ships in the first cut.**

The "B now, A later" reflex is what shipped products do *not* do, and this repo's own commercial
model is why. `docs/guides/subscription-tiers.md` makes Free a **permanent** tier capped at one
location and one terminal, with paid tiers sold on additional terminals
(`max_pos_instances`, `entitlements.rs:133`). Terminal enrolment is therefore not a
later-era concern — it is the **upgrade trigger**. A flow that re-runs full onboarding per device
makes the merchant's second terminal a worse experience than their first, at exactly the moment
they have just paid. Square, SumUp and Stripe Terminal all treat "add another reader/terminal" as a
first-class pairing action, not a repeat of signup.

Pairing also resolves a §1.7 problem nothing else does: ADR #54 §1.7 forbids the tablet any browser
route to Google, and option B's answer is "the tablet cannot have Google". Pairing moves the Google
half to the phone, where §2.4's web flow is **already shipped** — so the capability exists today
and only the handoff is new.

**What this commits us to:** a claim code (short TTL, single-use, rate-limited like
`login_lockout.go`), a poll endpoint, and the `Waiting for your phone` UI state with an escape
hatch to §2.4's `local` tier so a merchant whose phone is elsewhere is never stranded. The poll
must be idempotent under §2.2's guard, or a lost response mints a second terminal.

### Q2 — Which shell converges on which order? `[was blocking]` — DECIDED

| Option | Pros | Cons |
|---|---|---|
| **A. Both converge on desktop's order** (activate → identify → provision → login) | The desktop order already gates activation first, which §1.6 proves is required before linking; it already has the licence gate the tablet lacks; it is the order that does not dead-end on skip | The tablet must gain a licence-activation gate it has never had — a genuine new surface on Android |
| **B. Both converge on tablet's order** (wizard before login, no licence gate) | Smaller change to the tablet | Requires *removing* the desktop licence gate, contradicting §1.6 (linking needs activation); the tablet order is the one whose `onSkip` dead-ends (§1.5); would need a new argument not made here |
| **C. Keep both orders, share only the provisioning transaction** | Smallest diff; unblocks §2.1–§2.2 immediately | Leaves the §1.4 defect (same install, opposite verdicts) unfixed; two gate ladders remain to drift apart; fails this ADR's own §3.1 first claim |

**Decision: A — both shells converge on the desktop's order**
(activate → identify → provision → login).

This is the only option that is *physically implementable*, which makes it more than a preference.
§1.6 measured that `stored_credentials` refuses with `Invalid("this device is not activated yet")`
(`license.rs:206-217`) and `start_desktop_link` documents the same server requirement
(`desktop_link.rs:122-124`). Option B therefore asks to remove a gate that linking *depends on* —
it is not a tradeoff, it is a regression that would break identity resolution itself.

Option C is rejected because it fails this record's own §3.1 first claim: sharing only the
provisioning transaction leaves the two gate ladders, and with them the §1.4 defect, intact. A
shared transaction written by a gate that still disagrees about whether to call it is not a fix.

**Accepted cost, stated plainly:** the tablet gains a licence-activation gate it has never had. That
is a real new surface on Android — and it is the *correct* surface, because a tablet that cannot
activate a licence also cannot link an identity, cannot sync, and cannot be sold. The tablet's
absence of this gate is the bug, not a design.

*Revision note:* this reverses §1.1's framing that the two ADR-cited orders were equally arguable.
They were not; one of them cannot work.

**Not implemented (re-audited 2026-09-22).** The tablet still has no licence-activation gate, so
this decision stands decided-and-unbuilt. `get_license_status` has exactly one caller
(`ui/src/app/AppShell.tsx:230`) and `LicenseActivationScreen` exactly one render site
(`:827`), both desktop, and `ui/src/app/tablet/TabletAppShell.tsx:269-274` still says in its own
words that "licence activation remains desktop-only". Recorded as a status note here so the
decision cannot be misread as shipped from §2 having moved forward.

### Q3 — Does `local` mode ship in the first cut? `[was blocking]` — DECIDED

| Option | Pros | Cons |
|---|---|---|
| **A. Ship both tiers** (§2.4) | Honours offline-first; a merchant with no connectivity can still open the app and sell; keeps ADR #41 §2.1's network requirement a *product choice* rather than an accident | More UI paths (upgrade `local` → `linked`); two provisioning shapes to test; `tenant_id` handling for the unlinked case (§3.3) must be settled |
| **B. `linked` only in the first cut** | One path; fewer states; faster to a working `linked` flow | Makes ADR #41 §2.1's "Internet Connection is Mandatory" true by default rather than by decision — the merchant cannot open the app without internet; hollows out §2.4's rationale; the upgrade path is then designed under pressure later |

**Decision: A — ship both tiers, with `local` as the default path.**

The offline-first premise (ADR #6, ADR #10) is not decoration: every sale, stock deduction and shift
is designed to work with no network. A first-run that is the single place demanding connectivity
contradicts the architecture at its most visible moment, and it fails precisely for the merchant who
most needs the product. `subscription-tiers.md` prices IDR rates for the Indonesian market — 65M
MSMEs, per that file's own revenue note — a segment where requiring a connection to open the till
is a product defect, not a scoping choice.

The decision is also cheap in a way option B is not: `Free` is a **permanent** tier, not a trial,
capped at one location and one terminal. A `local` terminal is therefore *already* a legitimate
steady state — it is a Free terminal that has not yet linked — not a degraded one waiting for
rescue. Option B would make the Free tier unreachable without internet, which is incoherent against
a Free tier that is meant to be free forever.

**What this commits us to:** the `local` → `linked` upgrade must be exercisable by a real merchant
(Settings, plus the pairing entry point of Q1), and §3.3's `tenant_id`-sentinel question must be
answered so the upgrade is a write rather than a migration.

### Q4 — Is `provisioning` one row or keyed per terminal? `[was deferrable]` — DECIDED

| Option | Pros | Cons |
|---|---|---|
| **A. Singleton row** (`CHECK (id = 1)`, §2.1) | The gate is an O(1) existence check; matches "this install is provisioned"; simplest | `tenant_subscription.max_pos_instances` exists (`20260813_init.sql:903`), so multi-terminal is a licensed capability and this shape must change to support it |
| **B. Keyed per terminal**, with "is this install provisioned" derived | Handles multi-terminal natively | The boot gate now needs a query rather than an existence check, and "which terminal am I" becomes a boot-time question |

**Decision: B — keyed per terminal, with "is this install provisioned" **derived** from it.**

**This reverses option A above, and Q1 is what reversed it.** Option A is the singleton
(`CHECK (id = 1)`) shape an earlier draft recommended; it is kept in the table because the reason it
was wrong is the reason the decision matters. Once pairing is the enrolment mechanism (Q1), a device
can hold more than one terminal row over its life: a terminal can be re-paired to a different
location, and a shared tablet can be re-enrolled. A singleton row would turn each of those into a
destructive update of the install's identity — and the paid tiers are sold on exactly this axis, so
the schema must not obstruct the revenue path.

**Option A's cost — the one it was chosen for — is real and is answered rather than waved away.**
A query is not an existence check, so the boot gate does slightly more work. That is acceptable
because it is **one indexed lookup on a local SQLite table**, not a network call, and because §2.1's
derived state is a function either way. The gate question "is this install provisioned" is answered
by `EXISTS(SELECT 1 FROM provisioning WHERE terminal_id = ?)` — bounded, local, and O(1) on the index.

**Shape:** `provisioning(terminal_id PK, tenant_id, location_id, owner_user_id, device_id, mode,
home_region, provisioned_at)` — `home_region` is the residency mirror of §2.1, not a market value —
with `terminal_id` matching `terminals.device_id` (`20260813_init.sql:929`, `UNIQUE`). The device knows its own `terminal_id` from Settings before the row is read, so the
lookup needs no ambiguity resolution. §2.1's three derived states are unchanged; only their
condition moves from "a row exists" to "a row exists for this terminal".

**Guard against the risk this introduces:** with N rows, "which terminal am I" becomes a boot-time
question, so `terminal_id` must be resolvable **before** the gate renders — i.e. from the
`MACHINE_ID`/`SYNC_TERMINAL_ID` settings already classified as non-exportable device keys
(ADR #54 §1.4). If it is not resolvable, the shell must fall to `Unprovisioned` rather than guess,
matching §2.1's fail-closed direction.

> last audited 22-09-26 by docs-auditor
