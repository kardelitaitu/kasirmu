//! Drives the REAL process-global install key, in a process of its own.
//!
//! `INSTALL_KEY` is a `OnceLock`: once set it cannot be cleared, so installing a
//! key from `src/lib_tests.rs` would change the selected derivation for every
//! other case in that binary. Every unit case therefore injects its key sources
//! through `portable_key_from` / `candidate_keys_from` instead.
//!
//! An integration test is a separate process, which makes it the only place the
//! global can be exercised honestly — and the global is the thing S2b-2's boot
//! path will drive, so leaving it untested would leave the seam's contract
//! unproven. The public API is sufficient: `set_install_key`,
//! `install_key_derivation_active`, and the portable encrypt/decrypt pair.
//!
//! # Why this file is not called `install_key_process.rs`
//!
//! Windows UAC installer detection treats an executable whose NAME contains
//! "install" (or "setup", "update", "patch") as an installer and refuses to run it
//! without elevation — `cargo test` then dies with
//! `could not execute process ... (os error 740)` / `ERROR_ELEVATION_REQUIRED`,
//! even though the identical bytes run fine under another name. The test target's
//! binary name comes from the file stem, so the stem must avoid those words.

use kasirmu_crypto::{
    decrypt_sync_api_key, encrypt_sync_api_key, install_key_derivation_active, set_install_key,
};

/// The whole S2b-1 contract, end to end on the production public API:
/// a clean process reports inactive, the first install wins, writes move to the
/// installed key (H1), and rows written before the install still read (H4).
#[test]
fn the_installed_key_governs_writes_and_the_previous_rows_still_read() {
    // 1. A clean process selects the pre-seam derivation.
    assert!(
        !install_key_derivation_active(),
        "a fresh process must report no install key"
    );

    // 2. A row written BEFORE the upgrade, under whichever derivation a process
    //    with no install key selects (the legacy one, or an ambient master key).
    let pre_upgrade = encrypt_sync_api_key("pre-upgrade-secret").expect("encrypt before install");

    // 3. Install the key. This is what S2b-2's boot path will do once it has read
    //    the keychain.
    assert!(set_install_key([0x5A; 32]), "the first install must win");
    assert!(
        install_key_derivation_active(),
        "an installed key must report active"
    );

    // 4. Idempotent: a later install changes nothing and says so. A boot path
    //    that calls this twice must not read the `false` as a failure.
    assert!(
        !set_install_key([0x5B; 32]),
        "the first call wins; a later call must report that it did not install"
    );
    assert!(
        install_key_derivation_active(),
        "the second call must not have cleared or replaced the key"
    );

    // 5. H4: the pre-upgrade row still reads. This is the property D1's
    //    precondition existed to guarantee, asserted through the public reader.
    assert_eq!(
        decrypt_sync_api_key(&pre_upgrade).expect("H4: pre-upgrade row must still read"),
        "pre-upgrade-secret"
    );

    // 6. H1: a row written after the install reads back, and the install really
    //    did move which derivation writes.
    let post_upgrade = encrypt_sync_api_key("post-upgrade-secret").expect("encrypt after install");
    assert_ne!(
        pre_upgrade, post_upgrade,
        "the installed key must change which derivation writes"
    );
    assert_eq!(
        decrypt_sync_api_key(&post_upgrade).expect("H1: install-key row must read"),
        "post-upgrade-secret"
    );
}
