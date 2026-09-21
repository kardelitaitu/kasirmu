package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// ── normalizeBundleID ────────────────────────────────────────────────

func TestNormalizeBundleID_RestaurantStarter(t *testing.T) {
	if got := normalizeBundleID("restaurant_starter"); got != "restaurant_starter" {
		t.Errorf("expected restaurant_starter, got %q", got)
	}
}

func TestNormalizeBundleID_CaseInsensitive(t *testing.T) {
	for _, input := range []string{"Restaurant_Starter", "RESTAURANT_STARTER", "ReStAuRaNt_StArTeR"} {
		if got := normalizeBundleID(input); got != "restaurant_starter" {
			t.Errorf("normalizeBundleID(%q) = %q, want restaurant_starter", input, got)
		}
	}
}

func TestNormalizeBundleID_WhitespaceTrimmed(t *testing.T) {
	if got := normalizeBundleID("  restaurant_starter  "); got != "restaurant_starter" {
		t.Errorf("expected restaurant_starter with whitespace trimmed, got %q", got)
	}
}

func TestNormalizeBundleID_UnknownReturnsEmpty(t *testing.T) {
	for _, input := range []string{"", "unknown", "restaurant", "premium_kds", "  "} {
		if got := normalizeBundleID(input); got != "" {
			t.Errorf("normalizeBundleID(%q) = %q, want empty string", input, got)
		}
	}
}

// ── isBcryptHash ─────────────────────────────────────────────────────

func TestIsBcryptHash_Prefixes(t *testing.T) {
	for _, prefix := range []string{"$2a$", "$2b$", "$2y$"} {
		hash := prefix + "10$salt_and_hash_here_that_is_long_enough_for_bcrypt"
		if !isBcryptHash(hash) {
			t.Errorf("isBcryptHash(%q...) = false, want true", prefix)
		}
	}
}

func TestIsBcryptHash_PlaintextRejected(t *testing.T) {
	for _, input := range []string{
		"",
		"my-api-key",
		"not-a-hash",
		"$2x$invalid", // invalid bcrypt variant
		"plaintext-key",
	} {
		if isBcryptHash(input) {
			t.Errorf("isBcryptHash(%q) = true, want false", input)
		}
	}
}

// isBcryptHash is a prefix check — short strings like "$2a$" pass the
// prefix gate but bcrypt.CompareHashAndPassword would reject them later.
// This is the intended contract: the function tells you the FORMAT,
// not whether the hash is valid.
func TestIsBcryptHash_ShortBcryptStringPassesPrefixCheck(t *testing.T) {
	if !isBcryptHash("$2a$") {
		t.Error("$2a$ should pass the prefix check (validation happens at compare time)")
	}
}

// ── extractAPIKey ────────────────────────────────────────────────────

func TestExtractAPIKey_HappyPath(t *testing.T) {
	key, err := extractAPIKey("Bearer my-api-key-12345")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if key != "my-api-key-12345" {
		t.Errorf("expected my-api-key-12345, got %q", key)
	}
}

func TestExtractAPIKey_MissingPrefix(t *testing.T) {
	_, err := extractAPIKey("Token my-key")
	if err == nil {
		t.Error("expected error for missing Bearer prefix")
	}
}

func TestExtractAPIKey_EmptyKey(t *testing.T) {
	_, err := extractAPIKey("Bearer ")
	if err == nil {
		t.Error("expected error for empty key")
	}
}

func TestExtractAPIKey_WhitespaceTrimmed(t *testing.T) {
	key, err := extractAPIKey("Bearer   my-key  ")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if key != "my-key" {
		t.Errorf("expected my-key, got %q", key)
	}
}

func TestExtractAPIKey_EmptyHeader(t *testing.T) {
	_, err := extractAPIKey("")
	if err == nil {
		t.Error("expected error for empty header")
	}
}

// ── normalizeBillingPeriod ───────────────────────────────────────────

func TestNormalizeBillingPeriod_CanonicalPassThrough(t *testing.T) {
	if got := normalizeBillingPeriod("month"); got != "month" {
		t.Errorf("month -> %q, want month", got)
	}
	if got := normalizeBillingPeriod("year"); got != "year" {
		t.Errorf("year -> %q, want year", got)
	}
}

func TestNormalizeBillingPeriod_AliasMapping(t *testing.T) {
	if got := normalizeBillingPeriod("monthly"); got != "month" {
		t.Errorf("monthly -> %q, want month", got)
	}
	if got := normalizeBillingPeriod("yearly"); got != "year" {
		t.Errorf("yearly -> %q, want year", got)
	}
}

