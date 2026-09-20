// Tests for the Google OAuth web flow core (ADR #54).
//
// No network and no credentials: the token endpoint is a parameter, and the ID
// token is built here. The cases that matter are the refusals — an expired state,
// a replayed state, a token minted for another client, and an unverified address.
package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// buildIDToken assembles an unsigned JWT with the given payload claims.
func buildIDToken(t *testing.T, payload map[string]any) string {
	t.Helper()
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return "header." + base64.RawURLEncoding.EncodeToString(encoded) + ".signature"
}

// validClaims is a payload that validateIDToken accepts.
func validClaims(clientID string) map[string]any {
	return map[string]any{
		"iss":            "https://accounts.google.com",
		"aud":            clientID,
		"exp":            time.Now().Add(time.Hour).Unix(),
		"sub":            "1234567890",
		"email":          "Owner@Example.com",
		"email_verified": true,
	}
}

func TestNewOAuthStateIsUniqueAndPKCECorrect(t *testing.T) {
	state, verifier, challenge, err := newOAuthState()
	if err != nil {
		t.Fatalf("newOAuthState: %v", err)
	}
	if len(state) != 48 {
		t.Errorf("state length = %d, want 48 hex chars", len(state))
	}
	if len(verifier) < 43 || len(verifier) > 128 {
		t.Errorf("verifier length = %d, outside the PKCE 43-128 range", len(verifier))
	}
	sum := sha256.Sum256([]byte(verifier))
	if want := base64.RawURLEncoding.EncodeToString(sum[:]); challenge != want {
		t.Errorf("challenge is not S256(verifier): got %q want %q", challenge, want)
	}
	state2, verifier2, _, err := newOAuthState()
	if err != nil {
		t.Fatalf("second newOAuthState: %v", err)
	}
	if state == state2 || verifier == verifier2 {
		t.Error("two generated states must not repeat")
	}
}

func TestOAuthStateStoreIsSingleUse(t *testing.T) {
	store := newPendingStore[*oauthPending](oauthMaxPending)
	store.put("st-1", &oauthPending{next: "/en/account", verifier: "v", expiresAt: time.Now().Add(time.Minute)})
	got, ok := store.take("st-1")
	if !ok || got.next != "/en/account" {
		t.Fatalf("first take = %v %v", got, ok)
	}
	if _, ok := store.take("st-1"); ok {
		t.Error("a replayed state must not be honoured — that is the replay guard")
	}
	if _, ok := store.take("never-issued"); ok {
		t.Error("an unknown state must not be honoured")
	}
}

func TestOAuthStateStoreEnforcesAndFreesItsCeiling(t *testing.T) {
	// `/start` is unauthenticated and writes into this map, so the ceiling is the only
	// thing standing between one host and the process's memory for a TTL window. Both
	// halves matter: the cap must hold, and it must not wedge the endpoint shut — a map
	// full of expired entries that refuses every insert is a permanent outage.
	store := newPendingStore[*oauthPending](oauthMaxPending)
	for i := 0; i < oauthMaxPending; i++ {
		if !store.put(fmt.Sprintf("st-%d", i), &oauthPending{expiresAt: time.Now().Add(time.Minute)}) {
			t.Fatalf("the ceiling must admit %d entries; refused at %d", oauthMaxPending, i)
		}
	}
	if store.put("one-too-many", &oauthPending{expiresAt: time.Now().Add(time.Minute)}) {
		t.Fatal("a full store must refuse a new pending sign-in")
	}

	stale := newPendingStore[*oauthPending](oauthMaxPending)
	for i := 0; i < oauthMaxPending; i++ {
		stale.put(fmt.Sprintf("st-%d", i), &oauthPending{expiresAt: time.Now().Add(-time.Second)})
	}
	if !stale.put("fresh", &oauthPending{expiresAt: time.Now().Add(time.Minute)}) {
		t.Fatal("expired entries must be swept, or the cap becomes a permanent outage")
	}
}

func TestOAuthStateStoreRejectsExpiredAndSweepsOnInsert(t *testing.T) {
	store := newPendingStore[*oauthPending](oauthMaxPending)
	store.put("st-old", &oauthPending{expiresAt: time.Now().Add(-time.Second)})
	store.put("st-new", &oauthPending{expiresAt: time.Now().Add(time.Minute)})
	if _, ok := store.take("st-old"); ok {
		t.Error("an expired state must not be honoured")
	}
	if _, ok := store.pending["st-old"]; ok {
		t.Error("the insert should have swept the expired entry")
	}
	if _, ok := store.take("st-new"); !ok {
		t.Error("the fresh entry must survive the sweep")
	}
}

func TestOAuthAuthorizeURLHasTheRequiredParameters(t *testing.T) {
	raw := oauthAuthorizeURL("client-123", "https://license.example.com/cb", "state-abc", "chal-xyz")
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("authorize URL does not parse: %v", err)
	}
	q := u.Query()
	want := map[string]string{
		"client_id":             "client-123",
		"redirect_uri":          "https://license.example.com/cb",
		"response_type":         "code",
		"scope":                 "openid email profile",
		"state":                 "state-abc",
		"code_challenge":        "chal-xyz",
		"code_challenge_method": "S256",
	}
	for key, value := range want {
		if q.Get(key) != value {
			t.Errorf("%s = %q, want %q", key, q.Get(key), value)
		}
	}
	if q.Get("access_type") != "" || q.Get("prompt") != "select_account" {
		t.Errorf("expected select_account and no offline access, got prompt=%q access_type=%q",
			q.Get("prompt"), q.Get("access_type"))
	}
}

