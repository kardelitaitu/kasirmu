use super::*;
use crate::downgrade::QuotaDimension;
use crate::migrations;
use crate::subscription::SubscriptionTier;

fn complete_profile() -> UserProfile {
    UserProfile {
        date_of_birth: Some("1990-05-14".into()),
        phone: Some("+14155550123".into()),
        national_id_type: Some("ssn".into()),
        national_id: Some("123456789".into()),
        email: Some("alice@example.com".into()),
        monthly_take_home_minor: Some(5_000_000),
        emergency_contact_name: Some("Bob".into()),
        emergency_contact_phone: Some("+14155550987".into()),
        ..Default::default()
    }
}

#[test]
fn is_complete_true_when_all_required_present() {
    assert!(complete_profile().is_complete());
}

#[test]
fn is_complete_false_when_any_required_missing() {
    // Every one of the 8 profile-side required fields, missing one at a
    // time, must yield an incomplete profile (ADR #35 D6 semantics:
    // legacy rows are flagged, never rejected).
    let mut profile = complete_profile();
    let fields = [
        "date_of_birth",
        "phone",
        "national_id_type",
        "national_id",
        "email",
        "monthly_take_home_minor",
        "emergency_contact_name",
        "emergency_contact_phone",
    ];
    for field in fields {
        let mut p = profile.clone();
        match field {
            "date_of_birth" => p.date_of_birth = None,
            "phone" => p.phone = None,
            "national_id_type" => p.national_id_type = None,
            "national_id" => p.national_id = None,
            "email" => p.email = None,
            "monthly_take_home_minor" => p.monthly_take_home_minor = None,
            "emergency_contact_name" => p.emergency_contact_name = None,
            "emergency_contact_phone" => p.emergency_contact_phone = None,
            _ => unreachable!(),
        }
        assert!(
            !p.is_complete(),
            "{field} missing must make the profile incomplete"
        );
    }
    // Optionals never affect completeness.
    profile.job_title = "Cashier".into();
    profile.notes = "notes".into();
    assert!(profile.is_complete());
}

#[test]
fn validate_rejects_each_missing_required_field() {
    let profile = complete_profile();
    let missing = [
        "date_of_birth",
        "phone",
        "national_id_type",
        "national_id",
        "email",
        "monthly_take_home_minor",
        "emergency_contact_name",
        "emergency_contact_phone",
    ];
    for field in missing {
        let mut p = profile.clone();
        match field {
            "date_of_birth" => p.date_of_birth = None,
            "phone" => p.phone = None,
            "national_id_type" => p.national_id_type = None,
            "national_id" => p.national_id = None,
            "email" => p.email = None,
            "monthly_take_home_minor" => p.monthly_take_home_minor = None,
            "emergency_contact_name" => p.emergency_contact_name = None,
            "emergency_contact_phone" => p.emergency_contact_phone = None,
            _ => unreachable!(),
        }
        let err = p.validate().unwrap_err();
        match err {
            CoreError::Validation { field: f, .. } => {
                assert_eq!(f, field, "missing {field} must report that field")
            }
            other => panic!("expected Validation for {field}, got {other:?}"),
        }
    }
}

#[test]
fn validate_accepts_complete_profile() {
    assert!(complete_profile().validate().is_ok());
}

#[test]
fn validate_national_id_shape_per_type() {
    // ssn: exactly 9 digits.
    for bad in ["12345678", "1234567890", "12345678a", "abcdefghi"] {
        let mut p = complete_profile();
        p.national_id = Some(bad.into());
        let err = p.validate().unwrap_err();
        assert!(
            matches!(
                err,
                CoreError::Validation {
                    field: "national_id",
                    ..
                }
            ),
            "ssn {bad:?} must be rejected with a national_id field error"
        );
    }
    // nik: exactly 16 digits.
    let mut p = complete_profile();
    p.national_id_type = Some("nik".into());
    p.national_id = Some("3201010101010001".into());
    assert!(p.validate().is_ok(), "16-digit nik must pass");
    let mut p = complete_profile();
    p.national_id_type = Some("nik".into());
    p.national_id = Some("3201010101".into());
    let err = p.validate().unwrap_err();
    assert!(
        matches!(
            err,
            CoreError::Validation {
                field: "national_id",
                ..
            }
        ),
        "10-digit nik must be rejected"
    );
    // Unknown type.
    let mut p = complete_profile();
    p.national_id_type = Some("passport".into());
    let err = p.validate().unwrap_err();
    assert!(
        matches!(
            err,
            CoreError::Validation {
                field: "national_id_type",
                ..
            }
        ),
        "unknown national_id_type must be rejected"
    );
}

