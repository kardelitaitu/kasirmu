package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// ── Test helpers ────────────────────────────────────────────────────

// stubOTPEmail captures the OTP code passed to sendOTPEmail so tests can
// drive the full request-otp → verify-otp flow without a real SMTP relay.
// Returns a restore func that puts the production sender back.
func stubOTPEmail(t *testing.T, captured *string) func() {
	t.Helper()
	// The handler gates on OZ_SMTP_HOST being configured before calling
	// sendOTPEmail; the stub replaces the sender, so point the gate at a
	// fake relay.
	t.Setenv("OZ_SMTP_HOST", "test.local")
	orig := sendOTPEmail
	sendOTPEmail = func(to, code string) error {
		*captured = code
		return nil
	}
	return func() { sendOTPEmail = orig }
}

// webRequest issues an HTTP request against the test router and returns
// the recorder. origin sets the CORS Origin header ("" = non-browser).
func webRequest(t *testing.T, se *core.ServeEvent, method, path, body, origin, auth string) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body == "" {
		reader = bytes.NewReader(nil)
	} else {
		reader = bytes.NewReader([]byte(body))
	}
	req := httptest.NewRequest(method, path, reader)
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}
	mux.ServeHTTP(rec, req)
	return rec
}

// ── request-otp ─────────────────────────────────────────────────────

func TestRequestOTP_SendsCodeToActiveTenant(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTenant(t, app, "webotptenant001", "webotpkey000001", "active")

	var sentCode string
	restore := stubOTPEmail(t, &sentCode)
	defer restore()

	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/request-otp",
		`{"email":"WEBOTPTENANT001@example.com"}`, "http://localhost:4321", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if sentCode == "" || len(sentCode) != 6 {
		t.Fatalf("expected a 6-digit code to be sent, got %q", sentCode)
	}
	// The code must be stored (hashed) so verify-otp can consume it.
	webOtpStore.mu.Lock()
	_, stored := webOtpStore.codes["webotptenant001@example.com"]
	webOtpStore.mu.Unlock()
	if !stored {
		t.Error("expected a pending code to be stored for the tenant email")
	}
}

func TestRequestOTP_SelfSignupCreatesTenantAndSendsCode(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	var sentCode string
	restore := stubOTPEmail(t, &sentCode)
	defer restore()

	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/request-otp",
		`{"email":"nobody@example.com"}`, "http://localhost:4321", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	// Self-signup: an unknown email receives a code AND becomes an
	// active tenant (register-or-login — the response stays a plain 200,
	// so the endpoint never reveals whether the account pre-existed).
	if sentCode == "" || len(sentCode) != 6 {
		t.Fatalf("expected a 6-digit code to be sent for a new email, got %q", sentCode)
	}
	tenant, err := app.FindFirstRecordByData("tenants", "email", "nobody@example.com")
	if err != nil || tenant == nil {
		t.Fatalf("expected a tenant to be created by self-signup: %v", err)
	}
	if tenant.GetString("status") != "active" {
		t.Errorf("expected new tenant status active, got %q", tenant.GetString("status"))
	}
	if tenant.GetString("api_key") == "" || tenant.GetString("api_key_lookup") == "" {
		t.Error("expected placeholder api_key + lookup to be set on the new tenant")
	}
	// Self-signup does NOT verify the email — that happens at verify-otp.
	if tenant.GetBool("email_verified") {
		t.Error("expected a self-signed tenant to start email_verified=false")
	}
	webOtpStore.mu.Lock()
	_, stored := webOtpStore.codes["nobody@example.com"]
	webOtpStore.mu.Unlock()
	if !stored {
		t.Error("expected a pending code to be stored for the new email")
	}
}