func TestExchangeOAuthCodeSendsTheVerifierAndParsesTheIDToken(t *testing.T) {
	var seen url.Values
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Errorf("parse form: %v", err)
		}
		seen = r.PostForm
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id_token":"tok-abc"}`))
	}))
	defer server.Close()

	resp, err := exchangeOAuthCode(server.URL, "cid", "secret", "https://x/cb", "the-code", "the-verifier")
	if err != nil {
		t.Fatalf("exchange: %v", err)
	}
	if resp.IDToken != "tok-abc" {
		t.Errorf("id_token = %q", resp.IDToken)
	}
	for key, value := range map[string]string{
		"code":          "the-code",
		"code_verifier": "the-verifier",
		"grant_type":    "authorization_code",
		"redirect_uri":  "https://x/cb",
		"client_id":     "cid",
		"client_secret": "secret",
	} {
		if seen.Get(key) != value {
			t.Errorf("%s = %q, want %q", key, seen.Get(key), value)
		}
	}
}

func TestExchangeOAuthCodeRejectsFailures(t *testing.T) {
	for _, tc := range []struct {
		name    string
		status  int
		body    string
		wantSub string
	}{
		{"non-200", http.StatusBadRequest, `{"error":"invalid_grant"}`, "answered 400"},
		{"not json", http.StatusOK, "not json", "not JSON"},
		{"no id_token", http.StatusOK, `{"access_token":"a"}`, "no id_token"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()
			_, err := exchangeOAuthCode(server.URL, "cid", "secret", "https://x/cb", "c", "v")
			if err == nil {
				t.Fatal("expected an error")
			}
			if !strings.Contains(err.Error(), tc.wantSub) {
				t.Errorf("error %q does not mention %q", err.Error(), tc.wantSub)
			}
		})
	}
}

func TestValidateIDTokenAcceptsAGoogleTokenAndNormalisesTheEmail(t *testing.T) {
	claims, err := validateIDToken(buildIDToken(t, validClaims("cid")), "cid", time.Now())
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if claims.Subject != "1234567890" {
		t.Errorf("subject = %q", claims.Subject)
	}
	if claims.Email != "owner@example.com" {
		t.Errorf("email must be normalised like every other door, got %q", claims.Email)
	}
	if !claims.EmailVerified {
		t.Error("email_verified must survive the parse")
	}
}

func TestValidateIDTokenRejections(t *testing.T) {
	clientID := "cid"
	cases := []struct {
		name    string
		mutate  func(map[string]any)
		wantSub string
	}{
		{"foreign issuer", func(c map[string]any) { c["iss"] = "https://evil.example.com" }, "issuer"},
		{"foreign audience", func(c map[string]any) { c["aud"] = "other-client" }, "audience"},
		{"expired", func(c map[string]any) { c["exp"] = time.Now().Add(-time.Minute).Unix() }, "expired"},
		{"no expiry", func(c map[string]any) { delete(c, "exp") }, "expired"},
		{"no subject", func(c map[string]any) { delete(c, "sub") }, "subject"},
		{"no email", func(c map[string]any) { delete(c, "email") }, "email"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			claims := validClaims(clientID)
			tc.mutate(claims)
			if _, err := validateIDToken(buildIDToken(t, claims), clientID, time.Now()); err == nil {
				t.Fatal("expected a rejection")
			} else if !strings.Contains(err.Error(), tc.wantSub) {
				t.Errorf("error %q does not mention %q", err.Error(), tc.wantSub)
			}
		})
	}
}

func TestValidateIDTokenAcceptsAnAudienceArrayAndPaddedPayload(t *testing.T) {
	claims := validClaims("cid")
	claims["aud"] = []any{"other", "cid"}
	token := buildIDToken(t, claims)
	if _, err := validateIDToken(token, "cid", time.Now()); err != nil {
		t.Fatalf("a multi-audience token naming this client must pass: %v", err)
	}
	// A padded payload must survive too: rejecting a valid token over padding
	// would fail a sign-in for a reason nobody can act on.
	payload, err := json.Marshal(validClaims("cid"))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	padded := "header." + base64.URLEncoding.EncodeToString(payload) + ".signature"
	if _, err := validateIDToken(padded, "cid", time.Now()); err != nil {
		t.Fatalf("padded payload should parse: %v", err)
	}
}

func TestValidateIDTokenRejectsMalformedTokens(t *testing.T) {
	for _, token := range []string{"", "only-one-part", "two.parts", "a.!!!not-base64!!!.c"} {
		if _, err := validateIDToken(token, "cid", time.Now()); err == nil {
			t.Errorf("token %q should be rejected", token)
		}
	}
}