func TestNormalizeBillingPeriod_CaseInsensitive(t *testing.T) {
	if got := normalizeBillingPeriod("MONTHLY"); got != "month" {
		t.Errorf("MONTHLY -> %q, want month", got)
	}
	if got := normalizeBillingPeriod("Yearly"); got != "year" {
		t.Errorf("Yearly -> %q, want year", got)
	}
}

func TestNormalizeBillingPeriod_UnknownPassThrough(t *testing.T) {
	if got := normalizeBillingPeriod("weekly"); got != "weekly" {
		t.Errorf("weekly -> %q, want weekly (passthrough)", got)
	}
	if got := normalizeBillingPeriod(""); got != "" {
		t.Errorf("empty -> %q, want empty", got)
	}
}

func TestNormalizeBillingPeriod_WhitespaceTrimmed(t *testing.T) {
	if got := normalizeBillingPeriod("  monthly  "); got != "month" {
		t.Errorf("'  monthly  ' -> %q, want month", got)
	}
}

// ── redactRequestBody ────────────────────────────────────────────────

func TestRedactRequestBody_MasksAPIKey(t *testing.T) {
	input := []byte(`{"email":"user@test.com","api_key":"sk_live_abc123"}`)
	got := redactRequestBody(input)
	if strings.Contains(got, "sk_live_abc123") {
		t.Errorf("api_key must be redacted, got: %s", got)
	}
	if !strings.Contains(got, "[REDACTED]") {
		t.Errorf("expected [REDACTED] in output, got: %s", got)
	}
	if !strings.Contains(got, "user@test.com") {
		t.Errorf("non-sensitive fields must be preserved, got: %s", got)
	}
}

func TestRedactRequestBody_NoAPIKeyUnchanged(t *testing.T) {
	input := []byte(`{"email":"user@test.com","name":"Test"}`)
	got := redactRequestBody(input)
	if got != string(input) {
		t.Errorf("input without api_key must pass through unchanged, got: %s", got)
	}
}

func TestRedactRequestBody_InvalidJSONPassThrough(t *testing.T) {
	input := []byte(`not json at all`)
	got := redactRequestBody(input)
	if got != string(input) {
		t.Errorf("invalid JSON must pass through unchanged, got: %s", got)
	}
}

// Empty api_key is NOT redacted — an empty string is not a credential.
// This is the documented contract: "Only redact STRING api_key values"
// with the explicit `str != ""` guard.
func TestRedactRequestBody_EmptyAPIKeyPreserved(t *testing.T) {
	input := []byte(`{"api_key":""}`)
	got := redactRequestBody(input)
	if strings.Contains(got, "[REDACTED]") {
		t.Errorf("empty api_key must NOT be redacted, got: %s", got)
	}
}

// ── normalizeClientIP / stripPort (rate-limit keying) ────────────────
//
// The table tests below pin the hop model documented in the package doc:
// the edge appends the client and Caddy appends the edge, so the real client
// is 2 hops from the right of the X-Forwarded-For chain. A forged prepended
// entry must be ignored — only the hop-correct entry is returned.

func TestNormalizeClientIP_TwoHopChain(t *testing.T) {
	// client, edge → hops=2 must return the client (first entry).
	h := http.Header{}
	h.Set("X-Forwarded-For", "203.0.113.7, 10.0.0.2")
	if got := normalizeClientIP(h, "127.0.0.1", 2); got != "203.0.113.7" {
		t.Errorf("2-hop chain returned %q, want 203.0.113.7", got)
	}
}

func TestNormalizeClientIP_SingleEntryChainReturnsThatEntry(t *testing.T) {
	// REGRESSION (the outage): the measured production shape is a
	// SINGLE-ENTRY X-Forwarded-For holding the TRUE CLIENT IP — both proxy
	// hops pass the value through instead of appending a second entry, so
	// len(valid)==1 while hops defaults to 2. The old guard
	// ";hops > len(valid) => return remoteIP;" fired on every request and
	// returned the proxy's peer address, collapsing every client onto one
	// rate-limit bucket. A chain shorter than hops means the edge forwarded
	// the client unappended, so the oldest (here: only) entry IS the client.
	h := http.Header{}
	h.Set("X-Forwarded-For", "203.0.113.10")
	if got := normalizeClientIP(h, "172.30.0.5", 2); got != "203.0.113.10" {
		t.Errorf("single-entry chain must resolve the client; got %q, want 203.0.113.10 (remoteIP is the proxy, not the client)", got)
	}
}

