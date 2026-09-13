package main

// Password auth for the marketing site's account flow (website-plan.md
// §5/§11) — the complement to the OTP flow in web_otp.go. Five endpoints:
//
//	POST /api/v1/web/login                — {email, password} → session
//	POST /api/v1/web/set-password         — {password} (Bearer session)
//	POST /api/v1/web/register             — {email, password} → OTP email
//	POST /api/v1/web/request-password-reset — {email} → OTP email
//	POST /api/v1/web/reset-password       — {email, code, password} → session
//
// The password is OPTIONAL: tenants can stay OTP-only, and every
// password-related endpoint is gated so an account can never be claimed by
// knowing an email alone — register and reset both require proving inbox
// ownership (6-digit code), and set-password requires an authenticated
// session. Tenants without a password_hash get the same generic 401 on
// login as a wrong password, so login never reveals account state
// (matching verify-otp's no-enumeration posture).
//
// Password policy (enforced server-side AND mirrored by the client meter):
// 8–72 bytes, no leading/trailing whitespace, at least 8 runes, and at
// least 3 of the 4 character classes (lowercase, uppercase, digit,
// symbol). Passwords are stored as bcrypt hashes only (same
// golang.org/x/crypto dependency as api_key hashing) — never plaintext.
//
// Reset protection: a completed reset stamps tenants.password_reset_at and
// blocks further resets for 7 days (request-password-reset and
// reset-password both enforce it). Changing the password while signed in
// (set-password) is NOT subject to the cooldown, but must differ from the
// current password. All flows share the OTP session store (webOtpStore),
// so any issued token is an interchangeable Bearer token for /me.

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"golang.org/x/crypto/bcrypt"
)

const (
	// webPasswordMinLen is the minimum password length (bytes AND runes).
	webPasswordMinLen = 8
	// webPasswordMaxBytes caps the length at bcrypt's 72-byte input limit
	// (bcrypt silently truncates beyond it, which would let a 100-char
	// password authenticate with only its first 72 bytes).
	webPasswordMaxBytes = 72
	// webPasswordMinClasses requires at least 3 of the 4 character
	// classes (lower / upper / digit / symbol) — the strength meter
	// mirrors this exact rule.
	webPasswordMinClasses = 3
	// webPasswordResetCooldown blocks a NEW reset for 7 days after the
	// last completed reset (changing the password while signed in is not
	// affected). The email-code login remains the always-available
	// fallback during the cooldown.
	webPasswordResetCooldown = 7 * 24 * time.Hour

	// Per-email windowed budgets (each shares the per-IP backstop in
	// otpIPLimiter, matching the OTP flow's posture):
	//   register           3 / 15 min  (spam / SMTP-quota abuse)
	//   request-password-reset 3 / 15 min (OTP email spam)
	//   reset-password     5 / 15 min  (code brute force)
	//   login              5 / 15 min  (password brute force)
	webRegisterMax     = 3
	webResetRequestMax = 3
	webResetVerifyMax  = 5
	webLoginMax        = 5
	webAuthWindow      = 15 * time.Minute
)

// windowed limiters for the password flows. webLoginLimiter predates the
// others; all four are swept by windowSweepLoop (web_otp.go) and reset by
// resetRateLimiters (handler_test.go).
var (
	webLoginLimiter = &windowLimiter{
		entries: make(map[string]*windowEntry),
		limit:   webLoginMax,
		window:  webAuthWindow,
	}
	webRegisterLimiter = &windowLimiter{
		entries: make(map[string]*windowEntry),
		limit:   webRegisterMax,
		window:  webAuthWindow,
	}
	webResetRequestLimiter = &windowLimiter{
		entries: make(map[string]*windowEntry),
		limit:   webResetRequestMax,
		window:  webAuthWindow,
	}
	webResetVerifyLimiter = &windowLimiter{
		entries: make(map[string]*windowEntry),
		limit:   webResetVerifyMax,
		window:  webAuthWindow,
	}
)

// hashPassword derives the at-rest representation of a web password
// (bcrypt, DefaultCost — same strength as api_key hashing).
func hashPassword(password string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("failed to hash password: %w", err)
	}
	return string(h), nil
}

