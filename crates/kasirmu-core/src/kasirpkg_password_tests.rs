//! Tests for the password precondition on [`export_kasirpkg`].
//!
//! Separate module rather than extra cases in `kasirpkg_tests.rs`: that file is
//! edited concurrently by other agents in this worktree, and a shared test
//! file is where commits have already collided here.

use super::*;

fn payload() -> KasirpkgPayload {
    KasirpkgPayload {
        products: vec![serde_json::json!({"sku": "SKU-1"})],
        categories: vec![],
        sales: None,
        customers: None,
        users: None,
        settings: None,
    }
}

fn export(password: &str) -> Result<Vec<u8>, CoreError> {
    export_kasirpkg(
        password,
        "Kopi Senja",
        "0.0.1",
        vec!["products".into()],
        std::collections::HashMap::new(),
        &payload(),
    )
}

#[test]
fn export_refuses_an_empty_password() {
    // The key is Argon2id(password, salt) and the salt ships in the
    // PLAINTEXT header, so an empty password is not "encryption with a
    // weak secret" - it is no encryption at all, and the file carries
    // everything needed to derive the key.
    //
    // Scope, checked rather than assumed: the desktop UI DOES guard this
    // (the data-management screen requires >= 8 chars, plus a confirm
    // field), so an operator clicking through Export cannot produce such
    // a file. What is missing is the same rule one layer down:
    // `kasirmu-cli export-kasirpkg --password ""` passes clap (the arg is
    // required to be PRESENT, not non-empty) and reaches export_kasirpkg
    // unchanged, and any future caller inherits the trap. A
    // crypto-critical precondition enforced only in one screen's validation
    // is enforced in the wrong place.
    // `.expect_err(..)` rather than `expect_err(..)`: on failure the
    // latter dumps the whole exported Vec<u8> into the log, which is both
    // unreadable and a plaintext header (salt, nonce, store name) sitting
    // in CI output.
    let err = export("").expect_err("an empty password must not produce a backup");
    assert!(
        err.to_string().contains("password"),
        "the error must name the cause, got: {err}"
    );
}

#[test]
fn export_refuses_a_whitespace_only_password() {
    // "   " is the same accident (an unfilled field, a stray keystroke)
    // and derives just as deterministically as "".
    let err = export("   ").expect_err("a whitespace-only password must not produce a backup");
    assert!(err.to_string().contains("password"), "got: {err}");
}

#[test]
fn export_still_accepts_a_real_password_of_any_length() {
    // The guard is about emptiness only. Rejecting short-but-real
    // passwords would be a policy call this module has no business
    // making, and would break existing callers.
    let bytes = export("x").expect("a one-character password is still a password");
    let (header, payload) =
        import_kasirpkg(&bytes, "x").expect("must round-trip with the same password");
    assert_eq!(header.store_name, "Kopi Senja");
    assert_eq!(payload.products.len(), 1);
    // And the key still means something: a different password must not
    // open it, even one character away.
    assert!(
        import_kasirpkg(&bytes, "y").is_err(),
        "a wrong password must not decrypt"
    );
    assert!(export("correct horse battery staple").is_ok());
}

#[test]
fn import_does_not_refuse_an_empty_password() {
    // Deliberate asymmetry, and the reason this test exists. Backups
    // already written with an empty password must stay restorable -
    // refusing on import would brick them, exactly the trap avoided for
    // format v1 in B47. So the guard belongs on export only.
    //
    // A file this short fails on size, so use a full header block of
    // garbage: reaching the header parse proves no password check fired
    // first.
    let data = vec![b'x'; HEADER_LEN + 8];
    let err = import_kasirpkg(&data, "")
        .expect_err("garbage cannot import")
        .to_string();
    assert!(
        !err.to_lowercase().contains("required"),
        "import must not gate on an empty password, got: {err}"
    );
    assert!(
        err.to_lowercase().contains("header"),
        "expected the failure to come from parsing the header, got: {err}"
    );
}
