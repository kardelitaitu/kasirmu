package main

// Tenant lifecycle management endpoints (ADR #42 Phase 4) — admin-side
// operations that go beyond the Phase 3 status flips: contact edit,
// per-device revoke, manual subscription grant, and a guarded cascade
// delete. All endpoints go through adminAuth (Bearer OZ_ADMIN_KEY or an
// admin web session) exactly like the Phase 3 endpoints.
//
// Endpoints:
//
//	PATCH  /api/v1/admin/tenants/{id}                           — edit email/phone
//	POST   /api/v1/admin/tenants/{id}/devices/{deviceId}/revoke — revoke one device
//	POST   /api/v1/admin/tenants/{id}/grant-subscription        — manual subscription (transfer-paid customers)
//	DELETE /api/v1/admin/tenants/{id}                           — guarded cascade delete

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// isAdminTenantRecord reports whether the record is the admin tenant
// (OZ_ADMIN_EMAIL) — the account adminAuth maps sessions to. Its email
// must never change (it would break the auth mapping) and it must never
// be deleted (it would lock every admin session out).
func isAdminTenantRecord(tenant *core.Record) bool {
	adminEmail := strings.TrimSpace(os.Getenv("OZ_ADMIN_EMAIL"))
	if adminEmail == "" {
		adminEmail = defaultAdminEmail
	}
	return strings.EqualFold(tenant.GetString("email"), adminEmail)
}

// parseAllowedTypesJSON decodes the subscriptions.allowed_types JSON
// column back into the slice the signed payload needs.
func parseAllowedTypesJSON(s string) []string {
	if s == "" {
		return nil
	}
	var types []string
	if err := json.Unmarshal([]byte(s), &types); err != nil {
		return nil
	}
	return types
}

// parseInclusiveDate parses "YYYY-MM-DD" into the END of that UTC day
// (23:59:59Z) — the operator intent for an expiry date is "paid through
// that day", not "cut off at midnight of the day before".
func parseInclusiveDate(s string) (time.Time, error) {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return time.Time{}, err
	}
	return time.Date(t.Year(), t.Month(), t.Day(), 23, 59, 59, 0, time.UTC), nil
}

// ── PATCH /api/v1/admin/tenants/{id} ──────────────────────────────

// tenantUpdateRequest is the body for the contact-edit endpoint. Either
// field may be omitted; sending neither is a 400 (no-op PATCH is a bug).
type tenantUpdateRequest struct {
	Email string `json:"email"`
	Phone string `json:"phone"`
}

// handleAdminUpdateTenant edits a tenant's contact details.
// Email changes are normalized, validated, and uniqueness-checked (409 on
// collision). The admin tenant's email is immutable (adminAuth maps to it).
func handleAdminUpdateTenant(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		if !adminAuth(app, e) {
			return nil
		}
		tenant, err := app.FindRecordById("tenants", e.Request.PathValue("id"))
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{"error": "tenant not found"})
		}
		if e.Request.Body == nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "JSON body required"})
		}
		var req tenantUpdateRequest
		if err := json.NewDecoder(e.Request.Body).Decode(&req); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "invalid JSON body"})
		}
		if req.Email == "" && req.Phone == "" {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "nothing to update"})
		}

		if req.Email != "" && !strings.EqualFold(normalizeEmail(req.Email), tenant.GetString("email")) {
			if isAdminTenantRecord(tenant) {
				return e.JSON(http.StatusBadRequest, map[string]any{"error": "admin tenant email cannot be changed"})
			}
			email := normalizeEmail(req.Email)
			if !isValidEmail(email) {
				return e.JSON(http.StatusBadRequest, map[string]any{"error": "invalid email"})
			}
			// Email is the tenant's primary lookup — a collision would
			// silently merge two accounts' views.
			dupes, _ := app.FindRecordsByFilter("tenants", "email = {:email}", "", 1, 0,
				map[string]any{"email": email})
			if len(dupes) > 0 {
				return e.JSON(http.StatusConflict, map[string]any{"error": "email already in use"})
			}
			tenant.Set("email", email)
		}
		if req.Phone != "" {
			phone := strings.TrimSpace(req.Phone)
			if phone != tenant.GetString("phone") {
				tenant.Set("phone", phone)
			}
		}
		if err := app.Save(tenant); err != nil {
			log.Printf("/admin/tenants/%s (patch): save failed: %v", tenant.Id, err)
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "update failed"})
		}
		log.Printf("/admin/tenants/%s (patch): tenant %q contact updated", tenant.Id, tenant.GetString("email"))
		return e.JSON(http.StatusOK, map[string]any{
			"tenant": map[string]any{
				"id":    tenant.Id,
				"email": tenant.GetString("email"),
				"phone": tenant.GetString("phone"),
			},
		})
	}
}

