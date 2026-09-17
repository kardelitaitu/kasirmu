use super::*;

// ── Existing tests (preserved) ───────────────────────────────────────────────

#[test]
fn roundtrip_minimal() {
    let payload = OzpkgPayload {
        products: vec![],
        categories: vec![],
        sales: None,
        customers: None,
        users: None,
        settings: None,
    };

    let mut features = HashMap::new();
    features.insert("simple-retail".into(), "1".into());

    let exported = export_ozpkg(
        "test-password-123",
        "My Store",
        "0.0.1",
        vec!["products".into()],
        features.clone(),
        &payload,
    )
    .unwrap();

    let (header, imported) = import_ozpkg(&exported, "test-password-123").unwrap();

    assert_eq!(header.version, FORMAT_VERSION);
    assert_eq!(header.store_name, "My Store");
    assert_eq!(header.app_version, "0.0.1");
    assert_eq!(header.data_types, vec!["products"]);
    assert_eq!(header.features, features);
    assert!(imported.products.is_empty());
    assert!(imported.categories.is_empty());
    assert!(imported.sales.is_none());
}

#[test]
fn roundtrip_with_data() {
    let payload = OzpkgPayload {
        products: vec![serde_json::json!({"sku": "LATTE", "name": "Latte", "price": 450})],
        categories: vec![
            serde_json::json!({"id": "cat-drinks", "name": "Drinks", "colour": "#06b6d4"}),
        ],
        sales: Some(vec![]),
        customers: Some(vec![serde_json::json!({"id": "cust-1", "name": "Alice"})]),
        users: None,
        settings: Some(vec![
            serde_json::json!({"key": "store.name", "value": "My Store"}),
        ]),
    };

    let exported = export_ozpkg(
        "strong-password-here!",
        "My Store",
        "0.0.1",
        vec!["products".into(), "categories".into(), "customers".into()],
        HashMap::new(),
        &payload,
    )
    .unwrap();

    let (_header, imported) = import_ozpkg(&exported, "strong-password-here!").unwrap();

    assert_eq!(imported.products.len(), 1);
    assert_eq!(imported.categories.len(), 1);
    assert_eq!(imported.customers.as_ref().unwrap().len(), 1);
    assert_eq!(imported.settings.as_ref().unwrap().len(), 1);
    assert!(imported.users.is_none());
}

#[test]
fn wrong_password_fails() {
    let payload = OzpkgPayload {
        products: vec![],
        categories: vec![],
        sales: None,
        customers: None,
        users: None,
        settings: None,
    };

    let exported = export_ozpkg(
        "correct-password",
        "Store",
        "0.0.1",
        vec![],
        HashMap::new(),
        &payload,
    )
    .unwrap();

    let result = import_ozpkg(&exported, "wrong-password");
    assert!(
        result.is_err(),
        "decryption should fail with wrong password"
    );
}

#[test]
fn corrupted_data_fails() {
    let payload = OzpkgPayload {
        products: vec![],
        categories: vec![],
        sales: None,
        customers: None,
        users: None,
        settings: None,
    };

    let mut exported = export_ozpkg(
        "password",
        "Store",
        "0.0.1",
        vec![],
        HashMap::new(),
        &payload,
    )
    .unwrap();

    // Corrupt a byte in the ciphertext.
    let last = exported.len() - 1;
    exported[last] ^= 0x01;

    let result = import_ozpkg(&exported, "password");
    assert!(
        result.is_err(),
        "decryption should fail with corrupted data"
    );
}

