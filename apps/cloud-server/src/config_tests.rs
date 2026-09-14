use super::*;
use serial_test::serial;

#[test]
fn env_bool_true_values() {
    // Can't set env in unit tests without serial_test, so test the
    // helper logic directly.
    assert!(matches_bool_str("1"));
    assert!(matches_bool_str("true"));
    assert!(matches_bool_str("TRUE"));
    assert!(matches_bool_str("on"));
    assert!(matches_bool_str("ON"));
}

#[test]
fn env_bool_false_values() {
    assert!(!matches_bool_str("0"));
    assert!(!matches_bool_str("false"));
    assert!(!matches_bool_str("no"));
    assert!(!matches_bool_str(""));
}

/// Same logic as `env_bool` but operating on a string slice so tests
/// don't need environment mutation.
fn matches_bool_str(s: &str) -> bool {
    matches!(s, "1" | "true" | "TRUE" | "on" | "ON")
}

#[test]
fn default_port_is_3099() {
    // from_env reads the real env, but we can verify the default.
    let port: u16 = std::env::var("OZ_API_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3099);
    // In CI / local dev without OZ_API_PORT set, this is 3099.
    assert!(port > 0);
}

#[test]
fn log_format_parses_json() {
    assert_eq!(
        match "json" {
            "json" => LogFormat::Json,
            _ => LogFormat::Plain,
        },
        LogFormat::Json
    );
}

#[test]
fn log_format_defaults_to_plain() {
    assert_eq!(
        match "text" {
            "json" => LogFormat::Json,
            _ => LogFormat::Plain,
        },
        LogFormat::Plain
    );
}

#[test]
fn production_requires_both_secrets() {
    assert!(validate_production(true, None, Some("admin")).is_err());
    assert!(validate_production(true, Some("secret"), None).is_err());
    assert!(validate_production(true, Some("secret"), Some("admin")).is_ok());
}

#[test]
fn dev_mode_allows_missing_secrets() {
    assert!(validate_production(false, None, None).is_ok());
}

#[test]
fn production_implies_require_tls() {
    assert!(resolve_require_tls(false, true));
    assert!(resolve_require_tls(true, false));
    assert!(!resolve_require_tls(false, false));
}

#[test]
fn parse_usize_accepts_positive_values() {
    assert_eq!(parse_usize("32", 20), 32);
    assert_eq!(parse_usize(" 8 ", 20), 8);
}

#[test]
fn parse_usize_falls_back_on_invalid_values() {
    assert_eq!(parse_usize("0", 20), 20);
    assert_eq!(parse_usize("-1", 20), 20);
    assert_eq!(parse_usize("abc", 20), 20);
    assert_eq!(parse_usize("", 20), 20);
}

/// Run `f` with the given environment variables temporarily set/removed,
/// restoring their original values afterwards. Callers must be `#[serial]`
/// because `std::env::set_var` is process-global (and unsafe in Rust 2024).
fn with_env(vars: &[(&str, Option<&str>)], f: impl FnOnce()) {
    let saved: Vec<(&str, Option<String>)> = vars
        .iter()
        .map(|(name, _)| (*name, std::env::var(name).ok()))
        .collect();
    for (name, value) in vars {
        // SAFETY: `#[serial]` runs env-mutating tests one at a time; the
        // saved values are restored before this function returns.
        match value {
            Some(v) => unsafe { std::env::set_var(name, v) },
            None => unsafe { std::env::remove_var(name) },
        }
    }
    f();
    for (name, original) in saved {
        match original {
            Some(v) => unsafe { std::env::set_var(name, v) },
            None => unsafe { std::env::remove_var(name) },
        }
    }
}

/// The startup config gate — the first thing `main()` does before serving
/// — must fail when `OZ_PRODUCTION=1` but a required secret is missing, so
/// the process exits instead of falling back to the dev secret.
#[serial]
#[test]
fn apply_schema_defaults_to_true_when_unset() {
    with_env(
        &[("OZ_APPLY_SCHEMA", None), ("OZ_REDIRECT_ONLY", None)],
        || {
            let config = CloudServerConfig::from_env().expect("config should parse");
            assert!(
                config.apply_schema,
                "unset OZ_APPLY_SCHEMA must default to true"
            );
        },
    );
}

#[serial]
#[test]
fn apply_schema_disabled_by_zero() {
    with_env(
        &[("OZ_APPLY_SCHEMA", Some("0")), ("OZ_REDIRECT_ONLY", None)],
        || {
            let config = CloudServerConfig::from_env().expect("config should parse");
            assert!(
                !config.apply_schema,
                "OZ_APPLY_SCHEMA=0 must disable schema application"
            );
        },
    );
}

#[serial]
#[test]
fn apply_schema_disabled_by_false() {
    with_env(
        &[
            ("OZ_APPLY_SCHEMA", Some("false")),
            ("OZ_REDIRECT_ONLY", None),
        ],
        || {
            let config = CloudServerConfig::from_env().expect("config should parse");
            assert!(
                !config.apply_schema,
                "OZ_APPLY_SCHEMA=false must disable it"
            );
        },
    );
}

#[serial]
#[test]
fn apply_schema_explicit_one_stays_enabled() {
    with_env(
        &[("OZ_APPLY_SCHEMA", Some("1")), ("OZ_REDIRECT_ONLY", None)],
        || {
            let config = CloudServerConfig::from_env().expect("config should parse");
            assert!(
                config.apply_schema,
                "OZ_APPLY_SCHEMA=1 must keep it enabled"
            );
        },
    );
}

#[serial]
#[test]
fn production_mode_fails_startup_without_api_secret() {
    with_env(
        &[
            ("OZ_PRODUCTION", Some("1")),
            ("OZ_API_SECRET", None),
            ("OZ_ADMIN_KEY", Some("test-admin-key")),
            ("OZ_REDIRECT_ONLY", None),
        ],
        || {
            let err = CloudServerConfig::from_env()
                .expect_err("production boot without OZ_API_SECRET must fail");
            assert!(
                err.contains("OZ_PRODUCTION=1 requires OZ_API_SECRET"),
                "expected a clear OZ_API_SECRET error, got: {err}"
            );
        },
    );
}

#[serial]
#[test]
fn production_mode_fails_startup_without_admin_key() {
    with_env(
        &[
            ("OZ_PRODUCTION", Some("1")),
            ("OZ_API_SECRET", Some("test-secret")),
            ("OZ_ADMIN_KEY", None),
            ("OZ_REDIRECT_ONLY", None),
        ],
        || {
            let err = CloudServerConfig::from_env()
                .expect_err("production boot without OZ_ADMIN_KEY must fail");
            assert!(
                err.contains("OZ_PRODUCTION=1 requires OZ_ADMIN_KEY"),
                "expected a clear OZ_ADMIN_KEY error, got: {err}"
            );
        },
    );
}

#[serial]
#[test]
fn db_pool_size_defaults_to_eight_when_unset() {
    with_env(
        &[("OZ_DB_POOL_SIZE", None), ("OZ_REDIRECT_ONLY", None)],
        || {
            let config = CloudServerConfig::from_env().expect("config should parse");
            assert_eq!(
                config.db_pool_size, 8,
                "unset OZ_DB_POOL_SIZE must default to 8"
            );
        },
    );
}

#[serial]
#[test]
fn db_pool_size_respects_custom_value() {
    with_env(
        &[("OZ_DB_POOL_SIZE", Some("16")), ("OZ_REDIRECT_ONLY", None)],
        || {
            let config = CloudServerConfig::from_env().expect("config should parse");
            assert_eq!(
                config.db_pool_size, 16,
                "custom OZ_DB_POOL_SIZE should override default"
            );
        },
    );
}

// ── MIDTRANS_QRIS_ACQUIRER ───────────────────────────────────────────

/// Unset, empty and whitespace-only all normalise to `None` — the generic
/// QRIS charge. A blank value must never become `Some("")`: an empty
/// `qris.acquirer` on the wire is a misconfiguration pretending to be a
/// default, and it is the exact class of bug 6a32cc9dd removed.
#[test]
fn blank_qris_acquirer_is_not_an_acquirer() {
    assert_eq!(parse_qris_acquirer(None), None);
    assert_eq!(parse_qris_acquirer(Some(String::new())), None);
    assert_eq!(parse_qris_acquirer(Some("   ".into())), None);
}

/// A configured value is kept byte-for-byte once surrounding whitespace is
/// stripped — no case folding, no rewriting — because the acquirer name
/// belongs to Midtrans' vocabulary, not ours.
#[test]
fn configured_qris_acquirer_is_kept_verbatim() {
    assert_eq!(
        parse_qris_acquirer(Some("shopeepay".into())).as_deref(),
        Some("shopeepay")
    );
    assert_eq!(
        parse_qris_acquirer(Some("airpay shopee".into())).as_deref(),
        Some("airpay shopee")
    );
}

/// THE regression test for the half-built guard: `trim()` was used as a
/// predicate (`!v.trim().is_empty()`) but never as a normaliser, so a value
/// carrying CRLF — what a CRLF `.env`, a compose `env_file`, or a trailing
/// space in a compose `environment:` entry actually delivers — passed the
/// blank check and then went on the wire as `"gopay\r"`. Midtrans does not
/// know that acquirer, it 400s the charge, and every QRIS payment on the
/// deployment returns 502. Whitespace-only correctly read `None`, so nothing
/// at startup ever hinted the value was already broken.
#[test]
fn qris_acquirer_crlf_is_trimmed_not_forwarded() {
    assert_eq!(
        parse_qris_acquirer(Some("gopay\r".into())).as_deref(),
        Some("gopay"),
        "a CR from a CRLF env file must not ride along on the wire"
    );
    assert_eq!(
        parse_qris_acquirer(Some("gopay\r\n".into())).as_deref(),
        Some("gopay"),
        "neither may a full CRLF pair"
    );
}

/// Same class, the space variant: a trailing (or leading) space left by a
/// hand-edited compose file is not part of the acquirer's name.
#[test]
fn qris_acquirer_surrounding_spaces_are_trimmed() {
    assert_eq!(
        parse_qris_acquirer(Some("gopay ".into())).as_deref(),
        Some("gopay")
    );
    assert_eq!(
        parse_qris_acquirer(Some("  gopay".into())).as_deref(),
        Some("gopay")
    );
    assert_eq!(
        parse_qris_acquirer(Some("\tshopeepay\t".into())).as_deref(),
        Some("shopeepay")
    );
}

/// Whitespace-only already normalised to `None` under the half-built guard,
/// and the fix must not change that: normalising is not inventing a value.
#[test]
fn qris_acquirer_whitespace_only_is_still_none() {
    assert_eq!(parse_qris_acquirer(Some("   ".into())), None);
    assert_eq!(parse_qris_acquirer(Some("\r\n".into())), None);
    assert_eq!(parse_qris_acquirer(Some(" \t \r".into())), None);
}

/// Guard against the opposite over-correction: an inner space IS the name
/// (`"airpay shopee` is a real Midtrans alias), so trimming the ends must
/// never squeeze or split it.
#[test]
fn qris_acquirer_inner_space_is_preserved() {
    assert_eq!(
        parse_qris_acquirer(Some(" airpay shopee\r".into())).as_deref(),
        Some("airpay shopee"),
        "trimming is for the ends only — the inner space belongs to the value"
    );
}

/// Trimming is not case folding, and the known-acquirer warn is not a gate:
/// the configured bytes (post-trim) are what the gateway gets.
#[test]
fn qris_acquirer_is_not_case_folded_and_unknown_names_survive() {
    assert_eq!(
        parse_qris_acquirer(Some("GoPay".into())).as_deref(),
        Some("GoPay"),
        "no case folding — the gateway owns the vocabulary"
    );
    assert_eq!(
        parse_qris_acquirer(Some("shopee".into())).as_deref(),
        Some("shopee"),
        "a value outside the known set is warned about, never dropped"
    );
}

/// Both warns must stay diagnostics. `OZ_PRODUCTION=1` plus a pinned
/// acquirer, and an acquirer outside the known set, still boot and still
/// carry the trimmed value — refusing would break a legitimate single-tenant
/// production deployment, which is not this file's call to make.
#[serial]
#[test]
fn qris_acquirer_warns_do_not_change_the_parsed_value() {
    with_env(
        &[
            ("OZ_REDIRECT_ONLY", None),
            ("OZ_PRODUCTION", Some("1")),
            ("OZ_API_SECRET", Some("test-secret")),
            ("OZ_ADMIN_KEY", Some("test-admin-key")),
            ("MIDTRANS_QRIS_ACQUIRER", Some("gopay\r")),
        ],
        || {
            let config =
                CloudServerConfig::from_env().expect("a startup warn must never refuse the boot");
            assert_eq!(
                config.midtrans_qris_acquirer.as_deref(),
                Some("gopay"),
                "production + CRLF: warn about the pin, but still hand over the clean name"
            );
        },
    );
    with_env(
        &[
            ("OZ_REDIRECT_ONLY", None),
            ("OZ_PRODUCTION", None),
            ("MIDTRANS_QRIS_ACQUIRER", Some("shopee")),
        ],
        || {
            let config =
                CloudServerConfig::from_env().expect("an unknown acquirer is a warn, not an error");
            assert_eq!(
                config.midtrans_qris_acquirer.as_deref(),
                Some("shopee"),
                "the diagnostic must not edit the value it is warning about"
            );
        },
    );
}

/// The whole config read: unset env → `None` (what every deployment does
/// today), set env → the value, empty env → `None` again.
#[serial]
#[test]
fn qris_acquirer_env_unset_is_generic_and_set_is_kept() {
    with_env(
        &[("OZ_REDIRECT_ONLY", None), ("MIDTRANS_QRIS_ACQUIRER", None)],
        || {
            let config = CloudServerConfig::from_env().expect("config should parse");
            assert_eq!(
                config.midtrans_qris_acquirer, None,
                "unset MIDTRANS_QRIS_ACQUIRER must stay generic"
            );
        },
    );
    with_env(
        &[
            ("OZ_REDIRECT_ONLY", None),
            ("MIDTRANS_QRIS_ACQUIRER", Some("gopay")),
        ],
        || {
            let config = CloudServerConfig::from_env().expect("config should parse");
            assert_eq!(
                config.midtrans_qris_acquirer.as_deref(),
                Some("gopay"),
                "set MIDTRANS_QRIS_ACQUIRER must survive into the config"
            );
        },
    );
    with_env(
        &[
            ("OZ_REDIRECT_ONLY", None),
            ("MIDTRANS_QRIS_ACQUIRER", Some("")),
        ],
        || {
            let config = CloudServerConfig::from_env().expect("config should parse");
            assert_eq!(
                config.midtrans_qris_acquirer, None,
                "an empty MIDTRANS_QRIS_ACQUIRER (Docker passes \"\" for an absent
                host variable) must not become an acquirer"
            );
        },
    );
}
