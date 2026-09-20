# Unscoped IPC command inventory — the gate gap the orphan was built to measure

> **CORRECTION 2026-09-13 ~05:30, anchor HEAD `e046e2f26` — the DESKTOP `gated` column here is
> not a permission-check claim.** These classifications came from the registration-gate predicate,
> whose marker vocabulary is four substrings (`require_permission`, `permissions::`,
> `has_permission`, `authorize_with`) and whose bridge clause is **file-level**:
> `text.contains("oz_bridge::") && stems.contains(&module)`, where a stem qualifies if a
> permission token appears ANYWHERE in that bridge file. Re-measured: **369 of 378 desktop gated
> names (97.6%) rest on that clause; only 9 carry a marker in the command body itself.** Of ten
> sampled from the 68 whose forwarded bridge function has no guard even under the widened
> 15-spelling census, **7 showed none on the first hop** — the `auth` stem qualifies on a single
> line, `crates/oz-bridge/src/auth.rs:1234` (`OPERATOR_IMPERSONATE`), inside one impersonation
> command. So **a desktop row marked gated here is a claim about a stem match, not a claim about
> a permission check**, and no deregistration should be briefed off that column without an
> owner-confirmed gate. Method and full counts: see
> `.agents/registration-gate-audit-findings.md`.
> **The TABLET numbers in these files stand.** Tablet was independently verified: 318 registered /
> 193 gated / 125 debt reproduce exactly; 190 of 193 gated rest on a hard in-module marker and the
> file-level clause decides ZERO; 7/7 ratchet tests pass inside a 640/640 unfiltered run; the
> ceiling sits at the measurement with zero slack. The tablet over-claim is three hardware names
> matched on event literals (`print_receipt_scoped`, `print_sales_receipt_scoped`,
> `start_scanner_scoped`) — 3 of 193, not a clause deciding 97.6%. One new tablet-side figure
> from the same census: 20 of the 125 debt rows call a bespoke guard the four tokens cannot see
> (`require_inventory_count_permission` and kin), so tablet debt is **overstated** — 105 on the
> widened vocabulary. Safe direction: a ceiling correction, not a hole.

Measured 2026-09-13 against HEAD `90b7132ca` (branch `0.0.37`). Read-only run: no source file edited, nothing committed, no build. Reproducible via `.agents/scripts/measure_gate_gap.mjs`; raw output in `.agents/gate-gap.raw.txt`.

---

## 0. SAY IT LOUDLY: the harness IS the answer. This is a commit dispatch, not a build dispatch.

`registration_gate_tests.rs` already ran and **its output is already on disk** as two generated ledgers, one row per registered command that the shell does not gate-accept:

- `apps/desktop-tauri/src/commands/registration_gate_debt.generated.rs`
- `apps/mobile-tauri/src/commands/registration_gate_debt.generated.rs`

I did not reimplement the scan. I re-derived its inputs from `lib.rs` independently and they reconcile exactly:

| shell | names parsed from `generate_handler![` | ledger `REGISTERED_TOTAL` | debt rows parsed | ledger `DEBT_CEILING` | ledger rows missing from live list |
|---|---|---|---|---|---|
| desktop (`lib.rs:794`) | **448** | 448 | **70** | 70 | none |
| tablet (`lib.rs:445`) | **318** | 318 | **126** | 126 | none |

448/448 and 318/318 with zero orphan rows means the ledger is a **complete partition** of the live lists: absence from a ledger *is* gate-accepted, so `registered − debt` gives the gated count with no guesswork. Desktop **378 gated / 70 debt**, tablet **192 gated / 126 debt**. Both files report `UNSOURCED: 0`, i.e. every registered name resolved to a wrapper body — no blind spot in the scan itself.

One caveat that moves a number, and one only: the tablet ledger was written at **03:56:46** while `3a15dafe8` landed at **04:04:21** — the sweep predates the gating commit by 7m35s. See section 4.

---

