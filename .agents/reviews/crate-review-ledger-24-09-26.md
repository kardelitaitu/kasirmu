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

### Bridge sixteenth pass — 24-09-26 (I hardened my own guard, and it was evadable)

| ID | Sev | Location | Finding |
|---|---|---|---|
| BRIDGE-11 | LOW | `src/pos_tests.rs:67` — the BRIDGE-8 source pin | **The guard I added in the sixth pass could be defeated by FORMATTING ALONE, so the discount-percent defect it pins was still reintroducible with the suite green.** It tested one LINE at a time; written as a multi-line call, no single line contains both `Percentage::new(` and `discount_percent as u8`, every predicate missed, and the test passed with the truncating cast restored. **Proven by doing exactly that** and watching it pass. |

**How it was found.** The last pass's lesson was that this codebase's guards are
ahead of the audit, so this pass inverted the question: instead of hunting
defects, hunt guards that can pass by FINDING NOTHING. The named failure mode was
already in the ledger — `license_writer_literals_...` calls its own predecessor
"a decoration wearing a drift pin's name" — so the search was for a
source-derived scan with no floor assertion. `pos_tests.rs` was one, and it was
mine.

**The evasive shape is ordinary rustfmt output, not a contrived attack:**

```rust
foundation::Percentage::new(
    (args.discount_percent) as u8,
)
```

**Fixed two ways, each proven load-bearing by disabling it:**

1. **Whitespace-normalised.** The whole file is collapsed to one space-separated
   string before matching, so the scan is independent of how rustfmt wraps the
   expression. Verified: the evasive shape now FAILS the test (`pos.rs:90`).
2. **A vacuity floor.** `assert!(call_sites >= 3)` — the clamp is defined once and
   called at two doors. Verified: renaming the needle makes it FAIL with *"found 0
   - the scan is reading a file that no longer spells it, so this test would pass
   vacuously"*. Same discipline as `license_writer_literals_...`'s `>= 5`.

**A hedge worth stating.** The scan is still a source PATTERN, so an unusual
spelling could evade it — e.g. a cast through a local binding
(`let d = args.discount_percent as u8;`). The floor does not catch that, because
the helper still appears three times. It is a meaningful hardening, not a proof,
and that limit belongs next to it rather than in a claim that the class is closed.

**Verified:** `cargo test -p kasirmu-bridge --all-features --lib -- pos::` → **59
passed, 0 failed**, both new assertions green, both watched red when disabled.
Clippy clean on the file.

**Commit:** `14d1b444a` (BRIDGE-11, bridge).

**Note on the tally.** Counted as a finding even though it is my own guard rather
than shipped product code, because the CONSEQUENCE is live: an evadable pin leaves
BRIDGE-8 (a money defect) reintroducible. A guard that cannot fail is worse than
no guard, since it reads as coverage.

### Bridge seventeenth pass — 24-09-26 (the other two source pins were evadable too)

Applied the sixteenth pass's recommendation: run the same inverted question —
"can this guard pass by inspecting nothing?" — against the OTHER source-derived
pins. **Two of the three failed it.**

| ID | Sev | Location | Finding |
|---|---|---|---|
| BRIDGE-12 | LOW | `src/data_tests.rs:583` — the BRIDGE-1 pin | **Evadable by formatting, exactly like BRIDGE-11.** It tested `t.starts_with("let _ = tx.execute(")` one line at a time, so writing the discarded result as `let _ =` newline `tx.execute(` restored BRIDGE-1 IN FULL — every row-write error discarded while the counter still incremented — and the test **PASSED**. Verified by doing exactly that. Also had **no floor**, so the moment the pattern stopped matching it would have read as a clean sweep. |
| BRIDGE-13 | LOW | `src/terminals_tests.rs:110` — the BRIDGE-6 pin | **No floor, and its two `.expect()`s do not compensate.** They prove the MARKER `fn verify_binding(` was found, not that the extracted region IS the function: a body sliced short by an earlier `\n}` (a nested block) satisfies both while containing none of the code under test, and every assertion below would then pass by inspecting nothing. |

**Fixed, both proven load-bearing by disabling them.**

* `data_tests.rs` — whitespace-normalised (`split_whitespace().join(" ")`), the
  needle set widened to three spellings, and `assert!(call_sites >= 5)` so the
  scan cannot read a file that no longer spells `tx.execute(`. The evasive shape
  that defeated the old version now **FAILS** it.
* `terminals_tests.rs` — `assert!(body.len() > 200)` plus a shape check for
  `keyring`. Raising the bound to 200000 makes it fail with *"extracted only 1370
  bytes ... the scan is reading a region that no longer holds it"*; restored, it
  passes.

**One hypothesis I formed and disproved inside this pass.** My first reading was
that the BRIDGE-1 pin was ALREADY vacuous — `data.rs` contains zero literal
`let _ = tx.execute(` matches since my own sixth-pass fix. But the calls it must
watch are inside `import_data`, and reverting one site to the pre-fix form DOES
trip it (verified: `[(749, "let _ = tx.execute(")]`). The pin was live for the
reversion it was written for; what it could not see was a REFORMATTED reversion.
Recording the distinction because "the pattern finds nothing today" and "the pin
is dead" are different claims, and only the second would have justified deleting
it.

**The pattern across three passes.** Every source pin this audit has written or
inherited was shaped as a LINE-BASED TEXT SCAN, and every one of them could be
defeated by ordinary `cargo fmt` output. That is now three for three. The
recurring fix is the same two ingredients: **normalise whitespace before
matching, and assert a floor so the scan cannot pass by finding nothing.** Both
belong in the pattern for any future pin, and the licence-literal sweep in
`settings_tests.rs` already had them — it is the one that was written right, and
the one whose doc comment names the failure mode the others then repeated.

**Verified:** `cargo test -p kasirmu-bridge --all-features --lib -- data::
terminals:: pos::` → **124 passed, 0 failed**, with all three hardened assertions
green and each watched red when disabled. Clippy clean on both changed files.
`data.rs` itself is untouched — `git hash-object` equals `HEAD:` (the probes were
reverted).

**Commit:** `ef8f22f17` (BRIDGE-12/13, bridge tests).

### Bridge eighteenth pass — 24-09-26 (the shell gates could false-green too)

The seventeenth pass established the pattern "three for three" on source pins and
recommended applying it elsewhere. This pass took the obvious next step: the
SHELL gates are guards too, and neither had been audited for the same evadability.
**Both failed.**

| ID | Sev | Location | Finding |
|---|---|---|---|
| BRIDGE-14 | MEDIUM | `scripts/verify-scoped-coverage.sh:186` | **The gate could not distinguish "101 commands, all covered" from "0 commands found".** Its subject comes from grepping `lib.rs` for `commands::a::b,`. An empty derivation makes the loop run zero times, leaving `violations` at 0, and the gate prints **PASS** and exits 0. `set -e` does not save it — verified: the derivation ends in `grep -v`, which exits 0 on empty input, so nothing aborts. **Proven** by feeding it an empty subject and watching it print `PASS` with exit 0. |
| BRIDGE-15 | MEDIUM | `scripts/verify-scoped-authorization.sh:117` | **The same hole in the gate I wrote in the seventh pass.** The `find "$SRC"` subject empties if the directory moves, awk scans zero functions, `unreasoned` stays 0, and the gate exits 0. |

**Severity MEDIUM rather than LOW, and higher than the source-pin findings.**
BRIDGE-11/12/13 are pins inside a Rust test suite, where an evaded pin still
leaves the surrounding suite running. These two are Tier-0 **gates**: H-1 is the
gate that keeps every registered command paired with a `_scoped` twin, and H-1b
is the one that keeps every `_scoped` twin honest. A gate that false-greens is
worse than an absent gate, because pre-push and `check.sh` report it as
satisfied and the protections it stands for are recorded as verified.

**Fixed with the same ingredient the pins needed — a floor — and the numbers are
measured, not guessed.** `verify-scoped-coverage.sh` fails below **50** derived
commands (currently 101); `verify-scoped-authorization.sh` fails below **150**
scanned fns (currently 348). Both messages name the measured value, the source
path, and the date of measurement, so a future reader can tell a real regression
from a threshold that has gone stale. The H-1b floor exits **2**, distinct from
its "unreasoned fn" exit 1, so the two failures are not conflated.

**Proof, both directions, per gate.** Normal run: H-1 prints
`(derived 101 registered unscoped command(s))` and PASSes; H-1b prints
`scanned: 348 explained: 35 UNREASONED: 0` and exits 0. Floor raised above the
measured value: H-1 prints `FAIL: derived only 101 registered command(s) ... the
derivation is broken, so this gate would pass by checking nothing` and exits 1;
H-1b prints `FAIL: scanned only 348 _scoped fn(s) in
crates/kasirmu-bridge/src - the scan is reading nothing, so this gate would pass
vacuously` and exits 2. Both restored and re-verified green.

**The pattern, now five for five.** Every text-derived guard in this repository
that I have inspected — three Rust source pins and two shell gates — could be
defeated by a change that removes its SUBJECT rather than by one that defeats its
LOGIC, and every one of them reported success in that state. The two ingredients
that fix it are uniform: derive the subject from the real source (all five already
do), and **assert a floor so an empty subject cannot read as a clean sweep** (none
of the five did, until these passes). That second half is the whole finding, and
it is worth stating as a rule for this repo: a guard that iterates a derived set
must assert the set was non-empty, and name a measured value so the floor itself
can go stale loudly rather than silently.

**Verified:** `bash scripts/verify-scoped-coverage.sh` → PASS, exit 0.
`bash scripts/verify-scoped-authorization.sh --strict` → exit 0. Report mode →
exit 0. Both floors exercised in both directions. No source changed, so no test
suite is affected; the probe file used for the false-green demonstration was
removed (`git status` clean).

**Commit:** `ab4a48761` (BRIDGE-14/15, gates).

### Bridge nineteenth pass — 24-09-26 (the empty-subject rule is already the house standard)

The eighteenth pass recommended sweeping the floor rule across the remaining
derived-set guards. This pass did, and the sweep **disproved the premise**: the
rule was already institutionalised in this repository, in four places, before I
started applying it. **No defect found, and no code changed.**

**What the sweep found — all three Tier-0 Python gates already handle an empty
subject, by two different mechanisms, each reasoned in its own header:**

* **`verify-no-hardcoded-money-format.py`** REFUSES, with the sentence that names
  the class: *"a gate that walked nothing must not print clean, and this run walked
  none of the tree it is"* — exit 2, and a test case at `:411` that reddens it.
* **`verify-bundle-parity.py`** refuses too, via `BlankScanDirs`, and its docstring
  states the reason in the sharpest form in the repo: *"the verdict cannot tell
  'the tree is clean' from 'this run looked at nothing' once the list is empty,
  it only prints a number."* It also records the measured incident (a single space
  as `--scan-dirs` split to an empty tuple, iteration ran over nothing, and the run
  printed `scanned 0 file(s) in []` then `0 missing key(s)` and exit 0).
* **`verify-scoped-reads.py`** carries the same refusal as `NoShellsNamed`.
* **`verify-architecture-boundaries.py`** deliberately DECLINES a floor, and says
  why: its fixture tests are *"made of nothing else"*, so a floor *"would fail the
  fixture runs that are this checker's own tests, which is a different tool's fix
  and not this one's."* It closes the residual risk a different way — the green
  line carries the population it examined, so *"0 crates / 0 blockers" and "2
  crates / 0 blockers now read differently"*, and the header states the caller's
  action: read the `[population examined: ...]` clause and confirm it names the
  tree you meant.

**Verified empirically rather than by reading, and this is the part worth
recording.** All three gates print a real denominator on the green line —
`39 Rust key(s), 39 frontend key(s), 12 registration key(s) across 43 site(s)`;
`PASS (1168 production .rs file(s) ...)`; `[population examined: 39 crate(s) in the
Cargo graph, 577 dependency edge(s), 587 UI file(s), 978 file(s) below the
application layer]`. So the two shell gates I floored in the eighteenth pass were
not introducing a novel discipline — they were being brought UP TO a bar the
Python gates had already set, and several of them exceed it, because a printed
denominator is strictly more informative than a floor: a floor catches an empty
subject, a denominator lets a reader catch a WRONG one.

**The honest correction.** I described the floor rule last pass as a finding worth
propagating repo-wide. It is real for the two shell gates (BRIDGE-14/15 stand —
they had no floor, no denominator, and false-greened, which I demonstrated). But
the generalisation was wrong: the rule was not missing, it was already the house
standard, and where it is absent that absence is reasoned and compensated. The
useful version of the claim is narrower — **the shell gates lagged the Python
ones**, which is now fixed.

**Verified:** no source, test or script changed this pass. Both shell gates still
pass (`verify-scoped-coverage.sh` exit 0; `verify-scoped-authorization.sh
--strict` exit 0); the three Python gates run clean with their denominators
printed.

**No commit** beyond this ledger entry.

### Core twenty-seventh pass — 24-09-26 (refunds read in full: clean, and unusually so)

**No defect.** `db/refunds.rs` (994 lines) read end to end — the largest unread
money-path module in `kasirmu-core`. It is the strongest file this audit has
inspected, and worth recording in some detail because the reasons generalise.

**`create_refund` (460 lines) — every bound derived and argued, none asserted.**

* **IMMEDIATE, not DEFERRED** (`:69`), with the reason stated: the guard is a read
  and the refund is a write, so a deferred BEGIN losing the race fails with
  `SQLITE_BUSY_SNAPSHOT` instead of waiting out the busy_timeout. Correct hazard
  analysis, not a default.
* **THREE cumulative bounds, all read inside the transaction**, and the header
  explains why two cannot substitute for each other: the MONEY bound
  (`SUM(refunds.total_minor) <= sales.total_minor`) does not imply the QUANTITY
  bound, because a repeatedly under-priced partial refund stays inside the money
  ceiling while pushing more units back into stock than were ever deducted.
* **A per-line money RANGE, not an equality** (`:283-338`), both reasons verified
  by file:line — a price override legitimately stores `line_minor != unit * qty`,
  and the UI rounds in one place and estimates fractionally in another. The
  one-unit tolerance absorbs that; an equality would reject legitimate refunds.
  The residual it accepts is stated, and what absorbs it is named.
* **Booked value, never clamped** (`:309-317`): refuse above the ceiling, store the
  supplied figure unchanged below it, because clamping would silently rewrite a
  receipt.
* **The SKU-identity check closes a mint** (`:204-247`): both quantity bounds are
  measured against a NAMED sale line, so they are only as good as that line
  identity — refund one product line claiming another and the ceiling becomes
  units-of-any-product minted at the default location. A whitespace-only recorded
  sku REFUSES rather than falling back to the caller, with the trade stated: the
  row is the defect, not the refund.
* **`refunded_qty_for_sale_line_in_tx` excludes the refund under construction**
  (`:550-568`) because rows are inserted BEFORE the stock credit, so a bound read
  inside the credit path would count this refund twice.
* **i128, no float** (`:328-338`), with `max(1)` keeping the division infallible
  without relying on the schema CHECK.
* **Tenant copied from the SALE row**, not a literal and not a second lookup:
  `refunds.tenant_id` is RLS-covered in PostgreSQL, so a hardcoded value files a
  multi-store refund under the wrong tenant (`:351-361`).

**Prior findings confirmed fixed, not merely claimed.** The header records COR-25
(over-refund guard moved inside the transaction; was outside with `unwrap_or(0)` —
fail-OPEN on a money guard) and COR-26 (currency mismatch now rejected; the sale
currency was read then discarded). Both are present as described, at `:117-143`
and `:105-116`. Checked rather than trusting the stamp.

**A sweep for this audit own classes returned only prose.** The
float/unwrap pattern over the file yields THREE hits, all of them comments
explaining why those constructs are ABSENT — including the COR-25 note at `:118`
about `unwrap_or(0)` being indistinguishable from no-refunds-yet. Zero real
instances.

**Verified:** `cargo test -p kasirmu-core --lib -- db::refunds` → **51 passed, 0
failed**. No code changed.

**No commit** beyond this ledger entry.
### Core twenty-eighth pass — 24-09-26 (a dropped guard in the tenant-scoped sync mark)

| ID | Sev | Location | Finding |
|---|---|---|---|
| CORE-D | MEDIUM | `db/offline.rs:680` — `mark_offline_synced_for_tenant` | **The tenant-scoped mark dropped the terminal-state guard its unscoped sibling documents as necessary.** The unscoped `mark_offline_synced` is a guarded compare-and-set — `WHERE id = ?1 AND status = pending` — and its doc states why: a stale or double caller must not overwrite a dead-lettered (`failed`) row terminal state with `synced`. The tenant-scoped variant guarded only on `tenant_id`, so it DID resurrect a failed row. |

**Proven by probe, both directions.** A `failed` row with `retry_count = 3` and
`last_error = server error`:

* `mark_offline_synced_for_tenant` → `status = synced`, an invented `synced_at`
  (`2026-09-24T21:11:37.754Z`), while `retry_count` and `last_error` stayed behind
  — an internally contradictory row.
* `mark_offline_synced` on the same shape → `status = failed`, unchanged.

**Blast radius established rather than assumed, which is what fixes the severity.**
Nothing else reads `status = failed`: the dead-letter quarantine lives in
`sync_remote_failures.dead_lettered`, a DIFFERENT table, and retries are driven
from there. The one reader of the queue failed status is the observability
summary — `SUM(retry_count) WHERE status = failed` — which silently stops
counting the row. So this is a lost-SIGNAL defect, not a lost-money one: MEDIUM,
and the same hidden-failure class COR-20 forbids elsewhere in this very module.

**The finding only exists because the two variants were compared.** Reading either
alone shows nothing wrong: the unscoped one looks like ordinary defensiveness,
the tenant-scoped one like a simple tenant filter. The defect is the DIFFERENCE —
a guard one carries and its sibling does not — the same shape as BRIDGE-3/5
(credential paths), BRIDGE-7 (hardware HAL) and BRIDGE-9/10 (activation vs
renewal). **Sibling divergence is now the single most productive lens in this
audit: six findings, every one invisible to a single-site read.**

**Fixed** by adding `AND status = pending` and, because that makes `affected = 0`
ambiguous, by adopting the sibling probe-instead-of-guessing handling: a
tenant-scoped `COUNT(*)` distinguishes absent (still `NotFound`) from
present-but-not-pending (the idempotent no-op the CAS exists to produce). Without
that second half the fix would have turned a legitimate repeat call into a
spurious `NotFound` — verified, since the first attempt failed at exactly that
point before the probe was added.

**Pinned** by `tenant_scoped_mark_synced_refuses_to_resurrect_a_dead_lettered_row`,
mirroring the existing unscoped test. **Watched to FAIL** with the guard removed
(`a terminal failure must stay terminal`) and pass with it restored. The
pre-existing `tenant_scoped_mark_synced_refuses_cross_tenant` still passes, so the
tenant boundary is unchanged.

**Also verified clean here:** the COR-20 degradation policy is exactly right —
`log_degraded` makes every benign default visible, `query_or_none` separates
`QueryReturnedNoRows` from a real DB error `.ok()` had conflated, and
`enqueue_origin` deliberately PROPAGATES rather than degrading, because a NULL
after a failed lookup is indistinguishable from a genuine unpaired and would
silently reopen the double deduction that stamp exists to close.

**Verified:** `cargo test -p kasirmu-core --lib -- db::offline` → **70 passed, 0
failed**. Clippy clean on both files.

**Commit:** `7616a2cf9` (CORE-D).

### Core twenty-ninth pass — 24-09-26 (a stale stock cache on the sync-replay path)

| ID | Sev | Location | Finding |
|---|---|---|---|
| CORE-E | **HIGH** | `db/products_stock_query.rs:429` — `adjust_stock_in_tx` | **A synced stock adjustment left the read cache serving the pre-adjustment quantity.** `adjust_stock_in_tx` writes the same three rows as its non-tx sibling `adjust_stock_with_reason`, but omitted the cache invalidation the sibling performs. Because `get_stock` serves the cache FIRST and POPULATES it on a miss, a single read before a replayed adjustment was enough to poison the entry — measured: the database held **6** while `get_stock` returned **10**, a phantom 4 units a register would sell against stock that does not exist. |

**Why HIGH, by this ledger own definition (wrong today on a live path).** The
path is live — `platform/sync/src/queue.rs:135` and `:1127` call
`adjust_stock_in_tx` on every replayed `stock.movement` and every replayed sale
line. The consequence is oversell: the register believes it holds stock it has
already shipped out, and the error persists for the life of the cache entry
because nothing else invalidates it.

**The cache-populates-on-read detail is what turns an omission into a defect.** A
missing invalidation on a read-through cache is not merely wasteful: it is
DESTRUCTIVE, because any ordinary read between the adjustment and the next
legitimate invalidation installs the correct value — and the adjustment then
leaves it there, stale. That is stated in the test rather than left implicit.

**Found by the sibling-divergence sweep recommended last pass, and it is the
second such finding in two rounds.** I enumerated the 22 function pairs in
`kasirmu-core` (`X` vs `X_for_tenant`, `X_in_tx`, `X_on`, `X_scoped`) and
compared the `_in_tx` pairs first, because a variant that skips a guard its
non-tx sibling enforces is the highest-risk shape. `insert_stock_movement` vs
`_in_tx` turned out to be a harmless byte-identical copy (worth noting as
duplication, not a defect — the shared `_on` body exists and `_in_tx` does not
call it). `adjust_stock_in_tx` was the one that had actually dropped a step.

**The lesson this pass adds, and it is the sharpest one in the audit:** the two
functions differ by TWENTY-THREE LINES of ordinary-looking code at the end, and
each reads as complete on its own. Reading either in isolation shows nothing —
the non-tx one looks like it is being careful, the tx one looks like it simply
has no cache to worry about, because its signature takes a `Transaction` and
nothing about that signature suggests `self.cache` is still live. **Six of the
last eight findings have been sibling divergences** (BRIDGE-3/5, BRIDGE-7,
BRIDGE-9/10, CORE-D, CORE-E), which is now the dominant defect shape in this
codebase and the one a single-site read can never find.

**Fixed** by mirroring the sibling exactly: `invalidate_inventory` plus
`publish_inventory_change`, guarded by `if let Some(cache)`. The comment records
why the invalidation must happen even though the write is inside a caller
transaction — `get_stock` consults the cache before it reaches the database at
all, so an entry outliving the transaction is read regardless of what the
transaction did.

**Pinned** by `sync_replay_adjustment_invalidates_the_cached_quantity`, which
asserts the database AND the served value, and first asserts that the read path
cached on miss (the property that makes the defect destructive rather than
wasteful). **Watched to FAIL** with the invalidation removed (`a replayed
adjustment must not leave the cache serving the pre-adjustment quantity`) and pass
with it restored.

**Verified:** `cargo test -p kasirmu-core --lib -- db::products` → **140 passed, 0
failed**. Clippy clean under `--all-targets --all-features -- -D warnings` — which
caught two of my own mistakes first (`&sku.to_owned()` where `sku` was already a
`&str`, and the test calling the deprecated fn without the `#[allow(deprecated)]`
the sibling tests carry).

**Commit:** `3687afca5` (CORE-E).

### Core thirtieth pass — 24-09-26 (a sale enqueued under a hardcoded tenant)

| ID | Sev | Location | Finding |
|---|---|---|---|
| CORE-F | MEDIUM | `platform/startup/src/event_handlers.rs:87` — `SaleSyncEnqueuer` | **A completed sale was enqueued under a hardcoded `"default"` tenant while the event carried its real `store_id`.** The `offline_queue` is read PER TENANT, so a multi-store sale settled through this lane is filed where its own store daemon never looks and is never pushed. `SaleCompleted.store_id` is `Option<String>` and available at the call site; the helper used pins the literal and throws it away. |

