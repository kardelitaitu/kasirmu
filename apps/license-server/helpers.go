// Package main houses the license-server helpers shared across handlers:
// credential extraction, request parsing, billing-period normalization, body
// redaction, and — added for the rate-limit keying fix — client-IP
// normalization.
//
// # Client-IP hop model (rate-limit keying)
//
// Every rate-limit lane keys on e.RealIP(). That call only trusts the
// X-Forwarded-For chain once Settings.TrustedProxy.Headers is seeded, and
// before this fix nothing seeded it, so the Caddy reverse_proxy peer
// (localhost:8080) collapsed every client to the loopback address.
//
// The production proxy stack appends exactly two entries to X-Forwarded-For
// on the path to the license server:
//
//   - the edge (istio on license.kasir.mu, or Cloudflare on
//     license.ozpos.my.id) appends the *client*,
//   - Caddy (reverse_proxy → localhost:8080) appends the *edge*.
//
// So the real client sits 2 hops from the right end of the chain. The edge
// (Cloudflare) case is special: it exposes the client directly via the
// single-valued CF-Connecting-IP header, which the "cf" mode prefers.
//
// normalizeClientIP resolves the hop-correct entry and the router middleware
// in main.go collapses the whole chain to that one value, so RealIP() — and
// therefore every limiter — keys on the real client, never 127.0.0.1.
package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"net/netip"
	"os"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// bearerPrefix is the RFC 6750 scheme required on the Authorization header.
// The scheme itself ("Bearer") is case-sensitive per RFC 7235 §2.1; the
// header NAME is case-insensitive and normalized by Go's http.Header.Get.
// Declared once here so activate/renew/status all share the same prefix
// check (avoids drift if a future handler forgets to use "Bearer ").
const bearerPrefix = "Bearer "

// jsonMarshal is a thin wrapper around json.Marshal for readability.
func jsonMarshal(v any) ([]byte, error) {
	return json.Marshal(v)
}

// generateAPIKey returns a 32-byte hex-encoded random string used as the
// tenant's API key for renew and status endpoints.
func generateAPIKey() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		// CSPRNG failure means the OS entropy source is broken.
		// A predictable fallback is worse than crashing — the system
		// is in an unsafe state and should not generate API keys.
		log.Fatalf("crypto/rand.Read failed: %v — cannot generate secure API key", err)
	}
	return "oz_" + hex.EncodeToString(b)
}

// strDefault returns s if non-empty, otherwise returns d.
func strDefault(s, d string) string {
	if s != "" {
		return s
	}
	return d
}

// extractAPIKey resolves the api_key from the Authorization: Bearer
// header (preferred) or the legacy JSON body field (backward-compat
// for C1-pre-audit wire format). Returns:
//
//   - apiKey: the resolved api_key, or "" if neither source provided one
//   - err: non-nil iff the header is missing, malformed, or empty.
//
// The legacy body `api_key` field is deliberately NOT accepted here (the
// C1-followup hardening removed the backward-compat fallback): a body
// credential leaks into CDN / webserver access logs that capture request
// bodies, and a POS client must not have two credential channels to
// disagree about. The Bearer header is the sole authenticator.
//
// The Bearer path trims surrounding whitespace so trailing spaces after
// the token (a common copy-paste quirk) don't silently invalidate auth.
func extractAPIKey(authHeader string) (apiKey string, err error) {
	if !strings.HasPrefix(authHeader, bearerPrefix) {
		return "", errors.New("missing or malformed Authorization header (expected: Bearer <api_key>)")
	}
	key := strings.TrimSpace(strings.TrimPrefix(authHeader, bearerPrefix))
	if key == "" {
		return "", errors.New("empty api_key in Authorization: Bearer header")
	}
	return key, nil
}

// normalizeBillingPeriod canonicalizes the period vocabulary to the
// canonical plan-period format (month/year): the website's checkout sends
// monthly/yearly (from BillingPeriod), while the price map uses month/year.
// This function is shared by midtransAmountForTier (checkout → price map)
// and the webhook's custom_field3 cross-check (notification → price map)
// so both code paths agree on the vocabulary mapping.
//
// The normalization is case-insensitive and trims whitespace. Values that
// don't match any known vocabulary ("month", "year", "monthly", "yearly")
// pass through unchanged so the caller's comparison decides (and a garbage
// value mismatches the map).
func normalizeBillingPeriod(p string) string {
	switch strings.ToLower(strings.TrimSpace(p)) {
	case "monthly":
		return "month"
	case "yearly":
		return "year"
	default:
		return strings.ToLower(strings.TrimSpace(p))
	}
}

