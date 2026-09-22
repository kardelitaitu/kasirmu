# Remediation Checklist - kasir.mu

Derived from manager-codebase-review.md (commit 954d4b094), 2026-09-23. Nothing here is new evidence: every item traces to a numbered section of that review, and the acceptance check is the one stated there.

**How to use it.** Work top-down. Wave 1 items are individually shippable, but three have ordering constraints: C11 (snapshot before migrating) and C12 (variance report) are prerequisites for C10 and C3 respectively, and C7 is an ops change rather than a code change. Do not batch a schema change with the code that depends on it. Never raise a ceiling, never re-label a gate to make a registry self-consistent, and never retry a failed fix a fourth time - after three red gates on one area, diagnose the root cause instead. Record the command and its result in the verification log at the end when you tick an item.

---

## Wave 1 - before the next release (P0)

- [ ] **C1 [P0] Default to a real at-rest key instead of a public constant** (6.2, remediation P0-7)
  Fence: crates/kasirmu-crypto/src/lib.rs:59-111; the boot path of apps/desktop-tauri/src/lib.rs, apps/mobile-tauri/src/lib.rs, apps/cloud-server/src/main.rs; the README clause that conflates the keychain with the at-rest key.
  Done when: a per-install key is held in the OS keychain, a test asserts the static fallback cannot be reached in a release build, and a row written under the legacy derivation still decrypts after the key exists. **Precondition, and it is most of the work: make the reader branch-tolerant first** (see D1) - simply setting the environment variable, or refusing to boot without it, silently bricks five credential families and both PII columns on any existing install, including two families that have no product setter to restore them.

- [ ] **C2 [P0] Put an integrity gate on plugin loading** (6.4, P0-8)
  Fence: crates/kasirmu-plugin/src/lib.rs:8-12; manager.rs:109-129 and :218-308; apps/desktop-tauri/src/state.rs:325-347 and :702-755; manifest.rs:186-192.
  See D7 for the recommended shape (signed/checksummed manifest, operator grant, gated watcher - not removing the host). Done when: a modified .lua file is refused with a visible error and the previous plugin set keeps running; required_permissions become an operator grant rather than a self-declaration; allow_network / allow_filesystem / allow_http are either enforced or deleted.

- [ ] **C3 [P0] Make the pull idempotent per effect, not per item** (5.1, P0-2)
  Fence: platform/sync/src/queue.rs:438-443; apps/cloud-server/src/sync_store/pg.rs:163-166; plus a migration adding an origin/terminal column to offline_queue (20260813_init.sql:353-362 shows it has none).
  Done when: a test pushes a complete_sale, pulls it back, and asserts stock moved exactly once. Prefer the client-side origin check; use the server-side terminal filter only if a second puller class appears. **Prerequisite: C12.**

- [ ] **C4 [P0] Give refunds, voids and payments a sync arm** (5.2, P0-3)
  Fence: platform/sync/src/queue.rs:558-563 - they currently fall to Err(unsupported remote sync action) and dead-letter.
  Done when: a refund made on terminal A is visible on terminal B after a pull, with stock and shift figures consistent on both. Copy the idempotence pattern already used by finalize_sale (queue.rs:553-557) rather than inventing one.

- [ ] **C5 [P0] Stop counting voided and pending sales as revenue** (8.2, P0-4)
  Fence: crates/kasirmu-core/src/db/sales.rs:266-269 (export_daily_summary, no status predicate); crates/kasirmu-bridge/src/history.rs:319 versus :326, :347, :358 (two day definitions on one sheet).
  Done when: a voided sale does not change total_revenue, and the EOD header reconciles with its own payment breakdown on a refund-and-void fixture - a fixture that does not exist today and has to be written.