// ── POST /api/v1/admin/tenants/{id}/devices/{deviceId}/revoke ─────

// handleAdminRevokeDevice revokes one POS device. Mirrors the tenant's own
// handleWebRevokeDevice semantics (idempotent, 404 covers both "missing"
// and "belongs to someone else" so no existence leaks across tenants) but
// is guarded by adminAuth instead of a tenant session.
func handleAdminRevokeDevice(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		if !adminAuth(app, e) {
			return nil
		}
		tenantID := e.Request.PathValue("id")
		deviceID := e.Request.PathValue("deviceId")
		if deviceID == "" {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "device id is required"})
		}
		machine, err := app.FindRecordById("tenant_machines", deviceID)
		if err != nil || machine.GetString("tenant_id") != tenantID {
			return e.JSON(http.StatusNotFound, map[string]any{"error": "device not found"})
		}
		// Idempotent: already-revoked devices return the existing timestamp
		// (formatDateField — GetString leaks PocketBase's internal form).
		if existing := formatDateField(machine, "revoked_at"); existing != "" {
			return e.JSON(http.StatusOK, map[string]any{"status": "revoked", "revoked_at": existing})
		}
		now := time.Now().UTC().Format(time.RFC3339)
		machine.Set("revoked_at", now)
		if err := app.Save(machine); err != nil {
			log.Printf("/admin/tenants/%s/devices/%s/revoke: save failed: %v", tenantID, deviceID, err)
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "revoke failed"})
		}
		log.Printf("/admin/tenants/%s/devices/%s/revoke: device %q revoked by admin", tenantID, deviceID, machine.GetString("machine_id"))
		return e.JSON(http.StatusOK, map[string]any{"status": "revoked", "revoked_at": now, "machine_id": machine.GetString("machine_id")})
	}
}

// ── POST /api/v1/admin/tenants/{id}/grant-subscription ────────────

// grantSubscriptionRequest is the body for the manual grant endpoint —
// the path for transfer/e-wallet customers who paid outside Paddle and
// Midtrans. Exactly one of Months/ExpiresAt; Reason is mandatory (audit).
type grantSubscriptionRequest struct {
	TierKey   string `json:"tier_key"`
	Months    int    `json:"months"`
	ExpiresAt string `json:"expires_at"`
	Reason    string `json:"reason"`
}

