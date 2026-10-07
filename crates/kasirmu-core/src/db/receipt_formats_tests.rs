//! Tests for the receipt formats module (receipt-format axis).

use super::*;
use crate::db::Store;
use crate::migrations;

/// The caller owns the connection, so this no longer `Box::leak`s a
/// database per test to manufacture a `'static` (O-T03).
fn store(db: &rusqlite::Connection) -> Store<'_> {
    Store::new(db)
}

const NOW: &str = "2026-09-26T12:00:00.000Z";

fn seed_terminal(store: &Store<'_>, terminal_id: &str, location_id: &str) {
    store
        .conn
        .execute(
            "INSERT INTO terminals (id, name, device_id, is_active, bound_location_id,
                                    created_at, updated_at)
             VALUES (?1, ?1, ?1, 1, ?2, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')",
            params![terminal_id, location_id],
        )
        .unwrap();
}

fn seed_entity(store: &Store<'_>, entity_id: &str) {
    store
        .conn
        .execute(
            "INSERT INTO legal_entities (id, tenant_id, name, legal_name,
                    registration_number, tax_id, status, country_code, locale,
                    timezone, currency, created_at, updated_at)
             VALUES (?1, 'default', ?1, '', '', '', 'active', 'ID', '', '', '',
                     '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')",
            params![entity_id],
        )
        .unwrap();
}

fn content() -> ReceiptContent {
    ReceiptContent {
        required_fields: vec!["store_name".into(), "tax_id".into(), "total".into()],
        footer_text: "Terima kasih".into(),
        show_tax: true,
        show_currency: false,
        decimal_separator: "comma".into(),
        tax_id_label: None,
        tax_regime: None,
        statutory_rounding: None,
    }
}

fn layout() -> ReceiptLayout {
    ReceiptLayout {
        paper_width_mm: Some(80),
        margin_top_mm: Some(2),
        margin_bottom_mm: Some(3),
        margin_left_mm: None,
        margin_right_mm: None,
        show_logo: Some(false),
        print_copies: Some(1),
        show_table_number: None,
        footer_note: Some("note".into()),
    }
}

// ── writes ──────────────────────────────────────────────────

