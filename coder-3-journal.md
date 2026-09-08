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
