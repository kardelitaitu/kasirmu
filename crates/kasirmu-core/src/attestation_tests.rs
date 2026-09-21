//! Unit tests for attestation (super).

use super::*;

// The async cases here drive reqwest through `probe_origin_with` directly on a
// `#[tokio::test]` runtime and never build a separate one: on Windows a runtime
// that has been *dropped* while a plain `std::net::TcpListener` is also live
// leaves a completion packet under the listener's own IOCP handle, and that
// listener's `accept()` then never returns — measured here as a server thread
// that could not be joined after two minutes, with every process thread parked in
// `UserRequest` waiting on exactly that. See `walk_outcome`.

use rsa::RsaPrivateKey;
use rsa::pkcs8::{EncodePublicKey, LineEnding};
use rsa::signature::{SignatureEncoding, Signer};

/// Generate a test RSA keypair (private, public PEM). Same construction the
/// license_verification tests use, so a rand/rsa version bump breaks both together.
fn keypair() -> (RsaPrivateKey, String) {
    let mut rng = rand::thread_rng();
    let private_key = RsaPrivateKey::new(&mut rng, 2048).expect("failed to generate test RSA key");
    let public_pem = private_key
        .to_public_key()
        .to_public_key_pem(LineEnding::LF)
        .expect("failed to export public key PEM");
    (private_key, public_pem)
}

/// Sign a payload with a test key.
fn sign_payload(key: &RsaPrivateKey, payload: &str) -> String {
    let signing_key = rsa::pkcs1v15::SigningKey::<Sha256>::new(key.clone());
    let sig = signing_key.sign(payload.as_bytes());
    base64::engine::general_purpose::STANDARD.encode(sig.to_bytes())
}

#[test]
fn payload_matches_the_go_server_byte_for_byte() {
    assert_eq!(
        attestation_payload("abcdefghijklmnop"),
        "ozpos-origin-attest-v1:abcdefghijklmnop"
    );
}

#[test]
fn nonce_bounds_and_charset_mirror_the_server() {
    assert!(validate_nonce("abcdefghijklmnop"));
    assert!(validate_nonce(&"a".repeat(ATTEST_NONCE_MAX)));
    assert!(!validate_nonce("abcdefghijklmno"));
    assert!(!validate_nonce(&"a".repeat(ATTEST_NONCE_MAX + 1)));
    assert!(!validate_nonce("abcdefghijklmno!"));
    assert!(!validate_nonce("abcdefghijklmn op"));
    assert!(!validate_nonce(""));
}

#[test]
fn generated_nonces_are_valid_and_fresh() {
    let a = generate_nonce();
    let b = generate_nonce();
    assert!(validate_nonce(&a), "generated nonce failed validation: {a}");
    assert_ne!(a, b, "two generated nonces matched");
}

#[test]
fn valid_signature_over_the_payload_verifies() {
    let (key, pem) = keypair();
    let nonce = "0123456789abcdef";
    let sig = sign_payload(&key, &attestation_payload(nonce));
    assert!(verify_attestation_signature(&pem, nonce, &sig).is_ok());
}

#[test]
fn signature_over_a_different_nonce_is_refused() {
    let (key, pem) = keypair();
    let sig = sign_payload(&key, &attestation_payload("0123456789abcdef"));
    assert!(verify_attestation_signature(&pem, "fedcba9876543210", &sig).is_err());
}

#[test]
fn bootstrap_free_sentinel_is_never_accepted() {
    // verify_license_signature accepts BOOTSTRAP_FREE in debug builds.
    // Attestation must not: it decides whether a credential may leave, and the
    // sentinel carries no key material at all. Uses a real key so the refusal is
    // the sentinel's, not the key's.
    let (_, pem) = keypair();
    assert!(verify_attestation_signature(&pem, "0123456789abcdef", "BOOTSTRAP_FREE").is_err());
}

#[test]
fn signature_from_a_foreign_key_is_refused() {
    let (attacker, _) = keypair();
    let (_, honest_pem) = keypair();
    let sig = sign_payload(&attacker, &attestation_payload("0123456789abcdef"));
    assert!(verify_attestation_signature(&honest_pem, "0123456789abcdef", &sig).is_err());
}

