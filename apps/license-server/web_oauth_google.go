// Google OAuth web flow core (ADR #54).
//
// This half is pure and testable without Google: the single-use state store, the
// PKCE pair, the authorize-URL builder, the authorization-code exchange, and the
// ID-token claims check. The handlers that wire them to routes live in the same
// package and are tested against a fake token endpoint, so nothing here needs
// network access or client credentials to be verified.
//
// Two decisions worth stating: the state is single-use and expiring (a replayed
// callback must not mint a second session), and the ID token is NOT signature-
// verified — it arrives directly from Google's token endpoint over TLS in response
// to our own code exchange, which is exactly why the exchange happens server-side.
// Its claims are still checked (iss / aud / exp), because a token minted for a
// different client must not authenticate here.
package main

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

const (
	// oauthStateTTL bounds how long a started sign-in may be completed. Short:
	// the user is at the consent screen, not doing anything else.
	oauthStateTTL = 10 * time.Minute
	// oauthStateCookie binds a pending flow to the browser that started it, so a
	// state value leaked into a log cannot be used by another browser (login CSRF).
	oauthStateCookie = "oz_oauth_state"
	// oauthScopes is identity only: no Google API is called, and no offline access
	// is requested, so no refresh token is ever issued (ADR #54 §2.1).
	oauthScopes = "openid email profile"
	// oauthMaxPending caps how many sign-ins may be in flight at once. Without a
	// cap, /start is an unauthenticated write into a map bounded only by its TTL.
	oauthMaxPending = 10000
	// oauthTokenTimeout bounds the token exchange: a hung provider must not hold
	// a request handler open.
	oauthTokenTimeout = 10 * time.Second
	// oauthStartMax / oauthStartWindow bound how many sign-ins one host may begin.
	// `/start` is unauthenticated: without this a single host can fill the pending map and
	// answer every other user 503 until the TTL drains — the store's ceiling bounds MEMORY,
	// this bounds the damage one caller can do. Looser than the OTP limiter's 10 on purpose:
	// a shared office IP signs several people in, and a withdrawn consent is a legit retry.
	oauthStartMax    = 30
	oauthStartWindow = 15 * time.Minute
)

// The two endpoints are variables rather than constants so tests can point them at a
// local fake; production never reassigns them.
var (
	googleAuthEndpoint  = "https://accounts.google.com/o/oauth2/v2/auth"
	googleTokenEndpoint = "https://oauth2.googleapis.com/token"
)

// oauthPending is one started sign-in, keyed by its state value.
type oauthPending struct {
	next      string // post-login path on the marketing host
	verifier  string // PKCE code_verifier; sent only to the token endpoint
	expiresAt time.Time
}

// expires satisfies pendingEntry.
func (p *oauthPending) expires() time.Time { return p.expiresAt }

var googleOAuthState = newPendingStore[*oauthPending](oauthMaxPending)

// oauthStartLimiter is a per-IP bucket on beginning a sign-in (see oauthStartMax).
var oauthStartLimiter = &windowLimiter{
	entries: make(map[string]*windowEntry),
	limit:   oauthStartMax,
	window:  oauthStartWindow,
}

// newOAuthState mints the state value, the PKCE verifier, and its S256 challenge.
func newOAuthState() (state, verifier, challenge string, err error) {
	stateBytes := make([]byte, 24)
	if _, err = rand.Read(stateBytes); err != nil {
		return "", "", "", fmt.Errorf("failed to generate oauth state: %w", err)
	}
	verifierBytes := make([]byte, 32)
	if _, err = rand.Read(verifierBytes); err != nil {
		return "", "", "", fmt.Errorf("failed to generate pkce verifier: %w", err)
	}
	// base64url without padding is the unreserved 43-128 character set PKCE wants.
	verifier = base64.RawURLEncoding.EncodeToString(verifierBytes)
	sum := sha256.Sum256([]byte(verifier))
	challenge = base64.RawURLEncoding.EncodeToString(sum[:])
	return hex.EncodeToString(stateBytes), verifier, challenge, nil
}

