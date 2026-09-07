package main

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

// ActivateRequest is the JSON body for POST /api/v1/license/activate.
type ActivateRequest struct {
	Key       string `json:"key"`
	TenantID  string `json:"tenant_id"`
	MachineID string `json:"machine_id"`
	Email     string `json:"email"` // required
	// Phone is the contact phone number for the licensee.
	// Stored as-is on the tenant record; falls back to "-" if empty.
	Phone string `json:"phone"`
	// TrialVertical is the segmented-trial vertical (subscription-tiers.md §4).
	// Only read for trial keys (license_keys.is_trial = true): "" / unset →
	// 14-day Plus trial, "restaurant" / "cafe" → 14-day Pro trial,
	// "enterprise_referral" → 30-day Pro trial. Paid keys ignore it entirely
	// — a client-supplied parameter must never shorten a paying customer's
	// license.
	TrialVertical string `json:"trial_vertical"`
	// BundleID is the optional vertical-bundle id (subscription-tiers.md §3,
	// C3.2 shipped). "restaurant_starter" unlocks the kds workspace type at
	// the Plus tier. Mirrors trial_vertical's trust boundary: only honored
	// for trial keys — a client-supplied bundle must never widen a PAYING
	// license beyond what was purchased (paid bundles are issued by the
	// webhook at checkout via the price map's bundle segment, cross-checked
	// against custom_data.bundle / custom_field4). Unknown values are
	// ignored.
	BundleID string `json:"bundle_id"`
	// HardwareFingerprint is the device-level fingerprint (SPEC-2026-TRIAL-
	// LOCK): the client's "hw_<hex>" hash of the same hardware anchor the
	// machine_id derives from. Unlike machine_id (per-installation, bound
	// to a tenant's tenant_machines row), the fingerprint is stable across
	// reinstalls, so the trial lock keys on it — a device that claimed a
	// trial under a DIFFERENT email answers 403 at mint time even before
	// the machine-registration checks. Optional: clients that don't send
	// it fall back to the machine_id, and legacy/non-fingerprint values
	// skip the lock rather than bricking activation.
	HardwareFingerprint string `json:"hardware_fingerprint"`
	// APIKey is the tenant API key for authenticating re-activations.
	// On first activation the server issues a new api_key in the response,
	// which the POS persists and re-sends on subsequent calls.
	// When a license key is already activated by the same email's tenant,
	// the api_key is NOT required — the email + key pair is sufficient proof.
	APIKey string `json:"api_key,omitempty"`
	// RecoveryCode is the 6-digit code emailed to the tenant (requested
	// via POST /api/v1/license/recover) that authorizes an api_key
	// rotation on re-activation (LSE-11 phase A). Re-activating WITHOUT a
	// valid api_key still works — the caller gets the existing signed
	// subscription — but rotating the management credential requires this
	// inbox proof, so knowing only email + license key no longer yields
	// the tenant's renew/status credential.
	RecoveryCode string `json:"recovery_code,omitempty"`
}

// apiRotationLimiter caps api_key rotations per tenant (LSE-11 phase B):
// at most one rotation per 24h, in-memory (a restart forgets it — the
// rotation cooldown is a throttle, not a security boundary; phase A's
// recovery-code gate is the boundary). Swept by windowSweepLoop.
var apiRotationLimiter = &windowLimiter{
	entries: make(map[string]*windowEntry),
	limit:   1,
	window:  24 * time.Hour,
}

// sendAPIKeyRotationNotice is a package-level var so tests can stub it.
// Production impl: net/smtp. Best-effort — callers log failures and never
// block the rotation on it.
var sendAPIKeyRotationNotice = sendAPIKeyRotationNoticeSMTP

// sendAPIKeyRotationNoticeSMTP emails the tenant that their license
// management key (api_key) was just rotated, so a rotation forced by
// someone other than the owner becomes a visible, actionable event
// (LSE-11 phase B). Config is read per call (OZ_SMTP_*), values never
// echoed; failures are returned, never fatal.
func sendAPIKeyRotationNoticeSMTP(to string) error {
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
		from = "no-reply@ozpos.my.id"
	}

	subject := "Your OZ-POS license key was re-activated"
	body := "Your OZ-POS license was just re-activated with your email and " +
		"license key, which rotated your license management key.\n\n" +
		"If this was you (for example a reinstall), no action is needed.\n" +
		"If you did NOT re-activate just now, someone else may hold your " +
		"license key: sign in at https://ozpos.my.id/en/login/ to review " +
		"your devices, revoke unknown machines, and contact support.\n"

	var sb strings.Builder
	sb.WriteString("From: OZ-POS <")
	sb.WriteString(from)
	sb.WriteString(">\r\n")
	sb.WriteString("To: ")
	sb.WriteString(to)
	sb.WriteString("\r\n")
	sb.WriteString("Subject: ")
	sb.WriteString(subject)
	sb.WriteString("\r\n")
	sb.WriteString("MIME-Version: 1.0\r\n")
	sb.WriteString("Content-Type: text/plain; charset=utf-8\r\n")
	sb.WriteString("Date: ")
	sb.WriteString(time.Now().UTC().Format(time.RFC1123Z))
	sb.WriteString("\r\n")
	sb.WriteString("\r\n")
	sb.WriteString(body)
	return sendMailSMTP(host, port, user, password, from, []string{to}, []byte(sb.String()))
}

