//! Storage-form census for the settings credential deny list.
//!
//! # This census predates the tracked-funnel credential refusal
//!
//! Written at 5a536af6a, when `Settings::set_tracked` stored every key it was
//! handed. `0f26a4b29` made that funnel refuse every `SECRET_KEY_DENY_LIST`
//! credential except `smtp_config`. Which cases now exercise what — the file
//! is a map of the doors, not a list of accidents:
//!
//! - The 14 per-key cases and both count tests are untouched: they write
//!   through the ordinary typed setters and plain `Settings::set`, which
//!   carry no refusal, so they still measure the stored form.
//! - The three former funnel cases moved to the doors that still accept the
//!   write, assertions intact, door in the name: the unfiltered
//!   `Settings::set` for the every-key-plaintext and zero-ciphertext
//!   counts, and the ledger's own unguarded `Settings::write_delta` for
//!   the delta-survives case (the tracked funnel refuses `sync_api_key`
//!   now, so the cleartext delta arrives by the door the refusal does not
//!   cover).
//! - `the_funnel_refuses_every_deny_listed_credential_except_smtp_config`
//!   pins what the refusal made true: a deny-listed credential cannot be
//!   written through the funnel at all — the call errors and no row is left
//!   in either table. That is why the plaintext cases above no longer run
//!   through the funnel: a door that refuses the write can no longer answer
//!   the at-rest question for the keys it refuses.
//!
//! Every existing test asks whether a deny-listed key is *refused on read*
//! (`crates/kasirmu-bridge/src/settings_tests.rs:404-413`) or whether it is *a
//! member of the list*. None asks what actually landed in the column. A key
//! can therefore sit in the database in cleartext and every suite in the repo
//! stays green, because redaction on the read path is not encryption on the
//! write path. This file measures the FORM of the stored bytes.
//!
//! For each key it writes a known sentinel through the ordinary public
//! settings setter available to this crate, then reads the RAW column with a
//! hand-written `SELECT` that touches no `Settings::get_*` accessor and so
//! decrypts nothing, and classifies what it finds.
//!
//! Two tables are read, not one: `Settings::set_tracked` copies the value a
//! second time into the `setting_updated` delta ledger
//! (`platform/core/src/settings/raw.rs`, the tracked write), so a
//! credential written in cleartext through a tracked door exists in cleartext
//! in TWO tables. The two
//! verdicts are reported separately because they can disagree — the live row
//! is overwritten, the ledger row is append-only. See
//! `a_cleartext_delta_survives_a_later_encrypted_save`.
//!
//! # Why classification has to call a decrypt function
//!
//! It does, and that is a finding rather than a shortcut. `settings.value` is
//! a bare `TEXT` column (`crates/kasirmu-core/migrations/20260813_init.sql:633-637`)
//! with no prefix, no version byte, no marker column, no discriminator of any
//! kind. The only shape predicate in the codebase, `looks_like_ciphertext`
//! (`crates/kasirmu-crypto/src/lib.rs:311`), is PRIVATE, so it cannot be reused
//! here and is reimplemented below. Because that predicate is a base64 length
//! test and not a tag, a plaintext value that merely happens to be
//! base64-shaped is indistinguishable from real ciphertext by inspection —
//! proved by `nothing_in_the_stored_form_marks_a_row_as_ciphertext`. The only
//! operation that separates the two forms for certain is an attempt to decrypt
//! with the family key. That is why no detection gate exists: there is nothing
//! to gate ON.
//!
//! # Verdicts
//!
//! `Ciphertext` — not the sentinel, and the matching family decrypt returns
//! the sentinel. `Plaintext` — the sentinel byte for byte (decided WITHOUT
//! decrypting). `StructuredBlob` — a JSON document carrying the credential
//! inside it.

use kasirmu_core::{Settings, Store, migrations};
use rusqlite::Connection;

/// Written through every setter, read back from every column. Chosen so it is
/// never valid base64 in any alphabet (`.` and `#` are absent from all four),
/// which keeps the sentinel itself from being shape-ambiguous.
const SENTINEL: &str = "sentinel.plaintext.value#1";

/// Terminal id for the delta-ledger writes; `setting_updated` is keyed by
/// (key, terminal_id, version).
const TERM: &str = "term-census";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Form {
    Ciphertext,
    Plaintext,
    StructuredBlob,
    Absent,
    /// Neither of the above — a value this file cannot classify. Always an
    /// assertion failure at the call site.
    Unknown,
}

impl Form {
    fn label(self) -> &'static str {
        match self {
            Form::Ciphertext => "ciphertext",
            Form::Plaintext => "plaintext",
            Form::StructuredBlob => "structured-blob",
            Form::Absent => "absent",
            Form::Unknown => "UNKNOWN",
        }
    }
}

// -- Raw readers: no Settings::get_*, therefore no decryption ---------------

/// The live row, read straight out of `settings.value`.
fn raw_settings_value(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![key],
        |r| r.get::<_, String>(0),
    )
    .ok()
}

/// Every delta row ever written for the key, oldest first, read straight out
/// of `setting_updated.value`.
fn raw_delta_values(conn: &Connection, key: &str) -> Vec<String> {
    let mut stmt = conn
        .prepare("SELECT value FROM setting_updated WHERE key = ?1 ORDER BY id ASC")
        .expect("setting_updated is created by the migration");
    stmt.query_map(rusqlite::params![key], |r| r.get::<_, String>(0))
        .expect("delta read")
        .map(|r| r.expect("delta value"))
        .collect()
}

// -- Classification ---------------------------------------------------------

