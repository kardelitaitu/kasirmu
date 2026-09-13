package main

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// ── Tests: First-boot collection auto-provisioning ───────────────
//
// ensureCollections imports the embedded pb_schema.json on a fresh
// deployment (empty pb_data) so the license API never starts "healthy"
// with /activate, /renew, and /status failing on missing collections.

func TestEnsureCollections_ImportsOnFreshApp(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("failed to create test app: %v", err)
	}
	defer app.Cleanup()

	// Precondition: a fresh PocketBase app has only the default system
	// collections — none of the license business collections.
	for _, name := range requiredCollections {
		if _, err := app.FindCollectionByNameOrId(name); err == nil {
			t.Fatalf("precondition failed: %q should not exist on a fresh app", name)
		}
	}

	if err := ensureCollections(app); err != nil {
		t.Fatalf("ensureCollections should import the schema on first boot: %v", err)
	}

	for _, name := range requiredCollections {
		if _, err := app.FindCollectionByNameOrId(name); err != nil {
			t.Errorf("expected %q collection to be auto-created, got: %v", name, err)
		}
	}

	// Schema parity: the embedded schema must carry the email_verified,
	// password_hash, and password_reset_at fields so fresh boots get them
	// (existing volumes get them from the ensure*Field migrations instead).
	tenants, err := app.FindCollectionByNameOrId("tenants")
	if err != nil {
		t.Fatalf("tenants collection should exist after import: %v", err)
	}
	if tenants.Fields.GetByName("email_verified") == nil {
		t.Error("expected tenants.email_verified to be in the embedded pb_schema.json")
	}
	if tenants.Fields.GetByName("password_hash") == nil {
		t.Error("expected tenants.password_hash to be in the embedded pb_schema.json")
	}
	if tenants.Fields.GetByName("password_reset_at") == nil {
		t.Error("expected tenants.password_reset_at to be in the embedded pb_schema.json")
	}
}

func TestEnsureCollections_IsIdempotent(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("failed to create test app: %v", err)
	}
	defer app.Cleanup()

	// First import creates the collections.
	if err := ensureCollections(app); err != nil {
		t.Fatalf("first ensureCollections failed: %v", err)
	}

	// Second call must be a no-op (no error, no duplicate collections).
	if err := ensureCollections(app); err != nil {
		t.Fatalf("second ensureCollections should be a no-op: %v", err)
	}

	for _, name := range requiredCollections {
		if _, err := app.FindCollectionByNameOrId(name); err != nil {
			t.Errorf("expected %q to still exist after second call: %v", name, err)
		}
	}
}

// ── Tests: Rate Limiting ──────────────────────────────────────────

func TestRateLimiter_AllowsThenBlocks(t *testing.T) {
	rl := &rateLimiter{buckets: make(map[string]*tokenBucket), maxPerHr: 3}
	ip := "192.168.1.1"
	for i := 0; i < 3; i++ {
		if !rl.allow(ip) {
			t.Errorf("request %d should be allowed", i+1)
		}
	}
	if rl.allow(ip) {
		t.Error("4th request should be blocked")
	}
}

func TestRateLimiter_RefillsAfterHour(t *testing.T) {
	rl := &rateLimiter{buckets: make(map[string]*tokenBucket), maxPerHr: 3}
	ip := "192.168.1.2"
	for i := 0; i < 3; i++ {
		rl.allow(ip)
	}
	if rl.allow(ip) {
		t.Error("should be blocked after exhausting tokens")
	}
	rl.mu.Lock()
	rl.buckets[ip].lastFill = time.Now().Add(-2 * time.Hour)
	rl.mu.Unlock()
	if !rl.allow(ip) {
		t.Error("should be allowed after refill period")
	}
}

func TestKeyFailureTracker_BlocksAfterLimit(t *testing.T) {
	kf := &keyFailureTracker{failures: make(map[string]*keyFailures), maxAttempts: 3, cooldown: time.Hour}
	key := "OZ-TEST-BRUTE"
	for i := 0; i < 3; i++ {
		if kf.isBlockedBool(key) {
			t.Errorf("should not be blocked after %d failures", i)
		}
		kf.recordFailure(key)
	}
	if !kf.isBlockedBool(key) {
		t.Error("should be blocked after 3 failures")
	}
}

func TestKeyFailureTracker_CooldownExpires(t *testing.T) {
	kf := &keyFailureTracker{failures: make(map[string]*keyFailures), maxAttempts: 3, cooldown: 1 * time.Millisecond}
	key := "OZ-TEST-COOLDOWN"
	for i := 0; i < 3; i++ {
		kf.recordFailure(key)
	}
	if !kf.isBlockedBool(key) {
		t.Error("should be blocked after 3 failures")
	}
	time.Sleep(10 * time.Millisecond)
	if kf.isBlockedBool(key) {
		t.Error("should not be blocked after cooldown expires")
	}
}

// ── Tests: Expiry ─────────────────────────────────────────────────

func TestCalculateExpiry_Pro(t *testing.T) {
	exp := calculateExpiry("pro")
	diff := exp.Sub(time.Now().UTC().AddDate(1, 0, 0))
	if diff > time.Hour || diff < -time.Hour {
		t.Errorf("pro expiry should be ~1 year, got diff %v", diff)
	}
}