// passwordClassCount returns how many of the 4 character classes the
// password satisfies: lowercase, uppercase, digit, symbol. Multi-byte
// characters count toward the symbol class (they are not ASCII letters or
// digits), so an all-emoji password satisfies exactly one class.
func passwordClassCount(password string) int {
	var lower, upper, digit, symbol bool
	for _, r := range password {
		switch {
		case r >= 'a' && r <= 'z':
			lower = true
		case r >= 'A' && r <= 'Z':
			upper = true
		case r >= '0' && r <= '9':
			digit = true
		default:
			symbol = true
		}
	}
	count := 0
	for _, ok := range []bool{lower, upper, digit, symbol} {
		if ok {
			count++
		}
	}
	return count
}

// isValidPassword enforces the password policy: 8–72 bytes, no leading or
// trailing whitespace (copy-paste surprises), at least 8 runes so
// multi-byte (e.g. emoji) passwords can't sneak under the minimum by byte
// count alone, and at least 3 of the 4 character classes.
func isValidPassword(password string) bool {
	if password == "" {
		return false
	}
	if len(password) < webPasswordMinLen || len(password) > webPasswordMaxBytes {
		return false
	}
	if len([]rune(password)) < webPasswordMinLen {
		return false
	}
	if strings.TrimSpace(password) != password {
		return false
	}
	return passwordClassCount(password) >= webPasswordMinClasses
}

// passwordConfirmMismatch reports a client-side double-entry mismatch:
// the UI always sends password_confirm next to password (enforced by
// website/scripts/check-password-policy.mjs), and the server rejects the
// pair when confirm was supplied and differs. Absent confirm is allowed
// (older clients / hand-built calls), so the rule can never break the
// OTP-only flows — it exists to catch UI bugs, not to gate the API.
func passwordConfirmMismatch(password, confirm string) bool {
	return confirm != "" && confirm != password
}

// passwordResetCooldownUntil returns (until, true) when a NEW reset is
// still blocked by the 7-day cooldown (password_reset_at < 7 days ago),
// or (zero, false) when resets are allowed. The field is only stamped by
// a completed reset-password; set-password (change while signed in) never
// touches it.
func passwordResetCooldownUntil(tenant *core.Record) (time.Time, bool) {
	resetAt := tenant.GetDateTime("password_reset_at")
	if resetAt.Time().IsZero() {
		return time.Time{}, false
	}
	until := resetAt.Time().Add(webPasswordResetCooldown)
	if time.Now().Before(until) {
		return until, true
	}
	return time.Time{}, false
}

// ── POST /api/v1/web/register ───────────────────────────────────────