/// Reimplementation of the PRIVATE `kasirmu_crypto::looks_like_ciphertext`
/// (`crates/kasirmu-crypto/src/lib.rs:311`), which this test cannot call. Kept here
/// as a deliberate duplicate: a census having to copy a private heuristic in
/// order to classify its own database is itself the evidence that no public
/// discriminator exists.
fn looks_like_ciphertext_shape(value: &str) -> bool {
    use base64::Engine as _;
    fn dec(s: &str) -> Option<Vec<u8>> {
        base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(s)
            .ok()
            .or_else(|| base64::engine::general_purpose::URL_SAFE.decode(s).ok())
            .or_else(|| {
                base64::engine::general_purpose::STANDARD_NO_PAD
                    .decode(s)
                    .ok()
            })
            .or_else(|| base64::engine::general_purpose::STANDARD.decode(s).ok())
    }
    dec(value).is_some_and(|b| b.len() >= 12 + 16)
}

/// Ask the crypto family that owns `key`. `None` when the key has no family at
/// all — which is the census's point: for most of these keys there is not even
/// a decrypt function to call.
fn family_decrypt(key: &str, raw: &str) -> Option<String> {
    use kasirmu_core::crypto as c;
    match key {
        "sync_api_key" => c::decrypt_sync_api_key(raw).ok(),
        "sync_terminal_secret" => c::decrypt_sync_terminal_secret(raw).ok(),
        "pg_sync.password" => c::decrypt_pg_sync_password(raw).ok(),
        "rate_sync.api_key" => c::decrypt_rate_api_key(raw).ok(),
        _ => None,
    }
}

/// Classify one raw column value. `Plaintext` is decided WITHOUT decrypting
/// (byte equality with what we wrote); `Ciphertext` can only be decided by
/// asking the family key, which is the gap this file records.
fn classify(key: &str, raw: Option<&str>) -> Form {
    let Some(raw) = raw else { return Form::Absent };
    if raw == SENTINEL {
        return Form::Plaintext;
    }
    if raw.trim_start().starts_with('{') {
        return Form::StructuredBlob;
    }
    if family_decrypt(key, raw).as_deref() == Some(SENTINEL) {
        return Form::Ciphertext;
    }
    Form::Unknown
}

fn live_form(conn: &Connection, key: &str) -> Form {
    classify(key, raw_settings_value(conn, key).as_deref())
}

fn delta_forms(conn: &Connection, key: &str) -> Vec<Form> {
    raw_delta_values(conn, key)
        .iter()
        .map(|v| classify(key, Some(v.as_str())))
        .collect()
}

// -- The census table -------------------------------------------------------

/// The shape of an ordinary typed setter for one census key: takes the
/// connection and the value, returns the crate's own error type. Named so the
/// `Spec` row below stays readable (and so `clippy::type_complexity` stops
/// counting the nesting).
type TypedSetter = fn(&Connection, &str) -> Result<(), kasirmu_core::CoreError>;

/// One row per key under census. `typed` is the ordinary public setter for
/// that key in this crate where one exists; `None` means the key has no typed
/// setter at all and the only ordinary setter is the generic `Settings::set`.
struct Spec {
    key: &'static str,
    /// One-line truth about the typed setter, echoed into the failure message.
    setter: &'static str,
    typed: Option<TypedSetter>,
    expected: Form,
}

fn w_sync_api_key(conn: &Connection, v: &str) -> Result<(), kasirmu_core::CoreError> {
    Settings::set_sync_api_key(conn, v)
}
fn w_sync_terminal_secret(conn: &Connection, v: &str) -> Result<(), kasirmu_core::CoreError> {
    Settings::set_sync_terminal_secret(conn, v)
}
fn w_pg_sync_password(conn: &Connection, v: &str) -> Result<(), kasirmu_core::CoreError> {
    Settings::set_pg_sync_password(conn, v)
}
fn w_rate_sync_api_key(conn: &Connection, v: &str) -> Result<(), kasirmu_core::CoreError> {
    Settings::set_rate_sync_api_key(conn, v)
}
fn w_redis_url(conn: &Connection, v: &str) -> Result<(), kasirmu_core::CoreError> {
    Settings::set_redis_url(conn, v)
}
fn w_smtp_config(conn: &Connection, v: &str) -> Result<(), kasirmu_core::CoreError> {
    let cfg = kasirmu_core::export::email_report::SmtpConfig {
        host: "smtp.example.com".into(),
        port: 587,
        username: Some("reports".into()),
        password: Some(v.into()),
        from: "reports@example.com".into(),
        use_tls: true,
    };
    Store::new(conn).save_smtp_config(&cfg)
}

/// The 14 keys named by the census, in the order the task listed them.
const SPEC: &[Spec] = &[
    // typed encrypting setter EXISTS (Settings::set_sync_api_key)
    Spec {
        key: "sync_api_key",
        setter: "typed encrypting setter EXISTS",
        typed: Some(w_sync_api_key),
        expected: Form::Ciphertext,
    },
    // typed encrypting setter EXISTS (Settings::set_sync_terminal_secret)
    Spec {
        key: "sync_terminal_secret",
        setter: "typed encrypting setter EXISTS",
        typed: Some(w_sync_terminal_secret),
        expected: Form::Ciphertext,
    },
    // typed encrypting setter EXISTS (Settings::set_pg_sync_password)
    Spec {
        key: "pg_sync.password",
        setter: "typed encrypting setter EXISTS",
        typed: Some(w_pg_sync_password),
        expected: Form::Ciphertext,
    },
    // typed encrypting setter EXISTS (Settings::set_rate_sync_api_key)
    Spec {
        key: "rate_sync.api_key",
        setter: "typed encrypting setter EXISTS",
        typed: Some(w_rate_sync_api_key),
        expected: Form::Ciphertext,
    },
    // typed setter EXISTS but does NOT encrypt — it is a bare Settings::set
    Spec {
        key: "redis.url",
        setter: "typed setter EXISTS but does NOT encrypt",
        typed: Some(w_redis_url),
        expected: Form::Plaintext,
    },
    // NO crypto family at all
    Spec {
        key: "local_api.secret",
        setter: "NO crypto family",
        typed: None,
        expected: Form::Plaintext,
    },
    // NO crypto family at all (the bridge encrypts it machine-bound; this crate does not)
    Spec {
        key: "license.api_key",
        setter: "NO crypto family",
        typed: None,
        expected: Form::Plaintext,
    },
    // NO crypto family at all
    Spec {
        key: "stripe.api_key",
        setter: "NO crypto family",
        typed: None,
        expected: Form::Plaintext,
    },
    // NO crypto family at all
    Spec {
        key: "square.api_key",
        setter: "NO crypto family",
        typed: None,
        expected: Form::Plaintext,
    },
    // NO crypto family at all
    Spec {
        key: "midtrans.server_key",
        setter: "NO crypto family",
        typed: None,
        expected: Form::Plaintext,
    },
    // NO crypto family at all (it IS the KDF factor, so it cannot be sealed by it)
    Spec {
        key: "machine_id",
        setter: "NO crypto family",
        typed: None,
        expected: Form::Plaintext,
    },
    // NO crypto family at all
    Spec {
        key: "hardware_fingerprint",
        setter: "NO crypto family",
        typed: None,
        expected: Form::Plaintext,
    },
    // NO crypto family. Written 5a536af6a as a bare string literal with no
    // keys:: constant; b2196d701 registered it as keys::AUTH_TOKEN and put it
    // on SECRET_KEY_DENY_LIST. Still true: no reader of the key exists anywhere
    // in the tree, so the row remains a write-only cleartext duplicate of
    // sync_api_key.
    Spec {
        key: "sync.auth_token",
        setter: "NO crypto family",
        typed: None,
        expected: Form::Plaintext,
    },
    // typed setter EXISTS; it encrypts the password FIELD inside a JSON blob
    Spec {
        key: "smtp_config",
        setter: "typed setter EXISTS, encrypts one field",
        typed: Some(w_smtp_config),
        expected: Form::StructuredBlob,
    },
];