#[test]
fn validate_email_and_phone_and_dob_and_pay() {
    for bad_email in ["not-an-email", "@nope", "a@b", "a b@c.com"] {
        let mut p = complete_profile();
        p.email = Some(bad_email.into());
        assert!(
            matches!(
                p.validate(),
                Err(CoreError::Validation { field: "email", .. })
            ),
            "email {bad_email:?} must be rejected"
        );
    }
    for bad_phone in ["4155550123", "+1", "abc", "+141555501234567"] {
        let mut p = complete_profile();
        p.phone = Some(bad_phone.into());
        assert!(
            matches!(
                p.validate(),
                Err(CoreError::Validation { field: "phone", .. })
            ),
            "phone {bad_phone:?} must be rejected"
        );
    }
    // DOB in the future.
    let mut p = complete_profile();
    p.date_of_birth = Some("2999-01-01".into());
    assert!(matches!(
        p.validate(),
        Err(CoreError::Validation {
            field: "date_of_birth",
            ..
        })
    ));
    // Monthly pay must be strictly positive.
    for bad_pay in [0, -1, -5_000_000] {
        let mut p = complete_profile();
        p.monthly_take_home_minor = Some(bad_pay);
        assert!(
            matches!(
                p.validate(),
                Err(CoreError::Validation {
                    field: "monthly_take_home_minor",
                    ..
                })
            ),
            "pay {bad_pay} must be rejected"
        );
    }
}

#[test]
fn create_with_profile_writes_columns_and_roundtrips() {
    let conn = migrations::fresh_db();
    conn.execute_batch(
        "INSERT INTO roles (id, name, permissions) VALUES
             ('role-staff', 'staff', '[\"sales:view\"]');",
    )
    .unwrap();
    let store = Store::new(&conn);
    let profile = complete_profile();
    let user = store
        .create_user_with_profile("alice", "hash", "Alice", "role-staff", &profile, None)
        .unwrap();
    let loaded = store
        .get_user_profile(&user.id)
        .unwrap()
        .expect("profile must round-trip");
    assert_eq!(loaded, profile);
    assert!(loaded.is_complete());
}

#[test]
fn create_with_profile_rejects_duplicate_email_and_national_id() {
    let conn = migrations::fresh_db();
    conn.execute_batch(
        "INSERT INTO roles (id, name, permissions) VALUES
             ('role-staff', 'staff', '[\"sales:view\"]');",
    )
    .unwrap();
    let store = Store::new(&conn);
    store
        .create_user_with_profile(
            "alice",
            "hash",
            "Alice",
            "role-staff",
            &complete_profile(),
            None,
        )
        .unwrap();

    // Duplicate email.
    let mut dup_email = complete_profile();
    dup_email.national_id = Some("987654321".into()); // different id, same email
    let err = store
        .create_user_with_profile("bob", "hash", "Bob", "role-staff", &dup_email, None)
        .unwrap_err();
    assert!(
        matches!(err, CoreError::Conflict { field: "email", .. }),
        "duplicate email must be a field-level conflict, got {err:?}"
    );

    // Duplicate national_id.
    let mut dup_id = complete_profile();
    dup_id.email = Some("bob@example.com".into()); // different email, same id
    let err = store
        .create_user_with_profile("bob", "hash", "Bob", "role-staff", &dup_id, None)
        .unwrap_err();
    assert!(
        matches!(
            err,
            CoreError::Conflict {
                field: "national_id",
                ..
            }
        ),
        "duplicate national_id must be a field-level conflict, got {err:?}"
    );
}