func TestCalculateExpiry_Plus(t *testing.T) {
	exp := calculateExpiry("plus")
	diff := exp.Sub(time.Now().UTC().AddDate(1, 0, 0))
	if diff > time.Hour || diff < -time.Hour {
		t.Errorf("plus expiry should be ~1 year, got diff %v", diff)
	}
}

func TestMaxMachinesForTier_Plus(t *testing.T) {
	if got := maxMachinesForTier("plus"); got != 2 {
		t.Errorf("plus should allow 2 machines, got %d", got)
	}
}

func TestTierQuotas_Plus(t *testing.T) {
	maxStores, maxPOS, allowedTypes := tierQuotas("plus", "")
	if maxStores != 1 {
		t.Errorf("plus max_stores should be 1, got %d", maxStores)
	}
	if maxPOS != 2 {
		t.Errorf("plus max_pos_instances should be 2, got %d", maxPOS)
	}
	for _, want := range []string{"restaurant-pos", "store-pos", "admin", "inventory", "warehouse"} {
		if !slices.Contains(allowedTypes, want) {
			t.Errorf("plus allowed_types should include %q, got %v", want, allowedTypes)
		}
	}
	if slices.Contains(allowedTypes, "kds") {
		t.Errorf("plus must NOT allow kds (Pro+ only), got %v", allowedTypes)
	}
}

func TestCalculateExpiry_Free(t *testing.T) {
	exp := calculateExpiry("free")
	diff := exp.Sub(time.Now().UTC().AddDate(100, 0, 0))
	if diff > time.Hour || diff < -time.Hour {
		t.Errorf("free expiry should be ~100 years, got diff %v", diff)
	}
}

func TestCalculateExpiry_Enterprise(t *testing.T) {
	exp := calculateExpiry("enterprise")
	diff := exp.Sub(time.Now().UTC().AddDate(3, 0, 0))
	if diff > time.Hour || diff < -time.Hour {
		t.Errorf("enterprise expiry should be ~3 years, got diff %v", diff)
	}
}

func TestCalculateGraceUntil(t *testing.T) {
	expiresAt := time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC)
	// The published per-tier table (§B / subscription-tiers.md / pricing row):
	// Free 7, Plus 14, Pro 14, Premium 30, Enterprise 60. Premium and
	// Enterprise were the tiers the old flat-14 window shortchanged.
	cases := []struct {
		tier string
		want time.Time
	}{
		{"free", expiresAt.AddDate(0, 0, 7)},
		{"plus", expiresAt.AddDate(0, 0, 14)},
		{"pro", expiresAt.AddDate(0, 0, 14)},
		{"premium", expiresAt.AddDate(0, 0, 30)},
		{"enterprise", expiresAt.AddDate(0, 0, 60)},
		// Unknown tier keys get the shortest paid window (fail-closed for
		// the tenant's own good — never over-credit).
		{"mystery", expiresAt.AddDate(0, 0, 14)},
	}
	for _, tc := range cases {
		if got := calculateGraceUntil(tc.tier, expiresAt); !got.Equal(tc.want) {
			t.Errorf("calculateGraceUntil(%q) = %v, want %v", tc.tier, got, tc.want)
		}
	}
	if got := offlineGraceDays("mystery"); got != 14 {
		t.Errorf("offlineGraceDays(unknown) = %d, want 14", got)
	}
}

// ── Tests: Signature Round-Trip ───────────────────────────────────

func TestSignAndVerify_RoundTrip(t *testing.T) {
	initPrivateKey(t)

	sub := SubscriptionPayload{
		TenantID: "tenant-roundtrip", TierKey: "pro", Status: "active",
		StartsAt:   time.Now().UTC().Format(time.RFC3339),
		ExpiresAt:  time.Now().UTC().AddDate(1, 0, 0).Format(time.RFC3339),
		GraceUntil: time.Now().UTC().AddDate(1, 0, 14).Format(time.RFC3339),
		IssuedAt:   time.Now().UTC().Format(time.RFC3339),
	}
	payload, sig, err := signSubscription(sub)
	if err != nil {
		t.Fatalf("signing failed: %v", err)
	}
	verifySignature(t, payload, sig)
}

func TestSignAndVerify_TamperedPayload(t *testing.T) {
	initPrivateKey(t)

	sub := SubscriptionPayload{
		TenantID: "tenant-tamper", TierKey: "pro", Status: "active",
		StartsAt:   time.Now().UTC().Format(time.RFC3339),
		ExpiresAt:  time.Now().UTC().AddDate(1, 0, 0).Format(time.RFC3339),
		GraceUntil: time.Now().UTC().AddDate(1, 0, 14).Format(time.RFC3339),
		IssuedAt:   time.Now().UTC().Format(time.RFC3339),
	}
	payload, sig, err := signSubscription(sub)
	if err != nil {
		t.Fatalf("signing failed: %v", err)
	}
	tampered := strings.Replace(payload, `"pro"`, `"enterprise"`, 1)
	if err := verifySignatureHelper(tampered, sig); err == nil {
		t.Error("verification should fail on tampered payload")
	}
}