fn setup() -> Connection {
    migrations::fresh_db()
}

/// Write the sentinel through the key's ordinary setter.
fn written(spec: &Spec) -> Connection {
    let conn = setup();
    match spec.typed {
        Some(f) => f(&conn, SENTINEL).expect("typed setter must accept the write"),
        None => {
            Settings::set(&conn, spec.key, SENTINEL).expect("Settings::set must accept the write")
        }
    }
    conn
}

// -- Per-key cases ----------------------------------------------------------

macro_rules! key_case {
    ($name:ident, $idx:expr) => {
        #[test]
        fn $name() {
            let spec = &SPEC[$idx];
            let conn = written(spec);

            // settings.value — the live row.
            let live = live_form(&conn, spec.key);
            assert_eq!(
                live,
                spec.expected,
                "{}: settings.value landed as {} ({}), expected {} ({})",
                spec.key,
                live.label(),
                if live == Form::Unknown {
                    "unclassifiable without a key"
                } else {
                    "classified"
                },
                spec.expected.label(),
                spec.setter,
            );

            // The ordinary setter above is Settings::set or a typed setter
            // layered on it; neither writes the delta ledger. Recorded, not
            // assumed — the funnel is a different test.
            assert_eq!(
                raw_delta_values(&conn, spec.key).len(),
                0,
                "{}: the ordinary setter is expected to write no setting_updated row",
                spec.key
            );
        }
    };
}

key_case!(sync_api_key_form, 0);
key_case!(sync_terminal_secret_form, 1);
key_case!(pg_sync_password_form, 2);
key_case!(rate_sync_api_key_form, 3);
key_case!(redis_url_form, 4);
key_case!(local_api_secret_form, 5);
key_case!(license_api_key_form, 6);
key_case!(stripe_api_key_form, 7);
key_case!(square_api_key_form, 8);
key_case!(midtrans_server_key_form, 9);
key_case!(machine_id_form, 10);
key_case!(hardware_fingerprint_form, 11);
key_case!(sync_auth_token_form, 12);
key_case!(smtp_config_form, 13);

/// The smtp_config verdict is only meaningful if the credential really is
/// sealed inside the blob: a JSON document whose password field is still
/// cleartext would read the same to the '{' test above. So check the field,
/// not the envelope.
#[test]
fn smtp_config_blob_seals_only_its_password_field() {
    let conn = written(&SPEC[13]);
    let raw = raw_settings_value(&conn, "smtp_config").expect("row written");
    let v: serde_json::Value = serde_json::from_str(&raw).expect("smtp_config is JSON");

    // The non-secret fields travel in the clear — it is a blob, not a seal.
    assert_eq!(v["host"].as_str(), Some("smtp.example.com"));
    assert_eq!(v["from"].as_str(), Some("reports@example.com"));

    let pwd = v["password"].as_str().expect("password field present");
    assert_ne!(pwd, SENTINEL, "the password field is not the sentinel");
    assert!(
        kasirmu_core::crypto::decrypt_smtp_at_rest(pwd).is_ok_and(|s| s == SENTINEL),
        "the password field is not smtp-at-rest ciphertext of the sentinel: {pwd}"
    );
}

// -- The doors: same census, door in the name -------------------------------

/// The tracked funnel the shells call now REFUSES deny-listed credentials
/// (`0f26a4b29`, pinned by the refusal case below), so the plaintext census
/// runs through the door that still accepts the write: the unfiltered
/// `Settings::set`, the UNENCRYPTING writer the funnel itself calls after
/// its guard. Same 14 keys, same at-rest claim — every one of them lands as
/// plaintext in `settings.value`. The ledger claim changed WITH the door:
/// the tracked funnel copied each value into `setting_updated`, the
/// unfiltered set feeds it nothing, so the cleartext sits in exactly one
/// table — the live row — and the ledger stays empty.
#[test]
fn every_key_lands_plaintext_through_the_unfiltered_set() {
    let mut offenders = Vec::new();
    for spec in SPEC {
        let conn = setup();
        Settings::set(&conn, spec.key, SENTINEL)
            .expect("unfiltered Settings::set must accept the write");

        let live = live_form(&conn, spec.key);
        let deltas = delta_forms(&conn, spec.key);
        if live != Form::Plaintext || !deltas.is_empty() {
            offenders.push(format!(
                "{} live={} deltas={:?}",
                spec.key,
                live.label(),
                deltas.iter().map(|f| f.label()).collect::<Vec<_>>()
            ));
        }
    }
    assert!(
        offenders.is_empty(),
        "Settings::set is expected to store every key as plaintext in settings.value and write no setting_updated row; these differ: {offenders:?}"
    );
}

