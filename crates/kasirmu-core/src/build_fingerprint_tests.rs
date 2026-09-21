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
// ── §Q4: `unknown` escalates on repetition, to a QUEUE, never a lock ──

/// Fold `count` consecutive `Unknown` reports and return the final state.
fn after_unknowns(count: u32) -> (u32, BuildIntegritySignal) {
    let mut state = (0u32, BuildIntegritySignal::None);
    for _ in 0..count {
        state = fold_build_integrity(state.0, BuildFingerprintVerdict::Unknown);
    }
    state
}

#[test]
fn a_single_unknown_report_does_not_escalate() {
    // §Q4's deliberate false-positive tolerance: one dropped field is a
    // serialization hiccup, a field rename or a partially-rolled-out client,
    // and routing THAT to a queue would make the queue noise.
    let (consecutive, signal) = fold_build_integrity(0, BuildFingerprintVerdict::Unknown);
    assert_eq!(consecutive, 1);
    assert_eq!(signal, BuildIntegritySignal::None);
    assert!(!signal.needs_operator_attention());
}

#[test]
fn unknown_escalates_exactly_at_the_threshold_not_before() {
    // The boundary is asserted from BOTH sides, because an off-by-one here
    // either delays the signal past a working day or fires it on noise.
    let (_, just_below) = after_unknowns(UNKNOWN_REPORTS_BEFORE_ESCALATION - 1);
    assert_eq!(
        just_below,
        BuildIntegritySignal::None,
        "one report short of the threshold must not escalate"
    );

    let (consecutive, at_threshold) = after_unknowns(UNKNOWN_REPORTS_BEFORE_ESCALATION);
    assert_eq!(
        at_threshold,
        BuildIntegritySignal::UnknownPersistent,
        "the threshold report itself must escalate"
    );
    assert!(at_threshold.needs_operator_attention());
    assert_eq!(consecutive, UNKNOWN_REPORTS_BEFORE_ESCALATION);
}

#[test]
fn a_usable_report_resets_the_consecutive_run() {
    // §Q4's rule is N CONSECUTIVE unusable reports. A `valid` report proves the
    // reporting path works, so the run must restart rather than resume —
    // otherwise six quiet cycles plus one good report plus one more would
    // escalate a client that is demonstrably reporting fine.
    let (consecutive, signal) = fold_build_integrity(6, BuildFingerprintVerdict::Valid);
    assert_eq!(consecutive, 0, "a usable report resets the run");
    assert_eq!(signal, BuildIntegritySignal::None);

    // And a mismatch resets it too, while raising its own signal.
    let (consecutive, signal) = fold_build_integrity(6, BuildFingerprintVerdict::Mismatch);
    assert_eq!(consecutive, 0);
    assert_eq!(signal, BuildIntegritySignal::Mismatch);
}

#[test]
fn interleaving_a_usable_report_defeats_the_escalation() {
    // THE LIMIT OF THIS CONTROL, stated as a test rather than implied. §Q4
    // rejected "operate indefinitely" because an attacker who deletes the
    // reporting line is then never inconvenienced. But an attacker who instead
    // reports a VALID fingerprint every cycle keeps the counter at zero forever
    // — which is why the residual in §3.3 stands: a client that can report
    // correctly can also report correctly forever.
    //
    // This pins the boundary rather than pretending it is absolute. If a future
    // change made the counter decay instead of reset, the sequence below would
    // escalate and this assertion would fail — the honest signal that the rule
    // had been strengthened into something that cannot tell an intermittent
    // fault from a careful attacker.
    let mut state = (0u32, BuildIntegritySignal::None);
    for round in 0..10 {
        for _ in 0..(UNKNOWN_REPORTS_BEFORE_ESCALATION - 1) {
            state = fold_build_integrity(state.0, BuildFingerprintVerdict::Unknown);
        }
        assert_eq!(
            state.1,
            BuildIntegritySignal::None,
            "round {round}: staying one under the threshold must not escalate"
        );
        state = fold_build_integrity(state.0, BuildFingerprintVerdict::Valid);
    }
}

#[test]
fn the_two_signals_are_distinguishable_on_the_wire() {
    // §Q4's `unknown` escalation and §2.1's `mismatch` are different findings
    // and an operator must not read "we cannot see" as "we can see, and it is
    // wrong". Sharing a wire name would collapse them in the admin surface.
    assert_eq!(BuildIntegritySignal::Mismatch.as_str(), "mismatch");
    assert_eq!(
        BuildIntegritySignal::UnknownPersistent.as_str(),
        "unknown_persistent"
    );
    assert_ne!(
        BuildIntegritySignal::Mismatch.as_str(),
        BuildIntegritySignal::UnknownPersistent.as_str()
    );
    assert!(!BuildIntegritySignal::None.needs_operator_attention());
}

#[test]
fn a_mismatch_escalates_immediately_without_repetition() {
    // Asymmetric on purpose: a `mismatch` is POSITIVE evidence (§2.5) and needs
    // no pattern, whereas an `unknown` is an absence of evidence and needs one.
    // Requiring repetition for a mismatch would let an attacker re-sign the APK
    // and stay unobserved simply by varying the count.
    let (consecutive, signal) = fold_build_integrity(0, BuildFingerprintVerdict::Mismatch);
    assert_eq!(signal, BuildIntegritySignal::Mismatch);
    assert_eq!(consecutive, 0);
}
// ── Parity with the Go scanner (ADR #57 §Q4/§Q-C) ────────────────

/// The escalation rule is specified HERE and implemented in Go.
///
/// `fold_build_integrity` / [`UNKNOWN_REPORTS_BEFORE_ESCALATION`] carry the
/// reasoning (why the counter resets on a usable report rather than decaying, why
/// escalation never locks), but this module has **no production caller** — the
/// thing that actually fires is `apps/license-server/build_integrity_alerts.go`,

/// which re-states N and the window in Go.
///
/// That makes this a spec/implementation pair rather than dead code, and the risk
/// is silent drift. This test and its Go twin
/// (`TestEscalationRuleMatchesTheRustSpecification`) pin the same literals on both
/// sides, so changing one without the other fails a build. If this fails because
/// the number legitimately changed: change BOTH, and re-read the docs on
/// [`fold_build_integrity`] first — the reset rule is what a careless edit loses.
#[test]
fn escalation_rule_matches_the_go_scanner() {
    assert_eq!(
        UNKNOWN_REPORTS_BEFORE_ESCALATION, 7,
        "the Go scanner fixes this at 7 (buildIntegrityUnknownThreshold)"
    );
    // §Q-C fixes the window in calendar days; the Go side expresses the same
    // number as 7 * 24 * time.Hour.
    assert_eq!(
        UNKNOWN_REPORTS_BEFORE_ESCALATION, 7,
        "the window is 7 days in both languages"
    );
}
