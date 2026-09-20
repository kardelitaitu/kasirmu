// Tests for origin attestation (ADR #55).
//
// The security-critical surface is the payload and the signing primitive: a
// client that mis-derives the payload, or a server that signs something other
// than the nonce it was handed, fails open. The handler's remaining work is body
// limiting plus JSON, so these tests aim at the payload and the primitive.

package main

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAttestPayloadIsNamespacedAndCarriesTheNonce(t *testing.T) {
	const nonce = "abcdefghijklmnop"
	got := attestPayload(nonce)
	if got != "ozpos-origin-attest-v1:"+nonce {
		t.Fatalf("payload changed shape: %q", got)
	}
	// A subscription signature must not be replayable as an attestation: the
	// signed bytes must not be the bare nonce.
	if !strings.Contains(got, nonce) || got == nonce {
		t.Fatalf("payload is not namespaced: %q", got)
	}
}

func TestValidOpaqueTokenBounds(t *testing.T) {
	cases := []struct {
		name  string
		nonce string
		ok    bool
	}{
		{"lower bound", "abcdefghijklmnop", true},
		{"upper bound", strings.Repeat("a", 64), true},
		{"hex token", "0123456789abcdef0123456789abcdef", true},
		{"base64url token", "AbC-d_ef0123456789", true},
		{"too short", "abcdefghijklmno", false},
		{"too long", strings.Repeat("a", 65), false},
		{"punctuation", "abcdefghijklmno!", false},
		{"space", "abcdefghijklmn op", false},
		{"non-ascii", "abcdefghijklmné", false},
		{"empty", "", false},
	}
	for _, c := range cases {
		if got := validOpaqueToken(c.nonce); got != c.ok {
			t.Errorf("%s: validOpaqueToken(%q) = %v, want %v", c.name, c.nonce, got, c.ok)
		}
	}
}

// A signature minted over the attestation payload must verify with the public
// half of the server key -- that is the entire point of the endpoint.
func TestSignDetachedRoundTripsOverAttestPayload(t *testing.T) {
	// A throwaway keypair, not a skip: the package var is nil in this binary, and a
	// skipped security test is a test that cannot fail.
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("could not generate a test key: %v", err)
	}
	previous := privateKey
	privateKey = key
	defer func() { privateKey = previous }()

	const nonce = "0123456789abcdef"
	sigB64, err := signDetached([]byte(attestPayload(nonce)))
	if err != nil {
		t.Fatalf("signDetached: %v", err)
	}
	sig, err := base64.StdEncoding.DecodeString(sigB64)
	if err != nil {
		t.Fatalf("signature is not base64: %v", err)
	}
	pub, ok := privateKey.Public().(*rsa.PublicKey)
	if !ok {
		t.Fatal("private key has no RSA public half")
	}
	hash := sha256.Sum256([]byte(attestPayload(nonce)))
	if err := rsa.VerifyPKCS1v15(pub, crypto.SHA256, hash[:], sig); err != nil {
		t.Fatalf("signature did not verify: %v", err)
	}
	// A tampered nonce must not verify, or the endpoint would be signing a
	// payload the client never asked for.
	otherHash := sha256.Sum256([]byte(attestPayload("fedcba9876543210")))
	if err := rsa.VerifyPKCS1v15(pub, crypto.SHA256, otherHash[:], sig); err == nil {
		t.Fatal("signature verified over a nonce that was never sent")
	}
}

// TestAttestHasItsOwnRateLimitBudget proves the boot-time attest probe no
// longer spends the credential lanes' 5/hr per-IP budget: one IP may attest
// repeatedly (a normal app launch attests once) while its 6th /activate is
// still refused. If the two shared a bucket, either the attest calls would
// have been blocked or the activation would have been let through.
func TestAttestHasItsOwnRateLimitBudget(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	// registerTestRoutes does not mirror production's /attest mount (main.go
	// only), so mount it here against the same router handle.
	se.Router.POST("/api/v1/license/attest", handleAttest(app))

	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}

	// PocketBase's RealIP() parses RemoteAddr via net.SplitHostPort, so supply
	// the port:IP form (same pattern as TestActivateHandler_RateLimited).
	testIP := "10.99.99.77"
	testAddr := testIP + ":1234"

	// More attests than a whole credential budget: 5 must not be the ceiling.
	const attests = 8 // > ipRateLimiter.maxPerHr
	for i := 0; i < attests; i++ {
		req := httptest.NewRequest("POST", "/api/v1/license/attest",
			strings.NewReader(`{"nonce":"abcdefghijklmnop"}`))
		req.Header.Set("Content-Type", "application/json")
		req.RemoteAddr = testAddr
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("attest %d/%d: expected 200, got %d: %s", i+1, attests, rec.Code, rec.Body.String())
		}
	}

	// The same IP's credential budget is untouched by those requests.
	seedLicenseKey(t, app, "OZ-ATTEST-SPLIT01", "pro", "unused", "2099-12-31 23:59:59.000Z")
	activate := func() int {
		req := httptest.NewRequest("POST", "/api/v1/license/activate",
			strings.NewReader(`{"key":"OZ-ATTEST-SPLIT01","email":"attestsplit0001@example.com","machine_id":"attestsplitmach01"}`))
		req.Header.Set("Content-Type", "application/json")
		req.RemoteAddr = testAddr
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec.Code
	}
	for i := 0; i < ipRateLimiter.maxPerHr; i++ {
		if code := activate(); code == http.StatusTooManyRequests {
			t.Fatalf("activation %d/%d should have been allowed: attest consumed the credential budget",
				i+1, ipRateLimiter.maxPerHr)
		}
	}
	if code := activate(); code != http.StatusTooManyRequests {
		t.Fatalf("activation %d should be rate limited, got %d", ipRateLimiter.maxPerHr+1, code)
	}
}
