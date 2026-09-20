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
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
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
	// googleAuthEndpoint and googleTokenEndpoint are overridable per call so tests
	// drive a fake rather than the network.
	googleAuthEndpoint  = "https://accounts.google.com/o/oauth2/v2/auth"
	googleTokenEndpoint = "https://oauth2.googleapis.com/token"
	// oauthTokenTimeout bounds the token exchange: a hung provider must not hold
	// a request handler open.
	oauthTokenTimeout = 10 * time.Second
)

// oauthPending is one started sign-in, keyed by its state value.
type oauthPending struct {
	next      string // post-login path on the marketing host
	verifier  string // PKCE code_verifier; sent only to the token endpoint
	expiresAt time.Time
}

// oauthStateStore holds pending sign-ins. Expired entries are swept opportunistically
// on every insert rather than by a goroutine: the map is bounded by the rate limiter
// and the TTL, so a background sweeper would be machinery without a purpose.
type oauthStateStore struct {
	mu      sync.Mutex
	pending map[string]*oauthPending
}

var googleOAuthState = &oauthStateStore{pending: make(map[string]*oauthPending)}

// put records a pending sign-in, dropping anything already expired.
func (s *oauthStateStore) put(state string, p *oauthPending) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for key, entry := range s.pending {
		if now.After(entry.expiresAt) {
			delete(s.pending, key)
		}
	}
	s.pending[state] = p
}

// take atomically reads and deletes the pending sign-in for a state value.
// A missing, expired, or already-used state returns (nil, false) — all three are
// the same answer to the caller, which is what makes a replay indistinguishable
// from a bad request.
func (s *oauthStateStore) take(state string) (*oauthPending, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, exists := s.pending[state]
	if !exists {
		return nil, false
	}
	delete(s.pending, state) // single-use, whether or not it is still valid
	if time.Now().After(p.expiresAt) {
		return nil, false
	}
	return p, true
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
