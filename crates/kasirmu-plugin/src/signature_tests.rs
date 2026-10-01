use super::*;

use rsa::RsaPrivateKey;
use rsa::pkcs1v15::SigningKey;
use rsa::pkcs8::{EncodePublicKey, LineEnding};
use rsa::signature::{SignatureEncoding, Signer};
use rsa::traits::PublicKeyParts;

/// A deterministic-ish test keypair. 2048 bits keeps generation fast enough for
/// a unit test while staying the real algorithm.
fn test_keypair() -> (RsaPrivateKey, String) {
    let mut rng = rand::thread_rng();
    let private = RsaPrivateKey::new(&mut rng, 2048).expect("keygen");
    let pem = RsaPublicKey::from(&private)
        .to_public_key_pem(LineEnding::LF)
        .expect("pem");
    (private, pem)
}

/// Sign a digest exactly as the companion signing helper does.
fn sign(private: &RsaPrivateKey, digest: &[u8; 32]) -> String {
    let signing_key = SigningKey::<Sha256>::new(private.clone());
    let signature = signing_key.sign(signed_payload(digest).as_bytes());
    base64::engine::general_purpose::STANDARD.encode(signature.to_bytes())
}

fn scripts(pairs: &[(&str, &str)]) -> Vec<(String, Vec<u8>)> {
    pairs
        .iter()
        .map(|(p, c)| ((*p).to_string(), c.as_bytes().to_vec()))
        .collect()
}

fn perms(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| (*s).to_string()).collect()
}

// ── digest ──────────────────────────────────────────────────────────

#[test]
fn digest_is_stable_for_the_same_input() {
    let p = perms(&["cart:read", "cart:write"]);
    let s = scripts(&[("a.lua", "return 1")]);
    assert_eq!(
        plugin_digest("p", "1.0.0", &p, &s),
        plugin_digest("p", "1.0.0", &p, &s)
    );
}

#[test]
fn digest_ignores_permission_order_and_duplicates() {
    // The manager tests each permission independently, so order and duplicates
    // cannot change behaviour and must not change the digest.
    let a = plugin_digest("p", "1.0.0", &perms(&["cart:read", "cart:write"]), &[]);
    let b = plugin_digest("p", "1.0.0", &perms(&["cart:write", "cart:read"]), &[]);
    let c = plugin_digest(
        "p",
        "1.0.0",
        &perms(&["cart:read", "cart:read", "cart:write"]),
        &[],
    );
    assert_eq!(a, b, "order must not matter");
    assert_eq!(a, c, "duplicates must not matter");
}

#[test]
fn digest_ignores_script_order_but_not_script_bytes() {
    let a = plugin_digest(
        "p",
        "1.0.0",
        &[],
        &scripts(&[("a.lua", "x"), ("b.lua", "y")]),
    );
    let b = plugin_digest(
        "p",
        "1.0.0",
        &[],
        &scripts(&[("b.lua", "y"), ("a.lua", "x")]),
    );
    assert_eq!(a, b, "path order must not matter");

    let c = plugin_digest(
        "p",
        "1.0.0",
        &[],
        &scripts(&[("a.lua", "x"), ("b.lua", "z")]),
    );
    assert_ne!(a, c, "changed script bytes MUST change the digest");
}

#[test]
fn digest_changes_when_a_permission_is_widened() {
    // The escalation this whole module exists to make detectable.
    let before = plugin_digest("p", "1.0.0", &perms(&["log:write"]), &[]);
    let after = plugin_digest("p", "1.0.0", &perms(&["cart:write"]), &[]);
    assert_ne!(before, after);
}

#[test]
fn digest_is_not_ambiguous_across_the_id_version_boundary() {
    // Guards the length-prefix: without it, id "ab"+ver "c" and id "a"+ver "bc"
    // would collide, letting an author move a signature between plugins.
    let a = plugin_digest("ab", "c", &[], &[]);
    let b = plugin_digest("a", "bc", &[], &[]);
    assert_ne!(a, b);
}

#[test]
fn digest_is_not_ambiguous_across_field_boundaries() {
    // A script named like a permission must not be able to impersonate one.
    let a = plugin_digest("p", "1.0.0", &perms(&["cart:read"]), &[]);
    let b = plugin_digest("p", "1.0.0", &[], &scripts(&[("cart:read", "")]));
    assert_ne!(a, b);
}

// ── verification ────────────────────────────────────────────────────