#[test]
fn legacy_create_user_leaves_incomplete_profile() {
    let conn = migrations::fresh_db();
    conn.execute_batch(
        "INSERT INTO roles (id, name, permissions) VALUES
             ('role-staff', 'staff', '[\"sales:view\"]');",
    )
    .unwrap();
    let store = Store::new(&conn);
    let user = store
        .create_user("legacy", "hash", "Legacy", "role-staff")
        .unwrap();
    let profile = store
        .get_user_profile(&user.id)
        .unwrap()
        .expect("every user has a profile row (all-NULL for legacy)");
    assert!(
        !profile.is_complete(),
        "legacy users are incomplete, never rejected"
    );
}

#[test]
fn update_user_profile_roundtrips() {
    let conn = migrations::fresh_db();
    conn.execute_batch(
        "INSERT INTO roles (id, name, permissions) VALUES
             ('role-staff', 'staff', '[\"sales:view\"]');",
    )
    .unwrap();
    let store = Store::new(&conn);
    let user = store
        .create_user("alice", "hash", "Alice", "role-staff")
        .unwrap();
    let mut profile = complete_profile();
    profile.email = Some("alice.new@example.com".into());
    store.update_user_profile(&user.id, &profile).unwrap();
    let loaded = store.get_user_profile(&user.id).unwrap().unwrap();
    assert_eq!(loaded, profile);
    assert!(loaded.is_complete());
}

#[test]
fn get_user_profile_returns_none_for_unknown_user() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    assert!(store.get_user_profile("no-such-user").unwrap().is_none());
}

// ── ADR #35 D6 sensitive handling ────────────────────────────────

fn insert_role(conn: &rusqlite::Connection, id: &str, perms: &[&str]) {
    let json = serde_json::to_string(perms).unwrap();
    conn.execute(
        "INSERT INTO roles (id, name, permissions) VALUES (?1, ?2, ?3)",
        params![id, id, json],
    )
    .unwrap();
}

