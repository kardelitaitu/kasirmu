package main

// Admin dashboard API endpoints (ADR #42 Phase 3) — internal operations
// for the OZ-POS admin panel at admin.ozpos.my.id. All endpoints require
// Authorization: Bearer <OZ_ADMIN_KEY> (a server-side secret, never the
// tenant API key). They expose tenant management: list, drill-down, and
// lifecycle actions (activate/renew/revoke/tier-override).
//
// Endpoints:
//
//	GET  /api/v1/admin/tenants            — list tenants (paginated, filterable)
//	GET  /api/v1/admin/tenants/{id}       — single tenant detail + summary
//	POST /api/v1/admin/tenants/{id}/activate — activate license for tenant
//	POST /api/v1/admin/tenants/{id}/renew     — extend subscription expiry
//	POST /api/v1/admin/tenants/{id}/revoke    — revoke tenant access
//	POST /api/v1/admin/tenants/{id}/tier-override — set tier (with audit reason)
//	GET  /api/v1/admin/health             — server + DB health

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// adminDashboardVersion is the version string reported by
// GET /api/v1/admin/health. B31: it was a stale literal ("0.0.31") — the
// health card lied about what was deployed. Keep in sync with the repo
// version lock (AGENTS.md); TestAdminHealthB31 now pins it against the
// workspace Cargo.toml rather than against a copy of itself, so a bump that
// misses this file goes red instead of silently misreporting.
// scripts/bump-version.ps1 updates this line as part of a bump.
const adminDashboardVersion = "0.0.37"

// adminKeyOK validates the Authorization: Bearer <admin_key> header.
// Reads the key from OZ_ADMIN_KEY env; a missing env or wrong key is 401.
// LSE-8: the comparison is constant-time — every other secret comparison
// in this service (api_keys, OTP codes, webhook signatures) already was.
func adminKeyOK(e *core.RequestEvent) bool {
	authHeader := e.Request.Header.Get("Authorization")
	if !strings.HasPrefix(authHeader, bearerPrefix) {
		return false
	}
	provided := strings.TrimSpace(strings.TrimPrefix(authHeader, bearerPrefix))
	expected := strings.TrimSpace(os.Getenv("OZ_ADMIN_KEY"))
	if expected == "" || provided == "" || len(provided) != len(expected) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) == 1
}

// adminAuth is the middleware wrapper for admin endpoints: returns a 401
// JSON response (and false) when the caller is neither the admin key holder
// (server-to-server) nor a signed-in web session belonging to the admin
// tenant (OZ_ADMIN_EMAIL). The admin dashboard uses the browser session;
// scripts and the cloud server use the admin key.
func adminAuth(app core.App, e *core.RequestEvent) bool {
	if adminKeyOK(e) {
		return true
	}
	// Fall back to a web session owned by the admin tenant.
	token, err := extractBearerToken(e)
	if err != nil {
		e.JSON(http.StatusUnauthorized, map[string]any{
			"error": "Authorization: Bearer <admin_key> header required",
		})
		return false
	}
	tenantID := webOtpStore.getSession(hashWebToken(token))
	if tenantID == "" {
		e.JSON(http.StatusUnauthorized, map[string]any{
			"error": "Authorization: Bearer <admin_key> header required",
		})
		return false
	}
	tenant, err := app.FindRecordById("tenants", tenantID)
	if err != nil {
		return false
	}
	adminEmail := strings.TrimSpace(os.Getenv("OZ_ADMIN_EMAIL"))
	if adminEmail == "" {
		adminEmail = defaultAdminEmail
	}
	if strings.EqualFold(tenant.GetString("email"), adminEmail) {
		return true
	}
	e.JSON(http.StatusForbidden, map[string]any{
		"error": "account is not an admin",
	})
	return false
}

// ── GET /api/v1/admin/tenants ─────────────────────────────────────