func verifySignature(t *testing.T, payload, sigBase64 string) {
	t.Helper()
	if err := verifySignatureHelper(payload, sigBase64); err != nil {
		t.Fatalf("signature verification failed: %v", err)
	}
}

func verifySignatureHelper(payload, sigBase64 string) error {
	sig, err := base64.StdEncoding.DecodeString(sigBase64)
	if err != nil {
		return err
	}
	hash := sha256.Sum256([]byte(payload))
	return rsa.VerifyPKCS1v15(&privateKey.PublicKey, crypto.SHA256, hash[:], sig)
}

// ── Tests: API Key Generation ─────────────────────────────────────

func TestGenerateAPIKey_Unique(t *testing.T) {
	keys := make(map[string]bool)
	for i := 0; i < 100; i++ {
		k := generateAPIKey()
		if keys[k] {
			t.Errorf("duplicate API key generated: %s", k)
		}
		keys[k] = true
		if len(k) < 32 {
			t.Errorf("API key too short: %s (%d chars)", k, len(k))
		}
	}
}

// ── Tests: PEM Key Loading ────────────────────────────────────────

func TestLoadRSAKey_PKCS1(t *testing.T) {
	testKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	pkcs1DER := x509.MarshalPKCS1PrivateKey(testKey)
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: pkcs1DER})

	block, _ := pem.Decode(pemBytes)
	if block == nil {
		t.Fatal("should decode PEM block")
	}
	parsed, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		t.Fatalf("should parse PKCS1 key: %v", err)
	}
	if parsed == nil {
		t.Fatal("parsed key should not be nil")
	}
}

func TestLoadRSAKey_PKCS8(t *testing.T) {
	testKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	pkcs8DER, err := x509.MarshalPKCS8PrivateKey(testKey)
	if err != nil {
		t.Fatalf("marshal PKCS8: %v", err)
	}
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pkcs8DER})

	block, _ := pem.Decode(pemBytes)
	if block == nil {
		t.Fatal("should decode PEM block")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		t.Fatalf("should parse PKCS8 key: %v", err)
	}
	rsaKey, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		t.Fatal("parsed key should be RSA")
	}
	if rsaKey == nil {
		t.Fatal("rsa key should not be nil")
	}
}

// initPrivateKey ensures the package-level privateKey is set for unit tests
// that don't call newTestApp (e.g., signing round-trip tests).
func initPrivateKey(t testing.TB) {
	t.Helper()
	if privateKey == nil {
		key, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			t.Fatalf("failed to generate RSA key: %v", err)
		}
		privateKey = key
	}
}

// ── Tests: PEM Normalization ──────────────────────────────────────

func TestNormalizePEM_AlreadyValid(t *testing.T) {
	testKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	pkcs8DER, _ := x509.MarshalPKCS8PrivateKey(testKey)
	original := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pkcs8DER}))

	result := normalizePEM(original)
	// normalizePEM trims whitespace, so the result may differ from original
	// but must still decode as valid PEM.
	block, _ := pem.Decode([]byte(result))
	if block == nil {
		t.Fatal("already-valid PEM should decode successfully after normalization")
	}
	_, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		t.Fatalf("already-valid PEM should parse after normalization: %v", err)
	}
}

func TestNormalizePEM_SingleLine(t *testing.T) {
	testKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	pkcs8DER, _ := x509.MarshalPKCS8PrivateKey(testKey)
	valid := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pkcs8DER}))

	// Strip all newlines to simulate Northflank-style single-line key.
	singleLine := strings.ReplaceAll(valid, "\n", "")

	result := normalizePEM(singleLine)
	if !strings.Contains(result, "-----\n") {
		t.Error("single-line PEM should be re-wrapped with line breaks")
	}

	// The result must be decodable.
	block, _ := pem.Decode([]byte(result))
	if block == nil {
		t.Fatal("normalized single-line PEM should decode successfully")
	}
	_, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		t.Fatalf("normalized PEM should parse as PKCS8: %v", err)
	}
}

func TestNormalizePEM_LiteralBackslashN(t *testing.T) {
	testKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	pkcs8DER, _ := x509.MarshalPKCS8PrivateKey(testKey)
	valid := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pkcs8DER}))

	// Replace real newlines with literal \n (double-escaped in JSON/YAML env vars).
	literal := strings.ReplaceAll(valid, "\n", "\\n")

	result := normalizePEM(literal)
	if strings.Contains(result, "\\n") {
		t.Error("literal \\n should be converted to real newlines")
	}
	block, _ := pem.Decode([]byte(result))
	if block == nil {
		t.Fatal("PEM with literal \\n should decode after normalization")
	}
}

func TestNormalizePEM_SurroundingQuotes(t *testing.T) {
	testKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	pkcs8DER, _ := x509.MarshalPKCS8PrivateKey(testKey)
	valid := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pkcs8DER}))

	quoted := "\"  " + valid + "  \""
	result := normalizePEM(quoted)
	if strings.HasPrefix(result, "\"") {
		t.Error("surrounding quotes should be stripped")
	}
	block, _ := pem.Decode([]byte(result))
	if block == nil {
		t.Fatal("quoted PEM should decode after normalization")
	}
}