/// The live row can be re-encrypted by a later save while the cleartext copy
/// written earlier stays in the ledger forever: `settings.value` is
/// overwritten, `setting_updated.value` is append-only. The door that
/// plants the first row is part of the claim — the two tables disagree over
/// TIME, and the disagreement begins when a tracked copy lands. The tracked
/// funnel now refuses `sync_api_key`, so the cleartext delta arrives by the
/// ledger's own door, `Settings::write_delta` — the append half the tracked
/// write is built from, which `0f26a4b29` did NOT guard (raw.rs refuses in
/// `set_tracked` and `set_batch_tracked` only). Same key, same
/// cleartext-in-both-tables start, same survival.
#[test]
fn a_cleartext_delta_survives_a_later_encrypted_save_through_the_delta_door() {
    let conn = setup();

    // 1. Cleartext at rest, twice: the live row via the unfiltered set, the
    //    ledger row via the delta door (no refusal on it).
    Settings::set(&conn, "sync_api_key", SENTINEL).unwrap();
    Settings::write_delta(&conn, "sync_api_key", SENTINEL, TERM).unwrap();
    assert_eq!(live_form(&conn, "sync_api_key"), Form::Plaintext);
    assert_eq!(delta_forms(&conn, "sync_api_key"), vec![Form::Plaintext]);

    // 2. The user re-saves through the typed setter: the live row becomes
    //    ciphertext, and NO new delta row replaces the old one.
    Settings::set_sync_api_key(&conn, SENTINEL).unwrap();
    assert_eq!(live_form(&conn, "sync_api_key"), Form::Ciphertext);

    // 3. The cleartext copy is still there, and it is now the only copy that
    //    states the secret in the clear.
    let deltas = delta_forms(&conn, "sync_api_key");
    assert_eq!(
        deltas,
        vec![Form::Plaintext],
        "the ledger still holds the pre-encryption cleartext row"
    );
    assert_eq!(raw_delta_values(&conn, "sync_api_key")[0], SENTINEL);
}

/// The thing the refusal made true: through the renderer-reachable funnel a
/// deny-listed credential cannot be written AT ALL. This is why the plaintext
/// cases above no longer run through the funnel — a door that refuses the
/// write answers no at-rest question. The case walks the live deny list (the
/// `smtp_config` exception is the funnel's one named admit) and asserts the
/// refusal three ways: the call errors, the error names the key and never
/// quotes the value, and neither table holds a row afterwards.
#[test]
fn the_funnel_refuses_every_deny_listed_credential_except_smtp_config() {
    use kasirmu_core::settings::keys::SECRET_KEY_DENY_LIST;
    let refused: Vec<&str> = SECRET_KEY_DENY_LIST
        .iter()
        .copied()
        .filter(|k| *k != "smtp_config")
        .collect();
    assert_eq!(
        refused.len(),
        SECRET_KEY_DENY_LIST.len() - 1,
        "every deny-list entry except the smtp_config exception must be walked"
    );
    for key in refused {
        let conn = setup();
        let err = Settings::set_tracked(&conn, key, SENTINEL, TERM)
            .expect_err("the tracked funnel must refuse a deny-listed credential");
        let msg = err.to_string();
        assert!(msg.contains(key), "the refusal names the key, got: {msg}");
        assert!(
            !msg.contains(SENTINEL),
            "the refusal never quotes the value, got: {msg}"
        );
        assert!(
            raw_settings_value(&conn, key).is_none(),
            "{key}: the refused write leaves no settings row"
        );
        assert!(
            raw_delta_values(&conn, key).is_empty(),
            "{key}: the refused write leaves no setting_updated row"
        );
    }
}

// -- The count, so a new key moves a number ---------------------------------

/// Keys landing as ciphertext in `settings.value` when written by their own
/// ordinary setter. Adding a credential key to `SPEC` without giving it a
/// crypto family moves `plaintext`, and the sum check pins the total, so the
/// number cannot stay quietly correct by accident.
#[test]
fn exactly_four_keys_land_in_ciphertext_form() {
    let (mut ciphertext, mut plaintext, mut blob) = (0, 0, 0);
    let mut other = Vec::new();
    for spec in SPEC {
        match live_form(&written(spec), spec.key) {
            Form::Ciphertext => ciphertext += 1,
            Form::Plaintext => plaintext += 1,
            Form::StructuredBlob => blob += 1,
            f => other.push(format!("{} = {}", spec.key, f.label())),
        }
    }
    assert!(other.is_empty(), "unclassifiable storage forms: {other:?}");
    assert_eq!(ciphertext, 4, "keys whose settings.value is ciphertext");
    assert_eq!(blob, 1, "keys whose settings.value is a JSON blob");
    assert_eq!(plaintext, 9, "keys whose settings.value is cleartext");
    assert_eq!(
        SPEC.len(),
        ciphertext + plaintext + blob,
        "every key in the census must classify"
    );
}

/// The same census through the unfiltered set: zero — `Settings::set` never
/// encrypts, whoever calls it. (The four ciphertext landers arrive only
/// through their typed encrypting setters, which the count test above
/// measures; the unfiltered writer this case uses is not one of them.)
#[test]
fn zero_keys_land_in_ciphertext_form_through_the_unfiltered_set() {
    let mut n = 0;
    for spec in SPEC {
        let conn = setup();
        Settings::set(&conn, spec.key, SENTINEL).unwrap();
        if live_form(&conn, spec.key) == Form::Ciphertext {
            n += 1;
        }
    }
    assert_eq!(n, 0, "the unfiltered set never encrypts");
}

// -- Why there is no gate to hang on the stored form ------------------------