// handleRegister implements POST /api/v1/web/register — the signup-page
// path that pairs email + password (the OTP-only self-signup in
// request-otp remains for the login page's email-code tab).
//
//	{ "email": "owner@example.com", "password": "...", "password_confirm": "..." }
//
// password_confirm is the UI's double-entry guard: when supplied it must
// equal password (400 "passwords do not match" otherwise). Absent confirm
// is tolerated so hand-built calls and the OTP-only paths keep working.
// Unlike request-otp, registration is NOT register-or-login: an existing
// account gets a 409 (signup pages universally reveal existence), and the
// password is required up front. The tenant is created with
// email_verified=false and a 6-digit confirmation code is emailed; the
// existing verify-otp endpoint completes the signup (flips email_verified,
// issues the session). Response is always 200 {"status":"ok"} on success.
//
//   - 409: the email already has a tenant (active or not).
//   - 429: rate limited (3/email/15min, 10/IP/15min).
//   - 503: SMTP not configured (the confirmation code can't be sent).
//   - 400: malformed body / invalid email / weak password.
//   - 403: browser Origin outside the allowlist.
func handleRegister(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		e.Request.Body = http.MaxBytesReader(e.Response, e.Request.Body, webMaxBodyBytes)

		if !webOriginAllowed(e) {
			return e.JSON(http.StatusForbidden, map[string]any{
				"error": "origin not allowed",
			})
		}

		clientIP := e.RealIP()
		var req struct {
			Email           string `json:"email"`
			Password        string `json:"password"`
			PasswordConfirm string `json:"password_confirm"`
		}
		if err := json.NewDecoder(e.Request.Body).Decode(&req); err != nil {
			otpIPLimiter.allow(clientIP)
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "invalid JSON body",
			})
		}

		email := normalizeEmail(req.Email)
		if !isValidEmail(email) {
			otpIPLimiter.allow(clientIP)
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "email must be a valid address",
			})
		}
		if !isValidPassword(req.Password) {
			otpIPLimiter.allow(clientIP)
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "password must be at least 8 characters with at least 3 of: lowercase, uppercase, number, symbol",
			})
		}
		if passwordConfirmMismatch(req.Password, req.PasswordConfirm) {
			otpIPLimiter.allow(clientIP)
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "passwords do not match",
			})
		}

		// ── Rate limit (per email + per IP), BEFORE tenant lookup ──
		if !webRegisterLimiter.allow(email) || !otpIPLimiter.allow(clientIP) {
			return e.JSON(http.StatusTooManyRequests, map[string]any{
				"error": "rate limit exceeded, try again later",
			})
		}

		// ── Reject existing accounts (signup reveals existence) ──
		// Checked BEFORE the SMTP gate so a duplicate-email attempt gets its
		// client error (409) even when email delivery is down — the conflict
		// is about the account, not the server's ability to send mail.
		if existing, err := app.FindFirstRecordByData("tenants", "email", email); existing != nil && err == nil {
			return e.JSON(http.StatusConflict, map[string]any{
				"error": "an account with this email already exists",
			})
		}

		// ── SMTP configured? (503 = server config, never account state) ──
		if strings.TrimSpace(os.Getenv("OZ_SMTP_HOST")) == "" {
			log.Printf("/web/register: OZ_SMTP_HOST not configured — dropping signup for %q", email)
			return e.JSON(http.StatusServiceUnavailable, map[string]any{
				"error": "email delivery is not configured",
			})
		}

		// ── Create the tenant with the password hash ─────────────
		hash, err := hashPassword(req.Password)
		if err != nil {
			log.Printf("/web/register: hashing failed for %q: %v", email, err)
			return e.JSON(http.StatusInternalServerError, map[string]any{
				"error": "could not register an account, please try again",
			})
		}
		tenant, err := createTenant(app, email, hash)
		if err != nil {
			if errors.Is(err, errReservedAdminEmail) {
				// Reserved admin identity: refuse with the same 409
				// every existing address already gets (signup reveals
				// existence by design) — nothing new leaks.
				log.Printf("/web/register: refusing signup for reserved admin identity %q", email)
				return e.JSON(http.StatusConflict, map[string]any{
					"error": "an account with this email already exists",
				})
			}
			log.Printf("/web/register: tenant registration failed for %q: %v", email, err)
			return e.JSON(http.StatusInternalServerError, map[string]any{
				"error": "could not register an account, please try again",
			})
		}

		// ── Email the confirmation code ──────────────────────────
		code, err := generateOtpCode()
		if err != nil {
			log.Printf("/web/register: code generation failed: %v", err)
			return e.JSON(http.StatusInternalServerError, map[string]any{
				"error": "could not register an account, please try again",
			})
		}
		webOtpStore.storeCode(email, hashOtpCode(code))
		if err := sendOTPEmail(email, code); err != nil {
			log.Printf("/web/register: confirmation email failed for tenant %q: %v", tenant.Id, err)
			webOtpStore.deleteCode(email) // don't leave a dead code behind
			return e.JSON(http.StatusInternalServerError, map[string]any{
				"error": "could not deliver the confirmation code, please try again later",
			})
		}

		log.Printf("/web/register: registered tenant %q (id=%s)", email, tenant.Id)
		return e.JSON(http.StatusOK, map[string]any{"status": "ok"})
	}
}

// ── POST /api/v1/web/login ─────────────────────────────────────────

