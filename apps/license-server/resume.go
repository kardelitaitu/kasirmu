package main

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// handleResume returns an HTTP handler that resumes a paused subscription.
//
// Resume subscription (C3.3):
//   - Finds the paused subscription for this tenant
//   - Extends expires_at (+ grace_until) by the paused duration and re-signs
//     the payload (LSE-15): pausing freezes the paid period instead of
//     consuming it, and the device's offline-verified payload stays in sync
//     with the server record
//   - Sets status = "active", clears paused_at and paused_until
//   - Returns the fresh signed_payload + signature like renew does
func handleResume(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		// Cap request body at 64KB to prevent OOM via oversized JSON payloads (M4 audit).
		e.Request.Body = http.MaxBytesReader(e.Response, e.Request.Body, 64*1024)

		// ── Rate limit: shared persisted per-IP token bucket (5/hr) ──
		// pause/resume were the only findTenantByAPIKey (bcrypt) endpoints
		// without the bucket — an unauthenticated client could hammer them
		// for cheap CPU exhaustion. Applied before auth, mirroring
		// status.go ordering (LSE-16).
		if !ipRateLimiter.allow(e.RealIP()) {
			return e.JSON(http.StatusTooManyRequests, map[string]any{
				"error": "rate limit exceeded, try again later",
			})
		}

		// Authenticate via Bearer token
		apiKey, err := extractAPIKey(e.Request.Header.Get("Authorization"))
		if err != nil {
			return e.JSON(http.StatusUnauthorized, map[string]any{"error": err.Error()})
		}

		// Find tenant by API key
		tenant, err := findTenantByAPIKey(app, apiKey)
		if err != nil {
			return e.JSON(http.StatusUnauthorized, map[string]any{"error": "invalid API key"})
		}

		// Find the paused subscription for this tenant
		sub, err := app.FindFirstRecordByFilter("subscriptions",
			"tenant_id = {:tenant_id} && status = 'paused'",
			map[string]any{"tenant_id": tenant.Id})
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{
				"error": "no paused subscription found",
			})
		}

		// ── LSE-15: extend the billing window by the paused duration ──
		// The pause is supposed to freeze the paid period, not consume it.
		// Shared with the auto-resume scanner below.
		payloadStr, signature, _, err := resumeSubscription(app, sub, time.Now().UTC())
		if err != nil {
			log.Printf("resume: failed to resume subscription %s: %v", sub.Id, err)
			return e.JSON(http.StatusInternalServerError, map[string]any{
				"error": "failed to resume subscription",
			})
		}

		// Return the fresh signed payload so the device's offline-verified
		// copy updates on the same call (same contract as renew).
		return e.JSON(http.StatusOK, map[string]any{
			"status":         "active",
			"tier_key":       sub.GetString("tier_key"),
			"signed_payload": payloadStr,
			"signature":      signature,
		})
	}
}