#[test]
fn nothing_in_the_stored_form_marks_a_row_as_ciphertext() {
    let conn = setup();

    // 1. The schema carries no discriminator: three TEXT columns, no flag,
    //    no version-prefix column, no BLOB affinity.
    let cols: Vec<(String, String)> = {
        let mut stmt = conn.prepare("PRAGMA table_info(settings)").unwrap();
        stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?.to_uppercase(),
            ))
        })
        .unwrap()
        .map(|r| r.unwrap())
        .collect()
    };
    assert_eq!(
        cols.iter().map(|(n, _)| n.as_str()).collect::<Vec<_>>(),
        vec!["key", "value", "updated_at"],
        "settings has no marker column"
    );
    assert!(
        cols.iter().all(|(_, t)| t == "TEXT"),
        "every settings column is TEXT: {cols:?}"
    );

    // 2. Real ciphertext and a plaintext that merely LOOKS like ciphertext are
    //    indistinguishable without the key.
    Settings::set_sync_api_key(&conn, SENTINEL).unwrap();
    let real = raw_settings_value(&conn, "sync_api_key").unwrap();

    // 44 URL-safe base64 chars = 33 bytes >= 12 nonce + 16 tag: the exact bar
    // `looks_like_ciphertext` measures. It is not ciphertext.
    let fake = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    Settings::set(&conn, "stripe.api_key", fake).unwrap();

    assert!(
        looks_like_ciphertext_shape(&real) && looks_like_ciphertext_shape(fake),
        "both rows pass the only shape test the repo has"
    );
    assert_eq!(
        classify("sync_api_key", Some(&real)),
        Form::Ciphertext,
        "the real row is only identifiable as ciphertext by decrypting it"
    );
    // The decoy is plaintext, yet no inspection of the row can say so: it is
    // not the sentinel (so the byte-equality rule misses) and no family
    // decrypts it (so the decrypt rule gives up). That is the hole.
    assert_eq!(
        classify("stripe.api_key", Some(fake)),
        Form::Unknown,
        "a base64-shaped plaintext value cannot be classified without a key"
    );
}

/// The deny list is the population this census must cover. If a key is added
/// to the list and is neither censused nor already on the documented
/// exclusion, this fails and names it.
#[test]
fn census_covers_the_deny_list_except_the_documented_five() {
    use kasirmu_core::settings::keys::SECRET_KEY_DENY_LIST;
    let mut missing: Vec<&str> = SECRET_KEY_DENY_LIST
        .iter()
        .filter(|k| !SPEC.iter().any(|s| s.key == **k))
        .copied()
        .collect();
    missing.sort_unstable();
    // Excluded on purpose, each for a stated reason:
    //   lan_server.psk  manager-owned, the funnel refuses it; covered by the
    //                   bridge's own test, and it DOES have an encrypting
    //                   typed setter (Settings::set_lan_server_psk).
    //   license.*       per-install identity/PII rows, not credentials a
    //                   operator types; none has a crypto family.
    let expected = vec![
        "lan_server.psk",
        "license.payload",
        "license.phone",
        "license.signature",
        "license.tenant_id",
    ];
    assert_eq!(
        missing, expected,
        "the storage-form census no longer matches the deny list; a new credential key          was added (or removed) without updating SPEC"
    );
}

// -- Equality pin: one key value, two independent declarations --------------

/// The exception named by
/// `the_funnel_refuses_every_deny_listed_credential_except_smtp_config` is
/// declared in platform-core (`keys::SMTP_CONFIG`, reached here through the
/// `kasirmu_core::settings::keys` re-export). The two merge seams that decide
/// whether to re-read a stored blob and re-merge its password compare a
/// SEPARATE declaration of the same value —
/// `email_report::SMTP_CONFIG_SETTINGS_KEY` — one in the tablet command
/// (`apps/tablet-client/src/commands/settings.rs:604`), one in the desktop
/// funnel (`crates/kasirmu-bridge/src/settings.rs:484`). Nothing links the two
/// constants but their text, so they are one rename apart from disagreeing:
/// the funnel would keep excepting the key it names while the merge writes
/// under a key the exception no longer covers, the passwordless blob would
/// overwrite the stored secret, and the refusal pin above would stay green.
/// Neither constant is made an alias of the other here — the merge behaviour
/// is deliberate and other code reads the literal — so this asserts the
/// equality instead. It costs nothing while both read `"smtp_config"`; its
/// value is the day they do not.
#[test]
fn smtp_config_exception_key_and_merge_key_hold_the_same_value() {
    let exception = kasirmu_core::settings::keys::SMTP_CONFIG;
    let merge_key = kasirmu_core::export::email_report::SMTP_CONFIG_SETTINGS_KEY;
    assert_eq!(
        exception, merge_key,
        "the cleartext-credential exception and the SMTP merge key drifted apart: keys::SMTP_CONFIG (platform/core/src/settings/keys.rs:220, compared by the tracked funnel) is {exception:?}, but SMTP_CONFIG_SETTINGS_KEY (crates/kasirmu-core/src/export/email_report.rs:112, compared by both merge seams in apps/tablet-client/src/commands/settings.rs and crates/kasirmu-bridge/src/settings.rs) is {merge_key:?} — reword either one and the merge writes under a key the exception no longer covers, so the passwordless blob overwrites the stored secret in silence"
    );
}

// -- The borrowed refusal: why ONE list row carries this key's egress --------

// `sync.auth_token` is non-exportable TRANSITIVELY, and until now nothing in
// the repo said so. `keys::AUTH_TOKEN` is declared at
// `platform/core/src/settings/keys.rs:95` and enters `SECRET_KEY_DENY_LIST`
// (`:265-283`) as the IDENTIFIER `AUTH_TOKEN`, not as a retyped string literal,
// so renaming the key's value moves the guard with it. It is NOT in
// `NON_EXPORTABLE_DEVICE_KEYS` (`:295-296`). What keeps it out of a package is
// the definition of `is_non_exportable_setting_key` (`:393-396`) — in the secret
// list OR in the device list — so its egress refusal is a property this key
// BORROWS from the credential list. That one line in a `&[&str]` is the only
// thing holding it up.
//
// That is the fact the three cases below pin, and why all three are
// predicate-only: no connection, no `settings` row, no sqlite file. The claim is
// about WHICH LIST a key sits in, and a DB write would let a case pass for a
// storage reason while staying green after the membership is deleted.
//
// The hazard is historical, not hypothetical. Before commit `b2196d701` this key
// was on neither list and left the device as a duplicate cleartext copy of the
// tenant's sync secret on BOTH untrusted lanes. Deleting the entry again is one
// keystroke, is invisible from the read path, and has no reader anywhere in the
// tree that could notice — so the only defence left is a test that says so.