- [ ] **C6 [P0] Make the report timezone contract match the write contract** (8.1, P0-5)
  Fence: crates/kasirmu-core/src/db/reports/datetime.rs:26-47 and :96-98 (25 call sites inherit the silent UTC fallback); crates/kasirmu-core/src/timezone.rs:18-45 (the correct mapping that already exists); crates/kasirmu-core/src/db/provisioning.rs:467-476 and :514-564 (no validation of the timezone it writes); ui/src/features/analytics/analytics-data.ts:86-97 and :118.
  Done when: a store provisioned as Asia/Jakarta reports a 00:30 local sale on that local day, asserted by a test, and provisioning rejects or normalizes anything the reporting path cannot interpret. This is a code fix - there is no data fix, because the writer refuses offsets.

- [ ] **C7 [P0] Turn tenant isolation on for real - as a role change, not a schema edit** (7.1, P0-6)
  Fence: scripts/rls-cutover.sql:7-10, :33-42, :56 (its comment claiming 19 tables is stale against its own 34-table array); the connection configuration that carries DATABASE_URL.
  Sequence (see D2): create the oz_app role, grant DML on the 30 tables, point DATABASE_URL at it **and set OZ_APPLY_SCHEMA=0 in the same step**, verify, and only then consider FORCE as the follow-up. Keep **both** BYPASSRLS roles (webhook resolution and email discovery/prune) and the /status tolerance. Note the blocker this review first missed: the shipped PostgreSQL profile connects as a **superuser** (docker-compose.pg.yml sets POSTGRES_USER and DATABASE_URL from one variable, :21 and :39), and superusers bypass RLS even with FORCE on - so the cutover alone enforces nothing. Add a boot-time rolsuper / relforcerowsecurity assertion. Never add FORCE to the generated migration while the app connects as the table owner - every query would return zero rows on deploy.
  Done when: a tenant-table query without the tenant GUC returns zero rows and a write is rejected, a query with the GUC returns only that tenant's rows, and the reversal (NO FORCE plus DROP ROLE) is written down and rehearsed. Decide D2 first: if no deployment has run the cutover, this is live.

- [ ] **C8 [P0] Make recovery real: restore in the app, a backup that survives, verification on both sides** (14.1, P0-9)
  Fence: crates/kasirmu-cli/src/commands/backup.rs:62-98 (the only restore); crates/kasirmu-core/src/db/mod.rs:264-272 and :281-305 (destination deleted before it is written) and :319 (check_integrity, no production caller); crates/kasirmu-bridge/src/data.rs:146-150 and :330-348; apps/desktop-tauri/src/commands/data.rs; ui/src/api/data.ts; ui/src/app/UpdateBanner.tsx:143-155 and :179-189.
  Approach (see D5): a **safe-mode boot flag** rather than an in-process restore - the live connection is an Arc shared with twelve detached daemons that cannot be joined, and there is no restart primitive. Done when: a restore_roundtrip test backs up through the same command the UI calls, corrupts the live database, restores from the app path, and asserts check_integrity() is Ok with a known sale reading back; a second case asserts a corrupt backup is refused and the live file is left byte-identical. Backups write to a temporary name and rename over the previous only on success; at least two generations are kept; the app either quiesces or refuses a restore while another process holds the database.

- [x] **C9 [P0] Decide what qris-core is, and make the manifest say it** - DONE 2026-09-23, commit 57e0f8c84 (14.4, P0-10)
  Fence: crates/qris-core/Cargo.toml:6, :7, :9 (publish = true, MIT OR Apache-2.0, repository YOUR_ORG); deny.toml:83-268 (no entry for it, while MIT and Apache-2.0 are already allowlisted so cargo deny passes); root Cargo.toml:40 and :42.
  Done when: either it is proprietary like everything else (publish = false, license.workspace = true, a deny.toml clarification entry) or it is genuinely dual-licensed (LICENSE-MIT and LICENSE-APACHE committed, a real repository and authors, the deny.toml entry). cargo deny must no longer be blind to the difference. Owner decision D4: recommendation is to make it proprietary - zero dependents and no offline QRIS role today, while the code is worth keeping for the planned notification listener.

