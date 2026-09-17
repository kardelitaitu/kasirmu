use super::*;
use kasirmu_core::features::feature_key;

#[test]
fn feature_dto_debug_output() {
    let dto = FeatureDto {
        key: "cash-payment".into(),
        name: "Cash Payment",
        description: "Accept cash",
        group: "Payments",
        enabled: true,
        dependencies: vec![],
    };
    let debug = format!("{:?}", dto);
    assert!(debug.contains("Cash Payment"));
}

#[test]
fn feature_dto_serialize_json() {
    let dto = FeatureDto {
        key: "card-payment".into(),
        name: "Card Payment",
        description: "Credit/debit",
        group: "Payments",
        enabled: false,
        dependencies: vec!["cash-payment".into()],
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["key"], "card-payment");
    assert_eq!(json["name"], "Card Payment");
    assert!(!json["enabled"].as_bool().unwrap());
    assert_eq!(json["dependencies"][0], "cash-payment");
}

#[test]
fn set_feature_args_deserialize() {
    let json = r#"{"key":"barcode-scanning","enabled":true}"#;
    let args: SetFeatureArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.key, "barcode-scanning");
    assert!(args.enabled);
}

#[test]
fn set_feature_args_debug() {
    let args = SetFeatureArgs {
        key: "tax-engine".into(),
        enabled: false,
    };
    let debug = format!("{:?}", args);
    assert!(debug.contains("tax-engine"));
}

// ── SetFeaturesBulkArgs ──────────────────────────────────────

#[test]
fn set_features_bulk_args_deserialize() {
    let json = r#"{"keys": ["simple-retail", "cash-payment"], "enabled": true}"#;
    let args: SetFeaturesBulkArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.keys.len(), 2);
    assert_eq!(args.keys[0], "simple-retail");
    assert_eq!(args.keys[1], "cash-payment");
    assert!(args.enabled);
}

#[test]
fn set_features_bulk_args_deserialize_disable() {
    let json = r#"{"keys": ["kitchen-display"], "enabled": false}"#;
    let args: SetFeaturesBulkArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.keys.len(), 1);
    assert_eq!(args.keys[0], "kitchen-display");
    assert!(!args.enabled);
}

#[test]
fn set_features_bulk_args_empty_keys() {
    let json = r#"{"keys": [], "enabled": true}"#;
    let args: SetFeaturesBulkArgs = serde_json::from_str(json).unwrap();
    assert!(args.keys.is_empty());
    assert!(args.enabled);
}

#[test]
fn set_features_bulk_args_debug() {
    let args = SetFeaturesBulkArgs {
        keys: vec!["hardware".into()],
        enabled: false,
    };
    let debug = format!("{:?}", args);
    assert!(debug.contains("hardware"));
    assert!(debug.contains("false"));
}

#[test]
fn set_feature_result_debug() {
    let result = SetFeatureResult {
        success: true,
        features: vec![],
        auto_enabled: vec![],
    };
    let debug = format!("{:?}", result);
    assert!(debug.contains("true"));
}

#[test]
fn list_all_features_result_serialize() {
    let result = ListAllFeaturesResult { features: vec![] };
    let json = serde_json::to_value(&result).unwrap();
    assert!(json["features"].as_array().unwrap().is_empty());
}

#[test]
fn all_feature_metadata_non_empty() {
    let meta = all_feature_metadata();
    assert!(!meta.is_empty());
}

#[test]
fn all_feature_metadata_no_duplicate_keys() {
    let meta = all_feature_metadata();
    let mut keys: Vec<String> = meta
        .iter()
        .map(|(f, _, _, _)| feature_key(*f).to_string())
        .collect();
    keys.sort();
    let len_before = keys.len();
    keys.dedup();
    assert_eq!(keys.len(), len_before, "duplicate feature keys found");
}
