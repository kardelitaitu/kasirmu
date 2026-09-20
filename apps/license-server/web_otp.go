package main

// Web OTP endpoints for the marketing site's login/account flow
// (website-plan.md §5/§11). The tenant's identity IS the `tenants`
// record — no web_users collection. All browser traffic goes through
// these Go-router endpoints; PocketBase itself stays internal.
//
// Flow: POST request-otp (register-or-login — an unknown email self-signs
// a new ACTIVE tenant, see handleRequestOTP) → email 6-digit code → POST
// verify-otp → short-lived session token → GET /me (Bearer) → POST
// logout.
//
// OTP codes and sessions are stored in-memory ONLY (short-lived, and the
// plan explicitly says "no new auth collection"). A server restart
// invalidates pending codes and sessions — acceptable for short-lived
// credentials: the user re-requests a code. Rate-limit state is also
// in-memory per the contact.go precedent (per-email keys must not share
// the persisted per-IP tables, which are keyed by IP alone).

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/mail"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// ── Web OTP constants ────────────────────────────────────────────────

const (
	// webOtpTTL is how long a generated code stays valid.
	webOtpTTL = 15 * time.Minute
	// defaultWebSessionTTL is the session lifetime unless OZ_WEB_SESSION_TTL
	// overrides it. 24h keeps the account dashboard usable across a work
	// day; tokens are still revocable via /logout and on server restart.
	defaultWebSessionTTL = 24 * time.Hour
	// webMaxBodyBytes caps request bodies (same rationale as contact.go).
	webMaxBodyBytes = 16 * 1024
	// webOtpWindow / webOtpRequestMax / webOtpVerifyMax / webIPMax implement
	// the plan §11 rate table: 3 request-otp per email per 15 min and
	// 5 verify-otp attempts per email per 15 min, plus a per-IP backstop
	// so one host cannot spray many distinct emails (SMTP-quota abuse).
	webOtpWindow     = 15 * time.Minute
	webOtpRequestMax = 3
	webOtpVerifyMax  = 5
	webIPMax         = 10
	webSweepInterval = 30 * time.Minute
	webSweepMaxAge   = 2 * time.Hour
)

// ── In-memory stores ─────────────────────────────────────────────────

// otpCode is a pending verification code for one email.
type otpCode struct {
	hash      string // sha256 of the 6-digit code (never store plaintext)
	expiresAt time.Time
}

// webSession is an issued session token bound to a tenant.
type webSession struct {
	tenantID  string
	expiresAt time.Time
}

// otpStore holds pending codes and issued sessions. Both maps are
// guarded by one mutex; they are tiny (bounded by rate limiting + sweep).
type otpStore struct {
	mu       sync.Mutex
	codes    map[string]*otpCode    // key: normalized email
	sessions map[string]*webSession // key: sha256(token)
}

var webOtpStore = &otpStore{
	codes:    make(map[string]*otpCode),
	sessions: make(map[string]*webSession),
}

// storeCode records a pending code for the email.
func (s *otpStore) storeCode(email, codeHash string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.codes[email] = &otpCode{hash: codeHash, expiresAt: time.Now().Add(webOtpTTL)}
}

// takeCode atomically reads and deletes the code for the email.
// Returns ("", false) when missing or expired — callers treat both the
// same (generic 401) so verify-otp never reveals which case occurred.
func (s *otpStore) takeCode(email string) (hash string, ok bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, exists := s.codes[email]
	if !exists || time.Now().After(c.expiresAt) {
		delete(s.codes, email)
		return "", false
	}
	delete(s.codes, email) // single-use
	return c.hash, true
}

// deleteCode removes a pending code (used when email delivery fails so
// no orphan code outlives the failure). Idempotent.
func (s *otpStore) deleteCode(email string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.codes, email)
}

// createSession stores a new session and returns its expiry.
func (s *otpStore) createSession(tokenHash, tenantID string) time.Time {
	expires := time.Now().Add(webSessionTTL())
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[tokenHash] = &webSession{tenantID: tenantID, expiresAt: expires}
	return expires
}

// touchSession extends the TTL of an existing session (active-use refresh).
// No-op for unknown or expired sessions.
func (s *otpStore) touchSession(tokenHash string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if sess, exists := s.sessions[tokenHash]; exists && time.Now().Before(sess.expiresAt) {
		sess.expiresAt = time.Now().Add(webSessionTTL())
	}
}

// getSession returns the tenant bound to a token hash, or "" if the
// session is unknown/expired (both treated identically → 401).
func (s *otpStore) getSession(tokenHash string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, exists := s.sessions[tokenHash]
	if !exists || time.Now().After(sess.expiresAt) {
		delete(s.sessions, tokenHash)
		return ""
	}
	return sess.tenantID
}

