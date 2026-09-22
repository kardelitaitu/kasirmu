package main

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

func TestCRL_EndpointReturnsSignedList(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("failed to generate test rsa key: %v", err)
	}
	prev := privateKey
	privateKey = key
	defer func() { privateKey = prev }()

	app, se := setupDirectApp(t)
	defer app.Cleanup()

	// Seed a revoked license key
	keyCol, err := app.FindCollectionByNameOrId("license_keys")
	if err != nil {
		t.Fatalf("failed to find license_keys collection: %v", err)
	}
	revokedKey := "OZ-PRO-REVOKED-001"
	rec := core.NewRecord(keyCol)
	rec.Set("key", revokedKey)
	rec.Set("tier_key", "pro")
	rec.Set("status", "activated")
	rec.Set("expires_at", "2027-01-01T00:00:00Z")
	rec.Set("revoked_at", time.Now().UTC().Format(time.RFC3339))
	rec.Set("notes", "fraudulent dispute")
	if err := app.Save(rec); err != nil {
		t.Fatalf("failed to save revoked license key: %v", err)
	}

	// Seed an active (non-revoked) key
	activeKey := "OZ-PRO-ACTIVE-002"
	recActive := core.NewRecord(keyCol)
	recActive.Set("key", activeKey)
	recActive.Set("tier_key", "pro")
	recActive.Set("status", "activated")
	recActive.Set("expires_at", "2027-01-01T00:00:00Z")
	if err := app.Save(recActive); err != nil {
		t.Fatalf("failed to save active key: %v", err)
	}

	// Seed a revoked tenant
	tenantCol, err := app.FindCollectionByNameOrId("tenants")
	if err != nil {
		t.Fatalf("failed to find tenants collection: %v", err)
	}
	tenantRec := core.NewRecord(tenantCol)
	tenantRec.Set("email", "banned@merchant.com")
	tenantRec.Set("status", "revoked")
	tenantRec.Set("api_key", "oz_banned_apikey")
	if err := app.Save(tenantRec); err != nil {
		t.Fatalf("failed to save revoked tenant: %v", err)
	}
	bannedTenantID := tenantRec.Id

	// Mount CRL endpoint
	se.Router.GET("/api/v1/license/crl", handleLicenseCrl(app))
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/license/crl", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", w.Code, w.Body.String())
	}

	var resp CrlResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	if resp.Payload == "" || resp.Signature == "" {
		t.Fatalf("empty payload or signature: %+v", resp)
	}

	// Verify RSA signature
	sigBytes, err := base64.StdEncoding.DecodeString(resp.Signature)
	if err != nil {
		t.Fatalf("failed to decode signature base64: %v", err)
	}
	hash := sha256.Sum256([]byte(resp.Payload))
	pubKey := &key.PublicKey
	if err := rsa.VerifyPKCS1v15(pubKey, crypto.SHA256, hash[:], sigBytes); err != nil {
		t.Fatalf("signature verification failed: %v", err)
	}

	// Parse payload
	var payload CrlPayload
	if err := json.Unmarshal([]byte(resp.Payload), &payload); err != nil {
		t.Fatalf("failed to parse payload json: %v", err)
	}

	if payload.Issuer != "kasir.mu" {
		t.Errorf("issuer = %q, want 'kasir.mu'", payload.Issuer)
	}

	// Verify revoked key is present
	foundKey := false
	expectedHash := sha256.Sum256([]byte(revokedKey))
	expectedHashHex := hex.EncodeToString(expectedHash[:])

	for _, entry := range payload.Entries {
		if entry.Key == revokedKey {
			foundKey = true
			if entry.KeyHash != expectedHashHex {
				t.Errorf("entry.KeyHash = %q, want %q", entry.KeyHash, expectedHashHex)
			}
			if entry.Reason != "fraudulent dispute" {
				t.Errorf("entry.Reason = %q, want 'fraudulent dispute'", entry.Reason)
			}
		}
		if entry.Key == activeKey {
			t.Errorf("activeKey %q should not be in CRL entries!", activeKey)
		}
	}
	if !foundKey {
		t.Errorf("revoked key %q was not found in CRL entries", revokedKey)
	}

	// Verify revoked tenant is present
	foundTenant := false
	for _, tID := range payload.RevokedTenants {
		if tID == bannedTenantID {
			foundTenant = true
		}
	}
	if !foundTenant {
		t.Errorf("revoked tenant %q was not found in RevokedTenants list", bannedTenantID)
	}
}

func TestCRL_EmptyAndDeviceRevocations(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("failed to generate test rsa key: %v", err)
	}
	prev := privateKey
	privateKey = key
	defer func() { privateKey = prev }()

	app, se := setupDirectApp(t)
	defer app.Cleanup()

	// Seed a tenant first so foreign relation is valid
	tenantCol, err := app.FindCollectionByNameOrId("tenants")
	if err != nil {
		t.Fatalf("failed to find tenants collection: %v", err)
	}
	tenantRec := core.NewRecord(tenantCol)
	tenantRec.Set("email", "owner@merchant.com")
	tenantRec.Set("status", "active")
	tenantRec.Set("api_key", "oz_active_key_999")
	if err := app.Save(tenantRec); err != nil {
		t.Fatalf("failed to save tenant: %v", err)
	}

	// Seed a revoked device
	machCol, err := app.FindCollectionByNameOrId("tenant_machines")
	if err != nil {
		t.Fatalf("failed to find tenant_machines collection: %v", err)
	}
	machRec := core.NewRecord(machCol)
	machRec.Set("machine_id", "stolen-tablet-999")
	machRec.Set("tenant_id", tenantRec.Id)
	machRec.Set("revoked_at", time.Now().UTC().Format(time.RFC3339))
	if err := app.Save(machRec); err != nil {
		t.Fatalf("failed to save revoked device: %v", err)
	}

	se.Router.GET("/api/v1/license/crl", handleLicenseCrl(app))
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/license/crl", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var resp CrlResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}

	var payload CrlPayload
	if err := json.Unmarshal([]byte(resp.Payload), &payload); err != nil {
		t.Fatalf("payload parse error: %v", err)
	}

	if len(payload.Entries) != 0 {
		t.Errorf("expected 0 entries, got %d", len(payload.Entries))
	}
	if len(payload.RevokedTenants) != 0 {
		t.Errorf("expected 0 revoked tenants, got %d", len(payload.RevokedTenants))
	}

	foundDevice := false
	for _, dev := range payload.RevokedDevices {
		if dev == "stolen-tablet-999" {
			foundDevice = true
		}
	}
	if !foundDevice {
		t.Errorf("stolen-tablet-999 was not found in revoked_devices: %+v", payload.RevokedDevices)
	}
}

