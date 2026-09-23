use super::*;

#[test]
fn encrypt_decrypt_roundtrip() {
    let plaintext = "my-secret-api-key-12345";
    let machine_id = "test-machine-uuid";
    let encrypted = encrypt_api_key(plaintext, machine_id).unwrap();
    assert_ne!(encrypted, plaintext);
    let decrypted = decrypt_api_key(&encrypted, machine_id).unwrap();
    assert_eq!(decrypted, plaintext);
}

#[test]
fn wrong_machine_id_fails() {
    let plaintext = "secret";
    let encrypted = encrypt_api_key(plaintext, "machine-a").unwrap();
    let result = decrypt_api_key(&encrypted, "machine-b");
    assert!(result.is_err());
}

#[test]
fn static_key_roundtrip() {
    let plaintext = "sync-api-key-value";
    let encrypted = encrypt_sync_api_key(plaintext).unwrap();
    assert_ne!(encrypted, plaintext);
    let decrypted = decrypt_sync_api_key(&encrypted).unwrap();
    assert_eq!(decrypted, plaintext);
}

#[test]
fn smtp_at_rest_roundtrip() {
    let password = "smtp-password-123";
    // F-029: now Result — encrypt failure must not fall back to plaintext.
    let encrypted = encrypt_smtp_at_rest(password).unwrap();
    assert_ne!(encrypted, password);
    let decrypted = decrypt_smtp_at_rest(&encrypted).unwrap();
    assert_eq!(decrypted, password);
}

#[test]
fn smtp_password_legacy_plaintext_passthrough() {
    // Legacy plaintext (not encrypted) should pass through unchanged.
    let legacy = "plaintext-password";
    let result = decrypt_smtp_password(legacy, "machine-id").unwrap();
    assert_eq!(result, legacy);
}

#[test]
fn profile_field_roundtrip() {
    let field = "sensitive-national-id";
    let encrypted = encrypt_profile_field(field).unwrap();
    let decrypted = decrypt_profile_field(&encrypted).unwrap();
    assert_eq!(decrypted, field);
}

#[test]
fn corrupted_ciphertext_fails() {
    let result = decrypt_api_key("not-valid-base64!!!", "machine-id");
    assert!(result.is_err());
}

#[test]
fn too_short_ciphertext_fails() {
    // base64 of 5 bytes (< 12 + 16 minimum)
    let short = base64_encode(&[1, 2, 3, 4, 5]);
    let result = decrypt_api_key(&short, "machine-id");
    assert!(result.is_err());
}

#[test]
fn domain_separation() {
    let plaintext = "shared-value";
    let machine_id = "same-machine";
    let api_encrypted = encrypt_api_key(plaintext, machine_id).unwrap();
    let smtp_encrypted = encrypt_smtp_password(plaintext, machine_id).unwrap();
    // Different domains produce different ciphertexts
    assert_ne!(api_encrypted, smtp_encrypted);
    // Each decrypts with its own key only
    assert_eq!(
        decrypt_api_key(&api_encrypted, machine_id).unwrap(),
        plaintext
    );
    assert_eq!(
        decrypt_smtp_password(&smtp_encrypted, machine_id).unwrap(),
        plaintext
    );
}

#[test]
fn all_secret_types_roundtrip() {
    let val = "test-value";
    let machine = "test-machine";

    // Machine-bound
    assert_eq!(
        decrypt_api_key(&encrypt_api_key(val, machine).unwrap(), machine).unwrap(),
        val
    );
    assert_eq!(
        decrypt_smtp_password(&encrypt_smtp_password(val, machine).unwrap(), machine).unwrap(),
        val
    );

    // Static key
    assert_eq!(
        decrypt_sync_api_key(&encrypt_sync_api_key(val).unwrap()).unwrap(),
        val
    );
    assert_eq!(
        decrypt_sync_terminal_secret(&encrypt_sync_terminal_secret(val).unwrap()).unwrap(),
        val
    );
    assert_eq!(
        decrypt_pg_sync_password(&encrypt_pg_sync_password(val).unwrap()).unwrap(),
        val
    );
    assert_eq!(
        decrypt_rate_api_key(&encrypt_rate_api_key(val).unwrap()).unwrap(),
        val
    );
    assert_eq!(
        decrypt_lan_psk(&encrypt_lan_psk(val).unwrap()).unwrap(),
        val
    );
    assert_eq!(
        decrypt_profile_field(&encrypt_profile_field(val).unwrap()).unwrap(),
        val
    );
}