// deleteSession removes a session (logout). Idempotent.
func (s *otpStore) deleteSession(tokenHash string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, tokenHash)
}

// deleteSessionsForTenant removes every session bound to a tenant and
// returns how many were dropped (used by the admin tenant delete so a
// deleted account's dashboard logins die immediately).
func (s *otpStore) deleteSessionsForTenant(tenantID string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	dropped := 0
	for hash, sess := range s.sessions {
		if sess.tenantID == tenantID {
			delete(s.sessions, hash)
			dropped++
		}
	}
	return dropped
}

// sweep removes expired codes and sessions. Runs on a background
// goroutine and is exposed for tests.
func (s *otpStore) sweep() {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for email, c := range s.codes {
		if now.After(c.expiresAt) {
			delete(s.codes, email)
		}
	}
	for hash, sess := range s.sessions {
		if now.After(sess.expiresAt) {
			delete(s.sessions, hash)
		}
	}
}

// webSweepLoop is the background cleanup goroutine for the OTP store.
func webSweepLoop() {
	ticker := time.NewTicker(webSweepInterval)
	defer ticker.Stop()
	for range ticker.C {
		webOtpStore.sweep()
	}
}

// ── Per-key windowed rate limiter ────────────────────────────────────
//
// A fixed-window counter keyed by an arbitrary string (email or IP).
// Unlike the persisted per-IP token bucket in ratelimit.go, this one is
// deliberately in-memory and per-key: the SQLite persistence tables are
// keyed by IP alone, so sharing them between limiter kinds would clobber
// each other's state (same rationale as contactRateLimiter).

type windowLimiter struct {
	mu      sync.Mutex
	entries map[string]*windowEntry
	limit   int
	window  time.Duration
}

type windowEntry struct {
	count int
	start time.Time
}

// allow reports whether the key may proceed, incrementing its counter.
func (wl *windowLimiter) allow(key string) bool {
	wl.mu.Lock()
	defer wl.mu.Unlock()
	now := time.Now()
	e, ok := wl.entries[key]
	if !ok || now.Sub(e.start) >= wl.window {
		e = &windowEntry{start: now}
		wl.entries[key] = e
	}
	if e.count >= wl.limit {
		return false
	}
	e.count++
	return true
}

// remainingSeconds reports how long until the key's current window closes
// (0 when there is no active window). Read-only: it does not consume
// budget. Used by callers that must tell a client how long a cooldown
// (e.g. the LSE-11 api_key rotation cap) still lasts.
func (wl *windowLimiter) remainingSeconds(key string) int {
	wl.mu.Lock()
	defer wl.mu.Unlock()
	e, ok := wl.entries[key]
	if !ok {
		return 0
	}
	rem := wl.window - time.Since(e.start)
	if rem < 0 {
		return 0
	}
	return int(rem.Seconds() + 0.999)
}

// sweep drops entries whose window has fully passed.
func (wl *windowLimiter) sweep() {
	wl.mu.Lock()
	defer wl.mu.Unlock()
	now := time.Now()
	for k, e := range wl.entries {
		if now.Sub(e.start) >= wl.window {
			delete(wl.entries, k)
		}
	}
}

// windowSweepLoop is the background cleanup goroutine for all window
// limiters (bounded by the same 30-min cadence as the OTP store).
func windowSweepLoop() {
	ticker := time.NewTicker(webSweepInterval)
	defer ticker.Stop()
	for range ticker.C {
		otpRequestLimiter.sweep()
		otpVerifyLimiter.sweep()
		otpIPLimiter.sweep()
		apiRotationLimiter.sweep()
		recoverLimiter.sweep()
		webLoginLimiter.sweep()
		webRegisterLimiter.sweep()
		webResetRequestLimiter.sweep()
		webResetVerifyLimiter.sweep()
		exchangeConsumeLimiter.sweep()
		oauthStartLimiter.sweep()
	}
}

// otpRequestLimiter enforces the plan's 3 request-otp per email per 15 min.
var otpRequestLimiter = &windowLimiter{
	entries: make(map[string]*windowEntry),
	limit:   webOtpRequestMax,
	window:  webOtpWindow,
}

// otpVerifyLimiter enforces the plan's 5 verify-otp attempts per email per 15 min.
var otpVerifyLimiter = &windowLimiter{
	entries: make(map[string]*windowEntry),
	limit:   webOtpVerifyMax,
	window:  webOtpWindow,
}

// otpIPLimiter is a per-IP backstop (10/15min) so one host can't spray
// many distinct emails or burn SMTP quota.
var otpIPLimiter = &windowLimiter{
	entries: make(map[string]*windowEntry),
	limit:   webIPMax,
	window:  webOtpWindow,
}