#[test]
fn empty_password_is_refused_at_export() {
    // CONTRACT REVERSAL, recorded rather than silent. This test was added
    // as `empty_password_allowed` in 018972d5, asserting that
    // export_ozpkg("") succeeded "(though not recommended)". B50 reversed
    // that: the key is Argon2id(password, salt) and the salt ships in the
    // PLAINTEXT header, so an empty password is not a weak key - anyone
    // holding the file can derive it without guessing.
    //
    // Nothing is lost that the product ever offered: the desktop UI has
    // required >= 8 characters all along (the data-management screen),
    // and no doc or setting describes an empty password as a mode. What
    // survived was the Rust API's accident, reachable via `kasirmu-cli
    // export-ozpkg --password ""`.
    //
    // The half of the old test that still matters - import must tolerate
    // "" so backups written before this change stay restorable - is
    // pinned in ozpkg_password_tests.rs, and the round-trip for a real
    // (even one-character) password is pinned there too.
    let payload = OzpkgPayload {
        products: vec![],
        categories: vec![],
        sales: None,
        customers: None,
        users: None,
        settings: None,
    };

    let err = export_ozpkg("", "Store", "0.0.1", vec![], HashMap::new(), &payload)
        .expect_err("an empty password must not produce a backup");
    assert!(err.to_string().contains("password"), "got: {err}");
}

#[test]
fn header_metadata_preserved() {
    let payload = OzpkgPayload {
        products: vec![],
        categories: vec![],
        sales: None,
        customers: None,
        users: None,
        settings: None,
    };

    let mut features = HashMap::new();
    features.insert("cash-payment".into(), "1".into());
    features.insert("barcode-scanning".into(), "1".into());

    let exported = export_ozpkg(
        "password",
        "Test Store",
        "0.1.0",
        vec!["products".into(), "settings".into()],
        features.clone(),
        &payload,
    )
    .unwrap();

    let (header, _) = import_ozpkg(&exported, "password").unwrap();

    assert_eq!(header.store_name, "Test Store");
    assert_eq!(header.app_version, "0.1.0");
    assert_eq!(header.data_types, vec!["products", "settings"]);
    assert_eq!(header.features, features);
    assert!(!header.created_at.is_empty());
    assert!(!header.salt.is_empty());
    assert!(!header.nonce.is_empty());
}

#[test]
fn large_payload_roundtrip() {
    let products: Vec<serde_json::Value> = (0..100)
        .map(|i| {
            serde_json::json!({"sku": format!("SKU-{i:04}"), "name": format!("Product {i}"), "price": 100 + i})
        })
        .collect();

    let payload = OzpkgPayload {
        products: products.clone(),
        categories: vec![],
        sales: None,
        customers: None,
        users: None,
        settings: None,
    };

    let exported = export_ozpkg(
        "large-payload-password",
        "Big Store",
        "0.0.1",
        vec!["products".into()],
        HashMap::new(),
        &payload,
    )
    .unwrap();

    let (_header, imported) = import_ozpkg(&exported, "large-payload-password").unwrap();

    assert_eq!(imported.products.len(), 100);
    assert_eq!(imported.products[0]["sku"], "SKU-0000");
    assert_eq!(imported.products[99]["sku"], "SKU-0099");
}

fn empty_payload() -> OzpkgPayload {
    OzpkgPayload {
        products: vec![],
        categories: vec![],
        sales: None,
        customers: None,
        users: None,
        settings: None,
    }
}

#[test]
fn export_with_typical_enabled_flags_errors_instead_of_truncating() {
    let mut features = HashMap::new();
    for i in 0..16 {
        features.insert(format!("feature.pos.module_{i:02}"), "1".to_string());
    }
    let err = export_ozpkg(
        "password",
        "Kopi Senja",
        "0.0.33",
        vec!["products".to_string(), "categories".to_string()],
        features,
        &empty_payload(),
    )
    .expect_err("a header past HEADER_LEN must not be written as a truncated archive");
    let msg = err.to_string();
    assert!(
        msg.contains("512") && msg.contains("header"),
        "error should name the limit so the operator can act: {msg}"
    );
}

#[test]
fn export_with_oversized_store_name_errors_instead_of_truncating() {
    let long_name = "Toko ".repeat(100); // ~600 chars, well past HEADER_LEN
    let err = export_ozpkg(
        "password",
        &long_name,
        "0.0.33",
        vec!["products".to_string()],
        HashMap::new(),
        &empty_payload(),
    )
    .expect_err("a store name past HEADER_LEN must fail, not truncate");
    assert!(
        err.to_string().contains("512"),
        "error should name the limit: {err}"
    );
}

