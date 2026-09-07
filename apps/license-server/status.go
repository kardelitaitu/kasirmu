package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// handleStatus returns the current license status for a tenant.
//
// POST /api/v1/license/status
// Authorization: Bearer <api_key>
//
// The api_key is the sole authenticator. The `tenants.api_key` column is
// uniquely indexed (see renew.go for the same lookup pattern), so we resolve
// the tenant in one query without needing a tenant_id path parameter.
// This avoids leaking the credential through webserver access logs,
// CDN request logs, browser history, or Referer headers.
//
// All authentication failures (missing/malformed header, unknown api_key,
// non-active tenant) return 401 with a generic message — never 403, which
// would imply successful authentication — and never reveal whether the
// failure was an unknown key vs. a suspended tenant.
func handleStatus(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		// Cap request body at 64KB to prevent OOM via oversized JSON payloads (M4 audit).
		e.Request.Body = http.MaxBytesReader(e.Response, e.Request.Body, 64*1024)

		// ── Rate limit: 5 requests per IP per hour (shared bucket) ──
		// /status used to be unthrottled, letting an attacker hammer the
		// bcrypt verification in findTenantByAPIKey without ever touching
		// the activate/renew bucket. It now shares the persisted per-IP
		// token bucket so brute-forcing /status burns the same budget as
		// the other endpoints. Applied BEFORE auth (like /activate and
		// /renew) so failed attempts cannot bypass the limiter.
		clientIP := e.RealIP()
		if !ipRateLimiter.allow(clientIP) {
			return e.JSON(http.StatusTooManyRequests, map[string]any{
				"error": "rate limit exceeded, try again later",
			})
		}

		// ── Authenticate via Authorization: Bearer header ────────
		auth := e.Request.Header.Get("Authorization")
		if !strings.HasPrefix(auth, bearerPrefix) {
			log.Printf("/status: missing or malformed Authorization header")
			e.Response.Header().Set("WWW-Authenticate", `Bearer realm="license"`)
			return e.JSON(http.StatusUnauthorized, map[string]any{
				"error": "api_key must be sent in the Authorization: Bearer <api_key> header (body api_key is no longer accepted)",
			})
		}
		apiKey := strings.TrimSpace(strings.TrimPrefix(auth, bearerPrefix))
		if apiKey == "" {
			log.Printf("/status: empty api_key after Bearer prefix")
			e.Response.Header().Set("WWW-Authenticate", `Bearer realm="license"`)
			return e.JSON(http.StatusUnauthorized, map[string]any{
				"error": "api_key must be sent in the Authorization: Bearer <api_key> header (body api_key is no longer accepted)",
			})
		}

		// ── Look up tenant by api_key (uniquely indexed) ─────────
		// The stored key is a bcrypt hash; findTenantByAPIKey resolves the
		// tenant via the indexed SHA-256 lookup and verifies with bcrypt
		// (lazily migrating legacy plaintext rows).
		tenant, err := findTenantByAPIKey(app, apiKey)
		if err != nil || tenant.GetString("status") != "active" {
			if err != nil {
				log.Printf("/status: unknown api_key (tenant lookup failed): %v", err)
			} else {
				log.Printf("/status: tenant %q status is %q, not active",
					tenant.Id, tenant.GetString("status"))
			}
			return e.JSON(http.StatusUnauthorized, map[string]any{
				"error": "invalid api_key or tenant is not active",
			})
		}
		tenantID := tenant.Id

		// P8-2: Machine-level revocation — checked and performed via the
		// status endpoint. Extract machine_id and revoke flag from the
		// request body BEFORE the subscription query so these fields are
		// available in ALL response paths (including fallback when no
		// active subscription exists).
		deviceRevoked := false
		revokePerformed := false
		var statusReq struct {
			MachineID string `json:"machine_id,omitempty"`
			Revoke    bool   `json:"revoke,omitempty"`
		}
		if err := json.NewDecoder(e.Request.Body).Decode(&statusReq); err == nil && statusReq.MachineID != "" {
			machines, err := app.FindRecordsByFilter(
				"tenant_machines",
				"machine_id = {:machine_id} && tenant_id = {:tenant_id}",
				"", 1, 0,
				map[string]any{
					"machine_id": statusReq.MachineID,
					"tenant_id":  tenantID,
				},
			)
			if err == nil && len(machines) > 0 {
				machine := machines[0]
				revokedAt := machine.GetDateTime("revoked_at").Time()
				deviceRevoked = !revokedAt.IsZero()

				// If revoke action requested and not already revoked, perform it.
				if statusReq.Revoke && !deviceRevoked {
					machine.Set("revoked_at", time.Now().UTC().Format(time.RFC3339))
					if err := app.Save(machine); err != nil {
						log.Printf("/status: revoke failed for machine %q: %v", statusReq.MachineID, err)
					} else {
						deviceRevoked = true
						revokePerformed = true
						log.Printf("/status: machine %q revoked for tenant %q", statusReq.MachineID, tenantID)
					}
				}
			}
		}

		// ── Find latest ACTIVE subscription ─────────────────────
		// Only return active subscriptions — expired/revoked/grace_period
		// subscriptions are not the current license state. Without the
		// status filter, a more-recently-created "expired" subscription
		// would shadow an older "active" one (when both share the same
		// starts_at, or the expired one has a later starts_at from a
		// churn that was subsequently reversed).
		subs, err := app.FindRecordsByFilter(
			"subscriptions",
			"tenant_id = {:tenant_id} && status = 'active'",
			"-starts_at", 1, 0,
			map[string]any{"tenant_id": tenantID},
		)
		if err != nil || len(subs) == 0 {
			if err != nil {
				log.Printf("/status: subscription query failed for tenant=%q: %v", tenantID, err)
			} else {
				log.Printf("/status: tenant=%q has no active subscription", tenantID)
			}
			return e.JSON(http.StatusOK, map[string]any{
				"tenant_id":        tenantID,
				"status":           tenant.GetString("status"),
				"tier":             "unknown",
				"active":           false,
				"device_revoked":   deviceRevoked,
				"revoke_performed": revokePerformed,
			})
		}

		sub := subs[0]
		tierKey := sub.GetString("tier_key")
		subStatus := sub.GetString("status")

		log.Printf("/status: tenant=%q tier=%s status=%s active=%v device_revoked=%v revoke_performed=%v",
			tenantID, tierKey, subStatus, subStatus == "active", deviceRevoked, revokePerformed)
		return e.JSON(http.StatusOK, map[string]any{
			"tenant_id":   tenantID,
			"status":      tenant.GetString("status"),
			"tier":        tierKey,
			"active":      subStatus == "active",
			"expires_at":  sub.GetString("expires_at"),
			"grace_until": sub.GetString("grace_until"),
			// 1g dual-emit: max_locations is the primary name; max_stores
			// is kept for pre-rename clients whose LicenseStatusResponse
			// defaults the quota to 0 when the field is absent — dropping
			// the legacy key would silently report quota 0 to them.
			"max_locations":    sub.GetInt("max_stores"),
			"max_stores":       sub.GetInt("max_stores"),
			"device_revoked":   deviceRevoked,
			"revoke_performed": revokePerformed,
		})
	}
}