// trialSegmentation maps an activation request's trial_vertical to the
// (tier, duration-in-days) a trial key should mint (subscription-tiers.md
// §4). Blank/unset and unknown verticals fall back to the general 14-day
// Plus trial; restaurant/cafe signups get the 14-day Pro trial; enterprise
// referrals get the 30-day Pro trial. Matching is case-insensitive and
// whitespace-tolerant.
func trialSegmentation(vertical string) (tier string, days int) {
	switch strings.ToLower(strings.TrimSpace(vertical)) {
	case "restaurant", "cafe":
		return "pro", 14
	case "enterprise_referral":
		return "pro", 30
	case "enterprise_self_serve":
		return "enterprise", 30
	default:
		return "plus", 14
	}
}

// trialLockDenied is the typed error enforceTrialLock returns for the
// reset-abuse case (a different tenant claiming a trial on an already-
// claimed device). handleActivate renders it as the same 403 JSON the
// /trial claim endpoint emits, so both gates answer
// {"code":"TRIAL_ALREADY_CLAIMED",...} — the code the client keys on.
// (apis.NewForbiddenError's errData arg is field-level validation data,
// not free-form details, so a flat details map would be mangled into
// validation_invalid_value noise — hence the typed error.)
type trialLockDenied struct {
	code        string
	message     string
	expiredAt   string
	fingerprint string
}

func (e *trialLockDenied) Error() string { return e.message }

// enforceTrialLock is the activation-time half of the hardware-fingerprint
// trial lock (SPEC-2026-TRIAL-LOCK; the claim endpoint is /api/v1/license
// /trial). For a trial-key activation it ensures the machine has not
// already claimed a trial:
//
//   - no registration yet → create one for this tenant (the device's
//     first claim), allow the trial;
//   - registration owned by the SAME tenant → re-install re-activation,
//     allow;
//   - registration owned by a DIFFERENT tenant → 403 TRIAL_ALREADY_CLAIMED
//     — the reset-abuse case (same hardware, fresh email).
//
// The gate fires at mint time regardless of whether the client called the
// /trial endpoint first, so skipping the endpoint cannot bypass the lock.
// Returns a *trialLockDenied (rendered by the handler as the 403 JSON) or
// nil when the trial may proceed.
func enforceTrialLock(app core.App, hardwareFingerprint, machineID, tenantID string, trialDays int) error {
	// Prefer the device-level fingerprint (stable across reinstalls); fall
	// back to the machine_id for clients that only send that. Either way
	// the value must be a real fingerprint form, else the lock is skipped
	// rather than bricking activation.
	fp := normalizeHardwareFingerprint(hardwareFingerprint)
	if fp == "" {
		fp = normalizeHardwareFingerprint(machineID)
	}
	if fp == "" {
		// A non-fingerprint value (legacy client) skips the lock — the
		// /trial endpoint and clients that send a real fingerprint are
		// still protected.
		return nil
	}
	existing, err := app.FindFirstRecordByData("trial_registrations", "hardware_fingerprint", fp)
	if err != nil {
		// No claim yet — this activation is the device's first trial.
		coll, collErr := app.FindCollectionByNameOrId("trial_registrations")
		if collErr != nil {
			return fmt.Errorf("trial_registrations collection not found: %w", collErr)
		}
		rec := core.NewRecord(coll)
		rec.Set("hardware_fingerprint", fp)
		rec.Set("first_seen_at", time.Now().UTC())
		rec.Set("trial_expires_at", time.Now().UTC().AddDate(0, 0, trialDays))
		rec.Set("tenant_id", []string{tenantID})
		rec.Set("platform", "unknown")
		rec.Set("app_version", "unknown")
		if saveErr := app.Save(rec); saveErr != nil {
			log.Printf("trial lock: failed to register fingerprint %q for tenant %q: %v", fp, tenantID, saveErr)
			return nil // non-fatal: the trial still mints, the lock just degrades
		}
		log.Printf("trial lock: registered fingerprint %q for tenant %q (first claim)", fp, tenantID)
		return nil
	}

	// A claim exists. Resolve its owning tenant (relation stored as a JSON
	// array in PB). Same tenant → re-activation, allow. Different tenant →
	// the exact abuse the lock exists to prevent.
	owner := existing.GetString("tenant_id")
	if strings.HasPrefix(owner, "[") {
		if sl := existing.GetStringSlice("tenant_id"); len(sl) > 0 {
			owner = sl[0]
		}
	}
	if owner != "" && owner != tenantID {
		return &trialLockDenied{
			code:        "TRIAL_ALREADY_CLAIMED",
			message:     "A trial has already been claimed for this device. Purchase a license to continue.",
			expiredAt:   existing.GetDateTime("trial_expires_at").Time().UTC().Format(time.RFC3339),
			fingerprint: fp,
		}
	}
	// Same tenant (or a legacy claim without an owner): allow — the
	// tenant's own re-installations are legitimate.
	return nil
}

// normalizeBundleID canonicalizes an activation request's bundle_id.
// Only "restaurant_starter" is recognized today (TODO C3.2); anything else
// (blank, unknown, malformed) normalizes to "" — a no-op bundle.
func normalizeBundleID(bundle string) string {
	b := strings.ToLower(strings.TrimSpace(bundle))
	if b == "restaurant_starter" {
		return b
	}
	return ""
}

