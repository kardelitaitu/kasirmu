package main

// The auth-semantics tests for the SESSION half of the admin gate.
//
// adminAuth (admin_dashboard.go:64) admits a caller two ways: the
// Authorization: Bearer <OZ_ADMIN_KEY> secret (adminKeyOK) or a web session
// bound to the tenant whose email is OZ_ADMIN_EMAIL. Every pre-existing admin
// test in this package authenticates with "Bearer secret-admin-key", which
// returns from adminKeyOK on the first lines of adminAuth and never reaches the
// second half - the token -> webOtpStore -> tenant lookup -> admin-email
// comparison at admin_dashboard.go:69-97. That entire branch was exercised by
// nothing, so the auth-semantics changes queued behind an operator action would
// land unguarded.
//
// These tests drive the admin routes with a REAL session minted the way the
// login handlers mint one (webOtpStore.createSession(hashWebToken(tok),
// tenantId), web_otp.go:357 - the same store call the delete-path test at
// admin_lifecycle_test.go:398 makes) while pinning OZ_ADMIN_KEY to the empty
// string, so adminKeyOK can never be what let a request through.
//
// Written against TODAY's behaviour, with the intent marked. The tree is
// mid-repair:
//
//   - admin_tenant_lifecycle.go is getting a fail-closed guard resolver for
//     admin-tenant identification (dispatch in flight).
//   - web_otp.go is getting a reserved-address gate in createTenant so the
//     operator address cannot be registered as an ordinary tenant (dispatch in
//     flight).
//   - a later parked wave changes what an UNSET OZ_ADMIN_EMAIL does. Today a
//     blank env silently falls back to defaultAdminEmail
//     (password_rotation.go:42) - the gate is not closed, it is anchored to a
//     literal address in the binary. Nothing here asserts that a blank env
//     grants admin to anyone, so this file stays green when that fallback goes
//     away.
//
// Where today's answer is the thing intended to change, the case asserts a
// ONE-WAY property (requireGateDecision / requireDenied): it can only go red if
// the gate gets looser or produces a non-decision, never because a stricter
// guard landed.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

const (
	// adminSessionPathEmail is the OZ_ADMIN_EMAIL the cases that set it use.
	// Deliberately NOT defaultAdminEmail, so no case can accidentally pass by
	// hitting the blank-env fallback.
	adminSessionPathEmail = "session-path-admin@test.com"

	// adminStatsPath and adminTenantsPath are the admin routes these cases
	// drive: a read surface and a destructive one.
	adminStatsPath   = "/api/v1/admin/stats"
	adminTenantsPath = "/api/v1/admin/tenants/"

	// noAdminKey pins the bearer secret empty. adminKeyOK (admin_dashboard.go:53)
	// returns false on an empty expected value, so every grant below is the
	// session branch - and an ambient OZ_ADMIN_KEY on a developer machine cannot
	// quietly become the authenticator.
	noAdminKey = ""
)

// adminSessionFixture is a seeded tenant plus the raw bearer token of the web
// session minted for it.
type adminSessionFixture struct {
	id    string
	email string
	token string
}

// adminSessionTokenSeq keeps tokens unique across the whole binary run: the
// session store is a package global (web_otp.go:83) shared by every test in
// this package, so tenant ids alone are not enough.
var adminSessionTokenSeq int

