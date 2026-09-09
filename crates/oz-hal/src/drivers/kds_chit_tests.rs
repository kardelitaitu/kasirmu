use super::*;

#[test]
fn chit_contains_order_number() {
    let chit = format_kds_chit(
        Some(42),
        None,
        "Burger x2",
        2,
        "",
        "2026-07-30T12:00:00Z",
        "",
    );
    assert!(chit.text.contains("#42"));
}

#[test]
fn chit_contains_table_number() {
    let chit = format_kds_chit(
        Some(1),
        Some("T5"),
        "Fries",
        1,
        "",
        "2026-07-30T12:00:00Z",
        "",
    );
    assert!(chit.text.contains("Table: T5"));
}

#[test]
fn chit_contains_items() {
    let chit = format_kds_chit(
        Some(7),
        None,
        "Steak x2, Salad x1",
        3,
        "",
        "2026-07-30T12:00:00Z",
        "",
    );
    assert!(chit.text.contains("Steak x2"));
    assert!(chit.text.contains("Salad x1"));
}

#[test]
fn chit_contains_notes() {
    let chit = format_kds_chit(
        Some(3),
        None,
        "Pasta",
        1,
        "No cheese, gluten free",
        "2026-07-30T12:00:00Z",
        "",
    );
    assert!(chit.text.contains("NOTES:"));
    assert!(chit.text.contains("No cheese, gluten free"));
}

#[test]
fn chit_without_table_number_omits_table_line() {
    let chit = format_kds_chit(Some(5), None, "Tea", 1, "", "2026-07-30T12:00:00Z", "");
    assert!(!chit.text.contains("Table:"));
}

#[test]
fn chit_empty_notes_omits_notes_section() {
    let chit = format_kds_chit(Some(2), None, "Coffee", 1, "", "2026-07-30T12:00:00Z", "");
    assert!(!chit.text.contains("NOTES:"));
}

#[test]
fn chit_contains_received_timestamp() {
    let chit = format_kds_chit(Some(1), None, "Item", 1, "", "2026-07-30T12:34:56Z", "");
    assert!(chit.text.contains("Received: 2026-07-30T12:34:56Z"));
}

#[test]
fn chit_starts_with_esc_init() {
    let chit = format_kds_chit(Some(1), None, "Item", 1, "", "2026-07-30T12:00:00Z", "");
    assert!(chit.data.starts_with(escpos::ESC_INIT));
}

#[test]
fn chit_ends_with_full_cut() {
    let chit = format_kds_chit(Some(1), None, "Item", 1, "", "2026-07-30T12:00:00Z", "");
    assert!(chit.data.ends_with(escpos::CUT_FULL));
}

#[test]
fn chit_contains_separator() {
    let chit = format_kds_chit(Some(10), None, "Item", 1, "", "2026-07-30T12:00:00Z", "");
    assert!(chit.text.contains('─'));
}

#[test]
fn chit_contains_kitchen_order_heading() {
    let chit = format_kds_chit(Some(1), None, "Item", 1, "", "2026-07-30T12:00:00Z", "");
    assert!(chit.text.contains("KITCHEN ORDER"));
}

#[test]
fn chit_contains_item_count() {
    let chit = format_kds_chit(Some(1), None, "Item x3", 3, "", "2026-07-30T12:00:00Z", "");
    assert!(chit.text.contains("Items: 3"));
}

#[test]
fn center_text_pads_correctly() {
    let result = center_text("HELLO", 48);
    assert_eq!(result.len(), 48);
    assert_eq!(result.trim(), "HELLO");
}

#[test]
fn center_text_long_string_not_padded() {
    let long = "A".repeat(60);
    let result = center_text(&long, 48);
    assert_eq!(result.len(), 60);
}

#[test]
fn chit_handles_no_display_number() {
    let chit = format_kds_chit(None, None, "Item", 1, "", "2026-07-30T12:00:00Z", "");
    assert!(chit.text.contains("Order: --"));
}

#[test]
fn chit_handles_empty_table_string() {
    let chit = format_kds_chit(Some(1), Some(""), "Item", 1, "", "2026-07-30T12:00:00Z", "");
    assert!(!chit.text.contains("Table:"));
}

#[test]
fn chit_handles_unparseable_timestamp() {
    let chit = format_kds_chit(Some(1), None, "Item", 1, "", "not-a-timestamp", "");
    assert!(chit.text.contains("not-a-timestamp"));
}

#[test]
fn chit_prefix_renders_before_number() {
    // Render ruling: #{prefix}{n} — no zero-padded alternative arm, so the
    // same daily counter can never print two different ways.
    let chit = format_kds_chit(Some(7), None, "Item", 1, "", "2026-07-30T12:00:00Z", "B");
    assert!(chit.text.contains("Order: #B7"));
}

#[test]
fn chit_empty_prefix_keeps_plain_number() {
    // No stamped prefix (legacy rows, prefix-less locations) = the historic
    // rendering, pinned so the 16 pre-existing assertions stay valid.
    let chit = format_kds_chit(Some(7), None, "Item", 1, "", "2026-07-30T12:00:00Z", "");
    assert!(chit.text.contains("Order: #7"));
}

#[test]
fn chit_prefix_none_number_still_dash() {
    // '--' is unchanged when display_number is None, prefix or not.
    let chit = format_kds_chit(None, None, "Item", 1, "", "2026-07-30T12:00:00Z", "B");
    assert!(chit.text.contains("Order: --"));
}

#[test]
fn chit_bullets_are_formatted() {
    let chit = format_kds_chit(
        Some(1),
        None,
        "Item A, Item B",
        2,
        "",
        "2026-07-30T12:00:00Z",
        "",
    );
    assert!(chit.text.contains("  • Item A"));
    assert!(chit.text.contains("  • Item B"));
}

// ── HAL-1 regression: centering pads by character cells ───────────────

#[test]
fn center_text_is_symmetric_for_multibyte_names() {
    for name in ["Ayam Gepuk", "Kopi ☕", "Sate Padang", "Café"] {
        let centered = center_text(name, 48);
        assert_eq!(
            centered.chars().count(),
            48,
            "{name:?} did not fill the 48-cell chit width"
        );
        let left = centered.len() - centered.trim_start().len();
        let right = centered.chars().count() - centered.trim_end().chars().count();
        assert!(
            left == right || left + 1 == right || right + 1 == left,
            "{name:?} is lopsided: {left} left vs {right} right"
        );
    }
}

#[test]
fn center_text_leaves_over_width_text_untouched() {
    let wide = center_text("x".repeat(60).as_str(), 48);
    assert_eq!(wide.chars().count(), 60);
}
