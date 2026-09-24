// ── kasir.mu Updater Compatibility Check (AUDIT-28 RELEASE-04) ─────────────
//
// This harness replicates — line for line — the signature verification path
// the REAL Tauri updater client runs, using the SAME crate and version the
// client resolves (`minisign-verify 0.2.5` via tauri-plugin-updater 2.10.1).
//
// The client code (tauri-plugin-updater 2.10.1 `src/updater.rs`,
// `verify_signature`) is:
//
//     let pub_key_decoded = base64_to_string(pub_key)?;
//     let public_key = PublicKey::decode(&pub_key_decoded)?;
//     let signature_base64_decoded = base64_to_string(release_signature)?;
//     let signature = Signature::decode(&signature_base64_decoded)?;
//     public_key.verify(data, &signature, true)?;
//
// The integration check (`scripts/check-updater-compat.mjs`) signs installers
// with `scripts/generate-latest-json.mjs`, then feeds the manifest through
// THIS harness. If the signature is accepted here — by the exact same crate
// the real client uses — it will be accepted by the real updater client,
// closing the RELEASE-04 key-format compatibility loop end to end.
//
// Usage:
//   oz-updater-compat-check <pubkey-b64> <signature-b64> <installer-path>
//   oz-updater-compat-check --pubkey-file <pub.b64> --signature-file <sig.b64> <installer-path>
//   oz-updater-compat-check --pubkey-file <pub.b64> --signature-file <sig.b64> <installer-path> --output <result.txt>
// Exit: 0 = verified, 1 = rejected, 2 = usage/IO error.
//
// `--output <file>` writes the VERIFIED/REJECTED verdict to a file so
// integration drivers can read the result reliably even when console capture
// is flaky (e.g. PowerShell-on-Windows sandboxes).
//
// The pubkey must be the base64 of the minisign.pub TEXT blob (the format in
// tauri.conf.json::plugins.updater.pubkey) and the signature the base64 of the
// minisign .sig TEXT blob (the format in latest.json platforms[].signature) —
// exactly the strings the real client base64-decodes before parsing.
// File-based arguments are provided because very long base64 values can exceed
// Windows command-line limits / get mangled by shell quoting; the integration
// driver writes them to temp files instead.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use minisign_verify::{PublicKey, Signature};
use std::process::ExitCode;

/// Mirrors tauri-plugin-updater's `base64_to_string`: decode standard base64
/// and require the result to be valid UTF-8 (the client errors otherwise).
fn base64_to_string(base64_string: &str) -> Result<String, Box<dyn std::error::Error>> {
    let decoded = STANDARD.decode(base64_string)?;
    Ok(String::from_utf8(decoded)?)
}

/// Verbatim port of tauri-plugin-updater 2.10.1 `verify_signature`.
fn verify_signature(data: &[u8], release_signature: &str, pub_key: &str) -> Result<bool, String> {
    let pub_key_decoded =
        base64_to_string(pub_key).map_err(|e| format!("pubkey base64/utf8: {e}"))?;
    let public_key =
        PublicKey::decode(&pub_key_decoded).map_err(|e| format!("PublicKey::decode: {e}"))?;
    let signature_base64_decoded =
        base64_to_string(release_signature).map_err(|e| format!("signature base64/utf8: {e}"))?;
    let signature =
        Signature::decode(&signature_base64_decoded).map_err(|e| format!("Signature::decode: {e}"))?;
    public_key
        .verify(data, &signature, true)
        .map_err(|e| format!("verify: {e}"))?;
    Ok(true)
}

fn read_arg(s: &str) -> String {
    s.to_string()
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 4 {
        eprintln!(
            "usage: {} <pubkey-b64> <signature-b64> <installer-path> | --pubkey-file <f> --signature-file <f> <installer-path>",
            args[0]
        );
        return ExitCode::from(2);
    }

    // Parse file-based or inline arguments (a trailing --output <file> is optional).
    let mut output_file: Option<String> = None;
    let mut positional_end = args.len();
    if args.len() >= 2 && args[args.len() - 2] == "--output" {
        output_file = Some(args[args.len() - 1].clone());
        positional_end = args.len() - 2;
    }
    let core: Vec<String> = args[1..positional_end].to_vec();
    if core.is_empty() || core.len() < 3 {
        eprintln!(
            "usage: {} <pubkey-b64> <signature-b64> <installer-path> | --pubkey-file <f> --signature-file <f> <installer-path> [--output <file>]",
            args[0]
        );
        return ExitCode::from(2);
    }
    let (pubkey, signature, installer_path) = if core[0] == "--pubkey-file" {
        if core.len() != 5 || core[2] != "--signature-file" {
            eprintln!("usage: --pubkey-file <pub.b64> --signature-file <sig.b64> <installer-path> [--output <file>]");
            return ExitCode::from(2);
        }
        let pubkey = match std::fs::read_to_string(&core[1]) {
            Ok(s) => s.trim().to_string(),
            Err(e) => {
                eprintln!("failed to read pubkey file {}: {e}", core[1]);
                return ExitCode::from(2);
            }
        };
        let signature = match std::fs::read_to_string(&core[3]) {
            Ok(s) => s.trim().to_string(),
            Err(e) => {
                eprintln!("failed to read signature file {}: {e}", core[3]);
                return ExitCode::from(2);
            }
        };
        (pubkey, signature, read_arg(&core[4]))
    } else {
        (read_arg(&core[0]), read_arg(&core[1]), read_arg(&core[2]))
    };
    let record_verdict = |verdict: &str, code: u8| {
        if let Some(ref f) = output_file {
            let _ = std::fs::write(f, verdict);
        }
        ExitCode::from(code)
    };

    let data = match std::fs::read(&installer_path) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("failed to read installer {}: {e}", installer_path);
            return record_verdict(&format!("ERROR: {e}"), 2);
        }
    };
    match verify_signature(&data, &signature, &pubkey) {
        Ok(true) => {
            println!(
                "VERIFIED: signature accepted by minisign-verify {} (real client code path)",
                env!("CARGO_PKG_VERSION")
            );
            record_verdict("VERIFIED", 0)
        }
        Ok(false) => {
            eprintln!("REJECTED: signature did not verify");
            record_verdict("REJECTED", 1)
        }
        Err(e) => {
            eprintln!("REJECTED: {e}");
            record_verdict(&format!("REJECTED: {e}"), 1)
        }
    }
}