// seedAdminSessionTenant creates a tenant with the given email + verification
// state and mints a real web session for it - the same store write
// handleVerifyOTP / handleLoginPassword perform, so the route under test cannot
// tell this from a browser that signed in.
func seedAdminSessionTenant(t *testing.T, app core.App, email string, verified bool) adminSessionFixture {
	t.Helper()

	col, err := app.FindCollectionByNameOrId("tenants")
	if err != nil {
		t.Fatalf("tenants collection: %v", err)
	}
	tenant := core.NewRecord(col)
	tenant.Set("email", email)
	tenant.Set("api_key", "key-"+email)
	tenant.Set("api_key_lookup", apiKeyLookup("key-"+email))
	tenant.Set("status", "active")
	tenant.Set("email_verified", verified)
	if err := app.Save(tenant); err != nil {
		t.Fatalf("save tenant %q: %v", email, err)
	}

	adminSessionTokenSeq++
	token := fmt.Sprintf("admin-session-token-%d-%s", adminSessionTokenSeq, tenant.Id)
	webOtpStore.createSession(hashWebToken(token), tenant.Id)
	if got := webOtpStore.getSession(hashWebToken(token)); got != tenant.Id {
		t.Fatalf("precondition: session should resolve to %s, got %q", tenant.Id, got)
	}
	return adminSessionFixture{id: tenant.Id, email: email, token: token}
}

// setTenantVerified flips email_verified on a seeded tenant, so one identity can
// be compared against the gate in both verification states.
func setTenantVerified(t *testing.T, app core.App, id string, verified bool) {
	t.Helper()
	rec, err := app.FindRecordById("tenants", id)
	if err != nil {
		t.Fatalf("reload tenant %s: %v", id, err)
	}
	rec.Set("email_verified", verified)
	if err := app.Save(rec); err != nil {
		t.Fatalf("flip email_verified on %s: %v", id, err)
	}
}

// tenantExists is the side-effect half of the decision-consistency checks: a
// denial must not have deleted anything, a success must have.
func tenantExists(app core.App, id string) bool {
	rec, err := app.FindRecordById("tenants", id)
	return err == nil && rec != nil
}

// stubFxForAdminSessionTests keeps /api/v1/admin/stats off the network. The
// handler calls getFxRate (admin_stats.go:269); fxFetcher is the package seam
// and the cache is restored on cleanup so no case here depends on the upstream.
func stubFxForAdminSessionTests(t *testing.T) {
	t.Helper()

	origFetcher, origCache := fxFetcher, fxCache
	fxFetcher = func() (float64, bool) { return 16000, false }
	fxCacheMu.Lock()
	fxCache = nil
	fxCacheMu.Unlock()

	t.Cleanup(func() {
		fxFetcher = origFetcher
		fxCacheMu.Lock()
		fxCache = origCache
		fxCacheMu.Unlock()
	})
}