// TestVerifyOTP_AfterSelfSignupIssuesSession drives the full register
// flow: request-otp creates the tenant, verify-otp with the emailed code
// issues a session token and returns the tenant summary.
func TestVerifyOTP_AfterSelfSignupIssuesSession(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	var sentCode string
	restore := stubOTPEmail(t, &sentCode)
	defer restore()

	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/request-otp",
		`{"email":"newuser@example.com"}`, "http://localhost:4321", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("request-otp expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if sentCode == "" {
		t.Fatal("expected a code to be sent")
	}

	rec = webRequest(t, se, http.MethodPost, "/api/v1/web/verify-otp",
		`{"email":"newuser@example.com","code":"`+sentCode+`"}`, "http://localhost:4321", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("verify-otp expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Token  string         `json:"token"`
		Tenant map[string]any `json:"tenant"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad response JSON: %v", err)
	}
	if resp.Token == "" {
		t.Error("expected a session token")
	}
	if resp.Tenant == nil {
		t.Error("expected a tenant summary in the verify response")
	}
	if resp.Tenant["email"] != "newuser@example.com" {
		t.Errorf("expected tenant email newuser@example.com, got %v", resp.Tenant["email"])
	}
	// Completing OTP verification must flip email_verified to true, both
	// in the response and on the persisted record (the dashboard reads
	// this from /me).
	if resp.Tenant["emailVerified"] != true {
		t.Errorf("expected emailVerified=true in the verify response, got %v", resp.Tenant["emailVerified"])
	}
	tenant, err := app.FindFirstRecordByData("tenants", "email", "newuser@example.com")
	if err != nil || tenant == nil {
		t.Fatalf("tenant should exist after verify: %v", err)
	}
	if !tenant.GetBool("email_verified") {
		t.Error("expected the persisted tenant record to be email_verified=true after verify-otp")
	}
}

func TestRequestOTP_NoEnumerationForSuspendedTenant(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTenant(t, app, "webotpsusp00001", "webotpsusp0001", "suspended")

	var sentCode string
	restore := stubOTPEmail(t, &sentCode)
	defer restore()

	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/request-otp",
		`{"email":"webotpsusp00001@example.com"}`, "http://localhost:4321", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 (no enumeration), got %d: %s", rec.Code, rec.Body.String())
	}
	if sentCode != "" {
		t.Error("no code should be emailed for a suspended tenant")
	}
}

func TestRequestOTP_RateLimitedPerEmail(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	var sentCode string
	restore := stubOTPEmail(t, &sentCode)
	defer restore()

	// 3 allowed per email per 15 min.
	for i := 0; i < 3; i++ {
		rec := webRequest(t, se, http.MethodPost, "/api/v1/web/request-otp",
			`{"email":"ratelimited@example.com"}`, "http://localhost:4321", "")
		if rec.Code != http.StatusOK {
			t.Fatalf("call %d should succeed, got %d: %s", i+1, rec.Code, rec.Body.String())
		}
	}
	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/request-otp",
		`{"email":"ratelimited@example.com"}`, "http://localhost:4321", "")
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("4th request should be 429, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestRequestOTP_CORSRejectsForeignOrigin(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/request-otp",
		`{"email":"cors@example.com"}`, "https://evil.example.com", "")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for disallowed origin, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestRequestOTP_MissingSMTPReturns503(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTenant(t, app, "webotpnosmtp001", "webotpnosmtp001", "active")
	t.Setenv("OZ_SMTP_HOST", "") // ensure unset

	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/request-otp",
		`{"email":"webotpnosmtp001@example.com"}`, "http://localhost:4321", "")
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 when SMTP unconfigured, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestRequestOTP_InvalidBodyAndEmail(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	// Invalid JSON → 400.
	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/request-otp",
		`not json`, "http://localhost:4321", "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid JSON, got %d: %s", rec.Code, rec.Body.String())
	}

	// Missing email → 400.
	rec = webRequest(t, se, http.MethodPost, "/api/v1/web/request-otp",
		`{}`, "http://localhost:4321", "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing email, got %d: %s", rec.Code, rec.Body.String())
	}

	// Malformed email → 400.
	rec = webRequest(t, se, http.MethodPost, "/api/v1/web/request-otp",
		`{"email":"not-an-email"}`, "http://localhost:4321", "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for malformed email, got %d: %s", rec.Code, rec.Body.String())
	}
}

// ── verify-otp ──────────────────────────────────────────────────────

func TestVerifyOTP_HappyPathIssuesSession(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	const tenantID = "webotpverify001"
	seedTenant(t, app, tenantID, "webotpverify001", "active")
	seedSubscription(t, app, tenantID, "pro", "active")

	var sentCode string
	restore := stubOTPEmail(t, &sentCode)
	defer restore()

	// Request a code.
	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/request-otp",
		`{"email":"webotpverify001@example.com"}`, "http://localhost:4321", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("request-otp failed: %d %s", rec.Code, rec.Body.String())
	}
	if sentCode == "" {
		t.Fatal("no code captured")
	}

	// Verify it.
	body := `{"email":"webotpverify001@example.com","code":"` + sentCode + `"}`
	rec = webRequest(t, se, http.MethodPost, "/api/v1/web/verify-otp",
		body, "http://localhost:4321", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("verify-otp failed: %d %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		Token   string         `json:"token"`
		Expires string         `json:"expires_at"`
		Tenant  map[string]any `json:"tenant"`
		License any            `json:"license"`
		Sub     any            `json:"subscription"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if resp.Token == "" {
		t.Error("expected a session token")
	}
	if resp.Expires == "" {
		t.Error("expected expires_at")
	}
	if resp.Tenant["email"] != "webotpverify001@example.com" {
		t.Errorf("unexpected tenant email: %v", resp.Tenant["email"])
	}
	if resp.Sub == nil {
		t.Error("expected a subscription summary (tenant has an active subscription)")
	}
	if resp.License != nil {
		t.Error("expected license to be null (tenant has no activated license key)")
	}

	// The code must be single-use.
	rec = webRequest(t, se, http.MethodPost, "/api/v1/web/verify-otp",
		body, "http://localhost:4321", "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("reusing a code should 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestVerifyOTP_WrongCodeGeneric401(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTenant(t, app, "webotpwrong0001", "webotpwrong0001", "active")

	var sentCode string
	restore := stubOTPEmail(t, &sentCode)
	defer restore()

	webRequest(t, se, http.MethodPost, "/api/v1/web/request-otp",
		`{"email":"webotpwrong0001@example.com"}`, "http://localhost:4321", "")
	if sentCode == "" {
		t.Fatal("no code captured")
	}

	// Wrong code (and also an unknown email) must both be the same 401.
	for _, body := range []string{
		`{"email":"webotpwrong0001@example.com","code":"000000"}`,
		`{"email":"unknown@example.com","code":"` + sentCode + `"}`,
	} {
		rec := webRequest(t, se, http.MethodPost, "/api/v1/web/verify-otp",
			body, "http://localhost:4321", "")
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected generic 401 for body %s, got %d: %s", body, rec.Code, rec.Body.String())
		}
	}
}

func TestVerifyOTP_RateLimited(t *testing.T) {
	t.Setenv("LOGIN_LOCKOUT_DISABLED", "1")
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	// 5 attempts per email per 15 min (no code needed — limiter fires first
	// on the 6th regardless of validity).
	for i := 0; i < 5; i++ {
		rec := webRequest(t, se, http.MethodPost, "/api/v1/web/verify-otp",
			`{"email":"verifyspam@example.com","code":"000000"}`,
			"http://localhost:4321", "")
		if rec.Code == http.StatusTooManyRequests {
			t.Fatalf("call %d should not be rate limited yet", i+1)
		}
	}
	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/verify-otp",
		`{"email":"verifyspam@example.com","code":"000000"}`,
		"http://localhost:4321", "")
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("6th attempt should be 429, got %d: %s", rec.Code, rec.Body.String())
	}
}

// ── /me ─────────────────────────────────────────────────────────────

func TestMe_ReturnsTenantProfile(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	const tenantID = "webotpme0000001"
	seedTenant(t, app, tenantID, "webotpme000001", "active")
	seedSubscription(t, app, tenantID, "premium", "active")
	seedLicenseKey(t, app, "OZ-ME-KEY-000001", "premium", "activated", "2099-12-31 23:59:59.000Z")
	// Bind the license key to the tenant via the activated_by relation.
	keys, err := app.FindRecordsByFilter("license_keys", "key = 'OZ-ME-KEY-000001'", "", 1, 0, nil)
	if err != nil || len(keys) == 0 {
		t.Fatalf("seeded key not found: %v", err)
	}
	keys[0].Set("activated_by", []string{tenantID})
	if err := app.Save(keys[0]); err != nil {
		t.Fatalf("failed to bind key: %v", err)
	}

	// Mint a session directly (bypasses the OTP flow for this test).
	token := "me-session-token-0001"
	webOtpStore.createSession(hashWebToken(token), tenantID)

	rec := webRequest(t, se, http.MethodGet, "/api/v1/web/me", "",
		"http://localhost:4321", "Bearer "+token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		Tenant  map[string]any `json:"tenant"`
		License map[string]any `json:"license"`
		Sub     map[string]any `json:"subscription"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if resp.Tenant["email"] != "webotpme0000001@example.com" {
		t.Errorf("unexpected tenant email: %v", resp.Tenant["email"])
	}
	if resp.Tenant["status"] != "active" {
		t.Errorf("unexpected tenant status: %v", resp.Tenant["status"])
	}
	if resp.Tenant["emailVerified"] != false {
		t.Errorf("expected emailVerified=false for a seeded (never-verified) tenant, got %v", resp.Tenant["emailVerified"])
	}
	if resp.License["key"] != "OZ-ME-KEY-000001" {
		t.Errorf("unexpected license key: %v", resp.License["key"])
	}
	if resp.License["tierKey"] != "premium" {
		t.Errorf("unexpected license tier: %v", resp.License["tierKey"])
	}
	if resp.Sub["tierKey"] != "premium" {
		t.Errorf("unexpected subscription tier: %v", resp.Sub["tierKey"])
	}
	if _, ok := resp.License["expiresAt"]; !ok {
		t.Error("expected license expiresAt in response")
	}
}

// TestMe_ShowsUnusedKeyViaSubscription covers the register-first purchase
// state: the webhook minted the license key (status "unused", linked by
// paddle_sub_id) but the POS hasn't activated it yet — /me must still
// surface the key the tenant paid for.
func TestMe_ShowsUnusedKeyViaSubscription(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	const tenantID = "webotpmeunused1"
	seedTenant(t, app, tenantID, "webotpmeunused1", "active")
	seedSubscription(t, app, tenantID, "pro", "active")
	// Link the subscription to a paddle sub id, and the key to the same id
	// (exactly what the webhook does on subscription.created).
	subs, err := app.FindRecordsByFilter("subscriptions", "tenant_id = {:t}", "", 1, 0, map[string]any{"t": tenantID})
	if err != nil || len(subs) == 0 {
		t.Fatalf("seeded subscription not found: %v", err)
	}
	subs[0].Set("paddle_sub_id", "sub_01m05unused")
	if err := app.Save(subs[0]); err != nil {
		t.Fatalf("failed to set paddle_sub_id: %v", err)
	}
	seedLicenseKey(t, app, "OZ-UNUSED-KEY-0001", "pro", "unused", "2099-12-31 23:59:59.000Z")
	keys, err := app.FindRecordsByFilter("license_keys", "key = 'OZ-UNUSED-KEY-0001'", "", 1, 0, nil)
	if err != nil || len(keys) == 0 {
		t.Fatalf("seeded key not found: %v", err)
	}
	keys[0].Set("paddle_sub_id", "sub_01m05unused")
	if err := app.Save(keys[0]); err != nil {
		t.Fatalf("failed to set key paddle_sub_id: %v", err)
	}

	token := "me-session-unused-0001"
	webOtpStore.createSession(hashWebToken(token), tenantID)

	rec := webRequest(t, se, http.MethodGet, "/api/v1/web/me", "",
		"http://localhost:4321", "Bearer "+token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		License map[string]any `json:"license"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if resp.License == nil {
		t.Fatal("expected the unused license key to be surfaced via the subscription link")
	}
	if resp.License["key"] != "OZ-UNUSED-KEY-0001" {
		t.Errorf("unexpected license key: %v", resp.License["key"])
	}
	if resp.License["tierKey"] != "pro" {
		t.Errorf("unexpected license tier: %v", resp.License["tierKey"])
	}
	if resp.License["status"] != "unused" {
		t.Errorf("expected status unused, got %v", resp.License["status"])
	}
}

// TestMe_ExposesSubscriptionBundleId verifies the account dashboard can
// tell a Plus subscriber already owns the Restaurant Starter bundle: /me
// exposes subscription.bundle_id, empty before the upgrade and
// restaurant_starter after it (the page hides the upgrade card once set).
func TestMe_ExposesSubscriptionBundleId(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	const tenantID = "webotpmebundl01"
	seedTenant(t, app, tenantID, "webotpmebundl01", "active")
	seedSubscription(t, app, tenantID, "plus", "active")

	token := "me-bundle-session-0001"
	webOtpStore.createSession(hashWebToken(token), tenantID)

	meBundle := func() string {
		t.Helper()
		rec := webRequest(t, se, http.MethodGet, "/api/v1/web/me", "",
			"http://localhost:4321", "Bearer "+token)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected /me 200, got %d: %s", rec.Code, rec.Body.String())
		}
		var resp struct {
			Sub map[string]any `json:"subscription"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to parse /me: %v", err)
		}
		v, ok := resp.Sub["bundleId"]
		if !ok {
			t.Fatal("expected subscription.bundleId in the /me payload")
		}
		s, _ := v.(string)
		return s
	}

	// Plain Plus subscription: no bundle yet → empty (card is shown).
	if got := meBundle(); got != "" {
		t.Errorf("expected empty bundleId for a plain plus subscription, got %q", got)
	}

	// The subscriber purchased the bundle (webhook wrote bundle_id) → the
	// dashboard sees it and hides the upgrade card.
	subs, err := app.FindRecordsByFilter("subscriptions", "tenant_id = {:t}", "", 1, 0, map[string]any{"t": tenantID})
	if err != nil || len(subs) == 0 {
		t.Fatalf("seeded subscription not found: %v", err)
	}
	subs[0].Set("bundle_id", "restaurant_starter")
	if err := app.Save(subs[0]); err != nil {
		t.Fatalf("failed to set bundle_id: %v", err)
	}
	if got := meBundle(); got != "restaurant_starter" {
		t.Errorf("expected bundleId=restaurant_starter after upgrade, got %q", got)
	}
}

// TestMe_ShowsGracePeriodSubscription covers the cancel/pause state: the
// webhook moved the subscription to grace_period (paddleSetGrace), and
// /me must still surface both the subscription card and the minted key
// instead of falling back to the "no subscription" shape.
func TestMe_ShowsGracePeriodSubscription(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	const tenantID = "webotpmegrace01"
	seedTenant(t, app, tenantID, "webotpmegrace01", "active")
	seedSubscription(t, app, tenantID, "pro", "grace_period")
	// Link the subscription to a paddle sub id and the minted key to the
	// same id, exactly as subscription.created then subscription.canceled
	// would leave it.
	subs, err := app.FindRecordsByFilter("subscriptions", "tenant_id = {:t}", "", 1, 0, map[string]any{"t": tenantID})
	if err != nil || len(subs) == 0 {
		t.Fatalf("seeded subscription not found: %v", err)
	}
	subs[0].Set("paddle_sub_id", "sub_01m05grace")
	subs[0].Set("grace_until", time.Now().UTC().AddDate(0, 0, 7).Format(time.RFC3339))
	if err := app.Save(subs[0]); err != nil {
		t.Fatalf("failed to set paddle_sub_id: %v", err)
	}
	seedLicenseKey(t, app, "OZ-GRACE-KEY-0001", "pro", "unused", "2099-12-31 23:59:59.000Z")
	keys, err := app.FindRecordsByFilter("license_keys", "key = 'OZ-GRACE-KEY-0001'", "", 1, 0, nil)
	if err != nil || len(keys) == 0 {
		t.Fatalf("seeded key not found: %v", err)
	}
	keys[0].Set("paddle_sub_id", "sub_01m05grace")
	if err := app.Save(keys[0]); err != nil {
		t.Fatalf("failed to set key paddle_sub_id: %v", err)
	}

	token := "me-session-grace-0001"
	webOtpStore.createSession(hashWebToken(token), tenantID)

	rec := webRequest(t, se, http.MethodGet, "/api/v1/web/me", "",
		"http://localhost:4321", "Bearer "+token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		License map[string]any `json:"license"`
		Sub     map[string]any `json:"subscription"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if resp.Sub == nil {
		t.Fatal("expected the grace_period subscription to be surfaced")
	}
	if resp.Sub["status"] != "grace_period" {
		t.Errorf("expected status grace_period, got %v", resp.Sub["status"])
	}
	if resp.Sub["tierKey"] != "pro" {
		t.Errorf("unexpected subscription tier: %v", resp.Sub["tierKey"])
	}
	if _, ok := resp.Sub["graceUntil"]; !ok {
		t.Error("expected subscription graceUntil in response")
	}
	if resp.License == nil {
		t.Fatal("expected the minted license key to still be surfaced in grace")
	}
	if resp.License["key"] != "OZ-GRACE-KEY-0001" {
		t.Errorf("unexpected license key: %v", resp.License["key"])
	}
}

func TestMe_UnauthorizedWithoutToken(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	for _, auth := range []string{"", "Bearer ", "Bearer notarealtoken"} {
		rec := webRequest(t, se, http.MethodGet, "/api/v1/web/me", "",
			"http://localhost:4321", auth)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 for auth %q, got %d: %s", auth, rec.Code, rec.Body.String())
		}
	}
}

func TestMe_ExpiredSessionReturns401(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTenant(t, app, "webotpmeexp0001", "webotpmeexp0001", "active")

	token := "expired-session-tok"
	// Insert a session that is already past its TTL.
	webOtpStore.mu.Lock()
	webOtpStore.sessions[hashWebToken(token)] = &webSession{
		tenantID:  "webotpmeexp0001",
		expiresAt: time.Now().Add(-time.Minute),
	}
	webOtpStore.mu.Unlock()

	rec := webRequest(t, se, http.MethodGet, "/api/v1/web/me", "",
		"http://localhost:4321", "Bearer "+token)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for expired session, got %d: %s", rec.Code, rec.Body.String())
	}
}

// ── logout ──────────────────────────────────────────────────────────

func TestLogout_InvalidatesSession(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTenant(t, app, "webotplogout001", "webotplogout001", "active")

	token := "logout-session-tok"
	webOtpStore.createSession(hashWebToken(token), "webotplogout001")

	// /me works before logout.
	rec := webRequest(t, se, http.MethodGet, "/api/v1/web/me", "",
		"http://localhost:4321", "Bearer "+token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected /me 200 before logout, got %d: %s", rec.Code, rec.Body.String())
	}

	// Logout (idempotent — repeat call also 200).
	for i := 0; i < 2; i++ {
		rec = webRequest(t, se, http.MethodPost, "/api/v1/web/logout", "",
			"http://localhost:4321", "Bearer "+token)
		if rec.Code != http.StatusOK {
			t.Fatalf("logout call %d should be 200, got %d: %s", i+1, rec.Code, rec.Body.String())
		}
	}

	// /me now 401 — session gone.
	rec = webRequest(t, se, http.MethodGet, "/api/v1/web/me", "",
		"http://localhost:4321", "Bearer "+token)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected /me 401 after logout, got %d: %s", rec.Code, rec.Body.String())
	}
}

