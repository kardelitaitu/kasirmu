# Codebase Review - kasir.mu (C:/dev/ozpos)

**Date:** 2026-09-23. **Version reviewed:** 0.0.39. **Scope:** the whole repository - the Rust workspace (foundation, platform, modules, crates, apps), the React frontend, the Go license server, the cloud server, migrations, ops and delivery tooling, and the documentation as a set of claims about all of it. **Method:** read-only. Nine workers running fifteen assignments across four waves; no code was modified, no build or test was run, no deploy was attempted. Every finding cites a file and line, except where the deciding fact is environmental - those are enumerated in section 17. Counts were measured on this working tree on the date above; other sessions are editing the tree concurrently, so a re-run will differ slightly.

---

## 1. Verdict

This is a serious system built by people who measure things. The house rules are real (Money as i64, transactional writes, sibling test files, HAL mocks for every driver), the security primitives are implemented competently, the test corpus is enormous, and the repository audits itself with a 1,694-line open-findings ledger and a 77-entry gate registry that is honest enough to record which of its own entries enforce nothing. Four months of scrutiny went into making the *documentation* of this codebase trustworthy, and it mostly is.

What follows from that is the uncomfortable part. The defects that matter here are not missing features - they are **places where the code, the comments, the tests, the ADR and the README agree with each other and are all wrong together**. A checkout that believes it runs BEGIN IMMEDIATE. A stock guard that names a database constraint that was never created. A regression test whose name asserts the behaviour it cannot detect. A report timezone contract whose only accepted value is the one its own reader rejects. A README that says backups are unencrypted while calling the at-rest key a platform keychain secret. These are not sloppiness; they are the failure mode of a codebase whose culture trusts its own documentation. The single most valuable change in this report is not a bug fix - it is making the *assertions* executable.

**Twelve findings are rated P0.** They fall into four groups: money and stock correctness (three - 4.1, 4.2, 4.3), data propagation, reporting and recovery (five - 5.1, 5.2, 8.1, 8.2, 14.1), trust boundaries (three - 6.2, 6.4, 7.1), and licensing (one - 14.4). They consolidate into **ten remediation items** in section 15, because two pairs of findings share a fix. None requires a rewrite; two require an ops or ownership change rather than a patch.

### The five things to act on first

Ordered by merchant-visible consequence, not by how bad the code looks. The DEFERRED-transaction finding, which reads as the most alarming, is deliberately **not** first: the same document explains that it does not produce an oversell today (4.1).

**1. [P0] The at-rest encryption key defaults to a public constant.** Without OZ_MASTER_KEY set, every credential and PII field the product believes is encrypted is derived from a string that is in the repository - the source says so in those words. It is a confidentiality break over SMTP passwords, sync keys, PG passwords, LAN keys, national IDs and pay data, decided by one environment variable nobody has confirmed is set - and which nothing in the repository sets. See section 6.2, and note that simply setting it is not the fix: the read path cannot distinguish the two derivations, so it silently bricks five credential families and both PII columns. The repair has a precondition (a branch-tolerant reader), priced in the decisions companion, D1.

**2. [P0] Plugin loading has no integrity check.** Plugins are unsigned, unhashed, loaded from a user-writable directory and hot-reloaded within a second, with self-declared permissions, three parsed-and-ignored security flags, and a discount path that skips the SALES_DISCOUNT check the manual path enforces. See section 6.4.

**3. [P0] A terminal re-applies its own pushed sale and deducts the stock twice.** offline_queue has no origin column, all four pull queries filter on tenant_id alone, neither apply loop compares self-origin, and sync_applied_items only receipts items that were *applied* - never the ones the terminal itself created. On the tablet the duplicate lands on the same inventory the sale deducted. Independently re-derived twice, with the five obvious falsifiers each checked and absent. See section 5.1. Refunds and voids have the mirror-image problem: no sync arm at all, so they dead-letter (5.2).

**4. [P0] Voided and pending sales are counted as revenue.** export_daily_summary has no status predicate while every sibling report filters correctly - and the same end-of-day sheet computes its payment breakdown with a different day definition, so its header cannot reconcile with its own body. This is the number an owner reads at closing. See section 8.2.

**5. [P0] Tenant isolation is declared and not enforced.** The generated PostgreSQL schema enables 34 tenant policies, but FORCE ROW LEVEL SECURITY appears nowhere in migrations/ - only in an out-of-band cutover script whose own comment says the app connects as the table owner and bypasses RLS entirely. See section 7.1.

**Also before a release, and easy to under-rate:** (a) [P0] there is **no operator-reachable restore** - the only restore is a CLI command, the single backup slot is deleted before it is replaced, and nothing in production ever calls check_integrity, so a corrupt backup restores green; (b) [P0] the checkout runs a DEFERRED transaction while the code, the ADR and its regression test all assert BEGIN IMMEDIATE, and the database-level guard the code names as its backstop was never created (section 4); (c) [P0] the report timezone contract and the write-path timezone contract are mutually exclusive, so a store provisioned by the current wizard buckets revenue in UTC while its tax resolves at +07 (8.1); and (d) [P0] `qris-core` declares a permissive licence with publish = true in a proprietary repository, and the only licence checker is blind to it (14.4).

**[P1 - dated] One deadline runs on its own clock:** all eight grandfathered architecture-boundary entries expire on **2026-11-06**, which reddens every push and every CI run on a day nobody touches the boundary. See section 10.3.
### What is genuinely good, and should not be broken while fixing the above

- **The IPC and API boundaries are disciplined.** No React component calls invoke() directly; there is one Tauri boundary used by 49 API files. The local API binds loopback only, checks auth per request in constant time, and fails closed on CORS. No handler anywhere trusts a client-supplied tenant_id - every tenant read derives from the verified JWT claim.
- **The licensing and entitlement boundary holds.** No private key ships; the client embeds a public key only; verification fails closed; the Free-tier history cap cannot be bypassed through IPC; the license server takes its signing key from the environment and refuses to start without it.
- **The Lua sandbox is real.** No escape was demonstrated. Globals are nilled, memory is capped, and the host exposes no filesystem, socket or process primitive.
- **Error surfacing on the frontend is genuinely covered** (three boundaries, 122 files raising toasts, and a correct void-and-rethrow path when finalization fails mid-sale), **the i18n corpus has perfect en/id parity**, and **PG schema drift is enforced fail-closed in four live lanes** including RLS coverage in both directions.
- **HAL has a mock for every trait**, drivers are registered from a real bootstrap, and LAN defaults are safe (loopback unless a pre-shared key is configured; peers cannot inject KDS tickets).

### How to read the rest

Remediation is tracked separately: manager-codebase-review-checklist.md records each item, its fence and its acceptance evidence as it lands, and manager-codebase-review-decisions.md holds the eight owner decisions. This document records what was found, not what has since been fixed - except where a fix revealed a finding this review had missed, which is marked inline.

Section 3 is a scorecard if you want one screen. Sections 4 through 14 are the evidence, grouped by axis, each ending with what is right as well as what is wrong. A tickable companion - one checkbox per remediation item, with its file fence, its acceptance check and a verification log - is at manager-codebase-review-checklist.md. Section 15 is the remediation plan with an acceptance check per item. Section 16 lists the decisions that are yours, not the code's. Section 17 states what this review could not determine, and section 14 holds four findings that arrived after the first draft - two of them P0 - together with what they changed., and the appendix records which headline claims were confirmed, refined, or downgraded after independent verification - including one that was over-claimed and corrected.

---


## 2. What this system actually is, in ten lines

kasir.mu is a genuinely large, genuinely serious offline-first retail platform - not a toy, and not a monolith with a modular story bolted on. Measured this session: **39 Rust workspace members** (17 crates, 14 modules, 4 platform, 1 foundation, 3 Rust apps) plus a Go license server and a container glue app; **about 207,954 production Rust lines** across 697 files excluding test files, with 511 sibling test files and **8,525 #[test] functions**; a React 18 + Vite frontend of **1,437 files**, 602 test or spec files and 30 Playwright specs; **64 SQL migrations** producing a generated PostgreSQL twin; **54 Fluent translation files** with perfect en/id parity.
## 3. Scorecard

Scores are judgements; the P0 column is arithmetic and can be checked against the section headings. One severity scale is used throughout this document: **P0** (fix before the next release), **P1** (next), **P2** (hygiene that compounds), **P3** (cosmetic).

| Sec | Axis | Score | P0 | One line |
|---|---|---|---|---|
| 4 | Money, stock and concurrency | Critical | 3 | The transaction mode is not what every comment, ADR and test says it is, and the guard the code names as its backstop does not exist. |
| 5 | Offline to cloud convergence | Critical | 2 | A terminal re-applies its own pushed sale and deducts the stock twice, and refunds and voids never propagate at all. |
| 6 | Security: code trust, keys, data at rest | Critical | 2 | License crypto and sandboxing are solid; the at-rest key default and plugin loading are not. |
| 7 | Tenant isolation and IPC authority | Critical | 1 | Shipped RLS policies are inert on the owner connection, and 74 desktop / 94 mobile commands are recorded as ungated. |
| 8 | Reporting and tax | Critical | 2 | Voided sales are reported as revenue, and for an IANA-configured store every date bucket is on the wrong day. |
| 9 | Frontend | Fair | 0 | The IPC boundary is disciplined and error surfacing is real; the cart floors, and no build can fail on accessibility. |
| 10 | Architecture integrity | Mixed | 1 | The tier order is real in manifests and false in normal dependencies, modules are largely ceremony, and a dated baseline will fail CI. |
| 11 | Claim versus reality | Weak | 0 | Test, migration and workflow counts drift, and gates marked required run nowhere. |
| 12 | Delivery surfaces and ops | Mixed | 0 | Gates are abundant and often excellent; the shipped container 404s five registered routes and publishes Redis by default. |
| 13 | Declared-but-inert surface | Weak | 0 | The scale path, the log file sinks, the rate-sync daemon and the modules' own logic all read as finished and do nothing. |
| 14 | Recovery, upgrade path, failure consequences | Critical | 2 | No operator-reachable restore, an unverified single-slot backup, a migration runner that re-runs DDL on live data, and one crate that can be published under a permissive licence. |

**P0 total: twelve findings across seven of the eleven axes, consolidating into ten remediation items** in section 15 (two pairs share a fix). Every P0 is named in the sections above; the count is mechanical and can be checked against the headings.

## 4. Money and stock under concurrency

Three P0s live here. They compound: the first two are about a checkout that cannot do what it claims, the third is about the test that was supposed to catch it.

### 4.1 P0 - The checkout runs a DEFERRED transaction while code, ADR and test all assert BEGIN IMMEDIATE

Every money-moving door opens its transaction with rusqlite's unchecked_transaction(), which is Transaction::new_unchecked(conn, TransactionBehavior::Deferred) - verified in the pinned source of rusqlite 0.31.0 (registry transaction.rs:466-467, emitting BEGIN DEFERRED at :121-123). Call sites include sales_checkout.rs:210, sales_lifecycle.rs:86, :179, :606, :779, refunds.rs:66, gift_cards.rs:53, :421, :543, loyalty.rs:341, :463 and shifts.rs:109; there are **98 unchecked_transaction()? call sites in kasirmu-core** (128 across all tiers) and only **three production IMMEDIATE sites in the entire repository**: db/stock_counts.rs:93 and platform/core/src/settings/raw.rs:232 (both raw execute_batch), and kasirmu-bridge/src/topology/persistence.rs:352 (TransactionBehavior::Immediate). None of the three is on the checkout path - which is the point: the project already knows the pattern, and the settings delta-ledger even documents its own IMMEDIATE retry contract as a concurrency feature (raw.rs:16).

The code says otherwise in at least four places: the module doc at sales_checkout.rs:9 and :51 claims one BEGIN IMMEDIATE transaction, sales_lifecycle.rs:178 carries the literal comment '// -- BEGIN IMMEDIATE --' two lines above a DEFERRED call, batch.rs:30 repeats the claim, and ADR-19 5.2 itself prescribes conn.transaction_with_behavior(TransactionBehavior::Immediate)? at docs/decisions/2026-07-19-sale-deduction-multi-location.md:376-383. **The ADR's own sample was never implemented at checkout.**

Honesty about the failure mode matters more than the alarm: under WAL a DEFERRED transaction that reads stock and then promotes to a write does *not* silently oversell. If another connection committed in between, the promotion fails with SQLITE_BUSY_SNAPSHOT (rescode 517) - the busy handler cannot rescue it, because the snapshot is already invalid, and the only recovery is rollback and restart. What BEGIN IMMEDIATE buys is that the loser fails *at BEGIN*, which is exactly where busy_timeout can legitimately turn the conflict into a wait. This report does **not** claim that two terminals both pass the stock read. It claims that the invariant is false, load-bearing, undocumented in its true form, and untested - and that its repair is both small and already prescribed by the project's own ADR.

The exposure is real but bounded by one thing that *is* right: the stock read and the conditional decrement are both inside the transaction window (sales_checkout.rs:264 through batch lookup to the adjust at adjust.rs:250), so the structure is correct and only the isolation level is wrong. Do not let anyone hunt for a reproduction of an oversell that this code does not produce; the defect to fix is the lie, and the error path nobody retries.

### 4.2 P0 - The named second line of defence is fictional, not merely missing

