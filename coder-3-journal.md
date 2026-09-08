# coder-3 journal

## 2026-09-08 — Learned the four planning files (orientation pass)

Read end to end (500-line chunks): `todo-global-saas-1.md` (3738 ln),
`todo-global-saas-2.md` (2423 ln), `todo-global-saas-3.md` (568 ln),
`todo-tools.md` (516 ln). No code changes. Summary of state absorbed:

### Shared contract (saas-1, normative for all phases)
- Hierarchy: Organization/Tenant → Legal Entity → Location → Terminals →
  workspace runtimes (`retail-pos`, `resto-pos`, `kds`, `warehouse` — never
  rename these; `inventory_locations` stock points and the `Store<'a>` DB
  facade are also rename-exempt).
- Access contract: `subject + permission + scope + resource + entitlement`;
  page access never replaces action-level enforcement.
- §B: admin features lock at `expiresAt`; POS runs through tier grace
  (7/14/14/30/60); after grace → read-only lock. Fail-closed everywhere.
- Quotas server-issued, over-quota resources marked not deleted.

### State (all Phase 1 P0 boxes CLOSED with evidence)
- Store→Location rename 1a–1g done (incl. license-server dual-emit/dual-read
  wire compat `851d9a02`+`662e7f3a`).
- ADR #47 scoped authorization slices 1–3 done (`94e8a100`, `453c629f`,
  `8c0ae0b4`+`7f7d4ec4`); table is `assignments` (NOT `role_assignments`).
- ADR #46 topology revision history Phase 1 RATIFIED complete
  (`ec46e6b7` extraction, `8ce2c805` change-note, `d8ffa281` racing test).
- Tenant isolation: RLS coverage gate closed (`07197574`); 27 covered,
  7 documented-exempt.
- Subscription lifecycle fail-closed (`9896dac4` family), grace reconciliation
  (`09d389a6`, `499bb1b0`), quota centralization (`73e77c5f`, `de6d2df2`).

### Phase 2 open work
- Downgrade behavior: detection landed (`869de0ce`); OPEN: owner-facing
  remediation view, persisted over_quota marker, per-location dims.
- Entitlements beyond tiers: 4-phase design written (A one read model,
  B one limit table, C trial state, D server-issued grants); A+B are
  client-core-only, no migration. NOT implemented.
- Audit baseline + retention schedule: OPEN.
- Regional configuration, tax separation: OPEN.
- Locations→Topology entry point: OPEN.

### Phase 3 open work
- Feature-flag observability: core resolver (`869de0ce` availability.rs),
  tablet IPC (`e17a4e32`/`dfbc41b2`), UI client+dev-mock (`9c9b6f53`/
  `987d5698`), desktop IPC (`ff85e7be`) all landed. OPEN: Settings→
  Diagnostics screen (separate slice); `scope_granted` ruling (Amendment 4
  recommends v1 = compute from `session.store_id`, awaiting maintainer).
- Custom roles: safety half done; feature half unblocked via
  `roles.permissions` JSON key-set rows + IPC. OPEN.
- Regional billing, support tooling, service health contracts, multi-org
  switching: OPEN. Data residency doc: DONE (`docs/security/data-residency-and-retention.md`).

### todo-tools state
- Home Tools rebuild DONE (`ab410844`): `ui/src/features/workspaces/tools.tsx`
  catalogue (17 tools, groups Operations/Insights/Configuration, declarative
  `access`), `ui/src/utils/tierLevel.ts` fail-closed ordering, gate stack,
  57 tests.
- OPEN: IA/gate parity test; Locations→Topology entry; optional shortcuts/pins.

### Standing process rules (learned from supervisor logs — binding)
- Pathspec-scoped commits only; never `git add -A`/`stash`; untracked files
  carry no author trail — check the todo journals before committing files you
  did not write. Flip checkboxes in the landing commit.
- Journal appends use absolute repo-root paths (two stray-file incidents).
- `verify-ipc-parity.py` is NOT a pre-commit step; run it directly before
  calling any IPC slice done. dev-ci.yml has no push trigger.