// handleLoginPassword implements POST /api/v1/web/login — the password
// alternative to request-otp.
//
//	{ "email": "owner@example.com", "password": "..." }
//
// Success → the SAME shape as verify-otp: { token, expires_at, tenant,
// license, subscription }. Failure → a generic 401 "invalid email or
// password" for every failure mode (unknown email, no password set, wrong
// password, non-active tenant) so the endpoint never reveals account
// state. Login does NOT touch email_verified — only verify-otp proves
// inbox ownership; a password proves knowledge of a credential the owner
// set while already authenticated.
//
//   - 429: rate limited (5/email/15min, 10/IP/15min).
//   - 403: browser Origin outside the OZ_WEB_ALLOWED_ORIGINS allowlist.
//   - 400: malformed body / invalid email.
func handleLoginPassword(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		e.Request.Body = http.MaxBytesReader(e.Response, e.Request.Body, webMaxBodyBytes)

		if !webOriginAllowed(e) {
			return e.JSON(http.StatusForbidden, map[string]any{
				"error": "origin not allowed",
			})
		}

		clientIP := e.RealIP()
		var req struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(e.Request.Body).Decode(&req); err != nil {
			otpIPLimiter.allow(clientIP)
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "invalid JSON body",
			})
		}

		email := normalizeEmail(req.Email)
		if email == "" {
			otpIPLimiter.allow(clientIP)
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "email is required",
			})
		}
		if !isValidEmail(email) {
			otpIPLimiter.allow(clientIP)
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "email must be a valid address",
			})
		}

		// ── Escalating brute-force lockout (per email), FIRST ──────
		// 5s minimum gap; +30s after 3rd consecutive failure, more 30s
		// each, capped at 15 minutes. Persisted to SQLite (H2 audit).
		if locked, retryAfter := checkLoginLockout(email); locked {
			return e.JSON(http.StatusTooManyRequests, map[string]any{
				"error":       describeLoginLockout(retryAfter),
				"retry_after": retryAfter,
			})
		}

		// ── Rate limit (per email + per IP), BEFORE tenant lookup ──
		if !webLoginLimiter.allow(email) || !otpIPLimiter.allow(clientIP) {
			return e.JSON(http.StatusTooManyRequests, map[string]any{
				"error": "rate limit exceeded, try again later",
			})
		}

		// ── Resolve tenant ────────────────────────────────────────
		tenant, err := app.FindFirstRecordByData("tenants", "email", email)
		if tenant == nil || err != nil {
			recordLoginFailure(email)
			return e.JSON(http.StatusUnauthorized, map[string]any{
				"error": "invalid email or password",
			})
		}

		// Non-active tenants get the same generic 401 (their passwords
		// are never honored, but the response must not differ).
		if tenant.GetString("status") != "active" {
			recordLoginFailure(email)
			return e.JSON(http.StatusUnauthorized, map[string]any{
				"error": "invalid email or password",
			})
		}

		// ── Verify the bcrypt hash ───────────────────────────────
		// A missing password_hash (OTP-only account) takes the same path
		// as a wrong password: the UI hints at the email-code alternative,
		// but the API never says which case occurred.
		storedHash := tenant.GetString("password_hash")
		if storedHash == "" ||
			bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(req.Password)) != nil {
			recordLoginFailure(email)
			return e.JSON(http.StatusUnauthorized, map[string]any{
				"error": "invalid email or password",
			})
		}

		// Successful login clears the escalating lockout.
		clearLoginLockout(email)

		// ── Issue session token (same store as verify-otp) ───────
		token, expiresAt, err := issueWebSession(tenant.Id)
		if err != nil {
			log.Printf("/web/login: session issuance failed for tenant %q: %v", tenant.Id, err)
			return e.JSON(http.StatusInternalServerError, map[string]any{
				"error": "could not start a session, please try again",
			})
		}

		log.Printf("/web/login: session issued for tenant %q", tenant.Id)
		return e.JSON(http.StatusOK, webSessionResponse(app, tenant, token, expiresAt))
	}
}

// ── POST /api/v1/web/set-password ──────────────────────────────────