// handleAdminListTenants returns a paginated tenant list with summary
// counts. Supports ?page=, ?perPage=, and ?search= query params.
func handleAdminListTenants(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		if !adminAuth(app, e) {
			return nil
		}
		page := atoiDefault(e.Request.URL.Query().Get("page"), 1)
		perPage := atoiDefault(e.Request.URL.Query().Get("perPage"), 25)
		if perPage < 1 || perPage > 100 {
			perPage = 25
		}
		if page < 1 {
			page = 1
		}

		search := strings.TrimSpace(e.Request.URL.Query().Get("search"))
		filter := "status != ''"
		var params map[string]any
		if search != "" {
			// Email is stored lowercased (normalizeEmail). Use a simple
			// substring regex (case-sensitive, since both sides are lowered).
			lc := strings.ToLower(search)
			filter += " && email ~ {:search}"
			params = map[string]any{"search": regexp.QuoteMeta(lc)}
		}

		// Total count (for pagination controls) — uses the established
		// FindRecordsByFilter + len pattern (no dbx.Expression needed).
		all, err := app.FindRecordsByFilter("tenants", filter, "-created", 0, 0, params)
		if err != nil {
			log.Printf("/admin/tenants: count failed: %v", err)
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "query failed"})
		}
		total := len(all)

		records, err := app.FindRecordsByFilter("tenants",
			filter, "-created", perPage, (page-1)*perPage, params)
		if err != nil {
			log.Printf("/admin/tenants: query failed: %v", err)
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "query failed"})
		}

		tenants := make([]map[string]any, 0, len(records))
		for _, rec := range records {
			tenants = append(tenants, map[string]any{
				"id":            rec.Id,
				"email":         rec.GetString("email"),
				"status":        rec.GetString("status"),
				"emailVerified": rec.GetBool("email_verified"),
				"license":       licenseSummary(app, rec.Id),
				"subscription":  subscriptionSummary(app, rec.Id),
				"health":        tenantHealth(app, rec),
				"created":       rec.GetDateTime("created").Time().Format(time.RFC3339),
			})
		}

		return e.JSON(http.StatusOK, map[string]any{
			"tenants": tenants,
			"page":    page,
			"perPage": perPage,
			"total":   total,
			"search":  search,
		})
	}
}

// ── GET /api/v1/admin/tenants/{id} ────────────────────────────────

// handleAdminGetTenant returns the full detail for one tenant including
// its license, subscription, and device list.
func handleAdminGetTenant(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		if !adminAuth(app, e) {
			return nil
		}
		tenantID := e.Request.PathValue("id")
		tenant, err := app.FindRecordById("tenants", tenantID)
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{"error": "tenant not found"})
		}

		// Device list.
		machines, _ := app.FindRecordsByFilter("tenant_machines",
			"tenant_id = {:tid}", "-created", 0, 0,
			map[string]any{"tid": tenant.Id})
		devices := make([]map[string]any, 0, len(machines))
		for _, m := range machines {
			devices = append(devices, map[string]any{
				"id":           m.Id,
				"machine_id":   m.GetString("machine_id"),
				"last_seen_at": formatDateField(m, "last_seen_at"),
				"revoked_at":   formatDateField(m, "revoked_at"),
			})
		}

		return e.JSON(http.StatusOK, map[string]any{
			"tenant": map[string]any{
				"id":            tenant.Id,
				"email":         tenant.GetString("email"),
				"phone":         tenant.GetString("phone"),
				"status":        tenant.GetString("status"),
				"emailVerified": tenant.GetBool("email_verified"),
				"created":       tenant.GetDateTime("created").Time().Format(time.RFC3339),
			},
			"license":      licenseSummary(app, tenant.Id),
			"subscription": subscriptionSummary(app, tenant.Id),
			"health":       tenantHealth(app, tenant),
			"devices":      devices,
		})
	}
}

// ── POST /api/v1/admin/tenants/{id}/activate ─────────────────────

// handleAdminActivate marks a tenant active. Requires OZ_ADMIN_KEY.
func handleAdminActivate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		if !adminAuth(app, e) {
			return nil
		}
		tenant, err := app.FindRecordById("tenants", e.Request.PathValue("id"))
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{"error": "tenant not found"})
		}
		tenant.Set("status", "active")
		if err := app.Save(tenant); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "activate failed"})
		}
		log.Printf("/admin/tenants/%s/activate: tenant %q activated", tenant.Id, tenant.GetString("email"))
		return e.JSON(http.StatusOK, map[string]any{"status": "active"})
	}
}