// adminSessionServed reports whether the response is the admin dashboard payload
// rather than an error envelope - i.e. whether admin data actually crossed the
// gate.
func adminSessionServed(rec *httptest.ResponseRecorder) bool {
	var body struct {
		KPIs map[string]any `json:"kpis"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		return false
	}
	return body.KPIs != nil
}

// requireDenied asserts the response is a real authentication/authorization
// refusal. 401 is accepted next to 403 on purpose: a fail-closed guard is
// allowed to refuse BEFORE the session is resolved, and this file must not need
// editing when it lands. What it refuses to accept is admin data reaching the
// caller, and a silent non-decision.
func requireDenied(t *testing.T, label string, rec *httptest.ResponseRecorder) {
	t.Helper()

	if rec.Code >= 200 && rec.Code < 300 {
		t.Fatalf("%s: admin data served to a session that is not the admin tenant (status %d): %s",
			label, rec.Code, rec.Body.String())
	}
	if rec.Code != http.StatusUnauthorized && rec.Code != http.StatusForbidden {
		t.Fatalf("%s: expected a 401/403 denial, got %d: %s",
			label, rec.Code, rec.Body.String())
	}
	if adminSessionServed(rec) {
		t.Errorf("%s: denial response still carries the admin kpis payload", label)
	}
}

// requireGateDecision is the one-way assertion used where TODAY's behaviour is
// the thing we intend to change: the gate must produce a decision - 2xx, 401 or
// 403 - and never a 5xx, a 404 (route gone), or an empty non-response. adminAuth
// has a live branch that returns false WITHOUT writing anything
// (admin_dashboard.go:83-85, a session whose tenant row is gone), so "the gate
// answered with a status" is a real property, not a tautology. It cannot regress
// when the guard lands: it goes red only for a defect, and it logs which way the
// gate moved so a flip is visible in the run.
func requireGateDecision(t *testing.T, label, method string, rec *httptest.ResponseRecorder) bool {
	t.Helper()

	switch {
	case rec.Code >= 200 && rec.Code < 300:
		t.Logf("%s: GRANTED (%d) - today's permissive behaviour; the queued guard is expected to flip this to a denial, which stays green",
			label, rec.Code)
		if method == http.MethodGet && !adminSessionServed(rec) {
			t.Errorf("%s: 200 on an admin GET without an admin payload: %s", label, rec.Body.String())
		}
		return true
	case rec.Code == http.StatusUnauthorized, rec.Code == http.StatusForbidden:
		t.Logf("%s: DENIED (%d) - the stricter outcome; this case was written to survive it: %s",
			label, rec.Code, strings.TrimSpace(rec.Body.String()))
		return false
	default:
		t.Fatalf("%s: gate produced %d, which is neither a grant nor a denial: %s",
			label, rec.Code, rec.Body.String())
		return false
	}
}

// ── The missing class: an authenticated web session on an admin route ──

// TestAdminWebSessionDrivesAdminRoutesWithoutAdminKey is the case the suite never
// had: an operator signed in from the browser (no bearer secret anywhere in the
// request) reaching the admin surface through adminAuth's session branch. Before
// this file, nothing in the package proved that branch works - or that it is what
// served a 200.
func TestAdminWebSessionDrivesAdminRoutesWithoutAdminKey(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	stubFxForAdminSessionTests(t)

	t.Setenv("OZ_ADMIN_KEY", noAdminKey)
	t.Setenv("OZ_ADMIN_EMAIL", adminSessionPathEmail)

	admin := seedAdminSessionTenant(t, app, adminSessionPathEmail, true)

	// Read surface: the session branch must serve the admin payload.
	rec := doJSON(mux, http.MethodGet, adminStatsPath, "Bearer "+admin.token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("admin session rejected by the stats route: got %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if !adminSessionServed(rec) {
		t.Fatalf("200 but not the admin payload: %s", rec.Body.String())
	}

	// Control that makes the 200 mean something: a bearer token that is not in
	// the session store gets 401. So the grant above came from webOtpStore, not
	// from a leaked admin key or a route that forgot to check.
	rec = doJSON(mux, http.MethodGet, adminStatsPath, "Bearer not-a-session-anywhere", "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unknown bearer token: got %d, want 401: %s", rec.Code, rec.Body.String())
	}
	if adminSessionServed(rec) {
		t.Error("unknown token response leaks admin kpis")
	}

	// Write surface, denied by the lifecycle guard rather than by the gate: the
	// admin tenant is undeletable (deleting it would lock every admin session
	// out). Reaching 403 here - not 401 - proves the request passed adminAuth on
	// a session alone and that the guard behind it still fires.
	rec = doJSON(mux, http.MethodDelete, adminTenantsPath+admin.id, "Bearer "+admin.token,
		`{"confirm_email":"`+adminSessionPathEmail+`","reason":"session path probe"}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("delete of the admin tenant itself: got %d, want 403: %s", rec.Code, rec.Body.String())
	}
	if !tenantExists(app, admin.id) {
		t.Fatal("the admin tenant must survive an attempted delete")
	}

	// Write surface, the ordinary call. Pinned as decision + side-effect
	// consistency rather than as a 200: if the queued hardening decides a
	// session-authed caller may not delete tenants at all, that is stricter and
	// this stays green - but either way the status and the database may not
	// disagree.
	sacrifice := seedAdminSessionTenant(t, app, "sacrifice-session-path@test.com", true)
	rec = doJSON(mux, http.MethodDelete, adminTenantsPath+sacrifice.id, "Bearer "+admin.token,
		`{"confirm_email":"sacrifice-session-path@test.com","reason":"session path probe"}`)
	granted := requireGateDecision(t, "session delete of an ordinary tenant", http.MethodDelete, rec)
	stillThere := tenantExists(app, sacrifice.id)
	if granted == stillThere {
		t.Errorf("delete decision and side effect disagree: status %d (granted=%v), tenant still present=%v: %s",
			rec.Code, granted, stillThere, rec.Body.String())
	}
}