// redactRequestBody returns a JSON-string copy of body with the "api_key"
// field masked as "[REDACTED]". Used by handlers that want to log the
// request payload for debugging without leaking the credential into log
// files (which are typically retained longer and shared more broadly than
// request bodies, and may be scraped by log-aggregation tools).
//
// If body is not valid JSON, or has no api_key field, the original bytes
// are returned unchanged. We deliberately fall back to the raw bytes
// rather than an error string so a malformed-body log line is still
// useful for debugging the parse failure itself.
func redactRequestBody(body []byte) string {
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return string(body)
	}
	// Only redact STRING api_key values. The wire format is always a
	// string, but if a malformed request sent null/numeric/object, the
	// unmarshal target would be a non-string Go type — trying to assign
	// "[REDACTED]" to it would silently coerce at json.Marshal (or, for
	// json.RawMessage, write the literal "[REDACTED]" inside a quoted
	// string anyway, but the type assertion is the clearer contract).
	// The type assertion confines the redaction to the case we know how
	// to handle safely; non-string api_key is preserved as-is so a
	// malformed-body log line still shows the original payload.
	if val, ok := payload["api_key"]; ok {
		if str, ok := val.(string); ok && str != "" {
			payload["api_key"] = "[REDACTED]"
		}
	}
	redacted, err := json.Marshal(payload)
	if err != nil {
		return string(body)
	}
	return string(redacted)
}

// clientIPMode selects how normalizeClientIP resolves the real client IP.
// It is read from the LICENSE_CLIENTIP_MODE env var (case-insensitive).
//
//   - "off": always return remoteIP unchanged (legacy pre-fix behaviour,
//     e.g. when testing behind no proxy or in a local single-hop setup).
//   - "xff": (default) resolve the hop-correct entry from the LAST
//     X-Forwarded-For value (see the package doc for the 2-hop model).
//   - "cf": prefer the single-valued CF-Connecting-IP header when it parses
//     as an IP, else fall back to the "xff" behaviour.
//
// Any unrecognized value falls back to "xff" so a typo can never silently
// re-introduce the one-budget-for-all-clients failure.
type clientIPMode string

const (
	clientIPModeOff clientIPMode = "off"
	clientIPModeXFF clientIPMode = "xff"
	clientIPModeCF  clientIPMode = "cf"
)

// resolveClientIPMode returns the active LICENSE_CLIENTIP_MODE, defaulting to
// "xff" when the variable is unset or empty. Unrecognized values also map to
// "xff" (fail-safe, never to "off") so a misconfiguration cannot collapse every
// client onto the loopback budget.
func resolveClientIPMode() clientIPMode {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("LICENSE_CLIENTIP_MODE"))) {
	case "off":
		return clientIPModeOff
	case "cf":
		return clientIPModeCF
	default:
		// "xff" and anything unrecognized (including empty) → XFF.
		return clientIPModeXFF
	}
}

// resolveTrustedHops returns the number of X-Forwarded-For hops to walk back
// from the right end to reach the real client. It is read from
// LICENSE_TRUSTED_HOPS (default 2) and is clamped to >= 1 so a zero or
// negative value — which normalizeClientIP would otherwise treat as "return
// remoteIP" — still yields a usable hop count rather than silently disabling
// the fix.
func resolveTrustedHops() int {
	raw := strings.TrimSpace(os.Getenv("LICENSE_TRUSTED_HOPS"))
	if raw == "" {
		return 2
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return 2
	}
	if n < 1 {
		return 1
	}
	return n
}