// ── POST /api/v1/admin/tenants/{id}/renew ─────────────────────────

// renewRequest is the body for the renew endpoint.
type renewRequest struct {
	// Days to extend the subscription expiry by (default 365).
	Days int `json:"days"`
	// Optional exact expiry "YYYY-MM-DD" (inclusive — stored as the end
	// of that UTC day). Mutually exclusive with Days.
	ExpiresAt string `json:"expires_at"`
}

// handleAdminRenew extends the tenant's latest subscription expiry — by
// days (default 365) or to an exact date. Any change RE-SIGNS the
// subscription: the row and the signed payload must agree or the POS's
// offline trust checks diverge (the tenant-facing renew endpoint always
// re-signed; the admin path previously left a stale signature behind).
func handleAdminRenew(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		if !adminAuth(app, e) {
			return nil
		}
		tenant, err := app.FindRecordById("tenants", e.Request.PathValue("id"))
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{"error": "tenant not found"})
		}

		var req renewRequest
		if e.Request.Body != nil {
			_ = json.NewDecoder(e.Request.Body).Decode(&req)
		}
		if req.ExpiresAt != "" && req.Days > 0 {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "use days or expires_at, not both"})
		}

		// Find the latest subscription.
		subs, err := app.FindRecordsByFilter("subscriptions",
			"tenant_id = {:tid}", "-starts_at", 1, 0,
			map[string]any{"tid": tenant.Id})
		if err != nil || len(subs) == 0 {
			return e.JSON(http.StatusNotFound, map[string]any{"error": "no subscription found"})
		}
		sub := subs[0]

		var newExpiry time.Time
		if req.ExpiresAt != "" {
			t, err := parseInclusiveDate(req.ExpiresAt)
			if err != nil {
				return e.JSON(http.StatusBadRequest, map[string]any{"error": "expires_at must be YYYY-MM-DD"})
			}
			if !t.After(time.Now().UTC()) {
				return e.JSON(http.StatusBadRequest, map[string]any{"error": "expires_at must be in the future"})
			}
			newExpiry = t
		} else {
			if req.Days <= 0 {
				req.Days = 365
			}
			// B29: the old code anchored at time.Now(), so
			// renewing a subscription that still had months of paid time left
			// silently TRUNCATED it (2027-01-01 +30d became ~now+30d). Live
			// subs extend from their current expiry; expired ones renew from
			// now — max(now, expires_at) semantics.
			base := time.Now().UTC()
			if cur := sub.GetDateTime("expires_at").Time(); cur.After(base) {
				base = cur
			}
			newExpiry = base.Add(time.Duration(req.Days) * 24 * time.Hour)
		}
		newExpiryStr := newExpiry.Format(time.RFC3339)
		sub.Set("expires_at", newExpiryStr)
		sub.Set("status", "active")
		// Grace must move with the expiry so row and payload agree.
		grace := calculateGraceUntil(sub.GetString("tier_key"), newExpiry).Format(time.RFC3339)
		sub.Set("grace_until", grace)
		// Re-sign with the current tier/quotas and the new expiry.
		payload := SubscriptionPayload{
			TenantID:        tenant.Id,
			TierKey:         sub.GetString("tier_key"),
			Status:          "active",
			MaxLocations:    sub.GetInt("max_stores"),
			MaxPOSInstances: sub.GetInt("max_pos_instances"),
			AllowedTypes:    parseAllowedTypesJSON(sub.GetString("allowed_types")),
			StartsAt:        formatDateField(sub, "starts_at"),
			ExpiresAt:       newExpiryStr,
			GraceUntil:      grace,
			IssuedAt:        time.Now().UTC().Format(time.RFC3339),
		}
		// D2: carry any admin-authored per-feature grants into the signed payload.
		payload.Features = featureGrantsForTenant(app, tenant.Id)
		payloadStr, signature, signErr := signSubscription(payload)
		if signErr != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "renew failed"})
		}
		sub.Set("signed_payload", payloadStr)
		sub.Set("signature", signature)
		if err := app.Save(sub); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "renew failed"})
		}

		log.Printf("/admin/tenants/%s/renew: tenant %q renewed to %s",
			tenant.Id, tenant.GetString("email"), newExpiryStr)
		return e.JSON(http.StatusOK, map[string]any{
			"status":     "active",
			"expires_at": newExpiryStr,
		})
	}
}