- Tauri invoke args bind camelCase (`sessionToken`); typecheck proves nothing
  about that untyped boundary (defect 1, saas-3 Amendment 3).
- Caps-vs-verdict invariant is PER-CLIENT (desktop has debug Free→Premium
  upgrade, tablet must not mirror it — `dfbc41b2`).
- WSL bash hangs; use `C:\Program Files\Git\bin\bash.exe`.
- Money = i64 minor units; rusqlite transactions; forward-slash paths.

## 2026-09-08 — Audit-retention slice LANDED (by finisher-B; my session died first)

My session was stopped by the harness before I could commit this slice. The
work survived intact in the working tree and finisher-B landed it as
`feat(audit): enforce the tier audit retention schedule`, on top of
finisher-A's `3a36b0c8` (migration registration) and `d1ce3f99` (regional
resolver). Supervisor verified the audit suite 68/68 pre-landing.

### What the slice is
- **Tier windows** — `SubscriptionTier::audit_retention_days()`
  (`crates/oz-core/src/subscription.rs`): Free/OneTime `None`, Plus 90,
  Pro 180, Premium 365, Enterprise 1_095 (3y default). `None` deliberately
  INVERTS `sales_history_days`' `None` ("unlimited"): here it means "nothing
  retained", because no tier carries an unlimited audit window. Mirrored on
  the read model as `Entitlements::audit_retention_days()` so a schedule
  change cannot drift between the sweep and any UI that displays it.
- **The sweep** — `Store::sweep_audit_retention(&tier, now)`
  (`crates/oz-core/src/db/audit.rs`): deletes `audit_log` rows older than
  the tier window, measured from the EVENT timestamp, not insertion order
  (test `audit_retention_window_is_measured_from_event_timestamp` pins the
  late-inserted-expired case). Cutoff computed in Rust and passed as RFC3339
  — the memo sweep's 2026-09-07 ruling: SQLite `datetime()` emits a
  space-separated form that mis-sorts against `…T…Z`. Negative-window fast
  path skips the transaction entirely; idempotent; a bad `now` fails closed
  with nothing deleted.
- **Trigger carve-out** — migration `20260920_audit_retention.sql` replaces
  `audit_log_immutable_delete` with a sweep-gated equivalent that raises
  UNLESS a `settings` row `audit.retention_sweep_active` exists. The sweep
  inserts the marker, deletes, clears the marker and commits inside ONE
  transaction, so the exemption is never visible outside a live sweep: a
  crash rolls the marker back with the deletes, other connections never see
  uncommitted state, and any DELETE issued outside a sweeping transaction
  still aborts (test `audit_retention_trigger_still_blocks_direct_delete`).
  The UPDATE trigger stays absolutely immutable on purpose — no anonymization
  path exists, deletion IS the implemented policy.
- **IPC surface** — `require_audit_tier()` in both clients gates every
  tenant-facing audit read (list / review-status / mark-reviewed / export) on
  Premium+, per the adopted "Audit Log is Premium+" decision. Coverage is
  complete: desktop 4/4 commands, tablet 5/5 (incl. the deprecated
  non-scoped `list_audit_log`). Desktop passes `debug_upgrade: true`,
  tablet `false` — the per-client invariant from `dfbc41b2`.