// handleAdminGrantSubscription creates a fully signed subscription record
// via the same template the payment webhooks use (tierQuotas, grace calc,
// signSubscription), so the POS trusts a manual grant exactly like a paid
// one. Refuses to stack on an active subscription (use renew/tier-override
// instead) and re-activates a revoked/suspended tenant.
func handleAdminGrantSubscription(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		if !adminAuth(app, e) {
			return nil
		}
		tenant, err := app.FindRecordById("tenants", e.Request.PathValue("id"))
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{"error": "tenant not found"})
		}
		if e.Request.Body == nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "JSON body required"})
		}
		var req grantSubscriptionRequest
		if err := json.NewDecoder(e.Request.Body).Decode(&req); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "invalid JSON body"})
		}
		if req.Reason == "" {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "reason is required (audit trail)"})
		}
		if _, known := TierPriceUSD[req.TierKey]; !known {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "unknown tier_key"})
		}
		if req.Months < 0 {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "months must be positive"})
		}
		if req.Months > 0 && req.ExpiresAt != "" {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "use months or expires_at, not both"})
		}

		now := time.Now().UTC()
		var expiresAt time.Time
		if req.ExpiresAt != "" {
			t, err := parseInclusiveDate(req.ExpiresAt)
			if err != nil {
				return e.JSON(http.StatusBadRequest, map[string]any{"error": "expires_at must be YYYY-MM-DD"})
			}
			if !t.After(now) {
				return e.JSON(http.StatusBadRequest, map[string]any{"error": "expires_at must be in the future"})
			}
			expiresAt = t
		} else {
			if req.Months == 0 {
				req.Months = 12
			}
			expiresAt = now.AddDate(0, req.Months, 0)
		}

		// Conflict: stacking a manual grant on an active subscription
		// would shadow it (subscriptionSummary returns the latest record).
		subs, subErr := app.FindRecordsByFilter("subscriptions",
			"tenant_id = {:tid}", "-starts_at", 1, 0,
			map[string]any{"tid": tenant.Id})
		if subErr == nil && len(subs) > 0 && subs[0].GetString("status") == "active" {
			return e.JSON(http.StatusConflict, map[string]any{"error": "active subscription exists; use renew or tier-override"})
		}

		// ── Webhook-equivalent provisioning (paddle_webhook.go:942-996) ──
		maxStores, maxPOS, allowedTypes := tierQuotas(req.TierKey, "")
		startsAt := now.Format(time.RFC3339)
		expires := expiresAt.Format(time.RFC3339)
		grace := calculateGraceUntil(expiresAt).Format(time.RFC3339)
		payload := SubscriptionPayload{
			TenantID:        tenant.Id,
			TierKey:         req.TierKey,
			Status:          "active",
			MaxLocations:    maxStores,
			MaxPOSInstances: maxPOS,
			AllowedTypes:    allowedTypes,
			StartsAt:        startsAt,
			ExpiresAt:       expires,
			GraceUntil:      grace,
			IssuedAt:        startsAt,
		}
		payloadStr, signature, err := signSubscription(payload)
		if err != nil {
			log.Printf("/admin/tenants/%s/grant-subscription: sign failed: %v", tenant.Id, err)
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "grant failed"})
		}
		subCol, collErr := app.FindCollectionByNameOrId("subscriptions")
		if collErr != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "grant failed"})
		}
		subRecord := core.NewRecord(subCol)
		subRecord.Set("payment_provider", "manual")
		subRecord.Set("bundle_id", "")
		subRecord.Set("tenant_id", []string{tenant.Id})
		subRecord.Set("tier_key", req.TierKey)
		subRecord.Set("status", "active")
		subRecord.Set("starts_at", startsAt)
		subRecord.Set("expires_at", expires)
		subRecord.Set("grace_until", grace)
		// Persist the quota block so /status and later re-signs read
		// current values instead of zero values (mirrors renew.go M5).
		subRecord.Set("max_stores", maxStores)
		subRecord.Set("max_pos_instances", maxPOS)
		if b, err := json.Marshal(allowedTypes); err == nil {
			subRecord.Set("allowed_types", string(b))
		}
		subRecord.Set("signed_payload", payloadStr)
		subRecord.Set("signature", signature)
		if saveErr := app.Save(subRecord); saveErr != nil {
			log.Printf("/admin/tenants/%s/grant-subscription: save failed: %v", tenant.Id, saveErr)
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "grant failed"})
		}
		// A tenant that just paid must not stay revoked/suspended.
		if tenant.GetString("status") != "active" {
			tenant.Set("status", "active")
			if saveErr := app.Save(tenant); saveErr != nil {
				log.Printf("/admin/tenants/%s/grant-subscription: tenant status flip failed: %v", tenant.Id, saveErr)
			}
		}
		log.Printf("/admin/tenants/%s/grant-subscription: tenant %q → %s until %s (reason: %q)",
			tenant.Id, tenant.GetString("email"), req.TierKey, expires, safePrefix(req.Reason, 200))
		return e.JSON(http.StatusOK, map[string]any{
			"status":     "active",
			"tier_key":   req.TierKey,
			"expires_at": expires,
		})
	}
}