func TestNormalizeClientIP_SingleEntryChainClampsAtEveryHopCount(t *testing.T) {
	// There is NO hop count at which the pass-through shape may collapse
	// onto remoteIP: hops equal to, below, and above the chain length must
	// all resolve the same single entry (index clamped to 0).
	h := http.Header{}
	h.Set("X-Forwarded-For", "203.0.113.10")
	for _, hops := range []int{1, 2, 3, 9} {
		if got := normalizeClientIP(h, "172.30.0.5", hops); got != "203.0.113.10" {
			t.Errorf("hops=%d on a single-entry chain = %q, want 203.0.113.10", hops, got)
		}
	}
}

func TestNormalizeClientIP_DistinctClientsGetDistinctKeys(t *testing.T) {
	// The outage in one assertion: two different single-entry clients must
	// key the limiter into two different buckets. Old code returned the
	// shared remoteIP for both, so client B was rate-limited by client A's
	// traffic (429 on its first request).
	const proxyPeer = "172.30.0.5"
	hA := http.Header{}
	hA.Set("X-Forwarded-For", "203.0.113.10")
	hB := http.Header{}
	hB.Set("X-Forwarded-For", "198.51.100.77")

	hops := 2
	keyA := normalizeClientIP(hA, proxyPeer, hops)
	keyB := normalizeClientIP(hB, proxyPeer, hops)
	if keyA == keyB {
		t.Fatalf("both clients collapsed onto key %q — the one-bucket outage", keyA)
	}
	if keyA != "203.0.113.10" || keyB != "198.51.100.77" {
		t.Errorf("keys = (%q, %q), want (203.0.113.10, 198.51.100.77)", keyA, keyB)
	}
}

func TestNormalizeClientIP_NoUsableEntryReturnsRemoteIP(t *testing.T) {
	// remoteIP is returned ONLY when there is no usable entry at all.
	cases := []struct {
		name   string
		header string
	}{
		{"absent header", ""},
		{"empty header", "   "},
		{"only commas", ",,,"},
		{"only garbage", "not-an-ip, still-not-an-ip"},
	}
	for _, tc := range cases {
		h := http.Header{}
		if tc.header != "" {
			h.Set("X-Forwarded-For", tc.header)
		}
		if got := normalizeClientIP(h, "172.30.0.5", 2); got != "172.30.0.5" {
			t.Errorf("%s: got %q, want remoteIP 172.30.0.5", tc.name, got)
		}
	}
}

func TestNormalizeClientIP_GarbagePrefixedChainClampsToOldestValid(t *testing.T) {
	// Garbage still does not count toward hops; with a short chain the
	// oldest VALID entry is the answer, not remoteIP.
	h := http.Header{}
	h.Set("X-Forwarded-For", "garbage, 203.0.113.10")
	if got := normalizeClientIP(h, "172.30.0.5", 2); got != "203.0.113.10" {
		t.Errorf("garbage-prefixed single-valid chain = %q, want 203.0.113.10", got)
	}
}

func TestNormalizeClientIP_ForgedPrependIgnored(t *testing.T) {
	// An attacker prepends a spoofed client IP. It must be IGNORED — the
	// real client is at hop 2 from the right (the edge appended by Caddy),
	// not the forged left entry.
	h := http.Header{}
	h.Set("X-Forwarded-For", "6.6.6.6, 203.0.113.7, 10.0.0.2")
	if got := normalizeClientIP(h, "127.0.0.1", 2); got != "203.0.113.7" {
		t.Errorf("forged prepend must be ignored; got %q, want 203.0.113.7", got)
	}
}

func TestNormalizeClientIP_GarbageAndEmptyEntriesSkipped(t *testing.T) {
	// Garbage and empty entries do not count toward hops; only valid IPs do.
	h := http.Header{}
	h.Set("X-Forwarded-For", "not-an-ip, 203.0.113.7, , 10.0.0.2, garbage")
	if got := normalizeClientIP(h, "127.0.0.1", 2); got != "203.0.113.7" {
		t.Errorf("garbage/empty skipped; got %q, want 203.0.113.7", got)
	}
}

func TestNormalizeClientIP_ModeOffReturnsRemoteIP(t *testing.T) {
	t.Setenv("LICENSE_CLIENTIP_MODE", "off")
	h := http.Header{}
	h.Set("X-Forwarded-For", "203.0.113.7, 10.0.0.2")
	if got := normalizeClientIP(h, "127.0.0.1", 2); got != "127.0.0.1" {
		t.Errorf("mode off must return remoteIP, got %q", got)
	}
}