func TestNormalizePEM_SurroundingWhitespace(t *testing.T) {
	testKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	pkcs8DER, _ := x509.MarshalPKCS8PrivateKey(testKey)
	valid := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pkcs8DER}))

	spaced := "  \n  " + valid + "  \n  "
	result := normalizePEM(spaced)
	block, _ := pem.Decode([]byte(result))
	if block == nil {
		t.Fatal("whitespace-padded PEM should decode after normalization")
	}
}

// ── Tests: wrapPEM (raw base64) ───────────────────────────────────

func TestWrapPEM_RawBase64(t *testing.T) {
	testKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	pkcs8DER, _ := x509.MarshalPKCS8PrivateKey(testKey)
	valid := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pkcs8DER}))

	// Extract just the base64 body (strip PEM headers).
	lines := strings.Split(strings.TrimSpace(valid), "\n")
	var rawBase64 strings.Builder
	for _, line := range lines {
		if strings.HasPrefix(line, "-----") {
			continue
		}
		rawBase64.WriteString(line)
	}

	result := normalizePEM(rawBase64.String())
	if !strings.HasPrefix(result, "-----BEGIN PRIVATE KEY-----") {
		t.Error("raw base64 should be wrapped in PKCS#8 PEM envelope")
	}
	block, _ := pem.Decode([]byte(result))
	if block == nil {
		t.Fatal("wrapped base64 should produce valid PEM")
	}
}

func TestWrapPEM_StripWhitespace(t *testing.T) {
	testKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	pkcs8DER, _ := x509.MarshalPKCS8PrivateKey(testKey)
	valid := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pkcs8DER}))

	// Extract base64 with embedded newlines (64-char wrapped, no headers).
	lines := strings.Split(strings.TrimSpace(valid), "\n")
	var rawWithNewlines strings.Builder
	for _, line := range lines {
		if strings.HasPrefix(line, "-----") {
			continue
		}
		rawWithNewlines.WriteString(line)
		rawWithNewlines.WriteString("\n")
	}

	result := normalizePEM(rawWithNewlines.String())
	// Result should have exactly 64-char lines (not doubled newlines).
	block, _ := pem.Decode([]byte(result))
	if block == nil {
		t.Fatal("base64 with embedded newlines should produce valid PEM")
	}
}

func TestWrapPEM_RSAKeyType(t *testing.T) {
	testKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	pkcs1DER := x509.MarshalPKCS1PrivateKey(testKey)
	valid := string(pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: pkcs1DER}))

	// Extract base64 from PKCS1 PEM, wrap in PKCS8 envelope.
	lines := strings.Split(strings.TrimSpace(valid), "\n")
	var rawBase64 strings.Builder
	for _, line := range lines {
		if strings.HasPrefix(line, "-----") {
			continue
		}
		rawBase64.WriteString(line)
	}

	// normalizePEM wraps raw base64 in PKCS8 format by default.
	result := normalizePEM(rawBase64.String())
	block, _ := pem.Decode([]byte(result))
	if block == nil {
		t.Fatal("wrapped raw base64 should produce valid PEM")
	}
	// The DER bytes are PKCS1, so ParsePKCS1PrivateKey should succeed
	// regardless of the PEM "PRIVATE KEY" type label.
	parsed, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		t.Fatalf("PKCS1 DER should parse with ParsePKCS1PrivateKey: %v", err)
	}
	if parsed == nil {
		t.Fatal("parsed key should not be nil")
	}
}

// ── Tests: Helpers ────────────────────────────────────────────────

func TestStrDefault_NonEmpty(t *testing.T) {
	if strDefault("hello", "world") != "hello" {
		t.Error("strDefault should return s when non-empty")
	}
}

func TestStrDefault_Empty(t *testing.T) {
	if strDefault("", "default") != "default" {
		t.Error("strDefault should return d when s is empty")
	}
}

func TestStrDefault_BothEmpty(t *testing.T) {
	if strDefault("", "") != "" {
		t.Error("strDefault should return empty string when both are empty")
	}
}

func TestGenerateAPIKey_HasPrefix(t *testing.T) {
	k := generateAPIKey()
	if !strings.HasPrefix(k, "oz_") {
		t.Errorf("API key should have 'oz_' prefix, got: %s", k)
	}
}

// ── Tests: Rate Limiter Edge Cases ────────────────────────────────

func TestRateLimiter_IsolatedByIP(t *testing.T) {
	rl := &rateLimiter{buckets: make(map[string]*tokenBucket), maxPerHr: 3}
	ip1 := "192.168.1.1"
	ip2 := "192.168.1.2"

	// Exhaust ip1.
	for i := 0; i < 3; i++ {
		rl.allow(ip1)
	}
	if rl.allow(ip1) {
		t.Error("ip1 should be blocked after exhausting tokens")
	}
	// ip2 should still have full quota.
	for i := 0; i < 3; i++ {
		if !rl.allow(ip2) {
			t.Errorf("ip2 request %d should be allowed (not affected by ip1)", i+1)
		}
	}
}

func TestRateLimiter_DefaultMaxPerHr(t *testing.T) {
	if ipRateLimiter.maxPerHr != 5 {
		t.Errorf("global ipRateLimiter should default to 5 per hour, got %d", ipRateLimiter.maxPerHr)
	}
}