// ── The four negatives ───────────────────────────────────────────────

// TestAdminWebSessionNegativeUnverifiedAdminTenantIsNoStrongerThanVerified is
// negative case 1.
//
// FINDING (the session branch ignores email verification): adminAuth never reads
// email_verified, so a tenant record seeded - or imported - with the admin
// address and a FALSE verification flag authenticates as admin today. The login
// paths DO gate on it (verify-otp flips it at web_otp.go:769) and the
// reserved-address createTenant gate landing in web_otp.go is the intended
// direction: the admin address must not be reachable as an unverified ordinary
// account.
//
// So this case deliberately does NOT contract today's 200. It pins the one-way
// property: an unverified admin account may never be served where the same
// account verified is refused, and neither call may return a non-decision.
// Flipping the unverified leg to a denial is the fix and stays green here.
func TestAdminWebSessionNegativeUnverifiedAdminTenantIsNoStrongerThanVerified(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	stubFxForAdminSessionTests(t)

	t.Setenv("OZ_ADMIN_KEY", noAdminKey)
	t.Setenv("OZ_ADMIN_EMAIL", adminSessionPathEmail)

	admin := seedAdminSessionTenant(t, app, adminSessionPathEmail, false) // email_verified = false

	unverified := requireGateDecision(t, "GET /admin/stats, admin tenant email_verified=false", http.MethodGet,
		doJSON(mux, http.MethodGet, adminStatsPath, "Bearer "+admin.token, ""))

	// The same identity, the same token, the verification flag switched on.
	setTenantVerified(t, app, admin.id, true)
	verified := requireGateDecision(t, "GET /admin/stats, admin tenant email_verified=true", http.MethodGet,
		doJSON(mux, http.MethodGet, adminStatsPath, "Bearer "+admin.token, ""))

	if unverified && !verified {
		t.Error("email_verified=false is served while email_verified=true is refused - the verification check is inverted")
	}
	if verified {
		t.Log("control holds: the verified admin session is still granted, so only the unverified leg may tighten")
	}
}

// TestAdminWebSessionNegativeBlankAdminEmailEnvDoesNotAdmitAnyTenant is negative
// case 2.
//
// t.Setenv(key, "") is the unset case exactly as the gate sees it: adminAuth
// reads the value with os.Getenv (admin_dashboard.go:87) and nil and "" take the
// same branch.
//
// FINDING (a blank env is not a closed gate): the fallback is the literal
// defaultAdminEmail from password_rotation.go:42, so "unset" today still
// authenticates one address - whichever tenant happens to carry it. The parked
// wave changes exactly that, and this file takes no position on the outcome: it
// never asserts that a blank env grants admin, and never seeds a tenant at
// defaultAdminEmail for a blank-env request.
//
// What it does pin is the half that holds in both worlds: a blank env must not
// turn an ordinary tenant's session into an admin session. Today's answer is 403
// (that email is not the fallback address); under a fail-closed resolver it is
// 401 or 403. All three are green; admin data escaping is not.
func TestAdminWebSessionNegativeBlankAdminEmailEnvDoesNotAdmitAnyTenant(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	stubFxForAdminSessionTests(t)

	t.Setenv("OZ_ADMIN_KEY", noAdminKey)
	t.Setenv("OZ_ADMIN_EMAIL", "") // unset as far as os.Getenv is concerned

	ordinary := seedAdminSessionTenant(t, app, "blank-env-ordinary@test.com", true)

	requireDenied(t, "GET /admin/stats with OZ_ADMIN_EMAIL unset",
		doJSON(mux, http.MethodGet, adminStatsPath, "Bearer "+ordinary.token, ""))
	requireDenied(t, "DELETE /admin/tenants/{id} with OZ_ADMIN_EMAIL unset",
		doJSON(mux, http.MethodDelete, adminTenantsPath+ordinary.id, "Bearer "+ordinary.token,
			`{"confirm_email":"blank-env-ordinary@test.com","reason":"blank env probe"}`))
	if !tenantExists(app, ordinary.id) {
		t.Error("a request refused with a blank OZ_ADMIN_EMAIL must not have deleted the tenant")
	}
}