// ── Session token helpers ────────────────────────────────────────────

// webSessionTTL returns the configured session lifetime, defaulting to
// defaultWebSessionTTL. The OZ_WEB_SESSION_TTL env var (Go duration,
// e.g. "24h") overrides it for ops tuning.
func webSessionTTL() time.Duration {
	v := strings.TrimSpace(os.Getenv("OZ_WEB_SESSION_TTL"))
	if v == "" {
		return defaultWebSessionTTL
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		log.Printf("web OTP: invalid OZ_WEB_SESSION_TTL=%q (using default %v): %v",
			v, defaultWebSessionTTL, err)
		return defaultWebSessionTTL
	}
	return d
}

// generateWebToken returns a 64-char hex CSPRNG session token.
func generateWebToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("crypto/rand.Read failed: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// hashWebToken derives the store key for a session token (SHA-256), so a
// memory/DB dump of the store never exposes a usable token.
func hashWebToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// hashOtpCode derives the at-rest form of a 6-digit code (SHA-256).
func hashOtpCode(code string) string {
	sum := sha256.Sum256([]byte(code))
	return hex.EncodeToString(sum[:])
}

// issueWebSession mints a session token for the tenant and stores its
// hash in the in-memory session store (shared by OTP and password login).
// Returns the raw token (handed to the client once) and its expiry.
func issueWebSession(tenantID string) (token string, expiresAt time.Time, err error) {
	token, err = generateWebToken()
	if err != nil {
		return "", time.Time{}, fmt.Errorf("crypto/rand.Read failed: %w", err)
	}
	expiresAt = webOtpStore.createSession(hashWebToken(token), tenantID)
	return token, expiresAt, nil
}

// webSessionResponse is the success body shared by verify-otp and login:
// the token plus the tenant/license/subscription summaries the dashboard
// renders on arrival.
func webSessionResponse(app core.App, tenant *core.Record, token string, expiresAt time.Time) map[string]any {
	return map[string]any{
		"token":        token,
		"expires_at":   expiresAt.UTC().Format(time.RFC3339),
		"tenant":       tenantSummary(tenant),
		"license":      licenseSummary(app, tenant.Id),
		"subscription": subscriptionSummary(app, tenant.Id),
	}
}

// constantTimeHashEq compares two hex hashes in constant time so a wrong
// code guess doesn't leak timing information.
func constantTimeHashEq(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// ── CORS allowlist ───────────────────────────────────────────────────

// webAllowedOrigins returns the comma-separated OZ_WEB_ALLOWED_ORIGINS
// allowlist, defaulting to the current kasir.mu domain and the local
// dev origin. Additionally, OZ_CORS_ORIGINS (extra comma-separated
// origins, used by the Rust cloud server) is merged in so operators only
// need to set one env var for both services. Requests without an Origin
// header (curl, POS clients, server-to-server) are always allowed —
// CORS only governs browsers.
func webAllowedOrigins() []string {
	// Primary allowlist from OZ_WEB_ALLOWED_ORIGINS.
	v := strings.TrimSpace(os.Getenv("OZ_WEB_ALLOWED_ORIGINS"))
	var out []string
	if v == "" {
		out = []string{
			"https://kasir.mu",
			"https://dashboard.kasir.mu",
			"https://admin.kasir.mu",
			"http://localhost:4321",
		}
	} else {
		parts := strings.Split(v, ",")
		out = make([]string, 0, len(parts))
		for _, p := range parts {
			if p = strings.TrimSpace(p); p != "" {
				out = append(out, p)
			}
		}
	}
	// Merge extra origins from OZ_CORS_ORIGINS (shared with the Rust
	// cloud server) so a single env var covers both services.
	if extra := strings.TrimSpace(os.Getenv("OZ_CORS_ORIGINS")); extra != "" {
		for _, p := range strings.Split(extra, ",") {
			if p = strings.TrimSpace(p); p != "" {
				out = append(out, p)
			}
		}
	}
	return out
}

// webOriginAllowed rejects browser requests from origins outside the
// allowlist. PocketBase's global CORS middleware (default AllowOrigins:
// ["*"]) still emits Access-Control-Allow-Origin for any browser; this
// in-handler check is the actual enforcement layer per plan §11 ("the Go
// router sets CORS for the allow-listed origins").
func webOriginAllowed(e *core.RequestEvent) bool {
	origin := e.Request.Header.Get("Origin")
	if origin == "" {
		return true // non-browser caller
	}
	for _, allowed := range webAllowedOrigins() {
		if origin == allowed {
			return true
		}
	}
	return false
}

// ── SMTP email delivery ──────────────────────────────────────────────

// sendOTPEmail is a package-level var so tests can stub it (capturing the
// generated code) without a real SMTP server. Production impl: net/smtp.
var sendOTPEmail = sendOTPEmailSMTP

// sendOTPEmailSMTP delivers the 6-digit code via SMTP using the
// OZ_SMTP_* env vars:
//
//	OZ_SMTP_HOST     (required)
//	OZ_SMTP_PORT     (default 587)
//	OZ_SMTP_USER     (optional; some relays send unauthenticated)
//	OZ_SMTP_PASSWORD (optional)
//	OZ_SMTP_FROM     (default "no-reply@kasir.mu")
//
// Config is read per call so tests can t.Setenv and ops can fix a relay
// with a redeploy. Env values are never echoed in responses or logs.
func sendOTPEmailSMTP(to, code string) error {
	host := strings.TrimSpace(os.Getenv("OZ_SMTP_HOST"))
	if host == "" {
		return fmt.Errorf("OZ_SMTP_HOST is not configured")
	}
	port := strings.TrimSpace(os.Getenv("OZ_SMTP_PORT"))
	if port == "" {
		port = "587"
	}
	user := os.Getenv("OZ_SMTP_USER")
	password := os.Getenv("OZ_SMTP_PASSWORD")
	from := strings.TrimSpace(os.Getenv("OZ_SMTP_FROM"))
	if from == "" {
		from = "no-reply@kasir.mu"
	}

	msg := buildOtpEmail(from, to, code)
	return sendMailSMTP(host, port, user, password, from, []string{to}, msg)
}

// buildOtpEmail renders the plain-text OTP email (RFC 5322 message bytes).
// The code is only ever sent over the wire to the tenant's inbox — it is
// not stored in plaintext anywhere on the server.
func buildOtpEmail(from, to, code string) []byte {
	subject := "Your kasir.mu verification code"
	body := fmt.Sprintf(
		"Your kasir.mu verification code is: %s\n\n"+
			"It expires in %d minutes. If you didn't request this code, you can safely ignore this email.\n",
		code, int(webOtpTTL.Minutes()))

	var sb strings.Builder
	fmt.Fprintf(&sb, "From: kasir.mu <%s>\r\n", from)
	fmt.Fprintf(&sb, "To: %s\r\n", to)
	fmt.Fprintf(&sb, "Subject: %s\r\n", subject)
	sb.WriteString("MIME-Version: 1.0\r\n")
	sb.WriteString("Content-Type: text/plain; charset=utf-8\r\n")
	fmt.Fprintf(&sb, "Date: %s\r\n", time.Now().UTC().Format(time.RFC1123Z))
	sb.WriteString("\r\n")
	sb.WriteString(body)
	return []byte(sb.String())
}

// generateOtpCode returns a 6-digit code from the CSPRNG, uniform over
// 000000–999999 via rejection sampling: draw 24 bits, accept only values
// < 16,000,000 (the largest multiple of 1,000,000 that fits in 24 bits)
// so the modulo is bias-free.
func generateOtpCode() (string, error) {
	b := make([]byte, 3)
	for {
		if _, err := rand.Read(b); err != nil {
			return "", fmt.Errorf("crypto/rand.Read failed: %w", err)
		}
		val := int(b[0])<<16 | int(b[1])<<8 | int(b[2])
		if val < 16000000 {
			return fmt.Sprintf("%06d", val%1000000), nil
		}
	}
}

// ── request-otp ──────────────────────────────────────────────────────

// handleRequestOTP implements POST /api/v1/web/request-otp.
//
//	{ "email": "owner@example.com" }
//
// Register-or-login: an email with no tenant yet self-signs a new ACTIVE
// tenant (the website requires an account before checkout — the dashboard
// then drives payment). The response is always 200 for a well-formed
// request, so the endpoint never reveals whether the account existed
// before; a code is only generated + emailed for an ACTIVE tenant.
// Suspended / revoked tenants receive no code.
//
//   - 429: rate limited (3/email/15min, 10/IP/15min) — checked BEFORE
//     tenant lookup so probing cannot bypass the budget.
//   - 403: browser Origin outside the OZ_WEB_ALLOWED_ORIGINS allowlist.
//   - 400: malformed body / invalid email (never leaks account state).
//   - 503: SMTP not configured (server-side config, not account state).
func handleRequestOTP(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		e.Request.Body = http.MaxBytesReader(e.Response, e.Request.Body, webMaxBodyBytes)

		if !webOriginAllowed(e) {
			log.Printf("/web/request-otp: CORS blocked origin %q (add it to OZ_WEB_ALLOWED_ORIGINS or OZ_CORS_ORIGINS)", e.Request.Header.Get("Origin"))
			return e.JSON(http.StatusForbidden, map[string]any{
				"error": "origin not allowed",
			})
		}

		// ── Rate limit (per email + per IP), BEFORE validation ──
		clientIP := e.RealIP()
		var req struct {
			Email string `json:"email"`
		}
		if err := json.NewDecoder(e.Request.Body).Decode(&req); err != nil {
			// Still consume the IP budget so malformed-body probing
			// cannot bypass the limiter via repeated 400s.
			otpIPLimiter.allow(clientIP)
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "invalid JSON body",
			})
		}

		email := normalizeEmail(req.Email)
		if email == "" {
			otpIPLimiter.allow(clientIP)
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "email is required",
			})
		}
		if !isValidEmail(email) {
			otpIPLimiter.allow(clientIP)
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "email must be a valid address",
			})
		}

		if !otpRequestLimiter.allow(email) || !otpIPLimiter.allow(clientIP) {
			return e.JSON(http.StatusTooManyRequests, map[string]any{
				"error": "rate limit exceeded, try again later",
			})
		}

		// ── SMTP configured? (503 = server config, never account state) ──
		if strings.TrimSpace(os.Getenv("OZ_SMTP_HOST")) == "" {
			log.Printf("/web/request-otp: OZ_SMTP_HOST not configured — dropping request for %q", email)
			return e.JSON(http.StatusServiceUnavailable, map[string]any{
				"error": "email delivery is not configured",
			})
		}

		// ── Resolve tenant by email (unique index) ────────────────
		// Self-signup: a miss registers the email as a new ACTIVE tenant
		// (mirroring the Paddle webhook's tenant shape). FindFirstRecordByData
		// returns (nil, err) on a miss — guard both before touching tenant.
		tenant, err := app.FindFirstRecordByData("tenants", "email", email)
		if tenant == nil || err != nil {
			tenant, err = createTenantForEmail(app, email)
			if err != nil {
				if errors.Is(err, errReservedAdminEmail) {
					// Reserved admin identity: never self-sign it.
					// Same bare 200 as the non-active branch below —
					// no enumeration, and no code is sent or stored.
					log.Printf("/web/request-otp: refusing self-signup for reserved admin identity %q", email)
					return e.JSON(http.StatusOK, map[string]any{"status": "ok"})
				}
				log.Printf("/web/request-otp: tenant registration failed for %q: %v", email, err)
				return e.JSON(http.StatusInternalServerError, map[string]any{
					"error": "could not register an account, please try again",
				})
			}
		}
		if tenant.GetString("status") != "active" {
			// Same 200 as success — no enumeration.
			log.Printf("/web/request-otp: tenant %q is not active — no code", email)
			return e.JSON(http.StatusOK, map[string]any{"status": "ok"})
		}

		code, err := generateOtpCode()
		if err != nil {
			log.Printf("/web/request-otp: code generation failed: %v", err)
			return e.JSON(http.StatusInternalServerError, map[string]any{
				"error": "could not generate a code, please try again",
			})
		}

		// Store hash BEFORE sending so a failed send still consumes the
		// code (no orphan codes for an email the server can't reach).
		webOtpStore.storeCode(email, hashOtpCode(code))

		if err := sendOTPEmail(email, code); err != nil {
			log.Printf("/web/request-otp: email send failed for tenant %q: %v", tenant.Id, err)
			webOtpStore.deleteCode(email) // don't leave a dead code behind
			return e.JSON(http.StatusInternalServerError, map[string]any{
				"error": "could not deliver the code, please try again later",
			})
		}

		log.Printf("/web/request-otp: code sent to tenant %q", tenant.Id)
		return e.JSON(http.StatusOK, map[string]any{"status": "ok"})
	}
}