- [ ] **C10 [P0] Fix the transaction mode, the missing guard and the test that cannot see either** (4.1-4.3, P0-1)
  Fence: sales_checkout.rs:210, sales_lifecycle.rs:179 and :606, refunds.rs:66, gift_cards.rs:53, loyalty.rs:463, shifts.rs:109 (Immediate); a backfill migration before CHECK (qty >= 0) on stock_summary lands (20260813_init.sql:739-746 has none today); sales_tests.rs:3022-3092 (add busy_timeout, assert the lock error); migrations.rs:463-509 (fresh_db must apply production pragmas).
  Done when: (a) all seven sites use TransactionBehavior::Immediate; (b) the CHECK lands **after** a backfill that clamps or quarantines existing negatives, or it bricks startup; (c) fresh_db() carries busy_timeout 5000 and the loser of the concurrency test fails with a lock error rather than an unexamined one. **Prerequisite: C11.** Do not hunt for a reproduction of an oversell - the defect is the false invariant and the untested error path.

- [ ] **C11 [P1, prerequisite] Snapshot before every migration, and document the pre-flight** (14.2)
  Fence: platform/core/src/database/migrations.rs:112-121 (drift is repaired by re-running SQL on live data) and :424-446 (per-statement fallback loses per-file atomicity); docs/operations/ (no pre-upgrade procedure for the desktop file); scripts/backup-db.sh.
  Done when: a test asserts a snapshot exists after migrations::run, a migration that fails midway leaves both the database and the snapshot intact, and the runbook names the four pinned un-re-runnable migrations (migrations_tests.rs:361-366) as the reason.

- [ ] **C12 [P1, prerequisite] Variance report for stock already double-deducted** (5.1 remediation)
  Fence: a new reconciliation over stock_summary against stock_movements per (item, location).
  Done when: the report exists, has a test on a seeded double-deducted fixture, and an operator can accept or adjust each difference. Never write a blanket qty = SUM(deltas) update - it destroys legitimate manual adjustments.

---

## Wave 2 - next, each small and testable (P1)