products_stock_adjust/adjust.rs states at :31 and :144 that the schema's CHECK (qty >= 0) constraint is 'Layer 2' of the negative-stock guard, and :258-267 converts a ConstraintViolation on the stock_summary upsert into InsufficientStockAtLocation. That branch is unreachable, because the constraint does not exist: migrations/20260813_init.sql:739-746 declares stock_summary with qty INTEGER NOT NULL DEFAULT 0 and a composite primary key, and nothing else. Sibling tables inventory (:171) and stock_thresholds (:752) *do* carry CHECKs, so this is an omission rather than a convention. No later migration adds one (no ALTER TABLE stock_summary, no trigger, across 62 migration files), and the generated PG twin inherits the gap.

The live proof that nothing guards the column is the suite itself: inventory_tests.rs:246-250 inserts qty = -3 and unwraps the result. And the upsert at adjust.rs:250-257 is unconditional (qty = excluded.qty), so it is a classic lost update rather than an increment.

Practically, Layer 1 still holds the line: the Rust filter at adjust.rs:216-224 refuses negatives unless the location has allow_negative_stock set. So the impact is a missing backstop with dead code claiming it exists - a documentation defect with a correctness tail, not an open hole.

### 4.3 P0 - The regression test cannot detect the defect it is named after

concurrent_complete_sale_serialized_by_begin_immediate (sales_tests.rs:3022-3092) opens its connections with a bare Connection::open and sets no busy_timeout, no journal_mode and no foreign_keys (:3061-3066) against a database cloned from the in-memory fixture. With no busy handler, SQLite returns SQLITE_BUSY immediately; the loser dies at its first write. The test then asserts only success_count == 1 and failure_count >= 1 (:3081-3088) - it never inspects the error code. It therefore passes identically whether the loser failed at BEGIN (IMMEDIATE) or at the first write (DEFERRED). Its doc-comment and its assertion message both assert BEGIN IMMEDIATE while the code under test does not.

Two structural reasons make this worse than one weak test. First, fresh_db() (migrations.rs:463-509) never runs through migrations::run, so the test database has rollback-journal semantics and busy_timeout = 0 - the exact opposite of production, which sets WAL, busy_timeout 5000, synchronous NORMAL and foreign_keys ON at migrations.rs:403-413. Second, the repository *already contains the correct test*: tests/store_scoping_concurrency_integration.rs sets a 30-second busy timeout (:124, :138), drives BEGIN IMMEDIATE by hand (:230, :252) and asserts the loser reports a lock error (:267-271). It tests the pattern the checkout does not use.

### 4.4 P1 - Writes that are not in transactions, and balances with more than one writer

