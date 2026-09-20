package main

// Tests for sync-terminal registration at link time (ADR #54 §2.5 steps 6-7).
//
// Two properties matter: the registration actually reaches the sync service with the admin
// key and the right body, and a sync service that is missing or failing does NOT fail the
// link — it reports `terminal.issued=false` so the caller can see the difference.

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// syncStub stands in for the sync service and records what it was asked.
func syncStub(t *testing.T, status int, body string) (*httptest.Server, *recordedTerminal) {
	t.Helper()
	seen := &recordedTerminal{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen.method = r.Method
		seen.path = r.URL.Path
		seen.adminKey = r.Header.Get("x-admin-key")
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &seen.body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	return server, seen
}

type recordedTerminal struct {
	method   string
	path     string
	adminKey string
	body     struct {
		TerminalID string `json:"terminal_id"`
		TenantID   string `json:"tenant_id"`
		Label      string `json:"label"`
	}
}

// terminalPayloadOf runs the Google link end to end and returns the `terminal` field.
func terminalPayloadOf(t *testing.T, mux http.Handler, apiKey, state string) map[string]any {
	t.Helper()
	code := linkFlow(t, mux, apiKey, state)
	rec := doJSON(mux, http.MethodPost, "/api/v1/desktop/link/consume", "Bearer "+apiKey,
		`{"link_code":"`+code+`","machine_id":"mach-1"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("consume: %d %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	terminal, ok := body["terminal"].(map[string]any)
	if !ok {
		t.Fatalf("the reply must say whether a sync credential was issued: %v", body)
	}
	return terminal
}

func TestConsumeRegistersASyncTerminal(t *testing.T) {
	t.Setenv("OZ_GOOGLE_CLIENT_ID", "client-abc")
	t.Setenv("OZ_GOOGLE_CLIENT_SECRET", "secret")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")
	stub, seen := syncStub(t, http.StatusOK, `{"terminal_id":"mach-1","device_secret":"ds-1"}`)
	defer stub.Close()
	t.Setenv("OZ_SYNC_API_URL", stub.URL)
	restore := fakeGoogleToken(t, validClaims("client-abc"))
	defer restore()
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	tenantID, apiKey := seedLinkDevice(t, app)

	terminal := terminalPayloadOf(t, mux, apiKey, "0123456789abcdef")

	if terminal["issued"] != true {
		t.Fatalf("a reachable sync service must issue a credential: %v", terminal)
	}
	if terminal["deviceSecret"] != "ds-1" || terminal["terminalId"] != "mach-1" {
		t.Errorf("the credential must be passed through: %v", terminal)
	}
	if seen.path != syncTerminalPath || seen.method != http.MethodPost {
		t.Errorf("asked %s %s, want POST %s", seen.method, seen.path, syncTerminalPath)
	}
	if seen.adminKey != "secret-admin-key" {
		t.Errorf("admin key header = %q", seen.adminKey)
	}
	if seen.body.TerminalID != "mach-1" || seen.body.TenantID != tenantID {
		t.Errorf("registration body = %+v", seen.body)
	}
}

func TestConsumeSucceedsWithoutASyncCredential(t *testing.T) {
	// The best-effort property: linking is the primary purpose, so an unconfigured or failing
	// sync service leaves the account linked and SAYS the credential is missing.
	t.Setenv("OZ_GOOGLE_CLIENT_ID", "client-abc")
	t.Setenv("OZ_GOOGLE_CLIENT_SECRET", "secret")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")
	t.Setenv("OZ_SYNC_API_URL", "")
	restore := fakeGoogleToken(t, validClaims("client-abc"))
	defer restore()
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	_, apiKey := seedLinkDevice(t, app)

	terminal := terminalPayloadOf(t, mux, apiKey, "0123456789abcdef")
	if terminal["issued"] != false {
		t.Fatalf("an unconfigured sync service cannot issue anything: %v", terminal)
	}
	if reason, _ := terminal["reason"].(string); reason == "" {
		t.Error("the reply must say why no credential was issued")
	}
}

func TestConsumeSurvivesASyncServiceFailure(t *testing.T) {
	t.Setenv("OZ_GOOGLE_CLIENT_ID", "client-abc")
	t.Setenv("OZ_GOOGLE_CLIENT_SECRET", "secret")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")
	stub, _ := syncStub(t, http.StatusUnauthorized, `{"error":"invalid_admin_key"}`)
	defer stub.Close()
	t.Setenv("OZ_SYNC_API_URL", stub.URL)
	restore := fakeGoogleToken(t, validClaims("client-abc"))
	defer restore()
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	tenantID, apiKey := seedLinkDevice(t, app)

	terminal := terminalPayloadOf(t, mux, apiKey, "0123456789abcdef")
	if terminal["issued"] != false {
		t.Fatalf("a 401 from the sync service cannot issue: %v", terminal)
	}
	// And the account really is linked — the failure is scoped to the credential.
	rows := identityRows(t, app, providerGoogle, "1234567890")
	if len(rows) != 1 || rows[0].GetString("tenant") != tenantID {
		t.Errorf("the identity must be linked despite the sync failure: %d row(s)", len(rows))
	}
}

func TestEmailConsumeAlsoRegistersATerminal(t *testing.T) {
	// Both doors reach the same destination, so both must earn the credential.
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")
	stub, _ := syncStub(t, http.StatusOK, `{"terminal_id":"mach-1","device_secret":"ds-2"}`)
	defer stub.Close()
	t.Setenv("OZ_SYNC_API_URL", stub.URL)
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	_, apiKey := seedLinkDevice(t, app)
	var sent string
	restore := stubOTPEmail(t, &sent)
	defer restore()
	if rec := doJSON(mux, http.MethodPost, "/api/v1/desktop/link/email/request", "Bearer "+apiKey,
		`{"machine_id":"mach-1","email":"owner@example.com"}`); rec.Code != http.StatusOK {
		t.Fatalf("request: %d %s", rec.Code, rec.Body.String())
	}
	rec := doJSON(mux, http.MethodPost, "/api/v1/desktop/link/email/consume", "Bearer "+apiKey,
		`{"machine_id":"mach-1","code":"`+sent+`"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("consume: %d %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	terminal, _ := body["terminal"].(map[string]any)
	if terminal == nil || terminal["issued"] != true || terminal["deviceSecret"] != "ds-2" {
		t.Fatalf("the email door must issue the same credential: %v", body)
	}
}
