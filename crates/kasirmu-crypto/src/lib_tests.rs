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

// ── The static fallback and C1's release clause (review C1, plan §10) ─

/// The scope's other edge: with NO install key, the static fallback IS still the
/// writer.
///
/// **This test began as a tripwire and is now a positive pin.** Its original doc
/// said the release gate "must go red when this lands". The gate landed on
/// 2026-09-29 as plan §10 **option (a)** — a RE-SCOPED behavioural clause, not the
/// hard-error reading of §8.4 — so the tripwire is **discharged rather than
/// tripped**: the assertion below is still correct, and it is correct *because*
/// the clause is scoped. What it now pins is the edge the scope allows:
///
/// > in a release build the static fallback is never the WRITER **whenever a
/// > durable keychain exists**.
///
/// "Whenever a durable keychain exists" is doing real work. Every shipped install
/// is in the *other* case — NOTHING in the repository sets `OZ_MASTER_KEY` (zero
/// occurrences in `ops/`, `scripts/`, `.github/`, `.env.example`, any compose file
/// or Dockerfile), and a host with no usable keychain cannot resolve an install key
/// either — so this is the state a release build actually boots into. §10 refused
/// option (b) precisely because a hard error here would stop those installs
/// booting. The clause's affirmative half is pinned by
/// [`the_static_fallback_is_never_the_writer_when_an_install_key_exists`].
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

/// **C1's release clause, re-scoped 2026-09-29 (plan §10, option (a)).**
///
/// The clause: *in a release build the static fallback is never the WRITER
/// whenever a durable keychain exists.* It survives only as a **read candidate**
/// for rows written before the upgrade — which hazard H4 requires, and which is
/// why the clause cannot be a `compile_error!` build gate: `derive_static_key`
/// must stay **compiled** for that legacy read path. The only honest assertion is
/// behavioural, and this is it.
///
/// **Both halves are asserted, because asserting only the first would also be
/// satisfied by the wrong fix** — deleting the static derivation from the
/// candidate list, which would orphan every pre-upgrade row:
///
/// 1. an install key wins the **write** arm (the clause), and
/// 2. the static derivation is **still a read candidate** (H4's requirement).
#[test]
fn the_static_fallback_is_never_the_writer_when_an_install_key_exists() {
    let install = [0x0Au8; 32];

    // 1. The clause: the install key is the writer; the static derivation is not.
    let written = portable_key_from(SMTP_AT_REST_DOMAIN, Some(&install), None, derive_static_key);
    assert_eq!(
        written,
        install_key(SMTP_AT_REST_DOMAIN, &install),
        "an install key must win the write arm"
    );
    assert_ne!(
        written,
        derive_static_key(SMTP_AT_REST_DOMAIN),
        "the static fallback must not be the writer when a durable keychain exists"
    );

    // 2. H4's requirement: the static derivation stays readable for rows written
    //    before the upgrade. This is the half that makes the clause a SCOPE and
    //    not a deletion.
    let candidates =
        candidate_keys_from(SMTP_AT_REST_DOMAIN, Some(&install), None, derive_static_key);
    assert!(
        candidates.contains(&derive_static_key(SMTP_AT_REST_DOMAIN)),
        "the static derivation must remain a READ candidate (H4) -- a fix that \
         removed it would orphan every pre-upgrade row"
    );
    assert!(
        candidates.contains(&install_key(SMTP_AT_REST_DOMAIN, &install)),
        "the install derivation must be readable by the process that wrote it (H1)"
    );
    assert_ne!(
        candidates.first(),
        Some(&derive_static_key(SMTP_AT_REST_DOMAIN)),
        "the static derivation must not be the FIRST candidate while an install \
         key exists -- it is a fallback for old rows, not the primary"
    );
}

// ── C1 slices S2a + S2b-1: the per-install key seam ──────────────────

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