/// The spellings the `auth_token_*` cases must all refuse. Every one is DERIVED
/// from the constant — uppercased, space-padded, tab/newline-padded, case-mixed
/// — never typed as a literal, so the fixture moves with the key exactly as the
/// list does. The predicate trims and ASCII-case-folds the CANDIDATE while list
/// entries stay lowercase and untrimmed, which is what makes these spellings part
/// of the contract rather than decoration.
fn auth_token_spellings() -> Vec<String> {
    let exact = kasirmu_core::settings::keys::AUTH_TOKEN;
    let mixed: String = exact
        .chars()
        .enumerate()
        .map(|(i, c)| {
            if i % 2 == 0 {
                c.to_ascii_uppercase()
            } else {
                c
            }
        })
        .collect();
    vec![
        exact.to_string(),
        exact.to_ascii_uppercase(), // SYNC.AUTH_TOKEN
        format!("  {exact}  "),     // space-padded both sides
        format!("\t{exact}\n"),     // tab + newline padded
        mixed,                      // Sync.Auth_TOKen
    ]
}

/// Case 1 — the secret refusal itself, in every spelling the fold recognises.
///
/// Carries its own opposite: an ordinary non-credential key must stay admissible
/// in the SAME kinds of spelling, so this case cannot be satisfied by a predicate
/// that has started refusing everything. Without that half, a green run would not
/// distinguish a guard from a bug.
#[test]
fn auth_token_is_refused_as_a_secret_in_every_folded_spelling() {
    use kasirmu_core::settings::keys;
    let spellings = auth_token_spellings();
    assert!(
        spellings.len() >= 5,
        "the fixture must exercise more than the exact form, got {spellings:?}"
    );
    for spelling in &spellings {
        assert!(
            keys::is_secret_setting_key(spelling),
            "{spelling:?} is the tenant's sync API key under another spelling: keys::AUTH_TOKEN is on SECRET_KEY_DENY_LIST, so the fold must refuse it"
        );
    }
    for control in ["store.name", "STORE.NAME", "  sync_server_url\t"] {
        assert!(
            !keys::is_secret_setting_key(control) && !keys::is_non_exportable_setting_key(control),
            "the fold must still admit the ordinary key {control:?} — if this fails, the refusals above prove nothing"
        );
    }
}

/// Case 2 — WHY it is refused: the secret list, not the device list.
///
/// This is the case that keeps case 1 honest. `is_non_exportable_setting_key` is
/// an OR, so a key moved from `SECRET_KEY_DENY_LIST` to
/// `NON_EXPORTABLE_DEVICE_KEYS` would keep passing every "is it refused"
/// assertion while the credential list silently stopped carrying it — and the
/// list it would then sit on is documented as identifiers rather than
/// credentials, the wrong home for a secret. Asserting device-list NON-membership
/// is what forces the difference to be noticed.
#[test]
fn auth_token_is_non_exportable_through_the_secret_list_and_not_the_device_list() {
    use kasirmu_core::settings::keys;
    //
    assert!(
        keys::SECRET_KEY_DENY_LIST.contains(&keys::AUTH_TOKEN),
        "SECRET_KEY_DENY_LIST no longer contains keys::AUTH_TOKEN: that single membership is the whole reason a cleartext duplicate of the sync secret cannot leave the device"
    );
    assert!(
        !keys::NON_EXPORTABLE_DEVICE_KEYS.contains(&keys::AUTH_TOKEN),
        "keys::AUTH_TOKEN is now on NON_EXPORTABLE_DEVICE_KEYS. is_non_exportable_setting_key still answers true through the OR, so no other test would fail — but that list is for per-install IDENTIFIERS (machine_id, hardware_fingerprint, sync_terminal_id), not credentials, and this key holds the tenant's sync API secret. Give the secret list the membership it is supposed to have."
    );
    assert!(
        keys::is_secret_setting_key(keys::AUTH_TOKEN),
        "the credential predicate must flag it on its own, not only via the egress OR"
    );
    assert!(
        keys::is_non_exportable_setting_key(keys::AUTH_TOKEN),
        "and the egress predicate must refuse it, which is what load_exportable asks"
    );
}

/// Case 3 — the consequence, at the two doors that actually export.
///
/// Refused by the predicate is not the same as refused by the LANE, so this asks
/// the lane. `is_non_exportable_setting_key` is what `Settings::load_exportable`
/// filters on for the GUI settings export (`crates/kasirmu-bridge/src/data.rs`) and
/// `IngestPolicy::PortablePackage` is what the `.kasirpkg` lane asks
/// (`crates/kasirmu-cli/src/commands/kasirpkg.rs`, plus `set_batch_with_policy` on
/// restore). Lift `keys::AUTH_TOKEN` out of `SECRET_KEY_DENY_LIST` and a
/// credential-bearing key becomes packageable in cleartext through BOTH doors, in
/// every folded spelling at once — the exact state the tree was in before
/// `b2196d701`.
#[test]
fn a_removal_from_the_secret_list_would_make_auth_token_exportable_through_both_doors() {
    use kasirmu_core::settings::{IngestPolicy, IngestPolicyKind, keys};
    for spelling in auth_token_spellings() {
        assert!(
            !IngestPolicy::PortablePackage.admits(&spelling)
                && !IngestPolicy::RemoteSync.admits(&spelling),
            "{spelling:?} is admitted by an untrusted ingest lane, which happens the day keys::AUTH_TOKEN is removed from SECRET_KEY_DENY_LIST: a credential-bearing key then travels in cleartext through the .kasirpkg package AND the GUI settings export, in both directions"
        );
        assert!(
            keys::is_non_exportable_setting_key(&spelling),
            "{spelling:?} must be non-exportable — load_exportable filters on exactly this predicate, so a false here is a cleartext sync secret inside a package"
        );
    }
    assert!(
        IngestPolicy::TrustedLocal.admits(keys::AUTH_TOKEN),
        "control: the local lane owns this key and must NOT be filtered, or the refusals above would pass for a policy that rejects everything"
    );
}