- [ ] **C13 Bound the Lua tax hook and close the override asymmetry** (6.5) - range-check rate_bps exactly as discounts are checked (kasirmu-lua, sales.rs:473-506), and make the shortfall door pass the same overrides as the main door (bridge/pos.rs:1868-1873 versus :1567, :1575).
- [ ] **C14 Stop treating local_api.secret as plaintext and stop double-purposing it** (6.6) - crates/kasirmu-local-api/src/lib.rs:48-60, :202-227; clamp expiry_hours on POST /api/v1/tokens as the IPC mint already does (kasirmu-api/src/auth.rs:200-202).
- [ ] **C15 Give one sale one total** (9.2) - decide whether tip and service belong in sales.total_minor or only in payments, and make validate_payment_splits_cover_total compare like with like (db/sales.rs:247; sales_checkout.rs:522-534, :613).
- [ ] **C16 Fix the drawer: split tender and refund attribution** (8.4) - derive expected_cash from the payments table rather than the payment_method stamp; attribute refunds to refunds.processed_by (db/shifts.rs:147-186 versus :302-314; refunds.rs:340-342). Add the missing close_shift tests for split tender and house-account credit.
- [ ] **C17 Work the IPC gate debt down deliberately** (7.3) - delete the renderer-supplied user_id variant of settings::set_setting in favour of the scoped twin (commands/settings.rs:243-253); gate create_backup or document it as a deliberate unauthenticated filesystem write (bridge/data.rs:330-347); lower the two generated ceilings, never raise them.
- [ ] **C18 Wrap the money-path autocommit writes** (4.4) - 138 conn.execute sites in db/ outside tests; make update_sale_status a conditional in-transaction update like void_sale already is (sales_crud.rs:558-600 versus sales_lifecycle.rs:787-798).
- [ ] **C19 Enforce conflicts, or stop pretending to** (5.4, 5.5) - consume Decision::LastWriterWins and Decision::AutoMerge or delete the computation; add sale to the money-entity test so a completed sale stops classifying as low-severity catalog metadata; write the 'delivering' state the CHECK constraint already allows; guard and transact mark_offline_synced (db/offline.rs:421-431).
- [ ] **C20 Order the queue by priority on every push path** (5.3) - the daemon (platform/sync/src/daemon.rs:139) and the desktop bridge (kasirmu-bridge/src/sync.rs:545) do not sort, the tablet does (mobile commands/offline.rs:342).
- [ ] **C21 Stop storing gift-card numbers in plaintext** (6.3) - 20260813_init.sql:135-137, :1126; they ride every unfiltered .db and .backup.db snapshot.
- [ ] **C22 Read base_total_minor in reports, and fix the screen that adds currencies** (8.5) - kasirmu-reporting/menu_engineering.rs:90-95 is wired to a live screen (ui/src/api/reports.ts:529-534); the schema already carries sales.base_currency and base_total_minor (20260821_tender_currency.sql:1-8) and no report reads them.
- [ ] **C23 Make a panic visible and recoverable** (14.3) - catch_unwind (or the Tauri equivalent) so a command returns an error instead of hanging the promise; make spawn_watched restart or at least tear down and report (platform/startup/src/lib.rs:341-361); clear the sync daemon's running flag on task exit, not only on the normal path (platform/sync/src/daemon.rs:353, :461).
- [ ] **C24 Make accessibility able to fail a build** (9.5) - wire test:a11y into CI as blocking (check.sh:309-313 is advisory-WARN today and no workflow runs it), and fix inventory/TransactionLogScreen.tsx:238-241 (mouse-only row) plus the missing alt at ProductThumb.tsx:81.
- [ ] **C25 Make the gate registry tell the truth** (11.1) - add clippy and e2e to dev-ci.yml; re-label perf-smoke and data-testid-compliance as advisory; call check.sh from .githooks/pre-push or state plainly that a push is not the gate. Do not re-label clippy or e2e to make the registry self-consistent.
- [ ] **C26 Decide the architecture boundary before 2026-11-06** (10.2, 10.3) - re-tier the checker with a named rule for the seven type-only re-export edges and an ADR, or move the model types back down; either way add a checker test that a bumped expiry without a new reason fails. Owner decision D3: close the currency edge now, add a named rule for the seven type shims, and move the model types into foundation later - do not bump the dates.
- [x] **C27 Reconcile the container's proxy with the licence server's routes** - DONE 2026-09-23, commit 65f69112f (12.1) - apps/unified/Caddyfile:44-72 misses pairing/* and midtrans/*, so five registered routes 404 in the shipped image; the checker that would catch this already exists, is registered as required (scripts/check.sh:102, gates.json:613), and **is red on the current tree** - node scripts/check-unified-routes.mjs exits 1 naming /api/v1/pairing/*. Add the pairing and midtrans handles, then widen the checker to read the Go path constants rather than main.go string literals, because otherwise it can never see the Midtrans paths (see D8).

---

## Wave 3 - hygiene that compounds (P2)

- [ ] **C28 Size and structure** - 16 production files over the 1,000-line limit (kasirmu-api/src/pg.rs at 2,904 is worst); 568 test functions inline in 52 production files against AGENTS.md section 2; ui build debris at the frontend root; the 12,186-line single test file; the production Profiler in KdsScreen.tsx:390-394.
- [ ] **C29 Declared-but-inert surface** - decide per item (13): file/rotation log sinks, the rate-sync daemon, the scale driver that is never registered, the EDC stubs registered on a money path, the modules' test-only services, kasirmu-media (one-line workspace-exclude first, then delete) - and **kasirmu-lan**, which D6 recommends retiring the same way, since it has no client in either shell and the in-app KDS board does not need it. The empty plugin IPC surface is D7.
- [ ] **C30 Make the documentation true** (11) - fix the rows the review measured: test counts, migration count, workflow count, the log-sink and rate-sync claims, the ADR index range, the ui layout block, and the crates.io-style counts.

---

## Owner decisions - code is blocked on these

Full analysis - deciding facts, options with pros and cons, what would change the answer, and a recommendation - is in manager-codebase-review-decisions.md (D1-D8). The lines below are the index.

- [ ] **D1 Is OZ_MASTER_KEY set on any deployment?** Decides whether 6.2 is a live confidentiality break or a latent one.
- [ ] **D2 Has any PostgreSQL deployment run scripts/rls-cutover.sql?** Decides whether tenant isolation exists there at all.
- [ ] **D3 Architecture rule or tier order?** (10.2) Re-tier the checker with an ADR, or move ~5k lines of models back down. Forced by 2026-11-06.
- [ ] **D4 Is qris-core meant to be publishable?** (14.4) If not, it is a one-line manifest fix away from harmless.
- [ ] **D5 Is in-app restore a product feature or an ops procedure?** (14.1) Today the only restore is a CLI command.
- [ ] **D6 Is LAN KDS a product feature?** (6.7) It works and is safely defaulted, but nothing in the product can configure it.
- [ ] **D7 How much plugin trust is acceptable?** (6.4) Signed-and-verified and unsigned-hot-reload are the two ends; there is no documented middle.
- [ ] **D8 Does the unified container ship?** (12.1) If production runs the two-service compose, the five 404s are dev-only - and that should be written down.

---

## Do not do these

- [ ] Flip RLS from ENABLE to FORCE while the app connects as the table owner.
- [ ] Hand-edit the generated PG init instead of running scripts/generate-pg-migration.py.
- [ ] Backfill stock by setting qty to the sum of movement deltas.
- [ ] Raise the registration-gate debt ceilings - the ceiling is the finding.
- [ ] Delete the conflict Decision computation instead of consuming it.
- [ ] Weaken the concurrency test to success_count <= 1.
- [ ] Mark clippy or e2e advisory to make the gate registry self-consistent.
- [ ] Add busy_timeout to that test while leaving fresh_db() pragma-free.
- [ ] Add CHECK (qty >= 0) before the backfill migration has run.
- [ ] Retry the same fix a fourth time after three red gates - diagnose the root cause instead.

---

## Wave 4 - added during implementation

- [ ] **C31 [P2] Validate the Caddyfile itself, not just its routing semantics.** scripts/check-unified-routes.mjs parses apps/unified/Caddyfile as text, so a syntax error that the parser tolerates still ships and the container fails to start. Add caddy validate (or an equivalent parse) to the same gate, or state why it cannot run in CI. Found while closing C27.

## Verification log

Fill one row per ticked item. An item is not done until the command and its result are here.

| Item | Date | Command | Result | Commit |
|---|---|---|---|---|
| C1 | | | | |
| C2 | | | | |
| C3 | | | | |
| C4 | | | | |
| C5 | | | | |
| C6 | | | | |
| C7 | | | | |
| C8 | | | | |
| C9 | 2026-09-23 | cargo metadata --no-deps --format-version 1 | 39 packages, **0 with publish enabled**; qris-core now license = SEE LICENSE IN LICENSE, publish = [], repository = the real org | 57e0f8c84 |
| C9 | 2026-09-23 | grep -n qris-core deny.toml | deny.toml:273 name = "qris-core" (clarify entry present) | 57e0f8c84 |
| C9 | 2026-09-23 | cargo deny check licenses | exit 0 - licenses ok (cargo-deny 0.19.8 installed, so a real pass not a skip) | 57e0f8c84 |
| C27 | 2026-09-23 | node scripts/check-unified-routes.mjs (before) | EXIT 1 - /api/v1/pairing/* not carved out | - |
| C27 | 2026-09-23 | node scripts/check-unified-routes.mjs (after) | EXIT 0 - 7 prefixes (admin, desktop, license, midtrans, paddle, pairing, web) all -> pocketbase | 65f69112f |
| C27 | 2026-09-23 | non-vacuity: delete the new midtrans handle, re-run | EXIT 1 naming /api/v1/midtrans/* - proves the widened parser sees constant-declared routes | 65f69112f |
| C10 | | | | |
| C11 | | | | |
| C12 | | | | |

Wave 2 and wave 3 items append below as they are ticked.