/// The install branch enters the reader's candidate list ONLY when a key is
/// installed, and it is tried FIRST.
///
/// This REPLACES the S2a-era pin that asserted the derivation could never appear
/// in `candidate_keys`. S2b-1 changes that deliberately: hazard H1 is a writer
/// using a derivation no reader tries, which bricks the install on its own rows
/// immediately, so the candidate branch ships in the same slice as the write arm.
/// What must stay true is the CONDITION — with no key installed the list is
/// byte-identical to the pre-seam list, so no existing row gains a derivation its
/// writer never used.
#[test]
fn install_key_enters_the_candidate_list_only_when_installed_and_goes_first() {
    let secret = [7u8; 32];
    let derived = install_key(SMTP_AT_REST_DOMAIN, &secret);

    // Not installed: the pre-seam list, in the pre-seam order.
    let without = candidate_keys_from(SMTP_AT_REST_DOMAIN, None, None, derive_static_key);
    assert_eq!(
        without,
        vec![derive_static_key(SMTP_AT_REST_DOMAIN)],
        "with no install key the candidate list must be the pre-S2b-1 list"
    );
    assert!(
        !without.contains(&derived),
        "an uninstalled derivation must never be a read candidate -- adding it \
         would widen READ acceptance for every family without any writer using it"
    );

    // Installed: present, first, and without dropping the legacy branch.
    let with = candidate_keys_from(SMTP_AT_REST_DOMAIN, Some(&secret), None, derive_static_key);
    assert_eq!(
        with.first(),
        Some(&derived),
        "the newest derivation is the likeliest writer, so it is tried first"
    );
    assert!(
        with.contains(&derive_static_key(SMTP_AT_REST_DOMAIN)),
        "widening for reading must not drop the legacy branch"
    );
}

/// With no key installed the derivation reports inactive — hazard H2's guard.
///
/// This REPLACES the S2a-era pin that asserted the seam was dormant *by
/// construction*. S2b-1 makes the mechanism real, so what is pinned now is the
/// behaviour that matters: a process that installs no key — which is every
/// process until S2b-2 wires the keychain read at boot — must report inactive and
/// derive exactly as before.
///
/// Nothing in this binary calls `set_install_key`, and that is deliberate: the
/// global cannot be un-set, so installing one here would change the derivation
/// for every other case in this file. The real global is driven in
/// `tests/at_rest_key_lifecycle.rs`, which runs as its own process.
#[test]
fn install_key_derivation_is_inactive_until_a_key_is_installed() {
    assert!(
        !install_key_derivation_active(),
        "no key is installed in the unit-test binary; if this now returns true, a \
         case installed one into the process global and poisoned its siblings"
    );
}

/// Precedence is install > master > legacy (D1, answered 2026-09-29).
///
/// Exercised through `portable_key_from` with every source injected, because the
/// process global cannot be un-set and a `set_var` for the master key would race
/// every other case in this binary.
#[test]
fn install_key_wins_over_master_and_legacy() {
    let install = [0x07u8; 32];
    let master = [0x42u8; 32];

    let all_three = portable_key_from(
        SMTP_AT_REST_DOMAIN,
        Some(&install),
        Some(&master),
        derive_static_key,
    );
    assert_eq!(
        all_three,
        hmac_key(&install, SMTP_AT_REST_DOMAIN),
        "the per-install key is the real key once it exists, so it must win"
    );
    assert_ne!(all_three, hmac_key(&master, SMTP_AT_REST_DOMAIN));
    assert_ne!(all_three, derive_static_key(SMTP_AT_REST_DOMAIN));

    // Without an install key the master override still beats legacy...
    assert_eq!(
        portable_key_from(SMTP_AT_REST_DOMAIN, None, Some(&master), derive_static_key),
        hmac_key(&master, SMTP_AT_REST_DOMAIN)
    );
    // ...and with neither source the family's legacy derivation runs, unchanged.
    assert_eq!(
        portable_key_from(SMTP_AT_REST_DOMAIN, None, None, derive_static_key),
        derive_static_key(SMTP_AT_REST_DOMAIN)
    );
}

/// Hazards H1 and H4 together, through the PRODUCTION reader.
///
/// H1: a row written under an installed key is readable while that key is a
/// candidate — the self-brick the slice exists to prevent.
/// H4: a row written under the legacy derivation still reads once a key exists.
///
/// Driven through `decrypt_smtp_at_rest_under`, the production read with its key
/// list injected, so this asserts the real path rather than a reimplementation.
#[test]
fn install_key_rows_read_and_legacy_rows_survive_the_upgrade() {
    let install = [0x09u8; 32];
    let derived = install_key(SMTP_AT_REST_DOMAIN, &install);

    // H4: written BEFORE the key existed, under the legacy derivation.
    let legacy_row = encrypt(
        "written-before-upgrade",
        &derive_static_key(SMTP_AT_REST_DOMAIN),
    )
    .unwrap();
    // H1: written AFTER, under the installed key.
    let install_row = encrypt("written-after-upgrade", &derived).unwrap();

    let candidates =
        candidate_keys_from(SMTP_AT_REST_DOMAIN, Some(&install), None, derive_static_key);
    assert_eq!(
        decrypt_smtp_at_rest_under(&legacy_row, &candidates).expect("legacy row must still read"),
        "written-before-upgrade",
        "H4: the upgrade must not orphan rows written under the legacy derivation"
    );
    assert_eq!(
        decrypt_smtp_at_rest_under(&install_row, &candidates).expect("install row must read"),
        "written-after-upgrade",
        "H1: a writer's own rows must be readable by the same process"
    );

    // The pre-upgrade reader CANNOT open the new row — which is exactly why the
    // candidate branch had to ship in the same slice as the write arm.
    assert!(
        decrypt_smtp_at_rest_under(&install_row, &[derive_static_key(SMTP_AT_REST_DOMAIN)])
            .is_err(),
        "an install-key row is unreadable without the install branch: H1's failure mode"
    );
}