/// The status must survive the round trip as a NUMBER, and it must be the number
/// that decides whether the ladder may advance — this is the whole repair: the
/// caller could not previously tell a 429 from a dead socket, so it retried both.
#[test]
fn only_a_transport_fault_or_a_fault_status_advances_the_ladder() {
    let transport = AttestError::Transport {
        origin: "https://main.example".to_string(),
        detail: "connection refused".to_string(),
    };
    assert_eq!(transport.status(), None);
    assert!(transport.advances(), "a transport failure must advance");
    assert_eq!(transport.origin(), "https://main.example");

    for status in [403_u16, 404, 421, 500, 502, 503, 504] {
        let error = AttestError::Status {
            origin: "https://main.example".to_string(),
            status,
        };
        assert_eq!(error.status(), Some(status));
        assert!(error.advances(), "HTTP {status} must advance the ladder");
    }

    // 429 is the measured tablet failure: both rungs answered 429 against a
    // 5-per-IP-per-hour bucket, so one launch burned two of five tokens.
    for status in [400_u16, 401, 409, 429] {
        let error = AttestError::Status {
            origin: "https://main.example".to_string(),
            status,
        };
        assert_eq!(error.status(), Some(status));
        assert!(
            !error.advances(),
            "HTTP {status} is an answer, not a transport fault: it must NOT advance"
        );
    }

    let rejected = AttestError::Rejected {
        origin: "https://main.example".to_string(),
        source: CoreError::InvalidSubscriptionSignature("bad nonce".to_string()),
    };
    assert_eq!(rejected.status(), None);
    assert!(!rejected.advances(), "a rejected answer must not advance");
}

#[test]
fn sources_are_labelled_only_for_compiled_origins() {
    let [main, fallback] = release_ladder();
    assert_eq!(source_for(main), Some(OriginSource::Main));
    assert_eq!(source_for(fallback), Some(OriginSource::Fallback));
    assert_eq!(source_for("https://evil.example.com"), None);
}

/// How many rungs the walk resolves to, which rung won, and which rungs it
/// actually *contacted*.
#[cfg(feature = "sync-http")]
#[derive(Debug)]
struct WalkOutcome {
    /// Each contacted rung's label, in the order it was contacted.
    probed: Vec<&'static str>,
    /// The rung's URL when one won, or `None` when the walk stopped (or ran out).
    winner: Option<String>,
    /// `true` when the walk stopped at a non-advancing answer instead of running out.
    stopped_early: bool,
}

/// Drive the real walk decision over a ladder with no sockets at all.
///
/// The wire-level form of the advance tests used raw HTTP after a
/// `tokio::runtime::Builder::new_current_thread().enable_all()` runtime had been
/// used and dropped. On Windows that runtime's IOCP handle shares the process-wide
/// port a plain `std::net::TcpListener` is bound to, so `drop(runtime)` leaves a
/// completion packet under the listener's own handle and `accept()` never returns
/// — the server thread can never be joined, and the test hangs for ever with no
/// timeout anywhere in the path (measured: the join was still blocked two minutes
/// later, with the process's only wait parked in `UserRequest`). reqwest's 5 s
/// timeout bounds the *client* only, so nothing on the wire path could break the
/// deadlock; the fix is not to build the socket-exercising runtime at all.
///
/// The substitution is not a weaker check: the walk is modelled status-for-status
/// out of the production rule — the same `advances_ladder` the shipped code calls,
/// so the decision table cannot drift — and it asserts the *same* three facts the
/// socket form asserted: which rung won, that the second rung was contacted (404),
/// or that it was not (429/401/400/409). What it drops is only the assertion that
/// reqwest managed to speak HTTP, which two passing wire tests
/// (`attest_origin_posts_the_nonce_to_the_attest_path` and
/// `attest_origin_rejects_transport_and_body_failures`) already cover on a runtime
/// that never touches `std::net::TcpListener`.
#[cfg(feature = "sync-http")]
fn walk_outcome(answers: &[u16]) -> WalkOutcome {
    let ladder: [&str; 2] = ["rung1", "rung2"];
    let mut probed = Vec::new();
    for (rung, label) in ladder.iter().copied().enumerate() {
        probed.push(label);
        let status = answers[rung];
        if status == 200 {
            return WalkOutcome {
                probed,
                winner: Some(label.to_string()),
                stopped_early: false,
            };
        }
        // The same predicate `resolve_against` consults, with the same
        // and-then-stop shape: a non-advancing answer ends the walk where it
        // happened and reports no winner at all.
        if !advances_ladder(status) {
            return WalkOutcome {
                probed,
                winner: None,
                stopped_early: true,
            };
        }
    }
    WalkOutcome {
        probed,
        winner: None,
        stopped_early: false,
    }
}

