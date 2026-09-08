use super::*;

/// A payload shaped exactly as `handleHealth` emits it on the happy path.
const OK_BODY: &str = r#"{
  "status": "ok",
  "db_connected": true,
  "db_error": "",
  "smtp": { "configured": true, "verified": true, "error": "" },
  "paddle": { "secret_configured": true, "price_tiers_configured": true, "price_tiers_mappings": 5, "error": "" },
  "midtrans": { "server_key_configured": true, "price_tiers_configured": true, "price_tiers_mappings": 4, "error": "" },
  "rsa": { "configured": true },
  "discord": { "configured": true },
  "uptime_secs": 4211,
  "go_version": "go1.23.0",
  "go_os": "linux",
  "go_arch": "amd64"
}"#;

/// The same payload with the database unreachable — what the server sends
/// WITH a 503. Extra fields are ignored by the deserializer, which is why
/// they stay in: the fixture should not be a minimal idealised shape.
const DEGRADED_BODY: &str = r#"{
  "status": "degraded",
  "db_connected": false,
  "db_error": "sql: connection refused",
  "smtp": { "configured": true, "verified": true, "error": "" },
  "paddle": { "secret_configured": true, "price_tiers_configured": true, "price_tiers_mappings": 5, "error": "" },
  "midtrans": { "server_key_configured": true, "price_tiers_configured": true, "price_tiers_mappings": 4, "error": "" },
  "rsa": { "configured": true },
  "discord": { "configured": false },
  "uptime_secs": 4211,
  "go_version": "go1.23.0",
  "go_os": "linux",
  "go_arch": "amd64"
}"#;

fn body(json: &str) -> LicenseHealthBody {
    serde_json::from_str(json).expect("fixture parses")
}

#[test]
fn a_503_carrying_a_health_payload_is_degraded_not_unavailable() {
    // The defect this module exists for. `ping_license_server` asked only
    // `is_success()`, so a server that was up and reporting a dead database
    // arrived as the same red dot as a server that was not there.
    let (state, cause) = classify_license_health(503, Some(&body(DEGRADED_BODY)));
    assert_eq!(state, HealthState::Degraded);
    assert_eq!(cause.as_deref(), Some("database"));
}

#[test]
fn a_clean_200_is_operational_with_no_cause() {
    let (state, cause) = classify_license_health(200, Some(&body(OK_BODY)));
    assert_eq!(state, HealthState::Operational);
    assert_eq!(cause, None);
}

#[test]
fn an_unparsable_200_is_unavailable_rather_than_a_guess_at_ok() {
    // A proxy that answers 200 with an HTML error page is not a healthy
    // service. Reading "it returned 2xx" as ok would be the same mistake in
    // the opposite direction.
    let (state, cause) = classify_license_health(200, None);
    assert_eq!(state, HealthState::Unavailable);
    assert_eq!(cause.as_deref(), Some("no health payload (HTTP 200)"));
}

#[test]
fn the_status_code_is_carried_into_the_cause_when_there_is_no_body() {
    let (_, cause) = classify_license_health(502, None);
    assert_eq!(cause.as_deref(), Some("no health payload (HTTP 502)"));
}

#[test]
fn the_body_is_trusted_over_a_2xx_status() {
    // A server returning 200 while saying "degraded" is degraded. The status
    // code is transport; the payload is the claim.
    let (state, _) = classify_license_health(200, Some(&body(DEGRADED_BODY)));
    assert_eq!(state, HealthState::Degraded);
}

#[test]
fn an_ok_status_with_a_broken_gate_is_still_not_operational() {
    // The server only flips `status` for the database, so a missing payment
    // key arrives as status:"ok". Reporting Operational there would assert a
    // thing the payload contradicts one field later.
    let json = DEGRADED_BODY.replace("\"status\": \"degraded\"", "\"status\": \"ok\"");
    let parsed = body(&json);
    assert_eq!(parsed.status, "ok");
    let (state, cause) = classify_license_health(200, Some(&parsed));
    assert_eq!(state, HealthState::Degraded);
    assert_eq!(cause.as_deref(), Some("database"));
}

#[test]
fn a_missing_block_is_absent_not_broken() {
    // An older server without the gate blocks must not be reported as having
    // broken gates. This is the asymmetry the #[serde(default)] tolerance is
    // built to preserve: absent is not the same as failed.
    let minimal = r#"{ "status": "ok", "db_connected": true, "db_error": "" }"#;
    let parsed = body(minimal);
    assert!(parsed.paddle.is_none() && parsed.midtrans.is_none() && parsed.smtp.is_none());
    assert!(parsed.broken_subsystems().is_empty());
    let (state, _) = classify_license_health(200, Some(&parsed));
    assert_eq!(state, HealthState::Operational);
}

#[test]
fn a_missing_payment_key_is_reported_as_a_broken_gate() {
    let json = OK_BODY.replace(
        "\"server_key_configured\": true",
        "\"server_key_configured\": false",
    );
    let parsed = body(&json);
    assert_eq!(parsed.broken_subsystems(), vec!["midtrans"]);
    // Degraded, not Unavailable: the server is answering and checkout still
    // works on the providers that are configured.
    let (state, cause) = classify_license_health(200, Some(&parsed));
    assert_eq!(state, HealthState::Degraded);
    assert_eq!(cause.as_deref(), Some("midtrans"));
}