// createTenantForEmail self-signs a new ACTIVE tenant for the OTP
// register-or-login flow (no password — the email code is the only
// credential until the owner sets one). See createTenant.
func createTenantForEmail(app core.App, email string) (*core.Record, error) {
	return createTenant(app, email, "")
}

// createTenant registers a new ACTIVE tenant, mirroring the Paddle
// webhook's tenant shape (paddle_webhook.go): phone defaults to "-" and
// api_key holds a bcrypt hash of a throwaway placeholder — the customer's
// real api_key is minted at first activation (activate.go), which is when
// the POS learns it. passwordHash is the optional web login credential
// ("" for OTP-only signups, set by /web/register and the webhook path).
// If a concurrent request wins the unique-email race, the existing record
// is returned instead of failing.
// errReservedAdminEmail marks a createTenant call for the deployment's
// admin identity. Callers answer it with their EXISTING enumeration-free
// shapes: request-otp with the same bare 200 {"status":"ok"} it returns
// for a non-active tenant (no code), and /web/register with its existing
// 409 — which already reveals existence for every address, so nothing
// new leaks.
var errReservedAdminEmail = errors.New("tenants: email is reserved for the deployment admin identity")

// reservedAdminEmails returns the lowercase set of emails createTenant
// must never self-sign: the resolved admin target UNION the compiled
// defaultAdminEmail. The env side comes from adminEmailTargetWithDefault,
// the reservation-side wrapper over the shared resolver in
// admin_tenant_lifecycle.go (the local duplicate this replaced was only
// ever waiting for that rename). It is NOT isAdminTenantRecord's resolver:
// the reserved set must keep the compiled default when the env is unset,
// while the lifecycle guard refuses on an unset env. The default stays
// reserved even when OZ_ADMIN_EMAIL is set so the guard is
// order-independent with the deploy wave: while
// the env is unset the admin identity IS the default, so reserving only
// the resolved value would leave the hole open on exactly the deploys
// that are exposed. Keys are lowercase and candidates are compared
// through normalizeEmail, so a case variant cannot pass the guard while
// still matching the EqualFold admin gate.
func reservedAdminEmails() map[string]bool {
	return map[string]bool{
		strings.ToLower(defaultAdminEmail):             true,
		strings.ToLower(adminEmailTargetWithDefault()): true,
	}
}