// machineLimitExceeded reports whether the tenant has reached its tier's
// machine limit for a NEW machine. Returns a non-empty error message when
// the limit is hit and `machineID` is not already registered to the tenant
// (re-activating an existing machine is always allowed), or "" when the
// activation may proceed.
//
// Shared by the re-activation and first-activation paths so the limit logic
// (and its error text) can never drift apart.
func machineLimitExceeded(app core.App, tenantID, machineID, tier string, max int) string {
	if max <= 0 {
		return ""
	}
	machines, _ := app.FindRecordsByFilter(
		"tenant_machines",
		"tenant_id = {:tenant_id}",
		"", 0, 0,
		map[string]any{"tenant_id": tenantID},
	)
	if len(machines) < max {
		return ""
	}
	// Check if the machine being registered is already one of this
	// tenant's machines (re-activation case).
	for _, m := range machines {
		if m.Id == machineID {
			return ""
		}
	}
	return fmt.Sprintf(
		"machine limit reached (%d machines allowed on %s tier). Upgrade to add more.",
		max, tier,
	)
}

// registerMachine upserts the tenant_machines record for an activation:
// creates it (with first_seen_at) when absent, else updates last_seen_at.
//
// With `checkOwnership` true it returns conflict=true when the machine is
// already registered to a DIFFERENT tenant (the caller must answer 409).
// A save failure is returned as an error so the caller can log its own
// audit line — registration is non-fatal either way (the subscription is
// already valid).
func registerMachine(app core.App, machineID, tenantID string, checkOwnership bool) (conflict bool, err error) {
	machineColl, macErr := app.FindCollectionByNameOrId("tenant_machines")
	if macErr != nil {
		return false, nil
	}
	machine, macErr := app.FindRecordById("tenant_machines", machineID)
	if macErr != nil {
		machine = core.NewRecord(machineColl)
		machine.Set("id", machineID)
		machine.Set("tenant_id", tenantID)
		machine.Set("first_seen_at", time.Now().UTC())
	} else if checkOwnership && machine.GetString("tenant_id") != tenantID {
		return true, nil
	}
	machine.Set("last_seen_at", time.Now().UTC())
	if err := app.Save(machine); err != nil {
		return false, err
	}
	return false, nil
}

// rotateAPIKey performs the full api_key rotation lifecycle: verify the
// recovery code (inbox proof), enforce the per-tenant 24h throttle, mint and
// persist the new key, and notify the owner. Returns (handled, err,
// newAPIKey):
//
//   - handled=true → a response was written (401/429/500); the caller must
//     return err.
//   - newAPIKey non-empty → rotation succeeded; the caller should include it
//     in the response (the stored value is a bcrypt hash, so the plaintext
//     is only available here, at mint time).
//
// The owner notification is best-effort (non-fatal) and runs only AFTER the
// save succeeded so we never email a rotation that didn't happen.
func rotateAPIKey(
	app core.App,
	e *core.RequestEvent,
	req ActivateRequest,
	tenant *core.Record,
) (handled bool, err error, newAPIKey string) {
	storedHash, codeOK := webOtpStore.takeCode(req.Email)
	if !codeOK || !constantTimeHashEq(storedHash, hashOtpCode(req.RecoveryCode)) {
		return true, e.JSON(http.StatusUnauthorized, map[string]any{
			"error": "invalid or expired recovery code. Request a new code via POST /api/v1/license/recover.",
		}), ""
	}
	if !apiRotationLimiter.allow(tenant.Id) {
		remaining := apiRotationLimiter.remainingSeconds(tenant.Id)
		log.Printf("LSE-11: api_key rotation throttled for tenant %q (retry in %ds)", tenant.Id, remaining)
		return true, e.JSON(http.StatusTooManyRequests, map[string]any{
			"error":       "license management key was recently rotated. Check your email — if this wasn't you, contact support. Try again later.",
			"retry_after": remaining,
		}), ""
	}
	newAPIKey = generateAPIKey()
	apiKeyHash, apiKeyLookup, hashErr := hashAPIKey(newAPIKey)
	if hashErr != nil {
		log.Printf("Re-activation api_key rotation failed for tenant %q: %v", tenant.Id, hashErr)
		return true, e.JSON(http.StatusInternalServerError, map[string]any{
			"error": "failed to rotate api_key",
		}), ""
	}
	tenant.Set("api_key", apiKeyHash)
	tenant.Set("api_key_lookup", apiKeyLookup)
	if saveErr := app.Save(tenant); saveErr != nil {
		log.Printf("Re-activation api_key rotation save failed for tenant %q: %v", tenant.Id, saveErr)
		return true, e.JSON(http.StatusInternalServerError, map[string]any{
			"error": "failed to rotate api_key",
		}), ""
	}
	if noticeErr := sendAPIKeyRotationNotice(tenant.GetString("email")); noticeErr != nil {
		log.Printf("LSE-11: rotation notice email failed for tenant %q: %v", tenant.Id, noticeErr)
	}
	return false, nil, newAPIKey
}