// oauthAuthorizeURL builds the consent-screen URL. Fixed parameters only: nothing
// from the request reaches it except the state and the challenge.
func oauthAuthorizeURL(clientID, redirectURI, state, challenge string) string {
	q := url.Values{}
	q.Set("client_id", clientID)
	q.Set("redirect_uri", redirectURI)
	q.Set("response_type", "code")
	q.Set("scope", oauthScopes)
	q.Set("state", state)
	q.Set("code_challenge", challenge)
	q.Set("code_challenge_method", "S256")
	// Every sign-in is an explicit account choice: a shared browser must not
	// silently reuse whoever is signed into Google.
	q.Set("prompt", "select_account")
	return googleAuthEndpoint + "?" + q.Encode()
}

// oauthTokenResponse is the subset of the token endpoint response we consume.
type oauthTokenResponse struct {
	IDToken string `json:"id_token"`
}

// exchangeOAuthCode swaps an authorization code for tokens at tokenEndpoint.
//
// tokenEndpoint is a parameter so tests point it at a fake; production passes the
// real Google endpoint. The client secret never leaves the server, and the PKCE
// verifier is sent here and only here.
func exchangeOAuthCode(tokenEndpoint, clientID, clientSecret, redirectURI, code, verifier string) (*oauthTokenResponse, error) {
	form := url.Values{}
	form.Set("client_id", clientID)
	form.Set("client_secret", clientSecret)
	form.Set("code", code)
	form.Set("code_verifier", verifier)
	form.Set("grant_type", "authorization_code")
	form.Set("redirect_uri", redirectURI)

	client := &http.Client{Timeout: oauthTokenTimeout}
	resp, err := client.PostForm(tokenEndpoint, form)
	if err != nil {
		return nil, fmt.Errorf("token exchange failed: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		return nil, fmt.Errorf("token response could not be read: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		// The body can carry a client_id / redirect_uri diagnosis, but it must not
		// reach the browser: log it, answer generically.
		return nil, fmt.Errorf("token endpoint answered %d: %s", resp.StatusCode, string(body))
	}
	var parsed oauthTokenResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("token response was not JSON: %w", err)
	}
	if parsed.IDToken == "" {
		return nil, fmt.Errorf("token response carried no id_token")
	}
	return &parsed, nil
}

// oauthIDClaims is the subset of the ID token we trust after validation.
type oauthIDClaims struct {
	Subject       string
	Email         string
	EmailVerified bool
}

// rawIDClaims mirrors the wire shape. aud is a raw message because Google sends a
// string for a single audience and an array when a token has several.
type rawIDClaims struct {
	Iss           string          `json:"iss"`
	Aud           json.RawMessage `json:"aud"`
	Exp           int64           `json:"exp"`
	Sub           string          `json:"sub"`
	Email         string          `json:"email"`
	EmailVerified bool            `json:"email_verified"`
}

// decodeIDTokenClaims parses the payload segment without verifying the signature.
func decodeIDTokenClaims(idToken string) (*rawIDClaims, error) {
	parts := strings.Split(idToken, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("id_token is not a three-part JWT")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		// Some issuers pad; retry with padding rather than rejecting a valid token.
		if padded, padErr := base64.URLEncoding.DecodeString(parts[1]); padErr == nil {
			payload = padded
		} else {
			return nil, fmt.Errorf("id_token payload is not base64url: %w", err)
		}
	}
	var claims rawIDClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return nil, fmt.Errorf("id_token payload is not JSON: %w", err)
	}
	return &claims, nil
}

// audienceMatches reports whether the token was minted for this client.
func audienceMatches(raw json.RawMessage, clientID string) bool {
	if len(raw) == 0 || clientID == "" {
		return false
	}
	var single string
	if err := json.Unmarshal(raw, &single); err == nil {
		return single == clientID
	}
	var many []string
	if err := json.Unmarshal(raw, &many); err == nil {
		for _, aud := range many {
			if aud == clientID {
				return true
			}
		}
	}
	return false
}

// validateIDToken checks the claims that decide whether this identity may sign in.
//
// The signature is deliberately not verified: the token arrived over TLS directly
// from the token endpoint in response to our own exchange, and no other party can
// inject one. iss / aud / exp are checked because a token minted for a different
// client, or an expired one replayed from a log, must not authenticate here.
func validateIDToken(idToken, clientID string, now time.Time) (*oauthIDClaims, error) {
	claims, err := decodeIDTokenClaims(idToken)
	if err != nil {
		return nil, err
	}
	if claims.Iss != "accounts.google.com" && claims.Iss != "https://accounts.google.com" {
		return nil, fmt.Errorf("id_token issuer %q is not Google", claims.Iss)
	}
	if !audienceMatches(claims.Aud, clientID) {
		return nil, fmt.Errorf("id_token audience does not match this client")
	}
	if claims.Exp == 0 || now.After(time.Unix(claims.Exp, 0)) {
		return nil, fmt.Errorf("id_token is expired")
	}
	if claims.Sub == "" {
		return nil, fmt.Errorf("id_token has no subject")
	}
	if normalizeEmail(claims.Email) == "" {
		return nil, fmt.Errorf("id_token has no email")
	}
	return &oauthIDClaims{
		Subject:       claims.Sub,
		Email:         normalizeEmail(claims.Email),
		EmailVerified: claims.EmailVerified,
	}, nil
}