**The repo already knew, in three separate places, which is what makes this a
live miss rather than an unknown.** `offline.rs:305-310` documents the defect by
name (*"a real pre-existing bug, found here and NOT fixed here because its callers
are outside this change"*), `offline.rs:347` repeats it, and
`offline_tests.rs:1186` pins the correct shape for the in-transaction lane with the
warning that the hardcoded helper *"would reintroduce the multi-store bug this one
avoids"*. OFF-09 added `enqueue_offline_scoped` — the combined tenant+priority
entry point — precisely so the command boundary could preserve multi-store
isolation. This call site was simply never migrated to it.

**Why nothing caught it: every fixture in the file set `store_id: None`.** I
grepped all twelve `SaleCompleted` constructions in `event_handlers_tests.rs` and
each one passes `None`, so the tenant assertion could not have existed. That is the
second time this audit has found a defect preserved by a uniformly unrepresentative
fixture (the first was the `products_stock_query_tests.rs` cache probe).

**Severity MEDIUM, not HIGH, on an honest reading.** The lane is reachable and
subscribed (`startup/src/lib.rs:127`), but the handler documents itself as
*"lane one — the legacy `complete_sale` command"*, and the two wired settlement
doors write their outbox row in-transaction with the correct tenant and short-
circuit here via the outbox probe. So the exposure is the legacy command path,
which loses sync for a multi-store sale rather than corrupting data. Still a real
defect on a live path, now fixed rather than documented a fourth time.

**Fixed** by taking the tenant from the event with a `"default"` fallback. The
fallback keeps single-store installs byte-identical — an absent `store_id` was the
old unconditional behaviour — so only the multi-store case changes.

**Pinned by the two tests the fixtures never had** —
`sync_enqueuer_files_the_row_under_the_sale_store_not_a_hardcoded_default` and
`…_falls_back_to_default_without_a_store`. The first was **watched to FAIL** with
the tenant restored to the literal (`the sale store, not the enqueue helper
hardcoded default`) and pass with the fix.

**Verified:** `cargo test -p platform-startup` → **82 passed, 0 failed**.
`cargo check -p platform-startup` clean. Clippy clean on both files. Note: the first
build attempt failed inside `kasirmu-hal` on another agent untracked
`edc/loopback.rs`; retried once their work settled and it compiled with no change
on my side.

**Commit:** `07f9e9515` (CORE-F).

### Core thirty-first pass — 24-09-26 (the sibling sweep completed: 13 pairs, no defect)

**No defect found, no code changed.** This pass finished the sweep the last three
passes were working through: all 22 sibling pairs in `kasirmu-core` have now been
compared. The remaining 13 are clean.

| Pair | Verdict |
|---|---|
| `finalize_sale` / `_in_tx` | Identical logic; both apply customer stats under the same `changed == 1` guard |
| `create_sale` / `_in_tx` | Both share `insert_sale_with_lines` and both run `validate_sale_money` |
| `update_user` / `_in_tx` | The non-tx one DELEGATES to `_in_tx` — no second copy to drift |
| `log_audit` / `_in_tx` | Both delegate to `insert_audit`; AUD-06 redaction holds for both |
| `insert_stock_movement` / `_in_tx` | Byte-identical SQL (duplication, not a defect: the shared `_on` body exists and `_in_tx` does not call it) |
| `require_permission` / `_scoped` | Both delegate to `authorize_with`; the scoped one adds the scope predicate |
| `create_tax_rate` / `_scoped` | Both complete; TAX-02 (one transaction for clear-default + insert) holds in both |
| `update_tax_rate` / `_scoped` | Both complete; TAX-03 (archived rows immutable) holds in both |
| `pending_offline_count` / `_for_tenant` | Match |
| `list_pending_offline` / `_for_tenant` | Match |
| `mark_offline_failed` / `_for_tenant` | Match; both lenient no-op on a cross-tenant id, which the doc states |
| `delete_offline_item` / `_for_tenant` | Match |
| `enforce_pos_writable` / `_for_tenant` | Correct delegation; the no-row case is fail-open by design |

**The sweep verdict, stated plainly.** Across 22 pairs it produced THREE findings —
CORE-D (a dropped `status = pending` CAS guard on the tenant-scoped sync mark),
CORE-E (a missing cache invalidation on the synced stock adjustment, HIGH) and
CORE-F (a hardcoded tenant on the sale enqueue lane). The other 19 are correct,
and 6 of them prevent divergence STRUCTURALLY rather than by care: the non-tx
wrapper simply delegates to its `_in_tx` body (`update_user`), or both call one
shared helper (`create_sale`, `log_audit`, `insert_stock_movement`,
`require_permission`). **That delegation pattern is the durable fix** — it is what
makes the three findings impossible rather than merely fixed, and it is the
recommendation for any future pair.

**A note on where the three findings clustered.** All three were in the pair sets
that do NOT delegate (`adjust_stock*`, `mark_offline_*`, and the enqueue helpers
in different crates). Three for three is a small sample, but the mechanism is not
subtle: a pair that shares a body cannot diverge, and a pair that copies one can.
That is worth stating as a rule for this repo rather than a coincidence.

**Verified:** no source, test or script changed this pass, so no suite is
affected. `git status` confirms nothing of mine is uncommitted.

**No commit** beyond this ledger entry.

### Core thirty-second pass — 24-09-26 (loyalty and profile read in full: clean)

**No defect.** Two more large unread modules read end to end, applying the sibling
lens inline rather than as a separate sweep. Both are clean, and each contains a
worked example of a lesson this audit learned the hard way in another file.

**`db/loyalty.rs` (936).**

* `compute_points` is exact-integer throughout (`i128`, no float), with a proper
  floor-division normalisation so the half-up rule is uniform for any sign, and
  `i64::try_from(..).unwrap_or(i64::MAX)` rather than a truncating cast. Its doc
  records the f64 version it replaced and the concrete mis-rounding it caused.
* **`redeem_points` is the worked example of the fix I nearly filed as a bug.** It
  reads the balance OUTSIDE any transaction (`:370`), checks it (`:437`), and only
  then opens `IMMEDIATE` (`:463`) — which is exactly the TOCTOU shape. But the
  in-transaction write is a GUARDED CAS (`WHERE id = ?3 AND points >= ?1`, `:498`)
  with `changed != 1` → rollback and refuse. So the pre-transaction read is a
  cheap fast-fail for the common case and the CAS is the real guard; two
  concurrent redemptions cannot both succeed. **The projection update at `:514` is
  INSIDE that transaction** — the opposite of the reversal path below.
* `reverse_loyalty_on_refund` takes a bare `&Connection` and documents that callers
  supply the transaction. I verified BOTH callers do: `refunds.rs:427` and
  `sync/queue.rs:604`. It caps the reversal cumulatively (`headroom`, clamped
  `.max(0)`), uses the same i128 half-up, and keys the ledger row on
  `loyalty-reversal-<refund_id>` so a replay is a constraint-violation no-op.

**`db/profile.rs` (1,018) — the PII surface, and the best-argued file in the
crate.**

* The cipher state is THREE-valued, not boolean: `Absent` / `Readable` /
  `Unreadable`, with the comment that *"a read failure is never evidence that a
  field is empty"* (`:412`). `preserve()` returns the stored bytes only for
  `Unreadable`, and the doc explains why unreadable and "caller sent nothing" are
  different facts: only one of them is a decision anyone made.
* `SensitiveWritePolicy` splits the caller's half of the judgement from the stored
  bytes' half, and its `keep_pay` doc states both the correct and the incorrect
  surface for each setting rather than just the field name.
* The documented race at `:495` fails safe with the reason given: *"the worst case
  is re-binding a value that was just replaced, never erasing a seal."*
* `get_user_profile_viewed_by` logs the `staff.identity.read` / `staff.payroll.read`
  audit rows BEFORE releasing the values, always computes the last-4 mask, and
  carries `identity_withheld` so a writer can tell "withheld from you" from
  "not on file" — the distinction that would otherwise force an editor to invent
  a national id.

**A finding that existed only in my working notes, recorded because it is the
method working.** My first read of `reverse_loyalty_on_refund` suggested the tier
recompute subquery (`lifetime_points - ?1`) read the OLD lifetime value. It does
not: SQLite evaluates every SET right-hand side against the pre-update row, so the
subquery sees the new value. Checked before claiming, not after.

**And the delegation principle from the last pass, already applied here.**
`sync/queue.rs:579-591` records that this crate USED TO MIRROR the reversal body
*"because it was `pub(crate)` to kasirmu-core and therefore unreachable from here;
that mirror was a second writer of the same effect, free to drift from the
original"* — and now delegates to the single writer. The same note appears for
CRM-06 spend reversal at `:614-622`. That is exactly the rule the sibling sweep
arrived at, already written down in the code by an earlier author.

**Verified:** no code changed, so no suite is affected. `git status` confirms
nothing of mine is uncommitted.

**No commit** beyond this ledger entry.

### Modules thirty-third pass — 24-09-26 (a swallowed recipe read mis-deducts stock)

| ID | Sev | Location | Finding |
|---|---|---|---|
| MOD-A | MEDIUM | `modules/inventory/src/handlers.rs:133` — `handle_line` | **A recipe row that failed to decode was silently dropped, and the resulting EMPTY ingredient list is the code path for "this product has no recipe".** So an unreadable BOM row made the handler deduct the COMPOSITE item and never touch its INGREDIENTS — the exact inverse of what the recipe says. Measured before the fix: a `CAKE` sale with a recipe row whose `quantity_required` could not decode returned `Ok(())`, left the ingredient at full stock, and decremented the finished good (`cake 5 -> 3`, `flour 50 -> 50`). |

**The code was `for i in ings.flatten()`.** `ings` is a `rusqlite` row iterator,
so `flatten()` discards row-level `FromSql` errors — the statement-level
`prepare`/`query_map` errors DO propagate via `?`, which is what makes the
omission easy to miss when reading. A sweep of `modules/` and `crates/
kasirmu-core/src` found this as the ONLY `.flatten()` over a row iterator; every
other hit is `Option::flatten` on a single value.

**Already recorded by the crate own audit stamp as an unfixed INFO**, which is
worth noting: the stamp reads *"a recipe-table read error would yield an empty
ingredient list and deduct the composite product instead of ingredients
(infrastructure-failure only...)"* with `next: tighten stock_summary error
surfacing`. So the defect was known and never actioned. This pass closes it.

**Severity MEDIUM on an honest reachability reading.** Both `product_recipes`
columns are `NOT NULL` with a `CHECK (quantity_required > 0)`, so reaching a
decode error needs a corrupt or hand-edited database — hence not HIGH. But the
consequence is silent stock drift on BOTH sides with no signal anywhere, and
the handler held a transaction it could have rolled back the whole time.

**Fixed** by iterating the rows and propagating with `?`, so an unreadable BOM
refuses the deduction instead of being mistaken for an absent one. The choice of
REFUSAL over "skip the line, keep the sale" is the safe direction and is stated
in the comment: a sale that does not settle can be retried, stock that silently
drifted cannot be noticed. The handler holds one transaction and `handle`
propagates, so the refusal rolls the entire deduction back.

**Pinned** by `an_undecodable_recipe_row_refuses_the_sale_rather_than_mis_
deducting`, which asserts the refusal AND that neither side moved (cake stays 5,
flour stays 50). **Watched to FAIL** with `flatten()` restored and pass with the
fix.

**Verified:** `cargo test -p modules-inventory` → **85 passed, 0 failed** across
all targets. Clippy clean under `--all-targets --all-features -- -D warnings`.

**A note on the audit scope.** `modules/*` had no coverage in this audit before
now; `modules/inventory` was the largest unaudited surface at 1,607 lines. This
is the first finding from that half of the workspace, and the sibling lens was
what led to it — the *handler* arm and the *recipe* arm are two paths to the same
deduction, and the defect is that one of them could be reached by accident.

**Commit:** `0ae9a43bb` (MOD-A).

### Modules thirty-fourth pass — 24-09-26 (tax and sales modules: clean, and a lead disproved)

**No defect, no code changed.** `modules/tax` (608 lines) and the `modules/sales`
model layer read in full, with the tax math verified against a known case.

**`modules/tax` — the rounding primitive and the live tax path both correct.**

* `RoundingMode::divide` is integer-only, and its `HalfUp` arm has the two
  subtleties right: it short-circuits an EXACT division (because the
  `checked_add(divisor/2)` idiom shifts exact negative results), and it uses
  `checked_add` so an overflow returns `None` rather than wrapping. A
  fifteen-case test suite covers the negatives and the overflow.
* `compute_line_tax` (`db/sales_tax.rs:586`) applies it with `checked_mul` on
  the numerator AND `checked_add` on the inclusive divisor, so both overflow
  directions are typed errors. I verified the inclusive formula itself
  (`base * bps / (10000 + bps)`) against a known case — 11100 gross at 11% gives
  tax 1100 / net 10000, and re-deriving the tax from the net returns 1100. The
  formula is the correct one, not the naive inverse.

**`modules/sales` — `transition_to` is a closed state machine and `from_cart`
propagates every fallible total.** `from_cart_with_user` builds lines with
`.collect::<Option<Vec<_>>>()?`, so a single overflowing line total aborts the
whole construction rather than persisting a truncated sale.

**The lead I disproved, recorded because it took real work to close.** I found
that `Sale::from_cart` leaves `subtotal = 0` and `tax_total = 0` (probe output:
`subtotal=0 tax_total=0 total=2000`), that every test fixture sets those fields
BY HAND (`payment_failure_integration.rs:71-72` constructs them explicitly), and
that `base_bridge/src/pos.rs` contains ZERO references to either field. Three
independent signals all pointed at "every POS sale persists a zero subtotal and
zero tax header while its lines carry the tax". That would have been a HIGH
reporting defect.

**It is wrong, and the fourth check is what settled it.** `pos.rs:2222` calls
`compute_sale_tax_for_location(&mut sale, ..)` — a MUTATING function I had not
read — which at `sales_tax.rs:301-302` assigns both fields and at `:310-318`
adds the exclusive tax into `sale.total` (TAX-06). The gap between `from_cart`
and persistence is real but FILLED, and the code names it: *"Sale::from_cart sets
total from the cart total (post-discount, pre-tax); the customer pays the
discounted subtotal PLUS the exclusive tax on top. Adding it here makes
sales.total_minor the true collectible amount."*

**The method note worth keeping.** My grep for assignments to `sale.subtotal` /
`sale.tax_total` returned nothing because the assignment happens through a
`&mut sale` PARAMETER inside another function — a shape a field-name grep cannot
see. The second signal (fixtures setting the fields by hand) was genuinely
misleading: fixtures construct a `Sale` struct literally, so they MUST name every
field, and that says nothing about what production does. **A fixture naming a
field is not evidence that production never sets it.** Three signals agreeing was
still not enough; the mutating call site was.

**Verified:** no code changed, so no suite is affected. The probe used to measure
`from_cart` was removed and `git status` on the file is clean.

**No commit** beyond this ledger entry.

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
| PAY-A | MEDIUM | `src/drivers/stripe.rs:438-471` | **The Stripe refund path skips the blank-key guard its own charge path documents at length.** `authorize` routes through `idempotency_key_for` (`:242-249`), which maps an absent *or blank* key to `None` and whose comment explains the stakes: "Blank must not be sent: `Some("")` would put every caller who leaves the field empty into one shared key, and Stripe would reject each charge after the first as a conflict — turning the double-charge guard into a way to refuse legitimate payments." `refund` (`:456`) passes the caller's `idempotency_key` **straight through** with no such check. **Reproduced with wiremock:** `refund(.., Some("   "))` sends `Idempotency-Key: ""`, while `authorize(.., idempotency_key: Some("   "))` correctly sends **no** header. The same bug class the charge path closed, still open one method away. Square's refund (`square.rs:439-442`) and QRIS's refund (`qris.rs:689-692`) both *do* blank-check, so Stripe is the odd one out of three. | **CLOSED 2026-09-25 — verified fixed, and the fix predates this correction.** `stripe.rs:463` now reads `let idempotency_key = idempotency_key.filter(|k| !k.trim().is_empty());`, and its comment cites this finding by name. A test pins it: `stripe_refund_omits_a_blank_idempotency_key` (`stripe_tests.rs:21`), which asserts BOTH halves — that `Some("   ")` sends no `Idempotency-Key` header, and that a real key is still forwarded verbatim. So Stripe is no longer the odd one out of three. The finding text below is left verbatim as the dated reading it was; the three-way comparison and the wiremock reproduction were both correct when written. Re-verified by running the test, not by reading the comment. |
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
---

## Pass 35 — `license_verification.rs` (1,194) and the memo store-DB guard

**Method:** full module read of `crates/kasirmu-core/src/license_verification.rs`,
then a hypothesis-driven trace of the `store_db_exists` guard in
`crates/kasirmu-bridge/src/memo.rs`.

### Cleared: `license_verification.rs`

| Surface | Verdict |
|---|---|
| `verify_license_signature` | Clean. The `#[cfg(debug_assertions)]` sentinel short-circuit is documented as debug-only; the release policy lives in `TenantSubscription::verify_signature` (`subscription.rs:534`) and honours the sentinel only for `tier_key() == "free", so a sentinel-signed *paid* row falls through to base64 decode and is rejected. |
| `verify_crl_signature` / `_with_pem` | Clean. Real PKCS1v15 + SHA-256 verify against the embedded PEM **before** the payload is parsed — parse-after-verify, not before. |
| `is_revoked_in_crl_payload` | Clean. Tenant, device, and license key by exact value *and* SHA-256 digest. |
| `apply_crl_to_cache` | Clean. Delegates to `refresh_subscription_status_from_server` instead of duplicating the revocation write, so the CRL path and the status path cannot drift. |
| `apply_license_verdict_to_cache` | Clean. Cache write precedes the return by design (section 2.5 ordering), fail-open on write failure, `hardware_verified == Some(false)` folded into `device_revoked`. |
| `store_subscription` | Clean, and the `tenant_subscription.api_key` cleartext window is **already documented** at lines 1004-1024 as parked, with its reason (dropping the column mutates hosted merchant DBs). Not a new finding. |

### Disproved lead: the `store_db_exists` guard in `store_registered_terminals`

**Hypothesis (WRONG).** `crates/kasirmu-bridge/src/memo.rs:254` short-circuits on
`!store_db_exists(store_id)`. I claimed a fresh install's store DB does not exist
when the first memo is published, so a store-registered terminal would be silently
un-mirrored and the memo delivered to nobody.

**How it was tested.** Reproduced the production wiring in a new test: a global DB
carrying the provisioned baseline, plus a `StoreDatabaseManager` over a directory
with **no** `store-a.sqlite`, then ran the real `register_terminal_scoped` and
`publish_memo_scoped`. Measured at publish time:

```
DBG store_id=store-a store_db_exists=true    <- the guard is SATISFIED
DBG foreign_keys=1
DBG recipients-rows=1
DBG global-terminals-AFTER=1
DBG registered-in-global=1                   <- the mirror happened
```

**Why the premise fails.** `register_terminal_scoped` is a *scoped* command: it
calls `open_store`, which **creates** `store-<id>.sqlite` before publish ever runs.
So the 'store DB absent' window cannot survive any terminal registration — and if
no terminal was ever registered there is no terminal to miss, in which case the
zero-recipient fan-out refusal fires correctly. The guard is sound.

**Kept anyway, as pins rather than repros.** Two tests added to `memo_tests.rs`.
They pass against HEAD and are documented as regression pins for a guard that is
easy to invalidate by moving the fan-out off the global table:

- `publish_resolves_the_store_terminals_when_the_store_db_is_not_open_yet`
- `publishing_from_a_store_whose_db_is_absent_still_reaches_global_terminals`

Harness deltas, kept minimal: `mod testing` widened to `pub(crate)` and
`unique_store_dir` to `pub(crate)`, so a test can build the production directory
shape. No `pub` was introduced.

**Lesson (recurring).** A setup command that *exercises the code under test* can
erase the very precondition the test is built on: `register_terminal_scoped`
created the store DB the hypothesis needed to be absent. Probe the precondition
**at the moment of the act**, not at setup.

**Tally:** 19 findings fixed (5 HIGH), 8 leads disproved.

---

## Pass 36 — `modules/reporting` / `loyalty` / `staff`: the write-only projection

### MSL-11 (MEDIUM, FIXED): `SaleCompletedReporter` wrote a table nothing reads

`platform/startup/src/lib.rs` subscribed `modules_reporting::handlers::SaleCompletedReporter`
to the live `sale.completed` topic. Every completed sale appended a row to
`report_sales`. Three independent problems, all verified:

1. **The table has one writer and zero readers.** A whole-workspace grep for
   `report_sales` returns the DDL, the INSERT, and the handler's own tests —
   nothing else. No Rust path, no UI path (`ui/` has **0** hits), and no export
   path ever selects from it. The one apparent exception,
   `custom_report_sales_basic`, is an unrelated export test whose *function name*
   contains the substring.

   The sibling handlers on the same topic are the control group, and they prove
   this is not a convention: `AuditLogHandler` writes `audit_log` (**35** readers),
   `LoyaltyEarnHandler` writes `loyalty_accounts` (read by the loyalty engine), and
   `SaleSyncEnqueuer` writes the sync queue (drained by the sync daemon).
   `report_sales` is the only write-only table of the four.

2. **A lazy `CREATE TABLE IF NOT EXISTS` ran on every sale.** The handler called
   `ensure_table` at the top of `handle`, so every completed sale paid a DDL
   batch prepare on the hot path — the `perf: DDL per event` note the 25-07
   audit already recorded and left.

3. **It discarded `event.store_id`.** `SaleCompleted` carries `store_id`
   (`foundation/src/events.rs:18`), and the handler holds the **global identity**
   DB connection (`open_handler_connection(state.db_path)`, where `db_path` is
   `<app_data_dir>/kasir.db`). So in multi-store mode every store's sales landed
   in one shared table with no store attribution — the exact defect CORE-F fixed
   for `SaleSyncEnqueuer` in this same audit.

**Why removing it is correct rather than a stopgap.** The aggregates it claimed to
serve already exist, correctly, in `crates/kasirmu-core/src/db/reports/revenue.rs`:
`daily_revenue` reads `sales`/`refunds` directly, groups **BY CURRENCY**, applies
the store's UTC offset (REP-03), joins refunds `FULL OUTER` so a refund-only day
still yields a row (REP-04), and validates its date bounds. A projection table can
only ever be a stale duplicate of that.

**What changed.** The handler, its `report_sales` DDL, its 5 tests, and the startup
subscription are gone. `modules/reporting/src/handlers.rs` is kept at the same path
as an intentionally empty module so the crate layout stays stable. Module docs in
`lib.rs`, the subscription site, and `README.md` were corrected — the README had
documented the dead handler as live.

**Regression pin.** `platform/startup/src/startup_tests.rs::report_sales_projection_stays_removed`
walks every `.rs` file in the workspace, **strips line comments**, normalises
whitespace, and asserts no file outside a two-entry allowlist mentions the table.

**The pin was itself a caught evadable guard.** My first version exempted
`platform/startup/src/lib.rs` wholesale. A deliberate probe — `let _probe =
"INSERT INTO report_sales (sale_id) VALUES (?1)";` inserted at that path —
**passed** the pin. That is the fourth instance of this class in the audit (after
`pos_tests`, `data_tests`, `terminals_tests`), with the same root cause every time:
a blanket exemption wider than the thing being exempted. Fixed by matching on
**comment-stripped code** rather than by exempting files, and by dropping every
exempted path that could host a real writer.

Proof the corrected pin bites: with the probe present it FAILS naming
`platform/startup/src/lib.rs`; with the probe removed it passes. A floor
(`scanned >= 200`) stops it passing vacuously if the walk breaks. The pin also
documents that a Windows backslash literal in `ends_with` silently never matches.

### Cleared / recorded

- `modules/loyalty`: `models.rs` is exemplary — the MSL-10 `GiftCard.pin` fix is
  real (`skip_serializing` + `default`) and pinned by a test that also proves a
  legacy payload still deserializes to an empty pin. `earn_multiplier_millionths`
  is fixed-point i64, never a float. The real earn/redeem logic is in
  `kasirmu-core/src/db/loyalty.rs`.
- `modules/loyalty`'s own `LoyaltyRepository`/`LoyaltyService` have **zero
  production callers** — only their own tests. Same for `StaffRepository` and
  `ReportingRepository`.
- **`db/mod.rs:197` is misleading for reporting, and was left as an open note.**
  The ADR-#30 note names `ReportingRepository` among the repositories new code
  should prefer, but its `generate_daily_report` is materially worse than the real
  implementation: it hardcodes `Currency(*b"USD")` instead of parsing the sale
  currency, ignores the store's UTC offset, and counts refunds as revenue. Core's
  own convention is to *parse* the code and fall back to USD (`gift_cards.rs:24`,
  `loyalty.rs:21`, `email_report.rs:748`), so the hardcode is a local deviation,
  not a repo-wide one. Unmoneyed only because both are dead. **Not fixed** —
  out of this pass's scope and a doc/decision call.
- Eight modules export `*Repository`/`*Service` with no callers outside their own
  crate: `staff`, `reporting`, `tax`, `terminal`, `settings`, `sales`, `inventory`,
  `crm`.

**Tally:** 20 findings fixed (5 HIGH), 8 leads disproved, 1 pin hardened after it
was proven evadable.

---

## Pass 37 — `sync_client.rs` (949): a transport error destroyed the offline sale queue

### MSL-12 (HIGH, FIXED): `mark_all_failed` on a transport error made the push queue terminal

`sync_pending`'s error arm called `mark_all_failed`, which writes
`status = 'failed'`. **Nothing in this repository ever writes `status = 'pending'`
again** — a whole-repo grep for `SET status = 'pending'` returns **zero** hits — and
`list_pending_offline` selects `status = 'pending'` only. So a `failed` push item is
**terminal**: the queued sale never reaches the cloud again, silently and permanently.

A transport error was routed into that arm. A dropped connection, a 502 from a
restarting container, or a build with `sync-http` compiled out are all conditions
under which the server **never saw the item** — they are not verdicts on it.

**The divergence that proves the intent.** The SQLite daemon already refuses this
policy on the identical failure: `daemon_tick.rs`'s `Err(e)` arm does
`pushed = 0; sync_error = Some(...)` and never marks anything, and its plan-gate
sibling in the same function keeps items `pending` with the comment "a plan gate is
not a failure". Three shells (`kasirmu-core`, `kasirmu-bridge`, `apps/mobile-tauri`)
each carried their own copy of the destructive arm — five call sites in total — while
the daemon, the one path that runs every 60-120s, had it right.

**Two independent authors had already written the property down without acting on it.**
`sync_client.rs:324` says *"push-side `failed` items have no requeue path, so marking a
successful replay `failed` would strand it permanently"*, and `daemon.rs:236` repeats
*"push-side failed items are terminal (no requeue)"*. Both treat it as a constraint to
route around; neither asked whether the transport arm should be subject to it.

**What changed.** A new shared `sync_client::undelivered_batch(error) -> SyncAttemptResult`
holds the one policy (report the error, touch no rows, carry the plan-gate arm) and all
five call sites route through it, so the shells cannot drift again. `mark_all_failed`
remains for callers holding a genuine per-item verdict and now says so in its doc.

**Test.** `sync_pending_keeps_items_pending_on_a_transport_error` asserts the item is
still returned by `list_pending_offline` after a connection-refused. It was written
FIRST and observed to FAIL against the old code (`left: 0, right: 1` — the item had
been marked and dropped out of the retry set), then pass after the fix.

**Two existing tests pinned the destructive behaviour and were corrected, not deleted.**
`sync_pending_marks_items_synced` asserted `failed == 1` and `status == Failed` for a
missing server — despite its name it never tested syncing. `sync_pending_multiple_items`
asserted `failed == 2`. Both now assert the items stay `pending`, with the reasoning in
the test body and a pointer to the new case.

**Left alone, recorded:** `platform/sync/src/image_push.rs` also calls its own
`mark_all_failed` on a network error, but that is a hash-indexed image drain with its own
`enqueue`/`drain` cycle, not the sale queue — a different lifecycle that does not share
`list_pending_offline`. Its `drain_once_enqueues_and_marks_failed_on_network_error` test
still passes. If the image drain loses retries the same way, that is its own finding.

**Verified:** 52 `sync_client` tests, 9 bridge `offline::` tests, 427 `platform-sync`
tests all pass; clippy clean on the touched crates (`sync.rs:74` is another agent's
committed warning, untouched).

**Tally:** 21 findings fixed (6 HIGH), 8 leads disproved.

---

## Pass 38 — `subscription.rs` (1,215): the grace engine ignored the server's explicit verdict

### MSL-13 (HIGH, FIXED): `status = 'expired'` kept the PAID tier

`TenantSubscription::is_within_grace_period_at` derived its answer from date
arithmetic and carved out only `canceled` and `revoked`. Everything else fell
through to the date test, so a row the **license server had explicitly marked
`expired`** — with an `expires_at` still in the future — was "within grace".

Because `effective_tier_at` is a second reader of that same decision, the row
kept its **paid** tier. The consequence is not cosmetic; `effective_tier` is the
source of truth for:

- `quota_gate::resolve_tier_fail_closed` (:60) — the central quota gate, so an
  expired Enterprise tenant got 99 locations / 99 POS instances;
- `crates/kasirmu-api/src/routes/products.rs:280`;
- `crates/kasirmu-bridge/src/{history,workspaces,topology/commands}.rs`;
- `entitlements::from_subscription` — which publishes **both**
  `tier: effective_tier()` and `state: lifecycle_state()` in one struct, so the
  UI received `tier: Enterprise, state: Expired` side by side.

**How it surfaced.** Not by reading the code — by writing a matrix test that
asserted the module's OWN documented invariant. `lifecycle_state`'s doc claimed
the two engines "mirror exactly so the reported state can never disagree with
`effective_tier`", and no test checked it directly. The matrix walked 7 statuses
× 6 tiers × 6 expiry shapes (252 cells) and named the first disagreeing cell.

**The statuses, measured before the fix** (grace vs lifecycle):

| status | `is_within_grace_period` | `lifecycle_state` | before MSL-13 |
|---|---|---|---|
| `expired` | **true** | `Expired` | paid tier retained — the bug |
| `paused` | **true** | `Paused` | paid tier retained — the bug |
| `canceled` | false | `Canceled` | agreed |
| `revoked` | false | `Revoked` | agreed |
| `grace_period` | false (once dated) | `Grace` | by design, kept |
| unknown | true | `Unavailable` | by design, kept |

`expired` and `paused` are now honoured by both engines: an explicit
server-written verdict beats the date arithmetic, because the date logic DERIVES a
verdict while these statuses ARE the verdict. `grace_period` is deliberately NOT
in that set — it is the server saying the row IS in grace.

**Two design decisions checked rather than assumed.** `pos_read_only`'s own doc
(:1048) says "`Canceled`/`Paused` revert entitlements to Free (Free can still
sell)", which is why `paused` belongs in the never-within-grace family rather
than being a trading state. And I did NOT add `lifecycle_state_for_connection`:
`pos_read_only_for_connection` already supplies the ledger-time path for the
enforcement decision, so a third ledger variant would be a new public surface
with no caller.

**Test.** `server_expired_status_does_not_keep_the_paid_tier` asserts an
Enterprise row with `status = 'expired'` and a future date resolves to Free. It
was written first and observed to FAIL (`left: Enterprise, right: Free`), then
pass. `lifecycle_state_and_grace_period_agree_except_for_the_documented_carve_outs`
replaces my earlier, WRONG version of the same matrix: that one asserted a
usable-set equivalence and failed on `paused`/`canceled` — because *I* had assumed
the two engines agreed on "usable" when the design deliberately has them ask
different questions. The final test bounds the equivalence to the two remaining
documented carve-outs and asserts nothing vacuous.

**A false doc claim corrected.** `lifecycle_state`'s paragraph promised an
equivalence the code never implemented; it now states the real contract and names
the test that measures it.

**Verified:** 136 `subscription::` tests and the full `kasirmu-core` suite pass
with zero failures; clippy clean on core (`kasirmu-bridge`'s `sync.rs:74` is
another agent's committed warning, untouched).

**Tally:** 22 findings fixed (7 HIGH), 8 leads disproved.

---

## Pass 39 — the second-derivation class: one predicate written three times, and two false alarms

This pass started from the method that produced MSL-12 and MSL-13: a decision made
in one place while a second place derives it independently. It found one latent
structural risk and one measured flaky test — and two `as_str` leads that turned out
to be MY test asserting a contract that never existed.

### MSL-15 (LOW, FIXED): `{Active, Grace}` was written out three times

The set of lifecycle states that keep entitlements flowing existed as a literal in
three places: `Entitlements::addon_grant_flows` (`entitlements.rs:118`),
`explain_availability`'s `lifecycle_denies` (`availability.rs:385`), and the verdict
test. All three agreed, so this is LATENT, not live — but three copies of one
predicate are three chances to drift, and `availability_tests.rs:276` already
documents the exact hazard for one variant (`Revoked` was absorbed by the allow-list
with no compile error).

**Fix.** One definition, `SubscriptionLifecycleState::grants_entitlements`, on the
type that owns the vocabulary. Both consumers delegate. `every_lifecycle_state_
declares_whether_it_grants_entitlements` walks all seven variants (named one by one,
so a new variant is a compile error there) and asserts each consumer agrees with the
shared predicate.

### MSL-16 (LOW, FIXED): `mark_push_failure_bumps_attempts` failed ~1 run in 60

**Measured, not reasoned:** 60 consecutive runs produced exactly 1 failure. The cause
is in the TEST, not the code. `mark_push_attempt` uses AWS full-jitter —
`uniform(0, min(30min, 60s * 2^attempts))` — so at `attempts == 0` the draw is
`uniform(0, 60)` seconds. A draw of ZERO schedules the row for NOW, and
`peek_push_batch` selects `datetime(next_attempt_at) <= datetime('now')`, which is
then true. The test asserted an empty batch unconditionally.

**Fix.** The test now pins the guarantee the code actually makes — the row is never
scheduled BEFORE it was enqueued, and `peek` excludes it whenever the draw was
non-zero — asserting the genuine disjunction instead of a promise the jitter does not
make. Re-measured: **0 failures in 40 runs**. A test that fails randomly is worse
than no test, because it teaches the reader to re-run rather than to look.

### Two `as_str` leads pursued and DISPROVED — both were my tests' fault

Worth recording because the reflex (found a failing assertion, reached for a
production edit) was wrong twice in a row.

1. **`every_lifecycle_state_declares...` reported `Entitlements` and the shared
   predicate disagreeing about `Grace`.** My fixture wrote `state.as_str()` into the
   `status` COLUMN, and the reader matches the SERVER's vocabulary — where the
   string is `grace_period`. `Grace.as_str()` is `grace` (the WIRE form), which the
   reader correctly fails closed to `Unavailable`. Fixing the fixture to use the
   column vocabulary made it pass; no production change was warranted.

2. **A round-trip test `lifecycle_state_at(as_str()) == self` failed on `Grace`.**
   I nearly filed this as a defect. It is not: `as_str` and `lifecycle_state_at`
   speak two different vocabularies and only overlap on the five statuses spelled
   identically. Confirmed against the client: `ui/src/api/subscription.ts:14` types
   the union with `'grace'` and `SubscriptionContext.test.tsx` asserts
   `state === 'grace'`, so `as_str`'s value is RIGHT for the wire; the licensing
   layer's `GracePeriod` (camelCase, `kasirmu-bridge/src/license.rs`) is a third
   spelling on a third axis. The test was replaced by one pinning BOTH vocabularies
   and the deliberate non-round-trip between them.

**Lesson.** A failing assertion is evidence about MY test as much as about the code.
Both false alarms came from a fixture that invented a contract — round-tripping two
vocabularies that were never meant to convert. Check the client that consumes the
value before calling the value wrong.

### Cleared

- `crates/kasirmu-core/src/db/tax/scopes.rs` (962) — exemplary. `location_legal_entity`
  derives the entity from the location row specifically so a caller cannot claim one
  its branch lacks; the window's `effective_to` is documented EXCLUSIVE and
  `validate` refuses an empty period; a stored date that does not parse is SKIPPED
  rather than trusted or rewritten; `parse_effective_date` is strict (rejects RFC3339,
  `YYYY-M-D`, trailing space, month 13) and compares as `NaiveDate`, not as text.
  The caller-owns-the-business-date deferral names the open timezone question and
  refuses to invent a policy inside money math.

**Tally:** 24 findings fixed (7 HIGH), 10 leads disproved.

---

## Pass 40 — `topology.rs`, the API spec, and the terminal-secret timing lead

### Disproved lead #11 (the most instructive one): the terminal secret compare is NOT a timing oracle

`crates/kasirmu-api/src/routes/terminals.rs:79` looks up a terminal with
`WHERE terminal_id = ?1 AND secret_hash = ?2` — a plain SQL `=` on a secret digest.
The codebase has a documented, enforced convention of constant-time secret comparison:
`Mac::verify_slice` in `bridge/terminals.rs:129`, `bridge/picker.rs:79`,
`bridge/workspaces.rs:823`, and `api/routes/tokens.rs:133`, where API-2 fixed exactly
this shape and `tokens_tests.rs:257` pins it. So this looked like the missed sibling.

**It is not, and the distinction is the transferable part.** The bridge's own doc
(`bridge/terminals.rs:79-86`) states the criterion: the dangerous shape is
*"re-sign and compare the two hex strings"*, because there the STORED value's bytes are
steerable — they are the HMAC of attacker-influenced input, so a forger can walk the
prefix one hex character at a time. Here:

- the stored value is `SHA-256(secret)` where `secret` is `generate_device_secret()` →
  `Uuid::new_v4().simple()`, **server-generated and never returned to the attacker**
  except once at registration;
- the candidate is hashed too, so BOTH sides of the comparison are uniform 64-char
  digests with no steerable prefix;
- and the row is reached by `terminal_id`, which is the PRIMARY KEY, so an attacker must
  already know the exact id.

A byte-at-a-time oracle needs the attacker to control the bytes being compared. Here
they control neither side's content and cannot even influence the digest. Non-constant
time is fine because there is nothing to learn. **A constant-time comparison is not a
reflex; it is required when an attacker-chosen value is compared against a secret, and
the digest indirection is precisely what removes that property.**

The path is also better tested than I assumed before looking: `terminals_tests.rs`
covers plaintext-never-stored (asserting the hash does not even EMBED the secret, `:236`),
rotation invalidating the old secret, digest stability, and correct-secret-only matching.

### Cleared: `crates/kasirmu-core/src/topology.rs` (832)

Pure semantic-JSON validation — no DB, no money, no authz. Notable for its own rigour:
every gate carries the ADR clause that added it and the defect it closes, including
`duplicate-node` (an `or_insert` that "SILENTLY DROPPED" a node and then validated the
collapsed graph — the one defect no later gate can recover from) and
`multiple-ticket-inputs` (present in the TypeScript validator, absent here). It also
removes a hand-built set with the note *"Two correct copies are still two copies"* — the
same rule this audit has been applying. Direction is deliberately excluded from the
location-wire gate because the frontend treats it as presentation-only.

### Cleared: `crates/kasirmu-api/src/spec/` (1,428)

Hand-written OpenAPI. `spec_tests.rs` verifies the STRUCTURAL properties (every `$ref`
resolves, `x-oz-scope=both` on every base operation with a floor, no cloud-only path
leaked into the shared document, Parameter Objects not parked under `components/schemas`,
pagination refs moved with the objects). The factual claims I spot-checked hold:
"only its SHA-256 hash is persisted" is true (verified at `terminals.rs:156-196`), and
the rotation-without-409 behaviour matches the handler.

### Cleared: `crates/kasirmu-core/src/db/popularity.rs` (832)

Local analytics only (ADR #37), not money. Checked the one thing worth checking — that
the single-SKU path (`recompute_popularity` → `sale_day_counts`, `activity_day_counts`)
and the full pass (`recompute_all_popularity`) bucket days identically. They do: all
three use `strftime('%Y-%m-%d', created_at)` with the same `window_modifier()`. UTC
bucketing is uniform across every reader, and `days_ago` fails out-of-range days to
`i64::MAX` so the formula window drops them rather than scoring them.

**Tally:** 24 findings fixed (7 HIGH), 11 leads disproved.

---

## Pass 41 — `db/audit.rs` (783): the audit trail could be erased through a settings row

### MSL-17 (HIGH, FIXED): every ingest lane could forge the sweep marker

`crates/kasirmu-core/migrations/20260920_audit_retention.sql` replaces the
unconditional `audit_log_immutable_delete` trigger with a sweep-gated one: it raises
UNLESS the `settings` row `audit.retention_sweep_active` exists. The design is sound
as written — the sweep sets and clears the marker inside ONE transaction, so a crash
rolls it back with the deletes and another connection never sees uncommitted state.

**The hole is the policy on that key, not the trigger.** `IngestPolicy::admits`
(`platform/core/src/settings/raw.rs:663`) returned `true` for it in **ALL THREE**
lanes — including the two that carry attacker-authored data. Measured directly:

```
DBG PortablePackage=true RemoteSync=true TrustedLocal=true
```

So a `.kasirpkg` import or a remote-sync payload could write the marker on its own
connection and leave it there. The transaction discipline stops a COINCIDENT write;
it does not stop a deliberate one. With the marker present the trigger no longer
fires, and the audit trail — the record the trigger exists to make immutable — is
deletable.

**Proved end-to-end, in two halves.**

1. `platform-core::settings::raw_tests::the_audit_sweep_marker_is_refused_by_the_untrusted_lanes`
   asserts both untrusted lanes refuse the key and `TrustedLocal` admits it. Written
   FIRST and observed to FAIL on the `PortablePackage` assertion.
2. `kasirmu-core::db::audit::tests::a_forged_sweep_marker_defeats_audit_immutability`
   proves the consequence against the real trigger: baseline DELETE aborts
   (`"audit_log entries are immutable"`), then after an ordinary committed
   `Settings::set` of the marker the same DELETE succeeds (`cleared == 1`) and the row
   is really gone (`audit_count == 0`). It passes, which is the finding.

**Fix.** The marker joins `is_manager_owned_key`, so both untrusted lanes refuse it
while `TrustedLocal` keeps admitting it — the sweep writes it locally. Re-measured:
`PortablePackage=false RemoteSync=false TrustedLocal=true`. The constant now lives once
in `keys::AUDIT_SWEEP_MARKER_KEY`, and the test asserts it equals the string
`kasirmu-core` writes (`Store::SWEEP_MARKER_KEY`), because the two crates cannot share
it — `kasirmu-core` depends on `platform-core`, so the reverse edge would be a cycle.
That cross-crate duplication is the remaining seam and is now pinned by assertion.

**Why the existing tests missed it.** `audit_retention_trigger_still_blocks_direct_delete`
asserts a plain DELETE aborts — correct, but it never writes the marker first, so it
tests the trigger in the one state an attacker is not limited to. The new case adds the
single missing step.

### A self-inflicted error worth recording

My first attempt to append that test matched an anchor (`let conn = fresh();`) that also
occurs inside `audit_retention_bad_now_timestamp_fails_closed`, so the edit spliced the
new test INTO the middle of a live function — the new test then ran zero times (3303
filtered, 0 executed) instead of failing loudly. The repair restored the interrupted
function and appended at the true end of file. **A test that silently does not run is
worse than a failing one**, and the only reason it was noticed is that the run reported
`0 passed` for a filter that should have matched. Always check that a new test is
actually COLLECTED, not merely that the suite is green.

**Tally:** 25 findings fixed (8 HIGH), 11 leads disproved.

---

## Pass 42 — `sales_lifecycle.rs` (793): the pending-sale void left no trace

### MSL-18 (MEDIUM, FIXED): `void_pending_sale` contradicted its own module invariant

The module header states the invariant plainly (`sales_lifecycle.rs:9-11`): *"every
status transition bumps `version` inside a transaction; voiding never adjusts inventory;
**voids write audit entries**."* Its sibling `void_sale` honours it — line 829 writes
`sale.void` with the reason, the user and the total, and that action is what
`audit_integration.rs` asserts on.

`void_pending_sale` (line 620) wrote **no audit row at all** while doing strictly more
reversible work than `void_sale`: it iterates `deduction_locations` and credits stock
back at every original source, cancels KDS tickets in the ghost window, then flips the
row to `voided`. It is reachable from the register UI (`ui/src/api/sales.ts:395`) behind
`SALES_PROCESS`. So an operator asking *who voided this sale?* got an answer for a
completed sale and silence for a pending one — and the pending path is the one the
payment-failure fallback takes.

**Test.** `void_pending_sale_writes_an_audit_entry` drives the real path
(`complete_sale_deduction` → `void_pending_sale`) and counts `sale.void` rows for the
sale. Written FIRST and observed to FAIL (`left: 0, right: 1`), then pass.

**Fix.** The audit row is written through `log_audit`, which JOINS the caller's
transaction rather than opening its own, so it commits or dies with the void — the same
join `void_sale` relies on. The reason is recorded as a
`"reversal": "pending_sale_void"` marker rather than free text, because this method's
two callers (the UI failure path and the stale-pending reaper) pass no user-supplied
reason, and the reaper is not a user at all. The actor is `system` for that reason.

**A duplicated doc block, left alone.** `find_stale_pending_sales`'s doc comment appears
twice (`:717-722` and `:723-732`), the second nearly identical to the first. Harmless —
rustdoc renders the union — and deleting it is a pure cosmetic diff on a line I have no
other reason to touch. Recorded rather than actioned.

### Disproved lead #12: the negative-stock trigger is not the MSL-17 shape

`20261012_stock_summary_qty_nonnegative.sql` permits a negative `stock_summary.qty` when
a `workspace_inventory_locations` binding has `allow_negative_stock = 1` — structurally
the same "security gate keyed on a row another lane can write" shape as MSL-17. It is
NOT the same class:

- `allow_negative_stock` is a **documented shipped feature** (ADR 2026-07-18 §476;
  `LocationPicker.tsx:429` renders the badge), so forging it grants a capability the
  product intends to grant, rather than defeating a guard;
- the binding write is gated on `INVENTORY_LOCATIONS_MANAGE` through a session-resolved
  store-scoped command (`bridge/inventory.rs:277-289`), so the forgery requires the
  stock-policy authority the feature belongs to anyway;
- the trigger is a *backstop* over Layer 1, not the only guard. Verified rather than
  assumed: `adjust.rs:221-236` initialises `allow_negative = false` and can only set it
  from a binding, so a location with no binding is refused by
  `InsufficientStockAtLocation` in Rust before the trigger is consulted. The migration's
  claim that an unbound location has "no opt-out to violate" is accurate.

The migration itself is a model of the genre: it names the `CHECK (qty >= 0)` it rejected
AND the test that would have broken, states what it does not guarantee (ledger/rollup
drift, which the C12 variance report exists to surface), and explains its one refinement
of the literal predicate.

**Tally:** 26 findings fixed (8 HIGH), 12 leads disproved.

---

## Pass 43 — `db/stock_transfers.rs` (765): an empty transfer could be claimed as received

### MSL-19 (MEDIUM, FIXED): zero lines means a false `received` state

`receive_transfer` derives the final status from the transfer's LINES:

```rust
all_received     = COUNT(*) WHERE transfer_id = ? AND received_qty < qty  == 0
has_any_received = COUNT(*) WHERE transfer_id = ? AND received_qty > 0   > 0
final = if all_received { received } else if has_any_received { received_partial } else { in_transit }
```

On a transfer with **zero lines**, `all_received` counts 0 rows and is therefore true,
while `has_any_received` is false. The status resolves to `received`: a completed
transfer that moved nothing. Nothing required a line to exist — `create_transfer` takes
a `lines` slice with no non-empty guard, `add_transfer_line` only checks `status =
'draft'`, and `send_transfer`'s `qty <= 0` guard is **per-line**, so on an empty transfer
the loop body never runs and the guard is vacuous.

**Measured, not reasoned.** `an_empty_transfer_cannot_be_claimed_as_received` created a
transfer with `&[]`, sent it, and received it: it came back `"received"`. Written first,
observed to fail, then fixed.

**Reachability, stated honestly.** The shipped UI guards its own button —
`WarehouseConsole.tsx:164` returns early when `session.isEmpty` — but that is a
client-side check on a payload the API accepts directly, and the bridge validates
locations and terminals while never validating the line set
(`bridge/stock_transfers.rs:158-171`). The empty array is in fact the SHIPPED call shape:
`WarehouseConsole.tsx:173` passes `[]` to `create_stock_transfer_scoped` and then appends
lines one at a time in a loop at `:175-183`. A mid-loop failure leaves a live transfer
with partial lines. So the defect is reachable from the wire even though the happy-path
button is guarded.

**Fix, at the layer that owns the invariant.** `send_transfer` refuses a transfer with no
lines. Refused THERE rather than at `receive_transfer` because that is where the in-transit
state is created: if a transfer can never enter `in_transit` empty, no later step has an
empty one to mishandle. The invariant belongs where the data is written, not where the
button is clicked.

The test now pins three things: the send is refused with `field: "lines"`, the transfer
**stays `draft`** (a refused send must not advance the lifecycle), and the receive door is
therefore unreachable for it.

**One integration fixture was relying on the old behaviour.**
`add_line_to_non_draft_transfer_fails` sent an empty draft to reach `in_transit`; its
subject is the add-line guard on a non-draft transfer, so it now creates the draft with a
real line. Corrected as a fixture, with the reason in the body, not deleted.

### Cleared

The rest of `stock_transfers.rs` is careful work and worth recording as such: every
lifecycle transition claims its status INSIDE the transaction that does the inventory
work (so a concurrent cancel cannot let a receive credit stock on a cancelled transfer),
the per-line-in-transaction idiom `add_transfer_line` uses is documented as C18 P1.11 with
the exact defect it closes, and `receive_transfer` refuses a received quantity that exceeds
the ordered quantity or DECREASES after inventory was already credited.

**Tally:** 27 findings fixed (8 HIGH), 12 leads disproved.

---

## Pass 44 — `db/workspaces_instances.rs`: three dead arms and a retyped id list

### MSL-20 (LOW, FIXED): the owner-bypass compared against seven hand-typed literals

`list_workspaces_inner`'s step-1 bypass listed SEVEN role-id strings. Three of them —
`"admin"`, `"manager"`, `"auditor"` — are **not role ids at all**, and I proved it
rather than inferring it:

- `users.role_id` is `REFERENCES roles(id)` (`20260813_init.sql:29`), so the column can
  only hold a row that exists in `roles`;
- every preset id in `platform_core::rbac::ROLE_PRESETS` is `role-`-prefixed —
  `role-owner`, `role-manager`, `role-staff`, `role-admin`, `role-auditor`, `role-custom`;
- so `admin` / `manager` / `auditor` can never match. Those three arms were unreachable.

The four arms that WERE real retyped constants that already exist in
`platform_core::rbac::builtin_roles`. A hand-written list of ids is the "two correct
copies are still two copies" defect this tree names elsewhere (`topology.rs`), and its
failure mode is silent: a taxonomy change would not be a compile error here.

**Severity is LOW, and I checked that before acting.** The new test
`the_workspace_bypass_ids_are_the_canonical_ones` PASSES against the pre-fix code — so no
live authorisation outcome was wrong; the four real ids behaved correctly and the three
dead arms matched nothing. This is dead code plus a duplication hazard, not a behaviour
bug, and it is recorded as such rather than talked up.

**Fix.** `matches!(role_id, builtin_roles::OWNER | ADMIN | MANAGER | AUDITOR)` — the
taxonomy now owns the set. The test walks all six preset ids and asserts the bypass set is
exactly `{OWNER, ADMIN, MANAGER, AUDITOR}` (STAFF and CUSTOM deliberately fall through to
the assignment and role-type arms), plus that the three bare strings are not builtin role
ids at all.

**Proven behaviour-preserving:** all 74 `db::workspaces` tests pass unchanged, and the
full `kasirmu-core` suite is green with zero failures.

### A tooling failure worth recording (again)

Two mangled edits in this pass came from the SAME cause, and it is mine, not the
tooling's: a helper of the form `const A = (s) => Q + s + A` — where `A` is defined in
terms of itself — injects its own body into every substitution. It corrupted three lines
of the new test (`"default"` became `"default(s) => Q + s + A`). A second, separate slip
consumed the previous test's closing brace because my `old_string` started one line too
late.

Both were caught by the compiler, which is the point of compiling after every edit — but
the recurrence is the lesson: **when building source text in a program, never name the
builder after a value it also substitutes.** The earlier `format!` mistakes
(`assert_eq!` takes its message AS a format string; wrapping it in `format!` is a compile
error) come from the same family: text generation is where I make mistakes, so it gets the
same verify-immediately discipline as production code.

**Tally:** 28 findings fixed (8 HIGH), 12 leads disproved.

---

## Pass 45 — the workspace role bypass: one set, three hand-written copies

### MSL-21 (LOW, FIXED): three copies of an authorization predicate, all with dead arms

MSL-20 fixed ONE copy of this list. Applying the same lens mechanically found the rest:
the "which roles see every workspace" set was written out by hand in **three** places,
two of them live authorization paths —
`db/workspaces_instances.rs::list_workspaces_inner` (the listing), its sibling
`can_access_instance` (the per-instance gate), and
`db/workspaces.rs::list_workspaces_legacy`. Every copy carried the same three non-role
literals (`admin`, `manager`, `auditor`), all dead for the same proven reason:
`users.role_id` is `REFERENCES roles(id)` and every preset id is `role-`-prefixed.

**One definition now.** `platform_core::rbac::role_bypasses_workspace_assignment`, in
`rbac_presets.rs` beside `is_builtin_role_id` and built FROM `builtin_roles`, re-exported
through `rbac`. Both live sites call it. The set cannot fork and a taxonomy change lands
in one place.

**The legacy copy was NOT silently reconciled, and that is the deliberate part.**
`list_workspaces_legacy` also admitted `role-staff`, which the shared predicate excludes.
Rather than change a policy on a dead path, its literals were replaced with the canonical
constants while KEEPING its `role-staff` arm, and the divergence is documented at the
site: the function resolves from the pre-ADR-#4 tables (`user_workspaces`,
`role_workspaces`) and has **no caller outside its own tests** (verified: the only
external user in the tree is `list_all_workspace_types`, a different function). Making a
dead path agree would leave the next reader believing the two are one policy.

**Severity is LOW and checked, not asserted.** Two tests:
`the_workspace_bypass_ids_are_the_canonical_ones` (the listing, every preset id) and
`the_bypass_predicate_admits_exactly_the_management_roles` (the predicate directly, plus
that the three bare literals do not bypass). The first PASSES against the pre-fix code, so
no live authorization outcome was wrong — this is duplication plus dead code, and the
ledger says so rather than inflating it.

**The file had already flagged itself.** `db/workspaces.rs`'s own audit stamp reads
*"hardcoded role-id allowlist (8 variants) is fragile if presets change"* — a correct
diagnosis that sat in a comment while the code kept the shape.

**Verified:** 75 `db::workspaces` tests, 415 `platform-core` tests, and the full
`kasirmu-core` suite all pass; clippy clean on both crates.

**Tally:** 29 findings fixed (8 HIGH), 12 leads disproved.

---

## Pass 46 — `read_tiers.rs`: the one table never checked against the permission registry

### MSL-22 (LOW, PREVENTIVE): `READ_KEY_MAP` keys were unvalidated

Following MSL-20/MSL-21's identifier-hygiene lens to permission keys. The sweep found
`crates/kasirmu-api/src/read_tiers.rs` using bare literals (`"products:read"`,
`"sales:view"`, …) for the route-to-permission table. In a `const` table that is the
idiomatic form — a `const` cannot call a function — so the literals themselves are not
the finding. **The finding is that nothing checked them.**

The gate resolves each key through `permission_registry::is_registered`, which fails
CLOSED: an unregistered key denies. So a typo in this table is not a crash — it is a route
that silently 403s for every token, with nothing in the failure naming the cause. Three
things already validate permission keys, and I checked each:

- `validate_keys` — validates a TOKEN's claims at mint time (`routes/tokens.rs:363`); it
  never sees this table;
- `permission_registry_tests` — covers the permission CONSTANTS and the role PRESETS;
- the drift guards — `read_tiers_tests.rs` (router → map) and `openapi_tests.rs`
  (spec → map) both check that every route HAS an entry; neither checks that the entry's
  KEY is real.

So of the three key tables — permission constants, role presets, read-key map — the map was
the only one never checked against the registry, and it is the one that decides which key
gates which route.

**A guard, not a fix — and I verified that rather than assuming it.** The new test
`every_read_key_map_entry_names_a_registered_permission` PASSES against the current tree,
so all five keys are correct today and no route is mis-gated. To prove the guard has teeth I
temporarily changed one key to `"products:reed"`; it failed and NAMED the offender:

```
READ_KEY_MAP gates these routes with a permission the registry does not know, so they
403 for every token: [("/api/v1/products", "products:reed")]
```

Reverted, so the commit is the test alone (one file, +33). The case carries a floor
(`READ_KEY_MAP.len() >= 5`) so a broken walk cannot make it pass vacuously.

**Severity LOW and stated as such:** nothing is wrong today. This closes the third of three
tables against the registry so a future typo cannot become an invisible denial.

**Verified:** 21 `read_tiers` tests and all 331 `kasirmu-api` tests pass; clippy clean.

**Tally:** 30 findings fixed (8 HIGH), 12 leads disproved. One is a preventive guard rather
than a repair, counted because it closes a real gap in coverage.

---

## Pass 47 — `read_tiers.rs` presets: three grants that open no route

### MSL-23 (LOW, PINNED): the preset tests asserted the key LISTS, never what the keys reach

Continuing the identifier lens onto the preset tables. `read_tiers_tests` covers the preset
CONTENTS exhaustively — `resolve_preset_terminal_binds_read_keys` asserts every key and both
PII exclusions — and `permission_registry_tests` proves every preset key is registered.
**Neither asks whether a preset key gates anything.**

Cross-checking the three presets against `READ_KEY_MAP` (12 entries over 12 paths) found
three grants appearing in **no** map entry:

| preset | grant | routed? |
|---|---|---|
| `dashboard` | `reports:view` | no |
| `dashboard` | `analytics:view` | no |
| `audit` | `audit:view` | no |
| `audit` | `reports:view` | no (same key) |

So an operator who mints an `audit` token gets one carrying two permissions that open
**nothing** — the token can read no route at all. I checked both surfaces before concluding:
neither `kasirmu-api`'s router nor the cloud server exposes a reports/analytics/audit GET;
those surfaces are produced by the cloud server's EMAIL bundle
(`apps/cloud-server/src/email_pg/analytics.rs`), not as read-tier endpoints.

**Severity LOW and stated precisely.** This is over-NARROW, never over-broad: a dead grant
grants nothing, so it is not a security hole. It is also invisible — the preset tests pass,
the registry tests pass, and the token mints successfully carrying permissions that do
nothing.

**Pinned, not "fixed", and the distinction matters.** The right shape is not to delete the
keys (the reports read tier is clearly intended and documented in
`website/.../api-read-tiers.md`), nor to silently allow them. The new test
`preset_keys_that_gate_no_route_are_pinned_explicitly` asserts the dead set is EXACTLY
`{reports:view, analytics:view, audit:view}`, so:

- wiring a `/api/v1/reports*` route and adding map entries makes this test FAIL, telling the
  author to remove that key from `NOT_YET_ROUTED` — the grant now works and the note is
  stale;
- adding any NEW unrouted grant also fails, so a preset cannot quietly accumulate
  permissions that open nothing.

**Verified the guard has teeth** rather than assuming: adding `"nonexistent:read"` to
`AUDIT_PRESET` failed the test with
`left: [analytics:view, audit:view, nonexistent:read, reports:view]`. Reverted, so the commit
is the test alone (+44), carrying a floor on the preset lengths so a broken walk cannot pass
vacuously.

### A process correction

This round I twice reported a test as "not collected" when it was: my filter used `--exact`
with a bare function name, which matches nothing, and a plain filter returning `0 passed` was
reading the wrong run. The test was collected and passing both times. Last round's lesson was
"check that a test is COLLECTED"; the refinement is **check with the right invocation, and
treat `0 passed` as ambiguous between "not collected" and "filter typo" until the run is
inspected.**

**Verified:** 22 `read_tiers` tests and all 332 `kasirmu-api` tests pass; clippy clean.

**Tally:** 31 findings fixed (8 HIGH), 12 leads disproved. Two are preventive pins.

---

## Pass 48 — `kasirmu-api`: the two security warnings bypassed the log stream

### MSL-24 (MEDIUM, FIXED): `eprintln!` on the only signal for a privilege-widening config

Chasing the `read_tiers` thread to the middleware, I checked what happens when the read-gate's
inputs are unusual and found the escape hatches. Then found the real defect: **how they
announce themselves.**

Two security warnings, both guarded by a `std::sync::Once` so they fire once per process:

- `auth::warn_dev_fallback_once` (`auth.rs:105`) — OZ_API_SECRET unset, so every token is
  signed with a **hard-coded constant** and is forgeable by anyone who knows it;
- `routes::tokens::warn_terminal_read_tier_escape_once` (`tokens.rs:382`) —
  `OZ_TERMINAL_READ_TIER=full`, so terminal tokens get `permissions: None` = legacy **full
  read** of every mapped route, defeating the terminal preset by design.

Both wrote with `eprintln!`. **The server does not log through stderr.** `apps/cloud-server`
calls `kasirmu_logging::try_init_json()` / `try_init()`, and that subscriber installs a
**syslog layer** (`crates/kasirmu-logging/src/syslog.rs:104-108`) alongside the fmt layer. So
on a syslog deployment the two messages that matter most — "tokens are forgeable" and
"terminal tokens keep full read" — never reach the log an operator reads. Measured: 2
production `eprintln!` sites against **50** `tracing::` calls in the same crate, and **zero**
after the fix.

**They were also completely untested.** `warn_dev_fallback_once` and
`warn_terminal_read_tier_escape_once` had no test anywhere: dropping either CALL would leave
every suite green while silently removing an operator's only notice.

**Fix.** Both now `tracing::warn!`, keeping the `Once` (one warning per process is the point;
`tracing` has no rate limit of its own). Added
`signing_secret_falls_back_only_when_no_secret_is_supplied`, which pins what IS observable
given the `Once` — the fallback constant's value, that an explicitly supplied secret wins, and
that a BLANK secret is treated as absent rather than becoming the signing key.

**What I deliberately did NOT change.** The escape hatches themselves are a documented product
decision, not a defect: `.env.example:83` labels `OZ_TERMINAL_READ_TIER=full` a *"WIDENING
ESCAPE HATCH — a privilege increase, not a tuning knob"*, spec 0047 records the window, and
the website documents it. The defect was the delivery channel, and that is what I fixed.

### Also checked and cleared on the way

The read gate's fail-open arms (`claims.permissions == None` → pass; route not in the map →
pass) are both documented and deliberate, and the terminal path can only produce `None`
through the escape hatch above. `path_matches` compares segment-by-segment with `{param}`
wildcards, so a template cannot accidentally match a longer path.

**Verified:** all 333 `kasirmu-api` tests pass; clippy clean; no production `eprintln!` remains
in the crate.

**Tally:** 32 findings fixed (8 HIGH), 12 leads disproved. Two are preventive pins.

---

## Pass 49 — `db/recovery.rs`: the restore rollback message could lie

### MSL-25 (MEDIUM, FIXED): a discarded rollback Result emitted "left intact" unconditionally

Chasing the MSL-24 class ("a signal that does not reach its audience") onto discarded
`Result`s. The `Err` arm of `restore_from`'s swap did:

```rust
if had_live {
    let _ = std::fs::copy(&snapshot, db_path);   // <- Result DISCARDED
}
Err(CoreError::Internal(format!(
    "restore rolled back, '{}' left intact: {e}",
)))
```

The message was built **unconditionally**. If the rollback copy failed, the operator was told
their database was *intact* at the exact moment it was destroyed — the worst available untruth
during a restore, because it stops them reaching for the pre-restore snapshot they would need
to recover by hand. The function's own doc over-promised the same thing ("Any failure from
step 4 on restores the live path from the snapshot"), so code and doc agreed on a guarantee
only the happy path met.

**Fix.** The rollback's outcome now decides the message:

- rollback succeeded, there was a live DB → `"restore rolled back, '{}' left intact"`;
- rollback succeeded, there was none → `"...removed as it was before"` (the old wording said
  "left intact" for a database that never existed);
- rollback FAILED → `"restore FAILED and the automatic rollback ALSO failed; '{}' is NOT
  intact. <why>. The original content is in the pre-restore snapshot."` — loud, and it names
  the file the operator must restore by hand.

The no-live-database arm now also treats `NotFound` from the removal as SUCCESS (the goal was
"not there") and reports any other removal error rather than swallowing it.

**The doc was corrected too**, from "restores" to "ATTEMPTS to restore", with the reason
recorded.

**Reachability is stated honestly rather than implied.** The swap-failure arm is not portably
forcible from a test (it needs a rename or re-verify failure that cannot be induced without
platform-specific tricks), so the new test pins the invariant that holds for EVERY failure —
`a_failed_restore_leaves_the_original_database_and_does_not_lie_about_it` drives a refused
candidate and asserts the live file is still there, byte-identical, and that the message does
not claim "left intact" while the file is gone. The swap-arm fix itself is justified by
reading the code, and the ledger says so rather than pretending the test exercises it.

### A self-inflicted error, third occurrence — and it is now the point

The test text was first emitted corrupted: every `"literal"` became
`"literal(s        ) => Q + s + A`. Cause: I wrote a helper named `A` that referenced itself
(`const A = (s) => Q + s + A`), so it injected its own body at every call site. This is the
THIRD round with the same family of mistake (after `format!` inside `assert_eq!`, and `A` used
as both builder and substitution), and it is always in TEST-AUTHORING text generation, never in
production code I hand-write.

Rule now applied without exception: **build Rust source for edits from a plain array of lines
or a backtick template with no self-referential helpers, and compile immediately.** Every
occurrence was caught by `cargo check` within one step, and none reached a commit.

**Verified:** 10 `db::recovery` tests and the full `kasirmu-core` suite pass; clippy clean.

**Tally:** 33 findings fixed (8 HIGH), 12 leads disproved. Two are preventive pins.

---

## Pass 50 — the discarded-`Result` sweep: a lost low-stock alert with no trace

### MSL-26 (LOW, FIXED): the threshold check's failure was dropped, not just non-fatal

Continuing MSL-25's lens onto the remaining `let _ =` sites in the db layer. Most were
justified and are recorded as such:

- `downgrade.rs:126-131` — rollback inside an error path that returns the PRIMARY error;
- `products_images.rs:212`, `refunds.rs:932` — explicit "intentionally unused" bindings;
- `kds_lines.rs:404` / `kds_ops.rs:135` — `let _ = owned;` dropping a guard to control a
  lock's lifetime;
- `mod.rs`, `recovery.rs` temp-file removals — best-effort cleanup of a file nobody reads;
- `stock_counts.rs:166,173` — `ROLLBACK` in a `catch_unwind`-shaped path.

The outlier is `products_stock_adjust/adjust.rs:339`:

```rust
// 4. Synchronous threshold check (ADR-18 §9e-ii).
// Errors are silent — threshold alerts are advisory ...
let _ = self.check_stock_threshold_and_alert_in_tx(tx, ...);
```

Non-fatal is right — an advisory alert must not roll back the caller's stock movement.
**Silent is not.** The function INSERTs/UPDATEs `stock_alert_events`, and
`db/reports/product_sales.rs::active_stock_alerts` reads that table to render the low-stock
list. So a failed check means the operator loses a warning AND gets no log line saying why.
The same function, ten lines above, already `tracing::warn!`s a comparable advisory case
(negative qty not written to the legacy aggregate), so the omission was an inconsistency
rather than a policy.

**Fix.** The error is logged with the product, location and cause, and the comment now says
*non-fatal, not silent* with the reason. Behaviour is unchanged: the adjustment still commits.

**Test, and the premise error I caught in it.**
`a_failing_threshold_check_does_not_block_the_stock_adjustment` blocks every insert into
`stock_alert_events` with a test-only `RAISE(ABORT)` trigger, then asserts the adjustment
still lands. My FIRST version read the quantity with `get_stock` and failed
(`left: 0, right: -3`) — because `get_stock` reads the legacy cross-location `inventory`
aggregate, which is 0 until the first aggregate write, while `seed_everything` populates
`stock_summary`. The premise about the starting quantity was mine, not the code's. Fixed by
reading the canonical per-location surface directly, and the case now proves what it claims:
zero alert rows written, and the deduction applied anyway.

**A splice error, fourth occurrence — all in test authoring.** Inserting the test consumed the
`#[test]` attribute of the following function (`threshold_no_alert_when_above_threshold`),
which clippy caught as an unused function, plus a duplicated attribute on mine. Repaired, and
that test is live again. The recurring shape: my `old_string` anchors land on text that also
occurs inside a neighbouring item. **Mitigation now: anchor on the LAST few lines of the file,
or on a string unique to the target, and re-read the region after inserting.**

**Verified:** 159 `db::products` tests and the full `kasirmu-core` suite pass; clippy clean.

**Tally:** 34 findings fixed (8 HIGH), 12 leads disproved. Two are preventive pins.

---

## Pass 51 — the tax-rate probes: a DB failure reported as "no such rate"

### MSL-27 (MEDIUM, FIXED): `.ok()` collapsed every DB error into the absence case

Extending the dropped-error lens from `let _ =` (MSL-26) to `.ok()`, which discards an error
just as completely. Judged each candidate rather than sweeping:

- `customers.rs` (10 uses) — all on VALIDATORS (`Email::new`, `Phone::new`), where an invalid
  stored value legitimately becomes `None`. Correct, left alone.
- `profile.rs:368` — a decryption collapse that is documented, and whose write path re-derives
  the three states through `StoredCipher` so an unreadable ciphertext is never nulled out.
  **Exemplary**, and the direct opposite of this finding.
- `profile.rs:542` — a read accessor behind `SensitiveWritePolicy`. Correct, left alone.
- `tax/scopes.rs` (10) — the outlier: TEN `.ok()` and ZERO `.optional()` or explicit
  `QueryReturnedNoRows`, in a crate that uses `.optional()` 38 times and the explicit match
  19 times.

**The defect.** `rusqlite::query_row(...).ok()` maps EVERY error to `None`, not just
`QueryReturnedNoRows`. Two sites then turned that `None` into a POSITIVE CLAIM:

- `update_tax_rate_scoped` — a DB failure became `NotFound { entity: "tax_rate" }`, i.e.
  *"this tax rate does not exist"* while the row was present and the database was failing;
- `validate_scope_target` — a DB failure became `Validation { "no {table} {id:?}" }`, *"your
  scope target does not exist"* for a target that did exist.

Both are wrong diagnoses **on the money path**, and both hide the real fault: an operator
acting on either message goes looking for a data problem that is not there.

**Fix.** `.optional()?`, the crate's standard idiom — it maps ONLY `QueryReturnedNoRows` to
`None` and propagates anything else. Added the `OptionalExtension` import. Behaviour is
identical on every non-error path.

**Proven by regression, not asserted.**
`a_db_failure_in_the_rate_probe_is_not_reported_as_not_found` forces a REAL DB error by
renaming `tax_rates` mid-test, then asserts the failure is not `NotFound`. It PASSES with the
fix and, with the fix reverted, FAILS with exactly the predicted diagnosis:

```
a DB failure must not be reported as NotFound ... got
NotFound { entity: "tax_rate", id: "01a0d687-..." }
```

The fix was then restored. That is the strongest evidence available here — the test was
watched catching the bug it describes.

**The other `.ok()` sites in the file were left alone**, deliberately: `tax_rate_window`,
`tax_rate_scope`, `location_legal_entity`, the scope-claim probe and the erase probe all
return `Ok(None)` / `Ok(false)`, where collapsing an error to the absence answer is the
documented read semantic rather than a wrong diagnosis. Only the two that make a CLAIM were
changed.

**Verified:** 135 `db::tax` tests and the full `kasirmu-core` suite pass; clippy clean.

**Tally:** 35 findings fixed (8 HIGH), 12 leads disproved. Two are preventive pins.

---

## Pass 52 — `sales_lifecycle.rs`: a failed recipe read settled the sale without deducting

### MSL-28 (MEDIUM, FIXED): `.unwrap_or_default()` turned a read failure into "no recipe"

Continuing the silent-fallback lens from `.ok()` (MSL-27) onto `unwrap_or_default()` on a
`Result`. One site in the money path stood out, because it has a SIBLING that disagrees:

```rust
// sales_lifecycle.rs:228  (shortfall settlement door)
let recipe = match product_info.as_ref() {
    Some((pid, _)) => self.get_recipe_ingredients(pid).unwrap_or_default(),
    None => vec![],
};

// sales_checkout.rs:259   (checkout door, SAME read)
let recipe = self.get_recipe_ingredients(pid)?;
```

A DB failure in the first becomes an EMPTY recipe, which flips `has_recipe` false, which flips
`needs_stock` false — and the line is never deducted. The sale settles with inventory
under-reported and no error anywhere.

**Narrowing the reachability took two attempts, and the first was wrong.** My initial test used
a `retail` product and PASSED against the unfixed code, so I instrumented it rather than
declaring the lead dead: `result_is_ok=true`, because a retail product has
`tracks_inventory() == true` and deducts regardless of the recipe. Re-reading
`ProductType::tracks_inventory` (`modules/inventory/src/models.rs:132`) showed the only false
case is `service`. So the defect needs a **service product whose stock comes solely from its
recipe** — then `has_recipe` is the only thing making `needs_stock` true.

With that fixture the deviation is measured: the sale returned `Ok` (`result_is_ok=true`) while
the ingredient's stock stayed at **10** (`left: 10, right: 9`). Silent success, no deduction.

**Fix.** `?`, matching the checkout door. After the change the same test shows
`result_is_ok=false` with `database error: no such table: product_recipes` — the real cause,
propagated. The test asserts the error names `product_recipes` and that the ingredient still
holds 10, so it pins both the propagation and the rollback.

**Verified:** 190 `db::sales` tests and the full `kasirmu-core` suite pass; clippy clean.

### A note on an earlier finding converging

Commit `0b480dabb` (another agent) amended a bridge paused-capabilities assertion "to the MSL-13
explicit-verdict rule" — i.e. a sibling suite was reconciled with the semantics MSL-13 changed.
Verified green here (`kasirmu-bridge --lib subscription`: 34 passed). Worth recording that a
cross-crate semantic change can land in a test another lane owns, and the lane notices.

**Tally:** 36 findings fixed (8 HIGH), 12 leads disproved. Two are preventive pins.

---

## Pass 53 — receipts dated in the wrong business day for an IANA-configured store

### MSL-29 (MEDIUM, FIXED): two paths, one stored `timezone`, two different days

Still on the silent-fallback lens, this time on a **fallback that is itself documented**
elsewhere. `db/reports/datetime.rs` states the contract for `locations.timezone`:

*"`'+HH:MM'` / `'-HH:MM'` / `'UTC'` / **an IANA zone name** — the last resolved through
`crate::timezone::offset_for_zone`, so reports and the tax path agree on the business day."*

`parse_utc_offset` implements exactly that, and warns when it cannot resolve. But
`receipt_code.rs::offset_seconds` reimplemented a NARROWER parser — only the numeric forms and
`UTC`/`Z` — so an IANA name was treated as "a value core cannot interpret" and fell to UTC.

**Measured, not reasoned.** 2026-09-18T23:30:00Z is 2026-09-19 06:30 in Jakarta, so:

```
resolve_receipt_date(..."Asia/Jakarta") -> left: "260918"  (UTC)
                                          right: "260919"  (the reports path's day)
```

The consequence is wider than a misprinted day: that date feeds BOTH the printed `yymmdd` and
the `fiscal_year` passed to `claim_receipt_sequence` (`receipt_code.rs:336-337`), so the receipt
can be numbered inside the **wrong fiscal year's** sequence. And `receipt_code.rs` contains
**zero** `tracing::` calls — no signal at all — while its documented mirror `tz_modifier` warns
on precisely this fallback ("silently bucketing a day's revenue in the wrong zone is exactly the
failure this warn exists to surface").

**Fix.** `offset_seconds` now delegates to the same `parse_utc_offset` the reports path uses
(through its `pub(crate)` re-export), normalising `Z` first since that one spelling lives only in
the old parser. The two paths can no longer disagree on one stored value, and an unknown name
still falls back to UTC — `is_known_zone` is what keeps "this store is on UTC" distinguishable
from "unresolvable", which is the property the shared helper already had.

**The pre-existing test had to change, and that is the finding in miniature.**
`resolve_receipt_date_honours_the_location_offset` asserted the OLD behaviour —
`assert_eq!(yymmdd_utc, "260918")` under the comment *"A value core cannot interpret (an IANA
name) falls back to UTC"*. That assertion WAS the divergence, written down as intent. Updated to
the resolved day, with the old value quoted in the comment and a pointer to the new case that
still pins the genuine unknown-name fallback.

**Verified:** 16 `receipt_code` tests and the full `kasirmu-core` suite pass; clippy clean.

### Process note

Two linker failures (`rust-lld.exe`, exit 1) appeared mid-round from concurrent-agent contention
on `target/`; a wait-and-retry cleared it. Separately, my test insertion again split a
neighbouring function's header from its body ("cannot test inner items") — the FIFTH occurrence
of this anchor trap, caught by the compiler each time. The mitigation recorded last round (anchor
on the file's last lines, or a unique string) was not applied here, so it is now promoted from a
note to a rule I state before every append.

**Tally:** 37 findings fixed (8 HIGH), 12 leads disproved. Two are preventive pins.

---

## Pass 54 — `kasirmu-api` routes: the tz-interpolation and idempotency leads, both disproved

A reading round on the API surface, following MSL-29's lens (two places interpreting one value).
Three leads pursued, three disproved — recorded because a negative result that cost real work is
worth keeping.

**1. The `tz_modifier` SQL interpolation is genuinely injection-safe.** Twenty-seven call sites
interpolate the offset into `format!`-built SQL (`format!("DATE(s.created_at, '{tz}')")`, e.g.
`popularity.rs:246-255`). The safety argument is that `tz_modifier` output is validated by
`parse_utc_offset`. Verified at the source rather than trusted: `parse_fixed_offset` returns only
`"+00:00"` (the `UTC` literal arm) or a **6-byte** string whose bytes 1,2,4,5 are ASCII digits and
whose hour/minute are range-checked; the IANA arm returns `FixedOffset`'s `Display`, which is
`±HH:MM` by construction. An unresolvable value never reaches the SQL — `tz_modifier` substitutes
`"+00:00"`. No input can place a quote or a semicolon in that position.

**2. The sales idempotency guard IS fully tested — my first search just missed the file.**
`routes/sales_tests.rs` has 13 cases and none touch `guard_key`/`guard_key_reject`/`claim_sqlite`, so I
started writing a test for the unpinned claims. Grepping for the guard's own identifiers then found
`routes/sales_idempotency_tests.rs`, with dedicated coverage of both load-bearing properties:
`guard_key_absent_or_blank_is_unguarded` (absent, empty AND whitespace-only are all unguarded) and
`guard_key_is_taken_verbatim` (no trimming, no case folding). 10 cases, all green. The "never
normalised" claim is pinned, and a second grep on the FUNCTION NAMES rather than the test-file name is
what found it.

**3. The settings route's tenant scoping is consistent across both engines.** `scoped_key(base,
tenant)` is the isolation primitive; `get_setting_scoped_pg` (Postgres) and the `get_scoped` closure
(SQLite) implement the same resolution order — scoped row first, bare key as fallback — and the doc at
`settings.rs:153-163` explains why it reads the SCOPED row rather than the bare one
(`Store::merged_smtp_password_json` is pinned to the bare key, which is the desktop's single-tenant row;
merging against it "would carry some other tenant's secret into this one"). The F-029 decryption
failure is fail-closed with a logged error. Both branches agree.

**What this round actually bought.** Two of the three checks confirmed a security argument that existed
only as a COMMENT (the injection-safety claim and the tenant-scoping rationale), which is the same class
as MSL-22: a stated guarantee with no mechanical check behind it. I did not add tests for them this
round, because the properties are structural (a 6-byte range-checked shape; two identical closures)
rather than behavioural, and a test asserting `parse_fixed_offset`'s output shape would restate its
implementation. Recording the verification in the ledger is the honest deliverable.

**No findings in this pass**, and that is a statement about what was read: `routes/{sales,settings,
tokens}.rs` and the idempotency guard are clean. `routes/{images,tax_rates,products,exchange_rates,
memos,plans}.rs` remain unread.

**Tally:** 37 findings fixed (8 HIGH), 15 leads disproved. Two are preventive pins.

---

## Pass 55 — `routes/tax_rates.rs`: a DB failure reported as a tenant mismatch

### MSL-30 (MEDIUM, FIXED): `.unwrap_or(None)` on the scope probe, in a crate whose twin propagates

Reading the unread `kasirmu-api` routes, `tax_rates.rs` (413) — the hub's scoped-rate authoring door,
and the only surface that can write a scoped rate (manager ruling D8).

`check_scope_target_sqlite` (`:178`) refuses a scope target that is not a row of THIS tenant, and its
guard read was:

```rust
let owner: Option<String> = db
    .query_row(&sql, params![target], |row| row.get(0))
    .unwrap_or(None);          // <- every rusqlite error becomes None
if owner.as_deref() != Some(tenant_id) { /* "does not reference an existing {table} of this tenant" */ }
```

`tenant_id` is `TEXT NOT NULL` on both tables, so the `Option` comes from `row.get`'s generic, not from
nullability — meaning `.unwrap_or(None)` maps **every** `rusqlite::Error` to `None`, which then fails the
tenant comparison. A broken query is reported as *"legal_entity_id 'le-1' does not reference an existing
legal_entities of this tenant"*.

**The Postgres twin does it right, one file over.** `pg::scope_target_exists` (`pg.rs:443-447`)
propagates: `.map_err(|e| PgError::Db(e.to_string()))?`. Same check, same purpose, opposite failure
policy — and the swallow produces a *wrong diagnosis* that also hides the fault.

**Proven by a watched regression.**
`a_db_failure_in_the_scope_probe_is_not_reported_as_a_tenant_mismatch` seeds a legal entity that DOES
belong to the tenant, then renames `legal_entities` so the probe's own read fails, and asserts the
response does not carry the tenant-mismatch text. Against the unfixed code it fails with exactly the
predicted body:

```
400 Bad Request {"error":"legal_entity_id 'le-1' does not reference an existing legal_entities of this tenant"}
```

With `.optional()?` it passes. The fix was then reverted, the failure re-observed, and the fix restored —
so the test is known to catch the bug it describes.

**Verified:** 22 `tax_rates` tests and all 334 `kasirmu-api` tests pass; clippy clean.

**Note on the class.** This is the third instance of the same shape in three passes — MSL-27 (`.ok()` on
a tax probe), MSL-28 (`unwrap_or_default()` on a recipe read), MSL-30 (`unwrap_or(None)` on a scope
probe). In all three the giveaway was a SIBLING that handles the same read correctly: `optional()?`,
`?`, `.map_err(Db)?`. **The sibling-divergence lens is now the single most productive method in this
audit** — it produced MSL-25, 27, 28 and 30, and every one was found by comparing two call sites of one
function rather than by reading either in isolation.

**Tally:** 38 findings fixed (8 HIGH), 15 leads disproved. Two are preventive pins.
---

## Pass 56 — the swallow shapes, swept workspace-wide: MSL-30 was not alone

MSL-30 was the third instance of one shape in three passes, so this pass stopped reading files and
enumerated the shape instead: every production (non-test) occurrence of `unwrap_or(None)`,
`.ok()`, and `unwrap_or_default()` applied to a `Result`, then judged each by asking *what does a
failed read look like downstream?* Twelve production `unwrap_or(None)` sites in four files. Three of
the twelve were live defects; the rest are recorded below as judged-benign so the next pass does not
re-derive them.

### MSL-31 (MEDIUM, FIXED): the same file, the same probe, the update path

The sweep found `tax_rates.rs:401` — the file from the PREVIOUS pass — carrying the identical
`.unwrap_or(None)` on the **update** path's tenant-ownership probe. `check_scope_target_sqlite`
had been fixed on the create path; `update_tax_rate` reads `tenant_id` to prove the row belongs to
the caller before core's tenant-blind update runs, and swallowed the same way. A failing read
failed `owner.as_deref() != Some(tenant_id)` and answered
`NotFound { entity: "tax_rate" }` — "no such rate" while the rate exists and the database is what is
broken.

Fixed with a `match` rather than `?`, because `update_tax_rate` returns `Response`, not `Result`:
a DB error now returns `store_error_response(CoreError::Db(e))`. Test
`a_db_failure_in_the_update_owner_probe_is_not_reported_as_not_found` creates a rate, renames
`tax_rates` so the probe fails while the row stays present, and asserts the response is not `404`.
Watched failing with `assertion left != right failed: a DB failure must not be answered as NotFound
-- the rate exists`, then restored. 335 `kasirmu-api` tests pass; clippy clean. Commit `a9f05200a`.

**The lesson is about the sweep, not the bug.** I had READ this file end-to-end the pass before and
found only one of the two instances, because I was reading for the *finding* rather than for the
*shape*. The enumeration found the second one in a file I had just declared clean.

### MSL-32 (MEDIUM-HIGH, FIXED): a failed ledger read answered as the wall clock

`subscription.rs:582-593`, `compute_max_ledger_timestamp`: two `MAX(created_at)` reads, both
`.unwrap_or(None)`. The `(None, None)` arm below is *defined* as "no ledger data — use
`Utc::now()`", so **a database that could not answer the query was indistinguishable from an empty
ledger**, and the function returned the system clock.

Every consumer of that value is a clock-tampering defence, and each one is defeated by handing it the
wall clock — confirmed by reading all four callers, not assumed:

- `validate_clock_rollback` (`:620`) compares the result against `Utc::now()`. Given the wall clock
  it compares the clock **against itself** and passes. Its callers are the write gates:
  `workspaces.rs:291,377,544,596,721`, `products.rs:687`, `terminals.rs:475`,
  `topology/commands.rs:705`, `auth.rs:631`.
- `effective_tier_for_connection` (`:944`) is the fail-CLOSED tier resolver — its doc comment says
  "missing/tampered data degrades to Free" — reached from
  `db::quota_gate::Store::resolve_tier_fail_closed`. The wall clock is the one input that makes it
  **over-credit** (a live subscription reads as within grace) instead of degrade.
- `get_license_status` (`bridge/license.rs:770`) reports the failure as `ClockTampered` and puts the
  database's error text in the user-facing `message`: a wrong diagnosis, and the same shape as MSL-30/31.
- `pos_read_only_for_connection` (`:1086`) fails closed to `true` either way, so it is unaffected —
  worth recording, because it is the one caller the bug does NOT change.

Fixed by propagating both reads (`?`). The function already returned `Result<String, CoreError>`, and
all four callers already handle `Err`, so nothing else changed.

**Proven by a watched regression — and my first attempt at the falsification was wrong.**
`a_broken_ledger_read_is_not_reported_as_an_empty_ledger` renames `sales` and `audit_log` away and
asserts `compute_max_ledger_timestamp` errors. I reverted only the `sales` read and re-ran: the test
**passed**. The reason is that the `audit_log` read still had `?` and propagated — so the revert was
incomplete, not the test. A temporary probe confirmed both reads really were failing
(`PROBE sales err = Err(...no such table: sales)`), after which I reverted **both** reads and the test
failed exactly as predicted:

```
a failed ledger read must not be answered as an empty ledger;
  got Ok("2026-09-25T04:14:01.608096200+00:00")