// handleSetPassword implements POST /api/v1/web/set-password — the way a
// signed-in account sets its initial password or changes it.
//
//	{ "password": "...", "password_confirm": "..." }   Authorization: Bearer <session token>
//
// password_confirm is the UI's double-entry guard (400 on mismatch when
// supplied; absent confirm is tolerated).
//
// The session (issued only by verify-otp, login, or reset-password)
// identifies the account — the body carries no email, so the request can
// never set a password for a different tenant even if the JSON is mangled.
// Changing requires the new password to differ from the current one; the
// 7-day reset cooldown does NOT apply here (the user already proved their
// session). Success → 200 {"status":"ok"}; the new hash takes effect on
// the next login.
//
//   - 401: missing/unknown/expired session token.
//   - 400: weak password, or the new password equals the current one.
//   - 403: browser Origin outside the allowlist.
func handleSetPassword(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		e.Request.Body = http.MaxBytesReader(e.Response, e.Request.Body, webMaxBodyBytes)

		if !webOriginAllowed(e) {
			return e.JSON(http.StatusForbidden, map[string]any{
				"error": "origin not allowed",
			})
		}

		token, err := extractBearerToken(e)
		if err != nil {
			e.Response.Header().Set("WWW-Authenticate", `Bearer realm="web"`)
			return e.JSON(http.StatusUnauthorized, map[string]any{
				"error": "missing or invalid session token",
			})
		}
		tenantID := webOtpStore.getSession(hashWebToken(token))
		if tenantID == "" {
			e.Response.Header().Set("WWW-Authenticate", `Bearer realm="web"`)
			return e.JSON(http.StatusUnauthorized, map[string]any{
				"error": "invalid or expired session",
			})
		}

		var req struct {
			Password        string `json:"password"`
			PasswordConfirm string `json:"password_confirm"`
		}
		if err := json.NewDecoder(e.Request.Body).Decode(&req); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "invalid JSON body",
			})
		}
		if !isValidPassword(req.Password) {
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "password must be at least 8 characters with at least 3 of: lowercase, uppercase, number, symbol",
			})
		}
		if passwordConfirmMismatch(req.Password, req.PasswordConfirm) {
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "passwords do not match",
			})
		}

		tenant, err := app.FindRecordById("tenants", tenantID)
		if err != nil {
			// Tenant deleted mid-session — treat as expired, not a leak.
			webOtpStore.deleteSession(hashWebToken(token))
			e.Response.Header().Set("WWW-Authenticate", `Bearer realm="web"`)
			return e.JSON(http.StatusUnauthorized, map[string]any{
				"error": "invalid or expired session",
			})
		}
		if tenant.GetString("status") != "active" {
			return e.JSON(http.StatusUnauthorized, map[string]any{
				"error": "invalid or expired session",
			})
		}

		// ── Must differ from the current password ────────────────
		// A first-time set (empty stored hash) is always allowed; a
		// change must actually change something.
		storedHash := tenant.GetString("password_hash")
		if storedHash != "" &&
			bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(req.Password)) == nil {
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "new password must be different from the current password",
			})
		}

		hash, err := hashPassword(req.Password)
		if err != nil {
			log.Printf("/web/set-password: hashing failed for tenant %q: %v", tenant.Id, err)
			return e.JSON(http.StatusInternalServerError, map[string]any{
				"error": "could not save the password, please try again",
			})
		}
		tenant.Set("password_hash", hash)
		if err := app.Save(tenant); err != nil {
			log.Printf("/web/set-password: failed to persist password for tenant %q: %v", tenant.Id, err)
			return e.JSON(http.StatusInternalServerError, map[string]any{
				"error": "could not save the password, please try again",
			})
		}

		log.Printf("/web/set-password: password set for tenant %q", tenant.Id)
		return e.JSON(http.StatusOK, map[string]any{"status": "ok"})
	}
}

// ── POST /api/v1/web/request-password-reset ────────────────────────

