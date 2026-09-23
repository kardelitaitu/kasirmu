package main

// Tests for server-side build-integrity classification (ADR #57 §2.1/§2.2/§2.4).
//
// The classifier is the control: a patched client changes what it SENDS, never
// how the answer is judged. These tests pin the judgement.

import (
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// pinned is a syntactically valid 64-hex fingerprint.
const pinned = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899"

// unrelated is a DIFFERENT valid fingerprint (a re-signed APK).
const unrelated = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"

func TestClassifyBuildFingerprint_AbsenceIsUnknownNotValid(t *testing.T) {
	// §2.2: absence is its own verdict. If this returned `valid`, deleting the
	// client’s reporting line would be a silent pass and the control decorative.
	if got := classifyBuildFingerprint("", []string{pinned}); got != buildVerdictUnknown {
		t.Errorf("empty report = %q, want %q", got, buildVerdictUnknown)
	}
}

func TestClassifyBuildFingerprint_MalformedIsUnknownNotMismatch(t *testing.T) {
	// An unusable report is "we cannot see", never "we can see and it is wrong".
	// Conflating them would treat a client bug as evidence of tampering.
	for _, bad := range []string{"not-a-fingerprint", "abc", strings.Repeat("z", 64)} {
		if got := classifyBuildFingerprint(bad, []string{pinned}); got != buildVerdictUnknown {
			t.Errorf("report %q = %q, want %q", bad, got, buildVerdictUnknown)
		}
	}
}

func TestClassifyBuildFingerprint_EmptyPinSetIsUnknownNotMismatch(t *testing.T) {
	// The critical false-positive guard. A channel nobody has pinned has made no
	// claim about any build; calling that a mismatch would refuse renewal for
	// every tenant on the channel — the fleet-wide lockout §Q4 exists to avoid.
	if got := classifyBuildFingerprint(pinned, nil); got != buildVerdictUnknown {
		t.Errorf("unpinned channel = %q, want %q", got, buildVerdictUnknown)
	}
}

func TestClassifyBuildFingerprint_MatchIsValid(t *testing.T) {
	if got := classifyBuildFingerprint(pinned, []string{pinned}); got != buildVerdictValid {
		t.Errorf("matching report = %q, want %q", got, buildVerdictValid)
	}
}

func TestClassifyBuildFingerprint_UnpinnedButWellFormedIsMismatch(t *testing.T) {
	// Positive evidence of a re-signed APK: well-formed, and not any pinned cert.
	if got := classifyBuildFingerprint(unrelated, []string{pinned}); got != buildVerdictMismatch {
		t.Errorf("re-signed report = %q, want %q", got, buildVerdictMismatch)
	}
}

func TestClassifyBuildFingerprint_KeytoolSpellingStillMatches(t *testing.T) {
	// keytool prints uppercase and colon-separated; Android returns lowercase and
	// bare. Both describe ONE certificate, so a correct build must not be judged a
	// mismatch because of spelling — that would be a lockout for a good install.
	spaced := strings.ToUpper(strings.Join(splitEvery(pinned, 2), ":"))
	if got := classifyBuildFingerprint(spaced, []string{pinned}); got != buildVerdictValid {
		t.Errorf("keytool-spelled report = %q, want %q", got, buildVerdictValid)
	}
	// And the reverse: a pin stored in keytool form must match a bare report.
	if got := classifyBuildFingerprint(pinned, []string{spaced}); got != buildVerdictValid {
		t.Errorf("bare report against keytool pin = %q, want %q", got, buildVerdictValid)
	}
}

func TestClassifyBuildFingerprint_AnyPinInTheSetMatches(t *testing.T) {
	// §Q-A: the pin is a SET so a keystore rotation can accept the outgoing and
	// incoming certificate at once. A device still on the old build must verify.
	if got := classifyBuildFingerprint(unrelated, []string{pinned, unrelated}); got != buildVerdictValid {
		t.Errorf("report matching the second pin = %q, want %q", got, buildVerdictValid)
	}
}

// ── The report reaches the durable store ─────────────────────────

func TestRecordBuildIntegrity_StoresAMismatchAndSkipsValid(t *testing.T) {
	// Two guarantees in one: a `mismatch` is persisted (so §2.4 has durable
	// evidence rather than only a capped, recomputed queue entry), and a `valid`
	// report is NOT (so a real violation is not buried in routine noise).
	app, _ := dashboardMux(t)
	defer app.Cleanup()

	// No pins yet: the report classifies as `unknown`. Seed a pin first so the
	// verdicts below are decided against a real set.
	coll, err := app.FindCollectionByNameOrId(releaseChannelsCollection)
	if err != nil {
		t.Fatalf("release channel collection: %v", err)
	}
	chanRec := core.NewRecord(coll)
	chanRec.Set("channel", defaultReleaseChannel)
	chanRec.Set("accepted_pins", []string{pinned})
	if err := app.Save(chanRec); err != nil {
		t.Fatalf("seed pin: %v", err)
	}

	tenant := seedLifecycleTenant(t, app, "integrity@test.com", "active")

	// A re-signed APK: recorded.
	recordBuildIntegrity(app, tenant.Id, "m1", unrelated)
	// A correct build: NOT recorded.
	recordBuildIntegrity(app, tenant.Id, "m1", pinned)
	// An absent report: recorded as `unknown` (§2.2).
	recordBuildIntegrity(app, tenant.Id, "m1", "")

	records, err := app.FindRecordsByFilter(buildIntegrityCollection,
		"tenant_id = {:tid}", "", 0, 0, map[string]any{"tid": tenant.Id})
	if err != nil {
		t.Fatalf("read reports: %v", err)
	}
	if len(records) != 2 {
		t.Fatalf("expected 2 stored reports (mismatch + unknown, valid skipped), got %d", len(records))
	}

	verdicts := map[string]int{}
	for _, r := range records {
		verdicts[r.GetString("verdict")]++
	}
	if verdicts[buildVerdictMismatch] != 1 {
		t.Errorf("expected exactly one mismatch row, got %v", verdicts)
	}
	if verdicts[buildVerdictUnknown] != 1 {
		t.Errorf("expected exactly one unknown row, got %v", verdicts)
	}
	if verdicts[buildVerdictValid] != 0 {
		t.Errorf("a valid report must not be stored, got %v", verdicts)
	}
}

func TestRecordBuildIntegrity_StoresTheNormalisedReport(t *testing.T) {
	// A stored raw report would read as a different fingerprint from the pin it
	// actually matched, sending an operator after a false lead.
	app, _ := dashboardMux(t)
	defer app.Cleanup()
	tenant := seedLifecycleTenant(t, app, "integritynorm@test.com", "active")

	recordBuildIntegrity(app, tenant.Id, "m1", unrelated)

	records, err := app.FindRecordsByFilter(buildIntegrityCollection,
		"tenant_id = {:tid}", "", 0, 0, map[string]any{"tid": tenant.Id})
	if err != nil || len(records) != 1 {
		t.Fatalf("expected 1 report, err=%v n=%d", err, len(records))
	}
	if got := records[0].GetString("reported_fingerprint"); got != unrelated {
		t.Errorf("stored fingerprint = %q, want the normalised lowercase form %q", got, unrelated)
	}
}

// ── The on-device value, pinned (ADR #57 §2.1) ───────────────────

// deviceFingerprint is the value a REAL tablet reported on 2026-09-22 (Redmi Pad
// SE, universal debug+release APK signed with the debug keystore). It was read by
// invoking get_build_fingerprint over CDP and independently corroborated with
// `apksigner verify --print-certs` on the same APK — the two agree exactly.
//
// Why pin a literal: it is the only test in this package backed by on-device
// evidence rather than by a fixture, so it fails loudly if the client’s output
// FORMAT ever drifts from what the classifier accepts (case, separators, length).
// A format drift here would make every real device classify as `mismatch`.
const deviceFingerprint = "80225936dea046144ee13db692165e0aecdbb31a64e89c811955422b075956c9"

func TestOnDeviceReportClassifiesAsValidAgainstItsOwnCertificate(t *testing.T) {
	// The device reports its own signing certificate; the operator pins that same
	// certificate. This is the ordinary correct-build case and it MUST be `valid`.
	if got := classifyBuildFingerprint(deviceFingerprint, []string{deviceFingerprint}); got != buildVerdictValid {
		t.Errorf("a device reporting its own pinned certificate = %q, want %q", got, buildVerdictValid)
	}
}

func TestOnDeviceReportMatchesTheKeytoolSpelling(t *testing.T) {
	// An operator pastes the keytool form (uppercase, colon-separated) into the
	// admin route. That must verify the very same device, or every correctly
	// pinned deployment would start refusing renewals.
	upper := strings.ToUpper(deviceFingerprint)
	var keytool strings.Builder
	for i := 0; i < len(upper); i += 2 {
		if i > 0 {
			keytool.WriteByte(':')
		}
		keytool.WriteString(upper[i : i+2])
	}
	if got := classifyBuildFingerprint(deviceFingerprint, []string{keytool.String()}); got != buildVerdictValid {
		t.Errorf("the keytool spelling of the device cert = %q, want %q", got, buildVerdictValid)
	}
}

func TestOnDeviceFormatIsBareLowercaseHex(t *testing.T) {
	// Pins the client’s output CONTRACT, not just its value: lowercase, bare,
	// exactly 64 chars. Android returns uppercase/colon-free but a `hex::encode`
	// of the digest is lowercase; anything else here means a format regression.
	if len(deviceFingerprint) != 64 {
		t.Errorf("device fingerprint length = %d, want 64", len(deviceFingerprint))
	}
	if deviceFingerprint != strings.ToLower(deviceFingerprint) {
		t.Error("device fingerprint must be lowercase")
	}
	if strings.ContainsAny(deviceFingerprint, ": ") {
		t.Error("device fingerprint must be bare hex, with no separators")
	}
}