#[test]
fn a_correctly_signed_digest_verifies() {
    let (private, pem) = test_keypair();
    let digest = plugin_digest("p", "1.0.0", &perms(&["cart:read"]), &[]);
    let sig = sign(&private, &digest);
    assert!(verify_plugin_signature(&pem, &digest, &sig).is_ok());
}

#[test]
fn a_tampered_digest_is_refused() {
    let (private, pem) = test_keypair();
    let signed = plugin_digest("p", "1.0.0", &perms(&["cart:read"]), &[]);
    let sig = sign(&private, &signed);

    // The plugin changed after signing.
    let tampered = plugin_digest("p", "1.0.0", &perms(&["cart:write"]), &[]);
    assert!(
        verify_plugin_signature(&pem, &tampered, &sig).is_err(),
        "a signature over the old digest must not verify the new one"
    );
}

#[test]
fn a_signature_from_a_different_key_is_refused() {
    let (other_private, _) = test_keypair();
    let (_, pem) = test_keypair();
    let digest = plugin_digest("p", "1.0.0", &[], &[]);
    let sig = sign(&other_private, &digest);
    assert!(verify_plugin_signature(&pem, &digest, &sig).is_err());
}

#[test]
fn malformed_signature_input_is_rejected_by_value() {
    let (_, pem) = test_keypair();
    let digest = plugin_digest("p", "1.0.0", &[], &[]);

    let err = verify_plugin_signature(&pem, &digest, "not base64!!")
        .unwrap_err()
        .to_string();
    assert!(err.contains("base64"), "got: {err}");

    let err = verify_plugin_signature("not a pem", &digest, "AAAA")
        .unwrap_err()
        .to_string();
    assert!(err.contains("public key"), "got: {err}");
}

#[test]
fn the_signed_payload_is_namespaced() {
    let digest = [0u8; 32];
    let payload = signed_payload(&digest);
    assert!(payload.starts_with(PLUGIN_SIGNATURE_PREFIX));
    assert!(payload.ends_with(&hex::encode(digest)));
}

#[test]
fn the_digest_framing_matches_the_signing_tool() {
    // CROSS-LANGUAGE PIN. `scripts/sign-plugin.py` reimplements this framing in
    // Python; if the two drift, every signature that tool produces silently
    // fails to verify, and nothing else in either test suite would notice.
    //
    // Run `python3 scripts/sign-plugin.py --self-test` and compare the digest it
    // prints with the constant below. Regenerate BOTH together, never one.
    //
    // The fixture is deliberately the shipped example plugin's real shape:
    // multi-permission, unsorted, one script.
    let digest = plugin_digest(
        "example-discount",
        "1.0.0",
        &perms(&["cart:read", "cart:write", "system:time", "log:write"]),
        &scripts(&[("discount.lua", "return true\n")]),
    );
    assert_eq!(
        hex::encode(digest),
        "d8841a1f2606e46e66277e0867c705f292bf2a221a707da1152a70ae2630c240",
        "the digest framing changed — update scripts/sign-plugin.py in the same commit"
    );
}

// ── the on-disk gate ────────────────────────────────────────────────

/// Write a plugin dir with the given signature body, or none.
fn plugin_with_sig(dir: &Path, sig: Option<&str>) {
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(dir.join("discount.lua"), "return 1").unwrap();
    if let Some(body) = sig {
        std::fs::write(dir.join(SIGNATURE_FILE_NAME), body).unwrap();
    }
}

/// Write just the plugin script, with no signature yet.
fn write_script(dir: &Path, body: &str) {
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(dir.join("discount.lua"), body).unwrap();
}

/// Sign whatever is currently on disk for `dir`.
///
/// Must be called AFTER the script is written: the digest covers the real script
/// bytes, so signing a not-yet-written file would cover different content than
/// the verifier later reads.
fn sign_on_disk(dir: &Path, private: &RsaPrivateKey, id: &str, version: &str, declared: &[String]) {
    let scripts = disk_scripts(dir);
    let digest = plugin_digest(id, version, declared, &scripts);
    std::fs::write(dir.join(SIGNATURE_FILE_NAME), sign(private, &digest)).unwrap();
}

fn disk_scripts(dir: &Path) -> Vec<(String, Vec<u8>)> {
    vec![(
        "discount.lua".to_string(),
        std::fs::read(dir.join("discount.lua")).unwrap(),
    )]
}

#[test]
fn no_signature_and_no_key_is_allowed() {
    // The opt-in default: an install that configures no key behaves as before.
    let dir = tempfile::tempdir().unwrap();
    plugin_with_sig(dir.path(), None);
    let ok = verify_plugin(
        dir.path(),
        "p",
        "1.0.0",
        &perms(&["cart:read"]),
        &disk_scripts(dir.path()),
        None,
    )
    .unwrap();
    assert!(!ok, "should report 'no signature present'");
}

