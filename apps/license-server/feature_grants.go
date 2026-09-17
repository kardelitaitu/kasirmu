package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// FeatureGrantKeys is the authoritative allowlist of feature keys an admin may
// set through the D2 feature-grants authoring endpoint. It contains ONLY the
// FIVE boolean supports_* AvailabilityFeature names, mirroring the client's
// AvailabilityFeature::as_str() vocabulary in
// crates/kasirmu-core/src/availability.rs.
//
// Quota-named features (sales_history_days, locations, staff_users,
// pos_instances, warehouses) are DELIBERATELY EXCLUDED: the wire field is
// map[string]bool, and a boolean grant on a QUANTITY feature is semantically
// incoherent — you cannot "grant beyond tier" a number with true/false. Quota
// overrides are a separate, currently-unspecced surface. Do NOT "complete"
// this list by appending the quota keys; extend the wire contract first.
var FeatureGrantKeys = []string{
	"supports_qris",
	"supports_analytics",
	"supports_loyalty",
	"supports_daily_dashboard",
	"supports_cloud_sync",
}

// quotaFeatureKeys are the QUANTITY features intentionally absent from
// FeatureGrantKeys. A request naming one is rejected with a specific message
// (a coherent idea, just not this surface) rather than a generic "unknown
// key", so callers can tell the two apart.
var quotaFeatureKeys = map[string]bool{
	"sales_history_days": true,
	"locations":          true,
	"staff_users":        true,
	"pos_instances":      true,
	"warehouses":         true,
}

// isValidFeatureGrantKey reports whether key is an authorable boolean feature.
func isValidFeatureGrantKey(key string) bool {
	for _, k := range FeatureGrantKeys {
		if k == key {
			return true
		}
	}
	return false
}

// isQuotaFeatureKey reports whether key is a known quantity feature that the
// endpoint declines to author (see quotaFeatureKeys).
func isQuotaFeatureKey(key string) bool {
	return quotaFeatureKeys[key]
}

// featureGrantsForTenant returns the persisted per-feature grants for a
// tenant's current active subscription (most recent by starts_at), or nil if
// none are set. It is consulted at every signSubscription build site so an
// admin-authored grant (D2 authoring endpoint) survives the next
// renew/resume/webhook re-sign instead of being silently dropped.
//
// The returned map is keyed ONLY by the boolean supports_* feature names (see
// FeatureGrantKeys); quota-named features are never stored here.
func featureGrantsForTenant(app core.App, tenantID string) map[string]bool {
	if tenantID == "" {
		return nil
	}
	subs, err := app.FindRecordsByFilter("subscriptions",
		"tenant_id = {:tid} && status = 'active'", "-starts_at", 1, 0,
		map[string]any{"tid": tenantID})
	if err != nil || len(subs) == 0 {
		return nil
	}
	raw := subs[0].Get("feature_grants")
	if raw == nil {
		return nil
	}
	b, err := json.Marshal(raw)
	if err != nil {
		return nil
	}
	out := map[string]bool{}
	if err := json.Unmarshal(b, &out); err != nil {
		return nil
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// SetFeatureGrantsRequest is the JSON body for
// POST /api/v1/admin/subscriptions/{id}/feature-grants (Phase D2).
//
// grants maps a canonical feature key (one of FeatureGrantKeys — the five
// boolean supports_* AvailabilityFeature names) to a bool instruction:
//   - true  => grant the feature beyond the tier's own answer
//   - false => withhold the feature even where the tier would allow
//   - absent => leave the tier's own answer in place (clears it if present)
//
// No quota-named keys are accepted (sales_history_days, locations, staff_users,
// pos_instances, warehouses): the wire field is map[string]bool and a boolean
// grant on a QUANTITY feature is incoherent. Quota overrides are a separate,
// unspecced surface.
//
// Idempotent by design: re-POSTing the same grants is a no-op state change
// (the re-sign produces the same signed_payload), and POSTing a subset drops
// the omitted keys from the persisted map. Pre-first-activation authoring (a
// grant on a tenant with no subscription yet) is not a current flow; if it
// ever becomes one, it is an extension layered on top of this endpoint, not a
// change to it.
type SetFeatureGrantsRequest struct {
	Grants map[string]bool `json:"grants"`
}

// SetFeatureGrantsResponse is returned on success.
type SetFeatureGrantsResponse struct {
	SubscriptionID string          `json:"subscription_id"`
	Grants         map[string]bool `json:"grants"`
	SignedPayload  string          `json:"signed_payload"`
}

// handleAdminSetFeatureGrants returns the handler for POST
// /api/v1/admin/subscriptions/{id}/feature-grants (Phase D2).
//
// Requires admin auth (authenticateAdmin: OZ_ADMIN_KEY bearer or admin web
// session — the same gate as the other admin endpoints). It validates the
// requested keys against FeatureGrantKeys, persists the cleaned map to
// subscriptions.feature_grants, and RE-SIGNS the subscription immediately so
// the client picks the grant up on its next /status. Without the immediate
// re-sign the grant would stay dormant until the next natural renew/resume/
// webhook re-sign (a surprise; see D2 amendment 2). Idempotent: re-POSTing the
// same grants updates the one existing subscription row and produces the same
// signed_payload — no duplicate rows.
func handleAdminSetFeatureGrants(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		if !authenticateAdmin(app, e) {
			return e.JSON(http.StatusUnauthorized, map[string]any{
				"error": "Authorization: Bearer <admin_key> header required",
			})
		}

		subID := e.Request.PathValue("id")
		if subID == "" {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "subscription id required"})
		}

		sub, err := app.FindRecordById("subscriptions", subID)
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]any{"error": "subscription not found"})
		}

		if e.Request.Body == nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "JSON body required"})
		}
		var req SetFeatureGrantsRequest
		if err := json.NewDecoder(e.Request.Body).Decode(&req); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "invalid JSON body"})
		}

		// Validate the requested keys against the authoritative allowlist.
		cleaned := make(map[string]bool)
		for k, v := range req.Grants {
			if !isValidFeatureGrantKey(k) {
				// Distinguish quota-named keys (a coherent-but-unspecced request)
				// from junk so the caller gets an actionable message.
				if isQuotaFeatureKey(k) {
					return e.JSON(http.StatusBadRequest, map[string]any{
						"error": "quota overrides are a separate unspecced surface; only boolean supports_* feature keys may be granted here (got " + k + ")",
					})
				}
				return e.JSON(http.StatusBadRequest, map[string]any{
					"error": "unknown feature key: " + k + " (must be one of supports_qris, supports_analytics, supports_loyalty, supports_daily_dashboard, supports_cloud_sync)",
				})
			}
			cleaned[k] = v
		}

		// Persist the canonical source. Store exactly what was requested so a
		// re-POST of the same map is idempotent (same persisted value).
		sub.Set("feature_grants", cleaned)

		// Re-sign immediately (D2 amendment 2) so the grant is live on the next
		// /status rather than dormant until the next natural re-sign.
		if err := resignSubscriptionWithGrants(app, sub, cleaned); err != nil {
			log.Printf("/admin/subscriptions/%s/feature-grants: resign failed: %v", subID, err)
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "failed to re-sign subscription"})
		}
		if err := app.Save(sub); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "failed to persist feature grants"})
		}

		return e.JSON(http.StatusOK, SetFeatureGrantsResponse{
			SubscriptionID: sub.Id,
			Grants:         cleaned,
			SignedPayload:  sub.GetString("signed_payload"),
		})
	}
}

