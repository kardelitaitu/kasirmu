# Crate-by-crate review ledger — session 24-09-26

Reviewed against HEAD `0deb978b7` on branch `0.0.40`. Method: full read of every
production and test file in each crate, plus the narrowest executable check per
crate (`cargo test -p <crate>` and `cargo clippy -p <crate> --all-targets -- -D
warnings`). Nothing in this ledger is a static guess unless it says so.

Order is dependency order (leaves first), not alphabetical, so later crates are
judged against an already-verified base.

## Status

| # | Crate | Tests | Clippy | Findings |
|---|---|---|---|---|
| 1 | kasirmu-crypto | 21/21 pass | clean | CRY-A |
| 2 | kasirmu-logging | 43/43 pass | clean | LOG-1, LOG-2, LOG-3 |
| 3 | kasirmu-lua | 65/65 pass | clean | LUA-A (HIGH), LUA-B, LUA-C |
| 4 | kasirmu-media | 26/26 pass | clean | MED-A, MED-B (MEDIUM), MED-C..E (INFO) |
| 5 | qris-core | 53/53 pass | clean | QRIS-A..C (MEDIUM), QRIS-D (INFO) |
| 6 | kasirmu-core | 3829/3829 pass | **1 warning (CORE-C)** | CORE-A (MEDIUM), CORE-B/C (INFO) |
| 7 | kasirmu-security | 95/95 pass | clean | SEC-A (INFO), SEC-B (INFO) |
| 8 | kasirmu-hal | 345/345 pass | clean | HAL-A (INFO), HAL-B (INFO) |
| 9 | kasirmu-reporting | 80/80 pass | clean | REP-A (MEDIUM), REP-B/C (INFO) |
| 10 | kasirmu-notification | 33/33 pass | clean | NOT-A..D (INFO) |
| 11 | kasirmu-payment | 266/266 pass | clean | PAY-A (MEDIUM), PAY-B/C (INFO) |
| 12 | kasirmu-plugin | 183/183 pass | clean | **PLG-A (HIGH)**, PLG-B/C (INFO) |
| 13 | kasirmu-lan | 74/74 pass | clean | LAN-A (INFO) |
| 14 | kasirmu-cli | 134/134 pass | clean | CLI-A (INFO) |
| 15 | kasirmu-api | 330/330 pass | clean | API-A, API-B (MEDIUM) |
| 16 | kasirmu-local-api | 18/18 pass | **1 warning (LAPI-A)** | LAPI-A (INFO) |
| 17 | kasirmu-bridge | 1384/1384 pass | clean | none (see §17 coverage caveat) |

Severity legend: **HIGH** = wrong today on a live path; **MEDIUM** = wrong but
inert, or a contract the code does not honour; **INFO** = dead code, stale doc,
or a judgment call. Findings are recorded, not fixed, unless marked otherwise.

---

## Sweep summary

**17/17 crates reviewed.** All test suites green: **6979 tests passed, 0 failed**
across the whole `crates/` tree (the per-crate counts in the Status table above
sum to exactly this). Nothing in this repository was modified — every
probe was appended to a test file and reverted, and `git status --porcelain --
crates` is empty at the end of the sweep.

### Findings by severity

| Sev | Count | Items |
|---|---|---|
| **HIGH** | **2** | LUA-A (unsound `unsafe impl Sync`, reproduced crash), PLG-A (SQL validator bypass, reproduced) |
| MEDIUM | 11 | LOG-2, MED-A, MED-B, QRIS-A, QRIS-B, QRIS-C, CORE-A, REP-A, PAY-A, API-A, API-B |
| INFO | 28 | CRY-A; LOG-1, LOG-3; LUA-B, LUA-C; MED-C..E; QRIS-D; CORE-B, CORE-C; SEC-A, SEC-B; HAL-A, HAL-B; REP-B, REP-C; NOT-A..D; PAY-B, PAY-C; PLG-B, PLG-C; LAN-A; CLI-A; LAPI-A |
| **total** | **41** | |

### The two HIGH findings, and why they are the ones to fix first

**LUA-A — `unsafe impl Sync for LuaRuntime` is unsound** (`crates/kasirmu-lua/src/lib.rs:107`).
The SAFETY comment claims a `Mutex` guarantees single-threaded access, but nothing
in the crate enforces that: the type is `pub` with a `pub fn new()`, and the impl
makes `Arc<LuaRuntime>` `Send + Sync`, so any holder can reach the `&self` API from
many threads with no lock. `mlua::Lua` is `Send` but deliberately **not** `Sync`
under the `send` feature. **Reproduced:** two threads calling `load_str` through a
shared `Arc` crashed the test binary with `STATUS_ACCESS_VIOLATION` (0xc0000005).
**The fix is a deletion** — LUA-B shows that removing both `unsafe impl`s compiles
the entire workspace (`cargo check --workspace --all-targets` exit 0) and the tests
still pass, because every real holder is already a `tokio::sync::Mutex` and
`PluginManager` needs `Send` only, which `mlua` supplies.

**PLG-A — the plugin SQL namespace validator is bypassable with a comment**
(`crates/kasirmu-plugin/src/db.rs:174-194`). Every extraction regex anchors the table
name with `\s+`, so `DELETE FROM/**/sales` matches none of them, zero tables are
extracted, and `validate_sql` returns `Ok`. **Reproduced: 7/7 comment cases bypass**
(`DELETE FROM`, line comment, `CREATE TABLE`, `UPDATE`, `INSERT INTO`, `JOIN`), while
the plain forms are correctly rejected. PLG-11 closed the quoted-identifier bypass but
not this one. The stamp already names the durable fix: `sqlite3_set_authorizer`,
which enforces the policy at the engine rather than by text matching.

### Coverage caveat — read this before trusting a green row

Fourteen of the seventeen were read **in full** alongside their executable check:
crypto, logging, lua, media, qris-core, security, hal, reporting, notification,
payment, plugin, lan, cli, local-api. One caveat inside that group: `kasirmu-security`'s
Linux and macOS modules were source-reviewed only — they cannot execute on this
Windows host. The remaining **three** were too large for a full read and say so in
their own sections:

- **`kasirmu-core`** (53,451 prod lines): 10 files read, 4 sweeps across all 163,
  ~150 files unexamined.
- **`kasirmu-api`** (8,981): 10 files read, route-vs-map compared, `pg.rs` (2,760)
  and the spec modules unexamined.
- **`kasirmu-bridge`** (33,289): 3 files read, 3 sweeps across all 70, ~66 modules
  unexamined.

For those three, **absence of findings means "not yet examined", not "clean"**. A
second pass on each is the natural next step, and for `kasirmu-bridge` in particular —
it is where the command bodies live.

### Two house-rule breaks found by running clippy, not by reading

`cargo clippy --all-targets -- -D warnings` **fails** on `kasirmu-core` (CORE-C) and
on `kasirmu-local-api` (LAPI-A). Both were found only because the sweep ran clippy
per crate; the initial `kasirmu-core` entry in this ledger claimed "clippy clean"
after running only that crate's tests, and was corrected in place. The lesson is
recorded in CORE-C rather than quietly fixed.

### Findings that were retracted before being recorded

Four hypotheses were tested and disproved, and are written up so they are not
re-raised: the `decrypt_smtp_at_rest` "fail-open" claim in crypto (the doc already
documents the behaviour), `MessageVisitor` quoting in logging (probed — both paths
render unquoted), the missing-log-directory failure in logging (probed — the appender
creates it), and the `rate_bps` bound in lua (already bounded downstream in
`sales_tax.rs`). Each is recorded in its crate's section under "do not re-raise".
---

## Repair pass — 24-09-26

Every finding above was actioned. **13 commits**, one logical fix each, all on
`0.0.40`; nothing pushed. Each fix carries a regression test, and every test was
verified to FAIL with the fix disabled and PASS with it restored.

| Finding | Commit | Fix |
|---|---|---|
| LUA-A/B | `0421c4af0` | Removed both hand-written `unsafe impl Send/Sync for LuaRuntime`. Workspace compiles; every real holder is a `tokio::sync::Mutex`. |
| LUA-C | `0421c4af0` | Removed `coroutine` from the sandbox — Lua hooks are per-thread, so a coroutine escaped the 100K instruction limit. |
| PLG-A | `7076c33ea` | `strip_sql_comments` runs before table extraction, so `DELETE FROM/**/sales` is now rejected. |
| PLG-B | `7076c33ea` | `contains_word` panics on an impossible compile failure instead of returning `false` (fail-open). |
| PLG-C | — | Left as designed; the stamp already names `sqlite3_set_authorizer` as the durable fix, and PLG-A now covers the bypass class. |
| CORE-A | `0ff1abe99` | Upsert is one `INSERT ... ON CONFLICT DO UPDATE`, matching `set_terminal_profile`. |
| CORE-B | `3c141c75c` | Inline tests moved to `db/recovery_inline_tests.rs`; all 4 still run. |
| CORE-C | `0ff1abe99` | `clippy -D warnings` now passes on `kasirmu-core`. |
| QRIS-A/B/C | `1b27cad83` | Byte offsets throughout the TLV codec; `encode_field` returns `Result` (`FieldTooLong`); `crc::verify` uses `split_at_checked`. |
| QRIS-D | `29ac4bd96` | Fee computed in exact `u128` integer arithmetic; float removed. |
| MED-A | `8bc70a4dc` | `crop_target` threaded through `transform`/`process`; CenterCrop and Smart now work. |
| MED-B | `8bc70a4dc` | Degenerate crop targets rejected. |
| MED-C/D/E | `8bc70a4dc` | Docs corrected (upscale, no root validation, unused `quality`). |
| REP-A | `f672fb205` | INNER to LEFT join with SKU fallback; deleted products keep their history. |
| REP-B/C | `f672fb205` | Merge comment corrected; stale scaffold doc replaced. |
| PAY-A | `25aa45a51` | Blank refund idempotency key treated as absent, matching the charge path. |
| PAY-B/C | `25aa45a51` | QRIS stamp no longer leads with pre-fix severities. |
| API-A | `b431020f2` | `GET /api/v1/memos/active` added to `READ_KEY_MAP`. |
| API-B | `b431020f2` | Coverage test now parses the router source instead of a hand-typed list. |
| LOG-1/2/3 | `55332e929` | Dead `OpenFile` replaced by a constructed `LogDirUnusable`; a writable-directory pre-flight added; `init_eventlog` doc corrected. |
| LAPI-A | `55332e929` | `clippy -D warnings` now passes on `kasirmu-local-api`. |
| HAL-A | `1aa61ecd1` | Doc corrected: the helper does NOT filter to known adapters. |
| HAL-B | `1aa61ecd1` | Serial drawer reports `Io`, not `Bluetooth`. |
| LAN-A | `1aa61ecd1` | The crate itself refuses an unauthenticated non-loopback bind; loopback classifier tested. |
| CLI-A | `cbfe5ed41` | A failed settings write is counted and reported, not discarded. |
| SEC-A/B | `cbfe5ed41` | Doc corrections (inert PAN helpers; rotation is not read-only; `InMemoryKeyring` divergence). |
| NOT-A | `cbfe5ed41` | Phantom customer-phone lookup removed from the doc. |
| NOT-B | `cbfe5ed41` | Placeholder `+15550000000` fallbacks replaced by skip-with-warning. |
| NOT-C | `cbfe5ed41` | Unverified `parse_response` claim documented as unverified with a verification step. |
| NOT-D | `cbfe5ed41` | Inert feature recorded in the module doc. |
| CRY-A | — | Deliberately left: the pair is documented-dead, and removing two `pub fn`s is a breaking API change for a published-shape crate. |

**Verification:** `cargo test` on all 16 touched crates gives **5,694 passed, 0
failed**. `cargo clippy --all-targets --all-features -- -D warnings` is **clean on
all 16**. The only workspace clippy failures are two pre-existing warnings in
`platform/sync` (`daemon_tests.rs:551`, `lib_tests.rs:1797`), in files this pass
never touched.

**Not fixed, by design:** CRY-A (dead but public API) and PLG-C (behavioural
choice). NOT-C remains a coverage gap, not a defect claim.
---

## Bridge second pass — 24-09-26

The second pass on `kasirmu-bridge` (33,289 production lines, ~66 modules unread
in the first pass) found **two more real defects**, both fixed and committed as
`c1b148bea`.

| ID | Sev | Location | Finding |
|---|---|---|---|
| BRIDGE-1 | MEDIUM | `src/data.rs:784,789,838,843,867,873` | **`import_data` discards six row-write errors and still counts the rows as imported.** The `products` arm propagates with `?`, but the `categories`, `customers` and `users` arms were `let _ = tx.execute(...)` followed by an unconditional `counter += 1` — so a failed INSERT/UPDATE was reported in `ImportDataResult` as a record the database never received. Same defect class as CLI-A, in a different importer. **Fixed:** all six propagate. **Pinned** by a source test that fails if any `let _ = tx.execute(` returns. |
| BRIDGE-2 | MEDIUM | `src/license.rs:516` | **A failed hardware-fingerprint persist was discarded while the generated value was still returned.** `generate_hardware_fingerprint` falls back to a per-PROCESS random UUID when `get_system_uuid()` fails, so a discarded write means every launch derives a DIFFERENT fingerprint — and the license server's one-trial-per-device lock keys on this value. The sibling `get_hardware_fingerprint` already persists with `?`. **Fixed:** this path now matches. |

**Sweeps re-run across all 70 production files:** `unwrap`/`expect` (4, all
justified — unchanged from pass 1), `panic!`/`todo!`/`unimplemented!`/`unreachable!`
(0), `unsafe` (0 real; one comment), `format!`-built SQL (0), and `let _ =`
(16 sites: 8 were the BRIDGE-1/2 defects, 8 are benign and self-documented —
channel sends with no receiver, a best-effort probe read, a `flush` after a
successful write).

**Read in this pass:** `pos.rs` checkout path (`complete_sale_scoped`, the replay
guard, the C13 plugin-discount gate), `topology/persistence.rs`, `topology/commands.rs`,
`license.rs`, `data.rs`. **Still unread:** `staff.rs` (1,607), `auth.rs` (1,363),
`settings.rs` (1,336), and the remaining ~60 modules.

**Verified:** `cargo test -p kasirmu-bridge --all-features` → **1385 passed, 0
failed**. `cargo clippy -p kasirmu-bridge --all-targets --all-features -- -D
warnings` → clean. `cargo check --workspace --all-targets` → clean.
**Auth-gate sweep — a false alarm, recorded so it is not re-raised.** A first
pass flagged **119 of 347** `*_scoped` functions as authenticating without
authorizing. That was **wrong**: the pattern only knew `require_session_permission`,
`require_user_permission*` and `require_permission_for_session_resource`, while the
crate deliberately uses **module-local gate helpers** — `resolve_report_scope`
(`reports.rs:62`), `require_inventory_permission` (`inventory.rs:65`,
`stock_transfers.rs:75`), `require_tax_permission` (`tax.rs:206`),
`require_audit_permission` (`audit.rs:228`), `require_customer_permission`,
`require_loyalty_permission`, `require_avatar_write`, `require_category_permission`,
`require_inventory_count_permission` and `session_config`. With those included the
count falls to **12**, and all 12 are legitimate on inspection: self-scoped reads
(`get_own_avatar_scoped` reads only `session.user_id`; the two memo functions read
the session's own terminal), health probes (`version_scoped`, `ping_scoped`,
`get_device_id_scoped`, `get_local_ip_scoped`), and functions that gate through a
helper the widened pattern still could not see (`qris_auto_*` via `session_config`,
`get_sale_promotions_scoped` via `resolve_store`). **No authorization gap found.**

The lesson is the one the ledger already records twice: a pattern-based sweep
under-reports the moment a codebase has more than one way to spell a gate, and the
first number it produces should be checked against real code before it is believed.
### Modules read in the bridge second pass

