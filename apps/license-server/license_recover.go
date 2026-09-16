package main

// License recovery (LSE-11 phase A).
//
// Phase B throttled api_key rotation (one per tenant per 24h) and made
// every rotation email the owner. Phase A closes the remaining gap: the
// rotation itself now requires INBOX PROOF. A caller who knows only the
// email + license key can still re-activate (and run the POS with the
// existing signed subscription), but can no longer claim the tenant's
// renew/status credential — that now requires a 6-digit code emailed to
// the tenant's address.
//
// Flow:
//
//	1. POST /api/v1/license/activate without a valid api_key
//	   → 200 with the subscription and "api_key_rotation":
//	     {"status": "recovery_required"} (no rotation happens).
//	2. POST /api/v1/license/recover with the same email + license key
//	   → a 6-digit code is emailed to the tenant (generic 200).
//	3. POST /api/v1/license/activate again, this time with
//	   "recovery_code" → the code is verified against the OTP store and
//	   the api_key is rotated and returned.
//
// The recovery code reuses the web OTP store: codes are hashed at rest,
// single-use, expire with webOtpTTL, and prove the same thing a login
// code proves (control of the inbox). Rate limits: per-email budget
// (recoverLimiter) + the shared 5/hr per-IP token bucket, and key
// mismatches feed the same per-key escalating cooldown as activation so
// a key brute-forced through /recover is throttled identically.

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// recoverLimiter caps recovery-code requests per email (3 per 15 min).
// Swept by windowSweepLoop.
var recoverLimiter = &windowLimiter{
	entries: make(map[string]*windowEntry),
	limit:   3,
	window:  15 * time.Minute,
}

// sendLicenseRecoveryEmail is a package-level var so tests can stub it.
var sendLicenseRecoveryEmail = sendLicenseRecoveryEmailSMTP

// sendLicenseRecoveryEmailSMTP emails the tenant their recovery code.
// Config is read per call (OZ_SMTP_*), values never echoed; failures are
// returned, never fatal.
func sendLicenseRecoveryEmailSMTP(to, code string) error {
	host := strings.TrimSpace(os.Getenv("OZ_SMTP_HOST"))
	if host == "" {
		return fmt.Errorf("OZ_SMTP_HOST is not configured")
	}
	port := strings.TrimSpace(os.Getenv("OZ_SMTP_PORT"))
	if port == "" {
		port = "587"
	}
	user := os.Getenv("OZ_SMTP_USER")
	password := os.Getenv("OZ_SMTP_PASSWORD")
	from := strings.TrimSpace(os.Getenv("OZ_SMTP_FROM"))
	if from == "" {
		from = "no-reply@kasir.mu"
	}

	msg := buildLicenseRecoveryEmail(from, to, code)
	return sendMailSMTP(host, port, user, password, from, []string{to}, msg)
}

// buildLicenseRecoveryEmail renders the plain-text recovery email
// (RFC 5322 message bytes). The code is only ever sent to the tenant's
// inbox — never stored in plaintext server-side.
func buildLicenseRecoveryEmail(from, to, code string) []byte {
	subject := "Your kasir.mu license recovery code"
	body := fmt.Sprintf(
		"Your kasir.mu license recovery code is: %s\n\n"+
			"Enter this code in the app to restore license management access "+
			"(renewals and status checks). It expires in %d minutes.\n\n"+
			"If you did NOT request this code, someone may be trying to use "+
			"your license key: sign in at https://kasir.mu/en/login/ to "+
			"review your devices and contact support.\n",
		code, int(webOtpTTL.Minutes()))

	var sb strings.Builder
	sb.WriteString("From: kasir.mu <" + from + ">\r\n")
	sb.WriteString("To: " + to + "\r\n")
	sb.WriteString("Subject: " + subject + "\r\n")
	sb.WriteString("MIME-Version: 1.0\r\n")
	sb.WriteString("Content-Type: text/plain; charset=utf-8\r\n")
	sb.WriteString("Date: " + time.Now().UTC().Format(time.RFC1123Z) + "\r\n")
	sb.WriteString("\r\n")
	sb.WriteString(body)
	return []byte(sb.String())
}