func TestNormalizeClientIP_MissingHeaderReturnsRemoteIP(t *testing.T) {
	h := http.Header{}
	if got := normalizeClientIP(h, "127.0.0.1", 2); got != "127.0.0.1" {
		t.Errorf("missing header must return remoteIP, got %q", got)
	}
}

func TestNormalizeClientIP_HopsBeyondChainClampsToOldest(t *testing.T) {
	// hops beyond the chain length no longer returns remoteIP: it clamps to
	// the oldest available entry (see the clamp rationale in helpers.go).
	h := http.Header{}
	h.Set("X-Forwarded-For", "203.0.113.7, 10.0.0.2")
	if got := normalizeClientIP(h, "127.0.0.1", 5); got != "203.0.113.7" {
		t.Errorf("hops beyond chain must clamp to the oldest entry; got %q, want 203.0.113.7", got)
	}
}

func TestNormalizeClientIP_NonPositiveHopsReturnsRemoteIP(t *testing.T) {
	// hops <= 0 stays a hard "give up" — resolveTrustedHops clamps to >= 1,
	// so this only fires on a direct call with a nonsensical hop count.
	h := http.Header{}
	h.Set("X-Forwarded-For", "203.0.113.7, 10.0.0.2")
	for _, hops := range []int{0, -1} {
		if got := normalizeClientIP(h, "127.0.0.1", hops); got != "127.0.0.1" {
			t.Errorf("hops=%d must return remoteIP, got %q", hops, got)
		}
	}
}

func TestNormalizeClientIP_UnrecognizedModeFallsBackToXFF(t *testing.T) {
	// A typo'd mode must NOT silently disable the fix (never fall to "off").
	t.Setenv("LICENSE_CLIENTIP_MODE", "bogus")
	h := http.Header{}
	h.Set("X-Forwarded-For", "203.0.113.7, 10.0.0.2")
	if got := normalizeClientIP(h, "127.0.0.1", 2); got != "203.0.113.7" {
		t.Errorf("unrecognized mode must fall back to xff; got %q, want 203.0.113.7", got)
	}
}

func TestNormalizeClientIP_CFModePrefersConnectingIP(t *testing.T) {
	t.Setenv("LICENSE_CLIENTIP_MODE", "cf")
	h := http.Header{}
	// CF-Connecting-IP is the authoritative single client IP at the edge.
	h.Set("CF-Connecting-IP", "198.51.100.23")
	h.Set("X-Forwarded-For", "203.0.113.7, 10.0.0.2")
	if got := normalizeClientIP(h, "127.0.0.1", 2); got != "198.51.100.23" {
		t.Errorf("cf mode must prefer CF-Connecting-IP; got %q, want 198.51.100.23", got)
	}
}

func TestNormalizeClientIP_CFModeFallsBackToXFF(t *testing.T) {
	t.Setenv("LICENSE_CLIENTIP_MODE", "cf")
	h := http.Header{}
	// Garbage CF-Connecting-IP → fall through to XFF behaviour.
	h.Set("CF-Connecting-IP", "not-an-ip")
	h.Set("X-Forwarded-For", "203.0.113.7, 10.0.0.2")
	if got := normalizeClientIP(h, "127.0.0.1", 2); got != "203.0.113.7" {
		t.Errorf("cf mode with bad CF header must fall back to xff; got %q, want 203.0.113.7", got)
	}
}

func TestStripPort_RemovesPort(t *testing.T) {
	if got := stripPort("127.0.0.1"); got != "127.0.0.1" {
		t.Errorf("stripPort(127.0.0.1) = %q, want 127.0.0.1", got)
	}
}

func TestStripPort_BareHostUnchanged(t *testing.T) {
	if got := stripPort("10.0.0.2"); got != "10.0.0.2" {
		t.Errorf("bare host must be unchanged, got %q", got)
	}
}

func TestResolveTrustedHops_DefaultAndClamp(t *testing.T) {
	os.Unsetenv("LICENSE_TRUSTED_HOPS")
	if got := resolveTrustedHops(); got != 2 {
		t.Errorf("default hops = %d, want 2", got)
	}
	t.Setenv("LICENSE_TRUSTED_HOPS", "0")
	if got := resolveTrustedHops(); got != 1 {
		t.Errorf("hops=0 must clamp to 1, got %d", got)
	}
	t.Setenv("LICENSE_TRUSTED_HOPS", "5")
	if got := resolveTrustedHops(); got != 5 {
		t.Errorf("hops=5 must be 5, got %d", got)
	}
	t.Setenv("LICENSE_TRUSTED_HOPS", "not-a-number")
	if got := resolveTrustedHops(); got != 2 {
		t.Errorf("non-numeric hops must default to 2, got %d", got)
	}
}

