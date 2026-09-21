use super::*;

/// A shape-valid SHA-256, so a test that means "wrong value" is not
/// accidentally testing "wrong length".
fn sha256(seed: char) -> String {
    seed.to_string().repeat(64)
}

// ── §2.2: absence is a verdict, never `valid` ───────────────────────

#[test]
fn an_absent_report_is_unknown_never_valid() {
    // THE clause that keeps the control from being decorative. If this
    // returned `Valid`, the cheapest possible attack — deleting the line that
    // reports the fingerprint — would defeat §2.1 entirely.
    assert_eq!(
        classify_build_fingerprint(None, &[sha256('a')]),
        BuildFingerprintVerdict::Unknown
    );
}

#[test]
fn a_malformed_report_is_unknown_never_valid() {
    // Present but unusable is the same class as absent: the device did not make
    // a usable claim. A truncated hash, a non-hex blob and an empty string are
    // all things a tampered report can look like.
    let accepted = vec![sha256('a')];
    for bad in ["", "   ", "not-a-hash", "abcdef", &sha256('a')[..32]] {
        assert_eq!(
            classify_build_fingerprint(Some(bad), &accepted),
            BuildFingerprintVerdict::Unknown,
            "{bad:?} must classify as unknown, not valid"
        );
    }
}

#[test]
fn a_valid_report_is_valid_and_a_different_one_is_a_mismatch() {
    let accepted = vec![sha256('a'), sha256('b')];
    assert_eq!(
        classify_build_fingerprint(Some(&sha256('a')), &accepted),
        BuildFingerprintVerdict::Valid
    );
    // The Q-A decision: the pin is a SET, so the second accepted value is
    // valid too — that is what makes keystore rotation an ordinary write.
    assert_eq!(
        classify_build_fingerprint(Some(&sha256('b')), &accepted),
        BuildFingerprintVerdict::Valid
    );
    // A SHA-256 the channel does not hold IS the re-signed APK.
    assert_eq!(
        classify_build_fingerprint(Some(&sha256('c')), &accepted),
        BuildFingerprintVerdict::Mismatch
    );
}

// ── Normalisation: one fingerprint, one spelling ────────────────────

#[test]
fn keytool_and_packagemanager_spellings_of_one_fingerprint_agree() {
    // `keytool` prints uppercase with colons; Android's PackageManager returns
    // lowercase without them. A human pasting the keytool form into the admin
    // surface must not produce a mismatch against a correct build — that would
    // refuse renewal for a legitimate merchant, which §2.5 says is worse than
    // the tampering it guards against.
    let raw = "ABCDEF0123456789".repeat(4);
    let keytool_style = raw
        .as_bytes()
        .chunks(2)
        .map(|c| String::from_utf8_lossy(c).to_uppercase())
        .collect::<Vec<_>>()
        .join(":");
    // 32 hex pairs joined by 31 colons: 64 + 31 = 95 characters.
    assert_eq!(keytool_style.len(), 95, "32 pairs plus 31 separators");
    let android_style = raw.to_lowercase();

    for spelling in [keytool_style, android_style] {
        assert_eq!(
            classify_build_fingerprint(Some(&spelling), &[raw.clone()]),
            BuildFingerprintVerdict::Valid,
            "{spelling} names the same certificate and must match"
        );
    }
}

// ── An unpinned channel is not a mismatch ──────────────────────────

#[test]
fn an_empty_accepted_set_is_unknown_not_a_mismatch() {
    // This is the false-positive guard. A channel nobody has pinned has made no
    // claim about the build, so answering `Mismatch` would refuse renewal for
    // every tenant on it — punishing merchants for an operator's omission, and
    // exactly the outcome §2.5's conservative response policy exists to avoid.
    assert_eq!(
        classify_build_fingerprint(Some(&sha256('a')), &[]),
        BuildFingerprintVerdict::Unknown
    );
}

// ── The predicate ADR #57 §2.5's response table gates on ───────────

#[test]
fn only_a_mismatch_counts_as_positive_evidence() {
    // §2.5 refuses RENEWAL on a mismatch and does not on anything else. The
    // predicate must therefore be true for exactly one verdict: collapsing
    // `Unknown` into it would refuse renewal on silence, which is the failure
    // §2.2 names.
    assert!(BuildFingerprintVerdict::Mismatch.is_mismatch());
    assert!(!BuildFingerprintVerdict::Valid.is_mismatch());
    assert!(!BuildFingerprintVerdict::Unknown.is_mismatch());
}

#[test]
fn the_wire_names_are_the_ones_the_adr_response_table_uses() {
    // §2.5's table is keyed on these strings, and the admin surface will read
    // them back. A rename on either side is a silent precedence change.
    assert_eq!(BuildFingerprintVerdict::Valid.as_str(), "valid");
    assert_eq!(BuildFingerprintVerdict::Mismatch.as_str(), "mismatch");
    assert_eq!(BuildFingerprintVerdict::Unknown.as_str(), "unknown");
}