func TestRateLimiter_SweepRemovesExpiredBuckets(t *testing.T) {
	rl := &rateLimiter{buckets: make(map[string]*tokenBucket), maxPerHr: 3}

	// Insert old buckets.
	rl.mu.Lock()
	rl.buckets["10.0.0.1"] = &tokenBucket{tokens: 1, lastFill: time.Now().Add(-3 * time.Hour)}
	rl.buckets["10.0.0.2"] = &tokenBucket{tokens: 2, lastFill: time.Now()} // fresh
	rl.mu.Unlock()

	// Sweep should remove only the expired bucket.
	rl.sweep()

	rl.mu.Lock()
	defer rl.mu.Unlock()
	if _, ok := rl.buckets["10.0.0.1"]; ok {
		t.Error("expired bucket 10.0.0.1 should have been swept")
	}
	if _, ok := rl.buckets["10.0.0.2"]; !ok {
		t.Error("fresh bucket 10.0.0.2 should NOT be swept")
	}
}

func TestRateLimiter_SweepEmpty(t *testing.T) {
	rl := &rateLimiter{buckets: make(map[string]*tokenBucket), maxPerHr: 3}
	rl.sweep() // should not panic on empty map
	if len(rl.buckets) != 0 {
		t.Error("sweeping empty map should leave it empty")
	}
}

func TestKeyFailureTracker_SweepRemovesExpiredEntries(t *testing.T) {
	kf := &keyFailureTracker{failures: make(map[string]*keyFailures), maxAttempts: 3, cooldown: time.Hour}

	// Insert a partial failure that's very old.
	kf.mu.Lock()
	kf.failures["old-partial"] = &keyFailures{count: 1, lastAttempt: time.Now().Add(-48 * time.Hour)}
	// Insert a cooldown entry that's past its cooldown.
	kf.failures["cooled-down"] = &keyFailures{
		count: 5, cooldownAt: time.Now().Add(-1 * time.Hour), lastAttempt: time.Now(),
	}
	// Insert a fresh blocked entry (still in cooldown).
	kf.failures["fresh-blocked"] = &keyFailures{
		count: 5, cooldownAt: time.Now().Add(1 * time.Hour), lastAttempt: time.Now(),
	}
	kf.mu.Unlock()

	kf.sweep()

	kf.mu.Lock()
	defer kf.mu.Unlock()
	if _, ok := kf.failures["old-partial"]; ok {
		t.Error("old partial failure should have been swept")
	}
	if _, ok := kf.failures["cooled-down"]; ok {
		t.Error("cooled-down entry should have been swept")
	}
	if _, ok := kf.failures["fresh-blocked"]; !ok {
		t.Error("fresh blocked entry should NOT be swept")
	}
}

func TestKeyFailureTracker_SweepEmpty(t *testing.T) {
	kf := &keyFailureTracker{failures: make(map[string]*keyFailures), maxAttempts: 3, cooldown: time.Hour}
	kf.sweep() // should not panic on empty map
	if len(kf.failures) != 0 {
		t.Error("sweeping empty map should leave it empty")
	}
}

// ── Tests: Key Activation Locks ───────────────────────────────────
//
// These tests target the sharded-mutex implementation (Memory-Leak Audit
// fix): `&keyActivationLocks{}` is the zero-value struct (256 sync.Mutex
// shards). The prior unbounded `map[string]*sync.Mutex` field has been
// replaced and these tests no longer initialise it.

func TestActivationLocks_SerialisesSameKey(t *testing.T) {
	kal := &keyActivationLocks{}
	key := "OZ-CONCURRENT"

	unlock1 := kal.lock(key)

	// Try to lock the same key from a goroutine — must block.
	done := make(chan bool, 1)
	go func() {
		unlock2 := kal.lock(key)
		unlock2()
		done <- true
	}()

	// 100ms mirrors TestActivationLocks_ConcurrentSameKeyBlocks grace in handler_test.go — absorbs CI scheduler latency spikes.
	time.Sleep(100 * time.Millisecond)
	select {
	case <-done:
		t.Error("second lock should block until first is released")
	default:
	}

	unlock1()

	// Now the second lock should succeed.
	select {
	case <-done:
		// expected
	case <-time.After(200 * time.Millisecond):
		t.Error("second lock should succeed after first is released")
	}
}

// TestActivationLocks_NoGlobalMutexRegression verifies that locking
// two DIFFERENT keys does not deadlock AND completes promptly (no
// global-mutex regression). Under the sharded-mutex design distinct
// keys can occasionally hash to the same shard (~0.4% per pair across
// 256 buckets) and serialize — but the implementation MUST NOT deadlock
// or hold a global lock. We loop over 100 pairs and assert the wall
// clock stays under a generous bound (5s) — a regression to a single
// global mutex would serialise all 200 lock/unlock pairs and blow past
// this budget on any reasonably-loaded CI runner.
func TestActivationLocks_NoGlobalMutexRegression(t *testing.T) {
	kal := &keyActivationLocks{}
	const pairCount = 100
	const maxWallClock = 5 * time.Second
	start := time.Now()
	for i := 0; i < pairCount; i++ {
		keyA := fmt.Sprintf("KEY-A-%04d", i)
		keyB := fmt.Sprintf("KEY-B-%04d", i)
		unlock1 := kal.lock(keyA)
		unlock2 := kal.lock(keyB)
		unlock1()
		unlock2()
	}
	elapsed := time.Since(start)
	if elapsed > maxWallClock {
		t.Errorf("100 distinct-key lock pairs took %v; expected <%v (regression to global-mutex or serialised hot spot?)",
			elapsed, maxWallClock)
	}
}

