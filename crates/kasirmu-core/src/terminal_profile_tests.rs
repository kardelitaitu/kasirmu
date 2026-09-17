use super::*;

#[test]
fn terminal_profile_serde_roundtrip() {
    let profile = TerminalProfile {
        terminal_id: "t1".into(),
        profile_type: "kds_kiosk".into(),
        locked_screen: Some("kds".into()),
        updated_at: "2026-01-01T00:00:00.000Z".into(),
    };
    let json = serde_json::to_value(&profile).unwrap();
    assert_eq!(json["terminal_id"], "t1");
    assert_eq!(json["profile_type"], "kds_kiosk");
    assert_eq!(json["locked_screen"], "kds");

    let back: TerminalProfile = serde_json::from_value(json).unwrap();
    assert_eq!(back, profile);
}

#[test]
fn terminal_profile_no_locked_screen() {
    let profile = TerminalProfile {
        terminal_id: "t2".into(),
        profile_type: "counter_pos".into(),
        locked_screen: None,
        updated_at: "2026-01-01T00:00:00.000Z".into(),
    };
    let json = serde_json::to_value(&profile).unwrap();
    assert!(json["locked_screen"].is_null());
}

#[test]
fn terminal_profile_constants() {
    assert_eq!(TerminalProfile::UNRESTRICTED, "unrestricted");
    assert_eq!(TerminalProfile::COUNTER_POS, "counter_pos");
    assert_eq!(TerminalProfile::KDS_KIOSK, "kds_kiosk");
    assert_eq!(TerminalProfile::CUSTOMER_DISPLAY, "customer_display");
}

// ── All profile types serde roundtrip ───────────────────────────

#[test]
fn all_profile_types_serde_roundtrip() {
    for profile_type in &[
        TerminalProfile::UNRESTRICTED,
        TerminalProfile::COUNTER_POS,
        TerminalProfile::KDS_KIOSK,
        TerminalProfile::CUSTOMER_DISPLAY,
    ] {
        let profile = TerminalProfile {
            terminal_id: "t-test".into(),
            profile_type: (*profile_type).to_string(),
            locked_screen: None,
            updated_at: "2026-01-01T00:00:00.000Z".into(),
        };
        let json = serde_json::to_value(&profile).unwrap();
        assert_eq!(json["profile_type"], *profile_type);
        let back: TerminalProfile = serde_json::from_value(json).unwrap();
        assert_eq!(back, profile);
    }
}

// ── Profile with customer_display type ─────────────────────────

#[test]
fn customer_display_has_no_locked_screen() {
    let profile = TerminalProfile {
        terminal_id: "t3".into(),
        profile_type: TerminalProfile::CUSTOMER_DISPLAY.into(),
        locked_screen: None,
        updated_at: "2026-01-01T00:00:00.000Z".into(),
    };
    assert!(profile.locked_screen.is_none());
    assert_eq!(profile.profile_type, "customer_display");
}
