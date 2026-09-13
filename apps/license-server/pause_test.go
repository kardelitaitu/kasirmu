package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// seedSubscriptionForPause creates a subscription record for pause/resume tests.
func seedSubscriptionForPause(t *testing.T, app *tests.TestApp, tenantID, tierKey, status string) {
	t.Helper()
	coll, err := app.FindCollectionByNameOrId("subscriptions")
	if err != nil {
		t.Fatalf("subscriptions collection not found: %v", err)
	}
	rec := core.NewRecord(coll)
	rec.Set("tenant_id", []string{tenantID})
	rec.Set("tier_key", tierKey)
	rec.Set("status", status)
	rec.Set("starts_at", "2026-01-01T00:00:00Z")
	rec.Set("expires_at", "2027-01-01T00:00:00Z")
	rec.Set("signed_payload", "test-payload")
	rec.Set("signature", "test-sig")
	if err := app.Save(rec); err != nil {
		t.Fatalf("failed to seed subscription: %v", err)
	}
}

// ── Pause subscription tests ───────────────────────────────────────

func TestPauseSubscription(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	tenantID := "pausetenant0001" // 15 chars
	apiKey := "oz_pausetestkey01"
	seedTenant(t, app, tenantID, apiKey, "active")
	seedSubscriptionForPause(t, app, tenantID, "plus", "active")

	// Pause for 1 month
	body := servePost(t, se, "/api/v1/license/pause", "Bearer "+apiKey, nil,
		`{"pause_months":1}`)
	if body.Code != 200 {
		t.Fatalf("expected 200 for pause, got %d: %s", body.Code, body.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(body.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if resp["status"] != "paused" {
		t.Errorf("expected status 'paused', got %v", resp["status"])
	}
	if resp["tier_key"] != "plus" {
		t.Errorf("expected tier_key 'plus', got %v", resp["tier_key"])
	}

	// Verify subscription is now paused in DB
	sub, err := app.FindFirstRecordByFilter("subscriptions",
		"tenant_id = {:tenant_id} && status = 'paused'",
		map[string]any{"tenant_id": tenantID})
	if err != nil {
		t.Fatalf("subscription not paused in DB: %v", err)
	}

	// Verify paused_until is ~1 month from now
	pausedUntil := sub.GetDateTime("paused_until").Time()
	expected := time.Now().UTC().AddDate(0, 1, 0)
	diff := pausedUntil.Sub(expected)
	if diff < -2*time.Minute || diff > 2*time.Minute {
		t.Errorf("paused_until should be ~1 month from now, got %v (diff %v)", pausedUntil, diff)
	}

	// Verify paused_at is set
	pausedAt := sub.GetDateTime("paused_at")
	if pausedAt.IsZero() {
		t.Error("paused_at should be set")
	}

	t.Logf("pause: subscription paused for 1 month until %s", pausedUntil.Format(time.RFC3339))
}

func TestPauseSubscription_InvalidMonths(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	tenantID := "pauseinvalid001" // 15 chars
	apiKey := "oz_pauseinvalid01"
	seedTenant(t, app, tenantID, apiKey, "active")
	seedSubscriptionForPause(t, app, tenantID, "plus", "active")

	// Try pause with invalid months (0)
	body := servePost(t, se, "/api/v1/license/pause", "Bearer "+apiKey, nil,
		`{"pause_months":0}`)
	if body.Code != 400 {
		t.Fatalf("expected 400 for pause_months=0, got %d: %s", body.Code, body.Body.String())
	}

	// Try pause with invalid months (4)
	body = servePost(t, se, "/api/v1/license/pause", "Bearer "+apiKey, nil,
		`{"pause_months":4}`)
	if body.Code != 400 {
		t.Fatalf("expected 400 for pause_months=4, got %d: %s", body.Code, body.Body.String())
	}
}

func TestPauseSubscription_NoActiveSubscription(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	tenantID := "pausenosub00001" // 15 chars
	apiKey := "oz_pausenosub01"
	seedTenant(t, app, tenantID, apiKey, "active")
	// No subscription seeded

	// Try to pause without an active subscription
	body := servePost(t, se, "/api/v1/license/pause", "Bearer "+apiKey, nil,
		`{"pause_months":1}`)
	if body.Code != 404 {
		t.Fatalf("expected 404 for no active subscription, got %d: %s", body.Code, body.Body.String())
	}
}

func TestPauseSubscription_MaxMonths(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	tenantID := "pausemaxm000001" // 15 chars
	apiKey := "oz_pausemaxm01"
	seedTenant(t, app, tenantID, apiKey, "active")
	seedSubscriptionForPause(t, app, tenantID, "plus", "active")

	// Pause for 3 months (max allowed)
	body := servePost(t, se, "/api/v1/license/pause", "Bearer "+apiKey, nil,
		`{"pause_months":3}`)
	if body.Code != 200 {
		t.Fatalf("expected 200 for pause_months=3, got %d: %s", body.Code, body.Body.String())
	}

	// Verify paused_until is ~3 months from now
	sub, err := app.FindFirstRecordByFilter("subscriptions",
		"tenant_id = {:tenant_id} && status = 'paused'",
		map[string]any{"tenant_id": tenantID})
	if err != nil {
		t.Fatalf("subscription not paused in DB: %v", err)
	}
	pausedUntil := sub.GetDateTime("paused_until").Time()
	expected := time.Now().UTC().AddDate(0, 3, 0)
	diff := pausedUntil.Sub(expected)
	if diff < -2*time.Minute || diff > 2*time.Minute {
		t.Errorf("paused_until should be ~3 months from now, got %v (diff %v)", pausedUntil, diff)
	}
}

// ── Resume subscription tests ──────────────────────────────────────

func TestResumeSubscription(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	tenantID := "resumetenant001" // 15 chars
	apiKey := "oz_resumetest01"
	seedTenant(t, app, tenantID, apiKey, "active")
	seedSubscriptionForPause(t, app, tenantID, "plus", "paused")

	// Resume
	body := servePost(t, se, "/api/v1/license/resume", "Bearer "+apiKey, nil, "")
	if body.Code != 200 {
		t.Fatalf("expected 200 for resume, got %d: %s", body.Code, body.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(body.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if resp["status"] != "active" {
		t.Errorf("expected status 'active', got %v", resp["status"])
	}
	if resp["tier_key"] != "plus" {
		t.Errorf("expected tier_key 'plus', got %v", resp["tier_key"])
	}

	// Verify active in DB
	sub, err := app.FindFirstRecordByFilter("subscriptions",
		"tenant_id = {:tenant_id} && status = 'active'",
		map[string]any{"tenant_id": tenantID})
	if err != nil {
		t.Fatalf("subscription not active in DB: %v", err)
	}

	// Verify paused_at and paused_until are cleared
	pausedAt := sub.GetDateTime("paused_at")
	if !pausedAt.IsZero() {
		t.Errorf("paused_at should be zero after resume, got %v", pausedAt)
	}
	pausedUntil := sub.GetDateTime("paused_until")
	if !pausedUntil.IsZero() {
		t.Errorf("paused_until should be zero after resume, got %v", pausedUntil)
	}

	t.Log("resume: subscription resumed successfully")
}

func TestResumeSubscription_NotPaused(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	tenantID := "resumenotp00001" // 15 chars
	apiKey := "oz_resumenotp01"
	seedTenant(t, app, tenantID, apiKey, "active")
	seedSubscriptionForPause(t, app, tenantID, "plus", "active")

	// Try to resume an active subscription
	body := servePost(t, se, "/api/v1/license/resume", "Bearer "+apiKey, nil, "")
	if body.Code != 404 {
		t.Fatalf("expected 404 for no paused subscription, got %d: %s", body.Code, body.Body.String())
	}
}

func TestResumeSubscription_AuthRequired(t *testing.T) {
	resetRateLimiters()
	_, se := setupDirectApp(t)

	// Try resume without auth
	body := servePost(t, se, "/api/v1/license/resume", "", nil, "")
	if body.Code != 401 {
		t.Fatalf("expected 401 for missing auth, got %d: %s", body.Code, body.Body.String())
	}
}

func TestPauseSubscription_AuthRequired(t *testing.T) {
	resetRateLimiters()
	_, se := setupDirectApp(t)

	// Try pause without auth
	body := servePost(t, se, "/api/v1/license/pause", "", nil, `{"pause_months":1}`)
	if body.Code != 401 {
		t.Fatalf("expected 401 for missing auth, got %d: %s", body.Code, body.Body.String())
	}
}

// ── LSE-16: pause/resume share the per-IP bucket ───────────────────
// They were the only findTenantByAPIKey (bcrypt) endpoints without the
// persisted IP budget — an unauthenticated client could hammer them for
// cheap CPU exhaustion. The limiter fires after body validation (pause)
// / before auth (resume), so a well-formed request from an exhausted IP
// answers 429 instead of reaching bcrypt.

func TestPauseResume_RateLimited(t *testing.T) {
	resetRateLimiters()
	_, se := setupDirectApp(t)

	testIP := "10.99.99.93"
	for i := 0; i < ipRateLimiter.maxPerHr; i++ {
		ipRateLimiter.allow(testIP)
	}

	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}

	// Pause: well-formed body + garbage bearer → 429 (limiter precedes
	// the bcrypt lookup).
	req := httptest.NewRequest("POST", "/api/v1/license/pause",
		strings.NewReader(`{"pause_months":2}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer oz_notarealkey0000")
	req.RemoteAddr = testIP + ":1234"
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("pause: expected 429 once the IP budget is exhausted, got %d: %s", rec.Code, rec.Body.String())
	}

	// Resume: same exhausted IP → 429.
	req2 := httptest.NewRequest("POST", "/api/v1/license/resume", nil)
	req2.Header.Set("Authorization", "Bearer oz_notarealkey0000")
	req2.RemoteAddr = testIP + ":1234"
	rec2 := httptest.NewRecorder()
	mux.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusTooManyRequests {
		t.Fatalf("resume: expected 429 once the IP budget is exhausted, got %d: %s", rec2.Code, rec2.Body.String())
	}
}

// ── LSE-15: pausing must freeze the paid period, not consume it ──────

// TestResumeSubscription_ExtendsExpiryByPausedDuration pins the LSE-15
// fix: an early manual resume extends expires_at by the ACTUAL paused
// duration and re-signs the payload (the old code only flipped the
// status — the customer silently lost the paused months despite the doc
// comment claiming "resets the billing cycle").
func TestResumeSubscription_ExtendsExpiryByPausedDuration(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	tenantID := "lse15tenant0001" // 15 chars
	apiKey := "oz_lse15resume01"
	seedTenant(t, app, tenantID, apiKey, "active")
	seedSubscriptionForPause(t, app, tenantID, "plus", "paused")

	// Simulate a pause that started 10 days ago out of a 3-month window.
	sub, err := app.FindFirstRecordByFilter("subscriptions",
		"tenant_id = {:tid}", map[string]any{"tid": tenantID})
	if err != nil {
		t.Fatalf("find seeded sub: %v", err)
	}
	sub.Set("paused_at", time.Now().UTC().Add(-10*24*time.Hour))
	sub.Set("paused_until", time.Now().UTC().AddDate(0, 3, 0))
	if err := app.Save(sub); err != nil {
		t.Fatalf("set pause timestamps: %v", err)
	}
	originalExpiry := sub.GetDateTime("expires_at").Time()
	originalSignature := sub.GetString("signature")

	body := servePost(t, se, "/api/v1/license/resume", "Bearer "+apiKey, nil, "")
	if body.Code != 200 {
		t.Fatalf("expected 200 for resume, got %d: %s", body.Code, body.Body.String())
	}

	resumed, err := app.FindFirstRecordByFilter("subscriptions",
		"tenant_id = {:tid} && status = 'active'", map[string]any{"tid": tenantID})
	if err != nil {
		t.Fatalf("subscription not active after resume: %v", err)
	}

	newExpiry := resumed.GetDateTime("expires_at").Time()
	want := originalExpiry.Add(10 * 24 * time.Hour)
	diff := newExpiry.Sub(want)
	if diff < -2*time.Minute || diff > 2*time.Minute {
		t.Errorf("expires_at should be extended by exactly the 10 paused days: got %v, want %v (diff %v)",
			newExpiry, want, diff)
	}

	// grace_until must be recomputed from the new expiry.
	wantGrace := calculateGraceUntil("plus", newExpiry)
	graceDiff := resumed.GetDateTime("grace_until").Time().Sub(wantGrace)
	if graceDiff < -2*time.Minute || graceDiff > 2*time.Minute {
		t.Errorf("grace_until not recomputed: got %v, want %v",
			resumed.GetDateTime("grace_until").Time(), wantGrace)
	}

	// The payload must have been RE-SIGNED, not left as the seeded stub.
	if resumed.GetString("signature") == originalSignature {
		t.Error("signature was not renewed on resume — payload still stale")
	}
	if resumed.GetString("signature") == "" || resumed.GetString("signed_payload") == "" {
		t.Error("signed_payload/signature must be set after resume")
	}

	// The response carries the fresh signed payload for the device.
	var resp map[string]any
	if err := json.Unmarshal(body.Body.Bytes(), &resp); err != nil {
		t.Fatalf("parse response: %v", err)
	}
	if resp["signed_payload"] == nil || resp["signature"] == nil {
		t.Error("resume response must include signed_payload and signature (device offline sync)")
	}
}

// TestAutoResumeScanner_ResumesPastPauseWindow pins the scanner side of
// LSE-15: a subscription whose paused_until passed with no resume call is
// resumed by the scanner with the PLANNED pause length credited (not the
// extra time the record sat unresumed).
func TestAutoResumeScanner_ResumesPastPauseWindow(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	tenantID := "lse15scantest01" // 15 chars
	apiKey := "oz_lse15scan001"
	seedTenant(t, app, tenantID, apiKey, "active")
	seedSubscriptionForPause(t, app, tenantID, "pro", "paused")

	sub, err := app.FindFirstRecordByFilter("subscriptions",
		"tenant_id = {:tid}", map[string]any{"tid": tenantID})
	if err != nil {
		t.Fatalf("find seeded sub: %v", err)
	}
	// Pause started 100 days ago, planned for 90 days → ended 10 days ago.
	sub.Set("paused_at", time.Now().UTC().Add(-100*24*time.Hour))
	sub.Set("paused_until", time.Now().UTC().Add(-10*24*time.Hour))
	if err := app.Save(sub); err != nil {
		t.Fatalf("set pause timestamps: %v", err)
	}
	originalExpiry := sub.GetDateTime("expires_at").Time()

	runAutoResumeScanner(app)

	resumed, err := app.FindFirstRecordByFilter("subscriptions",
		"tenant_id = {:tid} && status = 'active'", map[string]any{"tid": tenantID})
	if err != nil {
		t.Fatalf("scanner did not resume the subscription: %v", err)
	}

	// Extension = planned pause (90 days), NOT the elapsed 100 days.
	want := originalExpiry.Add(90 * 24 * time.Hour)
	diff := resumed.GetDateTime("expires_at").Time().Sub(want)
	if diff < -2*time.Minute || diff > 2*time.Minute {
		t.Errorf("expires_at should be extended by the planned 90 pause days: got %v, want %v (diff %v)",
			resumed.GetDateTime("expires_at").Time(), want, diff)
	}
	if !resumed.GetDateTime("paused_until").IsZero() {
		t.Error("paused_until should be cleared after auto-resume")
	}
	_ = se
}
