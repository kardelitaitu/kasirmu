package main

// Tests for the desktop device link (ADR #54 §2.5).
//
// The properties under test are the ones that make the flow safe: only a loopback
// redirect is accepted, only the device that started the link can consume its code, and
// the identity must be the claimed tenant's own account.

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

const testVerifier = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"

func TestLoopbackRedirectOnlyAcceptsLoopbackHTTPWithPort(t *testing.T) {
	for _, tc := range []struct {
		uri string
		ok  bool
	}{
		{"http://127.0.0.1:49152", true},
		{"http://127.0.0.1:49152/callback", true},
		{"http://[::1]:8080", true},
		{"http://127.0.0.1", false},
		{"https://127.0.0.1:49152", false},
		{"http://localhost:49152", false},
		{"http://evil.example.com:49152", false},
		{"https://kasir.mu/callback", false},
		{"", false},
		{"http://", false},
	} {
		if got := loopbackRedirect(tc.uri); got != tc.ok {
			t.Errorf("loopbackRedirect(%q) = %v, want %v", tc.uri, got, tc.ok)
		}
	}
}

// seedLinkDevice prepares a tenant whose account email matches the fake Google claims.
func seedLinkDevice(t *testing.T, app *tests.TestApp) (tenantID, apiKey string) {
	t.Helper()
	tenantID, _ = seedDashboardTenant(t, app, "owner@example.com")
	return tenantID, "key-owner@example.com"
}

// startBody builds the /start payload; state is the caller-chosen flow id.
func startBody(state string) string {
	return `{"machine_id":"mach-1","state":"` + state + `","code_verifier":"` + testVerifier +
		`","redirect_uri":"http://127.0.0.1:49152"}`
}

// linkFlow runs /start then /callback and returns the loopback link code.
func linkFlow(t *testing.T, mux http.Handler, apiKey, state string) string {
	t.Helper()
	if rec := doJSON(mux, http.MethodPost, "/api/v1/desktop/link/google/start", "Bearer "+apiKey, startBody(state)); rec.Code != http.StatusOK {
		t.Fatalf("start(%s): %d %s", state, rec.Code, rec.Body.String())
	}
	rec := doJSON(mux, http.MethodGet, "/api/v1/desktop/link/google/callback?state="+state+"&code=auth-code", "", "")
	if rec.Code != http.StatusFound {
		t.Fatalf("callback(%s): %d %s", state, rec.Code, rec.Body.String())
	}
	location := rec.Header().Get("Location")
	if !strings.HasPrefix(location, "http://127.0.0.1:49152?link_code=") {
		t.Fatalf("Location = %q, want the loopback listener carrying a code", location)
	}
	return location[strings.Index(location, "link_code=")+len("link_code="):]
}

