//! Unit tests for attestation (super).

use super::*;
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

#[test]
fn sources_are_labelled_only_for_compiled_origins() {
    let [main, fallback] = release_ladder();
    assert_eq!(source_for(main), Some(OriginSource::Main));
    assert_eq!(source_for(fallback), Some(OriginSource::Fallback));
    assert_eq!(source_for("https://evil.example.com"), None);
}