// handleLicenseRecover implements POST /api/v1/license/recover.
//
//	{ "email": "owner@example.com", "key": "OZ-PRO-...." }
//
// The caller must already prove email + license-key ownership — the same
// proof the activation endpoint accepts for re-activation — so the code
// is only ever sent to the address that owns the key. Responses never
// reveal which part failed:
//
//   - 429: rate limited (per-IP bucket checked first, then the per-email
//     budget) — probing cannot bypass either budget.
//   - 401: unknown email / unknown key / key not activated by this
//     tenant — one generic message.
//   - 400: malformed body.
func handleLicenseRecover(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		// Cap request body at 16KB — same bound as the other public
		// endpoints (webMaxBodyBytes); the payload is two short strings.
		e.Request.Body = http.MaxBytesReader(e.Response, e.Request.Body, 16*1024)

		var body struct {
			Email string `json:"email"`
			Key   string `json:"key"`
		}
		if err := json.NewDecoder(e.Request.Body).Decode(&body); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "invalid JSON body",
			})
		}
		body.Email = strings.ToLower(strings.TrimSpace(body.Email))
		body.Key = strings.TrimSpace(body.Key)
		if body.Email == "" || body.Key == "" {
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "email and key are required",
			})
		}

		// IP backstop shares the activation budget (5/hr per IP), checked
		// before any lookup so probing cannot bypass it.
		if !ipRateLimiter.allow(e.RealIP()) {
			return e.JSON(http.StatusTooManyRequests, map[string]any{
				"error": "rate limit exceeded, try again later",
			})
		}
		// Per-email budget, also checked before lookups.
		if !recoverLimiter.allow(body.Email) {
			return e.JSON(http.StatusTooManyRequests, map[string]any{
				"error": "too many recovery requests, try again later",
			})
		}

		// Ownership proof: the key must exist AND be activated by the
		// tenant that owns this email. Every mismatch answers the same
		// generic 401 (no enumeration) and feeds the per-key escalating
		// cooldown, so brute-forcing the key here is throttled exactly
		// like at activation.
		tenant, err := app.FindFirstRecordByData("tenants", "email", body.Email)
		keyRecord, keyErr := app.FindFirstRecordByData("license_keys", "key", body.Key)
		if err != nil || keyErr != nil ||
			tenant == nil || keyRecord == nil ||
			keyRecord.GetString("status") != "activated" ||
			keyRecord.GetString("activated_by") != tenant.Id {
			keyFailTracker.recordFailure(body.Key)
			return e.JSON(http.StatusUnauthorized, map[string]any{
				"error": "invalid or already used license key",
			})
		}

		code, genErr := generateOtpCode()
		if genErr != nil {
			log.Printf("license recover: code generation failed for tenant %q: %v", tenant.Id, genErr)
			return e.JSON(http.StatusInternalServerError, map[string]any{
				"error": "failed to generate recovery code",
			})
		}
		webOtpStore.storeCode(body.Email, hashOtpCode(code))

		if sendErr := sendLicenseRecoveryEmail(body.Email, code); sendErr != nil {
			// No orphan code outlives a failed delivery.
			webOtpStore.deleteCode(body.Email)
			log.Printf("license recover: recovery email failed for tenant %q: %v", tenant.Id, sendErr)
			return e.JSON(http.StatusInternalServerError, map[string]any{
				"error": "failed to send recovery email",
			})
		}
		log.Printf("license recover: recovery code sent for tenant %q (key=%q)", tenant.Id, maskLicenseKey(body.Key))
		return e.JSON(http.StatusOK, map[string]any{
			"status": "sent",
		})
	}
}