func createTenant(app core.App, email, passwordHash string) (*core.Record, error) {
	// ── Admin reservation guard — the self-signup chokepoint ──────
	// createTenant is the one function both self-signup doors funnel
	// into (/web/register and request-otp's register-or-login). Without
	// this guard a caller mints an ACTIVE tenants row for the admin
	// identity with THEIR OWN credentials (email_verified=false) and
	// then passes the EqualFold admin match at login — two requests,
	// zero inbox access. Refuse BEFORE the save: an existing row is
	// never touched, and the unique-email race return below is
	// untouched for every other address (a concurrent duplicate on a
	// reserved address is the admin's own row and must never be handed
	// to a registrant).
	if reservedAdminEmails()[normalizeEmail(email)] {
		return nil, errReservedAdminEmail
	}
	tenantColl, err := app.FindCollectionByNameOrId("tenants")
	if err != nil {
		return nil, fmt.Errorf("tenants collection not found: %w", err)
	}
	tenant := core.NewRecord(tenantColl)
	tenant.Set("email", email)
	tenant.Set("phone", "-")
	placeholder := generateAPIKey()
	hash, lookup, hashErr := hashAPIKey(placeholder)
	if hashErr != nil {
		return nil, fmt.Errorf("failed to hash placeholder api_key: %w", hashErr)
	}
	tenant.Set("api_key", hash)
	tenant.Set("api_key_lookup", lookup)
	tenant.Set("status", "active")
	if passwordHash != "" {
		tenant.Set("password_hash", passwordHash)
	}
	// Verification is a separate step: a new account is NOT yet
	// email-verified until the user proves inbox ownership via verify-otp
	// (or reset-password).
	tenant.Set("email_verified", false)
	if saveErr := app.Save(tenant); saveErr != nil {
		// Unique-email race: another request registered the tenant first.
		existing, lookupErr := app.FindFirstRecordByData("tenants", "email", email)
		if lookupErr != nil || existing == nil {
			return nil, fmt.Errorf("failed to save tenant %q: %w", email, saveErr)
		}
		return existing, nil
	}
	log.Printf("registered new tenant %q (id=%s)", email, tenant.Id)
	return tenant, nil
}

