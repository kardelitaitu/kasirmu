package main

// Server-side build-integrity classification — ADR #57 §2.1/§2.2/§2.4.
//
// The client reports its APK signing-certificate fingerprint on the licence
// status call (§2.1); this file decides what that report MEANS. The split is
// the control: a patched client changes what it sends, never how the answer is
// judged, because the judgement never runs on the device.
//
// Key functions:
// - classifyBuildFingerprint — pure: a report plus the pinned set → a verdict.
// - recordBuildIntegrity — persists the verdict per tenant for the operator queue.
//
// Invariants:
// - Absence is a VERDICT, not a neutral. A missing or malformed report is
//   `unknown`, and `unknown` is never `valid` (§2.2). Without this clause the
//   control is bypassed by deleting one line of client reporting.
// - An EMPTY accepted set is `unknown`, not `mismatch`: a channel nobody has
//   pinned has made no claim about the build, and treating that as a mismatch
//   would flag every tenant on it. (This mirrors kasirmu-core
//   classify_build_fingerprint exactly; the two must agree or the client and
//   server would disagree about the same report.)
// - NOTHING here refuses a renewal or locks a device. §Q4 routes every verdict
//   to the operator queue, because a client-side bug must not be able to dark
//   a fleet of tills.

import (
	"log"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// Build-integrity verdicts. Named as constants so the writer, the reader and
// the tests cannot drift on the spelling.
const (
	// buildVerdictValid — the report matched a pinned fingerprint.
	buildVerdictValid = "valid"
	// buildVerdictMismatch — the report is a well-formed SHA-256 that is NOT
	// pinned: positive evidence the APK was re-signed (§2.1).
	buildVerdictMismatch = "mismatch"
	// buildVerdictUnknown — absent or unusable report. NOT "no problem": it is
	// "we cannot see" (§2.2).
	buildVerdictUnknown = "unknown"
)

// sha256HexLen is the length of a SHA-256 digest in hex.
const sha256HexLen = 64

// normaliseBuildFingerprint folds a report to the comparison form.
//
// Lowercase, hex-only: `keytool -printcert` prints uppercase and
// colon-separated while Android returns lowercase and bare, and both describe
// one certificate. This mirrors normaliseFingerprint (release_pins.go) and
// kasirmu-core’s own folding — a report and a pin that disagree only in
// spelling must not produce a false mismatch, which would be a merchant
// lockout for a correct build.
//
// Returns "" for anything that cannot be a SHA-256, which classifies as
// `unknown` rather than `mismatch`.
func normaliseBuildFingerprint(raw string) string {
	cleaned := strings.Map(func(r rune) rune {
		switch {
		case r >= '0' && r <= '9':
			return r
		case r >= 'a' && r <= 'f':
			return r
		case r >= 'A' && r <= 'F':
			return r + ('a' - 'A')
		default:
			return -1
		}
	}, raw)
	if len(cleaned) != sha256HexLen {
		return ""
	}
	return cleaned
}

// classifyBuildFingerprint turns a report and a pinned set into a verdict.
//
// The rules, in order, and the order matters:
//  1. An unusable report (absent, or not 64 hex) is `unknown`. §2.2 makes
//     absence its own verdict so that removing the client’s reporting line is
//     not a silent pass.
//  2. An EMPTY pinned set is `unknown`, NOT `mismatch`. A channel nobody has
//     pinned has made no claim, and treating that as a mismatch would refuse
//     renewal for every tenant on it — the exact false-positive §Q4 chose a
//     human queue to absorb.
//  3. A match against the set is `valid`.
//  4. Otherwise `mismatch`.
func classifyBuildFingerprint(reported string, accepted []string) string {
	report := normaliseBuildFingerprint(reported)
	if report == "" {
		return buildVerdictUnknown
	}
	if len(accepted) == 0 {
		return buildVerdictUnknown
	}
	for _, pin := range accepted {
		if normaliseBuildFingerprint(pin) == report {
			return buildVerdictValid
		}
	}
	return buildVerdictMismatch
}

// buildIntegrityCollection is the per-device report record name.
const buildIntegrityCollection = "build_integrity_reports"

// recordBuildIntegrity classifies a report and persists the verdict.
//
// Best-effort: a reporting failure must never fail the status response the
// client is waiting on. The licence answer is load-bearing for the till; this
// record only feeds an operator queue, so the direction of failure is chosen
// deliberately (log and continue).
func recordBuildIntegrity(app core.App, tenantID, machineID, reported string) {
	accepted := pinnedFingerprintsForChannel(app, defaultReleaseChannel)
	verdict := classifyBuildFingerprint(reported, accepted)

	// A `valid` report is the ordinary case and carries no signal; recording it
	// would fill the table with noise and make a real violation hard to find.
	// §Q4 escalates on repeated `unknown`, and §2.4 acts on `mismatch`, so those
	// two are the only verdicts worth storing.
	if verdict == buildVerdictValid {
		return
	}

	coll, err := app.FindCollectionByNameOrId(buildIntegrityCollection)
	if err != nil {
		log.Printf("build-integrity: collection %s unavailable, verdict %q dropped (tenant=%s): %v",
			buildIntegrityCollection, verdict, tenantID, err)
		return
	}
	rec := core.NewRecord(coll)
	rec.Set("tenant_id", tenantID)
	rec.Set("machine_id", machineID)
	// Store the NORMALISED report, never the raw one: a stored uppercase
	// colon-separated value would read as a different fingerprint from the pin it
	// actually matched, which is how an operator ends up chasing a false lead.
	rec.Set("reported_fingerprint", normaliseBuildFingerprint(reported))
	rec.Set("verdict", verdict)
	rec.Set("pinned_count", len(accepted))
	if err := app.Save(rec); err != nil {
		log.Printf("build-integrity: failed to record verdict %q for tenant=%s: %v", verdict, tenantID, err)
	}
}

// defaultReleaseChannel is the release channel a report is judged against.
//
// ADR #57 §Q-B: the store is channel-keyed because a keystore rotation is then
// ONE write rather than an N-tenant update. There is exactly one channel today
// (one release keystore), so a constant names it until a second exists — the
// same reasoning the region vocabulary uses for a closed set.
const defaultReleaseChannel = "android"

// pinnedFingerprintsForChannel reads a channel’s accepted pin set.
//
// Returns an EMPTY slice (never an error) when the channel is unknown or the
// store is unavailable: empty classifies as `unknown`, which fails open. An
// error here must not become a `mismatch`, or a storage problem would refuse
// renewals for the whole fleet.
func pinnedFingerprintsForChannel(app core.App, channel string) []string {
	rec, err := loadReleaseChannel(app, channel)
	if err != nil {
		log.Printf("build-integrity: pin lookup failed for channel %q: %v", channel, err)
		return []string{}
	}
	return acceptedPinsFromRecord(rec)
}

// deviceHasFingerprintMismatch reports whether THIS device has a stored
// `mismatch` verdict (ADR #57 §2.5).
//
// **Keyed on the DEVICE, not the tenant, and that is the whole point of §2.5.**
// A tenant-level refusal would take a merchant’s honest tills offline because
// one terminal at another location was tampered — the fleet-lockout failure
// §Q4 rejected. The renewal is refused to the device that failed the check;
// every other terminal the tenant owns renews normally.
//
// **Only `mismatch` refuses.** A persistent `unknown` is deliberately NOT a
// refusal here: §2.2 makes absence a verdict, but a serialization bug or a
// partially-rolled-out client produces it from legitimate devices, and §Q4
// routes that case to the operator queue instead. Refusing on `unknown` would
// let our own bug stop merchants renewing.
//
// **Fails open on every uncertainty** — empty machine_id, lookup error, or no
// rows — because a refusal is a restriction and a storage problem must not
// deny a legitimate renewal.
func deviceHasFingerprintMismatch(app core.App, machineID string) bool {
	if strings.TrimSpace(machineID) == "" {
		// A pre-#57 client asserts no identity, so no device-level decision is
		// possible. Fail open, exactly as the status endpoint does for an empty
		// machine_id.
		return false
	}
	_, err := app.FindFirstRecordByFilter(buildIntegrityCollection,
		"machine_id = {:m} && verdict = {:v}",
		map[string]any{"m": machineID, "v": buildVerdictMismatch})
	if err != nil {
		// Includes the not-found case, which is the ordinary one. A genuine
		// query failure is also a refusal-free path on purpose: an unavailable
		// store must not deny a renewal.
		return false
	}
	return true
}
