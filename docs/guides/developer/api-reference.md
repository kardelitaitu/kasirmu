<!-- FOLLOW-UP 2 2026-10-08: four KDS commands landed on the tablet shell (tablet 415 -> 419; `distinct` stays 513 because all four already existed on desktop), and their rows were marked [D]. Corrected to **[D+T]** — `list_kds_devices_scoped`, `register_kds_device_scoped`, `get_kds_routing_rules_scoped`, `save_kds_routing_rules_scoped` are each present in BOTH `generate_handler!` blocks, confirmed by brace-matched extraction of the raw files rather than by any parser. Re-swept after: all 513 rows cross-checked against the raw registries -> **0 marker mismatches, 0 registered-but-undocumented**. Live: `registered desktop=494 tablet=419 distinct=513`. -->

<!-- FOLLOW-UP 2026-10-08 (later the same day): the 1-row gap this stamp anticipated was closed. Two commands had landed in the registries after the repair and are now documented — `print_edc_settlement_slip_scoped` [D+T] (`commands::hardware`, 11) and `notify_memory_pressure` [T] (`commands::health`, 13). Live state: `registered desktop=494 tablet=415 distinct=513`, `documented 513 entries`, four buckets 0, `CLEAN`. -->

<!-- Audit stamp: 2026-10-08 · docs-auditor · status: ACCURATE AFTER REPAIR (major drift repaired) — doc and registries agree again (all four drift buckets zero, `CLEAN`, exit 0) · Supersedes the 2026-09-29 stamp, which was true when written and went false as the tablet shell gained commands without doc rows. Drift found and repaired this pass: 54 rows carried the wrong availability marker (all said `[D]` for commands now registered in BOTH shells — `edc` 8, `inventory` 17, `kds` 4, `regional` 1, `shifts` 7, `locations` 9, `products_images` 1, `auth::verify_pin` 1; root commit `6fe57ba17` "register shifts, inventory, kds, edc, locations, and pin commands for tablet parity", plus `edc_inquiry`/`edc_settle` from `656f109a0`); 10 registered commands had no row (`edc_inquiry`, `edc_settle` → `commands::edc`; `export_diagnostics`, `get_storage_health`, `record_crash_report` → `commands::health`; `get_sale_statutory_number_scoped`, `issue_tax_invoice_scoped` → `commands::fiscal`; `check_app_update`, `start_apk_download`, `prepare_and_launch_update` → a new `commands::updater` section, all three `[T]` because the Android updater is tablet-only by design); and one row's PROSE was stale as well as its marker — `get_active_market_profile_scoped` claimed "Desktop-only … not in the tablet shell" while `apps/mobile-tauri/src/lib.rs:1250` registers it, so the sentence was corrected with the marker. Section counts regenerated (`edc` 9→11, `fiscal` 5→7, `health` 9→12, new `updater` 3); every `(N)` on every heading now agrees with its own row count (verified programmatically). Final measured state: `registered desktop=493 tablet=413 distinct=511`, `documented 511 entries`, all four buckets 0. The 64-name drift was re-derived by an independent parser over both `generate_handler!` lists (`493/413/511` exactly, zero difference). · Repaired against branch `0.0.41` at `134aaed1b`. -->

<!-- SUPERSEDED audit stamp: 2026-09-29 · docs-auditor · status: CLEAN — doc and registries agree (all four drift buckets zero) · First pass over this file by this campaign, and the one file it deliberately skipped in every previous round. The skip was correct at the time and is worth recording: the file carried a ` M` in the working tree for the whole campaign, and under the root guide's shared-index rule a pathspec commit would have swept another session's in-flight edits into this one. What turned out to be true at the end is that the file's BYTES EQUAL the committed blob exactly — the modification was a stat-cache artifact, the way a file looks under automatic line-ending handling when nothing about its content has changed. The same signature appeared once before in this campaign on a different file and was confirmed the same way, by comparing the working-tree hash with the committed one rather than trusting either the status line or a diff. So the file was never unsafe to touch; it only LOOKED unsafe, and the discipline that kept it untouched was right to be cautious and wrong to be permanent about it. · THE DOCUMENT IS CURRENT, AND THE CHECKER PROVES IT RATHER THAN INFERING IT. The page's own tooling reports the registered command surface, the defined surface, and the documented entry count, and then tests four ways the three could disagree. All four report zero: no entry carries the wrong shell marker, no entry is listed that is registered nowhere, no entry is listed that is defined nowhere, and — the one that matters most — NO REGISTERED COMMAND IS MISSING FROM THE PAGE. The documented count and the distinct registered count are the same number. A generated reference that is regenerated on a cadence will drift; the question is whether anyone notices, and this document ships the command that notices. · AND THE GAP A PRIOR AUDIT RECORDED HAS BEEN CLOSED, which is the strongest evidence this campaign has that documentation maintenance is actually happening rather than merely intended. The earlier stamp on this page recorded, in its own words, that twenty-five registered commands had no row and that the claim of completeness was therefore true only of an earlier set. The count has since moved and the buckets are empty. Somebody regenerated the page, and the page says in advance how to check that they did. · THE SCALE IS WORTH RECORDING because it is what the tooling has to keep honest: four hundred and ninety-six distinct commands across two shells, the desktop registering more than the tablet, with the intersection large enough that a parity checker exists as a gate in its own right. A document that claims to track that surface is making a strong claim, and the strength of the claim is the reason the page was the hardest file in the campaign to audit — its correctness is a property of a script, not of prose, and the right audit was to run the script. · NOT RE-MEASURED, and the boundary is worth stating: the tool establishes that the page and the registries agree. It does not establish that every command behaves correctly, that the summaries match what the code does, or that the surface is the right one. Agreement between a document and its source is a necessary condition for the document being useful, not a sufficient one, and this stamp claims only the former. The prior audit's per-command summaries were copied from the commands' own documentation comments, which is the right method and the one this campaign did not re-derive. · Prior marker retained; footer re-dated to match the new stamp. -->
# API Reference — kasir.mu
<!-- Superseded audit marker (2026-09-08, body kept verbatim) · DSH · status: ACCURATE AFTER REPAIR (6 findings, 5 repaired) · First stamp this page ever carried; it had a footer from an earlier pass and nothing machine-readable about scope or evidence. · Refreshed the measured surface, which had rotted in eight days: registered 450→454 distinct (429 desktop / 301 tablet / 276 both, from apps/desktop-tauri/src/lib.rs and apps/mobile-tauri/src/lib.rs), discrepancies 154→158. · Corrected a header that presented a "55-entry gap" above a four-class table summing to 154 and implied one explained the other. They are different quantities; the header now states the intersection (406 names) and the identity 505−99=406, 406+48=454, which closes exactly and can be re-derived. · Replaced the 7 dead *_store_profile_scoped rows: the store→location rename moved the module to apps/desktop-tauri/src/commands/locations.rs and all seven names to their *_location_profile_* twins, verified against the file's own 8 pub async fn and their /// summaries. That also pulled 7 of the 48 undocumented commands into the page. The old rows each said "Scoped variant of create_store_profile" etc — no such unscoped command exists in either app; the only surviving store_profile names are SQLite service methods in crates/kasirmu-core/src/db/locations.rs. · Rewrote the "14 listed and not defined anywhere" row, which was the worst claim on the page: it said of its names "they do not exist", and for 7 of the 14 that is false. get_kds_order, get_kds_queue, list_kds_orders, update_kds_status and create_kds_order_from_sale are pub fn service methods in crates/kasirmu-core/src/db/kds_lines.rs and kds_orders.rs, and settings_changed_sink is a helper at apps/desktop-tauri/src/commands/sync.rs:210 whose command twin is settings_changed_sink_scoped at :811. The checker's "defined" means "annotated #[command]"; the page borrowed the tool's vocabulary without saying what the tool counts, and asserted something its own evidence contradicted. Renamed the bucket to say what it means. · Verified the 85 "not registered" bucket by re-running the comparison per name rather than trusting the label: all 85 are the legacy unscoped twins of a registered *_scoped command, i.e. the ADR #7 convention the page already documents, not rot. · A note on the repair itself: my first draft of the new locations section claimed all eight commands are registered. They are not — get_primary_location is defined but in no handler, and check-api-surface caught it by moving its own count the wrong way (85→86) inside the same edit. Documented as found, and kept listed on purpose, because this page derives from command definitions rather than handlers. · All 41 registered-but-undocumented commands were then written up on 08-09-26: each
summary taken from the command's own /// line, each availability marker read out of the
two generate_handler! lists rather than inferred. 17 rows folded into existing sections
(audit, auth, settings, staff x5, subscription x2, topology x7) and 24 as five new ones
(legal_entities 4, local_api 6, memo 7, payables 4, products_images 3), so
registered-not-listed is 0 and the page went 506 to 547 entries across 49 to 54 modules,
with zero duplicate rows. Net discrepancies 158 to 93, and every one that remains is
explained above rather than left untriaged: 86 legacy unscoped ADR #7 twins of
registered *_scoped commands, and 7 service methods in crates/kasirmu-core/src/db/kds_lines.rs
and kds_orders.rs that are listed as if they were IPC commands - two of those carry 80
and 70 references, so they are live code documented at the wrong layer, not dead names.
-->