// handleReactivation serves the re-activation case: the key is already
// activated by this email's tenant, so the email + key pair is sufficient
// proof of ownership and the existing signed subscription is returned
// WITHOUT requiring the api_key.
//
// Returns (handled, err) — handled=true when a response was written (the
// caller must return err), false when the key is not in the activated state
// and the caller should continue with the other key-status branches.
//
// LSE-11 phase A: a caller on email + key alone (a reinstall that lost the
// key) gets the existing signed subscription — enough to run the POS — but
// NOT a rotated api_key. The management credential now requires inbox proof:
// the client requests a code (POST /api/v1/license/recover) and re-sends
// activation with "recovery_code". Knowing only email + key therefore no
// longer yields the tenant's renew/status credential.
//
// LSE-11 phase B (retained as defense in depth): actual rotations are
// throttled to one per tenant per 24h and the owner is emailed on every
// rotation. The recovery-code verification, rotation throttle, key
// generation, persistence, and owner notification are extracted to
// rotateAPIKey so the api_key rotation lifecycle is independently testable.
func handleReactivation(
	app core.App,
	e *core.RequestEvent,
	req ActivateRequest,
	tenant *core.Record,
	keyRecord *core.Record,
	keyStatus string,
	activatedBy string,
) (handled bool, err error) {
	if !(keyStatus == "activated" && activatedBy == tenant.Id) {
		return false, nil
	}

	// Find existing ACTIVE subscription. Use FindRecordsByFilter
	// with explicit status='active' filter and order by -starts_at
	// to get the latest. FindFirstRecordByData without a status
	// filter would return an expired subscription for renewed
	// tenants (SQLite returns in insertion order), breaking
	// re-activation for any tenant who has ever renewed.
	subs, err := app.FindRecordsByFilter(
		"subscriptions",
		"tenant_id = {:tenant_id} && status = 'active'",
		"-starts_at", 1, 0,
		map[string]any{"tenant_id": tenant.Id},
	)
	if err != nil || len(subs) == 0 {
		return true, e.JSON(http.StatusInternalServerError, map[string]any{
			"error": "failed to find active subscription for reused key",
		})
	}
	subRecord := subs[0]

	log.Printf("Re-activation: key=%q already activated by tenant=%q (email=%q), returning existing subscription",
		maskLicenseKey(req.Key), tenant.Id, req.Email)

	// ── Machine count enforcement on re-activation ─────────
	// Without this check, a Free-tier key holder could install
	// on unlimited machines by repeatedly re-activating with the
	// correct email+key pair. Use the ACTIVE SUBSCRIPTION's tier
	// (not the key's tier) so that a tenant who downgraded via
	// renewal is correctly subject to the lower tier's limits.
	rTier := subRecord.GetString("tier_key")
	rMax := maxMachinesForTier(rTier)
	if msg := machineLimitExceeded(app, tenant.Id, req.MachineID, rTier, rMax); msg != "" {
		return true, e.JSON(http.StatusConflict, map[string]any{
			"error": msg,
		})
	}

	// ── Register / update machine ──────────────────────────
	// The key is already activated by this tenant (proven above),
	// so ownership is assumed — no conflict check needed.
	if _, saveErr := registerMachine(app, req.MachineID, tenant.Id, false); saveErr != nil {
		log.Printf("H1 audit: machine registration failed on re-activation (id=%q tenant_id=%q): %v",
			req.MachineID, tenant.Id, saveErr)
	}

	resp := map[string]any{
		"signed_payload": subRecord.GetString("signed_payload"),
		"signature":      subRecord.GetString("signature"),
		"tenant_id":      tenant.Id,
	}

	// The stored api_key is a one-way bcrypt hash and can never
	// be re-emitted. A caller who proved they hold the current
	// key (email + key bound to this tenant AND a matching
	// api_key) needs no re-emit.
	if !verifyAPIKey(tenant.GetString("api_key"), req.APIKey) {
		if req.RecoveryCode == "" {
			resp["api_key_rotation"] = map[string]any{
				"status": "recovery_required",
			}
		} else {
			if handled, err, newKey := rotateAPIKey(app, e, req, tenant); handled {
				return true, err
			} else if newKey != "" {
				resp["api_key"] = newKey
			}
		}
	}

	// Clear any accumulated failure tracking for this key
	// since the activation is valid.
	keyFailTracker.clearKey(req.Key)

	return true, e.JSON(http.StatusOK, resp)
}

// handleExistingTenantNewKey authenticates a NEW key activation against an
// existing tenant. Returns (handled, err, issuedAPIKey):
//
//   - handled=true → a response was written; the caller must return err.
//   - issuedAPIKey non-empty → a webhook-issued key (paddle_sub_id /
//     midtrans_sub_id) minted a fresh api_key the caller must return so
//     /status and /renew work for the POS.
//
// The caller must prove they are the registered tenant admin by presenting
// the api_key issued on first activation. EXCEPTION: webhook-issued keys are
// bound to this tenant's email at purchase, so email + key is sufficient
// proof (the same model as re-activation); their api_key is minted NOW and
// returned in the response — the webhook only stored a placeholder hash
// (both providers upsert the tenant the same way).
func handleExistingTenantNewKey(
	app core.App,
	e *core.RequestEvent,
	req ActivateRequest,
	tenant *core.Record,
	keyRecord *core.Record,
	keyStatus string,
) (handled bool, err error, issuedAPIKey string) {
	if keyStatus == "unused" || keyStatus == "" {
		providerIssued := keyRecord.GetString("paddle_sub_id") != "" || keyRecord.GetString("midtrans_sub_id") != ""
		if providerIssued {
			newAPIKey := generateAPIKey()
			apiKeyHash, apiKeyLookup, hashErr := hashAPIKey(newAPIKey)
			if hashErr != nil {
				log.Printf("webhook-key activation api_key mint failed for tenant %q: %v", tenant.Id, hashErr)
				return true, e.JSON(http.StatusInternalServerError, map[string]any{
					"error": "failed to create api_key",
				}), ""
			}
			tenant.Set("api_key", apiKeyHash)
			tenant.Set("api_key_lookup", apiKeyLookup)
			if saveErr := app.Save(tenant); saveErr != nil {
				log.Printf("webhook-key activation api_key save failed for tenant %q: %v", tenant.Id, saveErr)
				return true, e.JSON(http.StatusInternalServerError, map[string]any{
					"error": "failed to create api_key",
				}), ""
			}
			return false, nil, newAPIKey
		}
		if !verifyAPIKey(tenant.GetString("api_key"), req.APIKey) {
			return true, e.JSON(http.StatusUnauthorized, map[string]any{
				"error": "api_key required (or mismatched) — caller is not the registered administrator of this tenant",
			}), ""
		}
		return false, nil, ""
	}
	// Key status is something unexpected (not unused, not activated).
	// Block the attempt. This handles "revoked" and other edge states.
	keyFailTracker.recordFailure(req.Key)
	return true, e.JSON(http.StatusUnauthorized, map[string]any{
		"error": "invalid or already used license key",
	}), ""
}

