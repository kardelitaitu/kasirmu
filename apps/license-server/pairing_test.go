package main

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

func TestPairingStartAndPollPending(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()

	// 1. Start pairing without machine_id -> 400
	rec := doJSON(mux, http.MethodPost, "/api/v1/pairing/start", "", `{"device_name":"Tablet"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing machine_id, got %d", rec.Code)
	}

	// 2. Start pairing valid -> 200
	rec = doJSON(mux, http.MethodPost, "/api/v1/pairing/start", "", `{"machine_id":"tablet-01","device_name":"Front Counter Tablet"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for pairing start, got %d: %s", rec.Code, rec.Body.String())
	}

	var startResp struct {
		Code      string `json:"code"`
		PollToken string `json:"poll_token"`
		ExpiresAt string `json:"expires_at"`
		QrURL     string `json:"qr_url"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &startResp); err != nil {
		t.Fatalf("failed to decode start response: %v", err)
	}

	if len(normalizePairingCode(startResp.Code)) != 8 {
		t.Fatalf("expected 8-char normalized pairing code, got %q", startResp.Code)
	}
	if startResp.PollToken == "" {
		t.Fatal("expected non-empty poll_token")
	}
	if startResp.QrURL == "" {
		t.Fatal("expected non-empty qr_url")
	}

	// 3. Poll while pending -> returns { "status": "pending" }
	pollRec := doJSON(mux, http.MethodPost, "/api/v1/pairing/poll", "", `{"poll_token":"`+startResp.PollToken+`"}`)
	if pollRec.Code != http.StatusOK {
		t.Fatalf("expected 200 for poll, got %d: %s", pollRec.Code, pollRec.Body.String())
	}
	var pollResp struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(pollRec.Body.Bytes(), &pollResp); err != nil {
		t.Fatalf("failed to decode poll response: %v", err)
	}
	if pollResp.Status != "pending" {
		t.Fatalf("expected status 'pending', got %q", pollResp.Status)
	}

	// 4. Poll with invalid token -> 404
	invalidPoll := doJSON(mux, http.MethodPost, "/api/v1/pairing/poll", "", `{"poll_token":"non-existent-token"}`)
	if invalidPoll.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for invalid poll token, got %d", invalidPoll.Code)
	}
}

func TestPairingClaimAndPollClaimed(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()

	// Seed a tenant with a web session
	email := "operator@kasir.mu"
	tenantID, webToken := seedDashboardTenant(t, app, email)

	// Start pairing
	startRec := doJSON(mux, http.MethodPost, "/api/v1/pairing/start", "", `{"machine_id":"tablet-front","device_name":"Counter 1"}`)
	if startRec.Code != http.StatusOK {
		t.Fatalf("start pairing failed: %d %s", startRec.Code, startRec.Body.String())
	}
	var startResp struct {
		Code      string `json:"code"`
		PollToken string `json:"poll_token"`
	}
	_ = json.Unmarshal(startRec.Body.Bytes(), &startResp)

	// Claim without auth -> 401
	unauthClaim := doJSON(mux, http.MethodPost, "/api/v1/pairing/claim", "", `{"code":"`+startResp.Code+`"}`)
	if unauthClaim.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for unauthenticated claim, got %d", unauthClaim.Code)
	}

	// Claim with invalid code -> 400
	badCodeClaim := doJSON(mux, http.MethodPost, "/api/v1/pairing/claim", "Bearer "+webToken, `{"code":"ZZZZ-9999"}`)
	if badCodeClaim.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for bad pairing code, got %d", badCodeClaim.Code)
	}

	// Claim with valid code (and test transcription tolerance: lowercase, spaces)
	formattedCode := "  " + startResp.Code + "  "
	claimRec := doJSON(mux, http.MethodPost, "/api/v1/pairing/claim", "Bearer "+webToken, `{"code":"`+formattedCode+`"}`)
	if claimRec.Code != http.StatusOK {
		t.Fatalf("claim failed: %d %s", claimRec.Code, claimRec.Body.String())
	}
	var claimResp struct {
		Status   string `json:"status"`
		TenantID string `json:"tenant_id"`
	}
	_ = json.Unmarshal(claimRec.Body.Bytes(), &claimResp)
	if claimResp.Status != "claimed" || claimResp.TenantID != tenantID {
		t.Fatalf("unexpected claim response: %+v", claimResp)
	}

	// Re-claiming the same code -> 400 (already used)
	reclaim := doJSON(mux, http.MethodPost, "/api/v1/pairing/claim", "Bearer "+webToken, `{"code":"`+startResp.Code+`"}`)
	if reclaim.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for reclaiming used code, got %d", reclaim.Code)
	}

	// Poll after claim -> returns claimed details + terminal credentials (idempotent)
	for i := 0; i < 2; i++ {
		pollRec := doJSON(mux, http.MethodPost, "/api/v1/pairing/poll", "", `{"poll_token":"`+startResp.PollToken+`"}`)
		if pollRec.Code != http.StatusOK {
			t.Fatalf("poll attempt %d failed: %d %s", i+1, pollRec.Code, pollRec.Body.String())
		}
		var claimedPoll struct {
			Status   string         `json:"status"`
			TenantID string         `json:"tenant_id"`
			Email    string         `json:"email"`
			Terminal map[string]any `json:"terminal"`
		}
		if err := json.Unmarshal(pollRec.Body.Bytes(), &claimedPoll); err != nil {
			t.Fatalf("failed to decode claimed poll response: %v", err)
		}
		if claimedPoll.Status != "claimed" {
			t.Fatalf("expected status 'claimed', got %q", claimedPoll.Status)
		}
		if claimedPoll.TenantID != tenantID {
			t.Fatalf("expected tenant_id %q, got %q", tenantID, claimedPoll.TenantID)
		}
		if claimedPoll.Email != email {
			t.Fatalf("expected email %q, got %q", email, claimedPoll.Email)
		}
		if claimedPoll.Terminal == nil {
			t.Fatal("expected non-nil terminal payload")
		}
	}
}

func TestPairingClaimViaAdminKey(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()

	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	email := "merchant@kasir.mu"
	tenantID, _ := seedDashboardTenant(t, app, email)

	startRec := doJSON(mux, http.MethodPost, "/api/v1/pairing/start", "", `{"machine_id":"tablet-pos-admin","device_name":"Admin Paired"}`)
	if startRec.Code != http.StatusOK {
		t.Fatalf("start pairing failed: %d %s", startRec.Code, startRec.Body.String())
	}
	var startResp struct {
		Code      string `json:"code"`
		PollToken string `json:"poll_token"`
	}
	_ = json.Unmarshal(startRec.Body.Bytes(), &startResp)

	// Claim via admin key without tenant_id -> 400
	noTenantClaim := doJSON(mux, http.MethodPost, "/api/v1/pairing/claim", "Bearer secret-admin-key", `{"code":"`+startResp.Code+`"}`)
	if noTenantClaim.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 when admin claims without tenant_id, got %d", noTenantClaim.Code)
	}

	// Claim via admin key with tenant_id -> 200
	adminClaim := doJSON(mux, http.MethodPost, "/api/v1/pairing/claim", "Bearer secret-admin-key", `{"code":"`+startResp.Code+`","tenant_id":"`+tenantID+`"}`)
	if adminClaim.Code != http.StatusOK {
		t.Fatalf("admin claim failed: %d %s", adminClaim.Code, adminClaim.Body.String())
	}

	// Poll returns claimed
	pollRec := doJSON(mux, http.MethodPost, "/api/v1/pairing/poll", "", `{"poll_token":"`+startResp.PollToken+`"}`)
	if pollRec.Code != http.StatusOK {
		t.Fatalf("poll failed: %d %s", pollRec.Code, pollRec.Body.String())
	}
	var pollResp struct {
		Status   string `json:"status"`
		TenantID string `json:"tenant_id"`
	}
	_ = json.Unmarshal(pollRec.Body.Bytes(), &pollResp)
	if pollResp.Status != "claimed" || pollResp.TenantID != tenantID {
		t.Fatalf("unexpected poll response: %+v", pollResp)
	}
}

func TestPairingCrockfordNormalization(t *testing.T) {
	// 'O' and '0' map to '0', 'I', 'L', '1' map to '1', hyphens and spaces stripped
	raw := "o1-il-0x"
	got := normalizePairingCode(raw)
	want := "01110X"
	if got != want {
		t.Fatalf("normalizePairingCode(%q) = %q, want %q", raw, got, want)
	}
}

func TestPairingSessionExpiry(t *testing.T) {
	store := &pairingStore{
		byCode:  make(map[string]*pairingSession),
		byToken: make(map[string]*pairingSession),
		max:     10,
	}

	expiredSession := &pairingSession{
		Code:      "ABCD-1234",
		PollToken: "poll-expired",
		ExpiresAt: time.Now().Add(-1 * time.Minute),
		Status:    "pending",
	}
	store.put(expiredSession)

	// getByCode on expired session returns nil, false
	if _, ok := store.getByCode("ABCD-1234"); ok {
		t.Fatal("expected expired session to not be found by code")
	}

	// getByToken on expired session returns nil, false
	if _, ok := store.getByToken("poll-expired"); ok {
		t.Fatal("expected expired session to not be found by token")
	}
}