#[test]
fn export_with_header_under_the_budget_still_roundtrips() {
    let name = "a".repeat(200);
    let exported = export_ozpkg(
        "password",
        &name,
        "0.0.33",
        vec!["products".to_string()],
        HashMap::new(),
        &empty_payload(),
    )
    .expect("a header comfortably under HEADER_LEN must export");
    let (header, _) = import_ozpkg(&exported, "password").unwrap();
    assert_eq!(header.store_name, name);
}

/// Patch bytes inside the archive in place.
///
/// The header-integrity tests below use SAME-LENGTH substitutions so the
/// header JSON stays parseable — that is the whole point, since a parse
/// failure would prove nothing about authentication. Tests that
/// deliberately corrupt the header are fine with the length changing; a
/// longer replacement just overwrites following padding inside the fixed
/// HEADER_LEN block.
fn find_and_replace(bytes: &mut [u8], from: &[u8], to: &[u8]) {
    let pos = bytes
        .windows(from.len())
        .position(|w| w == from)
        .unwrap_or_else(|| {
            panic!(
                "needle not found in header: {}",
                String::from_utf8_lossy(from)
            )
        });
    assert!(
        pos + to.len() <= bytes.len(),
        "replacement must fit inside the buffer"
    );
    bytes[pos..pos + to.len()].copy_from_slice(to);
}

#[test]
fn tampering_with_the_header_store_name_is_detected() {
    let exported = export_ozpkg(
        "password",
        "Kopi Senja",
        "0.0.33",
        vec!["products".to_string()],
        HashMap::new(),
        &empty_payload(),
    )
    .unwrap();

    let mut tampered = exported.clone();
    find_and_replace(&mut tampered, b"Kopi Senja", b"Loka Datar");

    import_ozpkg(&tampered, "password")
        .expect_err("a rewritten header must not import as if it were authentic");
}

#[test]
fn tampering_with_the_header_feature_flags_is_detected() {
    let mut features = HashMap::new();
    features.insert("feature.pos.finance".to_string(), "yes".to_string());
    let exported = export_ozpkg(
        "password",
        "Kopi Senja",
        "0.0.33",
        vec!["products".to_string()],
        features,
        &empty_payload(),
    )
    .unwrap();

    let mut tampered = exported.clone();
    find_and_replace(
        &mut tampered,
        br#""feature.pos.finance":"yes""#,
        br#""feature.pos.finance":"no!""#,
    );

    import_ozpkg(&tampered, "password")
        .expect_err("flipping a feature flag in the plaintext header must be detected");
}

fn build_v1_archive(password: &str, store_name: &str, payload: &OzpkgPayload) -> Vec<u8> {
    let salt = [7u8; SALT_LEN];
    let nonce_bytes = [3u8; NONCE_LEN];

    let mut key = [0u8; KEY_LEN];
    Argon2::new(
        argon2::Algorithm::Argon2id,
        argon2::Version::V0x13,
        argon2::Params::new(
            ARGON_MEMORY,
            ARGON_ITERATIONS,
            ARGON_PARALLELISM,
            Some(KEY_LEN),
        )
        .expect("valid argon2 params"),
    )
    .hash_password_into(password.as_bytes(), &salt, &mut key)
    .expect("argon2 derive");

    let payload_json = serde_json::to_vec(payload).expect("serialize payload");
    let compressed = zstd::encode_all(std::io::Cursor::new(&payload_json), 3).expect("zstd");

    let cipher = Aes256Gcm::new_from_slice(&key).expect("aes key");
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), compressed.as_ref())
        .expect("v1 encrypt");

    let header = OzpkgHeader {
        version: 1,
        store_name: store_name.to_owned(),
        app_version: "0.0.33".to_owned(),
        created_at: "2026-08-30T00:00:00Z".to_owned(),
        data_types: vec!["products".to_string()],
        salt: hex::encode(salt),
        nonce: hex::encode(nonce_bytes),
        features: HashMap::new(),
    };
    let header_json = serde_json::to_vec(&header).expect("serialize header");
    assert!(header_json.len() <= HEADER_LEN);

    let mut out = vec![b' '; HEADER_LEN];
    out[..header_json.len()].copy_from_slice(&header_json);
    out.extend_from_slice(&ciphertext);
    out
}

