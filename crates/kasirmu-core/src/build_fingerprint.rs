//! Deployed-build fingerprint verdict (ADR #57 §2.1/§2.2).
//!
//! The APK signing-certificate fingerprint is computed on the client and
//! reported to the licence/sync server, which compares it against the
//! fingerprint(s) it holds for that tenant's release channel. A re-signed APK
//! carries a DIFFERENT certificate, so the observable change is the certificate
//! itself — no Play Services, works on the `minSdkVersion: 26` fleet, and
//! judged server-side so patching the comparison on the client changes nothing.
//!
//! # Why the verdict is a three-way enum and not a bool
//!
//! ADR #57 §2.2 is the clause that keeps the control from being decorative:
//! **absence of a verdict is treated as a verdict.** A missing, malformed or
//! unparseable report classifies as [`BuildFingerprintVerdict::Unknown`] and is
//! NEVER treated as valid. Without that, an attacker bypasses the control by
//! deleting the reporting line rather than defeating the comparison — the
//! cheapest possible attack.
//!
//! The distinction between `Unknown` and `Mismatch` is load-bearing and must not
//! be collapsed: they are recorded the same way initially, but they respond
//! differently. A `Mismatch` is positive evidence (refuse renewal, §2.5); an
//! `Unknown` is an absence of evidence (operate, record, escalate on repetition
//! per §Q4). Treating silence as evidence is how a false positive becomes a
//! merchant lockout.
//!
//! This module is deliberately pure: no I/O, no platform calls. It classifies a
//! value the caller obtained, so the precedence rules are testable without an
//! Android device.

use serde::{Deserialize, Serialize};

/// One accepted fingerprint, as hex, with its colon separators removed.
///
/// Normalisation is not cosmetic: `keytool` prints the SHA-256 as uppercase
/// colon-separated pairs (`AB:CD:…`), Android's `PackageManager` returns the
/// same bytes lowercase and unseparated, and a human pasting one into the admin
/// surface must not produce a mismatch against a correct build.
fn normalize(raw: &str) -> String {
    raw.chars()
        .filter(|c| c.is_ascii_hexdigit())
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

/// The verdict for one reported fingerprint (ADR #57 §2.1/§2.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BuildFingerprintVerdict {
    /// The report matched a fingerprint the server holds for this channel.
    Valid,
    /// The report matched none of them: a re-signed APK (§2.1).
    Mismatch,
    /// The report was absent, unparseable, or of a length no SHA-256 can have.
    ///
    /// **Never treat this as valid** (§2.2). It means the device did not make a
    /// usable claim, which is exactly what a deleted reporting line looks like.
    Unknown,
}

impl BuildFingerprintVerdict {
    /// Whether this verdict is positive evidence of tampering.
    ///
    /// `Unknown` is NOT positive evidence — see the module docs. Callers that
    /// gate on `is_mismatch()` therefore fail open on silence, which is the
    /// direction §2.2 and ADR #58 §2.4 both require for anything that could
    /// otherwise lock a till.
    #[must_use]
    pub fn is_mismatch(self) -> bool {
        matches!(self, Self::Mismatch)
    }

    /// The stored/wire keyword, matching the serde form.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Valid => "valid",
            Self::Mismatch => "mismatch",
            Self::Unknown => "unknown",
        }
    }
}

/// Classify one reported fingerprint against the accepted set for a channel.
///
/// `accepted` is the bounded, ordered set ADR #57 §Q-B decided a
/// `release_channels` record holds. An EMPTY set classifies as `Unknown`, not
/// `Mismatch`: a server holding no fingerprint for a channel has made no claim
/// about the build, and calling that a mismatch would refuse renewal for every
/// tenant on a channel nobody has pinned yet.
#[must_use]
pub fn classify_build_fingerprint(
    reported: Option<&str>,
    accepted: &[String],
) -> BuildFingerprintVerdict {
    // §2.2: absence is its own verdict, never `Valid`.
    let Some(raw) = reported else {
        return BuildFingerprintVerdict::Unknown;
    };
    let candidate = normalize(raw);
    // A SHA-256 is 64 hex digits. Anything else cannot be one, so it is an
    // unusable report rather than a wrong one — the same distinction as above.
    if candidate.len() != 64 {
        return BuildFingerprintVerdict::Unknown;
    }
    if accepted.is_empty() {
        return BuildFingerprintVerdict::Unknown;
    }
    if accepted
        .iter()
        .any(|expected| normalize(expected) == candidate)
    {
        return BuildFingerprintVerdict::Valid;
    }
    BuildFingerprintVerdict::Mismatch
}