| Module | Lines | Verdict |
|---|---|---|
| `pos.rs` | 2,149 | Read the money path: `complete_sale_scoped`, the COR-7 replay guard (replay/rekey/fresh verdicts), the two-lock shape and its documented concurrency residual, the C13 plugin-discount gate. Careful and correct; no finding. |
| `data.rs` | 1,188 | **BRIDGE-1 found and fixed.** Also verified the path-containment guard and the pre-transaction quota gates. |
| `license.rs` | 971 | **BRIDGE-2 found and fixed.** Also verified `verify_signature` + `enforce_pos_writable` precede the checkout, and that `check_license_status` fails closed. |
| `settings.rs` | 1,336 | Read the secret/managed-key policy surface: one shared predicate, labels derived from the key constants rather than a retyped prefix list. No finding. |
| `topology/persistence.rs` | 933 | Verified `topology_setting_key` rejects empty/over-long/`/`/control-char branch ids (tested), and that every template write is namespaced under it. No finding. |
| `topology/commands.rs` | 1,117 | Read the Apply path and the template commands. No finding. |
| `ctx.rs` | 597 | Session resolution, the 30 s account-revalidation window, and the four gate helpers. No finding. |

**Still unread in the bridge:** `workspaces.rs` (part-read), `hardware.rs` (761),
`terminals.rs` (733), `purchasing.rs` (733), `subscription.rs` (729), `tax.rs` (705),
and ~45 more modules — roughly 15,000 lines.

### Bridge third pass — 24-09-26 (same session, continued)

| ID | Sev | Location | Finding |
|---|---|---|---|
| BRIDGE-3 | **HIGH** | `src/auth.rs` — `refresh_picker_ticket` | **A DEACTIVATED account's session token minted a fresh, correctly-signed picker ticket.** The fn is sync, so it could not call `resolve_session` (which needs the identity-DB lock via `.await`) and kept only the in-memory lookup — dropping the live-account check. `resolve_session`'s own check does not cover the gap: the FIRST resolve of a token deliberately spends no query (it only opens the 30 s window), and after that it is a cached backstop. So a session minted before a manager deactivated the account kept resolving here for up to the session TTL (24 h) and was laundered into a 5-minute bearer credential for the pre-session workspace picker. **Proven by probe** (`PROBE` test, since removed): `refresh` returned `Ok(86-char ticket)` at the exact moment `staff::list_staff_scoped` on the SAME token returned `PermissionDenied("user is inactive")` — the two disagreed about whether the account existed. **Fixed:** an explicit `EXISTS(... deleted_at IS NULL AND is_active = 1)` check with `try_lock`, failing OPEN on a busy/failed DB exactly as `revalidate_account` does (a *downgrade* of an existing session must not become a new failure mode, and `create_session` re-derives authority from the DB anyway). **Pinned** by `refresh_picker_ticket_is_refused_for_a_deactivated_account`, which drives the deactivation through `Store::update_user` and asserts both the command denial and the ticket refusal. |
| BRIDGE-4 | HIGH | `crates/kasirmu-core/src/db/roles.rs` — `ROLE_REFERRERS` | **A trashed member pinned a role in the trash for good.** `soft_delete_role` gates on `role_reference_counts`, which counted RAW rows — while every *display* surface (`list_users`, the picker, `role_holders`) reads LIVE accounts. A soft-deleted member keeps his `users` row AND his `assignments` row (the trash stamps `deleted_at`, it never deletes; and `assignments` carries no trash column of its own and is not engaged by the intended cascade). So the authoring UI answered "reassign those rows before deleting it" about an account nobody could see, name, or reassign — and `purge_expired_users` only ANONYMISES people, never clears their assignment, while `purge_expired_roles` only purges roles ALREADY trashed. The role was undeletable forever. **Proven by probe** (since removed): after deactivate → trash, `soft_delete_role` returned `Validation("still referenced (users=1, assignments=1)")` while `role_holders` named nobody. **Fixed:** the referrer list became schema-derived — `(table, Option<live_predicate>)` — with the two tables that can outlive their subject filtered by liveness. **Pinned** by `reference_counts_ignore_a_trashed_member_but_restoring_them_blocks_again`, which also asserts the restore puts the block back. |

**Two hypotheses I formed and DISPROVED — recorded so they are not re-raised.**

1. *"A fully-trashed installation can never bootstrap its owner again."* I
   reasoned that `has_users` (live roster) would report `false` while
   `run_bootstrap_owner`'s "refuse if users exist" guard (raw `list_users`… I
   assumed) would refuse — bricking the till. **Probe result:** `bootstrap_owner`
   returned `Ok`. It calls `list_users()`, which IS trash-aware, so the two
   agree. No defect; the guard is already correct.
2. *"A trashed member can still act on his role, because `assignments` is not
   cascaded."* **Probe result:** he cannot. `authorize_with` denies on
   `!user.is_active` before it ever consults the assignment, and the trash
   requires deactivation first. The leftover `assignments` row is inert for
   authorization — which is why the BRIDGE-4 fix is purely about the
   *deletion gate* and does not need to touch the authorization path.
   **A third assumption was corrected mid-fix:** I first wrote the liveness
   predicate as `deleted_at IS NULL` on `assignments`, which failed at runtime
   with `SqlInputError: no such column`. Only `users` is soft-deleted; the
   liveness of an assignment is a question about its ACCOUNT, so it needs an
   `EXISTS` over `users`, not a column test. `ROLE_REFERRERS`'s doc now states
   that rule, so the next edit does not repeat it.

**Read in this pass:** `staff.rs` (1,692, full), `auth.rs` (1,485, full),
`inventory.rs` (917, full), `workspaces.rs` (first 500). `staff.rs` and
`inventory.rs` are otherwise clean: `staff.rs` records its security events
inside the same transaction as the change they describe, reads the
reactivation state in-tx with the same `deleted_at IS NULL` guard the write
uses, and keeps `keep_pay`/`keep_identity_record` honest against withheld
reads; `inventory.rs` presents one uniform session → gate → store-open →
single-call shape with the session user (never a caller id) as the actor.

**Verified:** `cargo test -p kasirmu-core --all-features` → **3321 passed, 1
failed**; the failure is
`db::kds::kds_devices::tests::consume_refuses_an_expired_token`, in files
(`kds_devices.rs`, `kds_devices_tests.rs`) that **another agent is editing at
this moment** — `git diff --stat HEAD` shows +262 lines uncommitted there and
none of mine. Not attributed to this work.
`cargo test -p kasirmu-bridge --all-features` → **exit 0, no failures**.
`cargo clippy -p kasirmu-core` and `-p kasirmu-bridge`, both
`--all-targets --all-features -- -D warnings` → **exit 0**.
`db::roles` 42 passed, `db::staff` 68 passed.

**Commits:** `9fa744ad0` (BRIDGE-4, core), `b619da831` (BRIDGE-3 test; the
`auth.rs` half was swept into another agent's `3f8674c96` — confirmed present
at HEAD by `git show HEAD:crates/kasirmu-bridge/src/auth.rs`).

### Bridge fourth pass — 24-09-26 (credential/trash sweep)

The third pass produced two HIGHs of the same *shape* — a predicate one path
applies and a sibling forgets — so this pass hunted that shape deliberately
rather than reading modules end to end. It paid immediately: the very first
lead (`list_workspace_screens`, flagged while reading `workspaces.rs`) was a
third instance of it.

| ID | Sev | Location | Finding |
|---|---|---|---|
| BRIDGE-5 | MEDIUM | `src/workspaces.rs` — `list_workspace_screens` | **The pre-session screen listing verified the ticket's SIGNATURE and nothing else.** Its sibling `list_workspaces`, 50 lines above, resolves the account from the global identity DB and refuses an inactive one; this fn read `store_id` straight off the wire and returned rows. **Probe result:** a validly-signed ticket for a **deactivated** cashier returned **6 screens**, and the same ticket returned **5 screens for `store-b`** — a store the caller had no relationship with. Authored as a test against the live account (`list_workspace_screens_refuses_a_deactivated_account`) and the store (`…_refuses_a_store_outside_the_callers_access`); both were watched to FAIL with the check disabled (showing the exact `Ok([...])` leak) and then pass with it restored. **Fixed:** resolve the real user, require `is_active`, and when the account carries `user_location_access` rows require the named store among them — the same fail-closed rule `verify_instance_access` applies to a session. Severity MEDIUM not HIGH: the payload is the static `workspace_type_screens` layout table (screen keys + sort order), not business data, and the store listing itself was already gated. It is fixed anyway because the pair disagreeing is what lets the stricter one be relaxed later by someone who reads the looser one as precedent. |

**Sweeps run, and what they CLEARED — the negative results are the point of
this pass.**

* **Credential mint/refresh/verify, both shells.** `refresh_picker_ticket`,
  `sign_`/`verify_picker_ticket`, `create_session`, `insert_session`,
  `session_keepalive`. Both `apps/desktop-tauri` and `apps/mobile-tauri` are
  **pure shims** onto `kasirmu_bridge::auth::*` — there is no second copy to
  drift, so BRIDGE-3 and BRIDGE-5 each fix both shells at once. Confirmed by
  reading the desktop shims (`commands/auth.rs:257,296`) and the mobile
  delegation (`commands/auth.rs:1082`).
* **Every PIN-verification site in the workspace** (3, from `verify_pin\(`).
  `auth.rs:442` (`staff_login`) is guarded by the `!user.is_active` check at
  `:420`; `:826` (`verify_pin`) resolves the session first; `:1291`
  (`switch_organization`) resolves the session first AND re-verifies the PIN
  (full re-auth, no carryover). **No unguarded comparison.**
* **Every raw `COUNT(*) FROM users`** (9 sites) against the BRIDGE-4 class.
  All nine filter `is_active = 1`, and the trash REQUIRES deactivation as a
  precondition (`soft_delete_user` refuses an active row), so a trashed member
  is excluded by construction — trash-safe, not trash-lucky. `profile.rs:609`
  is the armed-quota veto and is deliberately the same literal predicate as
  `count_staff_users`; its own comment records why it must not disagree with
  the gate that armed it.

**Read:** `workspaces.rs` completed (`list_workspace_screens_scoped`,
`set_/get_user_workspace_instances_scoped`, `list_all_workspaces_scoped`,
`list_workspaces_for_store_scoped`, `resolve_boot_store` full). In
`resolve_boot_store` the device-binding HMAC is verified with
`Mac::verify_slice` (constant-time — the module records that the previous
`hex::encode(..) ==` short-circuited and leaked the mismatch position), and
every failure path falls back to the primary store rather than failing open
into a caller-named one. No finding there.

**Verified:** `cargo test -p kasirmu-bridge --all-features` → **exit 0, no
failures**. My files are clippy-clean under
`--all-targets --all-features -- -D warnings`. *Caveat, not mine:* the crate as
of this moment has a `clippy::collapsible_if` error at `sync.rs:74` from
another agent's uncommitted in-flight edit (`git status` shows the file dirty;
the committed version passes).

**Commit:** `a45af101a` (BRIDGE-5, bridge).

### Bridge fifth pass — 24-09-26 (non-constant-time comparison)

| ID | Sev | Location | Finding |
|---|---|---|---|
| BRIDGE-6 | MEDIUM | `src/terminals.rs:85` — `verify_binding` | **The device-binding HMAC was compared with `expected == signature`** — `str` equality, which returns at the first differing byte, so the time to rejection leaked how many leading hex characters of a forgery were already correct. That is a byte-at-a-time oracle, and the caller controls the submitted signature. **The verdict is not internal:** it surfaces to the operator as `DeviceBindingDto::signature_valid` (`terminals.rs:370`), so an attacker who can read that flag gets the oracle's answer back directly rather than having to time it. |

**Why this is a genuine finding and not a duplicate.** `workspaces.rs` has its OWN
binding verifier (`verify_binding_hmac`, `:796`) and it is CORRECT — it uses
`Mac::verify_slice`, and its doc comment records that the `hex::encode(..) ==`
form was *replaced there* precisely because it "short-circuits on the first
differing byte". So the repair was applied to one of two copies;
`terminals.rs` — the module the keyring constant is actually named for, and
whose `DEVICE_BINDING_KEYRING_NAME` the `workspaces.rs` copy is documented as a
"deliberate duplicate" of — kept the defect. The module header even asserts the
duplication "is not unified here", so nothing was going to converge on its own.

**A workspace-wide sweep for the same shape returned exactly one site.**
`== (signature|sig|expected|hex_signature|mac|hmac)` and the reversed form both
match `terminals.rs:86` and nothing else (the other hits are a test helper's
slice search and `subscription.rs:534`'s comparison against a compiled-in
`BOOTSTRAP_FREE_SIGNATURE` constant, which is not attacker-controlled).

**How it is pinned, and why two different pins were needed.** A behavioural
test cannot catch this: the naive comparison accepts and rejects exactly the
same inputs, so it is a *timing* defect, not a logic one. I verified that
directly by restoring the old implementation and re-running — the
accept-the-real-signature / refuse-the-forgery pair passed against BOTH. So the
suite carries both:

* `verify_binding_accepts_the_real_signature_and_refuses_a_forgery` — the
  behavioural contract. It now walks byte positions `0, 1, mid, last` of a
  near-miss forgery (the two ends the short-circuit treated most and least
  cheaply), plus a signature valid for a DIFFERENT binding, plus malformed and
  empty input. It guards the contract even though it cannot see the defect.
* `verify_binding_compares_in_constant_time` — a SOURCE pin (`include_str!` of
  the module, scanning the verifier body for `verify_slice` and for the three
  spellings of a string comparison). Same technique
  `data_tests::import_data_propagates_every_row_write` uses. **Watched to FAIL**
  by reintroducing the short-circuit, then pass once restored.

**A second, smaller repair in the same function, found while writing the
tests.** The old `verify_binding` delegated to `sign_binding`, which MINTS a
keyring secret when none exists. `verify_binding` is called from
`build_device_binding_dto` — a diagnostic READ — so probing an unbound device
wrote a secret as a side effect. It now returns `Ok(false)` when no secret
exists (nothing can have been signed with one) and never writes. Pinned by
`verify_binding_refuses_when_no_secret_exists_and_stores_nothing`.

**Read:** `terminals.rs` (830, full) and `purchasing.rs` (787, full).
`purchasing.rs` is clean: every scoped command is the same `resolve_scope` →
gate → store-lock → single `Store` call, the write paths take
`PURCHASING_MANAGE` rather than `VIEW` where they mutate (including
`receive_purchase_order_with_lines_scoped`, with a comment saying why), and
money is `i64` minor throughout.

**Verified:** `cargo test -p kasirmu-bridge --all-features --lib -- terminals::
workspaces::` → **50 passed, 0 failed**. My files are clippy-clean.

*Caveat, not mine, and now WORSE than last pass:* the crate-wide run is
**1381 passed / 14 failed**, every failure in `kds::*` / `kds_routing::*`, all
from one cause — `table kds_devices has no column named pairing_token_hash`. A
concurrent agent has the migration (`20261014_kds_drop_pairing_tokens.sql`) and
the rewritten `kds_devices.rs` **uncommitted** while the previously-applied
`20261013_kds_pairing_consumption.sql` is already in the tree, so their
in-flight state is internally inconsistent. Nothing in it touches my modules.
The already-committed `sync.rs:74` `clippy::collapsible_if` (from
`5cbcb436d`) also still stands and is likewise theirs.

**Commit:** `cac8658c8` (BRIDGE-6, bridge).

### Bridge sixth pass — 24-09-26 (authorization coverage)

| ID | Sev | Location | Finding |
|---|---|---|---|
| BRIDGE-7 | MEDIUM | `src/hardware.rs` | **12 of the module's 13 `_scoped` commands authenticate but never authorize.** Every one calls `ctx.resolve_scope(session_token)?` (so the token must be valid and the account live) and then goes straight to the HAL registry or the store DB. Only `open_cash_drawer_scoped` (`:417`) carries a permission check (`PAYMENTS_CASH`). The ungated set includes the ones that matter: `print_receipt_scoped` (`:444`), `print_sales_receipt_scoped` (`:256`), `list_scanners_scoped` (`:576`), `start_scanner_scoped` (`:612`), `stop_scanner_scoped` (`:720`), `list_displays_scoped`, `display_show_scoped`, `display_clear_scoped`, `discover_hardware_scoped`. |

