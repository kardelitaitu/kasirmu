package main

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"golang.org/x/crypto/bcrypt"
)

// ── Test helpers ────────────────────────────────────────────────────

// seedTenantWithPassword seeds an active tenant AND sets its web password
// hash, mirroring the state after an account holder used set-password.
func seedTenantWithPassword(t *testing.T, app *tests.TestApp, tenantID, apiKey, password string) {
	t.Helper()
	seedTenant(t, app, tenantID, apiKey, "active")
	tenant, err := app.FindFirstRecordByData("tenants", "email", strings.ToLower(tenantID+"@example.com"))
	if err != nil || tenant == nil {
		t.Fatalf("seeded tenant not found: %v", err)
	}
	hash, err := hashPassword(password)
	if err != nil {
		t.Fatalf("hashPassword failed: %v", err)
	}
	tenant.Set("password_hash", hash)
	if err := app.Save(tenant); err != nil {
		t.Fatalf("failed to set password_hash: %v", err)
	}
}

// ── POST /api/v1/web/login ──────────────────────────────────────────

func TestLoginPassword_HappyPathIssuesSession(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTenantWithPassword(t, app, "pwlogin00000001", "pwloginapikey01", "correct-horse-1")

	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/login",
		`{"email":"pwlogin00000001@example.com","password":"correct-horse-1"}`,
		"http://localhost:4321", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		Token   string         `json:"token"`
		Expires string         `json:"expires_at"`
		Tenant  map[string]any `json:"tenant"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad response JSON: %v", err)
	}
	if resp.Token == "" {
		t.Error("expected a session token")
	}
	if resp.Expires == "" {
		t.Error("expected expires_at")
	}
	if resp.Tenant["email"] != "pwlogin00000001@example.com" {
		t.Errorf("unexpected tenant email: %v", resp.Tenant["email"])
	}

	// The issued token must work on /me exactly like an OTP session.
	me := webRequest(t, se, http.MethodGet, "/api/v1/web/me", "",
		"http://localhost:4321", "Bearer "+resp.Token)
	if me.Code != http.StatusOK {
		t.Fatalf("expected /me 200 with the login token, got %d: %s", me.Code, me.Body.String())
	}
}

// TestLoginPassword_Generic401ForEveryFailure pins the no-enumeration
// contract: unknown email, no password set, wrong password, and
// non-active tenant all return the identical 401 body — the endpoint can
// never be used to probe account state.
func TestLoginPassword_Generic401ForEveryFailure(t *testing.T) {
	t.Setenv("LOGIN_LOCKOUT_DISABLED", "1")
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	// Active tenant WITH a password.
	seedTenantWithPassword(t, app, "pwloginactive01", "pwloginactive01", "right-password-1")
	// Active tenant WITHOUT a password (OTP-only account).
	seedTenant(t, app, "pwloginotponly1", "pwloginotponly1", "active")
	// Suspended tenant WITH a password.
	seedTenant(t, app, "pwloginsusp0001", "pwloginsusp0001", "suspended")
	susp, err := app.FindFirstRecordByData("tenants", "email", "pwloginsusp0001@example.com")
	if err != nil || susp == nil {
		t.Fatalf("suspended tenant not found: %v", err)
	}
	hash, _ := hashPassword("right-password-1")
	susp.Set("password_hash", hash)
	if err := app.Save(susp); err != nil {
		t.Fatalf("failed to set suspended tenant password: %v", err)
	}

	cases := []struct {
		name string
		body string
	}{
		{"wrong password", `{"email":"pwloginactive01@example.com","password":"wrong-password"}`},
		{"unknown email", `{"email":"nobody@example.com","password":"right-password-1"}`},
		{"otp-only account (no password set)", `{"email":"pwloginotponly1@example.com","password":"right-password-1"}`},
		{"suspended tenant", `{"email":"pwloginsusp0001@example.com","password":"right-password-1"}`},
		{"empty password", `{"email":"pwloginactive01@example.com","password":""}`},
	}
	for _, tc := range cases {
		rec := webRequest(t, se, http.MethodPost, "/api/v1/web/login",
			tc.body, "http://localhost:4321", "")
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s: expected 401, got %d: %s", tc.name, rec.Code, rec.Body.String())
			continue
		}
		if !strings.Contains(rec.Body.String(), "invalid email or password") {
			t.Errorf("%s: expected generic 'invalid email or password', got %s", tc.name, rec.Body.String())
		}
	}
}

func TestLoginPassword_RateLimitedPerEmail(t *testing.T) {
	t.Setenv("LOGIN_LOCKOUT_DISABLED", "1")
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	// 5 attempts allowed per email per 15 min (wrong password → 401, but
	// the limiter counts every attempt).
	for i := 0; i < 5; i++ {
		rec := webRequest(t, se, http.MethodPost, "/api/v1/web/login",
			`{"email":"pwspam000000001@example.com","password":"wrong-password"}`,
			"http://localhost:4321", "")
		if rec.Code == http.StatusTooManyRequests {
			t.Fatalf("call %d should not be rate limited yet", i+1)
		}
	}
	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/login",
		`{"email":"pwspam000000001@example.com","password":"wrong-password"}`,
		"http://localhost:4321", "")
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("6th attempt should be 429, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestLoginPassword_CORSRejectsForeignOrigin(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/login",
		`{"email":"pwlogincors0001@example.com","password":"whatever-123"}`,
		"https://evil.example.com", "")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for disallowed origin, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestLoginPassword_InvalidBodyAndEmail(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	for _, body := range []string{
		`not json`,
		`{}`,
		`{"email":"not-an-email","password":"whatever-123"}`,
	} {
		rec := webRequest(t, se, http.MethodPost, "/api/v1/web/login",
			body, "http://localhost:4321", "")
		if rec.Code != http.StatusBadRequest {
			t.Errorf("body %q: expected 400, got %d: %s", body, rec.Code, rec.Body.String())
		}
	}
}

// ── POST /api/v1/web/set-password ───────────────────────────────────

func TestSetPassword_RequiresSession(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	for _, auth := range []string{"", "Bearer ", "Bearer notarealtoken"} {
		rec := webRequest(t, se, http.MethodPost, "/api/v1/web/set-password",
			`{"password":"brand-new-password"}`, "http://localhost:4321", auth)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 for auth %q, got %d: %s", auth, rec.Code, rec.Body.String())
		}
	}
}

func TestSetPassword_WeakPasswordRejected(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTenant(t, app, "pwsetweak000001", "pwsetweak000001", "active")
	token := "pwset-weak-token-01"
	webOtpStore.createSession(hashWebToken(token), "pwsetweak000001")

	for _, pw := range []string{
		"",                       // empty
		"short",                  // < 8 chars
		"  padded-password-123 ", // edge whitespace
		strings.Repeat("x", 73),  // > 72 bytes (bcrypt truncation)
	} {
		body := `{"password":"` + pw + `"}`
		rec := webRequest(t, se, http.MethodPost, "/api/v1/web/set-password",
			body, "http://localhost:4321", "Bearer "+token)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("password %q: expected 400, got %d: %s", pw, rec.Code, rec.Body.String())
		}
	}
}

// TestSetPassword_SetsAndRotates drives the full lifecycle: an OTP-only
// account sets its first password, logs in with it, rotates it, and the
// old password stops working while the new one authenticates.
func TestSetPassword_SetsAndRotates(t *testing.T) {
	t.Setenv("LOGIN_LOCKOUT_DISABLED", "1")
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTenant(t, app, "pwsetlife000001", "pwsetlife000001", "active")
	token := "pwset-life-token-01"
	webOtpStore.createSession(hashWebToken(token), "pwsetlife000001")

	// First-time set.
	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/set-password",
		`{"password":"first-password-123"}`, "http://localhost:4321", "Bearer "+token)
	if rec.Code != http.StatusOK {
		t.Fatalf("set-password expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// At-rest form must be a bcrypt hash, never the plaintext.
	tenant, err := app.FindFirstRecordByData("tenants", "email", "pwsetlife000001@example.com")
	if err != nil || tenant == nil {
		t.Fatalf("tenant not found: %v", err)
	}
	stored := tenant.GetString("password_hash")
	if stored == "" {
		t.Fatal("expected password_hash to be persisted")
	}
	if stored == "first-password-123" {
		t.Fatal("password must never be stored in plaintext")
	}
	if bcrypt.CompareHashAndPassword([]byte(stored), []byte("first-password-123")) != nil {
		t.Error("stored hash must verify against the first password")
	}

	// Login with the first password works.
	rec = webRequest(t, se, http.MethodPost, "/api/v1/web/login",
		`{"email":"pwsetlife000001@example.com","password":"first-password-123"}`,
		"http://localhost:4321", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("login with the first password should succeed, got %d: %s", rec.Code, rec.Body.String())
	}

	// Rotate.
	rec = webRequest(t, se, http.MethodPost, "/api/v1/web/set-password",
		`{"password":"second-password-456"}`, "http://localhost:4321", "Bearer "+token)
	if rec.Code != http.StatusOK {
		t.Fatalf("rotate expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// Old password now fails, new one succeeds.
	rec = webRequest(t, se, http.MethodPost, "/api/v1/web/login",
		`{"email":"pwsetlife000001@example.com","password":"first-password-123"}`,
		"http://localhost:4321", "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("old password should 401 after rotation, got %d: %s", rec.Code, rec.Body.String())
	}
	rec = webRequest(t, se, http.MethodPost, "/api/v1/web/login",
		`{"email":"pwsetlife000001@example.com","password":"second-password-456"}`,
		"http://localhost:4321", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("new password should succeed after rotation, got %d: %s", rec.Code, rec.Body.String())
	}
}

// ── POST /api/v1/web/register ───────────────────────────────────────

// TestRegister_CreatesTenantAndSendsCode covers the signup-page path:
// email+password creates an ACTIVE tenant (email_verified=false) with a
// bcrypt password_hash and emails a confirmation code.
func TestRegister_CreatesTenantAndSendsCode(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	var sentCode string
	restore := stubOTPEmail(t, &sentCode)
	defer restore()

	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/register",
		`{"email":"newregister@example.com","password":"RegisterPw!1"}`,
		"http://localhost:4321", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if sentCode == "" || len(sentCode) != 6 {
		t.Fatalf("expected a 6-digit confirmation code, got %q", sentCode)
	}

	tenant, err := app.FindFirstRecordByData("tenants", "email", "newregister@example.com")
	if err != nil || tenant == nil {
		t.Fatalf("tenant should exist after register: %v", err)
	}
	if tenant.GetString("status") != "active" {
		t.Errorf("expected status active, got %q", tenant.GetString("status"))
	}
	if tenant.GetBool("email_verified") {
		t.Error("expected email_verified=false until the confirmation code is verified")
	}
	// The password must be stored as a bcrypt hash, never plaintext, and
	// must authenticate the submitted value.
	stored := tenant.GetString("password_hash")
	if stored == "RegisterPw!1" {
		t.Fatal("password must never be stored in plaintext")
	}
	if bcrypt.CompareHashAndPassword([]byte(stored), []byte("RegisterPw!1")) != nil {
		t.Error("stored hash must verify against the submitted password")
	}

	// The confirmation code is stored (hashed) for verify-otp.
	webOtpStore.mu.Lock()
	_, ok := webOtpStore.codes["newregister@example.com"]
	webOtpStore.mu.Unlock()
	if !ok {
		t.Error("expected a pending confirmation code to be stored")
	}
}

// TestRegister_ThenVerifyCompletesSignup drives the full signup flow:
// register → emailed code → verify-otp issues a session and flips
// email_verified, and the submitted password then works at login.
func TestRegister_ThenVerifyCompletesSignup(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	var sentCode string
	restore := stubOTPEmail(t, &sentCode)
	defer restore()

	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/register",
		`{"email":"fullsignup@example.com","password":"SignupFlow!2"}`,
		"http://localhost:4321", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("register expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if sentCode == "" {
		t.Fatal("no confirmation code captured")
	}

	// Complete signup via the shared verify-otp endpoint.
	rec = webRequest(t, se, http.MethodPost, "/api/v1/web/verify-otp",
		`{"email":"fullsignup@example.com","code":"`+sentCode+`"}`, "http://localhost:4321", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("verify-otp expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	tenant, err := app.FindFirstRecordByData("tenants", "email", "fullsignup@example.com")
	if err != nil || tenant == nil {
		t.Fatalf("tenant should exist: %v", err)
	}
	if !tenant.GetBool("email_verified") {
		t.Error("expected email_verified=true after the confirmation code")
	}

	// The registered password works at login.
	rec = webRequest(t, se, http.MethodPost, "/api/v1/web/login",
		`{"email":"fullsignup@example.com","password":"SignupFlow!2"}`,
		"http://localhost:4321", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("login with the registered password should succeed, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestRegister_RejectsExistingAccount(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTenant(t, app, "existingacct001", "existingacct001", "active")

	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/register",
		`{"email":"existingacct001@example.com","password":"RegisterPw!1"}`,
		"http://localhost:4321", "")
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409 for an existing account, got %d: %s", rec.Code, rec.Body.String())
	}
	// The existing tenant's password must NOT have been overwritten.
	tenant, err := app.FindFirstRecordByData("tenants", "email", "existingacct001@example.com")
	if err != nil || tenant == nil {
		t.Fatalf("tenant should still exist: %v", err)
	}
	if tenant.GetString("password_hash") != "" {
		t.Error("409 must not set a password on the existing tenant")
	}
}

func TestRegister_WeakPasswordAndBadEmail(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	for _, body := range []string{
		`{"email":"weakpass@example.com","password":"password123"}`, // 2 classes
		`{"email":"weakpass@example.com","password":"short"}`,
		`{"email":"weakpass@example.com","password":""}`,
		`{"email":"not-an-email","password":"RegisterPw!1"}`,
		`{"email":"","password":"RegisterPw!1"}`,
		`not json`,
	} {
		rec := webRequest(t, se, http.MethodPost, "/api/v1/web/register",
			body, "http://localhost:4321", "")
		if rec.Code != http.StatusBadRequest {
			t.Errorf("body %q: expected 400, got %d: %s", body, rec.Code, rec.Body.String())
		}
	}
}

func TestRegister_RateLimited(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	// 3 attempts allowed per email per 15 min (first creates the tenant,
	// the next two 409 — the limiter counts every attempt).
	for i := 0; i < 3; i++ {
		rec := webRequest(t, se, http.MethodPost, "/api/v1/web/register",
			`{"email":"regspam0000001@example.com","password":"RegisterPw!1"}`,
			"http://localhost:4321", "")
		if rec.Code == http.StatusTooManyRequests {
			t.Fatalf("call %d should not be rate limited yet", i+1)
		}
	}
	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/register",
		`{"email":"regspam0000001@example.com","password":"RegisterPw!1"}`,
		"http://localhost:4321", "")
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("4th attempt should be 429, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestRegister_MissingSMTPReturns503(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	t.Setenv("OZ_SMTP_HOST", "")
	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/register",
		`{"email":"nosmtpreg@example.com","password":"RegisterPw!1"}`,
		"http://localhost:4321", "")
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 when SMTP unconfigured, got %d: %s", rec.Code, rec.Body.String())
	}
}

// ── POST /api/v1/web/request-password-reset ─────────────────────────

func TestRequestPasswordReset_SendsCode(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTenantWithPassword(t, app, "resetreq0000001", "resetreq0000001", "ResetPw!123")

	var sentCode string
	restore := stubOTPEmail(t, &sentCode)
	defer restore()

	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/request-password-reset",
		`{"email":"resetreq0000001@example.com"}`, "http://localhost:4321", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if sentCode == "" || len(sentCode) != 6 {
		t.Fatalf("expected a 6-digit reset code, got %q", sentCode)
	}
}

func TestRequestPasswordReset_UnknownEmailNoCode(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	var sentCode string
	restore := stubOTPEmail(t, &sentCode)
	defer restore()

	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/request-password-reset",
		`{"email":"nobody@example.com"}`, "http://localhost:4321", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 (no enumeration), got %d: %s", rec.Code, rec.Body.String())
	}
	if sentCode != "" {
		t.Error("no code should be emailed for an unknown email")
	}
}

// TestRequestPasswordReset_CooldownSurfaces pins the 7-day rule: within
// the cooldown the code is NOT sent and the response carries
// cooldown_until so the UI can show when a new reset is allowed.
func TestRequestPasswordReset_CooldownSurfaces(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTenantWithPassword(t, app, "resetcooldown01", "resetcooldown01", "ResetPw!123")
	tenant, err := app.FindFirstRecordByData("tenants", "email", "resetcooldown01@example.com")
	if err != nil || tenant == nil {
		t.Fatalf("tenant not found: %v", err)
	}
	tenant.Set("password_reset_at", time.Now().UTC().Format(time.RFC3339))
	if err := app.Save(tenant); err != nil {
		t.Fatalf("failed to set password_reset_at: %v", err)
	}

	var sentCode string
	restore := stubOTPEmail(t, &sentCode)
	defer restore()

	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/request-password-reset",
		`{"email":"resetcooldown01@example.com"}`, "http://localhost:4321", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if sentCode != "" {
		t.Error("no code should be sent during the 7-day cooldown")
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	until, ok := resp["cooldown_until"].(string)
	if !ok || until == "" {
		t.Error("expected cooldown_until in the response during the cooldown")
	}
}

func TestRequestPasswordReset_RateLimited(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	// 3 allowed per email per 15 min.
	for i := 0; i < 3; i++ {
		rec := webRequest(t, se, http.MethodPost, "/api/v1/web/request-password-reset",
			`{"email":"resetspam000001@example.com"}`, "http://localhost:4321", "")
		if rec.Code == http.StatusTooManyRequests {
			t.Fatalf("call %d should not be rate limited yet", i+1)
		}
	}
	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/request-password-reset",
		`{"email":"resetspam000001@example.com"}`, "http://localhost:4321", "")
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("4th request should be 429, got %d: %s", rec.Code, rec.Body.String())
	}
}

// ── POST /api/v1/web/reset-password ────────────────────────────────

// TestResetPassword_HappyPath drives forgot-password end to end: request a
// code, reset with a new valid password → session issued, old password
// dead, new one works, email marked verified, and the cooldown is stamped.
func TestResetPassword_HappyPath(t *testing.T) {
	t.Setenv("LOGIN_LOCKOUT_DISABLED", "1")
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTenantWithPassword(t, app, "resetfull000001", "resetfull000001", "OldPassw0rd!")

	var sentCode string
	restore := stubOTPEmail(t, &sentCode)
	defer restore()

	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/request-password-reset",
		`{"email":"resetfull000001@example.com"}`, "http://localhost:4321", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("request-password-reset expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if sentCode == "" {
		t.Fatal("no reset code captured")
	}

	rec = webRequest(t, se, http.MethodPost, "/api/v1/web/reset-password",
		`{"email":"resetfull000001@example.com","code":"`+sentCode+`","password":"NewPassw0rd!2"}`,
		"http://localhost:4321", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("reset-password expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// Session issued so the user lands signed in.
	var resp struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil || resp.Token == "" {
		t.Fatalf("expected a session token in the reset response: %v", err)
	}

	tenant, err := app.FindFirstRecordByData("tenants", "email", "resetfull000001@example.com")
	if err != nil || tenant == nil {
		t.Fatalf("tenant not found: %v", err)
	}
	if !tenant.GetBool("email_verified") {
		t.Error("reset proves inbox ownership — email_verified must be true")
	}
	if tenant.GetDateTime("password_reset_at").Time().IsZero() {
		t.Error("password_reset_at must be stamped to start the 7-day cooldown")
	}

	// Old password dead, new password works.
	rec = webRequest(t, se, http.MethodPost, "/api/v1/web/login",
		`{"email":"resetfull000001@example.com","password":"OldPassw0rd!"}`,
		"http://localhost:4321", "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("old password should 401 after reset, got %d", rec.Code)
	}
	rec = webRequest(t, se, http.MethodPost, "/api/v1/web/login",
		`{"email":"resetfull000001@example.com","password":"NewPassw0rd!2"}`,
		"http://localhost:4321", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("new password should log in after reset, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestResetPassword_CooldownBlocksSecondReset verifies the defense-in-depth
// check in reset-password: even if a code exists, a tenant whose last
// reset was <7 days ago gets 429 with retry info.
func TestResetPassword_CooldownBlocksSecondReset(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTenantWithPassword(t, app, "resetblock00001", "resetblock00001", "CurrentPw!123")
	tenant, err := app.FindFirstRecordByData("tenants", "email", "resetblock00001@example.com")
	if err != nil || tenant == nil {
		t.Fatalf("tenant not found: %v", err)
	}
	tenant.Set("password_reset_at", time.Now().UTC().Format(time.RFC3339))
	if err := app.Save(tenant); err != nil {
		t.Fatalf("failed to set password_reset_at: %v", err)
	}
	// Plant a code directly (request-password-reset would refuse to send
	// one during the cooldown — this simulates a race or manual state).
	webOtpStore.storeCode("resetblock00001@example.com", hashOtpCode("123456"))

	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/reset-password",
		`{"email":"resetblock00001@example.com","code":"123456","password":"NewPassw0rd!2"}`,
		"http://localhost:4321", "")
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 during cooldown, got %d: %s", rec.Code, rec.Body.String())
	}
	// The password must be untouched.
	tenant, _ = app.FindFirstRecordByData("tenants", "email", "resetblock00001@example.com")
	if bcrypt.CompareHashAndPassword([]byte(tenant.GetString("password_hash")), []byte("CurrentPw!123")) != nil {
		t.Error("cooldown block must not change the password")
	}
}

// TestResetPassword_WrongCodeAndWeakPassword covers the failure modes:
// wrong code → generic 401; weak/same password → 400 WITHOUT consuming
// the code (a corrected retry with the same code succeeds).
func TestResetPassword_WrongCodeAndWeakPassword(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTenantWithPassword(t, app, "resetfail000001", "resetfail000001", "CurrentPw!123")

	var sentCode string
	restore := stubOTPEmail(t, &sentCode)
	defer restore()

	webRequest(t, se, http.MethodPost, "/api/v1/web/request-password-reset",
		`{"email":"resetfail000001@example.com"}`, "http://localhost:4321", "")
	if sentCode == "" {
		t.Fatal("no reset code captured")
	}

	// Weak password (2 classes) → 400, and the code is NOT consumed
	// (the policy check runs before the single-use code is taken).
	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/reset-password",
		`{"email":"resetfail000001@example.com","code":"`+sentCode+`","password":"password123"}`,
		"http://localhost:4321", "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("weak password should 400, got %d: %s", rec.Code, rec.Body.String())
	}

	// Same as current password → 400 (must differ).
	rec = webRequest(t, se, http.MethodPost, "/api/v1/web/reset-password",
		`{"email":"resetfail000001@example.com","code":"`+sentCode+`","password":"CurrentPw!123"}`,
		"http://localhost:4321", "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("same password should 400 (must differ), got %d: %s", rec.Code, rec.Body.String())
	}

	// Same code + a valid different password now succeeds — proving the
	// policy failures did not burn the single-use code.
	rec = webRequest(t, se, http.MethodPost, "/api/v1/web/reset-password",
		`{"email":"resetfail000001@example.com","code":"`+sentCode+`","password":"NewPassw0rd!2"}`,
		"http://localhost:4321", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("corrected retry with the same code should succeed, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestResetPassword_WrongCode401 pins the generic 401 for a wrong code on
// a tenant NOT in cooldown: the single-use code is consumed by the attempt
// (takeCode deletes on any attempt) and the password stays untouched.
func TestResetPassword_WrongCode401(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTenantWithPassword(t, app, "resetwrong00001", "resetwrong00001", "CurrentPw!123")
	webOtpStore.storeCode("resetwrong00001@example.com", hashOtpCode("654321"))

	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/reset-password",
		`{"email":"resetwrong00001@example.com","code":"000000","password":"NewPassw0rd!2"}`,
		"http://localhost:4321", "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("wrong code should 401, got %d: %s", rec.Code, rec.Body.String())
	}
	tenant, _ := app.FindFirstRecordByData("tenants", "email", "resetwrong00001@example.com")
	if bcrypt.CompareHashAndPassword([]byte(tenant.GetString("password_hash")), []byte("CurrentPw!123")) != nil {
		t.Error("a wrong code must not change the password")
	}
}

// TestSetPassword_MustDiffer pins the change-while-signed-in rule: a new
// password equal to the current one is rejected with 400.
func TestSetPassword_MustDiffer(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTenantWithPassword(t, app, "setdiff00000001", "setdiff00000001", "CurrentPw!123")
	token := "set-diff-token-0001"
	webOtpStore.createSession(hashWebToken(token), "setdiff00000001")

	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/set-password",
		`{"password":"CurrentPw!123"}`, "http://localhost:4321", "Bearer "+token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for a password equal to the current one, got %d: %s", rec.Code, rec.Body.String())
	}

	// A genuinely different password still succeeds.
	rec = webRequest(t, se, http.MethodPost, "/api/v1/web/set-password",
		`{"password":"BrandNewPw!456"}`, "http://localhost:4321", "Bearer "+token)
	if rec.Code != http.StatusOK {
		t.Fatalf("different password should succeed, got %d: %s", rec.Code, rec.Body.String())
	}
}

// ── Helper unit tests ───────────────────────────────────────────────

func TestIsValidPassword(t *testing.T) {
	for _, tc := range []struct {
		in   string
		want bool
	}{
		// Valid: ≥8 chars and ≥3 of the 4 classes.
		{"Password1!", true},                   // lower+upper+digit+symbol
		{"passw0rd!", true},                    // lower+digit+symbol
		{"PASSWORD1!", true},                   // upper+digit+symbol
		{strings.Repeat("x", 69) + "A1", true}, // 72 bytes at the ceiling, 3 classes
		{"abcDEF123", true},                    // lower+upper+digit
		{"😀😀😀😀😀😀😀😀aA1", true},                  // 8 runes + 3 classes
		// Invalid: too short, too long, wrong class count, edge whitespace.
		{"", false},
		{"short", false},                 // < 8
		{strings.Repeat("x", 73), false}, // beyond bcrypt's 72-byte input
		{"password123", false},           // lower+digit only = 2 classes
		{"PASSWORD123", false},           // upper+digit only = 2 classes
		{"abcdefgh", false},              // lower only = 1 class
		{"!!!!!!!!", false},              // symbol only = 1 class
		{strings.Repeat("x", 72), false}, // 72 bytes but lower only
		{"  password123!", false},        // leading whitespace
		{"password123!  ", false},        // trailing whitespace
		{"😀😀😀😀😀😀😀😀", false},              // 8 runes but symbol-only = 1 class
	} {
		if got := isValidPassword(tc.in); got != tc.want {
			t.Errorf("isValidPassword(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}

func TestPasswordClassCount(t *testing.T) {
	for _, tc := range []struct {
		in   string
		want int
	}{
		{"", 0},
		{"abcdefgh", 1},   // lower
		{"ABCDEFGH", 1},   // upper
		{"12345678", 1},   // digit
		{"!!!!!!!!", 1},   // symbol
		{"abcABC", 2},     // lower+upper
		{"abcABC123", 3},  // lower+upper+digit
		{"abcABC123!", 4}, // all four
		{"😀😀😀😀😀😀😀😀", 1},   // symbols only
	} {
		if got := passwordClassCount(tc.in); got != tc.want {
			t.Errorf("passwordClassCount(%q) = %d, want %d", tc.in, got, tc.want)
		}
	}
}

// ── password_confirm (UI double-entry guard) ────────────────────────
//
// The UI sends password_confirm alongside password on every create/change
// flow (website/scripts/check-password-policy.mjs fails the build if a
// component stops sending it). The server rejects a supplied confirm that
// differs, and tolerates an absent confirm so hand-built calls and the
// OTP-only paths keep working.

func TestRegister_PasswordConfirmMismatch400(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	var sentCode string
	restore := stubOTPEmail(t, &sentCode)
	defer restore()

	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/register",
		`{"email":"confirmreg@example.com","password":"RegisterPw!1","password_confirm":"RegisterPw!2"}`,
		"http://localhost:4321", "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("mismatched confirm should 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "passwords do not match") {
		t.Errorf("expected 'passwords do not match', got %s", rec.Body.String())
	}
	if sentCode != "" {
		t.Error("no tenant should be created or emailed for a mismatched confirm")
	}

	// Matching confirm succeeds.
	rec = webRequest(t, se, http.MethodPost, "/api/v1/web/register",
		`{"email":"confirmreg@example.com","password":"RegisterPw!1","password_confirm":"RegisterPw!1"}`,
		"http://localhost:4321", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("matching confirm should 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// Absent confirm is tolerated (OTP-only / older clients).
	rec = webRequest(t, se, http.MethodPost, "/api/v1/web/register",
		`{"email":"confirmreg2@example.com","password":"RegisterPw!1"}`,
		"http://localhost:4321", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("absent confirm should 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSetPassword_PasswordConfirmMismatch400(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTenant(t, app, "confirmpws00001", "confirmpws00001", "active")
	token := "confirm-pw-set-token"
	webOtpStore.createSession(hashWebToken(token), "confirmpws00001")

	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/set-password",
		`{"password":"BrandNewPw!456","password_confirm":"BrandNewPw!789"}`,
		"http://localhost:4321", "Bearer "+token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("mismatched confirm should 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "passwords do not match") {
		t.Errorf("expected 'passwords do not match', got %s", rec.Body.String())
	}

	// The tenant's password must be untouched.
	tenant, err := app.FindFirstRecordByData("tenants", "email", "confirmpws00001@example.com")
	if err != nil || tenant == nil {
		t.Fatalf("tenant not found: %v", err)
	}
	if tenant.GetString("password_hash") != "" {
		t.Error("a mismatched confirm must not change the stored password")
	}

	// Matching confirm succeeds.
	rec = webRequest(t, se, http.MethodPost, "/api/v1/web/set-password",
		`{"password":"BrandNewPw!456","password_confirm":"BrandNewPw!456"}`,
		"http://localhost:4321", "Bearer "+token)
	if rec.Code != http.StatusOK {
		t.Fatalf("matching confirm should 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestResetPassword_PasswordConfirmMismatch400 pins that a mismatched
// confirm 400s WITHOUT consuming the single-use code (the confirm check
// runs before the code is taken), so a corrected retry succeeds.
func TestResetPassword_PasswordConfirmMismatch400(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTenantWithPassword(t, app, "confirmrst00001", "confirmrst00001", "CurrentPw!123")

	var sentCode string
	restore := stubOTPEmail(t, &sentCode)
	defer restore()

	webRequest(t, se, http.MethodPost, "/api/v1/web/request-password-reset",
		`{"email":"confirmrst00001@example.com"}`, "http://localhost:4321", "")
	if sentCode == "" {
		t.Fatal("no reset code captured")
	}

	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/reset-password",
		`{"email":"confirmrst00001@example.com","code":"`+sentCode+`","password":"NewPassw0rd!2","password_confirm":"NewPassw0rd!3"}`,
		"http://localhost:4321", "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("mismatched confirm should 400, got %d: %s", rec.Code, rec.Body.String())
	}

	// Same code + matching confirm now succeeds — the mismatch did not burn it.
	rec = webRequest(t, se, http.MethodPost, "/api/v1/web/reset-password",
		`{"email":"confirmrst00001@example.com","code":"`+sentCode+`","password":"NewPassw0rd!2","password_confirm":"NewPassw0rd!2"}`,
		"http://localhost:4321", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("corrected retry with the same code should succeed, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestPasswordPolicyMatchesSharedFixture pins the server policy against
// scripts/password-policy-cases.json — the SAME fixture the website's
// check-password-policy.mjs validates the client meter against (npm run
// precheck/prebuild). If either side changes its notion of a valid
// password, this test (or the node check) fails, so the two can never
// drift apart silently.
func TestPasswordPolicyMatchesSharedFixture(t *testing.T) {
	raw, err := os.ReadFile("../../scripts/password-policy-cases.json")
	if err != nil {
		t.Fatalf("cannot read shared password policy fixture: %v", err)
	}
	var fx struct {
		MinLength  int `json:"minLength"`
		MaxBytes   int `json:"maxBytes"`
		MinClasses int `json:"minClasses"`
		Cases      []struct {
			Password string `json:"password"`
			Classes  int    `json:"classes"`
			Valid    bool   `json:"valid"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatalf("cannot parse shared fixture: %v", err)
	}

	if fx.MinLength != webPasswordMinLen {
		t.Errorf("fixture minLength=%d, server webPasswordMinLen=%d", fx.MinLength, webPasswordMinLen)
	}
	if fx.MaxBytes != webPasswordMaxBytes {
		t.Errorf("fixture maxBytes=%d, server webPasswordMaxBytes=%d", fx.MaxBytes, webPasswordMaxBytes)
	}
	if fx.MinClasses != webPasswordMinClasses {
		t.Errorf("fixture minClasses=%d, server webPasswordMinClasses=%d", fx.MinClasses, webPasswordMinClasses)
	}
	if len(fx.Cases) == 0 {
		t.Fatal("fixture has no cases")
	}

	for _, c := range fx.Cases {
		if got := passwordClassCount(c.Password); got != c.Classes {
			t.Errorf("passwordClassCount(%q) = %d, fixture says %d", c.Password, got, c.Classes)
		}
		if got := isValidPassword(c.Password); got != c.Valid {
			t.Errorf("isValidPassword(%q) = %v, fixture says %v", c.Password, got, c.Valid)
		}
	}
}