// -- Decision pin: no ciphertext can be attributed to its key ---------------

/// The frozen domain-separation prefixes in `crates/kasirmu-crypto/src/lib.rs`
/// (lines 152-176), copied here as OBSERVED STRINGS because every one of them
/// is a private `const` — `SMTP_DOMAIN`, `API_KEY_DOMAIN`,
/// `SYNC_API_KEY_DOMAIN`, `SYNC_TERMINAL_SECRET_DOMAIN`,
/// `PG_SYNC_PASSWORD_DOMAIN`, `RATE_API_KEY_DOMAIN`, `LAN_PSK_DOMAIN`,
/// `SMTP_AT_REST_DOMAIN`, `PROFILE_AT_REST_DOMAIN`. Nothing reaches them from
/// an integration test and no production helper was added to expose them,
/// which is itself part of what is pinned: a caller cannot ask a value which
/// domain made it, and cannot ask the crate which domains it accepts.
const FROZEN_DOMAINS: &[&str] = &[
    "oz-pos.smtp-password.v1",
    "oz-pos.api-key.v1",
    "oz-pos.sync-api-key.v1",
    "oz-pos.sync-terminal-secret.v1",
    "oz-pos.pg-sync-password.v1",
    "oz-pos.rate-api-key.v1",
    "oz-pos.lan-psk.v1",
    "oz-pos.smtp-at-rest.v1",
    "oz-pos.user-profile-at-rest.v1",
];

/// A stored value, decomposed: base64url-nopad of nonce(12) || ciphertext ||
/// tag(16).
fn envelope(value: &str) -> Vec<u8> {
    use base64::Engine as _;
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(value)
        .expect("stored ciphertext is base64url-nopad")
}

/// # Why this is a pin and not an endorsement
///
/// A re-encryption migration — decrypt every stored credential with the old
/// key, re-encrypt with the new one, be done — is not merely risky here, it is
/// UNDECIDABLE, and the reason is a fact about the envelope rather than a bug:
///
/// 1. the envelope records no key identifier, no family name and no version:
///    its entire byte budget is nonce + payload + tag, so there is nowhere for
///    that information to be;
/// 2. `encrypt` and `decrypt` both ask `portable_key`, which calls
///    `master_key_from_env()` on EVERY call — the key comes from live process
///    state (`OZ_MASTER_KEY`) and never from the value in front of it;
/// 3. so a row written by the portable static derivation and a row written
///    under `OZ_MASTER_KEY` are the same KIND of object, and a sweep that dies
///    half way cannot tell which rows it already converted. Every surviving
///    row still decrypts under whichever branch the process happens to be in,
///    and a row it cannot read fails with the same generic tag error as a
///    corrupt row.
///
/// Rewrap is therefore not "hard", it is unsurveyable. This case makes that
/// executable instead of a sentence in a doc someone has to believe.
///
/// # ACTIVATION — when this pin is safe to delete
///
/// The moment the envelope carries a key identifier INSIDE the value — a
/// version byte, a `v2` marker, a key-id field, anything inspectable without
/// holding a key — a sweep can tell converted rows from unconverted ones, the
/// byte-budget and alphabet assertions below go red, and this is the case that
/// noticed. Land such a fix as a prefix OUTSIDE the encrypted part (a leading
/// id on the stored string, or a column), not inside the AEAD payload, or the
/// identifier stops being readable without the key it names.
#[test]
fn decision_pin_no_stored_ciphertext_names_the_key_that_produced_it() {
    // The accepted prefix set is v1-only. A second generation in it means
    // somebody started versioning these envelopes.
    for domain in FROZEN_DOMAINS {
        assert!(
            domain.ends_with(".v1"),
            "DECISION PIN BROKEN: {domain} is not a frozen .v1 prefix. A second generation of these domain strings means the envelope is being versioned — check whether it now records WHICH key made a row. If it does, this pin is obsolete and should be deleted; if it does not, the migration it implies still cannot tell a converted row from an unconverted one. This case pins a known limitation, it does not endorse it."
        );
    }

    /// One family: a name, the function that makes a row, and a DIFFERENT
    /// family decrypter to try it against — its own would succeed and prove
    /// nothing.
    type Family = (
        &'static str,
        fn(&str) -> Result<String, kasirmu_core::crypto::CryptoError>,
        fn(&str) -> Result<String, kasirmu_core::crypto::CryptoError>,
    );
    let families: [Family; 6] = [
        (
            "sync_api_key",
            kasirmu_core::crypto::encrypt_sync_api_key,
            kasirmu_core::crypto::decrypt_pg_sync_password,
        ),
        (
            "sync_terminal_secret",
            kasirmu_core::crypto::encrypt_sync_terminal_secret,
            kasirmu_core::crypto::decrypt_lan_psk,
        ),
        (
            "pg_sync.password",
            kasirmu_core::crypto::encrypt_pg_sync_password,
            kasirmu_core::crypto::decrypt_rate_api_key,
        ),
        (
            "rate_sync.api_key",
            kasirmu_core::crypto::encrypt_rate_api_key,
            kasirmu_core::crypto::decrypt_sync_api_key,
        ),
        (
            "smtp at-rest",
            kasirmu_core::crypto::encrypt_smtp_at_rest,
            kasirmu_core::crypto::decrypt_sync_terminal_secret,
        ),
        (
            "lan psk",
            kasirmu_core::crypto::encrypt_lan_psk,
            kasirmu_core::crypto::decrypt_smtp_at_rest,
        ),
    ];
    for (family, make, other_key) in families {
        let value = make(SENTINEL).expect("the family encrypts");
        let bytes = envelope(&value);
        // 1. Byte budget: every byte is accounted for. No room for a key id.
        assert_eq!(
            bytes.len(),
            12 + SENTINEL.len() + 16,
            "DECISION PIN BROKEN ({family}): the envelope is no longer exactly nonce(12)+payload+tag(16), so something extra is stored with it. If that something identifies the key or the version, a rewrap sweep can finally survey what it has converted and this pin should be deleted; if not, the format drifted without saying so. Known limitation, pinned not endorsed."
        );
        // 2. Nothing labels the STRING: base64url-nopad only, so no `:` or
        //    `.v1` suffix can sit in front of a value the way `$argon2id$`
        //    labels a password hash.
        assert!(
            value
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
            "{family}: stored value {value} carries a character outside the base64url alphabet — something is now labelling the row"
        );
        // 3. Nothing labels the BYTES: the domain that chose the key never
        //    appears in what the key produced.
        for domain in FROZEN_DOMAINS {
            assert!(
                !bytes.windows(domain.len()).any(|w| w == domain.as_bytes()),
                "{family}: the domain marker {domain} was found inside a stored value; the envelope has started naming its key"
            );
        }
        // 4. The failure is key-blind too: refusing the wrong key names
        //    nothing, so an unreadable row and a corrupt row sound alike.
        let wrong = other_key(&value)
            .expect_err("a row made by one family must not decrypt under another family key");
        let msg = wrong.to_string();
        for leak in ["oz-pos", ".v1", "sync", "pg", "rate", "smtp", "lan"] {
            assert!(
                !msg.contains(leak),
                "{family}: the refusal {msg:?} names {leak:?} — the failure is no longer key-blind"
            );
        }
    }

    // 5. The leading bytes are a fresh nonce, not a header: the same value
    //    under the same key never repeats them, so a sweep cannot group rows
    //    by a common prefix either.
    let a = envelope(&kasirmu_core::crypto::encrypt_sync_api_key(SENTINEL).unwrap());
    let b = envelope(&kasirmu_core::crypto::encrypt_sync_api_key(SENTINEL).unwrap());
    assert_ne!(a[..12], b[..12], "the first 12 bytes are the nonce");
    assert_ne!(a, b, "repeated bytes for identical input would be a header");
}