func TestDesktopLinkStartRequiresARegisteredDevice(t *testing.T) {
	t.Setenv("OZ_GOOGLE_CLIENT_ID", "client-abc")
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	seedLinkDevice(t, app)
	body := startBody("0123456789abcdef")

	if rec := doJSON(mux, http.MethodPost, "/api/v1/desktop/link/google/start", "", body); rec.Code != http.StatusUnauthorized {
		t.Fatalf("no credentials must be 401, got %d: %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(mux, http.MethodPost, "/api/v1/desktop/link/google/start", "Bearer wrong-key", body); rec.Code != http.StatusUnauthorized {
		t.Fatalf("an unknown key must be 401, got %d: %s", rec.Code, rec.Body.String())
	}
	unregistered := strings.Replace(body, "mach-1", "mach-unregistered", 1)
	if rec := doJSON(mux, http.MethodPost, "/api/v1/desktop/link/google/start", "Bearer key-owner@example.com", unregistered); rec.Code != http.StatusForbidden {
		t.Fatalf("an unregistered machine must be 403, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestDesktopLinkStartRefusesANonLoopbackRedirect(t *testing.T) {
	t.Setenv("OZ_GOOGLE_CLIENT_ID", "client-abc")
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	_, apiKey := seedLinkDevice(t, app)
	// Without this check the callback would redirect a one-time code to any host.
	body := `{"machine_id":"mach-1","state":"0123456789abcdef","code_verifier":"` + testVerifier + `","redirect_uri":"https://evil.example.com/steal"}`
	rec := doJSON(mux, http.MethodPost, "/api/v1/desktop/link/google/start", "Bearer "+apiKey, body)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for a foreign redirect, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestDesktopLinkStartReturnsAConsentURLWithTheDerivedChallenge(t *testing.T) {
	t.Setenv("OZ_GOOGLE_CLIENT_ID", "client-abc")
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	_, apiKey := seedLinkDevice(t, app)
	rec := doJSON(mux, http.MethodPost, "/api/v1/desktop/link/google/start", "Bearer "+apiKey, startBody("0123456789abcdef"))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var parsed struct {
		AuthorizeURL string `json:"authorizeUrl"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	u, err := url.Parse(parsed.AuthorizeURL)
	if err != nil {
		t.Fatalf("authorizeUrl does not parse: %v", err)
	}
	q := u.Query()
	if got := q.Get("code_challenge"); got != pkceChallenge(testVerifier) {
		t.Errorf("code_challenge = %q, want S256 of the verifier", got)
	}
	if got := q.Get("code_challenge_method"); got != "S256" {
		t.Errorf("code_challenge_method = %q", got)
	}
	if got := q.Get("state"); got != "0123456789abcdef" {
		t.Errorf("state = %q, want the caller's own value", got)
	}
	if got := q.Get("redirect_uri"); !strings.HasSuffix(got, linkPath) {
		t.Errorf("redirect_uri = %q, want this flow's callback path", got)
	}
	if n := desktopLinkState.len(); n != 1 {
		t.Errorf("the start must leave exactly one pending link, got %d", n)
	}
}

func TestDesktopLinkCallbackBindsTheIdentityAndHandsOffToLoopback(t *testing.T) {
	t.Setenv("OZ_GOOGLE_CLIENT_ID", "client-abc")
	t.Setenv("OZ_GOOGLE_CLIENT_SECRET", "secret")
	restore := fakeGoogleToken(t, validClaims("client-abc"))
	defer restore()
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	tenantID, apiKey := seedLinkDevice(t, app)

	code := linkFlow(t, mux, apiKey, "0123456789abcdef")

	// 1. The device that started the link consumes it and learns the account.
	consumed := doJSON(mux, http.MethodPost, "/api/v1/desktop/link/consume", "Bearer "+apiKey,
		`{"link_code":"`+code+`","machine_id":"mach-1"}`)
	if consumed.Code != http.StatusOK {
		t.Fatalf("consume: %d %s", consumed.Code, consumed.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(consumed.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if body["tenantId"] != tenantID {
		t.Errorf("tenantId = %v, want %v", body["tenantId"], tenantID)
	}
	if body["email"] != "owner@example.com" {
		t.Errorf("email = %v", body["email"])
	}
	if rows := identityRows(t, app, providerGoogle, "1234567890"); len(rows) != 1 || rows[0].GetString("tenant") != tenantID {
		t.Errorf("the identity must be linked to the claimed tenant, got %d row(s)", len(rows))
	}

	// 2. Single-use: the same code again is refused.
	if again := doJSON(mux, http.MethodPost, "/api/v1/desktop/link/consume", "Bearer "+apiKey, `{"link_code":"`+code+`","machine_id":"mach-1"}`); again.Code != http.StatusBadRequest {
		t.Errorf("a replayed code must be refused, got %d", again.Code)
	}

	// 3. Device binding: a FRESH code cannot be spent by another machine, even one
	// registered to the same tenant with valid credentials of its own.
	machines, err := app.FindCollectionByNameOrId("tenant_machines")
	if err != nil {
		t.Fatalf("tenant_machines: %v", err)
	}
	second := core.NewRecord(machines)
	second.Set("tenant_id", tenantID)
	second.Set("machine_id", "mach-2")
	if err := app.Save(second); err != nil {
		t.Fatalf("save second machine: %v", err)
	}
	freshCode := linkFlow(t, mux, apiKey, "fedcba9876543210")
	foreign := doJSON(mux, http.MethodPost, "/api/v1/desktop/link/consume", "Bearer "+apiKey,
		`{"link_code":"`+freshCode+`","machine_id":"mach-2"}`)
	if foreign.Code != http.StatusBadRequest {
		t.Errorf("another machine must not consume the code, got %d: %s", foreign.Code, foreign.Body.String())
	}
}
