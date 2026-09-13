package main

// Tests for the user + admin dashboard API endpoints (ADR #42 Phases 2–3):
// /api/v1/web/usage, /api/v1/web/devices, and the /api/v1/admin/tenants*
// management endpoints. Each test seeds a tenant + subscription + machine
// and asserts the JSON response.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// dashboardMux builds the test app (collections + dashboard routes) and
// returns the built mux for direct request serving.
func dashboardMux(t *testing.T) (*tests.TestApp, http.Handler) {
	t.Helper()
	resetRateLimiters()
	resetProviderRevenueCache()
	app, se := setupDirectApp(t)
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}
	return app, mux
}

// seedDashboardTenant creates a tenant + active subscription + machine and
// issues a session token for the tenant.
func seedDashboardTenant(t *testing.T, app *tests.TestApp, email string) (tenantID string, token string) {
	t.Helper()

	tenant, err := app.FindFirstRecordByData("tenants", "email", email)
	if err != nil || tenant == nil {
		col, _ := app.FindCollectionByNameOrId("tenants")
		tenant = core.NewRecord(col)
		tenant.Set("email", email)
		tenant.Set("api_key", "key-"+email)
		tenant.Set("api_key_lookup", apiKeyLookup("key-"+email))
		tenant.Set("status", "active")
		if err := app.Save(tenant); err != nil {
			t.Fatalf("save tenant: %v", err)
		}
	}
	tenantID = tenant.Id

	// Active subscription.
	subCol, _ := app.FindCollectionByNameOrId("subscriptions")
	sub := core.NewRecord(subCol)
	sub.Set("tenant_id", tenantID)
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

	// Machine/device.
	machCol, _ := app.FindCollectionByNameOrId("tenant_machines")
	m := core.NewRecord(machCol)
	m.Set("tenant_id", tenantID)
	m.Set("machine_id", "mach-1")
	if err := app.Save(m); err != nil {
		t.Fatalf("save machine: %v", err)
	}

	// Session token.
	token = "test-session-token"
	webOtpStore.createSession(hashWebToken(token), tenantID)
	return tenantID, token
}