// ── DELETE /api/v1/admin/tenants/{id} ─────────────────────────────

// deleteTenantRequest is the body for the guarded cascade delete.
type deleteTenantRequest struct {
	// Must equal the tenant email (case-insensitive) — a server-side
	// double-key mirroring the UI's confirm-by-email gate.
	ConfirmEmail string `json:"confirm_email"`
	Reason       string `json:"reason"`
}

// handleAdminDeleteTenant removes a tenant and everything attached to it:
// tenant_machines and subscriptions are deleted, license_keys keep their
// rows (financial audit trail) but lose the activated_by link, web
// sessions for the tenant are swept, then the tenant record goes.
// The admin tenant itself is undeletable.
func handleAdminDeleteTenant(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		if !adminAuth(app, e) {
			return nil
		}
		tenant, err := app.FindRecordById("tenants", e.Request.PathValue("id"))
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{"error": "tenant not found"})
		}
		var req deleteTenantRequest
		if e.Request.Body != nil {
			_ = json.NewDecoder(e.Request.Body).Decode(&req) // malformed/empty → confirm mismatch below
		}
		if normalizeEmail(req.ConfirmEmail) != tenant.GetString("email") {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "confirm_email must match the tenant email"})
		}
		if isAdminTenantRecord(tenant) {
			return e.JSON(http.StatusForbidden, map[string]any{"error": "the admin tenant cannot be deleted"})
		}

		// 1. Devices.
		machines, _ := app.FindRecordsByFilter("tenant_machines", "tenant_id = {:tid}", "", 0, 0,
			map[string]any{"tid": tenant.Id})
		machinesDeleted := 0
		for _, m := range machines {
			if app.Delete(m) == nil {
				machinesDeleted++
			}
		}
		// 2. Subscriptions (signed payloads die with the tenant).
		subs, _ := app.FindRecordsByFilter("subscriptions", "tenant_id = {:tid}", "", 0, 0,
			map[string]any{"tid": tenant.Id})
		subsDeleted := 0
		for _, s := range subs {
			if app.Delete(s) == nil {
				subsDeleted++
			}
		}
		// 3. License keys: clear the relation, KEEP the rows — minted keys
		// are the financial audit trail for real payments.
		keys, _ := app.FindRecordsByFilter("license_keys", "activated_by = {:tid}", "", 0, 0,
			map[string]any{"tid": tenant.Id})
		keysUnlinked := 0
		for _, k := range keys {
			k.Set("activated_by", "")
			if app.Save(k) == nil {
				keysUnlinked++
			}
		}
		// 4. Web sessions (the tenant's dashboard logins die immediately).
		sessionsDropped := webOtpStore.deleteSessionsForTenant(tenant.Id)
		// 5. The tenant record itself.
		if err := app.Delete(tenant); err != nil {
			log.Printf("/admin/tenants/%s (delete): tenant delete failed: %v", tenant.Id, err)
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "delete failed"})
		}
		log.Printf("/admin/tenants/%s (delete): tenant %q deleted by admin — machines=%d subs=%d keys_unlinked=%d sessions=%d (reason: %q)",
			tenant.Id, tenant.GetString("email"), machinesDeleted, subsDeleted, keysUnlinked, sessionsDropped, safePrefix(req.Reason, 200))
		return e.JSON(http.StatusOK, map[string]any{
			"deleted":          true,
			"machines":         machinesDeleted,
			"subscriptions":    subsDeleted,
			"keys_unlinked":    keysUnlinked,
			"sessions_dropped": sessionsDropped,
		})
	}
}