- **Daemons** — 15-minute sweep (rows expire on day boundaries, so 5 minutes
  buys nothing) on desktop (global DB + every open store DB — the audit
  screen's rows live in the per-store DBs) and tablet (single shared DB).
  Fail-closed asymmetry: an unreadable/tampered subscription row SKIPS the
  tick, because the fail-closed projection is Free and a purge triggered by
  corrupted data is irreversible, while a skipped sweep only delays deletion.
  A validly-signed Free row purges everything, as the schedule demands.

### Supervisor interventions in my work (round 49)
- `db/audit.rs:126` — `SWEEP_MARKER_KEY` needed an explicit `&'static str`
  annotation. Applied by the supervisor during a shared-tree blocker, not by
  me; credited in the commit body.
- The supervisor re-ran the gates at landing: `cargo test -p oz-core --lib
  audit` 68 passed / 0 failed, and `cargo check --lib` clean for oz-core,
  oz-pos-app and oz-pos-tablet.

### `subscription.rs` landed ELSEWHERE — not in my commit
The file carried BOTH my `audit_retention_days` (26 lines) and finisher-C's
uncommitted entitlements Phase D1 `payload_features` /
`payload_feature_grant` (41 lines). Phase D1 dominates, so the supervisor
ruled the whole file goes to C's Rust commit with the audit-line overlap
noted in its body. I built and verified a hunk-split (HEAD + my hunk only,
blob `112443b8`) that would have kept every SHA compiling, but the file was
locked mid-edit when I went to apply it — `cp: cannot create regular file
'crates/oz-core/src/subscription.rs': Permission denied` — and swapping a
file another agent owns is the clobber hazard AGENTS.md forbids, so I
escalated instead of forcing it. A first ruling accepted the consequence
that my commit would be an **intermediate that does not compile standalone**
(`db/audit.rs:167`, `entitlements.rs:164` and `subscription_tests.rs:1670-1690`
all call the method that would land one commit later); that ruling was then
REVERSED in favour of sequencing. C landed FIRST as `abda8574` — "feat(core):
parse per-feature grants from the signed payload" — carrying my 26-line
`audit_retention_days` hunk (subscription.rs:227-252) under an explicit
OVERLAP attribution paragraph, with an ORDERING NOTE recording that landing it
first is what removes the red intermediate. Nothing was split or swapped, and
every SHA in the range compiles. `license_verification.rs` and both clients'
`commands/subscription.rs` are C's own Phase D1 files.

### todo-global-saas-2.md "audit baseline" box LEFT OPEN (line 283)
Retention schedule, Free exclusion and the Premium+ read gate are now
demonstrably landed. Three clauses of the box text are NOT, so it was not
flipped:
- **"basic security events"** — no security event class reaches `audit_log`
  at all. Production emitters are `sale.completed`, `stock.adjusted`,
  `product.created`, `api.write`, `audit.review` and the
  profile/refund/topology/sale-lifecycle mutations. `commands/auth.rs` in
  BOTH clients writes NO audit row — login, logout and authentication
  failure are unaudited. Retention can only retain what is emitted, so the
  schedule currently protects business events, not security events.
- **"configurable contract override"** for Enterprise — not implemented; the
  doc-comment defers a contracted override to a signed custom entitlement
  (same ruling as `offline_grace_days`).
- **"compliance views"** — no `ui/src` audit surface exists in the tree;
  `git status --porcelain -- ui/src` showed only connection-health WIP from
  another slice.
OPEN, in order: emit the security-event baseline (auth + permission/role
changes), then the contract override, then the compliance view. Flip the box
when all three close.
## 2026-09-08 — Audit remainder #1 LANDED: basic security events on the auth paths

The first gap my own landing report named ("no security event class reaches
`audit_log` at all"). Now closed for the authentication-outcome class.

### What landed
- **New module** `crates/oz-core/src/db/audit_security.rs` (+ sibling
  `audit_security_tests.rs`), registered in `db/mod.rs`. A sibling rather
  than more of `db/audit.rs` because that file is already 603 lines — past the
  "preferably < 600" guidance — and the `db/` tree already splits `impl Store`
  per domain (`staff.rs`, `profile.rs`, `products.rs`), so this follows the
  house pattern instead of stretching one file.
- **`Store::record_security_event(&SecurityEvent, debug_upgrade)`** writes
  through the SAME `log_audit` path, so AUD-06 redaction and the append-only
  triggers apply unchanged. No trigger carve-out was needed: 20260920 exempts
  DELETE only, and this is an INSERT.
- **`SecurityEvent::{login_success, login_failed, logout}`** constructors. The
  action strings were CHOSEN from the existing UI contract, not invented:
  `login` and `login.failed` are already in `auditCatalog.ts`, and
  `login.failed` is already in `CRITICAL_ACTIONS`, so the screen renders it
  with critical emphasis today.
- **Failure classifiers**: `wrong_pin`, `unknown_user`, `account_inactive`,
  `rate_limited`. All four refusal paths in `staff_login` record, and the
  uniform STAFF-06 client message is unchanged — the distinction lives only in
  the audit row, which is where it belongs.
- **Wired in both clients**: 5 sites each (4 login arms + logout).
  `destroy_session` now takes the `SessionContext` out with the token so the
  event can name who left; an unknown token records nothing and still returns
  `Ok`, exactly as before, so a replayed logout cannot manufacture phantom
  events. A store switch destroys the old session too and is recorded as a
  logout — it is a genuine session end.

### The design decision worth keeping: fail OPEN where the sweep fails closed
`build_entitlements` projects Free for a missing, tampered or unreadable
subscription row. Honouring that projection here would mean an attacker who can
write one row turns the security audit trail OFF and then acts un-audited. So
the skip requires a CONFIRMED Free row (`loaded == true`), never the
fail-closed guess of one — the deliberate opposite of the retention sweep,
which skips on the same input because a purge is irreversible. Destructive
operations fail closed, additive ones fail open. Pinned by
`a_tampered_row_still_records_because_silencing_the_audit_is_the_attack` and
by the tablet test that reaches the same arm through `staff_login`.

The gate is expressed as `tier.audit_retention_days().is_none()` rather than a
second tier match: no retention entitlement means the sweep would purge the row
on the next tick anyway, so writing it would be pointless as well as against
the rule. One schedule, one source of truth, shared with `2fb2b873`.

### Per-client divergence, pinned by tests rather than prose
Desktop passes `debug_upgrade: true` (matching `require_audit_tier`), tablet
`false` (the `dfbc41b2` invariant). `apply_debug_upgrade` is
`cfg!(debug_assertions)`-gated, so a production Free tenant is excluded on both
clients and only a dev desktop promotes its own row. The desktop test asserts
`recorded == cfg!(debug_assertions)`; the tablet one asserts `recorded == 0`
unconditionally — so if the tablet ever mirrors the desktop flag, its test goes
red in exactly the build where that would otherwise be invisible.

### Where the events land, and the limitation that follows
Login happens BEFORE a store is resolved, so the only `Store` reachable is the
GLOBAL database. The audit screen reads the session store's database
(`list_audit_log_scoped`), so these rows are not visible there today. That is
inherent to the auth flow, not an oversight — the global DB already carries
`api.write` and system events and is already swept by the retention daemon.
Surfacing global security events in the audit UI is owed work.

### Still owed before todo-global-saas-2.md:283 can flip
1. **`logout` has no Fluent label.** `audit-action-logout` exists in neither
   `shared.ftl` nor `.id.ftl`, and both are HOT FILES this session must not
   touch, so the event renders through the catalog's unknown-action fallback.
   Editing `auditCatalog.ts` alone would fail pre-commit step 4 (bundle
   parity) without the FTL keys, so neither file was touched. The audit TRAIL
   is complete; the LABEL is the gap.
2. **Permission/role changes are still unaudited.** `user.create` and
   `user.update` are in the UI catalog but nothing emits them —
   `crates/oz-core/src/db/staff.rs` writes users and assignments with no audit
   row. Sensitive READS are already covered (`staff.identity.read`,
   `staff.payroll.read` in `db/profile.rs`); a PIN change is not.
3. **Enterprise configurable contract override** — still deferred to a signed
   custom entitlement.
4. **Compliance views** — no `ui/src` audit surface exists.

### Gates
`cargo test -p oz-core --lib audit` -> **83 passed** (68 prior + 15 new).
Regression sweeps clean: oz-core lib **2761 passed / 0 failed**, desktop lib
**1313 passed / 0 failed**, tablet lib **520 passed / 0 failed**.
`cargo check --lib` clean for all three crates; `cargo fmt --all --check`
clean. 7 new desktop and 7 new tablet auth wiring tests, all green.

### Process notes
- `db/mod.rs` carried only my one module line, so it IS in this pathspec
  (unlike the retention commit, where the same file was regional-only and was
  excluded).
- `crates/oz-core/src/db/tax.rs` and `tax_tests.rs` went dirty from another
  agent mid-session and four `ui/src/*.tsx` files were staged by someone else;
  the explicit pathspec kept all six out of this commit.
- `commands/auth.rs` was confirmed NOT hot before editing.

---

## 2026-09-08 — Audit remainder #2: staff-management events + the global read path

finisher-B, slice 2 of the audit baseline. Landed as TWO commits: a
`fix(audit)` repair that this slice's own testing uncovered, then
`feat(audit)` on top.

### CORRECTION to the entry above, and to landed commit `2fb2b873`'s body

That body says *"the global DB already carries api.write and system events and
is already swept by the retention daemon"*. The **api.write half is false**.
`StoreAuditSink` (`apps/desktop-client/src/local_api.rs`) is constructed with
the API's **served-store** connection — `local_api.rs:91`:
`StoreAuditSink::new(api_db.clone(), store_id)` — and its own doc says
"writing API mutations into the SERVED store's `audit_log` table". So
api.write is a per-store row, exactly like the rest of the business audit
trail.

That mattered, because slice 2 was scoped as "extend the read path — precedent:
api.write already lives in the global DB". There is **no such precedent**. The
security events are the FIRST global-DB audit rows to have any read path at
all, which is why (b) had to be designed rather than copied. Recorded here
rather than by editing the landed message.

### The bug the tests found: `require_audit_tier` could never have run

`apps/desktop-client/src/commands/audit.rs` and the tablet's both had:

```rust
fn require_audit_tier(state: &AppState) -> Result<(), AppError> {
    let db = state.db.blocking_lock();
```

`state.db` is a **tokio** `Mutex`. In tokio 1.49 `blocking_lock` is
`future::block_on(self.lock())`, and that function's first statement is
(`~/.cargo/registry/.../tokio-1.49.0/src/future/block_on.rs`):

```rust
let mut e = crate::runtime::context::try_enter_blocking_region().expect(
    "Cannot block the current thread from within a runtime...");
```

There is **no uncontended fast path** — the check fails whenever the current
thread is driving async tasks, which is every thread that polls a Tauri
command. So all **9** call sites (4 desktop + 5 tablet; counted at HEAD with
`grep -c 'require_audit_tier(&state)?;'`) were a guaranteed panic on first
real use of the Premium audit screen.

Why it survived:
- `grep` over `*_tests.rs` for `list_audit_log_scoped` /
  `export_audit_log_scoped` / `get_audit_review_status_scoped` → **zero**
  hits. The audit command surface had no Rust-layer test whatsoever.
- E2E cannot reach it: `ui/src/dev-mock/tauri-api.ts:3789` answers
  `list_audit_log_scoped` in JavaScript, so no Rust executes.
- The repo already knew the hazard elsewhere — `local_api_command_tests.rs:94`:
  *"no lock needed, `blocking_lock` would panic inside the test runtime"*.

Fix: the gate is now `async` and does `state.db.lock().await`, with a
"Why this is async and awaits the lock" doc block at both definitions so nobody
optimises the await away. 9 existing call sites converted + this slice's new
10th.

The rule that made this findable: **write the IPC-layer test even when you
think the core test already covers it.** The core tests were green for two
slices while the command that calls them could not execute.

### What landed (feature)

**(a) Emissions** — `create_staff_scoped` and `update_staff_scoped` on both
clients, through the same `record_security_event` sink as the auth paths:

| event | action | classifier |
|---|---|---|
| account created | `user.create` | `account_created` |
| profile/role/active edited | `user.update` | `profile_changed` |
| PIN rotated | `user.update` | `pin_rotated` |

Same confirmed-Free gate, same fail-open rule — the gate is the recorder's, not
the event kind's, so a staff edit on a confirmed Free tenant writes nothing and
a tampered subscription row still writes.

`SecurityEvent` gained one field, `subject_id: Option<String>`, and a
`staff_change(actor, subject, username, action, reason)` constructor. Login
events leave it `None` (a login is self-caused); staff events set it. So
`audit_log.user_id` is the **actor** and `target_id` the **subject** — the
convention `staff.identity.read` in `db/profile.rs` already uses.

**(b) Read path** — `Store::list_security_events(outcome, query, cursor,
limit)`, plus `list_security_events_scoped` on both clients.

### Design decisions worth keeping

**A PIN rotation does not get its own action string.** The catalog
(`ui/src/features/audit/auditCatalog.ts`) has `user.create` and
`user.update` — both already in `CRITICAL_ACTIONS` — and no pin key.
Inventing `user.pin_change` would strand a label and render through
`audit-action-unknown`. So the rotation is a `user.update` whose details carry
`reason: "pin_rotated"`: fully labelled today, still exactly separable in a
query, and nothing queued for the FTL window. **`logout` remains the only
security action still waiting on a label.**

**Staff events are recorded INSIDE the update transaction.**
`update_staff_scoped` wraps profile + assignment + PIN in one
`unchecked_transaction`; the recorder is called on `Store::new(&tx)` before
`tx.commit()`. So a rolled-back edit leaves no phantom event and a committed
edit can never be missing its trail. The create path cannot do this —
`create_user_with_profile` commits its own transaction — so its event is
written just after the account exists; a failure there loses the event but can
never strand the account. Pinned by
`a_rejected_create_records_no_security_event`.

**One SQL builder, not two.** `list_audit_entries_filtered` became a thin
wrapper over a new `pub(crate) list_audit_entries_page(..., actions)`. The
security page passes an action allow-list; the general page passes `None`.
Both share the LIKE-escaping and the `(created_at, id)` keyset contract, so
they cannot drift. An **empty** allow-list matches nothing (`1 = 0`) rather
than falling through to an unfiltered dump — a caller that forgets to populate
its allow-list must not be rewarded with every audit row.

**Scope isolation: the objection does not bite, and the reasoning is in the
command doc.** "Can one store's admin read another store's staff auth trail?"
presumes a per-store partition that does not exist: users/roles are global
records (ADR #4 / ADR #7 — the store-scoped files contain no `users` rows),
`list_staff_scoped` already exposes that table in full to any `staff:read`
session, and a login happens *before* a store is selected, so an auth event
carries no store attribution to withhold. The command discloses nothing new; it
makes an already-readable dataset queryable. Gates are unchanged: Premium+ tier
and `audit:view`.

**The client helper became the client's single sink.** `record_security_event`
in each `commands/auth.rs` is now `pub(crate)` and shared by the auth and
staff commands, so the per-client `debug_upgrade` policy (desktop `true`,
tablet `false`) is stated exactly once per client and cannot drift between
them.

### Gates

Core audit **94 passed** (was 83). Desktop staff **53**, tablet staff **31**,
desktop audit **13**, tablet audit **16**. Full desktop lib **1322 passed /
0 failed**. `cargo check -p oz-pos-app -p oz-pos-tablet --lib` clean.

### Process notes

- **`staff_tests.rs` is hot and was dirty on both clients**, so the staff
  wiring tests went into NEW sibling files
  (`commands/staff_security_events_tests.rs`) wired from `staff.rs` as a
  second `#[cfg(test)] #[path = ...] mod`. The hot file was never opened for
  edit. Same for the read-path tests (`audit_security_events_tests.rs`).
- Commit splitting: the new command lives in the same `audit.rs` files as the
  gate fix, so a pathspec-only split was impossible. I extracted the command
  block, restored `audit.rs`/`lib.rs` to HEAD, landed `fix(audit)` with its
  own regression tests, then re-added the command for `feat(audit)`. Two clean
  commits instead of one `fix` that secretly adds a feature.
- **`verify-ipc-parity.py` rejects an uninvoked scoped command** — it calls it
  "a redundant twin" and fails the run. Registering an IPC surface without a
  UI caller is NOT a no-op: either wire the caller or add a dated
  `scoped_orphans` entry to `scripts/ipc-parity-allowlist.json` with a reason.
  This is the gate that enforces the "stop at the core+IPC boundary" rule.
- The tree broke mid-verification from another agent's in-flight tax work
  (`db/tax.rs:744` had a backtick pasted inside a `format!`, killing the whole
  `oz-core` crate and therefore `cargo fmt --all`, pre-commit step 1). I did
  not touch their files and did not commit over a red build; re-verified from
  scratch once theirs settled.