#[test]
fn content_write_upserts_one_row_per_entity() {
    let store_db = migrations::fresh_db();
    let store = store(&store_db);
    store
        .set_receipt_content_for_entity("ent-1", &content(), NOW)
        .unwrap();
    // A rewrite replaces the row — still exactly one.
    let mut second = content();
    second.footer_text = "updated".into();
    store
        .set_receipt_content_for_entity("ent-1", &second, NOW)
        .unwrap();
    let count: i64 = store
        .conn
        .query_row(
            "SELECT COUNT(*) FROM receipt_formats WHERE scope_type = 'legal_entity' AND scope_id = 'ent-1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn content_write_rejects_unknown_and_duplicate_element_codes() {
    let store_db = migrations::fresh_db();
    let store = store(&store_db);
    let mut bad = content();
    bad.required_fields.push("qr_code_marketing".into());
    let err = store
        .set_receipt_content_for_entity("ent-1", &bad, NOW)
        .unwrap_err();
    assert!(
        matches!(
            err,
            CoreError::Validation {
                field: "required_fields",
                ..
            }
        ),
        "got {err:?}"
    );
    let mut dup = content();
    dup.required_fields.push("total".into());
    assert!(
        store
            .set_receipt_content_for_entity("ent-1", &dup, NOW)
            .is_err()
    );
}

#[test]
fn content_write_rejects_bad_separator_and_long_footer() {
    let store_db = migrations::fresh_db();
    let store = store(&store_db);
    let mut bad = content();
    bad.decimal_separator = "period".into();
    assert!(
        store
            .set_receipt_content_for_entity("ent-1", &bad, NOW)
            .is_err()
    );
    let mut long = content();
    long.footer_text = "x".repeat(501);
    assert!(
        store
            .set_receipt_content_for_entity("ent-1", &long, NOW)
            .is_err()
    );
}

#[test]
fn layout_write_rejects_bad_scope_and_nonsense_width() {
    let store_db = migrations::fresh_db();
    let store = store(&store_db);
    let mut wide = layout();
    wide.paper_width_mm = Some(200);
    assert!(
        store
            .set_receipt_layout_for_scope("terminal", "term-1", &wide, NOW)
            .is_err()
    );
    let mut low = layout();
    low.paper_width_mm = Some(5);
    assert!(
        store
            .set_receipt_layout_for_scope("terminal", "term-1", &low, NOW)
            .is_err()
    );
    assert!(
        store
            .set_receipt_layout_for_scope("legal_entity", "ent-1", &layout(), NOW)
            .is_err(),
        "layout is not a legal-entity concern"
    );
    let mut neg = layout();
    neg.margin_top_mm = Some(-1);
    assert!(
        store
            .set_receipt_layout_for_scope("terminal", "term-1", &neg, NOW)
            .is_err()
    );
}

#[test]
fn db_check_rejects_out_of_range_width_even_without_the_boundary() {
    let store_db = migrations::fresh_db();
    let store = store(&store_db);
    // Supervisor addition 3: nonsense widths fail at the DB layer too.
    let err = store.conn.execute(
        "INSERT INTO receipt_formats (id, tenant_id, scope_type, scope_id, config, paper_width_mm, created_at, updated_at)
         VALUES ('x', 'default', 'terminal', 'term-1', '{}', 500, '2026', '2026')",
        [],
    );
    assert!(err.is_err(), "the 20-120 CHECK must hold at the DB layer");
}

// ── the effective read: inheritance + provenance ───────────

#[test]
fn content_comes_from_the_entity_and_layout_from_terminal_over_workspace() {
    let store_db = migrations::fresh_db();
    let store = store(&store_db);
    store
        .conn
        .execute(
            "INSERT INTO locations (id, name, currency, timezone, is_primary, created_at, updated_at)
             VALUES ('store-1', 'Main', 'IDR', 'UTC', 1, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')",
            [],
        )
        .unwrap();
    seed_terminal(&store, "term-1", "store-1");
    seed_entity(&store, "ent-1");
    store
        .conn
        .execute(
            "UPDATE locations SET legal_entity_id = 'ent-1' WHERE id = 'store-1'",
            [],
        )
        .unwrap();
    store
        .set_receipt_content_for_entity("ent-1", &content(), NOW)
        .unwrap();
    let mut workspace = layout();
    workspace.paper_width_mm = Some(58);
    workspace.print_copies = Some(2);
    store
        .set_receipt_layout_for_scope("workspace", "store-1", &workspace, NOW)
        .unwrap();
    let mut terminal = layout();
    terminal.paper_width_mm = None; // width must fall through to the workspace row
    terminal.print_copies = Some(3);
    store
        .set_receipt_layout_for_scope("terminal", "term-1", &terminal, NOW)
        .unwrap();

    let eff = store
        .effective_receipt_format(Some("term-1"), None)
        .unwrap();
    // Content: entity, as-is (statutory).
    assert_eq!(eff.content_source, ReceiptSource::Entity);
    assert_eq!(eff.content.as_ref().unwrap().footer_text, "Terima kasih");
    // Layout: terminal answered (highest layer), width inherited from
    // workspace (58), copies from terminal (3), unset fields fall through.
    assert_eq!(eff.layout_source, ReceiptSource::Terminal);
    assert_eq!(eff.layout.paper_width_mm, Some(58));
    assert_eq!(eff.layout.print_copies, Some(3));
    assert_eq!(eff.layout.margin_top_mm, Some(2));
}

#[test]
fn terminal_layout_fills_only_its_own_fields_over_workspace() {
    let store_db = migrations::fresh_db();
    let store = store(&store_db);
    store
        .conn
        .execute(
            "INSERT INTO locations (id, name, currency, timezone, is_primary, created_at, updated_at)
             VALUES ('store-1', 'Main', 'IDR', 'UTC', 1, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')",
            [],
        )
        .unwrap();
    seed_terminal(&store, "term-1", "store-1");
    let mut workspace = layout();
    workspace.footer_note = Some("workspace note".into());
    store
        .set_receipt_layout_for_scope("workspace", "store-1", &workspace, NOW)
        .unwrap();
    // The terminal row sets ONLY the width; everything else must fall
    // through to the workspace row.
    let terminal = ReceiptLayout {
        paper_width_mm: Some(58),
        margin_top_mm: None,
        margin_bottom_mm: None,
        margin_left_mm: None,
        margin_right_mm: None,
        show_logo: None,
        print_copies: None,
        show_table_number: None,
        footer_note: None,
    };
    store
        .set_receipt_layout_for_scope("terminal", "term-1", &terminal, NOW)
        .unwrap();

    let eff = store
        .effective_receipt_format(Some("term-1"), None)
        .unwrap();
    assert_eq!(eff.layout.paper_width_mm, Some(58));
    assert_eq!(eff.layout.footer_note.as_deref(), Some("workspace note"));
}

#[test]
fn no_scoped_rows_and_no_legacy_keys_answers_unset() {
    let store_db = migrations::fresh_db();
    let store = store(&store_db);
    let eff = store
        .effective_receipt_format(Some("no-such-terminal"), None)
        .unwrap();
    assert_eq!(eff.content_source, ReceiptSource::Unset);
    assert!(eff.content.is_none());
    assert_eq!(eff.layout_source, ReceiptSource::Unset);
    // Layout still carries the renderer defaults via the legacy defaults
    // (80mm standard paper, zero margins, no table number).
    assert_eq!(eff.layout.paper_width_mm, Some(80));
}

// ── THE LEGACY FALLBACK PINS (supervisor addition 1) ───────

#[test]
fn legacy_fallback_reads_exactly_the_pinned_keys() {
    // Pin the EXACT key list: if the settings-rebuild stream retires or
    // renames a key, this test fails here first instead of the fallback
    // silently drifting.
    let store_db = migrations::fresh_db();
    let store = store(&store_db);
    for key in LEGACY_RECEIPT_KEYS {
        platform_core::settings::Settings::set(store.conn, key, "x").unwrap();
    }
    // Every pinned key must resolve through the legacy Settings API —
    // proving the literal list matches the platform-core spellings.
    assert_eq!(LEGACY_RECEIPT_KEYS.len(), 10);
    assert!(LEGACY_RECEIPT_KEYS.contains(&"receipt.footer"));
    assert!(LEGACY_RECEIPT_KEYS.contains(&"receipt.paper_width"));
    assert!(LEGACY_RECEIPT_KEYS.contains(&"receipt.show_tax"));
    assert!(LEGACY_RECEIPT_KEYS.contains(&"receipt.show_currency"));
    assert!(LEGACY_RECEIPT_KEYS.contains(&"receipt.decimal_separator"));
    assert!(LEGACY_RECEIPT_KEYS.contains(&"receipt.show_table_number"));
    assert!(LEGACY_RECEIPT_KEYS.contains(&"receipt.margin_top"));
    assert!(LEGACY_RECEIPT_KEYS.contains(&"receipt.margin_bottom"));
    assert!(LEGACY_RECEIPT_KEYS.contains(&"receipt.margin_left"));
    assert!(LEGACY_RECEIPT_KEYS.contains(&"receipt.margin_right"));

    // And the fallback itself engages: content answers Legacy.
    let eff = store
        .effective_receipt_format(Some("term-legacy"), None)
        .unwrap();
    assert_eq!(eff.content_source, ReceiptSource::Legacy);
    assert!(eff.content.is_some());
}

#[test]
fn scoped_row_overrides_the_legacy_key_for_the_same_concern() {
    let store_db = migrations::fresh_db();
    let store = store(&store_db);
    // Legacy footer set org-globally.
    platform_core::settings::Settings::set(store.conn, "receipt.footer", "legacy footer").unwrap();
    // Scoped content row with a different footer.
    let mut scoped = content();
    scoped.footer_text = "scoped footer".into();
    store
        .set_receipt_content_for_entity("ent-1", &scoped, NOW)
        .unwrap();
    // A primary location linked to the entity (the read model resolves the
    // content owner through it).
    seed_entity(&store, "ent-1");
    store
        .conn
        .execute(
            "INSERT INTO locations (id, name, currency, timezone, is_primary, legal_entity_id, created_at, updated_at)
             VALUES ('loc-primary', 'Main', 'IDR', 'UTC', 1, 'ent-1', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')",
            [],
        )
        .unwrap();

    let eff = store
        .effective_receipt_format(Some("term-1"), None)
        .unwrap();
    assert_eq!(eff.content_source, ReceiptSource::Entity);
    assert_eq!(
        eff.content.as_ref().unwrap().footer_text,
        "scoped footer",
        "the scoped row must win over the legacy key"
    );
}

#[test]
fn unknown_element_code_is_named_in_the_error() {
    let store_db = migrations::fresh_db();
    let store = store(&store_db);
    let mut bad = content();
    bad.required_fields = vec!["nft_certificate".into()];
    let err = store
        .set_receipt_content_for_entity("ent-1", &bad, NOW)
        .unwrap_err();
    match err {
        CoreError::Validation { message, .. } => {
            assert!(message.contains("nft_certificate"), "{message}");
        }
        other => panic!("expected Validation, got {other:?}"),
    }
}

// ── AN UNREADABLE settings TABLE IS NOT AN UNCONFIGURED REGISTER ─────

/// `effective_receipt_format` probes the ten legacy keys to decide whether a
/// legacy configuration exists at all. That probe used
/// `Settings::get(conn, key).is_ok_and(|v| v.is_some())`, so an unreadable
/// `settings` table (SQLITE_BUSY, corrupt, locked) answered "no" for every key:
/// `has_any` was false, the function returned `ReceiptSource::Unset`, and the
/// operator's saved receipt settings silently stopped applying with no error
/// reaching the print path. The four fills below the probe had the same shape
/// (`unwrap_or_default` / `unwrap_or(0)` / `unwrap_or(false)`), and the layout
/// half of the function repeated both.
///
/// The pin makes `settings` PRESENT but unreadable — `value` is a BLOB, so
/// every `row.get::<_, String>(0)` fails — and asserts the read REFUSES. A
/// probe that cannot run must not be reported as a negative probe.
#[test]
fn an_unreadable_settings_table_is_an_error_not_an_unconfigured_register() {
    let store_db = migrations::fresh_db();
    let store = store(&store_db);
    // A readable settings table answers Unset (no legacy key set) — the
    // honest-source rule, and the behaviour that must survive.
    let eff = store
        .effective_receipt_format(Some("term-1"), None)
        .expect("a readable settings table must resolve");
    assert_eq!(eff.content_source, ReceiptSource::Unset);

    // Now make the table unreadable without removing it, which is exactly the
    // locked/corrupt/short-read case the probe used to absorb.
    store
        .conn
        .execute_batch(
            "DROP TABLE settings; \
             CREATE TABLE settings (key TEXT PRIMARY KEY, value BLOB NOT NULL, \
                                     updated_at TEXT NOT NULL DEFAULT ''); \
             INSERT INTO settings (key, value) VALUES ('receipt.footer', x'80');",
        )
        .expect("rebuilding settings with an unreadable value");

    let err = store
        .effective_receipt_format(Some("term-1"), None)
        .expect_err("an unreadable settings table must not read as Unset");
    // The exact variant is the platform error wrapping the SQLite column-type
    // failure; the point of the pin is that it is an ERROR rather than a
    // silently-Unset answer, so assert on the shape and name the actual value
    // in the message.
    assert!(
        matches!(err, CoreError::Platform(_)),
        "expected the read failure to surface as a Platform error, got {err:?}"
    );
}

#[test]
fn effective_receipt_format_derives_entity_tax_label_and_regime() {
    let conn = migrations::fresh_db();
    conn.execute(
        "INSERT INTO legal_entities (id, tenant_id, name, country_code, tax_id)
         VALUES ('ent-sg', 'default', 'SG Entity', 'SG', 'M12345678X')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO locations (id, name, tenant_id, legal_entity_id, is_primary)
         VALUES ('loc-sg', 'SG Store', 'default', 'ent-sg', 1)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO terminals (id, name, device_id, bound_location_id)
         VALUES ('term-sg', 'POS SG', 'dev-sg', 'loc-sg')",
        [],
    )
    .unwrap();

    let store = Store::new(&conn);
    let mut c = content();
    c.tax_id_label = None;
    store
        .set_receipt_content_for_entity("ent-sg", &c, "2026-10-02T00:00:00.000Z")
        .unwrap();

    let eff = store
        .effective_receipt_format(Some("term-sg"), None)
        .expect("should resolve format");
    assert_eq!(eff.content_source, ReceiptSource::Entity);
    let content = eff.content.unwrap();
    assert_eq!(content.tax_id_label.as_deref(), Some("GST Reg No"));
    assert_eq!(content.tax_regime.as_deref(), Some("LOCAL/SG"));
}
