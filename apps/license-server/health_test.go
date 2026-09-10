package main

// Tests for the /api/health override (bindHealthOverride) and its SMTP
// sender-identity status field. They bind the same middleware main.go
// uses, then hit the real built-in /api/health path through the router, so
// both the interception and the payload are exercised.

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// getHealth builds the mux with the health override bound and issues a GET
// to the given path, returning the recorder.
func getHealth(t *testing.T, path string) *httptest.ResponseRecorder {
	t.Helper()
	app, se := setupDirectApp(t)
	defer app.Cleanup()
	bindHealthOverride(app, se)

	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func TestHealth_SMTPNotConfigured(t *testing.T) {
	resetSMTPHealthCache()
	t.Setenv("OZ_SMTP_HOST", "")
	t.Setenv("OZ_SMTP_FROM", "")

	rec := getHealth(t, "/api/health")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Status string `json:"status"`
		SMTP   struct {
			Configured bool   `json:"configured"`
			Verified   bool   `json:"verified"`
			Error      string `json:"error"`
		} `json:"smtp"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v; body: %s", err, rec.Body.String())
	}
	if body.Status != "ok" {
		t.Errorf("status = %q, want ok", body.Status)
	}
	if body.SMTP.Configured {
		t.Error("smtp.configured should be false when OZ_SMTP_HOST is unset")
	}
	if body.SMTP.Verified {
		t.Error("smtp.verified should be false when SMTP is not configured")
	}
}

func TestHealth_SMTPVerified(t *testing.T) {
	resetSMTPHealthCache()
	addr, _ := runSMTPServer(t, nil, false, testTLSCertPtr(t)) // accepts MAIL FROM
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatalf("split: %v", err)
	}
	t.Setenv("OZ_SMTP_HOST", host)
	t.Setenv("OZ_SMTP_PORT", port)
	t.Setenv("OZ_SMTP_USER", "")
	t.Setenv("OZ_SMTP_PASSWORD", "")
	t.Setenv("OZ_SMTP_FROM", "verified@example.com")

	rec := getHealth(t, "/api/health")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"verified":true`) {
		t.Errorf("expected smtp.verified=true in %s", rec.Body.String())
	}
}

func TestHealth_SMTPRejected(t *testing.T) {
	resetSMTPHealthCache()
	addr, _ := runSMTPServer(t, nil, true, testTLSCertPtr(t)) // 550 on MAIL FROM
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatalf("split: %v", err)
	}
	t.Setenv("OZ_SMTP_HOST", host)
	t.Setenv("OZ_SMTP_PORT", port)
	t.Setenv("OZ_SMTP_USER", "")
	t.Setenv("OZ_SMTP_PASSWORD", "")
	t.Setenv("OZ_SMTP_FROM", "unverified@example.com")

	rec := getHealth(t, "/api/health")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if strings.Contains(body, `"verified":true`) {
		t.Errorf("smtp.verified should be false for a rejected sender: %s", body)
	}
	if !strings.Contains(body, "unverified") && !strings.Contains(body, "not verified") {
		t.Errorf("expected the relay rejection to surface in smtp.error: %s", body)
	}
}

func TestHealth_SMTPUnsetFrom(t *testing.T) {
	resetSMTPHealthCache()
	t.Setenv("OZ_SMTP_HOST", "smtp-relay.brevo.com")
	t.Setenv("OZ_SMTP_PORT", "587")
	t.Setenv("OZ_SMTP_USER", "")
	t.Setenv("OZ_SMTP_PASSWORD", "")
	t.Setenv("OZ_SMTP_FROM", "")

	rec := getHealth(t, "/api/health")
	body := rec.Body.String()
	if !strings.Contains(body, `"configured":true`) || strings.Contains(body, `"verified":true`) {
		t.Errorf("expected configured=true, verified=false: %s", body)
	}
	if !strings.Contains(body, "OZ_SMTP_FROM") {
		t.Errorf("expected an OZ_SMTP_FROM error hint: %s", body)
	}
}

func TestHealth_OtherRoutesPassThrough(t *testing.T) {
	// The override middleware must not swallow non-health routes: the
	// built-in /api/collections (auth-required) should still answer 401,
	// proving the mux chain is intact.
	app, se := setupDirectApp(t)
	defer app.Cleanup()
	bindHealthOverride(app, se)

	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/collections", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 from unauthenticated /api/collections (built-in route intact), got %d: %s", rec.Code, rec.Body.String())
	}
}

// ── Paddle / RSA / Discord gate statuses ─────────────────────────────

