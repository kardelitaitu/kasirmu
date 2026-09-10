package main

// Tests for the tenant lifecycle endpoints (ADR #42 Phase 4):
// PATCH /admin/tenants/{id}, POST .../devices/{deviceId}/revoke,
// POST .../grant-subscription, DELETE /admin/tenants/{id}, plus the
// exact-date renew extension. Follows dashboard_api_test.go conventions.

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

const lifecycleAdminKey = "Bearer secret-admin-key"

// seedLifecycleTenant creates ONLY a tenant (no sub/machine), with the
// given status, so grant/delete tests control their own fixtures.
func seedLifecycleTenant(t *testing.T, app core.App, email, status string) *core.Record {
	t.Helper()
	col, _ := app.FindCollectionByNameOrId("tenants")
	tenant := core.NewRecord(col)
	tenant.Set("email", email)
	tenant.Set("api_key", "key-"+email)
	tenant.Set("api_key_lookup", apiKeyLookup("key-"+email))
	tenant.Set("status", status)
	if err := app.Save(tenant); err != nil {
		t.Fatalf("save tenant: %v", err)
	}
	return tenant
}

// findSubFor returns the tenant's latest subscription record.
func findSubFor(t *testing.T, app core.App, tenantID string) *core.Record {
	t.Helper()
	subs, err := app.FindRecordsByFilter("subscriptions", "tenant_id = {:tid}", "-starts_at", 1, 0,
		map[string]any{"tid": tenantID})
	if err != nil {
		t.Fatalf("find subs: %v", err)
	}
	if len(subs) == 0 {
		return nil
	}
	return subs[0]
}

// ── PATCH /admin/tenants/{id} — contact edit ──────────────────────

func TestAdminUpdateTenant_EmailAndPhone(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	tenant := seedLifecycleTenant(t, app, "old@test.com", "active")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	rec := doJSON(mux, http.MethodPatch, "/api/v1/admin/tenants/"+tenant.Id, lifecycleAdminKey,
		`{"email":"New@Test.com","phone":"+62 811-2222"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	updated, _ := app.FindRecordById("tenants", tenant.Id)
	if got := updated.GetString("email"); got != "new@test.com" {
		t.Errorf("email = %q, want normalized new@test.com", got)
	}
	if got := updated.GetString("phone"); got != "+62 811-2222" {
		t.Errorf("phone = %q", got)
	}
}

func TestAdminUpdateTenant_EmailConflict409(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	seedLifecycleTenant(t, app, "taken@test.com", "active")
	tenant := seedLifecycleTenant(t, app, "other@test.com", "active")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	rec := doJSON(mux, http.MethodPatch, "/api/v1/admin/tenants/"+tenant.Id, lifecycleAdminKey,
		`{"email":"taken@test.com"}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestAdminUpdateTenant_AdminEmailProtected(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	tenant := seedLifecycleTenant(t, app, defaultAdminEmail, "active")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	rec := doJSON(mux, http.MethodPatch, "/api/v1/admin/tenants/"+tenant.Id, lifecycleAdminKey,
		`{"email":"moved@test.com"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestAdminUpdateTenant_BadInput(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	tenant := seedLifecycleTenant(t, app, "badin@test.com", "active")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	for _, tc := range []struct {
		body string
		want int
	}{
		{`{}`, http.StatusBadRequest},                       // nothing to update
		{`{"email":"not-an-email"}`, http.StatusBadRequest}, // invalid email
		{`{"email":"", "phone":""}`, http.StatusBadRequest},
	} {
		rec := doJSON(mux, http.MethodPatch, "/api/v1/admin/tenants/"+tenant.Id, lifecycleAdminKey, tc.body)
		if rec.Code != tc.want {
			t.Errorf("body %s: expected %d, got %d: %s", tc.body, tc.want, rec.Code, rec.Body.String())
		}
	}
}

func TestAdminUpdateTenant_RequiresAdmin(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	tenant := seedLifecycleTenant(t, app, "auth@test.com", "active")

	rec := doJSON(mux, http.MethodPatch, "/api/v1/admin/tenants/"+tenant.Id, "", `{"phone":"x"}`)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
	// A non-admin web session is forbidden too.
	_, userToken := seedDashboardTenant(t, app, "someuser@test.com")
	rec = doJSON(mux, http.MethodPatch, "/api/v1/admin/tenants/"+tenant.Id, "Bearer "+userToken, `{"phone":"x"}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-admin session, got %d", rec.Code)
	}
}

// ── POST /admin/tenants/{id}/devices/{deviceId}/revoke ────────────

func TestAdminRevokeDevice_SetsAndIsIdempotent(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	tenantID, _ := seedDashboardTenant(t, app, "devrev@test.com")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	machines, _ := app.FindRecordsByFilter("tenant_machines", "tenant_id = {:tid}", "", 1, 0,
		map[string]any{"tid": tenantID})
	deviceID := machines[0].Id

	rec := doJSON(mux, http.MethodPost, "/api/v1/admin/tenants/"+tenantID+"/devices/"+deviceID+"/revoke", lifecycleAdminKey, "{}")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	first := body["revoked_at"].(string)
	if first == "" {
		t.Fatal("expected revoked_at to be set")
	}
	machine, _ := app.FindRecordById("tenant_machines", deviceID)
	if machine.GetString("revoked_at") == "" {
		t.Error("row should carry revoked_at")
	}

	// Idempotent second call returns the same timestamp.
	rec2 := doJSON(mux, http.MethodPost, "/api/v1/admin/tenants/"+tenantID+"/devices/"+deviceID+"/revoke", lifecycleAdminKey, "{}")
	var body2 map[string]any
	_ = json.Unmarshal(rec2.Body.Bytes(), &body2)
	if body2["revoked_at"] != first {
		t.Errorf("idempotency: got %v, want %v", body2["revoked_at"], first)
	}
}

func TestAdminRevokeDevice_ForeignOrMissingDevice404(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	ownerID, _ := seedDashboardTenant(t, app, "devowner@test.com")
	otherID, _ := seedDashboardTenant(t, app, "devother@test.com")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	machines, _ := app.FindRecordsByFilter("tenant_machines", "tenant_id = {:tid}", "", 1, 0,
		map[string]any{"tid": otherID})

	// Wrong tenant path → 404 (no existence leak).
	rec := doJSON(mux, http.MethodPost, "/api/v1/admin/tenants/"+ownerID+"/devices/"+machines[0].Id+"/revoke", lifecycleAdminKey, "{}")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for foreign device, got %d", rec.Code)
	}
	// Unknown device id → 404.
	rec = doJSON(mux, http.MethodPost, "/api/v1/admin/tenants/"+ownerID+"/devices/zzz/revoke", lifecycleAdminKey, "{}")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for unknown device, got %d", rec.Code)
	}
}