> **Derived from the `generate_handler!` registries of both clients, and it lists
> exactly the callable surface — every name here can be invoked on the shells its
> marker names, and no registered command is missing.** Regenerated 31-08-26, reconciled against reality 08-09-26. The live
> registered surface is **454 distinct commands** (re-measured 08-09-26; 429 in
> `apps/desktop-tauri/src/lib.rs`, 301 in `apps/mobile-tauri/src/lib.rs`, 276 in
> both) — a point-in-time record, kept as written. **Re-measured 2026-09-14: 478
> distinct registered commands — 453 in `apps/desktop-tauri/src/lib.rs:845-1340`, 322 in
> `apps/mobile-tauri/src/lib.rs:445`, 297 in both shells** — printed by
> `python .agents/skills/docs-auditor/scripts/check-api-surface.py`, whose first line is
> `registered   desktop=453 tablet=322 distinct=478`; the 297-both figure is NOT printed
> by it or by `python scripts/verify-ipc-parity.py` (which agrees per shell: 453 registered
> desktop, 322 tablet, EXIT 0) and comes from intersecting the two `generate_handler!`
> lists. **As at 2026-09-14 — superseded by the 2026-09-29 note below, which re-measured every number here.** The page's own shape was then re-derivable:
> `grep -c '^### `commands::' docs/guides/developer/api-reference.md` = 54 sections,
> `grep -cE '^- \*\*`' docs/guides/developer/api-reference.md` = 547 rows, and the `(N)` on every
> section header sums to 547 with zero sections whose annotation disagrees with their own
> row count. **What did move: 25 registered commands now have no row here** (the bucket
> below was 0 on 08-09-26), so "every one of the registered commands has a row" is true
> only of the 08-09-26 set; the 25 names and their modules are listed in the count note
> below. The 41 that were missing were added 08-09-26 — five
> new sections (`commands::legal_entities`, `local_api`, `memo`, `payables`,
> `products_images`) plus 17 rows folded into existing ones. Each summary is that command
> own `///` line copied from the source, and each [D]/[T]/[D+T] marker was read out of the
> two `generate_handler!` lists rather than inferred.
>
> The two sets overlapped completely **as at 08-09-26** — all 454 registered commands were
> listed then; they are not now (25 registered commands have no row, count note below) — and the
> arithmetic still closes:
> 547 documented minus 93 that are not wired (86 + 7 below) = 454, and 454 + 0
> registered-but-undocumented = 454 registered. The identity held for the old numbers
> too, and that is the point of writing it as an equation: after each repair it either
> still closes, or it tells you the arithmetic was never checked.
> **A correction recorded:** an earlier header asserted a "55-entry gap" and then presented a four-class table summing to 154 underneath
> it, which cannot both be true — 55 is a difference of set sizes while 154 is a count of
> discrepancies in four directions, and the two were being read as one number. Stating the
> intersection makes the claim checkable; the gap framing hid an inconsistency.
>
> Measured 08-09-26 with `--full`; re-derive before repeating any figure here.
>
> | Class | Count | What it means |
> |---|---|---|
> | Marker wrong | **0** (was 11) | Eleven rows said `[D]` or `[T]` for commands present in **both** `generate_handler!` lists: `version`, `get_brand_settings`, `test_sync_connection`, `list_workspaces`, `list_workspace_screens`, `discover_hardware_scoped`, `list_all_features_scoped`, `display_show_scoped`, `display_clear_scoped`, `list_displays_scoped`, `get_cart_deduction_location_scoped`. Verified independently against both `lib.rs` handler lists before changing any of them. The worst kind of error on this page, because an availability marker is exactly what a caller reads to decide whether a call exists on their shell. |
> | Listed but **not registered anywhere** | 86 | A real `#[command]` fn that no `generate_handler!` includes, so the front-end cannot invoke it. 85 of the 86 are the legacy unscoped twins of an existing `*_scoped` command — checked: for every one of the 85, `<name>_scoped` IS registered — which is the ADR #7 convention described at the foot of this header, not rot. The 86th is `get_primary_location`: defined at `apps/desktop-tauri/src/commands/locations.rs:100`, wired into no handler, listed as found and explained in full in the `commands::locations` note. Verified 08-09-26 by re-running the comparison name-by-name rather than trusting the bucket; the split stated 09-09-26 because "Count 86" above "All 85 are…" read as a self-contradiction inside one cell. |
> | Listed and **not defined as a command** | 7 | Not commands, and the page no longer presents them as ones. Each of the 7 rows below now carries `[not an IPC command]`: five are `pub fn` service methods in `crates/kasirmu-core/src/db/kds_lines.rs` / `kds_orders.rs` (`get_kds_order`, `get_kds_queue`, `list_kds_orders`, `update_kds_status`, `create_kds_order_from_sale`), `settings_changed_sink` is a plain helper at `apps/desktop-tauri/src/commands/sync.rs:210` wired at `:366`, and `recover_pending_topology_apply_at_startup` is an internal startup routine. Six of the seven have a real `*_scoped` command twin, named on the row; the seventh has none. All seven are kept listed because callers exist for them — two of the kds six carry 80 and 70 references apiece — but a reader deciding what the front end may call must look at the marker, not the name. Earlier revisions of this row asserted 'these do not exist', which was false for 7 of 14 names: the checker's `defined` set means *annotated `#[command]`*, and the page had borrowed that vocabulary without restating it. The seven genuinely-gone `*_store_profile_scoped` rows are no longer here at all — the store→location rename (09-06→09-08) replaced them with `commands::locations`. |
> | Registered but **not listed** | **0** (was 48) | **Closed on 08-09-26.** Every registered command now has a row: 17 folded into existing sections (`commands::topology` +7, `commands::staff` +5, one each into `audit`, `auth`, `settings`, and `commands::subscription` +2) and 24 as five new sections (`commands::legal_entities`, `commands::local_api`, `commands::memo`, `commands::payables`, `commands::products_images`). Each summary is that command's own `///` line copied from source and each marker read out of the two `generate_handler!` lists, so this bucket is the one that can be re-derived rather than re-believed. It was 44 on 31-08-26 and 48 by 08-09-26 — it grows by itself, because commands land faster than the regeneration does. |
>
> Reproduce every number above with
>
> ```bash
> python .agents/skills/docs-auditor/scripts/check-api-surface.py   # exit 0 since 2026-09-29
> ```
>
> It parses `generate_handler![...]` in each `lib.rs` for the registered set, every
> `#[command]` fn under `src/` for the defined set, and the entry lines of this page for
> the documented set, then reports the four classes separately. It is now
> wired into `check.sh`, `gates.json` and CI (`dev-ci.yml#ci-docs-drift`), because as of
> 2026-09-29 the page is green against it: all four classes are zero, so the gate starts
> life passing rather than muted. The count still moves with the code:
> it was 154 on 31-08-26, 158 by 08-09-26, entirely because 4 new command groups landed
> (`memos`, `payables`, `legal_entities`, `local_api`) without a doc row each. Do not
> hardcode a target number into CI; derive it.
>
> **Count note 2026-09-14 · DSH · comment-only pass ·** the four-class table above is
> dated 08-09-26 and is left as written; today the same command prints
> `marker wrong : 0`, `listed, not registered anywhere : 86`,
> `listed, not defined anywhere : 8`, `registered, not listed : 25`,
> `DRIFT: 119 discrepancies` and exits 1. Two of those moved against the table: the
> not-defined bucket is 8 not 7 because `rotate_encryption_key` joined it (its row is now
> marked, above), and registered-not-listed reopened from 0 to 25 — the arithmetic identity
> that used to close (547 documented − 94 unwired = 453 listed-and-registered, + 25
> registered-not-listed = 478) now leaves 25 commands registered in a handler list with no
> row on this page. They come from 12 command modules, not one new group — measured
> 2026-09-14 by grepping each name the checker prints back to the file that defines it
> under `apps/*/src/commands/` (both shells collapsed onto one basename, so a command
> living in both clients counts once): `fiscal.rs` 5, `receipt_format.rs` 3, then 2 each
> in `regional`, `qris_auto`, `local_payment`, `sync`, `locations`, `kds_routing`,
> `auth` (7 × 2 = 14), and 1 each in `tax`, `subscription`, `audit` — 5 + 3 + 14 + 3 = 25,
> which is the whole bucket and re-derives from the checker's own name list.
> Those 25 rows were NOT written here: this pass was scoped to counts, and
> adding summaries for 25 commands from their `///` lines is a separate change. Until then
> this page is complete for 453 of 478, not for all of them.
>
> Each entry shows availability — **[D+T]** both clients, **[D]** desktop-only,
> **[T]** tablet-only — followed by the command's own `///` summary line. The
> `*_scoped` / unscoped split is the ADR #7 multi-store convention: the scoped
> variant resolves the store from the session token; the unscoped variant is the
> legacy global-DB path (deprecated where a scoped twin exists). For full parameter
> and return types, read the `#[tauri::command]` fn in
> `apps/desktop-tauri/src/commands/<module>.rs` (or the tablet equivalent). All
> commands return `Result<T, AppError>`.

