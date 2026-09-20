package main

// Desktop device link (ADR #54 §2.5).
//
// The wizard's "link this device to my account" step: the POS opens the system browser
// at Google, Google returns to the licence server, and the server binds the identity to
// the tenant the DEVICE proves it holds. The device never sees a Google token, the
// client secret never leaves the server, and the loopback listener receives only a
// single-use code — never a credential.
//
// PKCE runs app → server → Google: the app generates the verifier and sends it here over
// TLS at /start; the server derives the S256 challenge for the consent URL and keeps the
// verifier until the token exchange. Sending the verifier rather than the challenge is
// what lets the exchange happen server-side while the secret stays out of the app.
//
// Endpoints:
//
//	POST /api/v1/desktop/link/google/start    — device-authenticated; returns the consent URL
//	GET  /api/v1/desktop/link/google/callback — Google's return; binds, then hands off to loopback
//	POST /api/v1/desktop/link/consume         — loopback code in, linked account out

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

const (
	// linkStateTTL bounds how long a started link may be completed.
	linkStateTTL = 10 * time.Minute
	// linkCodeTTL bounds the loopback handoff: the listener is waiting right now, so a
	// code that outlives a human's patience serves nothing.
	linkCodeTTL = 2 * time.Minute
	// Ceilings for the two stores (see pendingStore).
	linkMaxPending = 5000
	linkMaxCodes   = 5000
	// linkPath is the callback Google returns to (the licence host, not the app).
	linkPath = "/api/v1/desktop/link/google/callback"
)

// desktopLinkPending is one started device link, keyed by its state value.
type desktopLinkPending struct {
	tenantID    string // proven by the device's api_key, never taken from the body
	machineID   string
	verifier    string // PKCE verifier; sent only to the token endpoint
	redirectURI string // validated loopback, e.g. http://127.0.0.1:49152
	expiresAt   time.Time
}

// expires satisfies pendingEntry.
func (p *desktopLinkPending) expires() time.Time { return p.expiresAt }

// desktopLinkCode is the one-time handoff to the loopback listener.
type desktopLinkCode struct {
	tenantID  string
	machineID string
	subject   string
	email     string
	expiresAt time.Time
}

// expires satisfies pendingEntry.
func (c *desktopLinkCode) expires() time.Time { return c.expiresAt }

var (
	desktopLinkState = newPendingStore[*desktopLinkPending](linkMaxPending)
	desktopLinkCodes = newPendingStore[*desktopLinkCode](linkMaxCodes)
)

// loopbackRedirect reports whether a redirect_uri has the shape the ADR permits: plain
// http on a loopback address with an explicit port.
//
// Load-bearing: the value comes from the app and the callback redirects to it verbatim,
// so anything else would make this endpoint an open redirect that hands a one-time code
// to whoever asked.
func loopbackRedirect(redirectURI string) bool {
	u, err := url.Parse(redirectURI)
	if err != nil {
		return false
	}
	if u.Scheme != "http" {
		return false
	}
	host := u.Hostname()
	if host != "127.0.0.1" && host != "::1" {
		return false
	}
	return u.Port() != ""
}