// ── verify-otp ───────────────────────────────────────────────────────

// handleVerifyOTP implements POST /api/v1/web/verify-otp.
//
//	{ "email": "owner@example.com", "code": "123456" }
//
// Success → 200 with { token, expires_at, tenant, license, subscription }.
// Failure → generic 401 "invalid or expired code" for every failure mode
// (unknown email, wrong code, expired code, non-active tenant) so the
// endpoint never reveals which one occurred.
//
//   - 429: rate limited (5 attempts/email/15min, 10/IP/15min).
//   - 403: browser Origin outside the allowlist.
func handleVerifyOTP(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		e.Request.Body = http.MaxBytesReader(e.Response, e.Request.Body, webMaxBodyBytes)

		if !webOriginAllowed(e) {
			log.Printf("/web/verify-otp: CORS blocked origin %q (add it to OZ_WEB_ALLOWED_ORIGINS or OZ_CORS_ORIGINS)", e.Request.Header.Get("Origin"))
			return e.JSON(http.StatusForbidden, map[string]any{
				"error": "origin not allowed",
			})
		}

		clientIP := e.RealIP()
		var req struct {
			Email string `json:"email"`
			Code  string `json:"code"`
		}
		if err := json.NewDecoder(e.Request.Body).Decode(&req); err != nil {
			otpIPLimiter.allow(clientIP)
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "invalid JSON body",
			})
		}

		email := normalizeEmail(req.Email)
		code := strings.TrimSpace(req.Code)
		if email == "" || !isValidEmail(email) || !is6DigitCode(code) {
			otpIPLimiter.allow(clientIP)
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "email and 6-digit code are required",
			})
		}

		// ── Escalating brute-force lockout (per email), FIRST ──────
		// Wrong-code guessing escalates the same way as password login:
		// 5s minimum gap, +30s after 3rd consecutive failure, capped at
		// 15 minutes (login_lockout.go).
		if locked, retryAfter := checkLoginLockout(email); locked {
			return e.JSON(http.StatusTooManyRequests, map[string]any{
				"error":       describeLoginLockout(retryAfter),
				"retry_after": retryAfter,
			})
		}

		if !otpVerifyLimiter.allow(email) || !otpIPLimiter.allow(clientIP) {
			return e.JSON(http.StatusTooManyRequests, map[string]any{
				"error": "rate limit exceeded, try again later",
			})
		}

		// ── Resolve tenant BEFORE touching the code store ─────────
		// Non-active tenants get the same 401 as a wrong code (their
		// codes are never issued, but the response must not differ).
		tenant, err := app.FindFirstRecordByData("tenants", "email", email)
		if err != nil || tenant.GetString("status") != "active" {
			recordLoginFailure(email)
			return e.JSON(http.StatusUnauthorized, map[string]any{
				"error": "invalid or expired code",
			})
		}

		storedHash, ok := webOtpStore.takeCode(email)
		if !ok || !constantTimeHashEq(storedHash, hashOtpCode(code)) {
			recordLoginFailure(email)
			return e.JSON(http.StatusUnauthorized, map[string]any{
				"error": "invalid or expired code",
			})
		}

		// Successful OTP verification clears the escalating lockout.
		clearLoginLockout(email)

		// ── Mark the email verified ─────────────────────────────
		// Proving inbox ownership completes registration. Best-effort:
		// a persistence hiccup must not block the session (the flag is
		// cosmetic until the dashboard — the next verify-otp re-runs it).
		if !tenant.GetBool("email_verified") {
			tenant.Set("email_verified", true)
			if err := app.Save(tenant); err != nil {
				log.Printf("/web/verify-otp: failed to persist email_verified for tenant %q: %v", tenant.Id, err)
			}
		}

		// ── Issue session token ──────────────────────────────────
		token, expiresAt, err := issueWebSession(tenant.Id)
		if err != nil {
			log.Printf("/web/verify-otp: token generation failed: %v", err)
			return e.JSON(http.StatusInternalServerError, map[string]any{
				"error": "could not start a session, please try again",
			})
		}

		log.Printf("/web/verify-otp: session issued for tenant %q", tenant.Id)
		return e.JSON(http.StatusOK, webSessionResponse(app, tenant, token, expiresAt))
	}
}