// resumeSubscription ends a pause (LSE-15): extends expires_at + grace_until
// by the time actually spent paused, capped at the planned pause end, then
// re-signs the payload — exactly like renew does — and saves the record.
// Pausing freezes the paid period instead of consuming it, and the device's
// offline-verified payload stays in sync with the server record.
//
// Used by handleResume (early manual resume) and runAutoResumeScanner
// (paused_until passed with no resume call).
func resumeSubscription(app core.App, sub *core.Record, now time.Time) (payloadStr, signature string, newExpiresAt time.Time, err error) {
	pausedAt := sub.GetDateTime("paused_at").Time()
	pausedUntil := sub.GetDateTime("paused_until").Time()
	oldExpiresAt := sub.GetDateTime("expires_at").Time()

	// Credit the time actually spent paused, capped at the planned pause
	// end: an early manual resume gets exactly the elapsed pause back; a
	// late/auto resume (paused_until already past) gets the PLANNED pause
	// length, not the extra time the record sat unresumed afterwards.
	extension := time.Duration(0)
	if !pausedAt.IsZero() {
		end := now
		if !pausedUntil.IsZero() && pausedUntil.Before(now) {
			end = pausedUntil
		}
		if end.After(pausedAt) {
			extension = end.Sub(pausedAt)
		}
	}
	newExpiresAt = oldExpiresAt.Add(extension)
	newGraceUntil := calculateGraceUntil(sub.GetString("tier_key"), newExpiresAt)

	// Quota fields come from the paused subscription row itself so the
	// re-signed payload matches the DB exactly.
	var allowedTypes []string
	if err := json.Unmarshal([]byte(sub.GetString("allowed_types")), &allowedTypes); err != nil {
		allowedTypes = []string{}
	}
	resumed := SubscriptionPayload{
		TenantID:        sub.GetString("tenant_id"),
		TierKey:         sub.GetString("tier_key"),
		Status:          "active",
		MaxLocations:    sub.GetInt("max_stores"),
		MaxPOSInstances: sub.GetInt("max_pos_instances"),
		AllowedTypes:    allowedTypes,
		StartsAt:        sub.GetDateTime("starts_at").Time().Format(time.RFC3339),
		ExpiresAt:       newExpiresAt.Format(time.RFC3339),
		GraceUntil:      newGraceUntil.Format(time.RFC3339),
		IssuedAt:        now.Format(time.RFC3339),
	}
	// D2: carry any admin-authored per-feature grants into the signed payload.
	resumed.Features = featureGrantsForTenant(app, sub.GetString("tenant_id"))
	payloadStr, signature, err = signSubscription(resumed)
	if err != nil {
		return "", "", time.Time{}, err
	}

	sub.Set("status", "active")
	sub.Set("paused_at", nil)
	sub.Set("paused_until", nil)
	sub.Set("expires_at", resumed.ExpiresAt)
	sub.Set("grace_until", resumed.GraceUntil)
	sub.Set("signed_payload", payloadStr)
	sub.Set("signature", signature)

	if err := app.Save(sub); err != nil {
		return "", "", time.Time{}, err
	}

	log.Printf("resume: subscription %s resumed — expires_at extended by %s to %s",
		sub.Id, extension.Round(time.Minute), newExpiresAt.Format(time.RFC3339))
	return payloadStr, signature, newExpiresAt, nil
}

// ── Auto-resume scanner (LSE-15) ─────────────────────────────────────

// startAutoResumeScanner runs a daily scan that resumes paused
// subscriptions whose paused_until has passed. Without it the auto-resume
// promise in pause.go was only honored lazily when the device called
// /resume — a paused subscription nobody resumed sat in limbo with a
// stale, never-extended billing window.
func startAutoResumeScanner(app core.App) {
	runAutoResumeScanner(app)
	ticker := time.NewTicker(24 * time.Hour)
	for range ticker.C {
		runAutoResumeScanner(app)
	}
}

func runAutoResumeScanner(app core.App) {
	subs, err := app.FindRecordsByFilter("subscriptions",
		"status = 'paused' && paused_until != '' && paused_until < {:now}",
		"-starts_at", 0, 0,
		map[string]any{"now": time.Now().UTC().Format(time.RFC3339)})
	if err != nil {
		log.Printf("auto-resume-scanner: failed to query paused subscriptions: %v", err)
		return
	}
	if len(subs) == 0 {
		return
	}

	log.Printf("auto-resume-scanner: resuming %d subscription(s) past their pause window", len(subs))
	resumed := 0
	for _, sub := range subs {
		if _, _, _, err := resumeSubscription(app, sub, time.Now().UTC()); err != nil {
			log.Printf("auto-resume-scanner: failed to resume subscription %s: %v", sub.Id, err)
			continue
		}
		resumed++
	}
	log.Printf("auto-resume-scanner: scan complete — %d resumed", resumed)
}