// ── POST /api/v1/admin/tenants/{id}/revoke ────────────────────────

// handleAdminRevoke marks a tenant revoked.
func handleAdminRevoke(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		if !adminAuth(app, e) {
			return nil
		}
		tenant, err := app.FindRecordById("tenants", e.Request.PathValue("id"))
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{"error": "tenant not found"})
		}
		tenant.Set("status", "revoked")
		if err := app.Save(tenant); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "revoke failed"})
		}
		log.Printf("/admin/tenants/%s/revoke: tenant %q revoked", tenant.Id, tenant.GetString("email"))
		return e.JSON(http.StatusOK, map[string]any{"status": "revoked"})
	}
}

// ── POST /api/v1/admin/tenants/{id}/tier-override ─────────────────

// tierOverrideRequest is the body for the tier override endpoint.
type tierOverrideRequest struct {
	// New tier key (plus/pro/premium/enterprise).
	TierKey string `json:"tier_key"`
	// Reason for the override (audit trail).
	Reason string `json:"reason"`
}

// handleAdminTierOverride sets the tenant's subscription tier.
func handleAdminTierOverride(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		if !adminAuth(app, e) {
			return nil
		}
		tenant, err := app.FindRecordById("tenants", e.Request.PathValue("id"))
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{"error": "tenant not found"})
		}

		var req tierOverrideRequest
		if err := json.NewDecoder(e.Request.Body).Decode(&req); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "invalid JSON body"})
		}
		if req.TierKey == "" {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "tier_key is required"})
		}
		// B30: validate against the known tier set up front. An unknown
		// key used to fall through to the SelectField schema and surface
		// as a 500 "tier override failed" — an internal error for what is
		// really bad input (and MRR would price unknown keys at $0).
		if _, known := TierPriceUSD[req.TierKey]; !known {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "unknown tier_key"})
		}

		// Update the latest subscription's tier.
		subs, err := app.FindRecordsByFilter("subscriptions",
			"tenant_id = {:tid}", "-starts_at", 1, 0,
			map[string]any{"tid": tenant.Id})
		if err == nil && len(subs) > 0 {
			sub := subs[0]
			sub.Set("tier_key", req.TierKey)
			sub.Set("status", "active")
			if err := app.Save(sub); err != nil {
				return e.JSON(http.StatusInternalServerError, map[string]any{"error": "tier override failed"})
			}
		}

		log.Printf("/admin/tenants/%s/tier-override: tenant %q → %s (reason: %q)",
			tenant.Id, tenant.GetString("email"), req.TierKey, req.Reason)
		return e.JSON(http.StatusOK, map[string]any{"status": "ok", "tier_key": req.TierKey})
	}
}

// ── GET /api/v1/admin/health ──────────────────────────────────────

// handleAdminHealth returns server + DB health for the admin panel.
func handleAdminHealth(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		if !adminAuth(app, e) {
			return nil
		}
		// Simple DB ping: count tenants (any error → unhealthy).
		dbOK := true
		if _, err := app.FindRecordsByFilter("tenants", "status != ''", "-created", 1, 0); err != nil {
			dbOK = false
		}
		return e.JSON(http.StatusOK, map[string]any{
			"status":    "ok",
			"db_ok":     dbOK,
			"time":      time.Now().UTC().Format(time.RFC3339),
			"version":   adminDashboardVersion,
			"smtp_host": os.Getenv("OZ_SMTP_HOST") != "",
		})
	}
}

// atoiDefault parses s as an int, returning def when empty/invalid.
func atoiDefault(s string, def int) int {
	if s == "" {
		return def
	}
	var n int
	if _, err := fmt.Sscanf(s, "%d", &n); err != nil {
		return def
	}
	return n
}
