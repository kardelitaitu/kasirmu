/*
last audited 25-07-26 by RSA-Agent (kasirmu-hal slice B: verified)
crate: kasirmu-hal | status: SAFE | lint: CLEAN
findings: HAL-1 instance found here 31-08-26 and fixed — center_text() padded by byte .len(), so a multi-byte item name shifted the chit's centering. The 25-07-26 slice-B pass recorded this file as "clean"; it was verified structurally only, and the byte-vs-char defect is invisible without reading the padding arithmetic. Now uses escpos::cell_width. Otherwise clean: no unwrap/panic/unsafe, sibling tests per convention
next: none | perf: N/A
*/
//! KDS kitchen chit formatting — produces ESC/POS bytes for thermal
//! printers in the kitchen.
//!
//! Chits are compact, focused on what the kitchen needs: order number,
//! table number, items, notes, and timestamps. Designed for 80mm
//! thermal paper (~48 characters wide).

use super::escpos;

/// A formatted kitchen chit ready to send to a thermal printer.
pub struct KdsChit {
    /// ESC/POS bytes (includes init, text, feed, and cut commands).
    pub data: Vec<u8>,
    /// Plain-text representation (for logging/display).
    pub text: String,
}

/// Format a KDS order into a printable kitchen chit.
///
/// The chit includes:
/// - Header with "KITCHEN ORDER" label
/// - Order number and table number
/// - Item summary (what the kitchen needs to cook)
/// - Notes (allergies, modifications)
/// - Timestamp of when the order was received
/// - Separator lines for visual clarity
pub fn format_kds_chit(
    display_number: Option<i64>,
    table_number: Option<&str>,
    items_summary: &str,
    item_count: i64,
    notes: &str,
    received_at: &str,
    ticket_prefix: &str,
) -> KdsChit {
    let w = 48; // 80mm paper width
    let mut lines: Vec<String> = Vec::with_capacity(20);

    // Header
    let separator = "─".repeat(w);
    lines.push(separator.clone());
    lines.push(center_text("KITCHEN ORDER", w));
    lines.push(separator.clone());
    lines.push(String::new());

    // Order number — `#{prefix}{n}` when the ticket carries the location's
    // stamped prefix, plain `#{n}` otherwise. No invented zero-padding: only
    // the prefixed arm would gain it, printing the same counter two ways.
    let order_str = match display_number {
        Some(n) if !ticket_prefix.is_empty() => format!("#{ticket_prefix}{n}"),
        Some(n) => format!("#{n}"),
        None => "--".to_string(),
    };
    lines.push(format!("Order: {order_str}"));

    // Table number
    if let Some(table) = table_number
        && !table.is_empty()
    {
        lines.push(format!("Table: {table}"));
    }

    // Items count
    lines.push(format!("Items: {item_count}"));
    lines.push(String::new());
    lines.push(separator.clone());

    // Items
    lines.push("ITEMS:".to_string());
    for item_line in items_summary.split(", ") {
        let trimmed = item_line.trim();
        if !trimmed.is_empty() {
            lines.push(format!("  • {trimmed}"));
        }
    }
    lines.push(separator.clone());

    // Notes
    if !notes.is_empty() {
        lines.push(format!("NOTES: {notes}"));
        lines.push(separator.clone());
    }

    // Timestamp — pass through the received_at string as-is (already
    // in RFC3339 format from the database, no chrono dependency needed).
    lines.push(String::new());
    lines.push(format!("Received: {received_at}"));

    lines.push(separator.clone());
    lines.push(String::new());
    lines.push(center_text("<<< CUT HERE >>>", w));

    let text = lines.join("\n");

    // Build ESC/POS bytes
    let mut buf = Vec::with_capacity(text.len() + 64);
    buf.extend_from_slice(escpos::ESC_INIT);
    buf.extend_from_slice(escpos::LINE_SPACING_DEFAULT);
    buf.extend_from_slice(escpos::FONT_A);

    for line in text.lines() {
        buf.extend_from_slice(line.as_bytes());
        buf.extend_from_slice(escpos::LF);
    }

    buf.extend_from_slice(&escpos::feed(3));
    buf.extend_from_slice(escpos::CUT_FULL);

    KdsChit { data: buf, text }
}

/// Center text by padding with spaces to the given width.
///
/// Pads by character cells, not bytes — see [`escpos::cell_width`] (HAL-1).
fn center_text(s: &str, width: usize) -> String {
    let len = escpos::cell_width(s);
    if len >= width {
        s.to_owned()
    } else {
        let left = (width - len) / 2;
        let right = width - len - left;
        format!("{}{}{}", " ".repeat(left), s, " ".repeat(right))
    }
}

#[cfg(test)]
#[path = "kds_chit_tests.rs"]
mod tests;