```

Fix restored, probe deleted, 3314 `kasirmu-core` lib tests pass, clippy clean. Commit `cf75e96ca`.

**Process correction.** "Watch the test fail" is only meaningful if the revert restores the ENTIRE
defect. Reverting half of a two-site bug leaves the other site propagating and the test green — a
false pass that would have gone into the ledger as a verified pin. The probe is what caught it; the
rule from here is to re-run the probe *or* revert every site the test claims to cover.

### MSL-33 (MEDIUM, FIXED): a settings read failure answered as `false` on the local-API enable flag

`kasirmu-local-api/src/lib.rs:281,289` — `is_enabled` and `resolve_port` both `.unwrap_or(None)` on
`Settings::get`, which returns `Result<Option<String>, CoreError>`. Both live in a file whose own
siblings make the opposite choice, and state why: `resolve_store_id` (`:135`) uses `.ok().flatten()`
and **documents** the degradation ("silently degrades to primary rather than failing the boot
auto-start"), while `load_or_create_secret` (`:312`) propagates with `.map_err(...)?`.

The two swallow sites are the divergence: no documented rationale, and the failure direction is not
the safe one. `is_enabled` decides whether an **HTTP surface is exposed**; a failed read answered
`false` is silent (the merchant ticked the box and the API simply never came up) and is a
false-negative on a security-relevant surface. `resolve_port` silently substituted `DEFAULT_PORT`.

Fixed by returning `Result` from both, mirroring `load_or_create_secret`:
`is_enabled(&conn) -> Result<bool, String>`, `resolve_port(&conn) -> Result<u16, String>`, with the
read propagated via `.map_err(|e| format!("reading {KEY}: {e}"))?`. The two *value* cases are
unchanged and still pinned by the existing tests — absent / unparseable port falls back to
`DEFAULT_PORT`, `"0"` reads as disabled — because those are stored values this function is specified
to reject, not database faults.

Four call sites updated, each in the direction its own signature already wanted:
`commands/local_api.rs:70` (`prepare`, already `?`-propagating a settings read one line later) and
`build_status` (`:107`, already `Result<LocalApiStatus, AppError>`) now propagate; the two boot
auto-start sites in `apps/desktop-tauri/src/lib.rs:887,907` log a warning and fall back to `false`
rather than aborting the app launch. `cargo check -p kasirmu-app --all-targets` clean.

**Proven by a watched regression.**
`a_failed_read_of_the_enabled_flag_is_not_answered_false` renames `settings` away and asserts both
functions error. Watched failing against the reintroduced swallow with exactly the predicted message
("a failed read must not be answered `false` -- that is indistinguishable from the merchant
disabling it"), then restored. 19 `kasirmu-local-api` tests pass; clippy clean. Commit `d05f5203e`.

### Judged benign, with the reason (so no later pass re-derives them)

- `kasirmu-core/src/db/mod.rs:622-628` — `row.get(...).unwrap_or(None)` for
  `brand`, `rack_location`, `notes`, `unit`, `default_supplier_id`, `image_hash`. These are
  **column** reads, not query reads: the `Result` is `FromSql` conversion for a nullable column, so
  the `Option` is the column's nullability coming through the generic, and the fallback is exactly
  the schema's `NULL`. No failed read is being hidden. Genuinely correct.
- No other production `unwrap_or(None)` sites exist in the workspace (verified by enumeration, not
  sampling).

### The class, restated

Six instances now: MSL-27 (`.ok()` on a tax probe), MSL-28 (`unwrap_or_default()` on a recipe read),
MSL-30 (`unwrap_or(None)` on a scope probe), MSL-31 (its sibling in the same file), MSL-32 (a ledger
read answered as the wall clock), MSL-33 (a settings read answered as `false`). The tell is the same
every time and it is not the operator — it is the **branch the `None`/default lands in**. A default is
safe when it means "absent" and dangerous when the code downstream treats it as an *answer*: a
tenant mismatch, an empty ledger, a disabled flag. Ask what the default lets through, not whether the
operator is spelled `unwrap_or(None)` or `.ok()`.

**Tally:** 41 findings fixed (8 HIGH), 15 leads disproved. Two are preventive pins.
---

## Pass 57 — `routes/images.rs` clean, and MSL-34: the one axis with a bare `find_map`

### `images.rs` (517) — no findings, and the swallows are decisions

The largest remaining unread `kasirmu-api` route, and the only one wrapping a filesystem. Read end
to end. It carries **three** swallow-shaped fallbacks, and every one is a documented decision with a
loud warning rather than an oversight — which is the distinction this sweep exists to draw:

- `get_image_pack` (`:423`): a failed `image_ref_exists` reads as "unreferenced" and skips the frame.
  The comment states the direction AND the reason: *"Fail-CLOSED by decision, not by accident: this is
  the content-spine tenancy gate, so an error must read as 'not referenced' … Skipping is recoverable
  … but it is otherwise silent, so name it."* It is named — `tracing::warn!` with the tenant, the hash,
  the operation and the error.
- `get_image_missing` (`:508`, `:525`): both the PG and SQLite legs answer an empty set on error, and
  the comment explains that this endpoint only REORDERS the desktop push queue (the uploaded set comes
  from `image_push.rs::peek_push_batch`, never from this list) — so failing the request would be worse
  than an empty answer. It goes further and names the cost: *"an empty answer is now AMBIGUOUS: it
  means either 'nothing is missing' or 'the lookup failed', and the warning is the only way to tell
  them apart."*
- `process_image` / `store_image_atomic`: the temp+rename race is handled explicitly (a concurrent
  winner is treated as a duplicate, not an error), and a refcount failure rejects the image.

The module header discloses the residual abuse surface without being asked: PUT accepts any tenant JWT
and *"no per-tenant byte quota or rate limit exists: an authenticated tenant can fill the volume by
repeatedly hitting the 32 KB / 512 KB caps."* That is a product decision about a device cohort holding
valid credentials, correctly recorded as accepted rather than left to be rediscovered.

**Judged benign in the same sweep** (so no later pass re-derives them):

- `products.rs:276-283` — `TenantSubscription::load(&db, tenant_id).ok().flatten()` feeding a tier, then
  `.unwrap_or(Free)`. The comment says why: *"An unknown or tampered subscription fails closed at the
  Free cap."* Every arm (`Err`, `None`, bad signature) lands on `Free`, the most restrictive tier. A
  fail-closed default, not a swallow.
- `terminals.rs:134` — `body.label.unwrap_or_default()` is a request-body default, not a read.
- `attestation.rs:361` — `source_for(origin).unwrap_or(OriginSource::Main)` labels an origin that
  already passed `probe_origin_with`. The fallback is a classification tag for the log line, not a
  trust decision, and every rung of the compiled ladder has a `source_for`.

### MSL-34 (MEDIUM, FIXED): `country_code` was the one axis not going through `pick`

`regional.rs` (519) was the largest core module with **zero** ledger coverage. Its `RegionalConfig::resolve`
walks a narrowest-first layer chain taking the first non-blank value per axis. Three of the four axes
call `pick`, which re-checks blankness per layer:

```rust
fn pick(layers, get, default) -> RegionalValue {
    for layer in layers {
        if let Some(value) = get(layer).and_then(|v| blank_to_none(&v)) { … }   // <- the re-check
    }
}
```

and `pick`'s own doc says why the re-check is there rather than trusted from the constructors:
*"`RegionalLayer`'s fields are public, so a caller that builds one directly (the tests do, and so will
the IPC mapping in Slice 2) can put `Some("   ")` in a field. 'Blank means inherit' is the contract of
the whole chain, not of one constructor."*

The fourth axis did not:

```rust
let country_code = layers.iter().find_map(|layer| layer.country_code.clone());   // no blank re-check
```

So a blank market on a **narrow** layer stopped the walk, where a blank locale/timezone/currency would
have been skipped. `Some("")` is not `None`: it is a country-shaped value nothing validates, and the
fiscalisation path carries it as the market. This is the sibling-divergence lens applied *inside one
function* — three arms of one `Self { … }` literal sharing a rule, the fourth not.

**Severity is MEDIUM, not HIGH, and the reason is worth recording.** Every production layer is built by
`RegionalLayer::blank` (`db/regional.rs:92,109`), which applies `blank_to_none` itself, so the shipped
DB path cannot currently produce the shadowing — verified by reading the constructor, not assumed. The
defect is live for the direct-literal construction that `pick`'s doc explicitly anticipates ("so will
the IPC mapping in Slice 2"), which is where it would have shipped. Ranked as a latent wrong-turn on a
path the module documents as imminent, not a wrong answer today.

**Proven by a watched regression.** `a_blank_market_does_not_shadow_a_declared_one` builds a location
layer carrying `Some("")` and an entity layer declaring `"ID"`, and asserts `"ID"` wins; it repeats the
case with `"   "`. Against the unfixed code it fails with exactly the predicted pair:

```
assertion `left == right` failed: a blank market must mean "not set here", so the entity's declared market wins
  left: Some("")
 right: Some("ID")
