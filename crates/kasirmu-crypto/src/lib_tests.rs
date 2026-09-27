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

/// The preferred name wins over the legacy alias, and the alias keeps working on
/// its own. Split from the environment read so the precedence is testable without
/// a `set_var`, which would race every other case in this binary.
#[test]
fn master_key_prefers_the_new_name_and_still_reads_the_legacy_alias() {
    assert_eq!(
        master_key_raw_from(Some("new".into()), Some("legacy".into())),
        Some("new".to_string()),
        "the documented name must win when both are set"
    );
    assert_eq!(
        master_key_raw_from(None, Some("legacy".into())),
        Some("legacy".to_string()),
        "the legacy alias keeps working: retiring it outright would orphan stored rows"
    );
    assert_eq!(
        master_key_raw_from(Some("new".into()), None),
        Some("new".to_string())
    );
    assert_eq!(master_key_raw_from(None, None), None);
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
        selection_from_raw(master_key_raw_from(
            std::env::var(MASTER_KEY_ENV).ok(),
            std::env::var(MASTER_KEY_ENV_LEGACY).ok(),
        )),
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

/// The SMTP at-rest family must read through the SAME branch-tolerant path as
/// every other portable family.
///
/// `decrypt_smtp_at_rest` was the one reader still calling the single-key
/// `portable_key`, so a row written while `OZ_MASTER_KEY` was set could not be
/// opened once the master branch was in use -- the exact orphaning the
/// branch-tolerant reader exists to prevent, and one of the blast-radius
/// locations review C1/D1 enumerates.
///
/// Exercised with explicit key lists (like the `decrypt_with_candidates` case
/// above) rather than by setting `OZ_MASTER_KEY`, which other cases in this
/// binary read and which a `set_var` here would race.
#[test]
fn smtp_at_rest_reads_are_branch_tolerant() {
    let legacy = derive_static_key(SMTP_AT_REST_DOMAIN);
    let master = hmac_key(&[0x33u8; 32], SMTP_AT_REST_DOMAIN);
    // A row the MASTER branch wrote -- unreachable for the old single-key reader.
    let row = encrypt("smtp-secret", &master).unwrap();

    // The property that matters: a master-written row opens when the master key
    // is among the candidates, in either position. `decrypt_smtp_at_rest_under`
    // is the PRODUCTION reader with its key list injected, so this asserts the
    // real path rather than a reimplementation of it.
    assert_eq!(
        decrypt_smtp_at_rest_under(&row, &[legacy, master]).unwrap(),
        "smtp-secret"
    );
    assert_eq!(
        decrypt_smtp_at_rest_under(&row, &[master, legacy]).unwrap(),
        "smtp-secret"
    );

    // Tolerance is not "any key works": without the key that wrote the row the
    // reader still fails, and it fails CLOSED rather than returning ciphertext.
    assert!(
        decrypt_smtp_at_rest_under(&row, &[hmac_key(&[0x44u8; 32], SMTP_AT_REST_DOMAIN)]).is_err()
    );

    // The legacy arm is unchanged: a value that is not ciphertext still passes
    // through byte for byte, which is the compatibility the doc promises.
    assert_eq!(
        decrypt_smtp_at_rest_under("plaintext-legacy", &[legacy]).unwrap(),
        "plaintext-legacy"
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

// ── The static fallback, pinned (review C1) ─────────────────────────

/// The static fallback IS the default derivation, in every build profile.
///
/// `derive_static_key` derives from a public constant, so it is obfuscation
/// rather than confidentiality -- its own doc says so. Review C1's done-condition
/// asks for "a test [that] asserts the static fallback cannot be reached in a
/// release build". That cannot be written yet, because no such mechanism EXISTS:
/// reaching the static branch is what every shipped install does today, since
/// NOTHING in the repository sets `OZ_MASTER_KEY` (zero occurrences in `ops/`,
/// `scripts/`, `.github/`, `.env.example`, any compose file or Dockerfile).
///
/// What CAN be written is the other direction, and it is worth having: this pins
/// the CURRENT reachability. Adding the release gate the item asks for is a
/// change to where the key comes from -- which is decision D1 -- so when that
/// lands this test must go red and be inverted DELIBERATELY, rather than the
/// behaviour changing while every test stays green.
#[test]
fn the_static_fallback_is_the_default_derivation_and_is_pinned_as_reachable() {
    if master_key_from_env().is_some() {
        // Ambient master key: the fallback is not the selected branch here, and
        // this case is about the default. Covered by the branch-tolerant cases.
        return;
    }
    // `portable_key` is the PRODUCTION selector -- every at-rest write and every
    // single-key read calls it. Asserting on it, rather than on the parameterised
    // `portable_key_with` (which takes the master key as an argument and therefore
    // cannot observe this branch at all), is what makes this pin non-vacuous. The
    // first version of this test used the helper and PASSED with the production
    // selector deliberately broken -- the falsification caught it.
    let selected = portable_key(SMTP_AT_REST_DOMAIN, derive_static_key);
    assert_eq!(
        selected,
        derive_static_key(SMTP_AT_REST_DOMAIN),
        "with no master key the static derivation is selected -- if this fails, a \
         release gate was added and C1's decision was taken; invert this test \
         deliberately in the same change"
    );
}

// ── C1 slice S2a: the dormant per-install key seam ───────────────────

/// The install-key derivation is HMAC-SHA256(install_secret, domain) --
/// domain separation identical in shape to the master-key derivation, so a
/// row written under a per-install key is a DIFFERENT ciphertext from one
/// written under the master key for the same domain.
#[test]
fn install_key_is_domain_separated_and_deterministic() {
    let secret = [7u8; 32];
    let a = install_key(SMTP_AT_REST_DOMAIN, &secret);
    let b = install_key(SMTP_AT_REST_DOMAIN, &secret);
    let other_domain = install_key(PROFILE_AT_REST_DOMAIN, &secret);
    let other_secret = install_key(SMTP_AT_REST_DOMAIN, &[8u8; 32]);

    assert_eq!(a, b, "same secret + same domain must derive the same key");
    assert_ne!(a, other_domain, "domains must not share a key");
    assert_ne!(a, other_secret, "different secrets must not share a key");
}

/// The seam must NOT be reachable through the reader's candidate list, or
/// every existing row would silently gain a derivation its writer never used.
#[test]
fn install_key_is_absent_from_the_reader_candidate_list() {
    let secret = [7u8; 32];
    let candidates = candidate_keys(SMTP_AT_REST_DOMAIN, derive_static_key);
    assert!(
        !candidates.contains(&install_key(SMTP_AT_REST_DOMAIN, &secret)),
        "the per-install derivation must stay out of candidate_keys -- adding it \
         would widen READ acceptance for every family without any writer using it"
    );
}

/// A row written under the install key round-trips through it, and fails
/// under the legacy and master derivations -- the property S2c will rely on.
#[test]
fn install_key_round_trips_and_is_not_interchangeable() {
    let secret = [7u8; 32];
    let key = install_key(SMTP_AT_REST_DOMAIN, &secret);
    let ciphertext = encrypt("sk-install-secret", &key).expect("encrypt under install key");

    assert_eq!(
        decrypt(&ciphertext, &key).expect("decrypt under the same key"),
        "sk-install-secret"
    );
    assert!(
        decrypt(&ciphertext, &derive_static_key(SMTP_AT_REST_DOMAIN)).is_err(),
        "the public-constant derivation must not open an install-key row"
    );
}

/// S2a is DORMANT. If this fails, a source was wired without the D1 decision
/// -- which is the one thing the slice was scoped to avoid.
#[test]
fn install_key_derivation_is_currently_inactive() {
    assert!(
        !install_key_derivation_active(),
        "no per-install key source exists yet (S2b); if this now returns true, \
         a keychain-backed source was wired and C1's D1 decision must have been \
         taken deliberately in the same change"
    );
}