#[test]
fn a_v1_archive_written_before_the_header_binding_still_imports() {
    let payload = OzpkgPayload {
        products: vec![serde_json::json!({"sku": "LATTE"})],
        categories: vec![],
        sales: None,
        customers: None,
        users: None,
        settings: None,
    };
    let archive = build_v1_archive("password", "Legacy Store", &payload);

    let (header, imported) = import_ozpkg(&archive, "password")
        .expect("a v1 backup must stay readable after the v2 format lands");
    assert_eq!(header.version, 1);
    assert_eq!(header.store_name, "Legacy Store");
    assert_eq!(imported.products.len(), 1);

    import_ozpkg(&archive, "not-the-password")
        .expect_err("v1 compat must still reject a wrong password");
}

#[test]
fn an_untampered_archive_still_imports_after_the_header_is_bound() {
    let mut features = HashMap::new();
    features.insert("feature.pos.finance".to_string(), "1".to_string());
    let exported = export_ozpkg(
        "password",
        "Kopi Senja",
        "0.0.33",
        vec!["products".to_string()],
        features.clone(),
        &empty_payload(),
    )
    .unwrap();
    let (header, _) = import_ozpkg(&exported, "password").unwrap();
    assert_eq!(header.store_name, "Kopi Senja");
    assert_eq!(header.features, features);
}

// ═══════════════════════════════════════════════════════════════════════════════
// NEW TESTS: error paths, edge cases, and struct serde
// ═══════════════════════════════════════════════════════════════════════════════

// ── import_ozpkg error paths ─────────────────────────────────────────────────

#[test]
fn import_too_short_data_fails() {
    let result = import_ozpkg(&[0u8; 10], "password");
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("too short"),
        "error should mention file too short: {msg}"
    );
}

#[test]
fn import_empty_data_fails() {
    let result = import_ozpkg(&[], "password");
    assert!(result.is_err());
}

#[test]
fn import_exactly_header_len_with_invalid_json_fails() {
    // 512 bytes of garbage — valid length but not valid JSON header
    let mut data = vec![b'x'; HEADER_LEN];
    data.extend_from_slice(&[0u8; 32]); // dummy ciphertext
    let result = import_ozpkg(&data, "password");
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("invalid header"),
        "error should mention invalid header: {msg}"
    );
}

#[test]
fn import_unsupported_version_fails() {
    // Craft a header with version=9 by replacing '2' with '9' (same length).
    // This makes the JSON say "version":9 which is unsupported.
    let exported = export_ozpkg(
        "password",
        "Store",
        "0.0.1",
        vec![],
        HashMap::new(),
        &empty_payload(),
    )
    .unwrap();

    let mut data = exported;
    // Replace the version value '2' with '9' — same length, valid JSON
    find_and_replace(&mut data, b"\"version\":2", b"\"version\":9");

    let result = import_ozpkg(&data, "password");
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("unsupported format version") || msg.contains("version"),
        "error should mention unsupported version: {msg}"
    );
}

#[test]
fn import_invalid_salt_hex_fails() {
    let exported = export_ozpkg(
        "password",
        "Store",
        "0.0.1",
        vec![],
        HashMap::new(),
        &empty_payload(),
    )
    .unwrap();

    let mut data = exported;
    // Find the salt field and corrupt one hex char
    let header_str = String::from_utf8_lossy(&data[..HEADER_LEN]).to_string();
    let salt_start = header_str.find("\"salt\":\"").unwrap() + 8;
    data[salt_start] = b'g'; // 'g' is not valid hex

    let result = import_ozpkg(&data, "password");
    assert!(result.is_err(), "invalid salt hex should fail");
}

#[test]
fn import_invalid_nonce_hex_fails() {
    let exported = export_ozpkg(
        "password",
        "Store",
        "0.0.1",
        vec![],
        HashMap::new(),
        &empty_payload(),
    )
    .unwrap();

    let mut data = exported;
    // Find the nonce field and corrupt one hex char
    let header_str = String::from_utf8_lossy(&data[..HEADER_LEN]).to_string();
    let nonce_start = header_str.find("\"nonce\":\"").unwrap() + 8;
    data[nonce_start] = b'g'; // 'g' is not valid hex

    let result = import_ozpkg(&data, "password");
    assert!(result.is_err(), "invalid nonce should fail");
}