#[test]
fn write_encrypts_national_id_and_pay_at_rest() {
    let conn = migrations::fresh_db();
    insert_role(&conn, "role-staff", &["sales:view"]);
    let store = Store::new(&conn);
    let user = store
        .create_user_with_profile(
            "alice",
            "hash",
            "Alice",
            "role-staff",
            &complete_profile(),
            None,
        )
        .unwrap();

    // Raw SQL must never see the plaintext sensitive values.
    let (raw_id, raw_pay): (Option<String>, Option<String>) = conn
        .query_row(
            "SELECT national_id, monthly_take_home_minor FROM users WHERE id = ?1",
            params![user.id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    let raw_id = raw_id.unwrap();
    let raw_pay = raw_pay.unwrap();
    assert_ne!(raw_id, "123456789", "national_id must be encrypted at rest");
    assert_ne!(raw_pay, "5000000", "monthly pay must be encrypted at rest");

    // The stored ciphertext round-trips through the domain read path.
    let loaded = store.get_user_profile(&user.id).unwrap().unwrap();
    assert_eq!(loaded.national_id.as_deref(), Some("123456789"));
    assert_eq!(loaded.monthly_take_home_minor, Some(5_000_000));

    // A deterministic hash column preserves uniqueness (nonce-randomised
    // ciphertext would otherwise dodge the unique index).
    let hash: Option<String> = conn
        .query_row(
            "SELECT national_id_hash FROM users WHERE id = ?1",
            params![user.id],
            |r| r.get(0),
        )
        .unwrap();
    assert!(hash.is_some(), "national_id_hash must be populated");
}

#[test]
fn view_without_grants_masks_and_withholds() {
    let conn = migrations::fresh_db();
    insert_role(&conn, "role-target", &["sales:view"]);
    insert_role(&conn, "role-viewer", &["staff:read"]);
    let store = Store::new(&conn);
    let target = store
        .create_user_with_profile("target", "h", "T", "role-target", &complete_profile(), None)
        .unwrap();
    let viewer = store
        .create_user("viewer", "h", "V", "role-viewer")
        .unwrap();

    let view = store
        .get_user_profile_viewed_by(&viewer.id, &target.id)
        .unwrap()
        .expect("target exists");
    assert_eq!(view.national_id_masked, "*****6789", "masked to last-4");
    assert!(view.national_id.is_none(), "full national_id withheld");
    assert!(view.tax_id.is_none(), "tax_id withheld");
    assert!(
        view.monthly_take_home_minor.is_none(),
        "pay withheld without staff:read_payroll"
    );
    assert!(view.is_complete);
}

#[test]
fn view_with_grants_returns_full_values_and_audits() {
    let conn = migrations::fresh_db();
    insert_role(
        &conn,
        "role-mgr",
        &["staff:read", "staff:read_identity", "staff:read_payroll"],
    );
    let store = Store::new(&conn);
    let target = store
        .create_user_with_profile("target", "h", "T", "role-mgr", &complete_profile(), None)
        .unwrap();
    let viewer = store.create_user("viewer", "h", "V", "role-mgr").unwrap();

    let view = store
        .get_user_profile_viewed_by(&viewer.id, &target.id)
        .unwrap()
        .unwrap();
    assert_eq!(view.national_id.as_deref(), Some("123456789"));
    assert_eq!(view.monthly_take_home_minor, Some(5_000_000));
    assert_eq!(view.national_id_masked, "*****6789");

    // Read audit: one entry per sensitive field group, access only.
    let entries = store.list_audit_entries(10, 0).unwrap();
    let actions: Vec<String> = entries.iter().map(|e| e.action.clone()).collect();
    assert!(
        actions.contains(&"staff.identity.read".to_string()),
        "identity read must be audited, got {actions:?}"
    );
    assert!(
        actions.contains(&"staff.payroll.read".to_string()),
        "payroll read must be audited, got {actions:?}"
    );
    for e in &entries {
        assert!(
            !e.details.contains("123456789") && !e.details.contains("5000000"),
            "audit records access, not values: {}",
            e.details
        );
    }
}

#[test]
fn corrupt_ciphertext_fails_closed() {
    let conn = migrations::fresh_db();
    insert_role(
        &conn,
        "role-viewer",
        &["staff:read_identity", "staff:read_payroll"],
    );
    let store = Store::new(&conn);
    let viewer = store
        .create_user("viewer", "h", "V", "role-viewer")
        .unwrap();
    let target = store
        .create_user_with_profile("target", "h", "T", "role-viewer", &complete_profile(), None)
        .unwrap();

    // Corrupt the stored ciphertext directly.
    conn.execute(
        "UPDATE users SET national_id = 'garbage', monthly_take_home_minor = 'garbage' WHERE id = ?1",
        params![target.id],
    )
    .unwrap();

    let view = store
        .get_user_profile_viewed_by(&viewer.id, &target.id)
        .unwrap()
        .unwrap();
    assert!(
        view.national_id.is_none(),
        "corrupt ciphertext must never yield plaintext"
    );
    assert!(
        view.monthly_take_home_minor.is_none(),
        "corrupt pay ciphertext must fail closed"
    );
    // Masked value cannot leak the plaintext either.
    assert!(!view.national_id_masked.contains("123456789"));
}

#[test]
fn assign_role_guarded_denies_incomplete_profile() {
    let conn = migrations::fresh_db();
    insert_role(&conn, "role-basic", &["sales:view"]);
    insert_role(&conn, "role-sens", &["staff:read", "staff:read_identity"]);
    let store = Store::new(&conn);
    // Legacy user: no profile columns → incomplete.
    let user = store
        .create_user("legacy", "h", "Legacy", "role-basic")
        .unwrap();

    // Sensitive-granting role → denied while incomplete.
    let err = store
        .assign_role_guarded(&user.id, "role-sens")
        .unwrap_err();
    assert!(
        matches!(
            err,
            CoreError::Validation {
                field: "profile",
                ..
            }
        ),
        "incomplete profile must block sensitive-granting role, got {err:?}"
    );

    // Non-sensitive role → allowed even when incomplete.
    store.assign_role_guarded(&user.id, "role-basic").unwrap();

    // Completing the profile unlocks the sensitive-granting role.
    let mut profile = complete_profile();
    profile.email = Some("legacy@example.com".into());
    store.update_user_profile(&user.id, &profile).unwrap();
    store.assign_role_guarded(&user.id, "role-sens").unwrap();
    let role = store.get_user(&user.id).unwrap().unwrap().role_id;
    assert_eq!(role, "role-sens");
}

#[test]
fn deactivation_preserves_profile() {
    let conn = migrations::fresh_db();
    insert_role(&conn, "role-staff", &["sales:view"]);
    let store = Store::new(&conn);
    let user = store
        .create_user_with_profile("alice", "h", "A", "role-staff", &complete_profile(), None)
        .unwrap();
    store
        .update_user(&user.id, "alice", "A", "role-staff", false)
        .unwrap();
    let profile = store.get_user_profile(&user.id).unwrap().unwrap();
    assert!(
        profile.is_complete(),
        "deactivation must never delete identity/payroll/emergency data"
    );
    assert_eq!(profile.national_id.as_deref(), Some("123456789"));
    assert_eq!(profile.monthly_take_home_minor, Some(5_000_000));
}

// ── An unreadable seal is never erased (view-then-save) ─────────────
//
// Trigger in production: the at-rest key material moves (the restore-to-
// different-hardware path in kasirmu-bridge mints a RANDOM machine_id when the
// hardware anchor query fails), so every stored profile ciphertext that was
// sealed under the old value becomes undecryptable at exactly the same time.
// The read path then reports those fields as absent; a form that displays the
// profile and saves it back must not turn that read failure into a write of
// NULL over the ciphertext, because the value is recoverable if the key ever
// comes back.

/// Raw stored state of the two encrypted columns plus the uniqueness hash.
fn stored_seals(
    conn: &rusqlite::Connection,
    user_id: &str,
) -> (Option<String>, Option<String>, Option<String>) {
    conn.query_row(
        "SELECT national_id, national_id_hash, monthly_take_home_minor FROM users WHERE id = ?1",
        params![user_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )
    .unwrap()
}

/// A complete user whose sensitive columns can no longer be opened, as they
/// are after the derived key moves.
fn user_with_unreadable_seals(conn: &rusqlite::Connection, store: &Store) -> crate::User {
    let user = store
        .create_user_with_profile("alice", "h", "A", "role-viewer", &complete_profile(), None)
        .unwrap();
    conn.execute(
        "UPDATE users SET national_id = 'garbage', monthly_take_home_minor = 'garbage' WHERE id = ?1",
        params![user.id],
    )
    .unwrap();
    user
}

#[test]
fn view_then_save_cannot_erase_an_undecryptable_national_id() {
    let conn = migrations::fresh_db();
    insert_role(
        &conn,
        "role-viewer",
        &["staff:read", "staff:read_identity", "staff:read_payroll"],
    );
    let store = Store::new(&conn);
    let target = user_with_unreadable_seals(&conn, &store);
    let viewer = store
        .create_user("viewer", "h", "V", "role-viewer")
        .unwrap();
    let before = stored_seals(&conn, &target.id);
    assert_eq!(
        before.0.as_deref(),
        Some("garbage"),
        "the unreadable seal is what is stored before the round trip"
    );

    // View: the read path still fails closed — no plaintext, no crash.
    let view = store
        .get_user_profile_viewed_by(&viewer.id, &target.id)
        .unwrap()
        .expect("target exists");
    assert!(
        view.national_id.is_none(),
        "an undecryptable national id must not yield plaintext"
    );
    assert!(view.monthly_take_home_minor.is_none());

    // Save what that view showed, with one unrelated edit.
    let mut profile = store.get_user_profile(&target.id).unwrap().unwrap();
    assert!(profile.national_id.is_none() && profile.monthly_take_home_minor.is_none());
    profile.job_title = "Shift lead".into();
    store
        .update_user_profile(&target.id, &profile)
        .expect("saving a profile whose seals are unreadable must not fail");

    // The seals are byte-identical: state three is never collapsed into a clear.
    assert_eq!(
        stored_seals(&conn, &target.id),
        before,
        "an undecryptable national_id / pay ciphertext must survive a view-then-save"
    );
    // And the write itself happened — the guard is per column, not a veto.
    let saved = store.get_user_profile(&target.id).unwrap().unwrap();
    assert_eq!(saved.job_title, "Shift lead");
}

#[test]
fn unreadable_seal_is_preserved_while_cleared_fields_still_clear() {
    let conn = migrations::fresh_db();
    insert_role(&conn, "role-viewer", &["sales:view"]);
    let store = Store::new(&conn);
    let mut seed = complete_profile();
    seed.address = Some("12 Main St".into());
    seed.tax_id = Some("TAX-1".into());
    let user = store
        .create_user_with_profile("alice", "h", "A", "role-viewer", &seed, None)
        .unwrap();
    conn.execute(
        "UPDATE users SET national_id = 'garbage' WHERE id = ?1",
        params![user.id],
    )
    .unwrap();
    let (id_seal, _, _) = stored_seals(&conn, &user.id);

    // Readable pay and every plaintext column still round-trip normally, and a
    // genuinely cleared optional field is cleared — the guard must not make the
    // rest of the row sticky.
    let mut profile = store.get_user_profile(&user.id).unwrap().unwrap();
    profile.monthly_take_home_minor = Some(6_000_000);
    profile.address = None;
    profile.tax_id = None;
    store.update_user_profile(&user.id, &profile).unwrap();

    let (still_id, _, pay) = stored_seals(&conn, &user.id);
    assert_eq!(
        still_id.as_deref(),
        id_seal.as_deref(),
        "the unreadable national_id is untouched by the same write"
    );
    assert_ne!(
        pay.as_deref(),
        Some("6000000"),
        "the re-sealed pay must still be encrypted at rest"
    );
    assert!(pay.is_some(), "the readable pay column was rewritten");
    let cleared = store.get_user_profile(&user.id).unwrap().unwrap();
    assert_eq!(cleared.monthly_take_home_minor, Some(6_000_000));
    assert_eq!(cleared.address, None, "a cleared field must still clear");
    assert_eq!(cleared.tax_id, None, "a cleared field must still clear");
}

#[test]
fn undecryptable_seal_is_still_replaceable_when_a_value_is_supplied() {
    let conn = migrations::fresh_db();
    insert_role(&conn, "role-viewer", &["sales:view"]);
    let store = Store::new(&conn);
    let user = user_with_unreadable_seals(&conn, &store);

    // The operator is not locked out: re-entering the value deliberately
    // replaces the unreadable bytes and restores the uniqueness hash.
    let mut profile = complete_profile();
    profile.national_id = Some("987654321".into());
    profile.email = Some("alice2@example.com".into());
    store.update_user_profile(&user.id, &profile).unwrap();

    let loaded = store.get_user_profile(&user.id).unwrap().unwrap();
    assert_eq!(loaded.national_id.as_deref(), Some("987654321"));
    assert_eq!(loaded.monthly_take_home_minor, Some(5_000_000));
    let (raw_id, raw_hash, raw_pay) = stored_seals(&conn, &user.id);
    assert_ne!(raw_id.as_deref(), Some("garbage"));
    assert_ne!(raw_pay.as_deref(), Some("garbage"));
    assert_eq!(raw_hash.as_deref(), Some(sha256_hex("987654321").as_str()));
}

#[test]
fn genuinely_empty_field_is_never_preserved_and_stays_writable() {
    let conn = migrations::fresh_db();
    insert_role(&conn, "role-viewer", &["sales:view"]);
    let store = Store::new(&conn);
    let user = store
        .create_user_with_profile("alice", "h", "A", "role-viewer", &complete_profile(), None)
        .unwrap();
    // An EMPTY column (not an unreadable one) — the other half of the state
    // that decrypt_sensitive used to collapse into None.
    conn.execute(
        "UPDATE users SET national_id = '' WHERE id = ?1",
        params![user.id],
    )
    .unwrap();

    // Nothing is protected here, so the mandatory-field contract still fires:
    // an empty field stays a field the caller must supply.
    let mut profile = store.get_user_profile(&user.id).unwrap().unwrap();
    assert!(profile.national_id.is_none());
    let err = store.update_user_profile(&user.id, &profile).unwrap_err();
    assert!(
        matches!(
            err,
            CoreError::Validation {
                field: "national_id",
                ..
            }
        ),
        "an empty (not unreadable) national_id must still be reported as required, got {err:?}"
    );

    // And the moment one is supplied, the write lands over the empty column.
    profile.national_id = Some("123456789".into());
    store.update_user_profile(&user.id, &profile).unwrap();
    let (raw_id, raw_hash, _) = stored_seals(&conn, &user.id);
    assert!(raw_id.as_deref().is_some_and(|v| !v.is_empty()));
    assert_eq!(raw_hash.as_deref(), Some(sha256_hex("123456789").as_str()));
    assert_eq!(
        store
            .get_user_profile(&user.id)
            .unwrap()
            .unwrap()
            .national_id
            .as_deref(),
        Some("123456789")
    );
}

#[test]
fn stored_cipher_classification_separates_undecryptable_from_empty() {
    // Absent / empty: never protected.
    assert_eq!(StoredCipher::classify(None), StoredCipher::Absent);
    assert_eq!(
        StoredCipher::classify(Some(String::new())),
        StoredCipher::Absent
    );
    assert_eq!(StoredCipher::Absent.preserve(), None);
    // Decryptable: the caller saw the value, so it is not protected either.
    let sealed = encrypt_profile_field("123456789").unwrap();
    assert_eq!(
        StoredCipher::classify(Some(sealed.clone())),
        StoredCipher::Readable
    );
    assert_eq!(StoredCipher::Readable.preserve(), None);
    // Undecryptable: protected, and preserved VERBATIM.
    assert_eq!(
        StoredCipher::classify(Some("garbage".into())),
        StoredCipher::Unreadable("garbage".into())
    );
    assert_eq!(
        StoredCipher::Unreadable("garbage".into()).preserve(),
        Some("garbage")
    );
    // Pay: a ciphertext of the empty string is empty, not unreadable; a
    // ciphertext of a non-number is unreadable (it never reached the caller).
    let empty_seal = encrypt_profile_field("").unwrap();
    assert_eq!(
        StoredCipher::classify_pay(Some(empty_seal)),
        StoredCipher::Readable
    );
    assert_eq!(
        StoredCipher::classify_pay(Some(encrypt_profile_field("5000000").unwrap())),
        StoredCipher::Readable
    );
    // (Bound once: the seal is nonce-randomised, so two encryptions of the
    // same text are different ciphertexts.)
    let junk_seal = encrypt_profile_field("not-a-number").unwrap();
    assert_eq!(
        StoredCipher::classify_pay(Some(junk_seal.clone())),
        StoredCipher::Unreadable(junk_seal)
    );
    assert_eq!(
        StoredCipher::classify_pay(Some("garbage".into())).preserve(),
        Some("garbage")
    );
}

// ── mask_last4 ──────────────────────────────────────────────────────

#[test]
fn mask_last4_empty_string_returns_stars() {
    assert_eq!(mask_last4(""), "****");
}

#[test]
fn mask_last4_short_string_masks_all() {
    // ≤4 chars: all masked (no suffix revealed).
    assert_eq!(mask_last4("1234"), "****");
    assert_eq!(mask_last4("ab"), "**");
    assert_eq!(mask_last4("x"), "*");
}

#[test]
fn mask_last4_reveals_last_four() {
    assert_eq!(mask_last4("123456789"), "*****6789");
    assert_eq!(mask_last4("abcdef"), "**cdef");
    assert_eq!(mask_last4("12345678"), "****5678");
}

#[test]
fn mask_last4_exactly_five_shows_one_star() {
    assert_eq!(mask_last4("12345"), "*2345");
}

#[test]
fn mask_last4_unicode_chars_count_correctly() {
    // Unicode chars each count as one char for masking.
    assert_eq!(mask_last4("一二三四五六七八九"), "*****六七八九");
}

// ── sha256_hex ──────────────────────────────────────────────────────

#[test]
fn sha256_hex_deterministic() {
    let a = sha256_hex("hello");
    let b = sha256_hex("hello");
    assert_eq!(a, b);
}

#[test]
fn sha256_hex_different_inputs_different_hashes() {
    let a = sha256_hex("hello");
    let b = sha256_hex("world");
    assert_ne!(a, b);
}

#[test]
fn create_with_profile_tx_veto_closes_staff_limit_race() {
    // W8-C3b: mirror of staff_tests::create_user_tx_veto_closes_limit_race.
    // The profile door (commands/staff.rs create_staff_scoped, both clients)
    // writes through create_user_with_profile, so the in-tx veto must hold
    // here too. Fill to the cap UN-ARMED, then arm directly via
    // arm_creation_quota, so this pins the door rather than re-testing the
    // gate. Pro, not Free: Free allows 1 staff user and the fill loop needs
    // headroom above the fixture baseline.
    let conn = migrations::fresh_db();
    conn.execute_batch(
        "INSERT INTO roles (id, name, permissions) VALUES
             ('role-staff', 'staff', '[\"sales:view\"]');",
    )
    .unwrap();
    let store = Store::new(&conn);
    let tier = SubscriptionTier::Pro;
    let limit = QuotaDimension::Staff.limit_for(&tier).unwrap();
    let baseline = store.count_staff_users().unwrap();
    assert!(
        baseline < limit,
        "the fixture must start under the cap (baseline {baseline}, limit {limit})"
    );
    // Profiles must be distinct per user: email + national id are uniqueness
    // hashed, so a shared fixture would fail the INSERT before the veto runs.
    // The national id stays 9 digits (ssn validator) and 9-figures for every
    // i the loop or the over-cap attempt (-1) can produce.
    let profile_for = |i: i64| {
        let mut p = complete_profile();
        p.email = Some(format!("staff{i}@example.com"));
        p.national_id = Some(format!("{}", 200_000_000 + i));
        p
    };
    for i in baseline..limit {
        store
            .create_user_with_profile(
                &format!("staff-{i}"),
                "hash",
                "Staff",
                "role-staff",
                &profile_for(i),
                None,
            )
            .unwrap();
    }
    assert_eq!(store.count_staff_users().unwrap(), limit);
    store.arm_creation_quota(QuotaDimension::Staff, tier.clone());
    let err = store
        .create_user_with_profile(
            "staff-over",
            "hash",
            "Over",
            "role-staff",
            &profile_for(-1),
            None,
        )
        .unwrap_err();
    assert!(
        matches!(err, CoreError::SubscriptionLimitExceeded(_)),
        "Pro at the staff cap must be refused in-tx: {err:?}"
    );
    assert_eq!(
        store.count_staff_users().unwrap(),
        limit,
        "the over-cap user must not persist"
    );
}

#[test]
fn sha256_hex_returns_64_char_hex() {
    let hash = sha256_hex("test");
    assert_eq!(hash.len(), 64);
    assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
}
