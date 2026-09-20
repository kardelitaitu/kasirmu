package main

// Tests for the linked sign-in methods endpoints (ADR #54).
//
// The properties under test are authorisation, not plumbing: the tenant comes from
// the session, a foreign id is indistinguishable from an unknown one, and unlinking
// your own is allowed because the email remains the root credential.

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/tests"
)

// linkTestIdentity records an identity exactly as the OAuth callback would.
func linkTestIdentity(t *testing.T, app *tests.TestApp, tenantID, subject, email string) string {
	t.Helper()
	if err := ensureTenantIdentitiesCollection(app); err != nil {
		t.Fatalf("ensureTenantIdentitiesCollection: %v", err)
	}
	record, err := linkIdentity(app, tenantID, providerGoogle, subject, email)
	if err != nil {
		t.Fatalf("linkIdentity: %v", err)
	}
	return record.Id
}

// identitiesFrom unwraps the list response.
func identitiesFrom(t *testing.T, body []byte) []map[string]any {
	t.Helper()
	var parsed struct {
		Identities []map[string]any `json:"identities"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	return parsed.Identities
}

func TestWebIdentitiesRequiresASession(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()

	rec := doJSON(mux, http.MethodGet, "/api/v1/web/identities", "", "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without a session, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestWebIdentitiesListsOnlyTheSessionsTenant(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	mine, token := seedDashboardTenant(t, app, "mine@test.com")
	// Only the session tenant gets a token: seedDashboardTenant issues a FIXED
	// token string, so a second call would re-point the first session at it.
	theirs, err := createTenantForEmail(app, "theirs@test.com")
	if err != nil {
		t.Fatalf("seed other tenant: %v", err)
	}
	mineID := linkTestIdentity(t, app, mine, "sub-mine", "mine@test.com")
	theirsID := linkTestIdentity(t, app, theirs.Id, "sub-theirs", "theirs@test.com")

	rec := doJSON(mux, http.MethodGet, "/api/v1/web/identities", "Bearer "+token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	rows := identitiesFrom(t, rec.Body.Bytes())
	if len(rows) != 1 {
		t.Fatalf("expected exactly one identity for this tenant, got %d", len(rows))
	}
	if rows[0]["id"] != mineID {
		t.Errorf("id = %v, want %v", rows[0]["id"], mineID)
	}
	if rows[0]["provider"] != providerGoogle {
		t.Errorf("provider = %v", rows[0]["provider"])
	}
	if rows[0]["email"] != "mine@test.com" {
		t.Errorf("email = %v, want the provider address", rows[0]["email"])
	}
	for _, row := range rows {
		if row["id"] == theirsID {
			t.Error("another tenant's identity must never appear")
		}
	}
}

func TestWebUnlinkRefusesAnotherTenantsIdentity(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	_, token := seedDashboardTenant(t, app, "mine2@test.com")
	theirs, err := createTenantForEmail(app, "theirs2@test.com")
	if err != nil {
		t.Fatalf("seed other tenant: %v", err)
	}
	theirsID := linkTestIdentity(t, app, theirs.Id, "sub-theirs-2", "theirs2@test.com")

	rec := doJSON(mux, http.MethodDelete, "/api/v1/web/identities/"+theirsID, "Bearer "+token, "")
	// 404 rather than 403 on purpose: a distinguishable refusal would let a caller
	// probe which identity ids exist.
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for a foreign identity, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := app.FindRecordById(identityCollection, theirsID); err != nil {
		t.Error("the other tenant's identity must survive the attempt")
	}
}

func TestWebUnlinkRemovesTheSessionsOwnIdentity(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	mine, token := seedDashboardTenant(t, app, "mine3@test.com")
	id := linkTestIdentity(t, app, mine, "sub-mine-3", "mine3@test.com")

	rec := doJSON(mux, http.MethodDelete, "/api/v1/web/identities/"+id, "Bearer "+token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := app.FindRecordById(identityCollection, id); err == nil {
		t.Error("the identity row must be gone")
	}
	// The account stays usable: the email is the root credential, which is exactly
	// why no last-credential guard exists here.
	list := doJSON(mux, http.MethodGet, "/api/v1/web/identities", "Bearer "+token, "")
	if got := identitiesFrom(t, list.Body.Bytes()); len(got) != 0 {
		t.Errorf("expected no identities after unlinking, got %d", len(got))
	}
}

func TestWebUnlinkUnknownIdIs404(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	_, token := seedDashboardTenant(t, app, "mine4@test.com")

	rec := doJSON(mux, http.MethodDelete, "/api/v1/web/identities/nosuchidentityid", "Bearer "+token, "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestWebUnlinkRequiresASession(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	mine, _ := seedDashboardTenant(t, app, "mine5@test.com")
	id := linkTestIdentity(t, app, mine, "sub-mine-5", "mine5@test.com")

	rec := doJSON(mux, http.MethodDelete, "/api/v1/web/identities/"+id, "", "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := app.FindRecordById(identityCollection, id); err != nil {
		t.Error("an unauthenticated call must not delete anything")
	}
}
