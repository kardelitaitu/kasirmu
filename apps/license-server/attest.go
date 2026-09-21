// Origin attestation for the server-origin fallback ladder (ADR #55).
//
// POST /api/v1/license/attest answers a client-chosen nonce with an RSA-2048
// PKCS1v15/SHA-256 signature over a canonical payload. A client about to send a
// bearer credential (the tenant api_key, a sync token, a terminal device secret)
// to a *candidate* origin first asks that origin to prove it holds the license
// keypair; a hijacked or lapsed fallback domain cannot answer, so the credential
// is never offered to it.
//
// This is an unauthenticated signing oracle by construction, so the input is
// deliberately narrow: the nonce is 16-64 characters of [A-Za-z0-9_-], it is
// echoed in the signed payload, and nothing else from the request is signed. No
// attacker-chosen payload is ever signed.
//
// Verification on the client uses LICENSE_PUBLIC_KEY_PEM, the same key that
// verifies subscription payloads, and deliberately does NOT accept the
// BOOTSTRAP_FREE sentinel.
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// attestPayloadPrefix namespaces the signed payload so a signature produced for
// attestation can never be replayed as a subscription payload, or the reverse.
const attestPayloadPrefix = "ozpos-origin-attest-v1:"

// Nonce bounds: long enough to be unguessable, short enough that the signed
// payload stays a fixed, tiny size.
const (
	attestNonceMin = 16
	attestNonceMax = 64
)

// attestPayload builds the canonical signed payload for a nonce.
func attestPayload(nonce string) string {
	return attestPayloadPrefix + nonce
}

// validOpaqueToken reports whether a client-supplied opaque token — an attestation
// nonce, an OAuth state value — is within bounds and uses only the unreserved
// characters a hex, UUID or base64url token can contain.
//
// Bounded because these values end up in maps keyed by the value the client chose.
func validOpaqueToken(nonce string) bool {
	if len(nonce) < attestNonceMin || len(nonce) > attestNonceMax {
		return false
	}
	for _, r := range nonce {
		switch {
		case r >= 'a' && r <= 'z',
			r >= 'A' && r <= 'Z',
			r >= '0' && r <= '9',
			r == '-', r == '_':
		default:
			return false
		}
	}
	return true
}

// handleAttest answers a nonce with a detached signature over attestPayload.
//
// Unauthenticated by design: the client has not chosen an origin yet, so it has
// no credential to present. The nonce is therefore length- and charset-bounded
// so the signer can never be fed attacker-chosen bytes.
//
// Rate limiting uses attestLimiter, a per-IP budget of its own — NOT the
// ipRateLimiter shared by activate/recover/renew/status/pause/resume/trial/
// enterprise-trial. This endpoint verifies no credential and mints only a
// fixed-size signature over that bounded nonce, while a normal app launch
// calls it once; leaving it on the 5/hr credential budget meant five ordinary
// launches in an hour left the user's own activation attempts answering 429.
func handleAttest(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		e.Request.Body = http.MaxBytesReader(e.Response, e.Request.Body, webMaxBodyBytes)

		clientIP := e.RealIP()
		var req struct {
			Nonce string `json:"nonce"`
		}
		if err := json.NewDecoder(e.Request.Body).Decode(&req); err != nil {
			// Consume the budget on a malformed body too, so probing with
			// garbage cannot buy unlimited signatures.
			attestLimiter.allow(clientIP)
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "invalid JSON body"})
		}
		if !validOpaqueToken(req.Nonce) {
			attestLimiter.allow(clientIP)
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "nonce must be 16-64 characters of [A-Za-z0-9_-]",
			})
		}
		if !attestLimiter.allow(clientIP) {
			return e.JSON(http.StatusTooManyRequests, map[string]any{
				"error": "rate limit exceeded, try again later",
			})
		}

		signature, err := signDetached([]byte(attestPayload(req.Nonce)))
		if err != nil {
			log.Printf("/license/attest: signing failed: %v", err)
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "could not sign"})
		}
		return e.JSON(http.StatusOK, map[string]any{
			"nonce":     req.Nonce,
			"issuedAt":  time.Now().UTC().Format(time.RFC3339),
			"signature": signature,
		})
	}
}
