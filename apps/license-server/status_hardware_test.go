package main

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

func TestStatusHardware_AttestationAndTokenRotation(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("failed to generate test rsa key: %v", err)
	}
	prev := privateKey
	privateKey = key
	defer func() { privateKey = prev }()

	app, se := setupDirectApp(t)
	defer app.Cleanup()

	tenantID := "hwtenant0000001"
	apiKey := "hw_apikey_0000000000001"
	seedTenant(t, app, tenantID, apiKey, "active")
	seedSubscription(t, app, tenantID, "pro", "active")

	// Seed tenant_machines
	machCol, err := app.FindCollectionByNameOrId("tenant_machines")
	if err != nil {
		t.Fatalf("tenant_machines collection: %v", err)
	}
	machine := core.NewRecord(machCol)
	machine.Set("id", "machattest00001")
	machine.Set("machine_id", "machattest00001")
	machine.Set("tenant_id", tenantID)
	machine.Set("first_seen_at", time.Now().UTC().Add(-24*time.Hour))
	if err := app.Save(machine); err != nil {
		t.Fatalf("failed to save machine: %v", err)
	}

	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux: %v", err)
	}

	hwFP := "hw_1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff"

	// 1. Initial heartbeat with hardware fingerprint
	reqBody := `{"machine_id":"machattest00001","hardware_fingerprint":"` + hwFP + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/license/status", strings.NewReader(reqBody))
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp1 map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp1); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if resp1["device_revoked"] != false {
		t.Errorf("expected device_revoked = false, got %v", resp1["device_revoked"])
	}
	if resp1["hardware_verified"] != true {
		t.Errorf("expected hardware_verified = true, got %v", resp1["hardware_verified"])
	}
	token1, _ := resp1["hardware_token"].(string)
	if token1 == "" || !strings.HasPrefix(token1, "hwt_") {
		t.Errorf("expected hardware_token with prefix 'hwt_', got %q", token1)
	}

	// Verify tenant_machines record was updated with the hardware fingerprint and last_seen_at
	updatedMach, err := app.FindRecordById("tenant_machines", machine.Id)
	if err != nil {
		t.Fatalf("failed to find updated machine: %v", err)
	}
	if updatedMach.GetString("hardware_fingerprint") != hwFP {
		t.Errorf("expected stored hardware_fingerprint %q, got %q", hwFP, updatedMach.GetString("hardware_fingerprint"))
	}
	if updatedMach.GetDateTime("last_seen_at").IsZero() {
		t.Errorf("expected last_seen_at to be set")
	}

	// 2. Second heartbeat rotates hardware token
	time.Sleep(10 * time.Millisecond)
	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/license/status", strings.NewReader(reqBody))
	req2.Header.Set("Authorization", "Bearer "+apiKey)
	req2.Header.Set("Content-Type", "application/json")
	rec2 := httptest.NewRecorder()

	mux.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("expected 200 on second tick, got %d: %s", rec2.Code, rec2.Body.String())
	}
	var resp2 map[string]any
	if err := json.Unmarshal(rec2.Body.Bytes(), &resp2); err != nil {
		t.Fatalf("unmarshal resp2: %v", err)
	}
	if resp2["hardware_verified"] != true {
		t.Errorf("expected hardware_verified = true on second tick")
	}
}

func TestStatusHardware_FingerprintMismatchLocksDevice(t *testing.T) {
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	tenantID := "hwtenant0000002"
	apiKey := "hw_apikey_0000000000002"
	seedTenant(t, app, tenantID, apiKey, "active")
	seedSubscription(t, app, tenantID, "pro", "active")

	machCol, err := app.FindCollectionByNameOrId("tenant_machines")
	if err != nil {
		t.Fatalf("tenant_machines collection: %v", err)
	}
	machine := core.NewRecord(machCol)
	machine.Set("id", "machspoof000001")
	machine.Set("machine_id", "machspoof000001")
	machine.Set("tenant_id", tenantID)
	origFP := "hw_legitimate000000000000000000000000000000000000000000000000000000"
	machine.Set("hardware_fingerprint", origFP)
	if err := app.Save(machine); err != nil {
		t.Fatalf("failed to save machine: %v", err)
	}

	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux: %v", err)
	}

	// Attempt heartbeat with a spoofed / cloned hardware fingerprint
	spoofedFP := "hw_spoofedcloned9999999999999999999999999999999999999999999999999999"
	reqBody := `{"machine_id":"machspoof000001","hardware_fingerprint":"` + spoofedFP + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/license/status", strings.NewReader(reqBody))
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if resp["hardware_verified"] != false {
		t.Errorf("expected hardware_verified = false on mismatch, got %v", resp["hardware_verified"])
	}
	if resp["device_revoked"] != true {
		t.Errorf("expected device_revoked = true on mismatch, got %v", resp["device_revoked"])
	}
}

func TestStatusHardware_MachineRegisteredToDifferentTenant(t *testing.T) {
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	tenantA := "hwtenant000000a"
	apiKeyA := "hw_apikey_A00000000000"
	seedTenant(t, app, tenantA, apiKeyA, "active")
	seedSubscription(t, app, tenantA, "pro", "active")

	tenantB := "hwtenant000000b"
	apiKeyB := "hw_apikey_B00000000000"
	seedTenant(t, app, tenantB, apiKeyB, "active")

	// Register machine to Tenant B
	machCol, err := app.FindCollectionByNameOrId("tenant_machines")
	if err != nil {
		t.Fatalf("tenant_machines collection: %v", err)
	}
	machine := core.NewRecord(machCol)
	machine.Set("id", "machother000001")
	machine.Set("machine_id", "machother000001")
	machine.Set("tenant_id", tenantB)
	if err := app.Save(machine); err != nil {
		t.Fatalf("failed to save machine: %v", err)
	}

	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux: %v", err)
	}

	// Tenant A tries to query status using Tenant B's machine
	reqBody := `{"machine_id":"machother000001"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/license/status", strings.NewReader(reqBody))
	req.Header.Set("Authorization", "Bearer "+apiKeyA)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["device_revoked"] != false {
		t.Errorf("expected device_revoked = false for machine registered to different tenant, got %v", resp["device_revoked"])
	}
	if resp["hardware_verified"] != false {
		t.Errorf("expected hardware_verified = false for machine registered to different tenant, got %v", resp["hardware_verified"])
	}
}
