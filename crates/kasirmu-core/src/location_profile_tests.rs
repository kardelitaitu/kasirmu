use super::*;

fn default_profile() -> LocationProfile {
    LocationProfile {
        id: "default".into(),
        name: "Main Store".into(),
        address: "123 Main St".into(),
        tax_id: "TAX123".into(),
        currency: "USD".into(),
        timezone: "UTC".into(),
        is_primary: true,
        created_at: "2026-06-30T12:00:00Z".into(),
        updated_at: "2026-06-30T12:00:00Z".into(),
    }
}

#[test]
fn location_profile_has_required_fields() {
    let p = default_profile();
    assert_eq!(p.name, "Main Store");
    assert!(p.is_primary);
}

#[test]
fn location_profile_long_name() {
    let long_name = "A".repeat(255);
    let p = LocationProfile {
        name: long_name.clone(),
        ..default_profile()
    };
    assert_eq!(p.name, long_name);
}

#[test]
fn location_profile_empty_address() {
    let p = LocationProfile {
        address: String::new(),
        ..default_profile()
    };
    assert!(p.address.is_empty());
}

#[test]
fn location_profile_empty_tax_id() {
    let p = LocationProfile {
        tax_id: String::new(),
        ..default_profile()
    };
    assert!(p.tax_id.is_empty());
}

#[test]
fn location_profile_different_currencies() {
    for currency in ["USD", "EUR", "IDR", "JPY", "GBP"] {
        let p = LocationProfile {
            currency: currency.to_owned(),
            ..default_profile()
        };
        assert_eq!(p.currency, currency);
    }
}

#[test]
fn location_profile_different_timezones() {
    for tz in ["UTC", "America/New_York", "Asia/Jakarta", "Europe/London"] {
        let p = LocationProfile {
            timezone: tz.to_owned(),
            ..default_profile()
        };
        assert_eq!(p.timezone, tz);
    }
}

#[test]
fn location_profile_serde_roundtrip() {
    let p = default_profile();
    let json = serde_json::to_string(&p).unwrap();
    let back: LocationProfile = serde_json::from_str(&json).unwrap();
    assert_eq!(back, p);
}

#[test]
fn location_profile_serde_roundtrip_non_primary() {
    let p = LocationProfile {
        id: "branch-2".into(),
        name: "Branch 2".into(),
        address: String::new(),
        tax_id: String::new(),
        currency: "IDR".into(),
        timezone: "Asia/Jakarta".into(),
        is_primary: false,
        created_at: "2026-06-30T12:00:00Z".into(),
        updated_at: "2026-06-30T12:00:00Z".into(),
    };
    let json = serde_json::to_string(&p).unwrap();
    let back: LocationProfile = serde_json::from_str(&json).unwrap();
    assert_eq!(back, p);
}

#[test]
fn location_profile_serde_json_field_names() {
    let p = default_profile();
    let json = serde_json::to_value(&p).unwrap();
    assert_eq!(json["name"], "Main Store");
    assert_eq!(json["is_primary"], true);
    assert_eq!(json["currency"], "USD");
    assert_eq!(json["timezone"], "UTC");
}

#[test]
fn location_profile_debug() {
    let p = default_profile();
    assert!(!format!("{p:?}").is_empty());
}

#[test]
fn location_profile_clone_eq() {
    let a = default_profile();
    let b = a.clone();
    assert_eq!(a, b);
}

#[test]
fn location_profile_non_primary() {
    let p = LocationProfile {
        id: uuid::Uuid::now_v7().to_string(),
        name: "Branch 2".into(),
        address: String::new(),
        tax_id: String::new(),
        currency: "IDR".into(),
        timezone: "Asia/Jakarta".into(),
        is_primary: false,
        created_at: "2026-06-30T12:00:00Z".into(),
        updated_at: "2026-06-30T12:00:00Z".into(),
    };
    assert!(!p.is_primary);
    assert_eq!(p.currency, "IDR");
}

#[test]
fn location_profile_equality_depends_on_all_fields() {
    let a = default_profile();
    let b = LocationProfile {
        name: "Different Name".into(),
        ..default_profile()
    };
    assert_ne!(a, b);
}