// ── F-029: master-key portable derivation ─────────────────────────

#[test]
fn master_key_overrides_portable_derivation() {
    let master = Some([0x42u8; 32]);
    // Under a master key the portable key differs from the public
    // static derivation; without one it is byte-identical to legacy.
    let with_master = portable_key_with(SMTP_AT_REST_DOMAIN, &master, derive_static_key);
    let legacy = portable_key_with(SMTP_AT_REST_DOMAIN, &None, derive_static_key);
    assert_ne!(with_master, legacy);
    assert_eq!(legacy, derive_static_key(SMTP_AT_REST_DOMAIN));

    // Same override applies to the "static"-machine-id families.
    let sync_master = portable_key_with(SYNC_API_KEY_DOMAIN, &master, |d| derive_key(d, "static"));
    let sync_legacy = portable_key_with(SYNC_API_KEY_DOMAIN, &None, |d| derive_key(d, "static"));
    assert_ne!(sync_master, sync_legacy);
    assert_eq!(sync_legacy, derive_key(SYNC_API_KEY_DOMAIN, "static"));

    // Two different domains under the same master still differ
    // (domain separation survives the HMAC step).
    assert_ne!(
        portable_key_with(SMTP_AT_REST_DOMAIN, &master, derive_static_key),
        portable_key_with(PROFILE_AT_REST_DOMAIN, &master, derive_static_key)
    );
}

#[test]
fn master_key_sealed_roundtrip() {
    // End-to-end: values written under a master key decrypt under it.
    let master = Some([0x11u8; 32]);
    let key = portable_key_with(SMTP_AT_REST_DOMAIN, &master, derive_static_key);
    let encrypted = encrypt("smtp-secret", &key).unwrap();
    let decrypted = decrypt(&encrypted, &key).unwrap();
    assert_eq!(decrypted, "smtp-secret");
}

// ── F-029: fail-closed SMTP at-rest paths ─────────────────────────

#[test]
fn encrypt_smtp_at_rest_is_result_and_roundtrips() {
    let encrypted = encrypt_smtp_at_rest("smtp-password-123").unwrap();
    assert_ne!(encrypted, "smtp-password-123");
    assert_eq!(
        decrypt_smtp_at_rest(&encrypted).unwrap(),
        "smtp-password-123"
    );
}

#[test]
fn decrypt_smtp_at_rest_distinguishes_legacy_from_tamper() {
    // Legacy plaintext (not our format) passes through.
    assert_eq!(
        decrypt_smtp_at_rest("plaintext-legacy").unwrap(),
        "plaintext-legacy"
    );
    // Well-formed ciphertext with a corrupted tag is tampering, NOT
    // legacy — it must error instead of returning the ciphertext.
    let encrypted = encrypt_smtp_at_rest("real-secret").unwrap();
    let mut bytes = encrypted.into_bytes();
    bytes[5] = if bytes[5] == b'A' { b'B' } else { b'A' };
    let corrupted = String::from_utf8(bytes).unwrap();
    let err = decrypt_smtp_at_rest(&corrupted).expect_err("tampered ciphertext must fail closed");
    assert!(err.to_string().contains("decryption failed"));
}

#[test]
fn decrypt_smtp_password_distinguishes_legacy_from_tamper() {
    // Legacy plaintext passes through (existing behaviour).
    assert_eq!(
        decrypt_smtp_password("plaintext-legacy", "machine").unwrap(),
        "plaintext-legacy"
    );
    // Tampered well-formed ciphertext errors (old code returned it
    // unchanged, indistinguishable from a successful decrypt).
    let encrypted = encrypt_smtp_password("real-password", "machine").unwrap();
    let mut bytes = encrypted.into_bytes();
    bytes[5] = if bytes[5] == b'A' { b'B' } else { b'A' };
    let corrupted = String::from_utf8(bytes).unwrap();
    assert!(decrypt_smtp_password(&corrupted, "machine").is_err());
}

#[test]
fn looks_like_ciphertext_shape_gate() {
    assert!(!looks_like_ciphertext("plaintext-legacy"));
    assert!(!looks_like_ciphertext(""));
    let encrypted = encrypt_api_key("x", "machine").unwrap();
    assert!(looks_like_ciphertext(&encrypted));
}
// ── Derivation-selection report ──────────────────────────────────────

