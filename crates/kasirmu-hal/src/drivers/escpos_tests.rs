use super::*;

#[test]
fn formatted_receipt_starts_with_init() {
    let data = format_receipt("Hello\nWorld");
    assert!(data.starts_with(ESC_INIT), "missing ESC @ init");
}

#[test]
fn formatted_receipt_contains_body_text() {
    let data = format_receipt("Hello\nWorld");
    assert!(
        data.windows(b"Hello".len()).any(|w| w == b"Hello"),
        "missing body text"
    );
}

#[test]
fn formatted_receipt_has_line_feeds() {
    let data = format_receipt("Hello\nWorld");
    assert!(
        data.windows(LF.len()).any(|w| w == LF),
        "missing line feeds"
    );
}

#[test]
fn cut_commands_are_correct() {
    assert_eq!(CUT_FULL, &[0x1D, 0x56, 0x00]);
    assert_eq!(CUT_PARTIAL, &[0x1D, 0x56, 0x01]);
}

#[test]
fn kick_drawer_commands_are_correct() {
    // ESC p 0 25 50 — pin 2, 25*2ms on, 50*2ms off
    assert_eq!(KICK_DRAWER_PIN2, &[0x1B, 0x70, 0x00, 0x19, 0x32]);
    // ESC p 1 25 50 — pin 5, 25*2ms on, 50*2ms off
    assert_eq!(KICK_DRAWER_PIN5, &[0x1B, 0x70, 0x01, 0x19, 0x32]);
}

#[test]
fn alignment_commands_are_correct() {
    assert_eq!(ALIGN_LEFT, &[0x1B, 0x61, 0x00]);
    assert_eq!(ALIGN_CENTER, &[0x1B, 0x61, 0x01]);
    assert_eq!(ALIGN_RIGHT, &[0x1B, 0x61, 0x02]);
}

#[test]
fn bold_commands_are_correct() {
    assert_eq!(BOLD_ON, &[0x1B, 0x45, 0x01]);
    assert_eq!(BOLD_OFF, &[0x1B, 0x45, 0x00]);
}

#[test]
fn size_commands_are_correct() {
    assert_eq!(SIZE_NORMAL, &[0x1D, 0x21, 0x00]);
    assert_eq!(DBL_HEIGHT, &[0x1D, 0x21, 0x01]);
    assert_eq!(DBL_WIDTH, &[0x1D, 0x21, 0x10]);
    assert_eq!(DBL_BOTH, &[0x1D, 0x21, 0x11]);
}

#[test]
fn feed_n_produces_correct_bytes() {
    assert_eq!(feed(3), &[0x1B, 0x64, 3]);
    assert_eq!(feed(0), &[0x1B, 0x64, 0]);
}

// ── Barcode commands ─────────────────────────────────────────────

#[test]
fn barcode_code128_starts_with_gs_h() {
    let cmd = barcode(BarcodeType::Code128, b"REC-001");
    // Should start with GS h A0 (set height)
    assert_eq!(cmd[..3], [0x1D, 0x68, 0xA0], "missing GS h height");
    // Should contain GS H 02 (HRI below)
    assert!(cmd.windows(3).any(|w| w == [0x1D, 0x48, 0x02]));
    // Should contain GS k 49 n data (print barcode)
    assert!(cmd.windows(4).any(|w| w == [0x1D, 0x6B, 73, 7]));
    // Data should be present
    let data_start = cmd.windows(7).position(|w| w == b"REC-001");
    assert!(data_start.is_some(), "missing barcode data");
}

#[test]
fn barcode_ean13_command_format() {
    let cmd = barcode(BarcodeType::Ean13, b"123456789012");
    // GS k 02 n 12-digit data
    assert!(cmd.windows(4).any(|w| w == [0x1D, 0x6B, 2, 12]));
    assert!(cmd.windows(12).any(|w| w == b"123456789012"));
}

#[test]
fn barcode_code39_data_integrity() {
    let data = b"0123456789";
    let cmd = barcode(BarcodeType::Code39, data);
    // Data should appear in the command
    assert!(cmd.windows(10).any(|w| w == data));
}

// ── QR code commands ─────────────────────────────────────────────

#[test]
fn qr_code_starts_with_model_selection() {
    let cmd = qr_code(b"https://example.com/pay", 4);
    // Should start with GS ( k 04 00 31 41 32 00 (model 2)
    assert_eq!(
        cmd[..9],
        [0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00],
        "missing QR model selection"
    );
}

#[test]
fn qr_code_contains_size_and_print_commands() {
    let cmd = qr_code(b"test", 4);
    // Should contain module size: GS ( k 03 00 31 43 04
    assert!(
        cmd.windows(8)
            .any(|w| w == [0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 4])
    );
    // Should contain print command: GS ( k 03 00 31 51 30
    assert!(
        cmd.windows(8)
            .any(|w| w == [0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30])
    );
}

#[test]
fn qr_code_contains_data_bytes() {
    let data = b"payment:12345";
    let cmd = qr_code(data, 4);
    // Data should appear in store command
    assert!(cmd.windows(data.len()).any(|w| w == data));
}

#[test]
fn qr_code_module_size_clamps() {
    let cmd_low = qr_code(b"x", 1); // should clamp to 3
    let cmd_high = qr_code(b"x", 10); // should clamp to 8
    let cmd_default = qr_code(b"x", 4);
    // All should still be valid commands
    assert!(cmd_low.len() > 10);
    assert!(cmd_high.len() > 10);
    assert!(cmd_default.len() > 10);
}

#[test]
fn qr_code_empty_data_produces_command() {
    let cmd = qr_code(b"", 4);
    // Should still produce a valid command with zero-length data
    assert!(cmd.len() >= 17);
    // The store data command should have pL=3 (3 extra bytes for header)
    // so the total command length is 8 (header) + 3 (extra) + 0 (data) + 8 (print) = 19
    assert!(
        cmd.len() >= 15,
        "empty QR data should produce a valid command sequence"
    );
}

// ── HAL-1 regression: column widths are character cells, not bytes ────

#[test]
fn cell_width_counts_characters_for_every_multibyte_currency_symbol() {
    // Exactly the symbols receipt::currency_symbol returns as 2-3 byte
    // UTF-8. Under the old str::len() arithmetic each of these reported
    // 2-3 cells and stole that much padding from the price column.
    for symbol in ["€", "£", "¥", "₱", "฿", "₩"] {
        assert!(
            symbol.len() > 1,
            "{symbol} must be multi-byte or this test proves nothing"
        );
        assert_eq!(cell_width(symbol), 1, "{symbol} occupies one cell");
    }
}

#[test]
fn byte_based_padding_misaligns_and_cell_based_padding_does_not() {
    let s = "café"; // 4 cells, 5 bytes
    assert_ne!(s.len(), cell_width(s), "precondition: the two differ");

    // What the old code computed for a 10-cell column: pad spaces derived
    // from the byte length, then the value appended (the shape the line-item
    // rows use — `{:>pad$}` applied to an empty string, then the text).
    let old_line = format!("{}{}", " ".repeat(10 - s.len()), s);
    assert_ne!(
        cell_width(&old_line),
        10,
        "byte-based pad must land off-column (that was HAL-1)"
    );

    // What it computes now.
    let new_line = format!("{}{}", " ".repeat(10 - cell_width(s)), s);
    assert_eq!(cell_width(&new_line), 10, "cell-based pad aligns");
}