// ── Helpers the handlers share ──────────────────────────────────────

// oauthSiteURL is the public marketing site the flow returns to. Configured once
// rather than taken from the request, which is why no host allowlist is needed
// here: the host is ours, and only the PATH is ever attacker-influenced.
func oauthSiteURL() string {
	if v := strings.TrimSpace(os.Getenv("OZ_WEB_SITE_URL")); v != "" {
		return strings.TrimSuffix(v, "/")
	}
	return "https://kasir.mu"
}

// oauthNextPath restricts the post-login path to a same-site path.
//
// The same shape lib/safe-next.ts enforces in the browser: a leading slash, never a
// second slash, and none of the characters the URL parser normalises into one
// (backslash, tab, CR, LF) — `/[backslash]evil.com` is the form that made a prefix
// test insufficient there, and this is the server-side twin of that guard.
func oauthNextPath(raw string) string {
	const fallback = "/en/account"
	if raw == "" || !strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") {
		return fallback
	}
	if strings.ContainsAny(raw[1:], "\\\t\n\r") {
		return fallback
	}
	return raw
}

// oauthRedirectURI is the callback URL Google must have registered. The explicit
// override wins; otherwise it is derived from the host this request arrived on,
// which is the host the browser used and therefore the one the operator registered.
func oauthRedirectURI(e *core.RequestEvent) string {
	if v := strings.TrimSpace(os.Getenv("OZ_GOOGLE_REDIRECT_URI")); v != "" {
		return v
	}
	return "https://" + e.Request.Host + "/api/v1/web/oauth/google/callback"
}

// clearOAuthStateCookie expires the browser binding for a finished flow.
func clearOAuthStateCookie(e *core.RequestEvent) {
	http.SetCookie(e.Response, &http.Cookie{
		Name:     oauthStateCookie,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	})
}

// ── GET /api/v1/web/oauth/google/start ─────────────────────────────

// handleWebOAuthGoogleStart begins the web sign-in: it mints a state value, records
// the pending flow, binds the state to this browser with a cookie, and redirects to
// Google.
func handleWebOAuthGoogleStart(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		clientID := strings.TrimSpace(os.Getenv("OZ_GOOGLE_CLIENT_ID"))
		if clientID == "" {
			// Same shape as request-otp's unconfigured SMTP answer: a visible 503, never
			// a redirect to a consent screen that cannot complete.
			return e.JSON(http.StatusServiceUnavailable, map[string]any{
				"error": "google sign-in is not configured",
			})
		}

		// Consume the per-IP budget before minting anything: an unconfigured deployment
		// answered above without touching it, and a refused caller must leave no state.
		if !oauthStartLimiter.allow(e.RealIP()) {
			return e.JSON(http.StatusTooManyRequests, map[string]any{
				"error": "rate limit exceeded, try again later",
			})
		}

		state, verifier, challenge, err := newOAuthState()
		if err != nil {
			log.Printf("/web/oauth/google/start: %v", err)
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "could not start sign-in"})
		}
		if !googleOAuthState.put(state, &oauthPending{
			next:      oauthNextPath(e.Request.URL.Query().Get("next")),
			verifier:  verifier,
			expiresAt: time.Now().Add(oauthStateTTL),
		}) {
			return e.JSON(http.StatusServiceUnavailable, map[string]any{
				"error": "too many sign-ins in progress, try again shortly",
			})
		}

		// Bind the state to THIS browser: a state value that leaks into a log or a
		// referrer cannot then be completed from somewhere else (login CSRF).
		http.SetCookie(e.Response, &http.Cookie{
			Name:     oauthStateCookie,
			Value:    state,
			Path:     "/",
			MaxAge:   int(oauthStateTTL.Seconds()),
			HttpOnly: true,
			Secure:   true,
			SameSite: http.SameSiteLaxMode,
		})
		return e.Redirect(http.StatusFound, oauthAuthorizeURL(clientID, oauthRedirectURI(e), state, challenge))
	}
}