// ── Struct serde roundtrip ───────────────────────────────────────────────────

#[test]
fn ozpkg_header_serde_roundtrip() {
    let header = OzpkgHeader {
        version: 2,
        store_name: "Test Store".to_string(),
        app_version: "0.0.33".to_string(),
        created_at: "2026-08-31T00:00:00Z".to_string(),
        data_types: vec!["products".to_string(), "categories".to_string()],
        salt: "a".repeat(32),
        nonce: "b".repeat(24),
        features: {
            let mut m = HashMap::new();
            m.insert("key".to_string(), "value".to_string());
            m
        },
    };

    let json = serde_json::to_string(&header).unwrap();
    let parsed: OzpkgHeader = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed.version, 2);
    assert_eq!(parsed.store_name, "Test Store");
    assert_eq!(parsed.app_version, "0.0.33");
    assert_eq!(parsed.created_at, "2026-08-31T00:00:00Z");
    assert_eq!(parsed.data_types, vec!["products", "categories"]);
    assert_eq!(parsed.salt, "a".repeat(32));
    assert_eq!(parsed.nonce, "b".repeat(24));
    assert_eq!(parsed.features.get("key").unwrap(), "value");
}

#[test]
fn ozpkg_payload_serde_roundtrip_with_all_fields() {
    let payload = OzpkgPayload {
        products: vec![serde_json::json!({"sku": "A"})],
        categories: vec![serde_json::json!({"id": "B"})],
        sales: Some(vec![serde_json::json!({"id": "S1"})]),
        customers: Some(vec![serde_json::json!({"id": "C1"})]),
        users: Some(vec![serde_json::json!({"id": "U1"})]),
        settings: Some(vec![serde_json::json!({"key": "k", "value": "v"})]),
    };

    let json = serde_json::to_string(&payload).unwrap();
    let parsed: OzpkgPayload = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed.products.len(), 1);
    assert_eq!(parsed.categories.len(), 1);
    assert!(parsed.sales.is_some());
    assert!(parsed.customers.is_some());
    assert!(parsed.users.is_some());
    assert!(parsed.settings.is_some());
}

#[test]
fn ozpkg_payload_serde_skips_none_fields() {
    let payload = OzpkgPayload {
        products: vec![],
        categories: vec![],
        sales: None,
        customers: None,
        users: None,
        settings: None,
    };

    let json = serde_json::to_string(&payload).unwrap();
    assert!(!json.contains("sales"), "None sales should be skipped");
    assert!(
        !json.contains("customers"),
        "None customers should be skipped"
    );
    assert!(!json.contains("users"), "None users should be skipped");
    assert!(
        !json.contains("settings"),
        "None settings should be skipped"
    );
    // products and categories are always present (not Option)
    assert!(json.contains("products"));
    assert!(json.contains("categories"));
}

#[test]
fn ozpkg_header_debug_and_clone() {
    let header = OzpkgHeader {
        version: 2,
        store_name: "Store".to_string(),
        app_version: "0.0.1".to_string(),
        created_at: "2026-01-01T00:00:00Z".to_string(),
        data_types: vec![],
        salt: "a".repeat(32),
        nonce: "b".repeat(24),
        features: HashMap::new(),
    };

    let cloned = header.clone();
    assert_eq!(cloned.store_name, "Store");

    let debug = format!("{header:?}");
    assert!(debug.contains("OzpkgHeader"));
    assert!(debug.contains("Store"));
}

#[test]
fn ozpkg_payload_debug_and_clone() {
    let payload = empty_payload();
    let cloned = payload.clone();
    assert!(cloned.products.is_empty());

    let debug = format!("{payload:?}");
    assert!(debug.contains("OzpkgPayload"));
}

// ── Edge cases ───────────────────────────────────────────────────────────────

