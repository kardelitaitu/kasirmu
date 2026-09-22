// Certificate/Licence Revocation List (CRL) for ADR #58 §2.1 / §2.2.
//
// GET /api/v1/license/crl provides a public, cryptographically signed list
// of revoked license keys, tenants, and devices. This enables offline clients
// and syncing devices to instantaneously detect and enforce revocation of
// compromised, fraudulent, or chargebacked credentials.
//
// The payload is signed with the licence server's RSA-2048 private key using
// PKCS1v15/SHA-256 (via signDetached) and is verified on the client using
// LICENSE_PUBLIC_KEY_PEM.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"log"
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// CrlEntry represents one revoked license key in the CRL.
type CrlEntry struct {
	// The license key in cleartext (e.g. "OZ-PRO-...")
	Key string `json:"key"`
	// SHA-256 hex digest of the key for fast matching
	KeyHash string `json:"key_hash"`
	// Tenant ID the key was activated by, if known
	TenantID string `json:"tenant_id,omitempty"`
	// RFC 3339 timestamp when the key was revoked
	RevokedAt string `json:"revoked_at"`
	// Reason or notes associated with the revocation
	Reason string `json:"reason,omitempty"`
}

// CrlPayload is the canonical data structure signed by the license server.
type CrlPayload struct {
	// Issuer identifier (kasir.mu)
	Issuer string `json:"issuer"`
	// RFC 3339 timestamp when the CRL was issued
	IssuedAt string `json:"issued_at"`
	// List of revoked license key entries
	Entries []CrlEntry `json:"entries"`
	// List of tenant IDs whose status is "revoked"
	RevokedTenants []string `json:"revoked_tenants"`
	// List of machine IDs explicitly revoked
	RevokedDevices []string `json:"revoked_devices"`
}

// CrlResponse is the HTTP response envelope returned to callers.
type CrlResponse struct {
	// Canonical JSON string of the CrlPayload
	Payload string `json:"payload"`
	// Base64 RSA-2048 PKCS1v15 SHA-256 signature over Payload
	Signature string `json:"signature"`
}

// buildCrlPayload queries the database for all revoked entities and constructs a CrlPayload.
func buildCrlPayload(app core.App) (*CrlPayload, error) {
	// 1. Revoked license keys
	keyRecords, err := app.FindRecordsByFilter(
		"license_keys",
		"revoked_at != ''",
		"-revoked_at",
		5000,
		0,
		nil,
	)
	if err != nil {
		log.Printf("crl: query license_keys error: %v", err)
	}

	entries := make([]CrlEntry, 0, len(keyRecords))
	for _, rec := range keyRecords {
		keyStr := rec.GetString("key")
		if keyStr == "" {
			continue
		}
		h := sha256.Sum256([]byte(keyStr))
		revokedAt := formatDateField(rec, "revoked_at")
		if revokedAt == "" {
			revokedAt = time.Now().UTC().Format(time.RFC3339)
		}
		entries = append(entries, CrlEntry{
			Key:       keyStr,
			KeyHash:   hex.EncodeToString(h[:]),
			TenantID:  rec.GetString("activated_by"),
			RevokedAt: revokedAt,
			Reason:    rec.GetString("notes"),
		})
	}

	// 2. Revoked tenants
	tenantRecords, err := app.FindRecordsByFilter(
		"tenants",
		"status = 'revoked'",
		"-updated",
		5000,
		0,
		nil,
	)
	if err != nil {
		log.Printf("crl: query tenants error: %v", err)
	}

	revokedTenants := make([]string, 0, len(tenantRecords))
	for _, rec := range tenantRecords {
		revokedTenants = append(revokedTenants, rec.Id)
	}

	// 3. Revoked devices
	machineRecords, err := app.FindRecordsByFilter(
		"tenant_machines",
		"revoked_at != ''",
		"-revoked_at",
		5000,
		0,
		nil,
	)
	if err != nil {
		log.Printf("crl: query tenant_machines error: %v", err)
	}

	revokedDevices := make([]string, 0, len(machineRecords))
	for _, rec := range machineRecords {
		mID := rec.GetString("machine_id")
		if mID != "" {
			revokedDevices = append(revokedDevices, mID)
		}
	}

	return &CrlPayload{
		Issuer:         "kasir.mu",
		IssuedAt:       time.Now().UTC().Format(time.RFC3339),
		Entries:        entries,
		RevokedTenants: revokedTenants,
		RevokedDevices: revokedDevices,
	}, nil
}

// handleLicenseCrl returns the signed Certificate/Licence Revocation List.
//
// Unauthenticated by design: any POS terminal or sync node, even before
// activation or after credentials lapse, can inspect the revocation list.
func handleLicenseCrl(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		payload, err := buildCrlPayload(app)
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{
				"error": "failed to build revocation list",
			})
		}

		payloadBytes, err := jsonMarshal(payload)
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{
				"error": "failed to serialize revocation list",
			})
		}

		sig, err := signDetached(payloadBytes)
		if err != nil {
			log.Printf("crl: failed to sign payload: %v", err)
			return e.JSON(http.StatusInternalServerError, map[string]any{
				"error": "failed to sign revocation list",
			})
		}

		return e.JSON(http.StatusOK, CrlResponse{
			Payload:   string(payloadBytes),
			Signature: sig,
		})
	}
}