// ── Tests: Key Failure Tracker Edge Cases ─────────────────────────

func TestKeyFailureTracker_IsolatedByKey(t *testing.T) {
	kf := &keyFailureTracker{failures: make(map[string]*keyFailures), maxAttempts: 3, cooldown: time.Hour}
	key1 := "OZ-KEY-1"
	key2 := "OZ-KEY-2"

	// Exhaust key1.
	for i := 0; i < 3; i++ {
		kf.recordFailure(key1)
	}
	if !kf.isBlockedBool(key1) {
		t.Error("key1 should be blocked after 3 failures")
	}
	// key2 should not be affected.
	if kf.isBlockedBool(key2) {
		t.Error("key2 should not be blocked (isolated from key1)")
	}
}

func TestKeyFailureTracker_PartialFailures(t *testing.T) {
	kf := &keyFailureTracker{failures: make(map[string]*keyFailures), maxAttempts: 3, cooldown: time.Hour}
	key := "OZ-PARTIAL"

	// 2 failures should not block.
	kf.recordFailure(key)
	kf.recordFailure(key)
	if kf.isBlockedBool(key) {
		t.Error("should not be blocked after only 2 failures")
	}
	// 3rd failure should block.
	kf.recordFailure(key)
	if !kf.isBlockedBool(key) {
		t.Error("should be blocked after 3rd failure")
	}
}

func TestKeyFailureTracker_PartialDecayAfterTTL(t *testing.T) {
	kf := &keyFailureTracker{failures: make(map[string]*keyFailures), maxAttempts: 3, cooldown: time.Hour}
	key := "OZ-DECAY"

	// Record 2 failures.
	kf.recordFailure(key)
	kf.recordFailure(key)
	if kf.isBlockedBool(key) {
		t.Error("should not be blocked after 2 failures")
	}

	// Manually age the lastAttempt past the decay TTL.
	kf.mu.Lock()
	kf.failures[key].lastAttempt = time.Now().Add(-2 * time.Hour)
	kf.mu.Unlock()

	// After TTL expires, the counter should reset, and the key should NOT be blocked.
	if kf.isBlockedBool(key) {
		t.Error("should not be blocked after partial failures decay")
	}

	// The entry should still exist but with count reset to 0.
	kf.mu.Lock()
	f, ok := kf.failures[key]
	kf.mu.Unlock()
	if !ok {
		t.Error("entry should still exist after decay (counter reset, not deleted)")
	}
	if f.count != 0 {
		t.Errorf("counter should be reset to 0 after decay, got %d", f.count)
	}

	// Fresh failures should count from 0 (not from 2).
	kf.recordFailure(key)
	kf.recordFailure(key)
	if kf.isBlockedBool(key) {
		t.Error("should not be blocked after 2 fresh failures post-decay")
	}
	kf.recordFailure(key)
	if !kf.isBlockedBool(key) {
		t.Error("should be blocked after 3 fresh failures post-decay")
	}
}

func TestKeyFailureTracker_CleanupAfterCooldown(t *testing.T) {
	kf := &keyFailureTracker{failures: make(map[string]*keyFailures), maxAttempts: 3, cooldown: 100 * time.Millisecond}
	key := "OZ-CLEANUP"

	for i := 0; i < 3; i++ {
		kf.recordFailure(key)
	}
	if !kf.isBlockedBool(key) {
		t.Error("should be blocked after 3 failures")
	}

	time.Sleep(150 * time.Millisecond)

	// After cooldown, the entry should be cleaned up on next check.
	if kf.isBlockedBool(key) {
		t.Error("should not be blocked after cooldown expires")
	}
	// New failures should start fresh.
	kf.recordFailure(key)
	if kf.isBlockedBool(key) {
		t.Error("should not be blocked after single fresh failure")
	}
}

// ── Tests: Expiry Edge Cases ──────────────────────────────────────

func TestCalculateExpiry_Premium(t *testing.T) {
	exp := calculateExpiry("premium")
	diff := exp.Sub(time.Now().UTC().AddDate(1, 0, 0))
	if diff > time.Hour || diff < -time.Hour {
		t.Errorf("premium expiry should be ~1 year, got diff %v", diff)
	}
}

func TestCalculateExpiry_Unknown(t *testing.T) {
	exp := calculateExpiry("unknown-tier")
	diff := exp.Sub(time.Now().UTC().AddDate(1, 0, 0))
	if diff > time.Hour || diff < -time.Hour {
		t.Errorf("unknown tier should default to ~1 year, got diff %v", diff)
	}
}

func TestCalculateExpiry_SameLength(t *testing.T) {
	pro := calculateExpiry("pro")
	premium := calculateExpiry("premium")
	diff := pro.Sub(premium)
	if diff > time.Hour || diff < -time.Hour {
		t.Errorf("pro and premium should have same expiry, got diff %v", diff)
	}
}