// Truth table for the selection answer, exercised WITHOUT touching the process
// environment: every other test in this binary calls `portable_key`, which
// reads OZ_MASTER_KEY, so a set_var here would race them.
fn selection_from_raw(raw: Option<String>) -> bool {
    match raw {
        Some(v) => hex::decode(v.trim())
            .map(|b| b.len() == 32)
            .unwrap_or(false),
        None => false,
    }
}

#[test]
fn selection_reports_only_usable_master_values() {
    let valid = "ab".repeat(32);
    assert!(
        !selection_from_raw(None),
        "unset must report the legacy selection"
    );
    assert!(
        !selection_from_raw(Some(String::new())),
        "empty must not count as set"
    );
    assert!(
        !selection_from_raw(Some("nope".into())),
        "non-hex must not count"
    );
    assert!(
        !selection_from_raw(Some(valid[..62].into())),
        "31 bytes is not a master key"
    );
    assert!(
        !selection_from_raw(Some(valid.clone() + "ab")),
        "33 bytes is not a master key"
    );
    assert!(
        selection_from_raw(Some(valid.clone())),
        "64 hex chars is the master selection"
    );
    assert!(
        selection_from_raw(Some("  ".to_string() + &valid + "  ")),
        "whitespace is trimmed by the same reader the derivation uses"
    );
}

/// The report and the derivation must never disagree: the accessor calls the
/// very reader `portable_key` branches on, so drift is a test failure rather
/// than an operator misdiagnosis.
#[test]
fn accessor_agrees_with_the_reader_the_derivation_uses() {
    assert_eq!(
        master_key_derivation_active(),
        master_key_from_env().is_some(),
        "the selection report must be the derivation own answer"
    );
    assert_eq!(
        master_key_derivation_active(),
        selection_from_raw(std::env::var("OZ_MASTER_KEY").ok()),
        "the selection report must match the value it describes"
    );
}

// ── Branch-tolerant reads ───────────────────────────────────────────

/// A row is accepted under whichever candidate key authenticates it, and
/// the try order does not decide the answer: the legacy key first or last
/// both open a legacy row. Exercised with explicit key lists rather than
/// through `candidate_keys`, which reads `OZ_MASTER_KEY` and would race
/// the other cases in this binary.
#[test]
fn decrypt_with_candidates_accepts_any_authenticating_key() {
    let legacy = derive_static_key(PROFILE_AT_REST_DOMAIN);
    let master = hmac_key(&[0x11u8; 32], PROFILE_AT_REST_DOMAIN);
    let row = encrypt("profile-secret", &legacy).unwrap();

    // The slice's whole point: the master branch can still read a row the
    // legacy branch wrote, in either position of the candidate list.
    assert_eq!(
        decrypt_with_candidates(&row, &[legacy, master]).unwrap(),
        "profile-secret"
    );
    assert_eq!(
        decrypt_with_candidates(&row, &[master, legacy]).unwrap(),
        "profile-secret"
    );
    // ... and tolerance is not 'any key works': a list without the key that
    // wrote the row still fails.
    assert!(decrypt_with_candidates(&row, &[master]).is_err());
    assert!(
        decrypt_with_candidates(&row, &[hmac_key(&[0x22u8; 32], PROFILE_AT_REST_DOMAIN)]).is_err()
    );
}

/// With no usable `OZ_MASTER_KEY` there is exactly one candidate, so a
/// read stays byte-for-byte the single-key decrypt it was.
#[test]
fn candidate_keys_is_single_when_no_master_key_is_set() {
    if master_key_from_env().is_some() {
        return; // ambient master key: the two-candidate case is covered above
    }
    assert_eq!(
        candidate_keys(PROFILE_AT_REST_DOMAIN, derive_static_key),
        vec![derive_static_key(PROFILE_AT_REST_DOMAIN)]
    );
}

/// The flag tracks the key the portable families actually derive - a selection
/// report, not a security assertion.
#[test]
fn selection_flag_tracks_the_derived_key() {
    let active = master_key_derivation_active();
    let legacy_key = portable_key(SMTP_AT_REST_DOMAIN, derive_static_key);
    let master = master_key_from_env();
    let selected = portable_key_with(SMTP_AT_REST_DOMAIN, &master, derive_static_key);
    assert_eq!(
        active,
        selected != legacy_key,
        "the flag must be true exactly when the derived key is not the legacy one"
    );
}
