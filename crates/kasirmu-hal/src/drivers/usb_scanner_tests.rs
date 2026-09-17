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
