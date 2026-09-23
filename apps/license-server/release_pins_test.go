package main

// Tests for the release-channel pin store (ADR #57 §Q-B).
//
// These exercise the admin write path end to end against the same boot
// migrations production runs (dashboardMux mirrors boot), because the failure
// this store guards against — an attacker-appended pin, or a typo'd
// fingerprint refusing renewal for a correct build — is a data problem that a
// pure-function test cannot see.

import (
	"net/http"
	"strings"
	"testing"
)

// aPin is a syntactically valid fingerprint (64 hex). Its value is arbitrary:
// the store does not know or care which certificate it names.
const aPin = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899"

// anotherPin is a second valid fingerprint, for rotation tests.
const anotherPin = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"

func TestReleasePins_RejectsAMalformedPin(t *testing.T) {
	// A value that cannot be a SHA-256 must be REJECTED, not silently dropped:
	// a dropped pin is a build that stops verifying with no indication why.
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	rec := doJSON(mux, http.MethodPost, "/api/v1/admin/release-channels/android/pins",
		lifecycleAdminKey, `{"pins":["not-a-fingerprint"],"note":"typo"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for a malformed pin, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestReleasePins_RequiresANote(t *testing.T) {
	// §Q-A's rotation clause is unactionable for the next operator without a
	// record of why the set is what it is.
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	rec := doJSON(mux, http.MethodPost, "/api/v1/admin/release-channels/android/pins",
		lifecycleAdminKey, `{"pins":["`+aPin+`"]}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 without a note, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestReleasePins_StoresAndReadsBackTheSet(t *testing.T) {
	// The round trip is the feature: before this, §Q-B found the pin set existed
	// nowhere, so §2.1 compared against data nothing produced.
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	rec := doJSON(mux, http.MethodPost, "/api/v1/admin/release-channels/android/pins",
		lifecycleAdminKey, `{"pins":["`+aPin+`"],"note":"initial pin"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	got := doJSON(mux, http.MethodGet, "/api/v1/admin/release-channels/android/pins",
		lifecycleAdminKey, "")
	if got.Code != http.StatusOK {
		t.Fatalf("expected 200 on read, got %d: %s", got.Code, got.Body.String())
	}
	body := got.Body.String()
	if !strings.Contains(body, aPin) {
		t.Errorf("read back %s, want it to contain the stored pin %s", body, aPin)
	}
	if !strings.Contains(body, `"pinned":true`) {
		t.Errorf("read back %s, want pinned=true after a write", body)
	}
}
func TestReleasePins_NormalisesKeytoolSpelling(t *testing.T) {
	// keytool prints uppercase and colon-separated; Android returns lowercase
	// and bare. Both must land on ONE stored value, or a perfectly correct build
	// mismatches — the merchant-lockout failure §2.2 names.
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	// Uppercase, colon-separated form of the same certificate.
	spaced := strings.ToUpper(strings.Join(splitEvery(aPin, 2), ":"))
	rec := doJSON(mux, http.MethodPost, "/api/v1/admin/release-channels/android/pins",
		lifecycleAdminKey, `{"pins":["`+spaced+`"],"note":"pasted from keytool"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for the keytool spelling, got %d: %s", rec.Code, rec.Body.String())
	}

	stored, err := loadReleaseChannel(app, "android")
	if err != nil || stored == nil {
		t.Fatalf("expected a stored channel record, err=%v rec=%v", err, stored)
	}
	pins := acceptedPinsFromRecord(stored)
	if len(pins) != 1 {
		t.Fatalf("expected 1 stored pin, got %d: %v", len(pins), pins)
	}
	if pins[0] != aPin {
		t.Errorf("stored pin = %q, want the normalised lowercase form %q", pins[0], aPin)
	}
}

func TestReleasePins_AcceptsARotationOfTwo(t *testing.T) {
	// §Q-A option B: the pin is a SET precisely so a keystore rotation can
	// accept the outgoing and incoming certificate at once. A scalar would make
	// every rotation an outage for devices that had not yet updated.
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	rec := doJSON(mux, http.MethodPost, "/api/v1/admin/release-channels/android/pins",
		lifecycleAdminKey, `{"pins":["`+aPin+`","`+anotherPin+`"],"note":"rotation window"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for a two-pin rotation, got %d: %s", rec.Code, rec.Body.String())
	}
	stored, _ := loadReleaseChannel(app, "android")
	pins := acceptedPinsFromRecord(stored)
	if len(pins) != 2 {
		t.Fatalf("expected 2 stored pins, got %d: %v", len(pins), pins)
	}
}

func TestReleasePins_RejectsAnUnboundedSet(t *testing.T) {
	// §Q-A permits a set; it does not permit an unbounded allow-list. Every
	// entry is a fingerprint that will be ACCEPTED, so an attacker with write
	// access adding their own is exactly the defeat §2.1 guards against.
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	hex := "0123456789abcdef"
	pins := make([]string, 0, maxAcceptedPins+1)
	for i := 0; i <= maxAcceptedPins; i++ {
		// Distinct valid fingerprints: vary the repeated character.
		pins = append(pins, strings.Repeat(string(hex[i%16]), 64))
	}
	body := `{"pins":["` + strings.Join(pins, `","`) + `"],"note":"too many"}`
	rec := doJSON(mux, http.MethodPost, "/api/v1/admin/release-channels/android/pins",
		lifecycleAdminKey, body)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 above the pin bound, got %d: %s", rec.Code, rec.Body.String())
	}
}
func TestReleasePins_IsIdempotentOnTheSameSet(t *testing.T) {
	// A retry must not fail for being already-true, the model
	// handleAdminRevokeDevice and handleAdminSetRegion both follow.
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	first := doJSON(mux, http.MethodPost, "/api/v1/admin/release-channels/android/pins",
		lifecycleAdminKey, `{"pins":["`+aPin+`"],"note":"initial"}`)
	if first.Code != http.StatusOK {
		t.Fatalf("expected 200 on first write, got %d: %s", first.Code, first.Body.String())
	}

	// Same set, re-requested.
	second := doJSON(mux, http.MethodPost, "/api/v1/admin/release-channels/android/pins",
		lifecycleAdminKey, `{"pins":["`+aPin+`"],"note":"re-requested"}`)
	if second.Code != http.StatusOK {
		t.Fatalf("expected 200 for a no-op, got %d: %s", second.Code, second.Body.String())
	}
	if !strings.Contains(second.Body.String(), `"unchanged"`) {
		t.Errorf("expected status unchanged, got %s", second.Body.String())
	}
}

func TestReleasePins_EmptySetIsValidAndReportsUnpinned(t *testing.T) {
	// An empty set means "no claim yet", and kasirmu-core reads it as Unknown
	// rather than Mismatch — so an unpinned channel must be READABLE and must
	// not be mistaken for a locked-out one.
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	got := doJSON(mux, http.MethodGet, "/api/v1/admin/release-channels/android/pins",
		lifecycleAdminKey, "")
	if got.Code != http.StatusOK {
		t.Fatalf("expected 200 for an unpinned channel, got %d: %s", got.Code, got.Body.String())
	}
	if !strings.Contains(got.Body.String(), `"pinned":false`) {
		t.Errorf("expected pinned=false before any write, got %s", got.Body.String())
	}
}

func TestReleasePins_RequiresAdminAuth(t *testing.T) {
	// §Q-A: membership is admin-authored only. An unauthenticated write would
	// let anyone append a pin and defeat the control outright.
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	rec := doJSON(mux, http.MethodPost, "/api/v1/admin/release-channels/android/pins",
		"wrong-key", `{"pins":["`+aPin+`"],"note":"not the admin"}`)
	if rec.Code == http.StatusOK {
		t.Fatalf("expected a non-200 for a bad admin key, got %d: %s", rec.Code, rec.Body.String())
	}
	stored, _ := loadReleaseChannel(app, "android")
	if stored != nil {
		t.Errorf("an unauthenticated write must not create a channel record: %v", stored)
	}
}

// splitEvery splits s into chunks of n, for building the keytool spelling.
func splitEvery(s string, n int) []string {
	out := make([]string, 0, len(s)/n)
	for i := 0; i < len(s); i += n {
		end := i + n
		if end > len(s) {
			end = len(s)
		}
		out = append(out, s[i:end])
	}
	return out
}
