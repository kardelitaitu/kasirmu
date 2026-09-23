package main

// Release-channel pin store — the admin write path for ADR #57 §Q-B.
//
// ADR #57 §2.1 compares a reported APK signing-certificate fingerprint against
// the fingerprint(s) the server holds *for that tenant release channel*. §Q-B
// found that phrase appeared nowhere else in the repository, so as originally
// written the comparison was against data nothing produced. This file is the
// writer for that store; `ensureReleaseChannels` (main.go) creates it.
//
// Key functions:
// - handleAdminGetReleasePins — read a channel's accepted set.
// - handleAdminSetReleasePins — replace a channel's accepted set (the rotation action).
//
// Invariants:
// - Membership is ADMIN-authored only. §Q-A: an attacker who could append to the
//   set would have defeated §2.1, so the collection is superuser-only and no
//   public route touches it.
// - The set is BOUNDED (maxAcceptedPins). §Q-A chose a set over a scalar so a
//   keystore rotation is not an outage, but an unbounded list is an unbounded
//   allow-list; the bound is enforced here because PocketBase's JSON field has
//   no length rule.
// - Every fingerprint is normalised to lowercase 64-hex before storage, the same
//   folding `classify_build_fingerprint` performs, so a value pasted from
//   `keytool` (uppercase, colon-separated) cannot mismatch a correct build.
// - An EMPTY set is valid and means "no claim yet" — kasirmu-core reads it as
//   `Unknown`, never `Mismatch`, so it cannot refuse renewal for a channel
//   nobody has pinned.

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// maxAcceptedPins bounds the accepted set. §Q-A permits a set so a rotation can
// accept the outgoing and incoming certificate at once; it does not permit an
// unbounded allow-list, because every entry is a fingerprint that will be
// accepted, and an attacker with write access could otherwise add their own.
//
// Four is comfortably above a two-certificate rotation (current + previous)
// while staying small enough to reason about at a glance.
const maxAcceptedPins = 4

// releasePinUpdateRequest is the body for setting a channel's accepted pins.
type releasePinUpdateRequest struct {
	// Accepted SHA-256 signing-certificate fingerprints. Replaces the set
	// wholesale — a partial update would make "remove the rotated-out
	// certificate" unexpressible.
	Pins []string `json:"pins"`
	// Why the set is what it is (required — this is the audit trail, and §Q-A's
	// rotation clause is unactionable for the next operator without it).
	Note string `json:"note"`
}

// normaliseFingerprint folds a fingerprint to the comparison form.
//
// Both spellings of one certificate must land on the same string or a perfectly
// correct build mismatches: `keytool -printcert` prints uppercase and
// colon-separated, while Android's PackageManager returns lowercase and bare.
// The same folding lives in `classify_build_fingerprint` (kasirmu-core), and
// the two must agree — hence this mirrors it rather than inventing a second
// rule. Returns "" for anything that cannot be a SHA-256.
func normaliseFingerprint(raw string) string {
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
	if len(cleaned) != 64 {
		return ""
	}
	return cleaned
}

// loadReleaseChannel finds the row for a channel, or nil when none exists.
//
// A nil row is not an error: a channel with no pins has simply made no claim,
// which is the state every deployment starts in.
func loadReleaseChannel(app core.App, channel string) (*core.Record, error) {
	rec, err := app.FindFirstRecordByFilter(releaseChannelsCollection,
		"channel = {:channel}", map[string]any{"channel": channel})
	if err != nil {
		// Found no record: PocketBase surfaces this as an error with a nil
		// record, so distinguish "absent" from a genuine query failure by
		// checking the record rather than the error alone.
		if rec == nil {
			return nil, nil
		}
		return nil, err
	}
	return rec, nil
}

// acceptedPinsFromRecord reads the stored pin set, tolerating an absent or
// malformed value by reporting an EMPTY set rather than an error.
//
// Empty is the safe direction: `classify_build_fingerprint` reads an empty
// accepted set as `Unknown`, so a corrupt field cannot manufacture a
// `Mismatch` and refuse renewal for a correct build.
func acceptedPinsFromRecord(rec *core.Record) []string {
	if rec == nil {
		return []string{}
	}
	raw := rec.Get("accepted_pins")
	if raw == nil {
		return []string{}
	}
	// Round-trip through encoding/json rather than type-asserting: PocketBase
	// returns a JSON field as types.JSONRaw (a []byte), NOT as []any, so a type
	// switch on []any silently reads every stored set as empty. That failure is
	// invisible in the write response (which echoes the request) and only shows
	// on the read path — which is exactly the path an operator trusts before
	// rotating a keystore. This mirrors feature_grants.go's reader.
	b, err := json.Marshal(raw)
	if err != nil {
		return []string{}
	}
	var out []string
	if err := json.Unmarshal(b, &out); err != nil {
		return []string{}
	}
	return out
}

