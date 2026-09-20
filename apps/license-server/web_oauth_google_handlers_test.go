// Handler tests for the Google sign-in flow (ADR #54).
//
// The scenarios drive the real routes through the test app; only the token endpoint
// is pointed at a local fake, so the whole path is exercised — state, browser cookie,
// exchange, claim checks, identity resolution, one-time code — with no network and no
// Google project.
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// fakeGoogleToken serves an id_token built from the given claims and fails the test
// if the exchange did not carry the PKCE verifier.
func fakeGoogleToken(t *testing.T, claims map[string]any) func() {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Errorf("parse form: %v", err)
		}
		if r.PostForm.Get("code_verifier") == "" {
			t.Error("the exchange must send the PKCE verifier")
		}
		if r.PostForm.Get("client_secret") == "" {
			t.Error("the exchange must send the client secret")
		}
		w.Header().Set("Content-Type", "application/json")
		body, _ := json.Marshal(map[string]string{"id_token": buildIDToken(t, claims)})
		_, _ = w.Write(body)
	}))
	previous := googleTokenEndpoint
	googleTokenEndpoint = server.URL
	return func() {
		googleTokenEndpoint = previous
		server.Close()
	}
}

// ── oauthNextPath ──────────────────────────────────────────────────

func TestOAuthNextPathAcceptsOnlySameSitePaths(t *testing.T) {
	const fallback = "/en/account"
	for _, tc := range []struct{ raw, want string }{
		{"/en/pricing", "/en/pricing"},
		{"/en/pricing?plan=pro", "/en/pricing?plan=pro"},
		{"", fallback},
		{"https://evil.example.com", fallback},
		{"//evil.example.com", fallback},
		{"/\\evil.example.com", fallback},
		{"/\t/evil.example.com", fallback},
		{"en/pricing", fallback},
	} {
		if got := oauthNextPath(tc.raw); got != tc.want {
			t.Errorf("oauthNextPath(%q) = %q, want %q", tc.raw, got, tc.want)
		}
	}
}

// ── /start ─────────────────────────────────────────────────────────

func TestOAuthStartRedirectsToGoogleWithStateCookieAndChallenge(t *testing.T) {
	t.Setenv("OZ_GOOGLE_CLIENT_ID", "client-abc")
	runScenario(t, &tests.ApiScenario{
		Name:           "oauth start",
		Method:         "GET",
		URL:            "/api/v1/web/oauth/google/start?next=/en/pricing",
		ExpectedStatus: http.StatusFound,
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			location := res.Header.Get("Location")
			if !strings.HasPrefix(location, googleAuthEndpoint+"?") {
				t.Fatalf("Location = %q, want the authorize endpoint", location)
			}
			state := queryParam(t, location, "state")
			if state == "" {
				t.Error("the authorize URL must carry a state")
			}
			if got := queryParam(t, location, "code_challenge_method"); got != "S256" {
				t.Errorf("code_challenge_method = %q, want S256", got)
			}
			if queryParam(t, location, "code_challenge") == "" {
				t.Error("the authorize URL must carry a PKCE challenge")
			}
			if got := queryParam(t, location, "scope"); got != oauthScopes {
				t.Errorf("scope = %q, want %q", got, oauthScopes)
			}
			if got := queryParam(t, location, "prompt"); got != "select_account" {
				t.Errorf("prompt = %q, want select_account", got)
			}
			if queryParam(t, location, "access_type") != "" {
				t.Error("no offline access may be requested")
			}
			cookie := findCookie(res, oauthStateCookie)
			if cookie == nil {
				t.Fatalf("the flow must set the %s cookie", oauthStateCookie)
			}
			if cookie.Value != state {
				t.Error("the cookie must bind the same state the authorize URL carries")
			}
			if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode {
				t.Errorf("cookie flags: HttpOnly=%v Secure=%v SameSite=%v", cookie.HttpOnly, cookie.Secure, cookie.SameSite)
			}
			// The pending record must be completable exactly once.
			if _, ok := googleOAuthState.take(state); !ok {
				t.Error("the state must be pending")
			}
			if _, ok := googleOAuthState.take(state); ok {
				t.Error("the state must be single-use")
			}
		},
	})
}

func TestOAuthStartIsUnavailableWhenUnconfigured(t *testing.T) {
	t.Setenv("OZ_GOOGLE_CLIENT_ID", "")
	runScenario(t, &tests.ApiScenario{
		Method:          "GET",
		URL:             "/api/v1/web/oauth/google/start",
		ExpectedStatus:  http.StatusServiceUnavailable,
		ExpectedContent: []string{"not configured"},
	})
}

// ── /callback ──────────────────────────────────────────────────────