// ── Tests: safePrefix ─────────────────────────────────────────────

func TestSafePrefix_Short(t *testing.T) {
	result := safePrefix("hello", 10)
	if result != "hello" {
		t.Errorf("short string should be returned as-is, got %q", result)
	}
}

func TestSafePrefix_Truncated(t *testing.T) {
	result := safePrefix("hello world this is long", 10)
	if len(result) > 10 {
		t.Errorf("truncated string should be at most 10 chars, got %d", len(result))
	}
}

func TestSafePrefix_WithNewlines(t *testing.T) {
	result := safePrefix("line1\nline2\nline3", 20)
	if strings.Contains(result, "\n") {
		t.Error("newlines should be escaped to \\n")
	}
	if !strings.Contains(result, "\\n") {
		t.Error("newlines should be replaced with literal \\n")
	}
}

func TestSafePrefix_Zero(t *testing.T) {
	result := safePrefix("test", 0)
	if result != "" {
		t.Errorf("zero-length prefix should be empty, got %q", result)
	}
}

func TestSafePrefix_Empty(t *testing.T) {
	result := safePrefix("", 10)
	if result != "" {
		t.Errorf("empty input should return empty, got %q", result)
	}
}

// ── Tests: normalizePEM Edge Cases ────────────────────────────────

func TestNormalizePEM_EmptyInput(t *testing.T) {
	result := normalizePEM("")
	// Empty input after trimming still contains no PEM markers,
	// so it hits the raw-base64 wrapping path (wrapping empty base64 is harmless).
	if !strings.HasPrefix(result, "-----BEGIN") {
		t.Errorf("empty input should be wrapped as PEM, got %q", result)
	}
}

func TestNormalizePEM_NoMarkersAtAll(t *testing.T) {
	result := normalizePEM("just some random text")
	// Should return the text unchanged since it's not valid PEM and not base64-ish.
	// It will hit the "raw base64" path and wrap it.
	if !strings.HasPrefix(result, "-----BEGIN PRIVATE KEY-----") {
		t.Error("unrecognized input should be wrapped as raw base64")
	}
}

func TestNormalizePEM_OnlyBeginMarker(t *testing.T) {
	result := normalizePEM("-----BEGIN PRIVATE KEY-----somebase64")
	// Missing END marker — should return as-is (can't parse).
	if !strings.Contains(result, "-----BEGIN PRIVATE KEY-----") {
		t.Error("partial PEM with only BEGIN should be preserved")
	}
}

func TestNormalizePEM_OnlyEndMarker(t *testing.T) {
	result := normalizePEM("somebase64-----END PRIVATE KEY-----")
	// END marker is present but BEGIN is not, so the function can't
	// determine the envelope type and returns the input unchanged.
	if strings.HasPrefix(result, "-----BEGIN") {
		t.Error("input with only END marker should NOT be wrapped (ambiguous)")
	}
	if !strings.Contains(result, "-----END PRIVATE KEY-----") {
		t.Error("input with only END marker should be preserved")
	}
}

func TestNormalizePEM_CRLFLineEndings(t *testing.T) {
	testKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	pkcs8DER, _ := x509.MarshalPKCS8PrivateKey(testKey)
	valid := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pkcs8DER}))

	crlf := strings.ReplaceAll(valid, "\n", "\r\n")
	result := normalizePEM(crlf)

	// normalizePEM checks for "-----\r\n" and returns as-is if found.
	block, _ := pem.Decode([]byte(result))
	if block == nil {
		t.Fatal("CRLF PEM should decode after normalization")
	}
}

func TestNormalizePEM_SingleQuotes(t *testing.T) {
	testKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	pkcs8DER, _ := x509.MarshalPKCS8PrivateKey(testKey)
	valid := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pkcs8DER}))

	quoted := "'  " + valid + "  '"
	result := normalizePEM(quoted)
	block, _ := pem.Decode([]byte(result))
	if block == nil {
		t.Fatal("single-quoted PEM should decode after normalization")
	}
}

// ── Tests: generateAPIKey Edge Cases ──────────────────────────────

func TestGenerateAPIKey_Format(t *testing.T) {
	k := generateAPIKey()
	// Should be "oz_" prefix + 64 hex chars (32 bytes).
	if len(k) != 67 {
		t.Errorf("API key should be 67 chars (oz_ + 64 hex), got %d: %s", len(k), k)
	}
	if !strings.HasPrefix(k, "oz_") {
		t.Errorf("API key should have oz_ prefix, got: %s", k)
	}
	// The hex part should only contain hex characters.
	hexPart := strings.TrimPrefix(k, "oz_")
	for _, c := range hexPart {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			t.Errorf("API key hex part should be lowercase hex, got char %c in %s", c, k)
		}
	}
}

func TestGenerateAPIKey_ManyUniqueness(t *testing.T) {
	keys := make(map[string]bool)
	for i := 0; i < 1000; i++ {
		k := generateAPIKey()
		if keys[k] {
			t.Fatalf("duplicate API key generated after %d iterations: %s", i, k)
		}
		keys[k] = true
	}
}

// ── Tests: signSubscription Edge Cases ────────────────────────────