**Why I am recording this as a coverage gap and NOT fixing it this round.**
The module is internally CONSISTENT in the opposite direction from a bug: 12
commands agree with each other, and the single gated one is the outlier. That
is the signature of a deliberate historical policy (hardware access = any
authenticated operator at a terminal), not of a forgotten line — and the
doc comments on each ungated fn list only `InvalidSession` under `# Errors`,
never `PermissionDenied`, i.e. the absence is documented rather than
accidental. Changing 12 signatures-worth of behaviour is a product decision
about who may open a till's drawer, print a receipt, or read a customer
display — not a defect repair. The right first step is the one below, which
turns the decision into a visible, checkable list.

What IS unambiguously worth fixing is how the gap stayed invisible, and that
is the second half of this finding:

**The scoped-coverage gate cannot see this class of defect at all.**
`scripts/verify-scoped-coverage.sh:175-177` decides a command is covered the
moment a twin exists:

```sh
if echo "$scoped_funcs" | grep -q "^${fn_name}_scoped$"; then
    continue
fi
```

It never opens the twin. So the two HIGH/MEDIUM authorization holes this audit
found by reading — BRIDGE-3 (a deactivated account minting a picker ticket)
and BRIDGE-5 (an ungated pre-session screen listing) — are BOTH invisible to
it, and so is every command in the table above. The gate enforces the naming
convention, not the property the convention exists for. Its own header states
the property correctly ("it authenticates a `session_token`, AND it resolves
the *session's store*" and, in its example, "session + REPORTS_VIEW"); the
implementation checks only the first half.

**Recommended next action (not taken here — it is a gate change with its own
blast radius):** teach the gate to assert that every `*_scoped` fn whose body
touches the store or the HAL either calls a permission helper or appears in an
explicit, reasoned allowlist of the shape the file already uses. Hardware's 12
become one line of documented policy, and BRIDGE-3/BRIDGE-5 become
unrepresentable. Flagged for a ruling rather than done unilaterally, because a
new failing gate on a shared branch stops every other agent until it is
satisfied.

**Read this pass:** `subscription.rs` (758, full) and `tax.rs` (742, full) —
both clean, and both are the positive control for the pattern: `tax.rs` routes
all 8 scoped commands through one `require_tax_permission` helper with
`SETTINGS_READ` on reads and `SETTINGS_EDIT` on writes, and `subscription.rs`
fails closed on every axis (`build_entitlements` verifies the signature and
returns `Entitlements::fail_closed` on a missing/tampered row rather than an
error, because the UI renders gates open on error). Money in `tax.rs` is
`rate_bps: i64` with zero float arithmetic.

**Verified:** no code change this pass, so the suite state is unchanged from the
fifth pass (`terminals::` + `workspaces::` 50 passed; the KDS failures are
still a concurrent agent's uncommitted migration skew).

### Bridge seventh pass — 24-09-26 (closing the gate blind spot)

The sixth pass ended with a concrete claim: `verify-scoped-coverage.sh` cannot
see the defect class that produced BRIDGE-3 and BRIDGE-5, because it decides a
command is covered the moment a `_scoped` twin EXISTS and never opens the
twin. This pass acted on the recommendation and built the missing half.

**New: `scripts/verify-scoped-authorization.sh`.** A `_scoped` fn that reaches
the store or the HAL must EITHER call a permission helper, OR be named in a
reasoned `SELF_SCOPED` list, OR carry a `// ungated-ok: <reason>` marker. Two
modes: **report (default)**, which lists offenders and always exits 0, and
**`--strict`**, which exits 1 when an ungated fn has no stated reason.

Report is the default ON PURPOSE. A new hard failure on a shared branch stops
every concurrent agent until it is satisfied, so `--strict` is wired into
pre-push only once the backlog reaches zero. **The checker is committed but NOT
yet enforcing** — a deliberate half-step, recorded so it does not read as an
oversight.

**What it found: 348 `_scoped` fns scanned, 31 resolve the store and never
authorize.** They cluster by module — `hardware.rs` (8), `offline.rs` (5),
`tables.rs` (3), `promotions.rs` (3), `sync.rs` (3), `workspaces.rs` (3,
`list_workspace_screens_scoped` among them), `scale.rs` (2), plus singles in
`features.rs`, `pos.rs`, `settings.rs`, `shifts.rs`. That list is the artifact:
it turns an invisible policy into a checkable one, and it independently
re-derived the BRIDGE-7 hardware finding from source rather than from reading.

**Calibrated against false positives, which is what makes the number usable.**
The detector flags ZERO of the functions verified gated by hand: all 8 `tax.rs`
scoped commands and `open_cash_drawer_scoped`, the single gated hardware fn. It
also rediscovered the exact hardware set enumerated manually in the sixth pass,
from a completely different direction — two independent methods agreeing.

**Two detector bugs found and fixed while building it — recorded because the
first version produced a plausible WRONG answer, which is the failure mode a
checker must not have.**

1. A `_scoped` signature line ALSO matches the generic "a top-level fn starts
   here" pattern, so the first version closed every fn against an EMPTY body.
   The `_scoped` test now runs first and consumes the line.
2. The counters live inside awk, so the shell saw only unbound variables
   (`scanned: unbound variable`). The summary and exit code now come from awk,
   and bash reads its status.

**Read this pass:** `tables.rs` and `scale.rs` in full, to test the detector
against real ungated code rather than trusting it. Both ARE genuinely ungated —
`tables.rs` says so in its own header ("the ungated reads (no session gate by
design)") — corroborating that the 31 are mostly a deliberate historical policy
rather than 31 independent mistakes. The checker exists so that policy is stated
per function instead of inferred from silence.

**Verified:** `bash scripts/verify-scoped-authorization.sh` → exit 0 (report);
`--strict` → exit 1 (31 offenders), as designed. `verify-scoped-coverage.sh`
still PASSES, so the existing gate is unaffected.

**Commit:** `2b97e2722` (script).

### Bridge eighth pass — 24-09-26 (the gate now enforces)

The seventh pass committed the checker in REPORT mode with a stated
precondition: wire `--strict` into the gates once the backlog reaches zero.
This pass cleared the backlog and wired it.

**31 -> 0.** Every ungated `_scoped` fn now carries a machine-readable reason,
as an `// ungated-ok:` marker inside its body. **The changes are comment-only —
no behaviour moved**, which is the correct scope: the review established these
are deliberate policy, and changing 31 authorization decisions is a product
ruling, not a repair.

**How the 35 explained entries break down, by the reason actually recorded:**

* **Deliberate shell asymmetry** — `promotions.rs` reads (3). The module header
  already said so in prose ("the deliberate gate asymmetry preserved verbatim
  from the shell"); the marker makes it checkable.
* **Documented module policy** — `tables.rs` reads (3, "the ungated reads (no
  session gate by design)"), `offline.rs` reads (5, where the header names
  exactly four gated write paths and the 4 gates are present), `scale.rs`
  (2, per-register hardware), `workspaces.rs` (4, the workspace PICKER, which
  every authenticated role must reach and which is assignment-scoped and
  tier-filtered inside).
* **Per-INSTALL or compile-time values** — `license.rs`, `health.rs`,
  `currency.rs`, `features.rs`: the answer is the same on every store, so there
  is no store to scope it to.
* **Self-scoped** — `avatars.rs`, `memo.rs`, `settings.rs`, `shifts.rs`,
  `pos.rs`: keyed on the session identity, so they cannot name another actor.
* **One KNOWN OPEN GAP, deliberately NOT laundered as safe** — the 9 hardware
  device commands. Their marker reads "KNOWN GAP (BRIDGE-7) - device access is
  currently open to any authenticated operator. Gating it is a product ruling,
  not a repair." That phrasing is load-bearing: the marker's job is to make an
  exception VISIBLE, and a marker that reads like a justification would do the
  opposite.

**A correction to the seventh pass's own reasoning, found while doing this.**
I first concluded the hardware set needed `enforce_pos_writable`-style gates
like `offline::enqueue_offline_scoped`. That was wrong for most of them:
`enqueue_offline_scoped` is a WRITE (it mutates the sync queue) and its gate is
a §B read-only lock, whereas `list_scanners_scoped` reads a device id set. They
are not the same defect. Only `print_sales_receipt_scoped` and
`print_receipt_scoped` share the "acts on real hardware" shape, and they are
recorded in the same KNOWN GAP rather than split, because the ruling that
decides them decides all nine.

**Wired in (this is the part that closes the blind spot for good):**

* `scripts/run-pre-push.py` — added to Tier 0 static gates as
  `verify-scoped-authorization (H-1b)`, run with `--strict`.
* `scripts/check.sh` — a step immediately after the H-1 coverage step.
* `scripts/gates.json` — registered as `scoped-authorization`, status
  `required`, with a note recording the measured numbers (348 scanned, 0
  unreasoned) and naming the hardware gap so a future reader does not mistake
  the pass for a claim that all 348 are safe.
* `.githooks/pre-push` — the skipped-gates message now names H-1b too.

**Verified:** `bash scripts/verify-scoped-authorization.sh --strict` → **exit
0**, 348 scanned / 35 explained / **0 unreasoned**. `bash
scripts/verify-scoped-coverage.sh` → still PASSES (the existing gate is
unaffected). `python -c "json.load(...)"` on `gates.json` → valid.
`cargo check -p kasirmu-bridge --all-features` → clean.
`cargo test -p kasirmu-bridge --all-features --lib -- terminals:: workspaces::
tables:: scale:: promotions:: offline::` → **93 passed, 0 failed**, covering
every module I touched.

**Commits:** `f40c78a7c` (43 lines of markers across 9 files, comment-only),
`0c6ff94b2` (gate wiring across 4 files).

### Bridge ninth pass — 24-09-26 (a money defect in `pos.rs`)

| ID | Sev | Location | Finding |
|---|---|---|---|
| BRIDGE-8 | **HIGH** | `src/pos.rs:1852` — `complete_sale_with_resolved_shortfalls_scoped` | **The two checkout doors handled an out-of-range `discount_percent` differently, and the difference moved money.** `discount_percent` is an `i64` on the wire while `foundation::Percentage` holds a `u8` capped at 100, so the narrowing needs a decision. The PREVIEW door (`build_preview_cart`) had always clamped with `.min(100)`; the shortfall CHECKOUT door cast raw with `args.discount_percent as u8`, and `as` TRUNCATES. A caller sending **300** had the payable previewed at **100%** and the sale charged at **44%**. **256** is the sharpest case: it truncates to **0**, so the discount was silently DROPPED — no error, no warning, a full-price sale. |

**Why this is HIGH by the ledger's own definition** ("wrong today on a live path"):
the path is live (`complete_sale_with_resolved_shortfalls_scoped` is the
shortfall dialog's submit), the wrong value is money on a receipt, and the
failure is SILENT — the operator confirms the previewed total and the customer
is charged a different one.

**The asymmetry is what proves it is a defect rather than a policy.** Both doors
take the same `i64` from the same wire shape and feed the same `Percentage`.
One clamped; one truncated. `Percentage::new` returns `None` above 100 and its
`Deserialize` impl REJECTS such a value with a typed error, so the truncating
cast was the only route in the codebase that could turn an out-of-range input
into a wrong-but-valid discount instead of a refusal — everything else already
treats >100 as an error or clamps it.

**Fixed by making the decision once.** A new `checkout_discount_percent(i64) ->
i64` `clamp(0, 100)` is now the single narrowing, and both doors route through
it. Clamping (not rejecting) is the correct resolution of the two candidate
behaviours: the preview door's clamp is the one already shipped and tested, and
`Percentage`'s own ceiling is 100, so "above the maximum means the maximum" is
what the type already commits to.

**The pin took three attempts, and the failures are the interesting part.**

1. First I asserted the helper's output directly. **Restoring the raw cast in
   the checkout door still passed** — the test exercised the helper, not the
   door. A test that passes against the defect is worse than none, because it
   reads as coverage.
2. So I added a SOURCE scan over `pos.rs` rejecting any narrowing of
   `discount_percent` that does not route through the helper. That scan
   immediately flagged a SECOND site I had introduced myself (line 1678),
   which is the strongest evidence it works: it caught the author.
3. With both sites routed, **restoring the raw cast makes the test FAIL** with
   `pos.rs:1852 narrows discount_percent without the shared clamp`; restoring
   the fix makes it pass.

The test keeps both halves: the behavioural assertions document the contract,
and the source scan is what actually catches a regression, because the defect
lives at a CALL SITE rather than in the helper.

**Read this pass:** finished `pos.rs` — `complete_sale_with_resolved_shortfalls_scoped`
(the C2 plugin-tax-override parity with the main door, the COR-7 replay guard
with its basket-derived re-key, and the `deny_unknown_fields` arg struct), and
`shortfall_line_unit_price` / `stamp_attempt_split_keys` / `ReplayVerdict`.
The replay guard on this door is careful: it re-keys on a hash of the request
CONTENTS because the cart id is a per-submit synthetic `resolved-<timestamp>`,
with the reasoning recorded — that is the correction to a defect class, not the
defect.

**Verified:** `cargo test -p kasirmu-bridge --all-features --lib -- pos::` → **59
passed, 0 failed**. Clippy clean on both files under
`--all-targets --all-features -- -D warnings`.

**Commit:** `be8d3d8d0` (BRIDGE-8, bridge).

### Bridge tenth pass — 24-09-26 (activation was not atomic)

| ID | Sev | Location | Finding |
|---|---|---|---|
| BRIDGE-9 | MEDIUM | `src/license.rs:161` — `activate_license` | **The two writes that activate a licence were not one transaction, so a mid-way failure left the NEW tier persisted beside the OLD payload.** `store_subscription` (the `tenant_subscription` row every tier gate and `get_subscription_capabilities` read) runs its INSERT in AUTOCOMMIT; `Settings::set_batch` (the signed payload, signature, api_key) opens its OWN transaction. A failure in the second left the first durable — a Pro quota row beside the Free payload. |

**Why this is a defect and not a cosmetic ordering nit: the code already
CLAIMED the property it did not have.** The block comment reads *"This write
comes BEFORE Settings::set_batch so a partial failure doesn't leave the system
in an inconsistent state where Settings reflect the new tier but
tenant_subscription still has the old Free tier."* Ordering alone cannot
deliver that when the two writers use different transactions — it can only
decide WHICH half is stranded, not whether one is. The comment wrote a cheque
the code did not cash, which is worse than no comment: a reader checking the
invariant against the prose would have concluded it held.

**Proven, not reasoned.** A regression test forces the settings write to fail
(dropping the `settings` table) after the subscription write has already run,
then asserts the tier is still Free. **Emulating the old autocommit shape makes
it FAIL with `left: Pro, right: Free`** — the new tier survived a failed
activation, exactly the state the comment claimed was prevented. Restoring the
joined transaction makes it pass.

**Fixed** by opening one `unchecked_transaction()` and routing BOTH writers
through it, plus `tx.commit()` at the end. `store_subscription` already took a
`&Connection`, and a `&Transaction` derefs to one, so the core signature needed
no change — the fix is entirely at the call site. The hardcoded `"license.*"`
string literals were also replaced with the existing `platform_core::settings::
keys::LICENSE_*` constants, which is how every other lane in this crate names
them (the literals were the only place they appeared unqualified).

**Honest scope note:** the failure needs the second write to fail, which in
practice means disk-full, a locked/corrupt DB, or a process kill between the
two statements. So this is MEDIUM, not HIGH — wrong but requiring a fault to
reach, not wrong on an ordinary path. It is still worth fixing because
activation is the ONE moment the quota facts change, and the stranded state is
self-consistent enough to persist for the life of the install.

**Read this pass:** `activate_license`, `sealed_api_key`, `stored_credentials`,
`get_machine_id`, and the licence-key plumbing in `crates/kasirmu-core/src/
license_verification.rs` and `platform/core/src/settings/{keys,raw}.rs` to
establish that `set_batch` really does open its own transaction (it does —
`raw.rs:137`) and that the `LICENSE_*` constants match the literals used here.
`sealed_api_key` is careful: it treats an undecryptable value as legacy
plaintext rather than erroring, with the reason recorded, because activation
must still work on a database written by a pre-encryption build.

**Verified:** `cargo test -p kasirmu-bridge --all-features --lib -- license::` →
**23 passed, 0 failed**. `cargo check -p kasirmu-bridge --all-features` clean.
My two files are clippy-clean under `--all-targets --all-features -- -D
warnings`; the crate still carries the unrelated `sync.rs:74`
`clippy::collapsible_if` committed by another agent in `5cbcb436d`.

**Commit:** `0edcda3dc` (BRIDGE-9, bridge).

### Bridge eleventh pass — 24-09-26 (the renew twin)

| ID | Sev | Location | Finding |
|---|---|---|---|
| BRIDGE-10 | MEDIUM | `src/license.rs:335` — `renew_license` | **The renewal lane carried the same non-atomic pair as activation.** `store_subscription` (autocommit) followed by `Settings::set_batch` (its own transaction), under a comment reading "Persist the renewed subscription to both stores". A failure between them left the renewed `tenant_subscription` durable beside the PREVIOUS payload and signature — quota gates reading Pro/Premium while the licence status check reads the old expiry, a state nothing ever reconciles. |

**This pass was a deliberate CLASS HUNT, not a module read**, and that is the
point of recording it separately. BRIDGE-9 established the shape
("a store write in autocommit followed by a `Settings::set_batch` that opens
its own transaction, under a comment claiming they are ordered for
consistency"). Rather than read the next module end-to-end, I searched the
crate for that shape. It found exactly one more site.

**The sweep, and why it is worth trusting:** a script walked every production
file for a `store_subscription(` call followed within 45 lines by
`Settings::set_batch(`, then checked the intervening lines for a
`unchecked_transaction`/`let tx`. It reported **one** hit — `license.rs:335` —
which is exactly the site I had already spotted by reading, and it reported
**nothing** for the two lanes fixed in the tenth pass, because those now open
the transaction the scan looks for. A scan that is silent on the fixed cases
and loud on the unfixed one is calibrated, not merely quiet.

**Proven the same way.** The new test drops the `settings` table between the
two writes; **emulating the old autocommit shape fails it with `left: Premium,
right: Free`**, and the joined transaction passes. Same `LICENSE_*` constants
substituted for the raw literals as in the tenth pass.

**Verified:** `cargo test -p kasirmu-bridge --all-features --lib -- license::` →
**24 passed, 0 failed** (both atomicity tests green). `cargo check -p
kasirmu-bridge --all-features` clean. My files are clippy-clean under
`--all-targets --all-features -- -D warnings`.

**Commit:** `b348f84f4` (BRIDGE-10, bridge).

### Bridge twelfth pass — 24-09-26 (two false alarms, and why they were worth chasing)

**No defect fixed this pass.** Both leads died under verification, and the
negative results are recorded because each one was a *plausible* defect that a
less careful pass would have reported as real.

**1. `customers.rs` gates on a CALLER-SUPPLIED `user_id` — but only on
unreachable legacy fns.** `create_global` (`:305`), `update_global` (`:340`) and
`delete_global` (`:373`) all authorize `require_permission(&args.user_id, ..)`
rather than the session user, which is the textbook authorization fallacy and
exactly the shape BRIDGE-3/5 trained me to look for. Verification: the `_scoped`
twins (`create_scoped` `:454`, `update_scoped` `:484`, `delete_scoped` `:513`) all
use `session.user_id` correctly, the five `*_global` fns have **zero
registrations** in either shell (`grep customers::*_global apps/` → 0) and
**zero callers** anywhere in the bridge, and their own doc comments say
"Deprecated for multi-store UI paths (ADR #7): `create_scoped` takes the user
from the session instead of the arguments". So the exposure is nil. Recorded as
INFO dead API rather than a finding. **The lesson:** "authorizes the wrong
subject" is only a defect where the function is REACHABLE; reachability is a
separate check from the shape.

**2. `refresh_license_crl` looked like a revocation mechanism that never runs.**
It is a complete CRL implementation — fetch, `verify_crl_signature`,
`apply_crl_to_cache`, and `invalidate_all_sessions` on revocation, i.e. ADR #58
§2.1/§2.2 — and `grep refresh_license_crl` returns **one** hit: its own
definition. Zero callers in the bridge, zero in either shell. For a licensing
audit that reads as "we built the kill switch and never wired it", which would
have been a serious HIGH.

**It is wrong.** Lines 630-637 show `check_license_status` performing the same
refresh inline ("Opportunistically refresh CRL on status check (ADR #58
§2.1/§2.2)"), with the same verify-then-apply order and the same
session-invalidation on `Ok(true)`. So the LIVE path exists and works;
`refresh_license_crl` is a dead DUPLICATE of it, not the mechanism itself.
**The lesson, and it is the sharper one:** "nothing calls this" does not mean
"this behaviour never happens" — it means the behaviour, if it happens, happens
somewhere else. A dead-code signal is evidence about a SYMBOL, never about a
CAPABILITY.

**A tooling error worth recording, because it produced a wrong worklist.** My
first dead-code sweep (a PowerShell pass over `pub fn` names counting references)
reported **30** candidates. Spot-checking four with the real `grep` tool showed
25 were false positives: `get_daily_revenue` has 26 references,
`update_sync_settings` has 79. The script's `Select-String -Path` globs did not
recurse into nested module directories (`src/topology/`, `src/db/`), so anything
referenced only from a subdirectory counted as dead. **That is the same failure
mode as the seventh pass's awk checker** — a plausible, confidently-formatted
wrong number — and it was caught the same way: by verifying a sample against a
second tool before believing the aggregate. Noting it because the ledger now
records that mistake twice, in two different languages, which suggests the
guard should be a rule rather than a habit: **any count a new script produces is
a hypothesis until a sample is confirmed by an independent method.**

**Read this pass:** `customers.rs` (gate helpers + both twin sets), `license.rs`
CRL half (`check_license_status` revocation ladder, `refresh_license_crl`),
`sync.rs` `test_sync_connection` (the two `unwrap_or(true)` sites — both benign:
the predicate is "no server URL configured", a connectivity question, not a
security one), and the tail of `workspaces.rs` (`remediation_target`,
`recover_/suspend_surplus_workspace_instances_scoped`).

**Verified:** no code changed, so suite state is unchanged from the eleventh pass
(`license::` 24 passed; my files clippy-clean). `git status` confirms nothing of
mine is uncommitted.

### Bridge thirteenth pass — 24-09-26 (stock integrity, and the independent-count rule applied)

**No defect fixed.** Two unread stock-integrity modules read in full and verified
clean, plus the dead-API thread the twelfth pass left open, closed out.

**Read in full: `inventory_counts.rs` (574) and `stock_transfers.rs` (356).**
Both are the positive control for the pattern this audit keeps finding:

* Every one of the 11 `inventory_count` commands is `resolve_scope` →
  `require_inventory_count_permission(ctx, &session.user_id)` → store lock → one
  `Store` call. Every one of the 10 `stock_transfers` commands is the same shape
  with `INVENTORY_TRANSFER`. No call site takes the actor from the wire and none
  skips the gate — the two things that produced BRIDGE-3/5/7.
* `inventory_counts.rs` checks arithmetic the way money code should:
  `checked_sub` for the counted-vs-expected difference, with a typed
  `"counted_qty difference overflow"` refusal rather than a wrapping `-`.
* State is guarded by predicate helpers (`editable_count`,
  `editable_or_readable_count`) rather than inline `status ==` tests, so the
  draft/in-progress/cancelled rule has one definition;
  `update_stock_count_status` adds an explicit transition table.
* `create_stock_transfer_scoped` validates BOTH locations and BOTH terminals
  before the write and takes `&session.user_id` as the creator.

**Verified:** `cargo test -p kasirmu-bridge --all-features --lib --
inventory_counts:: stock_transfers::` → **32 passed, 0 failed**. No float and no
bare `unwrap`/`expect` in either production file.

**Closed the dead-API thread from the twelfth pass.** `reports.rs` exposes paired
`X` / `X_scoped` functions per report, and only the `_scoped` variant is
registered (`apps/desktop-tauri/src/lib.rs:1230` registers
`get_daily_revenue_scoped`; the unscoped `get_daily_revenue` has no registration
anywhere). That is the coverage gate's intended outcome rather than rot — the
unscoped twin is the pre-ADR-#7 door the `_scoped` one replaced — so the pairing
is not dead code to delete, it is what `verify-scoped-coverage.sh` exists to
require. Same disposition as `customers::*_global`: unregistered, uncalled,
deliberately superseded.

**The independent-count rule, applied as promised.** Rather than re-running my own
broken PowerShell sweep, every dead-code claim this pass was confirmed with the
`grep` TOOL, which recurses into `src/topology/`, `src/db/` and the nested module
directories the script missed and which produced the 25-of-30 false positives. It
cost two greps and removed an entire class of wrong worklist. The rule stands as
written: **a count a new script produces is a hypothesis until a sample is
confirmed independently.**

**Running tally:** 10 defects fixed (4 HIGH), 2 classes closed by construction
(the H-1b authorization gate; the class-hunt method), and 4 leads disproved under
verification — recorded because a disproved lead costs the same effort to find and
would have been worse to report as real.

### Bridge fourteenth pass — 24-09-26 (the API crate, and a third disproved lead)

**No defect fixed.** Moved to `kasirmu-api` as recommended — the crate with only
first-pass coverage. The specific target was `pg.rs` (2,760 lines, never read).

**Read:** `pg.rs` head + `create_user` + `verify_terminal_credentials`, the whole
of `auth.rs` (335), the whole of `read_tiers.rs` (233) and its completeness test,
`routes/tokens.rs` `admin_key_authorised`, `routes/terminals.rs` `hash_secret`,
and `routes/settings.rs` both handlers.

**Verified good, with one that was worth checking against a claim:**

* `admin_key_authorised` (`routes/tokens.rs:101`) is genuinely constant-time —
  HMAC-SHA256 digests under a fixed domain-separation key compared with
  `verify_slice`. The file header claims this as **API-2 FIXED**, and the claim
  holds: this is the same defect class as BRIDGE-6, already repaired here, and
  the doc even names the reason ("a plain `==` on strings short-circuits on the
  first differing byte"). I checked rather than trusting the stamp.
* **Swept the whole API crate for that class**: `== *(secret|key|admin|token|
  signature|supplied|provided)` and the reversed form return **zero** hits.
  `verify_slice` appears exactly once, at the one site that needs it.
* `hash_secret` SHA-256s the device secret and the comparison happens IN SQL
  (`secret_hash = $2`), so there is no in-process string compare to time.
* `verify_terminal_credentials` handles the pre-tenant RLS read explicitly
  (BYPASSRLS discovery-role check before the lookup) and rolls back on drop.
* `create_user` is transactional, RLS-scoped via `set_config(..., true)`, checks
  the role exists before the insert, and distinguishes unique-vs-FK violations.

**The disproved lead — and it is the most instructive one yet.** I found that
`/api/v1/settings` (GET) is the ONE protected GET route absent from
`READ_KEY_MAP`, and `read_gate_middleware` fails OPEN on an unmapped path ("Route
not in the map — sync, public, or write — pass through"). The map's own comment
documents that this exact gap was hit once before: *"This route is on the
protected router but was MISSING from this map, and the gate passes any unmapped
path through — so a read-scoped token reached it with no permission check"* (the
memos route, fixed as API-A). So the shape, the precedent and the fail-open
design all pointed at a live hole.

**Wrong, and twice over.** First, `get_settings_handler` gates ITSELF —
`admin_key_authorised` is the first statement (`routes/settings.rs:225`), so a
read-scoped JWT is rejected before any read. Second, and better: the completeness
question is ALREADY under test. `read_key_map_covers_all_protected_get_routes`
(`read_tiers_tests.rs:232`) parses the ROUTER SOURCE, derives the GET route set,
exempts `/api/v1/settings` with the reason spelled out
(`"/api/v1/settings", // admin-key gated in the handler`), and fails on anything
unmapped. It asserts the parse found ≥10 routes so it cannot pass vacuously, and
its comment records that the FIRST version asserted a HAND-TYPED list — *"which is
how GET /api/v1/memos/active came to be unmapped while the gate passed it through
unchecked"*. That is the same lesson as BRIDGE-6's source pin and BRIDGE-8's
call-site scan, already learned and already applied in this crate.

**Verified:** `cargo test -p kasirmu-api --all-features
read_key_map_covers` → **1 passed, 0 failed**.

**The pattern worth naming.** Three consecutive passes (12th, 13th, 14th) produced
no defect, and each died the same way: a plausible defect shape, correctly
identified, that verification showed was ALREADY GUARDED — by a handler-level
gate, by a source-derived completeness test, by a documented exemption. The
bridge and the API both already carry the two defences this audit has been
building toward (a fail-closed gate, and a test that keeps a list honest), and in
several places they got there first. That is a substantive finding about the
CODEBASE, not a null result: the remaining risk is concentrated where those
defences are absent, and finding those places is now more about locating GAPS IN
THE GUARDS than about reading more code.

### Bridge fifteenth pass — 24-09-26 (guard coverage, and a change the guards REJECTED)

Following the fourteenth pass's recommendation — target guard coverage rather
than more module reads — I looked for security-relevant lists that lack a
completeness test, and found the opposite: a guard so tight it rejected a
"tidy-up" I was about to ship.

**The candidate change.** Eight production `Settings::get` calls in `license.rs`
(`:205`, `:295`, `:298`, `:536`, `:780`, `:781`, `:928`, `:963`) pass credential
keys as **raw string literals** (`"license.api_key"`) rather than through the
`keys::LICENSE_*` constants declared in `platform/core/src/settings/keys.rs`. I
had replaced exactly these literals with constants in the two WRITE sites during
the tenth pass, so the reads looked like a leftover. I replaced all eight.

**It compiled, and the guard failed.**
`settings::license_writer_literals_are_swept_from_license_rs_not_from_a_transcription`
went red with *"the sweep read no key-shaped literal out of license.rs: the
include_str path moved or the parser broke."* Reading it explains why the
literals are load-bearing: the test's job is to prove that what `license.rs`
SPELLS matches what `keys.rs` DECLARES, and it does that by lifting the literals
out of the file as TEXT (`include_str!`) and comparing them to the registry. Its
own doc records that the first version compared a hand-typed transcription — *"it
could only go red by being edited, and stayed green while `license.rs` drifted,
which is a decoration wearing a drift pin's name"*. Replacing every literal with
the constant would have made the sweep find nothing, i.e. would have rebuilt
exactly the decoration the test exists to prevent. Reverted; guard green again.

**So the same review act produced two opposite conclusions, and the guard decided
between them.** Read locally, the raw literals look like drift that a careful
engineer should normalise. Read against the guard, they are the test's INPUT, and
normalising them disarms it. The guard's `>= 5 literals` assertion is what makes
the difference detectable at all — without it the "fix" would have shipped green
and silently converted a live drift pin into a no-op.

**Verified:** `cargo test -p kasirmu-bridge --all-features --lib
license_writer_literals` → **1 passed** after the revert (FAILED with my change).
`license::` → **24 passed**.

**What this pass actually establishes about guard coverage.** The three guards I
checked this round and last are all stronger than a module read would have told
me:

* `read_key_map_covers_all_protected_get_routes` — derives routes from ROUTER
  SOURCE, exempts with reasons, asserts a floor so it cannot pass vacuously.
* `license_writer_literals_are_swept_from_license_rs_not_from_a_transcription` —
  sweeps the producer as text, asserts it found something, and is proven live by
  the failure above.
* `every_credential_family_key_declared_in_keys_rs_is_blocked` — forward, reverse
  AND set-equality legs, plus a parallel table test that must equal the swept set
  (`LICENSE_PHONE` was once a constant behind, and the comment records it).

Each has the two properties that separate a guard from a decoration: it derives
its subject from the real source rather than a transcription, and it asserts a
floor so it cannot pass by finding nothing. That is a substantive answer to the
question the last pass raised, and it is the fourth round running whose conclusion
is that the codebase's guard layer is already ahead of the audit.

#### Where the audit stands

Ten defects found and fixed across the bridge and core, four of them HIGH:
BRIDGE-1 (discarded import write errors), BRIDGE-2 (discarded fingerprint
persist), BRIDGE-3 (deactivated account minting a picker ticket), BRIDGE-4
(trashed member pinning a role), BRIDGE-5 (ungated pre-session screen listing),
BRIDGE-6 (non-constant-time HMAC compare), BRIDGE-7 (12 ungated hardware
commands — recorded, now enforced by a gate, gating itself left as a product
ruling), BRIDGE-8 (discount-percent truncation moving money), BRIDGE-9
(non-atomic activation), BRIDGE-10 (non-atomic renewal).

Two of those classes are now closed by construction rather than by fixes:
**authorization** (the H-1b gate fails pre-push on a `_scoped` fn that
authenticates without authorizing) and **the class-hunt method itself**, which
has now paid three times (BRIDGE-5, BRIDGE-7, BRIDGE-10) and is the
recommendation for the next pass.





---

## 1. kasirmu-crypto — reviewed 24-09-26

`src/lib.rs` (455) + `src/lib_tests.rs` (340), read in full.

**Verified:** `cargo test -p kasirmu-crypto` → 21 passed, 0 failed.
`cargo clippy -p kasirmu-crypto --all-targets -- -D warnings` → exit 0.

**Good:** real domain separation across nine `oz-pos.*.v1:` prefixes; the
tamper-vs-legacy distinction is genuine (`looks_like_ciphertext` gates the
plaintext passthrough, so a corrupted ciphertext fails closed rather than being
returned as the secret — this is the old CRY-2 finding, actually repaired);
branch-tolerant reads are coherent (writes stay single-derivation, so bytes on
disk do not move); the single `.expect()` in `hmac_key` is a true RFC 2104
invariant.

| ID | Sev | Location | Finding |
|---|---|---|---|
| CRY-A | INFO | `src/lib.rs:231,242` | `encrypt_smtp_password` / `decrypt_smtp_password` have no caller outside `lib_tests.rs`. Already recorded as dead at `docs/operations/runbook.md:1114` and `crates/kasirmu-cli/src/commands/credential_deltas.rs:482`. Left in place: they are public API of a published-shape crate and the dead-ness is already documented. |

**Retracted before recording — do not re-raise.** An initial reading held that
`decrypt_smtp_at_rest` silently returns sub-28-byte truncated ciphertext as the
password, contradicting its doc. Re-read shows the doc at `src/lib.rs:272-276`
already states exactly this ("values that are not valid base64 **or shorter than
our nonce+tag minimum** are treated as legacy plaintext"). The "corrupted,
truncated" wording I had quoted belongs to `decrypt_profile_field` at `:365`,
which has no passthrough at all and is therefore accurate. The behaviour is
intended legacy compatibility, documented, and pinned by
`platform/core/src/settings/tests.rs:1677`. No defect.

---

## 2. kasirmu-logging — reviewed 24-09-26

All six modules and all five test files, read in full.

**Verified:** `cargo test -p kasirmu-logging` → 43 passed, 0 failed; 2 doctests
pass. `cargo clippy -p kasirmu-logging --all-targets -- -D warnings` → exit 0.

**Good:** the L-1 guard-retention fix is correct and tested behaviourally (the
regression case logs *after* init returns and asserts the marker reaches the
file, not merely that a guard sits in a `Vec`); `filter_for` genuinely
separates "RUST_LOG unset" from "RUST_LOG unparseable"; `facility_code` is pure
and split from the FFI so the mapping is testable without `openlog`; both
`unsafe` sites are minimal, with `CString::new` rejecting interior NULs and
`syslog` using a `"%s"` format literal so the message cannot be read as a
format string.

| ID | Sev | Location | Finding |
|---|---|---|---|
| LOG-1 | INFO | `src/error.rs:17` | `LoggingError::OpenFile` is dead — never constructed outside its own tests, and no init path opens a log file itself (`tracing_appender::rolling::hourly` does). The variant advertises a guarantee this crate cannot deliver. |
| LOG-2 | MEDIUM | `src/lib.rs:225-258` | `try_init_with_file` cannot report a file-write failure. `try_init` returns `Err` only when the global subscriber is already set, so an unwritable path yields a non-blocking writer whose writes are dropped and `Ok(())` to the caller. **Verified only by reading** — I could not construct the failing path in this session; the *positive* half was probed and confirmed (the appender auto-creates a missing directory and writes successfully). |
| LOG-3 | INFO | `src/eventlog.rs:43-46` | `init_eventlog` documents `# Errors: Returns LoggingError::InvalidLevel if the Event Log source cannot be registered`, but it never registers a source and never returns that error. (`init_syslog`'s `# Errors` is accurate — it does validate facility and NUL.) |

**Context that lowers the urgency of all three:** the file, syslog and eventlog
sinks are inert — no caller outside the crate, and `kasirmu-cli` installs no
subscriber at all. Already documented at `docs/guides/product/ROADMAP.md:236-254`,
`manager-codebase-review.md:450` and `docs/operations/runbook.md:766`. LOG-1..3
are therefore documentation debt on unreachable code.

**Hypotheses probed and dropped — do not re-raise.** (1) `MessageVisitor::record_debug`
calls `format!("{:?}", value)` for the `message` field while `record_str` does
not, which would render formatted messages quoted in syslog/eventlog but
unquoted in stdout. A temporary probe measured both paths: `"hello world"` and
`"hello 42"`, both unquoted. No defect. (2) A missing log directory fails
silently. Probed: `tracing_appender::rolling::hourly` creates the directory and
the write succeeds (`dir_exists=true, files=1`). No defect.

Both probes were run by temporarily appending a test to `src/lib_tests.rs` and
were reverted; `git status --porcelain -- crates/kasirmu-logging` was empty
afterwards.

---

## 3. kasirmu-lua — reviewed 24-09-26

`src/lib.rs` (490), `src/bridge.rs` (226), `src/error.rs` (34) and all three
test files, read in full.

**Verified:** `cargo test -p kasirmu-lua` → 65 passed, 0 failed; 1 doctest
passes. `cargo clippy -p kasirmu-lua --all-targets -- -D warnings` → exit 0.
`cargo test -p kasirmu-lua -p kasirmu-plugin` → 65 + 181 + 3 pass.

**Good:** the sandbox removes `io`/`loadfile`/`dofile`/`require`/`package`/
`debug`/`raw*`/`load` and rebuilds `os` as a fresh table holding only
`date`/`time`/`clock` (so `os.execute` is not merely shadowed but absent);
the 10 MiB memory cap and 100K-instruction hook are both installed; the
discount `percent` range is validated at the parse site so every caller shares
one contract (the LUA-2 fix is real); `LuaEventBridge` has genuine per-plugin
owner scoping (`remove_owner`/`off_for`), so one plugin cannot unsubscribe
another's callbacks.

| ID | Sev | Location | Finding |
|---|---|---|---|
| LUA-A | **HIGH** | `src/lib.rs:102-107` | `unsafe impl Sync for LuaRuntime` is **unsound**. It is justified by "used behind a `Mutex` in application state", but nothing in this crate enforces that: the type is `pub` with a `pub fn new()`, and the impl makes `Arc<LuaRuntime>` `Send + Sync`, so any holder can reach the `&self` API from many threads with no lock at all. `mlua::Lua` is `Send` but deliberately **not** `Sync` under the `send` feature (`mlua-0.9.9/src/lua.rs`: a lone `unsafe impl Send for Lua`, no `Sync` anywhere in the crate) — the whole point of withholding `Sync` is that Lua state must not be entered concurrently. **Reproduced:** a probe calling `load_str` from two threads through a shared `Arc<LuaRuntime>` crashed the test binary with `STATUS_ACCESS_VIOLATION` (0xc0000005). The crate root's `#![deny(unsafe_code)]` does not help, because the offending impl carries its own `#[allow(unsafe_code)]`. |
| LUA-B | INFO | `src/lib.rs:105,107` | **Both `unsafe impl`s are unnecessary.** Probed by deleting them and running `cargo check --workspace --all-targets` → **exit 0** (whole workspace, including `kasirmu-plugin` and both Tauri shells), then `cargo test -p kasirmu-lua -p kasirmu-plugin` → 65 + 181 pass. Every real holder is already a mutex: desktop `Arc<Mutex<Option<PluginManager>>>` and tablet `Mutex<Option<PluginManager>>` are **`tokio::sync`** mutexes, which are `Sync` for a `Send` `T`, and `PluginManager` (which owns the `LuaRuntime`) needs `Send` only — supplied by `mlua` itself. The excluded fuzz target is single-threaded. Deleting both impls is the fix that makes LUA-A unreachable rather than merely undocumented. |
| LUA-C | MEDIUM | `src/lib.rs:171-179` | The 100K instruction limit does **not** apply to coroutines. **Reproduced:** a coroutine running 200 000 loop iterations completed normally and returned 200000, while the identical loop on the main thread aborted with "script aborted: instruction limit exceeded (100K)". Lua hooks are per-thread state, and `coroutine.wrap` runs its body on a new Lua thread. The doc block at `src/lib.rs:25-26` ("scripts are aborted after 100 000 Lua instructions to prevent infinite loops") is therefore false for any script that wraps its work in a coroutine, and `coroutine` is not in the removed-globals list at `src/lib.rs:132-146`. |

**Note on LUA-C reachability.** The memory cap (10 MiB) still holds for a
coroutine and does bound the damage, so this is a CPU/denial-of-service gap
rather than an escape. It is reachable only if untrusted Lua reaches
`load_str`/`load_file`; the plugin manager loads merchant-authored files. I did
not trace the full plugin trust boundary, so I am reporting the measured
behaviour and not a claim about exploitability.

**Hypothesis probed and dropped — do not re-raise.** The asymmetry that
`parse_discount_result` range-checks `percent` (0–100) while `parse_tax_override`
does not bound `rate_bps` looks like a money bug. It is not: `rate_bps` is
validated downstream in `kasirmu-core/src/db/sales_tax.rs:136-142` against
`MAX_TAX_RATE_BPS`, returning `CoreError::Validation`, and that path is pinned by
`crates/kasirmu-core/src/db/sales_tests.rs:4809+`. This is the C13 remediation
recorded in `manager-codebase-review-checklist.md:65`. No defect.

All probes were run by temporarily appending a test to `src/lib_tests.rs` and
were reverted; `git status --porcelain -- crates/kasirmu-lua` was empty
afterwards.

---

## 4. kasirmu-media — reviewed 24-09-26

All six modules and all six test files, read in full.

**Verified:** `cargo test -p kasirmu-media` → 26 passed, 0 failed (re-run after
probe revert). `cargo clippy -p kasirmu-media --all-targets -- -D warnings` →
exit 0.

**Good:** the M-1 decompression-bomb guard is real and correctly ordered — a
header-only `ImageReader::into_dimensions` probe enforces **both** `max_side`
and `max_pixels` *before* any pixel allocation, and the two tests use shrunken
limits so no large buffers are allocated in CI. The M-2 single-decode pipeline is
genuine (`auto_crop_img`/`thumbnail_img`/`compress_img` take an in-memory
`DynamicImage`, so the frame is not re-encoded and re-decoded per stage). Crop
math is saturating, the solid-colour trim guard returns the original frame rather
than a zero-size image, and there is no `unsafe` anywhere.

| ID | Sev | Location | Finding |
|---|---|---|---|
| MED-A | MEDIUM | `src/pipeline.rs:167` | **The pipeline can never centre-crop.** `transform` hard-codes `None` as the target: `crate::crop::auto_crop_img(img, crop_mode, None)?`. `auto_crop_img` returns `InvalidDimensions` for `CenterCrop` and `Smart` when the target is `None`, so **two of the three `CropMode` variants are dead through the only production entry point** — only `TrimBorders` works. **Reproduced:** `transform(.., CropMode::CenterCrop, ..)` → `Err("invalid dimensions: CenterCrop requires a target")`; `Smart` → `Err("Smart crop requires a target")`; `TrimBorders` → `Ok`. No test covers a non-`TrimBorders` mode through the pipeline, which is why this passes CI. |
| MED-B | MEDIUM | `src/crop.rs:110-133` | **A degenerate `target` is not rejected, despite the doc saying it is.** `auto_crop`/`auto_crop_img` document `InvalidDimensions` "if the source **or target** is degenerate", but only the *source* is checked (`:79-84`). The `target.height == 0` arm at `:118` is dead for its stated purpose (float division by zero yields `inf`, not a panic) and `target.width == 0` is unguarded entirely. **Reproduced:** `auto_crop_img(img, CenterCrop, Some(ImageDimensions::new(0, 100)))` → `Ok` with a **0×300** output image. The returned frame is itself degenerate, and the doc contract is false. |
| MED-C | INFO | `src/thumbnail.rs:66-96` | Thumbnails **upscale** sources smaller than the requested box: a 10×10 source with a 512 box returns 512×512. The function-level doc is arguably consistent ("one side will match the bound exactly"), but the module doc at `:9-10` says the crate "**downscales** it", and the practical effect is that a tiny logo is blown up to 512×512 and stored at many times its original size. Behaviour is defensible as a deliberate fit-to-box; flagging because the module doc misdescribes it. |
| MED-D | INFO | `src/storage.rs:53-54` | Doc/code mismatch: the `LocalStorage` struct doc says "**construction validates the root path is non-empty**", but `LocalStorage::new` is a bare `Self { root: root.into() }` with no validation whatsoever. An empty root is accepted silently. |
| MED-E | INFO | `src/compress.rs:125-132` | `expected_ratio(target_format, quality)` discards `quality` (`let _ = quality;`) and returns a constant per format, so the parameter is dead. Callers cannot tell from the signature that quality has no effect. |

**Context.** `kasirmu-media` has **zero dependents** — no crate in the workspace
names it (`git grep kasirmu-media` over `*.toml`/`*.rs` hits only its own files
plus `deny.toml`), matching the INERT entry at `manager-codebase-review.md:452`.
The storage backends are documented PLANNED stubs returning `NotImplemented`
everywhere, and `MediaPipeline::process` ignores both `owner_key` and its
storage backend. So MED-A and MED-B are real defects in implemented code that
nothing currently calls; they will bite whoever wires this crate up.

All probes were run by temporarily appending a test to `src/pipeline_tests.rs`
and were reverted; `git status --porcelain -- crates/kasirmu-media` was empty
afterwards and the suite re-run green.

---

## 5. qris-core — reviewed 24-09-26

All 13 modules plus `tests/integration.rs`, read in full.

**Verified:** `cargo test -p qris-core --all-features` → 34 + 6 + 13 = **53
passed, 0 failed** (re-run after probe revert). `cargo clippy -p qris-core
--all-targets --all-features -- -D warnings` → exit 0.

**Good:** the TLV codec is clean, the CRC-16/CCITT implementation is textbook
(0x1021 / 0xFFFF / no reflection), `into_dynamic` validates the amount *before*
mutating, `QrisBuilder::build` rejects missing mandatory fields rather than
emitting a malformed payload, and there is no `unsafe` anywhere. The
`REAL_BANK_JATIM_STATIC_QRIS` integration fixture is a genuine
scanned-from-a-sticker ground truth, which is the right kind of test for a parser.

| ID | Sev | Location | Finding |
|---|---|---|---|
| QRIS-A | MEDIUM | `src/tlv.rs:81-89` vs `:26-68` | **Byte-vs-char length mismatch makes any non-ASCII field unparseable.** `encode_field` writes `value.len()` — the **byte** length — while `parse_tlvs` slices the value with `chars[pos..pos + len]`, i.e. **characters**. For ASCII the two agree, which is why every test passes. **Reproduced:** a merchant name containing U+2018/U+2019 serialises with length `22` (bytes) for 20 characters, and `QrisPayload::parse` on that string fails outright with `tag 00 has an invalid length field`. Indonesian merchant names are routinely non-ASCII, and `merchant_name`/`merchant_city`/`store_label`/`bill_number` are all free text, so this is a realistic input. Round-trip is broken for exactly the payloads the builder produces. |
| QRIS-B | MEDIUM | `src/tlv.rs:79-89` | **`encode_field` is a public path that panics.** It `assert!\!\`s `value.len() <= 99` and documents "`# Panics` Panics if `value.len() > 99`", but it is reached from safe, infallible-looking APIs: `QrisBuilder::build()` → `to_qris_string()` → `payload.rs:279` for `merchant_name`, and the same for `merchant_city`, `postal_code`, `guid`, `nmid`, bill/terminal labels. **Reproduced:** a 100-character merchant name makes `to_qris_string()` panic. `build()` returns `Result` and `to_qris_string` returns `String`, so no signature warns the caller. Note the docstring at `tag.rs:51` says merchant name is "up to 25 characters" — the 99 boundary is the TLV length field, not the spec limit, and neither is enforced. |
| QRIS-C | MEDIUM | `src/crc.rs:49-51` | **`crc::verify` slices by byte index and can panic on non-ASCII input.** `let split = full_payload.len() - 4; let pre_crc = &full_payload[..split];` — `len()` is bytes, and `&str` indexing panics when `split` is not a UTF-8 char boundary. `is_valid_qris` is a public, documented "quick check" and `QrisPayload::parse` calls this before any other validation, so a QR string ending in multi-byte characters panics instead of returning `false`/`Err`. **Reproduced:** `is_valid_qris("’’’’")` (four U+2019) → panic at `crc.rs:50`. This is the same root cause as QRIS-A (byte/char confusion) surfacing in a second place. |
| QRIS-D | INFO | `src/amount.rs:91-105` | `calculate_percentage_fee` performs money arithmetic in `f64` (`(base_amount as f64) * (pct / 100.0)` then `.ceil() as u64`), against the house rule that monetary values never use floats. It also accepts `pct` up to any finite value with no upper bound, and `percent_str` is parsed as `f64` so `"0.1"` is inexact. The tests only use values where f64 is exact, so the imprecision is invisible. Returns whole rupiah, so the blast radius is a rounding error of at most 1 rupiah — recorded as INFO for the convention breach, not as a live money bug. |

**Context.** `qris-core` has **zero workspace dependents** — nothing names it
outside its own files (plus `deny.toml`). It is also the only crate on a
different version line (`0.1.0` rather than the workspace `0.0.40`), which is
consistent with a vendored/upstream-style crate rather than product code. So
QRIS-A/B/C are real defects in a self-contained library that nothing in this
repo calls yet.

**Note on QRIS-A/B interaction.** Because `parse_tlvs` counts characters and
`encode_field` counts bytes, a non-ASCII field both *fails to parse* (QRIS-A)
and, if the byte length exceeds 99 while the char length does not, *panics on
encode* (QRIS-B). The two are one root cause: no single agreed unit for "length"
across the codec. A fix should pick bytes (matching the EMVCo spec, where length
is in bytes) and make `encode_field` return `Result` rather than assert.

All probes were run by temporarily appending a test to `tests/integration.rs` and
were reverted; `git status --porcelain -- crates/qris-core` was empty afterwards
and the suite re-run green.

---

## 6. kasirmu-core — reviewed 24-09-26

**Scale, stated honestly.** This crate is **53,451 production lines across 163
files** plus 72,562 lines of tests — roughly 13× the five crates reviewed before
it combined. A full line-by-line read of every file is not achievable in one
pass, so the method here is different and the coverage claim is narrower than for
crates 1–5. **Read in full:** `db/sales.rs` (tax path), `db/downgrade.rs`,
`db/terminal_overrides.rs`, `db/terminal_profiles.rs`, `db/suppliers.rs`,
`db/cart.rs`, `db/customers.rs`, `db/kds_devices.rs`, `db/receipt_code.rs`,
`db/recovery.rs`. **Swept mechanically across all 163 production files:** float
usage, inline-test placement, transaction discipline, and write-without-transaction
patterns. **Not read:** the remaining ~150 production files, including the large
`db/*` domains (products, inventory, refunds, loyalty, reports, kds, staff,
workspaces, assignments, profile, audit) and `subscription.rs`,
`license_verification.rs`, `sync_client.rs`. Findings below are what this pass
established; absence of findings elsewhere means *not yet examined*, not *clean*.

**Verified:** `cargo test -p kasirmu-core` → **3829 passed, 0 failed across 26
compile targets** (the lib target alone is 3289 tests / 225 s; the rest are
integration and doctest targets). The touched module was re-run after the probe
revert (27 passed).

### House-rule sweeps

| Rule | Result |
|---|---|
| **Money is `i64`, never float** | **Holds.** Every `f64` in production code is analytics, geometry, or a derived percentage — `popularity.rs` scoring/forecasting, `table.rs` canvas coordinates, `db/reports/*` and `db/shifts.rs` margin-percent **display** fields, `db/popularity.rs` scores. No float touches a stored monetary value. `db/loyalty.rs:29,796,936` explicitly documents removing an `f64` points path in favour of integer math. |
| **Tests in sibling `*_tests.rs`, never inline** | **One violation** — CORE-B below. 152 production files correctly use `#[cfg(test)] #[path = "..._tests.rs"]`; exactly one embeds its tests inline. |
| **DB writes inside a transaction** | **Holds**, with the single exception of CORE-A. Two write statements in one function are otherwise always inside a `transaction()`/`unchecked_transaction()` or a `SAVEPOINT`; single-statement writes are atomic in SQLite and correctly need none. |

| ID | Sev | Location | Finding |
|---|---|---|---|
| CORE-A | MEDIUM | `src/db/terminal_overrides.rs:63-84` | **`set_terminal_override` is a read-modify-write upsert with no transaction and no `ON CONFLICT`.** It runs `UPDATE … WHERE terminal_id=?1 AND feature=?2`, and only `if affected == 0` runs an `INSERT`. Two concurrent callers both see `affected == 0` and both insert, so the second gets a UNIQUE violation on the `(terminal_id, feature)` PRIMARY KEY. **Reproduced:** replaying the interleaving against the real schema yields `UNIQUE constraint failed: terminal_feature_overrides.terminal_id, terminal_feature_overrides.feature`. The fix is already used by the sibling file: `db/terminal_profiles.rs:73-79` does the same upsert with `INSERT … ON CONFLICT(terminal_id) DO UPDATE SET … excluded.…`, which is atomic in one statement. |
| CORE-C | INFO | `src/db/offline.rs:47-49` | **`cargo clippy -p kasirmu-core --all-targets -- -D warnings` fails at HEAD**, so the house rule "clippy must pass" is broken on this crate. The single warning is `clippy::needless_question_mark` on `fn enqueue_origin`: the body is `Ok(Settings::get_sync_terminal_id(conn)?)`, which is exactly `Settings::get_sync_terminal_id(conn)`. Pre-existing and unmodified (`git show HEAD:crates/kasirmu-core/src/db/offline.rs` line 48 is identical). Recorded because this review initially reported the crate as clippy-clean after running only its tests — the correction is the point. |
| CORE-B | INFO | `src/db/recovery.rs:378-532` | **The one production file that embeds its tests inline** (`#[cfg(test)] mod tests {` at `:378`, ~150 lines) instead of the mandated sibling file. This is a convention violation, **not dead or duplicate code**: the tests are real, they run, and they do not overlap with `db/recovery_tests.rs` — that sibling exists and is wired separately from `db/mod.rs:637`, covering backup-generation rotation rather than this file's restore-verification cases. Worth noting because it means `db/recovery.rs` is 532 lines of which a third is test code, pushing it toward the 600-line guidance. |

**Sweep results that were false alarms, recorded so they are not re-raised.**
(1) Ten files were flagged as "writes with no transaction" by a first pass; six
were single-statement writes (atomic in SQLite, correctly untransacted), and
`db/downgrade.rs` uses `SAVEPOINT` (`:74`), which the first regex missed — its
doc at `:50` says "single transaction" and at `:60` says "runs in a savepoint",
both accurate. (2) `crates/kasirmu-core/src/db/recovery_tests.rs` initially
looked orphaned because `recovery.rs` has no `#[path]` to it; it is in fact
wired from `db/mod.rs:637`, and the two suites test different things.

The probe was run by temporarily appending a test to
`src/db/terminal_overrides_tests.rs` and was reverted; `git status --porcelain --
crates/kasirmu-core` was empty afterwards and the module re-run green (27 passed).

---

## 7. kasirmu-security — reviewed 24-09-26

All 8 modules and all 8 test files, read in full.

**Verified:** `cargo test -p kasirmu-security` → 88 + 7 = **95 passed, 0 failed**.
`cargo clippy -p kasirmu-security --all-targets -- -D warnings` → exit 0.

**Good:** the SEC-4 staged rotation ordering is genuinely correct — park staging,
archive previous, promote, best-effort cleanup — so the only destructive write is
the final pointer swap, and a failure before step 3 leaves both the current key
and `{name}-prev` intact. `rotate_key` scrubs the raw entropy with
`key_bytes.zeroize()` and keeps the encoded form in a `Zeroizing` allocation.
The Windows FFI is careful: every `CredReadW` path frees with `CredFree`, and
the SEC-3 zero-size-blob guard avoids `from_raw_parts` on a possibly-null
pointer. `mask_token`'s eight-character tail is reasoned about explicitly
(collision probability, entropy retained) rather than picked as a round number.

| ID | Sev | Location | Finding |
|---|---|---|---|
| SEC-A | INFO | `src/mask.rs:40,85,120,150` | **`mask_pan`, `is_valid_pan`, `mask_name` and `mask_cvv` have no caller outside this crate.** Only `mask_token` is consumed (11 call sites across `desktop-tauri`, `mobile-tauri`, `kasirmu-bridge`). The crate's own doc and README both describe `mask` as owning "the masked-PAN display the cashier flow renders" and "PAN masking ... for kasir.mu" — but no PAN ever reaches the app: a search for PAN/cardholder fields outside this crate finds only an unrelated Square `CARDHOLDER_VERIFICATION_REQUIRED` status constant and a statement-descriptor doc comment. The PCI-DSS helpers are well-built and well-tested, and currently inert. |
| SEC-B | INFO | `src/lib.rs:1-5` | **Two module-doc claims do not match the code.** (1) The module doc at `:22-25` states the rotated key "is read back only to report rotation status (three functions in `crates/kasirmu-bridge/src/security.rs`)", but that file defines `default_keyring` and `with_keyring` wrappers around `key_rotation_status`/`rotate_key` — it reports *and rotates*, so "only to report" understates the surface. (2) The `InMemoryKeyring::rotate_key` implementation at `:254-283` does **not** follow the staged ordering the trait documents as the SEC-4 contract: it archives `{name}-prev` first and then overwrites `name` directly, with no staging slot. It is a single-lock in-memory map so no interleaving is possible and the behaviour is defensible — but the trait doc presents staging as the contract, and the one override that could demonstrate it does something else. |

**Known items already recorded in this crate's own audit stamps — verified present, not re-raised as new.** `SEC-1` (macOS not-found detection matches debug-string substrings, so any error code containing `-128` is misclassified as "item not found" and a real failure becomes `Ok(None)`) — confirmed at `src/macos.rs:41-50,71`. `SEC-2` (Linux `LibSecretKeyring` embeds a private tokio `Runtime` and calls `block_on` per operation, which panics if invoked from an async context) — confirmed at `src/linux.rs:30,111`. `SEC-5` (`insecure_skip_verify` is serde-visible with no guard, log, or debug gate) — confirmed at `src/tls.rs:44-45`; note `TlsConfig` itself has no consumer outside this crate, so the flag is currently unreachable in production. `SEC-6` residual (`get_secret`/`set_secret` still return `String` rather than a `SecretString`) — confirmed. `SEC-7` (`DecryptionFailed` has no producer) — confirmed: it is constructed only in `error_tests.rs`, and no consumer outside the crate maps it. `SEC-8` (`mask_name` counts bytes, not chars) — confirmed and pinned by `mask_name_byte_vs_char_caveat`. `SEC-9` (Linux `set_secret` is delete-then-create, non-atomic; the `Delete` error is swallowed with `let _ =`; `OpenSession` uses the `"plain"` algorithm) — confirmed at `src/linux.rs:148-159`.

**One nuance worth recording on SEC-1/SEC-9.** These are real defects on **platform paths that never run on this development host** (Windows). The crate's own stamp already says "source-reviewed on Windows host" for the Linux and macOS modules, which is the honest framing — they are unverified by execution here, not merely unverified by reading.

**No probe was needed for this crate.** All findings are reachability and doc/code-consistency checks confirmed by reading and by `git grep`; no test file was modified.

---

## 8. kasirmu-hal — reviewed 24-09-26

**Scale:** 5,825 production lines across 41 files, plus 3,903 test lines. All
production files read, including the 15 driver modules, 6 traits, the transport
layer, registry and bootstrap.

**Verified:** `cargo test -p kasirmu-hal` → 323 + 21 + 1 = **345 passed, 0 failed**.
`cargo clippy -p kasirmu-hal --all-targets` → **no `kasirmu-hal` diagnostics**.
(The `-D warnings` run fails, but on `kasirmu-core` — see CORE-C; HAL itself is
clean.)

**Good:** the AGENTS.md mandatory-mock rule holds crate-wide — all six traits have
programmable mocks, and `MockEdcTerminal` fails closed until explicitly armed so
an unarmed mock cannot exercise an approved-payment path on a money device. The
HAL-1 byte-vs-char fix is thorough: every pad routes through
`escpos::cell_width`, and `truncate` takes `max - 1` *characters* rather than
slicing bytes, so it is inherently boundary-safe. `registry.rs` reasons carefully
about ordering (`scanner_ids_ranked` with a documented family rank, because
`useBarcodeScanner.ts` takes element 0 and a bare COM port must not outrank a
recognised HID scanner) and about *not* auto-probing a card terminal. Stubs report
`Unsupported` rather than `NotFound` specifically so an operator is not told to
check a cable on a feature that was never written.

| ID | Sev | Location | Finding |
|---|---|---|---|
| HAL-A | INFO | `src/drivers/drawer.rs:117-134` | **`SerialCashDrawer::discover_all` is dead, and its doc describes filtering it does not perform.** The doc says it "Uses the same KNOWN_SERIAL_ADAPTERS list as the serial scanner driver to find USB-to-serial adapters", but the body calls `serial::probe_ports(false)` — and `probe_ports`'s own doc says `false` is "a raw listing ... which keeps every port the OS reports". So it would return a driver for every serial port on the machine, not just known adapters. The function has **zero callers** (`SerialCashDrawer` appears outside tests only in this file and at `registry.rs:425`, which uses `::new`, not `discover_all`). `DriverRegistry::discover` does not call it either. Dead code with a misleading contract; the doc would mislead whoever wires it. |
| HAL-B | INFO | `src/drivers/drawer.rs:143-157` | **`SerialCashDrawer::open` reports a transport failure as a Bluetooth error.** The final `map_err` maps a `spawn_blocking` join failure to `HalError::Bluetooth(...)` even though this is a serial (or USB-serial) driver — no Bluetooth is involved. The `HalErrorKind` discriminator is explicitly documented as what "UI code can branch on ... without parsing the message string" (`error.rs:18-21`), so this misroutes the one field designed to be machine-readable. |

**Known items already recorded in this crate's own stamps — verified present, not re-raised as new.** The WeightScale discovery gap (no discovery path exists; `HidWeightScale::read_weight` is a stub returning `Unsupported`, deliberately kept out of `apply_config` because registering it would turn `read_scale_weight_scoped`'s clean `Ok(None)` into a recurring `Err`) — confirmed at `scale.rs:51-67` and `bootstrap.rs:166-177`. The EDC terminals being stubs that fail closed — confirmed at `edc/wired.rs:75-108`. `bt_printer.rs` being an alias rather than a second implementation — confirmed. The `mock.rs` `expect("poisoned")` calls being confined to test doubles — confirmed, and they are the crate's only panic paths.

**Two doc/code mismatches checked and cleared.** (1) `DecimalSeparator::effective_exponent` looks dead, but it is reachable from outside the crate and is documented as the config-level API retained after formatting moved to `format_minor`. (2) The module doc at `lib.rs:14-16` lists only five traits while the crate exports six (`EdcTerminal` is named separately at `:23-27`), so the split is intentional, not an omission.

**No probe was needed.** Findings are reachability and doc/code-consistency checks confirmed by reading and `git grep`; no test file was modified and `git status --porcelain -- crates/kasirmu-hal` is empty.

---

## 9. kasirmu-reporting — reviewed 24-09-26

All 6 production modules (677 lines) and all 6 test files, read in full.

**Verified:** `cargo test -p kasirmu-reporting --all-features` → **80 passed, 0
failed**. `cargo clippy -p kasirmu-reporting --all-targets --all-features` → no
`kasirmu-reporting` diagnostics (the only warning in the run is `kasirmu-core`'s,
CORE-C).

**Good:** every query is parameterized, all money stays in integer minor units,
`margin.rs` documents its cost semantics precisely (cost snapshotted into
`sale_lines.cost_minor` at checkout so later product edits never restate history),
`margin_percent` guards division by zero, and the `DATE(s.created_at)` window
queries are already recorded as a known non-sargable perf note.

| ID | Sev | Location | Finding |
|---|---|---|---|
| REP-A | MEDIUM | `src/daily_summary.rs:160`, `src/menu_engineering.rs:98` | **Deleting a product silently erases its historical sales from two of four reports.** Both `query_top_products` and `query_menu_engineering` use an **INNER** `JOIN products p ON sl.sku = p.sku`, while `sale_lines.sku` is plain `TEXT` with **no foreign key** to `products` (`20260813_init.sql:583`) and `Store::delete_product` is a hard `DELETE FROM products` (`products_crud.rs`). So removing a discontinued item drops its past sales out of the product leaderboard and the menu-engineering matrix. **Reproduced:** after `delete_product("SKU-GONE")` on a store with one completed 3×1000 sale, `query_top_products` returns **0 rows** and `query_menu_engineering` returns **0 rows**, while the very same sale line still comes back from `margin::query_sale_lines_with_margin` (which uses `LEFT JOIN` + `COALESCE(p.name, sl.sku)`) and `query_daily_summary` still reports the full revenue. The inconsistency is the finding: one module was built to tolerate a missing product and two were not. |
| REP-B | INFO | `src/menu_engineering.rs:151` | **The merge keeps an arbitrary unit price, and its comment says otherwise.** `merge_same_product_rows` folds rows for one product sold at different prices and keeps the first-seen `unit_price_minor`/`unit_cost_minor` with the comment "Keep the first unit price/cost (most common / representative)". It is neither: the rows arrive ordered by revenue descending, so "first" is simply the highest-revenue price point. The pre-existing R-1 stamp records this as INFO; confirmed and the comment's justification is what is wrong. |
| REP-C | INFO | `src/lib.rs:15-16` | The module doc still says "This crate is a scaffold — reports are added once the cart, sale, payment, and inventory tables stabilize", but the crate ships four working query surfaces (`query_daily_summary`, `query_sales_by_hour`, `query_top_products`, `query_menu_engineering`) plus margin reporting. Stale status line. |

**Note on REP-A's blast radius.** The reporting queries themselves are correct for
a live catalogue; the defect is the join tolerance, and it is reachable through
ordinary product management rather than any edge case. Whether a deleted product
*should* retain report presence is a product decision — the crate already answers
it in `margin.rs` (keep the line, fall back to the SKU for the name), so the
cheapest consistent fix is to make the other two agree with it rather than to add
FKs.

The probe was run by temporarily appending a test to
`src/daily_summary_tests.rs` and was reverted; `git status --porcelain --
crates/kasirmu-reporting` was empty afterwards and the suite re-run green (80
passed).

---

## 10. kasirmu-notification — reviewed 24-09-26

All 5 production modules (995 lines) and all 5 test files, read in full.

**Verified:** `cargo test -p kasirmu-notification --all-features` → **33 passed, 0
failed** (the 3 "ignored" are the `ignore`-fenced doc examples). `cargo clippy -p
kasirmu-notification --all-targets --all-features` → no `kasirmu-notification`
diagnostics.

**Good:** webhook verification is correct HMAC-SHA256 with a constant-time
`verify_slice`, and it **fails closed** — no app secret configured is a `Config`
error, never a silent `Ok(true)`. The COR-31 bounded HTTP client is real (10 s
connect / 30 s total) and, importantly, does **not** silently fall back to an
unbounded client on builder failure — it logs loudly. The N-1 currency fix carries
a real `currency_code`/`amount_1000` instead of a hardcoded IDR/0 stub, and N-2
honours the `Retry-After` header by capturing it *before* the body consumes the
response. Every handler spawns onto `tokio` so the synchronous event bus is never
blocked on network I/O.

| ID | Sev | Location | Finding |
|---|---|---|---|
| NOT-A | INFO | `src/handlers.rs:46-50` | **`OrderConfirmationHandler`'s doc describes a lookup that does not exist.** It states: "If the sale has a `customer_id`, the handler looks it up via a phone number resolver. Otherwise it uses the `store_phone` fallback or skips." There is no resolver and `customer_id` is never read — the handler uses `store_phone` only. The wiring confirms it: `platform/startup/src/lib.rs:204` passes `WHATSAPP_STORE_PHONE`, so every order confirmation goes to the store, not the customer. |
| NOT-B | INFO | `platform/startup/src/lib.rs:213,222` | **Two of three handlers fall back to a placeholder phone number instead of skipping.** `PaymentReceiptHandler` defaults `WHATSAPP_RECEIPT_PHONE` to the literal `+15550000000`, and `StockLowAlertHandler` does the same for `WHATSAPP_MANAGER_PHONE`. With the feature enabled but those env vars unset, the app builds messages addressed to a hard-coded dummy US number and attempts to send them. `OrderConfirmationHandler` gets this right — its `store_phone` is an `Option`, and it warns and returns `Ok(())` when absent. The inconsistency is the finding: one handler fails closed, two fail open to a fake destination. |
| NOT-C | INFO | `src/whatsapp.rs:158-166` | **`parse_response` reads a field that is probably not in the response it parses, and has zero test coverage.** It sets `accepted` from `body["messages"][0]["message_status"]`. **UNVERIFIED — flagged as such:** I could not confirm the Meta Cloud API success shape in this session (web search is unavailable; its endpoint returned an auth error), so I am not asserting the field is absent. What *is* verifiable is that `parse_response` is reachable only through the two live HTTP paths (`whatsapp.rs:253,301`) and is referenced by no test — so if `message_status` is absent from a real success body, `accepted` is silently `false` on every successful send and nothing would catch it. The correct next step is to capture one real success body as a fixture, not to change the code on suspicion. |
| NOT-D | INFO | `platform/startup/Cargo.toml:57` | **The whole notification surface is inert.** `whatsapp-notifications` is declared only in `platform/startup` (no other crate names it), that crate's `default = []`, and neither `apps/desktop-tauri` nor `apps/mobile-tauri` enables it — both depend on `platform-startup` with no features. Matches the INERT entry at `manager-codebase-review.md:454`. |

**On NOT-C, stated plainly.** This is the one place in this review where I would
have used an external source and could not. The finding is recorded as a *coverage*
gap with a named verification step, not as a defect claim — the code may well be
correct.

**No probe was needed.** Findings are reachability, doc/code-consistency and
feature-gate checks confirmed by reading and `git grep`; no test file was modified
and `git status --porcelain -- crates/kasirmu-notification` is empty.

---

## 11. kasirmu-payment — reviewed 24-09-26

All 13 production modules (2,766 lines) and all 12 test files, read in full.

**Verified:** `cargo test -p kasirmu-payment --all-features` → **266 passed, 0
failed across 9 targets**. `cargo clippy -p kasirmu-payment --all-targets
--all-features` → no `kasirmu-payment` diagnostics.

**Good:** the crate doc is unusually honest — it states outright that nothing in
either Tauri app constructs a `PaymentRequest` yet, and explains *why* that
matters for severity grading, which is exactly the note that stops a latent defect
being read as a live money-path outage. The PAY-2/PAY-3/PAY-4/PAY-5 and COR-31
remediations are real and well-reasoned: `idempotency_key_for` refuses to send a
blank key (a shared `Some("")` would make Stripe reject every charge after the
first), `classify_stripe_error` replaced a `message.contains("card")` heuristic
with a code table, Square's `autocomplete: false` keeps authorize two-phase, and
QRIS's PAY-1 amount parser now hard-errors on sub-Rupiah fractions instead of
`unwrap_or(0)`. Webhook and Paddle are stubs that fail closed.

| ID | Sev | Location | Finding |
|---|---|---|---|
| PAY-A | MEDIUM | `src/drivers/stripe.rs:438-471` | **The Stripe refund path skips the blank-key guard its own charge path documents at length.** `authorize` routes through `idempotency_key_for` (`:242-249`), which maps an absent *or blank* key to `None` and whose comment explains the stakes: "Blank must not be sent: `Some("")` would put every caller who leaves the field empty into one shared key, and Stripe would reject each charge after the first as a conflict — turning the double-charge guard into a way to refuse legitimate payments." `refund` (`:456`) passes the caller's `idempotency_key` **straight through** with no such check. **Reproduced with wiremock:** `refund(.., Some("   "))` sends `Idempotency-Key: ""`, while `authorize(.., idempotency_key: Some("   "))` correctly sends **no** header. The same bug class the charge path closed, still open one method away. Square's refund (`square.rs:439-442`) and QRIS's refund (`qris.rs:689-692`) both *do* blank-check, so Stripe is the odd one out of three. |
| PAY-B | INFO | `src/lib.rs:23-38` | The module doc's wiring warning is accurate but easy to outlive: it correctly records that no client calls `authorize` today, which is what keeps PAY-A prospective rather than live. Worth re-reading (and the doc updating) the moment a client wires a gateway, because several findings here — including PAY-A — become live on that day. |
| PAY-C | INFO | `src/drivers/qris.rs:1-9` | The QRIS file stamp carries **three stacked "fixed" blocks** (25-07 P1, 25-07 P2, 09-09, 09-14) above a findings line that still leads with the pre-fix PAY-1/PAY-2/PAY-3 severity text. The fixes are real and in the code; the header reads as though they were not. Cosmetic, but this is the file a reader consults to judge whether a QRIS amount bug is open. |

**Two pre-existing issues verified present, not re-raised as new.** (1) The
`ResilientProcessor` retry loop retries `refund` on `Transient` errors (`resilience.rs:229-237`,
`refund`'s `ErrorClass` for `Timeout`/`Network` is `Transient`), so a refund that
times out and succeeds server-side can be submitted twice — this is the
documented reason the trait doc says callers "MUST supply a unique key per
distinct refund operation", and it is why PAY-A matters. (2) `PaymentError::Network`
is used for genuinely terminal conditions (`classify_stripe_error` maps
`authentication_error`, `invalid_request_error` and `api_error` to `Network` at
`:327-331`), which `classify()` then labels `Transient` — so a bad API key is
retried and can trip the breaker. Both are recorded in the crate's own stamps as
known.

**Unverified in this session.** The gateway wire contracts (Stripe's `idempotency_error`
shape, Square's error-code list, Midtrans's `status_code` strings) could not be
checked against vendor documentation — web search is unavailable here (its endpoint
returned an auth error). Findings above rest on in-repo evidence only; PAY-A is
reproduced locally and does not depend on an external source.

The probe was run by temporarily appending a `wiremock` test to
`src/drivers/stripe_tests.rs` and was reverted; `git status --porcelain --
crates/kasirmu-payment` was empty afterwards and the suite re-run green (266 passed).

---

## 12. kasirmu-plugin — reviewed 24-09-26

All 7 production modules (1,832 lines) and all 7 test files, read in full.

**Verified:** `cargo test -p kasirmu-plugin --all-features` → **183 passed, 0
failed**. `cargo clippy -p kasirmu-plugin --all-targets --all-features` → no
`kasirmu-plugin` diagnostics.

**Good:** `manifest.rs` is genuinely careful — `deny_unknown_fields` on every
section so a typo fails loudly, a typed kebab-case `Permission` enum with a
fail-closed `permission_from_str`, strict SemVer, and the C2 decision to **reject**
a plugin that declares `allow_network`/`allow_filesystem`/`allow_http` because the
host cannot honour them (accepting them would imply a protection that does not
exist). `loader.rs` PLG-02 is sound: structural rejection of absolute/drive/UNC/
`..` *and* a canonical-containment check that defeats symlink escape. `package.rs`
PLG-01/PLG-06 are real defenses (entry-name sanitisation, entry-count/compressed/
uncompressed/total caps, a 100x ratio cap, and a take(cap+1) read so a lying
central directory cannot overrun).

| ID | Sev | Location | Finding |
|---|---|---|---|
| PLG-A | **HIGH** | `src/db.rs:174-194, 322-409` | **The plugin SQL namespace validator is bypassable with an SQL comment, so a plugin can read and write core tables.** Every extraction regex anchors the table name with whitespace (FROM_PATTERN is `(?i)\bFROM\s+([A-Za-z_]…)`, and JOIN, INTO, UPDATE, TABLE, INSERT INTO, DELETE FROM, DROP TABLE have the same shape). A comment between the keyword and the identifier is legal SQLite and matches none of them, so **zero** tables are extracted, the prefix loop at `:245-252` has nothing to reject, and `validate_sql` returns `Ok`. PLG-11 closed the *quoted-identifier* bypass (double-quote, backtick, square-bracket forms) but not this one, which needs no quoting at all. **Reproduced:** `DELETE FROM sales` is correctly rejected, while `DELETE FROM/**/sales`, a line-comment variant, `CREATE TABLE/**/sales (id INT)`, `UPDATE/**/users SET x=1`, `INSERT INTO/**/products VALUES (1)` and `JOIN/**/sales` **all pass validation** (7/7 comment cases bypassed). `PluginDb::exec`, `query` and `execute` all funnel through this one function, so the whole isolation boundary falls together. |
| PLG-B | INFO | `src/db.rs:305-311` | `contains_word` recompiles a fresh `Regex` on every call and **swallows a compile failure as `false`** (`unwrap_or(false)`). The pattern is a word-boundary match over `regex::escape`d input, so it cannot realistically fail — but `false` means "keyword absent", i.e. the fail-open direction on a security check, and it contradicts the deliberate RUST-07 panic-invariant stance taken by its sibling `sql_regex` a few lines above. That comment is about a compile-time constant; this one is built per call, which is how the two ended up inconsistent. |
| PLG-C | INFO | `src/db.rs:214, 240-241` | `validate_sql` is a **denylist plus identifier extraction**, and the blocked-keyword list (ATTACH, VACUUM, REINDEX, CREATE TRIGGER/VIEW/INDEX/VIRTUAL TABLE, …) is matched against the whole statement *including string literals* — so a plugin writing the word "attach" inside a quoted value is refused. The stamp already records the right long-term answer (`sqlite3_set_authorizer`, which enforces policy at the engine rather than by text matching); PLG-A is a concrete reason to prefer it, since an authorizer is immune to comment and whitespace games. |

**Why PLG-A matters even though the plugin runtime is not the money path.** The
module's entire stated purpose is that "plugins cannot accidentally or maliciously
modify core tables (e.g. sales, users, products)" (`db.rs:8-12`). The bypass is one
comment away from any plugin, and plugin scripts are the one Lua surface the host
loads from disk. Severity caveat: I did not trace whether a plugin is ever handed a
`PluginDb` backed by the **main** store connection in production — `PluginDb::new`
accepts any `Connection`, so impact depends on that wiring, which is outside this
crate.

**Also noted, not a finding.** `PluginDb` holds a `rusqlite::Connection` behind
`Arc<Mutex<_>>` but issues **no transactions** of its own (`exec`/`execute` are
single statements or `execute_batch`, which SQLite runs implicitly per statement).
That is consistent with the house rule as written for single statements, and a
plugin script cannot currently compose a multi-statement unit anyway.

The probe was run by temporarily appending a test to `src/db_tests.rs` and was
reverted; `git status --porcelain -- crates/kasirmu-plugin` was empty afterwards
and the suite re-run green (183 passed).

---

## 13. kasirmu-lan — reviewed 24-09-26

All 4 production modules (1,697 lines) and all 4 test files, read in full.

**Verified:** `cargo test -p kasirmu-lan --all-features` → **74 passed, 0
failed**. `cargo clippy -p kasirmu-lan --all-targets --all-features` → no
`kasirmu-lan` diagnostics.

**Good:** the DC-1 fix is real work, not a comment — `noise-psk-v1` runs
`Noise_XXpsk3_25519_ChaChaPoly_SHA256` via `snow` with the PSK mixed into
message 3 so it never crosses the wire, the responder static key is derived
domain-separated from the PSK, and the first-byte transport selector keeps
legacy clients working. Every handshake step is bounded by a timeout, and the
whole handshake runs **inside the spawned task**, so a slow peer cannot block the
accept loop. The replay buffer is bounded twice (1,024/queue, 8,192 total,
drop-oldest with a warn) and device-keyed so a reconnecting tablet's queue is
actually findable. The connection-level `BufReader` fix is correct and the
comment explaining why a transient reader loses pipelined bytes is the kind of
note that stops the bug being reintroduced.

| ID | Sev | Location | Finding |
|---|---|---|---|
| LAN-A | INFO | `src/lib.rs:1-6` (stamp) vs `apps/desktop-tauri/src/lib.rs:756-764` | **"PSK required for external bind" is enforced by the caller with an exact-string match, not by this crate.** The crate stamp claims "safe 127.0.0.1 default with PSK required for external bind", but `LanEventForwarder::new(bind_addr, psk)` accepts any address with `psk = None` and simply skips phase 0 (`lib.rs:572-574`), serving every event in cleartext. The only guard is `if bind == "0.0.0.0" && psk.is_none()` in the desktop app, which falls back to loopback. Any other external bind spelling — `"0.0.0.0:9180"`, `"::"`, a LAN IP, `"localhost"` resolving off-box — would not match and would open an unauthenticated cleartext event stream. **Reachability, stated honestly:** I could not find a production writer that can set `lan_server.bind` to anything — the generic desktop/tablet funnels refuse the `lan_server.` prefix as manager-owned (`platform/core/src/settings/raw.rs:710-736`), `.kasirpkg` import refuses it (pinned by `kasirpkg_import_refuses_machine_id_secret_and_manager_rows`), and there is no LAN settings UI (`git grep` over `ui/src` finds none). So this is a **latent** hazard, not a live exposure — but the doc comment at `platform/core/src/settings/keys.rs:174` already anticipates a dedicated control ("Required when `lan_server.bind` is `0.0.0.0`"), and the moment one lands with any other external-bind value the guard is bypassed. The durable fix is for `kasirmu-lan` to refuse to serve an unauthenticated bind it cannot verify is loopback, rather than trusting the caller's string comparison. |

**Design note, not a finding.** `psk_matches` hashes both inputs under a fixed
HMAC key and compares digests with `verify_slice`. That is a correct
constant-time-comparison technique, though for a value already in memory a direct
constant-time byte compare would be simpler; the doc explains the choice and the
timing rationale is sound.

**No probe was needed.** Findings are reachability and enforcement-boundary checks
confirmed by reading and `git grep`; no test file was modified and
`git status --porcelain -- crates/kasirmu-lan` is empty.

---

## 14. kasirmu-cli — reviewed 24-09-26

All 16 production modules (3,507 lines) and the test files, read in full.

**Verified:** `cargo test -p kasirmu-cli --all-features` → **134 passed, 0
failed across 4 targets**. `cargo clippy -p kasirmu-cli --all-targets
--all-features` → no `kasirmu-cli` diagnostics.

**Good:** the CLI-1..CLI-5 remediations are all real and in the code — the
tx-aware `create_sale_in_tx` inside the import transaction, a genuine argon2 hash
for the seeded admin PIN with a change-it-now warning, PHC-format validation on
`--pin-hash`, WAL checkpoint plus sidecar deletion before a restore, and the
1,290-line `commands.rs` split into per-family modules. `stock_variance.rs` is
exemplary operator-facing design: it refuses a `--db` path it would have to
create (because a report over a freshly created empty file "is not a clean
database — it is a lie about one"), and `bound_note` states plainly when a
report was CAPPED, which is the one failure mode a reconciliation report must not
have. `open_store_for_credential_deltas` / `open_store_for_stock_variance` are
deliberately scoped to their two subcommands so `migrate`/`init-db`/`restore` keep
provisioning on first run.

| ID | Sev | Location | Finding |
|---|---|---|---|
| CLI-A | INFO | `src/commands/kasirpkg.rs:475` | **A failed settings write during import is silently discarded and still counted.** The settings loop does `let _ = Settings::set(&tx, key, value);` and then unconditionally `total += 1`, so a write that fails reports as an imported record and the operator sees "import complete — N records written" with no error. Every other data type in the same function propagates with `?`, and the file's own header comment insists refused rows "write NOTHING" — a row the policy *admits* but whose write then fails is neither refused nor reported. The `let _ =` is the only discarded result in this crate's production code (`git grep 'let _ = '` over `src/` finds it and one benign `let _ = &args` in `seed_demo.rs`). |

**Pre-existing items verified present, not re-raised.** The `--db` footgun that
`Connection::open` creates a missing path is already guarded for the two commands
where a created file would produce a *misleading* answer, and the guards' comments
explain why the shared `open_db` is deliberately left alone. The import's
`if let Ok(...)` per-row deserialisation silently skips malformed rows rather than
failing the batch — consistent with the warn-and-continue ingest policy the file
documents, and it counts only rows that parsed.

**No probe was needed.** Findings are code-reading and `git grep` checks; no test
file was modified and `git status --porcelain -- crates/kasirmu-cli` is empty.

---

## 15. kasirmu-api — reviewed 24-09-26

**Scale:** 8,981 production lines across 23 files (plus 8,166 test lines).
`pg.rs` alone is 2,760 lines. **Read in full:** `lib.rs`, `auth.rs`,
`read_tiers.rs`, `api_audit.rs`, `routes/{tokens,settings,terminals,plans,memos}.rs`.
**Swept across all 23:** the router-vs-`READ_KEY_MAP` comparison and the
public/protected route split. **Not read line-by-line:** `pg.rs` (2,760),
`spec/{paths,schemas}.rs`, and the remaining route modules (`products`,
`sales`, `images`, `tax_rates`, `exchange_rates`, `users`, `categories`,
`health`). Findings below are what this pass established; elsewhere means *not
yet examined*, not *clean*.

**Verified:** `cargo test -p kasirmu-api --all-features` → **330 passed, 0
failed**. `cargo clippy -p kasirmu-api --all-targets --all-features` → no
`kasirmu-api` diagnostics.

**Good:** the API-1 production-secret gate is correct and refuses to boot
(`OZ_PRODUCTION=1` without `OZ_API_SECRET`/`OZ_ADMIN_KEY` is a startup error, so
the hard-coded dev JWT secret is unreachable in production). The JWT cache key
includes the resolved secret, so a process holding two secrets cannot cross-serve
a cached validation. `Validation::default()` plus explicit `validate_exp` is
HS256-only, closing algorithm confusion. Admin-key comparison is constant-time via
HMAC digests. The 401 taxonomy (`token_expired`/`invalid_token`/`missing_token`)
with `WWW-Authenticate: Bearer` is the right shape for a client that must
distinguish "refresh" from "misconfigured". I verified that all four
admin-key-gated routes placed on the **public** router (`tokens`, `terminals`,
`plans` PUT, `settings` GET+PUT) do gate themselves through `admin_key_authorised`
— the public placement is a real trap that is currently avoided.

| ID | Sev | Location | Finding |
|---|---|---|---|
| API-A | MEDIUM | `src/read_tiers.rs:42-115` vs `src/lib.rs:357-364` | **`GET /api/v1/memos/active` is absent from `READ_KEY_MAP`, so a read-scoped token can call it with no permission check.** The route is registered on the protected router (`lib.rs:361-364`) and requires a valid JWT, but the read-gate treats any path not in the map as "sync, public, or write" and **passes it through** (`read_tiers.rs:229-232`). A token minted with the `terminal` preset (products/categories/reference/plan only) therefore reaches the memos endpoint, which returns active memos for a caller-named `?terminal_id=` within the tenant. The handler's own comment confirms the access model it relies on — "An admin-minted token … may query ANY terminal's active memos via `?terminal_id=`" — which is a deliberate choice for admin tokens but not something a narrow preset should inherit. **Verified by reading**, not by running: the gap is a missing map entry, and `READ_KEY_MAP` has no `memos` entry at all. |
| API-B | MEDIUM | `src/read_tiers_tests.rs` (`read_key_map_covers_all_protected_get_routes`) | **The test that exists to catch API-A cannot catch it.** It is named `read_key_map_covers_all_protected_get_routes` and its comment says "Every image + product + reference GET route in the router must have a read-key entry", but the body asserts that a **hand-written `expected_paths` array** is present in `READ_KEY_MAP` — it never consults the router. Adding a route to `lib.rs` without adding it here changes nothing, which is exactly how `/api/v1/memos/active` came to be missing while the suite stayed green. A real guard would build the router and enumerate its routes (or parse `lib.rs`), so the test fails when the two drift. This is the same defect class the repo already names elsewhere: "every test in this repository checks the mechanism; none checks the attachment." |

**Note on the blast radius.** API-A is bounded by the JWT requirement and by
`tenant_id` coming from claims rather than the query, so it is a
least-privilege widening rather than an unauthenticated hole: a legacy token
(`permissions: None`) already reads everything by design, and an admin token is
meant to reach this route. The affected population is exactly the tokens the tier
system was built to narrow.

**No probe was needed.** Both findings are structural (a missing map entry and a
test that does not read its own subject), confirmed by reading the route table and
the map side by side; no test file was modified and `git status --porcelain --
crates/kasirmu-api` is empty.

---

## 16. kasirmu-local-api — reviewed 24-09-26

The whole crate is one 546-line `src/lib.rs` plus its test file — read in full.

**Verified:** `cargo test -p kasirmu-local-api --all-features` → **18 passed, 0
failed**. `cargo clippy -p kasirmu-local-api --all-targets --all-features` →
**1 warning (its own, LAPI-A)**; the `-D warnings` run fails on that plus
`kasirmu-core`'s CORE-C.

**Good:** this is the most carefully-reasoned small crate in the sweep. Two
boundary guards each carry a full argument for their existence:
`reject_foreign_tenant_writes` (C34) explains the brick-the-install hazard — the
shared write routes stamp the request's tenant claim, and a non-default claim
would make the *next launch* fail `check_tenant_integrity` — and correctly gates
writes only, since a read cannot plant the row. `mark_single_tenant` (C39) closes
the other half at the mint. The guard admits exactly two tenant values (`None` and
`"default"`) rather than "not empty", with the reasoning that `Some("")` would
stamp `tenant_id = ''`, which the boot check rejects identically. The per-install
secret is 32 CSPRNG bytes (replacing a two-UUIDv7 construction whose timestamps
added structure without entropy), it is on `SECRET_KEY_DENY_LIST`, and
`local_api.*` is refused on every bulk lane — verified in `kasirmu-cli`,
`kasirmu-bridge` and `platform-core`. `bearer_claims` takes `HeaderMap` rather than
`Request` with an explicit note that `Body` is not `Sync` and would make the future
`!Send` — a real async-correctness detail most code misses. CORS is an empty
allowlist (fail-closed), the admin key and signing secret are the same value, and
terminal client-credentials are disabled on this surface.

| ID | Sev | Location | Finding |
|---|---|---|---|
| LAPI-A | INFO | `src/lib.rs:182-185` | **`cargo clippy -p kasirmu-local-api --all-targets --all-features -- -D warnings` fails on this crate's own code.** `clippy::doc_lazy_continuation` at `:185` — the doc comment on `bearer_claims` wraps to a line beginning with `- it never turns a rejection into a different rejection, only adds one of` followed by `/// its own.`, which clippy reads as a lazily-continued list item. Trivial to fix (indent the continuation), but it means the house rule "clippy must pass" is broken here as well as in `kasirmu-core` (CORE-C). |

**On the C34/C39 guards, one thing worth recording.** They are correct as
written, and the reasoning is unusually complete. The residual I would flag for a
future pass is that both are *additive* boundary layers applied **outside** the
router (`lib.rs:441-456`), which is the right place given the router is shared with
the cloud server — but it also means the protection lives in this crate while the
routes it protects live in `kasirmu-api`. If the shared router gains another tenant-
stamping write route, the guard still covers it (it keys on the method and the
claim, not the path), which is exactly why it was written that way.

**No probe was needed.** Findings are a clippy run and code reading; no test file
was modified and `git status --porcelain -- crates/kasirmu-local-api` is empty.

---

## 17. kasirmu-bridge — reviewed 24-09-26

**Scale, stated honestly.** 33,289 production lines across 70 files (plus 34,075
test lines) — the largest crate in the sweep, and larger than `kasirmu-core`.
**Read in full:** `lib.rs`, `ctx.rs` (597), `topology/revisions.rs`. **Swept
mechanically across all 70 production files:** `unwrap`/`expect`, float usage, and
transaction discipline. **Not read line-by-line:** the remaining ~66 modules
(`pos.rs` 2,149, `staff.rs` 1,607, `auth.rs` 1,363, `settings.rs` 1,336,
`data.rs` 1,188, `topology/commands.rs` 1,117, and the rest). Findings below are
what this pass established; elsewhere means *not yet examined*, not *clean*.

**Verified:** `cargo test -p kasirmu-bridge --all-features` → **1384 passed, 0
failed**. `cargo clippy -p kasirmu-bridge --all-targets --all-features` → no
`kasirmu-bridge` diagnostics.

### House-rule sweeps

| Rule | Result |
|---|---|
| **No production `unwrap`/`expect`** | **Holds — 4 total in 33,289 lines**, and all four are justified: `picker.rs:50` is the RFC 2104 HMAC invariant; `pos.rs:175,2156` are `Percentage::new` calls the preceding lines validate to `0..=100` with a `SAFETY` comment; `audit.rs:260` is inside a doc comment, not code. |
| **Money is `i64`, never float** | **Holds.** All 13 float mentions are image-encode quality (`products_images.rs` `f32`), topology canvas geometry (`topology/model.rs` `f64` x/y with an explicit NaN/Infinity serialisation guard), or a derived `popularity_score`. No float touches a stored amount. |
| **DB writes inside a transaction** | **Holds.** One file flagged (`topology/revisions.rs`, 3 `execute` calls) and it is correct by design — `cleanup_old_topology_revisions` documents exactly why no transaction wraps its per-branch loop: the `diagram IS NOT NULL` guard makes a re-run a no-op, so a partial failure leaves work the next 300 s tick finishes, and holding the global write lock across all branches is the worse trade. The two other `execute` sites there take an explicit `&Transaction<'_>`. |

**Good.** `BridgeCtx` is a careful design: it borrows rather than holding `Arc`s so
a shell that re-assigns `db_manager` is seen by the next call, and it holds no
tauri type so the whole surface is testable headless. The session-account
revalidation window is unusually well-argued — it explains why the *first* resolve
only starts the window (a login already filtered `deleted_at`/`is_active`, so a token
cannot be born revoked), why it uses `try_lock` and not `blocking_lock` (the latter
aborts inside a tokio runtime), and why a busy DB fails **open** with a log rather
than turning a transient hiccup into a mass logout. The side map is keyed by the
identity DB's `Arc` pointer so the same token string against a different database
never inherits another window, and the test hook is a thread-local so a shortened
window cannot leak into a parallel test. Expired-token removal masks the token with
`mask_token` on the way into the log, with the bearer-credential reasoning stated.

**No findings in this pass.** That is a statement about *coverage*, not about the
crate: 66 modules of `pos`, `staff`, `auth`, `settings`, `data`, `sync`, `license`,
`inventory`, `topology` and more were not read. `kasirmu-bridge` deserves the same
second pass `kasirmu-core` does, and for the same reason — it is where the command
bodies actually live.

**No probe was needed.** Findings are three mechanical sweeps plus a full read of
the two files that define the crate's contract; no test file was modified and
`git status --porcelain -- crates/kasirmu-bridge` is empty.