// pkceChallenge derives the S256 challenge for a verifier, matching newOAuthState.
func pkceChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// generateLinkCode mints the single-use handoff value (48 hex, like the F1 code).
func generateLinkCode() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("could not generate a link code: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// desktopLinkCallbackURI is the callback Google must have registered for this host.
func desktopLinkCallbackURI(e *core.RequestEvent) string {
	// The override names the WEB callback; this flow's callback shares its host.
	if v := strings.TrimSpace(os.Getenv("OZ_GOOGLE_REDIRECT_URI")); v != "" {
		if i := strings.Index(v, "/api/v1/"); i > 0 {
			return v[:i] + linkPath
		}
	}
	return "https://" + e.Request.Host + linkPath
}

// authenticateDevice resolves the tenant from the device's own api_key and confirms the
// machine is registered to it. Both facts come from the device.
func authenticateDevice(app core.App, e *core.RequestEvent, machineID string) (*core.Record, bool) {
	if strings.TrimSpace(machineID) == "" {
		e.JSON(http.StatusBadRequest, map[string]any{"error": "machine_id is required"})
		return nil, false
	}
	token, err := extractBearerToken(e)
	if err != nil {
		e.JSON(http.StatusUnauthorized, map[string]any{"error": "missing device credentials"})
		return nil, false
	}
	tenant, err := findTenantByAPIKey(app, token)
	if err != nil || tenant == nil {
		e.JSON(http.StatusUnauthorized, map[string]any{"error": "invalid device credentials"})
		return nil, false
	}
	machines, err := app.FindRecordsByFilter("tenant_machines",
		"machine_id = {:mid} && tenant_id = {:tid}", "", 1, 0,
		map[string]any{"mid": machineID, "tid": tenant.Id})
	if err != nil {
		log.Printf("/desktop/link: machine lookup failed: %v", err)
		e.JSON(http.StatusInternalServerError, map[string]any{"error": "could not verify this device"})
		return nil, false
	}
	if len(machines) == 0 {
		// Not registered to this tenant: the wizard runs after activation, so either the
		// device was never activated or the credentials belong to another account.
		e.JSON(http.StatusForbidden, map[string]any{"error": "this device is not registered to that account"})
		return nil, false
	}
	return tenant, true
}

// ── POST /api/v1/desktop/link/google/start ─────────────────────────

// handleDesktopLinkStart records a pending link and answers with the consent URL.
func handleDesktopLinkStart(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		clientID := strings.TrimSpace(os.Getenv("OZ_GOOGLE_CLIENT_ID"))
		if clientID == "" {
			return e.JSON(http.StatusServiceUnavailable, map[string]any{"error": "google sign-in is not configured"})
		}

		e.Request.Body = http.MaxBytesReader(e.Response, e.Request.Body, webMaxBodyBytes)
		var req struct {
			MachineID    string `json:"machine_id"`
			CodeVerifier string `json:"code_verifier"`
			State        string `json:"state"`
			RedirectURI  string `json:"redirect_uri"`
		}
		if err := json.NewDecoder(e.Request.Body).Decode(&req); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "invalid JSON body"})
		}
		tenant, ok := authenticateDevice(app, e, req.MachineID)
		if !ok {
			return nil // response already sent
		}
		if !loopbackRedirect(req.RedirectURI) {
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "redirect_uri must be a loopback http URL with an explicit port",
			})
		}
		if !validOpaqueToken(req.State) {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "state must be 16-64 characters of [A-Za-z0-9_-]"})
		}
		if len(req.CodeVerifier) < 43 || len(req.CodeVerifier) > 128 {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "code_verifier must be 43-128 characters"})
		}
		if !desktopLinkState.put(req.State, &desktopLinkPending{
			tenantID:    tenant.Id,
			machineID:   req.MachineID,
			verifier:    req.CodeVerifier,
			redirectURI: req.RedirectURI,
			expiresAt:   time.Now().Add(linkStateTTL),
		}) {
			return e.JSON(http.StatusServiceUnavailable, map[string]any{
				"error": "too many links in progress, try again shortly",
			})
		}
		return e.JSON(http.StatusOK, map[string]any{
			"authorizeUrl": oauthAuthorizeURL(clientID, desktopLinkCallbackURI(e), req.State, pkceChallenge(req.CodeVerifier)),
		})
	}
}

// ── GET /api/v1/desktop/link/google/callback ───────────────────────