/// S2b-1's own gate: with no key installed, nothing on the production path moved.
///
/// Asserts the PRODUCTION selector and the production candidate list rather than
/// the injectable helpers, so the pin cannot pass while the real path is broken.
#[test]
fn no_install_key_leaves_the_production_path_unchanged() {
    assert!(
        !install_key_derivation_active(),
        "a case installed a key into the process global and poisoned this one"
    );
    let ambient_master = master_key_from_env();

    // `portable_key` is what every at-rest write calls.
    let expected = match ambient_master {
        Some(m) => hmac_key(&m, SMTP_AT_REST_DOMAIN),
        None => derive_static_key(SMTP_AT_REST_DOMAIN),
    };
    assert_eq!(
        portable_key(SMTP_AT_REST_DOMAIN, derive_static_key),
        expected,
        "with no install key the selection must be the pre-S2b-1 selection"
    );

    // The candidate list must not have gained an arm.
    assert_eq!(
        candidate_keys(SMTP_AT_REST_DOMAIN, derive_static_key).len(),
        if ambient_master.is_some() { 2 } else { 1 },
        "an uninstalled derivation must not widen the read candidate list"
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

// ── C14(a): the local-API secret family ──────────────────────────────

/// The new family round-trips and is not interchangeable with its siblings.
#[test]
fn local_api_secret_round_trips_and_is_not_interchangeable() {
    let secret = "0123456789abcdef".repeat(4); // the exact legacy shape, 64 hex
    let ciphertext = encrypt_local_api_secret(&secret).expect("encrypt");

    assert_ne!(ciphertext, secret, "the stored form must not be the secret");
    assert_eq!(
        decrypt_local_api_secret(&ciphertext).expect("decrypt"),
        secret
    );

    // Domain separation: a sibling reader must not open this family's row.
    assert!(decrypt_lan_psk(&ciphertext).is_err());
    assert!(decrypt_sync_api_key(&ciphertext).is_err());
    assert!(decrypt_smtp_at_rest(&ciphertext).is_err());
}

/// **The C14(a) hazard, pinned.** The legacy plaintext shape PASSES the crate's
/// only shape test, so a passthrough gated on it would never fire — every
/// pre-upgrade row would surface as a decrypt ERROR instead of reading. This
/// asserts the collision, asserts the resulting failure, and asserts that the
/// ciphertext this family writes can never be mistaken for the legacy shape
/// (which is what lets the caller discriminate *positively*).
#[test]
fn local_api_secret_legacy_shape_collides_with_the_shape_test() {
    let legacy = "0123456789abcdef".repeat(4);
    assert_eq!(legacy.len(), 64);

    // 1. The collision: the legacy value IS "ciphertext-shaped" to the repo's
    //    only predicate, because 64 hex chars are valid base64 and decode to 48
    //    bytes — past the 12 nonce + 16 tag bar. This is exactly why the generic
    //    fail-closed reader cannot serve this family.
    assert!(
        looks_like_ciphertext(&legacy),
        "a 64-char hex secret passes looks_like_ciphertext; if this ever goes \
         false, the generic reader would still be the wrong design here"
    );

    // 2. And it genuinely does NOT decrypt under this family's key — so the
    //    generic reader would have failed closed on every existing install.
    assert!(
        decrypt_local_api_secret(&legacy).is_err(),
        "the legacy plaintext must not decrypt; this error is what the generic \
         reader would have surfaced as a bricked local API"
    );

    // 3. The ciphertext is 12 + 64 + 16 = 92 bytes -> 124 base64url chars, so it
    //    is disjoint from the 64-char legacy shape on BOTH length and alphabet.
    let ciphertext = encrypt_local_api_secret(&legacy).expect("encrypt");
    assert_ne!(
        ciphertext.len(),
        64,
        "ciphertext length must be disjoint from the legacy shape"
    );
    assert!(
        !ciphertext
            .chars()
            .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)),
        "ciphertext must never look like lowercase hex"
    );
}