#[test]
fn unicode_store_name_roundtrip() {
    let name = "Toko Kopi ☕ Senja";
    let exported = export_ozpkg(
        "password",
        name,
        "0.0.33",
        vec![],
        HashMap::new(),
        &empty_payload(),
    )
    .unwrap();
    let (header, _) = import_ozpkg(&exported, "password").unwrap();
    assert_eq!(header.store_name, name);
}

#[test]
fn unicode_password_roundtrip() {
    let password = "pässwörd日本語🔑";
    let exported = export_ozpkg(
        password,
        "Store",
        "0.0.33",
        vec![],
        HashMap::new(),
        &empty_payload(),
    )
    .unwrap();
    let result = import_ozpkg(&exported, password);
    assert!(result.is_ok(), "unicode password should work");
}

#[test]
fn unicode_in_payload_roundtrip() {
    let payload = OzpkgPayload {
        products: vec![serde_json::json!({
            "sku": "KOPI-01",
            "name": "Kopi Susu Panas ☕",
            "description": "いりこだし"
        })],
        categories: vec![serde_json::json!({
            "id": "minuman",
            "name": "Minuman"
        })],
        sales: None,
        customers: Some(vec![serde_json::json!({
            "id": "cust-1",
            "name": "田中太郎"
        })]),
        users: None,
        settings: None,
    };

    let exported = export_ozpkg(
        "password",
        "Store",
        "0.0.33",
        vec!["products".into()],
        HashMap::new(),
        &payload,
    )
    .unwrap();

    let (_, imported) = import_ozpkg(&exported, "password").unwrap();
    assert_eq!(imported.products[0]["name"], "Kopi Susu Panas ☕");
    assert_eq!(imported.products[0]["description"], "いりこだし");
    assert_eq!(imported.customers.as_ref().unwrap()[0]["name"], "田中太郎");
}

#[test]
fn payload_with_all_optional_fields_some() {
    let payload = OzpkgPayload {
        products: vec![serde_json::json!({"sku": "A", "price": 100})],
        categories: vec![serde_json::json!({"id": "cat-1"})],
        sales: Some(vec![
            serde_json::json!({"id": "s1", "total": 500}),
            serde_json::json!({"id": "s2", "total": 300}),
        ]),
        customers: Some(vec![serde_json::json!({"id": "c1"})]),
        users: Some(vec![serde_json::json!({"id": "u1", "role": "admin"})]),
        settings: Some(vec![
            serde_json::json!({"key": "store.name", "value": "My Store"}),
            serde_json::json!({"key": "tax.rate", "value": "0.11"}),
        ]),
    };

    let exported = export_ozpkg(
        "password",
        "Store",
        "0.0.33",
        vec![
            "products".into(),
            "sales".into(),
            "customers".into(),
            "users".into(),
            "settings".into(),
        ],
        HashMap::new(),
        &payload,
    )
    .unwrap();

    let (_, imported) = import_ozpkg(&exported, "password").unwrap();
    assert_eq!(imported.products.len(), 1);
    assert_eq!(imported.categories.len(), 1);
    assert_eq!(imported.sales.as_ref().unwrap().len(), 2);
    assert_eq!(imported.customers.as_ref().unwrap().len(), 1);
    assert_eq!(imported.users.as_ref().unwrap().len(), 1);
    assert_eq!(imported.settings.as_ref().unwrap().len(), 2);
}

#[test]
fn empty_data_types_roundtrip() {
    let exported = export_ozpkg(
        "password",
        "Store",
        "0.0.1",
        vec![], // empty data_types
        HashMap::new(),
        &empty_payload(),
    )
    .unwrap();

    let (header, _) = import_ozpkg(&exported, "password").unwrap();
    assert!(header.data_types.is_empty());
}

#[test]
fn many_data_types_roundtrip() {
    let types: Vec<String> = (0..20).map(|i| format!("type_{i}")).collect();
    let exported = export_ozpkg(
        "password",
        "Store",
        "0.0.1",
        types.clone(),
        HashMap::new(),
        &empty_payload(),
    )
    .unwrap();

    let (header, _) = import_ozpkg(&exported, "password").unwrap();
    assert_eq!(header.data_types, types);
}