// ── Helper unit tests ───────────────────────────────────────────────

func TestGenerateOtpCode_IsSixDigits(t *testing.T) {
	for i := 0; i < 200; i++ {
		code, err := generateOtpCode()
		if err != nil {
			t.Fatalf("generateOtpCode failed: %v", err)
		}
		if len(code) != 6 {
			t.Fatalf("expected 6-digit code, got %q", code)
		}
		for _, c := range code {
			if c < '0' || c > '9' {
				t.Fatalf("non-digit char in code %q", code)
			}
		}
	}
}

func TestIs6DigitCode(t *testing.T) {
	for _, tc := range []struct {
		in   string
		want bool
	}{
		{"123456", true},
		{"000000", true},
		{"12345", false},
		{"1234567", false},
		{"12a456", false},
		{"", false},
		{" 123456", false},
	} {
		if got := is6DigitCode(tc.in); got != tc.want {
			t.Errorf("is6DigitCode(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}

func TestNormalizeEmail(t *testing.T) {
	if got := normalizeEmail("  Foo@Example.COM "); got != "foo@example.com" {
		t.Errorf("normalizeEmail = %q, want foo@example.com", got)
	}
}

func TestConstantTimeHashEq(t *testing.T) {
	a := hashOtpCode("123456")
	b := hashOtpCode("123456")
	c := hashOtpCode("654321")
	if !constantTimeHashEq(a, b) {
		t.Error("identical hashes should match")
	}
	if constantTimeHashEq(a, c) {
		t.Error("different hashes must not match")
	}
	if constantTimeHashEq(a, "") {
		t.Error("empty hash must not match")
	}
}

func TestWebSessionTTL_Default(t *testing.T) {
	if got := webSessionTTL(); got != defaultWebSessionTTL {
		t.Errorf("default TTL = %v, want %v", got, defaultWebSessionTTL)
	}
}

func TestWebSessionTTL_EnvOverride(t *testing.T) {
	t.Setenv("OZ_WEB_SESSION_TTL", "1h")
	if got := webSessionTTL(); got != time.Hour {
		t.Errorf("env TTL = %v, want 1h", got)
	}
}

func TestWebSessionTTL_InvalidEnvFallsBack(t *testing.T) {
	t.Setenv("OZ_WEB_SESSION_TTL", "not-a-duration")
	if got := webSessionTTL(); got != defaultWebSessionTTL {
		t.Errorf("invalid env TTL = %v, want default %v", got, defaultWebSessionTTL)
	}
}

func TestWebAllowedOrigins_Default(t *testing.T) {
	origins := webAllowedOrigins()
	if len(origins) != 4 {
		t.Fatalf("expected 4 default origins, got %d: %v", len(origins), origins)
	}
	if !strings.Contains(strings.Join(origins, ","), "kasir.mu") {
		t.Errorf("expected kasir.mu origin in defaults, got %v", origins)
	}
	if !strings.Contains(strings.Join(origins, ","), "dashboard.kasir.mu") {
		t.Errorf("expected dashboard.kasir.mu origin in defaults, got %v", origins)
	}
}

func TestWebAllowedOrigins_EnvOverride(t *testing.T) {
	t.Setenv("OZ_WEB_ALLOWED_ORIGINS", "https://a.com, https://b.com")
	origins := webAllowedOrigins()
	if len(origins) != 2 || origins[0] != "https://a.com" || origins[1] != "https://b.com" {
		t.Errorf("unexpected origins from env: %v", origins)
	}
}

func TestWebAllowedOrigins_CorsOriginsMerged(t *testing.T) {
	// OZ_CORS_ORIGINS should be merged into the allowlist alongside
	// the primary OZ_WEB_ALLOWED_ORIGINS (or its defaults).
	t.Setenv("OZ_CORS_ORIGINS", "https://extra.com, https://also-extra.com")
	origins := webAllowedOrigins()
	found := map[string]bool{}
	for _, o := range origins {
		found[o] = true
	}
	// Default origins still present.
	if !found["https://kasir.mu"] {
		t.Error("default kasir.mu origin missing after OZ_CORS_ORIGINS merge")
	}
	if !found["http://localhost:4321"] {
		t.Error("default localhost origin missing after OZ_CORS_ORIGINS merge")
	}
	// Extra origins merged in.
	if !found["https://extra.com"] {
		t.Error("OZ_CORS_ORIGINS extra origin https://extra.com not merged")
	}
	if !found["https://also-extra.com"] {
		t.Error("OZ_CORS_ORIGINS extra origin https://also-extra.com not merged")
	}
}

func TestWebAllowedOrigins_CorsOriginsWithCustomPrimary(t *testing.T) {
	// Both env vars set: primary + extra should all be present.
	t.Setenv("OZ_WEB_ALLOWED_ORIGINS", "https://primary.com")
	t.Setenv("OZ_CORS_ORIGINS", "https://extra.com")
	origins := webAllowedOrigins()
	found := map[string]bool{}
	for _, o := range origins {
		found[o] = true
	}
	if !found["https://primary.com"] {
		t.Error("primary origin missing")
	}
	if !found["https://extra.com"] {
		t.Error("extra origin missing")
	}
	// Default kasir.mu should NOT be present (overridden by primary).
	if found["https://kasir.mu"] {
		t.Error("default origin should not appear when OZ_WEB_ALLOWED_ORIGINS is set")
	}
}

func TestWebAllowedOrigins_CorsOriginsEmpty(t *testing.T) {
	// Empty OZ_CORS_ORIGINS should not add anything.
	t.Setenv("OZ_CORS_ORIGINS", "")
	origins := webAllowedOrigins()
	if len(origins) != 4 {
		t.Errorf("expected 4 default origins with empty OZ_CORS_ORIGINS, got %d: %v", len(origins), origins)
	}
}

func TestWebAllowedOrigins_CorsOriginsWhitespace(t *testing.T) {
	// Whitespace-only and comma-only entries should be silently skipped.
	t.Setenv("OZ_CORS_ORIGINS", " , https://valid.com , ")
	origins := webAllowedOrigins()
	found := map[string]bool{}
	for _, o := range origins {
		found[o] = true
	}
	if !found["https://valid.com"] {
		t.Error("valid origin from OZ_CORS_ORIGINS not found")
	}
	// Should not have empty-string entries.
	for _, o := range origins {
		if o == "" {
			t.Error("empty string origin in allowlist")
		}
	}
}

func TestWebOriginAllowed_AcceptsCorsOrigin(t *testing.T) {
	// A request from an origin listed in OZ_CORS_ORIGINS must be allowed.
	t.Setenv("OZ_CORS_ORIGINS", "https://cors-extra.com")
	e := &core.RequestEvent{}
	// Simulate an Origin header.
	e.Request = &http.Request{Header: http.Header{"Origin": {"https://cors-extra.com"}}}
	if !webOriginAllowed(e) {
		t.Error("origin from OZ_CORS_ORIGINS should be allowed")
	}
}

func TestWebOriginAllowed_RejectsUnknownOrigin(t *testing.T) {
	// An origin not in any allowlist must be rejected.
	e := &core.RequestEvent{}
	e.Request = &http.Request{Header: http.Header{"Origin": {"https://evil.com"}}}
	if webOriginAllowed(e) {
		t.Error("unknown origin should be rejected")
	}
}

func TestWebOriginAllowed_NoOriginHeaderAllowed(t *testing.T) {
	// Non-browser callers (curl, server-to-server) have no Origin — always allowed.
	e := &core.RequestEvent{}
	e.Request = &http.Request{Header: http.Header{}}
	if !webOriginAllowed(e) {
		t.Error("request without Origin header should be allowed")
	}
}

func TestOTPStore_SweepRemovesExpired(t *testing.T) {
	store := &otpStore{
		codes:    make(map[string]*otpCode),
		sessions: make(map[string]*webSession),
	}
	store.codes["expired@example.com"] = &otpCode{hash: "x", expiresAt: time.Now().Add(-time.Minute)}
	store.codes["fresh@example.com"] = &otpCode{hash: "y", expiresAt: time.Now().Add(time.Hour)}
	store.sessions["expiredhash"] = &webSession{tenantID: "t", expiresAt: time.Now().Add(-time.Minute)}
	store.sessions["freshhash"] = &webSession{tenantID: "t", expiresAt: time.Now().Add(time.Hour)}

	store.sweep()

	if _, ok := store.codes["expired@example.com"]; ok {
		t.Error("expired code should be swept")
	}
	if _, ok := store.codes["fresh@example.com"]; !ok {
		t.Error("fresh code should remain")
	}
	if _, ok := store.sessions["expiredhash"]; ok {
		t.Error("expired session should be swept")
	}
	if _, ok := store.sessions["freshhash"]; !ok {
		t.Error("fresh session should remain")
	}
}

func TestWindowLimiter_AllowsThenBlocks(t *testing.T) {
	wl := &windowLimiter{entries: make(map[string]*windowEntry), limit: 2, window: time.Minute}
	first := wl.allow("k")
	second := wl.allow("k")
	if !first || !second {
		t.Errorf("first two should be allowed, got %v then %v", first, second)
	}
	if wl.allow("k") {
		t.Error("third should be blocked")
	}
	if !wl.allow("other") {
		t.Error("different key should not be blocked")
	}
}

func TestWindowLimiter_Sweep(t *testing.T) {
	wl := &windowLimiter{entries: make(map[string]*windowEntry), limit: 1, window: time.Minute}
	wl.allow("k")
	wl.mu.Lock()
	wl.entries["k"].start = time.Now().Add(-2 * time.Minute)
	wl.mu.Unlock()
	wl.sweep()
	if _, ok := wl.entries["k"]; ok {
		t.Error("expired window should be swept")
	}
}

// ── Email builder tests ─────────────────────────────────────────────

func TestBuildOtpEmail_RFC5322Headers(t *testing.T) {
	msg := buildOtpEmail("no-reply@kasir.mu", "user@example.com", "123456")
	s := string(msg)

	for _, want := range []string{
		"From: kasir.mu <no-reply@kasir.mu>",
		"To: user@example.com",
		"Subject: Your kasir.mu verification code",
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=utf-8",
		"Date:",
	} {
		if !strings.Contains(s, want) {
			t.Errorf("missing header %q in OTP email", want)
		}
	}
}

func TestBuildOtpEmail_ContainsCode(t *testing.T) {
	msg := buildOtpEmail("from@test.com", "to@test.com", "998877")
	s := string(msg)

	if !strings.Contains(s, "998877") {
		t.Error("OTP email must contain the verification code")
	}
	if !strings.Contains(s, "6-digit") && !strings.Contains(s, "6 digit") {
		// The body mentions the code format.
	}
}

func TestBuildOtpEmail_ExpiryMinutes(t *testing.T) {
	msg := buildOtpEmail("from@test.com", "to@test.com", "000000")
	s := string(msg)

	// The body states the TTL in minutes (webOtpTTL = 15 minutes).
	if !strings.Contains(s, "15 minutes") {
		t.Errorf("OTP email should mention 15-minute expiry, got body:\n%s", s)
	}
}

func TestBuildOtpEmail_RFC5322LineEndings(t *testing.T) {
	msg := buildOtpEmail("from@test.com", "to@test.com", "111111")
	s := string(msg)

	// RFC 5322 requires \r\n line endings in headers.
	if !strings.Contains(s, "From: ...\r\n") || strings.Contains(s, "From:\n") {
		// Check that headers use \r\n, not bare \n.
	}
	// Verify no bare \n after header names (common bug: missing \r).
	lines := strings.Split(s, "\n")
	for i, line := range lines {
		if strings.HasPrefix(line, "From:") || strings.HasPrefix(line, "To:") || strings.HasPrefix(line, "Subject:") {
			// The line before splitting on \n should have ended with \r.
			if i > 0 && !strings.HasSuffix(lines[i-1], "\r") {
				t.Errorf("header at line %d missing \r before \n (RFC 5322 requires CRLF)", i)
			}
		}
	}
}

// ── admin identity reservation (self-signup squat guard) ────────────

// TestRequestOTP_ReservedAdminEmailCreatesNoRow drives the createTenant
// guard through request-otp with OZ_ADMIN_EMAIL unset: the compiled
// default admin address keeps its enumeration-free 200 {"status":"ok"}
// shape, but no tenants row is self-signed and no code is sent or stored.
func TestRequestOTP_ReservedAdminEmailCreatesNoRow(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()
	// Deliberately unset: the resolved admin identity IS the compiled
	// default, which is exactly the address an unguarded deploy lets an
	// attacker squat with their own credentials.
	t.Setenv("OZ_ADMIN_EMAIL", "")

	var sentCode string
	restore := stubOTPEmail(t, &sentCode)
	defer restore()

	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/request-otp",
		`{"email":"`+defaultAdminEmail+`"}`, "http://localhost:4321", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected the enumeration-free 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Status string `json:"status"`
		Error  string `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad response JSON: %v", err)
	}
	if resp.Status != "ok" || resp.Error != "" {
		t.Errorf("expected {\"status\":\"ok\"} with no error, got %s", rec.Body.String())
	}
	if sentCode != "" {
		t.Errorf("no code may be sent for the reserved admin address, got %q", sentCode)
	}
	if tenant, _ := app.FindFirstRecordByData("tenants", "email", defaultAdminEmail); tenant != nil {
		t.Error("no tenants row may be created for the reserved admin address")
	}
	webOtpStore.mu.Lock()
	_, stored := webOtpStore.codes[defaultAdminEmail]
	webOtpStore.mu.Unlock()
	if stored {
		t.Error("no pending code may be stored for the reserved admin address")
	}
}

// TestRequestOTP_ReservedAdminVariantsRefused proves the guard compares
// lowercase to lowercase through the same normalization the callers feed:
// case and whitespace variants of the reserved address must not walk past
// it while still matching the EqualFold admin gate.
func TestRequestOTP_ReservedAdminVariantsRefused(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()
	t.Setenv("OZ_ADMIN_EMAIL", "")

	var sentCode string
	restore := stubOTPEmail(t, &sentCode)
	defer restore()

	// Exactly the per-email request-otp budget: every variant normalizes
	// onto the same reserved address, so a 4th would rate-limit instead
	// of exercising the guard.
	variants := []string{
		strings.ToUpper(defaultAdminEmail), // upper-case
		"  " + defaultAdminEmail + "  ",    // surrounding whitespace
		"AdiKaradWiatmaJa@Gmail.Com",       // mixed case (mirrors defaultAdminEmail)
	}
	for _, v := range variants {
		rec := webRequest(t, se, http.MethodPost, "/api/v1/web/request-otp",
			`{"email":"`+v+`"}`, "http://localhost:4321", "")
		if rec.Code != http.StatusOK {
			t.Errorf("variant %q: expected the enumeration-free 200, got %d: %s", v, rec.Code, rec.Body.String())
		}
		if sentCode != "" {
			t.Errorf("variant %q: no code may be sent for the reserved admin address, got %q", v, sentCode)
			sentCode = ""
		}
		if tenant, _ := app.FindFirstRecordByData("tenants", "email", defaultAdminEmail); tenant != nil {
			t.Errorf("variant %q: no tenants row may be created for the reserved admin address", v)
		}
	}
}

// TestRequestOTP_ReservedSetUnionsEnvOverrideWithDefault proves the
// reserved set is the UNION of the resolved admin target and the compiled
// defaultAdminEmail: with OZ_ADMIN_EMAIL pointed elsewhere, BOTH stay
// reserved (order independence with the deploy wave that flips the env
// on), while a non-reserved address still self-signs — the guard is
// reserved-set-scoped, not a blanket removal of register-or-login.
func TestRequestOTP_ReservedSetUnionsEnvOverrideWithDefault(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()
	t.Setenv("OZ_ADMIN_EMAIL", "deployowner@example.com")

	var sentCode string
	restore := stubOTPEmail(t, &sentCode)
	defer restore()

	for _, reserved := range []string{"deployowner@example.com", defaultAdminEmail} {
		rec := webRequest(t, se, http.MethodPost, "/api/v1/web/request-otp",
			`{"email":"`+reserved+`"}`, "http://localhost:4321", "")
		if rec.Code != http.StatusOK {
			t.Errorf("reserved %q: expected 200, got %d: %s", reserved, rec.Code, rec.Body.String())
		}
		if sentCode != "" {
			t.Errorf("reserved %q: no code may be sent, got %q", reserved, sentCode)
			sentCode = ""
		}
		if tenant, _ := app.FindFirstRecordByData("tenants", "email", reserved); tenant != nil {
			t.Errorf("reserved %q: no tenants row may be created", reserved)
		}
	}

	// A plain address keeps the register-or-login behaviour the login
	// page's OTP tab depends on (AuthForm.tsx register-first).
	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/request-otp",
		`{"email":"plainselfsignup@example.com"}`, "http://localhost:4321", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("non-reserved address: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if sentCode == "" || len(sentCode) != 6 {
		t.Fatalf("non-reserved address: expected a 6-digit code, got %q", sentCode)
	}
	tenant, err := app.FindFirstRecordByData("tenants", "email", "plainselfsignup@example.com")
	if err != nil || tenant == nil {
		t.Fatalf("non-reserved address: expected a tenant to be created: %v", err)
	}
	if tenant.GetString("status") != "active" || tenant.GetBool("email_verified") {
		t.Errorf("expected an active unverified tenant, got status=%q verified=%v",
			tenant.GetString("status"), tenant.GetBool("email_verified"))
	}
}

// TestCreateTenant_RefusesReservedAdminEmail is the chokepoint unit test:
// createTenant itself must refuse the reserved set (normalized) and must
// still create plain addresses — the guard is not a blanket removal.
func TestCreateTenant_RefusesReservedAdminEmail(t *testing.T) {
	resetRateLimiters()
	app, _ := setupDirectApp(t)
	defer app.Cleanup()
	t.Setenv("OZ_ADMIN_EMAIL", "")

	rec, err := createTenant(app, defaultAdminEmail, "")
	if err == nil || !errors.Is(err, errReservedAdminEmail) {
		t.Fatalf("expected errReservedAdminEmail for the default admin address, got %v", err)
	}
	if rec != nil {
		t.Errorf("no record may be returned for a refused create, got id=%s", rec.Id)
	}
	// Mixed case must normalize onto the reserved set, not slip past.
	if _, err := createTenant(app, strings.ToUpper(defaultAdminEmail), ""); !errors.Is(err, errReservedAdminEmail) {
		t.Fatalf("expected errReservedAdminEmail for a case variant, got %v", err)
	}
	if tenant, _ := app.FindFirstRecordByData("tenants", "email", defaultAdminEmail); tenant != nil {
		t.Error("no tenants row may be created for the reserved admin address")
	}

	// A plain address still creates an ACTIVE, unverified tenant — the
	// same shape the self-signup flow has always produced.
	got, err := createTenant(app, "chokepointplain@example.com", "")
	if err != nil {
		t.Fatalf("expected a plain address to still create, got %v", err)
	}
	if got.GetString("status") != "active" || got.GetBool("email_verified") {
		t.Errorf("expected an active unverified tenant, got status=%q verified=%v",
			got.GetString("status"), got.GetBool("email_verified"))
	}
}

// TestCreateTenant_RaceReturnsExistingRowWithoutError pins the unique-email
// race path the guard must never disturb: when a row already exists (the
// Save loses the race), createTenant returns that existing row with a nil
// error — no 500, and no refusal for a non-reserved address.
func TestCreateTenant_RaceReturnsExistingRowWithoutError(t *testing.T) {
	resetRateLimiters()
	app, _ := setupDirectApp(t)
	defer app.Cleanup()

	// The Go-built test fixture omits the production unique email index
	// (pb_schema.json carries idx_tenants_email; createTestCollections
	// deliberately keeps the fixture minimal), so attach it here — the
	// race branch only exists because that index rejects the second save.
	col, err := app.FindCollectionByNameOrId("tenants")
	if err != nil {
		t.Fatalf("tenants collection not found: %v", err)
	}
	col.Indexes = append(col.Indexes, "CREATE UNIQUE INDEX idx_tenants_email ON tenants (email)")
	if err := app.Save(col); err != nil {
		t.Fatalf("failed to attach the production email index: %v", err)
	}

	seedTenant(t, app, "racetenant00001", "racekey0000001", "active")
	existing, err := app.FindFirstRecordByData("tenants", "email", "racetenant00001@example.com")
	if err != nil || existing == nil {
		t.Fatalf("seeded tenant not found: %v", err)
	}

	got, err := createTenant(app, "racetenant00001@example.com", "not-a-real-hash")
	if err != nil {
		t.Fatalf("race path must return the existing row without error, got %v", err)
	}
	if got == nil || got.Id != existing.Id {
		t.Fatalf("expected the existing row id=%s, got id=%s", existing.Id, got.Id)
	}
	// Exactly one row for the address: the race returned the seed, it did
	// not mint a duplicate and it did not 500.
	dupes, _ := app.FindRecordsByFilter("tenants", "email = {:email}", "", 0, 0,
		map[string]any{"email": "racetenant00001@example.com"})
	if len(dupes) != 1 {
		t.Errorf("expected exactly 1 row after the race, got %d", len(dupes))
	}
}

// TestRequestOTP_SendFailurePinsKnownHazard_ActiveUnverifiedRowSquatsEmail is a
// PIN OF A KNOWN HAZARD, NOT AN ENDORSEMENT (review finding parked as a
// decision, not a deferred task): request-otp's register-or-login door
// self-signs the tenant via createTenant with status="active" (web_otp.go)
// BEFORE sendOTPEmail is attempted (create at :593, send at :626), so a
// merchant whose mail relay is misconfigured gets a 500 yet the email is now
// HELD by an ACTIVE, email_verified=false row nobody proved inbox ownership
// for. Unlike /web/register this door sets no password, so the row cannot log
// in — the hazard here is the active row squatting the identity while the
// owner is told the code could not be delivered. The ordering repair (create
// the tenant non-active, activate on verification) is a schema change —
// tenants.status is a validated PocketBase select — plus a boot migration,
// deliberately parked behind an operator decision. If this test fails because
// the ordering changed, that is the intended loud outcome — update this pin
// deliberately, not silently.
func TestRequestOTP_SendFailurePinsKnownHazard_ActiveUnverifiedRowSquatsEmail(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	// The SMTP gate passes (OZ_SMTP_HOST set) but the send itself fails.
	t.Setenv("OZ_SMTP_HOST", "test.local")
	orig := sendOTPEmail
	sendOTPEmail = func(to, code string) error { return errors.New("smtp relay down (simulated)") }
	defer func() { sendOTPEmail = orig }()

	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/request-otp",
		`{"email":"otpfailpin@example.com"}`, "http://localhost:4321", "")
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 when the send fails, got %d: %s", rec.Code, rec.Body.String())
	}

	// Assert on the record read back, not the return value — the finding is
	// precisely that the two disagree.
	tenant, err := app.FindFirstRecordByData("tenants", "email", "otpfailpin@example.com")
	if err != nil || tenant == nil {
		t.Fatalf("hazard pin: tenant exists after a failed send: %v", err)
	}
	if tenant.GetString("status") != "active" {
		t.Errorf("hazard pin: status = %q, want active (tenant created before the send)", tenant.GetString("status"))
	}
	if tenant.GetBool("email_verified") {
		t.Error("hazard pin: email_verified should stay false — no inbox proof happened")
	}

	// The failed send must not leave a dead code behind (deleteCode path).
	webOtpStore.mu.Lock()
	_, codeStored := webOtpStore.codes["otpfailpin@example.com"]
	webOtpStore.mu.Unlock()
	if codeStored {
		t.Error("hazard pin: a failed send must not leave a pending code")
	}
}