// ── /me ──────────────────────────────────────────────────────────────

// handleMe implements GET /api/v1/web/me.
//
// Authorization: Bearer <token>
//
// Returns the tenant profile + license + subscription summary, or a
// generic 401 for a missing/unknown/expired token (never reveals which).
// Session resolution is shared with the dashboard endpoints
// (resolveWebSession in web_dashboard.go) — including the active-use TTL
// refresh (hardening F6), so an operator who keeps the dashboard open
// stays signed in without re-authenticating.
func handleMe(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		tenant, ok := resolveWebSession(app, e)
		if !ok {
			return nil // response already sent
		}

		return e.JSON(http.StatusOK, map[string]any{
			"tenant":       tenantSummary(tenant),
			"license":      licenseSummary(app, tenant.Id),
			"subscription": subscriptionSummary(app, tenant.Id),
		})
	}
}

// ── logout ───────────────────────────────────────────────────────────

// handleLogout implements POST /api/v1/web/logout. Always 200 — the
// client clears its sessionStorage regardless, and an unknown token is
// nothing to report (idempotent logout).
func handleLogout(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		if !webOriginAllowed(e) {
			return e.JSON(http.StatusForbidden, map[string]any{
				"error": "origin not allowed",
			})
		}

		token, err := extractBearerToken(e)
		if err == nil {
			webOtpStore.deleteSession(hashWebToken(token))
		}
		return e.JSON(http.StatusOK, map[string]any{"status": "ok"})
	}
}

// ── Shared helpers ───────────────────────────────────────────────────

// extractBearerToken pulls the token from the Authorization header
// (reuses the RFC 6750 bearerPrefix constant from helpers.go).
func extractBearerToken(e *core.RequestEvent) (string, error) {
	auth := e.Request.Header.Get("Authorization")
	if !strings.HasPrefix(auth, bearerPrefix) {
		return "", fmt.Errorf("missing or malformed Authorization header")
	}
	token := strings.TrimSpace(strings.TrimPrefix(auth, bearerPrefix))
	if token == "" {
		return "", fmt.Errorf("empty token")
	}
	return token, nil
}