// handleAdminGetReleasePins reads a channel's accepted set.
//
// GET /api/v1/admin/release-channels/{channel}/pins
//
// The operator-facing half of the rotation: before writing a new set, an
// operator needs to see what the current one is. Without this the only way to
// learn the pin set would be to read the database, which is exactly the
// situation §Q-B exists to remove.
func handleAdminGetReleasePins(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		if !adminAuth(app, e) {
			return nil
		}
		channel := normaliseChannel(e.Request.PathValue("channel"))
		if channel == "" {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "channel is required"})
		}

		rec, err := loadReleaseChannel(app, channel)
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "release channel lookup failed"})
		}
		return e.JSON(http.StatusOK, map[string]any{
			"channel":       channel,
			"accepted_pins": acceptedPinsFromRecord(rec),
			"pinned":        rec != nil,
		})
	}
}

// handleAdminSetReleasePins replaces a channel's accepted pin set.
//
// POST /api/v1/admin/release-channels/{channel}/pins
//
// ADR #57 §Q-B: the writer is the admin surface, "because that is where an
// operator with the authority to rotate a keystore already lives". This is that
// route.
//
// Idempotent in the same sense handleAdminSetRegion is: writing the set that is
// already stored reports status "unchanged" rather than failing, so a retried
// or double-clicked request cannot error for being already-true.
//
// Validates the WHOLE request before writing anything. A partially-applied pin
// set would be worse than a rejected one: it would silently narrow the accepted
// set and start refusing renewal for devices that had been verifying.
func handleAdminSetReleasePins(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		if !adminAuth(app, e) {
			return nil
		}
		channel := normaliseChannel(e.Request.PathValue("channel"))
		if channel == "" {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "channel is required"})
		}
		if e.Request.Body == nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "JSON body required"})
		}
		var req releasePinUpdateRequest
		if err := json.NewDecoder(e.Request.Body).Decode(&req); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "invalid JSON body"})
		}

		if strings.TrimSpace(req.Note) == "" {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "note is required (audit trail)"})
		}
		if len(req.Pins) > maxAcceptedPins {
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "too many pins — at most " + strconv.Itoa(maxAcceptedPins) + " accepted fingerprints per channel",
			})
		}

		// Normalise and reject unusable entries rather than dropping them. A
		// silently-dropped pin is a build that stops verifying with no
		// indication why, which is the merchant-lockout failure §2.2 names.
		pins := make([]string, 0, len(req.Pins))
		seen := make(map[string]bool, len(req.Pins))
		for _, raw := range req.Pins {
			norm := normaliseFingerprint(raw)
			if norm == "" {
				return e.JSON(http.StatusBadRequest, map[string]any{
					"error": "each pin must be a SHA-256 signing-certificate fingerprint (64 hex digits, colons and case tolerated)",
				})
			}
			if seen[norm] {
				continue // dedupe: the same cert listed twice is one pin
			}
			seen[norm] = true
			pins = append(pins, norm)
		}

		existing, err := loadReleaseChannel(app, channel)
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "release channel lookup failed"})
		}
		from := acceptedPinsFromRecord(existing)
		if samePinSet(from, pins) {
			return e.JSON(http.StatusOK, map[string]any{
				"status":        "unchanged",
				"channel":       channel,
				"accepted_pins": from,
			})
		}

		coll, err := app.FindCollectionByNameOrId(releaseChannelsCollection)
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{
				"error": "release channel store unavailable",
			})
		}
		rec := existing
		if rec == nil {
			rec = core.NewRecord(coll)
			rec.Set("channel", channel)
		}
		rec.Set("accepted_pins", pins)
		rec.Set("note", req.Note)
		rec.Set("updated_by", adminActor(e))
		if err := app.Save(rec); err != nil {
			log.Printf("/admin/release-channels/%s/pins: save failed: %v", channel, err)
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "release pin update failed"})
		}

		log.Printf("/admin/release-channels/%s/pins: %d pin(s) → %d pin(s) (by %q)",
			channel, len(from), len(pins), adminActor(e))
		return e.JSON(http.StatusOK, map[string]any{
			"status":        "updated",
			"channel":       channel,
			"accepted_pins": pins,
			"from":          from,
		})
	}
}

// normaliseChannel folds a channel name to its canonical form.
//
// Lowercased and trimmed so "android" and "Android " name one channel: the same
// reasoning the region vocabulary uses, where two spellings of one value would
// be a routing bug that looks like a data bug.
func normaliseChannel(raw string) string {
	return strings.ToLower(strings.TrimSpace(raw))
}

// samePinSet reports whether two pin sets are equal regardless of order.
//
// Order-insensitive because the set is a SET: reordering the same fingerprints
// is not a rotation, and reporting "updated" for it would put a meaningless
// entry in front of the next operator reading the audit trail.
func samePinSet(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	inA := make(map[string]bool, len(a))
	for _, p := range a {
		inA[p] = true
	}
	for _, p := range b {
		if !inA[p] {
			return false
		}
	}
	return true
}