func TestHealth_PaddleStatus_Configured(t *testing.T) {
	t.Setenv("PADDLE_WEBHOOK_SECRET", "test-webhook-secret")
	t.Setenv("PADDLE_PRICE_TIERS", "pri_test_pro:pro,pri_test_premium:premium")

	rec := getHealth(t, "/api/health")
	var body struct {
		Paddle struct {
			SecretConfigured     bool   `json:"secret_configured"`
			PriceTiersConfigured bool   `json:"price_tiers_configured"`
			PriceTiersMappings   int    `json:"price_tiers_mappings"`
			Error                string `json:"error"`
		} `json:"paddle"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v; body: %s", err, rec.Body.String())
	}
	if !body.Paddle.SecretConfigured {
		t.Error("expected paddle.secret_configured=true")
	}
	if !body.Paddle.PriceTiersConfigured {
		t.Error("expected paddle.price_tiers_configured=true")
	}
	if body.Paddle.PriceTiersMappings != 2 {
		t.Errorf("expected 2 price→tier mappings, got %d", body.Paddle.PriceTiersMappings)
	}
	if body.Paddle.Error != "" {
		t.Errorf("expected no paddle error, got %q", body.Paddle.Error)
	}
}

func TestHealth_PaddleStatus_Missing(t *testing.T) {
	t.Setenv("PADDLE_WEBHOOK_SECRET", "")
	t.Setenv("PADDLE_PRICE_TIERS", "")

	rec := getHealth(t, "/api/health")
	var body struct {
		Paddle struct {
			SecretConfigured     bool   `json:"secret_configured"`
			PriceTiersConfigured bool   `json:"price_tiers_configured"`
			Error                string `json:"error"`
		} `json:"paddle"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v; body: %s", err, rec.Body.String())
	}
	if body.Paddle.SecretConfigured {
		t.Error("expected paddle.secret_configured=false when the secret is unset")
	}
	if body.Paddle.PriceTiersConfigured {
		t.Error("expected paddle.price_tiers_configured=false when tiers are unset")
	}
	if !strings.Contains(body.Paddle.Error, "PADDLE_PRICE_TIERS") {
		t.Errorf("expected the tiers error to surface, got %q", body.Paddle.Error)
	}
}

// ── Midtrans gate status (C3.1, DEPLOY.md §12) ───────────────────────

func TestHealth_MidtransStatus_Configured(t *testing.T) {
	t.Setenv("MIDTRANS_SERVER_KEY", "Mid-server-test-key")
	t.Setenv("MIDTRANS_PRICE_TIERS", "49000:plus:month,500000:plus:year")

	rec := getHealth(t, "/api/health")
	var body struct {
		Midtrans struct {
			ServerKeyConfigured  bool   `json:"server_key_configured"`
			PriceTiersConfigured bool   `json:"price_tiers_configured"`
			PriceTiersMappings   int    `json:"price_tiers_mappings"`
			Error                string `json:"error"`
		} `json:"midtrans"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v; body: %s", err, rec.Body.String())
	}
	if !body.Midtrans.ServerKeyConfigured {
		t.Error("expected midtrans.server_key_configured=true")
	}
	if !body.Midtrans.PriceTiersConfigured {
		t.Error("expected midtrans.price_tiers_configured=true")
	}
	if body.Midtrans.PriceTiersMappings != 2 {
		t.Errorf("expected 2 amount→tier mappings, got %d", body.Midtrans.PriceTiersMappings)
	}
	if body.Midtrans.Error != "" {
		t.Errorf("expected no midtrans error, got %q", body.Midtrans.Error)
	}
}

func TestHealth_MidtransStatus_Missing(t *testing.T) {
	t.Setenv("MIDTRANS_SERVER_KEY", "")
	t.Setenv("MIDTRANS_PRICE_TIERS", "")

	rec := getHealth(t, "/api/health")
	var body struct {
		Midtrans struct {
			ServerKeyConfigured  bool   `json:"server_key_configured"`
			PriceTiersConfigured bool   `json:"price_tiers_configured"`
			PriceTiersMappings   int    `json:"price_tiers_mappings"`
			Error                string `json:"error"`
		} `json:"midtrans"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v; body: %s", err, rec.Body.String())
	}
	if body.Midtrans.ServerKeyConfigured {
		t.Error("expected midtrans.server_key_configured=false when the server key is unset")
	}
	if body.Midtrans.PriceTiersConfigured {
		t.Error("expected midtrans.price_tiers_configured=false when tiers are unset")
	}
	if body.Midtrans.PriceTiersMappings != 0 {
		t.Errorf("expected 0 mappings when tiers are unset, got %d", body.Midtrans.PriceTiersMappings)
	}
	if !strings.Contains(body.Midtrans.Error, "MIDTRANS_PRICE_TIERS") {
		t.Errorf("expected the tiers error to surface, got %q", body.Midtrans.Error)
	}
}