// TestAdminWebSessionNegativeNonAdminTenantSessionIsRefused is negative case 3:
// the gate's own 403 branch (admin_dashboard.go:94, "account is not an admin"),
// reached with a real signed-in customer on both a read and a write admin route.
//
// Fully pinnable - this is already the strict answer, so it is asserted as a
// denial rather than as a one-way property, and it pins the leak half too: a
// refusal must not be a 200-with-admin-data wearing a denial status.
func TestAdminWebSessionNegativeNonAdminTenantSessionIsRefused(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	stubFxForAdminSessionTests(t)

	t.Setenv("OZ_ADMIN_KEY", noAdminKey)
	t.Setenv("OZ_ADMIN_EMAIL", adminSessionPathEmail)

	seedAdminSessionTenant(t, app, adminSessionPathEmail, true) // the admin account exists...
	customer := seedAdminSessionTenant(t, app, "not-an-admin@test.com", true)
	victim := seedAdminSessionTenant(t, app, "other-tenant@test.com", true)

	requireDenied(t, "GET /admin/stats, non-admin session",
		doJSON(mux, http.MethodGet, adminStatsPath, "Bearer "+customer.token, ""))
	requireDenied(t, "GET /admin/tenants/{id}, non-admin session",
		doJSON(mux, http.MethodGet, adminTenantsPath+victim.id, "Bearer "+customer.token, ""))
	requireDenied(t, "DELETE /admin/tenants/{id}, non-admin session",
		doJSON(mux, http.MethodDelete, adminTenantsPath+victim.id, "Bearer "+customer.token,
			`{"confirm_email":"other-tenant@test.com","reason":"should not be allowed"}`))
	if !tenantExists(app, victim.id) {
		t.Error("a refused session-authed delete must leave the victim tenant in place")
	}
}