// TestEnsurePasswordHashField_MigratesExistingCollection simulates a
// deployment that predates the field: the tenants collection exists
// WITHOUT password_hash, and the migration must add it (idempotently)
// as a hidden text field without touching other fields.
func TestEnsurePasswordHashField_MigratesExistingCollection(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("failed to create test app: %v", err)
	}
	defer app.Cleanup()

	tenants := core.NewBaseCollection("tenants")
	tenants.Fields.Add(
		&core.EmailField{Name: "email", Required: true},
		&core.SelectField{Name: "status", Required: true, Values: []string{"active", "suspended", "revoked"}},
	)
	if err := app.Save(tenants); err != nil {
		t.Fatalf("failed to create tenants collection: %v", err)
	}
	if tenants.Fields.GetByName("password_hash") != nil {
		t.Fatal("precondition failed: tenants should not have password_hash yet")
	}

	if err := ensurePasswordHashField(app); err != nil {
		t.Fatalf("ensurePasswordHashField failed: %v", err)
	}
	after, err := app.FindCollectionByNameOrId("tenants")
	if err != nil {
		t.Fatalf("find tenants after migration: %v", err)
	}
	field := after.Fields.GetByName("password_hash")
	if field == nil {
		t.Fatal("expected password_hash field to be added by the migration")
	}
	if field.Type() != core.FieldTypeText {
		t.Errorf("expected a text field, got %q", field.Type())
	}

	// Idempotent: a second run must be a no-op.
	if err := ensurePasswordHashField(app); err != nil {
		t.Fatalf("second ensurePasswordHashField should be a no-op: %v", err)
	}
}