#[test]
fn many_feature_flags_roundtrip() {
    let mut features = HashMap::new();
    for i in 0..10 {
        features.insert(format!("feature.flag_{i}"), format!("value_{i}"));
    }

    let exported = export_ozpkg(
        "password",
        "Store",
        "0.0.1",
        vec![],
        features.clone(),
        &empty_payload(),
    )
    .unwrap();

    let (header, _) = import_ozpkg(&exported, "password").unwrap();
    assert_eq!(header.features, features);
}

#[test]
fn export_output_size_is_header_plus_ciphertext() {
    let exported = export_ozpkg(
        "password",
        "Store",
        "0.0.1",
        vec![],
        HashMap::new(),
        &empty_payload(),
    )
    .unwrap();

    // Output must be exactly HEADER_LEN + ciphertext_len
    assert!(
        exported.len() > HEADER_LEN,
        "must have ciphertext after header"
    );
    // AES-GCM ciphertext = plaintext + 16-byte tag
    let ciphertext_len = exported.len() - HEADER_LEN;
    assert!(ciphertext_len >= 16, "ciphertext must include GCM tag");
}

#[test]
fn header_json_fits_in_fixed_block() {
    // The header JSON must always fit in HEADER_LEN bytes
    let exported = export_ozpkg(
        "password",
        "Store",
        "0.0.33",
        vec!["products".into()],
        HashMap::new(),
        &empty_payload(),
    )
    .unwrap();

    // First HEADER_LEN bytes should be valid JSON (after trimming spaces)
    let header_bytes = &exported[..HEADER_LEN];
    let trimmed_len = header_bytes
        .iter()
        .rposition(|&b| b != b' ')
        .map(|pos| pos + 1)
        .unwrap_or(0);

    let result: Result<OzpkgHeader, _> = serde_json::from_slice(&header_bytes[..trimmed_len]);
    assert!(result.is_ok(), "header block must be valid JSON");
}

#[test]
fn salt_and_nonce_are_hex_encoded() {
    let exported = export_ozpkg(
        "password",
        "Store",
        "0.0.1",
        vec![],
        HashMap::new(),
        &empty_payload(),
    )
    .unwrap();

    let (header, _) = import_ozpkg(&exported, "password").unwrap();

    // Salt should be 32 hex chars (16 bytes)
    assert_eq!(header.salt.len(), SALT_LEN * 2);
    assert!(hex::decode(&header.salt).is_ok(), "salt must be valid hex");

    // Nonce should be 24 hex chars (12 bytes)
    assert_eq!(header.nonce.len(), NONCE_LEN * 2);
    assert!(
        hex::decode(&header.nonce).is_ok(),
        "nonce must be valid hex"
    );
}

#[test]
fn each_export_uses_unique_salt_and_nonce() {
    let make_export = || {
        export_ozpkg(
            "password",
            "Store",
            "0.0.1",
            vec![],
            HashMap::new(),
            &empty_payload(),
        )
        .unwrap()
    };

    let a = make_export();
    let b = make_export();

    let (header_a, _) = import_ozpkg(&a, "password").unwrap();
    let (header_b, _) = import_ozpkg(&b, "password").unwrap();

    assert_ne!(
        header_a.salt, header_b.salt,
        "each export must use unique salt"
    );
    assert_ne!(
        header_a.nonce, header_b.nonce,
        "each export must use unique nonce"
    );
}

#[test]
fn format_version_constant_is_v2() {
    assert_eq!(FORMAT_VERSION, 2, "export must write format v2");
}

#[test]
fn created_at_is_valid_iso8601() {
    let exported = export_ozpkg(
        "password",
        "Store",
        "0.0.1",
        vec![],
        HashMap::new(),
        &empty_payload(),
    )
    .unwrap();

    let (header, _) = import_ozpkg(&exported, "password").unwrap();

    // Should parse as RFC 3339 / ISO 8601
    assert!(
        chrono::DateTime::parse_from_rfc3339(&header.created_at).is_ok(),
        "created_at must be valid RFC 3339, got: {}",
        header.created_at
    );
}
