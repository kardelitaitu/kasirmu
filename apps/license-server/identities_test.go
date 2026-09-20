// Tests for federated identity linking (ADR #54 §2.3).
//
// The matrix is the security surface: each case here is a rule whose violation
// either hands an account to the wrong person or locks out the right one.
package main

import (
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func newIdentityApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("failed to create test app: %v", err)
	}
	t.Cleanup(app.Cleanup)
	if err := ensureCollections(app); err != nil {
		t.Fatalf("ensureCollections: %v", err)
	}
	if err := ensureTenantIdentitiesCollection(app); err != nil {
		t.Fatalf("ensureTenantIdentitiesCollection: %v", err)
	}
	return app
}

func identityRows(t *testing.T, app *tests.TestApp, provider, subject string) []*core.Record {
	t.Helper()
	rows, err := app.FindRecordsByFilter("tenant_identities",
		"provider = {:p} && subject = {:s}", "", 0, 0,
		map[string]any{"p": provider, "s": subject})
	if err != nil {
		t.Fatalf("identity lookup: %v", err)
	}
	return rows
}

func tenantByEmail(t *testing.T, app *tests.TestApp, email string) *core.Record {
	t.Helper()
	rec, err := app.FindFirstRecordByData("tenants", "email", email)
	if err != nil {
		return nil
	}
	return rec
}

func TestEnsureTenantIdentitiesCollectionIsIdempotent(t *testing.T) {
	app := newIdentityApp(t)
	coll, err := app.FindCollectionByNameOrId("tenant_identities")
	if err != nil {
		t.Fatalf("collection should exist: %v", err)
	}
	if coll.ListRule != nil || coll.CreateRule != nil || coll.UpdateRule != nil {
		t.Error("rules must be nil (superuser-only); an empty string would be public guest access")
	}
	if joined := strings.Join(coll.Indexes, " "); !strings.Contains(joined, "idx_tenant_identities_subject") {
		t.Errorf("the (provider, subject) unique index is missing: %v", coll.Indexes)
	}
	if err := ensureTenantIdentitiesCollection(app); err != nil {
		t.Fatalf("a second ensure must be a no-op: %v", err)
	}
}

func TestResolveIdentityCreatesAndLinksANewAccount(t *testing.T) {
	app := newIdentityApp(t)
	tenant, outcome, err := resolveIdentity(app, providerGoogle, "sub-new", "New.User@Example.com", true, "")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if outcome != IdentityCreated {
		t.Fatalf("outcome = %s, want created", outcome)
	}
	if !tenant.GetBool("email_verified") {
		t.Error("the provider proved the mailbox, so email_verified must be true")
	}
	if tenant.GetString("status") != "active" {
		t.Errorf("status = %q, want active", tenant.GetString("status"))
	}
	if tenantByEmail(t, app, "new.user@example.com") == nil {
		t.Error("the account email must be normalised, like every other door")
	}
	rows := identityRows(t, app, providerGoogle, "sub-new")
	if len(rows) != 1 {
		t.Fatalf("identity rows = %d, want 1", len(rows))
	}
	if rows[0].GetString("tenant") != tenant.Id {
		t.Error("the identity must point at the created tenant")
	}
	if rows[0].GetString("email_at_provider") != "new.user@example.com" {
		t.Errorf("email_at_provider = %q", rows[0].GetString("email_at_provider"))
	}
}

func TestResolveIdentityIsIdempotentForABoundSubject(t *testing.T) {
	app := newIdentityApp(t)
	first, outcome, err := resolveIdentity(app, providerGoogle, "sub-idem", "idem@example.com", true, "")
	if err != nil || outcome != IdentityCreated {
		t.Fatalf("setup: %v %s", err, outcome)
	}
	second, outcome2, err := resolveIdentity(app, providerGoogle, "sub-idem", "idem@example.com", true, "")
	if err != nil {
		t.Fatalf("second resolve: %v", err)
	}
	if outcome2 != IdentityBound {
		t.Fatalf("outcome = %s, want bound", outcome2)
	}
	if second.Id != first.Id {
		t.Error("a second sign-in must land in the same tenant")
	}
	if rows := identityRows(t, app, providerGoogle, "sub-idem"); len(rows) != 1 {
		t.Errorf("identity rows = %d, want exactly 1", len(rows))
	}
}

func TestResolveIdentityLinksAnExistingTenantAndFlipsEmailVerified(t *testing.T) {
	app := newIdentityApp(t)
	tenant, err := createTenant(app, "existing@example.com", "")
	if err != nil {
		t.Fatalf("createTenant: %v", err)
	}
	if tenant.GetBool("email_verified") {
		t.Fatal("precondition: a fresh tenant is not verified")
	}
	linked, outcome, err := resolveIdentity(app, providerGoogle, "sub-link", "existing@example.com", true, "")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if outcome != IdentityLinked {
		t.Fatalf("outcome = %s, want linked", outcome)
	}
	if linked.Id != tenant.Id {
		t.Error("must link to the email-matched tenant, not create a second account")
	}
	refetched, err := app.FindRecordById("tenants", tenant.Id)
	if err != nil {
		t.Fatalf("refetch: %v", err)
	}
	if !refetched.GetBool("email_verified") {
		t.Error("linking a provider-verified email must flip email_verified")
	}
}

