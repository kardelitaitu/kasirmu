//! Pinned gated-command census (ADR #35 D3 / spec 0047).
//!
//! Every Tauri command module in both clients is enumerated here with its
//! permission-gate census: how many `require_permission_for_user` /
//! `require_permission_for_session` calls the module makes, and which
//! permission constants flow into the gate. The list is explicit and
//! reviewed — adding a command module, or changing any gate call, requires
//! updating this pin. That diff is the review signal the spec's "pinned
//! gated-command set" calls for.
//!
//! The test also asserts:
//! - every permission key used at a gate call site is a *registered* key
//!   (the 0046 registry inventory), so an unregistered key can never reach
//!   the gate from a live command, and
//! - no raw string-literal permission (e.g. `"sales:typo"`) is passed to a
//!   gate call — unregistered literal typos are fail-closed (denied) by the
//!   gate, but they would break the command, so they are pinned out of
//!   existence.
//!
//! Scope: the *path a client actually executes*, not one directory. The
//! desktop shell's `src/commands` and the tablet shell's are walked with the
//! `authz.rs` wrapper names, and - because Wave A-E lifted the desktop
//! command bodies into `crates/kasirmu-bridge/src` (the shell files are shims that
//! build a `BridgeCtx` and forward) - the bridge is walked too, with its own
//! wrapper names, merged into the desktop table by module stem. A stem that
//! exists in both is summed; a stem that exists in only one is pinned as
//! found. So `analytics` still reads 2 after the move, because its two gate
//! calls moved rather than vanished - and a gate that is dropped instead of
//! moved still trips the pin.
//!
//! Test-module blocks are stripped before census. The gate itself is
//! `kasirmu_core::db::Store::require_permission`; the wrappers in each root's helper
//! module (`authz.rs` in the shells, `ctx.rs` in the bridge) are the only
//! entry points, so a module with zero gate calls is ungated by construction
//! (its census is pinned as `0, &[]`).

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Pinned census — desktop client.
// Shell gate calls plus the gate calls in `crates/kasirmu-bridge/src`, which the shell
// forwards to. Generated from the current source; update deliberately,
// never silently.
//
// `currencies` and `exchange_rates` read 0 because their bodies were folded
// into the bridge's single `currency` module, which pins 7 - exactly the
// 2 + 5 they used to carry. The count moved; it did not disappear.
// ---------------------------------------------------------------------------
static PINNED_DESKTOP: &[(&str, usize, &[&str])] = &[
    ("analytics", 2, &["ANALYTICS_VIEW"]),
    ("audit", 7, &["AUDIT_EXPORT", "AUDIT_VIEW"]),
    ("auth", 1, &["OPERATOR_IMPERSONATE"]),
    // Pinned at their measured shape (the test compares through a BTreeMap, so the
    // row order is not load-bearing): avatars gained a STAFF_UPDATE gate and
    // desktop_link gates nothing yet, both without a census update.
    ("avatars", 1, &["STAFF_UPDATE"]),
    ("desktop_link", 0, &[]),
    ("branding", 5, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    ("browser", 0, &[]),
    // 1 gate call with SETTINGS_READ, absent from the pin. A REAL unpinned gate: the
    // one-click diagnostic archive export (bf8e004f9) resolves the session and then
    // requires SETTINGS_READ in the bridge, so this row reviews a live permission.
    ("diagnostics", 1, &["SETTINGS_READ"]),
    // Pinned at its measured shape, the same call the comment above records:
    // `build_integrity.rs` gates nothing yet, and the census walks every
    // non-skipped .rs in the directory, so an added module is a row.
    ("build_integrity", 0, &[]),
    (
        "bundles",
        6,
        &[
            "PRODUCTS_CREATE",
            "PRODUCTS_DELETE",
            "PRODUCTS_READ",
            "PRODUCTS_UPDATE",
        ],
    ),
    (
        "categories",
        4,
        &[
            "PRODUCTS_CREATE",
            "PRODUCTS_DELETE",
            "PRODUCTS_READ",
            "PRODUCTS_UPDATE",
        ],
    ),
    ("currencies", 0, &[]),
    ("currency", 7, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    (
        "customers",
        10,
        &[
            "CUSTOMERS_CREATE",
            "CUSTOMERS_DELETE",
            "CUSTOMERS_EDIT",
            "CUSTOMERS_VIEW",
        ],
    ),
    // Re-pinned 2026-09-23 (was 6): 9b551e76b added the restore-candidate
    // gate require_session_permission(..., SETTINGS_EDIT) in
    // kasirmu-bridge/src/data.rs and did not bump this row. The key was
    // already pinned, so only the count moved.
    //
    // Re-pinned for C8 S5a (7 -> 10, keys gain SETTINGS_READ): the three restore
    // IPC commands are now registered in apps/desktop-tauri/src/lib.rs and gated
    // in apps/desktop-tauri/src/commands/data.rs. `restore_prepare` requires
    // SETTINGS_EDIT (it writes <db>.restore-request.json, the file the boot
    // consumer promotes); `list_restore_candidates` and `restore_status` require
    // SETTINGS_READ — the read half of the same family, so seeing that a restore
    // is pending does not confer the right to request one.
    //
    // Note for the next reader: the bridge's own `restore_prepare` enforces
    // SETTINGS_EDIT as well (kasirmu-bridge/src/data.rs:1159), and the two reads
    // take no token there by design. So the wrapper gate is NOT independently
    // observable at runtime — removing it still denies a session without the
    // permission, via the bridge. THIS ROW is what makes the wrapper gate
    // load-bearing: drop it and the count falls to 9 and this pin goes red.
    (
        "data",
        10,
        &["DATA_EXPORT", "SETTINGS_EDIT", "SETTINGS_READ"],
    ),
    // 2026-09-29: the multi-terminal CRUD commands landed in
    // crates/kasirmu-bridge/src/edc.rs (8d3222d37) and the e-faktur stamping
    // pair in history (7e2ddcbe5); neither commit moved these pins. Re-measured
    // from source, not from the red message: 8 gate calls at edc.rs:336,:359,
    // :380,:401,:405,:432,:476,:520, carrying the 5 keys below. The three
    // SALES_* keys are the pre-existing tender path; SETTINGS_READ/SETTINGS_EDIT
    // are the terminal CRUD, which is why the read/write pair appears together.
    (
        // 8 -> 11 in 656f109a0 "feat(edc): add invoice reference, batch settlement,
        // and transaction inquiry", which added three gated commands. The KEY SET
        // did not move -- the new commands reuse the tender path's permissions --
        // which is exactly what the census reports (count row only, no keys row).
        "edc",
        11,
        &[
            "SALES_PROCESS",
            "SALES_REFUND",
            "SALES_VOID",
            "SETTINGS_EDIT",
            "SETTINGS_READ",
        ],
    ),
    ("email", 3, &["REPORTS_SCHEDULE", "SETTINGS_EDIT"]),
    ("exchange_rates", 0, &[]),
    ("features", 2, &["SETTINGS_EDIT"]),
    // 5 -> 7 and two SALES_* keys in 859d5d44b "feat(bridge,apps): expose
    // issue_tax_invoice_scoped and statutory_number IPC commands". The move is
    // documented IN THE SOURCE, not inferred from the subject: each new command's
    // own doc comment states its gate ("Gated by `sales:process`.", "…`sales:view`."),
    // so the family change is declared intent rather than a copied permission.
    (
        "fiscal",
        7,
        &[
            "SALES_PROCESS",
            "SALES_VIEW",
            "SETTINGS_EDIT",
            "SETTINGS_READ",
        ],
    ),
    (
        "gift_cards",
        8,
        &["GIFTCARDS_ISSUE", "GIFTCARDS_MANAGE", "GIFTCARDS_REDEEM"],
    ),
    ("hardware", 1, &["PAYMENTS_CASH"]),
    ("health", 0, &[]),
    // 2026-09-29: re-measured alongside the edc row. history.rs carries 7 gate
    // calls now (:73,:187,:262,:281,:303,:324,:382) — the two SALES_PROCESS
    // entries at :262/:281 are the e-faktur stamping pair added by 7e2ddcbe5.
    (
        "history",
        7,
        &["REPORTS_EXPORT", "SALES_PROCESS", "SALES_VIEW"],
    ),
    (
        "inventory",
        25,
        &[
            "INVENTORY_LOCATIONS_MANAGE",
            "INVENTORY_VIEW",
            "SALES_PROCESS",
        ],
    ),
    ("inventory_counts", 10, &["INVENTORY_COUNT"]),
    ("kds", 9, &["KDS_UPDATE", "KDS_VIEW"]),
    ("kds_device", 6, &["KDS_UPDATE", "KDS_VIEW"]),
    ("kds_routing", 3, &["KDS_UPDATE", "KDS_VIEW"]),
    ("legal_entities", 4, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    ("license", 3, &["SETTINGS_EDIT"]),
    ("local_api", 6, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    // 3 -> 7 at a5212ca5f ("persist payment gateways with at-rest encryption"), which
    // registered four payment_gateways commands on this module: get / list / set /
    // delete gateway config. The KEY SET is unchanged - the pin's SETTINGS_EDIT +
    // SETTINGS_READ already covers all seven, and the census confirmed the keys
    // matched while only the count drifted. So this is a count update for newly gated
    // commands, not a widening of what the module may touch: nothing here became
    // reachable that the previous three were not.
    //
    // The gate call is deliberately NOT re-derived. That is what this row is FOR: the
    // census read the source and found the drift, so the pin moved to meet it and a
    // reviewer can see those four commands in a5212ca5f rather than take this on faith.
    ("local_payment", 7, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    ("locations", 13, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    (
        "loyalty",
        8,
        &[
            "LOYALTY_EARN",
            "LOYALTY_MANAGE",
            "LOYALTY_REDEEM",
            "LOYALTY_VIEW",
        ],
    ),
    ("memo", 5, &["MEMO_STOP", "MEMO_WRITE"]),
    // 4 -> 5 in fd4a0ff6e "feat(sync): add dead_letter_count to PgDaemonStatus and
    // gate list_remote_failures_scoped" -- one newly gated command, same key.
    ("offline", 5, &["SYNC_MANAGE"]),
    (
        "payables",
        4,
        &[
            "PAYABLES_CREATE",
            "PAYABLES_SETTLE",
            "PAYABLES_VIEW",
            "PAYABLES_WRITEOFF",
        ],
    ),
    ("picker", 0, &[]),
    ("picker_ticket", 0, &[]),
    // No `plugins` row: `44e7be9cd` deleted
    // `apps/desktop-tauri/src/commands/plugins.rs` — a two-line placeholder
    // carrying no `#[tauri::command]` and no gate call — together with its
    // `pub mod plugins;` declaration. `assert_pin` fails a pinned row with no
    // module on disk ("absent"), so the row outlived its module and this test
    // was red until it was retired here. The census walks `src/commands`, so
    // a future plugin module reappears as an unpinned row and must be re-pinned
    // deliberately rather than silently inherited.
    // Re-pinned 2026-09-23 (was 17): 1b7bd2466 added the plugin-discount
    // gate require_session_permission(..., SALES_DISCOUNT) in
    // kasirmu-bridge/src/pos.rs and did not bump this row. The key was
    // already pinned, so only the count moved. The tablet row below stays at
    // 17: its census scans apps/mobile-tauri only, not the bridge.
    (
        "pos",
        18,
        &["SALES_DISCOUNT", "SALES_OVERRIDE_PRICE", "SALES_PROCESS"],
    ),
    (
        "product_variants",
        5,
        &[
            "PRODUCTS_CREATE",
            "PRODUCTS_DELETE",
            "PRODUCTS_READ",
            "PRODUCTS_UPDATE",
        ],
    ),
    (
        "products",
        10,
        &[
            "INVENTORY_ADJUST",
            "PRODUCTS_CREATE",
            "PRODUCTS_DELETE",
            "PRODUCTS_EDIT_COST",
            "PRODUCTS_READ",
            "PRODUCTS_UPDATE",
        ],
    ),
    ("products_images", 3, &["PRODUCTS_READ", "PRODUCTS_UPDATE"]),
    (
        "promotions",
        4,
        &[
            "PROMOTIONS_APPLY",
            "PROMOTIONS_CREATE",
            "PROMOTIONS_DELETE",
            "PROMOTIONS_EDIT",
        ],
    ),
    ("purchasing", 10, &["PURCHASING_MANAGE", "PURCHASING_VIEW"]),
    // The QRIS auto-rail command gates with SALES_PROCESS (3d50b3ac5/903b30a71);
    // row added at the round-14 review, count measured from source.
    ("qris_auto", 1, &["SALES_PROCESS"]),
    ("receipt_format", 5, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    ("refunds", 3, &["SALES_PROCESS", "SALES_REFUND"]),
    // 4 -> 5 in d635b58f0 "feat(regional): register get_active_market_profile_scoped
    // Tauri command" -- the command the subject names, gated on the existing pair.
    ("regional", 5, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    // The measured debt ledger is a .rs under src/commands, so the census walks it. It
    // names no gate and no permission (6c574ee07 landed it): that is a row to record,
    // not a file to skip - adding the stem to `skip` would stop ever looking at it.
    ("registration_gate_debt.generated", 0, &[]),
    ("reports", 1, &["REPORTS_EXPORT", "REPORTS_VIEW"]),
    ("scale", 0, &[]),
    ("security", 2, &["SECURITY_MANAGE"]),
    (
        "settings",
        15,
        &["SALES_VIEW", "SETTINGS_EDIT", "SETTINGS_READ"],
    ),
    ("setup", 1, &["STAFF_MANAGE_ROLES"]),
    (
        "shifts",
        6,
        &[
            "PAYMENTS_CASH",
            "SHIFTS_CLOSE",
            "SHIFTS_OPEN",
            "SHIFTS_VIEW_ANY",
        ],
    ),
    // Re-pinned 22-09-26 for the staff/role trash: five scoped commands moved this
    // stem from (11, four keys) to (16, six). Three of the calls are
    // `require_permission_for_user(.., STAFF_DELETE)` on delete/restore/list-trash,
    // two are `require_session_permission(.., STAFF_MANAGE_ROLES)` on the role trash,
    // and STAFF_DELETE is a new key for this row. STAFF_READ_IDENTITY was already
    // measured in the bridge's `update_staff_scoped` (the caller-aware profile
    // write) and had never been added here — this pass absorbs it rather than
    // leaving a known-stale row beside the edited one.
    (
        "staff",
        16,
        &[
            "STAFF_CREATE",
            "STAFF_DELETE",
            "STAFF_MANAGE_ROLES",
            "STAFF_READ",
            "STAFF_READ_IDENTITY",
            "STAFF_UPDATE",
        ],
    ),
    ("stock_transfers", 10, &["INVENTORY_TRANSFER"]),
    (
        "subscription",
        3,
        &[
            "ANALYTICS_VIEW",
            "INVENTORY_LOCATIONS_MANAGE",
            "LOYALTY_VIEW",
            "REPORTS_VIEW",
            "SALES_PROCESS",
            "SALES_VIEW",
            "SETTINGS_READ",
            "STAFF_CREATE",
            "SYNC_MANAGE",
            "TOPOLOGY_WRITE",
        ],
    ),
    ("sync", 12, &["SYNC_MANAGE"]),
    // Pinned at its measured shape: the sync test pins module declares the
    // gates the sync tests drive, but carries no gate CALL of its own, so the
    // census reads 0 from it. It is a row because the census walks every
    // non-skipped .rs in the directory -- an added module is a row, gated or not.
    ("sync_test_pins", 0, &[]),
    (
        "tables",
        6,
        &[
            "TABLES_ASSIGN",
            "TABLES_CLOSE",
            "TABLES_CREATE",
            "TABLES_DELETE",
            "TABLES_EDIT",
        ],
    ),
    ("tax", 8, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    (
        "terminals",
        // 17 -> 16: one gate call left the module, so the pin moved down with it.
        // The pin is a census, not a floor -- a removal has to be recorded the same
        // way an addition does, or the row stops describing the source.
        16,
        &[
            "TERMINALS_DELETE",
            "TERMINALS_EDIT",
            "TERMINALS_READ",
            "TERMINALS_REGISTER",
        ],
    ),
    ("topology", 6, &["AUDIT_VIEW", "TOPOLOGY_WRITE"]),
    ("void", 1, &["SALES_VOID"]),
    (
        "workspaces",
        8,
        &["STAFF_READ", "STAFF_UPDATE", "WORKSPACES_SWITCH"],
    ),
];

// ---------------------------------------------------------------------------
// Pinned census — tablet client.
// ---------------------------------------------------------------------------
static PINNED_TABLET: &[(&str, usize, &[&str])] = &[
    ("analytics", 0, &[]),
    ("audit", 0, &[]),
    ("auth", 1, &["OPERATOR_IMPERSONATE"]),
    ("avatars", 0, &[]),
    ("branding", 0, &[]),
    // ADR #36/#37/#38 opener browser plugin: no permission-gated commands.
    ("browser", 0, &[]),
    ("bundles", 0, &[]),
    // 2026-09-29: re-measured. The tablet categories module carries 3 gate calls
    // (:141 PRODUCTS_CREATE, :192 PRODUCTS_UPDATE, :240 PRODUCTS_DELETE) — the
    // count was pinned at 1 while the three write doors were already there.
    // PRODUCTS_READ is deliberately NOT a key here: the only occurrence is the
    // prose at :266, which the census skips (it cuts comments before collecting),
    // so adding it would pin a name no gate call carries.
    (
        "categories",
        3,
        &["PRODUCTS_CREATE", "PRODUCTS_DELETE", "PRODUCTS_UPDATE"],
    ),
    ("currencies", 3, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    (
        "customers",
        1,
        &[
            "CUSTOMERS_CREATE",
            "CUSTOMERS_DELETE",
            "CUSTOMERS_EDIT",
            "CUSTOMERS_VIEW",
        ],
    ),
    // Pinned at their measured (0 calls, no keys), same call as setting-
    // up a module: the census walks every non-skipped .rs in the commands
    // dir, so an added module is a row even when it gates nothing.
    ("data", 0, &[]),
    ("desktop_link", 0, &[]),
    ("edc", 0, &[]),
    ("exchange_rates", 5, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    ("features", 2, &["SETTINGS_EDIT"]),
    // STAYS 0, and the reason is worth recording because the desktop row reads 7.
    // The tablet census has ONE root (its own src/commands) and no bridge root, so
    // it never sees the gates: the desktop row is 0 from the shell PLUS 7 from
    // `crates/kasirmu-bridge/src/fiscal.rs`, which is where the two commands added in
    // 859d5d44b actually gate. The tablet's new commands exist and delegate to the
    // same bridge, but the bridge root is not part of the tablet census.
    ("fiscal", 0, &[]),
    ("gift_cards", 0, &[]),
    // Exists on disk and gates NOTHING: registered for tablet parity in 6fe57ba17
    // ("register shifts, inventory, kds, edc, locations, and pin commands for
    // tablet parity"). Pinned as `0, &[]` so its absence is recorded rather than
    // inferred -- a zero-call module is ungated by construction, per this file's
    // header, so there is no unreviewed gate here, only a missing expectation.
    ("inventory", 1, &[]),
    ("hardware", 0, &[]),
    ("health", 0, &[]),
    // Re-pinned 13-09-26: 3a15dafe8 put a real permission check in the five
    // scoped history twins. Re-measured 2026-09-29: 7 gate calls —
    // :320,:364 (SALES_VIEW), :400,:420,:440 (REPORTS_EXPORT) and the two
    // e-faktur stamping doors at :512,:535 (SALES_PROCESS, added with the
    // desktop pair). The earlier pin of 5 predates those two.
    // history_tests.rs is skipped by stem, so 268198aba contributes nothing here.
    (
        "history",
        7,
        &["REPORTS_EXPORT", "SALES_PROCESS", "SALES_VIEW"],
    ),
    ("inventory_counts", 1, &["INVENTORY_COUNT"]),
    // Registered for tablet parity in 6fe57ba17 ("register shifts, inventory, kds,
    // edc, locations, and pin commands for tablet parity"). Exists on disk and gates
    // NOTHING -- a zero-call module is ungated by construction, so this pin records
    // an expectation rather than reviewing a gate.
    ("kds_device", 0, &[]),
    ("kds_routing", 0, &[]),
    ("kds", 1, &["KDS_UPDATE"]),
    ("legal_entities", 0, &[]),
    // Both walk into the census ungated and unpinned: the tablet's license.rs and
    // locations.rs hold no permission-gated command of their own (the bodies gate in
    // kasirmu-bridge), and the census walks every non-skipped .rs in the directory.
    ("license", 0, &[]),
    ("locations", 0, &[]),
    ("local_payment", 1, &["SETTINGS_EDIT"]),
    ("loyalty", 0, &[]),
    ("memo", 0, &[]),
    // 3 -> 4 by the same fd4a0ff6e as the desktop row: the module is parity-shared.
    ("offline", 4, &["SYNC_MANAGE"]),
    ("picker_ticket", 0, &[]),
    (
        "pos",
        17,
        &["SALES_DISCOUNT", "SALES_OVERRIDE_PRICE", "SALES_PROCESS"],
    ),
    (
        "product_variants",
        2,
        &["PRODUCTS_CREATE", "PRODUCTS_UPDATE"],
    ),
    (
        "products",
        5,
        &[
            "PRODUCTS_CREATE",
            "PRODUCTS_DELETE",
            "PRODUCTS_EDIT_COST",
            "PRODUCTS_UPDATE",
        ],
    ),
    ("products_images", 0, &[]),
    (
        "promotions",
        4,
        &[
            "PROMOTIONS_APPLY",
            "PROMOTIONS_CREATE",
            "PROMOTIONS_DELETE",
            "PROMOTIONS_EDIT",
        ],
    ),
    ("purchasing", 0, &[]),
    // Tablet mirrors the QRIS auto-rail landing with two gated calls; same
    // key, reviewed at the round-14 census repair.
    ("qris_auto", 2, &["SALES_PROCESS"]),
    ("receipt_format", 2, &["SETTINGS_EDIT"]),
    ("refunds", 3, &["SALES_PROCESS", "SALES_REFUND"]),
    // 2 -> 3 by the same d635b58f0 as the desktop row.
    ("regional", 3, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    // Same as the desktop leg: the tablet ledger landed in 3c793f8e3 and the census
    // walks every non-skipped .rs in the commands dir. Pinned at its measured
    // (0 calls, no keys) rather than skipped out of existence.
    ("registration_gate_debt.generated", 0, &[]),
    ("reports", 0, &[]),
    ("scale", 0, &[]),
    (
        "settings",
        15,
        &["SALES_VIEW", "SETTINGS_EDIT", "SETTINGS_READ"],
    ),
    ("setup", 0, &[]),
    ("shifts", 0, &[]),
    // STAFF_READ_IDENTITY joined this row at 22-09-26: the tablet's shim measures it
    // without the count moving, because the census counts CALLS and the key set is
    // collected per call. Pinned at the measured pair rather than trimmed.
    ("staff", 1, &["STAFF_READ_IDENTITY", "STAFF_UPDATE"]),
    ("stock_transfers", 0, &[]),
    (
        "subscription",
        3,
        &[
            "ANALYTICS_VIEW",
            "INVENTORY_LOCATIONS_MANAGE",
            "LOYALTY_VIEW",
            "REPORTS_VIEW",
            "SALES_PROCESS",
            "SALES_VIEW",
            "SETTINGS_READ",
            "STAFF_CREATE",
            "SYNC_MANAGE",
            "TOPOLOGY_WRITE",
        ],
    ),
    ("sync", 9, &["SYNC_MANAGE"]),
    (
        "tables",
        6,
        &[
            "TABLES_ASSIGN",
            "TABLES_CLOSE",
            "TABLES_CREATE",
            "TABLES_DELETE",
            "TABLES_EDIT",
        ],
    ),
    // 2026-09-29: re-measured. The tablet tax module carries 8 gate calls
    // (:96,:346,:372,:446 SETTINGS_READ and :141,:230,:314,:412 SETTINGS_EDIT);
    // the count was pinned at 1, which matched neither the reads nor the writes.
    ("tax", 8, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    ("testing", 0, &[]),
    // 3 gate calls with settings keys, absent from the pin. A REAL unpinned gate:
    // unlike the zero-call rows above, this module enforces permissions no pin row
    // reviews.
    ("updater", 3, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    (
        "terminals",
        10,
        &[
            "TERMINALS_DELETE",
            "TERMINALS_EDIT",
            "TERMINALS_READ",
            "TERMINALS_REGISTER",
        ],
    ),
    ("void", 1, &["SALES_VOID"]),
    ("workspaces", 0, &[]),
];

/// Remove every `#[cfg(test)] { ... }` block from a source file, wherever it
/// appears (some modules interleave production commands after their tests).
fn strip_test_blocks(src: &str) -> String {
    const MARKER: &str = "#[cfg(test)]";
    let mut out = String::new();
    let mut rest = src;
    while let Some(idx) = rest.find(MARKER) {
        out.push_str(&rest[..idx]);
        let mut j = idx + MARKER.len();
        let bytes = rest.as_bytes();
        while j < bytes.len() && (bytes[j] as char).is_whitespace() {
            j += 1;
        }
        if j < bytes.len() && bytes[j] == b'{' {
            let mut depth = 0usize;
            let mut k = j;
            while k < bytes.len() {
                match bytes[k] {
                    b'{' => depth += 1,
                    b'}' => {
                        depth -= 1;
                        if depth == 0 {
                            k += 1;
                            break;
                        }
                    }
                    _ => {}
                }
                k += 1;
            }
            rest = &rest[k.min(rest.len())..];
        } else {
            rest = &rest[idx + MARKER.len()..];
        }
    }
    out.push_str(rest);
    out
}

/// Is this line *defining* a gate wrapper rather than calling one?
///
/// A client shell keeps its wrappers in `authz.rs` (skipped wholesale), but
/// `kasirmu-bridge` defines its thin wrappers inside the same module that calls
/// them, so the definition line has to be told apart from a call site.
fn is_wrapper_definition(line: &str) -> bool {
    let mut rest = line;
    while let Some(i) = rest.find("fn require_") {
        // `fn require_x(` at the start of the remainder, or preceded only by
        // qualifiers (`pub`, `async`, `unsafe`, visibility), is a definition.
        let before = line[..i].trim_end();
        if before.is_empty()
            || before.ends_with("fn")
            || before.ends_with("async")
            || before.ends_with("unsafe")
            || before.ends_with("pub")
            || before.ends_with("crate")
            || before.ends_with("super")
            || before.ends_with("pub(crate)")
            || before.ends_with("pub(super)")
        {
            return true;
        }
        rest = &rest[i + 3..];
    }
    false
}

/// Gate entry points counted in a client shell's `src/commands`: the
/// `authz.rs` wrappers. `authz.rs` itself is skipped, so a hit is always a
/// command asking the gate.
const SHELL_GATES: &[&str] = &[
    "require_permission_for_user(",
    "require_permission_for_session(",
];

/// Gate entry points counted in `crates/kasirmu-bridge/src`. The extraction that
/// moved the command bodies out of the desktop shell moved the gates with
/// them, and renamed them: `BridgeCtx::require_session_permission` and
/// `BridgeCtx::require_permission_for_user` are the bridge's equivalents of
/// the shell's `authz.rs` wrappers, `ctx.rs` (skipped, like `authz.rs`) is
/// where they reach `Store::require_permission`, and each bridge module keeps
/// its own thin wrapper (`require_inventory_permission` and friends) that
/// commands call. A line that *defines* a wrapper is not a call site, so
/// definition lines are skipped; a command that calls the store gate
/// directly is counted by the `.require_permission(&` form, which never
/// matches a wrapper body (those pass the bare `user_id` parameter).
const BRIDGE_GATES: &[&str] = &[
    "require_session_permission(",
    "require_permission_for_user(",
    "require_permission_for_session(",
    "require_user_permission_scoped(",
    "require_permission_for_session_resource(",
    "require_session_resource_permission(",
    "require_inventory_permission(",
    "require_inventory_count_permission(",
    "require_customer_permission(",
    "require_category_permission(",
    "require_tax_permission(",
    "require_loyalty_permission(",
    "require_audit_permission(",
    ".require_permission(&",
];

// `require_audit_tier(` (bridge audit/auth, tablet audit) is deliberately not
// counted in either vocabulary: it is a subscription-tier/plan check on the
// entitlement read model, not a permission gate — it never consults the 0046
// registry, so it stays out of this census. Enumerating `require_` names and
// adding it to the lists above would reach the opposite conclusion.

/// The gate census for one module: `(gate_call_count, sorted_keys)`.
///
/// Mirrors the generator that produced the pins: comments and `use` lines
/// are skipped, inline `//` comments are cut, every call start named in
/// `gates` is counted, and every `permissions::KEY` token is collected.
fn census(src: &str, gates: &[&str]) -> (usize, Vec<String>) {
    let mut calls = 0usize;
    let mut keys = std::collections::BTreeSet::new();
    for raw in src.lines() {
        let trimmed = raw.trim_start();
        if trimmed.is_empty() || trimmed.starts_with("//") || trimmed.starts_with("use ") {
            continue;
        }
        let line = match trimmed.find("//") {
            Some(i) => &trimmed[..i],
            None => trimmed,
        };
        if !is_wrapper_definition(line) {
            for gate in gates {
                calls += line.matches(gate).count();
            }
        }
        let mut rest = line;
        while let Some(i) = rest.find("permissions::") {
            let after = &rest[i + "permissions::".len()..];
            let name: String = after
                .chars()
                .take_while(|c| c.is_ascii_uppercase() || *c == '_')
                .collect();
            if !name.is_empty() {
                keys.insert(name);
            }
            rest = after;
        }
    }
    (calls, keys.into_iter().collect())
}

/// Raw string-literal permissions passed to a gate call named in `gates` (e.g.
/// `"sales:typo"`). The gate denies these fail-closed, but a live command
/// would break, so they are pinned out of existence.
fn raw_permission_literals(src: &str, gates: &[&str]) -> Vec<String> {
    let mut bad = Vec::new();
    for raw in src.lines() {
        let trimmed = raw.trim_start();
        if trimmed.is_empty() || trimmed.starts_with("//") || trimmed.starts_with("use ") {
            continue;
        }
        if !gates.iter().any(|g| trimmed.contains(*g)) {
            continue;
        }
        let mut rest = trimmed;
        while let Some(q) = rest.find('"') {
            rest = &rest[q + 1..];
            if let Some(end) = rest.find('"') {
                let s = &rest[..end];
                if s.contains(':') {
                    bad.push(s.to_string());
                }
                rest = &rest[end + 1..];
            } else {
                break;
            }
        }
    }
    bad
}

/// Census one module: `.rs` files are counted directly; a subdirectory
/// (split modules like `topology/`) is aggregated under its directory name
/// so the pin tracks the *module's* permission surface wherever its files
/// live. `calls` sums across files; `keys` unions.
fn census_file(path: &Path, gates: &[&str]) -> (usize, Vec<String>) {
    let src = fs::read_to_string(path).expect("read command file");
    let stripped = strip_test_blocks(&src);
    let raw = raw_permission_literals(&stripped, gates);
    let label = path.to_string_lossy().into_owned();
    assert!(
        raw.is_empty(),
        "{label} passes raw string-literal permissions to the gate: {raw:?}"
    );
    census(&stripped, gates)
}

fn census_dir(dir: &Path, gates: &[&str], skip: &[&str]) -> BTreeMap<String, (usize, Vec<String>)> {
    let mut out: BTreeMap<String, (usize, Vec<String>)> = BTreeMap::new();
    for entry in fs::read_dir(dir).expect("read commands dir") {
        let entry = entry.expect("dir entry");
        let path = entry.path();
        let file_type = entry.file_type().expect("dir entry type");
        let stem = path
            .file_stem()
            .expect("file stem")
            .to_string_lossy()
            .into_owned();
        if file_type.is_dir() {
            let (dir_calls, dir_keys) = census_dir(&path, gates, skip)
                .into_values()
                .reduce(|a, b| {
                    (a.0 + b.0, {
                        let mut keys = a.1;
                        keys.extend(b.1);
                        keys.sort();
                        keys.dedup();
                        keys
                    })
                })
                .unwrap_or((0, Vec::new()));
            // A split module can keep a same-named root file (e.g. the thin
            // `topology.rs` beside `topology/`): sum it in rather than let
            // read_dir order decide which entry wins.
            match out.get_mut(&stem) {
                Some((calls, keys)) => {
                    *calls += dir_calls;
                    keys.extend(dir_keys);
                    keys.sort();
                    keys.dedup();
                }
                None => {
                    out.insert(stem, (dir_calls, dir_keys));
                }
            }
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        // Skip split test files and excluded modules.
        if stem == "authz"
            || stem == "mod"
            || stem.ends_with("_tests")
            || skip.contains(&stem.as_str())
        {
            continue;
        }
        let (file_calls, file_keys) = census_file(&path, gates);
        match out.get_mut(&stem) {
            Some((calls, keys)) => {
                *calls += file_calls;
                keys.extend(file_keys);
                keys.sort();
                keys.dedup();
            }
            None => {
                out.insert(stem, (file_calls, file_keys));
            }
        }
    }
    out
}

/// One census root: a directory plus the gate vocabulary that applies there.
struct Root<'a> {
    dir: PathBuf,
    gates: &'a [&'a str],
    /// Non-command support files to skip (the crate's `authz.rs` equivalent).
    skip: &'a [&'a str],
}

/// The four drift classes, as row strings — pure, so it can be tested on
/// synthetic input.
///
/// EXTRACTED from `assert_pin` so the classification is reachable without a
/// filesystem. Everything here is a decision about a (pin, source) PAIR, and
/// all four classes matter for different reasons:
///
/// - `absent`: the pin names a module that no longer exists. A deregistered
///   command leaves this row behind, and a stale exemption outliving its
///   command protects nothing.
/// - `count`: the module gained or lost gate CALLS.
/// - `keys`: the permission SET moved, which is behavioural -- a module that
///   now asks for a different permission is doing a different job.
/// - `unpinned`: a module gates permissions but appears in no row at all, so
///   nothing is reviewing it. This is the class the live drift reports most
///   often (`diagnostics`, `inventory`, `kds_device`, `kds_routing`).
///
/// Rows are collected, never short-circuited: the caller asserts on the whole
/// table because one row at a time turns a fifty-row drift into a queue.
fn diff_rows(
    actual: &BTreeMap<String, (usize, Vec<String>)>,
    pinned: &[(&str, usize, &[&str])],
) -> Vec<String> {
    let mut rows: Vec<String> = Vec::new();
    for (stem, exp_calls, exp_keys) in pinned {
        let Some((got_calls, got_keys)) = actual.get(*stem) else {
            rows.push(format!(
                "{stem:<20} absent   pinned, but no module on disk (pin: {exp_calls} gate calls, keys {exp_keys:?})"
            ));
            continue;
        };
        if *exp_calls != *got_calls {
            rows.push(format!(
                "{stem:<20} count    pin {exp_calls}, source {got_calls}"
            ));
        }
        let got: Vec<&str> = got_keys.iter().map(String::as_str).collect();
        if *exp_keys != &got[..] {
            rows.push(format!(
                "{stem:<20} keys     pin {exp_keys:?}, source {got:?}"
            ));
        }
    }
    for stem in actual.keys() {
        if !pinned.iter().any(|(s, _, _)| s == stem) {
            let (calls, keys) = &actual[stem];
            // TWO DIFFERENT FACTS, and the earlier single wording was false for one
            // of them. A module with gate calls is real debt: it enforces
            // permissions that no pin row reviews. A module with NO gate calls is
            // "ungated by construction" in this file's own words, and its absence
            // from the pin means only that nobody wrote the expected `0, &[]` row --
            // which is bookkeeping, not an unreviewed gate. Reporting both as
            // "gates permissions on disk" overstated the second: four of the
            // tablet rows currently read that way while carrying zero calls and
            // zero keys. Split because the reader's next action differs -- add a
            // gate to the review, versus record an expectation that will never
            // change.
            if *calls == 0 && keys.is_empty() {
                rows.push(format!(
                    "{stem:<20} unmapped module has no gate calls and is absent from the \
                     pinned census; add it as `0, &[]` so the absence is recorded rather \
                     than inferred"
                ));
            } else {
                rows.push(format!(
                    "{stem:<20} unpinned gates permissions on disk but is NOT in the pinned \
                     census (source: {calls} gate calls, keys {keys:?})"
                ));
            }
        }
    }
    rows
}

/// Compare the merged two-root census against the pin, and report EVERY
/// drifted row in one failure.
///
/// A pinned census is only worth what it shows when it breaks: an assertion
/// that panics on the first mismatch turns a fifty-row drift into a one-row
/// report and queues the rest behind repeated reruns. Count drift, key-set
/// drift, a pinned row with no module on disk, and a gating module missing
/// from the pin are all collected first, then reported together as one table.
fn assert_pin(roots: &[Root], pinned: &[(&str, usize, &[&str])]) {
    let mut actual: BTreeMap<String, (usize, Vec<String>)> = BTreeMap::new();
    for root in roots {
        for (stem, (calls, keys)) in census_dir(&root.dir, root.gates, root.skip) {
            match actual.get_mut(&stem) {
                Some((c, k)) => {
                    *c += calls;
                    k.extend(keys);
                    k.sort();
                    k.dedup();
                }
                None => {
                    actual.insert(stem, (calls, keys));
                }
            }
        }
    }

    let rows = diff_rows(&actual, pinned);

    assert!(
        rows.is_empty(),
        "gate-census drift: {} of {} pinned rows disagree. Update every pin deliberately — \
         the full set is the review signal.\n  {:<20} {}\n{}",
        rows.len(),
        pinned.len(),
        "module",
        "drift",
        rows.into_iter()
            .map(|r| format!("  {r}"))
            .collect::<Vec<_>>()
            .join("\n"),
    );
}

#[test]
fn desktop_command_census_matches_pin() {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    // The desktop path is the shell *plus* the crate the shell delegates to:
    // Wave A-E moved the command bodies (and their gate calls) into
    // `kasirmu-bridge`, so the shell alone no longer measures anything.
    assert_pin(
        &[
            Root {
                dir: manifest.join("src/commands"),
                gates: SHELL_GATES,
                skip: &[],
            },
            Root {
                dir: manifest.join("../../crates/kasirmu-bridge/src"),
                gates: BRIDGE_GATES,
                skip: &["ctx", "lib", "error", "testing"],
            },
        ],
        PINNED_DESKTOP,
    );
}

#[test]
fn tablet_command_census_matches_pin() {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    // Tablet still owns its command bodies, so its shell is the whole path.
    assert_pin(
        &[Root {
            dir: manifest.join("../mobile-tauri/src/commands"),
            gates: SHELL_GATES,
            skip: &[],
        }],
        PINNED_TABLET,
    );
}

/// Resolve a census constant *name* to its permission *value*.
///
/// The census extracts constant names (`permissions::AUDIT_EXPORT`), while
/// the registry keyed by values (`"audit:export"`). Resolving through the
/// real constants keeps this honest: renaming a constant breaks the match
/// arm here, forcing the census to be updated deliberately.
fn permission_value(name: &str) -> &'static str {
    use kasirmu_core::permissions as p;
    match name {
        "ANALYTICS_VIEW" => p::ANALYTICS_VIEW,
        "AUDIT_EXPORT" => p::AUDIT_EXPORT,
        "AUDIT_VIEW" => p::AUDIT_VIEW,
        "CUSTOMERS_CREATE" => p::CUSTOMERS_CREATE,
        "CUSTOMERS_DELETE" => p::CUSTOMERS_DELETE,
        "CUSTOMERS_EDIT" => p::CUSTOMERS_EDIT,
        "CUSTOMERS_VIEW" => p::CUSTOMERS_VIEW,
        "DATA_EXPORT" => p::DATA_EXPORT,
        "GIFTCARDS_ISSUE" => p::GIFTCARDS_ISSUE,
        "GIFTCARDS_MANAGE" => p::GIFTCARDS_MANAGE,
        "GIFTCARDS_REDEEM" => p::GIFTCARDS_REDEEM,
        "INVENTORY_ADJUST" => p::INVENTORY_ADJUST,
        "INVENTORY_COUNT" => p::INVENTORY_COUNT,
        "INVENTORY_LOCATIONS_MANAGE" => p::INVENTORY_LOCATIONS_MANAGE,
        "INVENTORY_TRANSFER" => p::INVENTORY_TRANSFER,
        "INVENTORY_VIEW" => p::INVENTORY_VIEW,
        "KDS_UPDATE" => p::KDS_UPDATE,
        "KDS_VIEW" => p::KDS_VIEW,
        "LOYALTY_EARN" => p::LOYALTY_EARN,
        "LOYALTY_MANAGE" => p::LOYALTY_MANAGE,
        "LOYALTY_REDEEM" => p::LOYALTY_REDEEM,
        "LOYALTY_VIEW" => p::LOYALTY_VIEW,
        "MEMO_STOP" => p::MEMO_STOP,
        "MEMO_WRITE" => p::MEMO_WRITE,
        "OPERATOR_IMPERSONATE" => p::OPERATOR_IMPERSONATE,
        "PAYABLES_CREATE" => p::PAYABLES_CREATE,
        "PAYABLES_SETTLE" => p::PAYABLES_SETTLE,
        "PAYABLES_VIEW" => p::PAYABLES_VIEW,
        "PAYABLES_WRITEOFF" => p::PAYABLES_WRITEOFF,
        "PAYMENTS_CASH" => p::PAYMENTS_CASH,
        "PRODUCTS_CREATE" => p::PRODUCTS_CREATE,
        "PRODUCTS_DELETE" => p::PRODUCTS_DELETE,
        "PRODUCTS_EDIT_COST" => p::PRODUCTS_EDIT_COST,
        "PRODUCTS_READ" => p::PRODUCTS_READ,
        "PRODUCTS_UPDATE" => p::PRODUCTS_UPDATE,
        "PROMOTIONS_APPLY" => p::PROMOTIONS_APPLY,
        "PROMOTIONS_CREATE" => p::PROMOTIONS_CREATE,
        "PROMOTIONS_DELETE" => p::PROMOTIONS_DELETE,
        "PROMOTIONS_EDIT" => p::PROMOTIONS_EDIT,
        "PURCHASING_MANAGE" => p::PURCHASING_MANAGE,
        "PURCHASING_VIEW" => p::PURCHASING_VIEW,
        "REPORTS_EXPORT" => p::REPORTS_EXPORT,
        "REPORTS_SCHEDULE" => p::REPORTS_SCHEDULE,
        "REPORTS_VIEW" => p::REPORTS_VIEW,
        "SALES_DISCOUNT" => p::SALES_DISCOUNT,
        "SALES_OVERRIDE_PRICE" => p::SALES_OVERRIDE_PRICE,
        "SALES_PROCESS" => p::SALES_PROCESS,
        "SALES_REFUND" => p::SALES_REFUND,
        "SALES_VIEW" => p::SALES_VIEW,
        "SALES_VOID" => p::SALES_VOID,
        "SECURITY_MANAGE" => p::SECURITY_MANAGE,
        "SETTINGS_EDIT" => p::SETTINGS_EDIT,
        "SETTINGS_READ" => p::SETTINGS_READ,
        "SHIFTS_CLOSE" => p::SHIFTS_CLOSE,
        "SHIFTS_OPEN" => p::SHIFTS_OPEN,
        "SHIFTS_VIEW_ANY" => p::SHIFTS_VIEW_ANY,
        "STAFF_CREATE" => p::STAFF_CREATE,
        // Resolved through the real constant on purpose: the trash's delete/restore
        // commands gate on it, so a rename has to break this arm rather than quietly
        // unpin the key.
        "STAFF_DELETE" => p::STAFF_DELETE,
        "STAFF_MANAGE_ROLES" => p::STAFF_MANAGE_ROLES,
        "STAFF_READ" => p::STAFF_READ,
        // Measured in the bridge's caller-aware profile write; it had never been
        // resolved here, so the key set was carrying a name nothing could check.
        "STAFF_READ_IDENTITY" => p::STAFF_READ_IDENTITY,
        "STAFF_UPDATE" => p::STAFF_UPDATE,
        "SYNC_MANAGE" => p::SYNC_MANAGE,
        "TABLES_ASSIGN" => p::TABLES_ASSIGN,
        "TABLES_CLOSE" => p::TABLES_CLOSE,
        "TABLES_CREATE" => p::TABLES_CREATE,
        "TABLES_DELETE" => p::TABLES_DELETE,
        "TABLES_EDIT" => p::TABLES_EDIT,
        "TOPOLOGY_WRITE" => p::TOPOLOGY_WRITE,
        "TERMINALS_DELETE" => p::TERMINALS_DELETE,
        "TERMINALS_EDIT" => p::TERMINALS_EDIT,
        "TERMINALS_READ" => p::TERMINALS_READ,
        "TERMINALS_REGISTER" => p::TERMINALS_REGISTER,
        "WORKSPACES_SWITCH" => p::WORKSPACES_SWITCH,
        other => panic!(
            "census key `{other}` has no resolve arm — add it to permission_value() \
             deliberately, referencing the real constant"
        ),
    }
}

/// Every permission key used at a gate call site must be registered in the
/// 0046 registry — the same registry the gate's deny-by-default consults. An
/// unregistered key at a live call site would fail closed for every role,
/// including the `*` owner, silently breaking the command.
#[test]
fn all_gated_permission_keys_are_registered() {
    for (_, _, keys) in PINNED_DESKTOP.iter().chain(PINNED_TABLET) {
        for key in *keys {
            let value = permission_value(key);
            assert!(
                platform_core::permission_registry::is_registered(value),
                "permission `{value}` (from census key `{key}`) is used at a gate call site \
                 but is not in the 0046 registry — the gate denies it for every role"
            );
        }
    }
}

// ── The census parser's own contract ────────────────────────────────────
//
// WHY THESE EXIST. Everything above asserts a NUMBER against a pin. That
// number comes from `census()`, which strips comments, skips `use` lines,
// discards wrapper DEFINITIONS, and pulls permission keys out of
// `permissions::IDENT`. None of that machinery had a test — the file held
// exactly three, all asserting counts against the pin. So a parser bug and a
// genuine registration drift produce the SAME failure: a count that disagrees
// with the pin. That is the failure mode worth closing, because the pin's whole
// purpose is to be the review signal, and a miscount launders a real drift into
// "the pin is stale" or the reverse.
//
// These cases drive the helpers on SYNTHETIC source, so they cannot be
// satisfied by the current tree's contents and cannot drift with it.

/// A gate CALL is counted; a wrapper DEFINITION is not -- and the definition
/// must match the GATE VOCABULARY for the guard to matter.
///
/// A first draft of this case used a definition named `require_inventory_permission`
/// while matching the vocabulary `require_session_permission(`, and it passed
/// with the guard DISABLED: the definition line happened to contain no gate
/// token, so skipping it changed nothing (found by mutation, not by reading).
/// The load-bearing shape is a definition whose NAME contains a gate spelling --
/// which is exactly the bridge's own layout, where each module keeps a thin
/// `require_<domain>_permission` wrapper beside calls to
/// `require_session_permission`. Without the guard, every such wrapper would be
/// counted as a call site and every module would gain a phantom gate -- the
/// exact shape of an "unpinned gates permissions on disk" row.
#[test]
fn census_counts_a_gate_call_but_not_a_wrapper_definition() {
    // The definition's name carries the vocabularies being counted, AND its body
    // calls one, so both mechanisms are exercised: the tool must skip the
    // definition line and still count the call inside it.
    let vocab = &[
        "require_session_permission(",
        "require_inventory_permission(",
    ];
    let src = "async fn require_inventory_permission(&self, p: Permission) -> Result<(), E> {\n    \
               let x = self.require_session_permission(p, p).await?;\n";
    let (calls, _) = census(src, vocab);
    assert_eq!(
        calls, 1,
        "the DEFINITION line must not count and the call inside the body must; got {calls}"
    );

    // And directly: a bare definition line is zero calls, a bare call line is one.
    let (def_only, _) = census("async fn require_inventory_permission(&self) {}\n", vocab);
    assert_eq!(
        def_only, 0,
        "a definition alone is not a call; got {def_only}"
    );
    let (call_only, _) = census("self.require_inventory_permission(p).await?;\n", vocab);
    assert_eq!(call_only, 1, "a call alone is one call; got {call_only}");
}

/// A commented-out gate call is NOT counted.
///
/// Prose and dead code mention these identifiers constantly -- the module docs
/// in this repo name every wrapper. Counting them would inflate every module
/// that documents its own gate.
#[test]
fn census_ignores_commented_gate_calls() {
    let src = "// ctx.require_session_permission(&s, p).await?;\n\
               let y = 1; // ctx.require_session_permission(&s, p).await?;\n";
    let (calls, _) = census(src, &["require_session_permission("]);
    assert_eq!(calls, 0, "a commented call is not a call; got {calls}");
}

/// A `use` line is skipped, so an imported gate name is not a call.
#[test]
fn census_ignores_use_lines() {
    let src = "use crate::ctx::require_session_permission;\n";
    let (calls, _) = census(src, &["require_session_permission"]);
    assert_eq!(calls, 0, "an import is not a call site; got {calls}");
}

/// Permission keys are collected from `permissions::IDENT`, and only the
/// IDENT part.
///
/// The key list is what `all_gated_permission_keys_are_registered` grades, so a
/// truncated or over-long extraction would silently check the wrong constant.
#[test]
fn census_extracts_permission_keys_from_the_path() {
    let src = "ctx.require_session_permission(&s, permissions::SETTINGS_READ).await?;\n";
    let (_, keys) = census(src, &["require_session_permission("]);
    assert_eq!(
        keys,
        vec!["SETTINGS_READ".to_string()],
        "the key must be the constant with no path left on it; got {keys:?}"
    );
}

/// Several keys on one line all land in the set, deduplicated and ordered.
///
/// `fiscal`'s pin is a KEY LIST, not a count, so a parser that took only the
/// first key would under-report exactly the row the current drift names.
#[test]
fn census_collects_every_key_on_a_line_once_each() {
    let src = "// a comment naming permissions::NOT_A_KEY\n\
               let _ = permissions::SALES_PROCESS;\n\
               let _ = permissions::SETTINGS_READ;\n\
               let _ = permissions::SALES_PROCESS;\n";
    let (_, keys) = census(src, &["require_session_permission("]);
    assert_eq!(
        keys,
        vec!["SALES_PROCESS".to_string(), "SETTINGS_READ".to_string()],
        "keys must be deduplicated and sorted, and a commented one excluded; got {keys:?}"
    );
}

/// A raw string-literal permission at a gate is reported.
///
/// This is the "typo'd permission fails closed for everyone" guard. It is
/// reported rather than counted, so the assertion is on the list contents.
#[test]
fn raw_permission_literals_reports_a_string_literal_argument() {
    let src = "ctx.require_session_permission(&s, \"sales:typo\").await?;\n";
    let bad = raw_permission_literals(src, &["require_session_permission("]);
    assert_eq!(
        bad,
        vec!["sales:typo".to_string()],
        "a literal permission must be reported; got {bad:?}"
    );
}

/// `strip_test_blocks` consumes an INLINE braced `#[cfg(test)] { … }`, which is
/// the only shape its brace walker handles.
///
/// MEASURED, and the measurement corrects an assumption: this branch handles a
/// shape that appears **zero times** in `crates/kasirmu-bridge/src`. All 76
/// `#[cfg(test)]` declarations there are the UNBRACED `#[cfg(test)] #[path = …] mod
/// tests;` form -- a declaration with no body in the file to strip, which is why
/// the else-branch below is the one that actually runs. So this case pins the
/// walker's real behaviour on the shape it was written for, and the next one
/// pins the shape the tree actually uses. Neither is a claim that the brace
/// branch is LOAD-BEARING: test bodies are also excluded by FILENAME, since
/// `census_dir` skips any file whose stem ends in `_tests` (gate_audit.rs:780)
/// before this function is ever called. Recording the redundancy so nobody
/// "removes the dead branch" without knowing what else depends on it.
#[test]
fn strip_test_blocks_consumes_an_inline_braced_cfg_test_block() {
    let src = "fn live() { let _ = Example { a: 1 }; }\n\
               #[cfg(test)]\n{\n    let _ = Example { a: 1 };\n    let _ = Example { b: 2 };\n}\n\
               fn after() { let _ = Example { c: 3 }; }\n";
    let stripped = strip_test_blocks(src);
    assert!(
        !stripped.contains("b: 2"),
        "the inline block's body survived:\n{stripped}"
    );
    assert!(
        stripped.contains("a: 1") && stripped.contains("c: 3"),
        "the walker must return to depth 0 at the block's close and keep the rest:\n{stripped}"
    );
}

/// The UNBRACED form -- `#[cfg(test)] #[path = …] mod tests;` -- is what the tree
/// actually uses (76 occurrences in `kasirmu-bridge`), and the walker must leave
/// the declaration's line in place rather than eating the rest of the file.
///
/// This is the else-branch, and it is the branch that fires on every real input.
/// A regression here would delete code from the point of the marker onward, which
/// would UNDER-count gates and make the pin silently permissive -- the direction
/// that matters, because a pin that reports zero drift is indistinguishable from
/// a tree with no drift.
#[test]
fn strip_test_blocks_leaves_the_unbraced_declaration_in_place() {
    let src = "#[cfg(test)]\n#[path = \"x_tests.rs\"]\nmod tests;\n\
               fn live() { ctx.require_session_permission(&s, permissions::SETTINGS_READ); }\n";
    let stripped = strip_test_blocks(src);
    assert!(
        stripped.contains("fn live") && stripped.contains("permissions::SETTINGS_READ"),
        "an unbraced declaration must not consume the rest of the file:\n{stripped}"
    );
    let (calls, keys) = census(&stripped, &["require_session_permission("]);
    assert_eq!(calls, 1, "the live call must still be counted; got {calls}");
    assert_eq!(
        keys,
        vec!["SETTINGS_READ".to_string()],
        "and its key kept; got {keys:?}"
    );
}

// ── `diff_rows`: the four drift classes ─────────────────────────────────
//
// WHY THE EXTRACTION. The classification used to live inside `assert_pin`,
// which takes `&[Root]` -- filesystem paths -- so the only way to exercise it
// was to run the whole census against the real tree. That made each class
// testable only in the state the tree happened to be in, and `absent` has never
// occurred at all: no pin currently names a missing module. These cases drive
// every class on synthetic maps, so all four are now pinned independently of
// what the checkout contains.

fn map(rows: &[(&str, usize, &[&str])]) -> BTreeMap<String, (usize, Vec<String>)> {
    rows.iter()
        .map(|(stem, calls, keys)| {
            (
                (*stem).to_string(),
                (
                    *calls,
                    keys.iter().map(|k| (*k).to_string()).collect::<Vec<_>>(),
                ),
            )
        })
        .collect()
}

/// An exactly-matching pin produces no rows.
///
/// The control for the four cases below: without it, a classifier that always
/// emitted a row would satisfy every "this drift is reported" assertion.
#[test]
fn diff_rows_is_empty_when_the_pin_matches() {
    let actual = map(&[("billing", 3, &["SETTINGS_READ"])]);
    let pinned: &[(&str, usize, &[&str])] = &[("billing", 3, &["SETTINGS_READ"])];
    let rows = diff_rows(&actual, pinned);
    assert!(
        rows.is_empty(),
        "a matching pin must report nothing: {rows:?}"
    );
}

/// `absent`: the pin names a module the source no longer has.
///
/// The class that has never fired in this repo, and therefore the one with no
/// incidental coverage at all. A deregistered command must not leave a pin
/// behind, so this row guards against a stale exemption outliving what it
/// protected.
#[test]
fn diff_rows_reports_a_pinned_module_that_is_absent() {
    let actual = map(&[]);
    let pinned: &[(&str, usize, &[&str])] = &[("deleted", 2, &["SETTINGS_READ"])];
    let rows = diff_rows(&actual, pinned);
    assert_eq!(rows.len(), 1, "expected one row, got: {rows:?}");
    assert!(
        rows[0].contains("absent") && rows[0].contains("deleted"),
        "the row must name the class and the module: {:?}",
        rows[0]
    );
}

/// `count`: same keys, different call count -- reported with both numbers.
#[test]
fn diff_rows_reports_a_count_mismatch() {
    let actual = map(&[("edc", 11, &["SETTINGS_READ"])]);
    let pinned: &[(&str, usize, &[&str])] = &[("edc", 8, &["SETTINGS_READ"])];
    let rows = diff_rows(&actual, pinned);
    assert_eq!(rows.len(), 1, "expected one row, got: {rows:?}");
    assert!(
        rows[0].contains("count") && rows[0].contains("pin 8") && rows[0].contains("source 11"),
        "the row must carry both numbers so the reader can judge the move: {:?}",
        rows[0]
    );
}

/// `keys`: same count, different permission set -- still reported.
///
/// This is the behavioural class. `fiscal` currently trips it by moving from
/// settings permissions to sales ones, which is a different job, and a
/// classifier that only compared counts would call that a match.
#[test]
fn diff_rows_reports_a_key_set_mismatch_at_equal_count() {
    let actual = map(&[("fiscal", 5, &["SALES_PROCESS", "SALES_VIEW"])]);
    let pinned: &[(&str, usize, &[&str])] = &[("fiscal", 5, &["SETTINGS_EDIT", "SETTINGS_READ"])];
    let rows = diff_rows(&actual, pinned);
    assert_eq!(rows.len(), 1, "expected exactly one row, got: {rows:?}");
    assert!(
        rows[0].contains("keys"),
        "a key move at equal count must be reported as a keys row: {:?}",
        rows[0]
    );
}

/// `unpinned`: a module gates permissions and appears in no row.
///
/// The most common class in the live drift. It is reported for a module with NO
/// pin entry, so the row must name what was found -- a reader needs the key list
/// to write the missing entry.
#[test]
fn diff_rows_reports_a_gating_module_that_is_unpinned() {
    let actual = map(&[("diagnostics", 1, &["SETTINGS_READ"])]);
    let pinned: &[(&str, usize, &[&str])] = &[];
    let rows = diff_rows(&actual, pinned);
    assert_eq!(rows.len(), 1, "expected one row, got: {rows:?}");
    assert!(
        rows[0].contains("unpinned") && rows[0].contains("SETTINGS_READ"),
        "the row must name the module and the keys found on disk: {:?}",
        rows[0]
    );
}

/// Every drifted row is reported, not just the first.
///
/// The property the function's own doc comment claims: "the first row alone is
/// a queue". A short-circuiting implementation would still pass every
/// single-drift case above, so this is the one that pins the contract they all
/// rely on.
#[test]
fn diff_rows_reports_every_drift_in_one_call() {
    let actual = map(&[
        ("edc", 11, &["SETTINGS_READ"]),
        ("fiscal", 5, &["SALES_VIEW"]),
        ("diagnostics", 1, &["SETTINGS_READ"]),
    ]);
    let pinned: &[(&str, usize, &[&str])] = &[
        ("edc", 8, &["SETTINGS_READ"]),
        ("fiscal", 5, &["SETTINGS_EDIT"]),
        ("deleted", 2, &["SETTINGS_READ"]),
        ("ok", 0, &[]),
    ];
    let rows = diff_rows(&actual, pinned);
    // 5 expected: edc count, fiscal keys, diagnostics unpinned, deleted absent,
    // and ok absent.
    assert_eq!(
        rows.len(),
        5,
        "every drift class must appear in ONE report; got {rows:?}"
    );
    for needle in ["absent", "count", "keys", "unpinned"] {
        assert!(
            rows.iter().any(|r| r.contains(needle)),
            "the class {needle} is missing from the report: {rows:?}"
        );
    }
}
// ── `census_dir`: the walker, its filters, and the split-module merge ────
//
// WHY. `census_dir` decides WHICH FILES enter the census at all; the
// parser tests above start from source that has already been selected. Five
// behaviours live here and none had a case:
//   1. filename filters -- `authz`, `mod`, `*_tests`, and the caller's `skip`
//   2. non-`.rs` extensions are ignored
//   3. a DIRECTORY recurses and its children merge into ONE stem
//   4. a split module (root file BESIDE a same-named dir) SUMS rather than one
//      winning -- `topology.rs` beside `topology/` is that shape in this tree
//   5. keys are sorted and deduplicated across the merge
//
// These need a real directory, so they build one with `tempfile` (already a
// dev-dependency) rather than mocking the filesystem.

/// Write `files` (relative path -> contents) under a fresh temp dir.
fn fixture(files: &[(&str, &str)]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("temp dir");
    for (rel, body) in files {
        let path = dir.path().join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(&path, body).expect("write fixture file");
    }
    dir
}

const GATE: &[&str] = &["require_session_permission("];

/// A plain `.rs` file is read and its gate call counted.
#[test]
fn census_dir_reads_a_plain_module_file() {
    let dir = fixture(&[(
        "billing.rs",
        "fn f() { ctx.require_session_permission(&s, permissions::SETTINGS_READ).await; }\n",
    )]);
    let out = census_dir(dir.path(), GATE, &[]);
    assert_eq!(out.len(), 1, "one module expected: {out:?}");
    assert_eq!(out["billing"].0, 1, "one gate call expected: {out:?}");
    assert_eq!(out["billing"].1, vec!["SETTINGS_READ".to_string()]);
}

/// `*_tests`, `authz`, `mod` and the caller's `skip` list are all excluded.
///
/// This is the filter that keeps test fixtures and gate WRAPPERS out of the
/// census. Losing `_tests` would count every fixture; losing `authz` would
/// count the wrapper definitions themselves and inflate every module.
#[test]
fn census_dir_skips_test_wrappers_and_the_skip_list() {
    let body = "fn f() { ctx.require_session_permission(&s, permissions::SETTINGS_READ).await; }\n";
    let dir = fixture(&[
        ("keep.rs", body),
        ("thing_tests.rs", body),
        ("authz.rs", body),
        ("mod.rs", body),
        ("error.rs", body),
    ]);
    let out = census_dir(dir.path(), GATE, &["error"]);
    assert_eq!(
        out.keys().collect::<Vec<_>>(),
        vec!["keep"],
        "only the non-excluded module may survive: {out:?}"
    );
}

/// A non-`.rs` file is ignored even when it contains gate-shaped text.
#[test]
fn census_dir_ignores_non_rust_files() {
    let dir = fixture(&[
        (
            "notes.txt",
            "ctx.require_session_permission(&s, permissions::SETTINGS_READ);\n",
        ),
        ("keep.rs", "fn f() {}\n"),
    ]);
    let out = census_dir(dir.path(), GATE, &[]);
    assert_eq!(out.keys().collect::<Vec<_>>(), vec!["keep"], "{out:?}");
}

/// A directory recurses, and its children merge into ONE entry named for the
/// directory -- calls summed, keys unioned.
///
/// This is why the census keys on the module and not the file: `topology/`
/// holds several files that are one module to a reviewer.
#[test]
fn census_dir_merges_a_directory_into_one_stem() {
    let dir = fixture(&[
        (
            "split/a.rs",
            "fn f() { ctx.require_session_permission(&s, permissions::SALES_VIEW).await; }\n",
        ),
        (
            "split/b.rs",
            "fn g() { ctx.require_session_permission(&s, permissions::SETTINGS_READ).await; }\n",
        ),
    ]);
    let out = census_dir(dir.path(), GATE, &[]);
    assert_eq!(out.len(), 1, "one module from two files: {out:?}");
    assert_eq!(out["split"].0, 2, "calls must be summed: {out:?}");
    assert_eq!(
        out["split"].1,
        vec!["SALES_VIEW".to_string(), "SETTINGS_READ".to_string()],
        "keys must be unioned and sorted: {out:?}"
    );
}

/// THE SPLIT-MODULE MERGE: a root file beside a same-named directory adds to
/// the same entry rather than one overwriting the other.
///
/// `topology.rs` sits beside `topology/` in THIS tree, so this is live rather
/// than hypothetical. The comment at the merge site says the alternative is to
/// "let read_dir order decide which entry wins" -- so the failure mode is a
/// count that changes between runs on the same source. Summing is the contract.
#[test]
fn census_dir_sums_a_split_module_root_file_with_its_directory() {
    let dir = fixture(&[
        (
            "topology.rs",
            "fn f() { ctx.require_session_permission(&s, permissions::SETTINGS_READ).await; }\n",
        ),
        (
            "topology/a.rs",
            "fn g() { ctx.require_permission_for_user(&s, permissions::SALES_VIEW).await; }\n",
        ),
        (
            "topology/b.rs",
            "fn h() { ctx.require_permission_for_user(&s, permissions::SALES_VIEW).await; }\n",
        ),
    ]);
    let gates: &[&str] = &[
        "require_session_permission(",
        "require_permission_for_user(",
    ];
    let out = census_dir(dir.path(), gates, &[]);
    assert_eq!(
        out.len(),
        1,
        "the root file and the dir are ONE module: {out:?}"
    );
    assert_eq!(
        out["topology"].0, 3,
        "the root file's call must add to the directory's, not replace it: {out:?}"
    );
    assert_eq!(
        out["topology"].1,
        vec!["SALES_VIEW".to_string(), "SETTINGS_READ".to_string()],
        "keys from both halves must survive: {out:?}"
    );
}

/// An empty directory yields no rows rather than panicking.
#[test]
fn census_dir_returns_nothing_for_an_empty_directory() {
    let dir = fixture(&[]);
    assert!(census_dir(dir.path(), GATE, &[]).is_empty());
}

/// THE DIR BRANCH'S MERGE, isolated from the file branch's copy.
///
/// WHY A SEPARATE CASE. The merge appears TWICE in `census_dir` -- once in the
/// directory branch and once in the file branch -- and for a plain split module
/// either copy alone produces the same sum, because the second one to run merges
/// into whatever the first inserted. Measured: disabling the DIRECTORY branch's
/// merge leaves the split-module case above passing 6/6, so that case cannot
/// tell the two copies apart.
///
/// This fixture forces the directory branch to be the ONLY writer for its stem,
/// by giving the same-named root file a name the walker SKIPS (`mod.rs`). The
/// directory's own children still merge among themselves, so if that branch stops
/// summing, two children collapse to whichever `into_values()` happened to end
/// on -- a count that changes with the map's contents rather than the source.
#[test]
fn census_dir_merge_survives_when_the_root_file_is_excluded() {
    let dir = fixture(&[
        // Skipped by the `mod` filter, so only the directory branch writes.
        (
            "mod.rs",
            "fn f() { ctx.require_session_permission(&s, permissions::SALES_VIEW).await; }\n",
        ),
        (
            "mod/a.rs",
            "fn g() { ctx.require_session_permission(&s, permissions::SALES_VIEW).await; }\n",
        ),
        (
            "mod/b.rs",
            "fn h() { ctx.require_session_permission(&s, permissions::SETTINGS_READ).await; }\n",
        ),
    ]);
    let out = census_dir(dir.path(), GATE, &[]);
    assert_eq!(out.len(), 1, "one module expected: {out:?}");
    assert_eq!(
        out["mod"].0, 2,
        "both children must sum, with no file branch to do it for them: {out:?}"
    );
    assert_eq!(
        out["mod"].1,
        vec!["SALES_VIEW".to_string(), "SETTINGS_READ".to_string()],
        "keys from both children must survive the directory branch's merge: {out:?}"
    );
}

/// `permission_value` must map each NAME to that name's OWN constant.
///
/// WHY THIS EXISTS. The registry test above only asks whether the value
/// `permission_value` returns is REGISTERED. That is a real check, but it cannot
/// see a wrong-but-plausible arm: changing `"SALES_VIEW" => p::SALES_VIEW` to
/// `=> p::SALES_PROCESS` still yields a registered permission, so the registry
/// test passes while the census silently grades the wrong key for that row.
/// Measured: that swap compiles, recompiles the crate, and leaves
/// `all_gated_permission_keys_are_registered` GREEN. The map is hand-written,
/// so this is the gap it can actually fall into.
///
/// The arms are an IDENTITY by construction: every permission constant in
/// `platform/core/src/rbac.rs` is spelled `UPPER_SNAKE` and holds the same text
/// lowercased with the FIRST underscore replaced by a colon (`SALES_VIEW` ->
/// `"sales:view"`, `STAFF_READ_IDENTITY` -> `"staff:read_identity"`). Measured
/// over all 99 constants: the only six that deviate are the `role-*` values
/// (OWNER -> `role-owner` and friends), which are roles and never appear as
/// census keys.
///
/// So the expected value is DERIVED from the name rather than restated, which is
/// what makes this able to catch a mismatch instead of duplicating the map.
fn expected_permission_value(name: &str) -> String {
    match name.find('_') {
        Some(i) => format!(
            "{}:{}",
            name[..i].to_lowercase(),
            name[i + 1..].to_lowercase()
        ),
        None => name.to_lowercase(),
    }
}

/// Every pinned key resolves to its OWN permission, not merely to some permission.
#[test]
fn permission_value_resolves_each_key_to_its_own_constant() {
    let mut checked = 0usize;
    for (_, _, keys) in PINNED_DESKTOP.iter().chain(PINNED_TABLET) {
        for key in *keys {
            let got = permission_value(key);
            let want = expected_permission_value(key);
            assert_eq!(
                got, want,
                "permission_value(\"{key}\") resolved to `{got}`, but that name's own \
                 constant holds `{want}` -- the arm is mapping the key to a different \
                 permission, so the census would grade the wrong key while the \
                 registry test still passed"
            );
            checked += 1;
        }
    }
    assert!(
        checked > 0,
        "no keys were checked -- the pin is empty, so this test proved nothing"
    );
}

/// A zero-call, zero-key module is reported as BOOKKEEPING, not as an unreviewed gate.
///
/// WHY. Four tablet rows (`edc`, `kds_device`, `kds_routing`, `shifts`) currently
/// fail the census while carrying `0` calls and `[]` keys -- modules that exist
/// on disk and gate nothing. The single previous wording called every one of
/// them "gates permissions on disk", which is false for these four and sends the
/// reader looking for a gate that does not exist. This file's own header says a
/// zero-call module is "ungated by construction (its census is pinned as `0, &[]`)",
/// so the honest report is that the expected row was never written.
#[test]
fn diff_rows_separates_an_empty_module_from_an_unpinned_gate() {
    let actual = map(&[
        ("shifts", 0, &[]),
        ("updater", 3, &["SETTINGS_EDIT", "SETTINGS_READ"]),
    ]);
    let pinned: &[(&str, usize, &[&str])] = &[];
    let rows = diff_rows(&actual, pinned);
    assert_eq!(rows.len(), 2, "both modules must be reported: {rows:?}");

    let shifts = rows
        .iter()
        .find(|r| r.contains("shifts"))
        .expect("shifts row");
    assert!(
        !shifts.contains("gates permissions on disk"),
        "a module with no gate calls must not claim it gates permissions: {shifts:?}"
    );
    assert!(
        shifts.contains("0, &[]"),
        "the row must say what to add, since the fix is bookkeeping: {shifts:?}"
    );

    let updater = rows
        .iter()
        .find(|r| r.contains("updater"))
        .expect("updater row");
    assert!(
        updater.contains("gates permissions on disk"),
        "a module WITH gate calls is genuine debt and must still say so: {updater:?}"
    );
    assert!(
        updater.contains("SETTINGS_READ"),
        "the real-debt row must carry the keys for the reviewer: {updater:?}"
    );
}