// ── admin identity reservation (self-signup squat guard) ────────────

// TestRegister_ReservedAdminEmailRefused409 drives the createTenant guard
// through /web/register: the reserved admin address is refused with the
// EXISTING duplicate-email 409 (which already reveals existence for every
// address — nothing new leaks), no confirmation code is sent, and no row
// is created. Case and whitespace variants are refused the same way: the
// guard normalizes before comparing, so they cannot walk past it while
// still matching the EqualFold admin gate.
func TestRegister_ReservedAdminEmailRefused409(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()
	t.Setenv("OZ_ADMIN_EMAIL", "")

	var sentCode string
	restore := stubOTPEmail(t, &sentCode)
	defer restore()

	// Exactly the per-email register budget: every attempt normalizes
	// onto the same reserved address, so a 4th would rate-limit instead
	// of exercising the guard.
	attempts := []string{
		defaultAdminEmail,                  // exact
		strings.ToUpper(defaultAdminEmail), // upper-case
		"  " + defaultAdminEmail + "  ",    // surrounding whitespace
	}
	for _, a := range attempts {
		rec := webRequest(t, se, http.MethodPost, "/api/v1/web/register",
			`{"email":"`+a+`","password":"RegisterPw!1"}`,
			"http://localhost:4321", "")
		if rec.Code != http.StatusConflict {
			t.Errorf("attempt %q: expected the existing 409, got %d: %s", a, rec.Code, rec.Body.String())
			continue
		}
		var resp map[string]string
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("bad response JSON: %v", err)
		}
		if resp["error"] != "an account with this email already exists" {
			t.Errorf("attempt %q: expected the standard duplicate-email error, got %q", a, resp["error"])
		}
		if sentCode != "" {
			t.Errorf("attempt %q: no confirmation code may be sent for the reserved address, got %q", a, sentCode)
			sentCode = ""
		}
		if tenant, _ := app.FindFirstRecordByData("tenants", "email", defaultAdminEmail); tenant != nil {
			t.Errorf("attempt %q: no tenants row may be created for the reserved admin address", a)
		}
	}
}

// TestRegister_NonReservedAddressStillCreates pins the reserved-set scope
// of the guard at the register door: a plain address keeps creating an
// ACTIVE, unverified tenant with a confirmation code — the signup path
// the site depends on is untouched for every non-reserved address.
func TestRegister_NonReservedAddressStillCreates(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	var sentCode string
	restore := stubOTPEmail(t, &sentCode)
	defer restore()

	rec := webRequest(t, se, http.MethodPost, "/api/v1/web/register",
		`{"email":"guardscoped@example.com","password":"RegisterPw!1"}`,
		"http://localhost:4321", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if sentCode == "" || len(sentCode) != 6 {
		t.Fatalf("expected a 6-digit confirmation code, got %q", sentCode)
	}
	tenant, err := app.FindFirstRecordByData("tenants", "email", "guardscoped@example.com")
	if err != nil || tenant == nil {
		t.Fatalf("tenant should exist after register: %v", err)
	}
	if tenant.GetString("status") != "active" || tenant.GetBool("email_verified") {
		t.Errorf("expected an active unverified tenant, got status=%q verified=%v",
			tenant.GetString("status"), tenant.GetBool("email_verified"))
	}
}