// ── GET /api/v1/web/oauth/google/callback ──────────────────────────

// handleWebOAuthGoogleCallback completes the flow: state checked against both the
// store and the browser cookie, the code exchanged server-side, the claims validated,
// the identity resolved, and a one-time F1 code handed to the marketing host.
func handleWebOAuthGoogleCallback(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		clientID := strings.TrimSpace(os.Getenv("OZ_GOOGLE_CLIENT_ID"))
		clientSecret := strings.TrimSpace(os.Getenv("OZ_GOOGLE_CLIENT_SECRET"))
		if clientID == "" || clientSecret == "" {
			return e.JSON(http.StatusServiceUnavailable, map[string]any{
				"error": "google sign-in is not configured",
			})
		}

		query := e.Request.URL.Query()
		// The user declined, or Google reported a problem: land them back on the
		// login page rather than on a JSON error they cannot act on.
		if refused := query.Get("error"); refused != "" {
			log.Printf("/web/oauth/google/callback: provider refused: %s", refused)
			return e.Redirect(http.StatusFound, oauthSiteURL()+"/en/login?oauth="+url.QueryEscape(refused))
		}
		state := query.Get("state")
		code := query.Get("code")
		if state == "" || code == "" {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "missing state or code"})
		}
		cookie, cookieErr := e.Request.Cookie(oauthStateCookie)
		if cookieErr != nil || cookie.Value == "" ||
			subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(state)) != 1 {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "invalid oauth state"})
		}
		pending, ok := googleOAuthState.take(state)
		clearOAuthStateCookie(e)
		if !ok {
			// Unknown, expired, or already used — one answer for all three.
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "invalid oauth state"})
		}

		token, err := exchangeOAuthCode(googleTokenEndpoint, clientID, clientSecret,
			oauthRedirectURI(e), code, pending.verifier)
		if err != nil {
			// The body can carry a redirect_uri or client_id diagnosis; log it, answer
			// generically so nothing about our configuration reaches the browser.
			log.Printf("/web/oauth/google/callback: token exchange failed: %v", err)
			return e.JSON(http.StatusBadGateway, map[string]any{"error": "sign-in could not be completed"})
		}
		claims, err := validateIDToken(token.IDToken, clientID, time.Now())
		if err != nil {
			log.Printf("/web/oauth/google/callback: id_token rejected: %v", err)
			return e.JSON(http.StatusUnauthorized, map[string]any{"error": "sign-in could not be completed"})
		}

		tenant, outcome, err := resolveIdentity(app, providerGoogle, claims.Subject,
			claims.Email, claims.EmailVerified, "")
		if err != nil {
			log.Printf("/web/oauth/google/callback: resolve failed: %v", err)
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "sign-in could not be completed"})
		}
		switch outcome {
		case IdentityBound, IdentityLinked, IdentityCreated:
			log.Printf("/web/oauth/google: %s identity for tenant %s (%s)", providerGoogle, tenant.Id, outcome)
		case IdentityRefusedReserved:
			return e.JSON(http.StatusForbidden, map[string]any{"error": "this address cannot sign in"})
		case IdentityRefusedUnverified:
			return e.JSON(http.StatusForbidden, map[string]any{"error": "your email address is not verified with Google"})
		case IdentityConflict:
			return e.JSON(http.StatusConflict, map[string]any{"error": "this identity is linked to another account"})
		default:
			log.Printf("/web/oauth/google/callback: unexpected outcome %q", outcome)
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "sign-in could not be completed"})
		}

		// The session token itself must never reach a URL: hand the Worker a
		// single-use code instead (hardening F1), exactly as the OTP flow does.
		exchangeCode, err := webExchangeStore.mint(tenant.Id)
		if err != nil {
			log.Printf("/web/oauth/google/callback: mint failed for tenant %s: %v", tenant.Id, err)
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "sign-in could not be completed"})
		}
		target := oauthSiteURL() + pending.next
		separator := "?"
		if strings.Contains(target, "?") {
			separator = "&"
		}
		return e.Redirect(http.StatusFound, target+separator+"code="+url.QueryEscape(exchangeCode))
	}
}
