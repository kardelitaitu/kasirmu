use super::*;

#[test]
fn terminal_feature_override_serde_roundtrip() {
    let tfo = TerminalFeatureOverride {
        terminal_id: "t1".into(),
        feature: "gift-cards".into(),
        enabled: true,
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-07-01T12:00:00Z".into(),
    };
    let json = serde_json::to_string(&tfo).unwrap();
    let back: TerminalFeatureOverride = serde_json::from_str(&json).unwrap();
    assert_eq!(back, tfo);
}

#[test]
fn terminal_feature_override_disabled() {
    let tfo = TerminalFeatureOverride {
        terminal_id: "t2".into(),
        feature: "kds".into(),
        enabled: false,
        created_at: "2026-06-01T00:00:00Z".into(),
        updated_at: "2026-06-01T00:00:00Z".into(),
    };
    let json = serde_json::to_string(&tfo).unwrap();
    assert!(json.contains("\"enabled\":false"));
    let back: TerminalFeatureOverride = serde_json::from_str(&json).unwrap();
    assert!(!back.enabled);
    assert_eq!(back.terminal_id, "t2");
    assert_eq!(back.feature, "kds");
}

#[test]
fn terminal_feature_override_inequality() {
    let a = TerminalFeatureOverride {
        terminal_id: "t1".into(),
        feature: "gift-cards".into(),
        enabled: true,
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-01-01T00:00:00Z".into(),
    };
    let mut b = a.clone();
    b.enabled = false;
    assert_ne!(a, b);
}

#[test]
fn terminal_feature_override_different_terminal() {
    let a = TerminalFeatureOverride {
        terminal_id: "t1".into(),
        feature: "gift-cards".into(),
        enabled: true,
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-01-01T00:00:00Z".into(),
    };
    let mut b = a.clone();
    b.terminal_id = "t2".into();
    assert_ne!(a, b);
}

// ── Debug / Clone / JSON fields ─────────────────────────────

#[test]
fn terminal_feature_override_debug() {
    let tfo = TerminalFeatureOverride {
        terminal_id: "t1".into(),
        feature: "gift-cards".into(),
        enabled: true,
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-07-01T12:00:00Z".into(),
    };
    let debug = format!("{tfo:?}");
    assert!(debug.contains("t1"));
    assert!(debug.contains("gift-cards"));
}

#[test]
fn terminal_feature_override_clone_eq() {
    let a = TerminalFeatureOverride {
        terminal_id: "t1".into(),
        feature: "kds".into(),
        enabled: false,
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-01-01T00:00:00Z".into(),
    };
    let b = a.clone();
    assert_eq!(a, b);
}

#[test]
fn terminal_feature_override_json_field_names() {
    let tfo = TerminalFeatureOverride {
        terminal_id: "t1".into(),
        feature: "loyalty".into(),
        enabled: true,
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-07-01T12:00:00Z".into(),
    };
    let json = serde_json::to_value(&tfo).unwrap();
    assert_eq!(json["terminal_id"], "t1");
    assert_eq!(json["feature"], "loyalty");
    assert_eq!(json["enabled"], true);
}

#[test]
fn terminal_feature_override_empty_timestamps() {
    let tfo = TerminalFeatureOverride {
        terminal_id: "t1".into(),
        feature: "kds".into(),
        enabled: true,
        created_at: String::new(),
        updated_at: String::new(),
    };
    assert!(tfo.created_at.is_empty());
    assert!(tfo.updated_at.is_empty());
}

#[test]
fn terminal_feature_override_long_terminal_id() {
    let long_id = "t".repeat(100);
    let tfo = TerminalFeatureOverride {
        terminal_id: long_id.clone(),
        feature: "kds".into(),
        enabled: true,
        created_at: String::new(),
        updated_at: String::new(),
    };
    assert_eq!(tfo.terminal_id.len(), 100);
}

#[test]
fn terminal_feature_override_long_feature_name() {
    let long_feature = "very-long-feature-name-with-many-dashes".to_string();
    let tfo = TerminalFeatureOverride {
        terminal_id: "t1".into(),
        feature: long_feature.clone(),
        enabled: false,
        created_at: String::new(),
        updated_at: String::new(),
    };
    assert_eq!(tfo.feature, long_feature);
}

#[test]
fn terminal_feature_override_neq_when_feature_differs() {
    let a = TerminalFeatureOverride {
        terminal_id: "t1".into(),
        feature: "gift-cards".into(),
        enabled: true,
        created_at: String::new(),
        updated_at: String::new(),
    };
    let b = TerminalFeatureOverride {
        terminal_id: "t1".into(),
        feature: "kds".into(),
        enabled: true,
        created_at: String::new(),
        updated_at: String::new(),
    };
    assert_ne!(a, b);
}