func TestOAuthCallbackRejectsAMissingOrUnknownState(t *testing.T) {
	t.Setenv("OZ_GOOGLE_CLIENT_ID", "client-abc")
	t.Setenv("OZ_GOOGLE_CLIENT_SECRET", "secret")
	// No cookie at all: the browser binding is what makes a leaked state useless.
	runScenario(t, &tests.ApiScenario{
		Method:          "GET",
		URL:             "/api/v1/web/oauth/google/callback?state=abc&code=x",
		ExpectedStatus:  http.StatusBadRequest,
		ExpectedContent: []string{"invalid oauth state"},
	})
	// A cookie that matches, but a state nobody issued.
	runScenario(t, &tests.ApiScenario{
		Method:          "GET",
		URL:             "/api/v1/web/oauth/google/callback?state=abc&code=x",
		Headers:         map[string]string{"Cookie": oauthStateCookie + "=abc"},
		ExpectedStatus:  http.StatusBadRequest,
		ExpectedContent: []string{"invalid oauth state"},
	})
}

func TestOAuthCallbackRedirectsBackWhenTheUserDeclines(t *testing.T) {
	t.Setenv("OZ_GOOGLE_CLIENT_ID", "client-abc")
	t.Setenv("OZ_GOOGLE_CLIENT_SECRET", "secret")
	runScenario(t, &tests.ApiScenario{
		Method:         "GET",
		URL:            "/api/v1/web/oauth/google/callback?error=access_denied",
		ExpectedStatus: http.StatusFound,
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			location := res.Header.Get("Location")
			if !strings.Contains(location, "/en/login?oauth=access_denied") {
				t.Errorf("Location = %q, want the login page carrying the reason", location)
			}
		},
	})
}

func TestOAuthCallbackHappyPathMintsASingleUseCode(t *testing.T) {
	t.Setenv("OZ_GOOGLE_CLIENT_ID", "client-abc")
	t.Setenv("OZ_GOOGLE_CLIENT_SECRET", "secret")
	t.Setenv("OZ_WEB_SITE_URL", "https://kasir.mu")
	restore := fakeGoogleToken(t, validClaims("client-abc"))
	defer restore()

	state, verifier, _, err := newOAuthState()
	if err != nil {
		t.Fatalf("newOAuthState: %v", err)
	}
	runScenario(t, &tests.ApiScenario{
		Name:    "oauth callback",
		Method:  "GET",
		URL:     "/api/v1/web/oauth/google/callback?state=" + state + "&code=auth-code",
		Headers: map[string]string{"Cookie": oauthStateCookie + "=" + state},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			if !googleOAuthState.put(state, &oauthPending{
				next:      "/en/pricing",
				verifier:  verifier,
				expiresAt: time.Now().Add(time.Minute),
			}) {
				t.Fatal("could not seed the pending flow")
			}
		},
		ExpectedStatus: http.StatusFound,
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			location := res.Header.Get("Location")
			if !strings.HasPrefix(location, "https://kasir.mu/en/pricing?code=") {
				t.Fatalf("Location = %q, want the marketing host carrying a code", location)
			}
			code := location[strings.Index(location, "code=")+len("code="):]
			tenantID := webExchangeStore.consume(code)
			if tenantID == "" {
				t.Fatal("the minted code must be consumable once")
			}
			if webExchangeStore.consume(code) != "" {
				t.Error("the code must be single-use")
			}
			rec, err := app.FindRecordById("tenants", tenantID)
			if err != nil {
				t.Fatalf("the code must name a real tenant: %v", err)
			}
			if rec.GetString("email") != "owner@example.com" {
				t.Errorf("tenant email = %q", rec.GetString("email"))
			}
			if !rec.GetBool("email_verified") {
				t.Error("a provider-verified signup must be email_verified")
			}
			if rows := identityRows(t.(*testing.T), app, providerGoogle, "1234567890"); len(rows) != 1 {
				t.Errorf("identity rows = %d, want 1", len(rows))
			}
		},
	})
}

func TestOAuthCallbackRefusesAnUnverifiedEmail(t *testing.T) {
	t.Setenv("OZ_GOOGLE_CLIENT_ID", "client-abc")
	t.Setenv("OZ_GOOGLE_CLIENT_SECRET", "secret")
	claims := validClaims("client-abc")
	claims["email_verified"] = false
	restore := fakeGoogleToken(t, claims)
	defer restore()

	state, verifier, _, err := newOAuthState()
	if err != nil {
		t.Fatalf("newOAuthState: %v", err)
	}
	runScenario(t, &tests.ApiScenario{
		Method:  "GET",
		URL:     "/api/v1/web/oauth/google/callback?state=" + state + "&code=auth-code",
		Headers: map[string]string{"Cookie": oauthStateCookie + "=" + state},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			googleOAuthState.put(state, &oauthPending{next: "/en/pricing", verifier: verifier, expiresAt: time.Now().Add(time.Minute)})
		},
		ExpectedStatus:  http.StatusForbidden,
		ExpectedContent: []string{"not verified with Google"},
	})
}

// ── small helpers ──────────────────────────────────────────────────

func queryParam(t testing.TB, rawURL, name string) string {
	t.Helper()
	u, err := url.Parse(rawURL)
	if err != nil {
		t.Fatalf("could not parse %q: %v", rawURL, err)
	}
	return u.Query().Get(name)
}

func findCookie(res *http.Response, name string) *http.Cookie {
	for _, cookie := range res.Cookies() {
		if cookie.Name == name {
			return cookie
		}
	}
	return nil
}