There are **138 autocommit-capable conn.execute sites in db/ outside tests** (grep for conn.execute( under crates/kasirmu-core/src/db, excluding _tests.rs), several of them on money paths (sales_crud.rs:591, sales_lifecycle.rs:57, audit.rs:369, loyalty.rs:850 and :965, customers.rs:196 and :250). Some ride an outer transaction, some do not. update_sale_status (sales_crud.rs:558-600) reads the status outside any transaction and then issues an unconditional UPDATE, which makes its own rows == 0 to Conflict branch unreachable; the same file on the void path shows the correct pattern (sales_lifecycle.rs:787-798, a conditional update on status = 'active').

On balances, gift cards are exemplary: one balance, one writer per operation, conditional updates with in-transaction re-reads (gift_cards.rs:57, :430-443, :557-570). Loyalty is not. loyalty_accounts.points has three writers, only one of which is conditional (earn at loyalty.rs:841 is a non-atomic points + ?, redeem at :499 is a correct CAS, reversal at :953 uses MAX(points - ?, 0)); customers.loyalty_points is a derived projection written from three loyalty sites plus two independent insert-time sites in kasirmu-bridge/src/data.rs:740 and kasirmu-cli/src/commands/kasirpkg.rs:419; customers.total_spent_minor is written with + on completion and - on refund, in different transactions, and floors at zero.

One more detail worth keeping: stock_counts.rs:93, :131, :136 and :143 hand-roll BEGIN IMMEDIATE through execute_batch - the only place in the codebase where the correct mode is used, and it bypasses the Transaction type entirely.

## 5. Offline to cloud convergence

This is the product's central promise, so its defects deserve the harshest reading. They get it.

### 5.1 P0 - A terminal re-applies its own pushed sale and deducts the stock a second time

The path, verified twice by two independent investigators: a sale settles and writes its outbox row **inside the settlement transaction** (sales_checkout.rs:553-559 into db/offline.rs:318-357) with the local stock already decremented. The daemon pushes it; the server stores the **same id** with ON CONFLICT (id) DO NOTHING (sync_store/pg.rs:86), so nothing distinguishes it. On the next pull the terminal receives its own item back, because the pull query filters on tenant_id alone (pg.rs:163-166, sqlite.rs:151, pg_transport.rs:98) and offline_queue has **no terminal or origin column at all** (20260813_init.sql:353-362). The apply path then runs complete_sale, which calls adjust_stock_in_tx(tx, sku, -qty) for every line (platform/sync/src/queue.rs:438-443), and the stock moves a second time.

The guard that looks like it should stop this does not: sync_applied_items records **applied** items, and its only production writer is the apply path itself (queue.rs:408, db/offline.rs:844, :851). A row the terminal itself created was never applied, so it has no receipt. Neither apply loop compares origin (daemon_tick.rs:678-735, pg_daemon.rs:694-730), and the complete_sale arm never consults the sales table. Five specific falsifiers were searched for and none exists.

Blast radius, stated precisely because it differs by shell: this is **double deduction on the originator**, not a missing deduction elsewhere. A non-origin terminal correctly needs the deduction. On the tablet, the sync daemons and checkout share state.db, so the duplicate lands on the same inventory the sale deducted; on the desktop the daemons run against the global database (lib.rs:540) while checkout writes store-<id>.sqlite, so the duplicate lands on a different inventory table. In both cases there is no error, no failed row, and nothing on the queue screen reports it.

Effect idempotence is not uniform, and the working patterns are the blueprint for the fix: complete_sale and stock.adjusted are **not** idempotent (the code admits the latter at queue.rs:592-595), while stock.movement (primary key), product.created (create_product_if_absent_in_tx), settings.* and finalize_sale (a conditional update on status = 'pending', awarding only when changed == 1) **are**.

### 5.2 P0 - Refunds, voids and payments have no sync arm at all

Found while enumerating the arms: refund, void and payment fall through to _ => Err(unsupported remote sync action) (queue.rs:558-563). A refund or void performed on one terminal **never propagates** - it dead-letters. For a multi-terminal shop this is a correctness hole of the same family as 5.1, and it is the kind of gap that only shows up as an unexplained stock or revenue discrepancy weeks later.

### 5.3 P1 - Ordering is wall-clock, priority is applied on one push path out of three

No payload carries a sequence number. The local queue orders by created_at (db/offline.rs:388-391) and only one of three push callers re-sorts by priority (mobile offline.rs:342); the daemon (platform/sync/src/daemon.rs:139) and the desktop bridge (kasirmu-bridge/src/sync.rs:545) do not. The server orders pulls by created_at, id (sync_store/pg.rs:139, :165). Since SyncPriority is Critical=0 and Low=2, a Low settings.update can be applied before a Critical complete_sale on every pulling terminal.

### 5.4 P1 - Conflicts are recorded, reviewed by a human - and never enforced

The migration's comment promises that conflict rows exist 'so a manager can review them instead of the merge silently discarding one side', and there is a real review API (GET and POST /api/sync/conflicts, sync_api.rs:198-201, :723-770). But detection is advisory: detect_conflict runs before the insert and every outcome except a Flag is ignored, and even a Flag only logs a warning - the item is inserted regardless (sync_store.rs:173-200). Decision::LastWriterWins and Decision::AutoMerge are computed and **never consumed** (conflict_resolution.rs:217-236). The client's Conflict arm silently drops the local payload as 'server item wins' (sync_client.rs:329-348). And the money guard is a substring test over gift_card, payment, refund, loyalty, payout and cash (conflict_resolution.rs:134-147) - **complete_sale matches none of them**, so a completed sale is classified LastWriterWins at Low severity.

### 5.5 P1 - Drain atomicity and an unguarded status write

The email/webhook outbox delivers before it records the outcome with no lease: the SQLite path SELECTs, delivers, then UPDATEs in a separate statement (apps/cloud-server/src/outbox.rs:130-196), and the PG path takes FOR UPDATE SKIP LOCKED but commits the claim before delivering (:246-278). The 'delivering' state exists in the CHECK constraint and the documented lifecycle (20260902_outbox.sql:23) and **no code ever writes it** (grep returns zero). More consequentially for sales, mark_offline_synced is a bare single-statement UPDATE with no transaction and no status guard (db/offline.rs:421-431) - it will mark a failed row as synced, and it returns NotFound on zero rows, which is the error that aborts apply_sync_outcomes mid-batch because that loop propagates with ? (sync_client.rs:307, :321, :325). The daemon's apply_push_results does the opposite and logs-and-continues (daemon.rs:212-264); a test suite exists specifically for that divergence.

### 5.6 What is right here

Transport-level deduplication is solid: offline_queue ids are UUIDv7 minted once at enqueue (db/offline.rs:242), the server's conflict target is the id, and a duplicate returns Rejected('duplicate id: ...') which the client correctly routes to synced (sync_client.rs:70-76, :310-322). The local row is never marked before the remote acknowledgement. And PG schema parity is genuinely enforced: scripts/generate-pg-migration.py is the sole author of the PG twin, its --check runs in four live places (pre-commit:183-192, check.sh:447, run-pre-push.py:260, dev-ci.yml:659), and RLS coverage **fails closed** in both directions - an undocumented tenant table and a stale exemption both abort generation (generate-pg-migration.py:425-450), with self-tests for both.

## 6. Security: the code trust boundary, the money, and the data at rest

This is the axis with the widest spread in the whole review: first-class cryptography and a genuinely well-built sandbox sit next to an unsigned code-loading path and a default encryption key that anyone with the repository can derive.

### 6.1 Credit first - the license and entitlement boundary is sound

No private key ships in the client. Only the public key is tracked (crates/kasirmu-core/oz-license.key.pub opens with BEGIN PUBLIC KEY), the private PEM is ignored by .gitignore:70, the client embeds the public key with include_str! (license_verification.rs:44), and there is no client-side RSA signing - the only private-key use in core is GCP service-account signing for export (export/cloud_destination.rs:757-769). The license server loads its RSA-2048 key exclusively from the OZ_LICENSE_PRIVATE_KEY environment variable and exits with log.Fatal when it is missing (apps/license-server/main.go:75-77); a repository-wide search finds no PEM file anywhere, and no live workflow references the key.

The verification policy fails closed: subscription.rs:517-538 accepts the BOOTSTRAP_FREE_SIGNATURE sentinel only when the tier is literally free, otherwise it requires RSA-2048 PKCS1v15/SHA-256; entitlements.rs:280-301 returns None on any verification error and build_entitlements returns Entitlements::fail_closed; the debug upgrade path is cfg!(debug_assertions)-gated and its callers pass debug_upgrade = false on the tablet and on the purge path. The Free-tier three-month history cap is not bypassable through IPC: the tablet registers the capped twin and only the gated, scoped twin is registered on desktop.

### 6.2 P0 - the default at-rest encryption key is a public constant

kasirmu-crypto::portable_key(domain, legacy) derives HMAC-SHA256(master, domain) when OZ_MASTER_KEY (64 hex characters) is set - and otherwise falls back to derive_static_key(domain), a bare SHA-256 of a public constant string. The source says exactly what that means: 'a public constant: anyone with the repo can derive it and decrypt every portable at-rest value in any deployment's database. It protects against opportunistic database inspection only - it is obfuscation, NOT confidentiality' (crates/kasirmu-crypto/src/lib.rs:59-79, :98-111). A keyring-backed master key was deliberately not adopted, to preserve cross-machine portability (:68-71).

What rides on that key: the SMTP password, the sync API key, the terminal secret, the PostgreSQL password, the LAN pre-shared key, the rate-sync API key, and PII written through encrypt_profile_field - national ID and monthly pay (db/profile.rs:38, :773-778). There is no first-run bootstrap: portable_key reads the environment on every call and falls back silently, so a fresh install encrypts nothing, in the meaningful sense of the word.

The README's 'platform keychain' clause makes this worse by pointing the reader the other way. Three native keychains are implemented and dispatched correctly (WindowsCredentialManager, LibSecretKeyring, MacOsKeychain, with an InMemoryKeyring fallback the code itself labels 'This is NOT secure'), but the keychain entry oz-pos/encryption-key is read back **only to report its own rotation age** (bridge/security.rs:106-124, :142-145) and derives no ciphertext whatsoever; the crate's own README states that the keyring entry 'is NOT the key that any settings or PII ciphertext is derived from' (kasirmu-security/README.md:17-20). The device-binding key (oz-pos/device-binding-hmac-key) is a real keychain user, but it is not the at-rest key.

Severity depends on a deployment fact this review cannot read from source: whether any production instance sets OZ_MASTER_KEY. If none does, every 'encrypted' credential in every database is decryptable by anyone holding the repository. **Nothing in the repository sets it** - a tree-wide search finds no mention in ops/, scripts/, .github/, any compose or Dockerfile, or .env.example - and neither Tauri shell can even report its own state, because the only detection hook is called from the cloud server. **Setting it on a live install is not the fix either:** the read path is branch-intolerant by pinned design (a row written under the static derivation is refused by the master branch and vice versa, and the two are indistinguishable objects - crates/kasirmu-core/tests/credential_storage_form.rs:1042-1103), so the change bricks seven locations across five credential families and both PII columns, and two of the five have no product setter to restore them. The repair needs a branch-tolerant reader first; see D1 in manager-codebase-review-decisions.md. One sharp failure mode was found while designing that reader: five settings call sites in platform/core/src/settings/typed.rs (:334, :361, :437, :553, :639) do `.unwrap_or(v)` on a decryption failure, so a shaped-but-undecryptable value is handed back to the caller **as the credential**. Nothing else needs to go wrong for a wrong secret to reach an SMTP or sync client - the fix is to fail closed on a shaped ciphertext that decrypts under no derivation.

### 6.3 P1 - what the encrypted package covers, and what the plaintext backups leak

The .kasirpkg format is properly built and the README clause is TRUE: AES-256-GCM with a 512-byte space-padded JSON header, key derived by Argon2id at m=19456 KiB, t=2, p=1, V0x13 - exactly the OWASP minimum rather than a weakened profile - with a fresh random salt and nonce per export, zstd level 3 before encryption, the header bound as AAD since format v2 (v1 headers are unauthenticated and are accepted only for legacy import), and empty passwords refused on export (kasirpkg.rs:59-61, :164-168, :229-241, :277-290).

Two caveats matter. First, the header is **cleartext** and carries the store name, app version, timestamp, data types, salt, nonce and the full feature-flag set (kasirpkg.rs:78-96) - and the app version written into it is a hardcoded '0.0.1' at the call site (bridge/data.rs:543), so it is useless for forensics. Second, the payload is **six table groups**: products, categories, sales *headers without lines*, customers, users and settings (kasirpkg.rs:100-119). Inventory, payments, audit log, gift cards, shifts, tax rates, exchange rates and all attachments are **not** in the package. A merchant's 'encrypted backup' is a partial export, not a backup of their business.

The README's admission that whole-file .db and .backup.db snapshots are unencrypted is TRUE **and understated**. Store::backup() uses rusqlite's online backup API into a plain file (db/mod.rs:281-305) at a sibling path (bridge/data.rs:146-150). Beyond that: every sync pull writes an 'unfiltered cleartext' pre-pull snapshot beside the live database, retaining one (bridge/sync.rs:660-682); create_backup performs **no permission check at all** and logs backup_ungated_no_session (bridge/data.rs:331-347) while its gated twin enforces DATA_EXPORT; and create_backup_to accepts an operator-chosen destination guarded only against .. traversal (:872-892). Nothing plaintext reaches the network - the network lanes are encrypted packages, warehouse INSERTs and HTML email reports - so the exposure is local disk, but unbounded in location and unauthenticated in creation.

On 'PAN masking': the helper is correct (mask_pan implements PCI-DSS 3.3 first-six/last-four, kasirmu-security/src/mask.rs:40-67) and has **zero production callers**. The real reason no card number leaks is that none is ever stored - the payments table has no card column, edc_terminals stores no card data, and every in-repo writer sets gateway_response to None. The genuine card-shaped plaintext in this schema is **gift_cards.card_number TEXT UNIQUE NOT NULL** with a plain index (20260813_init.sql:135-137, :1126): unencrypted, unmasked, absent from .kasirpkg, and present in every .db and .backup.db snapshot. The UI's *****6789 strings are national_id_masked, a staff profile field, not a PAN.

Finally, TLS is PARTIAL: a TLS configuration type exists, but it carries an insecure_skip_verify boolean that is serde-visible with no release-build gate (kasirmu-security/src/tls.rs:5, :45, :167-168); the crate's own audit note records it as SEC-5, open. Audit logging is TRUE with the usual caveat: sanitize_details redacts a fixed key list and truncates before INSERT (db/audit.rs:18-41, :363-370) - key-name-based only, so a sensitive value under an unlisted key is stored verbatim.

### 6.4 P0 - plugins are unsigned, in-process, hot-reloaded code

Plugins load from <app_data_dir>/plugins/ with no signature, checksum or hash anywhere on the load path (kasirmu-plugin/src/lib.rs:8-12, desktop-tauri/src/state.rs:325-347). A notify watcher hot-reloads on **any** file change with no integrity check and swaps the live manager (state.rs:702-733, :741-755), so any process running as the same user can drop a .lua file into that directory and have it execute in-process within about a second. A USB stick is not sufficient - the path is the app data directory, not removable media - but the 'compromised cashier machine' case is exactly this.

The capability model does not compensate. Each plugin's required_permissions are **self-declared in its own manifest** with no operator grant step (manager.rs:109-129, :218-308), so the manifest is a formality rather than an authorization boundary; allow_network, allow_filesystem and allow_http are parsed and **never read** (manifest.rs:186-192) - dead security knobs that imply protection which does not exist; capabilities.drivers is likewise inert. And the plugin discount path applies a discount with **no SALES_DISCOUNT check** - that check exists only on the manual path (bridge/pos.rs:163-179 versus the plugin path at :2071-2134).

The honest counter-argument, so the recommendation is not over-read: a plugin granting a 100% discount is the intended feature, the pending-discount drains re-validate the percentage to 0..=100 and take the first pending item, and the plugin surface is not currently reachable from a shipped UI (commands/plugins.rs is empty after reload_plugins was removed). The finding is that the trust model is *absent*, not that a specific exploit was demonstrated.

### 6.5 P2 - the Lua sandbox holds, but its tax hook is unbounded

Credit: the Lua sandbox is real. io, loadfile, dofile, require, package, debug, rawget/rawset, load, module and collectgarbage are nilled, os is rebuilt with only date/time/clock, the memory cap is 10 MiB and an instruction hook fires every 100k instructions (kasirmu-lua/src/lib.rs:120-182). No escape was demonstrated - no exposed Rust function hands Lua a file, socket or process primitive.

The bounded residuals: the instruction hook is per-chunk, so it is a CPU bound rather than a wall-clock timeout (docs/security/lua-sandbox-audit.md F2 was never closed); oz.on accepts any event string and LuaEventBridge::fire is public (bridge.rs:111-159); oz.log has no rate limit; and fire_event propagates with ?, so a plugin hook error aborts sale completion (manager.rs:479-521).

The one that matters for money: **a Lua tax override's rate_bps is unbounded** - sales_tax.rs:133-186 feeds sales.rs:473-506 with no range check - so a rule can zero or **negate** tax on a line. Discounts are range-checked; tax is not. And the shortfall-resolution checkout door passes an empty override list (bridge/pos.rs:1868-1873) where the main door passes the real overrides (:1567, :1575-1578), so the same rule applies on one door and silently not on the other.

### 6.6 P2 - the local API secret is plaintext, permanent and dual-purpose

kasirmu-local-api generates a 32-byte CSPRNG secret and stores it **in plaintext** through Settings::set, with no crypto import in the file (local-api/src/lib.rs:202-227, :48-60) - already recorded in docs/security/security-audit-completion.md:30. That one value doubles as the JWT signing key and the operator admin key, and it rides every unfiltered .db/.backup.db snapshot (bridge/data.rs:177-195). Because it is a database setting, two installs derived from one seed share a key.

The rest of the local API is well built and should be said plainly: it binds 127.0.0.1 only, never 0.0.0.0 (lib.rs:282-284); auth is JWT plus X-Admin-Key checked per request in constant time; cors_origins is empty and every write uses a JSON extractor, so cross-site requests cannot complete a preflighted call and CSRF is not a viable vector; the default-off gate re-reads the setting under the operation lock and leaves it off if the bind fails (desktop-tauri/src/lib.rs:806-861). Its reachable surface is its own 27-route axum router - **zero of the 453 Tauri IPC commands** are exposed. But one thing is unclamped: POST /api/v1/tokens passes expiry_hours straight through (kasirmu-api/src/auth.rs:200-202) where the IPC mint clamps to 8760 hours, and scripts/generate-local-api-key.bat:15 mints a ten-year token.

### 6.7 P2 but latent - LAN/KDS

Transport is TCP with newline-delimited JSON; the first byte selects Noise_XXpsk3_25519_ChaChaPoly_SHA256 or a legacy cleartext hello, and authentication is the pre-shared key alone with a constant-time comparison (kasirmu-lan/src/lib.rs:488-574, noise.rs:27). Defaults are correct: bind 127.0.0.1:9180, and a 0.0.0.0 bind without a non-empty PSK is refused and downgraded to loopback (desktop-tauri/src/lib.rs:685-716). Peers **cannot inject**: the post-handshake per-peer loop has no read branch at all (lib.rs:785-832), so KDS tickets, sales and bumps cannot be pushed over the LAN.

With the key, however, a peer receives everything: sale.completed with line items, prices and customer_id, plus all kds.* lines, and should_deliver returns true even for a peer with no subscription (lib.rs:882-905, kds_sync.rs:336), with a replay buffer handing reconnecting peers their queued tickets. The responder static key is derived **deterministically from the PSK** (noise.rs:36-49), so one compromised tablet - or a capture on the legacy cleartext path - yields the store-wide key.

The mitigating fact is also a finding: **no production caller exists for set_lan_server_psk and no UI or command writes any lan_server.* setting (grep over desktop-tauri/src finds reads only). That is why a shared shop LAN cannot be exposed by accident - and it also means 'LAN KDS' is effectively undeployable through the product.

### 6.8 P3 - the CLI and the device-link listener

kasirmu-cli has a global --db path and no authentication of any kind (cli.rs:30-37): migrate, restore, import/export, and a user create that mints an admin-role credential from a caller-supplied PHC pin_hash (commands/user.rs:90-115). Authority therefore equals 'can write the database file' - which an untrusted cashier machine already implies, but which escalates to an authenticated session when the device is unlocked and the attacker only has the profile. Separately, the device-link flow opens a second loopback listener on an ephemeral port and parses link_code from the request line with no source check (bridge/desktop_link.rs:53-54); the impact depends on consume_desktop_link, which was outside this review's fence.

## 7. Tenant isolation and IPC authority

### 7.1 P0 - RLS is declared in the shipped schema and enforced by nothing

The generated PostgreSQL schema enables row-level security and creates 34 tenant policies (migrations/20260813_init.pg.sql:3663-3671, generated from RLS_TEMPLATE at scripts/generate-pg-migration.py:601-624, each policy USING (tenant_id = current_setting('oz.tenant_id', true))). **FORCE ROW LEVEL SECURITY appears nowhere in migrations/** - it exists only in scripts/rls-cutover.sql:10, :50, :56 and in test fixtures. That script states the consequence in the project's own words: 'Today the app connects as the table owner, which bypasses RLS entirely' (rls-cutover.sql:7-9). So on any PostgreSQL deployment that has not had the out-of-band cutover applied, every tenant policy in the shipped schema is inert, and a single missed WHERE tenant_id = ? is a cross-tenant read or write.

The blocker is bigger than the missing FORCE: **the shipped PostgreSQL profile connects as a superuser**, and superusers bypass row-level security even with FORCE enabled - a fact the repository's own test states (apps/cloud-server/src/db_tests.rs:710-713). docker-compose.pg.yml derives DATABASE_URL from the same variable it sets POSTGRES_USER to (:21, :39), and in the official postgres image that is the superuser and database owner. Against that profile, running the cutover produces no enforcement at all. The cutover itself is better than this review first said: 206 lines, it creates oz_app, grants on 30 tables rather than 19, creates two BYPASSRLS roles (pre-tenant webhook resolution, and the email sender plus prune), is idempotent, and ships a rollback recipe - though its own comments disagree about the table count. See D2 for the sequence and the boot-time assertion that would make the state visible.

The good news is that the coverage itself is complete and enforced: PostgreSQL has 49 tables with a tenant_id column, and RLS_TABLES (34) plus RLS_EXEMPT (15) equals exactly 49 with an exact set equality, checked independently this session. The generator fails closed on an uncovered tenant table **and** on a stale exemption (generate-pg-migration.py:425-450), with self-tests both ways. The gap is not which tables are covered; it is that coverage has no effect on the connection the application actually uses.

### 7.2 Credit - nothing trusts a client-supplied tenant

Every tenant read on the cloud server derives from the verified JWT claim rather than from a body, query or header parameter (sync_api.rs:230-234, :269, :371, :494, :665, :728; payment_api.rs:210, :343; rate_limit.rs:343-346), and the transaction-scoped GUC is set from that same value inside the transaction. On the desktop the tenant is a compile-time literal. A grep of both shell command directories finds no command parameter named tenant_id. The one soft spot is that POST /api/v1/tokens can mint a token with tenant_id absent, which the middleware then treats as the literal tenant 'default' (kasirmu-api/src/auth.rs:70-73, :162, :210; sync_api.rs:234), and the endpoint stays open when OZ_ADMIN_KEY is unset (apps/cloud-server/src/main.rs:18) - fail-open by naming rather than by policy, dev-only by intent.

### 7.3 P1 - the shells measure their own IPC gate debt and report it as accepted

The most useful thing in this section is that the repository already knows, precisely, and writes it down. Both shells generate a registration-gate ledger with a debt ceiling: desktop registers **DEBT_CEILING = 74** (47 no_session_resolution plus 27 resolves_session_names_no_permission) and the tablet **94** (50 plus 44) - measured during remediation planning at **75** and **95** respectively, because a row (setup::get_preset_features) was added after this review's measurement; the ceiling is a moving target by design and the ledger drifts upward whenever a command is registered without a gate (registration_gate_debt.generated.rs:214, :223, :226 and :325, :354, :361). Those are not sampled estimates; they are the runtime registration table.

Class-1 entries - commands enumerated as doing no session resolution at all - include settings::set_setting, data::create_backup, data::export_data_without_session, setup::provision_device, staff::bootstrap_owner, license::pause_subscription, license::resume_license, license::renew_license and the three desktop_link pairing commands. Some are legitimate by design: the setup wizard must run before a session exists, provision_device refuses tenant reassignment, and the export twin is a documented ADR-58 decision. Others are not so easily defended.

Two deserve to be named individually. **settings::set_setting authorizes a renderer-supplied user_id**: the command takes user_id: String from the renderer and forwards it (commands/settings.rs:243-253; ui/src/api/settings.ts:282-283), and the gate is real - require_permission_for_user(store, user_id, SETTINGS_EDIT) at bridge/settings.rs:1259 - but it asks about the id the caller typed, not the caller. The codebase already documents this exact anti-pattern elsewhere, in a comment explaining why a scoped twin exists because the old signature 'took userId from the renderer, which is exactly the actor the permission check asks about' (ui/src/api/settings.ts:141). And **data::create_backup writes a full database copy to disk with no identity and no permission check** (bridge/data.rs:330-347, registered on desktop lib.rs:919 and mobile lib.rs:602), logging backup_ungated_no_session while doing it. The read-only argument that justifies the export twin does not cover a filesystem write.

The tablet is the weaker shell: its ledger classes pos::complete_sale_scoped, pos::process_refund_scoped, products::adjust_stock_scoped, offline::enqueue_offline_scoped and the promotions commands as resolves_session_names_no_permission, even though the doors do gate (commands/pos.rs:269, :990-999). And desktop-tauri/src/commands/pos.rs:55-61 re-exports run_override_line_price_unchecked - a price-override path whose name announces its own nature, with the permission attached only on the scoped wrapper (bridge/pos.rs:433-434). It is not currently registered; it is a loaded gun sitting on the shell's module surface.

## 8. Reporting and tax: the numbers an owner runs the business on

This axis produced the review's most uncomfortable result, because the defects are silent, plausible-looking, and land on the two most-read surfaces: the end-of-day sheet and every daily/weekly/monthly revenue figure.

### 8.1 P0 - The two timezone contracts in this codebase are mutually exclusive

Verified at the root, twice. The report bucketing helper reads locations.timezone and accepts **only** 'UTC' or a six-byte +/-HH:MM offset; anything else - explicitly including IANA zone names - returns None so that the caller falls back to UTC semantics, and the fallback is applied with no log, no error and no tracing call anywhere in the module (crates/kasirmu-core/src/db/reports/datetime.rs:18-19, :26-47, :96-98). The module's own documentation states the intent: core carries no tzdata dependency, and a misconfigured store must fall back to UTC rather than guess.

Meanwhile the write path accepts **only** IANA names. The ADR-56 first-run wizard hardcodes timezone: 'Asia/Jakarta' in its provisionDevice call (ui/src/features/setup/ProvisioningFlow.tsx:268), the core writer inserts it verbatim with no validation at all - validate_provision_args checks the location name, owner fields, PIN, terminal, tenant and device credential, but never the timezone (db/provisioning.rs:467-476, :514-564) - and the only writer that *does* validate rejects anything outside Asia/Jakarta, Asia/Makassar, Asia/Jayapura or UTC (bridge/locations.rs:314-321). The intersection of the two contracts is the single value **UTC**.

So: a store provisioned by the current first-run flow is Asia/Jakarta, and every date-bucketed report for it is computed in UTC. There are **25 tz_modifier call sites** - sales_summary (10), revenue (3), product_sales (4), analytics (3), sales.rs export_daily_summary and export_sales_by_hour (2), popularity, kds daily ticket counter, shifts hour labels - and all of them inherit the silent fallback. The tax path reads the same column with a different parser that gets it right: business_date_in_zone maps asia/jakarta to +07:00 (crates/kasirmu-core/src/timezone.rs:18-45, bridge/currency.rs:293-300). A 00:30 WIB sale therefore lands in yesterday's revenue bucket while its tax is resolved on the correct local day. The UI repeats the UTC fallback deliberately (analytics-data.ts:86-97, :118), so the analytics date range is UTC-anchored too - consistently wrong rather than inconsistent.

Two details make this worse rather than better. There is **no data fix**: no migration sets an offset, and the writer that would refuse one is the same one the wizard uses. And the correct mapping already exists in the same codebase, in the module the reports were meant to follow (timezone.rs:8-9). The fix is code, not data: make the report path consult the zone resolver that already exists, and make the two contracts one contract.

### 8.2 P0 - The EOD sheet reports voided and pending sales as revenue, and cannot reconcile with itself

export_daily_summary selects from sales with a date predicate and **no status predicate at all** (crates/kasirmu-core/src/db/sales.rs:266-269), so Pending, Active and Voided rows are summed as today's revenue. Voided sales keep their total_minor, because void_sale never touches it (db/sales_lifecycle.rs:769-773). Every sibling report filters correctly - sales_summary, revenue, product_sales and shifts all use status = 'completed' (sales_summary.rs:164, :196, :285, :312, :380; revenue.rs:143, :209, :272; product_sales.rs:174; shifts.rs:332) - which makes this query the outlier, not the convention.

Then the sheet compounds it. Its total_revenue comes from the timezone-bucketed daily summary (bridge/history.rs:319, :366) while the payment, void and discount breakdowns on the *same sheet* use raw date(created_at) = date('now') with no timezone modifier at all (:326, :347, :358). One sheet, two day definitions, a status filter on one side and none on the other. The header cannot reconcile with its own body, and nothing raises an error. The repository's own test suite pins the hazard (history_tests.rs:469-476, :544-563). **A finding this review missed, surfaced when the desktop fix landed:** the tablet has a *second, independent* EOD builder in apps/mobile-tauri/src/commands/history.rs with both defects, and the repository's own hazard pins record it - one pin went red when the desktop path was fixed, while its sibling still passes only because it exercises the unfixed tablet copy. Two builders mean two fixes, and only one was ever in this review's scope.

### 8.3 P1 - Gross profit ignores refunds, and COGS can be repriced at today's cost

Revenue is SUM(sales.total_minor) over completed sales (revenue.rs:132-144) - tax-inclusive gross, since exclusive tax is added into total_minor before persistence, and there is no tax-exclusive revenue figure anywhere in db/reports. COGS is a correlated subquery over sale lines (revenue.rs:135-141). Gross profit is total_minor minus cogs_minor (revenue.rs:100, :154-158) - using **gross** total - while net_revenue_minor subtracts refunds. Returned goods are back in stock, but their cost stays in COGS and their full sale price stays in gross profit. There is no net-profit figure. On any day with refunds, profit is overstated, always in the owner's favour.

The COGS expression also contradicts the crate's own documented contract: COALESCE(sl2.cost_minor, p2.cost_minor, 0) falls back to the product's **current** cost, while kasirmu-reporting/src/margin.rs:17-20 promises that cost is snapshotted at checkout and that editing a product's cost later never restates historical margins. Any line predating the snapshot - or whose product was deleted and re-added - is repriced at today's cost.

### 8.4 P1 - The cash drawer and the shift report disagree by construction

expected_cash = opening + total_cash - cash_refunds - payouts (db/shifts.rs:186), with total_cash taken from sales where payment_method = 'cash' (:147). Refund and payout subtraction are correct. But a split-tender sale is stamped payment_method = 'split' (bridge/pos.rs:1007, :1020, :2138-2143), which matches neither cash nor card and falls into total_other (:149) - so the **cash leg of every split tender is invisible to the drawer expectation**, the drawer is short, and the cashier is recorded over/short with no error. The real tender methods *are* recorded, in the payments table (sales_checkout.rs:601-622), and the shift **report** reads that table (shifts.rs:302-308) - so the close and the report disagree by construction. No test covers close_shift with a split tender (grep finds none).

Refunds have a second attribution problem: both total_refunds and cash_refunds join refunds to sales on the *original* sale's user_id and ignore refunds.processed_by (shifts.rs:157-177 versus refunds.rs:340-342). A refund processed the next day belongs to no shift at all, silently, and refunds are typed by the original sale's tender rather than the refund's own. Void handling, by contrast, is correct (counted separately, excluded from cash), gift cards are not yet a tender so they cannot corrupt the drawer, and house-account credit is correctly excluded from expected_cash.

### 8.5 P1 - One live screen adds currencies together

The per-currency discipline in db/reports is real and tested: revenue groups by (date, currency), top_products and category_breakdown group by line currency, percentages normalize within currency, and a USD refund cannot net IDR revenue (reports_tests.rs:1778). But kasirmu-reporting breaks the rule: menu_engineering sums SUM(line_minor) and margin across **all** currencies with no grouping (menu_engineering.rs:90-95), and that report is wired to a live screen (ui/src/api/reports.ts:529-534). daily_summary.rs does the same but currently has no production caller. The schema even has the fix - sales.base_currency and base_total_minor exist precisely for this (20260821_tender_currency.sql:1-8) - and **no report reads them**, so there is no 'revenue in base currency' total an owner can use across currencies, only per-currency rows that cannot be added.

### 8.6 Tax: the engine is sound, the integration around it is not

Credit: scope precedence is genuinely well built. Location, then LegalEntity, then Global - first tier with a live row wins; within a tier, is_default, then newest effective_from, then id; effective_to is exclusive; ambiguous rows carrying both scope columns are skipped rather than guessed; product and category assignments are consulted before the scope walk and out-of-scope assignments fall through instead of applying (tax/scopes.rs:425-446, :886-936, :520-549; sales_tax.rs:444-491). Inclusive and exclusive tax are handled correctly (inclusive uses base x bps / (10000 + bps) and is not added to the total; exclusive is added), rounding is integer HalfUp by default with a per-rate statutory override, and cart preview and checkout share the resolver, the rounding mode and the same as-of timestamp - so they are constructed to agree - though 8.7 records that the discounted-cart case is untested.

Three integration defects sit around that sound core. **Tax is computed on pre-discount line totals** (sales_tax.rs:121) while the sale total comes from the post-discount cart, so a fully discounted sale still carries tax. **Promotions apply after tax** (db/promotions.rs:385-390, bridge/pos.rs:1582-1586), reducing the total in place, which breaks the subtotal + tax = total contract the tax module asserts (sales_tax.rs:276-281). And the Lua override asymmetry described in 6.5 means a tax rule silently applies on one checkout door and not the other.

### 8.7 What is proven, and what is not

Proven by tests: per-currency separation, refund netting and refund-day attribution, COGS from snapshot cost, store-offset bucketing and the IANA-to-UTC fallback (tested *as the intended behaviour*, which is how the bug survived), cash-refund subtraction, payouts, and tax rounding modes. Untested: the EOD builder's own numbers (only debug and serialize tests exist), close_shift with split tender, close_shift with house-account credit, gross profit on any day containing refunds (every assertion uses refund-free fixtures), cart-preview versus checkout tax for a discounted cart, the Lua-override checkout door, menu_engineering under mixed currencies, and export_daily_summary's status behaviour - which is pinned as a hazard rather than asserted as correct.

## 9. The frontend

### 9.1 Credit - the IPC boundary and error surfacing are better than most codebases at this scale

No React component calls invoke() directly - a grep across .tsx finds zero real call sites, only comments and mock keys. There is exactly one Tauri boundary, ui/src/utils/logged-invoke.ts:18, imported by 48 of the 66 api files, and the raw @tauri-apps/api/core import is confined to api/tauri.ts plus tests. That is discipline, and it is enforced by convention rather than by lint, which makes it more impressive, not less.

Failure surfacing is genuinely covered: three named boundaries (ErrorBoundary, LocalizedErrorBoundary, GlobalErrorReporter with window.error and unhandledrejection handlers) are wired at AppProviders.tsx:44-46 with a 30-second auto-reload, and 122 files raise toasts. The mid-checkout path is exemplary - if finalize fails after completeSale succeeded, the sale is voided, both errors are surfaced, and the original error is rethrown (PaymentModal.tsx:751-762). The i18n corpus is clean: 54 .ftl files, 27 en and 27 id, with perfect parity in both directions and a fail-closed linter. Focus management is real (useFocusTrap.ts:57, used by six surfaces). And the accessibility picture is much better than a heuristic grep suggests: a scan flagged nine clickable non-interactive elements; an earlier pass reported all nine as defects, but on inspection eight carry a guard (aria-hidden, role=presentation plus tabIndex -1, or an explicit eslint-disable with a keyboard handler) and only the row named in 9.5 is a real defect.

### 9.2 P1 - One sale, two totals: tip and service charge

This is the highest-consequence frontend finding, and it is a backend contract issue that the UI exposes. sales.total_minor is cart.total() - line totals minus discount plus tax, **with no tip or service-charge term** (modules/sales/src/models.rs:171; foundation/src/cart.rs:115-143) - while tip_minor and service_charge_minor are written into their own columns untrusted-and-verbatim (bridge/pos.rs:2151-2152). The UI's own total *does* include service and tip (features/sales/usePosState.ts:239-254), and it is that tip-inclusive total which is shown as Total Due and which drives the payment splits (PaymentModal.tsx:675, :995, :1454-1461). payments.amount_minor is then bound from the client-supplied split amounts (pos.rs:2226-2240; db/payments.rs:96-103), and validate_payment_splits_cover_total only rejects sums *below* the total (sales_checkout.rs:427) - so a tip-inflated sum passes silently.

The result is two stored numbers describing one sale, diverging by exactly tip + service charge: loyalty accrual, revenue reporting and the EOD cash expectation use the tip-exclusive sales.total_minor (sales_lifecycle.rs:55, :65-75; revenue.rs:98-107; shifts.rs:146-150, :183), while the same shift's payment breakdown uses SUM(payments.amount_minor) (shifts.rs:302-314). A cashier's drawer expectation understates by the cash tips collected. base_total_minor - the loyalty earn basis - is likewise fully client-trusted with no server re-derivation (pos.rs:2148; sales_checkout.rs:529-534).

### 9.3 P1 - Three currency truths, grounded carts, and a persisted client total

There is no store library: 11 React contexts totalling 2,285 lines, with WorkspaceContext.tsx alone at 807 lines holding active workspace, instance, screens, store, session token and terminal id in one provider - so a token change re-renders every consumer. Currency has **three** sources of truth: CurrencyContext.tsx:51 mounts with an unscoped getDefaultCurrency() and only later receives the per-store value via a session-token refresh push; SettingsPage.tsx:117-121 mirrors defaultCurrency into local state and re-syncs it by effect; and RegionalSettingsCard.tsx:93, :135 reads a third per-location value. Changing the default currency in one surface does not deterministically reach the other two.

On money the picture is mixed but not alarming. parseMinorUnits is exact BigInt half-up arithmetic (types/domain.ts:199-228) and the cart is integer throughout - but every derivation **floors** (usePosState.ts:236, :245, :251, :258), which is arithmetically identical to the Rust side (verified: zero mismatches across a bounded scan), so the totals agree bit-for-bit. The real exposures are around the arithmetic: setDiscount forces Math.round(percent) to an integer (:282, :294, :307) while the Rupiah-discount path passes a **fractional** percent (RetailPosScreen.tsx:990), so a Rp discount is silently applied at a rounded rate and the UI then displays the rounded rate as if it were the requested one; and the hold path persists a client-computed total_minor (PaymentModal.tsx:925, RetailPosScreen.tsx:1143) which the resume path never uses, because it re-derives from discountPercent (:1189) - a stored money value that disagrees with the recomputation and is dead.

### 9.4 Correction - the money display is a smell, not a defect

An earlier pass rated formatMoney's float division Critical. **That was overstated, and this review corrects it.** types/domain.ts:252 does divide minor units by 10 ** exp in binary floating point before Intl.NumberFormat, and useMoney.ts repeats the pattern three times, but a bounded scan finds no wrong digit below about 9x10^15 minor units for exponent-2 and exponent-3 currencies, and for exponent-0 currencies (IDR, JPY, KRW and friends - including this product's launch market) the division is exact and cannot fail at all. The Rust and TypeScript currency tables agree on exponents. It is a latent precision smell worth a day of work, not a critical finding. The genuinely unguarded part is separate: five files hand-roll their own (minor / 10 ** exp).toFixed(exp), and the CI money gate **excludes ui entirely** (scripts/verify-no-hardcoded-money-format.py:115 restricts ROOTS), so nothing enforces the convention on the frontend.

### 9.5 P2 - no build anywhere can fail on accessibility

scripts/check.sh:309-313 runs npm run test:a11y as an advisory WARN explicitly marked non-blocking, and a grep of the live workflows for test:a11y returns **zero** matches. The only a11y enforcement that can redden a build is npm run lint in dev-ci.yml:345, which runs jsx-a11y recommended rules at error level with no --max-warnings 0 - and in that recommended set, the two rules that would catch a missing label on a control (control-has-associated-label and label-has-for) are **off**. So 'every interactive element has an ARIA label', a stated house rule, is review-only.

Real defects are correspondingly few. The one clear live defect is inventory/TransactionLogScreen.tsx:238-241, a clickable table row with no role, no tabIndex and no key handler - a mouse-only expandable row. ProductThumb.tsx:81 may be the only image without an alt attribute and should be checked before acting. Everything else a naive scan flags is properly guarded. Given how good the rest of the discipline is, wiring test:a11y into CI as a blocking gate looks like the cheapest quality win in this document.

### 9.6 Perf and hygiene

The largest components are NodeTopologyEditor.tsx (2,480 lines), PaymentModal.tsx (1,881) and RetailPosScreen.tsx (1,782); React.memo appears only 17 times in the entire tree while some very large lists (TransactionLogScreen, SalesHistoryScreen) map inline and only two files use react-window. KdsScreen.tsx:390-394 wraps the whole board in a Profiler whose onRender allocates a closure per render and console.debug's every update over 1ms **in production builds** - measurable overhead on the highest-churn screen for a dev-only benefit. Test files have grown to match the components: __tests__/NodeTopologyEditor.test.tsx is 12,186 lines with 548 tests in one file. And ui/ carries build debris at its root (checkall.log, checkall-rerun.log, .tmp-ui.log, vite.config.js, vite.config.d.ts, tsconfig.tsbuildinfo).

## 10. Architecture: honest where someone moved a call site

### 10.1 Scale, and where the domain actually lives

The five-tier workspace is real in the manifests and deliberately documented in the root Cargo.toml. What the manifests do not say is where the work happens. **kasirmu-bridge is 70,691 lines across 141 files - larger than kasirmu-core (54,987 production lines, or 143,845 counting tests)** - and although its crate description calls it 'headless IPC middleware', only ctx.rs and error.rs are middleware; pos.rs (2,294 lines), staff.rs (1,659), auth.rs (1,468), settings.rs (1,425), topology/commands.rs (1,158), sync.rs (1,037) and products.rs (1,029) are the **application layer** that both shells thin-wrap. Desktop has 72 command files and the tablet 105 (the subset that actually calls into the bridge is smaller - an earlier draft's figures of 63 and 58 were unsupported and are withdrawn). That is not a defect to fix by splitting - splitting per domain buys nothing either shell can see, and merging it into core would recreate the monolith ADR-30 broke - but the docstring is false and should be corrected in the same change.

Two more size signals worth recording: **crates/kasirmu-core/src/db is 34,409 production lines behind one Store type**, with 56 public modules in src/db/mod.rs and 71 in the 288-line src/lib.rs; db/sales_tests.rs alone is a 4,598-line file with 143 tests. The tablet app (37,321 lines) is larger than the desktop app (25,474).

### 10.2 The module system is largely ceremony - and the checker knows it

Of 14 module crates, 4 are self-described stubs ('Stub: lifecycle only', ~85-line lib.rs). The other 10 are registered and loaded (platform/startup/src/lib.rs:94-115), but their own service and repository layers - InventoryService, InventoryRepository, SalesService, SalesRepository, InventoryStockHandler - have call sites **only in their own tests and tests/boundary_contract.rs**: zero production callers. Every on_load/on_start/on_stop body is a tracing::info! plus a 'future phases will' comment. The live stock deduction runs in the finalize transaction (startup/src/lib.rs:133-141), not in the modules. Only modules/reporting's SaleCompletedReporter is genuinely subscribed from outside itself (:174), and modules/currency declares itself complete. The modules/*/repository.rs and service.rs mirrors duplicate CRUD that actually lives in kasirmu-core and are documented as unwired.

The dependency picture is more benign than the tier diagram suggests, and this review corrects an earlier reading of it. modules/*/Cargo.toml names kasirmu-core only under **[dev-dependencies]** (crm:25-27, inventory:25-27, for fresh_db), so there is **no runtime cycle**; nothing in modules/ depends on core in production. The 8 grandfathered 'core-upward-dependency' baseline entries are 7 **type-only** edges - three-line pub use shims re-exporting category, customer, product, sale, refund, inventory, tax_rate, terminal, user, loyalty and gift_card models, feeding 30 kasirmu_core::Sale sites, 12 Customer, 8 Product and 5 User - plus **one behavioral edge**: core/src/db/settings.rs delegates 11 methods to modules_currency::repository::CurrencyRepository (16 references) with a From<CurrencyError> conversion in error.rs.

So the inversion is a **labeling** inversion, not a layering one. The recommendation is therefore to fix the rule rather than move 5,000 lines: either re-tier kasirmu-core as a legitimate consumer of module domain types via a named, non-expiring rule keyed on files that only re-export, keeping the time-bounded rule for the currency edge alone - or, if the tier order is held as the invariant, accept that the honest fix is moving the models back down (reversing ADR-30 phase 4). The first is two files of change and reversible; the second is honest and expensive. Either way the decision should be recorded in an ADR, because a rewritten rule that nobody wrote down reads as a weakened gate.

### 10.3 The 2026-11-06 cliff

**On 2026-11-06 - 44 days from this review - every push and every CI run goes red on a day nobody touched the boundary.** The architecture-boundaries baseline entries all expire on that date, and the checker moves each expired entry into both expired and blocking (scripts/verify-architecture-boundaries.py:799-802) with main returning 1 when anything is blocking or stale (:935). Three lanes run it: scripts/run-pre-push.py:253 (Tier 0, always), scripts/check.sh:98, and dev-ci.yml:554 inside static-gates. Today the checker reports 39 crates, 577 dependency edges, 8 tracked, 0 blocking, 0 stale - a clean state that will fail on a calendar date unless the decision above is made first.

The cheapest available repair is to bump the expiry dates, which is permitted and unguarded - pure debt laundering. Two adjacent facts: the --strict flag is parsed and never read (checker:41) while all three lanes pass it, so it is decorative; and deleting the entries instead would remove the only guard against core re-absorbing business logic. If the owner does nothing else from this section, make this decision before the expiry - and add a checker test that a bumped expiry without a new reason fails.

### 10.4 kasirmu-media is a complete pipeline nothing calls

13 files, 1,553 lines, a full ingest/compress/crop/thumbnail/dedupe/storage pipeline - and **zero dependents**: it appears in no app manifest, and a grep for kasirmu_media across all Rust sources returns nothing outside Cargo.toml:63 and Cargo.lock:3630. storage.rs is NotImplemented stubs and pipeline::process is a stub; the last substantive commit was 2026-08-30, after which only rebrand renames. The **shipped** image path is a different implementation: bridge/src/products_images.rs (5 MB, 4096-squared and pixel-count caps, 512 px, WebP at q40 to q30 to q24, content-hashed filenames) with avatars.rs reusing its ingest helper.

The lazy, reversible first step is to add it to [workspace] exclude - a one-line change that *proves* the zero-dependent claim by making the build fail if anything actually needs it - and only then delete it. The counter-argument is testable before acting: diff media's guard table against bridge's, and if media's limits are the stricter ones, wire bridge to media instead of deleting it.

### 10.5 The verdict

Stated as an assessment to be quoted, not as a measurement: **this codebase's modular architecture is aspirational in its documentation and honest only where it has been paid for.** The five-tier diagram asserts modules below crates while core normal-depends on eight module crates; modules are 12,886 lines of which about 953 are four logging-only stubs and roughly 600 are an unwired service/repository/handler mirror; kasirmu-bridge calls itself middleware while holding the real application layer. But the modularity that *is* real is real precisely where someone moved a call site rather than a diagram - the currency repository with 20 external callers, the reporting handler subscribed from startup, the command layer both shells genuinely adopted. The architecture is not a lie; it is a forecast, and 2026-11-06 is when the forecast is either paid for or quietly re-dated.

## 11. Claim versus executable reality

The repository is unusually documentation-heavy, which makes drift here more consequential than in a typical project: the owner and future contributors act on these claims. Every row below was re-measured this session, by the command named, so it can be checked rather than believed:

- test functions: grep -rn --include='*.rs' -o '#\[test\]' . | wc -l
- front-end test files: find ui/src -name '*.test.*' -o -name '*.spec.*' | wc -l
- migrations: ls crates/kasirmu-core/migrations/*.sql | wc -l
- workflows: ls .github/workflows/*.yml (three live plus 11 retired in attic/)

| Claim | Source | Measured | Verdict |
|---|---|---|---|
| 8,355 Rust test functions | README.md:34, :228 | 8,525 | PARTIAL - stale by 170 |
| 593 front-end test files | README.md:34, :214 | 602 test or spec files under ui/src; 611 files under ui/src/__tests__ | PARTIAL - stale, and the two bases differ |
| 59 migration files | README.md:177 | 64 .sql files (63 SQLite plus the generated PG twin) | FALSE - and the '58 SQLite + 1 generated PG' arithmetic no longer holds |
| 'Clippy in no live workflow' | README.md:227 | zero clippy hits in live workflows; only attic/ci.yml.bak:230 | TRUE - and stronger: not on push either |
| 'Log sinks exist but are never wired' | README.md:254 | try_init() IS called in all three apps (desktop lib.rs:102, mobile lib.rs:69, cloud main.rs:213-217); file/rotation/syslog/eventlog sinks have zero callers | PARTIAL - the true half is invisible, the false half is one grep |
| 'Exchange-rate auto-sync daemon never starts' | README.md:256 | init_rate_sync defined at platform/startup/src/lib.rs:429, zero callers under apps/ | TRUE |
| '10 active modules + 4 stubs' | README.md:260 | matches | TRUE |
| 'Seven pre-commit steps' | AGENTS.md:28 | seven section headers in .githooks/pre-commit | TRUE |
| 'TWO workflows' | docs/operations/ci-pipeline.md:25 | three live .yml (dev-ci, release, android) | FALSE |
| Coverage CI job and Lighthouse CI gate | ROADMAP.md:266, :517 | both recorded retired in gates.json:362, :368-371 | FALSE |
| Numbered ADRs '#1-#52' | docs/decisions/README.md:9-12 | index runs to #59 | FALSE |
| ui layout test-utils/ directory | ui/README.md structure block | test-utils is a file (ui/src/test-utils.tsx); the real helpers are nested under __tests__/ | PARTIAL |
| 1,694-line open-findings ledger | docs/records/audit-open-findings.md | present, and 26 source files carry inline 'findings:' IDs | TRUE - and it is this review's most useful prior |

### 11.1 Release and CI truth

A merge to main runs dev-ci.yml: the changes router, website, cargo-check (fmt and cargo check), cargo-nextest with --all-features, ui-test (typecheck, lint, ratchet, Vitest, tz, bundle budgets), i18n, ci-docs-drift, static-gates (about 28 steps), release-readiness, and northflank-deploy on a main push. A **local git push** runs .githooks/pre-push, which calls scripts/run-pre-push.py and nothing else (pre-push:23) - it never calls check.sh, so the 79 legs there do not run, and --no-verify skips it silently (pre-push:19).

**Neither path runs**: cargo clippy (check.sh:59 is local-only), E2E (check.sh:336), the a11y suite, npm run test:a11y, cargo deny (advisory), coverage, Lighthouse, fuzz, or the retired nightly security jobs. release.yml validates only tag-versus-version and updater signature compatibility (:73-90) before release-build (:93) - no lint, no test, no a11y, no security scan stands between a tag and a shipped artifact.

gates.json holds 77 gate ids: 60 required, 2 advisory, 15 retired, 0 optional. It is itself validated by scripts/verify-ci-docs-drift.py:143-170 (duplicate ids rejected; cross-checks docs, workflows, check.sh and check:all; audits orphan hook steps at :1205) and that validation runs in CI (dev-ci.yml:471). So the gate registry is honest **about** its entries - and several of those entries are honest about being unenforced while still marked required: e2e (:316-320, 'No CI job'), perf-smoke (:327, 'two layers of opt-out on a gate marked required'), and data-testid-compliance (:313, 'invisible to CI today'). The advisory and retired entries beside them - a11y-advisory (:245, 'a green Dev CI run is not evidence a11y was checked'), audit (:378, 'deliberately NO ci block'), coverage (:371), sync-slow-tests (:347) - are equally unenforced but are labelled correctly. So exactly three gates carry a required status with no runner: e2e, perf-smoke and data-testid-compliance, plus clippy, which the registry marks required while no live workflow invokes it either. The registry is therefore accurate and its *status field* is not a measure of enforcement; anyone counting required gates over-reports enforced coverage.

Gates that silently no-op: core.hooksPath is opt-in and unversioned, so on a fresh clone all seven pre-commit steps vanish - including the only commit-time guards for PG schema drift and migration column types (CI backstops exist for both since 0.0.37); a missing ui/node_modules turns lint, typecheck, test and i18n into named skips with an unchanged exit status (run-pre-push.py:8-10); a missing Docker turns E2E into a SKIP (check-ui.mjs:22); missing Playwright browsers make perf-smoke a skip; and a missing python3 aborts the pre-commit hook outright while making CI steps fail rather than skip.

## 12. The delivery surfaces: what actually ships

### 12.1 P1 - the shipped unified container 404s five registered license-server routes

The one container ops/ actually builds runs three processes under supervisord: Caddy on :80, the PocketBase-based license server on :8080, and the Rust cloud server on :3099, with one image and one data volume. Routing is by path, first matching handle wins. The Caddyfile carves exactly five license-server namespaces out to :8080 - license, web, admin, desktop and paddle (Caddyfile:44-64) - then sends /api/v1/* to :3099 (:72-75).

But the license server registers **seven** first-segment namespaces (main.go:331-446). The set difference is **two namespaces and five routes**: pairing/start, pairing/claim and pairing/poll (:402-404), plus midtrans/snap and midtrans/webhook (:437, :446). Those fall through to the Rust server, whose axum router registers no such route and installs no fallback layer (apps/cloud-server/src/main.rs:740-761 - the only .fallback( is on the redirect-only branch at :279), and kasirmu-api's router adds none either (lib.rs:265-387). The result is a plain axum 404. The Caddy catch-all is a *proxy* catch-all, not a route catch-all: it only forwards to a server that has no such route.

The casualty is not cosmetic: the tablet device-code pairing flow that ADR-56 section 2.5 exists for is dead in the shipped image, and the Midtrans snap and webhook endpoints never reach their handlers. The underlying defect is a process gap, not a typo - the Caddy carve-out list was never reconciled against the license server's route table. That gap produced a checker, and the checker caught it: scripts/check-unified-routes.mjs is registered as a required gate (scripts/check.sh:102, gates.json:613) and was failing on this tree - 'unified-routes: 1 route prefix(es) reach the Rust service by default - /api/v1/pairing/* is not carved out'. It has since been fixed under this review's own checklist (C27, commit 65f69112f): the pairing and midtrans handles now precede the generic /api/v1/* block, and the checker was widened to resolve route prefixes declared as Go constants, which it previously could not see - its non-vacuity was demonstrated by deleting the new midtrans handle and watching it fail again. Residual: nothing validates the Caddyfile's own syntax, so a typo that the text parser tolerates would still ship. The same file also defaults /api/* to PocketBase (:106-109), so any future sync route registered under /api/ silently changes owner.

Two related facts: the license server's own health override (apps/license-server/health.go:19-21, :247-249) is unreachable through the unified port, because Caddy claims /api/health for :3099 before the /api/* default (:92-99 versus :106); and the server's routes and money logic live in single files - main.go is 1,520 lines holding about 60 inline route registrations, paddle_webhook.go 1,414, web_otp.go 1,074, activate.go 1,052 - with no test asserting that the route set matches the proxy.

### 12.2 P1 - an orphaned Docker guard, and a repository whose real dependency graph is prose

scripts/verify-dockerfile-workspace.py is the only check that would compare Dockerfile.server against Dockerfile.unified. Dockerfile.server:93 asserts that it runs in CI, docs/plans/northflank-p1-p7-plan.md:26 names it as a CI check - and it runs **nowhere**: no gates.json id, no check.sh step, no workflow step, no hook. Its absence coincides with the unified image being unbuildable from 2026-09-13 to 2026-09-18 (recorded in Dockerfile.unified:58-63).

That is a symptom of a wider pattern worth naming: of 157 files in scripts/, 56 are referenced by CI, hooks, check.sh or gates.json, and 101 are not - of which 98 are referenced only from documentation. Exactly three are referenced by nothing at all (apply-fluent-patch.py, fix-settings-extraction.py, fix_pg_lints.py). The delivery system's effective dependency graph is prose, so a documentation rename silently orphans a gate with no signal, and no mechanism notices.

### 12.3 P2 - the documented quickstart cannot work, and the default stack publishes Redis

The base compose file instructs the operator to export OZ_LICENSE_PRIVATE_KEY by catting crates/kasirmu-core/oz-license-private.pem (ops/docker/docker-compose.yml:13, and the same path appears in Dockerfile.unified:15 and DEPLOY.md:81). **No PEM file exists anywhere in the repository** (a glob for *.pem returns zero; .gitignore:70 ignores them), so the documented one-command startup fails on a fresh clone. Compose itself fails fast first, with a ${OZ_LICENSE_PRIVATE_KEY:?} substitution at :117; if the variable is set but empty, the Go bootstrap exits with log.Fatal before PocketBase serves anything (apps/license-server/main.go:75-78). The e2e stack passes that variable with an empty default (docker-compose.e2e.yml:58) - exactly the input that triggers log.Fatal - and only works because run-e2e.mjs supplies a generated key.

On Redis, a correction to an earlier reading: the base compose **does** publish 6379 to the host (docker-compose.yml:139-142) with no requirepass, and docker-compose.prod.yml **does** remove it with an empty-override ports directive (:64-76). So the port is not 'leaked outside the override' - but the override is the only thing that closes it, and **nothing in the repository ever merges it**: the file's own quick-start (:14), scripts/dev-up.sh:44-50 and docker-compose.pg.yml's header all run the base stack alone. The default and every dev entry point publish Redis on 0.0.0.0.

Credit where earned: every base image in ops/ is digest-pinned (Dockerfile.unified:27, :43, :185, :189; Dockerfile.server:22; docker-compose.yml:140; .pg.yml:37; .e2e.yml:83) - there are zero unpinned tags. install.sh verifies the SHA-256 of the installer and of itself when run from disk, though it has no GPG or Authenticode layer on the unix path (ops/install/install.sh:28-35). uninstall.sh preserves data unless --purge is passed. No ops script destroys data without confirmation - the unguarded destructive command is a commented recipe, not executable code. And secret-shaped literals appear only in the e2e compose (e2e-test-secret, dummy), never in a shipped path.

### 12.4 The website, and the rest of the Go license server

website/ is Astro 7 with React 19 and Tailwind 4, 45 .astro pages, prebuild and postbuild hooks, and a check gated by a precheck that runs the i18n audit, a password-policy check and vitest. Deploy is **manual** - npm run deploy through scripts/wrangler-deploy.sh, targeting Cloudflare Workers static assets - and the CI job that exists (dev-ci.yml:144-180) builds and validates with no deploy step and no secret. That is a defensible choice, but it means the site ships by hand and no gate stands between a broken build and production.

The Go license server is otherwise well built for its size: PocketBase v0.39.6 with 9 auto-imported collections and idempotent boot migrations, admin auth by bearer key or an admin-tenant web session, client auth by tenant API key through a SHA-256 lookup index, RSA-2048 signing loaded only from the environment, token-bucket rate limiting keyed on the real client IP with a router-level BindFunc that collapses the X-Forwarded-For chain before any handler sees it, and an escalating persisted login lockout capped at 15 minutes. 52 production files and 19,378 lines, tested by 54 files and 25,453 lines.

## 13. Declared, documented, and inert

This section exists because the most expensive defect class in a documented codebase is a feature that reads as finished and does nothing. Each item below was checked for a wiring call site or for the absence of one.

| Surface | Status | Evidence |
|---|---|---|
| Hardware scale path | **INERT** | HidWeightScale is never registered (no register_scale caller outside tests - registry.rs:134 defines it), HardwareConfig omits scales (bootstrap.rs:169-177), read_scale_weight_scoped always returns Ok(None). A weighed-goods merchant configures a scale, sees no weight, and gets no error. |
| EDC payment terminals | **STUB ON A MONEY PATH** | WiredEdcTerminal and WirelessEdcTerminal are registered by apply_config (bootstrap.rs:371-391) while every operation returns Unsupported. Startup logs them as registered; the first card sale fails at the device layer. |
| 10 modules' business logic | **TEST-ONLY** | SalesService, InventoryService, SalesRepository, InventoryStockHandler have no production callers (10.2 above). |
| File, syslog and eventlog sinks | **INERT** | try_init_with_file, try_init_json_with_file, init_syslog and init_eventlog have zero call sites outside the crate (only definitions and its own tests). A shipped binary logs to stdout only, and kasirmu-cli installs no subscriber at all. An incident has no log file to hand a support engineer. |
| Rate-sync daemon | **INERT** | init_rate_sync is defined (platform/startup/src/lib.rs:429-433) and referenced nowhere else; grep over apps/ returns zero. Settings keys, a status struct and a UI toggle all exist and do nothing. |
| kasirmu-media | **ZERO DEPENDENTS** | 10.4 above. |
| Plugin IPC | **EMPTY** | commands/plugins.rs is empty after reload_plugins was removed; runtime use is limited to the discount drain. |
| WhatsApp notifications | **INERT** | The whatsapp module is gated behind a feature (whatsapp-notifications) that the desktop crate - its only consumer - never enables. |
| `kasirmu-payment`'s Paddle driver | **STUB** | Compiled by the default feature, never constructed by a live caller; PaymentProcessorRegistry::build_from_config is a hard PLANNED stub that errors (registry.rs:127-133). |
| `DriverRegistry::discover()` | **UNCALLED** | Used only in its own tests; bootstrap uses discover_scanners_excluding instead. |
| `init_console_subscriber` | **NO-OP** | Called by both shells, but compiles to nothing without the tokio-console feature (console.rs:28-31). |

Two more from the frontend and data layers, for completeness: features/marketplace/AddonsMarketplace.tsx has no importer outside its own passing test - a green test on a screen no route can reach (features/index.ts:68-74 records it as UNRESOLVED) - and 32 exported API symbols have zero non-test references (the six promotions.ts scoped getters, four tables.ts commands, purchasing.ts:updatePoStatus, staff.ts:clearAvatarScoped), which is an inference-grade identifier scan rather than a graph result.

## 14. Four findings found after the first draft

These came from an adversarial audit of this document itself, which asked what a serious review of this repository should cover and this one did not. Two of them changed the verdict order in section 1.

### 14.1 P0 - There is no operator-reachable restore, and the backup it would restore from is unverified

**The only restore path in the product is a CLI command.** crates/kasirmu-cli/src/commands/backup.rs:62-98 is reachable as oz restore and nowhere else: the bridge has no restore, apps/desktop-tauri/src/commands/data.rs registers only import_data besides the backup commands, the desktop generate_handler! block contains no restore, ui/src/api/data.ts exposes none, and the Data screen offers export, import and backup tabs. A merchant whose database is lost cannot recover it with the product they bought - and the updater's rollback affordance opens the GitHub releases page rather than restoring anything.

**The single backup slot is deleted before it is replaced.** Store::backup copies through SQLite's online-backup API (crates/kasirmu-core/src/db/mod.rs:281-305), but remove_destination_for_backup deletes the existing destination *first* (db/mod.rs:264-272, called at :282), and default_backup_path is one fixed name - <db>.backup.db (crates/kasirmu-bridge/src/data.rs:146-150). A full disk or a crash mid-copy therefore leaves **zero** recoverable snapshots, not one degraded one. The sync pre-pull family is separate and capped at one file (crates/kasirmu-bridge/src/sync.rs:682).

**Nothing verifies a backup, before or after a restore.** Store::check_integrity exists (crates/kasirmu-core/src/db/mod.rs:319) and its own doc comment says verification is the caller's job (:394) - and no production code calls it. run_restore never does. A corrupt backup restores successfully, and the failure surfaces later as 'database disk image is malformed' at first query. The same is true of the pre-update safety backup.

**Restoring against a running till is silent corruption.** The CLI checkpoints WAL, drops its own connection, deletes the -wal and -shm sidecars, then copies the file (backup.rs:73-94). Nothing stops a desktop or tablet shell holding the same database: its sidecars are deleted underneath it and its post-backup writes are lost on the next open, with no error.

**And the updater's safety net is decorative.** Artifact signing is properly done - minisign/Ed25519, public key committed at apps/desktop-tauri/tauri.conf.json:67-72, private key a CI secret, signature re-verified before publish. But before installing, the app simply calls createBackup, writes updater.previous_version and updater.last_backup_path, and installs (ui/src/app/UpdateBanner.tsx:143-155). That backup is the same ungated create_backup (crates/kasirmu-bridge/src/data.rs:337-348), it is never integrity-checked, and the stored path is read by **no restore code** - it is a write-only setting.

**Verdict: no - a merchant cannot recover from a disaster today.** The product ships no restore affordance, its only backup is an unverified plaintext single-slot file that the next backup deletes before replacing, and the updater's safety backup is never checked, never restorable and never referenced again.

### 14.2 P1 - The upgrade path is careful about integrity and careless about repair

The migration runner deserves credit it does not advertise: migrations::run executes first on every start (apps/desktop-tauri/src/state.rs:223-231), refuses to open a schema that a newer binary has migrated (platform/core/src/database/migrations.rs:297-325), normalizes legacy checksums, and wraps each file **and** its schema_migrations insert in one transaction with foreign-key enforcement deliberately toggled outside it (migrations.rs:555-572 - correct, because SQLite ignores that pragma inside a transaction).

But a genuine checksum mismatch is **repaired rather than refused**: the runner logs 'migration definition drift detected - re-applying SQL' and executes the migration again against the live database (platform/core/src/database/migrations.rs:112-121), by design so a comment-only edit cannot brick startup (:23-25). There is **no pre-migration backup** (the runner never snapshots, and docs/operations/ holds no pre-flight procedure for the desktop file), and the repository pins four migrations as un-re-runnable because they consume the state they transform (20260831_loyalty_multiplier_fixedpoint, 20260906_rename_store_to_location, 20260911_memo_fk_restrict, 20260913_memo_locations - migrations_tests.rs:361-366), inside a set containing 52 destructive statements including whole-table rebuilds. A prior incident of exactly this shape is already on record (docs/records/2026-09-21-migration-init-drift-bricked-startup.md). The per-statement drift fallback also gives up per-file atomicity (:424-446).

No schema rollback exists at all: rollback() in the generic runner is public, correct and called only from tests (:147 - the core registry carries no down SQL by policy), and db/downgrade.rs is a *quota* report that never touches DDL. Migration failure reaches the operator as a generic Tauri setup error with no dialog and no recovery path.

### 14.3 P1 - After a panic, the system fails silently in three different ways

An earlier draft of this review counted unwrap sites and would have reported a number. The number is not the finding - and the figure quoted by the audit did not reproduce (a different pattern yields 96 non-test, non-comment sites in 37 files; the repository's own scripts/scan-unwrap-panic.py counts 140 annotated invariants across 29 files, all classified). Every panic that could be traced into an IPC command, a sync apply path or a money computation is guarded by an adjacent invariant; the reachable-unguarded residue is approximately zero.

The defect is the **consequence model**. Tauri 2.11.3 (Cargo.lock:7191) compiles async commands onto a spawned task, run_invoke_handler only returns a bool, and the framework contains no catch_unwind - so **a panicking command never writes a response and the frontend's invoke() promise hangs forever**: no error, no console exception, no crash. All 455 registered desktop commands are async, so all behave this way. A cashier completes a sale, the spinner never ends, and whether the sale persisted is unknown.

Daemons are worse. Every desktop daemon goes through spawn_watched (platform/startup/src/lib.rs:341-361), whose watchdog logs ERROR '{name} panicked' and does **nothing else** - no supervisor, no restart - so 17 daemons (sync, pg-sync, image push, email, KDS health, memo sweep, LAN forwarder, local API) can each die permanently and silently. The cloud server's email queue worker is a bare tokio::spawn with no watchdog at all (apps/cloud-server/src/email_pg/queue_worker.rs:32). The sync daemon carries a state bug on top: `running` is set true at platform/sync/src/daemon.rs:353 and cleared only on the normal shutdown path (:461), so **a panicking sync worker leaves the daemon permanently wedged** - start_inner refuses with 'sync daemon is already running' until the app restarts.

This is P1, not P0: a diagnosability and recovery defect rather than a correctness one. It becomes P0 if panic = 'abort' ever reaches a release profile (it is set nowhere today, and the root Cargo.toml notes the choice is undecided), because then every one of those sites becomes a whole-app kill.

### 14.4 P0 - One crate declares a permissive licence in a proprietary repository

crates/qris-core is the **only** package in this workspace with publish = true, and it declares license = 'MIT OR Apache-2.0' with repository = 'https://github.com/YOUR_ORG/qris-core' - a literal placeholder (crates/qris-core/Cargo.toml:6, :7, :9). The root workspace sets license = 'SEE LICENSE IN LICENSE' and publish = false (Cargo.toml:40, :42); this crate overrides both. The repository's own LICENSE forbids distribution of any part of the codebase.

It is invisible to the only checker that exists: deny.toml enumerates 38 licence clarifications mapping every other crate to the proprietary licence, qris-core is absent from that list, and MIT and Apache-2.0 are already in the allow list - so `cargo deny check licenses` **passes**. The crate has zero dependents, no LICENSE-MIT or LICENSE-APACHE files, and a README that links both. Nothing has been published; a single `cargo publish -p qris-core` would publish this QRIS implementation under a permissive licence, attributed to an organisation that does not exist, and that cannot be undone.

### 14.5 What this section changes

Two of these four findings are P0 and both outrank several items in the original verdict: a merchant cannot restore a lost database, and one command can irreversibly mis-license a component. Section 1 was reordered accordingly, and section 15 carries the matching remediation items (P0-9, P0-10) plus the two P1 follow-ups.

## 15. Prioritized remediation

Order matters: the transaction-mode change is small, sits behind an idiom already in the tree, and is the precondition that makes every later stock test meaningful. Never batch a schema change with the code that depends on it; RLS ships last and as a role/ops change, never as a schema edit. Never batch a schema change with the code that depends on it. RLS ships last and as a role/ops change, never as a schema edit.

### P0 - fix before the next release

**P0-1. Make the money-path transactions IMMEDIATE, then make the guard real, then fix the test.**
Seven sites: sales_checkout.rs:210, sales_lifecycle.rs:179 and :606, refunds.rs:66, gift_cards.rs:53, loyalty.rs:463, shifts.rs:109 - replace self.conn.unchecked_transaction()? with Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?. The alternative (the raw execute_batch('BEGIN IMMEDIATE') idiom used at stock_counts.rs:93) is rejected as a default: it hand-rolls rollback on seven multi-statement money flows. Add CHECK (qty >= 0) to stock_summary **only after** a backfill migration that clamps or quarantines existing negatives into an audit table - the constraint will otherwise brick startup, and the repository has precedent for exactly that class of incident. Add a busy timeout to the regression test's connections and assert that the loser fails with a *lock* error, not merely that one success and one failure occurred. Add a test asserting PRAGMA busy_timeout is 5000 on a fresh_db() connection, and make fresh_db() apply the same pragmas as migrations::run - that omission is the root cause of the wrong-reason pass.
Acceptance: cargo test -p kasirmu-core concurrent_complete_sale_serialized_by_begin_immediate, with the loser's error inspected, plus the busy_timeout assertion on a fresh fixture.

**P0-2. Make the pull idempotent per effect, not per item.**
Before apply_remote_in_tx re-applies complete_sale (platform/sync/src/queue.rs:438-443), check whether the sale originated on this terminal and skip the local deduction - the effect is already in stock_summary. The alternative (filtering the caller's own pushes out of pg_pull_items, sync_store/pg.rs:163-166) is one SQL predicate and no new schema, but it moves the ownership rule into the server query and breaks when a terminal is re-registered with a new id; use it only if a second puller class appears. Either way, **gate this on a variance report**: reconcile stock_summary against stock_movements per (item, location), emit the differences for an operator to accept or adjust, and do not silently rewrite already-double-deducted stock - a blind qty = SUM(deltas) update destroys legitimate manual adjustments.
Acceptance: a test that pushes a complete_sale, pulls it back, and asserts stock moved exactly once; plus the variance report existing and being run once in the field before the fix ships.

**P0-3. Give refunds, voids and payments a sync arm.**
queue.rs:558-563 currently dead-letters them. Until they propagate, a multi-terminal shop cannot correct a sale made on another terminal.
Acceptance: a refund on terminal A is visible on terminal B after a pull, with stock and shift figures consistent on both.

**P0-4. Stop reporting voided and pending sales as revenue, and make the EOD sheet use one day definition.**
Add the status predicate to export_daily_summary (crates/kasirmu-core/src/db/sales.rs:266-269) and unify the day definitions inside bridge/history.rs:319 versus :326, :347, :358.
Acceptance: a voided sale on a day does not change total_revenue, and the EOD header reconciles with its own payment breakdown on a refund-and-void fixture - a fixture that does not exist today and must be written.

**P0-5. Make the report timezone contract match the write contract.**
25 tz_modifier call sites fall back silently to UTC for the IANA names the write path is the only one allowed to produce. Route the report path through the zone resolver that already exists (crates/kasirmu-core/src/timezone.rs:18-45) so one contract governs both. This is a code fix; there is no data fix available, since the writer refuses offsets. The same change should add the missing validation on the provisioning write path (provisioning.rs:467-476) so the two contracts cannot drift again.
Acceptance: a store provisioned as Asia/Jakarta reports a 00:30 local sale on that local day, asserted by a test; and provisioning rejects or normalizes anything it cannot report on.

**P0-6 (revised). Tenant isolation lands as a role change - and the role is currently a superuser.**
Do **not** add FORCE ROW LEVEL SECURITY to the generated migration while the application still connects as the table owner: every query would return zero rows on deploy. But the role is the real blocker, and it is worse than a missing FORCE - the shipped PostgreSQL profile sets POSTGRES_USER and DATABASE_URL from the same variable (ops/docker/docker-compose.pg.yml:21, :39), which in the official image is the **superuser**, and superusers bypass RLS even with FORCE enabled (apps/cloud-server/src/db_tests.rs:710-713). Against that profile the cutover alone produces no enforcement. The sequence, per D2: create oz_app, grant DML, point DATABASE_URL at it **and** set OZ_APPLY_SCHEMA=0 in the same step, verify, keep FORCE as the documented follow-up, preserve both BYPASSRLS roles (rls-cutover.sql:126-158), and add a boot-time rolsuper / relforcerowsecurity assertion so the state is visible. The cutover covers 30 tables and its own comments disagree about the count (rls-cutover.sql:56, :195-205).
Acceptance: a tenant-table query without the tenant GUC returns zero rows and a write is rejected; a query with the GUC returns only that tenant's rows; and the boot assertion warns loudly when the connected role is the owner or a superuser.

**P0-7 (revised). Default to a real at-rest key - but fix the reader first.**
If OZ_MASTER_KEY is not set on a deployment, everything this product calls encrypted is derivable from the repository - and **nothing in the repository sets it**. Simply requiring it at boot is not the fix: the read path cannot distinguish the two derivations (crates/kasirmu-core/tests/credential_storage_form.rs:1042-1103), so the change bricks seven locations across five credential families and both PII columns, and two of those families have no product setter to restore them. The target per D1 is a per-install key held in the OS keychain, with re-encryption on write (the five setters already re-wrap on save) and an export/import lane for .ozpkg PII. **The precondition is the whole cost:** make the reader branch-tolerant - try the master derivation, then the legacy one - before any key is generated.
Acceptance: a fresh install without an explicit master key generates and keychains one; a test asserts the static fallback cannot be reached in a release build; and a row written under the legacy derivation still decrypts after the key exists.

**P0-8. Put an integrity gate on plugin loading.**
Sign or checksum plugin directories and verify before load, and refuse the hot-reload path when verification fails. Make required_permissions an operator grant rather than a self-declaration, and either implement allow_network/allow_filesystem/allow_http or delete them - a parsed-and-ignored security knob is worse than none.
Acceptance: a modified .lua file in the plugin directory is refused with a visible error and the previous plugin set keeps running.

**P0-9. Make recovery real: an in-app restore, a backup that survives, and a verification step.**
Add a restore entry point to the bridge and expose it through IPC and the Data screen, so recovery does not require a CLI the merchant cannot run. Write each new backup to a temporary name and rename over the previous one only after the copy succeeds, so a failed backup cannot destroy the last good snapshot; keep at least two generations. Call Store::check_integrity after every backup and **before** any restore, and refuse to restore a file that fails. Quiesce the app - or refuse the restore - while another process holds the database.
Acceptance: a bridge-level restore_roundtrip test that backs up through the same command the UI calls, corrupts the live database, restores from the app path, and asserts check_integrity() is Ok with a known sale reading back; plus a corrupt-backup case asserting the restore **refuses** and leaves the live file byte-identical.

**P0-10. Decide what qris-core is, and make the manifest say it.**
Either it is proprietary like everything else - publish = false, license.workspace = true, and a deny.toml clarification entry carrying the root licence - or it is genuinely dual-licensed: commit LICENSE-MIT and LICENSE-APACHE, set a real repository and authors, and add the deny.toml entry that makes the difference visible. The one thing that cannot stand is both.
Acceptance: cargo metadata reports no package with publish enabled unless it carries committed licence files, and cargo deny check licenses exits 0 **while** grepping deny.toml for qris-core returns a match - i.e. the allowlist can no longer mask the difference.

**P1 (new). Snapshot before every migration, and document the pre-flight.**
migrations::run should snapshot - or refuse to proceed when it cannot - before applying anything, and docs/operations/ should carry a pre-upgrade procedure for the desktop SQLite file. It currently carries none, while four migrations are pinned un-re-runnable and 52 statements are destructive. This is also a **precondition for P0-1's CHECK constraint**, which is exactly the class of change that must not run against an unbacked database.
Acceptance: a test asserting a snapshot exists after migrations::run, and a migration that fails midway leaving both the database and the snapshot intact.

**P1 (new). Make a panic visible and recoverable.**
Give command bodies a catch_unwind (or the Tauri equivalent) so a panicking command returns an error instead of hanging the frontend's promise forever; make spawn_watched restart, or at minimum tear down and report; and clear the sync daemon's `running` flag on task exit rather than only on the normal shutdown path.
Acceptance: a forced panic in a command body makes the caller receive Err rather than a pending promise, and a forced panic in a sync worker leaves is_running() false so a restart succeeds.

### P1 - next, and each is a small, testable change

- **Lua tax bounds**: range-check rate_bps the way discounts are range-checked, and close the override asymmetry between the two checkout doors (bridge/pos.rs:1868 versus :1567, :1575).
- **local_api.secret**: stop storing it in plaintext, stop using one value as signing key and admin key, and clamp expiry_hours on POST /api/v1/tokens as the IPC mint already does.
- **The two-total sale**: decide whether tip and service belong in sales.total_minor or only in payments, and make validate_payment_splits_cover_total compare like with like. One sale, one total.
- **Split-tender cash**: derive expected_cash from the payments table rather than from the payment_method stamp, so the drawer and the shift report tell the same story; attribute refunds to refunds.processed_by, not to the original sale's seller.
- **IPC gate debt**: delete the renderer-supplied user_id variant of settings::set_setting in favour of the scoped twin; gate create_backup or document it as a deliberate unauthenticated filesystem write; drive the two generated ledgers down deliberately instead of raising the ceilings.
- **Autocommit writes**: wrap the 142 bare execute sites on money paths, and make update_sale_status a conditional update inside a transaction like void_sale already is.
- **Conflict enforcement**: either consume Decision::LastWriterWins and Decision::AutoMerge or stop computing them; add sale to the money-entity test so a completed sale stops classifying as low-severity catalog metadata; and write the 'delivering' state the CHECK constraint already allows.
- **Gift-card numbers**: encrypt or mask card_number, which rides every plaintext snapshot today.
- **Base-currency reporting**: make reports read base_total_minor so an owner has a total that can be added across currencies, and fix menu_engineering, which currently adds currencies together on a live screen.
- **a11y as a gate**: wire test:a11y into CI as blocking, and fix TransactionLogScreen.tsx:238 - the mouse-only row - plus the missing alt at ProductThumb.tsx:81.
- **The 2026-11-06 cliff**: make the architecture decision (below) before the date, and add a checker test that a bumped expiry without a new reason fails.
- **Four required-but-unrun gates**: fix clippy and e2e by adding them to dev-ci.yml; re-label perf-smoke and data-testid-compliance as advisory, unless a budget is enforced. Do not re-label clippy or e2e to make the registry self-consistent.
- **Call check.sh from pre-push**, or state plainly that a push is not the gate.

### P2 - hygiene that compounds if left

The 16 production files over the 1,000-line house limit (kasirmu-api/src/pg.rs at 2,904 is the worst); the 568 test functions sitting inline in 52 production files against AGENTS.md section 2; ui build debris at the frontend root; the 12,186-line single test file; the KDS production Profiler; the 32 unreferenced API symbols and the unreachable marketplace screen; the 101 scripts referenced only by prose; and the ~3 orphan scripts referenced by nothing at all.

### Do not do these

Flip RLS from ENABLE to FORCE while the app connects as the owner. Hand-edit the generated PG init instead of running the generator. Backfill by setting qty to the sum of movement deltas. Raise the registration-gate debt ceilings - the ceiling **is** the finding. Delete the conflict Decision computation instead of consuming it. Weaken the concurrency test to success_count <= 1. Mark clippy or e2e advisory to make the gate registry self-consistent. Add a busy timeout to that test while leaving fresh_db() pragma-free. Retry the same fix a fourth time if the first three fail - after three red gates on one area, diagnose the root cause instead of patching symptoms.

## 16. Parked decisions for the owner

Each of these is now analysed in **manager-codebase-review-decisions.md** (D1-D8), with the deciding facts, the options priced against them, what would change the answer, and a recommendation. Two of those analyses changed this review's own advice: D1 showed that requiring the master key at boot would destroy data, and D2 showed that the shipped PostgreSQL profile connects as a superuser, where FORCE is a no-op.

These are irreversible, deployment-dependent, or genuinely the owner's call. Nothing here blocks the reversible work above.

1. **Is OZ_MASTER_KEY set on any deployment?** This decides whether the public-constant at-rest key is a live exposure or a latent one. It is an environment fact, not a code fact, and only the owner can answer it.
2. **Has any PostgreSQL deployment run scripts/rls-cutover.sql?** If not, tenant isolation does not exist at the database layer there. Same class of question.
3. **Architecture rule versus tier order** (10.2): re-tier the checker to match reality, or move the models back down. My recommendation is the first plus an ADR, but it is the owner's invariant to set - and the 2026-11-06 date forces the decision either way.
4. **Delete kasirmu-media, or wire it in.** One-line reversible proof first, then the diff of the two image implementations. Deleting forecloses the crop/preset work that 0046b describes.
5. **Is LAN KDS a product feature or an experiment?** It works and is safely defaulted, but nothing in the product can configure it, and its key derivation means one compromised tablet exposes all sale traffic on the LAN.
6. **How much plugin trust is acceptable?** Signed-and-verified restricts third-party extension; today's unsigned hot-reload is the opposite extreme. There is no middle ground documented.
7. **Is qris-core meant to be publishable, or is that a stray manifest?** It is the only crate in the workspace with publish enabled, it declares a permissive licence against the repository's own proprietary LICENSE, and the only licence checker cannot see the difference. Recommendation: treat it as proprietary until someone says otherwise.
8. **Is in-app restore a product feature or an ops procedure?** Today the only restore is a CLI command. If merchants are expected to recover their own database, that is a feature to build; if not, the runbook needs to say who does it and how they verify the file first.
9. **Does the unified container matter?** It is the shape ops/ ships; if it is not what production runs, the five 404'd routes are a dev-only bug, and the Northflank deployment shape should be recorded in the repo so nobody has to ask again.

## 17. Method and limits

Nine read-only workers across four dispatch waves - running fifteen assignments in total - produced the evidence behind this document: one spine decision, five research dossiers, six dimension-split reviews, three architectural verdicts, and two independent verifications of the highest-severity claims. **No code was modified, no build was run, no test was executed, and no deploy or network call was made** - every claim above is derived from source, schema, manifests, generated ledgers, SQL and CI configuration, and the claims that could not be settled that way are listed in section 17.

P0-1 and P0-2 were each independently re-derived by a second worker, and both re-derivations **changed the wording** of the original finding - the oversell mechanism in P0-1 was over-claimed and is now stated as a false invariant rather than a proven race, and P0-2's blast radius was corrected per shell. Two findings were downgraded after verification: the money-display float concern (now a smell, not a defect) and the Redis 'leak' (now a default-exposure fact, not an override defect). One finding was falsified as stated and kept as a narrower true claim. Those corrections are in the text, not in a footnote.

**What this review could not establish.** Whether any given deployment sets OZ_MASTER_KEY or has run the RLS cutover; whether production runs the unified container or the two-service compose shape; whether the payment gateways ever populate gateway_response at runtime; whether the vendored SQLite amalgamation includes the WAL-reset fix; whether the ADR-56 provisioning flow is the only first-run path shipped, given that a legacy UTC seeder still exists; the real ACLs on the plugin directory and on backup destinations per OS; whether the compiled OS keychain implementations succeed on each target; and whether the live workflows currently pass, since none was executed. Test totals are the count of #[test] functions, not of executed cases - no suite was run.

## Appendix - Worker roster and verification status

| # | Role | Assignment | Outcome |
|---|---|---|---|
| t1 | thinker | Review spine and assessment axes | Adopted: money-first claim-versus-evidence differential, 13-section outline |
| w1 | researcher | Rust workspace architecture map | Delivered; also ran the sync-convergence investigation, the claims-and-CI audit and the non-Rust surfaces review |
| w2 | researcher | Frontend and tooling map | Delivered; also produced the rusqlite verification, the container-routing verification and the data-at-rest audit |
| r1 | reviewer | Money and stock concurrency | Two P0s; then the declared-but-inert surface audit |
| r2 | reviewer | Security: licensing, tenant, IPC | Three P1s plus the RLS finding; then the independent P0-2 re-derivation and the reporting/tax review |
| f1 | reviewer | Frontend architecture, state, errors | Five findings; then the UI-versus-Rust money agreement, where it corrected its own earlier Critical |
| t2 | thinker | Remediation sequencing | Five tracks - transaction mode, pull idempotence, IPC authority, autocommit/conflict, gates - with the do-not list |
| t3 | thinker | Module system, bridge and media | Fix / keep / delete verdicts; found the 2026-11-06 expiry cliff |
| r3 | reviewer | Lua, plugin, local API, LAN security | One Critical (plugin trust) plus four Majors |

| Headline claim | Status |
|---|---|
| Checkout transactions are DEFERRED, not IMMEDIATE | **CONFIRMED** in the pinned rusqlite source, twice |
| stock_summary has no CHECK (qty >= 0), and the code names it as a guard | **CONFIRMED** across all 64 migration files |
| A terminal re-applies its own complete_sale and deducts stock twice | **CONFIRMED**, blast radius corrected (tablet and desktop differ) |
| Refund, void and payment have no sync arm | **CONFIRMED** (new finding during re-derivation) |
| RLS is enabled but not forced in the shipped schema | **CONFIRMED**; severity depends on whether the cutover ran |
| The default at-rest key is a public constant | **CONFIRMED**; live only if OZ_MASTER_KEY is unset |
| The shipped container 404s pairing and midtrans routes | **CONFIRMED**, and the set difference is exactly two namespaces and five routes |
| Reports fall back to UTC for IANA store zones | **CONFIRMED** - the write path accepts only the value the read path rejects |
| export_daily_summary counts voided sales as revenue | **CONFIRMED**; every sibling report filters correctly |
| formatMoney can display a wrong digit | **DOWNGRADED** - unreachable below ~9x10^15 minor units, exact for IDR |
| Redis is leaked outside the prod override | **REFINED** - the override closes it and nothing ever merges the override |
| There is no operator-reachable restore | **CONFIRMED** - CLI only; the bridge, IPC and UI have none, and no production code verifies a backup |
| The migration runner re-runs DDL when a checksum drifts | **CONFIRMED**, and by explicit design |
| No production caller of Store::check_integrity | **CONFIRMED** |
| qris-core declares a permissive licence with publish enabled | **CONFIRMED**; nothing has published it yet |
| A panicking async Tauri command hangs the frontend promise | **CONFIRMED** from the Tauri 2.11.3 source in the lockfile, not observed at runtime |
| '219 production unwrap sites' | **NOT REPRODUCED** - a different pattern yields 96 non-test, non-comment sites in 37 files, and the repository's own scanner counts 140 annotated invariants across 29 files |
| Counts quoted in the first draft (migrations, test functions, front-end files, autocommit sites) | **CORRECTED** in this revision; section 11 now prints the command that produces each row |

This document was assembled by the manager from the workers' reports; every figure in it traces to a file and line cited in the text or in the accompanying journal at .agents/manager-journal-codebase-review.md.

It was then audited by three independent workers before delivery - one re-deriving its numbers, one hunting for what it failed to cover, one judging it as a document - and the result was not cosmetic: two findings were added that outrank items in the original verdict (section 14), several counts were wrong and are corrected, one severity was double-labelled and is now fixed, one headline number did not reproduce and is now stated as unreproduced rather than repeated, and the "act on first" list was reordered away from the finding that reads as most alarming toward the findings with the largest merchant-visible consequence.
