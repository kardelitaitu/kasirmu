//! End-to-end proof that `scripts/sign-plugin.py` and the Rust verifier agree.
//!
//! The unit tests in `signature_tests.rs` prove the verifier is correct in
//! isolation, using a keypair generated inside Rust. They cannot prove the
//! **signing tool** produces something the loader accepts — that is a
//! cross-language contract, and a drift in either direction would leave every
//! signature silently unverifiable with both suites green.
//!
//! This test closes that gap from the Rust side: it shells out to the real
//! script, then loads the result through the real `PluginManager::new`. It is
//! `#[ignore]`d because it needs Python plus the `cryptography` package, which
//! CI does not guarantee; run it deliberately after touching either side:
//!
//! ```text
//! cargo test -p kasirmu-plugin -- --ignored signature_roundtrip
//! ```

#![cfg(test)]

use std::path::{Path, PathBuf};
use std::process::Command;

/// The repository root, resolved from this crate's manifest directory.
fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf()
}

fn python(script: &Path, args: &[&str]) -> std::process::Output {
    Command::new("python3")
        .arg(script)
        .args(args)
        .output()
        .unwrap_or_else(|e| panic!("running python3 {}: {e}", script.display()))
}

/// Copy the shipped example plugin into a scratch plugins directory.
///
/// Also hoists `plugin-grants.json` to the plugins ROOT: in the shipped example
/// it sits inside the plugin directory, but the grant store is read from the
/// directory handed to `PluginManager::new`, which here is the root.
fn seed_example(dir: &Path) {
    let example = repo_root().join("scripts/examples/example-discount");
    let dest = dir.join("example-discount");
    std::fs::create_dir_all(&dest).unwrap();
    for entry in std::fs::read_dir(&example).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name();
        // Skip any signature left over from a previous run so each case starts
        // from a known state.
        if name == "plugin.toml.sig" {
            continue;
        }
        // The grant file belongs at the plugins root, beside the plugin dirs.
        let target = if name == "plugin-grants.json" {
            dir.join(&name)
        } else {
            dest.join(&name)
        };
        std::fs::copy(entry.path(), target).unwrap();
    }
}

/// Read the public key PEM the signing tool prints.
fn public_key_of(private: &Path) -> String {
    let script = repo_root().join("scripts/sign-plugin.py");
    let out = python(&script, &["--key", &private.to_string_lossy(), "--print-public-key"]);
    assert!(out.status.success(), "print-public-key failed: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8(out.stdout).unwrap()
}

#[test]
#[ignore = "needs python3 + the cryptography package; run with --ignored"]
fn signature_roundtrip_sign_then_load() {
    let script = repo_root().join("scripts/sign-plugin.py");
    let tmp = tempfile::tempdir().unwrap();
    let key = tmp.path().join("key.pem");
    let plugins = tmp.path().join("plugins");
    std::fs::create_dir(&plugins).unwrap();
    seed_example(&plugins);

    // 1. Generate a keypair.
    let out = python(&script, &["--generate-key", "--key", &key.to_string_lossy()]);
    assert!(out.status.success(), "keygen failed: {}", String::from_utf8_lossy(&out.stderr));

    // 2. Sign the plugin with the real tool. NOTE the path is the PLUGIN
    //    directory, not the plugins root — the tool reads plugin.toml from the
    //    directory it is given and writes the signature beside it.
    let plugin_dir = plugins.join("example-discount");
    let out = python(&script, &["--key", &key.to_string_lossy(), &plugin_dir.to_string_lossy()]);
    assert!(out.status.success(), "signing failed: {}", String::from_utf8_lossy(&out.stderr));
    assert!(
        plugin_dir.join("plugin.toml.sig").exists(),
        "the tool must write the signature file"
    );

    // 3. The real loader must ACCEPT it with the key configured.
    let pem = public_key_of(&key);
    // SAFETY: this test is #[ignore]d and the env var is read only by
    // PluginManager::new, so a single-threaded deliberate run is the contract.
    unsafe { std::env::set_var("KASIRMU_PLUGIN_PUBLIC_KEY", &pem) };
    let loaded = kasirmu_plugin::PluginManager::new(&plugins);
    assert!(
        loaded.is_ok(),
        "a plugin signed by the real tool must load: {:?}",
        loaded.err()
    );
    unsafe { std::env::remove_var("KASIRMU_PLUGIN_PUBLIC_KEY") };

    // 4. Tampering with the script must make it REFUSE.
    std::fs::write(
        plugins.join("example-discount/discount.lua"),
        "oz.apply_discount(\"cart\", 99)\n",
    )
    .unwrap();
    unsafe { std::env::set_var("KASIRMU_PLUGIN_PUBLIC_KEY", &pem) };
    let tampered = kasirmu_plugin::PluginManager::new(&plugins);
    unsafe { std::env::remove_var("KASIRMU_PLUGIN_PUBLIC_KEY") };
    assert!(
        tampered.is_err(),
        "a tampered script must invalidate the signature and refuse the plugin"
    );

    // 5. With NO key configured, a plugin that SHIPS a signature is refused
    //    rather than silently passed: an install that never checked must not
    //    tell a signed author "fine". The error names the missing key.
    let no_key = kasirmu_plugin::PluginManager::new(&plugins)
        .expect_err("a signature with no configured key must be reported, not ignored");
    assert!(
        no_key.to_string().contains("public key"),
        "the error must name the missing key, got: {no_key}"
    );

    // 6. And with the signature file removed and still no key, the plugin loads:
    //    verification is opt-in, so an unsigned install behaves as before.
    std::fs::remove_file(plugins.join("example-discount/plugin.toml.sig")).unwrap();
    let unsigned = kasirmu_plugin::PluginManager::new(&plugins);
    assert!(
        unsigned.is_ok(),
        "without a key and without a signature, the plugin must load: {:?}",
        unsigned.err()
    );
}