## 1. The table — class A: unscoped command performs no permission check while its scoped twin does

Desktop rows, registration site is `apps/desktop-tauri/src/lib.rs`.

| name | handler / registration line | gated? | twin (gate-accepted) | same name on tablet |
|---|---|---|---|---|
| `branding::get_brand_settings` | commands/branding.rs @821 | NO | `get_brand_settings_scoped` | C |
| `branding::pick_logo_file` | commands/branding.rs @822 | NO | `pick_logo_file_scoped` | not registered |
| `data::get_backup_status` | commands/data.rs @844 | NO | `get_backup_status_scoped` | not registered |
| `data::create_backup` | commands/data.rs @846 | NO | `create_backup_scoped` | not registered |
| `email::get_report_schedule` | commands/email.rs @851 | NO | `get_report_schedule_scoped` | not registered |
| `edc::edc_terminal_status` | commands/edc.rs @854 | NO | `edc_terminal_status_scoped` | not registered |
| `features::list_all_features` | commands/features.rs @890 | NO | `list_all_features_scoped` | C |
| `settings::set_setting` | commands/settings.rs:274 @1012 | NO | `set_setting_scoped` | **A as well — open in both shells** |
| `security::get_key_rotation_info` | commands/security.rs @1097 | NO | `get_key_rotation_info_scoped` | not registered |
| `security::rotate_encryption_key` | commands/security.rs @1099 | NO | `rotate_encryption_key_scoped` | not registered |
| `workspaces::list_workspaces` | commands/workspaces.rs @1114 | NO | `list_workspaces_scoped` | D |
| `workspaces::list_workspace_screens` | commands/workspaces.rs @1115 | NO | `list_workspace_screens_scoped` | D |
| `license::get_machine_id` | commands/license.rs @1130 | NO | `get_machine_id_scoped` | not registered |
| `license::get_hardware_fingerprint` | commands/license.rs @1132 | NO | `get_hardware_fingerprint_scoped` | not registered |
| `license::renew_license` | commands/license.rs @1134 | NO | `renew_license_scoped` | not registered |
| `license::pause_subscription` | commands/license.rs @1136 | NO | `pause_subscription_scoped` | not registered |
| `license::resume_subscription` | commands/license.rs @1138 | NO | `resume_subscription_scoped` | not registered |
| `license::get_license_status` | commands/license.rs @1140 | NO | `get_license_status_scoped` | not registered |
| `license::check_license_status` | commands/license.rs @1142 | NO | `check_license_status_scoped` | not registered |
| `license::test_auth_connection` | commands/license.rs @1144 | NO | `test_auth_connection_scoped` | not registered |
| `settings::get_setting` | commands/settings.rs:243 @1203 | NO | `get_setting_scoped` | C |
| `sync::test_sync_connection` | commands/sync.rs @1269 | NO | `test_sync_connection_scoped` | **A as well** |

Tablet rows, registration site is `apps/mobile-tauri/src/lib.rs`; 13 from the ledger plus one restored in section 4.