```

The existing `country_code` tests did not catch it because both build their layers through the test
helper `layer()` — a raw struct literal that bypasses `blank_to_none` — yet only ever pass `None`, never
`Some("")`. The fix reuses `blank_to_none` on the market axis. Fix reverted and the failure re-observed
(41 passed / 1 failed), then restored: 42 `regional` tests pass, 3315 `kasirmu-core` lib tests pass,
clippy clean. Commit `87b60078f`.

### Corrections and closures

- The `bridge` suite that returned no output in pass 56 completed on re-run: **1400 passed, 0 failed**
  (869s). The earlier silent result was a harness artifact, not a failure — the run is now on record.
- `kasirmu-core` clippy caught a `redundant_closure` in my own first fix
  (`.and_then(|v| blank_to_none(v))` → `.and_then(blank_to_none)`). Fixed before commit; the lint is
  why the commit shows the narrower form.

**Tally:** 42 findings fixed (8 HIGH), 15 leads disproved. Two are preventive pins.
---

## Pass 58 — MSL-35: a terminal token could skip the memo-write admin key

### The finding, from a sibling divergence on a security gate

`routes/memos.rs` (216) was unread. Its write guard `require_tenant_write` is a documented sibling of
`routes/tokens.rs::require_admin_write`, and the two do not agree:

```rust
// require_admin_write (tokens.rs:158-175) -- TWO defences:
if !admin_key_authorised(headers, configured) { return 401; }
if claims.terminal_id.is_some()               { return 403; }

// require_tenant_write (memos.rs:53) -- documented as mirroring it, but:
if claims.terminal_id.is_none() && !admin_key_authorised(headers, admin_key) { return 401; }
```

The memos condition is **inverted**: the admin-key check only runs when the token has NO
`terminal_id`. So any token carrying a terminal scope skipped the admin key entirely on
`POST /api/v1/memos/sync` — the tenant-wide memo reconciler (upsert + delete-by-omission).

**The giveaway was the comment, not the code.** The sentence directly above the guard said the
exemption applied *"only when the deployment chose to allow terminal credentials at all"* — and the
function never consulted `AppState::allow_terminal_credentials`. Grepping it across the file returns
**zero** hits. The sibling that MINTS terminal tokens does check it (`tokens.rs:198`), so the two
disagreed about when a device credential is legal at all.

### Severity, and why I did not call it HIGH

Reachability was measured, not argued. The desktop local API sets
`allow_terminal_credentials: false` (`kasirmu-local-api/src/lib.rs:434`) and mounts these routes anyway
— `router_with_openapi` is called with that same state, and `/api/v1/memos/sync` is registered in the
shared `router()` (`kasirmu-api/src/lib.rs:357-360`). So the route IS mounted on a surface that
disabled device credentials. What saves it today is the other end: the only production mint of a
terminal-scoped token is `tokens.rs:236`, gated by the same flag at `:198`, returning 400 before it can
reach `create_token_full`. **No terminal token can currently exist on that surface**, which makes this a
latent defence-in-depth divergence rather than a live hole — MEDIUM, with the reachability written down
so the next reader does not have to re-derive it. It becomes live the moment any of the three conditions
changes: the flag flips, the mint gate is relaxed, or the check moves behind a different surface.

### Proven, after my first two attempts at the test were WRONG

The fix makes the guard mirror its sibling: a terminal-scoped token is refused outright (403
`terminal_scope_disabled`) when the embedder disabled device credentials, and the admin key is then
required of every caller that gets past it. The tenant still comes from the claims, never the body, so
cross-tenant isolation never depended on either branch.

**The test was wrong twice, and both times the falsification is what caught it.** First draft asserted
`assert_ne!(resp.status(), OK)`. Disabling the new guard left the test GREEN — a probe showed why: the
request then fell through to the *other* defence (the admin key) and returned 401, which is still "not
200". I then restored the exact pre-fix guard and measured: **503** (`pg_unavailable`) — the request had
walked past the admin-key check entirely and reached the backend branch. So the defect was real and my
assertion simply could not see it.

Rewritten to name the status (`assert_eq!(403)`), the falsification finally bit:

```
left: 503
right: 403
```

which is the pre-fix behaviour stated exactly. Fix restored: 336 `kasirmu-api` lib tests pass (was 335),
clippy clean, `bridge` 1400 pass. Commit `bc7389f8c`.

**Process correction (third of its kind, and the sharpest).** `assert_ne!(x, OK)` on an HTTP status is
not a security assertion — it passes for every unrelated failure the request might hit on its way
through the layers, including the very layer under test. A test that pins an authorization decision must
name the status AND the branch that produced it; where several defences sit in a row, only the exact code
distinguishes "this defence fired" from "a later one did". Both earlier rewrites would have entered the
ledger as verified pins while being blind to the thing they claimed to pin.

### Also read, no findings

- `desktop_link.rs` (506) — PKCE + device-link client. Disciplined throughout: `.map_err` with context on
  every call, an empty `authorizeUrl` rejected explicitly, and the verifier-length constraint documented
  as caught by a test rather than by inspection ("RFC 7636 requires at least 43, so Google rejects the
  shorter value outright").
- `service_health.rs` (362) — `aggregate` returns `Unknown` for an empty set, and `severity_rank` ranks
  `Unknown` BEST, both with the reasoning stated: a rollup should report "the worst thing we actually
  know", not flicker with polling order. Correct and load-bearing in the right direction.
- `memos.rs` read path — every deviation is annotated, including why an admin-minted token may query any
  terminal's memos while a terminal token may not name another.
- A workspace-wide `find_map` census confirms MSL-34 was the ONLY instance of that shape.

**Tally:** 43 findings fixed (8 HIGH), 15 leads disproved. Two are preventive pins.
---

## Pass 59 — the authz-gate sweep: no findings, and two of my own false trails

MSL-35 was an authorization-gate divergence, so this pass stopped reading files and enumerated every
gate decision in `kasirmu-api` instead: all 24 production sites of `admin_key_authorised`,
`require_admin_write`, `terminal_id.is_*`, `allow_terminal_credentials` and `SingleTenantSurface`. There
are now four distinct gate shapes in the tree, and the sweep is what makes their relationships
auditable in one view:

| shape | sites | admin key | terminal scope | claims? |
|---|---|---|---|---|
| `require_admin_write` | products x2, tax_rates x2, exchange_rates x2 | yes | deny | yes |
| `users.rs::may_manage_users` + inline key | users | yes | deny | yes |
| `require_tenant_write` | memos::sync | yes | flag-gated (MSL-35) | yes |
| bare `admin_key_authorised` | settings x2, plans x1, terminals x1, tokens x2 | yes | n/a | **no** |

### Why the fourth row is correct, not a gap

The bare-key row looked like the same omission MSL-35 fixed — four handlers checking the admin key with
no terminal-scope test alongside it. It is not, and the reason is checkable rather than arguable:
**those handlers do not take `Extension<ApiTokenClaims>` at all.** `settings.rs` and `terminals.rs`
contain zero references to the claims type; `plans.rs`'s only two references are the import and the
*read* handler's extractor (`:41`), not the write handler at `:89`. With no tenant claim in scope there
is no terminal identity to test, and a device credential can satisfy an admin-key check no better than
any other caller. A terminal-scope denial would have nothing to read.

### Also verified clean

- `users.rs` hand-rolls both defences instead of calling `require_admin_write`, but in the same order and
  with the same status codes (401 then 403, `insufficient_scope`). A duplication worth noting; not a
  divergence.
- `exchange_rates.rs` serves three GETs with no tenant parameter and no auth claims. Verified this is
  correct rather than assuming: `modules/currency` has **zero** references to `tenant_id`, so these rates
  are global reference data, not tenant-scoped rows.
- `read_tiers.rs` + `read_tiers_tests.rs` — the anti-drift test derives the GET route set by parsing the
  router source, after an earlier hand-typed list let `GET /api/v1/memos/active` pass unchecked. It
  guards against its own vacuous pass (`get_routes.len() >= 10`), requires a *reason* per exemption, and
  its failure mode is a missed route rather than a false alarm. I checked the 13 READ_KEY_MAP entries
  against the router by hand: exact cover, no gaps. This is the model the rest of the audit should
  imitate — a structual check that cannot drift.
- `cache.rs` (505) — every Redis error degrades to miss/noop, the fail-safe direction for a cache; the
  B48 fix (`inventory_invalidation_target`) is precise and its reasoning is preserved verbatim.
- `plans.rs:43` / `memos.rs:46` / `images.rs` — `.unwrap_or("default")` on `claims.tenant_id`. Correct:
  `None` is the legacy single-store token shape, and `create_token_full` only omits the claim for it.

### Two false trails of my own, both caught by checking rather than concluding

1. **"`sync_pull.rs` has no tests at all."** I grepped `sync_pull_tests.rs` for `pin_hash|upsert_users`,
   got nothing, and checked the *sibling* test file — concluding the SYNC-06 credential invariant was
   unmechanized. Wrong: the tests live in `sync_client_tests.rs` (the module is wired as a submodule of
   `sync_client`, `sync_client.rs:264`), and all four pass —
   `apply_snapshot_writes_placeholder_pin_hash_for_new_users`,
   `apply_snapshot_preserves_existing_local_pin_hash_on_conflict`,
   `snapshot_user_with_pin_hash_is_rejected`, `snapshot_user_without_pin_hash_deserializes`. The
   invariant's header claims are all backed. **A grep miss inside one file is not evidence about the
   module; the `#[path]` wiring means the test file can live elsewhere entirely.**
2. **"`plans.rs` has no claims on its write path."** True (verified), but I had first concluded it from a
   truncated read of the handler signature; the grep count of 2 made me look again and confirm which
   handler owns them.

**No defects in this pass.** 336 `kasirmu-api` lib tests and 49 `sync_client` tests pass on the
unmodified tree; nothing was committed. The `bridge` suite re-ran green at 1400 for the third time.

**Tally:** 43 findings fixed (8 HIGH), 15 leads disproved. Two are preventive pins.
---

## Pass 60 — MSL-36: the quota tier was resolved against the wall clock, not the ledger

### What led there, and why the first three probes proved nothing

`entitlements.rs` (307) was unread. Its `from_subscription` resolves the tier with
`sub.effective_tier()` — the WALL-CLOCK reader — while `subscription.rs` has a ledger-time sibling
(`effective_tier_for_connection`) whose whole documented purpose is to resist a local clock rollback.
The census showed the split was lopsided: the wall-clock reader at ~10 sites including the shared read
model, the ledger reader at exactly one (`db/quota_gate.rs::resolve_tier_fail_closed`).

**Three probes failed to demonstrate any divergence before the fourth worked, and each failure was
informative rather than wasted.**

1. Expiry 400 days past, ledger future-dated: both readers said Free. Too far — no grace window involved.
2. Expiry 40 days past with the ledger at real time: both said Free. The two windows coincide whenever
   the clocks agree, which is precisely why the bug cannot be seen by reading either one.