// ── POST /admin/tenants/{id}/renew — exact-date extension ─────────

func TestAdminRenew_ExactDateResigns(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	tenantID, _ := seedDashboardTenant(t, app, "renewdate@test.com")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	rec := doJSON(mux, http.MethodPost, "/api/v1/admin/tenants/"+tenantID+"/renew", lifecycleAdminKey, `{"expires_at":"2027-03-15"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	sub := findSubFor(t, app, tenantID)
	if got := sub.GetDateTime("expires_at").Time().UTC().Format(time.RFC3339); got != "2027-03-15T23:59:59Z" {
		t.Errorf("expires_at = %s, want end-of-day 2027-03-15", got)
	}
	if sub.GetString("signature") == "test" || sub.GetString("signed_payload") == "{}" {
		t.Fatal("renew must re-sign the subscription (row/payload agreement)")
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(sub.GetString("signed_payload")), &payload); err != nil {
		t.Fatalf("signed_payload not JSON: %v", err)
	}
	if payload["expires_at"] != "2027-03-15T23:59:59Z" {
		t.Errorf("payload expires_at = %v", payload["expires_at"])
	}
	if payload["tier_key"] != "pro" {
		t.Errorf("payload tier_key = %v, want carried pro", payload["tier_key"])
	}
}

func TestAdminRenew_DaysBehaviorUnchanged(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	tenantID, _ := seedDashboardTenant(t, app, "renewdays@test.com")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	rec := doJSON(mux, http.MethodPost, "/api/v1/admin/tenants/"+tenantID+"/renew", lifecycleAdminKey, `{"days":30}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	sub := findSubFor(t, app, tenantID)
	// Seeded sub expires 2027-01-01 (future vs now) → B29 anchor keeps it.
	if got := sub.GetDateTime("expires_at").Time().UTC().Format(time.RFC3339); got != "2027-01-31T00:00:00Z" {
		t.Errorf("days=30 renewal = %s, want 2027-01-31 anchored at the live expiry", got)
	}
	if sub.GetString("signature") == "test" {
		t.Error("days renewal must also re-sign")
	}
}

func TestAdminRenew_BadInput(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	tenantID, _ := seedDashboardTenant(t, app, "renewbad@test.com")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	for _, tc := range []struct {
		body string
		want int
	}{
		{`{"days":30,"expires_at":"2027-03-15"}`, http.StatusBadRequest},
		{`{"expires_at":"2020-01-01"}`, http.StatusBadRequest}, // past
		{`{"expires_at":"not-a-date"}`, http.StatusBadRequest},
	} {
		rec := doJSON(mux, http.MethodPost, "/api/v1/admin/tenants/"+tenantID+"/renew", lifecycleAdminKey, tc.body)
		if rec.Code != tc.want {
			t.Errorf("body %s: expected %d, got %d: %s", tc.body, tc.want, rec.Code, rec.Body.String())
		}
	}
	// No subscription at all → 404.
	tenant := seedLifecycleTenant(t, app, "nosub-renew@test.com", "active")
	rec := doJSON(mux, http.MethodPost, "/api/v1/admin/tenants/"+tenant.Id+"/renew", lifecycleAdminKey, `{"days":30}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for no subscription, got %d", rec.Code)
	}
}

// ── POST /admin/tenants/{id}/grant-subscription ───────────────────

func TestAdminGrantSubscription_CreatesSignedSub(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	tenant := seedLifecycleTenant(t, app, "grant@test.com", "revoked")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	rec := doJSON(mux, http.MethodPost, "/api/v1/admin/tenants/"+tenant.Id+"/grant-subscription", lifecycleAdminKey,
		`{"tier_key":"pro","months":6,"reason":"transfer payment #123"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	sub := findSubFor(t, app, tenant.Id)
	if sub == nil {
		t.Fatal("expected a subscription record")
	}
	if sub.GetString("payment_provider") != "manual" {
		t.Errorf("payment_provider = %q, want manual", sub.GetString("payment_provider"))
	}
	if sub.GetString("tier_key") != "pro" {
		t.Errorf("tier_key = %q", sub.GetString("tier_key"))
	}
	if sub.GetInt("max_stores") != 2 || sub.GetInt("max_pos_instances") != 5 {
		t.Errorf("pro quotas wrong: stores=%d pos=%d", sub.GetInt("max_stores"), sub.GetInt("max_pos_instances"))
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(sub.GetString("signed_payload")), &payload); err != nil {
		t.Fatalf("signed_payload not JSON: %v", err)
	}
	if payload["status"] != "active" || payload["tenant_id"] != tenant.Id {
		t.Errorf("payload status/tenant wrong: %v %v", payload["status"], payload["tenant_id"])
	}
	// ~6 months out (now+6mo), so just check it is in the future and grace computed.
	exp := sub.GetDateTime("expires_at").Time()
	if !exp.After(time.Now().UTC().AddDate(0, 5, 0)) {
		t.Errorf("expires_at = %v, want about six months out", exp)
	}
	if sub.GetDateTime("grace_until").Time().Before(exp) {
		t.Error("grace_until must follow expires_at")
	}
	// Revoked tenant flipped to active.
	updated, _ := app.FindRecordById("tenants", tenant.Id)
	if updated.GetString("status") != "active" {
		t.Errorf("tenant status = %q, want active after grant", updated.GetString("status"))
	}
}

func TestAdminGrantSubscription_ExpiresAt(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	tenant := seedLifecycleTenant(t, app, "grantdate@test.com", "active")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	rec := doJSON(mux, http.MethodPost, "/api/v1/admin/tenants/"+tenant.Id+"/grant-subscription", lifecycleAdminKey,
		`{"tier_key":"plus","expires_at":"2027-08-01","reason":"cash payment"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	sub := findSubFor(t, app, tenant.Id)
	if got := sub.GetDateTime("expires_at").Time().UTC().Format(time.RFC3339); got != "2027-08-01T23:59:59Z" {
		t.Errorf("expires_at = %s, want inclusive 2027-08-01", got)
	}
	if sub.GetInt("max_stores") != 1 {
		t.Errorf("plus stores = %d, want 1", sub.GetInt("max_stores"))
	}
	// plus must NOT carry kds (no bundle).
	var types []string
	_ = json.Unmarshal([]byte(sub.GetString("allowed_types")), &types)
	for _, ty := range types {
		if ty == "kds" {
			t.Error("plus without bundle must not include kds")
		}
	}
}

func TestAdminGrantSubscription_Rejections(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	// Active subscription exists → conflict.
	activeID, _ := seedDashboardTenant(t, app, "grantconflict@test.com")
	// No subscription.
	free := seedLifecycleTenant(t, app, "grantfree@test.com", "active")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	for _, tc := range []struct {
		id   string
		body string
		want int
	}{
		{activeID, `{"tier_key":"pro","months":6,"reason":"x"}`, http.StatusConflict},
		{free.Id, `{"tier_key":"unknown","months":6,"reason":"x"}`, http.StatusBadRequest},
		{free.Id, `{"tier_key":"pro","months":6}`, http.StatusBadRequest}, // no reason
		{free.Id, `{"tier_key":"pro","reason":"x"}`, http.StatusOK},       // months default 12
		{free.Id, `{"tier_key":"pro","months":6,"expires_at":"2027-01-01","reason":"x"}`, http.StatusBadRequest},
		{free.Id, `{"tier_key":"pro","expires_at":"2020-01-01","reason":"x"}`, http.StatusBadRequest},
	} {
		rec := doJSON(mux, http.MethodPost, "/api/v1/admin/tenants/"+tc.id+"/grant-subscription", lifecycleAdminKey, tc.body)
		if rec.Code != tc.want {
			t.Errorf("body %s: expected %d, got %d: %s", tc.body, tc.want, rec.Code, rec.Body.String())
		}
	}
}

// ── DELETE /admin/tenants/{id} — guarded cascade ──────────────────

func TestAdminDeleteTenant_Cascade(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	tenantID, token := seedDashboardTenant(t, app, "del@test.com")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	// A minted license key bound to the tenant — must be unlinked, kept.
	keyCol, _ := app.FindCollectionByNameOrId("license_keys")
	key := core.NewRecord(keyCol)
	key.Set("key", "OZ-PRO-TEST-TEST-TEST-TEST")
	key.Set("tier_key", "pro")
	key.Set("status", "activated")
	key.Set("expires_at", "2027-01-01T00:00:00Z")
	key.Set("activated_by", tenantID)
	if err := app.Save(key); err != nil {
		t.Fatalf("save key: %v", err)
	}

	// Web session for the tenant dies with the delete.
	hash := hashWebToken(token)
	if webOtpStore.getSession(hash) != tenantID {
		t.Fatal("precondition: session should exist")
	}

	rec := doJSON(mux, http.MethodDelete, "/api/v1/admin/tenants/"+tenantID, lifecycleAdminKey,
		`{"confirm_email":"DEL@test.com","reason":"test account cleanup"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body["deleted"] != true || body["machines"] != float64(1) || body["subscriptions"] != float64(1) || body["keys_unlinked"] != float64(1) {
		t.Fatalf("cascade summary wrong: %v", body)
	}
	if _, err := app.FindRecordById("tenants", tenantID); err == nil {
		t.Error("tenant record should be gone")
	}
	if findSubFor(t, app, tenantID) != nil {
		t.Error("subscriptions should be deleted")
	}
	machines, _ := app.FindRecordsByFilter("tenant_machines", "tenant_id = {:tid}", "", 0, 0, map[string]any{"tid": tenantID})
	if len(machines) != 0 {
		t.Error("machines should be deleted")
	}
	kept, _ := app.FindRecordById("license_keys", key.Id)
	if kept == nil {
		t.Fatal("license key row must survive (audit trail)")
	}
	if len(kept.GetStringSlice("activated_by")) != 0 {
		t.Errorf("activated_by should be cleared, got %v", kept.GetStringSlice("activated_by"))
	}
	if webOtpStore.getSession(hash) != "" {
		t.Error("web sessions for the deleted tenant must be dropped")
	}
}

func TestAdminDeleteTenant_Guards(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	admin := seedLifecycleTenant(t, app, defaultAdminEmail, "active")
	victim := seedLifecycleTenant(t, app, "victim@test.com", "active")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	// Admin tenant undeletable — even with the right confirm email.
	rec := doJSON(mux, http.MethodDelete, "/api/v1/admin/tenants/"+admin.Id, lifecycleAdminKey,
		`{"confirm_email":"`+defaultAdminEmail+`"}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for admin tenant, got %d", rec.Code)
	}
	// Wrong confirm email.
	rec = doJSON(mux, http.MethodDelete, "/api/v1/admin/tenants/"+victim.Id, lifecycleAdminKey,
		`{"confirm_email":"wrong@test.com"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for mismatched confirm, got %d", rec.Code)
	}
	// Missing body entirely.
	rec = doJSON(mux, http.MethodDelete, "/api/v1/admin/tenants/"+victim.Id, lifecycleAdminKey, "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing confirm, got %d", rec.Code)
	}
	if _, err := app.FindRecordById("tenants", victim.Id); err != nil {
		t.Error("tenant must survive failed deletes")
	}
}

// parseAllowedTypesJSON round-trips and tolerates garbage.
func TestParseAllowedTypesJSON(t *testing.T) {
	if got := parseAllowedTypesJSON(`["a","b"]`); len(got) != 2 || got[0] != "a" {
		t.Errorf("got %v", got)
	}
	if got := parseAllowedTypesJSON(""); got != nil {
		t.Errorf("empty should be nil, got %v", got)
	}
	if got := parseAllowedTypesJSON("not json"); got != nil {
		t.Errorf("garbage should be nil, got %v", got)
	}
}

// parseInclusiveDate lands on the end of the UTC day.
func TestParseInclusiveDate(t *testing.T) {
	got, err := parseInclusiveDate("2027-03-15")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Format(time.RFC3339) != "2027-03-15T23:59:59Z" {
		t.Errorf("got %s", got.Format(time.RFC3339))
	}
	if _, err := parseInclusiveDate("15/03/2027"); err == nil {
		t.Error("expected error for non-ISO date")
	}
}

// ── Tenant health aggregation (saas-3 support box) ───────────────

// seedHealthFixture builds the full aggregate-present case: tenant,
// active subscription, license key bound to the tenant, two machines
// (one revoked, one last-seen), and a trial registration reporting the
// deployed app version.
func seedHealthFixture(t *testing.T, app core.App, email string) *core.Record {
	t.Helper()
	tenant := seedLifecycleTenant(t, app, email, "active")

	subCol, _ := app.FindCollectionByNameOrId("subscriptions")
	sub := core.NewRecord(subCol)
	sub.Set("tenant_id", tenant.Id)
	sub.Set("tier_key", "pro")
	sub.Set("status", "active")
	sub.Set("max_stores", 3)
	sub.Set("max_pos_instances", 5)
	sub.Set("starts_at", "2026-01-01T00:00:00Z")
	sub.Set("expires_at", "2027-01-01T00:00:00Z")
	sub.Set("signature", "test")
	sub.Set("signed_payload", "{}")
	if err := app.Save(sub); err != nil {
		t.Fatalf("save subscription: %v", err)
	}

	keyCol, _ := app.FindCollectionByNameOrId("license_keys")
	key := core.NewRecord(keyCol)
	key.Set("key", "OZ-HEALTH-KEY-"+email)
	key.Set("tier_key", "pro")
	key.Set("status", "activated")
	key.Set("activated_by", tenant.Id)
	key.Set("expires_at", "2027-01-01T00:00:00Z")
	if err := app.Save(key); err != nil {
		t.Fatalf("save license key: %v", err)
	}

	machCol, _ := app.FindCollectionByNameOrId("tenant_machines")
	revoked := core.NewRecord(machCol)
	revoked.Set("tenant_id", tenant.Id)
	revoked.Set("machine_id", "mach-revoked")
	revoked.Set("revoked_at", "2026-09-01T00:00:00Z")
	if err := app.Save(revoked); err != nil {
		t.Fatalf("save revoked machine: %v", err)
	}
	seen := core.NewRecord(machCol)
	seen.Set("tenant_id", tenant.Id)
	seen.Set("machine_id", "mach-seen")
	seen.Set("last_seen_at", "2026-09-10T01:02:03Z")
	if err := app.Save(seen); err != nil {
		t.Fatalf("save seen machine: %v", err)
	}

	trialCol, _ := app.FindCollectionByNameOrId("trial_registrations")
	trial := core.NewRecord(trialCol)
	trial.Set("tenant_id", tenant.Id)
	trial.Set("hardware_fingerprint", "health-fp-"+email)
	trial.Set("first_seen_at", "2026-09-01T00:00:00Z")
	trial.Set("trial_expires_at", "2026-09-15T00:00:00Z")
	trial.Set("platform", "windows")
	trial.Set("app_version", "0.0.35")
	if err := app.Save(trial); err != nil {
		t.Fatalf("save trial registration: %v", err)
	}
	return tenant
}

func healthFromDetail(t *testing.T, mux http.Handler, tenantID string) map[string]any {
	t.Helper()
	rec := doJSON(mux, http.MethodGet, "/api/v1/admin/tenants/"+tenantID, lifecycleAdminKey, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Health map[string]any `json:"health"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return body.Health
}

func TestTenantHealthAggregatesAllSignals(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	tenant := seedHealthFixture(t, app, "healthy@test.com")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	health := healthFromDetail(t, mux, tenant.Id)
	if health["tenantStatus"] != "active" {
		t.Errorf("tenantStatus = %v, want active", health["tenantStatus"])
	}
	if health["licenseStatus"] != "activated" {
		t.Errorf("licenseStatus = %v, want activated (from the bound license key)", health["licenseStatus"])
	}
	if health["subscriptionStatus"] != "active" {
		t.Errorf("subscriptionStatus = %v, want active", health["subscriptionStatus"])
	}
	if health["devices"] != float64(2) {
		t.Errorf("devices = %v, want 2", health["devices"])
	}
	if health["devicesRevoked"] != float64(1) {
		t.Errorf("devicesRevoked = %v, want 1", health["devicesRevoked"])
	}
	if health["lastSeenAt"] != "2026-09-10T01:02:03Z" {
		t.Errorf("lastSeenAt = %v, want the seen machine pulse", health["lastSeenAt"])
	}
	if health["appVersion"] != "0.0.35" {
		t.Errorf("appVersion = %v, want the trial claim version", health["appVersion"])
	}

	// The LIST view carries the same health row (surfaced alongside the
	// existing tenant list/stats). NOTE: the unfiltered first page is used
	// deliberately — the ?search= path of handleAdminListTenants is
	// PRE-EXISTING-broken (probe: email ~ {:search} matched zero rows for
	// a freshly seeded lowercase email) and out of this slice's fence.
	rec := doJSON(mux, http.MethodGet, "/api/v1/admin/tenants", lifecycleAdminKey, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("list: expected 200, got %d", rec.Code)
	}
	var list struct {
		Tenants []struct {
			Email  string         `json:"email"`
			Health map[string]any `json:"health"`
		} `json:"tenants"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("unmarshal list: %v", err)
	}
	if len(list.Tenants) != 1 || list.Tenants[0].Health["appVersion"] != "0.0.35" {
		t.Fatalf("list health = %+v, want the aggregated row", list.Tenants)
	}
}

// The hub learns app_version ONLY from trial registrations. A tenant
// without one must report "unknown" — never the server build, never a
// tier guess (brief hard rule: never fabricate).
func TestTenantHealthVersionUnknownWhenNeverReported(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	tenant := seedLifecycleTenant(t, app, "noversion@test.com", "active")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	health := healthFromDetail(t, mux, tenant.Id)
	if health["appVersion"] != "unknown" {
		t.Errorf("appVersion = %v, want exactly unknown (hub has no version row)", health["appVersion"])
	}
	if health["licenseStatus"] != "none" {
		t.Errorf("licenseStatus = %v, want none (no license key record)", health["licenseStatus"])
	}
	if health["subscriptionStatus"] != "none" {
		t.Errorf("subscriptionStatus = %v, want none (no subscription record)", health["subscriptionStatus"])
	}
}

func TestTenantHealthEmptyTenant(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	tenant := seedLifecycleTenant(t, app, "empty@test.com", "active")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	health := healthFromDetail(t, mux, tenant.Id)
	if health["devices"] != float64(0) || health["devicesRevoked"] != float64(0) {
		t.Errorf("devices = %v/%v, want 0/0 for a tenant with no machines", health["devices"], health["devicesRevoked"])
	}
	if health["lastSeenAt"] != "" {
		t.Errorf("lastSeenAt = %v, want empty (no machines = no stored pulse)", health["lastSeenAt"])
	}
	if health["appVersion"] != "unknown" {
		t.Errorf("appVersion = %v, want unknown", health["appVersion"])
	}
}