// normalizeEmail lowercases and trims an email (the tenants.email index
// stores lowercase — see seedTenant in handler_test.go).
func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// isValidEmail validates an address using net/mail (mirrors contact.go).
func isValidEmail(email string) bool {
	addr, err := mail.ParseAddress(email)
	return err == nil && addr.Address == email
}

// is6DigitCode checks for exactly six ASCII digits.
func is6DigitCode(code string) bool {
	if len(code) != 6 {
		return false
	}
	for _, c := range code {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// tenantSummary is the /me tenant block. Keys follow the camelCase
// convention of the license/subscription blocks (tierKey, expiresAt, …).
func tenantSummary(tenant *core.Record) map[string]any {
	return map[string]any{
		"id":            tenant.Id,
		"email":         tenant.GetString("email"),
		"emailVerified": tenant.GetBool("email_verified"),
		"status":        tenant.GetString("status"),
	}
}

// formatDateField serializes a record's date field as RFC3339 UTC (the
// contract the website frontend parses: "2027-01-01T00:00:00Z"). PocketBase
// GetString on a DateField returns its internal storage form
// ("2027-01-01 00:00:00.000Z" — space-separated), which is NOT RFC3339 and
// breaks strict parsers. Empty/zero values return "" so the JSON omits the
// timestamp rather than emitting an invalid one.
func formatDateField(rec *core.Record, field string) string {
	dt := rec.GetDateTime(field)
	t := dt.Time()
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

// licenseSummary returns the tenant's latest activated license key
// record, or nil when none exists (account page shows the fallback).
func licenseSummary(app core.App, tenantID string) any {
	// Prefer the activated key (bound to the tenant at activation).
	keys, err := app.FindRecordsByFilter(
		"license_keys",
		"activated_by = {:tenant_id}",
		"-created", 1, 0,
		map[string]any{"tenant_id": tenantID},
	)
	if err != nil || len(keys) == 0 {
		// Not activated yet: show the key the tenant paid for. The webhook
		// mints it with status "unused" + paddle_sub_id; the subscription
		// record links that id to the tenant. Any subscription record
		// counts (active or grace_period) — a canceled customer still owns
		// the key and the POS honors it through the signed grace payload.
		// (The POS binds it via activated_by at first activation —
		// activate.go.)
		subs, subErr := app.FindRecordsByFilter(
			"subscriptions",
			"tenant_id = {:tenant_id}",
			"-starts_at", 1, 0,
			map[string]any{"tenant_id": tenantID},
		)
		if subErr != nil || len(subs) == 0 {
			return nil
		}
		subID := subs[0].GetString("paddle_sub_id")
		if subID == "" {
			return nil
		}
		keys, err = app.FindRecordsByFilter(
			"license_keys",
			"paddle_sub_id = {:sid}",
			"-created", 1, 0,
			map[string]any{"sid": subID},
		)
		if err != nil || len(keys) == 0 {
			return nil
		}
	}
	k := keys[0]
	return map[string]any{
		"key":       k.GetString("key"),
		"tierKey":   k.GetString("tier_key"),
		"status":    k.GetString("status"),
		"expiresAt": formatDateField(k, "expires_at"),
	}
}

// subscriptionSummary returns the tenant's latest subscription record
// regardless of status (active, grace_period, expired, revoked) so the
// account page can show a canceled customer's state instead of falling
// back to the "subscribe now" prompt, or nil when none exists. This is
// the dashboard lookup — deliberately broader than status.go's POS
// /status lookup, which still gates runtime access to active-only.
func subscriptionSummary(app core.App, tenantID string) any {
	subs, err := app.FindRecordsByFilter(
		"subscriptions",
		"tenant_id = {:tenant_id}",
		"-starts_at", 1, 0,
		map[string]any{"tenant_id": tenantID},
	)
	if err != nil || len(subs) == 0 {
		return nil
	}
	s := subs[0]
	return map[string]any{
		"tierKey":    s.GetString("tier_key"),
		"status":     s.GetString("status"),
		"startsAt":   formatDateField(s, "starts_at"),
		"expiresAt":  formatDateField(s, "expires_at"),
		"graceUntil": formatDateField(s, "grace_until"),
		// Vertical-bundle id (C3.2) the subscription was purchased with — the
		// account dashboard uses it to hide the bundle upgrade card once the
		// subscriber already owns the bundle (restaurant_starter).
		"bundleId": s.GetString("bundle_id"),
	}
}