3. Expiry 20 days past (inside Premium's 30-day grace) against real time: both said Premium. Correct,
   and it establishes the baseline the fix must preserve.

The fourth probe is the one that generalises: **the divergence is unreachable while wall time and ledger
time agree, so a unit test cannot produce it by adjusting dates alone** — it has to move one clock
relative to the other. Since the OS clock cannot be changed in a test, the equivalent construction is to
move the LEDGER forward, which is the same relative state a rollback produces.

### The exposure, measured

With the ledger 40 days ahead of a lapsed grace window the two readers disagree exactly as predicted:

```
ledger reader -> Free       (correct: the grace window genuinely lapsed)
wall reader   -> Premium    (grants the paid caps the tenant no longer paid for)
```

Reachability was then checked rather than assumed. `validate_clock_rollback` is the guard that catches a
rolled clock, and it is called at 9 bridge write sites. The five `from_subscription` sites that gate a
capability were each tested for it:

| door | what it grants | rollback guard on path |
|---|---|---|
| `products.rs:702` | product cap | yes |
| `terminals.rs:499` | register cap | yes |
| `locations.rs:235` | location cap | **no** |
| `inventory.rs:116` | warehouse cap | **no** |
| `staff.rs:1126` | staff cap | **no** |
| `history.rs:77` | sales-history window | **no** |

`staff.rs:1122-1126` is the clearest: it loads the subscription, verifies the signature, then enforces
the staff cap from the wall-clock tier — and `ctx.resolve_session` (called earlier at `:1101`)
revalidates the *account*, not the clock. Nothing on that path consults the ledger.

### The fix, and the one site deliberately left alone

`Entitlements::from_subscription_for_connection(sub, conn, usage)` is the ledger-time sibling, added
beside the original rather than replacing it, because the two doors that DO guard the clock are
unaffected and the read-model constructor is cheaper. The four unguarded capability doors now call it.

**`subscription.rs:378` was checked and deliberately NOT changed.** Its `from_subscription` feeds
`load_feature_verdict`, which `subscription.rs:241` documents as "Phase 3 **observability**" and `:457`
as "a diagnostics read". Its only production caller is the explain path (`:478`); enforcement runs
through the scoped `require_permission` gates. A wrong verdict there misreports why a feature is
unavailable — a real but different, lower-severity defect, and changing it would put a ledger query on a
diagnostic read for no enforcement benefit. Recorded so the next pass does not re-derive it.

**A schema risk I checked before committing.** `from_subscription_for_connection` reads the ledger from
the connection it is handed, and the four doors pass different databases (`locations.rs` the store DB,
`inventory.rs` the identity DB, `staff.rs`/`history.rs` the global DB). Had `sales`/`audit_log` been
absent from the identity DB, MSL-32's error propagation would have turned my own fix into a
paying-tenant downgrade. Verified two ways: a probe confirmed both tables in a freshly-migrated DB, and
the project already calls `validate_clock_rollback(&global_db)` at 8 sites — so the global DB is
established as ledger-bearing. Safe, but it was not safe to assume.

**Proven by a watched regression.**
`the_ledger_reader_refuses_a_tier_the_rolled_wall_clock_would_grant` asserts the two readers AGREE with
aligned clocks (guarding against this being a different bug), then moves the ledger and asserts the
divergence. Falsified by making the new constructor delegate to `effective_tier`: it fails with
`left: Premium, right: Free` — the wall-clock answer on the ledger-time path. Restored: 18 `entitlements`
tests and 3316 `kasirmu-core` lib tests pass. Commit `b63f4b382`.

### Process correction: `cargo fmt` wrote to other agents' files

`cargo fmt -p kasirmu-core -p kasirmu-bridge` reformatted **26 files I had not touched** — other
sessions' uncommitted work in `license_tests.rs`, `pos.rs`, `sync.rs`, `kds_devices.rs`, `db/roles.rs`
and more. I reverted all of them and confirmed my six stayed formatted (`--check` re-run, filtering to my
paths). In a shared checkout `cargo fmt` on a crate is a whole-tree write, not a scoped one — the
formatting equivalent of a bare `git commit`. Never run it on a crate here; format the files named in the
diff, or accept `--check` as the gate and leave it to the hook.

**Tally:** 44 findings fixed (8 HIGH), 15 leads disproved. Two are preventive pins.
---

## Pass 61 — MSL-37: my own MSL-36 fix created a caps-payload divergence

### The regression, found by following the fix rather than the code

MSL-36 made the four unguarded capability gates resolve the tier against the LEDGER. That immediately
raised a question about the door I had just touched from the other side: the caps DTO — the payload the
UI renders every gate from — is built by `load_capabilities` → `build_entitlements` →
`Entitlements::from_subscription`, which is the WALL-CLOCK reader. If the two disagree, a rolled-back
install shows Premium caps in the UI while the gate refuses the action: the exact "verdict contradicts
the gate" drift the one-read-model work exists to prevent, and one I would have introduced.

It is real, and the test says so precisely:

```
assertion `left == right` failed: the caps payload must report the tier the gate enforces, not the wall clock's
  left: "premium"          <- dto.tier, what the UI shows
 right: "free"             <- store.resolve_tier_fail_closed(), what the gate enforces
```

The test drives the divergence the way the clock behaves rather than the way a fixture would: it stamps
Premium, expires the row 20 days back (inside Premium's 30-day grace), asserts the aligned-clock answers
AGREE, then moves the ledger 40 days forward — the same relative state a rollback produces — and asserts
they still agree. It also asserts the wall-clock reader still says Premium, so the test would notice if
the fix were reverted rather than silently passing.

### The fix, and why it lives on the trait

Scattering `from_subscription_for_connection` through the bridge would have left the next caller free to
pick the wrong one — the failure mode MSL-36 was. Instead `SubscriptionLoader` gained
`entitlements_for(&self, sub, usage)`, whose **default** is the wall-clock assembly (correct for a loader
with no database behind it, which is what the crate's own tests are) and which `impl SubscriptionLoader
for Store` **overrides** with the ledger-aware one. `build_entitlements` now routes through the loader,
so every database-backed caller gets the ledger tier by construction and only the deliberately
connection-less test loaders keep the old behaviour.

There is exactly one implementor (`Store`) — verified by grep, not assumed — so the default is not a
silent second path for production code.

**A comment this makes true rather than changes:** `load_over_quota_report` already said *"The effective
tier is what the gates enforce — assess against it, not the nominal tier, so the report matches the next
rejection."* Before this fix that sentence was aspirational: the report used the wall clock while the
gates had moved to the ledger. Now it holds.

**Falsified before committing.** Removing the `Store` override makes the test fail with the same
`premium` / `free` pair, so the override — not something else — is what makes it pass. Restored: 3316
`kasirmu-core` lib tests pass, and the full bridge suite is re-run below.

### Correction to my own formatting practice

Last pass I learned that `cargo fmt -p <crate>` writes to other agents' files. This pass I used
`rustfmt --check <file>` to get the exact preferred form for the ONE file I had edited, then applied the
two hunks by hand — and verified the third remaining hunk was a **pre-existing** import-order issue in
that file, not mine, so I left it alone. A scoped `--check` plus a hand edit is the correct form here;
`cargo fmt` on a crate is not.

**Tally:** 45 findings fixed (8 HIGH), 15 leads disproved. Two are preventive pins.
---

## Pass 62 — the census finished: MSL-38 and MSL-39, and the end of the wall-clock class

Last pass ended with a recommendation rather than a new file: the MSL-36/37 pair were the same root cause
found twice, so the high-value work was to **enumerate every remaining wall-clock `effective_tier()`
caller and judge each** instead of reading modules and hoping to notice. That is what this pass did. Nine
raw hits, five real callers after comments and the module under test, and all five are now adjudicated:

| site | what it does | rollback guard upstream | verdict |
|---|---|---|---|
| `db/downgrade.rs:66` | `persist_over_quota_markers` | **none** (self-resolves) | **MSL-38 fixed** |
| `api/routes/products.rs:280` | product-creation cap | **none anywhere in the crate** | **MSL-39 fixed** |
| `db/workspaces_lifecycle.rs:31` | `enforce_instance_quota` | yes at its only caller | judged safe, pinned by MSL-37 |
| `bridge/workspaces.rs:558,610` | recover/suspend surplus instances | yes (`:544`, `:596`) | judged safe |
| `bridge/topology/commands.rs:709` | warehouse quota + capacity | yes (`:705`) | judged safe |

### MSL-38 (MEDIUM, FIXED): the marker refresh re-resolved the tier, for itself, from the clock

`persist_over_quota_markers` derives the tier a SECOND time — `TenantSubscription::load` +
`effective_tier()` — rather than taking the one its caller already has. After MSL-36 the gates enforce
the ledger tier, and this function is called from **inside** them (`quota_gate.rs:188`,
`locations.rs:302`, `products_crud.rs:686`, `staff.rs:755,797`, `workspaces_lifecycle.rs:392,417`). So a
creation could be refused against the ledger tier while the marker refresh, running a few lines later in
the same call, recorded markers computed against a different one.

Its own doc states the contract it broke — *"obtained the same way the creation gates get it"* — which
makes this the same species as MSL-35 (a comment promising a check the code did not make) and MSL-34 (a
sibling rule applied to three arms of four).

Falsified and restored. The test is the interesting part: with aligned clocks the seeded store fits
Premium comfortably and **zero** markers are due, so the baseline is asserted first; then the ledger is
rolled 40 days on and the seeded store — 2 terminals, 2 active warehouses, 2 active staff — is over every
Free cap, so an empty refresh can only mean the markers were computed against the wall clock. Watched
failing on exactly that assertion, then restored.

### MSL-39 (MEDIUM, FIXED): the API product gate, on a surface with no rollback guard at all

`routes/products.rs:280` gated product creation on the wall-clock tier. The instinct is to call that safe
— a cloud server's clock is not the merchant's to roll — so I checked rather than reason from the name:
`kasirmu-api` contains **zero** `validate_clock_rollback` calls, and `kasirmu-local-api` mounts the SAME
`router_with_openapi` over the merchant's local SQLite DB (`lib.rs:450`). So this router does run on the
device, where the clock is the merchant's, with no rollback guard on the path. The wall-clock reader
keeps the paid product cap after the grace window lapsed; the ledger reader fails closed to Free.

### The remaining three, judged rather than assumed

`enforce_instance_quota` is the one worth naming: it is a genuine creation gate reading the wall clock,
and its safety is entirely its **caller's** — `bridge/workspaces.rs:394` guards the clock at `:377`. The
function itself documents nothing about that dependency, so it is a latent trap for the next caller even
though it is correct today. Recorded as such rather than "fixed" with a connection argument it does not
have; the two `workspaces.rs` sites and the topology site are guarded directly at `:544`/`:596` and `:705`.

### Why this closes the class

Six instances deep — MSL-32 (the ledger read itself), MSL-36 (four capability gates), MSL-37 (the caps
payload MSL-36 broke), MSL-38 (the markers those gates refresh), MSL-39 (the same gate in the API) — every
remaining `effective_tier()` caller is now either ledger-aware or guarded, and the census means that is a
closed statement rather than a sample. The two I did not change are recorded with the reason, so the next
pass reads a verdict instead of re-deriving one.

**Verified:** 3317 `kasirmu-core` lib tests (was 3316), 336 `kasirmu-api`, 1401 `kasirmu-bridge`, clippy
clean on both changed crates. Commit `a4aa3f6bd`.

**Tally:** 47 findings fixed (8 HIGH), 15 leads disproved. Two are preventive pins.
---

## Pass 63 — MSL-40: an unvalidated status vocabulary, found by enumerating rather than reading

### Why `purchasing.rs` and not a module

Pass 62 concluded that enumerating a shape across the tree beats reading modules front-to-back. So this
pass opened with the next-largest swallow family — 252 production `unwrap_or_default()` sites — and
grouped them by file to find where they concentrate. `kasirmu-bridge/src/purchasing.rs` led at 32, a
module with no ledger coverage at all.

**The 32 sites are all benign**, and worth recording so no later pass re-derives them: every one is an
`Option<&str>` request field mapped to `""` (`args.contact_person.as_deref().unwrap_or_default()` and
friends) across four near-identical supplier/PO blocks. That is "an absent optional means empty", not a
swallowed error — the same judgement as the row-column reads at `db/mod.rs:622`.

But the four repeated blocks are a divergence *invitation*, so I diffed them field by field. They are
identical — except that `update_supplier` carries one argument the create path does not:

```rust
args.status.as_deref().unwrap_or("active"),   // both update_supplier and update_supplier_scoped
```

### MSL-40 (MEDIUM, FIXED): a raw constraint failure reported as a storage fault

`UpdateSupplierArgs.status` is a free `Option<String>` from the client. `update_supplier` passes it
straight through to the column, whose only guard is the schema:

```sql
status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive'))
```

`name` and `code` are validated in the same function for emptiness AND length before the write, so a bad
value there is a typed `CoreError::Validation`. `status` was the one updatable field with no check, so an
out-of-vocabulary value surfaced as:

```
Db(SqliteFailure(Error { code: ConstraintViolation, extended_code: 275 },
   Some("CHECK constraint failed: status IN ('active', 'inactive')")))
```

A storage fault reported for a validation mistake, with no field name for the command layer to render.

**Two sibling comparisons settle it as a divergence rather than a style preference.**

1. `update_po_status` — the adjacent command in the same module family — validates its own vocabulary
   explicitly (`purchase_orders.rs:329-335`) and documents it in its `# Errors` block.
2. `db/payables.rs` goes further still: a `PayableStatus` enum with `from_db`, `can_transition`, and a
   `parse_status_filter` that rejects unknown values at the bridge boundary.

So the tree has three different levels of rigor for the same problem — enum, explicit list, nothing —
and `update_supplier` held the outlier.

**The fix narrows no accepted input.** The CHECK is exact-match, so `" active"` never satisfied it
either; the change converts the *error type* only. That is why it is safe without a migration.

**Falsified before committing.** Disabling the new check makes the test fail with the exact
`ConstraintViolation` above, then restored. Both directions are pinned: an out-of-vocabulary value is a
typed `Validation` **and** the row is left untouched, while both legitimate values still round-trip.
3319 `kasirmu-core` lib tests pass (was 3317), clippy clean. Commit `382ae4639`.

### The census this implies, and what it found

The schema carries about twenty `CHECK (… IN (…))` vocabulary constraints. Rather than sample, I
enumerated which of them can be reached by a client-supplied string, and the answer is: very few.
Most of the `status: String` fields in the bridge are **response DTOs** (reading the value out), and the
two other write paths checked — `purchase_orders` and `payables` — both validate properly. MSL-40 looks
to be the sole unvalidated one, which is consistent with it being the one whose sibling sits in the same
file family: the divergence lens again.

**Tally:** 48 findings fixed (8 HIGH), 15 leads disproved. Two are preventive pins.
---

## Pass 64 — the status-vocabulary census, completed: no new defects

### The enumeration, and what it closed

MSL-40 was one unvalidated status writer found by comparing siblings. This pass asked the obvious next
question — *is it the only one?* — and answered it by enumeration rather than sampling, so the answer is
a closed statement. The property: a store function that writes a vocabulary column from a caller-supplied
`&str`, where the column carries a `CHECK (… IN (…))` and validation would otherwise be the schema's job.

Nine such functions exist across `kasirmu-core/src/db`. **All nine are now adjudicated:**

| function | guard | verdict |
|---|---|---|
| `suppliers.rs:162` `update_supplier` | none (schema only) | **MSL-40, fixed last pass** |
| `kds_orders.rs:387` `update_kds_status` | `KdsStatus::from_str` + transition state machine | clean |
| `kds_lines.rs:318` `update_kds_line_item_status` | `KdsStatus::from_str` + in-tx transition check | clean |
| `tables.rs:259` `update_table_status` | `TableStatus::from_str` + occupied-requires-a-sale rule | clean |
| `purchase_orders.rs:324` `update_po_status` | explicit `valid_statuses` list + documented in `# Errors` | clean |
| `legal_entities.rs:14` `validate_entity_fields` | `matches!(status, "active" \| "inactive")`, called on BOTH create and update | clean |
| `kds_orders.rs:260`, `kds_lines.rs:289` | `&str` forwarders into the validated fns above | clean |
| `stock_transfers.rs:197` | a `WHERE status = ?1` READ filter, not a write | n/a |

**`suppliers` was the sole outlier**, and the tree already contained the exact repair: `legal_entities.rs:27`
writes the same two-value vocabulary with the same `matches!` form I used. That the one unguarded function
sat beside its own sibling is the divergence lens again, and it is why MSL-40 was correctly scoped rather
than over-stated.

### Three shapes of rigor, and why that is not a defect

The nine split into three tiers — a typed enum with `from_str` and a state machine (`KdsStatus`,
`TableStatus`, `PayableStatus`), an explicit `&[&str]` list (`update_po_status`), and a `matches!` literal
(`legal_entities`). That looks like drift and is not: each is a **deliberate ladder**, and the vocabulary
grows as the state machine does. Suppliers need two values and no transitions, so `matches!` is right; KDS
needs four states and a legal-transition matrix, so an enum pays for itself. Rewriting the two-value cases
into enums would be churn, and MSL-40's fix follows the local precedent rather than inventing a fourth shape.

### Why `status` is still a `String` rather than a new enum

The idiomatically "better" fix is a `SupplierStatus` enum beside `TableStatus`. I did not do it, and the
reason is scope rather than difficulty: `Supplier.status` is a **public struct field** (`supplier.rs:37`)
whose doc already states the contract — *"Status: 'active' or 'inactive'"* — and it flows into
`SupplierDto`, the bridge args, and the Suppliers screen, which renders it into a CSS class. Changing the
field's type is a public-API design change touching three crates and the UI; validating at the write
boundary is the defect repair, and it makes the existing doc comment true rather than restating it in a new
type. The enum remains a reasonable follow-up if a third status ever appears — recorded, not silently deferred.

### Also checked, no findings

- **Client-string passthroughs.** Every bridge command feeding these nine (`kds.rs:407`, `purchasing.rs:445`,
  `:598`, `:724`, `tables.rs:154`) reaches a validated store function, so the vocabulary is enforced once,
  at the boundary that owns the column.
- **Scoped vs unscoped.** `update_po_status` / `update_supplier` have unscoped variants with no session or
  permission gate — which looked like a hole until I checked registration: only the `_scoped` forms are in
  either shell's `generate_handler!` list. The unscoped ones are the pre-ADR#7 dead form, consistent
  across the whole module.
- **Insert paths.** `legal_entities` validates through the same helper on create and update
  (`:71`, `:101`); `create_supplier` hardcodes `'active'` so it has no status to validate. No gap.

**No defects in this pass.** 3319 `kasirmu-core` lib tests, 337 `kasirmu-api`, 1401 `kasirmu-bridge`, clippy
clean on both crates. Nothing was committed except this record.

**Tally:** 48 findings fixed (8 HIGH), 15 leads disproved. Two are preventive pins.
---

## Pass 65 — out of the crates: MSL-41, and the UI/apps surfaces scoped

### Why this pass left `crates/`

Two consecutive thin passes in `core`/`bridge`/`api` suggested the high-yield veins there were worked, so
this pass acted on the previous round's recommendation and went where the ledger has **never** looked.
The ledger's own scope statement is "17/17 crates" and its sweep summary counts only `crates/` — the
`ui/` TypeScript and the ~30k-line `apps/*-tauri` command layer are referenced in it exclusively as
*consumers* of Rust behaviour, never as audited surface.

### MSL-41 (HIGH, FIXED): every supplier edit silently re-activated an inactive supplier

Found by tracing one field across the IPC boundary rather than reading a file.

`update_supplier` — both the global and the scoped variant — resolved the status a caller did not send
with a literal:

```rust
args.status.as_deref().unwrap_or("active"),
```

And the Suppliers screen **never sends one.** `SuppliersScreen.tsx` seeds its edit form from the row
(`:90-101`) but the form carries no status field, the payload it builds at `:125-129` omits `status`,
and the screen's only other references to the word are a column header (`:268`) and the badge it renders
(`:282`). The type agrees — `UpdateSupplierArgs.status?: string` in `ui/src/api/purchasing.ts:47`.

So the field is `None` on every save, `unwrap_or("active")` turns it into an explicit `"active"`, and
the UPDATE writes it. **Correcting a supplier's phone number flipped it from `inactive` back to
`active`, silently and with nothing in the UI able to express the intent.** The CSS already carries a
`.suppliers-badge--inactive` class (`:132`), so the screen displays a state it has no way to produce or
preserve.

This is MSL-40's column again, one layer up: there the store trusted the schema to validate a value, here
the command layer invented a value nobody asked for. Both are a boundary assuming what the layer behind it
would do.

**Fix.** `status_for_update(requested, existing)` — an explicit non-blank value wins, anything else
preserves the row — and both wrappers now read the current row first. Blank counts as absent, matching the
`blank_to_none` convention the settings and regional layers already use.

**Falsified before committing.** Pointing the helper's fallback back at the `"active"` literal makes the
test fail with exactly the reported pair:

```
assertion `left == right` failed: an edit that omits status must preserve the row, not force it active
  left: "active"
 right: "inactive"
```

The test drives the real store: it deactivates a supplier, edits its phone number through the payload
shape the UI actually builds, and asserts both that the status survives AND that the edit still lands — so
it cannot pass by turning the update into a no-op.

### Severity: HIGH, and why

The severity legend reserves HIGH for "wrong today on a live path". This is: the register UI is the only
way to edit a supplier, so *every* edit of a deactivated supplier is wrong, and the write is silent. It
does not corrupt money or leak data, so it is not the worst kind of HIGH — but "a user-visible state the
product deliberately models flips back on an unrelated edit" is a live wrong answer, not an inert one.

### Recorded, not actioned

**The UI still cannot set a status.** With the backend preserving it, the remaining gap is a missing
affordance: the screen shows the badge and styles both states but offers no control to change one. That is
a product decision about how suppliers are deactivated (and whether it belongs on this screen at all), not
a defect repair — recorded here so the next pass does not rediscover the CSS class and re-diagnose it.

### Also checked in the new surfaces, no findings

- **`ui/` money handling is genuinely careful.** `parseMinorUnits` (`ui/src/types/domain.ts:199`) and
  `convertMinorUnits` (`ui/src/api/currency.ts:116`) are BigInt throughout, with explicit half-up-tie rules
  and documented MONEY-01/MONEY-02 fixes; the float patterns they replaced are described in their own doc
  comments. This is the same discipline the Rust `Money` type enforces, achieved independently.
- **The registration-gate ratchet** (`apps/*-tauri/src/commands/registration_gate_tests.rs`, 14 tests pass)
  is a model of a self-guarding audit: it names what green does NOT mean, keeps a generated debt ledger of
  every ungated command, and pins a floor against the parsed tree so its own parser cannot silently stop
  matching. The 455 registered names and their states are already recorded there — re-reporting them would
  be duplicating a maintained artifact.
- **Two prior findings verified closed rather than assumed.** LAN-A: `kasirmu-lan` now owns the rule
  (`bind_addr_is_loopback` at `lib.rs:124`, refusal at `:352`), handles every spelling the finding named
  including the bare-IPv6 case that caused the bypass, and fails closed on unparseable hosts. CRY-A: the
  dead machine-bound SMTP pair is now *documented as dead* in the CLI (`credential_deltas.rs:482`, "no
  caller left in the tree"), which is the right disposition for a public-but-uncalled function.

**Tally:** 49 findings fixed (9 HIGH), 15 leads disproved. Two are preventive pins.
---

## Pass 66 — MSL-42: an unvalidated currency, and two wrong diagnoses I had to correct

### The finding

`update_location_profile` (`db/locations.rs:224`) writes `locations.currency` raw. Its
sibling `update_regional_config_for_location` (`db/regional.rs:178`) validates the SAME column through the
shared axis validator, and the bridge layer between them (`locations.rs:320`) validates the
`timezone` sitting beside it in the same function — so currency was the one field with no check at any
layer. The column is `TEXT NOT NULL DEFAULT 'USD'` with no CHECK.

Reachable from the UI by ordinary typing: the inspector renders timezone as a three-option preset
`<select>` with a client-side guard, and currency as a free-text `<input>` whose **only** constraint is
`maxLength={3}`. `regional_config_for_location` reads that column straight into the Location layer of the
chain the POS resolves money through.

**Fix:** parse through `Currency` — the same rule the sibling path reaches — producing a typed
`CoreError::Validation { field: "currency" }`. Falsified by reverting to the raw write, which persists
`currency: ""`; restored, 85 `locations` tests pass.

### Two diagnoses I got wrong, and what caught them

This is the part worth recording, because both errors were the same kind: **I asserted a contract without
reading the thing that defines it.**

1. **"`XYZ` is an invalid currency."** My first test asserted a non-ISO code would be rejected. It was not
   — and the fix I had already written did not reject it either. Reading `Currency::from_str`
   (`foundation/src/money.rs:119`) settled it: the parser checks **shape only** — exactly three ASCII
   alphabetic bytes, uppercased — with no ISO-4217 membership table. `XYZ` is a legal value *by design*;
   `US`, `USDD` and `""` are not. The doc comment saying "ISO-4217 alpha-3" describes that shape, not a
   registry lookup. My premise was wrong, not the parser.
2. **"The regional path should also reject blank."** I extended the fix so a blank currency would
   preserve rather than clear, reasoning that `locations.currency` is the *resolved* value. An existing
   test failed immediately: `write_blank_clears_each_axis_to_inherit` pins the opposite as deliberate —
   blank clears the Location layer so the chain falls through to the entity layer, which is exactly what
   the regional design means by "not set at this scope". I reverted the second fix.

The two writers therefore have **different blank semantics on purpose**, and the corrected test pins both
directions so a later refactor cannot "unify" them into whichever one it reads first. That the existing
suite caught my overreach is the system working; the alternative — writing the assertion to match what my
fix happened to do — is how a suite stops being evidence.

**A redundancy I then removed by measurement.** My fix carried an explicit blank check before the parse. I
disabled it and the test stayed green: `"".parse::<Currency>()` already fails on length, with the same
typed error, for blank *and* for any string that trims to blank. The branch was dead, so it is gone — the
whole fix is now the parse plus its message.

### Verified

3321 `kasirmu-core` lib tests (was 3319 — two new, both proven to fail against the unfixed code), 1403
`kasirmu-bridge`, clippy clean. Commit `8f9de1af2`.

**Tally:** 50 findings fixed (9 HIGH), 15 leads disproved. Two are preventive pins.
---

## Pass 67 — MSL-43: the currency the C6b timezone fix left behind

### The finding

MSL-42 established that `locations.currency` had one validated writer and one raw one. Asking the obvious
follow-up — *how many writers does this vocabulary have?* — found a third: `provision_device`.

`validate_provision_args` (`db/provisioning.rs:555`) is a thorough pre-write validator, and its own comment
explains exactly why the timezone is checked there:

> *"A free-text IANA name outside it resolves to UTC through the reporting path's fallback arm
> (`crate::timezone::offset_for_zone`), which would silently report a Jakarta store in UTC."*

The test beside it is named `an_unsupported_timezone_is_rejected_and_names_the_accepted_values` and calls
itself *"The defect C6b closes: the write path validated nothing"*. Six bad values are pinned.

**`currency` is written by that same function — into `locations.currency` AND into the store-wide
`Settings::set_default_currency` (`:675`) — and is checked nowhere**: not in the validator, not in the
bridge, not in the shell. It is documented as `ISO-4217 currency` on both the core args (`:322`) and the
wire DTO (`bridge/setup.rs:158`). So this is the C6b fix applied to one field and not to the one beside
it, in the same function, writing the same row.

**Fix:** the same `Currency` parse MSL-42 applies, so all three writers of this vocabulary now agree.
Falsified by disabling the check — a blank currency provisions successfully, row and setting and all —
then restored. 29 `provisioning` tests pass.

### Severity: MEDIUM, and I checked before claiming otherwise

The reachable-caller question decides this, so I traced it rather than reasoning from the field type.
There is exactly **one** caller, and `ProvisioningFlow.tsx:417` hardcodes `currency: 'IDR'` with no input
field at all (its timezone is hardcoded `Asia/Jakarta` for the same reason). So no user can send a bad
value today.

That makes it MEDIUM rather than HIGH: a public `String` documented as ISO-4217, guarded by nothing across
three layers, where the sibling field was validated for precisely this failure mode. It is latent — live
the moment anything supplies the field, which the touchscreen-locale work or a second provisioning path
would do. Calling it HIGH would have been defensible-sounding and wrong, and the difference matters
because the ledger's HIGH count is supposed to mean "wrong today".

The test asserts the stronger property regardless of current reachability: a refused provision must leave
**no** store-wide default currency set, which is the consequence that would outlive the bad row.

### The shape, now three findings deep

MSL-40 (the store trusted the schema to validate), MSL-41 (the command layer invented a value nobody sent),
MSL-42 (one of two writers validated), MSL-43 (the sibling of a fix, in the same function). All four are
one question asked of a different layer: **which layer owns this rule, and does every path to the column
agree?** Nothing in the four was found by reading a file top to bottom; each came from tracing one field
across the boundary.

**Verified:** 3323 `kasirmu-core` lib tests (was 3321 — two new, both proven to fail against the unfixed
code), 1403 `kasirmu-bridge`, clippy clean. Commit `6fedc69bb`.

**Tally:** 51 findings fixed (9 HIGH), 15 leads disproved. Two are preventive pins.
---

## Pass 68 — MSL-44: the column disagreed with every surface that reported it

### Leaving the currency vein, as planned

Pass 67 concluded the `locations.currency` vein was exhausted — all three writers now validate — so this
pass picked a different column and asked the same question: *which layer owns this rule, and does every
path agree?* `customers.email` / `customers.phone` have four writers and, unlike currency, a value-object
type (`foundation::Email`, `foundation::Phone`) that the tree clearly intends to gate them.

### The finding, measured rather than reasoned

`create_customer` and `update_customer` bind the caller's raw string straight into the INSERT/UPDATE and
apply `Email::new(..).ok()` only when BUILDING THE RETURNED STRUCT. So a probe gives:

```text
PROBE returned email      = None
PROBE stored   email      = Some("not-an-email")
PROBE read-back           = None
PROBE after-update stored = Some("also-bad")
```

**The column held a value every API surface reported as absent.** The read path applies the same
`.and_then(..ok())`, so nothing in the type system could ever surface it, and it persists indefinitely.
Any future reader of the raw column — a report, an export, a sync push — silently picks up what every
caller believes is not there.

### The correction: the existing test was right, my first fix was not

My first fix **rejected** an invalid email with a typed `Validation` error, and it broke
`create_customer_invalid_email_saved_as_none` — a pre-existing test whose name states the intended
contract outright, and whose comment explains it (`Email::new` returns `Err`, so `and_then` yields
`None`).

Read carefully, that test pins a **reporting** rule and asserts only the returned struct. It never
asserts the column. So the bug was never "the store accepts a bad email" — it was **the column not
honouring the contract the suite already pinned**. My rejecting fix would have overridden a deliberate,
tested decision with my own preference.

The correct, smaller fix: normalise on the way in, binding `None` for an unparseable value so the column,
the read path and the return value finally all say the same thing. Same commit as the bug, one helper,
no contract changed. `create_customer_invalid_email_saved_as_none` now passes **because the behaviour it
describes is true** rather than in spite of it.

**Falsified before committing.** Rebinding the raw values reproduces the exact disagreement:

```
assertion `left == right` failed: an unparseable email must be stored as NULL, not as the caller's raw string
  left: Some("not-an-email")
 right: None
```

Three tests added: both directions of the normalisation, plus a valid value round-tripping **trimmed**
(the property the fix must not break). 24 `customers` tests pass.

### Reachability, stated honestly

All four production writers validate upstream — the bridge's `validate_customer_fields` and the tablet's
hand-maintained duplicate (functionally identical, verified line by line) — and the CLI validates too. So
no user can currently store a bad address, and this is a latent trap rather than a live wrong answer.
MEDIUM. The reason it is worth fixing anyway is that the trap is silent by construction: the failure mode
is *wrong data that nothing can see*, which is strictly worse than a crash the first time it happens.

**Verified:** 3326 `kasirmu-core` lib tests (was 3323 — three new), 1403 `kasirmu-bridge`, clippy clean.
Commit `24144c794`.

**Tally:** 52 findings fixed (9 HIGH), 15 leads disproved. Two are preventive pins.
---

## Pass 69 — MSL-45: the same disagreement, where it also blocked the operator

### Following the shape rather than the file

MSL-44 established a shape — a store method whose RETURN VALUE parses a field while the PERSISTED COLUMN
takes it raw — so this pass enumerated every `.ok()` parse-on-return in the db layer (62 sites) and looked
for the same split. Three candidates in `products_crud.rs` used `foundation::Barcode::new(&s).ok()`, and the
write path beside them bound `barcode` raw.

### The finding, and why it is worse than MSL-44

A probe on a whitespace barcode:

```text
PROBE returned barcode = None
PROBE stored   barcode = Some("   ")
PROBE second product   = Err(Conflict { entity: "product", field: "sku or barcode" })
```

`Barcode::new` rejects only empty/whitespace, so whitespace is the one trigger — and unlike the customer
case it produces a **user-visible dead end**, for two independent reasons:

1. the value is invisible through the API (same as MSL-44), and
2. because `uq_products_barcode` is UNIQUE, it consumes the one slot — so the NEXT product saved with a
   blank barcode is refused with `Conflict { field: "sku or barcode" }` **while its SKU is perfectly unique**.
   The operator gets an error naming the wrong field and no way to see why.

**Reachability measured, not assumed.** The products screen binds the raw field
(`VariantManagementScreen.tsx:400`) and passes `form.barcode || null` — where `"   "` is truthy and travels
as a non-null value. The bridge validates the barcode on the LOOKUP path only (`products.rs:372`) and
passes it straight through on create/update (`:720`, `:926`). So typing spaces into the barcode box is an
ordinary action, not a crafted call. That makes this HIGH-adjacent: a live, silent, user-facing failure.

### The fix, and the one path that did not need it

`normalise_barcode` — blank becomes `None`, everything else is trimmed — wired into **both** `create_product`
and `update_product`, so an update cannot install what the create path now refuses to leave behind.
Normalising rather than rejecting follows the contract MSL-44 confirmed: the read path and the return path
already say "absent" via `Barcode::new(..).ok()`, so only the column disagreed.

**`product_variants.barcode` was checked and needs nothing**: it takes a typed `Barcode` argument
(`products.rs:281`, `:352`), so the type system prevents the gap there. That is also the evidence that
`products` was the only text-based path — the tree already had the better design one table over.

**Falsified before committing.** Making the helper a pass-through reproduces both failures (the stored
`Some("   ")` and the missed trim), then restored. Two tests added: the blank-barcode round trip including
the second-product save, and a real barcode still storing trimmed AND remaining findable by the scanner's
lookup — the property a careless fix would break. 13 `products` barcode tests pass.

**Verified:** 3328 `kasirmu-core` lib tests (was 3326 — two new), 1403 `kasirmu-bridge`, clippy clean.
Commit `a425669cc`.

### A note on where this is heading

Two findings in a row from one shape, and both were found by enumerating the shape rather than reading the
file. The remaining `.ok()` sites are mostly JSON decoding and float parsing, which do not have a
"persisted column" half. The productive next question is probably not "which other column" but "which
UNIQUE or FK-constrained column is written from an unvalidated string" — the constraint is what turns an
invisible value into a blocked operator.

**Tally:** 53 findings fixed (9 HIGH), 15 leads disproved. Two are preventive pins.
---

## Pass 70 — MSL-46: the same class again, where the constraint was unenforceable

### The recommendation executed

Pass 69 closed with a concrete next question: *which UNIQUE or FK-constrained column is written from an
unvalidated string?* — on the reasoning that the constraint is what turns an invisible value into a blocked
operator. This pass enumerated the 70 `CREATE UNIQUE INDEX` statements and traced the string-written ones.

### The finding

`inventory_locations.name` carries `idx_inventory_locations_name_unique … WHERE is_active = 1`, whose whole
purpose is to stop two active locations sharing a name. Both writers bound the caller's **untrimmed**
string, so the index was defeated by padding rather than by a bad value. Measured:

```text
PROBE first  ("Back Room")        = Ok
PROBE second ("Back Room ")       = Ok
PROBE third  ("  Back Room")      = Ok
PROBE active rows = 5             (2 seeded + 3 mine)
```

Three active rows the picker renders identically — **the duplicate the index exists to prevent, still
reachable**. `listInventoryLocations` feeds the cashier-facing `LocationPicker` and `ShiftBar`, so the
impact is a cashier choosing between two entries that look the same with no way to tell them apart.

### Two fixes, because there were two defects

1. **Trim before the check AND the bind**, on both writers. Wired into create and update so neither can
   install what the other refuses.
2. **Map the UNIQUE violation to `Conflict`**, following the house pattern at six other sites
   (`products_crud.rs:366-374`, `staff.rs:550`, `roles.rs:234`, `profile.rs:834`, `loyalty.rs` ×3). The
   trim alone turned an opaque `Db(SqliteFailure(UNIQUE constraint failed))` into the duplicate being
   *refused*, but still with a storage error naming no field — MSL-40's shape. A duplicate location name
   is now a typed `Conflict { entity: "inventory_location", field: "name" }`, matching how a duplicate SKU
   reports.

**Falsified before committing.** Reverting the trim reproduces both defects exactly —
`left: "  Front Room  ", right: "Front Room"` for the storage, and a padded duplicate *succeeding* with a
returned id. Restored; two tests pass.

### Two of my own errors, caught by measuring instead of asserting

1. **I asserted the create path was the only writer.** It was not — `update_inventory_location` binds the
   same column the same way, and it is the path that can *rename* an existing row into a collision, which
   the create-path-only fix would have left open.
2. **My row-count assertion was wrong, not the code.** `assert_eq!(active, 1)` failed with `left: 3`; the
   base migration seeds two system locations (`Default Inventory`, `In Transit` at `20260813_init.sql:1525`
   and `:1531`), which I had not read. The test now counts the NAME under test rather than the table — a
   bare `COUNT(*)` was measuring the seed.

The second is the same lesson as passes 66 and 68, from the other direction: there, an existing test caught
me overriding a contract; here, reading the fixture settled a count I had assumed. Both are cheaper than a
wrong fix.

**Verified:** 3332 `kasirmu-core` lib tests (was 3330 — two new), 1403 `kasirmu-bridge`, clippy clean.
Commit `a28b42a49`.

**Tally:** 54 findings fixed (9 HIGH), 15 leads disproved. Two are preventive pins.
---

## Pass 71 — the UNIQUE-column census completed: no new defects

### Finishing what pass 70 started

MSL-46 fixed `inventory_locations.name`. The obvious follow-up — *is it the only UNIQUE string column
written untrimmed?* — is what this pass answered, by enumerating every remaining UNIQUE string column and
tracing its writers rather than sampling. **All are now adjudicated:**

| column | how it is protected | verdict |
|---|---|---|
| `inventory_locations.name` | — | **MSL-46, fixed last pass** |
| `suppliers.code` | `code.trim()` before the bind, both writers | clean |
| `purchase_orders.po_number` | `po_number.trim()`, both writers | clean |
| `users.username` | `trim().to_lowercase()` | clean |
| `users.email` | **shape-validated**: local@domain.tld, no whitespace | clean |
| `users.national_id_hash` | **shape-validated**: 9 digits (ssn) / 16 (nik) | clean |
| `locations.ticket_prefix` | `normalize_ticket_prefix` (trim + ASCII-uppercase) | clean |
| `sync_applied_items.effect_key` | machine-built by the sync client; partial index ignores NULL | clean |

### Two hypotheses tested and disproved, which is the point of measuring

The email column looked like the strongest candidate — UNIQUE, held in a profile struct, bound verbatim at
`profile.rs:815`, and with no normalization anywhere upstream in the bridge. Two probes:

```text
PROBE second user, padded email + padded national id
      = Err(Validation { field: "national_id", message: "national id must be 9 digits for ssn" })
PROBE second user, padded email only
      = Err(Validation { field: "email", message: "email address is not well-formed" })
```

Both were **refused**. `validate()` (`profile.rs:187-204`) checks the national id is exactly N *ASCII
digits* and the email contains *no whitespace*, and either rule inherently excludes padding — I had
reasoned from "the value is bound raw" to "the value can be padded" without reading the validator that
runs first. The hash then makes the uniqueness proof match the shape-checked plaintext, so the pair cannot
disagree.

**Judged, not silently skipped:** `locations.name` (the store profile, distinct from
`inventory_locations.name`) is bound untrimmed by both its writers. That is *consistent* between them and
the column carries no UNIQUE index — only `idx_locations_primary` on a boolean — so no constraint is
defeated and no duplicate is hidden. Cosmetic; recorded rather than changed, because trimming it would be
churn on a column with no contract to honour.

### No defects in this pass

3332 `kasirmu-core` lib tests and clippy clean on the unmodified tree; no commit beyond this record. The
probe was appended, measured, and removed — `git status --porcelain -- crates/kasirmu-core/src/db` is empty
at the end of the pass.

### What the census establishes

Five findings (MSL-40 through MSL-46) all came from one question asked at a different layer or column:
*which layer owns this rule, and does every path to the column agree?* The UNIQUE-column variant is now
closed as a census — the remaining columns are protected by a validator, a normalizer, or are machine-built,
and that is a statement about the whole set rather than a sample. The next productive question is likely a
different constraint family (FK-referenced codes, or the `WHERE`-clause predicates the partial indexes rely
on) rather than a sixth pass over string columns.

**Tally:** 54 findings fixed (9 HIGH), 15 leads disproved. Two are preventive pins.
---

## Pass 72 — MSL-48: the FK family, and one finding that turned out to be three

### Taking the recommendation

Pass 71 closed by naming the next constraint family: FK-referenced codes. This pass enumerated the 100
`REFERENCES` clauses in the base schema, filtered to the **code-shaped** targets (a caller supplies a name,
not an opaque id), and found `products(sku)` referenced by four tables. Every one of them is reachable from
a UI the operator types into.

### The finding, measured

The bundle editor's component SKU is a free-text `<input>` (`BundleManagementScreen.tsx:424`), the bridge
forwards it unvalidated (`bundles.rs:170`), and the store binds it straight into a `REFERENCES products(sku)`
column. A typo produced:

```text
PROBE create_bundle with bad sku = Err(Db(SqliteFailure(
    ConstraintViolation, 787, Some("FOREIGN KEY constraint failed"))))
```

No field, no SKU, and nothing saying the *product* is what is missing — while the screen's catch
(`BundleManagementScreen.tsx:177-182`) distinguishes only its client-side `BundleValidationError`, so a DB
error falls through to the generic `bundles-error-save` toast. **A mistyped SKU reads as "the bundle could
not be saved" with nothing pointing at the field.**

### It was three instances, not one

The first probe led to the other two by asking the same question of each sibling rather than stopping:

| column | path | defect |
|---|---|---|
| `bundle_items.sku` | bundle create + update | raw FK |
| `product_variants.parent_sku` | variant create | raw FK (free-text parent in the variant editor) |
| `product_bundles.bundle_sku` | bundle create + **rename** | raw FK; a bundle IS a product |

The third is the one I would have missed by fixing the reported symptom: `bundle_sku` is
`UNIQUE REFERENCES products(sku)`, so the *row written first* can fail the same way, including on rename.

**Fix:** one helper per table — `insert_bundle_row`, `insert_bundle_item`, and a match in
`create_product_variant_on` — each mapping `ConstraintViolation` to `NotFound { entity: "product", id: <the SKU> }`.
The bundle-row helper serves both the FK and its own `UNIQUE`, because either way the SKU is what the caller
must change.

**Falsified before committing, all four tests.** Disabling each mapping reproduces the exact raw
`FOREIGN KEY constraint failed`; restored, 24 `product_bundles` and 3337 total `kasirmu-core` tests pass.
Commits `75630b756` (items) and `4187c72d8` (variants + bundle SKU).

### Why this is the same finding a fourth time

MSL-40 (schema trusting the DB), 41 (command layer inventing a value), 42/43 (one of several writers
validated), 44/45 (column disagreeing with its own report), 46 (constraint defeated by whitespace), 48
(constraint reported as a storage fault). Seven findings, one question: **which layer owns this rule, and
does every path agree?** The FK variant differs only in which constraint complains — and in that the
offending value is visible on the operator's screen, which is what makes the wrong error message costly.

**Verified:** 3337 `kasirmu-core` lib tests (was 3332 — five new across the two commits), 1404
`kasirmu-bridge`, clippy clean on the unmodified tree. The remaining FK targets (`currencies(code)`,
`workspace_types(key)`) are enumerated but not yet adjudicated; that is the next pass.

**Tally:** 55 findings fixed (9 HIGH), 15 leads disproved. Two are preventive pins.
---

## Pass 73 — MSL-49 and MSL-50: the FK census finished

### The two remaining targets, both confirmed

Pass 72 left `currencies(code)` and `workspace_types(key)` named but unadjudicated. This pass measured both,
and both leaked the same raw failure.

### MSL-49: `currencies(code)` — and a test that could not have caught it

`modules/currency` is the one module the ledger previously deferred ("its own gaps tracked under the
parallel review's F-findings"), so it had never been read here. It turned out to be unusually disciplined —
trims, uppercases, validates every field, wraps the write and read-back in one transaction — with about
twenty tests including whitespace normalisation.

But the FK membership was left to SQLite, and **the test meant to cover it asserts only `is_err()`**:

```rust
#[test]
fn create_exchange_rate_rejects_unknown_currency() {
    // exchange_rates.from_currency/to_currency have FK references to
    // currencies(code); a code not in the table must be rejected.
    assert!(result.is_err(), "a rate for an unknown currency must be rejected by the FK");
}
```

The comment shows the author knew the FK was the mechanism — and the assertion is exactly why the wrong
*kind* went unnoticed. Measured, both paths returned
`Db(SqliteFailure(ConstraintViolation, "FOREIGN KEY constraint failed"))`.

**Fixed** with a `currency_exists` lookup before the write, returning
`Validation { field: "from_currency" | "to_currency" }` that echoes the rejected code. The API's
`store_error_response` already maps that to a 400 naming the field, so the fix propagates end to end. The two
existing tests are now **strengthened to assert the kind** rather than `is_err()`, which is the change that
makes them able to fail.

**This is the sharpest instance of the class so far**: not an oversight in production code, but a test that
pinned the mechanism ("rejected by the FK") while being blind to the contract (what the caller sees).

### MSL-50: `workspace_types(key)` — non-empty is not membership

`create_workspace_instance_with_purpose` validated `type_key` for emptiness only, while the column is
`REFERENCES workspace_types(key)`. A bogus key returned the same raw FK failure. Fixed with one indexed
lookup, naming `type_key` and echoing the value. Falsified before committing.

### The census, closed

| FK target | protected by | verdict |
|---|---|---|
| `products(sku)` ×3 | typed mapping, MSL-48 | fixed |
| `currencies(code)` | `currency_exists`, MSL-49 | fixed |
| `workspace_types(key)` | membership lookup, MSL-50 | fixed |
| `workspaces(key)` | seeded vocabulary, machine-supplied | clean |
| `roles(id)`, `users(id)`, `locations(id)` | ids from the same store, not operator-typed codes | clean |

**Verified:** 3338 `kasirmu-core` lib tests (was 3337), 88 `modules-currency` (two strengthened), 342
`kasirmu-api`, clippy clean on both changed crates. Commits `4d67961cd`, `0a33edea6`.

**Tally:** 57 findings fixed (9 HIGH), 15 leads disproved. Two are preventive pins.
---

## Pass 74 — MSL-51: a rule only the client enforced, and a test I had to change

### The family, and the shift in shape

Passes 72-73 closed the FK family. This pass enumerated the **non-vocabulary CHECK constraints** — 26 range,
sign and business rules — and found that most quantity writers already validate: sales, refunds and stock
transfers all check `qty` explicitly. Two did not, and both live on `bundle_items`.

The shape shifted here, and the shift matters: MSL-48/49/50 were a *constraint being misreported*. This is
**no constraint at all**.

### MSL-51: `bundle_items.qty` — the check existed, just not where the callers reach

`qty INTEGER NOT NULL DEFAULT 1`, no CHECK, and no store-side validation. The desktop editor has always
refused it (`BundleManagementScreen.tsx:136`: `qty < 1` throws) — which is precisely why it went unnoticed.
Both shells forward to the same bridge command (`create_bundle_scoped`, `update_bundle_scoped`), and the
bridge does no qty validation, so the **tablet app, a script, or any future IPC caller** could store "−2 of
ITEM-A" in a bundle.

That is a client-side guard standing in for a boundary rule — the same lesson as MSL-40 from the other side.

**A test I changed, deliberately, and why that is the honest resolution.** Fixing this broke
`create_bundle_with_zero_qty_item`, which asserted `found.items[0].qty == 0`. I read it in context before
deciding: it sits in a block labelled *"Additional edge-case tests"* and its job is to record what the store
does with an odd input. It documents behaviour; it does not establish a rule. Three things then broke the tie
against it — the schema never carried a CHECK, the editor contradicts it (`qty < 1` is rejected), and nothing
sums the column for money (a bundle has its own price). I updated the test to assert the new validation and
wrote the reasoning into the test rather than only the ledger, so the next reader sees the decision where the
assertion is.

This is the third time a pre-existing test has decided a question for me (MSL-44, 46, 51). Twice it
corrected me; this once it recorded a behaviour I judged wrong. Reading it before overriding it is the whole
discipline.

### MSL-51 (continued): `unit_price_minor` — pinned, and rated honestly

The sibling is a price OVERRIDE, `INTEGER` with no CHECK, validated by the editor (`unitPrice < 0`) and not by
the store. Traced properly before rating it: **nothing in `kasirmu-core` sums this column** — the
`qty * unit_price_minor` arithmetic at `sales_tax.rs:385` belongs to SALE lines, a different table — so a
negative value is inert today.

**MEDIUM at most, and I have written it as a consistency pin rather than a live wrong answer.** It is worth
fixing because the column is money: the first consumer to trust it would inherit a value the UI already
believes is impossible. Both guards sit in `insert_bundle_item`, the one place every item passes through, and
both are falsified.

### Also checked, no findings

- `product_recipes.quantity_required` carries `CHECK (> 0)` but has **no production writer** anywhere in the
  tree — the table is migration-seeded only, so the constraint is unreachable. Recorded so a later pass does
  not re-derive it.
- The remaining 24 non-vocabulary CHECKs are on sale lines, payments, stock counts and similar paths whose
  writers validate explicitly (the `qty <= 0` census above).

**Verified:** 3344 `kasirmu-core` lib tests (was 3338 — three new plus one updated expectation), 1970 in the
`db::` layer alone, 1404 `kasirmu-bridge`, clippy clean. Commit `0ef4330c3`.

**An unrelated failure, correctly attributed:** a full-suite run showed
`sync_client::tests::the_pull_stub_delegates_to_the_shared_rule_and_variant` failing. `sync_client.rs`,
`sync_client_tests.rs` and `sync_pull.rs` are dirty with another lane's in-flight work; my module (28 tests)
and the whole `db::` layer (1970) pass in isolation. Recorded rather than "fixed" — it is not mine to touch.

**Tally:** 58 findings fixed (9 HIGH), 15 leads disproved. Two are preventive pins.
---

## Pass 75 — MSL-52: the vocabulary census, finished

### Closing the last unadjudicated check family

Pass 64 adjudicated the vocabulary CHECKs reached by a `status: &str` parameter and left the rest open.
This pass enumerated the remaining vocabulary columns (`txn_type`, `event_type`, `count_type`,
`profile_type`, `scope_mode`, `branch_scope`, `workspace_scope`) and traced every writer. **All are now
closed:**

| column | how it is written | verdict |
|---|---|---|
| `profile_type` | caller `&str`, no validation | **MSL-52, fixed** |
| `txn_type` (gift cards ×3, loyalty ×3) | hardcoded literals in the SQL (`'redeem'`, `'issue'`…) | clean |
| `event_type` (product_activity ×2) | hardcoded `'search'` / `'edit'` | clean |
| `count_type` | hardcoded in the INSERT | clean |
| `scope_mode`, `branch_scope`, `workspace_scope` | hardcoded `'global', 'all', 'all'` | clean |

The pattern in the clean rows is worth naming: they are **literals inside the SQL string**, not parameters.
A vocabulary written as a literal cannot be wrong at runtime — which is why `txn_type` needed no guard on
six write sites while `profile_type` needed one on a single site.

### MSL-52: `profile_type`, enforced by the CHECK alone

`terminal_profiles.profile_type` carries
`CHECK (profile_type IN ('counter_pos', 'kds_kiosk', 'customer_display', 'unrestricted'))`, and nothing
else validated it: the store binds a raw `&str`, the bridge checks only non-emptiness
(`terminals.rs:703`), and the UI types it `profileType: string` with no screen constraining it. Measured:

```text
Db(SqliteFailure(ConstraintViolation, 275,
   "CHECK constraint failed: profile_type IN ('counter_pos', 'kds_kiosk', ...)"))
```

The MSL-40/50 shape again, on a column whose whole purpose is selecting which UI a terminal renders.

**Severity: MEDIUM, and latent.** The only UI caller passes a value it chooses, so no user types a bad one
today. Pinned because the vocabulary is a real contract — the front-end branches on
`profileType === 'kds_kiosk'` (`useTerminalProfile.ts:79`) — and because both tests together prove the
guard **matches** the schema rather than narrowing it: one rejects a bad value, the other accepts all four
the CHECK admits.

Falsified by disabling the guard, which reproduces the exact `CHECK constraint failed` above.

### Two constraint families now closed by census

*UNIQUE string columns* (pass 71) and *FK-referenced codes* (passes 72-73) and *vocabulary CHECKs*
(passes 64, 75) are each a closed statement rather than a sample. Across all three the recurring question
is the same one MSL-40 opened with: **which layer owns this rule, and does every path agree?** The
variants differ only in what enforces the rule — a UNIQUE index, an FK, a CHECK — and in whether the
resulting failure names a field.

**Verified:** 3292 `kasirmu-core` lib tests with the other lane's in-flight `sync_client` module skipped
(55 filtered), 18 in `terminal_profiles`, 1404 `kasirmu-bridge`, clippy clean. Commit `323b28455`.

**Tally:** 59 findings fixed (9 HIGH), 15 leads disproved. Two are preventive pins.

## Pass 76 — MSL-53: the guard and the FK answer different questions

Started on the partial-index predicates and found that family disciplined (each migration states its
invariant, its predicate rationale, and its writer census; the writer censuses still match). So I followed
the *one* lead that family pointed at instead: **a guard that counts referrers and a FOREIGN KEY that
enforces them can disagree, and only the FK gets the last word.**

`roles.rs` states the disagreement itself, and then reasons past it. `ROLE_REFERRERS` filters
`users` to `deleted_at IS NULL`, and the doc says why in as many words:

> The `Option<&str>` half exists because the FOREIGN KEY and the LIVE row are not the same set, and
> `users` is the one table where they differ.

That is correct for the **authoring guard** — a tombstone nobody can name, reassign, or wait out must not
pin a role in the trash forever, and counting raw rows was a real bug the module records having fixed.
It is wrong for the **sweep**, which does not ask "can a person still name this role?" but "will
`DELETE FROM roles` succeed?". `purge_expired_roles` asked the first question and ran the second
statement.

**Why the sets differ, permanently.** No production path ever deletes a `users` row. The staff trash
stamps `deleted_at` (`staff.rs:744`), and `purge_expired_users` **anonymises in place** — an
`UPDATE` (`staff.rs:855`) that does not clear `role_id`. So a member who has ever held a role holds
it in the FK's eyes for the life of the database, whether they are live, trashed, or purged. Only tests
delete from `users`.

**Measured, on the module's own fixtures:**

```text
Db(SqliteFailure(Error { code: ConstraintViolation, extended_code: 787 },
   Some("FOREIGN KEY constraint failed")))
```

Sequence: a user holds a role → the user is trashed → `soft_delete_role` sees zero *live* referrers and
trashes the role (correctly) → the window closes → the sweep's `DELETE` meets the FK. And because the
loop runs inside **one transaction**, the failure aborted the **entire sweep**, not just the un-collectable
row: every other expired role in that pass stayed on disk, and the error the operator saw was a raw
`SqliteFailure` naming no table.

**Severity: HIGH.** The migration that introduced the feature (`20261010_role_trash.sql:11-12`) rests on
the claim that "the delete guard has already proved nothing references it, so the 90-day sweep can remove
the row outright". The probe shows that premise is unsound, so the sweep has never actually been able to
collect such a role — it has thrown instead, and taken the pass with it.

**The fix keeps both censuses, because both are right about their own question.** `ROLE_FK_REFERRERS`
is the FK's census, `ROLE_REFERRERS` stays the roster's, and `role_has_any_fk_referrer` is consulted by
the sweep only. Choosing between them was never the point: the row is genuinely pinned, so the sweep
leaves it trashed and reports **0** rather than lying about having collected it. Reverting the guard to
raw rows was rejected as the fix — it recreates the undeletable-role bug the doc block exists to record.

Falsified by deleting the two new lines: the new test fails with the exact `extended_code: 787` above and
passes with them. Two tests, one per direction — the sweep *leaves* a role a trashed member still holds,
and the sweep *still collects* one no row references, so the guard is provably a `continue` and not an
early return.

**Verified:** 44 in `db::roles::tests` (up from 40), 1974 in the `db::` layer (0 failed), `clippy -D
warnings` clean, both files `rustfmt`-clean apart from one 105-character line that predates the change
and is left untouched. Commit `5aeb1b289`.

**Tally:** 60 findings fixed (10 HIGH), 15 leads disproved. Two are preventive pins.

## Pass 77 — MSL-54: the trigger census (and MSL-17 confirmed live)

Generalised MSL-53 into a census rather than another column sweep: **every place a hand-written guard
precedes a constraint SQLite enforces anyway, where the guard is weaker than the arbiter.** The schema
carries exactly eight distinct triggers, and they are the constraints no Rust guard can model.

| Trigger family | Arbiter | Rust guard | Verdict |
|---|---|---|---|
| `stock_summary_qty_nonnegative_{insert,update}` | `qty >= 0` **conditionally** | pre-check + `ConstraintViolation` catch | **sound, and deliberately weaker** |
| `trg_assignments_scope_id_pair{,_update}` | `scope_id IS NULL` iff `organization` | `AssignmentSpec::validate_resource_pair` | **sound, guard is stricter** |
| `audit_log_immutable_delete` | marker row absent | `IngestPolicy` + `run_set_setting` | **sound — MSL-17, already fixed** |
| `audit_log_immutable_update` | always aborts | none | **sound — no path exists to guard** |
| `loyalty_tiers_validate_{insert,update}` | multiplier fixed-point | typed at the model | **sound** |

**`stock_summary` is the inverse of MSL-53, and it is the best-reasoned constraint in the tree.** There is
deliberately **no** `CHECK (qty >= 0)`: an unconditional one would refuse the negative the opt-in
`allow_negative_stock` path writes, silently re-enabling the very Rust guard that flag exists to opt out of
(owner decision D11). The Rust side therefore matches on the **primary** code 19 rather than 787, which is
correct precisely because the arbiter is a trigger (1811) and not a CHECK — the doc says so and it is
true. Nothing to change; recorded because a future reader adding a CHECK would defeat D11.

**The assignment pair is the MSL-53 lens applied and passing.** The trigger is a biconditional
(`(scope_type = 'organization') != (scope_id IS NULL)` → ABORT). The Rust guard at
`assignments.rs:100` is **stricter**, refusing `Some("")` where the trigger admits it — correct direction,
since an empty id is a real "narrow to nothing". And the guard is genuinely reached:
`validate_resource_pair` has exactly one production caller (`assignments.rs:458`, the sole write path),
with the trigger as documented backstop. `scope_type` is a Rust enum besides, so the column's CHECK is
unreachable from Rust.

**The audit carve-out is MSL-17, verified live rather than trusted.** The trigger keys on a `settings`
row's mere existence, and `Store::set_setting` takes an arbitrary key — so I re-ran the question this
campaign answered earlier: *can any door other than the sweep write it?* `is_manager_owned_key`
(`raw.rs:781-800`) names the marker explicitly, so **PortablePackage and RemoteSync both refuse it**;
`TrustedLocal` admits it by design, but the desktop funnel refuses manager-owned keys before the write
(`run_set_setting`), so the local IPC cannot set it either. The only writer is the sweep, and the sweep
holds it inside one transaction with a fast path that never opens one. This is an independent
confirmation that the MSL-17 fix holds, not a second finding.

**MSL-54 (LOW, fixed): a duplicated assertion implying coverage that does not exist.**
`raw_tests.rs` asserted `IngestPolicy::TrustedLocal.admits(marker)` **twice** — `:227-232` and
`:241-246` — under two different messages and two near-identical comments, with the core-key equality
check wedged between them. The second copy cannot fail where the first passes, so it pinned nothing; what
it did do is make the test read as if it guarded two invariants. Removed the copy (7 lines), keeping the
one assertion and its comment. Verified: the test still passes, 168 in `settings::`, clippy clean,
rustfmt clean (including the stray blank line the deletion exposed).

**This closes four constraint families by census**: UNIQUE string columns (71), FK-referenced codes
(72-73), vocabulary CHECKs (64, 75), and now **triggers** (77). The recurring question is unchanged, and
MSL-53 and MSL-54 are its two failure directions — a guard **weaker** than its arbiter (the FK outvotes
it, and the sweep aborts) and a guard **duplicated** against itself (nothing is enforced twice, but the
test claims otherwise).

**Verified:** 168 `platform-core settings::`, 44 `db::roles::tests`, 1974 `db::` layer, clippy clean on
both crates touched. Commits `afe1291c5` (MSL-54).

**Tally:** 61 findings fixed (10 HIGH), 15 leads disproved. Two are preventive pins.

## Pass 78 — MSL-55: the KDS retention boundary, and a limitation worth stating

Took last round's named axis: the unattended sweeps. Thirteen exist; I adjudicated the two families the
ledger had never opened — the four `memos.rs` sweeps and the two `kds_ops.rs` ones.

**The memo cluster is clean, and two leads died by measurement.**

1. `sweep_expired_archives` claims *"rows still referenced by a `RESTRICT` FK cannot exist here, so the
   delete is unconditional once aged."* This is the exact claim MSL-53 falsified for roles, so I tested it
   rather than reading it. The two `RESTRICT` edges (`20260911_memo_fk_restrict.sql`) point **outward**
   — `memos.location_id → locations` and `memo_recipients.terminal_id → terminals` — and every FK that
   points *at* `memos` is `ON DELETE CASCADE`. So no edge can block the sweep's `DELETE`, and
   `retention_sweep_deletes_archives_only_past_the_window` already asserts zero child rows survive. Sound.
2. `sweep_ended_to_archived` restamps `archived_at` with no `archived_at IS NULL` guard, which would move
   the retention anchor forward. But its source predicate is `status IN ('stopped','expired')`, and
   `'archived'` is written in exactly one place (`:529`) and never left — the sole other `archived` site
   is the DELETE. The restamp is unreachable. Sound.

**`cleanup_old_kds_orders` had a real coverage gap: the retention BOUNDARY was untested.** Its two existing
tests seed a fixed `.000Z` literal and a 365-day window, so the comparison they exercise is a whole year
wide — they pass identically for any cutoff within a year of correct. That is the same shape as the bug the
memo sweep already paid for (a cutoff format that mis-sorted at the boundary and slipped deletions by up to
a day). MSL-55 adds the boundary test: a row past `retention_days` is pruned, a row a minute younger
survives, with the fixtures expressed as offsets from the same `Utc::now()` the call uses. Verified
falsifiable — the first version failed at `deleted == 0` because an exact-boundary fixture races the
cutoff's own microseconds, which is why the fixture now carries a one-second margin.

**What I could NOT pin, stated because I nearly claimed it.** I wrote that the cutoff's `%S%.3fZ` spelling
would be caught. It is not:

| Cutoff spelling | Renders | Boundary test |
|---|---|---|
| `%S%.3fZ` (production) | `…:03.310Z` | passes |
| `%S.%3fZ` | `…:03.310Z` — **byte-identical** | passes |
| `%S%fZ` (nanoseconds) | `…:03.310230200Z` | **passes** |

I measured all three. `%.3f` and `.3f` agree exactly, and even the nanoseconds form passes because a
one-second margin swamps a sub-millisecond difference — the date-and-second prefix dominates the string
comparison and only the tail varies. **So the cutoff's `%.3f` is correct but unpinned by anything**: no
boundary I can write is tight enough to observe it. The format is verified correct by the column's own
DEFAULT (`strftime('%Y-%m-%dT%H:%M:%fZ')` = `SS.SSS`) and by reading, not by a test, and the doc on
MSL-55 now says so rather than implying coverage. A tautology I briefly added (asserting the length of my
own fixture helper) was removed for the same reason: it tested the test, not the code.

**The structural observation kept from this round:** `kds_ops.rs` repeats the same format literal **four**
times — once for a write (`ack_kds_order`'s `started_at`/`acked_at`) and three times for cutoffs — across
two producers (chrono) and one contract (the column's strftime shape). That is the second-definition shape
this campaign has a named rule against, but it is a *tidiness* finding with no behaviour consequence
(measured: all four agree, and one edit reverted clean). Recorded as a lead, not actioned: naming the
constant is the fix and it is a refactor, not a repair, so it belongs in a chassis pass rather than an
audit pass.

**Verified:** 4 `cleanup_old_kds_orders` (was 2), 165 in the `kds` family, `clippy -D warnings` clean,
`rustfmt` clean, `kds_ops.rs` byte-identical to HEAD (all falsification probes reverted). Commit
`9c4c4bb86`.

**Tally:** 62 findings fixed (10 HIGH), 17 leads disproved. Two are preventive pins.

## Pass 79 — MSL-56/57: the Rust-vs-SQLite timestamp shape census

New axis, taken from MSL-55's own lesson. A Rust-produced timestamp string that is later compared
AGAINST a column SQLite wrote is a silent failure when the two shapes disagree: no error, no type check,
just a lexical comparison that answers wrong. So I enumerated every `.format("…")` in production code and
adjudicated each against the column it meets. Nine distinct formats; three verdicts.

| Rust format | Sites | Compared to | Verdict |
|---|---|---|---|
| `%Y-%m-%dT%H:%M:%S%.3fZ` | 9 | `strftime('%Y-%m-%dT%H:%M:%fZ')` columns | **correct** — `%.3f` renders `SS.SSS` |
| `%Y-%m-%dT%H:%M:%S%.6fZ` | 1 | same | **MSL-56, fixed** |
| `%Y-%m-%d %H:%M:%S` | 2 | filesystem mtime, display only | sound — lead disproved |
| `%Y-%m-%d` | 12 | one is a SQL day bound | **MSL-57, fixed** |

**MSL-56 (MEDIUM, fixed): `terminal_overrides.rs` wrote microseconds where the column writes
milliseconds.** The helper's comment claimed *"Same format used by the SQL `strftime` default in
migrations"* — and it was false. Measured against a real DB:

```text
sqlite = 2026-09-25T23:46:15.606Z     (len 24)   -- the column DEFAULT
rust   = 2026-09-25T23:46:15.606805Z  (len 27)   -- format_now()
```

Both are lexically comparable but not *interchangeably*: for two rows in the same whole second they differ
at index 24, where SQLite has `Z` (0x5A) and the Rust stamp a digit — so the coarser, older row sorts
AFTER. Nothing compares these columns today, which is why it was never visible; it is fixed so the first
caller that orders by `updated_at` does not inherit the inversion. The comment now states the contract,
the measured divergence, and which SQLite default it has to match. Pinned by
`override_timestamps_match_the_sqlite_column_shape`, which reads the expected shape **out of SQLite**
rather than restating it in Rust, so the test cannot pass by agreeing with its own copy of the format.

**MSL-57 (HIGH, fixed): the custom-report END DATE silently dropped its own day's rows.**
`build_custom_report` built its upper bound as `format!("{end_date} 23:59:59")` — a SPACE at index 10 —
while all three filterable columns (`sales.created_at`, `customers.created_at`, `shifts.opened_at`)
default to `strftime('%Y-%m-%dT%H:%M:%fZ')`, i.e. a `T` at index 10. `' '` (0x20) sorts BELOW `'T'`
(0x54), so every row stamped on the end date itself compared GREATER than the bound. Measured on the
module's own fixtures, with a raw-SQL control:

```text
end=2026-06-30  ->  1 row
end=2026-06-15  ->  0 rows   (the sale is stamped 2026-06-15T10:00:00.000Z)
raw SQL, same bound  ->  0 rows
```

A single-day custom report came back **empty while the rows plainly existed** — the worst shape of report
bug, because nothing errors and the numbers just read zero. Reachable: `build_custom_report_scoped`
(`kasirmu-bridge/src/reports.rs:609`) is the IPC door.

**Why this survived the memo sweep's identical fix.** The memo module fixed precisely this class —
`archived_at <= datetime(...)` against an RFC3339 column — and wrote it up at length. The audit
security-trail filter fixed it too, as D84 ruling 3, with a reusable `normalize_day_bound`. Neither
generalised: the export built its own bound inline, in a different shape, and no census existed over
"Rust stamps that meet SQLite stamps". That census is this pass.

**The fix was aligned to the house idiom on a second look.** My first version used
`T23:59:59.999Z` with `<=`; the audit precedent (`audit.rs:526-537`, `created_at < ?`) uses an
EXCLUSIVE next-day midnight, `{day+1}T00:00:00.000Z` with `<`. Both are correct for millisecond data,
but `.999Z` silently assumes millisecond precision whereas the exclusive form stays correct under finer
stamps. Re-done the house way, so there is one idiom and not two. A second assertion pins the semantic the
exclusive form introduces — a row at midnight of the day AFTER the end date is correctly EXCLUDED.

Falsified both ways: the original bound fails `left: 0, right: 1` on the same-day case, and the realigned
version fails identically when reverted.

**Leads disproved, and worth recording so they are not re-checked:** the two `%Y-%m-%d %H:%M:%S` sites
(`kasirmu-bridge/src/data.rs:420,1106`) format a filesystem mtime for a backup-status DTO — never
compared, never parsed, a legitimate display format. The `%.3fZ` family's other eight sites all write to
or compare against `%fZ` columns and agree.

**Verified:** 141 `export` (was 119), 18 `terminal_overrides`, 1976 `db::`, `clippy -D warnings` clean,
both files `rustfmt`-clean (one pre-existing long line in `terminal_overrides_tests.rs:41` left
untouched). Commits `faaa9a256` (MSL-56), `1869f2309` + `a630f00c9` (MSL-57).

**Tally:** 64 findings fixed (11 HIGH), 19 leads disproved. Two are preventive pins.

## Pass 80 — MSL-58: the census widens to bound parameters, and a test I refused to leave flaky

Continued the timestamp-shape axis from MSL-56/57, which had only looked at `.format()` **producer** sites.
A Rust string can also meet a SQLite column as a **bound parameter** with no `.format()` to grep for, so I
enumerated every comparison of a timestamp column against `?N` (29 sites) and then every
`to_rfc3339_opts` precision in production code.

**The discriminator is precision, and the safe idiom is the right one.** 159 production sites use
`SecondsFormat::Millis` — which renders exactly the 24-character `…00.000Z` shape
`strftime('%Y-%m-%dT%H:%M:%fZ')` writes — and three use `Secs`. Two of the three are sound (one records a
display timestamp into a settings row; one builds a diagnostic deadline that nothing compares). The third
was not.

**MSL-58 (LOW, fixed): `archive_stock_movements` compared a second-precision cutoff against millisecond
columns.** `stock_movements.created_at` defaults to `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`, and all three
archive statements compare `created_at < ?` lexically. The cutoff was built with `SecondsFormat::Secs` —
`…:00Z`, 20 characters — so at index 19 the cutoff has `Z` (0x5A) where any stored row has `.` (0x2E), and
`'.'` sorts BELOW `'Z'`. A row in the same whole second as the cutoff therefore still satisfies `<` and is
archived early. Measured before the fix: a row stamped from the column's own `strftime` was archived by a
**zero-day** window. Bounded to sub-second drift on a day-scale retention, so LOW — but on a live path, and
the same class as MSL-56/57.

**Why 30 days of existing tests could not see it, which is the transferable part.** Every other archive
test seeds `'2020-01-01T00:00:00Z'` — **the very shape the cutoff was wrongly using** — against a 30-day
window whose date portion decides the comparison long before index 19 is reached. Fixture and bound agreed
with each other while both disagreed with the schema. The new fixtures are built from the column's own
`strftime` expression, which is what makes them able to disagree with it.

**A flaky test I wrote and then refused to keep.** My first version used a zero-day window and asserted the
same-second row survives. It discriminates **correctly** against the bug and fails on the fix — because
with a whole-DAY parameter both the fixture and the cutoff read the wall clock, so the row lands
microseconds *before* the cutoff and archiving it is right. I could not make the same-second case
deterministic, and rather than ship a test that passes for the wrong reason I retargeted it: the fixtures
assert the column shape, and the behaviour assertion is the day-scale one that is genuinely stable.
The doc says outright what it does not pin. Falsified by changing the cutoff sign, which the retargeted
test catches.

**Environment note, recorded because it cost three retries:** a bare `cargo test -p kasirmu-core --lib`
from another lane hung twice and held the shared test binary `kasirmu_core-90b1da…exe`, so every link failed
with `rust-lld: failed to write output … permission denied`. I killed only the orphaned test **binary** —
never another lane's cargo parent — and then moved my own builds to `CARGO_TARGET_DIR=target-review` so my
runs stop contending for that artifact at all.

**Verified:** 10 `archive_movements` (was 9), 1982 `db::`, `clippy -D warnings` clean, both files
`rustfmt`-clean apart from one pre-existing hunk at `products_tests.rs:2012` left untouched. Commit
`c1ac67d34` (verified by hash — HEAD had moved to another lane's `45d8fdabc` between the commit and the
read, which is exactly why the policy is to check the hash and never HEAD).

**Tally:** 65 findings fixed (11 HIGH), 21 leads disproved. Two are preventive pins.

## Pass 81 — MSL-59: the day-range idiom census, and a stale doc closed

Took the deeper lesson from MSL-58 — **a fixture that agrees with the code's own mistake makes the test
invisible** — and asked the mirror question: how many *other* day-range predicates were written in a shape
nobody could see was wrong?

**The census is closed, and it is uniform.** Every date-range predicate in `db/reports/` — 37 of them
across `sales_summary.rs`, `revenue.rs`, `product_sales.rs` — uses the same shape:

```sql
WHERE status = 'completed' AND DATE(created_at, ?3) BETWEEN ?1 AND ?2
```

Not one uses a raw string comparison against a timestamp column. `DATE(col, tz)` normalises the column to
a bare day, so **the shape of both the fixture and the bound becomes irrelevant** — this idiom is
structurally immune to the MSL-57 bug. Enumerating every day-bound construction in production code found
exactly two: my `export` fix and the `audit.rs:537` precedent. Everything else was a test fixture or a
fixed-offset constant.

| Day-range idiom | Where | Verdict |
|---|---|---|
| `DATE(col, tz) BETWEEN date AND date` | `db/reports/` (37 sites) | shape-immune — the safest |
| `col >= day AND col < (day+1)T00:00:00.000Z` | `audit.rs` (D84 ruling 3) | correct |
| `col <= "{day} 23:59:59"` | `export/mod.rs` | **was MSL-57** |

Three idioms and one bug. I cross-checked the two surviving ones on the boundary that mattered — a sale
stamped `2026-07-31T23:00:00.000Z` against an end date of `2026-07-31` — and both include it, so the export
fix now agrees with the reports module rather than merely being defensible on its own.

**The 54 `Secs`-shaped test fixtures are not a defect, and I checked rather than assumed.** 54 test
literals use the 20-character `…T00:00:00Z` shape while the schema writes 24-character `%fZ`. That is only
a hazard where a fixture is **compared**; where it is merely stored and summed it cannot matter. The
`reports_tests.rs` and `analytics_tests.rs` fixtures feed the `DATE()`-wrapped aggregations above, and
`analytics` wraps even its open-ended bounds the same way. Lead disproved, recorded so it is not re-run.

**MSL-59 (LOW, fixed): a duplicated doc block, the first half of it stale.** `find_stale_pending_sales`
carried **two** adjacent doc comments on one function (`:764-769` and `:770-775`), near-identical
restatements of the ADR-20 §6 paragraph — and the first described `pending_expires_at < datetime('now')`,
the SQL-side form the code **abandoned**. A reader hitting the first block learned the mechanism that was
specifically replaced, and the second block's only distinct value was the correction. Collapsed to one
block that states the Rust-side threshold, names the column shape it matches, and records why the SQL-side
form was wrong (its `YYYY-MM-DD HH:MM:SS` output has a space at index 10 where the column has `T`).
This was already on the ledger as an open LOW; it is now closed.

**Verified:** 7 `sales_lifecycle`, `clippy -D warnings` clean, `rustfmt` clean. Commit `fa48b175d`
(verified by hash).

**Tally:** 66 findings fixed (11 HIGH), 22 leads disproved. Two are preventive pins.

## Pass 82 — MSL-60: the carried-forward lead, proven, and its home found

Ran down the lead MSL-59 explicitly carried: **`export`'s custom report compared dates in raw UTC while
`db/reports/` applies the store-local timezone (REP-03).**

**First, I checked whether someone already owns this.** Searching the tree for the timezone contract
surfaced another lane's review doc, and its checklist shows **C6 DONE** (`7559a3f6b`, "resolve report
timezone via the IANA zone resolver") and **C6b DONE** (`1fea7d78`, `validate_provision_args` validates the
timezone it writes). That is the area I was about to work in, so the next question was not "is this a bug"
but "is this bug outside their fence". `git show --stat 7559a3f6b` touches exactly four files —
`reports/datetime.rs`, `reports/datetime_tests.rs`, `reports_tests.rs`, `timezone.rs` — and neither C6's
fence list nor C6b mentions `export/mod.rs` or `build_custom_report`. The export filter sits **outside** a
closed item, on the same defect class, so it is mine to fix and not a duplicate.

**Measured, on an `Asia/Jakarta` (UTC+7) store**, with a sale at `2026-07-31T20:00:00.000Z` — which is
03:00 on 1 August locally:

```text
tz_modifier = "+07:00"
export  July = 1   August = 0      <- the bug
reports July = 0   August = 1
```

Same store, same row, opposite days. A user exporting "July" got a July that contains an August sale, and
the Analytics screen sitting beside it said August.

**A probe that lied to me first, and why.** My initial run showed both surfaces agreeing on July — which
would have killed the finding. It was wrong because `fresh_db()` seeds **no `locations` row at all**, so my
`UPDATE locations SET timezone = ...` matched nothing and `tz_modifier()` fell back to `+00:00` for both
paths. The probe needed `seed_provisioned_baseline`. Worth recording: the *fallback* is what made the bug
invisible, and a fixture without a primary location is exactly the shape that hides it.

**The fix adopts the reports idiom rather than a third one.** `DATE(col, tz) BETWEEN ?1 AND ?2` —
byte-identical in shape to the 37 predicates in `db/reports/`. It collapses the two-branch
`>= start` / `< day+1` construction into one predicate and fixes both defects at once: the column is
converted to the store day *before* comparison, so the sub-second shape stops mattering (MSL-57's
class) and the day means the operator's day. An absent bound now widens to an open end
(`0000-01-01`/`9999-12-31`) instead of narrowing the range. `tz` comes from the single REP-03 resolver and
is embedded only after that validation, so it can inject nothing beyond a date modifier.

**The test asserts two things on purpose.** The local day is right, *and* the export filter agrees with
`payment_method_breakdown` for the same store and day. The second half is not redundant: a future change
could fix this filter into a third idiom that is locally correct and still disagrees with the reports a
user reads beside it. Falsified by dropping the `DATE(col, tz)` conversion — the test then fails
`left: (0, 0), right: (0, 1)`, the raw `BETWEEN` matching neither month.

**Verified:** 142 `export` (was 141), 1982 `db::`, `clippy -D warnings` clean, both files
`rustfmt`-clean. Commit `261387b20` (verified by hash).

**Tally:** 67 findings fixed (11 HIGH), 22 leads disproved. Two are preventive pins.

**Note on scope, so this is not over-read:** the remaining UTC/local questions in this area — the
analytics UI's deliberate UTC anchoring (`analytics-data.ts`) and the tax path's separate resolver — belong
to C6/C6b's owners and are recorded there. This pass claims only the export custom-report filter.

**Leads carried forward, not actioned:** `export`'s date filter compares in raw UTC while `db/reports/`
applies a store-local tz modifier (`REP-03`). That is a pre-existing semantic difference my fix did not
introduce and did not silently change — the two surfaces can disagree about which day a late-evening sale
belongs to. Worth its own pass; recorded so it is not lost.

## Pass 83 — MSL-61: re-checked my own carried items, then a doc that contradicts itself

Started by auditing my own backlog rather than the code: the ledger has accumulated carried-forward items
over ~10 passes, and a note is only trustworthy until someone else's lane moves under it.

**Two carried items re-checked, both still accurate.**
- *"The UI still cannot set a supplier status"* (recorded as a product decision, not a repair): still
  display-only. `SuppliersScreen.tsx` renders the badge (`:282`) and the CSS styles both states, but the
  only two `status` mentions in the file are the column header and the badge — no control. The note held,
  and it stays a decision rather than a defect.
- The `export` raw-UTC lead was closed by me last pass (MSL-60), so it needed no re-check beyond deleting
  it from the carried list.

**Then the tax validity window, because it is the same boundary shape as MSL-57/60.** `effective_from`
inclusive / `effective_to` EXCLUSIVE, with a documented "a boundary day must have exactly one answer".
Four things checked, three clean:

1. `window_covers` (`db/tax/scopes.rs:854`) is correct and stated **once** for both readers: `from <= as_of`
   and `as_of < to`, with an unparseable stored date returning false so the row is skipped rather than
   trusted. Good.
2. **The SQLite/PG duplication is deliberate and still in agreement.** `pg.rs:545-546` says outright it
   mirrors core's `TaxRateWindow::validate` because the latter is private. I compared both clause by
   clause — same field order, same `is_none`/`is_err` check, same `from >= to` refusal, same unreachable
   defaults. The only difference is the message rendering (`{to:?}` vs `{to}`), and no test asserts either
   string, so it is cosmetic and inert. This is the MSL-54 shape (a duplicated rule) and here the
   duplication is *justified and held*, which is worth stating explicitly since MSL-54 was a defect.
3. **Only one resolver exists.** PG validates on write but never resolves a window; resolution is
   `Store::resolve_tax_rate_for_location` alone, so there is no second answer to diverge.
4. `business_date_in_zone` resolves IANA names properly, so `as_of` can be a real local day.

**MSL-61 (LOW, fixed): a doc block that contradicted the function directly beneath it.** `tax_scope_now`
(`kasirmu-bridge/src/pos.rs`) carried a doc saying *"`as_of` is the UTC calendar date, and that is a
recorded compromise"*, citing `locations.timezone` being *"read as a fixed offset"* and an open question
in the regional-config doc. The body does the exact opposite — it falls back to UTC only when the zone is
missing, and otherwise calls `business_date_in_zone(Utc::now(), &timezone)` — and the inline comment at
`:50` says *"not raw UTC"*, refuting the doc three lines above it. Both of the doc's premises were also
stale: the IANA-name read path was fixed, and the open question it cites was **closed by C6** (the same
lane whose fence I checked last pass). Corrected to state the store-local business date, why the boundary
day matters, and where the UTC fallback actually lives.

This is MSL-59's shape (a doc describing the abandoned mechanism) with an extra twist: the two halves were
**adjacent**, so a reader could see them disagree. Left uncorrected, the next change to this function
would plausibly restore UTC on the authority of the doc.

**Verified:** 1404 `kasirmu-bridge` tests, 0 failed; `clippy -p kasirmu-bridge --all-targets -D warnings`
clean. `rustfmt` reports three hunks in `pos.rs`/`pos_tests.rs`, all pre-existing and untouched — my diff
is comment lines only, confirmed with `git diff`. Commit `246a535fa` (verified by hash).

**Tally:** 68 findings fixed (11 HIGH), 23 leads disproved. Two are preventive pins.

## Pass 84 — MSL-62: an unpoliced promise — eleven copies of one security mapper

This round I censused the *shape* the last three findings shared: **one rule stated in more than one
place.** I harvested every doc comment claiming a named partner (`Mirrors X`, "the same rule as Y",
"kept in step") and adjudicated each pair. 39 claims; most hold, and the pattern concentrated in one
neighbourhood.

**The authorization gates agree, and I checked all four pairs rather than the two the docs name.**
`apps/desktop-tauri/src/commands/authz.rs` has four gates; `kasirmu-bridge/src/ctx.rs` carries the
bridge-side equivalents under different names. Compared clause by clause — same underlying call, same
argument order, and for the two resource gates the same **scoped-then-resource** sequence with identical
arguments. No drift.

**MSL-62: `map_gate_error` exists in ELEVEN places, and nothing checks they agree.**

| Copy | Location |
|---|---|
| canonical | `kasirmu-bridge/src/ctx.rs:109` |
| shell | `apps/desktop-tauri/src/commands/authz.rs:48` (targets `AppError`) |
| 9 mirrors | `bridge/{staff,loyalty,customers,categories,inventory_counts,inventory,regional,stock_transfers,tax}.rs` |

**The copies are load-bearing, which is why drift would matter.** `impl From<CoreError> for
BridgeError` (`error.rs:62`) maps `CoreError::PermissionDenied` to `BridgeError::Core { sub_kind:
PermissionDenied }` — a *generic* core error — while the UI branches on `BridgeError::PermissionDenied`
itself. Every gate needs that correction, so a copy that drifts hands the front end the wrong wire shape
for a denial, silently.

**The duplication is deliberate and already ruled on — I checked before touching it.** The port journal
(`docs/archived/manager-2-journal.md`) records the ruling per wave: *"Tax gate STAYS non-scope-aware
`Store::require_permission` with `map_gate_error` mirror (D-B12 categories ruling applied)"*, and names a
dedupe that was to ride a later gate-fix. It did not land: `ctx::map_gate_error` is still private, is not
re-exported, and the scheduled cleanup lost its tracker when the journal was **archived** — the active
checklist has zero mentions of it. So this is not a new defect and not a refactor to do unilaterally
mid-migration; it is a **known duplication whose only tracking artifact was retired, with nothing failing
when a copy changes.**

**So I pinned agreement instead of refactoring.** No test existed for it (zero `map_gate_error` hits across
all 63 bridge test files). `gate_error_mapping_tests.rs` reads the real sources via `include_str!` — the
idiom `settings_tests.rs` already uses across crates — extracts each mapper's **match arms only** (doc
comments and signatures legitimately vary per module and are not the rule), and compares all ten bridge
copies against a literal canonical set. A second test asserts the shell copy still translates a denial to
`AppError::PermissionDenied` rather than routing it through `AppError::from`.

**The canonical expectation is a literal, not derived from `ctx.rs`**, and that is deliberate: deriving it
would let the test pass whenever all copies agree with *each other*, including when every one of them had
drifted together — the failure that matters most. The doc says so. A module missing its mapper PANICS
rather than passing as "no drift", so the eventual dedupe is reported rather than silently absorbed.

Falsified by making `tax.rs`'s copy wrap the message: the test fails naming `tax.rs` and the rule it
broke. Restored, and `tax.rs` is byte-identical to HEAD.

**Verified:** 1406 `kasirmu-bridge` (was 1404), 0 failed; `clippy -p kasirmu-bridge --lib -D warnings`
clean; both files `rustfmt`-clean. Commit `81d1557bf` (verified by hash; new file landed through the §3
`add` + pathspec chain, `create mode` confirmed).

**Tally:** 69 findings fixed (11 HIGH), 23 leads disproved. Two are preventive pins. One new pin: a
checked agreement standing in for a retired tracking artifact.

## Pass 85 — MSL-63: the KDS visibility mirror holds; a stale quota note closed

Continued the named-partner census from MSL-62, taking the two remaining entries that promised a
**behavioural** mirror rather than a type or wording one — where drift would be a wrong answer rather than a
stale sentence.

**`kds_orders` visibility: the "Mirrors exactly" claim holds, and it is not obvious.** Two encodings of one
rule: `instance_visibility_condition_sql` (`kds_orders.rs:91`, a SQL fragment pushed into the WHERE for
one indexed pass) and `order_visible_to_instance` (`:185`, a Rust predicate used by the single-order
lookups). The shapes are genuinely different — the SQL says

```text
(no targets AND (tii IS NULL OR tii = :iid)) OR EXISTS(target = :iid)
```

while the Rust branches early: *if any target exists, visibility is exactly "does a matching target
exist"*, ignoring `target_instance_id` entirely. I enumerated the truth table over the reachable input
shapes rather than reading them side by side, because the interesting case is one neither text names: a row
with BOTH a targeting row AND a non-null `target_instance_id`. The SQL's trailing `OR EXISTS` and the
Rust's early return **coincide** there, and on all seven reachable shapes the two agree. No drift, and now
a stated result rather than an assumption.

**MSL-63 (LOW, fixed): a mirror note describing a refactor that had already happened.**
`Store::count_products` (`downgrade.rs:220`) said it *"Mirrors the inline count in
`Store::enforce_product_quota`"*, and that *"extracting the shared count out of `enforce_product_quota` is a
possible follow-up"*. Both halves were stale in the **safe** direction, which is why nothing failed:

- `enforce_product_quota` (`products_crud.rs:239`) no longer counts anything — it delegates to
  `enforce_creation_quota`, whose own comment says "same products count (`count_products`)".
- The extraction the note proposed **has been done**. Both readers now call `count_products`: the
  assessment through `assess_downgrade` (`:43`) and the creation gate through `quota_gate::quota_count`
  (`quota_gate.rs:89`). The rule is shared, not mirrored.

So the doc under-claimed a better design. Corrected to state the sharing, name the two readers, and record
that the note is superseded. Verified the intra-doc links resolve by name rather than assuming:
`assess_downgrade`, `enforce_product_quota` and `count_products` are all `pub` methods on `Store`.

**One thing I checked before calling the other count a duplicate.** `create_product_with_attributes`
(`products_crud.rs:392`) also runs `COUNT(*) FROM products`, but it is **deliberate and not a copy**: it
counts inside its own transaction, after the insert, because under WAL a pre-transaction count reads only
its snapshot — the comment there explains this is what closes the TOCTOU the pre-transaction gate cannot.
Same table, same predicate, different moment, for a reason that is recorded. Left alone, and the doc now
says so.

**On the crate's 52 pre-existing broken intra-doc links:** `cargo doc -D warnings` fails on this crate, and
I checked my own contribution rather than either ignoring it or claiming the crate is clean — filtering the
error list for `assess_downgrade`, `enforce_product_quota`, `count_products` and `downgrade.rs` returns
zero hits, so none of the 52 is mine. Recorded as an open crate-wide item, not repaired here: it is 52
links across modules I would be editing blind, and it is its own pass.

**Verified:** 22 `downgrade`, 0 failed; `clippy -p kasirmu-core --lib -D warnings` clean; `rustfmt` clean.
Commit `bb8ed4ca8` (verified by hash).

**Tally:** 70 findings fixed (11 HIGH), 23 leads disproved. Two preventive pins plus the MSL-62 agreement
pin. One crate-wide item recorded: 52 broken intra-doc links in `kasirmu-core`, none of them mine.

## Pass 86 — MSL-64: the escaped-backtick family, and the doc-link census

Ran down the crate-wide item MSL-63 recorded: 52 broken intra-doc links in `kasirmu-core`, none of them
mine. Treating it as a number was the wrong shape, so I characterised it by CAUSE first and found it is
not one defect but five families — and one of them was a real authoring bug with a clear blast radius.

**MSL-64 (LOW, fixed): every backtick in `stock_variance.rs` was escaped with a literal backslash.** Lines
1-31 of the module doc and its function docs read ``[\`Store::stock_variance_report\`]`` — the `\` escapes
the backtick, so rustdoc sees broken syntax: the inline code never renders (the reader gets literal
backslashes) and the link never forms. Measured: **31 occurrences in the production file**, 6 in its test
file, 6 in `migrations_tests.rs` — 43 total, and the crate had exactly three files carrying the defect, all
of them the same authoring slip.

The fix is the mechanical one, applied only to lines matching `^\s*(//!|///)` — never to a string literal or
a code line — and proven so: the diff is 43 insertions / 43 deletions, and a filter over `git diff -U0` for
added lines that are NOT doc comments returns **nothing**. One further site in the same module needed a real
change, not an unescape: `[\`StockVarianceRow\`]` still failed after unescaping because the module doc
resolves in the parent namespace, so it now carries an explicit `(crate::stock_variance::StockVarianceRow)`
target.

**`cargo doc -D warnings` on `kasirmu-core` went 52 → 46 unresolved links.** The six resolved are exactly
the six link sites this pass repaired, verified by re-filtering the error list for `StockVariance`,
`stock_variance` and `StockVarianceRow` — now zero hits.

**The other four families, characterised rather than fixed, because each needs its own judgement:**

| Family | Examples | Why it fails |
|---|---|---|
| `Store::x` where `x` is non-public | `reject_builtin_role_id` (`pub(crate)`), `map_role_conflict` (private), `validate_scope_target` (private) | rustdoc cannot link a non-public item from public docs |
| bare name needing a path | `QuotaError`, `Payable`, `MemoStatus`, `Entitlements` | the item exists but is not in scope at the doc site |
| private module | `super::roles`, `super::staff`, `rates`, `revenue`, `scopes`, `datetime`, `product_sales` | the module is not public |
| intra-doc link to a private fn | `claim_document_number_in_tx`, `stock_variance_report`, `list_warehouse_products` | same as family 1 |

I verified family 1 by reading the definitions rather than inferring it: all five samples are `pub(crate)`
or bare `fn`. That matters because it decides the remedy — the fix is either to make the item public or to
drop the link syntax and leave the name in plain backticks, and which one is right differs per site. A blind
sweep would either widen the public API to satisfy a doc or mangle a link that should stay. Left recorded:
**46 known broken intra-doc links in `kasirmu-core`, with the cause of the largest family stated**, and no
CI signal on it either way (nothing runs `cargo doc`).

**Verified:** 6 `stock_variance` tests, 0 failed; `clippy -p kasirmu-core --lib -D warnings` clean; all three
files `rustfmt`-clean; `cargo doc` recount run twice, before and after. Commit `007211828` (verified by
hash).

**Tally:** 71 findings fixed (11 HIGH), 23 leads disproved. Two preventive pins. One crate-wide item
narrowed from "52 unexplained" to "46, four named families, one closed".

## Pass 87 — MSL-65: the non-public link families, repaired by cause

Continued MSL-64's four named families, which I had characterised but deliberately not touched because each
site needs a decision. This pass made those decisions and repaired two families.

**First, a measurement correction I owe the ledger.** MSL-64 reported "52 → 46 unresolved links" and
attributed the six to the escaped-backtick family. Half right: rustdoc emits **46 link warnings across 20
locations**, and the two counts move independently. Re-measuring properly gave the round a real baseline —
**20 locations / 46 links** — and the end state is **15 locations / 41 links**, with zero newly introduced
(checked, not assumed: the round briefly showed 17 when my `replace_all` made an already-correct link
explicitly targeted, producing a *redundant explicit link target* warning; reverted).

**MSL-65 (LOW, fixed): two families, seven files, 13 lines — all doc-only.** The fix differs by family, which
is exactly why a blind sweep would have been wrong:

| Family | Sites | Remedy chosen |
|---|---|---|
| link to a non-public item | `roles.rs` ×6 (`reject_builtin_role_id` `pub(crate)`, `validate_permission_grants` `pub(crate)`, `map_role_conflict` private, `HOLDERS_FROM_WHERE` private const, `ROLE_FK_REFERRERS` private const), `topology.rs` ×1 (`semantic_type_key` private fn) | drop the link syntax, keep the name in plain backticks — these are internal helpers, and naming one is useful while linking it is impossible |
| public item out of scope | `QuotaError::{Staff,Product,Register,Store}Limit` ×4, `QuotaError` ×1 | keep the link, qualify the path (`crate::subscription::QuotaError::…`) — `QuotaError` **is** public (`subscription.rs:1211`) and a reader benefits from following it |

Each decision was made by **reading the definition**, not by pattern: I confirmed all five `roles.rs`
targets are `pub(crate)` or bare `fn`, while the two names *in the same sentences* (`update_role`,
`role_holders`) are `pub` and were already resolving — so the failure is specifically about visibility, not
about the link syntax in general. For `QuotaError` I confirmed the module is `pub mod subscription` and that
all four variants exist before qualifying.

**A foreign hunk I refused to commit.** `roles.rs` came back dirty with **two** changes: my seven doc lines,
and a rustfmt reformat of the pre-existing 105-character `EXISTS` line that another lane's tree-wide
`cargo fmt` left uncommitted. Committing the file would have filed their formatting under my message, so I
reverted just that hunk — the file is back to its HEAD shape for that line — leaving the commit a clean
13 insertions / 13 deletions with every changed line a doc comment. Verified with a filter over
`git diff -U0` for added lines that are not `///`/`//!`, which returns nothing.

**Still open, and now the smaller half:** 41 links / 15 locations across `assignments`, `audit`,
`image_refs`, `loyalty` (×2), `products_crud`, `products_stock_adjust/adjust`, `tax/rates`, `tax/scopes`,
`export/email_report` (×2), `session` (×2), `subscription` (×2) and `quota_gate`. The recurring names there —
`FiscalScheme`, `DocumentNumberSequence`, `Payable`, `MemoStatus`, `Entitlements`, `SecurityEvent` — look
like the same "public but out of scope" family, and the module links (`super::roles`, `super::staff`, `rates`,
`revenue`, `scopes`, `datetime`, `product_sales`) are the private-module family. Recorded with the remedy
per family already established, so the next pass is mechanical rather than another census.

**Verified:** 49 `roles`, 92 `staff`, 8 `quota_gate`, 63 `topology` tests, 0 failed;
`clippy -p kasirmu-core --lib -D warnings` clean; all seven files `rustfmt`-clean apart from the one
pre-existing HEAD hunk in `roles.rs` deliberately left untouched; `cargo doc` recounted after every edit.
Commit `c6965cbb1` (verified by hash).

**Tally:** 72 findings fixed (11 HIGH), 23 leads disproved. Two preventive pins. Crate-wide doc debt:
**52 → 41 links, 20 → 15 locations**, both counted directly.

## Pass 88 — MSL-66: the out-of-scope family, and a bulk edit that needed cleaning up

Continued the link census with the plan MSL-65 set: the remaining links were *mostly* the two known
families with remedies established, so this pass could be mechanical. **Verified that premise before acting
on it** — and it held for most names, with exceptions that mattered.

**The premise, checked by reading definitions rather than inferring.** I resolved the visibility of every
unresolved name: `FiscalScheme`, `DocumentNumberSequence`, `Payable`, `PayableStatus`, `MemoStatus`,
`DeliveryStatus`, `Entitlements`, `SecurityEvent`, `QuotaUsage`, `LinkedAccount`, `RegionalConfig`,
`FeatureVerdict`, `VerdictDetail`, `AvailabilityFeature`, `AvailabilityFacts`, `BuildFingerprintVerdict`,
`list_warehouse_products`, `new_with_restaurant_pos`, `explain_availability`, `build_entitlements` — **every
one is `pub`**. So they are the "public but out of scope" family, and the fix is to qualify the path, the
convention this crate already uses (`export/mod.rs:13`, `migrations.rs:11`, and my own
`stock_variance.rs:10`).

**Two exceptions the census caught, which a blanket sweep would have got wrong.**
- `validate_table_geometry` (`db/tables.rs:34`) is a bare `fn` — private, so qualifying it does not help;
  that one takes the plain-backtick treatment.
- `list_warehouse_products` (`products_crud.rs:130`) is `pub` **and in the same file**, failing only because
  the doc names it unqualified; it needed `Self::`, not a crate path.

**MSL-66 (LOW, fixed): 23 links resolved, 41 → 23.** Ten files, 23 insertions / 23 deletions, and every
changed line a doc comment — verified with a filter over `git diff -U0` for added lines that are not
`///`/`//!`, which returns nothing.

**A bulk edit I had to clean up, recorded because it is the kind of damage a sweep does.** Applying the
qualification file-by-file with `replace_all`, one iteration threw on `regional.rs` (`RegionalConfig::method`
forms did not match my bare-name pattern) and aborted mid-loop — leaving files already edited. Re-running the
loop over the remaining names then hit those same files **a second time**, and `[`X`](p)` became
`[`X`](p)(p)`. Six sites across `memo.rs`, `payable.rs` and `db/fiscal.rs` were left double-applied.

I found them by *measuring*, not by re-reading: `cargo doc` reported **3 `redundant explicit link target`
warnings that did not exist before my edit**, and grepping for the literal `)(crate::` found all six
double-applications. Both classes are now zero, and the count is back to 15 locations / 23 links with
**zero redundant**. The lesson is worth keeping: an idempotency bug in a bulk edit is invisible in the diff
(the diff looks like a clean substitution) and only shows up in the tool that consumes it.

**Still open: 23 links / 15 locations.** Mostly the families already characterised — the stale-name pair
(`merge_smtp_password_with_stored` should be `merge_smtp_password_json`; `Store::claim_document_number_in_tx`
no longer exists, the real fn is `claim_statutory_number_for_sale` at `db/fiscal.rs:407`, and I verified its
doc's *description* of the one-statement concurrency contract is still accurate — only the name is stale),
the private-module links (`super::roles`, `super::staff`, `rates`, `revenue`, `scopes`, `datetime`,
`product_sales`), and the `pkce`/`desktop_link`/`availability` re-export names. Each now has its remedy
decided; the next pass is substitution.

**Verified:** 3311 `kasirmu-core` lib tests (0 failed, 55 `sync_client` filtered for the concurrent lane);
`clippy -p kasirmu-core --lib -D warnings` clean; all ten files `rustfmt`-clean; `cargo doc` re-measured
after every step, including the two regression checks above. Commit `8e20f40fb` (verified by hash).

**Tally:** 73 findings fixed (11 HIGH), 23 leads disproved. Two preventive pins. Crate-wide doc debt:
**52 → 23 links, 20 → 15 locations**, and the self-inflicted regression I introduced and cleaned sits
inside this pass rather than in a later one.

## Pass 89 — MSL-67: unresolved links reach ZERO, and a diagnostic I had been missing

Finished the link census. **`cargo doc` now reports 0 unresolved links and 0 redundant targets in
`kasirmu-core`, down from 46.** 14 files, 25 insertions / 21 deletions, every changed line a doc comment
(verified by filtering `git diff -U0` for non-doc additions across exactly the files named in the commit).

**MSL-67 (LOW, fixed) — four families closed this pass, each decided by reading the definition:**

| Family | Sites | Remedy |
|---|---|---|
| stale name (the item no longer exists) | `merge_smtp_password_with_stored` → `merge_smtp_password_json`; `Store::claim_document_number_in_tx` → `claim_statutory_number_for_sale` | correct the NAME; for the fiscal one I re-read the target and confirmed its doc's description of the one-statement concurrency contract is still true — only the name had rotted |
| `pub` item, same file | `explain_availability`, `generate_pkce`, `pkce_challenge`, `start_desktop_link`, `new`/`new_with_restaurant_pos` (`SessionContext`), `build_entitlements`, `list_warehouse_products` (`Self::`) | qualify the path |
| `pub mod` sibling | `super::staff`, `super::roles` | qualify as `crate::db::X` — a `super::` in a **module** doc resolves from the crate root, not from `db`, which is why the `pub mod` alone did not help |
| private `mod` | `datetime`, `revenue`, `sales_summary`, `product_sales` (`db/reports`), `rates`, `scopes` (`db/tax`) | plain backticks — these children are `mod`, not `pub mod`, so no path can link them |

**A correction to my own earlier fix.** Last pass I qualified `validate_table_geometry` as
`[`...`](crate::db::tables::validate_table_geometry)`. It is a bare `fn` — private — so qualifying it could
never work, and it was still failing this round. Reverted to plain backticks. That was my error, caught by
re-measuring rather than by re-reading my own diff.

**THE THING I HAD BEEN MISSING, and it changes how the debt should be reported.** Zeroing the `unresolved
link` count is not zero doc warnings. `cargo doc` emits a **second, distinct diagnostic** — *"public
documentation for X links to private item Y"* — which my census never counted because I grepped a different
phrase. There are **12** of them, and they are **pre-existing**: I verified `earn_points_with_conn` is
`pub(crate)` with the link present at HEAD. So the honest end state is:

```text
unresolved links     46 -> 0
redundant targets     3 -> 0   (2 were self-inflicted and cleaned here)
links to private     12       (pre-existing, never in my counts, own remedy)
```

Recording this because the previous five passes each reported a falling *unresolved* number as though it were
the whole of the doc debt. It was not, and the second class has the same established remedy (a private item
gets plain backticks), so it is the obvious next increment rather than a new census.

**Two self-inflicted regressions, found by measuring, not reading.** Both times the qualification of an
already-resolving link produced a `redundant explicit link target` warning — once at `entitlements.rs:302`
and `export/email_report.rs:56` this round. Both reverted to bare. Same lesson as MSL-66: a bulk doc edit
looks clean in the diff and only the consuming tool shows its mistakes, so `cargo doc` is re-run after every
step and its count re-read rather than assumed.

**A foreign hunk, refused again.** `roles.rs` came back carrying another lane's uncommitted rustfmt
reformat of the 105-character `EXISTS` line alongside my one doc line. Reverted that hunk, so the commit is
1 insertion / 1 deletion for that file and every line mine.

**Verified:** 3313 `kasirmu-core` lib tests, 0 failed (55 `sync_client` filtered for the concurrent lane);
`clippy -p kasirmu-core --lib -D warnings` clean; all 14 files `rustfmt`-clean; `cargo doc` re-measured after
every step, with the final state read from the tool rather than inferred. Commit `8b197d07d` (verified by
hash).

**Tally:** 74 findings fixed (11 HIGH), 23 leads disproved. Two preventive pins. Doc debt: **46 → 0 unresolved
links**, and **12 pre-existing private-item links** newly counted and recorded — the honest denominator I had
been quoting the wrong half of.

## Pass 90 — MSL-68: `cargo doc -D warnings` is clean, and the doc-debt arc closes

Took the increment MSL-67 named. **All three rustdoc warning counts are now zero on `kasirmu-core`, and
`RUSTDOCFLAGS="-D warnings" cargo doc` passes** — it failed before this arc started. That is the durable
outcome: the crate had no signal at all on a broken doc link, so a real one could be introduced freely.

```text
                    pass 85    now
unresolved links       46   ->   0
redundant targets       3   ->   0
links to private       12   ->   0
```

**MSL-68 (LOW, fixed): the last twelve, each verified private before touching it.** This family is one
diagnostic with one remedy — the item cannot be linked, so the name stays in plain backticks — but I checked
every target rather than assuming the pattern, and the visibilities are not uniform: `resource_covered_by`
and `earn_points_with_conn` are `pub(crate)`, `ensure_scoped_coverage_survives` is `pub(super)`, and
`build_audit_where`, `authorize_with`, `validate_scope_target`, `optional_smtp_fields`, `parsed_trial` plus
`IMAGE_REFS_IN_CHUNK` are bare. All twelve take the same remedy, but three different visibilities is exactly
the case where assuming would have picked the wrong one for some site.

**Ten files, 12 insertions / 12 deletions, every changed line a doc comment** — verified by filtering
`git diff -U0` for non-doc additions across exactly the files named in the commit. No foreign hunks this
time: the `roles.rs` reformat that dogged the last two passes belongs to another lane and that file is not
in this commit at all.

**The honest close on the arc.** Five passes (85-90) took this crate from "52 unexplained broken links" to a
clean `cargo doc -D warnings`. The reusable part is not the count but the method, which held every time:

- **Measure the tool, never the diff.** Every self-inflicted regression in this arc — six double-applied
  links in MSL-66, two redundant targets in MSL-67 and again here — was invisible in the diff and visible
  only in rustdoc's output. `cargo doc` was re-run and its count re-read after every single step.
- **Classify by cause before fixing.** "52 broken links" was five families with *four different remedies*
  (qualify a path, unescape a backtick, drop the syntax, correct a stale name). A blind sweep would have
  widened the public API to satisfy a doc.
- **Read the definition, not the name.** Confirming `pub` vs `pub(crate)` vs bare `fn` decided the remedy per
  site, and caught my own error when I qualified the private `validate_table_geometry` (MSL-67).
- **Count the right diagnostic.** I reported a falling *unresolved* number for five passes before noticing
  the *private-item* class was never in it at all. The denominator was wrong, not just the numerator.

**Verified:** 3313 `kasirmu-core` lib tests, 0 failed (55 `sync_client` filtered for the concurrent lane);
`clippy -p kasirmu-core --lib -D warnings` clean; `RUSTDOCFLAGS="-D warnings" cargo doc -p kasirmu-core
--no-deps --lib` **passes**; all ten files `rustfmt`-clean. Commit `4d243bfba` (verified by hash).

**Tally:** 75 findings fixed (11 HIGH), 23 leads disproved. Two preventive pins. Doc debt: **0 of every
kind**, with `-D warnings` armed on the doc tool for the first time in this crate.

## Pass 91 — MSL-69: the quota TOCTOU family is clean, and already pinned

Returned to code after closing the doc arc. Swept the **check-then-write** shape: 85 `SELECT COUNT(*)`
sites, filtered to those where a count decides a later write.

**The quota gates are the interesting subset, and they are disciplined.** Eight production call sites arm a
dimension and re-check in-transaction (`take_armed_quota`): Locations, Products, Warehouses, PosRegisters, and
Staff **three times** (create, profile write, reactivation). All eight share one shape — read the count
inside the caller's write transaction and refuse with `current > limit` — which is the only version that
closes the TOCTOU a pre-transaction gate cannot, since under WAL a pre-tx count reads its own snapshot.

**The Staff trio looked like the "one rule, four places" defect and is not.** Four copies of the identical
predicate exist — `count_staff_users` (`staff.rs:243`) and the three in-tx rechecks (`staff.rs:474`,
`staff.rs:661`, `profile.rs:609`) — all byte-identical (`is_active = 1 AND role_id != ?1`, OWNER bound), and
the docs claim they agree. Unlike the earlier duplication findings, I found this one is **already pinned
behaviourally**:

| Door | Test | How it catches drift |
|---|---|---|
| `create_user` | `create_user_tx_veto_closes_limit_race` | fills to `count_staff_users()`'s own limit, asserts the veto refuses the next and the count holds — a divergent predicate either persists the over-cap row or refuses a legal one |
| reactivation | `update_user_tx_veto_closes_the_reactivation_door` | asserts the over-cap refusal AND that the under-cap reactivation still succeeds |
| profile write | `profile_tests.rs:894-938` | same shape, baselined against `count_staff_users()` |

**And every other dimension is armed by a test too** — Locations ×2, PosRegisters ×1, Products ×2,
Warehouses ×2, Staff ×4 — plus a generic loop over all dimensions. So the answer here is "already done",
which is worth recording as a clean result rather than manufacturing a change.

**A near-miss on my own method, recorded because it is the failure mode of grep-driven censuses.** My first
pass reported **Products: 0 arming sites** — which would have been a real finding (a dimension with an
in-tx recheck and no test). It was false: `products_tests.rs` writes the path fully qualified
(`crate::downgrade::QuotaDimension::Products`), which my shorter pattern missed. Two lines of confirmation —
grepping the bare `arm_creation_quota` — showed 2 sites. The lesson is the one this campaign keeps
re-learning: a zero from a pattern is a hypothesis, not a measurement, and it should be checked against a
second spelling before it becomes a claim.

**One deliberate asymmetry, verified rather than assumed.** `staff.rs:657` reads through `self.conn` while
the other seven read through `tx`, because that function does not own the transaction — the comment says
returning makes the caller's `?` unwind and its guard roll back. I confirmed that is the actual contract:
the guard runs POST-update inside the caller's transaction, for the same WAL reason `create_user` counts
after its insert. Correct as written; nothing to change.

**No code change this pass.** The sweep found no defect, and the two things I could have "fixed" (a
duplicated predicate, a differing read handle) are both already pinned and reasoned. Recorded as a clean
census with the coverage table above, so the next pass does not re-walk it.

**Verified:** no files changed. The census rests on reading all eight production sites, all four predicate
copies, and the six test modules that arm them.

**Tally:** 75 findings fixed (11 HIGH), 23 leads disproved, 24 clean censuses. This is the second family
(after the KDS visibility mirror, MSL-63) where the answer was "the codebase already does this" — which is
the outcome a census is supposed to be able to produce.

## Pass 92 — MSL-70: the ungated-command axis is already covered by a generated ratchet

Swept the shape this campaign finds most often: **two layers that must agree, where one carries a guard the
other does not.** This time the twin pairs — the bridge's 63 unscoped/scoped command pairs — asking which
mutating command can be reached without a permission gate.

**The answer is "none that is not already tracked", and the codebase tracks it properly.** The desktop shell
carries a **generated** debt ledger (`commands/registration_gate_debt.generated.rs`) listing every registered
command the gate does not accept, with its measured state — **54 `no_session_resolution` entries** plus a
second class, `resolves_session_names_no_permission`. Its header says *"GENERATED by the registration-gate
sweep — DO NOT HAND-EDIT … a hand-edited line here is the drift this generated file exists to prevent"*, and
the ratchet test that regenerates it is what I already noted at pass 84 as a model of a self-guarding audit.

**My census rediscovered exactly one entry, and the ledger already names it.** The single surviving
candidate, `license::renew_license`, appears at `registration_gate_debt.generated.rs:132` as
`("license::renew_license", "no_session_resolution")`. I then verified the part that would actually matter:
the scoped twin is **not** a thin delegate — `renew_license_scoped` (`license.rs:1030-1033`) resolves the
session and calls `require_session_permission(SETTINGS_EDIT)` before delegating, with the usual F-017
comment. The ungated path is the legacy unscoped one, and it is named in the ledger.

**My detector was wrong twice in the same pass, and both errors are the same shape.**

1. First run reported **7 registered + mutating + ungated** commands, all in `inventory.rs`. All seven are
   gated — by `require_inventory_permission`, a module-local helper my pattern did not list. I read each of
   the seven to confirm.
2. Correcting that, by enumerating **all** gate helpers first (six real ones, plus two test functions that
   matched `^fn` in a test file), left one candidate — which the debt ledger already tracked.

This is the third time this campaign a pattern-derived count has been wrong (the KDS `cleanup_old_kds_orders`
zero in MSL-55, the Products `0 arming sites` in MSL-69, and now 7 ungated commands). The failing move is
identical each time: **treating a grep result as a measurement instead of a hypothesis.** When the pattern is
*absence* — no gate, zero sites — the correct next step is always to enumerate the referent set (here: every
`require_*` helper) and re-run, not to report the absence.

**What I would have proposed, had the ledger not existed:** document or gate `renew_license`. It is already
both — the ledger documents the debt class, and the scoped door that the UI actually uses enforces
SETTINGS_EDIT. So there is no change to make, and the honest output is a clean census plus the method
correction above, which is the transferable part.

**Verified:** no files changed. The census rests on reading all 63 twin pairs' registry entries, the 7
`inventory.rs` gates individually, the `renew_license` pair end to end, and the generated ledger.

**Tally:** 75 findings fixed (11 HIGH), 23 leads disproved, 25 clean censuses. Two families have now come
back "already handled" (MSL-63 visibility, MSL-69 quotas, MSL-70 gates), which is what a census should be
able to produce — and each time the useful residue was a method correction, not a patch.

## Pass 93 — MSL-71: inverted the sweep — guards that over-report rather than under-guard

Last pass ended noting that sweeps for **absent** guards were returning clean while method corrections kept
landing. So I inverted the premise: instead of "is a check missing", ask "does a check that exists say the
right thing". Two axes, one finding.

**Axis A — do Validation errors name the field they guard?** 373 production `field: "..."` sites across ~150
distinct names. I cross-checked every name against the schema columns and then against each site's message
text. Two sites looked wrong on the heuristic (`sales_lifecycle.rs:255` reports `field: "resolutions"` for a
message about a SKU; `sales_tax.rs:139` reports `field: "rate_bps"` for a message naming a SKU) and **both
are correct on reading** — the field names the guarded input, and the message carries the SKU as useful
context. The heuristic was catching prose, not defects. Axis clean; 75 field names with no matching column
proved nothing, because many legitimately name request-payload fields or composite names (`payments` is a
line array, `dataset` an export parameter).

**Axis B — do documented numbers match the code?** This is a positive check, which is why it was worth
running after three consecutive absence-based false positives. The subscription caps are documented as a
**published contract** (`docs/guides/user/subscription-tiers.md`, "single source of truth for tier pricing,
quotas and feature gates"), so a doc/code divergence is customer-facing.

**The numbers all match — I verified every tier.** `max_locations` Premium `Some(5)` against the doc's 5;
`max_pos_instances` 1/2/5/None; `max_warehouses` 1/2/3/None; `max_staff_users` 1/5/20/50/None;
`max_products` 200/500/1_000/10_000/None; `max_kds_screens` 0/2/None. Every one agrees with both the page
and its own doc comment.

**MSL-71 (LOW, fixed): the page named one pinning convention as if it covered all six caps.** It said
*"Each published number is pinned by a `*_matches_published_contract` test"*. Exactly **two** tests carry
that name (`tier_max_products_matches_published_contract` at `db/products_tests.rs:2673`,
`tier_max_kds_screens_matches_published_contract` at `db/workspaces_tests.rs:1772`); the other four caps are
pinned by the `tier_max_*` tests in `subscription_tests.rs` (14 number-assertion sites), which assert the
same literal values under different names.

So the substance was true and the mechanism description was not — and the failure mode it invites is
specific: a maintainer adding a seventh cap, grepping for `matches_published_contract` to see what to
imitate, would find two of six and could reasonably conclude their cap needs no pin. Corrected to describe
both conventions, with the file and line of each named test, and the reason it matters (this page cites code
rather than duplicating the table).

**Verified:** the two cited test names were grepped at their exact paths before being written down, and the
14 `subscription_tests.rs` assertion sites counted. No code changed, so no test run was needed; the round
touched one Markdown file.

**Tally:** 76 findings fixed (11 HIGH), 23 leads disproved, 26 clean censuses. Worth recording that
**changing the question from "what is missing" to "what is wrong" produced a finding after three
absence-based passes came back empty** — the same inversion that produced MSL-59 (a stale mirror note) and
MSL-63 (a doc under-claiming its own design) in earlier arcs.

## Pass 94 — MSL-72: the cross-file line citations, and four that had drifted

Continued last pass's inversion — ask **"what is wrong"** rather than **"what is missing"** — on a target
whose ground truth is checkable without judgement: doc comments that cite a **concrete file and line**. 40
distinct citations across the crate; a stale one sends a reader to the wrong code, and unlike prose a line
number is either reachable or it is not.

**MSL-72 (LOW, fixed): six citations, four of them pointing at content that had moved.**

| Citation | Claimed | Actually |
|---|---|---|
| `db/refunds.rs:315` → `db/reports.rs:467, :534` | report netting reads `refunds.total_minor` | **`db/reports.rs` is 40 lines** — the module was split into `db/reports/{datetime,revenue,sales_summary,product_sales}.rs`, so the target is categorically unreachable. The three real sites are `reports/revenue.rs:148, :215, :277`, and I verified each reads `SUM(total_minor) FROM refunds` |
| `cache.rs:453` → `apps/.../state.rs:331` | `is_healthy()` sampled once at startup | drifted to `:360`; I confirmed it is sampled there and `cache_healthy` appears nowhere else, so the *"sampled once and never polled"* claim is still true |
| `export/email_report.rs:134` → `bridge/sync.rs:72-74, :157-159` | the API-key and PG keep-on-blank rule | API key is now `:137-142`; the `:157-159` target no longer exists at all — the PG settings are `:172-178` |
| `export/email_report.rs:333-334` → `settings.rs:731-738`, `sync.rs:36` | the `stripe.api_key` read-back shape and `SyncSettingsDto::has_api_key` | `:731-738` is a db-lock error path; the real read-back is `gateway_status` at `settings.rs:987-992`. `sync.rs:36` is a doc about terminal secrets; `has_api_key` is at `:96` |

**The one citation I checked that was exactly right** is worth recording because it is the pattern the others
should follow: `terminal_profiles.rs:75` cited `terminals.rs:703` for "the bridge checks non-emptiness only" —
i read it, and `crates/kasirmu-bridge/src/terminals.rs:703` is precisely `validate_not_empty("profile_type",
...)`. The **path** was ambiguous though (a `db/terminals.rs` exists in core and is 454 lines, so a reader
looking there finds nothing), so I made the crate explicit. That fix is a clarification; that comment is mine
from MSL-52, and the citation it carries was correct.

**One near-miss on my own checker, the same shape as the last three passes.** My first reachability pass
reported **13 unreachable citations**, which would have been a much larger finding. Ten were false: my
resolver only tried three path prefixes, so cross-crate citations (`bridge/src/sync.rs`,
`platform/startup/src/lib.rs`) and slash-separated ones (`foundation/src/cart.rs`) all came back missing. I
resolved each by globbing its basename before believing any of them — and of the ten, two were genuinely
stale (recorded above) and eight land on plausible content.

**The transferable point, since it is now the fourth instance:** a pattern-derived *absence* is a hypothesis,
and the corrective is always the same — widen the referent set and re-run. Here the referent set was "path
prefixes", and widening it turned 13 into 2. This is the check I should run *first* on any future census, not
after the numbers look surprising.

**Verified:** 52 `db::refunds`, 18 `db::terminal_profiles` tests, 0 failed;
`clippy -p kasirmu-core --lib -D warnings` clean; all four files `rustfmt`-clean; the diff is 9 insertions /
8 deletions with **every changed line a comment** (`//`, `///` or `//!`), confirmed by a filter that accepts
all three forms after the first one flagged plain `//` lines as code. Commit `2d99359e0` (verified by hash).

**Tally:** 77 findings fixed (11 HIGH), 23 leads disproved, 27 clean censuses. Two findings this pass and
eleven last pass, from the same inversion — which continues to be the higher-yield direction now that
absence-based sweeps on guards and quotas have been exhausted.

## Pass 95 — MSL-73: cardinality and liveness claims — one finding, four verified

Kept pushing the "what is wrong" inversion onto another **checkable** class: doc comments asserting a
cardinality or a liveness fact ("the only caller", "three copies", "read here and nowhere else"). 38 such
claims; a cardinality is either right or wrong, which is what makes them worth checking rather than reading.

**Four claims verified true, and the verification is the point.**

| Claim | Verified how |
|---|---|
| `cache.rs:485` "`RedisCache`'s listener thread is the only caller" of `inventory_invalidation_target` | one production call site (`cache.rs:262`), everything else tests; and the enclosing `#[cfg(feature = "cache-redis")]` at `:154` confirms the *"that only caller is gated"* half |
| `memos.rs:524` "is the only writer of the column" | `SET status = 'archived'` appears once in `memos.rs:529`; the second hit is a `WHERE`, the third a different table |
| `subscription.rs:1173` "three copies of one predicate" | `grants_entitlements()` exists and both named sites now call it — `availability.rs:385` and `entitlements.rs:151` |
| `sync_client.rs:528` "rule expressed in six places" | all five named sync fns have a gated real body plus a disabled stub delegating to `sync_http_disabled_error()`; the sixth is `sync_pull::fetch_snapshot_from_server` |

**MSL-73 (LOW, fixed): one note wrong on all three of its claims.** `tax/scopes.rs:351-357` said the four
columns from `20260921` are *"read here and nowhere else"*, and that *"nothing in the sale computation path
calls this yet, because nothing can author a scoped row until the write-side slice lands"*. Measured:

- the columns are read widely — `effective_from`/`effective_to` have 31 production sites each outside this
  file (`sync_pull` writes and reads them; `sales_tax` reads them), `legal_entity_id` has 89;
- the sale path **does** call the resolver: `db/sales_tax.rs:577` is the level-3 lookup, documented at `:487`;
- scoped rows **can** be authored: `create_tax_rate_scoped` / `update_tax_rate_scoped` landed and are called
  from `tax.rs:341` / `:398`.

The note describes a slice's landing state that has since been superseded by two later slices. Corrected to
state the current behaviour, to name why the old note existed, and to keep the part that is still the real
justification — one resolver, so the sale, the authoring UI and the diagnostics cannot disagree about which
rate applies on a day. I verified the two `db/sales_tax.rs` line numbers and both `Self::` link targets
before writing them into a permanent comment.

**Why this class is worth a pass even though four of five came back clean.** These claims are the ones a
reader *acts* on — "the only caller" tells you it is safe to change a signature, "nothing calls this yet"
tells you the path is dead. When they rot they do not fail any test; they authorise a wrong change. The one
that had rotted was exactly of that kind: a maintainer reading it would conclude the sale path is unaffected
by the resolver, which is the opposite of the truth.

**Verified:** 78 `db::tax` tests, 0 failed; `clippy -p kasirmu-core --lib -D warnings` clean;
`RUSTDOCFLAGS="-D warnings" cargo doc` still passes (so the new intra-doc links resolve); `rustfmt` clean;
the diff is 18 insertions / 7 deletions with **every changed line a comment**. Commit `bea0c29b3` (verified
by hash).

**Tally:** 78 findings fixed (11 HIGH), 23 leads disproved, 28 clean censuses. Three consecutive passes from
the inversion have now produced findings after the absence-based sweeps on guards, quotas and links had all
gone quiet.

## Pass 96 — MSL-74: the liveness-claim census — 23 checked, all true

Deliberate extension of the inversion. MSL-73's finding was a **liveness** claim ("nothing calls this yet")
that rotted because the code moved forward, so this pass swept comments asserting what code does *not* do — a
class that can only rot in one direction. 661 raw hits for `never`/`not yet`/`no caller`, narrowed to **23**
genuine existential claims by keeping only comment lines that assert code existence or reachability (a design
statement like "must never resolve to available" is a rule, not a claim about the tree).

**All 23 are accurate. The verifications, since "clean" is only worth recording with the evidence:**

| Claim | Checked |
|---|---|
| `media.rs:12`, `payment_gateways.rs:11`, `payment_settlements.rs:11` "methods below are not yet functional" | each file is 3 `pub fn`, all returning `PLANNED, not implemented yet`, zero SQL — stubs stay stubs |
| `cache.rs:487` "dead code in a default build" | `Cargo.toml:47` `default = ['sync-http']`, so `cache-redis` is off; the `cfg_attr` at `:495` carries the allow |
| `workspaces.rs:277` "nothing writes it anymore" | only writer of `user_workspaces` is a test fixture (`workspaces_tests.rs:130`) |
| `sync_client.rs:416` "nothing writes `status = 'pending'` again" | every `status = 'pending'` in `offline.rs` is a `WHERE`, never a `SET`, across all 12 sites; and `sync_client_tests.rs:1203` already records verifying this exact claim |
| `subscription.rs:161` "the last caller is gone" | zero code callers of the deprecated `.max_stores()` — the only two textual hits are archived planning docs quoting it historically |

**One recommendation, not a repair.** `SubscriptionTier::max_stores` is now *provably* dead: no code caller
anywhere in the tree, and the migration that renamed the concept (`20260906`) landed long ago. But it is a
`pub fn` on a `pub` type, so removing it changes the crate's public surface — that is a decision about API
compatibility, not a defect, and the rule here is to record such a thing rather than act on it unilaterally.
Filed as a follow-up: the deprecation note could be upgraded from *"the last caller is gone"* to a deletion
when the crate's next breaking release is cut.

**What this pass does and does not establish.** It does **not** say liveness claims are reliable in general —
MSL-73 found one wrong on all three counts, one pass ago. It says this particular 23-claim set, in this crate,
is currently true, and that the class is worth a periodic re-run precisely because every one of these claims
authorises a change (deleting a function, assuming a code path is dead) and none of them fails a test when it
rots. Two of the twenty-three were checked *because* they looked most likely to have rotted (the "not yet
functional" stubs and the "last caller is gone" alias) and both were correct.

**Verified:** no files changed. The census rests on reading the four stub files end to end, the `Cargo.toml`
feature list, all 12 `pending` predicates in `offline.rs`, and grepping the deprecated method across the whole
tree.

**Tally:** 78 findings fixed (11 HIGH), 23 leads disproved, 29 clean censuses. One recommendation recorded
(delete the dead alias at a breaking release). Worth noting for the next pass: **four of the five inversion
passes found something and this one did not**, so the doc-accuracy axis is approaching the point where the
absence-based sweeps landed — the sensible next move is back to code behaviour rather than more comment
sweeping.

## Pass 97 — MSL-75: back to code — COR-12 closed on all three doors

Acted on last pass's steering note and returned to **code behaviour**, to the axis that has produced the most
findings: two layers that must implement one rule. This time the pair was the **SQLite and PostgreSQL halves
of the same HTTP route** — `POST /api/v1/products` dispatches to `pg::create_product` when a pool exists
(`routes/products.rs:251`) and to `store.create_product` otherwise (`:301`).

**MSL-75 (LOW, fixed): the 255-char name ceiling existed on one door of three.**

| Door | Before | After |
|---|---|---|
| create (SQLite) | refuses >255 — `products_crud.rs:305` | unchanged |
| **update (SQLite)** | **only checked non-empty**; an over-long name entered by edit | now refuses >255 |
| **create (PG / cloud)** | **no length check at all**; the same route accepted what the local branch refused | now refuses >255 |

The column is plain `TEXT` on both schemas with **no length constraint** (`20260813_init.pg.sql:865` declares
`('products', 'name', 'TEXT', NULL::text, true)`), so the guard is the whole rule on both sides — not a
backstop behind a CHECK.

**This was already known, and I found that before acting.** `docs/archived/2026-08-31-glm-5.3f-crates-audit.md:669`
records **COR-12 (LOW)**: "Name-length asymmetry. `create_product` rejects names >255 chars; `update_product`
only checks non-empty". It was still open — and still **tracked**, in the module's own audit stamp
(`db/products.rs:18`), with `next: add 255-char check to update_product (COR-12)`. So this pass is closing a
known item rather than discovering one, which is the honest description.

**Three things I checked that the original finding did not name.**

1. **The PG door.** COR-12 named only the core pair. The cloud branch of the same route had no check either,
   which makes the rule absent on 2 of 3 doors rather than 1 of 2.
2. **`update_product_attributes` was named in the original remedy** — *"and `update_product_attributes`"*. I
   read it: `UpdateProductAttributes` (`db/products.rs:184`) has **no `name` field** (cost, brand,
   rack_location, notes, unit, is_active, default_supplier_id), so there was nothing to guard. The remedy's
   parenthetical was imprecise, and applying it blindly would have meant inventing a check for a field that
   does not exist.
3. **Every sibling module already does it on both doors** — `customers.rs:219/278`, `suppliers.rs:99/186`,
   `staff.rs:533`, `promotions.rs` (fixed earlier as the same COR-12 class), and `pg.rs:833` for display
   names. `products` was the lone outlier, so the fix restores an established convention rather than
   inventing one.

**The test asserts agreement, not just a refusal.**
`update_product_refuses_the_name_length_the_create_path_already_did` drives BOTH doors with the same 256-char
name and asserts both refuse, then asserts exactly 255 is **accepted** — so the guard cannot pass by being
stricter than the rule it restores. Falsified by deleting the update-door guard: the test fails at `:421`, the
update assertion, with the create half still green. Restored and re-run.

**Stamp updated, because leaving it would have been a lie.** `db/products.rs` now records `COR-12 CLOSED
26-09-26` and moves `next:` to **COR-14**, which I verified is still open before naming it
(`products.rs:412`, `barcode_raw.and_then(|s| foundation::Barcode::new(&s).ok())` — the silent drop the audit
described).

**Verified:** 3321 `kasirmu-core` lib tests (55 `sync_client` filtered for the concurrent lane), 0 failed; 14
`update_product` tests including the new one; `clippy -D warnings` clean on **both** `kasirmu-core` and
`kasirmu-api`; all four files `rustfmt`-clean. Commit `39717ea2d` (verified by hash).

**Tally:** 79 findings fixed (11 HIGH), 23 leads disproved, 29 clean censuses. Note the shape of this one:
the productive move was not a new sweep but **taking a tracked-but-unfixed item and checking the two
adjacencies its original author had not** — the PG twin and the second named function. Both checks changed
the remedy.

## Pass 98 — MSL-76: COR-23 closed, its stamp corrected, and two orphaned fragments reunited

Continued last pass's productive shape — **take a tracked-but-unfixed item from an audit stamp and check the
adjacencies its author missed** — by harvesting all 66 non-`none` `next:` lines in `kasirmu-core`.

**One stamp item was already done.** `db/shifts.rs:6` asks for *"partial unique index on `shifts(user_id)`
WHERE status='open' (COR-27)"* — and `20261011_open_shift_uniqueness.sql:92` already creates
`idx_shifts_open_per_user`. Stale in the safe direction.

**MSL-76 (LOW, fixed): COR-23 was real, but stated wrong, and the remedy narrower than the item asks.**
`delete_customer` is a bare `DELETE`. The stamp claimed it *"hard-deletes regardless of sales history /
loyalty account — **dangling references possible**"*. That is **false**: `sales.customer_id` and
`loyalty_accounts.customer_id` are both NO ACTION and `foreign_keys` is ON on every connection path
(`migrations.rs:463`, `:535`, `:580`), so the FK rejects the delete outright — CUST-11 intends exactly that,
and its test already asserted the row survives.

So there was **no safety hole**, and the item's own remedy (*"consider soft-delete or referential guard"*)
would have added a guard the schema already provides. The real gap was **reporting**: the refusal reached the
client as `CoreError::Db` with a raw `FOREIGN KEY constraint failed`, naming neither the customer nor the
blocker. Now `Validation { field: "customer_id", .. }` with a message saying what holds the row and what to
do.

**Why `Validation` and not `Conflict` — which I first wrote, then corrected.** `Conflict` is the obvious
variant for "cannot delete", but its shared `Display` is `"conflict: {entity} already exists ({field})"`,
written for a uniqueness collision, and it reads as a **failed create** here. I checked before switching: all
22 production `Conflict` sites are uniqueness collisions and none is a blocked delete, so this would have been
the first and would have carried the wrong sentence. `Validation` takes a free-form message, and its
`CoreErrorKind::Validation` still reaches the UI as a distinct `sub_kind` — the actual gain over `Db`.

**Both halves falsified separately.** Deleting the mapping fails both new tests with the defect verbatim in
the output: `Db(SqliteFailure(ConstraintViolation, 787, "FOREIGN KEY constraint failed"))`. Sales and loyalty
are tested apart, because a mapping covering only `sales` would still leak a raw error for the loyalty
referrer.

**The bridge test was strengthened rather than left passing.** It asserted `BridgeError::Core { .. }`, which
my change still satisfied — a weaker assertion that would have kept passing while the message regressed. It
now asserts the exact `sub_kind` and that the message names the reference and the remedy, which also proves
the new shape survives the bridge boundary.

**MSL-77 (LOW, fixed): two fragments of the ledger itself were orphaned 760 lines from their entry.** While
reading the file to append this pass I found two closing blocks — Pass 82's "Note on scope" and "Leads
carried forward" — stranded at the end of the file, separated from Pass 82 by twelve blank lines and seven
later passes. Each appeared exactly once, so they were not duplicates but **misplaced**: a reader following
Pass 82 (the export timezone fix) never saw the scope note or the carried lead. Moved both back inside
Pass 82, immediately after its tally; the file now ends at the newest entry rather than trailing old prose.
This is also what made the carried lead findable again — it is the `export`/`reports` UTC divergence that
MSL-60 left open.

**Verified:** 3332 `kasirmu-core` lib tests (55 `sync_client` filtered for the concurrent lane), 0 failed; 28
`customers`; 47 `kasirmu-bridge` `customers`; `clippy -D warnings` clean; all three source files
`rustfmt`-clean. Commit `20cf1cbbc` (verified by hash).

**Tally:** 80 findings fixed (11 HIGH), 23 leads disproved, 29 clean censuses. Two passes of the stamp-harvest
shape have produced two fixes and two tracking-note corrections — it is yielding better than the comment
sweeps did, because each item already names a location and a suspected defect, so the work is verification
rather than search.

## Pass 99 — MSL-78: COR-29 closed, and the wrap measured rather than argued

Third pass of the stamp harvest, this time ranking the 19 remaining `next:` items by whether they name a
**concrete code location and a checkable claim** rather than a design preference. COR-8 (a `void_sale` CAS)
and COR-29 (an unchecked `received + damaged`) were the two money-path candidates; I took COR-29 first
because its remedy was a single expression.

**MSL-78 (HIGH, fixed): an over-receipt could wrap past its own cap.**

`receive_purchase_order_with_lines` guards with `if received + damaged > line.qty`. Every input is
**unbounded**: `purchase_order_lines.qty` is `INTEGER NOT NULL DEFAULT 0` with no CHECK or ceiling
(`20260813_init.sql:504`), creation only refuses a *negative* qty, and `received_qty`/`damaged_qty` arrive
as raw `i64` from the bridge DTO. Measured:

```text
qty      = i64::MAX                (9223372036854775807)
received = i64::MAX - 1
damaged  = 10
true sum = 9223372036854775816     -- wraps to -9223372036854775800
guard    = (wrapped > qty) = FALSE -- so the guard PASSES
```

A **negative** sum, so the comparison reads false: the over-receipt is persisted and stock-adjusted. Rated
HIGH because it is wrong today on a live path *and* the failure is silent in release (a debug build panics on
the same input, which is how it would surface in CI but not in the field).

**What made this a finding rather than a nit: the file already had the rule, and this was the one place it
was not applied.** `create_purchase_order` uses `checked_mul` (`:202`) and `checked_add` (`:208`) with an
explicit MONEY-05 note — *"CreatePoLineInput arrives over IPC (untrusted) and dev/test builds disable
overflow checks, so a bare `*` silently wraps"*. So the convention was stated, cited, and enforced two
functions above the one bare `+` on the same class of input.

**Falsified, and the failure output proved the mechanism.** Restoring the bare `+` fails the new test with
`got: NotFound { entity: "product", id: "prod-po" }` — i.e. the wrapped guard **passes**, the receipt proceeds,
and it only stops later for an unrelated reason (the stock adjust finding no product). That is stronger
evidence than the assert alone: it shows the bad value reaching the next stage.

**The stamp's own finding text already described it precisely** — *"i64 overflow wraps negative in release
and bypasses the ordered-qty cap (stock itself still guarded by checked_add inside adjust)"*, including the
correct observation that the stock write is separately guarded. So the audit had the mechanism right; what it
lacked was the fix. My first stamp edit restated that analysis, duplicating it; I collapsed the duplication so
COR-29 appears once, as closed.

**Verified:** 3336 `kasirmu-core` lib tests (55 `sync_client` filtered for the concurrent lane), 0 failed; 52
`purchase_order`; `clippy -D warnings` clean; both files `rustfmt`-clean. Commit `00e67b929` (verified by
hash; HEAD had moved to another lane's commit between the commit and the read, which is exactly why the hash
is checked rather than HEAD).

**Tally:** 81 findings fixed (12 HIGH), 23 leads disproved, 29 clean censuses. The stamp harvest is now
3-for-3 on producing fixes, and this is the highest-severity of the three — worth noting that COR-29 had sat
tracked-but-unfixed for two months with its mechanism correctly described, which suggests the remaining
`next:` items deserve the same treatment rather than being read as closed.

## Pass 100 — MSL-79: COR-8 was already fixed; what was missing was a test

Fourth pass of the stamp harvest, taking the other money-path item I deferred from MSL-78: **COR-8** on
`void_sale`.

**The stamp's `next:` line was stale, and its `findings:` text described code that no longer exists.** The
full original complaint was: *"`void_sale` (`sales_lifecycle.rs:567`) increments version and guards
`status='pending'`, but that is a state guard not the version CAS its comment claims, and the `execute()` row
count is **discarded** so voiding an already-voided or completed sale returns `Ok`."* Measured against the
current file:

| Claim | Now |
|---|---|
| predicate is the useless `status='pending'` state guard | it is `WHERE id = ?2 AND status = 'active'` — the sale's own live state, matching the pre-check |
| row count discarded | `rows == 0` rolls back and returns `Conflict { entity: "sale", field: "version" }` |
| `sales_lifecycle.rs:567` | the function is at `:822`; the file was split (`F-011`) and the line moved |

So both halves of the complaint are **fixed**, and the `status='pending'` guards the finding quoted belong to
`void_pending_sale` and the stale-reap path, not to `void_sale`.

**MSL-79 (LOW, fixed): the CAS branch was unreachable from every existing test.** Zero `CoreError::Conflict`
assertions in `sales_lifecycle_tests.rs`, and the one refusal test (`refused_void_writes_no_outbox_row`) trips
the **out-of-transaction pre-check**, which reports `Validation { field: "status" }` — a *different arm*. So
the fix was real but undefended: deleting `AND status = 'active'` would have left the suite green while a
completed (paid, points-awarded) sale could be overwritten to voided. That is exactly the MSL-78 shape, one
pass later: a correct fix with nothing holding it in place.

**The test is a real two-connection race**, following the `gift_cards_tests` precedent: a file-backed WAL DB
(`fresh_file`), a rival thread that stages `status='completed'` and holds the write lock, and connection A
running `void_sale` with a `busy_timeout` so it gets past its pre-check, then blocks on the UPDATE and loses.
It asserts both halves — the `Conflict`, **and** that the rival's `completed` survived the column.

**Falsified at the right place.** Dropping the `AND status = 'active'` predicate fails the test on the
`Conflict` assertion, which proves it reaches the CAS arm rather than passing via the pre-check. Restored and
re-run green.

**Stamp corrected in both places.** `next:` now says `none`, and the `findings:` text carries the closing note
with the correction inline — what the original claimed, what the code does now, and which missing guard
actually belongs to `void_pending_sale`. Recording the correction matters more than the closure here: a
future reader would otherwise look for a `status='pending'` guard in `void_sale` and conclude the fix had
regressed.

**Verified:** 3339 `kasirmu-core` lib tests (55 `sync_client` filtered for the concurrent lane), 0 failed;
`clippy -D warnings` clean; both files `rustfmt`-clean. Commit `d5a0f0d8b` (verified by hash).

**Tally:** 82 findings fixed (12 HIGH), 23 leads disproved, 29 clean censuses. Four passes of the stamp
harvest have produced three fixes and **two items that were already repaired but never pinned**. So the
harvest is yielding something other than un-repaired defects: code that is **correct and undefended**, where
an audit recorded a right fix and left the branch untested. That is the target to carry forward rather than
looking for new defects.

## Pass 101 — MSL-80: a test I wrote and then withdrew, because its precondition is not committed

Acted on last pass's stated target — **code that is correct and undefended** — by enumerating it rather than
picking items one at a time: all **16** production `CoreError::Conflict` returns in `kasirmu-core`, checked
against every sibling test file for a `Conflict` assertion.

**The enumeration.** Ten files assert a `Conflict` somewhere; the ones with **zero** assertions were
`kds_orders.rs`, `products_stock_query.rs` and `workspaces_lifecycle.rs` (the latter two recorded for a later
pass). The most valuable was `kds_orders.rs:494` — a compare-and-set whose own comment claims it is *"the same
shape and same reason as `update_po_status`"*, and whose precedent **is** pinned by
`update_po_status_race_cannot_overwrite_a_competing_transition`. The copy had no test, so deleting its
`AND status = ?4` predicate would leave the suite green while a rival transition was silently overwritten.

**I wrote the test, it works, and I withdrew it.** A two-connection race using the precedent's *busy-handler*
technique (not a fixed timer — the precedent's own doc explains a timer is load-dependent and can fail a
correct implementation, so I followed it rather than repeating the simpler version I used in MSL-79). It
passes in 0.9s and falsifies correctly: dropping the predicate fails on the *"winner's status must survive"*
assertion, proving the lost update the comment describes.

The first run failed for a reason worth recording: I had A request `pending -> ready`, which the KDS state
machine **rejects before any write**, so A never reached the UPDATE and the busy-handler deadline fired
("A never reached its write lock within 10s"). Changing it to `pending -> cancelled` established the
interleaving. A race test whose setup is invalid fails by *timeout*, not by assertion — worth knowing.

**Why it is not committed: its precondition is another lane's uncommitted work.** Checking the diff before
committing showed `kds_orders.rs` had **40 changed lines** when I had touched one predicate, and the diff was
*adding* the whole CAS: at HEAD the UPDATE is an unconditional `WHERE id = ?3` with **0** `Conflict` returns
(the worktree has **1**). The file's mtime was 10:46:53, five minutes before my own edits — another agent is
actively writing it right now.

So my test asserts a `Conflict` branch that **does not exist at HEAD**, and committing it would break
`cargo test` for every other lane. Committing `kds_orders.rs` alongside it would sweep their in-flight change
under my message, which the house rules forbid outright. Neither option is acceptable, so the test was
withdrawn.

**A revert I got wrong, and caught.** Removing the test by slicing lines 1..4186 also deleted **876 lines**
of real content — I had read `totalLines: 4286` and mistaken a line *count* for the original file length, so
the slice cut into the pre-existing suite. `git checkout --` restored it and the kds family went back to 174
passing. Recorded because it is the failure mode of range-based edits: the range must come from the *diff*,
not from a line count read later.

**What is left for the next pass, and the right order to do it in:** the test is reconstructable from this
entry when `kds_orders.rs` lands (the CAS, the `pending -> cancelled` transition, the busy-handler
interleaving, and the two assertions — `Conflict { entity: "kds_order" }` and status stays `preparing`).
`products_stock_query.rs:324` and `workspaces_lifecycle.rs:210` remain uncovered and are **not** blocked by
anyone, so they are the safer next targets.

**Verified:** kds family back to **174 passed** after the restore, and the full core suite re-run at
**3339 passed, 0 failed** (55 `sync_client` filtered for the concurrent lane) — the earlier 3341 was a run
that still included my test, so it is not comparable; `clippy -D warnings` clean; `rustfmt` clean;
`kds_tests.rs` byte-identical to HEAD (`git status` clean for it). No commit this pass — nothing of mine
survived to commit.

**Tally:** 82 findings fixed (12 HIGH), 23 leads disproved, 29 clean censuses. One lead recorded rather than
actioned: the enumeration produced a real gap, a working fix, and a reason not to land it that only appeared
when I checked the diff against HEAD — which is the check the commit policy exists to force.

---

## Pass 102 — the sync replay that dead-letters a valid non-retail product (MSL-81)

Pass 101 closed with `products_stock_query.rs:324` named as the next uncovered `Conflict` branch and
explicitly *not* blocked by any other lane. This pass took it and found something larger than a missing
assertion: the branch was **wrong**, not merely untested.

### What the branch is for

`create_product_if_absent_in_tx` is the `product.created` pull arm's storage door. It reads the existing row
for the SKU and decides *idempotent replay* vs *genuine conflict*:

```
let same = existing_name == name.trim()
    && existing_price == price.minor_units
    && existing_currency == cur_str
    && existing_category.as_deref() == category_id
    && existing_barcode.as_deref() == barcode
    && existing_type == product_type;   // <-- this line
```

Its own doc says *"a repeated SKU is only idempotent when it describes the same product"*. The comparison is
the right idea; the sixth conjunct was comparing against a value the producer **cannot supply**.

### The defect: the producer's event has no `product_type` at all

`InventorySyncEnqueuer::handle` (`platform/startup/src/event_handlers.rs:151`) builds the queue payload from
the `ProductCreated` domain event:

```
let payload = serde_json::json!({
    "sku": event.sku, "name": event.name, "price_minor": event.price_minor,
    "currency": event.currency, "category_id": event.category_id,
    "barcode": event.barcode, "initial_stock": event.initial_stock,
}).to_string();
```

There is no `product_type` key, and there **cannot** be one: `ProductCreated` (`foundation/src/events.rs:54`)
has seven fields and none of them is a type. The event cannot express the type it is announcing.

The consumer then invented one:

```
let product_type = payload["product_type"].as_str().unwrap_or("retail");
```

So an *absent* key became the *value* `"retail"`, and that invented value was fed into the equality check
above. For a product created as anything else the conjunct is `"service" == "retail"` — false — and a
byte-for-byte replay of a product the terminal itself just created is reported as
`Conflict { entity: "product", field: "sku" }`, fails its apply, and burns a retry unit toward the
dead-letter budget.

The write path proves the value is real and user-supplied: `CreateProductScopedArgs.product_type: String`
(`crates/kasirmu-bridge/src/products.rs:80`, default `"retail"` at `:636`) reaches the DB at `:722` and the
event at `:738` — passing through the publish without ever being added to it.

### The stamp was confidently wrong

The module stamp at `platform/sync/src/queue.rs:5` asserted the opposite in as many words: the
`unwrap_or("")`/`unwrap_or(-1)` defaults are *"fully caught at the storage boundary"*. For `sku`, `name`,
`price_minor` and `currency` that is true — the defaults are blank/invalid and get validated. For
`product_type` the default is a **plausible legal value**, so nothing catches it; it is silently compared as
if it were data. A default that is *valid* is more dangerous than one that is invalid, because the validation
layer designed to catch the invalid ones cannot see it. This is the same failure the ledger recorded four
times before: a confident statement about a mechanism is a hypothesis until the mechanism is executed.

### Fix

Three coordinated changes, smallest complete set across the real data flow:

1. **`crates/kasirmu-core/src/db/products_stock_query.rs`** — the type is now `Option<&str>` on a new
   `create_product_if_absent_with_tx`; the conjunct becomes
   `product_type.is_none_or(|t| existing_type == t)`. The old `create_product_if_absent_in_tx` is kept with
   its exact signature and now delegates with `Some(product_type)`, so `is_none_or` degrades to
   `existing_type == t` and **no existing caller's semantics change**. The INSERT uses
   `product_type.unwrap_or("retail")` (the column default), and the service short-circuit reads
   `product_type == Some("service")`.
2. **`platform/sync/src/queue.rs`** — `let product_type = payload["product_type"].as_str();`, absent
   passed through as absent, with a comment naming the event struct as the reason.
3. **`platform/sync/src/queue_tests.rs`** — the regression test below.

### Why not fix it in the event instead

Adding `product_type` to `ProductCreated` would be the *better* long-term shape, but it is a wider change
(the struct, its `Deserialize` contract, and every publisher: `crates/kasirmu-bridge/src/products.rs:738`,
`apps/mobile-tauri/src/commands/products.rs:488`, plus three test constructors) and it would change a
serialized event's schema. Passing absence through as absence fixes the live bug at the boundary that
actually misreads it, and stays correct for any other producer that also omits the key. Recorded as a lead:
**`ProductCreated` should carry `product_type`; the consumer's `Option` is the compatibility shim that lets
it be added later without another break.**

### Regression test and falsification

`a_non_retail_product_replay_is_idempotent_despite_the_producers_missing_type` seeds a `service` row, then
replays the payload in *byte-for-byte the shape `InventorySyncEnqueuer` enqueues* — every key it sets, and
no `product_type` key. It asserts the apply succeeds, the receipt is written, **no** dead-letter failure row
is created, and the stored type survives as `Service`.

Falsified by restoring the old line in the consumer and re-running: it fails exactly as predicted —
`called Result::unwrap() on an Err value: Conflict { entity: "product", field: "sku" }` — then the fix was
restored and the test passed again. The fix is load-bearing.

**Verified:** `platform-sync` lib **436 passed, 0 failed**; `kasirmu-core` lib **3395 passed, 0 failed**
(up from 3339 at pass 101); `products_stock_query` family 3/3; `clippy -D warnings` clean on both crates;
`rustfmt` clean on my three files. Committed as `633bee434`, verified by hash to contain exactly those three
paths.

**Foreign hunk refused again.** `crates/kasirmu-core/src/db/products_stock_query.rs` and its sibling
`products_stock_query_tests.rs` were dirty before I started: a tree-wide `cargo fmt` from another lane
(reflowing `publish_inventory_change(...)` and a set of trait method bodies). The test file is **100% theirs**
and was not committed; the one foreign hunk that had landed in the *production* file I reverted by hand so my
commit is exactly my three hunks. The residue rustfmt still reports at `products_stock_query.rs:488` is that
lane's, present at HEAD, and is none of my change.

**Tally:** 83 findings fixed (13 HIGH), 23 leads disproved, 29 clean censuses. One new lead recorded:
`ProductCreated` should carry `product_type`.

---

## Pass 103 — the variant-blind assertion on `workspaces_lifecycle.rs:210` (MSL-82)

Pass 102 closed naming this as the last uncovered `Conflict` branch. It was not uncovered — it was covered
by an assertion that **cannot tell the difference**, and the census that called it uncovered was itself
the same pattern-derived absence the ledger has now recorded five times.

### The census was wrong, and the way it was wrong is the lesson

I grepped `Conflict` in `workspaces_tests.rs` and found **zero** matches, so I wrote "zero assertions" into my
working note. The branch *is* exercised — by `create_workspace_instance_duplicate_fails` at `:295`, which
predates this pass:

```
let result = store.create_workspace_instance("default-restaurant-pos", ...);
assert!(result.is_err());
```

`assert!(result.is_err())` passes for *any* error. The referent of my search was the **error variant**, but I
searched for the **token** `Conflict` — and the test never spells it. A pattern-derived absence is a
hypothesis, not a measurement; the referent set has to be enumerated and re-run, exactly as recorded at
MSL-59/63/64 and four more times since. The honest statement was never "uncovered", it was "pinned by an
assertion blind to the distinction the branch exists to create".

### What the branch actually does, proven rather than assumed

`create_workspace_instance_with_purpose` probes `COUNT(*) > 0 FROM workspace_instances WHERE id = ?1`, and
returns `Conflict { entity: "workspace instance", field: "id" }` when true, before a bare `INSERT`.
`workspace_instances.id` is `TEXT PRIMARY KEY` (`migrations/20260813_init.sql:984`), so the INSERT is
independently protected by a real uniqueness constraint. That makes the two failure modes distinguishable:

- the pre-check fires → the documented `Conflict`;
- a race that slips past the pre-check → `UNIQUE constraint failed`, surfacing as a raw
  `Db(SqliteFailure(...))`.

I falsified by disabling the pre-check (`if false && exists`) and re-running the strengthened test:

```
expected Conflict on the id, got Db(SqliteFailure(Error { code: ConstraintViolation,
  extended_code: 1555 }, Some("UNIQUE constraint failed: workspace_instances.id")))
```

So the pre-check is **load-bearing** — it is the only thing converting a storage fault into the error the
function's own doc at `:99` promises. The old `is_err()` assertion would have passed just as happily with the
pre-check deleted. This is MSL-79's shape (`void_sale`'s CAS was correct but unpinned) with one difference:
there the assertion was missing, here it was present and vacuous. **A test that cannot fail for the reason the
code exists is worse than no test, because it reports as coverage.**

### Fix

One hunk in `crates/kasirmu-core/src/db/workspaces_tests.rs` — the weak assertion becomes a match on the
variant, asserting `entity == "workspace instance"` and `field == "id"`, with a `panic!` naming the actual
error. No production change was needed: the branch was correct, only unpinned. Confirmed by restoring the file
to HEAD (`git status` clean for `workspaces_lifecycle.rs`).

**Verified:** the strengthened test passes; the workspaces family **78 passed, 0 failed**; `kasirmu-core` lib
**3395 passed, 0 failed**; `rustfmt` clean on my file. Committed as `1c4f9d5ff`, verified by hash to contain
exactly that one file. The falsification edit was reverted and `workspaces_lifecycle.rs` is byte-identical to
HEAD.

**Foreign hunks refused again — two in the same file.** `workspaces_tests.rs` carried a second lane's
`cargo fmt` reflow (a `use` statement's stray `\n    ;` and a wrapped `assert!`), which I reverted by hand so
the commit is exactly my one hunk.

**A clippy note worth recording, not fixing here:** `cargo clippy -p kasirmu-core --all-targets -- -D
warnings` currently fails on **three pre-existing** lints in files *not* mine — `product_bundles_tests.rs:334`
(`empty line after doc comment`), `gift_cards_tests.rs:971` and `workspaces_instances_tests.rs:60` (`match` for
single-pattern destructuring). The first two are **clean at HEAD**, so this is repo-wide debt older than this
pass, not a regression I introduced; the third is another lane's dirty file. My own files are lint-clean under
`--lib`. Recorded because `clippy -D warnings` is a stated gate that no live workflow runs, so it will stay
red until someone owns it.

**Tally:** 84 findings fixed (13 HIGH, 71 others), 24 leads disproved, 29 clean censuses. The branch census
from pass 101 is now closed: every production `Conflict` return in `kasirmu-core` has a variant-pinning
assertion except the two recorded as belonging to other lanes (`kds_orders.rs`, MSL-80's withdrawal).

---

## Pass 104 — two stamps stale in the DANGEROUS direction (MSL-83)

Every prior stamp pass found stale items that were **safe**: a `next:` line naming work already done, or a claim
that turned out conservative. This pass found the opposite, and the direction is what makes it a finding.

### The pattern, named precisely

`drivers/qris.rs` had already been corrected once for this exact defect — its stamp records it in as many words:
*"A reader who skims only `next:` was being sent to redo three closed items"* (PAY-C, corrected 2026-09-25).
That correction was applied to **one file**. I enumerated the remaining `next:` lines across the workspace and
found the same defect standing **one file up**, in the crate root:

```
crates/kasirmu-payment/src/lib.rs:5
next: give refund an idempotency key (PAY-2), partial refund (PAY-3), Stripe decline classification (PAY-4)
```

and again in a second file:

```
crates/kasirmu-payment/src/types.rs:4
findings: ... idempotency_key contract ("processor generates fallback if None") ignored by all live drivers — PAY-2
```

**A correction applied to one instance of a defect is not a correction of the defect.** PAY-C fixed the file where
it was noticed; the same sentence survived in two others because nothing enumerated the class. That is the
general lesson, and it is the same shape as the census failures recorded at MSL-59/63/72 — the referent set has
to be enumerated, not the one site that happened to be read.

### Verification of each claim, not assertion

I checked all three items individually against the code before touching the stamp:

| Item | Claim in the stamp | Evidence found |
|---|---|---|
| PAY-2 refund idempotency | "open, unchanged" | **CLOSED** — `RefundRequest.idempotency_key` (`types.rs:52`) threaded through the trait (`processor.rs:102-107`), honoured by `qris.rs:689`, `stripe.rs:465` (via `idempotency_key_for` at `:242`), `square.rs:439` (via `:341`) |
| PAY-3 partial refund | "open" | **CLOSED** — `refund` takes `amount: Option<Money>`, doc at `processor.rs:93`: *"If `amount` is `None` the full amount is refunded"* |
| PAY-4 Stripe decline classification | "open" | **CLOSED** — code-based mapping fixed and documented at `stripe.rs:300-324` |

Each closed item is also **pinned by a test** — `qris_tests.rs:105`, `stripe_tests.rs:21` and `:293`,
`square_tests.rs:186` — so this is not a case of code without coverage.

### The stale universal (`types.rs`) — the sharpest part

`types.rs:4` said the contract was *"ignored by **all** live drivers"*. That is a universal claim, and it was
false in a specific and checkable way: **three of the four drivers honour it**. The only driver that ignores it is
Paddle, and it ignores it because it is a `PLANNED` stub returning `Unsupported` for every method
(`paddle.rs:111-120`) — it performs no operation at all, refund included.

So a universal was written from a non-universal observation (the state of the majority in July), and **nothing
re-checks a universal when its referent set changes**. Three drivers were fixed underneath the sentence and it kept
reading as current. This is worth separating from ordinary staleness: an absolute claim degrades *silently*, because
each individual change looks like it is only touching one driver, and no diff ever touches the sentence that
quantified over all of them.

### Fix

Comment-only, 5 insertions / 5 deletions across two files — no code changed. Both stamps now name what is actually
open in the crate (`webhook.rs` verifiers are a fail-closed stub, PAY-11; `registry.rs` `build_from_config` is a
PLANNED stub, PAY-12 — both deliberate, both fail closed, neither a correctness hole), give the per-item evidence
with line anchors, and record the shape of the error so the next reader does not repeat it.

**Verified:** `kasirmu-payment` **182 lib + 4 + 3 + 21 + 13 + 16 + 22 + 13 + 5 doctests passed, 0 failed**;
`clippy -p kasirmu-payment --all-targets -- -D warnings` clean on the crate; `rustfmt` clean on both edited files.
Committed as `f7bb70469`, verified by hash to contain exactly those two paths. Note for anyone re-running rustfmt
here: `--check` on `lib.rs` **recurses into sibling modules**, so it reports diffs in `stripe_tests.rs`,
`registry_tests.rs`, `resilience.rs` and `resilience_tests.rs` that are **another lane's** unformatted work and are
not in `lib.rs` at all — the `Diff in ...` lines must be read for their *path*, not just their exit code.

**Tally:** 85 findings fixed (13 HIGH, 72 others), 24 leads disproved, 29 clean censuses. The `next:`-line backlog
is now enumerated (231 lines, ~60 non-`none`); this pass closed 2 of them and the enumeration itself is recorded so
the next pass can work the remainder without re-scanning.

---

## Pass 105 — SEC-1: the string-matched status code that turned failures into `Ok(None)` (MSL-84)

This one came out of the enumerated `next:` backlog rather than from reading a module, and it is a **live
correctness bug in shipped code**, not a stale stamp.

### The defect, measured

`crates/kasirmu-security/src/macos.rs` decided whether the keychain was reporting "no such item" by searching
the **debug string** of the error:

```
Err(e) if e.code() < 0 => {
    // errSecItemNotFound = -25300, errSecUnimplemented = -128.
    if format!("{e:?}").contains("item not found")
        || format!("{e:?}").contains("-25300")
        || format!("{e:?}").contains("-128")
    {
        return Ok(None);
    }
```

Three independent things are wrong with those five lines, and I measured each rather than inferring it:

1. **The numeric code was in hand and was discarded.** The guard already evaluates `e.code()`, and
   `security_framework::base::Error::code()` returns the `OSStatus` (`base.rs:62`, `pub const fn code(self)
   -> OSStatus`). The correct value was one comparison away the whole time.
2. **`"-128"` is a prefix of the entire `-128xx` range.** Enumerated: `-12800`, `-12801`, `-12899`, `-1280`
   all contain it, as does `-128` itself. Each is a genuine failure, and each was reported as an absent item —
   a storage error silently downgraded to `Ok(None)` in `get_secret` and to `Ok(false)` ("already deleted") in
   `delete_secret`. The `get_secret` direction is the dangerous one: a caller that reads `None` will provision a
   fresh secret over one that exists.
3. **The comment's own constant is wrong.** It states `errSecUnimplemented = -128`.
   `security-framework-sys::base` defines `errSecUnimplemented = -4` (`base.rs:54`). `-128` is not an errSec
   not-found code at all, so even the intended second code was fictitious.

The authoritative values are available in a crate we already depend on — `errSecItemNotFound = -25300`,
`errSecUnimplemented = -4`, `errSecDuplicateItem = -25299` (`security-framework-sys-2.17.0/src/base.rs:53-61`)
— so nothing here needed to be recalled or guessed.

### Why it had survived every previous pass

`macos.rs` is `#[cfg(target_os = "macos")]`, and its test file `macos_tests.rs` is behind the same gate.
There is **no macOS target installed on this machine** (`rustup target list --installed` shows only
android/windows/linux), so the module is neither compiled nor tested in this environment — and the same is true
of every Windows-hosted review the crate has had. The stamp is honest about this: `lint: N/A (platform-gated,
source-reviewed on Windows host)`. "Source-reviewed" is exactly the reviewing mode that does not catch a
predicate error, because the behaviour only exists at runtime.

### Fix — and the part that matters more than the fix

The predicate now lives in a **new, deliberately non-gated module**, `crate::keychain_status`:

```
pub const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

pub const fn status_means_item_not_found(code: i32) -> bool {
    code == ERR_SEC_ITEM_NOT_FOUND
}
```

`macos.rs` consumes it (`Err(e) if status_means_item_not_found(e.code()) => Ok(None)`), which **deletes** the
malformed branch rather than patching it. Placing the predicate outside the platform gate is the substantive
part: a fix that stays inside `#[cfg(target_os = "macos")]` would be just as unverifiable as the bug was, and
would ship on the same "source-reviewed" basis. Now it compiles and runs on every host and in CI.

The constants are duplicated as literals with the source named in a doc comment, rather than referenced from
`security-framework-sys`, because `security-framework` is itself `[target.'cfg(target_os = "macos")'.dependencies]`
in this crate's manifest — importing the constant would drag the gate back in and defeat the point.

### Tests, all runnable on this host

`keychain_status_tests.rs` pins: the exact code means absence; each `-128xx` code is a failure (the SEC-1
regression, named as such); `-4`/`-128` are not absence; the neighbouring real statuses (`-25299`, `-25293`,
`-25263`, `-25318`, and the values immediately either side of `-25300`) are not absence; and a sweep of
`-25400..=-25200` finds **exactly one** code meaning absence.

**Falsified.** Restoring the original predicate verbatim fails on cue:

```
status -12800 is a failure, not an absent item        (a_code_merely_containing_the_needle_is_not_absence)
assertion failed: !status_means_item_not_found(-128)  (unimplemented_is_not_absence_either)
```

then the fix was restored and all five passed. Worth recording that the *first* falsification attempt did not
compile (`contains` is not `const fn`), so I made the falsified predicate non-`const` and re-ran — a
falsification that fails to build proves nothing, and it would have been easy to record it as a pass.

**Verified:** `kasirmu-security` **93 lib passed** (up from 88 — the five new tests), 0 failed;
`clippy -p kasirmu-security --all-targets -- -D warnings` clean; `rustfmt` clean on all four edited files;
`macos.rs` confirmed to still **parse** (`rustfmt --emit stdout` exits 0) since no macOS target can compile it
here. Committed as `66240faaf` via the §3 new-file chain, verified by hash — two `create mode` entries, exactly
my files.

**Note on the limits of this verification, stated plainly:** the fix is verified *logically* — the predicate is
tested and the call sites use it correctly — but `macos.rs` itself still cannot be *compiled* on this host, so
the wiring is source-reviewed, not machine-checked. That is a real gap and it is the same gap that hid SEC-1.
Closing it needs a macOS runner or the `x86_64-apple-darwin` target added to CI; recorded as a lead rather than
claimed as done.

**Tally:** 86 findings fixed (14 HIGH — this is the 14th, and a live silent-failure rather than a doc defect;
72 others), 24 leads disproved, 29 clean censuses. The `next:` backlog enumeration paid for itself here: this
was filed as "replace string matching with numeric code compare" and read, on a skim, like a tidiness item.

---

## Pass 106 — SEC-5, and a lead disproved by the same method (MSL-85)

Two results in one pass: one finding reclassified, and one lead killed. Both came from applying SEC-1's own
method — verify the referent set before acting on the claim.

### The lead that was disproved

The `linux.rs` stamp carries `next: reentrancy strategy for Runtime; atomic set; **numeric error matching**` —
the same phrase as SEC-1, in the same crate. After fixing SEC-1's string-matched status code on macOS I went
looking for the Linux twin.

**There is none.** `linux.rs` never string-matches a status: it asks the Secret Service for matching items and
reads absence from an **empty result set** (a `SearchItems` round trip). There is no status code being
compared, so there is nothing to mis-compare. The phrase in the stamp refers to the `zbus` error surface
generally, not to an incoming-status decision. Lead disproved — and worth recording precisely because the
*phrase* matched while the *mechanism* did not. A shared vocabulary is not a shared defect.

### SEC-5, reclassified

The stamp said: *"insecure_skip_verify is serde-visible with no guard, log, or debug gate — consumer gating
must be verified"*, with `next: warn or gate insecure_skip_verify in release builds (SEC-5)`. The instruction
presumes a live insecure path. I checked for one:

- `TlsConfig` is a plain data struct — paths, a `bool`, a `Vec<String>`.
- The crate has **no TLS implementation**: no `rustls`, no `native-tls`, no `ClientConfig`, no
  connector of any kind (grep for each returns nothing in-crate).
- A workspace-wide grep for `insecure_skip_verify` finds **zero consumers outside this crate**. The only other
  mentions are two docs (`ARCHITECTURE.md:578`, `ROADMAP.md:185`) that describe it as configuration helpers,
  which is what it is.

So the flag is **inert**: setting it `true` disables nothing, and setting it `false` enables nothing. Gating it
in release builds, as the filing asked, would have been cargo-culting a guard onto a value with no effect — and
it would have *implied* the flag is live, which is the more dangerous reading of the two.

An independent archived audit agrees: `docs/archived/2026-08-31-glm-5.3f-crates-audit.md:465` records
*"`insecure_skip_verify` has **zero consumers outside this crate**"*. Two passes, different methods, same
referent.

**The real hazard is latent-by-wiring.** The danger is not today's behaviour, it is the day someone builds a
connector from this struct and inherits a boolean documented only as *"(development only)"* — an unenforced
promise, not a description. The fix therefore puts the obligation where that author will be reading it:

- the field docs now state, first, that it is **currently inert**, and name the gating duty that begins the
  moment a consumer exists;
- `TlsConfig::insecure_verification_is_inert()` is the tripwire, and
  `insecure_skip_verify_is_inert_configuration_not_a_live_bypass` pins the current fact.

**Falsified:** flipping the tripwire constant to `false` fails the test on its own message (*"the flag is inert
only while no connector consumes TlsConfig"*), then the constant was restored and the suite went green again.

**A design decision worth recording:** my first draft of the tripwire walked the whole workspace from inside
the unit test, looking for a read of the field, and failed if it found one. I deleted it. It was slow, it
re-read the filesystem on every test run, it could not see another lane's uncommitted work (so it would report
a false negative on exactly the change it existed to catch), and it duplicated what a plain grep already does.
A tripwire that is *a doc comment plus an assertion about the type* costs nothing and is honest about what it
actually guarantees. The scanner was over-engineering, and the ladder says reuse the grep.

**Verified:** `kasirmu-security` **94 lib passed** (up from 93), 0 failed; total suite 94 + 7;
`clippy -p kasirmu-security --all-targets -- -D warnings` clean; `rustfmt` clean on both edited files.
Committed as `a5ffe9d94`, verified by hash to contain exactly the two paths. The only *code* change is the
const tripwire; everything else is documentation and one test.

**Tally:** 87 findings fixed (14 HIGH, 73 others), 25 leads disproved — this pass added the Linux twin to the
disproved column, which is where it belongs — 29 clean censuses. SEC-5 is closed in its reframed form; the
original instruction is retained verbatim inside the stamp so the next reader can see why it was changed rather
than finding it silently gone.

---

## Pass 107 — COR-2: the map that only ever grew (MSL-86)

Filed as *"per-username HashMap unbounded — login-form spam grows memory without cap"*. That is accurate, and
it undersells the mechanism, which I got precisely by reading the code rather than the summary.

### What was actually wrong

`record_failure` did this:

```
let attempts = map.entry(username.to_string()).or_default();
attempts.retain(|t| now.duration_since(*t) < window);   // prunes the VEC
```

The **vector** was pruned on every call. The **key** was never removed. So the map did not hold "attempts" — it
held one permanent entry per username ever seen, each with an empty vec after its window elapsed. The cost per
sprayed request was a `String` (the key) plus a map slot, retained for the life of the process, and nothing
would ever free it. "Unbounded HashMap" describes the shape; the fact that matters is that the **pruning
visible in the code was the reason the leak looked handled**.

`username` is the map key and it comes from the login form, so the caller controls the key space directly. A
loop sending a distinct name per request grows the map by one entry per request, forever.

### Fix

One sweep before inserting the caller's key:

```
map.retain(|_, attempts| attempts.iter().any(|t| now.duration_since(*t) < window));
```

A username with any still-live attempt is kept — that is the lockout, and dropping it would hand an attacker a
free reset. A username whose every entry has aged out carries **no information**: the next attempt from that
name starts from zero either way, so the entry is pure residue. The map therefore holds at most the names
active within the last window, which is bounded by request rate over the window rather than by process
lifetime.

`tracked_usernames()` was added so the bound is **assertable** rather than merely described in a comment.

### Tests, and the falsification

Three tests, all of which fail without the sweep:

- `distinct_usernames_do_not_accumulate_without_bound` — 10,000 distinct names through a zero-length window
  (where every attempt expires immediately, so any surviving key can only be the bug). Asserts the count is
  exactly 1.
- `expired_usernames_are_evicted_and_live_ones_are_kept` — two live names, a real 1.1 s wait, then a third
  name arrives; asserts only the third remains and that its lockout still functions.
- `eviction_never_clears_a_live_lockout` — a live lockout must survive 500 sweeps. This one asserts the
  **opposite** direction, guarding the fix from over-evicting.

Falsified by replacing the sweep with a no-op:

```
assertion `left == right` failed: only the key added by the current call may remain;
  10000 entries would be the leak
assertion `left == right` failed: alice and bob expired and must be gone; only carol remains
```

10,000 entries — the leak measured exactly. The third test correctly still passed under falsification, which
is the right behaviour for a guard on the opposite direction. Then the sweep was restored and all 33 passed.

**Latent, not live.** At HEAD this module has **zero production callers** — it is exported at `lib.rs:269` and
used by nothing. I verified that rather than assuming it from the stamp. So no user was exposed; the fix
matters because this is a public API whose entire stated purpose is protecting an unauthenticated form, and
the first person to wire it up would have inherited the leak invisibly.

**Verified:** `rate_limiter` family **33 passed** (30 existing + 3 new), 0 failed; `kasirmu-core` lib full run
**3398 passed, 0 failed** (up from 3395); `clippy -p kasirmu-core --lib -- -D warnings` clean; `rustfmt` clean
on both files. Committed as `4584e125c`, verified by hash to contain exactly the two paths.

**Tally:** 88 findings fixed (14 HIGH, 74 others), 25 leads disproved, 29 clean censuses. This is the third
`next:` item closed from the enumerated backlog (SEC-1, SEC-5, COR-2), and the second one in a row where the
filing's framing was accurate but the mechanism was worse than the summary implied.