func TestResolveIdentityRefusesAReservedAdminEmailBeforeLinking(t *testing.T) {
	t.Setenv("OZ_ADMIN_EMAIL", "operator@example.com")
	app := newIdentityApp(t)
	if _, err := createTenantForEmail(app, "operator@example.com"); err == nil {
		t.Fatal("precondition: creation must already refuse the reserved address")
	}
	// Case variants must not slip past: the reservation compares normalized.
	tenant, outcome, err := resolveIdentity(app, providerGoogle, "sub-admin", "OPERATOR@example.com", true, "")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if outcome != IdentityRefusedReserved {
		t.Fatalf("outcome = %s, want refused_reserved", outcome)
	}
	if tenant != nil {
		t.Error("a reserved address must not resolve to a tenant")
	}
	if rows := identityRows(t, app, providerGoogle, "sub-admin"); len(rows) != 0 {
		t.Error("no identity may be linked to a reserved address")
	}
	if tenantByEmail(t, app, "operator@example.com") != nil {
		t.Error("no tenant row may be created for a reserved address")
	}
}

func TestResolveIdentityRefusesAnUnverifiedAddress(t *testing.T) {
	app := newIdentityApp(t)
	tenant, outcome, err := resolveIdentity(app, providerGoogle, "sub-unverified", "unverified@example.com", false, "")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if outcome != IdentityRefusedUnverified {
		t.Fatalf("outcome = %s, want refused_unverified", outcome)
	}
	if tenant != nil {
		t.Error("no tenant for an unproven address")
	}
	if tenantByEmail(t, app, "unverified@example.com") != nil {
		t.Error("an unproven address must not create an account")
	}
	if rows := identityRows(t, app, providerGoogle, "sub-unverified"); len(rows) != 0 {
		t.Error("an unproven address must not link")
	}
}

func TestResolveIdentityRefusesReservedEvenWhenUnverified(t *testing.T) {
	// Ordering guard: the reservation is checked before the verification gate, so
	// the more specific refusal is the one a caller observes.
	t.Setenv("OZ_ADMIN_EMAIL", "operator2@example.com")
	app := newIdentityApp(t)
	_, outcome, err := resolveIdentity(app, providerGoogle, "sub-both", "operator2@example.com", false, "")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if outcome != IdentityRefusedReserved {
		t.Fatalf("outcome = %s, want refused_reserved", outcome)
	}
}

func TestResolveIdentityConflictsWhenBoundToAnotherTenant(t *testing.T) {
	app := newIdentityApp(t)
	owner, outcome, err := resolveIdentity(app, providerGoogle, "sub-conflict", "owner@example.com", true, "")
	if err != nil || outcome != IdentityCreated {
		t.Fatalf("setup: %v %s", err, outcome)
	}
	other, err := createTenantForEmail(app, "other@example.com")
	if err != nil {
		t.Fatalf("setup tenant: %v", err)
	}
	if other.Id == owner.Id {
		t.Fatal("setup: the two tenants must differ")
	}
	tenant, outcome2, err := resolveIdentity(app, providerGoogle, "sub-conflict", "owner@example.com", true, other.Id)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if outcome2 != IdentityConflict {
		t.Fatalf("outcome = %s, want conflict", outcome2)
	}
	if tenant != nil {
		t.Error("a conflict must not return a tenant")
	}
	rows := identityRows(t, app, providerGoogle, "sub-conflict")
	if len(rows) != 1 || rows[0].GetString("tenant") != owner.Id {
		t.Error("a conflict must never rebind the identity")
	}
}

func TestResolveIdentityRefreshesTheLastSignInStamp(t *testing.T) {
	app := newIdentityApp(t)
	if _, outcome, err := resolveIdentity(app, providerGoogle, "sub-touch", "touch@example.com", true, ""); err != nil || outcome != IdentityCreated {
		t.Fatalf("setup: %v %s", err, outcome)
	}
	rows := identityRows(t, app, providerGoogle, "sub-touch")
	if len(rows) != 1 || rows[0].GetString("last_login") == "" {
		t.Fatal("the first link must stamp last_login")
	}
	first := rows[0].GetString("last_login")

	// A re-sign-in is not a no-op: a stale stamp misreports when the identity was last
	// used, which is the value an operator reads while investigating an incident.
	time.Sleep(50 * time.Millisecond)
	if _, outcome, err := resolveIdentity(app, providerGoogle, "sub-touch", "touch@example.com", true, ""); err != nil || outcome != IdentityBound {
		t.Fatalf("re-sign-in: %v %s", err, outcome)
	}
	after := identityRows(t, app, providerGoogle, "sub-touch")[0].GetString("last_login")
	if after == first {
		t.Errorf("last_login must advance on a re-sign-in, still %q", first)
	}
}

func TestResolveIdentityDevicePathRequiresTheTenantsOwnEmail(t *testing.T) {
	app := newIdentityApp(t)
	device, err := createTenantForEmail(app, "shop@example.com")
	if err != nil {
		t.Fatalf("setup tenant: %v", err)
	}
	// A personal Google account is refused: otherwise two minutes of physical
	// access would attach an identity to the shop's tenant and keep access.
	if _, outcome, resolveErr := resolveIdentity(app, providerGoogle, "sub-personal", "personal@example.com", true, device.Id); resolveErr != nil {
		t.Fatalf("resolve: %v", resolveErr)
	} else if outcome != IdentityRefusedMismatch {
		t.Fatalf("outcome = %s, want refused_mismatch", outcome)
	}
	tenant, outcome, err := resolveIdentity(app, providerGoogle, "sub-shop", "shop@example.com", true, device.Id)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if outcome != IdentityLinked {
		t.Fatalf("outcome = %s, want linked", outcome)
	}
	if tenant.Id != device.Id {
		t.Error("must link to the device-claimed tenant")
	}
}