func handleActivate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		// Cap request body at 64KB to prevent OOM via oversized JSON payloads (M4 audit).
		e.Request.Body = http.MaxBytesReader(e.Response, e.Request.Body, 64*1024)
		var req ActivateRequest
		if err := json.NewDecoder(e.Request.Body).Decode(&req); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "invalid request body",
			})
		}

		// ── Authenticate via Authorization: Bearer <api_key> ──────
		// The Bearer header is the SOLE credential channel (C1-followup
		// hardening removed the legacy body `api_key` fallback — a body
		// credential leaks into CDN / webserver access logs that capture
		// request bodies). Two cases:
		//   * header present → it is authoritative (the body field is
		//     ignored for authentication);
		//   * header absent + body api_key present → the caller is a
		//     legacy client sending the credential where access logs can
		//     capture it — reject with a hint pointing at the header;
		//   * header absent + no body api_key → first-time activation
		//     has no credential yet (the server issues one) — proceed.
		authHeader := e.Request.Header.Get("Authorization")
		if strings.HasPrefix(authHeader, bearerPrefix) {
			apiKey := strings.TrimSpace(strings.TrimPrefix(authHeader, bearerPrefix))
			if apiKey == "" {
				e.Response.Header().Set("WWW-Authenticate", `Bearer realm="license"`)
				return e.JSON(http.StatusUnauthorized, map[string]any{
					"error": "api_key must be sent in the Authorization: Bearer <api_key> header (body api_key is no longer accepted)",
				})
			}
			req.APIKey = apiKey
		} else if req.APIKey != "" {
			e.Response.Header().Set("WWW-Authenticate", `Bearer realm="license"`)
			return e.JSON(http.StatusUnauthorized, map[string]any{
				"error": "api_key must be sent in the Authorization: Bearer <api_key> header (body api_key is no longer accepted)",
			})
		}

		// Normalize email to lowercase + trim so that lookup-by-email
		// is case-insensitive and whitespace-tolerant. Email addresses
		// are case-insensitive per RFC 5321 §2.4 in practice, and we
		// store them in canonical form to avoid creating duplicate
		// tenants for the same human.
		req.Email = strings.ToLower(strings.TrimSpace(req.Email))

		// ── Validate required fields ──────────────────────────────
		if req.Key == "" || req.Email == "" || req.MachineID == "" {
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "key, email, and machine_id are required",
			})
		}

		clientIP := e.RealIP()

		// ── Rate limit: 5 activations per IP per hour ─────────────
		if !ipRateLimiter.allow(clientIP) {
			return e.JSON(http.StatusTooManyRequests, map[string]any{
				"error": "rate limit exceeded, try again later",
			})
		}

		// ── Per-key brute-force: progressive cooldown ────
		if blocked, waitDuration := keyFailTracker.isBlocked(req.Key); blocked {
			// Round to seconds for a cleaner message
			waitStr := waitDuration.Round(time.Second).String()
			return e.JSON(http.StatusTooManyRequests, map[string]any{
				"error": "too many attempts for this key, try again in " + waitStr,
			})
		}

		// ── Validate license key FIRST ──────────────────────────
		// Key lookup is read-only and happens before any lock
		// acquisition to determine whether this is a re-activation
		// or new activation (which determines the lock strategy).
		// The per-key lock is acquired later, inside the appropriate
		// branch, to maintain consistent lock ordering with renew.go
		// (tenant→key) and avoid deadlock.
		// Look up the key record before touching tenant state, so we
		// can check whether this is a re-activation of an already-
		// activated key — which lets us skip the api_key requirement
		// when the caller already proved knowledge of the email + key.
		keyRecord, err := app.FindFirstRecordByData("license_keys", "key", req.Key)
		if err != nil {
			keyFailTracker.recordFailure(req.Key)
			return e.JSON(http.StatusUnauthorized, map[string]any{
				"error": "invalid license key",
			})
		}

		keyStatus := keyRecord.GetString("status")
		activatedBy := ""

		// ── Find or Create tenant record by Email ─────────────────
		var isNewTenant bool
		// Plaintext api_key to return in the response, if any. The stored
		// value is a bcrypt hash, so the plaintext is only ever available
		// here — at the moment it is minted (or rotated).
		var issuedAPIKey string
		tenant, err := app.FindFirstRecordByData("tenants", "email", req.Email)
		if err != nil {
			// Tenant not found by email. Before creating one, check
			// whether the key itself is still valid for new activation.
			// If the key is already activated (wrong email — the key
			// belongs to a different tenant), revoked, or in any other
			// non-unused state, reject immediately WITHOUT creating a
			// spurious tenant record that would never be cleaned up.
			if keyStatus != "unused" && keyStatus != "" {
				errMsg := "invalid or already used license key"
				keyFailTracker.recordFailure(req.Key)
				return e.JSON(http.StatusUnauthorized, map[string]any{
					"error": errMsg,
				})
			}

			isNewTenant = true

			// ── Per-key activation lock ─────────────────────────
			// Acquired BEFORE tenant creation to prevent:
			// (a) orphaned tenant records from concurrent same-key
			//     requests that both read keyStatus=="unused"
			// (b) activation overwrite where a stale keyStatus
			//     allows re-activating an already-activated key.
			// For new tenants there is no tenant lock (no existing
			// tenant to lock on), so key-only ordering is safe and
			// consistent with renew.go (no cross-path deadlock).
			unlock := activationLocks.lock(req.Key)
			defer unlock()

			// Re-read key status under lock — another request may
			// have activated this key between our initial read and
			// lock acquisition.
			keyRecord, err = app.FindFirstRecordByData("license_keys", "key", req.Key)
			if err != nil || (keyRecord.GetString("status") != "unused" && keyRecord.GetString("status") != "") {
				keyFailTracker.recordFailure(req.Key)
				return e.JSON(http.StatusUnauthorized, map[string]any{
					"error": "invalid or already used license key",
				})
			}
			keyStatus = keyRecord.GetString("status")

			tenantColl, collErr := app.FindCollectionByNameOrId("tenants")
			if collErr != nil {
				return e.JSON(http.StatusInternalServerError, map[string]any{
					"error": "server misconfiguration: tenants collection not found",
				})
			}
			tenant = core.NewRecord(tenantColl)
			tenant.Set("email", req.Email)
			// Persist the phone number from the activation request.
			// Falls back to "-" when empty so the required field
			// constraint on the tenants collection is satisfied.
			tenant.Set("phone", strDefault(req.Phone, "-"))
			issuedAPIKey = generateAPIKey()
			apiKeyHash, apiKeyLookup, hashErr := hashAPIKey(issuedAPIKey)
			if hashErr != nil {
				log.Printf("Failed to hash api_key: %v", hashErr)
				return e.JSON(http.StatusInternalServerError, map[string]any{
					"error": "failed to create tenant",
				})
			}
			tenant.Set("api_key", apiKeyHash)
			tenant.Set("api_key_lookup", apiKeyLookup)
			tenant.Set("status", "active")
			if saveErr := app.Save(tenant); saveErr != nil {
				log.Printf("Failed to save tenant: %v", saveErr)
				return e.JSON(http.StatusInternalServerError, map[string]any{
					"error": "failed to create tenant",
				})
			}
		} else {
			// Tenant exists — check status.
			if tenant.GetString("status") != "active" {
				return e.JSON(http.StatusForbidden, map[string]any{
					"error": "tenant account is suspended or revoked",
				})
			}

			// ── Per-tenant lock (mirrors renew.go Fix #3) ─────────
			// Serialise concurrent activations for the same tenant
			// (different keys) to prevent TOCTOU races on machine limits
			// and multiple active subscriptions.
			unlockTenant := tenantLocks.lock(tenant.Id)
			defer unlockTenant()

			// ── Per-key activation lock (tenant→key ordering) ─────
			// Acquired AFTER the tenant lock to maintain consistent
			// lock ordering with renew.go and avoid deadlock.
			unlock := activationLocks.lock(req.Key)
			defer unlock()

			// Re-read key status under lock — another request may
			// have activated this key between our initial read and
			// lock acquisition. Without this re-check, a stale
			// keyStatus=="unused" could cause a duplicate subscription.
			keyRecord, err = app.FindFirstRecordByData("license_keys", "key", req.Key)
			if err != nil {
				keyFailTracker.recordFailure(req.Key)
				return e.JSON(http.StatusUnauthorized, map[string]any{
					"error": "invalid or already used license key",
				})
			}
			keyStatus = keyRecord.GetString("status")
			activatedBy = ""

			// Resolve the activated_by tenant ID (defensive for legacy
			// JSON-array format). Only non-"unused" keys have an
			// activated_by relation set.
			if keyStatus != "unused" {
				activatedBy = keyRecord.GetString("activated_by")
				if strings.HasPrefix(activatedBy, "[") {
					if sl := keyRecord.GetStringSlice("activated_by"); len(sl) > 0 {
						activatedBy = sl[0]
					}
				}
			}

			// ── Re-activation: key already activated by this email's tenant ──
			// When the key is already activated and the activated_by tenant
			// matches this email's tenant, return the existing subscription
			// WITHOUT requiring the api_key. The email + key pair is sufficient
			// proof that the caller owns this activation.
			if handled, err := handleReactivation(app, e, req, tenant, keyRecord, keyStatus, activatedBy); handled {
				return err
			}

			// ── Key activated by a different tenant ───────────────
			// The key is already activated, but the activated_by tenant
			// does not match this email's tenant — the caller supplied an
			// email that doesn't belong to the key's owner. Use the same
			// generic message as unused/revoked keys to avoid leaking
			// whether a key exists and is activated (information disclosure).
			if keyStatus == "activated" && activatedBy != tenant.Id {
				keyFailTracker.recordFailure(req.Key)
				return e.JSON(http.StatusUnauthorized, map[string]any{
					"error": "invalid or already used license key",
				})
			}

			// ── New activation for existing tenant: api_key required ──
			// The caller must prove they are the registered tenant admin
			// by presenting the api_key that was issued on first activation.
			// EXCEPTION: webhook-issued keys (paddle_sub_id / midtrans_sub_id
			// set) are bound to this tenant's email at purchase, so email +
			// key is sufficient proof (the same model as re-activation). The
			// tenant's api_key is minted NOW and returned in the response so
			// /status and /renew work for the POS — the webhook only stored a
			// placeholder hash (both providers upsert the tenant the same way).
			if handled, err, newKey := handleExistingTenantNewKey(app, e, req, tenant, keyRecord, keyStatus); handled {
				return err
			} else if newKey != "" {
				issuedAPIKey = newKey
			}

		}

		tenantID := tenant.Id

		// ── Expiry check (only reached for unused keys on new tenants,
		//   or unused keys passing the api_key gate for existing tenants).
		if keyRecord.GetDateTime("expires_at").Time().Before(time.Now()) {
			return e.JSON(http.StatusGone, map[string]any{
				"error": "license key has expired",
			})
		}

		// ── Segmented trial resolution (C2.1) ─────────────────
		// Trial keys (license_keys.is_trial) mint a short-duration license
		// whose tier and length come from the request's trial_vertical (§4):
		// general signups get 14 days of Plus, restaurant/cafe signups get
		// 14 days of Pro, and enterprise referrals get 30 days of Pro.
		// Paid keys (is_trial = false) never enter this branch — their tier,
		// expiry, and quota block come solely from the key record, so a
		// forged trial_vertical can never downgrade or shorten a paid key.
		isTrialKey := keyRecord.GetBool("is_trial")
		var trialTier string
		var trialDays int
		if isTrialKey {
			trialTier, trialDays = trialSegmentation(req.TrialVertical)
		}

		// ── Hardware-fingerprint trial lock (SPEC-2026-TRIAL-LOCK) ──
		// One trial per physical device. Fires BEFORE the machine-count and
		// tenant_machines registration checks so a claimed device answers
		// 403 TRIAL_ALREADY_CLAIMED (the reset-abuse case) instead of a
		// misleading machine-conflict 409. The fingerprint is the client's
		// hardware-derived "hw_<hex>" (stable across reinstalls), falling
		// back to the machine_id for clients that don't send one; a claim
		// by the SAME tenant is a re-install re-activation and passes.
		if isTrialKey {
			if err := enforceTrialLock(app, req.HardwareFingerprint, req.MachineID, tenantID, trialDays); err != nil {
				if denied, ok := err.(*trialLockDenied); ok {
					return e.JSON(http.StatusForbidden, map[string]any{
						"code":                 denied.code,
						"message":              denied.message,
						"expired_at":           denied.expiredAt,
						"hardware_fingerprint": denied.fingerprint,
					})
				}
				return err
			}
		}

		// ── Machine count enforcement (H1 audit gap fix) ─────
		// Before registering, check that the tenant hasn't exceeded
		// their tier-based machine limit. Machine record IDs are
		// the SHA-256 fingerprint (same as req.MachineID).
		// Limits mirror the subscription tier quotas:
		//   Free:       1 machine
		//   Pro:        3 machines
		//   Premium:    10 machines
		//   Enterprise: unlimited
		tierForLimit := keyRecord.GetString("tier_key")
		// Trial keys are limited by the SEGMENTED tier (e.g. a restaurant
		// trial minted as Pro gets Pro's 3 machines), not the key's default.
		if isTrialKey {
			tierForLimit = trialTier
		}
		maxMachines := maxMachinesForTier(tierForLimit)
		if msg := machineLimitExceeded(app, tenantID, req.MachineID, tierForLimit, maxMachines); msg != "" {
			return e.JSON(http.StatusConflict, map[string]any{
				"error": msg,
			})
		}

		// ── Register machine (non-fatal: subscription is already valid) ──
		conflict, saveErr := registerMachine(app, req.MachineID, tenantID, true)
		if conflict {
			return e.JSON(http.StatusConflict, map[string]any{
				"error": "machine already registered to a different tenant",
			})
		}
		if saveErr != nil {
			log.Printf("H1 audit: machine registration failed (id=%q tenant_id=%q): %v", req.MachineID, tenantID, saveErr)
		}

		// ── Webhook-issued key: reuse the Paddle-created subscription ──
		// The Paddle webhook created the active subscription at purchase and
		// keeps it in sync via subscription.* events. Don't mint a duplicate
		// here — return the existing signed payload so the POS gets the same
		// tier/expiry Paddle authorized. Manual keys never hit this branch.
		if keyRecord.GetString("paddle_sub_id") != "" {
			subs, err := app.FindRecordsByFilter(
				"subscriptions",
				"tenant_id = {:tenant_id} && status = 'active'",
				"-starts_at", 1, 0,
				map[string]any{"tenant_id": tenantID},
			)
			if err == nil && len(subs) > 0 {
				subRecord := subs[0]
				keyRecord.Set("status", "activated")
				keyRecord.Set("activated_at", time.Now().UTC().Format(time.RFC3339))
				keyRecord.Set("activated_by", tenantID)
				if err := app.Save(keyRecord); err != nil {
					log.Printf("WARNING: failed to mark key %s as activated: %v", maskLicenseKey(req.Key), err)
				}
				keyFailTracker.clearKey(req.Key)
				resp := map[string]any{
					"signed_payload": subRecord.GetString("signed_payload"),
					"signature":      subRecord.GetString("signature"),
					"tenant_id":      tenantID,
				}
				if issuedAPIKey != "" {
					resp["api_key"] = issuedAPIKey
				}
				return e.JSON(http.StatusOK, resp)
			}
			// No active subscription yet (edge case: webhook raced the
			// activation) — fall through and create one from the key below.
		}

		// ── Build and sign subscription ───────────────────────────
		tierKey := keyRecord.GetString("tier_key")
		expiresAt := calculateExpiry(tierKey)
		maxStores := keyRecord.GetInt("max_stores")
		maxPOSInstances := keyRecord.GetInt("max_pos_instances")

		var allowedTypes []string
		if err := json.Unmarshal([]byte(keyRecord.GetString("allowed_types")), &allowedTypes); err != nil {
			allowedTypes = []string{}
		}

		// Trial keys: override the tier, expiry, and quota block with the
		// vertical segmentation (§4) plus the request's bundle (C3.2). The
		// key record's own values serve as the default for blank/unknown
		// verticals (trialSegmentation). tierQuotas applies the bundle: a
		// recognized bundle unlocks kds at the Plus tier.
		if isTrialKey {
			tierKey = trialTier
			expiresAt = time.Now().UTC().AddDate(0, 0, trialDays)
			maxStores, maxPOSInstances, allowedTypes = tierQuotas(trialTier, normalizeBundleID(req.BundleID))
		}

		sub := SubscriptionPayload{
			TenantID:        tenantID,
			TierKey:         tierKey,
			Status:          "active",
			MaxLocations:    maxStores,
			MaxPOSInstances: maxPOSInstances,
			AllowedTypes:    allowedTypes,
			StartsAt:        time.Now().UTC().Format(time.RFC3339),
			ExpiresAt:       expiresAt.Format(time.RFC3339),
			GraceUntil:      calculateGraceUntil(tierKey, expiresAt).Format(time.RFC3339),
			IssuedAt:        time.Now().UTC().Format(time.RFC3339),
		}

		// ── Build and sign subscription payload ───────────────────
		payloadStr, signature, err := signSubscription(sub)
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{
				"error": "signing failed",
			})
		}

		// ── Save subscription record ──────────────────────────────
		subColl, err := app.FindCollectionByNameOrId("subscriptions")
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{
				"error": "server misconfiguration: subscriptions collection not found",
			})
		}
		subRecord := core.NewRecord(subColl)
		subRecord.Set("tenant_id", tenantID)
		subRecord.Set("tier_key", tierKey)
		subRecord.Set("status", "active")
		subRecord.Set("starts_at", sub.StartsAt)
		subRecord.Set("expires_at", sub.ExpiresAt)
		subRecord.Set("grace_until", sub.GraceUntil)
		// Persist the quota block on the subscription record so /status reads
		// real values (mirrors renew.go's M5-audit fix). Storage keeps the
		// historical max_stores field name (1g renamed the wire only).
		subRecord.Set("max_stores", sub.MaxLocations)
		subRecord.Set("max_pos_instances", sub.MaxPOSInstances)
		if b, err := json.Marshal(sub.AllowedTypes); err == nil {
			subRecord.Set("allowed_types", string(b))
		}
		subRecord.Set("signed_payload", payloadStr)
		subRecord.Set("signature", signature)
		if err := app.Save(subRecord); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{
				"error": "failed to save subscription",
			})
		}

		// ── Mark key as activated ─────────────────────────────────
		keyRecord.Set("status", "activated")
		keyRecord.Set("activated_at", time.Now().UTC().Format(time.RFC3339))
		keyRecord.Set("activated_by", tenantID)
		if err := app.Save(keyRecord); err != nil {
			log.Printf("WARNING: failed to mark key %s as activated: %v", maskLicenseKey(req.Key), err)
		}

		// ── Clear failure tracking for this key ─────────────────
		// The activation succeeded — any prior failed attempts against
		// this key should be cleared so a legitimate re-activation
		// (e.g. after reinstalling on a new machine) isn't blocked
		// by the brute-force cooldown from earlier typos.
		keyFailTracker.clearKey(req.Key)

		// ── Lightweight repeat-email detector (NOT the trial-lock gate) ──
		// Every successful TRIAL activation records the (email, device)
		// fingerprint; a second claim by the same email on the same device
		// (the same-tenant reinstall case the full SPEC-2026-TRIAL-LOCK
		// gate allows by design) bumps the count and is surfaced as
		// repeat_claim so the client can warn without blocking. Paid keys
		// are never recorded — the detector watches trial claims only.
		var repeatClaim any
		if isTrialKey {
			if count, firstAt := recordTrialClaim(app, req.Email, req.MachineID, tenantID, req.Key); count > 1 {
				repeatClaim = map[string]any{
					"count":            count,
					"first_claimed_at": firstAt,
				}
			}
		}

		// ── Return signed subscription to POS ─────────────────────
		resp := map[string]any{
			"signed_payload": payloadStr,
			"signature":      signature,
			"tenant_id":      tenantID,
		}
		if repeatClaim != nil {
			resp["repeat_claim"] = repeatClaim
		}
		// api_key is included only for newly created tenants (so the POS can
		// persist it). The stored value is a bcrypt hash, so the plaintext
		// issuedAPIKey captured at mint time is returned here. Re-activation
		// of an already-activated key is handled earlier (rotation). Existing
		// tenants activating a new key already proved they hold the key, so
		// nothing is re-emitted (H1 audit).
		if isNewTenant || issuedAPIKey != "" {
			resp["api_key"] = issuedAPIKey
		}
		return e.JSON(http.StatusOK, resp)
	}
}