// resignSubscriptionWithGrants rebuilds the SubscriptionPayload from a stored
// subscription record, grafts the supplied feature grants onto it, re-signs,
// and writes the new signed_payload + signature back onto the record. It is
// the single shared re-sign path for D2 authoring so the emitted payload shape
// stays identical to every other re-sign site (tier/quota/expiry faithful,
// IssuedAt refreshed). The supplied grants map is the authoritative source:
// an empty map yields an omitempty-elided features block.
func resignSubscriptionWithGrants(app core.App, sub *core.Record, grants map[string]bool) error {
	payload := SubscriptionPayload{
		TenantID:        sub.GetString("tenant_id"),
		TierKey:         sub.GetString("tier_key"),
		Status:          sub.GetString("status"),
		MaxLocations:    sub.GetInt("max_stores"),
		MaxPOSInstances: sub.GetInt("max_pos_instances"),
		AllowedTypes:    parseAllowedTypesJSON(sub.GetString("allowed_types")),
		StartsAt:        formatDateField(sub, "starts_at"),
		ExpiresAt:       formatDateField(sub, "expires_at"),
		GraceUntil:      formatDateField(sub, "grace_until"),
		IssuedAt:        time.Now().UTC().Format(time.RFC3339),
		Features:        grants,
	}
	payloadStr, signature, err := signSubscription(payload)
	if err != nil {
		return err
	}
	sub.Set("signed_payload", payloadStr)
	sub.Set("signature", signature)
	return nil
}

// ensureFeatureGrantsField adds the feature_grants json field to the
// subscriptions collection on existing pb_data volumes that predate Phase D2.
// Fresh boots get it from the embedded pb_schema.json; this is the idempotent
// in-place upgrade so the D2 authoring endpoint and the build-site grafts can
// read/write the persisted grant map on every deployment. No-op once present.
func ensureFeatureGrantsField(app core.App) error {
	collection, err := app.FindCollectionByNameOrId("subscriptions")
	if err != nil {
		return fmt.Errorf("subscriptions collection not found: %w", err)
	}
	if collection.Fields.GetByName("feature_grants") != nil {
		return nil
	}
	collection.Fields.Add(&core.JSONField{
		Name: "feature_grants",
		Help: "Per-feature boolean grants authored by an admin (Phase D2). Keys are restricted to the five supports_* AvailabilityFeature names; quota-named features are excluded.",
	})
	if err := app.Save(collection); err != nil {
		return fmt.Errorf("failed to add feature_grants field: %w", err)
	}
	log.Println("migrated subscriptions collection: added feature_grants field")
	return nil
}
