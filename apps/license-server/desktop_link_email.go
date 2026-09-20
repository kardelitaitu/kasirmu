package main

// Device link by emailed code (ADR #54 §2.6-§2.7).
//
// The route that needs no browser: Google's browser flows are closed on Android (§1.7),
// so the tablet — and any account that is not a Google one — proves the account by
// receiving a 6-digit code at the address the tenant already owns. The destination is the
// same as the Google path: the device ends up linked to the account.
//
// Endpoints:
//
//	POST /api/v1/desktop/link/email/request — device-authenticated; mails a link-purpose code
//	POST /api/v1/desktop/link/email/consume — device-authenticated; spends it
//
// Three security properties, all deliberate:
//
//  1. The address must be the TENANT'S OWN. The device proves which tenant it holds with its
//     api_key, so the submitted address is a confirmation, never an identity claim — a device
//     cannot ask for a code to somebody else's mailbox.
//  2. The code is purpose-bound (§2.6): a link code cannot be spent as a login, and the login
//     lockout is shared so this endpoint is not the cheaper door to brute-force.
//  3. No `tenant_identities` row is written. Nothing federated was linked, and the proof of
//     inbox control lives where the email flow already keeps it: `tenants.email_verified`.

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// ── POST /api/v1/desktop/link/email/request ────────────────────────

// handleDesktopLinkEmailRequest mails a link-purpose code to the tenant's own address.
func handleDesktopLinkEmailRequest(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		e.Request.Body = http.MaxBytesReader(e.Response, e.Request.Body, webMaxBodyBytes)
		var req struct {
			MachineID string `json:"machine_id"`
			Email     string `json:"email"`
		}
		if err := json.NewDecoder(e.Request.Body).Decode(&req); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "invalid JSON body"})
		}
		tenant, ok := authenticateDevice(app, e, req.MachineID)
		if !ok {
			return nil // response already sent
		}
		email := normalizeEmail(req.Email)
		if email != normalizeEmail(tenant.GetString("email")) {
			// Told plainly: the caller is authenticated as this tenant, so naming its own
			// account leaks nothing — and a device must never be able to aim a code at a
			// mailbox it does not hold.
			return e.JSON(http.StatusForbidden, map[string]any{
				"error": "that address is not this store's account address",
			})
		}
		if tenant.GetString("status") != "active" {
			return e.JSON(http.StatusForbidden, map[string]any{"error": "this account is not active"})
		}
		if strings.TrimSpace(os.Getenv("OZ_SMTP_HOST")) == "" {
			return e.JSON(http.StatusServiceUnavailable, map[string]any{"error": "email delivery is not configured"})
		}
		if !otpRequestLimiter.allow(email) || !otpIPLimiter.allow(e.RealIP()) {
			return e.JSON(http.StatusTooManyRequests, map[string]any{
				"error": "rate limit exceeded, try again later",
			})
		}

		code, err := generateOtpCode()
		if err != nil {
			log.Printf("/desktop/link/email/request: code generation failed: %v", err)
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "could not generate a code, please try again"})
		}
		webOtpStore.storeCodeFor(purposeLink, email, hashOtpCode(code))
		if err := sendOTPEmail(email, code); err != nil {
			webOtpStore.deleteCode(email) // never leave a code the user was not told about
			log.Printf("/desktop/link/email/request: delivery to %q failed: %v", email, err)
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "could not send the code, please try again"})
		}
		log.Printf("/desktop/link/email: link code sent for tenant %s", tenant.Id)
		return e.JSON(http.StatusOK, map[string]any{"status": "sent"})
	}
}

// ── POST /api/v1/desktop/link/email/consume ────────────────────────

// handleDesktopLinkEmailConsume spends a link code and marks the account verified.
func handleDesktopLinkEmailConsume(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		e.Request.Body = http.MaxBytesReader(e.Response, e.Request.Body, webMaxBodyBytes)
		var req struct {
			MachineID string `json:"machine_id"`
			Code      string `json:"code"`
		}
		if err := json.NewDecoder(e.Request.Body).Decode(&req); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "invalid JSON body"})
		}
		tenant, ok := authenticateDevice(app, e, req.MachineID)
		if !ok {
			return nil
		}
		email := normalizeEmail(tenant.GetString("email"))
		code := strings.TrimSpace(req.Code)
		if !is6DigitCode(code) {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "a 6-digit code is required"})
		}
		// The shared lockout: a wrong code here must escalate exactly as it does at
		// /web/verify-otp, or this endpoint becomes the cheaper way to guess.
		if locked, retryAfter := checkLoginLockout(email); locked {
			return e.JSON(http.StatusTooManyRequests, map[string]any{
				"error":       describeLoginLockout(retryAfter),
				"retry_after": retryAfter,
			})
		}
		if !otpVerifyLimiter.allow(email) || !otpIPLimiter.allow(e.RealIP()) {
			return e.JSON(http.StatusTooManyRequests, map[string]any{"error": "rate limit exceeded, try again later"})
		}
		storedHash, ok := webOtpStore.takeCodeFor(purposeLink, email)
		if !ok || !constantTimeHashEq(storedHash, hashOtpCode(code)) {
			recordLoginFailure(email)
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "invalid or expired code"})
		}

		// Controls the inbox, so the account is verified — the same state the Google path
		// reaches by the provider's assertion (§1.2 keeps the email as the account root).
		if !tenant.GetBool("email_verified") {
			tenant.Set("email_verified", true)
			if err := app.Save(tenant); err != nil {
				log.Printf("/desktop/link/email/consume: could not mark tenant %s verified: %v", tenant.Id, err)
				return e.JSON(http.StatusInternalServerError, map[string]any{"error": "could not update the account"})
			}
		}
		log.Printf("/desktop/link/email: tenant %s verified by emailed code", tenant.Id)
		// Same destination as the Google path: the account is proven, and the device earns its
		// sync credential on the way out.
		return e.JSON(http.StatusOK, map[string]any{
			"tenantId": tenant.Id,
			"email":    email,
			"verified": true,
			"terminal": terminalPayloadForLink(req.MachineID, tenant.Id),
		})
	}
}