// normalizeClientIP resolves the real client IP that the rate limiter should
// key on, from the proxy X-Forwarded-For chain (or CF-Connecting-IP).
//
// Parameters:
//   - header: the inbound request headers (read-only: the value is returned,
//     never written — the collapsing middleware in main.go owns the write).
//   - remoteIP: the connection peer (e.Request.RemoteAddr with the port
//     stripped). Returned unchanged for any ambiguous case.
//   - hops: how many entries from the RIGHT end of the last X-Forwarded-For
//     value the client sits at (see the package doc: 2 in production).
//
// Behaviour by mode (resolveClientIPMode):
//   - clientIPModeOff: returns remoteIP unchanged.
//   - clientIPModeCF: if the single-valued CF-Connecting-IP header parses as
//     an IP, returns it; otherwise falls through to XFF behaviour.
//   - clientIPModeXFF (default): reads the LAST X-Forwarded-For header value
//     (the one the nearest trusted proxy appended), splits on ",", trims each
//     entry, keeps only entries that parse with netip.ParseAddr, and returns
//     the entry at index len(valid)-hops, CLAMPED to 0.
//
// The clamp is the whole point. A chain SHORTER than the configured hop count
// means the edge passed the client value through UNAPPENDED (the measured
// production shape: both hops forward a single-entry XFF holding the true
// client). The oldest available entry is then the client; returning remoteIP
// — the proxy's own peer address — instead is what collapsed every client
// onto one rate-limit bucket, because main.go writes the returned value back
// and e.RealIP() keys the limiter on it. A chain LONGER than or equal to hops
// keeps the exact right-end offset model, so a genuinely appending edge still
// resolves correctly.
//
// normalizeClientIP returns remoteIP ONLY when there is no usable entry at
// all: the X-Forwarded-For header is absent or empty, or no entry in the
// chain parses as an IP. hops <= 0 still returns remoteIP. Garbage and empty
// entries are skipped WITHOUT counting toward hops, so a forged prepended
// entry can never shift which real entry is returned — only a genuine proxy
// append (always at the right end) changes the resolved IP.
//
// SECURITY ASSUMPTION: the selected entry is trustworthy only because the
// edge is assumed to sanitise (overwrite) or produce the X-Forwarded-For /
// CF-Connecting-IP header. The clamp makes the oldest available entry the
// answer when the chain is short, so an edge that merely PASSES THROUGH a
// client-supplied header hands that client its own choice of rate-limit key.
// This is not spoof-resistance; it is correctness for a pass-through edge.
// Deployments behind such an edge must rely on the edge overwriting the
// header (which is what the seed's trusted-proxy config encodes).
func normalizeClientIP(header http.Header, remoteIP string, hops int) string {
	mode := resolveClientIPMode()
	if mode == clientIPModeOff {
		return remoteIP
	}

	if mode == clientIPModeCF {
		if cf := strings.TrimSpace(header.Get("CF-Connecting-IP")); cf != "" {
			if _, err := netip.ParseAddr(cf); err == nil {
				return cf
			}
		}
		// Fall through to XFF behaviour when CF-Connecting-IP is missing/garbage.
	}

	// XFF behaviour: the LAST header occurrence is the one the nearest trusted
	// proxy appended, which is exactly what RealIP() trusts once TrustedProxy
	// is seeded. Only valid IPs count toward the hop walk.
	values := header.Values("X-Forwarded-For")
	if len(values) == 0 {
		return remoteIP
	}
	chain := strings.Split(values[len(values)-1], ",")

	valid := make([]string, 0, len(chain))
	for _, e := range chain {
		trimmed := strings.TrimSpace(e)
		if trimmed == "" {
			continue
		}
		if _, err := netip.ParseAddr(trimmed); err != nil {
			continue
		}
		valid = append(valid, trimmed)
	}

	// No usable entry at all → the only case that may fall back to the peer.
	if len(valid) == 0 || hops <= 0 {
		return remoteIP
	}
	// Walk hops back from the right end, clamped to the oldest entry: a
	// shorter-than-hops chain means the edge forwarded the client value
	// unappended, so the oldest entry IS the client (see the doc comment).
	idx := len(valid) - hops
	if idx < 0 {
		idx = 0
	}
	return valid[idx]
}

// stripPort returns host without its optional ":port" suffix, mirroring the
// port handling RealIP()'s fallback (e.RemoteIP()) relies on. A bare host
// with no colon is returned unchanged; an IPv6 literal in brackets keeps the
// brackets.
func stripPort(remoteAddr string) string {
	if remoteAddr == "" {
		return ""
	}
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		// No port present (e.g. a bare IP or unix socket path) — use as-is.
		return remoteAddr
	}
	return host
}

// seedClientIPSettings installs the trusted-proxy configuration that makes
// e.RealIP() (and therefore every rate limiter) trust the X-Forwarded-For
// header. Before this, Settings.TrustedProxy.Headers was empty, so RealIP()
// fell back to e.RemoteIP() — which is the Caddy loopback peer — collapsing
// every client onto 127.0.0.1 and one shared budget.
//
// UseLeftmostIP is deliberately LEFT FALSE: the router middleware in main.go
// collapses X-Forwarded-For to exactly ONE value, so leftmost/rightmost is
// irrelevant and we avoid any ambiguity about which entry RealIP() picks.
//
// The seed is idempotent per boot — if the header is already trusted it is a
// no-op — and persists via app.Save (which reloads the in-memory settings,
// so RealIP() sees it immediately, even for the very next request). The
// PB_SETTINGS row defaults exist only for a screenshots-import scenario; this
// guarantees the running server is correct regardless of how pb_data was
// provisioned.
func seedClientIPSettings(app core.App) error {
	s := app.Settings()
	// Already seeded: keep the existing config (do not overwrite a deliberate
	// operator change such as extra headers or UseLeftmostIP=true).
	if len(s.TrustedProxy.Headers) == 1 && s.TrustedProxy.Headers[0] == "X-Forwarded-For" {
		return nil
	}
	s.TrustedProxy.Headers = []string{"X-Forwarded-For"}
	// Leave UseLeftmostIP at its zero value (false).
	return app.Save(s)
}