/// Consecutive `Unknown` reports that escalate to a queue signal (ADR #57 §Q4).
///
/// Seven, per the record's stated reasoning: at one report per sync cycle it
/// separates a permanently-broken client from an intermittent failure while
/// staying inside a working day. **This number is a tuning parameter, not a
/// security boundary** — the record says so explicitly, and the routing to a
/// human is the boundary.
pub const UNKNOWN_REPORTS_BEFORE_ESCALATION: u32 = 7;

/// What an operator queue should be told about one tenant's build integrity.
///
/// This is the ESCALATION half of ADR #57 §Q4, deliberately separate from the
/// per-report [`BuildFingerprintVerdict`]: a verdict describes one report, and
/// this describes a pattern across reports. Collapsing them would make a single
/// dropped field indistinguishable from a persistent one, which is precisely
/// the false-positive that §Q4 chose a human queue to absorb.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BuildIntegritySignal {
    /// Nothing for an operator to read.
    None,
    /// Positive evidence of a re-signed APK (§2.1).
    Mismatch,
    /// The reporting has been unusable for long enough to stop looking like noise
    /// (§2.2 + §Q4). NOT the same finding as `Mismatch` and must not be shown as
    /// one: this is "we cannot see", that is "we can see, and it is wrong".
    UnknownPersistent,
}

impl BuildIntegritySignal {
    /// The stored/wire keyword, matching the serde form.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Mismatch => "mismatch",
            Self::UnknownPersistent => "unknown_persistent",
        }
    }

    /// Whether this signal is something an operator should be shown.
    #[must_use]
    pub fn needs_operator_attention(self) -> bool {
        !matches!(self, Self::None)
    }
}

/// Fold one report's verdict into a tenant's running integrity signal.
///
/// Q4 option B, as a pure state machine: `unknown` reports ACCUMULATE, and once
/// they reach [`UNKNOWN_REPORTS_BEFORE_ESCALATION`] the tenant escalates. Any
/// usable report — `valid` or `mismatch` — RESETS the counter, because either
/// one proves the reporting path works; a single detectable report in between
/// must not be carried forward as a broken channel.
///
/// **Why the counter resets rather than decays.** A decay would let an attacker
/// stay permanently under the threshold by emitting one usable report every few
/// cycles, which re-opens the bypass §Q4 option A was rejected for. Reset-on-
/// usable keeps the rule honest: N CONSECUTIVE unusable reports means the
/// channel really has been broken for N cycles.
///
/// **The signal never locks anything.** §Q4 routes escalation to the operator
/// queue (§Q3) and never to an automatic lockout, because a serialization bug, a
/// field rename or a partially-rolled-out client would each produce `unknown`
/// from legitimate devices — and darking every affected till is worse than the
/// abuse it would prevent. CALLERS MUST NOT turn this into a session refusal.
#[must_use]
pub fn fold_build_integrity(
    previous_consecutive_unknowns: u32,
    verdict: BuildFingerprintVerdict,
) -> (u32, BuildIntegritySignal) {
    match verdict {
        BuildFingerprintVerdict::Mismatch => (0, BuildIntegritySignal::Mismatch),
        BuildFingerprintVerdict::Valid => (0, BuildIntegritySignal::None),
        BuildFingerprintVerdict::Unknown => {
            let consecutive = previous_consecutive_unknowns.saturating_add(1);
            let signal = if consecutive >= UNKNOWN_REPORTS_BEFORE_ESCALATION {
                BuildIntegritySignal::UnknownPersistent
            } else {
                BuildIntegritySignal::None
            };
            (consecutive, signal)
        }
    }
}

#[cfg(test)]
#[path = "build_fingerprint_tests.rs"]
mod tests;