// handleDesktopLinkCallback completes the link and hands the app a one-time code.
//
// Google reaches this without a session, which is why the state carries the tenant: the
// pending record — minted only for a device that authenticated — is the authority.
func handleDesktopLinkCallback(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		clientID := strings.TrimSpace(os.Getenv("OZ_GOOGLE_CLIENT_ID"))
		clientSecret := strings.TrimSpace(os.Getenv("OZ_GOOGLE_CLIENT_SECRET"))
		if clientID == "" || clientSecret == "" {
			return e.JSON(http.StatusServiceUnavailable, map[string]any{"error": "google sign-in is not configured"})
		}
		query := e.Request.URL.Query()
		state := query.Get("state")
		if state == "" || query.Get("code") == "" {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "missing state or code"})
		}
		pending, ok := desktopLinkState.take(state)
		if !ok {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "invalid or expired link state"})
		}

		token, err := exchangeOAuthCode(googleTokenEndpoint, clientID, clientSecret,
			desktopLinkCallbackURI(e), query.Get("code"), pending.verifier)
		if err != nil {
			log.Printf("/desktop/link/google/callback: token exchange failed: %v", err)
			return linkErrorRedirect(e, pending.redirectURI, "exchange_failed")
		}
		claims, err := validateIDToken(token.IDToken, clientID, time.Now())
		if err != nil {
			log.Printf("/desktop/link/google/callback: id_token rejected: %v", err)
			return linkErrorRedirect(e, pending.redirectURI, "invalid_token")
		}

		// The device proved the tenant; the user proves the identity. resolveIdentity refuses
		// an identity that is not this tenant's own account.
		tenant, outcome, err := resolveIdentity(app, providerGoogle, claims.Subject,
			claims.Email, claims.EmailVerified, pending.tenantID)
		if err != nil {
			log.Printf("/desktop/link/google/callback: resolve failed: %v", err)
			return linkErrorRedirect(e, pending.redirectURI, "server_error")
		}
		switch outcome {
		case IdentityBound, IdentityLinked:
			log.Printf("/desktop/link/google: %s identity on tenant %s (%s)", providerGoogle, tenant.Id, outcome)
		case IdentityConflict, IdentityRefusedMismatch, IdentityRefusedReserved, IdentityRefusedUnverified:
			return linkErrorRedirect(e, pending.redirectURI, string(outcome))
		default:
			// IdentityCreated cannot happen here (the tenant is already proven), so seeing it
			// would mean the claimed tenant id did not resolve.
			log.Printf("/desktop/link/google/callback: unexpected outcome %q", outcome)
			return linkErrorRedirect(e, pending.redirectURI, "server_error")
		}

		code, err := generateLinkCode()
		if err != nil {
			log.Printf("/desktop/link/google/callback: %v", err)
			return linkErrorRedirect(e, pending.redirectURI, "server_error")
		}
		if !desktopLinkCodes.put(code, &desktopLinkCode{
			tenantID:  pending.tenantID,
			machineID: pending.machineID,
			subject:   claims.Subject,
			email:     claims.Email,
			expiresAt: time.Now().Add(linkCodeTTL),
		}) {
			return linkErrorRedirect(e, pending.redirectURI, "busy")
		}
		return e.Redirect(http.StatusFound, pending.redirectURI+"?link_code="+url.QueryEscape(code))
	}
}

// linkErrorRedirect sends the app back to its own listener with a reason it can show,
// rather than leaving the browser on a JSON error nobody is looking at.
func linkErrorRedirect(e *core.RequestEvent, redirectURI, reason string) error {
	return e.Redirect(http.StatusFound, redirectURI+"?link_error="+url.QueryEscape(reason))
}

// ── POST /api/v1/desktop/link/consume ──────────────────────────────

// handleDesktopLinkConsume exchanges the loopback code for the linked account.
//
// The code is single-use AND bound to the machine that started the flow, so a code
// lifted out of the loopback URL is worthless on another device.
func handleDesktopLinkConsume(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		e.Request.Body = http.MaxBytesReader(e.Response, e.Request.Body, webMaxBodyBytes)
		var req struct {
			LinkCode  string `json:"link_code"`
			MachineID string `json:"machine_id"`
		}
		if err := json.NewDecoder(e.Request.Body).Decode(&req); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "invalid JSON body"})
		}
		tenant, ok := authenticateDevice(app, e, req.MachineID)
		if !ok {
			return nil
		}
		code, ok := desktopLinkCodes.take(req.LinkCode)
		if !ok {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "invalid or expired link code"})
		}
		if code.tenantID != tenant.Id || code.machineID != req.MachineID {
			// Same answer as an unknown code: a mismatch is either a replay from elsewhere or a
			// device that did not start this flow. Note the code is ALREADY burned by take()
			// above — deliberate, like a one-time password: the cost of a leaked code is a
			// wasted two-minute window, not a link, and the legitimate device simply retries.
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "invalid or expired link code"})
		}
		return e.JSON(http.StatusOK, map[string]any{
			"tenantId": tenant.Id,
			"provider": providerGoogle,
			"email":    code.email,
		})
	}
}