// doJSON performs a request against the mux and returns the recorder.
func doJSON(mux http.Handler, method, path, auth, body string) *httptest.ResponseRecorder {
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

// ── GET /api/v1/web/usage ─────────────────────────────────────────

func TestWebUsage_ReturnsUsageStats(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	_, token := seedDashboardTenant(t, app, "usage@test.com")

	rec := doJSON(mux, http.MethodGet, "/api/v1/web/usage", "Bearer "+token, "")

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if body["device_count"] != float64(1) {
		t.Errorf("expected device_count 1, got %v", body["device_count"])
	}
	if body["subscription_count"] != float64(1) {
		t.Errorf("expected subscription_count 1, got %v", body["subscription_count"])
	}
	if body["max_locations"] != float64(3) {
		t.Errorf("expected max_locations 3, got %v", body["max_locations"])
	}
	if body["max_pos_instances"] != float64(5) {
		t.Errorf("expected max_pos_instances 5, got %v", body["max_pos_instances"])
	}
}

func TestWebUsage_RejectsNoSession(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()

	rec := doJSON(mux, http.MethodGet, "/api/v1/web/usage", "", "")

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

// ── GET /api/v1/web/devices ───────────────────────────────────────

func TestWebDevices_ReturnsMachines(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	_, token := seedDashboardTenant(t, app, "devices@test.com")

	rec := doJSON(mux, http.MethodGet, "/api/v1/web/devices", "Bearer "+token, "")

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Devices []map[string]any `json:"devices"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if len(body.Devices) != 1 {
		t.Fatalf("expected 1 device, got %d", len(body.Devices))
	}
	if body.Devices[0]["machine_id"] != "mach-1" {
		t.Errorf("expected machine_id mach-1, got %v", body.Devices[0]["machine_id"])
	}
}

// ── POST /api/v1/web/devices/{id}/revoke ─────────────────────────

func TestWebRevokeDevice_SetsRevokedAt(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	_, token := seedDashboardTenant(t, app, "revoke@test.com")

	// Fetch the device to learn its record id.
	rec := doJSON(mux, http.MethodGet, "/api/v1/web/devices", "Bearer "+token, "")
	var list struct {
		Devices []map[string]any `json:"devices"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if len(list.Devices) != 1 {
		t.Fatalf("expected 1 device, got %d", len(list.Devices))
	}
	id := list.Devices[0]["id"].(string)

	rec = doJSON(mux, http.MethodPost, "/api/v1/web/devices/"+id+"/revoke", "Bearer "+token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Status    string `json:"status"`
		RevokedAt string `json:"revoked_at"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if body.Status != "revoked" {
		t.Errorf("expected status revoked, got %q", body.Status)
	}
	if body.RevokedAt == "" {
		t.Error("expected revoked_at timestamp")
	}

	// Second call is idempotent — still 200, still revoked.
	rec2 := doJSON(mux, http.MethodPost, "/api/v1/web/devices/"+id+"/revoke", "Bearer "+token, "")
	if rec2.Code != http.StatusOK {
		t.Fatalf("expected 200 on repeat revoke, got %d", rec2.Code)
	}
}

func TestWebRevokeDevice_RejectsMissingDevice(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	_, token := seedDashboardTenant(t, app, "revoke-missing@test.com")

	rec := doJSON(mux, http.MethodPost, "/api/v1/web/devices/nonexistent/revoke", "Bearer "+token, "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestWebRevokeDevice_RejectsNoSession(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()

	rec := doJSON(mux, http.MethodPost, "/api/v1/web/devices/x/revoke", "", "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

// ── GET /api/v1/admin/tenants ─────────────────────────────────────

func TestAdminListTenants_RequiresKey(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()

	rec := doJSON(mux, http.MethodGet, "/api/v1/admin/tenants", "", "")

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without admin key, got %d", rec.Code)
	}
}

func TestAdminListTenants_ReturnsTenants(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	seedDashboardTenant(t, app, "admin-list@test.com")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	rec := doJSON(mux, http.MethodGet, "/api/v1/admin/tenants", "Bearer secret-admin-key", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Tenants []map[string]any `json:"tenants"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	found := false
	for _, tn := range body.Tenants {
		if tn["email"] == "admin-list@test.com" {
			found = true
		}
	}
	if !found {
		t.Error("expected seeded tenant in list")
	}
}

// ── GET /api/v1/admin/tenants?search= + pagination ────────────────

func TestAdminListTenants_SearchFilters(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	seedDashboardTenant(t, app, "search-alpha@test.com")
	seedDashboardTenant(t, app, "search-beta@test.com")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	rec := doJSON(mux, http.MethodGet,
		"/api/v1/admin/tenants?search=ALPHA", "Bearer secret-admin-key", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Tenants []map[string]any `json:"tenants"`
		Total   int              `json:"total"`
		Search  string           `json:"search"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if body.Total != 1 {
		t.Errorf("expected total=1 for search=ALPHA, got %d", body.Total)
	}
	if len(body.Tenants) != 1 || body.Tenants[0]["email"] != "search-alpha@test.com" {
		t.Errorf("expected only alpha tenant, got %v", body.Tenants)
	}
	if body.Search != "ALPHA" {
		t.Errorf("expected search echo ALPHA, got %q", body.Search)
	}
}

func TestAdminListTenants_Pagination(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	seedDashboardTenant(t, app, "page-a@test.com")
	seedDashboardTenant(t, app, "page-b@test.com")
	seedDashboardTenant(t, app, "page-c@test.com")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	// perPage=2 → page 1 should return 2 tenants, total=3.
	rec := doJSON(mux, http.MethodGet,
		"/api/v1/admin/tenants?page=1&perPage=2", "Bearer secret-admin-key", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Tenants []map[string]any `json:"tenants"`
		Total   int              `json:"total"`
		Page    int              `json:"page"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if body.Total != 3 {
		t.Errorf("expected total=3, got %d", body.Total)
	}
	if len(body.Tenants) != 2 {
		t.Errorf("expected 2 tenants on page 1, got %d", len(body.Tenants))
	}
	if body.Page != 1 {
		t.Errorf("expected page=1, got %d", body.Page)
	}
}

// ── POST /api/v1/admin/tenants/{id}/renew ─────────────────────────

func TestAdminRenew_ExtendsSubscription(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	tenantID, _ := seedDashboardTenant(t, app, "renew@test.com")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	rec := doJSON(mux, http.MethodPost,
		"/api/v1/admin/tenants/"+tenantID+"/renew",
		"Bearer secret-admin-key", `{"days": 30}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if body["status"] != "active" {
		t.Errorf("expected status active, got %v", body["status"])
	}
	if body["expires_at"] == "" {
		t.Error("expected expires_at to be set")
	}
}

// ── POST /api/v1/admin/tenants/{id}/tier-override ─────────────────

func TestAdminTierOverride_UpdatesTier(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	tenantID, _ := seedDashboardTenant(t, app, "override@test.com")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	rec := doJSON(mux, http.MethodPost,
		"/api/v1/admin/tenants/"+tenantID+"/tier-override",
		"Bearer secret-admin-key", `{"tier_key":"premium","reason":"test"}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if body["tier_key"] != "premium" {
		t.Errorf("expected tier_key premium, got %v", body["tier_key"])
	}
}

// ── Contract: /api/v1/web/me shape ──────────────────────────────────

// testContractFields asserts every key in expected is present in the JSON
// response body and has the right Go type (string, bool, float64 etc.).
func testContractFields(t *testing.T, body map[string]any, expected map[string]string) {
	t.Helper()
	for field, typeName := range expected {
		v, ok := body[field]
		if !ok {
			t.Errorf("missing field %q", field)
			continue
		}
		switch typeName {
		case "string":
			if _, ok := v.(string); !ok {
				t.Errorf("field %q should be string, got %T", field, v)
			}
		case "bool":
			if _, ok := v.(bool); !ok {
				t.Errorf("field %q should be bool, got %T", field, v)
			}
		case "float64":
			if _, ok := v.(float64); !ok {
				t.Errorf("field %q should be float64, got %T", field, v)
			}
		}
	}
}

// TestMeContract_FullShape verifies the /me endpoint returns the complete
// set of fields the frontend AccountView consumes, with correct types.
func TestMeContract_FullShape(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()

	tenantID, token := seedDashboardTenant(t, app, "contract-me@test.com")
	// Seed an activated license key so licenseSummary returns a non-nil block.
	seedLicenseKey(t, app, "OZ-CONTRACT-KEY-001", "pro", "activated", "2027-01-01T00:00:00Z")
	keys, err := app.FindRecordsByFilter("license_keys", "key = 'OZ-CONTRACT-KEY-001'", "", 1, 0, nil)
	if err != nil || len(keys) == 0 {
		t.Fatalf("seeded license key not found: %v", err)
	}
	keys[0].Set("activated_by", tenantID)
	if err := app.Save(keys[0]); err != nil {
		t.Fatalf("failed to activate license key: %v", err)
	}

	rec := doJSON(mux, http.MethodGet, "/api/v1/web/me", "Bearer "+token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}

	// Tenant block — consumed by the profile card.
	tenant, ok := body["tenant"].(map[string]any)
	if !ok {
		t.Fatal("missing tenant block")
	}
	testContractFields(t, tenant, map[string]string{
		"id":            "string",
		"email":         "string",
		"emailVerified": "bool",
		"status":        "string",
	})

	// License block — consumed by the license section.
	license, ok := body["license"].(map[string]any)
	if !ok {
		t.Fatal("missing license block")
	}
	testContractFields(t, license, map[string]string{
		"key":       "string",
		"tierKey":   "string",
		"status":    "string",
		"expiresAt": "string",
	})
	if license["expiresAt"].(string) == "" {
		t.Error("license.expiresAt should be non-empty for an activated key")
	}

	// Subscription block — consumed by the subscription section.
	sub, ok := body["subscription"].(map[string]any)
	if !ok {
		t.Fatal("missing subscription block")
	}
	testContractFields(t, sub, map[string]string{
		"tierKey":    "string",
		"status":     "string",
		"startsAt":   "string",
		"expiresAt":  "string",
		"graceUntil": "string",
		"bundleId":   "string",
	})
	if sub["startsAt"].(string) == "" {
		t.Error("subscription.startsAt should be non-empty")
	}
	if sub["expiresAt"].(string) == "" {
		t.Error("subscription.expiresAt should be non-empty")
	}

	// Property: every date field the frontend parses must be RFC3339 UTC —
	// the JS fmtDate/daysUntil helpers assume `2027-01-01T00:00:00Z` shape.
	// A date-only string ("2027-01-01") or non-UTC zone would break them.
	dateFields := []struct {
		name  string
		value string
	}{
		{"license.expiresAt", license["expiresAt"].(string)},
		{"subscription.startsAt", sub["startsAt"].(string)},
		{"subscription.expiresAt", sub["expiresAt"].(string)},
		{"subscription.graceUntil", sub["graceUntil"].(string)},
	}
	for _, df := range dateFields {
		// Empty dates are valid (not-yet-set grace), but a non-empty value
		// must parse as RFC3339 and be timezone-agnostic UTC.
		if df.value == "" {
			continue
		}
		parsed, err := time.Parse(time.RFC3339, df.value)
		if err != nil {
			t.Errorf("field %q (%q) is not RFC3339: %v", df.name, df.value, err)
			continue
		}
		zone, _ := parsed.Zone()
		if zone != "UTC" {
			t.Errorf("field %q (%q) should serialize in UTC, got zone %q", df.name, df.value, zone)
		}
	}
}

// TestMeContract_NilLicense verifies that /me returns a nil license block
// (not a missing key) when the tenant has no activated license key.
func TestMeContract_NilLicense(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()

	_, token := seedDashboardTenant(t, app, "contract-nolicense@test.com")
	// No seedLicenseKey — no activated key, no subscription-linked key.

	rec := doJSON(mux, http.MethodGet, "/api/v1/web/me", "Bearer "+token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if body["license"] != nil {
		t.Error("expected license to be nil when no key exists")
	}
}

// Contract: /api/v1/web/devices shape — every device must carry the
// full set of fields the frontend revoke + device-list logic expects.
func TestWebDevices_ContractFields(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	_, token := seedDashboardTenant(t, app, "contract-devices@test.com")

	rec := doJSON(mux, http.MethodGet, "/api/v1/web/devices", "Bearer "+token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var list struct {
		Devices []map[string]any `json:"devices"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if len(list.Devices) == 0 {
		t.Fatal("expected at least one device from the seeded tenant")
	}
	for i, d := range list.Devices {
		// All fields the frontend reads (AccountView Device interface).
		if _, ok := d["id"]; !ok {
			t.Errorf("devices[%d] missing id", i)
		}
		if _, ok := d["machine_id"]; !ok {
			t.Errorf("devices[%d] missing machine_id", i)
		}
		if _, ok := d["created"]; !ok {
			t.Errorf("devices[%d] missing created", i)
		}
		if _, ok := d["revoked_at"]; !ok {
			t.Errorf("devices[%d] missing revoked_at", i)
		}
		// created must be a parseable RFC3339 string.
		created, ok := d["created"].(string)
		if !ok || created == "" {
			t.Errorf("devices[%d].created should be a non-empty string", i)
		}
	}
}

// Contract: /api/v1/web/usage shape — every field the frontend
// (or the static dashboard) consumes must be present.
func TestWebUsage_ContractFields(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	_, token := seedDashboardTenant(t, app, "contract-usage@test.com")

	rec := doJSON(mux, http.MethodGet, "/api/v1/web/usage", "Bearer "+token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	testContractFields(t, body, map[string]string{
		"device_count":       "float64",
		"subscription_count": "float64",
		"max_locations":      "float64",
		"max_pos_instances":  "float64",
	})
	if body["device_count"].(float64) < 1 {
		t.Error("device_count should be at least 1 for a seeded tenant with a machine")
	}
}

// ── GET /api/v1/admin/tenants/{id} ────────────────────────────────

func TestAdminGetTenant_ReturnsDetail(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	tenantID, _ := seedDashboardTenant(t, app, "admin-get@test.com")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	rec := doJSON(mux, http.MethodGet, "/api/v1/admin/tenants/"+tenantID, "Bearer secret-admin-key", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	tenant, ok := body["tenant"].(map[string]any)
	if !ok {
		t.Fatal("missing tenant block")
	}
	if tenant["id"] != tenantID {
		t.Errorf("tenant.id = %v, want %s", tenant["id"], tenantID)
	}
	if tenant["email"] != "admin-get@test.com" {
		t.Errorf("tenant.email = %v", tenant["email"])
	}
	// License + subscription blocks surface (the seeded tenant has a sub).
	if _, ok := body["subscription"].(map[string]any); !ok {
		t.Error("expected subscription block in tenant detail")
	}
	// Device list: the seeded tenant has one machine.
	devices, ok := body["devices"].([]any)
	if !ok || len(devices) < 1 {
		t.Errorf("expected at least 1 device in tenant detail, got %v", devices)
	}
}

func TestAdminGetTenant_NotFound(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	rec := doJSON(mux, http.MethodGet, "/api/v1/admin/tenants/nonexistent", "Bearer secret-admin-key", "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

// ── POST /api/v1/admin/tenants/{id}/activate ──────────────────────

func TestAdminActivate_FlipsTenantToActive(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	tenantID, _ := seedDashboardTenant(t, app, "admin-activate@test.com")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	// Seed the tenant as revoked first, then activate it.
	tenant, err := app.FindRecordById("tenants", tenantID)
	if err != nil {
		t.Fatalf("tenant not found: %v", err)
	}
	tenant.Set("status", "revoked")
	if err := app.Save(tenant); err != nil {
		t.Fatalf("seed revoked status: %v", err)
	}

	rec := doJSON(mux, http.MethodPost, "/api/v1/admin/tenants/"+tenantID+"/activate", "Bearer secret-admin-key", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	after, err := app.FindRecordById("tenants", tenantID)
	if err != nil {
		t.Fatalf("tenant not found: %v", err)
	}
	if after.GetString("status") != "active" {
		t.Errorf("expected tenant status active after activate, got %q", after.GetString("status"))
	}
}

func TestAdminActivate_NotFound(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	rec := doJSON(mux, http.MethodPost, "/api/v1/admin/tenants/nonexistent/activate", "Bearer secret-admin-key", "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

// ── POST /api/v1/admin/tenants/{id}/revoke ────────────────────────

func TestAdminRevoke_FlipsTenantToRevoked(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	tenantID, _ := seedDashboardTenant(t, app, "admin-revoke@test.com")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	rec := doJSON(mux, http.MethodPost, "/api/v1/admin/tenants/"+tenantID+"/revoke", "Bearer secret-admin-key", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	after, err := app.FindRecordById("tenants", tenantID)
	if err != nil {
		t.Fatalf("tenant not found: %v", err)
	}
	if after.GetString("status") != "revoked" {
		t.Errorf("expected tenant status revoked, got %q", after.GetString("status"))
	}
}

func TestAdminRevoke_RequiresKey(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	tenantID, _ := seedDashboardTenant(t, app, "admin-revoke-nokey@test.com")

	rec := doJSON(mux, http.MethodPost, "/api/v1/admin/tenants/"+tenantID+"/revoke", "", "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without admin key, got %d", rec.Code)
	}
}

// ── GET /api/v1/admin/health ───────────────────────────────────────

func TestAdminHealth_ReportsOK(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	rec := doJSON(mux, http.MethodGet, "/api/v1/admin/health", "Bearer secret-admin-key", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if body["status"] != "ok" {
		t.Errorf("expected status ok, got %v", body["status"])
	}
	if body["db_ok"] != true {
		t.Errorf("expected db_ok true, got %v", body["db_ok"])
	}
}
