package main

// Tests for the tenant lifecycle endpoints (ADR #42 Phase 4):
// PATCH /admin/tenants/{id}, POST .../devices/{deviceId}/revoke,
// POST .../grant-subscription, DELETE /admin/tenants/{id}, plus the
// exact-date renew extension. Follows dashboard_api_test.go conventions.

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

const lifecycleAdminKey = "Bearer secret-admin-key"

// lifecycleNonAdminEmail is the OZ_ADMIN_EMAIL every case that needs a
// NON-admin row points the env at. The tenant-lifecycle guard fails closed
// when OZ_ADMIN_EMAIL is unset — with no address to compare against it
// treats EVERY row as the admin tenant — so a case expecting a rename or a
// delete to succeed must name an admin identity that is not the row under
// test. Deliberately not defaultAdminEmail and not any seeded tenant email.
const lifecycleNonAdminEmail = "lifecycle-operator@test.com"

// lifecycleAdminEmail is the address the two guard cases seed a row at AND
// point the env at, so their refusal is proven to come from the MATCH and
// not from the blanket.
const lifecycleAdminEmail = "lifecycle-admin@test.com"

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
	t.Setenv("OZ_ADMIN_EMAIL", lifecycleNonAdminEmail)

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
	t.Setenv("OZ_ADMIN_EMAIL", lifecycleNonAdminEmail)

	rec := doJSON(mux, http.MethodPatch, "/api/v1/admin/tenants/"+tenant.Id, lifecycleAdminKey,
		`{"email":"taken@test.com"}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestAdminUpdateTenant_AdminEmailProtected pins the MATCH, not the
// blanket. The guard answers 400 for EVERY row when OZ_ADMIN_EMAIL is
// unset, so a case that merely seeds a row and expects 400 stays green for
// the wrong reason: it cannot tell "this row is the admin tenant" apart
// from "no admin identity is configured". Hence the env names the seeded
// address, the refusal must carry the message from the guard itself, and a
// second non-admin row in the same app under the same env still renames.
func TestAdminUpdateTenant_AdminEmailProtected(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	admin := seedLifecycleTenant(t, app, lifecycleAdminEmail, "active")
	ordinary := seedLifecycleTenant(t, app, "movable@test.com", "active")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")
	t.Setenv("OZ_ADMIN_EMAIL", lifecycleAdminEmail)

	rec := doJSON(mux, http.MethodPatch, "/api/v1/admin/tenants/"+admin.Id, lifecycleAdminKey,
		`{"email":"moved@test.com"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "admin tenant email cannot be changed") {
		t.Errorf("the 400 must come from the admin guard, got %s", rec.Body.String())
	}
	if reloaded, _ := app.FindRecordById("tenants", admin.Id); reloaded.GetString("email") != lifecycleAdminEmail {
		t.Errorf("admin tenant email changed to %q", reloaded.GetString("email"))
	}

	// Control leg: the guard is match-scoped. Without it the blanket
	// fail-closed refusal above would look like a passing test.
	rec = doJSON(mux, http.MethodPatch, "/api/v1/admin/tenants/"+ordinary.Id, lifecycleAdminKey,
		`{"email":"moved2@test.com"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("control: expected 200 renaming a non-admin row, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestAdminUpdateTenant_BadInput(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	tenant := seedLifecycleTenant(t, app, "badin@test.com", "active")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")
	t.Setenv("OZ_ADMIN_EMAIL", lifecycleNonAdminEmail)

	// wantErr is asserted as well as the status: every leg is a 400 under
	// BOTH the admin guard and the validator, and the guard at the rename
	// check runs BEFORE the duplicate-email check and the validator. Without
	// the message the case would stay green while answering from the wrong
	// branch — here OZ_ADMIN_EMAIL names a non-admin address, so the
	// validator must be the one answering.
	for _, tc := range []struct {
		body    string
		want    int
		wantErr string
	}{
		{`{}`, http.StatusBadRequest, "nothing to update"},
		{`{"email":"not-an-email"}`, http.StatusBadRequest, "invalid email"},
		{`{"email":"", "phone":""}`, http.StatusBadRequest, "nothing to update"},
	} {
		rec := doJSON(mux, http.MethodPatch, "/api/v1/admin/tenants/"+tenant.Id, lifecycleAdminKey, tc.body)
		if rec.Code != tc.want {
			t.Errorf("body %s: expected %d, got %d: %s", tc.body, tc.want, rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), tc.wantErr) {
			t.Errorf("body %s: expected error %q, got %s", tc.body, tc.wantErr, rec.Body.String())
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

func TestAdminGrantSubscription_ClearsDeviceRevocations(t *testing.T) {
	// ADR #58 §4a Q-C option B: un-revoking a tenant must release its devices,
	// because the client-side per-device check (§2.4a.2) refuses sessions on a
	// device whose revoked_at is set. Without this, "the tenant paid" leaves an
	// active account with locked tills.
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	tenant := seedLifecycleTenant(t, app, "grantclear@test.com", "revoked")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	machCol, err := app.FindCollectionByNameOrId("tenant_machines")
	if err != nil {
		t.Fatalf("tenant_machines collection: %v", err)
	}
	// One revoked device and one that was never revoked, so the test proves
	// the clear is selective and does not blanket-write every row.
	revoked := core.NewRecord(machCol)
	revoked.Set("tenant_id", tenant.Id)
	revoked.Set("machine_id", "grantclear-revoked")
	revoked.Set("revoked_at", "2026-09-01T00:00:00Z")
	if err := app.Save(revoked); err != nil {
		t.Fatalf("save revoked machine: %v", err)
	}
	untouched := core.NewRecord(machCol)
	untouched.Set("tenant_id", tenant.Id)
	untouched.Set("machine_id", "grantclear-live")
	untouched.Set("last_seen_at", "2026-09-10T00:00:00Z")
	if err := app.Save(untouched); err != nil {
		t.Fatalf("save live machine: %v", err)
	}

	rec := doJSON(mux, http.MethodPost, "/api/v1/admin/tenants/"+tenant.Id+"/grant-subscription", lifecycleAdminKey,
		`{"tier_key":"pro","months":6,"reason":"customer paid the arrears"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	after, err := app.FindRecordById("tenant_machines", revoked.Id)
	if err != nil {
		t.Fatalf("reload revoked machine: %v", err)
	}
	if got := formatDateField(after, "revoked_at"); got != "" {
		t.Errorf("revoked_at = %q, want cleared by the tenant un-revoke", got)
	}
	live, err := app.FindRecordById("tenant_machines", untouched.Id)
	if err != nil {
		t.Fatalf("reload live machine: %v", err)
	}
	if got := formatDateField(live, "last_seen_at"); got == "" {
		t.Error("the clear must not disturb rows it did not revoke")
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
	t.Setenv("OZ_ADMIN_EMAIL", lifecycleNonAdminEmail)

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

// TestAdminDeleteTenant_Guards pins the 403 to the MATCH, not to the
// blanket: the guard refuses every delete when OZ_ADMIN_EMAIL is unset, so
// the admin row is seeded at an address the env also names, the refusal has
// to carry the message from the guard itself, and a third non-admin row in
// the same app under the same env must still delete. The two confirm-email
// legs stay as they were — they answer BEFORE the guard (the confirm check
// is the earlier of the two in handleAdminDeleteTenant).
func TestAdminDeleteTenant_Guards(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	admin := seedLifecycleTenant(t, app, lifecycleAdminEmail, "active")
	victim := seedLifecycleTenant(t, app, "victim@test.com", "active")
	deletable := seedLifecycleTenant(t, app, "deletable@test.com", "active")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")
	t.Setenv("OZ_ADMIN_EMAIL", lifecycleAdminEmail)

	// Admin tenant undeletable — even with the right confirm email.
	rec := doJSON(mux, http.MethodDelete, "/api/v1/admin/tenants/"+admin.Id, lifecycleAdminKey,
		`{"confirm_email":"`+lifecycleAdminEmail+`"}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for admin tenant, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "the admin tenant cannot be deleted") {
		t.Errorf("the 403 must come from the admin guard, got %s", rec.Body.String())
	}
	if _, err := app.FindRecordById("tenants", admin.Id); err != nil {
		t.Error("the admin tenant must survive a refused delete")
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

	// Control leg: a non-admin row still deletes under the same env.
	rec = doJSON(mux, http.MethodDelete, "/api/v1/admin/tenants/"+deletable.Id, lifecycleAdminKey,
		`{"confirm_email":"deletable@test.com"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("control: expected 200 deleting a non-admin row, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := app.FindRecordById("tenants", deletable.Id); err == nil {
		t.Error("control: the non-admin row should be gone")
	}
}

// TestAdminTenantGuard_UnsetEmailRefusesDeleteOfTheDefaultRow states what
// an unset OZ_ADMIN_EMAIL does now. It used to refuse EVERY delete, on the
// premise that an unset variable means the admin identity is unknown — the
// premise was false: authentication falls back to the compiled
// defaultAdminEmail (main.go:535, admin_dashboard.go:87, addon_admin.go:278,
// password_rotation.go:176), so the identity is known and the blanket
// refusal was an outage, not a protection. The guard is now membership in
// the reserved set, so BOTH halves are asserted: the row at the compiled
// default is undeletable, and an ordinary churned tenant is still
// offboardable. t.Setenv(key, "") is the unset case as the code reads it
// and shields the case from an ambient value on a dev machine.
func TestAdminTenantGuard_UnsetEmailRefusesDeleteOfTheDefaultRow(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	compiled := seedLifecycleTenant(t, app, defaultAdminEmail, "active")
	churned := seedLifecycleTenant(t, app, "unset-delete@test.com", "active")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")
	t.Setenv("OZ_ADMIN_EMAIL", "")

	// The default deploy still has an undeletable admin row.
	rec := doJSON(mux, http.MethodDelete, "/api/v1/admin/tenants/"+compiled.Id, lifecycleAdminKey,
		`{"confirm_email":"`+defaultAdminEmail+`","reason":"reserved row probe"}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for the reserved default row, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := app.FindRecordById("tenants", compiled.Id); err != nil {
		t.Error("the reserved default row must survive a refused delete")
	}

	// And an ordinary row is operable — the half the blanket refusal broke.
	rec = doJSON(mux, http.MethodDelete, "/api/v1/admin/tenants/"+churned.Id, lifecycleAdminKey,
		`{"confirm_email":"unset-delete@test.com","reason":"offboarding probe"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 deleting an ordinary row with the env unset, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestAdminTenantGuard_UnsetEmailRefusesRenameOfTheDefaultRow is the same
// pair on the contact-edit side: 400 for the reserved row with its email
// unchanged, 200 for an ordinary row.
func TestAdminTenantGuard_UnsetEmailRefusesRenameOfTheDefaultRow(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	compiled := seedLifecycleTenant(t, app, defaultAdminEmail, "active")
	ordinary := seedLifecycleTenant(t, app, "unset-rename@test.com", "active")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")
	t.Setenv("OZ_ADMIN_EMAIL", "")

	rec := doJSON(mux, http.MethodPatch, "/api/v1/admin/tenants/"+compiled.Id, lifecycleAdminKey,
		`{"email":"moved-off-default@test.com"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for the reserved default row, got %d: %s", rec.Code, rec.Body.String())
	}
	if reloaded, _ := app.FindRecordById("tenants", compiled.Id); reloaded.GetString("email") != defaultAdminEmail {
		t.Errorf("reserved row email changed to %q", reloaded.GetString("email"))
	}

	rec = doJSON(mux, http.MethodPatch, "/api/v1/admin/tenants/"+ordinary.Id, lifecycleAdminKey,
		`{"email":"renamed-away@test.com"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 renaming an ordinary row with the env unset, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestAdminUpdateTenant_RefusesRenameIntoReservedAdminAddress is the
// mint-path case this commit exists for. The guard only ever looked at the
// SOURCE row, and createTenant reservation gates signup, so renaming an
// ordinary tenant ONTO an unoccupied admin address was the way to acquire
// the address adminAuth maps an admin session to — a takeover mint through
// the contact-edit endpoint. The target is now checked against the same
// reserved set, so the rename is refused and the row keeps its email.
func TestAdminUpdateTenant_RefusesRenameIntoReservedAdminAddress(t *testing.T) {
	t.Run("EnvNamedAddressWithNoRow", func(t *testing.T) {
		app, mux := dashboardMux(t)
		defer app.Cleanup()
		mint := "mint-target@lifecycle.test"
		victim := seedLifecycleTenant(t, app, "ordinary-mint@test.com", "active")
		t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")
		t.Setenv("OZ_ADMIN_EMAIL", mint)

		rec := doJSON(mux, http.MethodPatch, "/api/v1/admin/tenants/"+victim.Id, lifecycleAdminKey,
			`{"email":"Mint-Target@lifecycle.test"}`)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 renaming into the reserved admin address, got %d: %s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "reserved for the deployment admin identity") {
			t.Errorf("the refusal must name the reserved target, got %s", rec.Body.String())
		}
		reloaded, _ := app.FindRecordById("tenants", victim.Id)
		if reloaded.GetString("email") != "ordinary-mint@test.com" {
			t.Errorf("row email changed to %q — the mint path is open", reloaded.GetString("email"))
		}
		// And the minted row would have been admin: prove the guard agrees
		// that no row now holds the address, so nothing was promoted.
		if isAdminTenantRecord(reloaded) {
			t.Error("the ordinary row must not be the admin tenant")
		}
	})

	t.Run("CompiledDefaultIsReservedEvenWhenTheEnvIsUnset", func(t *testing.T) {
		app, mux := dashboardMux(t)
		defer app.Cleanup()
		victim := seedLifecycleTenant(t, app, "ordinary-default@test.com", "active")
		t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")
		t.Setenv("OZ_ADMIN_EMAIL", "")

		rec := doJSON(mux, http.MethodPatch, "/api/v1/admin/tenants/"+victim.Id, lifecycleAdminKey,
			`{"email":"`+defaultAdminEmail+`"}`)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 renaming into the compiled default, got %d: %s", rec.Code, rec.Body.String())
		}
		if reloaded, _ := app.FindRecordById("tenants", victim.Id); reloaded.GetString("email") != "ordinary-default@test.com" {
			t.Errorf("row email changed to %q — the mint path is open", reloaded.GetString("email"))
		}
	})

	t.Run("OccupiedReservedAddressStillAnswers409", func(t *testing.T) {
		app, mux := dashboardMux(t)
		defer app.Cleanup()
		mint := "held-target@lifecycle.test"
		seedLifecycleTenant(t, app, mint, "active")
		victim := seedLifecycleTenant(t, app, "ordinary-held@test.com", "active")
		t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")
		t.Setenv("OZ_ADMIN_EMAIL", mint)

		// A reserved address that some row already holds is the duplicate
		// case, and the 409 must keep winning: the reservation refusal is
		// only for the unoccupied mint path.
		rec := doJSON(mux, http.MethodPatch, "/api/v1/admin/tenants/"+victim.Id, lifecycleAdminKey,
			`{"email":"`+mint+`"}`)
		if rec.Code != http.StatusConflict {
			t.Fatalf("expected 409 for an occupied address, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("NonReservedTargetStillRenames", func(t *testing.T) {
		app, mux := dashboardMux(t)
		defer app.Cleanup()
		victim := seedLifecycleTenant(t, app, "ordinary-plain@test.com", "active")
		t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")
		t.Setenv("OZ_ADMIN_EMAIL", "someone-else@lifecycle.test")

		rec := doJSON(mux, http.MethodPatch, "/api/v1/admin/tenants/"+victim.Id, lifecycleAdminKey,
			`{"email":"Plain-Customer@Test.com"}`)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 for an ordinary rename, got %d: %s", rec.Code, rec.Body.String())
		}
		if reloaded, _ := app.FindRecordById("tenants", victim.Id); reloaded.GetString("email") != "plain-customer@test.com" {
			t.Errorf("email = %q, want the normalized plain-customer@test.com", reloaded.GetString("email"))
		}
	})
}

// TestAdminEmailTarget pins the resolver itself: an unset, empty or
// whitespace-only OZ_ADMIN_EMAIL is ("" , false) — NEVER the compiled
// defaultAdminEmail. The guard no longer reads either resolver directly; it
// asks reservedAdminEmails, which reaches the address through
// adminEmailTargetWithDefault. What this case still protects is the
// env-named answer health and the reservation both depend on: a set value
// comes back trimmed with ok=true, an unset one says no.
func TestAdminEmailTarget(t *testing.T) {
	for _, tc := range []struct {
		name string
		env  string
	}{
		{"unset", ""},
		{"spaces only", "   \t "},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("OZ_ADMIN_EMAIL", tc.env)
			got, ok := adminEmailTarget()
			if ok {
				t.Errorf("ok = true for %q, want false", tc.env)
			}
			if got != "" {
				t.Errorf("got %q, want the empty string", got)
			}
			if got == defaultAdminEmail {
				t.Error("the resolver must not fall back to the compiled defaultAdminEmail")
			}
		})
	}

	t.Run("trimmed when set", func(t *testing.T) {
		t.Setenv("OZ_ADMIN_EMAIL", "  ops@example.com  ")
		got, ok := adminEmailTarget()
		if !ok || got != "ops@example.com" {
			t.Errorf("got (%q, %v), want (ops@example.com, true)", got, ok)
		}
	})

	// The compiled default is just another value here: naming it in the env
	// resolves to ok=true, so the guard compares instead of refusing.
	t.Run("compiled default is an ordinary value", func(t *testing.T) {
		t.Setenv("OZ_ADMIN_EMAIL", defaultAdminEmail)
		got, ok := adminEmailTarget()
		if !ok || got != defaultAdminEmail {
			t.Errorf("got (%q, %v), want (%q, true)", got, ok, defaultAdminEmail)
		}
		if reserved := adminEmailTargetWithDefault(); reserved != defaultAdminEmail {
			t.Errorf("reserved-set resolution = %q, want %q", reserved, defaultAdminEmail)
		}
	})

	// The two resolutions differ ONLY on the unset branch — that is the
	// reservation side keeping the compiled default while the guard refuses.
	t.Run("reserved resolution still defaults when unset", func(t *testing.T) {
		t.Setenv("OZ_ADMIN_EMAIL", "")
		if got, ok := adminEmailTarget(); ok || got != "" {
			t.Errorf("guard resolver = (%q, %v), want (\"\" , false)", got, ok)
		}
		if got := adminEmailTargetWithDefault(); got != defaultAdminEmail {
			t.Errorf("reserved resolution = %q, want the compiled default %q", got, defaultAdminEmail)
		}
	})
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

// ── /api/health admin-identity snapshot (fail-closed diagnosability) ──

// TestAdminEmailHealthSnapshot covers the three states of OZ_ADMIN_EMAIL
// that the fail-closed guard makes matter, and pins the one property a
// future edit is most likely to break: no address value ever reaches the
// response body. /api/health is public, so the payload reports the SHAPE of
// the admin identity — source, matching_rows, verified — and nothing else.
func TestAdminEmailHealthSnapshot(t *testing.T) {
	// buildHealthMux binds the same override main.go uses, on a fresh app
	// that starts with zero tenants, so every count below counts only what
	// this case seeded.
	buildHealthMux := func(t *testing.T) (core.App, http.Handler) {
		t.Helper()
		app, se := setupDirectApp(t)
		t.Cleanup(app.Cleanup)
		bindHealthOverride(app, se)
		mux, err := se.Router.BuildMux()
		if err != nil {
			t.Fatalf("BuildMux: %v", err)
		}
		return app, mux
	}

	// adminBlock GETs the real /api/health and returns the decoded admin
	// object plus the RAW body, so the leak property is asserted on what
	// actually went over the wire, not on the map the handler built.
	adminBlock := func(t *testing.T, mux http.Handler) (map[string]any, string) {
		t.Helper()
		rec := doJSON(mux, http.MethodGet, "/api/health", "", "")
		if rec.Code != http.StatusOK {
			t.Fatalf("health: expected 200, got %d: %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Admin map[string]any `json:"admin"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("health unmarshal: %v", err)
		}
		if body.Admin == nil {
			t.Fatal("the health payload carries no admin block")
		}
		if len(body.Admin) != 3 {
			t.Errorf("admin block has %d fields, want exactly the 3 contracted ones: %v", len(body.Admin), body.Admin)
		}
		for k, v := range body.Admin {
			if s, ok := v.(string); ok && strings.Contains(s, "@") {
				t.Errorf("admin field %q carries an address-shaped value %q", k, s)
			}
		}
		return body.Admin, rec.Body.String()
	}

	// assertNoAddress: neither a full address nor its local part may appear
	// anywhere in the body, in any case — a masked or truncated form still
	// fails on the local part.
	assertNoAddress := func(t *testing.T, raw string, addrs ...string) {
		t.Helper()
		lower := strings.ToLower(raw)
		for _, a := range addrs {
			if strings.Contains(lower, strings.ToLower(a)) {
				t.Errorf("the address %q appears in the health body", a)
			}
			if at := strings.Index(a, "@"); at > 0 {
				if local := a[:at]; strings.Contains(lower, strings.ToLower(local)) {
					t.Errorf("the address local part %q appears in the health body", local)
				}
			}
		}
	}

	t.Run("UnsetEnvReportsFallbackAndTheGuardProtectsOnlyTheReservedRow", func(t *testing.T) {
		app, mux := buildHealthMux(t)
		t.Setenv("OZ_ADMIN_EMAIL", "")
		compiled := seedLifecycleTenant(t, app, defaultAdminEmail, "active")
		ordinary := seedLifecycleTenant(t, app, "ordinary-health@test.com", "active")

		snap, raw := adminBlock(t, mux)
		assertNoAddress(t, raw, defaultAdminEmail, "ordinary-health@test.com")
		if snap["source"] != "fallback" {
			t.Errorf("source = %v, want fallback", snap["source"])
		}
		if snap["matching_rows"] != float64(1) {
			t.Errorf("matching_rows = %v, want 1 (the compiled default has exactly one row)", snap["matching_rows"])
		}
		if snap["verified"] != false {
			t.Errorf("verified = %v, want false: an address nobody named is not deploy hygiene", snap["verified"])
		}
		// The guard-side half, restated for the set-membership guard: the
		// anchor address has a row and that row is protected, while an
		// ordinary tenant is operable. This is where the earlier claim that
		// BOTH rows were protected died — the snapshot counts one match and
		// the guard now agrees that only the reserved row is the admin one.
		if !isAdminTenantRecord(compiled) {
			t.Error("the row at the compiled default must be the protected admin tenant")
		}
		if isAdminTenantRecord(ordinary) {
			t.Error("an ordinary row must stay operable when the env is unset")
		}
	})

	t.Run("EnvPointedAtNoRowIsTheBrickedDeployShape", func(t *testing.T) {
		app, mux := buildHealthMux(t)
		noRow := "nobody-here@health.test"
		t.Setenv("OZ_ADMIN_EMAIL", noRow)
		seedLifecycleTenant(t, app, "someone-else@health.test", "active")

		snap, raw := adminBlock(t, mux)
		assertNoAddress(t, raw, noRow, "someone-else@health.test")
		if snap["source"] != "env" {
			t.Errorf("source = %v, want env", snap["source"])
		}
		if snap["matching_rows"] != float64(0) {
			t.Errorf("matching_rows = %v, want 0", snap["matching_rows"])
		}
		if snap["verified"] != false {
			t.Errorf("verified = %v, want false", snap["verified"])
		}
		// The guard compares against the named address, so it matches no row
		// and protects nothing: the inverse failure, and the reason 0 and
		// fallback must never be collapsed into one "not configured" flag.
		rows, err := app.FindAllRecords("tenants")
		if err != nil {
			t.Fatalf("find tenants: %v", err)
		}
		for _, r := range rows {
			if isAdminTenantRecord(r) {
				t.Errorf("with the env set to an address with no row, %q must not be treated as the admin tenant", r.GetString("email"))
			}
		}
	})

	t.Run("EnvMatchingExactlyOneRowIsVerified", func(t *testing.T) {
		app, mux := buildHealthMux(t)
		only := "single-owner@health.test"
		t.Setenv("OZ_ADMIN_EMAIL", "  "+only+"  ")
		admin := seedLifecycleTenant(t, app, only, "active")
		seedLifecycleTenant(t, app, "customer@health.test", "active")

		snap, raw := adminBlock(t, mux)
		assertNoAddress(t, raw, only, "customer@health.test")
		if snap["source"] != "env" {
			t.Errorf("source = %v, want env", snap["source"])
		}
		if snap["matching_rows"] != float64(1) {
			t.Errorf("matching_rows = %v, want 1", snap["matching_rows"])
		}
		if snap["verified"] != true {
			t.Errorf("verified = %v, want true (named address, exactly one row)", snap["verified"])
		}
		// The one state where source, matching_rows and the guard all agree:
		// exactly this row is the admin tenant, and its neighbour is not.
		if !isAdminTenantRecord(admin) {
			t.Error("the matched row must be the admin tenant")
		}
		if rows, err := app.FindAllRecords("tenants"); err == nil {
			for _, r := range rows {
				if r.Id != admin.Id && isAdminTenantRecord(r) {
					t.Errorf("only the named row may be the admin tenant, %q also matched", r.GetString("email"))
				}
			}
		}
	})
}