> **Count note 2026-09-29 · Buffy · repair pass ·** the page now matches the registries
> exactly: `registered desktop=481 tablet=345 distinct=496`, `documented 496 entries`,
> and `marker wrong : 0`, `listed, not registered anywhere : 0`,
> `listed, not defined anywhere : 0`, `registered, not listed : 0` — **`CLEAN: doc and
> registries agree`**, exit 0. What that took, and what it removed: 101 rows named a
> command that exists nowhere in the repo (97 were unscoped ADR #7 twins whose code has
> since been deleted, 4 were retired setup/topology names), 3 rows named a `#[command]` fn
> that no `generate_handler!` lists, 10 availability markers named the wrong shell, and 55
> registered commands had no row at all. Every name removed is accounted for under
> [Names this page deliberately does not list](#names-this-page-deliberately-does-not-list),
> with its successor or its real home, so nothing was dropped silently. This page's own
> section annotations were also wrong before this pass — four of them disagreed with their
> own row counts (`commands::hardware` said 16 over 13 rows, `products` 23 over 22,
> `settings` 29 over 28, and the header said 54 sections when there were 55) — which is
> why the table above claimed "zero sections whose annotation disagrees" and was not true.
> The `(N)` on each heading was regenerated from its own rows in this pass, and the six
> sections that had no page presence at all (`avatars`, `fiscal`, `local_payment`,
> `qris_auto`, `receipt_format`, `regional`) were added.

> **Count note 2026-10-08 · docs-auditor · repair pass ·** the page is green against the
> checker again, and the drift it had accumulated since 2026-09-29 is named here so it can
> be dated rather than re-derived: `registered desktop=493 tablet=413 distinct=511`,
> `documented 511 entries`, and `marker wrong : 0`, `listed, not registered anywhere : 0`,
> `listed, not defined anywhere : 0`, `registered, not listed : 0` — **`CLEAN: doc and
> registries agree`**, exit 0. Two classes had reopened, and both trace to the same cause:
> the tablet shell gained a large body of commands without a doc row each. **54 rows carried
> the wrong availability marker** — every one said `[D]` for a command that is now in BOTH
> `generate_handler!` lists, so each became `[D+T]`. They are not one feature: `edc` (8),
> `inventory` (17), `kds` (4), `regional` (1), `shifts` (7), `locations` (9), `products_images`
> (1), and `auth::verify_pin` (1). The registration commit is `6fe57ba17` ("register shifts,
> inventory, kds, edc, locations, and pin commands for tablet parity"); one further pair
> (`edc_inquiry`, `edc_settle`) arrived with `656f109a0`. **10 registered commands had no
> row**: `edc_inquiry`, `edc_settle` (→ `commands::edc`), `export_diagnostics`,
> `get_storage_health`, `record_crash_report` (→ `commands::health`),
> `get_sale_statutory_number_scoped`, `issue_tax_invoice_scoped` (→ `commands::fiscal`), and
> the three Android updater commands `check_app_update`, `start_apk_download`,
> `prepare_and_launch_update`, which got the page's first **`commands::updater`** section
> because the module had none. Those three are `[T]` — the updater is tablet-only by design
> (it streams an APK and hands off to the Android package installer), matching its
> desktop-section allowlist entry in `scripts/ipc-parity-allowlist.json`. One row's PROSE was
> also stale, not just its marker: `get_active_market_profile_scoped` said "Desktop-only:
> registered in `apps/desktop-tauri`, not in the tablet shell" while the tablet registers it
> at `apps/mobile-tauri/src/lib.rs:1250`; the marker and the sentence are both corrected.
> Section counts moved with the rows: `edc` 9→11, `fiscal` 5→7, `health` 9→12, and the new
> `updater` section holds 3. Verified by an independent parser over both `generate_handler!`
> lists that reproduced `493/413/511` exactly.

<!-- regenerate: parse generate_handler! in both lib.rs for the surface, and the /// doc comments in commands/*.rs for the summaries -->
### `commands::analytics` (2)

- **`get_staff_analytics_daily_scoped`** [D+T] — Per-day shift + sales series for one staff member over `[from, to]`.
- **`get_staff_analytics_scoped`** [D+T] — Per-staff shift + sales summary for the session's store over `[from, to]`.

### `commands::audit` (6)

- **`export_audit_log_scoped`** [D+T] — Export the session store's audit log to CSV (AUD-09).
- **`get_audit_review_status_scoped`** [D+T] — Fetch the session store's latest review checkpoint + unreviewed count
- **`list_audit_log_scoped`** [D+T] — Fetch audit log entries scoped to the session's store (AUD-01).
- **`list_security_events_scoped`** [D+T] — Read the ORGANIZATION-level security trail — logins, logouts and staff account changes — from the GLOBAL identity database.
- **`mark_audit_reviewed_scoped`** [D+T] — Persist a server-side review checkpoint for the session's store (AUD-04).

- **`export_security_events_scoped`** [D+T] — Export the ORGANIZATION-level security trail to CSV (owner ruling D61-7, D84).

### `commands::auth` (11)

- **`create_session`** [D+T] — Create a new session and return an opaque session token.
- **`destroy_session`** [D+T] — Destroy an active session, invalidating the token.
- **`has_users`** [D+T] — Check whether any staff accounts exist in the database.
- **`impersonate_user_scoped`** [D+T] — Begin an operator impersonation session for support. The caller must present a valid operator session that holds the.
- **`refresh_picker_ticket`** [D+T] — Mint a fresh picker ticket for a caller who already holds a valid session token.
- **`session_keepalive`** [D+T] — Refresh the current session's TTL so long-lived screens (analytics,
- **`staff_check_username`** [D+T] — Check a username before the PIN step (STAFF-06).
- **`staff_login`** [D+T] — Authenticate a staff member by username and PIN.
- **`verify_pin`** [D+T] — Verify the current session user's PIN.

- **`list_organizations`** [D+T] — Enumerate the Organizations (legal entities) this device knows about.
- **`switch_organization`** [D+T] — Switch the active Organization (legal entity) for an authenticated session.

### `commands::avatars` (3)

- **`clear_avatar_scoped`** [D+T] — Clear `user_id`'s avatar back to the initials fallback.
- **`get_own_avatar_scoped`** [D+T] — Read the SESSION user's own avatar hash, or null when none is set.
- **`set_avatar_scoped`** [D+T] — Set `user_id`'s avatar from the image at `source_path`.

### `commands::branding` (7)

- **`get_brand_settings`** [D+T] — Load all brand settings at once.
- **`get_brand_settings_scoped`** [D+T] — Load all brand settings resolved from a session token. ADR #7.
- **`pick_logo_file`** [D] — Open a native file picker filtered to image files and return the
- **`pick_logo_file_scoped`** [D] — Session-scoped variant of [`pick_logo_file`].
- **`set_brand_logo_path_scoped`** [D+T] — Set the brand logo path (scoped — two-phase db access).
- **`set_brand_primary_colour_scoped`** [D+T] — Scoped variant of `set_brand_primary_colour` (ADR #7).
- **`set_brand_store_name_scoped`** [D+T] — Scoped variant of `set_brand_store_name` (ADR #7).

### `commands::browser` (2)

- **`open_product_images`** [T] — Open a Google Images search for a product in the default browser.
- **`open_product_images_scoped`** [D] — Open a Google Images search for a product in the default browser.

### `commands::bundles` (6)

- **`create_bundle_scoped`** [D+T] — Create a new bundle (scoped).
- **`delete_bundle_scoped`** [D+T] — Scoped variant of `delete_bundle` (ADR #7).
- **`get_bundle_scoped`** [D+T] — Scoped variant of `get_bundle` (ADR #7).
- **`list_bundles_scoped`** [D+T] — Scoped variant of `list_bundles` (ADR #7).
- **`lookup_bundle_by_sku_scoped`** [D+T] — Scoped variant of `lookup_bundle_by_sku` (ADR #7).
- **`update_bundle_scoped`** [D+T] — Scoped variant of `update_bundle` (ADR #7).

### `commands::categories` (5)

- **`create_category_scoped`** [D+T] — Create category in the store resolved from a session token (CAT-01).
- **`delete_category_scoped`** [D+T] — Delete a category in the store resolved from a session token (CAT-01/02).
- **`list_categories`** [T] — Fetch all categories, ordered by name.
- **`list_categories_scoped`** [D+T] — Fetch all categories for the store resolved from a session token. ADR #7.
- **`update_category_scoped`** [D+T] — Update a category in the store resolved from a session token (CAT-01).

### `commands::currencies` (7)

- **`currency_info`** [D+T] — Currency info.
- **`currency_info_scoped`** [D] — Session-scoped variant of [`currency_info`].
- **`get_default_currency`** [D+T] — Get default currency.
- **`get_default_currency_scoped`** [D+T] — Get the default currency in the store resolved from a session token. ADR #7.
- **`list_currencies_scoped`** [D+T] — List currencies resolved from a session token. ADR #7.
- **`set_default_currency`** [D+T] — Set default currency.
- **`set_default_currency_scoped`** [D+T] — Set the default currency in the store resolved from a session token. ADR #7.

### `commands::customers` (7)

- **`create_customer_scoped`** [D+T] — Create a customer in the store resolved from a session token.
- **`delete_customer_scoped`** [D+T] — Delete a customer from the store resolved from a session token. ADR #7.
- **`get_customer_history_scoped`** [D+T] — Get the read-only history for a customer (CUST-05). ADR #7.
- **`get_customer_scoped`** [D+T] — Scoped variant of `get_customer` (ADR #7).
- **`list_customers_scoped`** [D+T] — List customers for the store resolved from a session token. ADR #7.
- **`search_customers_scoped`** [D+T] — Search customers in the store resolved from a session token. ADR #7.
- **`update_customer_scoped`** [D+T] — Update a customer in the store resolved from a session token. ADR #7.

### `commands::data` (12)

- **`create_backup`** [D] — Create backup.
- **`create_backup_scoped`** [D] — Session-scoped variant of [`create_backup`].
- **`export_data`** [D+T] — Export data.
- **`get_backup_status`** [D] — Get backup status.
- **`get_backup_status_scoped`** [D] — Session-scoped variant of [`get_backup_status`].
- **`import_data`** [D+T] — Import data.
- **`import_preview`** [D+T] — Import preview.

- **`create_backup_to`** [T] — Backup the database to an operator-chosen destination (tablet only).
- **`export_data_without_session`** [D+T] — Export data on the session-less path. The command carries no `///` line in source.
- **`list_restore_candidates`** [D] — List the backup generations beside the live database, each with its verdict.
- **`restore_prepare`** [D] — Request a restore of the named candidate on the next boot (gated).
- **`restore_status`** [D] — Report whether a restore request is pending beside the live database.

### `commands::edc` (11)

- **`edc_refund`** [D+T] — Refund a previously captured card transaction.
- **`edc_sale`** [D+T] — Process a card-present sale (authorize + capture in one call).
- **`edc_terminal_status`** [D] — Query the EDC terminal's current status.
- **`edc_terminal_status_scoped`** [D+T] — Session-scoped variant of [`edc_terminal_status`].
- **`edc_void`** [D+T] — Void a pending authorisation before capture.

- **`create_edc_terminal_scoped`** [D+T] — Create a new card-payment terminal (session-scoped).
- **`delete_edc_terminal_scoped`** [D+T] — Delete a card-payment terminal (session-scoped).
- **`list_edc_terminals_scoped`** [D+T] — List configured card-payment terminals (session-scoped).
- **`update_edc_terminal_scoped`** [D+T] — Update an existing card-payment terminal (session-scoped).
- **`edc_inquiry`** [D+T] — Query or reconcile transaction status by invoice reference.
- **`edc_settle`** [D+T] — Perform batch settlement on the EDC terminal.

### `commands::email` (4)

- **`get_report_schedule`** [D] — Get the current report schedule configuration.
- **`get_report_schedule_scoped`** [D] — Session-scoped variant of [`get_report_schedule`].
- **`save_report_schedule`** [D] — Save the report schedule configuration.
- **`send_test_report`** [D] — Send a test report email using the currently configured SMTP

### `commands::exchange_rates` (5)

- **`create_exchange_rate_scoped`** [D+T] — Create an exchange rate in the store resolved from a session token. ADR #7.
- **`delete_exchange_rate_scoped`** [D+T] — Delete an exchange rate in the store resolved from a session token. ADR #7.
- **`get_latest_exchange_rate_scoped`** [D+T] — Return the latest exchange rate for a pair effective on/before
- **`list_exchange_rates_scoped`** [D+T] — List exchange rates in the store resolved from a session token. ADR #7.
- **`list_latest_exchange_rates_scoped`** [D+T] — The current rate for every pair (CUR-11), store resolved from a

### `commands::features` (4)

- **`list_all_features`** [D+T] — Fetch every known feature with its current enabled status, metadata,
- **`list_all_features_scoped`** [D+T] — Session-scoped variant of [`list_all_features`].
- **`set_feature`** [D+T] — Enable or disable a single feature flag.
- **`set_features_bulk`** [D+T] — Enable or disable multiple feature flags atomically in a single

### `commands::fiscal` (7)

Statutory number series and fiscal schemes, per legal entity. Desktop and tablet both register all five.

- **`get_document_number_sequence_scoped`** [D+T] — Read the statutory number series for one legal entity and document kind.
- **`list_document_number_sequences_for_entity_scoped`** [D+T] — The configured series for ONE legal entity (the overview's per-entity drill-down).
- **`list_document_number_sequences_scoped`** [D+T] — List every statutory number series configured for the tenant.
- **`list_fiscal_schemes_scoped`** [D+T] — List the tenant's fiscal schemes — the entity-level anchor the number series hang off.
- **`upsert_document_number_sequence_scoped`** [D+T] — Create or update the statutory number series for one legal entity and document kind.
- **`issue_tax_invoice_scoped`** [D+T] — Issue a formal statutory Tax Invoice for a sale in the store resolved from a session token.
- **`get_sale_statutory_number_scoped`** [D+T] — Read the statutory document number stamped on a sale in the store resolved from a session token.

### `commands::gift_cards` (8)

- **`freeze_gift_card_scoped`** [D+T] — Freeze a gift card (scoped).
- **`get_gift_card_balance_scoped`** [D+T] — Get the current balance of a gift card (scoped).
- **`get_gift_card_scoped`** [D+T] — Get a gift card by its card number or internal ID (scoped).
- **`issue_gift_card_scoped`** [D+T] — Issue a new gift card (scoped — requires valid session).
- **`list_gift_cards_scoped`** [D+T] — List all gift cards with optional filtering by status (scoped).
- **`redeem_gift_card_scoped`** [D+T] — Redeem (spend) a gift card balance against a sale (scoped).
- **`top_up_gift_card_scoped`** [D+T] — Add value (top up) to an existing gift card (scoped).
- **`unfreeze_gift_card_scoped`** [D+T] — Unfreeze a previously frozen gift card (scoped).

### `commands::hardware` (11)

- **`discover_hardware_scoped`** [D+T] — Discover all connected USB hardware devices (scoped).
- **`display_clear_scoped`** [D+T] — Clear a customer-facing pole display (scoped).
- **`display_show_scoped`** [D+T] — Show content on a customer-facing pole display (scoped).
- **`list_displays_scoped`** [D+T] — List all registered customer displays (scoped).
- **`list_scanners_scoped`** [D+T] — List all registered barcode scanners (scoped).
- **`open_cash_drawer_scoped`** [D+T] — Open cash drawer (scoped — requires valid session).
- **`print_receipt_scoped`** [D+T] — Print receipt (scoped — requires valid session).
- **`print_edc_settlement_slip_scoped`** [D+T] — Print an EDC settlement slip (scoped — requires valid session).
- **`print_sales_receipt_scoped`** [D+T] — Print sales receipt for the store resolved from a session token. ADR #7.
- **`start_scanner_scoped`** [D+T] — Start a barcode scanner (scoped).
- **`stop_scanner_scoped`** [D+T] — Stop the active barcode scanner (scoped).

### `commands::health` (13)

- **`get_device_id`** [D+T] — Get the stable device identifier (hostname) for terminal binding.
- **`get_device_id_scoped`** [D] — Session-scoped variant of [`get_device_id`].
- **`get_local_ip`** [D+T] — Get the local IP address of the machine.
- **`get_local_ip_scoped`** [D] — Session-scoped variant of [`get_local_ip`].
- **`ping`** [D+T] — Liveness probe. Returns `Ok("pong")` if the Tauri runtime is alive.
- **`ping_scoped`** [D] — Session-scoped variant of [`ping`].
- **`version`** [D+T] — Version.
- **`version_scoped`** [D+T] — Version info resolved from a session token. ADR #7.

- **`get_build_fingerprint`** [T] — Report this installation's APK signing-certificate fingerprint (ADR #57 §2.1).
- **`notify_memory_pressure`** [T] — Dispatched when Android OS reports memory pressure (`onTrimMemory` / `onLowMemory`); levels ≥ 10 back background sync off.
- **`export_diagnostics`** [D+T] — Export comprehensive diagnostic archive (.zip) containing system telemetry, sync status, and sanitized logs.
- **`get_storage_health`** [D+T] — Check storage capacity and low space warning.
- **`record_crash_report`** [D+T] — Record fatal frontend or runtime crash telemetry report without sensitive PII.

### `commands::history` (12)

- **`export_daily_summary`** [T] — Export daily summary.
- **`export_daily_summary_scoped`** [D+T] — Fetch the daily sales summary for the store resolved from a session token.
- **`export_eod_report`** [T] — Fetch the full EOD (End-of-Day) report for today.
- **`export_eod_report_scoped`** [D+T] — Fetch the full EOD report for the store resolved from a session token.
- **`export_sales_by_hour`** [T] — Export sales by hour.
- **`export_sales_by_hour_scoped`** [D+T] — Fetch sales-by-hour breakdown for the store resolved from a session token.
- **`get_sale`** [T] — Get sale.
- **`get_sale_scoped`** [D+T] — Fetch a single sale by ID from the store resolved from a session token.
- **`list_sales`** [T] — List sales.
- **`list_sales_scoped`** [D+T] — List all sales for the store resolved from a session token.

- **`create_faktur_pengganti_scoped`** [D+T] — Create a Faktur Pengganti for an existing e-Faktur on a completed sale.
- **`stamp_faktur_pajak_scoped`** [D+T] — Stamp a DJP-approved NSFP onto a completed sale.

### `commands::inventory` (24)

- **`acknowledge_stock_alert_scoped`** [D+T] — Acknowledge a stock alert event (records who acknowledged it).
- **`active_stock_alerts_scoped`** [D+T] — Get active stock alerts for a location (enriched with product SKU/name).
- **`create_inventory_location`** [D+T] — Create a new inventory location.
- **`create_inventory_transaction`** [D+T] — Create a new manual / staff inventory transaction audit log session.
- **`deactivate_inventory_location`** [D+T] — Deactivate an inventory location (fails if contains stock or pending transfers).
- **`delete_stock_threshold`** [D+T] — Delete a stock alert threshold boundary.
- **`end_inventory_shift`** [D+T] — End an active inventory shift.
- **`finalize_sale`** [D+T] — Transition a pending sale's status to completed after payment capture.
- **`get_active_inventory_shift`** [D+T] — Retrieve the active inventory shift for the current user, if any.
- **`get_inventory_transaction`** [D+T] — Retrieve details of a single transaction, including its lines.
- **`get_low_stock_alerts_at_location_scoped`** [D+T] — Get per-location low stock alerts.
- **`get_stock_thresholds`** [D+T] — Get stock alert thresholds for a location.
- **`get_workspace_inventory_locations`** [D+T] — Get inventory location bindings for a workspace instance.
- **`get_workspace_locations_scoped`** [D+T] — Resolve locations bound to a workspace instance (unified resolver ADR-19 §10).
- **`invalidate_location_cache_scoped`** [D+T] — Invalidate the location resolver cache.
- **`list_inventory_locations`** [D+T] — List all inventory locations.
- **`list_inventory_shifts`** [D+T] — List all inventory shifts history.
- **`list_inventory_transactions`** [D+T] — List all inventory transactions.
- **`list_inventory_transactions_for_shift`** [D+T] — List inventory transactions for a specific shift (staff + location + time window).
- **`set_stock_threshold`** [D+T] — Set a stock alert threshold boundary.
- **`set_workspace_inventory_locations`** [D+T] — Set inventory location bindings for a workspace instance.
- **`start_inventory_shift`** [D+T] — Start a new inventory shift for the current user at a location.
- **`update_inventory_location`** [D+T] — Update details of an existing inventory location.
- **`void_pending_sale`** [D+T] — Void a pending sale and restore stock.

### `commands::inventory_counts` (10)

- **`add_count_line_scoped`** [D+T] — Add a line to an editable count in the session's store.
- **`complete_stock_count_scoped`** [D+T] — Complete a count and attribute generated adjustments to the session user.
- **`create_stock_count_scoped`** [D+T] — Create a stock count in the session's store and attribute it to the session user.
- **`get_count_lines_scoped`** [D+T] — Fetch lines from a count in the session's store.
- **`get_stock_count_scoped`** [D+T] — Fetch one stock count from the session's store.
- **`list_stock_adjustments_scoped`** [D+T] — List adjustments from the session's store.
- **`list_stock_counts_scoped`** [D+T] — List stock counts from the session's store.
- **`remove_count_line_scoped`** [D+T] — Remove a line belonging to an editable count in the session's store.
- **`update_count_line_scoped`** [D+T] — Update a line belonging to an editable count in the session's store.
- **`update_stock_count_status_scoped`** [D+T] — Move an editable count to `in_progress` or `cancelled`.

### `commands::desktop_link` (8)

> Added 2026-09-20: these three shipped with ADR #54 §2.5 and were never listed here. The
> `check-api-surface.py` checker had been unable to run since `apps/desktop-client` was renamed,
> which is why nothing noticed; reviving it is what surfaced them.

- **`link_device_google`** [D+T] — Link this device to the account that signs in with Google.
- **`link_device_email_request`** [D+T] — Email a 6-digit code to the account address (the tablet's route).
- **`link_device_email_consume`** [D+T] — Spend that code and link the device.

- **`login_with_email_password`** [D+T] — Signs in with an email address and the account's password.
- **`poll_device_pairing`** [D+T] — Polls an active device-code pairing session (ADR #56 §2.5).
- **`request_email_login_code`** [D+T] — Emails a 6-digit sign-in code to an address (register-or-login).
- **`start_device_pairing`** [D+T] — Starts a device-code pairing session (ADR #56 §2.5).
- **`verify_email_login_code`** [D+T] — Spends an emailed sign-in code, returning the session it proved.

### `commands::kds` (9)

- **`create_kds_order_from_sale_scoped`** [D+T] — Create KDS orders in the store resolved from a session token. ADR #7.
- **`get_kds_order_lines_scoped`** [D+T] — Get all line items for a KDS order (scoped — ADR #7).
- **`get_kds_order_scoped`** [D+T] — Get a KDS order from the store resolved from a session token. ADR #7.
- **`get_kds_queue_scoped`** [D+T] — Get the kitchen queue for the store resolved from a session token. ADR #7.
- **`list_kds_orders_scoped`** [D+T] — List KDS orders for the store resolved from a session token. ADR #7.
- **`print_kds_chit_scoped`** [D+T] — Print a kitchen chit for a specific KDS order by ID (scoped — ADR #7).
- **`update_kds_line_item_status_scoped`** [D+T] — Update the status of a single KDS line item in the store resolved
- **`update_kds_order_items_scoped`** [D+T] — Update the items on a KDS order in the store resolved from a session token. ADR #7.
- **`update_kds_status_scoped`** [D+T] — Update a KDS order's status in the store resolved from a session token. ADR #7.

### `commands::kds_device` (6)

- **`ack_kds_order_scoped`** [D] — Acknowledge a KDS order — the device accepted the ticket and started
- **`deactivate_kds_device_scoped`** [D] — Deactivate a KDS device (soft-delete).
- **`get_kds_device_scoped`** [D] — Get a single KDS device by ID.
- **`list_kds_devices_scoped`** [D+T] — List all KDS devices for the Restaurant POS bound to the current session.
- **`register_kds_device_scoped`** [D+T] — Register a new KDS device bound to a Restaurant POS.
- **`update_kds_device_status_scoped`** [D] — Update a KDS device's connection status.

### `commands::kds_routing` (3)

- **`resolve_kds_targets_scoped`** [D] — Resolve which KDS device IDs should receive an order based on its


- **`get_kds_routing_rules_scoped`** [D+T] — List the KDS routing rules of the session's restaurant, highest priority first (lower number wins).
- **`save_kds_routing_rules_scoped`** [D+T] — Replace the complete KDS routing rule set of the session's restaurant.

### `commands::legal_entities` (4)

> Added 08-09-26. Every command in this module was registered and
> undocumented; these summaries are the commands own /// lines, and the
> parameter lists are in the module source.

A legal entity is the contracting body an organization registers; tenants hang off it.

- **`create_legal_entity_scoped`** [D+T] — Create a Legal Entity for the authenticated Organization/Tenant.
- **`get_legal_entity_scoped`** [D+T] — Get one Legal Entity for the authenticated Organization/Tenant.
- **`list_legal_entities_scoped`** [D+T] — List Legal Entities for the authenticated Organization/Tenant.
- **`update_legal_entity_scoped`** [D+T] — Update a Legal Entity for the authenticated Organization/Tenant.

### `commands::license` (17)

- **`activate_license`** [D] — Activates a license key for the given email, phone, and machine ID.
- **`check_license_status`** [D+T] — Checks the license status against the PocketBase license server.
- **`check_license_status_scoped`** [D] — Session-scoped variant of [`check_license_status`].
- **`get_hardware_fingerprint`** [D] — Retrieves the device-level hardware fingerprint (SPEC-2026-TRIAL-LOCK).
- **`get_hardware_fingerprint_scoped`** [D] — Session-scoped variant of [`get_hardware_fingerprint`].
- **`get_license_status`** [D+T] — Analyzes the local license state and returns a comprehensive status response.
- **`get_license_status_scoped`** [D] — Session-scoped variant of [`get_license_status`].
- **`get_machine_id`** [D] — Retrieves the unique hardware identifier for this installation.
- **`get_machine_id_scoped`** [D] — Session-scoped variant of [`get_machine_id`].
- **`pause_subscription`** [D] — Pause the current subscription for 1–3 months.
- **`pause_subscription_scoped`** [D] — Session-scoped variant of [`pause_subscription`].
- **`renew_license`** [D] — Renews an existing license subscription with a new license key.
- **`renew_license_scoped`** [D] — Session-scoped variant of [`renew_license`].
- **`resume_subscription`** [D] — Resume a paused subscription.
- **`resume_subscription_scoped`** [D] — Session-scoped variant of [`resume_subscription`].
- **`test_auth_connection`** [D] — Ping the license server's `/api/health` endpoint to verify reachability.
- **`test_auth_connection_scoped`** [D] — Session-scoped variant of [`test_auth_connection`].


### `commands::local_api` (6)

> Added 08-09-26. Every command in this module was registered and
> undocumented; these summaries are the commands own /// lines, and the
> parameter lists are in the module source.

The loopback HTTP API. Desktop-only: there is no tablet handler for any of these.

- **`local_api_mint_token_scoped`** [D] — Mint a long-lived API token signed with the per-install secret.
- **`local_api_rotate_secret_scoped`** [D] — Rotate the per-install signing secret. Every previously minted token stops validating immediately and the.
- **`local_api_set_enabled_scoped`** [D] — Enable or disable the local API server (persisted across restarts). Enabling binds `127.0.0.1:<port>` against the PRIMARY STORE's.
- **`local_api_set_port_scoped`** [D] — Change the listen port. When the server is running it is restarted on the new port; a failed restart returns an error and leaves the.
- **`local_api_set_store_scoped`** [D] — Choose which store the local API serves. Empty string resets to the primary store. Running servers restart against the new target.
- **`local_api_status_scoped`** [D] — Report whether the local API is enabled/running and on which port.

### `commands::local_payment` (6)

Regional slice 6 — the payment rails a location accepts, as one read and one whole-list write, plus gateway configuration.

- **`delete_payment_gateway_scoped`** [D+T] — Delete a payment gateway configuration for the session's store.
- **`get_local_payment_methods_scoped`** [D+T] — Read the effective payment-rail surface for one location of the session's store.
- **`get_payment_gateway_config_scoped`** [D+T] — Read a single payment gateway configuration for the session's store.
- **`list_payment_gateways_scoped`** [D+T] — List all payment gateway configurations for the session's store.
- **`set_local_payment_methods_scoped`** [D+T] — Replace the location's rail list (the card's whole-list write) and return the freshly effective set.
- **`set_payment_gateway_config_scoped`** [D+T] — Upsert a payment gateway configuration for the session's store.

### `commands::loyalty` (8)

- **`earn_loyalty_points_scoped`** [D+T] — Awards loyalty points in the store resolved by the active session.
- **`get_loyalty_account_scoped`** [D+T] — Retrieves a loyalty account from the store resolved by the active session.
- **`get_or_create_loyalty_account_scoped`** [D+T] — Retrieves or creates a loyalty account in the active store.
- **`get_points_value_scoped`** [D+T] — Converts loyalty points into minor currency units in the active store.
- **`list_loyalty_accounts_scoped`** [D+T] — Lists loyalty accounts from the store resolved by the active session.
- **`list_loyalty_tiers_scoped`** [D+T] — Lists loyalty tiers from the store resolved by the active session.
- **`redeem_loyalty_points_scoped`** [D+T] — Redeems loyalty points in the store resolved by the active session.
- **`update_loyalty_tier_scoped`** [D+T] — Updates a loyalty tier in the store resolved by the active session.


### `commands::memo` (7)

> Added 08-09-26. Every command in this module was registered and
> undocumented; these summaries are the commands own /// lines, and the
> parameter lists are in the module source.

The terminal memo board. Authoring and publishing are desktop-side; acknowledgement is per-terminal, so the read and ack commands are in both shells.

- **`acknowledge_memo_scoped`** [D+T] — Acknowledge a memo on the caller's terminal. Authenticated-only.
- **`create_memo_scoped`** [D] — Create a memo draft as the authenticated author. Requires `memo:write`.
- **`list_active_memos_scoped`** [D+T] — List the memos the caller's terminal should display, newest tier-stacked, plus the server-issued display cadence. Authenticated-only: the recipient.
- **`list_authored_memos_scoped`** [D] — List every memo authored by the session user, newest first — the management read behind the authoring screen. Requires `memo:write`; the.
- **`publish_memo_scoped`** [D] — Publish a draft memo. Requires `memo:write`.
- **`revise_memo_scoped`** [D] — Revise an existing memo with new title and body. Requires `memo:write`.
- **`stop_memo_scoped`** [D] — Early-stop a published memo (`published → stopped`): it leaves every display surface immediately and `stopped_by` records who ended it.

### `commands::offline` (9)

- **`delete_offline_item_scoped`** [D+T] — Delete a processed offline queue item (scoped).
- **`enqueue_offline_scoped`** [D+T] — Enqueue a transaction for later sync (scoped).
- **`list_all_offline_scoped`** [D+T] — List all offline queue items (scoped).
- **`list_pending_offline_scoped`** [D+T] — List all pending (unsynced) offline queue items (scoped).
- **`list_remote_failures_scoped`** [D+T] — List retained remote-application failures (scoped).
- **`offline_queue_status_summary_scoped`** [D+T] — Get a summary of the offline queue status (scoped).
- **`pending_offline_count_scoped`** [D+T] — Get the count of pending offline items (scoped).
- **`requeue_remote_failure_scoped`** [D+T] — Requeue a dead-lettered remote item (scoped).
- **`retry_offline_sync_scoped`** [D+T] — Attempt to sync all pending offline items (scoped).


### `commands::payables` (4)

> Added 08-09-26. Every command in this module was registered and
> undocumented; these summaries are the commands own /// lines, and the
> parameter lists are in the module source.

Supplier debts raised outside a purchase order. Desktop-only for now.

- **`create_payable_scoped`** [D] — Raise a payable (a supplier debt). Requires `payables:create`.
- **`list_payables_scoped`** [D] — List payables, newest first. `status` optionally filters to one lifecycle state. Requires `payables:view`.
- **`record_payable_payment_scoped`** [D] — Record a payment against a payable (partial or full settlement). Requires `payables:settle`. Returns the updated payable; the payment history is a.
- **`write_off_payable_scoped`** [D] — Write off a payable (forgive the remaining balance). Requires `payables:writeoff` — a money-destruction action, terminal and audited.

### `commands::pos` (21)

- **`add_line_scoped`** [D+T] — Add a line to an active cart in the store resolved from a session token. ADR #7.
- **`complete_sale_scoped`** [D+T] — Complete a sale within the store resolved from a session token.
- **`complete_sale_with_resolved_shortfalls_scoped`** [D+T] — Complete a sale with cashier-resolved shortfalls (split fulfillment).
- **`compute_cart_tax_scoped`** [D+T] — Compute cart tax for the store resolved from a session token. ADR #7.
- **`delete_held_cart_scoped`** [D+T] — Delete a held cart in the store resolved from a session token. ADR #7.
- **`get_active_cart_scoped`** [T] — Load a cart in the session scope. ADR #7.
- **`get_cart_deduction_location`** [T] — Return the deduction location info for an active cart.
- **`get_cart_deduction_location_scoped`** [D+T] — Scoped variant of `get_cart_deduction_location` (ADR #7).
- **`get_held_cart_scoped`** [D+T] — Get a held cart from the store resolved from a session token. ADR #7.
- **`hold_cart_scoped`** [D+T] — Hold a cart in the store resolved from a session token. ADR #7.
- **`list_active_carts_scoped`** [T] — List active carts in the session scope. ADR #7.
- **`list_held_carts_scoped`** [D+T] — List held carts for the store resolved from a session token. ADR #7.
- **`list_open_bills_scoped`** [D+T] — List open bills for the store resolved from a session token. ADR #7.
- **`override_cart_deduction_location_scoped`** [D+T] — Override the deduction location lock on an active cart.
- **`override_line_price_scoped`** [D+T] — Override a line price within the store resolved from a session token.
- **`preview_promoted_total_from_lines_scoped`** [D+T] — Preview the promotion-reduced payable from raw cart lines.
- **`preview_promoted_total_scoped`** [D+T] — Preview the promotion-reduced payable for a cart without mutating it.
- **`set_cart_discount_scoped`** [D+T] — Set a cart discount within the store resolved from a session token.
- **`start_sale_scoped`** [D+T] — Start a new sale in the store resolved from a session token. ADR #7.

- **`publish_course_fired_scoped`** [D+T] — Publish one fired course for a completed sale (ADR #7).
- **`set_line_course_scoped`** [D+T] — Assign (or clear) the restaurant course on an active cart line (ADR #7).

### `commands::product_variants` (5)

- **`create_product_variant_scoped`** [D+T] — Create a product variant (scoped).
- **`delete_product_variant_scoped`** [D+T] — Scoped variant of `delete_product_variant` (ADR #7).
- **`get_product_variant_scoped`** [D+T] — Scoped variant of `get_product_variant` (ADR #7).
- **`list_product_variants_scoped`** [D+T] — Scoped variant of `list_product_variants` (ADR #7).
- **`update_product_variant_scoped`** [D+T] — Update an existing product variant (scoped).

### `commands::products` (12)

- **`adjust_stock_scoped`** [D+T] — Adjust stock for the store resolved from a session token.
- **`create_product_scoped`** [D+T] — Create a product within the store resolved from a session token.
- **`delete_product_scoped`** [D+T] — Delete a product within the store resolved from a session token.
- **`get_product_track_serial_batch_scoped`** [D+T] — Store-scoped batch variant of `get_product_track_serial_batch`. ADR #7.
- **`get_product_track_serial_scoped`** [D+T] — Check whether a product tracks serial numbers, store-scoped. ADR #7.
- **`list_products_scoped`** [D+T] — Fetch all products for the store resolved from a session token.
- **`list_warehouse_products_at_location`** [D] — Fetch inventory-tracked products with stock at a specific location.
- **`list_warehouse_products_scoped`** [T] — Session-scoped variant of `list_warehouse_products`.
- **`lookup_by_barcode_scoped`** [D+T] — Look up a product by barcode for the store resolved from a
- **`lookup_product_by_sku_scoped`** [D+T] — Look up a product by SKU for the store resolved from a
- **`record_product_search_scoped`** [D+T] — Record an acted-upon product search for the popularity index.
- **`update_product_scoped`** [D+T] — Update a product within the store resolved from a session token.


### `commands::products_images` (3)

> Added 08-09-26. Every command in this module was registered and
> undocumented; these summaries are the commands own /// lines, and the
> parameter lists are in the module source.

Product image slot assignment (slots 1..=5). The bytes live on disk; these commands move the assignment rows.

- **`products_clear_image_scoped`** [D+T] — Remove the image at `slot` for `product_id`. Only the DB assignment is removed; the file on disk is left for the GC.
- **`products_list_images_scoped`** [D+T] — List the image assignments for a product (slots 1..=5), ordered by slot. The editor flow calls this on open to show the primary + alternatives.
- **`products_set_image_scoped`** [D+T] — Assign the image at `source_path` to `product_id` at `slot` (1..=5). The ingest pipeline runs entirely in Rust: `source_path` is the file.

### `commands::promotions` (7)

- **`apply_promotion_scoped`** [D+T] — Apply a promotion in the store resolved from a session token. ADR #7.
- **`create_promotion_scoped`** [D+T] — Create a promotion in the store resolved from a session token. ADR #7.
- **`delete_promotion_scoped`** [D+T] — Delete a promotion in the store resolved from a session token. ADR #7.
- **`get_promotion_scoped`** [D+T] — Get a promotion from the store resolved from a session token. ADR #7.
- **`get_sale_promotions_scoped`** [D+T] — Get sale promotions from the store resolved from a session token. ADR #7.
- **`list_promotions_scoped`** [D+T] — List promotions for the store resolved from a session token. ADR #7.
- **`update_promotion_scoped`** [D+T] — Update a promotion in the store resolved from a session token. ADR #7.

### `commands::purchasing` (10)

- **`create_purchase_order_scoped`** [D+T] — Scoped variant of `create_purchase_order` (ADR #7).
- **`create_supplier_scoped`** [D+T] — Scoped variant of `create_supplier` (ADR #7).
- **`get_purchase_order_scoped`** [D+T] — Scoped variant of `get_purchase_order` (ADR #7).
- **`get_supplier_scoped`** [D+T] — Scoped variant of `get_supplier` (ADR #7).
- **`list_purchase_orders_scoped`** [D+T] — Scoped variant of `list_purchase_orders` (ADR #7).
- **`list_suppliers_scoped`** [D+T] — Scoped variant of `list_suppliers` (ADR #7).
- **`receive_purchase_order_scoped`** [D+T] — Scoped variant of `receive_purchase_order` (ADR #7).
- **`receive_purchase_order_with_lines_scoped`** [D+T] — Scoped variant of `receive_purchase_order_with_lines` (ADR #7).
- **`update_po_status_scoped`** [D+T] — Scoped variant of `update_po_status` (ADR #7).
- **`update_supplier_scoped`** [D+T] — Scoped variant of `update_supplier` (ADR #7).

### `commands::qris_auto` (2)

Dynamic QRIS, desktop and tablet. Both are scoped, per ADR #7.

- **`qris_auto_charge_scoped`** [D+T] — Issue a dynamic Midtrans QRIS charge for a sale (scoped, ADR #7).
- **`qris_auto_status_scoped`** [D+T] — Poll a charge's settlement status (scoped, ADR #7).

### `commands::refunds` (3)

- **`list_refunds_scoped`** [D+T] — List all refunds for a sale from the store resolved from a session token.
- **`lookup_sale_by_receipt_barcode_scoped`** [D+T] — Look up a sale by receipt barcode from the store resolved from a session token.
- **`process_refund_scoped`** [D+T] — Process a refund within the store resolved from a session token.

### `commands::receipt_format` (3)

Three layers of one receipt format: the terminal override, the workspace layout record, and the primary legal entity's statutory content.

- **`get_receipt_format_scoped`** [D+T] — Read the effective receipt format for the session's terminal (or the store default when none is bound).
- **`set_receipt_content_scoped`** [D+T] — Replace the primary legal entity's statutory content record and return the freshly effective format.
- **`set_receipt_layout_scoped`** [D+T] — Replace the workspace-layer layout record for the session's store db.

### `commands::regional` (3)

Regional slice 2/3 — the per-location regional configuration, read and write — and slice 7, the
compiled cold-boot market profile.

- **`get_regional_config_scoped`** [D+T] — Read the effective regional configuration for one location of the session's store.
- **`set_regional_config_scoped`** [D+T] — Write the regional configuration for one location of the session's store.
- **`get_active_market_profile_scoped`** [D+T] — Read the compiled, locked market profile for one location of the session's store. Gate `settings:read` in `kasirmu_bridge::regional`; loaded once on cold boot and cached in application state, so **zero database reads happen during the sale lifecycle**. Registered in both shells (`apps/desktop-tauri/src/lib.rs:1763`, `apps/mobile-tauri/src/lib.rs:1250`).

### `commands::reports` (24)

- **`build_custom_report_scoped`** [D+T] — Build a custom report for the session's store.
- **`get_basket_size_scoped`** [D+T] — Get average basket size for the session's store.
- **`get_basket_size_trend_scoped`** [D+T] — Get per-day basket size (mean line count) for the session's store.
- **`get_category_breakdown_scoped`** [D+T] — Get category breakdown for the session's store.
- **`get_category_forecast_scoped`** [D+T] — Get the next-period demand forecast per top category (simple linear fit
- **`get_category_popularity_scoped`** [D+T] — Get per-category popularity standings for the session's store: each
- **`get_category_popularity_trend_scoped`** [D+T] — Get the per-period popularity trend for the session's store: each of the
- **`get_customer_split_scoped`** [D+T] — Get new vs returning customer counts for the session's store.
- **`get_daily_revenue_scoped`** [D+T] — Get daily revenue for the session's store.
- **`get_discounts_summary_scoped`** [D+T] — Get discount usage summary for the session's store.
- **`get_hourly_heatmap_scoped`** [D+T] — Get hourly heatmap for the session's store.
- **`get_hourly_occupancy_scoped`** [D+T] — Completed table-bound orders per hour of day for the session's store.
- **`get_inventory_trend_scoped`** [D+T] — Get daily units sold (the inventory trend line) for the session's store.
- **`get_inventory_turnover_scoped`** [D+T] — Get a stock-turnover snapshot for the session's store at one location.
- **`get_low_stock_alerts_scoped`** [D+T] — Get low stock alerts for the session's default store location.
- **`get_menu_engineering_scoped`** [D+T] — Get menu engineering for the session's store.
- **`get_monthly_revenue_scoped`** [D+T] — Get monthly revenue for the session's store.
- **`get_payment_method_breakdown_scoped`** [D+T] — Get revenue split by payment method for the session's store.
- **`get_sale_line_margins_scoped`** [D+T] — Get per-line cost and margin for a single sale (HPP exposure).
- **`get_table_turnover_scoped`** [D+T] — Completed table-bound orders per day for the session's store.
- **`get_top_products_scoped`** [D+T] — Get top products for the session's store with a bounded limit.
- **`get_voided_items_scoped`** [D+T] — Get the top voided product lines for the session's store.
- **`get_voided_sales_summary_scoped`** [D+T] — Get voided-sale totals for the session's store.
- **`get_weekly_revenue_scoped`** [D+T] — Get weekly revenue for the session's store.

### `commands::scale` (3)

- **`list_scale_devices_scoped`** [D+T] — List scale devices (scoped).
- **`read_scale_weight`** [T] — Read the current weight from the registered weight scale.
- **`read_scale_weight_scoped`** [D+T] — Read scale weight (scoped).

### `commands::security` (3)

- **`get_key_rotation_info`** [D] — Get the current key rotation status (key age, creation timestamp).
- **`get_key_rotation_info_scoped`** [D] — Session-scoped variant of [`get_key_rotation_info`].
- **`rotate_encryption_key_scoped`** [D] — Session-scoped variant of [`rotate_encryption_key`].

### `commands::settings` (20)

- **`gateway_status`** [D+T] — Report which payment gateways have credentials configured.
- **`get_credit_settings_scoped`** [D+T] — Scoped variant of `get_credit_settings` (ADR #7).
- **`get_deployment_info`** [D+T] — Read-only deployment metadata for the signed-in operator. Authenticates the session and checks `settings:read` inline (category 2 unscoped command).
- **`get_hardware_settings`** [T] — Get hardware settings for the current terminal from the DB.
- **`get_hardware_settings_scoped`** [D+T] — Get hardware settings (scoped — multi-phase with session validation).
- **`get_receipt_settings_scoped`** [D+T] — Get receipt settings resolved from a session token. ADR #7.
- **`get_setting`** [D+T] — Read a single setting value by key.
- **`get_setting_scoped`** [D+T] — Scoped variant of `get_setting` (ADR #7).
- **`get_store_settings_scoped`** [D+T] — Get store settings resolved from a session token. ADR #7.
- **`get_user_preferences_scoped`** [D+T] — Get user preferences resolved from a session token. ADR #7.
- **`list_credit_sales_scoped`** [D+T] — List credit sales for the store resolved from a session token. ADR #7.
- **`set_credit_settings_scoped`** [D+T] — Set credit settings resolved from a session token. ADR #7.
- **`set_hardware_settings_scoped`** [D+T] — Set hardware settings resolved from a session token. ADR #7.
- **`set_receipt_settings_scoped`** [D+T] — Set receipt settings resolved from a session token. ADR #7.
- **`set_setting`** [D+T] — **Deprecated — use `set_setting_scoped` (ADR #7).**
- **`set_setting_scoped`** [D+T] — Write (or overwrite) a single setting value resolved from a session token. ADR #7.
- **`set_settings_scoped`** [D+T] — Write (or overwrite) multiple settings in a single transaction, resolved from a session token. ADR #7.
- **`set_store_settings_scoped`** [D+T] — Set store settings resolved from a session token. ADR #7.
- **`set_user_preferences_scoped`** [D+T] — Set user preferences resolved from a session token. ADR #7.
- **`settle_credit_scoped`** [D+T] — Settle a credit sale resolved from a session token. ADR #7.

### `commands::setup` (5)

- **`get_enabled_features`** [D+T] — Return the list of currently-enabled feature keys.
- **`seed_default_roles_scoped`** [D+T] — Requires the `staff:manage_roles` permission.

- **`get_first_run_state`** [D+T] — The first-run state for one terminal (ADR #56 §2.1); replaces the retired `get_setup_status` boolean.
- **`get_preset_features`** [D+T] — Return the feature keys a store-type preset enables.
- **`provision_device`** [D+T] — Provision this terminal in one idempotent transaction (ADR #56 §2.2).

### `commands::shifts` (7)

- **`close_shift_scoped`** [D+T] — Close a shift in the store resolved from a session token. ADR #7.
- **`create_cash_payout_scoped`** [D+T] — Scoped variant of `create_cash_payout` (ADR #7).
- **`get_active_shift_scoped`** [D+T] — Get the active shift for the session user from the store-scoped DB. ADR #7.
- **`get_shift_report_scoped`** [D+T] — Scoped variant of `get_shift_report` (ADR #7).
- **`get_shift_scoped`** [D+T] — Scoped variant of `get_shift` (ADR #7).
- **`list_shifts_scoped`** [D+T] — List shifts for the store resolved from a session token. ADR #7.
- **`open_shift_scoped`** [D+T] — Open a shift in the store resolved from a session token. ADR #7.

### `commands::staff` (16)

- **`bootstrap_owner`** [D+T] — Create the first owner user in a fresh installation.
- **`create_role_scoped`** [D+T] — Create a custom role: a named key-set row in the same vocabulary enforcement already speaks (ADR #47 ruling 4).
- **`create_staff_scoped`** [D+T] — Create a staff member. Caller identity is resolved from the session token.
- **`delete_role_scoped`** [D+T] — Delete an authored role. Refused for preset ids and for any role still referenced. The second guard.
- **`get_staff_profile_scoped`** [D+T] — Load a staff member's full profile as the session user sees it (ADR #35
- **`list_permission_keys_scoped`** [D+T] — List the registered permission keys. Without this the authoring UI would have to hardcode the vocabulary, which.
- **`list_role_holders_scoped`** [D+T] — List the accounts that hold one role, org-wide. No store filter, deliberately: `users`, `assignments` and `roles` are.
- **`list_roles_scoped`** [D+T] — List roles. Caller identity is resolved from the session token.
- **`list_staff_scoped`** [D+T] — List staff members. Caller identity is resolved from the session token.
- **`update_role_scoped`** [D+T] — Re-name, re-describe, or re-grant an authored role. Editing re-points every holder, so the grant set is validated against the.
- **`update_staff_scoped`** [D+T] — Update a staff member. Caller identity is resolved from the session token.

- **`delete_staff_scoped`** [D+T] — Move a staff member to the trash (the soft delete, 90-day retention window).
- **`list_role_trash_scoped`** [D+T] — The role trash, newest first. Runs the 90-day purge sweep before listing.
- **`list_staff_trash_scoped`** [D+T] — The staff trash, newest first. Runs the 90-day purge sweep before listing.
- **`restore_role_scoped`** [D+T] — Take a custom role back out of the trash.
- **`restore_staff_scoped`** [D+T] — Take a staff member back out of the trash (they come back INACTIVE).

### `commands::stock_transfers` (10)

- **`add_stock_transfer_line_scoped`** [D+T] — Add a transfer line in the session-scoped store.
- **`cancel_stock_transfer_scoped`** [D+T] — Cancel a transfer in the session-scoped store.
- **`create_stock_transfer_scoped`** [D+T] — Create a stock transfer in the store resolved from the session token.
- **`get_stock_transfer_lines_scoped`** [D+T] — Get transfer lines from the session-scoped store.
- **`get_stock_transfer_scoped`** [D+T] — Get a stock transfer from the session-scoped store.
- **`list_in_transit_transfers_scoped`** [D+T] — List in-transit transfers with their line items in one batch request.
- **`list_stock_transfers_scoped`** [D+T] — List stock transfers from the session-scoped store.
- **`receive_stock_transfer_scoped`** [D+T] — Receive a transfer, attributing the actor to the authenticated session.
- **`remove_stock_transfer_line_scoped`** [D+T] — Remove a transfer line in the session-scoped store.
- **`send_stock_transfer_scoped`** [D+T] — Send a transfer in the session-scoped store.

### `commands::locations` (9)

> Renamed from `store_profiles` in the store→location rename (`10260a035`/`c9d0ec95f`
> core SQL 09-06, `54470e277` wire field 09-07, `1b3e71798` entitlements 09-08). Every
> name below was verified 08-09-26 against `apps/desktop-tauri/src/commands/locations.rs`
> — all eight `pub async fn` in that file, with that file's own `///` summaries. Seven of
> the eight are in `apps/desktop-tauri/src/lib.rs` (`:1194`–`:1200`); **the eighth,
> `get_primary_location`, is defined but wired into no handler at all.** It stays listed
> because this page is derived from `#[tauri::command]` definitions, per this header's own
> first sentence — a page derived from the handlers would have silently dropped a command
> the front-end cannot call. None of the eight is in a tablet handler. That first draft
> said "all eight are registered" and the checker answered by moving its own count the
> wrong way, 85 unwired became 86: the tool caught my assertion inside the same edit that
> introduced it.
> Note the pre-rename rows said "Scoped variant of `create_store_profile`" and so on:
> **no such unscoped command has ever existed in either app.** The only surviving
> `store_profile` names are SQLite service methods in
> `crates/kasirmu-core/src/db/locations.rs` (`list_store_profiles`, `get_store_profile`), which
> are not IPC surface. A doc comment pointing at one of those as a command is how 7 rows
> came to look like live API.
> **Changed 2026-09-29:** `get_primary_location` is defined at
> `apps/desktop-tauri/src/commands/locations.rs:100` and wired into no handler, so it is no
> longer listed here as a command — see [Defined but in no handler](#defined-but-in-no-handler-3-names).
> The section keeps the seven `_scoped` commands, all of which are registered in the
> desktop handler.

- **`list_locations_scoped`** [D+T] — List location profiles for the session's tenant (ADR #7).
- **`get_location_profile_scoped`** [D+T] — Get a location profile for the session's tenant (ADR #7).
- **`get_primary_location_scoped`** [D+T] — Get the primary location for the session's tenant (ADR #7).
- **`create_location_profile_scoped`** [D+T] — Create a location profile for the session's tenant (ADR #7).
- **`update_location_profile_scoped`** [D+T] — Update a location profile for the session's tenant (ADR #7).
- **`set_primary_location_scoped`** [D+T] — Set a location as primary for the session's tenant (ADR #7).
- **`delete_location_profile_scoped`** [D+T] — Delete a location profile for the session's tenant (ADR #7).

- **`get_location_ticket_prefix_scoped`** [D+T] — Read one location's KDS ticket prefix for the session's tenant (`None` means no prefix).
- **`set_location_ticket_prefix_scoped`** [D+T] — Set (or clear) one location's KDS ticket prefix; returns the value as stored.

### `commands::subscription` (4)

- **`explain_feature_availability_scoped`** [D+T] — Explain WHY a feature is (un)available for the session user — the diagnostics surface behind support's "why can't I use X" question.
- **`get_over_quota_report`** [D+T] — The tenant-level over-quota assessment for the owner-facing remediation view (todo-global-saas-2.md §J downgrade item): which.
- **`get_subscription_capabilities`** [D+T] — Read the tenant's subscription capabilities and current usage.

- **`get_over_quota_report_scoped`** [D+T] — The `_scoped` twin of `get_over_quota_report` for the owner-facing remediation view.

### `commands::sync` (17)

- **`get_pg_sync_settings_scoped`** [D] — Get PG sync settings (scoped).
- **`get_sync_plan_scoped`** [D+T] — Get sync plan (scoped).
- **`get_sync_settings_scoped`** [D+T] — Get sync settings resolved from a session token. ADR #7.
- **`pending_sync_count_scoped`** [D+T] — Pending sync count (scoped).
- **`pg_sync_start_scoped`** [D] — PG sync start (scoped).
- **`pg_sync_status_scoped`** [D] — PG sync status (scoped).
- **`pg_sync_stop_scoped`** [D] — PG sync stop (scoped).
- **`request_sync_token_scoped`** [D+T] — Request a sync token (scoped).
- **`settings_changed_sink_scoped`** [D] — Settings changed sink (scoped — no-op for session-validated callers).
- **`sync_pull_scoped`** [D+T] — Sync pull (scoped — 4-phase with auth refresh + backup).
- **`sync_run_scoped`** [D+T] — Sync run (scoped — 3-phase with auth refresh).
- **`test_sync_connection`** [D+T] — Test the cloud sync connection by pinging the configured server.
- **`test_sync_connection_scoped`** [D+T] — Test sync connection (scoped).
- **`update_pg_sync_settings_scoped`** [D] — Update PG sync settings (scoped).
- **`update_sync_settings_scoped`** [D+T] — Update sync settings (scoped).

- **`list_sync_conflicts_scoped`** [D+T] — List conflicts flagged for manager review (scoped).
- **`resolve_sync_conflict_scoped`** [D+T] — Record a manager's decision on a conflict (scoped). Returns `false` when the row was not open.

### `commands::tables` (9)

- **`assign_table_order_scoped`** [D+T] — Assign an order to a table in the store resolved from a session token. ADR #7.
- **`create_table_scoped`** [D+T] — Create a table in the store resolved from a session token. ADR #7.
- **`delete_table_scoped`** [D+T] — Delete a table in the store resolved from a session token. ADR #7.
- **`get_table_scoped`** [D+T] — Get a table from the store resolved from a session token. ADR #7.
- **`list_sections_scoped`** [D+T] — List sections for the store resolved from a session token. ADR #7.
- **`list_tables_scoped`** [D+T] — List tables for the store resolved from a session token. ADR #7.
- **`release_table_scoped`** [D+T] — Release a table in the store resolved from a session token. ADR #7.
- **`update_table_scoped`** [D+T] — Update a table in the store resolved from a session token. ADR #7.
- **`update_table_status_scoped`** [D+T] — Update a table's status in the store resolved from a session token. ADR #7.

### `commands::tax` (8)

- **`create_tax_rate_scoped`** [D+T] — Create a tax rate in the store resolved from a session token. ADR #7.
- **`delete_tax_rate_scoped`** [D+T] — Delete a tax rate in the store resolved from a session token. ADR #7.
- **`get_tax_rate_dependency_counts_scoped`** [D+T] — Get dependency (reference) counts for a tax rate in the store resolved
- **`list_category_tax_rates_scoped`** [D+T] — List category-to-tax-rate assignments for the store resolved from a
- **`list_tax_rates_scoped`** [D+T] — List tax rates for the store resolved from a session token. ADR #7.
- **`set_category_tax_rates_scoped`** [D+T] — Set (replace) the tax rates assigned to a category in the store resolved
- **`update_tax_rate_scoped`** [D+T] — Update a tax rate in the store resolved from a session token. ADR #7.

- **`list_tax_rate_rounding_modes_scoped`** [D+T] — The statutory rounding directive of each named rate row, in one batch read (E1-5).

### `commands::terminals` (16)

- **`clear_device_binding_scoped`** [D] — Clear a device binding in the store resolved from a session token. ADR #7.
- **`delete_terminal_override_scoped`** [D+T] — Delete a terminal override in the store resolved from a session token. ADR #7.
- **`delete_terminal_profile_scoped`** [D] — Delete a terminal profile in the store resolved from a session token. ADR #7.
- **`delete_terminal_scoped`** [D+T] — Delete a terminal in the store resolved from a session token. ADR #7.
- **`get_device_binding_scoped`** [D] — Get device binding from the store resolved from a session token. ADR #7.
- **`get_terminal_profile_scoped`** [D] — Get a terminal profile from the store resolved from a session token. ADR #7.
- **`get_terminal_scoped`** [D+T] — Get a terminal from the store resolved from a session token. ADR #7.
- **`list_terminal_overrides_scoped`** [D+T] — List terminal overrides from the store resolved from a session token. ADR #7.
- **`list_terminal_profiles_scoped`** [D] — List terminal profiles from the store resolved from a session token. ADR #7.
- **`list_terminals_scoped`** [D+T] — List terminals from the store resolved from a session token. ADR #7.
- **`ping_terminal_scoped`** [D+T] — Ping a terminal in the store resolved from a session token. ADR #7.
- **`register_terminal_scoped`** [D+T] — Register a terminal in the store resolved from a session token. ADR #7.
- **`set_device_binding_scoped`** [D+T] — Set a device binding in the store resolved from a session token. ADR #7.
- **`set_terminal_override_scoped`** [D+T] — Set a terminal override in the store resolved from a session token. ADR #7.
- **`set_terminal_profile_scoped`** [D] — Set a terminal profile in the store resolved from a session token. ADR #7.
- **`update_terminal_scoped`** [D+T] — Update a terminal in the store resolved from a session token. ADR #7.

### `commands::topology` (10)

- **`apply_topology_diff`** [D] — Apply a full topology diff atomically (Critical #4).
- **`can_save_topology`** [D] — Return whether the authenticated session can save topology changes.
- **`delete_topology_template`** [D] — Delete one template. Returns `false` when there was nothing to delete.
- **`list_topology_revisions`** [D] — ADR #46 §1/§8: one branch's deploy history, newest first, metadata only. Gated on `AUDIT_VIEW`, not `TOPOLOGY_WRITE`. Revision history answers the.
- **`list_topology_templates`** [D] — Names of a branch's saved templates, sorted for display.
- **`load_topology`** [D] — Load the persisted topology graph.
- **`load_topology_revision`** [D] — ADR #46 §5/§7: fetch one revision's graph, to diff it or load it as a draft. Never mutates — restore-to-draft is a client-side action, and.
- **`load_topology_template`** [D] — Load one diagram template. `None` when it never existed or is unreadable.
- **`pin_topology_revision`** [D] — ADR #46 §4: pin or unpin one revision, exempting it from deflation. Gated on `TOPOLOGY_WRITE`, deliberately unlike its two read siblings.
- **`save_topology_template`** [D] — Save a diagram template under a branch, replacing any template of that name.

### `commands::updater` (3)

Android in-app self-updater. **Tablet-only ([T]): the module lives in `apps/mobile-tauri/src/commands/updater.rs` and no desktop command exists for it** — the desktop keeps its own updater surface (the `@tauri-apps/plugin-updater` probe behind `useVersionStatus`).

- **`check_app_update`** [T] — Query release manifest and check for available Android updates.
- **`start_apk_download`** [T] — Download APK streaming with resume and SHA-256 verification.
- **`prepare_and_launch_update`** [T] — Create safety SQLite backup snapshot before installing update.

### `commands::void` (1)

- **`void_sale_scoped`** [D+T] — Void a sale within the store resolved from a session token.

### `commands::workspaces` (15)

- **`archive_workspace_instance_scoped`** [D] — Archive (soft-delete) a workspace instance (admin). ADR #7.
- **`create_workspace_instance_scoped`** [D] — Create a new workspace instance (admin). Permission from session. ADR #7.
- **`get_user_workspace_instances_scoped`** [D] — Get instance IDs assigned to a user. Permission check from session. ADR #7.
- **`get_workspace_instance_scoped`** [D] — Get a single workspace instance. `is_default` reflects the session user. ADR #7.
- **`list_all_workspaces_scoped`** [D] — List all workspace types resolved from a session token. ADR #7.
- **`list_workspace_screens`** [D+T] — List screens (nav items) for a workspace type during boot/workspace
- **`list_workspace_screens_scoped`** [D] — List screens for a workspace type from the store-scoped database. ADR #7.
- **`list_workspaces`** [D+T] — List workspace instances for the pre-session workspace picker.
- **`list_workspaces_for_store_scoped`** [D] — List workspace instances in an explicitly named store for the session user.
- **`list_workspaces_scoped`** [D] — List workspace instances accessible to the session user within their store. ADR #7.
- **`recover_workspace_instances_scoped`** [D] — Recover `QuotaSuspended` workspace instances after a tier upgrade. ADR #5 Phase 3b.
- **`resolve_boot_store`** [D+T] — Resolve the active store and instance from device binding.
- **`set_user_workspace_instances_scoped`** [D] — Replace all instance assignments for a user. Caller permission from session. ADR #7.
- **`suspend_surplus_workspace_instances_scoped`** [D] — Suspend surplus workspace instances after a tier downgrade. ADR #5 Phase 3c.
- **`update_workspace_instance_scoped`** [D] — Update the editable fields of a workspace instance (admin). ADR #7.



---

## Names this page deliberately does not list

Everything removed from the module sections above is here. None of these names can be
invoked today; each line says what to call instead or where the real function lives.
Re-derive the whole set with `python .agents/skills/docs-auditor/scripts/check-api-surface.py --full`.

### Retired unscoped twins (90 names)

The ADR #7 convention's legacy half. Each row's unscoped name was deleted from both
clients; **the callable surface is the `_scoped` twin of the same name, which has its own
row above.** A grep for any name in this table returns nothing under `apps/`.

| Module | Retired unscoped names (`_scoped` twin is the callable one) |
|---|---|
| `commands::branding` | `set_brand_logo_path`, `set_brand_primary_colour`, `set_brand_store_name` |
| `commands::bundles` | `create_bundle`, `delete_bundle`, `get_bundle`, `list_bundles`, `lookup_bundle_by_sku`, `update_bundle` |
| `commands::gift_cards` | `freeze_gift_card`, `get_gift_card`, `get_gift_card_balance`, `issue_gift_card`, `list_gift_cards`, `redeem_gift_card`, `top_up_gift_card`, `unfreeze_gift_card` |
| `commands::hardware` | `open_cash_drawer`, `print_receipt`, `print_sales_receipt` |
| `commands::offline` | `delete_offline_item`, `enqueue_offline`, `list_all_offline`, `list_pending_offline`, `list_remote_failures`, `pending_offline_count`, `requeue_remote_failure`, `retry_offline_sync` |
| `commands::product_variants` | `create_product_variant`, `delete_product_variant`, `get_product_variant`, `list_product_variants`, `update_product_variant` |
| `commands::products` | `create_product`, `delete_product`, `get_product_track_serial`, `get_product_track_serial_batch`, `list_warehouse_products`, `lookup_product_by_sku`, `record_product_search`, `update_product` |
| `commands::promotions` | `apply_promotion`, `create_promotion`, `delete_promotion`, `get_promotion`, `get_sale_promotions`, `list_promotions`, `update_promotion` |
| `commands::purchasing` | `create_purchase_order`, `create_supplier`, `get_purchase_order`, `get_supplier`, `list_purchase_orders`, `list_suppliers`, `receive_purchase_order`, `update_po_status`, `update_supplier` |
| `commands::settings` | `get_credit_settings`, `get_receipt_settings`, `get_store_settings`, `list_credit_sales`, `set_credit_settings`, `set_receipt_settings`, `set_store_settings`, `settle_credit` |
| `commands::sync` | `get_sync_plan`, `get_sync_settings`, `pending_sync_count`, `request_sync_token`, `sync_pull`, `sync_run`, `update_sync_settings` |
| `commands::tables` | `assign_table_order`, `create_table`, `delete_table`, `get_table`, `list_sections`, `list_tables`, `release_table`, `update_table`, `update_table_status` |
| `commands::terminals` | `delete_terminal`, `delete_terminal_override`, `get_terminal`, `list_terminal_overrides`, `list_terminals`, `ping_terminal`, `set_terminal_override`, `update_terminal` |
| `commands::locations` | `get_primary_location` |

### Documented as non-commands before, moved here (8 names)

These rows used to sit in the module sections with a `[not an IPC command]` marker. They
are real code at the wrong layer, kept because callers exist for them.

| Name | What it actually is |
|---|---|
| `create_kds_order_from_sale` | Service method in `kasirmu_core::db`; the command is `create_kds_order_from_sale_scoped` |
| `get_kds_order` | Service method in `kasirmu_core::db`; the command is `get_kds_order_scoped` |
| `get_kds_queue` | Service method in `kasirmu_core::db`; the command is `get_kds_queue_scoped` |
| `list_kds_orders` | Service method in `kasirmu_core::db`; the command is `list_kds_orders_scoped` |
| `update_kds_status` | Service method in `kasirmu_core::db`; the command is `update_kds_status_scoped` |
| `settings_changed_sink` | A plain helper at `apps/desktop-tauri/src/commands/sync.rs:210`, wired at `:366`; the command is `settings_changed_sink_scoped` at `:811` |
| `rotate_encryption_key` | Retired by `a32b13aaa` ("drop the ungated rotate_encryption_key command"); the command is `rotate_encryption_key_scoped` at `apps/desktop-tauri/src/commands/security.rs:105` |
| `recover_pending_topology_apply_at_startup` | An internal startup routine, not a `#[command]`, and it has no `_scoped` twin either |

### Retired by a rename, with no unscoped twin (3 names)

| Retired name | Replacement |
|---|---|
| `complete_setup` | `provision_device` (ADR #56 §2.2) — one idempotent transaction instead of a preset write |
| `dismiss_setup_wizard` | `provision_device` — the wizard's dismissal is a first-run state, not a separate command |
| `get_setup_status` | `get_first_run_state` (ADR #56 §2.1) — a state, not the retired boolean |

### Defined but in no handler (3 names)

Annotated `#[tauri::command]`, and absent from both `generate_handler!` lists. The
front-end cannot call any of these; they are listed here rather than in the module
sections because this page documents the **callable** surface.

| Name | Note |
|---|---|
| `adjust_stock` | Superseded by `adjust_stock_scoped`; carries no `///` line in source |
| `list_products` | Superseded by `list_products_scoped` |
| `register_terminal` | Source marks it "**Deprecated for multi-store (ADR #7):** Use `register_terminal_scoped`" |

---

> last audited 08-10-26 by docs-auditor

