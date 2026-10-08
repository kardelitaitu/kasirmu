use super::*;

#[test]
fn hid_report_parses_letter() {
    // Report: no modifiers, key code 0x04 = 'a'
    let report = [0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00];
    assert_eq!(hid_report_to_char(&report), Some('a'));
}

#[test]
fn hid_report_with_shift_gives_uppercase() {
    // Report: LShift (0x02), key code 0x04 = 'A'
    let report = [0x02, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00];
    assert_eq!(hid_report_to_char(&report), Some('A'));
}

#[test]
fn hid_report_no_key_returns_none() {
    let report = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    assert_eq!(hid_report_to_char(&report), None);
}

#[test]
fn hid_report_enter_is_newline() {
    let report = [0x00, 0x00, 0x28, 0x00, 0x00, 0x00, 0x00, 0x00];
    assert_eq!(hid_report_to_char(&report), Some('\n'));
}

#[test]
fn hid_report_digit_shifted_gives_symbol() {
    // RShift (0x20), key code 0x1E = '1' → '!'
    let report = [0x20, 0x00, 0x1E, 0x00, 0x00, 0x00, 0x00, 0x00];
    assert_eq!(hid_report_to_char(&report), Some('!'));
}

#[test]
fn hid_report_space() {
    let report = [0x00, 0x00, 0x2C, 0x00, 0x00, 0x00, 0x00, 0x00];
    assert_eq!(hid_report_to_char(&report), Some(' '));
}

/// The three copies of `MAX_BARCODE_LEN` must keep the SAME unit in their prose.
///
/// WHY THIS EXISTS. The constant is defined independently in three driver modules --
/// `usb_scanner`, `bt_scanner` and `serial_scanner` -- with no shared source, so their
/// docs could drift while the VALUE agreed. They had: `usb_scanner` said "1024 chars"
/// where the other two said "1024 bytes", and the check in all three is a byte length
/// (`String::len()` for the HID path, `Vec<u8>::len()` for the two byte-buffer paths).
///
/// Harmless today -- every entry in the HID table is ASCII, so the counts coincide -- but
/// the doc is what a reader trusts, and a non-ASCII key added to that table would make
/// the two diverge under a comment denying it.
///
/// Pinned as a SOURCE assertion because the defect was in the prose, not the behaviour:
/// a byte count cannot observe a wrong unit while the inputs happen to be ASCII.
#[test]
fn max_barcode_len_docs_agree_on_the_unit_across_all_three_copies() {
    let copies = [
        ("usb_scanner.rs", include_str!("usb_scanner.rs")),
        ("bt_scanner.rs", include_str!("bt_scanner.rs")),
        ("serial_scanner.rs", include_str!("serial_scanner.rs")),
    ];

    for (name, source) in copies {
        let doc = source
            .lines()
            .find(|l| l.contains("Maximum length of a single scanned barcode"))
            .unwrap_or_else(|| panic!("{name} lost the MAX_BARCODE_LEN doc line"));
        let msg =
            format!("{name}'s MAX_BARCODE_LEN doc must state BYTES, because all three bounds are ")
                + "byte lengths (String::len() / Vec<u8>::len()); got: "
                + doc;
        assert!(doc.contains("bytes") && !doc.contains("chars"), "{msg}");
        assert!(
            source.contains("MAX_BARCODE_LEN: usize = 1024;"),
            "{name} must define MAX_BARCODE_LEN = 1024 like its two siblings"
        );
    }
}