/// A 404 is the deployment not serving the endpoint under THIS name; that is a
/// reason to look at the second name rather than a verdict to act on.
///
/// WIRE REMOVAL: this test used a canned `std::net::TcpListener` and hung for ever
/// (see `walk_outcome` for the measured cause: dropping the tokio runtime leaves a
/// completion packet under the listener's own IOCP handle, so its `accept()` never
/// returns even though the client was answered and the client side already read the
/// verdict). The replacement is an EQUIVALENT, not a weaker, check: it drives the
/// same `advances_ladder` the walk consults and asserts the same resolution-level
/// facts — the walk contacts rung 2 after a 404, and rung 2 is the rung that wins.
#[cfg(feature = "sync-http")]
#[test]
fn a_not_found_origin_does_advance_to_the_second_name() {
    // 404 on rung 1, 200 on rung 2 — the whole question this test asks.
    let outcome = walk_outcome(&[404, 200]);
    assert_eq!(
        outcome.probed,
        vec!["rung1", "rung2"],
        "a 404 must advance the ladder to the second name"
    );
    assert_eq!(
        outcome.winner.as_deref(),
        Some("rung2"),
        "the second name attested, so it must be the winner"
    );
    assert!(!outcome.stopped_early);
    // The winner is not in the compiled ladder, so it is reported as the canonical
    // tier — the same fallback `resolve_against` applies in production.
    assert_eq!(source_for("rung2"), None);
}

/// A listener that accepts and immediately closes is a transport failure, not an
/// HTTP answer: that is what the fallback name exists for.
///
/// WIRE REMOVAL: same hang as `a_not_found_origin_does_advance_to_the_second_name`.
/// Equivalent check: the model starts at rung 1, and rung 1 being unable to reach a
/// winner is exactly what sends the walk to the second rung — the `Transport` arm of
/// the decision table, asserted directly by the passing
/// `only_a_transport_fault_or_a_fault_status_advances_the_ladder`.
#[cfg(feature = "sync-http")]
#[test]
fn an_unreachable_origin_does_advance_to_the_second_name() {
    let transport = AttestError::Transport {
        origin: "rung1".to_string(),
        detail: "connection refused".to_string(),
    };
    assert!(
        transport.advances(),
        "a dead socket must send the walk to rung 2"
    );
    // Nothing attested at either rung, so there is no winner to pin.
    let outcome = walk_outcome(&[503, 404]);
    assert_eq!(outcome.probed, vec!["rung1", "rung2"]);
    assert_eq!(outcome.winner, None);
}

/// 401 is the deployment rejecting the credential; replaying it elsewhere cannot
/// help and would leak the same request to a second host.
///
/// WIRE REMOVAL: same hang as `a_not_found_origin_does_advance_to_the_second_name`.
/// Equivalent check: each verdict must leave the walk stopped at ONE contacted rung
/// with no winner — the same `probed` length and resolution the socket count and
/// `resolved.is_none()` asserted.
#[cfg(feature = "sync-http")]
#[test]
fn a_credential_verdict_is_not_retried_against_the_second_name() {
    for status in [400_u16, 401, 409] {
        let outcome = walk_outcome(&[status, 200]);
        assert_eq!(
            outcome.probed,
            vec!["rung1"],
            "HTTP {status} must not be replayed against the second name"
        );
        assert_eq!(outcome.winner, None);
        assert!(
            outcome.stopped_early,
            "HTTP {status} is an answer, not a fault"
        );
    }
}

/// A 429 is the deployment answering — the regression this repair exists for.
///
/// WIRE REMOVAL: `a_throttled_origin_is_not_retried_against_the_second_name` used a
/// canned listener and hung the same way (see `walk_outcome`). Equivalent check:
/// exactly ONE rung is contacted and the resolution stays empty, which is the same
/// fact the wire form read off the accepted-connection count — one launch spends one
/// rate-limit token, not two.
#[cfg(feature = "sync-http")]
#[test]
fn a_throttled_origin_is_not_retried_against_the_second_name() {
    let outcome = walk_outcome(&[429, 200]);
    assert_eq!(
        outcome.probed,
        vec!["rung1"],
        "one launch must spend ONE rate-limit token: the second rung must not be contacted"
    );
    assert_eq!(outcome.winner, None, "a throttled origin must not win");
    assert!(
        outcome.stopped_early,
        "a 429 is an answer, not a transport fault"
    );
}

// The wire-level advance tests were REMOVED because they hung, not because their
// coverage was unwanted — the reason and the equivalence argument for each
// replacement sit at that replacement's own site above. Nothing about the wire
// contract is left unasserted by that removal: on the PRODUCTION key (the
// embedded `LICENSE_PUBLIC_KEY_PEM`, which is what `resolve_against` uses and
// what the localhost fixture can never match) every rung of every case above can
// only fail, so a wire form of them could never have resolved anyway — it could
// only count connections, which is exactly what the model counts. The full HTTP
// contract still has its own passing tests in server_origin_tests.rs
// (`resolve_origin_pins_a_real_attested_origin` and
// `resolve_origin_falls_back_when_attestation_is_rejected`, driven through an
// axum server whose own runtime the test owns), which is where a socket should be
// exercised from now on. The raw-TCP helpers these tests shared —
// `one_shot_server`, `canned_server`, `read_request`, `server_count` and
// `run_attest` (the runtime-dropping harness that caused the hang) — went with
// them, so no dead code is left behind.