// handleRequestPasswordReset implements POST /api/v1/web/request-password-reset
// — the first half of the forgot-password flow.
//
//	{ "email": "owner@example.com" }
//
// Always 200 {"status":"ok"} so the endpoint never reveals whether the
// account exists; a code is emailed only to an ACTIVE tenant. When the
// 7-day post-reset cooldown is active, the code is NOT sent and the
// response carries cooldown_until (RFC 3339) so the UI can show when a
// new reset is allowed.
//
//   - 429: rate limited (3/email/15min, 10/IP/15min).
//   - 503: SMTP not configured.
//   - 400: malformed body / invalid email.
//   - 403: browser Origin outside the allowlist.
func handleRequestPasswordReset(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		e.Request.Body = http.MaxBytesReader(e.Response, e.Request.Body, webMaxBodyBytes)

		if !webOriginAllowed(e) {
			return e.JSON(http.StatusForbidden, map[string]any{
				"error": "origin not allowed",
			})
		}

		clientIP := e.RealIP()
		var req struct {
			Email string `json:"email"`
		}
		if err := json.NewDecoder(e.Request.Body).Decode(&req); err != nil {
			otpIPLimiter.allow(clientIP)
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "invalid JSON body",
			})
		}

		email := normalizeEmail(req.Email)
		if !isValidEmail(email) {
			otpIPLimiter.allow(clientIP)
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "email must be a valid address",
			})
		}

		// ── Rate limit (per email + per IP), BEFORE tenant lookup ──
		if !webResetRequestLimiter.allow(email) || !otpIPLimiter.allow(clientIP) {
			return e.JSON(http.StatusTooManyRequests, map[string]any{
				"error": "rate limit exceeded, try again later",
			})
		}

		// ── SMTP configured? (503 = server config, never account state) ──
		if strings.TrimSpace(os.Getenv("OZ_SMTP_HOST")) == "" {
			log.Printf("/web/request-password-reset: OZ_SMTP_HOST not configured — dropping request for %q", email)
			return e.JSON(http.StatusServiceUnavailable, map[string]any{
				"error": "email delivery is not configured",
			})
		}

		tenant, err := app.FindFirstRecordByData("tenants", "email", email)
		if tenant == nil || err != nil || tenant.GetString("status") != "active" {
			// Same 200 as success — no enumeration.
			return e.JSON(http.StatusOK, map[string]any{"status": "ok"})
		}

		// ── 7-day cooldown: don't send, surface when it lifts ────
		if until, ok := passwordResetCooldownUntil(tenant); ok {
			log.Printf("/web/request-password-reset: tenant %q in reset cooldown until %s", tenant.Id, until.UTC().Format(time.RFC3339))
			return e.JSON(http.StatusOK, map[string]any{
				"status":         "ok",
				"cooldown_until": until.UTC().Format(time.RFC3339),
			})
		}

		code, err := generateOtpCode()
		if err != nil {
			log.Printf("/web/request-password-reset: code generation failed: %v", err)
			return e.JSON(http.StatusInternalServerError, map[string]any{
				"error": "could not send a reset code, please try again",
			})
		}
		webOtpStore.storeCode(email, hashOtpCode(code))
		if err := sendOTPEmail(email, code); err != nil {
			log.Printf("/web/request-password-reset: email send failed for tenant %q: %v", tenant.Id, err)
			webOtpStore.deleteCode(email)
			return e.JSON(http.StatusInternalServerError, map[string]any{
				"error": "could not deliver the reset code, please try again later",
			})
		}

		log.Printf("/web/request-password-reset: reset code sent to tenant %q", tenant.Id)
		return e.JSON(http.StatusOK, map[string]any{"status": "ok"})
	}
}

// ── POST /api/v1/web/reset-password ────────────────────────────────

