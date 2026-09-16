package main

// Tests for the one-time session exchange flow (hardening F1, ADR #42):
// exchange-issue mints a short-lived single-use code for an authenticated
// session; exchange-consume turns that code back into a fresh session. The
// per-IP backstop on browser-origin consume calls is covered too.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// doJSONBrowser issues a request WITH a browser Origin header so the
// exchange-consume per-IP limiter is exercised (server-to-server calls are
// exempt by design — see exchangeConsumeLimiter).
func doJSONBrowser(mux http.Handler, method, path, origin, auth, body string) *httptest.ResponseRecorder {
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Origin", origin)
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

// ── exchange-issue ───────────────────────────────────────────────────

func TestExchangeIssue_RequiresSession(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()

	rec := doJSON(mux, http.MethodPost, "/api/v1/web/exchange-issue", "", "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without a session, got %d", rec.Code)
	}
}

func TestExchangeIssue_MintsSingleUseCode(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	_, token := seedDashboardTenant(t, app, "exchange@test.com")

	rec := doJSON(mux, http.MethodPost, "/api/v1/web/exchange-issue", "Bearer "+token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Code      string `json:"code"`
		ExpiresIn int    `json:"expires_in"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if len(body.Code) < 32 {
		t.Errorf("expected a long one-time code, got %q (len %d)", body.Code, len(body.Code))
	}
	if body.ExpiresIn != int(exchangeTTL.Seconds()) {
		t.Errorf("expected expires_in %d, got %d", int(exchangeTTL.Seconds()), body.ExpiresIn)
	}
}

// ── exchange-consume ─────────────────────────────────────────────────

func TestExchangeConsume_TurnsCodeIntoSession(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	_, token := seedDashboardTenant(t, app, "exchange-consume@test.com")

	// Mint a code.
	rec := doJSON(mux, http.MethodPost, "/api/v1/web/exchange-issue", "Bearer "+token, "")
	var minted struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &minted); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}

	// Consume it (browser-origin, so the limiter is checked but not hit).
	rec = doJSONBrowser(mux, http.MethodPost, "/api/v1/web/exchange-consume",
		"https://kasir.mu", "", `{"code":"`+minted.Code+`"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	newToken, _ := body["token"].(string)
	if newToken == "" {
		t.Fatal("expected a fresh session token from exchange-consume")
	}
	// The new token must be a live session bound to the same tenant.
	tenantID := webOtpStore.getSession(hashWebToken(newToken))
	if tenantID == "" {
		t.Error("expected the consumed session to resolve to a tenant")
	}
}

func TestExchangeConsume_SingleUse(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	_, token := seedDashboardTenant(t, app, "exchange-single@test.com")

	rec := doJSON(mux, http.MethodPost, "/api/v1/web/exchange-issue", "Bearer "+token, "")
	var minted struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &minted); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}

	// First consume succeeds.
	rec1 := doJSONBrowser(mux, http.MethodPost, "/api/v1/web/exchange-consume",
		"https://kasir.mu", "", `{"code":"`+minted.Code+`"}`)
	if rec1.Code != http.StatusOK {
		t.Fatalf("expected 200 on first consume, got %d", rec1.Code)
	}
	// Replaying the same code must fail — the code was deleted on read.
	rec2 := doJSONBrowser(mux, http.MethodPost, "/api/v1/web/exchange-consume",
		"https://kasir.mu", "", `{"code":"`+minted.Code+`"}`)
	if rec2.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 on replay, got %d", rec2.Code)
	}
}

func TestExchangeConsume_RateLimitsBrowserOrigin(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	_, token := seedDashboardTenant(t, app, "exchange-ratelimit@test.com")

	// Mint a fresh code before each consume (single-use, so the limiter
	// must be the thing rejecting us — not a stale code).
	mint := func() string {
		rec := doJSON(mux, http.MethodPost, "/api/v1/web/exchange-issue", "Bearer "+token, "")
		var b struct {
			Code string `json:"code"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
			t.Fatalf("mint failed: %v", err)
		}
		return b.Code
	}

	// Drain the budget with real codes; the per-IP limiter rejects the
	// (limit+1)th browser-origin call before the body is even decoded.
	var lastCode int
	for i := 0; i < exchangeConsumeMax+1; i++ {
		code := mint()
		rec := doJSONBrowser(mux, http.MethodPost, "/api/v1/web/exchange-consume",
			"https://kasir.mu", "", `{"code":"`+code+`"}`)
		lastCode = rec.Code
	}
	if lastCode != http.StatusTooManyRequests {
		t.Fatalf("expected 429 on the (limit+1)th browser-origin consume, got %d", lastCode)
	}
}

func TestExchangeConsume_ServerToServerExemptFromLimiter(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	_, token := seedDashboardTenant(t, app, "exchange-s2s@test.com")

	// No Origin header = the Worker proxy path, which must NOT be throttled
	// by the per-IP backstop even beyond the browser budget.
	for i := 0; i < exchangeConsumeMax+1; i++ {
		rec := doJSON(mux, http.MethodPost, "/api/v1/web/exchange-issue", "Bearer "+token, "")
		var b struct {
			Code string `json:"code"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
			t.Fatalf("mint failed: %v", err)
		}
		recConsume := doJSON(mux, http.MethodPost, "/api/v1/web/exchange-consume", "", `{"code":"`+b.Code+`"}`)
		if recConsume.Code != http.StatusOK {
			t.Fatalf("expected 200 on server-to-server consume %d, got %d", i, recConsume.Code)
		}
	}
}