| name | handler / registration line | gated? | twin (gate-accepted) | same name on desktop |
|---|---|---|---|---|
| `history::list_sales` | commands/history.rs:58 @569 | **NO** | `list_sales_scoped` checks `SALES_VIEW` at history.rs:297 | **desktop registers no unscoped history fn at all** |
| `history::get_sale` | commands/history.rs:114 @570 | **NO** | `get_sale_scoped` — `SALES_VIEW` at :340 | same |
| `history::export_daily_summary` | commands/history.rs:145 @571 | **NO** | `export_daily_summary_scoped` — `REPORTS_EXPORT` at :380 | same |
| `history::export_sales_by_hour` | commands/history.rs:157 @572 | **NO** | `export_sales_by_hour_scoped` — `REPORTS_EXPORT` at :404 | same |
| `history::export_eod_report` | commands/history.rs:205 @573 | **NO** | `export_eod_report_scoped` — `REPORTS_EXPORT` at :428 | same |
| `settings::set_receipt_settings` | commands/settings.rs @576 | NO | `set_receipt_settings_scoped` | not registered |
| `settings::set_store_settings` | commands/settings.rs @578 | NO | `set_store_settings_scoped` | not registered |
| `settings::set_credit_settings` | commands/settings.rs @580 | NO | `set_credit_settings_scoped` | not registered |
| `settings::settle_credit` | commands/settings.rs @582 | NO | `settle_credit_scoped` | not registered |
| `settings::set_hardware_settings` | commands/settings.rs @584 | NO | `set_hardware_settings_scoped` | not registered |
| `settings::set_setting` | commands/settings.rs:549 @590 | NO | `set_setting_scoped` @879 | **A as well** |
| `currencies::get_default_currency` | commands/currencies.rs @513 | NO | `get_default_currency_scoped` | C |
| `currencies::set_default_currency` | commands/currencies.rs @515 | NO | `set_default_currency_scoped` | C |
| `sync::test_sync_connection` | commands/sync.rs @609 | NO | `test_sync_connection_scoped` | **A as well** |

**Proven by direct code read, not inherited from the ledger:** the five `history` rows. In `apps/mobile-tauri/src/commands/history.rs`, `require_permission_for_user` appears at lines **297, 340, 380, 404, 428** — all five inside `*_scoped` — and at **no line inside the five unscoped originals** (58, 114, 145, 157, 205). That is exactly the shape the orphan was cut to count: the twins got a permission, the originals stayed open, and both names remain registered.

---

## 2. Count by category

| category | desktop | tablet | meaning |
|---|---|---|---|
| GATE-ACCEPTED | 378 | 192 | resolves a session **and** names a permission on the path actually taken |
| **A — ungated original, gated twin** | **22** | **14** | the deregistration class |
| C — original and twin both open | 14 (7 pairs) | 30 (15 pairs) | `_scoped` is a name, not a gate |
| E — scoped-only, no unscoped twin registered | 10 | 60 | scope-only surface, still ungated |
| D — ungated, no twin at all | 24 | 23 | needs a gate, not a deregistration |
| BY_DESIGN_UNGATED | 0 | 0 | the harness records none — which is why 70 and 126 read worse than the tree is |

Class A total: **36 rows / 34 distinct operations**; `settings::set_setting` and `sync::test_sync_connection` are open in **both** shells.

**Divergence is the headline column.** Of **293** operation names registered in both shells, **97 classify differently**, and **75** of those are literally one shell gating and the other not (GATED vs A/C/D/E). Same kernel, same command name, two postures — a renderer that can reach both shells picks the weaker one. Worst instances:
- `history::*`: desktop registers **only** scoped twins; tablet registers both and leaves the unscoped half open.
- `inventory_counts::*_scoped` (10 names): **GATED on desktop, class E open on tablet** — same names, same underlying calls.
- `workspaces::list_workspaces` and `list_workspace_screens`: A on desktop, D on tablet (the tablet twin is not even gated).

---

## 3. Excluded, named by category, with the line that proves it

| name(s) | category | proof |
|---|---|---|
| `auth::staff_login`, `auth::staff_check_username`, `auth::has_users`, `auth::create_session`, `auth::list_organizations` (both shells) | login | the credential check *is* the body; no session exists to resolve yet. All class **D** — no gated twin, so the pairing test excludes them without a judgement call |
| `staff::bootstrap_owner`, `setup::get_enabled_features`, `setup::complete_setup`, `setup::dismiss_setup_wizard`, `setup::get_setup_status`, `license::activate_license`, `topology::load_topology`, `settings::gateway_status` | unauthenticated setup / status | class D on desktop: no scoped twin is gate-accepted, so the repo offers no evidence a permission for these exists |
| `auth::destroy_session`, `auth::session_keepalive`, `auth::switch_organization` (tablet) | session mechanics | class D — these establish or end the identity a permission would be asked of |
| `health::ping`, `health::version`, `health::get_device_id`, `health::get_local_ip` (desktop) | health probe | class **C**: the paired `*_scoped` is itself `resolves_session_names_no_permission`, so there is nothing to deregister *into*; device metadata with no operator action behind it |