// TestClientIPMiddleware_RunsBeforeRouteAndRealIPResolvesClient is the GATE
// for the ordering assumption in main.go: the router-level BindFunc must run
// BEFORE the route handler, collapsing X-Forwarded-For to the single client
// IP so the handler's e.RealIP() returns the client, not the loopback peer.
//
// It reproduces the production request (Caddy → localhost:8080, XFF carrying
// client,edge) and asserts that a route handler registered AFTER the
// middleware sees the collapsed client IP via e.RealIP().
func TestClientIPMiddleware_RunsBeforeRouteAndRealIPResolvesClient(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	// Seed the trusted-proxy setting exactly as main.go does on serve, so
	// RealIP() trusts the collapsed X-Forwarded-For header.
	if err := seedClientIPSettings(app); err != nil {
		t.Fatalf("seedClientIPSettings failed: %v", err)
	}

	hops := resolveTrustedHops()

	// Router-level middleware registered BEFORE the route (mirrors main.go,
	// which binds it at the top of the OnServe block before any POST/GET).
	clientIPObserved := ""
	se.Router.BindFunc(func(e *core.RequestEvent) error {
		remoteIP := stripPort(e.Request.RemoteAddr)
		clientIP := normalizeClientIP(e.Request.Header, remoteIP, hops)
		e.Request.Header.Set("X-Forwarded-For", clientIP)
		return e.Next()
	})
	// Route registered after the middleware.
	se.Router.GET("/__probe_client_ip", func(e *core.RequestEvent) error {
		clientIPObserved = e.RealIP()
		return e.String(http.StatusOK, clientIPObserved)
	})

	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/__probe_client_ip", nil)
	// Caddy (reverse_proxy → localhost:8080) is the peer; the XFF chain
	// carries client,edge exactly as production does.
	req.RemoteAddr = "127.0.0.1"
	req.Header.Set("X-Forwarded-For", "203.0.113.7, 10.0.0.2")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("probe status = %d, body %s", rec.Code, rec.Body.String())
	}
	if clientIPObserved != "203.0.113.7" {
		t.Fatalf("handler saw RealIP()=%q, want 203.0.113.7 (client, not loopback)", clientIPObserved)
	}
	if rec.Body.String() != "203.0.113.7" {
		t.Fatalf("probe body = %q, want 203.0.113.7", rec.Body.String())
	}
}

// TestClientIPMiddleware_NoSettingSeedStaysLoopback proves the flip side:
// if the trusted-proxy setting is NOT seeded, RealIP() still returns the
// loopback peer (the documented pre-fix defect), which is why main.go seeds
// it. This guards against a regression that silently drops the seed.
func TestClientIPMiddleware_NoSettingSeedStaysLoopback(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	// Explicitly ensure the setting is NOT seeded (fresh test app has empty
	// TrustedProxy.Headers), so RealIP() falls back to RemoteIP().
	if len(app.Settings().TrustedProxy.Headers) != 0 {
		t.Skip("test app unexpectedly pre-seeded TrustedProxy.Headers")
	}

	hops := resolveTrustedHops()
	seen := ""
	se.Router.BindFunc(func(e *core.RequestEvent) error {
		remoteIP := stripPort(e.Request.RemoteAddr)
		clientIP := normalizeClientIP(e.Request.Header, remoteIP, hops)
		e.Request.Header.Set("X-Forwarded-For", clientIP)
		return e.Next()
	})
	se.Router.GET("/__probe_no_seed", func(e *core.RequestEvent) error {
		seen = e.RealIP()
		return e.String(http.StatusOK, seen)
	})

	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/__probe_no_seed", nil)
	req.RemoteAddr = "127.0.0.1"
	req.Header.Set("X-Forwarded-For", "203.0.113.7, 10.0.0.2")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	// Without the trusted-proxy seed, RealIP() ignores X-Forwarded-For and
	// falls back to the connection peer (loopback-with-port parses as
	// "invalid IP"). The essential property: the real CLIENT IP is NOT
	// resolved without the seed — which is exactly why main.go seeds it.
	if seen == "203.0.113.7" {
		t.Fatalf("without setting seed RealIP()=%q, must NOT be the client IP (documents the defect)", seen)
	}
}