/// Spawned by the branch pin below with `OZ_MASTER_KEY` set, so both
/// derivations can be observed without mutating this process environment
/// underneath the other cases.
#[test]
#[ignore = "child probe: run by the branch pin with OZ_MASTER_KEY injected"]
fn decision_pin_child_probe_under_master_key() {
    let Ok(ct) = std::env::var("OZ_PIN_CHILD_CT") else {
        println!("OZ-PIN not-spawned");
        return;
    };
    let active = kasirmu_core::crypto::master_key_derivation_active();
    let refused = kasirmu_core::crypto::decrypt_sync_api_key(&ct).is_err();
    let ours = kasirmu_core::crypto::encrypt_sync_api_key(SENTINEL).expect("child encrypts");
    println!("OZ-PIN active={active} refused={refused} ct={ours}");
}

/// The consequence the shape pin only describes: a row made under one branch
/// does not decrypt under the other, and the two rows are the same kind of
/// object — so which branch made a row is not recoverable from the row.
#[test]
fn decision_pin_portable_ciphertext_is_refused_under_the_other_branch() {
    assert!(
        !kasirmu_core::crypto::master_key_derivation_active(),
        "this case assumes the suite runs with OZ_MASTER_KEY unset; if it is set, both processes are on the same branch and the comparison proves nothing"
    );
    let portable = kasirmu_core::crypto::encrypt_sync_api_key(SENTINEL).unwrap();
    assert_eq!(
        kasirmu_core::crypto::decrypt_sync_api_key(&portable).unwrap(),
        SENTINEL,
        "the portable branch round-trips in this process"
    );

    let exe = std::env::current_exe().expect("path to this test binary");
    let out = std::process::Command::new(exe)
        .args([
            "--exact",
            "decision_pin_child_probe_under_master_key",
            "--nocapture",
            "--ignored",
        ])
        .env(
            "OZ_MASTER_KEY",
            "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
        )
        .env("OZ_PIN_CHILD_CT", &portable)
        .output()
        .expect("spawn the child probe");
    let stdout = String::from_utf8_lossy(&out.stdout);
    let line = stdout
        .lines()
        .find(|l| l.starts_with("OZ-PIN active="))
        .unwrap_or_else(|| panic!("child printed no probe line; stdout: {stdout}"));
    assert!(line.contains("active=true"), "{line}");
    assert!(
        line.contains("refused=true"),
        "DECISION PIN BROKEN: the child, running under OZ_MASTER_KEY, decrypted a row written by the portable static derivation ({line}). Either the envelope now says which key made it — in which case this pin is obsolete — or reading became branch-tolerant, which changes what a half-finished rewrap would do. Known limitation, pinned not endorsed."
    );

    let master = line
        .split("ct=")
        .nth(1)
        .expect("child reports its own ciphertext")
        .trim()
        .to_string();
    assert!(
        kasirmu_core::crypto::decrypt_sync_api_key(&master).is_err(),
        "DECISION PIN BROKEN: a row written under OZ_MASTER_KEY decrypted here, where that key is not set: {master}"
    );

    // And the two rows are indistinguishable AS OBJECTS: same budget, same
    // alphabet. That is the undecidability, and it is what a sweep faces.
    let p = envelope(&portable);
    let m = envelope(&master);
    assert_eq!(p.len(), m.len(), "both are nonce(12)+payload+tag(16)");
    assert_ne!(p[..12], m[..12], "neither leading run is a header");
    assert!(
        master
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
        "the master-branch row {master} is not the same shape as the portable row"
    );
}