#[test]
fn an_unverified_configured_smtp_is_broken_but_an_unconfigured_one_is_not() {
    let unverified = OK_BODY.replace("\"verified\": true", "\"verified\": false");
    assert_eq!(
        body(&unverified).broken_subsystems(),
        vec!["smtp"],
        "configured but rejected by the relay is a real fault"
    );
    let unconfigured = OK_BODY.replace(
        "\"configured\": true, \"verified\": true",
        "\"configured\": false, \"verified\": false",
    );
    assert!(
        body(&unconfigured).broken_subsystems().is_empty(),
        "no SMTP configured is not a broken SMTP"
    );
}

#[test]
fn a_missing_signing_key_is_broken_but_a_missing_webhook_is_not() {
    // Both blocks have the same shape and opposite weight: rsa missing means
    // licenses cannot be signed, discord missing means one support relay is
    // off. The server's own comment draws that line and the classifier has to
    // agree with it.
    let no_rsa = OK_BODY.replace(
        "\"rsa\": { \"configured\": true }",
        "\"rsa\": { \"configured\": false }",
    );
    assert_eq!(body(&no_rsa).broken_subsystems(), vec!["rsa"]);
    let no_discord = DEGRADED_BODY.replace(
        "\"discord\": { \"configured\": false }",
        "\"discord\": { \"configured\": true }",
    );
    assert_eq!(
        body(&no_discord).broken_subsystems(),
        vec!["database"],
        "discord is informational and never appears"
    );
}

#[test]
fn broken_subsystems_are_listed_in_payload_order() {
    let json = OK_BODY
        .replace(
            "\"server_key_configured\": true",
            "\"server_key_configured\": false",
        )
        .replace("\"verified\": true", "\"verified\": false");
    assert_eq!(
        body(&json).broken_subsystems(),
        vec!["smtp", "midtrans"],
        "stable order so a rendered cause string does not shuffle"
    );
}

// ── state ordering ────────────────────────────────────────────────

#[test]
fn unknown_never_outranks_a_known_state() {
    // Load-bearing: if Unknown were worst, a rollup taken before the slowest
    // probe returned would report Unknown and the banner would flicker with
    // polling order rather than with health.
    assert_eq!(
        HealthState::Unknown.worst(HealthState::Unavailable),
        HealthState::Unavailable
    );
    assert_eq!(
        HealthState::Degraded.worst(HealthState::Unknown),
        HealthState::Degraded
    );
    assert_eq!(
        HealthState::Unknown.worst(HealthState::Operational),
        HealthState::Operational
    );
}

#[test]
fn unavailable_outranks_degraded() {
    assert_eq!(
        HealthState::Degraded.worst(HealthState::Unavailable),
        HealthState::Unavailable
    );
    assert_eq!(
        HealthState::Unavailable.worst(HealthState::Degraded),
        HealthState::Unavailable
    );
}

#[test]
fn aggregation_takes_the_worst_known_state() {
    let states = [
        HealthState::Operational,
        HealthState::Unknown,
        HealthState::Degraded,
        HealthState::Operational,
    ];
    assert_eq!(aggregate(&states), HealthState::Degraded);
    let with_outage = [HealthState::Degraded, HealthState::Unavailable];
    assert_eq!(aggregate(&with_outage), HealthState::Unavailable);
}

#[test]
fn an_empty_rollup_is_unknown_not_operational() {
    // Nothing probed is not the same as everything fine.
    assert_eq!(aggregate(&[]), HealthState::Unknown);
}

#[test]
fn degraded_counts_as_usable_and_unavailable_does_not() {
    // Degraded means reduce what you rely on, not stop. A POS terminal that
    // went offline over a database hiccup on the license server would be a
    // worse outcome than one that keeps selling.
    assert!(HealthState::Degraded.is_usable());
    assert!(HealthState::Operational.is_usable());
    assert!(!HealthState::Unavailable.is_usable());
    assert!(!HealthState::Unknown.is_usable());
}

// ── key round-trips ───────────────────────────────────────────────

#[test]
fn every_state_key_round_trips_and_is_unique() {
    let mut seen = Vec::new();
    for state in HealthState::ALL {
        let key = state.as_str();
        assert_eq!(
            HealthState::parse(key),
            Some(state),
            "key {key} round-trips"
        );
        assert!(!seen.contains(&key), "duplicate key {key}");
        seen.push(key);
    }
}

#[test]
fn every_service_key_round_trips_and_is_unique() {
    let mut seen = Vec::new();
    for kind in ServiceKind::ALL {
        let key = kind.as_str();
        assert_eq!(ServiceKind::parse(key), Some(kind), "key {key} round-trips");
        assert!(!seen.contains(&key), "duplicate key {key}");
        seen.push(key);
    }
}

#[test]
fn unknown_keys_parse_as_none_rather_than_a_default() {
    assert_eq!(ServiceKind::parse("billing"), None);
    assert_eq!(ServiceKind::parse(""), None);
    assert_eq!(
        HealthState::parse("ok"),
        None,
        "the server's word is not our key"
    );
    assert_eq!(
        HealthState::parse("Operational"),
        None,
        "keys are case-sensitive"
    );
}