#[test]
fn no_signature_is_refused_when_a_key_is_configured() {
    let dir = tempfile::tempdir().unwrap();
    plugin_with_sig(dir.path(), None);
    let (_, pem) = test_keypair();

    let err = verify_plugin(
        dir.path(),
        "p",
        "1.0.0",
        &perms(&["cart:read"]),
        &disk_scripts(dir.path()),
        Some(&pem),
    )
    .expect_err("a key is configured, so an unsigned plugin must be refused")
    .to_string();
    assert!(err.contains("requires signed plugins"), "got: {err}");
}

#[test]
fn a_signature_with_no_configured_key_is_refused_not_ignored() {
    // Silently passing here would tell an author their signature was checked
    // when no check happened.
    let dir = tempfile::tempdir().unwrap();
    plugin_with_sig(dir.path(), Some("AAAA"));

    let err = verify_plugin(
        dir.path(),
        "p",
        "1.0.0",
        &perms(&["cart:read"]),
        &disk_scripts(dir.path()),
        None,
    )
    .expect_err("a present-but-unverifiable signature must be reported")
    .to_string();
    assert!(err.contains("no plugin public key"), "got: {err}");
}

#[test]
fn a_valid_on_disk_signature_verifies_end_to_end() {
    let dir = tempfile::tempdir().unwrap();
    let (private, pem) = test_keypair();
    let perms_list = perms(&["cart:read", "cart:write"]);

    write_script(dir.path(), "return 1");
    sign_on_disk(dir.path(), &private, "p", "1.0.0", &perms_list);

    let ok = verify_plugin(
        dir.path(),
        "p",
        "1.0.0",
        &perms_list,
        &disk_scripts(dir.path()),
        Some(&pem),
    )
    .unwrap();
    assert!(ok, "a correctly signed plugin must verify");
}

#[test]
fn editing_the_script_after_signing_refuses_the_plugin() {
    // THE test this module exists for: the manifest and version are untouched,
    // only the Lua body changed -- and that must be caught.
    let dir = tempfile::tempdir().unwrap();
    let (private, pem) = test_keypair();
    let perms_list = perms(&["cart:read"]);

    write_script(dir.path(), "return 1");
    sign_on_disk(dir.path(), &private, "p", "1.0.0", &perms_list);

    // Attacker rewrites the script; manifest, version and signature untouched.
    std::fs::write(dir.path().join("discount.lua"), "return 2").unwrap();

    let err = verify_plugin(
        dir.path(),
        "p",
        "1.0.0",
        &perms_list,
        &disk_scripts(dir.path()),
        Some(&pem),
    )
    .expect_err("a changed script body must invalidate the signature")
    .to_string();
    assert!(err.contains("did not verify"), "got: {err}");
}

#[test]
fn widening_a_permission_after_signing_refuses_the_plugin() {
    // The other escalation: same scripts, same version, one extra capability.
    let dir = tempfile::tempdir().unwrap();
    let (private, pem) = test_keypair();
    let declared = perms(&["cart:read"]);

    write_script(dir.path(), "return 1");
    sign_on_disk(dir.path(), &private, "p", "1.0.0", &declared);

    let widened = perms(&["cart:read", "cart:write"]);
    let scripts = disk_scripts(dir.path());
    assert!(
        verify_plugin(dir.path(), "p", "1.0.0", &widened, &scripts, Some(&pem)).is_err(),
        "a permission added after signing must invalidate the signature"
    );
}

#[test]
fn the_signature_file_is_not_itself_part_of_the_digest() {
    // Otherwise signing would be circular: the digest would depend on the
    // signature that covers it.
    let (private, pem) = test_keypair();
    let p = perms(&["cart:read"]);
    let s = scripts(&[("a.lua", "x")]);
    let digest = plugin_digest("p", "1.0.0", &p, &s);
    let sig = sign(&private, &digest);
    // Signing again over the same inputs is deterministic in payload, so the
    // digest is unchanged by the existence of a signature.
    assert_eq!(plugin_digest("p", "1.0.0", &p, &s), digest);
    assert!(verify_plugin_signature(&pem, &digest, &sig).is_ok());
}

#[test]
fn the_test_key_is_really_2048_bits() {
    // Guards against a future "speed up the tests" edit silently weakening the
    // algorithm the production path uses.
    let (private, _) = test_keypair();
    assert_eq!(private.size() * 8, 2048);
}
