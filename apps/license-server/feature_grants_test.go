package main

// Tests for Phase D2 server-side per-feature grant authoring:
// POST /api/v1/admin/subscriptions/{id}/feature-grants.
//
// Covers (a) admin-key auth, (b) the FIVE-key allowlist with quota-key and
// unknown-key rejection, (c) persistence to subscriptions.feature_grants plus an
// immediate re-sign (D2 amendment 2) so the grant is live on next /status, and
// (d) omitempty byte-identity of the signed payload when no grants are set.

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/tests"
)

// grantSubID seeds a tenant + active subscription and returns the subscription id.
func grantSubID(t *testing.T, app *tests.TestApp, email string) string {
	t.Helper()
	tenantID, _ := seedDashboardTenant(t, app, email)
	subs, err := app.FindRecordsByFilter("subscriptions",
		"tenant_id = {:tid}", "-starts_at", 1, 0, map[string]any{"tid": tenantID})
	if err != nil || len(subs) == 0 {
		t.Fatalf("seed sub lookup: %v", err)
	}
	return subs[0].Id
}

func TestFeatureGrants_Unauthorized_NoKey(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	subID := grantSubID(t, app, "fg-nokey@test.com")
	rec := doJSON(mux, http.MethodPost,
		"/api/v1/admin/subscriptions/"+subID+"/feature-grants", "", `{"grants":{"supports_analytics":true}}`)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestFeatureGrants_Unauthorized_WrongKey(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")
	subID := grantSubID(t, app, "fg-wrongkey@test.com")
	rec := doJSON(mux, http.MethodPost,
		"/api/v1/admin/subscriptions/"+subID+"/feature-grants", "Bearer not-the-right-key", `{"grants":{"supports_analytics":true}}`)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestFeatureGrants_UnknownKey_Rejected(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")
	subID := grantSubID(t, app, "fg-unknown@test.com")
	rec := doJSON(mux, http.MethodPost,
		"/api/v1/admin/subscriptions/"+subID+"/feature-grants", "Bearer secret-admin-key",
		`{"grants":{"not_a_real_feature":true}}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "unknown feature key") {
		t.Fatalf("expected unknown-key message, got: %s", rec.Body.String())
	}
}

func TestFeatureGrants_QuotaKey_RejectedWithSurfaceMessage(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")
	subID := grantSubID(t, app, "fg-quota@test.com")
	rec := doJSON(mux, http.MethodPost,
		"/api/v1/admin/subscriptions/"+subID+"/feature-grants", "Bearer secret-admin-key",
		`{"grants":{"locations":true}}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "quota overrides are a separate unspecced surface") {
		t.Fatalf("expected quota-surface message, got: %s", rec.Body.String())
	}
}

func TestFeatureGrants_Success_PersistsAndResigns(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")
	subID := grantSubID(t, app, "fg-success@test.com")

	rec := doJSON(mux, http.MethodPost,
		"/api/v1/admin/subscriptions/"+subID+"/feature-grants", "Bearer secret-admin-key",
		`{"grants":{"supports_analytics":true,"supports_cloud_sync":false}}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// Persisted on the subscription record.
	sub, err := app.FindRecordById("subscriptions", subID)
	if err != nil {
		t.Fatalf("find sub: %v", err)
	}
	raw := sub.Get("feature_grants")
	b, _ := json.Marshal(raw)
	if !strings.Contains(string(b), "supports_analytics") || !strings.Contains(string(b), "supports_cloud_sync") {
		t.Fatalf("feature_grants not persisted: %s", string(b))
	}

	// Re-signed payload carries the features block (D2 amendment 2: not dormant).
	signedPayload := sub.GetString("signed_payload")
	if !strings.Contains(signedPayload, "\"features\"") {
		t.Fatalf("re-signed payload missing features block: %s", signedPayload)
	}
	if !strings.Contains(signedPayload, "supports_analytics") {
		t.Fatalf("re-signed payload missing grant: %s", signedPayload)
	}

	// Response body echoes the re-signed payload.
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if body["signed_payload"] == nil || !strings.Contains(body["signed_payload"].(string), "features") {
		t.Fatalf("response missing signed_payload features: %v", body)
	}
}

func TestFeatureGrants_IdempotentRePost_SameSignedPayload(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")
	subID := grantSubID(t, app, "fg-idem@test.com")
	body := `{"grants":{"supports_qris":true}}`

	first := doJSON(mux, http.MethodPost,
		"/api/v1/admin/subscriptions/"+subID+"/feature-grants", "Bearer secret-admin-key", body)
	if first.Code != http.StatusOK {
		t.Fatalf("first expected 200, got %d: %s", first.Code, first.Body.String())
	}
	second := doJSON(mux, http.MethodPost,
		"/api/v1/admin/subscriptions/"+subID+"/feature-grants", "Bearer secret-admin-key", body)
	if second.Code != http.StatusOK {
		t.Fatalf("second expected 200, got %d: %s", second.Code, second.Body.String())
	}
	var b1, b2 map[string]any
	_ = json.Unmarshal(first.Body.Bytes(), &b1)
	_ = json.Unmarshal(second.Body.Bytes(), &b2)
	if b1["signed_payload"] != b2["signed_payload"] {
		t.Fatalf("re-POST of same grants changed signed_payload (not idempotent):\n%v\n%v", b1["signed_payload"], b2["signed_payload"])
	}
}

func TestFeatureGrants_SubscriptionNotFound(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")
	rec := doJSON(mux, http.MethodPost,
		"/api/v1/admin/subscriptions/nonexistent-id/feature-grants", "Bearer secret-admin-key",
		`{"grants":{"supports_analytics":true}}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

// ── Emission unit tests (no HTTP): signSubscription omitempty behaviour ──

func TestSignSubscription_FeaturesOmitempty(t *testing.T) {
	initPrivateKey(t)

	// No grants set -> payload must NOT contain a "features" key (byte-identical
	// to a pre-Phase-D payload).
	noGrants, _, err := signSubscription(SubscriptionPayload{
		TenantID: "t1", TierKey: "pro", Status: "active",
		StartsAt:   time.Now().UTC().Format(time.RFC3339),
		ExpiresAt:  time.Now().UTC().AddDate(1, 0, 0).Format(time.RFC3339),
		GraceUntil: time.Now().UTC().AddDate(1, 0, 14).Format(time.RFC3339),
		IssuedAt:   time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("sign failed: %v", err)
	}
	if strings.Contains(noGrants, "features") {
		t.Fatalf("expected no features key, got: %s", noGrants)
	}

	// Grants set -> payload carries only the set keys.
	withGrants, _, err := signSubscription(SubscriptionPayload{
		TenantID: "t1", TierKey: "pro", Status: "active",
		StartsAt:   time.Now().UTC().Format(time.RFC3339),
		ExpiresAt:  time.Now().UTC().AddDate(1, 0, 0).Format(time.RFC3339),
		GraceUntil: time.Now().UTC().AddDate(1, 0, 14).Format(time.RFC3339),
		IssuedAt:   time.Now().UTC().Format(time.RFC3339),
		Features:   map[string]bool{"supports_analytics": true},
	})
	if err != nil {
		t.Fatalf("sign failed: %v", err)
	}
	if !strings.Contains(withGrants, "\"features\"") || !strings.Contains(withGrants, "supports_analytics") {
		t.Fatalf("expected features block with supports_analytics, got: %s", withGrants)
	}
	if strings.Contains(withGrants, "supports_cloud_sync") {
		t.Fatalf("unexpected key in features block: %s", withGrants)
	}
}