// TestAdminWebSessionNegativeAdminEmailCaseAndWhitespaceDivergence is negative
// case 4, and the one that pins a divergence rather than a verdict.
//
// FINDING (the gate normalizes only one side): admin_dashboard.go:87 trims the
// ENV value and then compares with strings.EqualFold, so the env side gets both
// TrimSpace and case-folding while the STORED side gets case-folding only. The
// account-identity path normalizes both sides - normalizeEmail (web_otp.go:856)
// lowercases AND trims, and every web login / register / reset handler runs its
// input through it before looking the tenant up. Two readers of the same
// address, two notions of identity. password_rotation.go:176 is a third notion:
// it reads OZ_ADMIN_EMAIL with no TrimSpace at all. The fail-closed guard
// resolver landing in admin_tenant_lifecycle.go is where that gets decided.
//
// So no verdict is contracted for either variant - each leg may lawfully go
// either way once the guard lands (the case leg today grants; the whitespace leg
// today cannot even be stored) - but both legs must produce a real decision and
// must never be able to delete the admin account.
func TestAdminWebSessionNegativeAdminEmailCaseAndWhitespaceDivergence(t *testing.T) {
	t.Run("StoredAdminEmailDiffersOnlyByCase", func(t *testing.T) {
		app, mux := dashboardMux(t)
		defer app.Cleanup()
		stubFxForAdminSessionTests(t)

		t.Setenv("OZ_ADMIN_KEY", noAdminKey)
		t.Setenv("OZ_ADMIN_EMAIL", adminSessionPathEmail)

		// Same address, different case. EqualFold admits it today; a byte-exact
		// resolver would not. Both readings are green here.
		padded := strings.ToUpper(adminSessionPathEmail[:4]) + adminSessionPathEmail[4:]
		admin := seedAdminSessionTenant(t, app, padded, true)

		granted := requireGateDecision(t, "GET /admin/stats, admin email stored in a different case", http.MethodGet,
			doJSON(mux, http.MethodGet, adminStatsPath, "Bearer "+admin.token, ""))

		// Whichever way the identity comparison goes, the admin account is
		// undeletable: 401/403 must hold under both readings (refused at the
		// gate, or admitted and then refused by the lifecycle guard). It may
		// never be 200 - that is the property the parked guard must not break.
		rec := doJSON(mux, http.MethodDelete, adminTenantsPath+admin.id, "Bearer "+admin.token,
			`{"confirm_email":"`+padded+`","reason":"case divergence probe"}`)
		if rec.Code >= 200 && rec.Code < 300 {
			t.Errorf("the admin tenant was deleted through a case-variant session (status %d)", rec.Code)
		}
		if !tenantExists(app, admin.id) {
			t.Error("the admin tenant must survive a case-variant delete attempt")
		}
		if granted {
			t.Log("today: EqualFold folds case, so a differently-cased admin email IS the admin (the login path would instead normalize it to the stored lowercase form)")
		}
	})

	t.Run("AdminEmailDiffersOnlyBySurroundingWhitespace", func(t *testing.T) {
		app, mux := dashboardMux(t)
		defer app.Cleanup()
		stubFxForAdminSessionTests(t)

		// The env side carries the padding, which admin_dashboard.go:87 trims.
		t.Setenv("OZ_ADMIN_KEY", noAdminKey)
		t.Setenv("OZ_ADMIN_EMAIL", "  \t"+adminSessionPathEmail+"  ")

		admin := seedAdminSessionTenant(t, app, adminSessionPathEmail, true)
		requireGateDecision(t, "GET /admin/stats, OZ_ADMIN_EMAIL padded with whitespace", http.MethodGet,
			doJSON(mux, http.MethodGet, adminStatsPath, "Bearer "+admin.token, ""))

		// The mirror leg: can the STORED side even hold the padding? Today the
		// tenants.email field rejects it, which is why the one-sided TrimSpace
		// above is latent rather than exploitable. If this ever starts
		// succeeding the asymmetry became reachable and the guard resolver MUST
		// normalize both sides - so this half is asserted as a decision too,
		// never as "storage rejects it".
		col, err := app.FindCollectionByNameOrId("tenants")
		if err != nil {
			t.Fatalf("tenants collection: %v", err)
		}
		paddedRecord := core.NewRecord(col)
		paddedRecord.Set("email", "  "+adminSessionPathEmail+"-padded  ")
		paddedRecord.Set("api_key", "key-padded-session-path")
		paddedRecord.Set("api_key_lookup", apiKeyLookup("key-padded-session-path"))
		paddedRecord.Set("status", "active")
		paddedRecord.Set("email_verified", true)
		if saveErr := app.Save(paddedRecord); saveErr != nil {
			t.Logf("storage rejects a whitespace-padded tenants.email (%v) - the one-sided TrimSpace in admin_dashboard.go:87 is latent today", saveErr)
			return
		}
		adminSessionTokenSeq++
		paddedToken := fmt.Sprintf("admin-session-token-%d-padded", adminSessionTokenSeq)
		webOtpStore.createSession(hashWebToken(paddedToken), paddedRecord.Id)
		requireGateDecision(t, "GET /admin/stats, admin email STORED with surrounding whitespace", http.MethodGet,
			doJSON(mux, http.MethodGet, adminStatsPath, "Bearer "+paddedToken, ""))
	})
}