func TestHealth_MidtransStatus_ServerKeyOnly(t *testing.T) {
	// The alert scenario the runbook cares about: the server key is present
	// but the price map was dropped/rotated — the gate must flag the tiers
	// piece without hiding that the key is fine.
	t.Setenv("MIDTRANS_SERVER_KEY", "Mid-server-test-key")
	t.Setenv("MIDTRANS_PRICE_TIERS", "")

	rec := getHealth(t, "/api/health")
	var body struct {
		Midtrans struct {
			ServerKeyConfigured  bool   `json:"server_key_configured"`
			PriceTiersConfigured bool   `json:"price_tiers_configured"`
			Error                string `json:"error"`
		} `json:"midtrans"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v; body: %s", err, rec.Body.String())
	}
	if !body.Midtrans.ServerKeyConfigured {
		t.Error("expected midtrans.server_key_configured=true with the server key set")
	}
	if body.Midtrans.PriceTiersConfigured {
		t.Error("expected midtrans.price_tiers_configured=false when tiers are unset")
	}
	if !strings.Contains(body.Midtrans.Error, "MIDTRANS_PRICE_TIERS") {
		t.Errorf("expected the tiers error to surface, got %q", body.Midtrans.Error)
	}
}

func TestHealth_RSAStatus(t *testing.T) {
	// setupDirectApp calls initPrivateKey, so the key is loaded.
	rec := getHealth(t, "/api/health")
	var body struct {
		RSA struct {
			Configured bool `json:"configured"`
		} `json:"rsa"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v; body: %s", err, rec.Body.String())
	}
	if !body.RSA.Configured {
		t.Error("expected rsa.configured=true when the signing key is loaded")
	}
}

func TestRSAHealthStatus_WhenKeyMissing(t *testing.T) {
	initPrivateKey(t)
	if !rsaHealthStatus()["configured"].(bool) {
		t.Fatal("precondition failed: key should be loaded")
	}
	orig := privateKey
	privateKey = nil
	defer func() { privateKey = orig }()
	if rsaHealthStatus()["configured"].(bool) {
		t.Error("expected rsa.configured=false when the key is not loaded")
	}
}

func TestHealth_DiscordStatus(t *testing.T) {
	t.Setenv("OZ_DISCORD_WEBHOOK", "")
	rec := getHealth(t, "/api/health")
	if !strings.Contains(rec.Body.String(), `"discord":{"configured":false}`) {
		t.Errorf("expected discord.configured=false when unset: %s", rec.Body.String())
	}

	t.Setenv("OZ_DISCORD_WEBHOOK", "https://discord.com/api/webhooks/123")
	rec = getHealth(t, "/api/health")
	if !strings.Contains(rec.Body.String(), `"discord":{"configured":true}`) {
		t.Errorf("expected discord.configured=true when set: %s", rec.Body.String())
	}
}

// ── Per-market price maps (saas-3 billing, owner go D95) ────────────

func TestHealth_MarketPriceMapsOptionalNotFatal(t *testing.T) {
	t.Setenv("PRICE_TIERS_IDR", "")
	rec := getHealth(t, "/api/health")
	var body struct {
		MarketPrices struct {
			Configured bool              `json:"configured"`
			Markets    map[string]any    `json:"markets"`
			Errors     map[string]string `json:"errors"`
		} `json:"market_prices"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v; body: %s", err, rec.Body.String())
	}
	if body.MarketPrices.Configured {
		t.Error("market maps are optional — absent vars must report configured=false")
	}
	if len(body.MarketPrices.Errors) != 0 {
		t.Errorf("an absent market map is not an error, got %v", body.MarketPrices.Errors)
	}
}

func TestHealth_MarketPriceMapsConfiguredAndMalformed(t *testing.T) {
	t.Setenv("PRICE_TIERS_IDR", "plus=74900,pro=149900")
	t.Setenv("PRICE_TIERS_BROKEN", "plus=")
	rec := getHealth(t, "/api/health")
	var body struct {
		MarketPrices struct {
			Configured bool `json:"configured"`
			Markets    map[string]struct {
				Mappings int `json:"mappings"`
			} `json:"markets"`
			Errors map[string]string `json:"errors"`
		} `json:"market_prices"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v; body: %s", err, rec.Body.String())
	}
	if !body.MarketPrices.Configured {
		t.Error("expected market_prices.configured=true when a map is set")
	}
	if body.MarketPrices.Markets["IDR"].Mappings != 2 {
		t.Errorf("expected 2 IDR mappings, got %+v", body.MarketPrices.Markets)
	}
	if !strings.Contains(body.MarketPrices.Errors["BROKEN"], "PRICE_TIERS_BROKEN") {
		t.Errorf("expected the malformed market's parse error to surface, got %v", body.MarketPrices.Errors)
	}
}