What is deliberately **not** waved away: the nine `license::*` rows in desktop class A. They cannot be excluded as pre-auth by design because their scoped twins **are** gate-accepted, which is the repository claiming a permission exists for the operation. Flagged for owner ruling.

---

## 4. The one correction the raw ledger gets wrong

`history::export_daily_summary_scoped` is recorded as `resolves_session_names_no_permission`. It no longer is: `apps/mobile-tauri/src/commands/history.rs:380` calls `require_permission_for_user(..., permissions::REPORTS_EXPORT)`. Generated file 03:56:46, commit 04:04:21.

Consequences, and this is the class of error that turns a count into a lie:
- tablet debt is **125**, not 126; the frozen `DEBT_CEILING = 126` is one row too high, and a ratchet ceiling that is too high will not catch a regression that only shrinks,
- `history::export_daily_summary` is class **A**, not C. From the raw ledger alone you would report **four** history findings; the commit subject says five. Five is correct.

Spot check for other staleness: `stale ledger rows absent from live list: none` on both shells, and `3a15dafe8` is the only listed commit later than a ledger. That is a spot check, not a proof.

---

## 5. Fix shape (five lines)

1. **Harness completion plus a commit — not a build.** The scan exists, works, and is 30 minutes from being load-bearing.
2. **Land the four untracked files as one commit** (both `registration_gate_tests.rs` and both `..._debt.generated.rs`) **together with** the two `mod.rs` shims from `.agents/orphan-mod-rs.diff`; the shims are inert without the files and unresolvable unless the files are tracked, which is precisely why they were rejected alone. Tablet delimiter fix (`:200`, sibling-owned) first.
3. **Regenerate both ledgers at HEAD before freezing them**, so the committed baseline is not 7m35s stale and the tablet ceiling records the true 125.
4. **Then deregister as a ratcheted per-family series, one family per commit, tablet `history::*` first** — desktop already proves the end state by registering no unscoped original at all. Each commit must show the matching `ui/src/api/<domain>.ts` wrapper already calling the scoped name.
5. **Keep the registration-time floor (the harness) as the enforcement, and reconcile `scripts/ipc-parity-allowlist.json` against it** — the third list nobody has read into this. Two unreconciled allowlists is how tonight already went twice.

---

## 6. What I did NOT reach

- **No desktop-side permission read.** Tablet `history.rs` and `settings.rs` were verified line by line; for desktop the harness was trusted. Desktop gates may live in `crates/oz-bridge/src/*` (its own header says the bridge is in the parse set), which I never opened. **All 22 desktop class-A rows are harness-measured, not hand-proven.**
- `security::rotate_encryption_key` (desktop) — the highest-impact name in the list — was not read.
- **No `ui/src/api` caller grep.** Whether each class-A unscoped name still has a front-end caller is what decides deregister versus gate-in-place. Unanswered; about 34 wrappers.
- **Neither harness could be executed.** Tablet is truncated at `registration_gate_tests.rs:200` (`cargo check -p oz-pos-tablet --tests` exit **101**). Desktop would not even be reached: `cargo check -p kasirmu-app --tests` exits **0**, but the `#[cfg(test)]` shim is not in HEAD, because I restored `mod.rs` in the previous task — so `cargo test -p kasirmu-app registration` currently matches **no test**. **Re-applying `.agents/orphan-mod-rs.diff` is what makes it runnable**, and that is a `git apply`, not a build.
- Ledger staleness beyond section 4 is unproven for other families.
- No source file was edited; no commit, no stash, no `cargo clean`, no `cargo build`. Exit codes read before pipes: `kasirmu-app` check **0**, `oz-pos-tablet` check **0**, `cargo fmt --all -- --check` **0** (green since the reject).