// handleResetPassword implements POST /api/v1/web/reset-password — the
// second half of the forgot-password flow.
//
//	{ "email": "owner@example.com", "code": "123456", "password": "...", "password_confirm": "..." }
//
// password_confirm is the UI's double-entry guard (400 on mismatch when
// supplied; absent confirm is tolerated).
//
// Proves inbox ownership with the emailed code (same single-use store as
// verify-otp), enforces the password policy, requires the new password to
// differ from the stored one, stamps password_reset_at (starting the
// 7-day cooldown), marks the email verified, and issues a session so the
// user lands signed in. Success → the verify-otp session shape.
//
// Validation order matters: policy + must-differ run BEFORE the code is
// consumed, so a user who fat-fingers the password doesn't burn their
// single-use code. The cooldown is re-checked here (defense in depth —
// request-password-reset already gates it, but codes could outlive a
// race or a manual state edit).
//
//   - 429: rate limited (5/email/15min, 10/IP/15min), or cooldown active.
//   - 401: invalid/expired code (never reveals which failure).
//   - 400: malformed body / invalid email / weak password / same password.
//   - 403: browser Origin outside the allowlist.
func handleResetPassword(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		e.Request.Body = http.MaxBytesReader(e.Response, e.Request.Body, webMaxBodyBytes)

		if !webOriginAllowed(e) {
			return e.JSON(http.StatusForbidden, map[string]any{
				"error": "origin not allowed",
			})
		}

		clientIP := e.RealIP()
		var req struct {
			Email           string `json:"email"`
			Code            string `json:"code"`
			Password        string `json:"password"`
			PasswordConfirm string `json:"password_confirm"`
		}
		if err := json.NewDecoder(e.Request.Body).Decode(&req); err != nil {
			otpIPLimiter.allow(clientIP)
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "invalid JSON body",
			})
		}

		email := normalizeEmail(req.Email)
		code := strings.TrimSpace(req.Code)
		if !isValidEmail(email) || !is6DigitCode(code) {
			otpIPLimiter.allow(clientIP)
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "email and 6-digit code are required",
			})
		}

		// ── Rate limit (per email + per IP), BEFORE tenant lookup ──
		if !webResetVerifyLimiter.allow(email) || !otpIPLimiter.allow(clientIP) {
			return e.JSON(http.StatusTooManyRequests, map[string]any{
				"error": "rate limit exceeded, try again later",
			})
		}

		// ── Resolve tenant BEFORE touching the code store ────────
		tenant, err := app.FindFirstRecordByData("tenants", "email", email)
		if err != nil || tenant == nil || tenant.GetString("status") != "active" {
			return e.JSON(http.StatusUnauthorized, map[string]any{
				"error": "invalid or expired code",
			})
		}

		// ── Cooldown (defense in depth — see handler doc) ────────
		if until, ok := passwordResetCooldownUntil(tenant); ok {
			return e.JSON(http.StatusTooManyRequests, map[string]any{
				"error":          "password reset was recently completed, try again later",
				"cooldown_until": until.UTC().Format(time.RFC3339),
			})
		}

		// ── Policy + confirm + must-differ BEFORE consuming the code ──
		if !isValidPassword(req.Password) {
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "password must be at least 8 characters with at least 3 of: lowercase, uppercase, number, symbol",
			})
		}
		if passwordConfirmMismatch(req.Password, req.PasswordConfirm) {
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "passwords do not match",
			})
		}
		storedHash := tenant.GetString("password_hash")
		if storedHash != "" &&
			bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(req.Password)) == nil {
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "new password must be different from the current password",
			})
		}

		// ── Consume and verify the single-use code ───────────────
		storedCodeHash, ok := webOtpStore.takeCode(email)
		if !ok || !constantTimeHashEq(storedCodeHash, hashOtpCode(code)) {
			return e.JSON(http.StatusUnauthorized, map[string]any{
				"error": "invalid or expired code",
			})
		}

		hash, err := hashPassword(req.Password)
		if err != nil {
			log.Printf("/web/reset-password: hashing failed for tenant %q: %v", tenant.Id, err)
			return e.JSON(http.StatusInternalServerError, map[string]any{
				"error": "could not reset the password, please try again",
			})
		}
		tenant.Set("password_hash", hash)
		// Stamp the cooldown anchor: the 7-day window starts NOW.
		tenant.Set("password_reset_at", time.Now().UTC().Format(time.RFC3339))
		// Proving inbox ownership doubles as email verification.
		tenant.Set("email_verified", true)
		if err := app.Save(tenant); err != nil {
			log.Printf("/web/reset-password: failed to persist password for tenant %q: %v", tenant.Id, err)
			return e.JSON(http.StatusInternalServerError, map[string]any{
				"error": "could not reset the password, please try again",
			})
		}

		// ── Issue a session so the user lands signed in ──────────
		token, expiresAt, err := issueWebSession(tenant.Id)
		if err != nil {
			log.Printf("/web/reset-password: session issuance failed for tenant %q: %v", tenant.Id, err)
			return e.JSON(http.StatusInternalServerError, map[string]any{
				"error": "could not start a session, please try again",
			})
		}

		log.Printf("/web/reset-password: password reset for tenant %q", tenant.Id)
		return e.JSON(http.StatusOK, webSessionResponse(app, tenant, token, expiresAt))
	}
}
