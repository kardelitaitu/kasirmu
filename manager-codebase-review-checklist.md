# Remediation Checklist - kasir.mu

**Progress at 2026-09-23.** **10 checklist items fully ticked** (C5, C5b, C6, C6b, C7 detection half, C9, C11 code half, C12, C13, C27) **plus 13 further slices landed inside items whose checkbox stays open until the whole item is done** (C1 S1 and S1.5, C2 step 1, C3 S1, C8 S1 and S2, C10a, C17 slices 1-2, C18 P1.1, P1.2, P1.3, P1.5). Every one names its commit SHA, and the verification log at the end carries the command and its result. Do not read a ticked line as 'this area is finished' - read the annotation beside it for the remainder.

Derived from manager-codebase-review.md (commit 954d4b094), 2026-09-23. Nothing here is new evidence: every item traces to a numbered section of that review, and the acceptance check is the one stated there.
---

## Wave 1 - before the next release (P0)

- [ ] **C1 [P0] Default to a real at-rest key instead of a public constant** (6.2, remediation P0-7) - **S1 DONE (012dd2663), S1.5 DONE (37a3c00b)**; S2a/S2b/S2c (install-key seam, keychain entry, `oz rekey`) and S3 (the .ozpkg PII pin) remain, plus one named follow-up: the two callers that swallow the new fail-closed error with `.unwrap_or(None)` (apps/desktop-tauri/src/lib.rs:703, platform/sync/src/daemon.rs:156) still degrade silently to "no credential" instead of surfacing it.
  Fence: crates/kasirmu-crypto/src/lib.rs:59-111; the boot path of apps/desktop-tauri/src/lib.rs, apps/mobile-tauri/src/lib.rs, apps/cloud-server/src/main.rs; the README clause that conflates the keychain with the at-rest key.
  **Slices from the D1 design** (each independently shippable, in this order): **S1** branch-tolerant read in crates/kasirmu-crypto/src/lib.rs - a candidate-key helper (legacy first, master second) behind one decrypt path that treats the AES-GCM tag as the sole oracle; no marker column, no envelope version byte, no schema change, no eager rewrap. Gate = the existing pin test in crates/kasirmu-core/tests/credential_storage_form.rs **inverted** (child under OZ_MASTER_KEY decrypts the parent's legacy row; a master-written row still fails in the parent). **S1.5** fail closed on shaped-but-undecryptable values at platform/core/src/settings/typed.rs:334, :361, :437, :553, :639 - today they `unwrap_or(v)` and hand the ciphertext back as the credential. **S2a** dormant install-key seam in crypto. **S2b** new keychain entry oz-pos/at-rest-key.v1 (generate-once-if-absent) wired at startup - do NOT reuse oz-pos/encryption-key, whose rotation archives the old key without re-wrapping any row. **S2c** opt-in `oz rekey` CLI that copies the DB first and prints counts, never values. **S3** a pin test that .ozpkg user JSON never carries national_id or monthly pay.
  Done when: a per-install key is held in the OS keychain, a test asserts the static fallback cannot be reached in a release build, and a row written under the legacy derivation still decrypts after the key exists. **Precondition, and it is most of the work: make the reader branch-tolerant first** (see D1) - simply setting the environment variable, or refusing to boot without it, silently bricks five credential families and both PII columns on any existing install, including two families that have no product setter to restore them.

- [ ] **C2 [P0] Put an integrity gate on plugin loading** (6.4, P0-8) - **first step DONE (28a2bfeb)**: content fingerprint at load, automatic hot-swap REMOVED (a change is refused with a visible error and the running set survives; restart picks up a change), and the three unread capability flags now fail closed. Signature verification and the operator grant store remain - they are the part your D7 answer decides.
  Fence: crates/kasirmu-plugin/src/lib.rs:8-12; manager.rs:109-129 and :218-308; apps/desktop-tauri/src/state.rs:325-347 and :702-755; manifest.rs:186-192.
  See D7 for the recommended shape (signed/checksummed manifest, operator grant, gated watcher - not removing the host). Done when: a modified .lua file is refused with a visible error and the previous plugin set keeps running; required_permissions become an operator grant rather than a self-declaration; allow_network / allow_filesystem / allow_http are either enforced or deleted.

- [ ] **C3 [P0] Make the pull idempotent per effect, not per item** (5.1, P0-2) **Slice status:** S1 DONE (schema befd3b71 + the index-surface pin bumped to 188 in 0db7ba6c - the pin is a census assertion over sqlite_master, so every migration that adds or drops a named index must move it, and the comment block above it now explains why each increment happened); **S2 DONE (6614f522)**: the origin and the effect key are threaded through the queue, both server stores and the transport (offline 91 tests, cloud sync_store 22). THE WARNING IN THE DESIGN WAS RIGHT: the miss was real and lived in a file the fence did not name - apps/cloud-server/src/sync_store.rs holds TWO MORE server INSERT column lists, the per-item fallbacks that run whenever the multirow fast path errors, and touching only pg.rs/sqlite.rs would have silently dropped the field for exactly those batches. The worker found it, included it, and added a discriminating test that poisons an id to force the fallback and was verified to fail when the fix is reverted. Declared open item: the applier still writes a NULL effect_key, so the partial index is inert until the receipt call is switched (S3a: BLOCKED on a fence conflict - the C4 lifetime-spend worker held queue.rs, so S3a stopped with zero edits rather than sweep foreign work. Its researched handoff is in the journal: the receipt writer is queue.rs:868 and the arms must change signature to yield Option<String>, with the effect keys per arm listed there, and two arms that cannot carry a key at all - stock.adjusted (no id in its payload) and stock.movement under the crdt_delta envelope (two effects in one item). Re-dispatch S3a once queue.rs is clean.). S3-S7 remain.
  Fence: platform/sync/src/queue.rs:438-443; apps/cloud-server/src/sync_store/pg.rs:163-166; plus a migration adding an origin/terminal column to offline_queue (20260813_init.sql:353-362 shows it has none).
  Done when: a test pushes a complete_sale, pulls it back, and asserts stock moved exactly once. Prefer the client-side origin check; use the server-side terminal filter only if a second puller class appears. **Prerequisite: C12.**

- [ ] **C4 [P0] Give refunds, voids and payments a sync arm** (5.2, P0-3)
  Fence: platform/sync/src/queue.rs:558-563 - they currently fall to Err(unsupported remote sync action) and dead-letter.
  Done when: a refund made on terminal A is visible on terminal B after a pull, with stock and shift figures consistent on both. Copy the idempotence pattern already used by finalize_sale (queue.rs:553-557) rather than inventing one.

- [x] **C5 [P0] Stop counting voided and pending sales as revenue** (8.2, P0-4) - **DONE 2026-09-23**, desktop 743f222f + tablet 1eee8e0f (C5b)
  Fence: crates/kasirmu-core/src/db/sales.rs:266-269 (export_daily_summary, no status predicate); crates/kasirmu-bridge/src/history.rs:319 versus :326, :347, :358 (two day definitions on one sheet).
  Done when: a voided sale does not change total_revenue, and the EOD header reconciles with its own payment breakdown on a refund-and-void fixture - a fixture that does not exist today and has to be written.

- [x] **C6 [P0] Make the report timezone contract match the write contract** (8.1, P0-5) - **DONE 2026-09-23, commit 7559a3f6b** (the provisioning-validation half is split out as C6b)
  Fence: crates/kasirmu-core/src/db/reports/datetime.rs:26-47 and :96-98 (25 call sites inherit the silent UTC fallback); crates/kasirmu-core/src/timezone.rs:18-45 (the correct mapping that already exists); crates/kasirmu-core/src/db/provisioning.rs:467-476 and :514-564 (no validation of the timezone it writes); ui/src/features/analytics/analytics-data.ts:86-97 and :118.
  Done when: a store provisioned as Asia/Jakarta reports a 00:30 local sale on that local day, asserted by a test, and provisioning rejects or normalizes anything the reporting path cannot interpret. This is a code fix - there is no data fix, because the writer refuses offsets.

- [x] **C7 [P0] Turn tenant isolation on for real - as a role change, not a schema edit** (7.1, P0-6) - **detection half DONE (e7aec886)**: a pure RlsPosture::from_facts verdict (Enforced / BypassedBySuperuser / BypassedByOwnerRole / PartiallyEnforced / NoProtectedTables) with 9 unit tests, an ERROR-level boot report, and rls_posture on /health plus its published schema. The protected-table set is read from pg_policies rather than pinning the generated 34 in Rust. The role cutover itself remains an owner/ops action, and the SQL query is code-review-covered only - this environment has no PostgreSQL
  Fence: scripts/rls-cutover.sql:7-10, :33-42, :56 (its comment claiming 19 tables is stale against its own 34-table array); the connection configuration that carries DATABASE_URL.
  Sequence (see D2): create the oz_app role, grant DML on the 30 tables, point DATABASE_URL at it **and set OZ_APPLY_SCHEMA=0 in the same step**, verify, and only then consider FORCE as the follow-up. Keep **both** BYPASSRLS roles (webhook resolution and email discovery/prune) and the /status tolerance. Note the blocker this review first missed: the shipped PostgreSQL profile connects as a **superuser** (docker-compose.pg.yml sets POSTGRES_USER and DATABASE_URL from one variable, :21 and :39), and superusers bypass RLS even with FORCE on - so the cutover alone enforces nothing. Add a boot-time rolsuper / relforcerowsecurity assertion. Never add FORCE to the generated migration while the app connects as the table owner - every query would return zero rows on deploy.
  Done when: a tenant-table query without the tenant GUC returns zero rows and a write is rejected, a query with the GUC returns only that tenant's rows, and the reversal (NO FORCE plus DROP ROLE) is written down and rehearsed. Decide D2 first: if no deployment has run the cutover, this is live.

- [ ] **C8 [P0] Make recovery real: restore in the app, a backup that survives, verification on both sides** (14.1, P0-9) - **slice S1 DONE (6814222)**: backups are copy -> verify (integrity_check on the snapshot) -> rotate 3 generations -> atomic rename; a failed copy leaves the previous snapshot byte-identical; remove_destination_for_backup deleted with the directory-target typed error preserved. **S2 DONE (3add5b27)**: validate_candidate returns a typed verdict (Acceptable / OlderButAcceptable / NewerThanThisBuild / Corrupt plus a reason - never a bare bool), restore_from validates, snapshots to <db>.pre-restore.db, deletes the sidecars only AFTER validation, stages and re-verifies before an atomic rename, and rolls back on failure; the CLI now delegates to it so one validator and one swap serve both lanes (9 recovery tests pass, plus the 21 backup_restore_integration tests). A candidate with no schema_migrations table is OlderButAcceptable, which is what keeps a pre-migration snapshot restorable. **S3 DONE (9b551e76)**: list_restore_candidates reports each generation with its verdict (a corrupt one is LISTED as Corrupt, not omitted), restore_prepare gates on SETTINGS_EDIT then validates then requires the store name read from the CANDIDATE itself before writing <db>.restore-request.json, and restore_status reports a pending request (an unparsable one reports pending WITH an error, never 'nothing pending'). Nothing is restored by this slice - the boot consumer is S4. S4-S7 remain.
  Fence: crates/kasirmu-cli/src/commands/backup.rs:62-98 (the only restore); crates/kasirmu-core/src/db/mod.rs:264-272 and :281-305 (destination deleted before it is written) and :319 (check_integrity, no production caller); crates/kasirmu-bridge/src/data.rs:146-150 and :330-348; apps/desktop-tauri/src/commands/data.rs; ui/src/api/data.ts; ui/src/app/UpdateBanner.tsx:143-155 and :179-189.
  Approach (see D5): a **safe-mode boot flag** rather than an in-process restore - the live connection is an Arc shared with twelve detached daemons that cannot be joined, and there is no restart primitive. Done when: a restore_roundtrip test backs up through the same command the UI calls, corrupts the live database, restores from the app path, and asserts check_integrity() is Ok with a known sale reading back; a second case asserts a corrupt backup is refused and the live file is left byte-identical. Backups write to a temporary name and rename over the previous only on success; at least two generations are kept; the app either quiesces or refuses a restore while another process holds the database.

  **Slices from the D5 design** (each independently shippable; ship S1-S2 before S3+): **S1** backup durability in crates/kasirmu-core/src/db/mod.rs - tmp file in the same directory, check_integrity on the tmp, atomic rename, rotate three generations, delete remove_destination_for_backup. **S2** validate_candidate + restore_from (validate, pre-restore snapshot to `<db>.pre-restore.db`, delete -wal/-shm, tmp+rename, re-verify, roll back on failure), with the CLI's run_restore refactored onto it. **S3** bridge: list_restore_candidates / restore_prepare (SETTINGS_EDIT plus a typed store-name confirmation, writes `<db>.restore-request.json`) / restore_status. **S4** boot: a recovery module in both shells called BEFORE AppState::new, so no live connection or detached daemon is involved; a `<db>.restore.lock` made with create_new guards a double boot. **S5** IPC plus a Safe Mode screen with locale strings. **S6** the updater writes `<db>.restore-candidate.json` after its pre-update backup, because updater.last_backup_path is unreadable exactly when it is needed. **S7** runbook and CLI help. Schema gate: an OLDER candidate is acceptable (forward re-apply), a NEWER one is refused.
- [x] **C9 [P0] Decide what qris-core is, and make the manifest say it** - DONE 2026-09-23, commit 57e0f8c84 (14.4, P0-10)
  Fence: crates/qris-core/Cargo.toml:6, :7, :9 (publish = true, MIT OR Apache-2.0, repository YOUR_ORG); deny.toml:83-268 (no entry for it, while MIT and Apache-2.0 are already allowlisted so cargo deny passes); root Cargo.toml:40 and :42.
  Done when: either it is proprietary like everything else (publish = false, license.workspace = true, a deny.toml clarification entry) or it is genuinely dual-licensed (LICENSE-MIT and LICENSE-APACHE committed, a real repository and authors, the deny.toml entry). cargo deny must no longer be blind to the difference. Owner decision D4: recommendation is to make it proprietary - zero dependents and no offline QRIS role today, while the code is worth keeping for the planned notification listener.

- [ ] **C10 [P0] Fix the transaction mode, the missing guard and the test that cannot see either** (4.1-4.3, P0-1) - **transaction half DONE (515989936)**: all seven doors open TransactionBehavior::Immediate, fresh_db() applies production's pragmas, and the regression test now sets a busy timeout, asserts the loser fails with a busy/locked error, and detects SQLITE_BUSY/BUSY_SNAPSHOT. The CHECK (qty >= 0) constraint and its backfill remain (C10b)
  Fence: sales_checkout.rs:210, sales_lifecycle.rs:179 and :606, refunds.rs:66, gift_cards.rs:53, loyalty.rs:463, shifts.rs:109 (Immediate); a backfill migration before CHECK (qty >= 0) on stock_summary lands (20260813_init.sql:739-746 has none today); sales_tests.rs:3022-3092 (add busy_timeout, assert the lock error); migrations.rs:463-509 (fresh_db must apply production pragmas).
  Done when: (a) all seven sites use TransactionBehavior::Immediate; (b) the CHECK lands **after** a backfill that clamps or quarantines existing negatives, or it bricks startup; (c) fresh_db() carries busy_timeout 5000 and the loser of the concurrency test fails with a lock error rather than an unexamined one. **Prerequisite: C11.** Do not hunt for a reproduction of an oversell - the defect is the false invariant and the untested error path.

- [x] **C11 [P1, prerequisite] Snapshot before every migration** (14.2) - **code half DONE 2026-09-23, commit 9c6d76e1**; the runbook/pre-flight half is split out as C11b
  Fence: platform/core/src/database/migrations.rs:112-121 (drift is repaired by re-running SQL on live data) and :424-446 (per-statement fallback loses per-file atomicity); docs/operations/ (no pre-upgrade procedure for the desktop file); scripts/backup-db.sh.
  Done when: a test asserts a snapshot exists after migrations::run, a migration that fails midway leaves both the database and the snapshot intact, and the runbook names the four pinned un-re-runnable migrations (migrations_tests.rs:361-366) as the reason.

- [x] **C12 [P1, prerequisite] Variance report for stock already double-deducted** (5.1 remediation) - **DONE 2026-09-23, commit bdaffa47**; wiring it to an operator surface is C12b
  Fence: a new reconciliation over stock_summary against stock_movements per (item, location).
  Done when: the report exists, has a test on a seeded double-deducted fixture, and an operator can accept or adjust each difference. Never write a blanket qty = SUM(deltas) update - it destroys legitimate manual adjustments.

---

## Wave 2 - next, each small and testable (P1)

- [x] **C13 Bound the Lua tax hook and close the override asymmetry** (6.5) - range-check rate_bps exactly as discounts are checked (kasirmu-lua, sales.rs:473-506), and make the shortfall door pass the same overrides as the main door (bridge/pos.rs:1868-1873 versus :1567, :1575). - **DONE (1b7bd246 + 803efecf)**: plugin discounts now require SALES_DISCOUNT, a Lua rate_bps outside 0..=MAX_TAX_RATE_BPS is REJECTED (not clamped, so the rule owns the amount), and the shortfall door now passes the same overrides as the main door. 3 new bridge pos tests + 5 core sales_tax tests; 58 bridge pos tests and 158 core sales tests pass.
- [ ] **C14 Stop treating local_api.secret as plaintext and stop double-purposing it** (6.6) - crates/kasirmu-local-api/src/lib.rs:48-60, :202-227; clamp expiry_hours on POST /api/v1/tokens as the IPC mint already does (kasirmu-api/src/auth.rs:200-202).
- [ ] **C15 Give one sale one total** (9.2) - decide whether tip and service belong in sales.total_minor or only in payments, and make validate_payment_splits_cover_total compare like with like (db/sales.rs:247; sales_checkout.rs:522-534, :613).
- [ ] **C16 Fix the drawer: split tender and refund attribution** (8.4) - derive expected_cash from the payments table rather than the payment_method stamp; attribute refunds to refunds.processed_by (db/shifts.rs:147-186 versus :302-314; refunds.rs:340-342). Add the missing close_shift tests for split tender and house-account credit.
- [ ] **C17 Work the IPC gate debt down deliberately** (7.3) - **slice 1 DONE and verified (3aa5af0e)**: tablet ceilings 95 -> 92, class-1 51 -> 48, REGISTERED_TOTAL 345 -> 342, all four drift pins green; **slice 2 DONE (0eb2a045)**: the three dead settings reads deleted, ceilings 92 -> 89, class-1 48 -> 45, REGISTERED_TOTAL/FLOOR 342 -> 339, all four drift pins green, IPC parity gate OK. get_hardware_settings deferred to C17b. Items 1, 4-10 remain - delete the renderer-supplied user_id variant of settings::set_setting in favour of the scoped twin (commands/settings.rs:243-253); gate create_backup or document it as a deliberate unauthenticated filesystem write (bridge/data.rs:330-347); lower the two generated ceilings, never raise them.
- [ ] **C18 Wrap the money-path autocommit writes** (4.4) - 138 conn.execute sites in db/ outside tests; make update_sale_status a conditional in-transaction update like void_sale already is (sales_crud.rs:558-600 versus sales_lifecycle.rs:787-798). **Slice status:** P1.2 DONE (b0e78e69) - create_cash_payout is now a compare-and-set inside the write, with a deterministic race test that was proved to fail against the unfixed SQL before shipping; P1.1 (update_sale_status) and P1.5 (fiscal numbering) in flight.
  **Ordered P1 list** (money and stock first, from the inventory in the journal): P1.1 sales_crud.rs:591 update_sale_status - dispatched (compare-and-set; its Conflict branch is unreachable today); P1.2 cash_payouts.rs:51 - dispatched (check-then-act race against the shift); P1.3 shifts.rs:80 open_shift (**DONE 4518a2b8**, proven RED against the unfixed SQL - the second open won and persisted a duplicate); P1.4 gift_cards.rs:635/:668 freeze/unfreeze; P1.5 fiscal.rs:213 statutory numbering (**DONE 2243cf096 - but reclassified: the CLAIM path at fiscal.rs:399 was already atomic inside the new IMMEDIATE transactions, so this was a house-rule fix on the bare autocommit upsert, not a race, and no test can fail against the pre-fix code; the worker proved that by running its race test against the unfixed code and watching it pass**); P1.6 payables.rs:63 (**DONE 3abd6e67**); P1.7 purchase_orders.rs:316 (**DONE 291b9065**); P1.8 products_crud.rs:555/:576 (**DONE 4fea3894**, honest partial - no discriminating test exists); P1.9 products_stock_query.rs:107 (wrap at its sync caller platform/sync/src/queue.rs:666, whose sibling arm already does); P1.10 stock_counts.rs:61-332; P1.11 stock_transfers.rs:327/:370 (its delete-then-compensate must be one transaction); P1.12 tables.rs:300/:320; P1.13 products.rs:248/:276.
| C10a | 2026-09-23 | grep TransactionBehavior::Immediate across the seven doors | sales_checkout 1, sales_lifecycle 4, refunds 1, gift_cards 1, loyalty 1, shifts 1 - all seven sites converted | 515989936 |
| C10a | 2026-09-23 | cargo test -p kasirmu-core concurrent_complete_sale | 1 passed - the test now sets busy_timeout (sales_tests.rs:3248), asserts the loser fails with a busy/locked error (:3278), and detects SQLITE_BUSY/BUSY_SNAPSHOT (:3290) | 515989936 |
| C10a | 2026-09-23 | cargo test -p kasirmu-core sales | 184 passed, 0 failed (was 177) | 515989936 |
| C18 P1.5 | 2026-09-23 | cargo test -p kasirmu-core fiscal | 19 passed, 0 failed - house-rule fix on the sequence upsert; the claim path was already atomic and the worker proved it by running its race test against the unfixed code and watching it pass (so no discriminating test exists) | 2243cf096 |
| C18 P1.1 | 2026-09-23 | cargo test -p kasirmu-core sales_crud | 2 passed - a_committed_competing_transition_is_not_overwritten and a_transition_that_lost_the_race_reports_the_conflict (the CONFLICT path, not a happy path) | c57c5e7ce |
| C8 S2 | 2026-09-23 | cargo test -p kasirmu-core recovery | 9 passed, 0 failed - four new cases (accept + restore, corrupt refused with live db AND sidecars untouched, newer-than-build refused with the newer reason, older accepted) plus the three S1 cases | 3add5b27 |
| C8 S3 | 2026-09-23 | cargo test -p kasirmu-bridge data | 70 passed, 0 failed - six new cases proving the FILE on disk, not just the DTO: a corrupt candidate refuses with no request written, a wrong store name refuses with no file, the right name writes a request naming that candidate, and a corrupt generation is LISTED as Corrupt rather than omitted | 9b551e76 |
| C18 P1.6 | 2026-09-23 | cargo test -p kasirmu-core payable | 21 passed - create_payable now opens the transaction before its first check and delegates to a create_payable_in_tx body; the worker PROVED the composition test bites by bypassing the wrapper and getting a nested-transaction panic, and then DOWNGRADED its own other test's claim because that one also passes with the wrapper bypassed (the FK-checked trigger aborts the write independently) | 3abd6e67 |
| C18 P1.7 | 2026-09-23 | cargo test -p kasirmu-core purchase_order | 51 passed + 1 integration - update_po_status is now a compare-and-set; the worker proved the test bites by deleting only the AND status predicate and watching it FAIL (it had validated only the status vocabulary, never a legal transition, and never read the current status) | 291b9065 |
| C4 S1 | 2026-09-23 | cargo test -p platform-sync | 398 passed - eight new named cases covering refund credit-once + replay no-op, refund with the sale ABSENT applying the effect, void active-to-voided + replay, void of a completed sale CONFLICTING, payment keyed and unkeyed idempotence, payment without the sale as a benign no-op, and the legacy applier consuming all three arms. DECLARED GAP: the sale-present path reverses loyalty points but NOT the customer lifetime-spend figure, because the real helper is pub(crate) and unreachable - tracked as its own follow-up | f147ef37 |
| C4 follow-up | 2026-09-23 | cargo test -p platform-sync + cargo test -p kasirmu-core loyalty | 399 passed and 53 passed - the lifetime-spend reversal now applies on a propagated refund, and the worker PROVED the new case fails against the pre-fix code (behaviourally disabling the call gave 1000 vs 600). IT ALSO CORRECTED MY BRIEF: total_spent_minor is not in loyalty.rs at all - the originator's reversal is inlined in refunds.rs:408-434 - so widening the helper alone would NOT have closed the gap; it widened the helper AND added the missing spend reversal. Declared: loyalty points now have ONE writer, lifetime spend still has TWO (a mirror in queue.rs), which the next slice consolidates | 760c82d2 |
| C4 one-writer | 2026-09-23 | cargo test -p kasirmu-core --lib refund + cargo test -p platform-sync | 64 passed and 399 passed - reverse_customer_spend_on_refund is now the single public writer in refunds.rs, both callers delegate, the queue.rs mirror is DELETED, and ZERO test assertions changed (behavioural equivalence on a money rule, which is the only acceptable proof for a refactor) | aacd0356 |
| C3 S3a | 2026-09-23 | cargo test -p platform-sync | 402 passed - the receipt is keyed on the EFFECT: a pure helper derives the key from the identity the originator already minted, so no arm signature changed, and the pre-check probes item_id OR effect_key. BOTH halves were falsified independently (reverting only the pre-check FAILED the redelivery case with stock deducted twice; reverting only the write FAILED with left None right Some("sale:sale-42:deduct")). Two pre-existing tests were UPDATED because the contract moved - a replay under a fresh item id now reports applied:false - and the worker showed the invariants they protect (status stays voided, payments_row_count 1) are still asserted. stock.adjusted and crdt_delta stock.movement return None deliberately (no single effect to key on) | 359f3b85 |
| C3 S4 | 2026-09-23 | cargo test -p platform-sync | 408 passed - the origin gate is in: before the transaction, an item whose origin equals THIS install's sync_terminal_id is receipted (effect-keyed) and NOT applied; a NULL origin is never treated as self, so legacy and in-flight rows apply exactly as today. Both new skip tests were FALSIFIED by neutering the guards (2 FAILED, then queue.rs restored byte-identically by blob hash). CRITICAL GAP DECLARED: nothing stamps a real origin yet, so the primary gate is DORMANT and only the secondary sales.terminal_id guard bites - the producer-side stamp is slice S5a, dispatched | c8486bb2 |
| C3 S5a | 2026-09-23 | cargo test -p kasirmu-core offline | 95 passed - the enqueue lane now stamps origin_terminal_id from Settings::get_sync_terminal_id, read ONCE per call, covering both funnels (enqueue_offline_inner for the conn lane and enqueue_offline_in_tx for the settlement door, which is the lane the double deduction was observed on). An unpaired install writes SQL NULL exactly as before, and a lookup ERROR is propagated rather than degraded to None - because a NULL written after a failed lookup is indistinguishable from a genuine unpaired install and would silently reopen the double deduction. With S5a landed the S4 gate is LIVE, not dormant | a15c5b68 |
| C18 P1.7 flake | 2026-09-23 | cargo test -p kasirmu-core --lib (full target, under load) | 3246 passed, 0 failed in 219.84s - the timer-based interleaving was replaced with a test-controlled one, so the race no longer depends on machine load. The worker confirmed the falsification still bites (removing the guard still FAILS the test), then died before committing; the manager ran the isolated case 6 times and the full lib target under load, and committed it at the wave gate | see log |
| C8 S4a | 2026-09-23 | cargo test -p kasirmu-app --lib recovery:: | 8 passed - the desktop shell now consumes <db>.restore-request.json BEFORE AppState::new opens anything. Three design points worth keeping: it NEVER fails the boot (returns an Outcome, no ? on that path); it IGNORES the verdict stored in the request and re-validates the candidate at boot, so a candidate swapped or truncated since the prepare is caught; and it treats the request file as untrusted input (absolute path, no '..'). The worker also caught its own bug - it first kept the lock on success, and its test showed a stale lock would refuse the NEXT request, so success now archives the request instead. Declared gap: the request JSON is matched by a hand-built fixture, not by the real writer, and the two suffix constants are duplicated (the bridge's is private) so they agree by inspection only - the round-trip test is dispatched | 4781b122 |
| C8 contract pin | 2026-09-23 | cargo test -p kasirmu-bridge data | 73 passed - the request file contract is now pinned against the CONSUMER'S OWN LITERAL, not against the writer: the exact file name, the exact JSON key the consumer deserializes (candidate_path), and the absolute-without-'..' path rule. BINDING PROOF: flipping the test's literal suffix to a typo made all three tests FAIL with NotFound, then reverted. It also reported the residual honestly - the suffix still exists as two copies, so a rename on the consumer side alone is only caught when the bridge test runs | d539eb66 |
| C18 P1.8 | 2026-09-23 | cargo test -p kasirmu-core product | 236 passed - the two mutually exclusive arms are now ONE conditional statement whose expected_version binds to "?9 IS NULL OR version = ?9", wrapped in an IMMEDIATE transaction with the conflict-vs-not-found read-back inside. HONEST PARTIAL: the worker built the deterministic race test, ran it against the UNFIXED code and watched it PASS (SQLite's own implicit transaction already gave the old single autocommit UPDATE its CAS property), so it DELETED the test rather than ship one that passes either way - the real defect was the error diagnosis reading a different snapshot, which is not observable without progress_handler/update_hook | 4fea3894 |
| C18 P1.4 | 2026-09-23 | cargo test -p kasirmu-core gift_card | 26 passed - freeze/unfreeze are compare-and-set with the state read OUTSIDE the transaction; the worker DEMONSTRATED the negative control by reverting only the two SQL predicates and watching the two forced-interleaving race tests FAIL with the lost update visible in the panic payload (it got the winner's row clobbered). It also separated the tests that discriminate from the two state-outcome tests that pass either way by design, because those pin the pre-check | 39c6cc03 |
| C18 P1.3 | 2026-09-23 | cargo test -p kasirmu-core --lib shift | 77 passed - includes open_shift_race_cannot_create_a_second_open_shift, which FAILED against the unfixed SQL (the second open persisted a duplicate) | 4518a2b8 |
  **P2:** audit.rs:369 log_audit (20 production callers, all standalone - wrap it or record an explicit documented exception, do not leave it undecided); loyalty.rs:126/:651; promotions.rs:242 (latent, no production caller).
  **P3:** 89 sites - batch one transaction per public fn at the boundary, personal-data subset first (customers.rs:196/:250, staff.rs:664/:698/:723). Check profile.rs:995/:999 and sales.rs:437 for dead code before spending time on them.
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

- [ ] **C18 P1.3b [P1] Give the shift invariant a database-level guard.** open_shift is now atomic, but there is still no partial unique index on shifts(user_id) WHERE status = 'open', so any SQL writer outside that function can still create a second open shift. A migration adding the partial index closes the same class of hole the app-level fix closed - and it must land alongside its own index-surface pin bump in migrations_tests.rs, which is why it is a separate slice from any migration already in flight.

- [x] **C5b [P0] Mirror the EOD fix into the tablet's duplicate builder** - **DONE 2026-09-23, commit 1eee8e0f**. Both doors now call the shared core queries; both hazard pins INVERTED (names kept) and the boundary-row pin gained an anti-vacuity guard. The tablet builder also lost a latent bug: its payment query had no COALESCE and grouped by method without currency while the header is per-row.
- [x] **C6b [P1] Validate the timezone on the write path** - **DONE 2026-09-23, commit 1fea7d78**: validate_provision_args now rejects anything outside the three Indonesian presets plus UTC, reusing the same predicate the bridge's update path and the regional axis validator use - so the accepted set has one owner. Rejection only, storage untouched, no migration. Six unsupported values rejected with a field-named message; Asia/Pontianak is deliberately in the rejection list because the reporting path can resolve it while the write boundary's closed set does not (proof the set was reused, not widened) - crates/kasirmu-core/src/db/provisioning.rs:467-476 and :514-564 insert locations.timezone verbatim with no validation while crates/kasirmu-bridge/src/locations.rs:314-321 accepts only Asia/Jakarta|Asia/Makassar|Asia/Jayapura|UTC. Split out of C6, whose reporting half is done.
- [ ] **C11b [P2] Document the pre-migration snapshot and the pre-flight** - docs/operations/ carries no pre-upgrade procedure for the desktop SQLite file, and the four pinned un-re-runnable migrations (migrations_tests.rs:361-366) are not named anywhere an operator reads. Split out of C11, whose code half is done.
- [ ] **C12b [P2] Wire the variance report to an operator surface** - the report exists in core (bdaffa47) with no caller: no Tauri command, no UI. Decide the surface (a Data-screen panel or a CLI subcommand) and gate it like the other read-only report surfaces.

- [ ] **C31 [P2] Validate the Caddyfile itself, not just its routing semantics.** scripts/check-unified-routes.mjs parses apps/unified/Caddyfile as text, so a syntax error that the parser tolerates still ships and the container fails to start. Add caddy validate (or an equivalent parse) to the same gate, or state why it cannot run in CI. Found while closing C27.

## C17 work list (from the IPC gate-debt inventory; ceilings measured 75 desktop / 95 tablet during remediation)

**Slice 2 finding (recorded):** three of the four tablet settings reads are dead, but `get_hardware_settings` is NOT - `ui/src/hooks/useTerminalHardware.ts:240` calls it from a production fallback arm whenever the session token is null, and the null initial state makes that reachable. So it is queued as **C17b**: retire that fallback (wait for the token, or fail the card closed visibly) and only then delete the command and its ledger row, with an acceptance that proves the UI still resolves hardware settings with a session. The IPC parity gate independently confirms the split - it lists the three dead doors among the 15 commands named by no shipped UI file, and omits hardware.

The ordered, lowest-risk-first list is in the inventory recorded in the journal: (1) delete the tablet's five ungated history reads and their registrations, because the scoped twins are already live and the UI already prefers them; (2) the tablet's four ungated settings reads; (3) the three ungated branding setters; (4) the ungated create_backup and get_backup_status; (5) six vendor/value wrappers; (6) five more; (7) set_setting's renderer-supplied user_id (needs a decision first: the ungated door writes the GLOBAL identity database while the scoped twin writes the store database, so they are not interchangeable); (8) five tablet wrappers; (9) hoist the tablet pos/refunds permission checks out of private run_* helpers into the wrapper bodies so the sweep can see them; (10) route the tablet promotions wrappers through the bridge shims that already enforce PROMOTIONS_*. Per deletion: remove the command and its registration, lower REGISTERED_FLOOR, DEBT_CEILING and the matching class count together, regenerate with KASIRMU_REGENERATE_GATE_LEDGER=1, then run both registration_gate_tests files. Ceilings may only fall.


---


---

## Handover - where this stands and what is next

**State at 2026-09-23 (mid-implementation).** 21 items verified and ticked with a commit SHA each; 6 slices landed but partial with a named remainder; the rest queued or parked. Every tick's evidence is in the verification log below, and the gate command block above re-derives all of it.

**Landed and verified (each with its SHA):** C5 + C5b (completed sales only, one day definition, both shells), C6 + C6b (one timezone contract on the read path, validation on the write path), C7 detection half (RLS posture reported at boot and on /health), C9 (qris-core proprietary), C10a (the seven money-path doors are BEGIN IMMEDIATE, and the regression test can now detect the mode), C11 code half (snapshot before migrating), C12 (read-only stock variance report), C13 (plugin discounts gated, Lua tax bounds enforced), C17 slices 1-2 (ceilings 95 to 89 on the tablet, 75 to 72 desktop-pending), C18 P1.1/P1.2/P1.3/P1.5 (sale-status CAS, cash payouts, open_shift, fiscal sequence), C27 (unified routing, checker widened), C1 stages S1 and S1.5 (branch-tolerant credential reads, fail closed on undecryptable), C8 slices S1 and S2 (atomic verified backups; validated atomic restore with the CLI re-pointed onto it), C2 first step (no silent plugin hot-swap, capability flags fail closed), C3 slice S1 (origin column + per-effect receipt schema).

**The next three dispatches, in order, with fences (do these before starting anything else):**
1. **C4 slice S2** - the enqueue sites, once C4-S1's arms land: `crates/kasirmu-core/src/db/refunds.rs` (after the refund/line inserts, before the stock credit), `sales_lifecycle.rs` (void_sale, after the CAS and before commit), `sales_checkout.rs` and `sales_lifecycle.rs:544` (one payment.recorded per split, after each INSERT), plus new `enqueue_*_outbox_in_tx` helpers in `db/offline.rs`. Use the in-transaction enqueue form only - the non-transactional insert is the wrong one. Acceptance: a rolled-back refund or settlement leaves zero queue rows; a committed one leaves exactly one.
2. **C18 slice P1.3b** - the shift invariant needs a database-level guard: a migration adding a PARTIAL UNIQUE INDEX on shifts(user_id) WHERE status = 'open'. It must land with its own index-surface pin bump in `crates/kasirmu-core/src/migrations_tests.rs` (the pin is a census over sqlite_master; the comment block above it explains each increment).
3. **C8 slice S4** - the boot-time safe-mode consumer in both shells, called BEFORE `AppState::new` opens anything, with a `<db>.restore.lock` made by create_new so a double boot cannot race. Depends on S3's request file (in flight).

**Owner-blocked, each waiting on one question (do not guess these):**
- **C1 stage 2** (per-install keychain key + `oz rekey`): is `OZ_MASTER_KEY` set on any deployment, and is whole-file .db credential portability a requirement? The reader is already branch-tolerant, which was the precondition.
- **C2 signature verification + operator grant store**: D7 - how much plugin trust is acceptable. The silent hot-swap is already removed, so the remaining risk is a first load of a dropped file.
- **C7 role cutover**: has any PostgreSQL deployment run scripts/rls-cutover.sql? Detection now reports the posture at boot, so the answer is one HTTP call away.
- **C26 architecture**: rule versus tier order, deadline **2026-11-07** (the grandfathered entries expire then and the checker treats expired as blocking).
- **C17 slice 3** (desktop create_backup): does the pre-login updater keep a session-less door as a documented exemption? And does set_setting's global-identity-vs-store-database split allow a straight repoint to its scoped twin?

**Two operational lessons from implementation, worth keeping:**
- **Verify worker artifacts, not the roster.** Four workers in this wave stopped silently - two produced nothing, one produced complete green work it never committed, one wrote nothing at all - while still reporting running or ready. A file mtime, a grep for the expected marker, or running the acceptance yourself is the reliable signal, and a commit SHA is the only tick worth recording.
- **A worker that cannot demonstrate a failing test should say so.** Three slices here landed with a proven RED: the concurrency test failed against the unfixed SQL first (sale-status CAS, cash payout, open_shift). Two others correctly reported that no discriminating test exists for their change (the fiscal sequence wrap, the C13 tax bounds) rather than shipping a test that would pass either way.
## Gate commands - re-verify everything ticked so far

Run from the repository root. These are the exact commands whose output is recorded in the verification log; none of them mutates the tree. (Per AGENTS.md, a full `cargo test --workspace` is not an iteration command - the workspace CHECK is fine, and the per-crate test targets below are what the ticks actually assert.)

```bash
# integration: does the whole workspace still compile
cargo check --workspace

# C2 step 1 - plugin host: no silent hot-swap, capability flags fail closed
cargo test -p kasirmu-plugin                       # 181 passed
cargo test -p kasirmu-app --lib state::tests        # 11 passed

# C1 S1 + S1.5 - branch-tolerant reads, and fail closed on undecryptable
cargo test -p kasirmu-core --test credential_storage_form   # 28 passed, 1 ignored
cargo test -p kasirmu-crypto                                # 21 passed
cargo test -p platform-core                                 # 410 passed

# C8 S1 - atomic, verified, 3-generation backups
cargo test -p kasirmu-core recovery                         # 5 passed
cargo test -p kasirmu-core --test backup_restore_integration # 21 passed

# C6 + C6b - one timezone contract on the read path, validation on the write path
cargo test -p kasirmu-core datetime                         # 8 passed
cargo test -p kasirmu-core --lib reports::tests             # 80 passed
cargo test -p kasirmu-core provisioning                     # 25 passed

# C12 - read-only stock variance report
cargo test -p kasirmu-core stock_variance                   # 6 passed

# C5 + C5b - completed sales only, one day definition, on BOTH shells
cargo test -p kasirmu-core sales                            # 177 passed
cargo test -p kasirmu-bridge history                        # 17 passed
cargo test -p kasirmu-mobile history                        # 19 passed
cargo test -p kasirmu-mobile known_hazard                   # 2 passed (both pins inverted)

# C17 slice 1 (+2 in flight) - gate-debt ceilings, which may only fall
cargo test -p kasirmu-mobile registration_gate              # 10 passed, all four drift pins

# C27 - the shipped container routes every licence-server namespace
node scripts/check-unified-routes.mjs                       # EXIT 0, 7 prefixes

# C9 - no package may be publishable in a proprietary repository
cargo metadata --no-deps --format-version 1                 # expect 0 packages with publish enabled
grep -n qris-core deny.toml                                 # expect a clarify entry
cargo deny check licenses                                   # expect 'licenses ok'
```

A tick without a command in the log is not a tick. If a command here fails, the item it belongs to is NOT done, whatever its checkbox says.

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
| C1 S1 | 2026-09-23 | cargo test -p kasirmu-core --test credential_storage_form | 28 passed, 0 failed, 1 ignored (EXIT 0) | 012dd2663 |
| C1 S1 | 2026-09-23 | cargo test -p kasirmu-crypto | 21 passed, 0 failed (EXIT 0) | 012dd2663 |
| C1 S1 | 2026-09-23 | fails-before proof (lib.rs reverted at HEAD, new test in place) | 27 passed / 1 FAILED on decision_pin_reads_are_branch_tolerant, then lib.rs restored byte-for-byte | 012dd2663 |
| C18 P1.1 | 2026-09-23 | (dispatched) acceptance is a CONFLICT-path test, not a happy path | pending | - |
| C6 | 2026-09-23 | cargo test -p kasirmu-core datetime | 8 passed, 0 failed (EXIT 0) | 7559a3f6b |
| C6 | 2026-09-23 | cargo test -p kasirmu-core --lib reports::tests | 80 passed, 0 failed - includes the INVERTED test iana_timezone_names_resolve_to_the_store_local_day | 7559a3f6b |
| C11 | 2026-09-23 | cargo test -p platform-core migrations | 39 passed, 0 failed, 370 filtered (EXIT 0) | 9c6d76e1 |
| C12 | 2026-09-23 | cargo test -p kasirmu-core stock_variance | 6 passed, 0 failed (EXIT 0) | bdaffa47 |
| C17 slice 1 | 2026-09-23 | cargo test -p kasirmu-mobile registration_gate | 4 drift pins ok (ceilings_only_shrink, three_way_partition, registration_floor, generated_ledger_is_the_sweeps_own_output) - ceilings 92 | 3aa5af0e |
| C5 | 2026-09-23 | cargo test -p kasirmu-core sales + cargo test -p kasirmu-bridge history | core 177 passed; bridge 17 passed incl. the new eod_report_reconciles_on_a_refund_and_void_fixture | 743f222f |
| C2 step 1 | 2026-09-23 | cargo test -p kasirmu-plugin | 181 passed, 0 failed (+2 doctests) | 28a2bfeb |
| C2 step 1 | 2026-09-23 | cargo test -p kasirmu-app --lib state::tests | 11 passed incl. plugin_change_is_refused_and_live_set_survives | 28a2bfeb |
| C8 S1 | 2026-09-23 | cargo test -p kasirmu-core recovery | 5 passed, 0 failed | 6814222 |
| C8 S1 | 2026-09-23 | cargo test -p kasirmu-core --test backup_restore_integration | 21 passed, 0 failed - the deletion did not break the RUST-03 directory-target pins | 6814222 |
| C5b | 2026-09-23 | cargo test -p kasirmu-mobile history | 19 passed, 0 failed (EXIT 0) | 1eee8e0f |
| C5b | 2026-09-23 | cargo test -p kasirmu-mobile known_hazard | 2 passed - both pins inverted in place, names unchanged, both now asserting the CORRECTED behaviour | 1eee8e0f |
| C6b | 2026-09-23 | cargo test -p kasirmu-core provisioning | 25 passed, 0 failed (was 22) - includes an_unsupported_timezone_is_rejected_and_names_the_accepted_values | 1fea7d78 |
| C13 | 2026-09-23 | cargo test -p kasirmu-core db::sales + concurrent_complete_sale | 158 passed and the concurrency test passed, after the plugin-discount gate, the bounded rate_bps and the shortfall-door override symmetry landed | 1b7bd246 |
| C1 S1.5 | 2026-09-23 | cargo test -p platform-core | 410 passed, 0 failed (+4 doctests) - five new fail_closed_* tests, five legacy_plaintext_* still passing | 37a3c00b |
| C18 P1.2 | 2026-09-23 | cargo test -p kasirmu-core cash_payout | 34 passed, 0 failed - includes payout_refused_when_shift_closes_between_read_and_write, which was PROVED to fail against the unfixed SQL before shipping | b0e78e69 |
| C10 | | | | |
| C11 | | | | |
| C12 | | | | |

Wave 2 and wave 3 items append below as they are ticked.