func TestSignSubscription_EmptyTier(t *testing.T) {
	initPrivateKey(t)

	sub := SubscriptionPayload{
		TenantID: "tenant-empty-tier", TierKey: "", Status: "active",
	}
	payload, sig, err := signSubscription(sub)
	if err != nil {
		t.Fatalf("signing with empty tier should succeed: %v", err)
	}
	verifySignature(t, payload, sig)
}

func TestSignSubscription_MinimalFields(t *testing.T) {
	initPrivateKey(t)

	sub := SubscriptionPayload{
		TenantID: "tenant-minimal", TierKey: "free", Status: "active",
	}
	payload, sig, err := signSubscription(sub)
	if err != nil {
		t.Fatalf("signing with minimal fields should succeed: %v", err)
	}
	verifySignature(t, payload, sig)
}

func TestSignSubscription_DifferentTiersProduceDifferentSignatures(t *testing.T) {
	initPrivateKey(t)

	sub1 := SubscriptionPayload{TenantID: "t1", TierKey: "pro", Status: "active"}
	sub2 := SubscriptionPayload{TenantID: "t1", TierKey: "enterprise", Status: "active"}

	p1, s1, _ := signSubscription(sub1)
	p2, s2, _ := signSubscription(sub2)

	if s1 == s2 {
		t.Error("different tiers should produce different signatures")
	}
	if p1 == p2 {
		t.Error("different tiers should produce different payloads")
	}
}

// ── Tests: normalizePEM (remaining branches) ─────────────────────

func TestNormalizePEM_EndMarkerBeforeHeader(t *testing.T) {
	// END marker appears before the header closes — edge case that returns raw.
	result := normalizePEM("-----END PRIVATE KEY----------BEGIN PRIVATE KEY-----base64")
	// "-----END" appears at start, "-----BEGIN" at position 31. The search for
	// "-----BEGIN " would find the BEGIN marker, but endMarker would be 0
	// which is < headerClose, so it returns raw.
	if !strings.Contains(result, "-----END") {
		t.Error("malformed PEM with END before BEGIN should be preserved")
	}
}

func TestNormalizePEM_EndMarkerWithoutClosingDashes(t *testing.T) {
	// "-----END PRIVATE KEY" without the final "-----".
	result := normalizePEM("-----BEGIN PRIVATE KEY-----base64data-----END PRIVATE KEY")
	// footerClose will be -1 (no closing -----), returns raw.
	if !strings.Contains(result, "-----END PRIVATE KEY") {
		t.Error("PEM with incomplete END marker should be preserved")
	}
}

func TestNormalizePEM_BeginMarkerWithoutClosingDashes(t *testing.T) {
	// BEGIN marker present but the type section never closes with "-----"
	// anywhere in the string (no "-----" appears at all after the type name).
	result := normalizePEM("-----BEGIN PRIVATE KEY")
	// headerClose is -1 (no "-----" found in afterType), returns raw.
	if !strings.Contains(result, "-----BEGIN PRIVATE KEY") {
		t.Error("PEM with incomplete BEGIN header should be preserved")
	}
}

// ── Tests: jsonMarshal ────────────────────────────────────────────

func TestJsonMarshal_Simple(t *testing.T) {
	data, err := jsonMarshal(map[string]string{"key": "value"})
	if err != nil {
		t.Fatalf("jsonMarshal should not error: %v", err)
	}
	if string(data) != `{"key":"value"}` {
		t.Errorf("unexpected json output: %s", string(data))
	}
}

func TestJsonMarshal_Error(t *testing.T) {
	_, err := jsonMarshal(make(chan int)) // channels can't be marshaled
	if err == nil {
		t.Error("jsonMarshal should error on unmarshalable type")
	}
}

// TestEnsureEmailVerifiedField_MigratesExistingCollection simulates a
// deployment that predates the field: the tenants collection exists
// WITHOUT email_verified, and the migration must add it (idempotently)
// without touching other fields.
func TestEnsureEmailVerifiedField_MigratesExistingCollection(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("failed to create test app: %v", err)
	}
	defer app.Cleanup()

	tenants := core.NewBaseCollection("tenants")
	tenants.Fields.Add(
		&core.EmailField{Name: "email", Required: true},
		&core.SelectField{Name: "status", Required: true, Values: []string{"active", "suspended", "revoked"}},
	)
	if err := app.Save(tenants); err != nil {
		t.Fatalf("failed to create tenants collection: %v", err)
	}
	if tenants.Fields.GetByName("email_verified") != nil {
		t.Fatal("precondition failed: tenants should not have email_verified yet")
	}

	if err := ensureEmailVerifiedField(app); err != nil {
		t.Fatalf("ensureEmailVerifiedField failed: %v", err)
	}
	after, err := app.FindCollectionByNameOrId("tenants")
	if err != nil {
		t.Fatalf("find tenants after migration: %v", err)
	}
	field := after.Fields.GetByName("email_verified")
	if field == nil {
		t.Fatal("expected email_verified field to be added by the migration")
	}
	if field.Type() != core.FieldTypeBool {
		t.Errorf("expected a bool field, got %q", field.Type())
	}

	// Idempotent: a second run must be a no-op.
	if err := ensureEmailVerifiedField(app); err != nil {
		t.Fatalf("second ensureEmailVerifiedField should be a no-op: %v", err)
	}
}
