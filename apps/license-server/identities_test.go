// Tests for federated identity linking (ADR #54 §2.3).
//
// The matrix is the security surface: each case here is a rule whose violation
// either hands an account to the wrong person or locks out the right one.
package main

import (
	"fmt"
	"net/http"
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

func TestResolveIdentityRecordsEveryOutcomeInTheAuditTrail(t *testing.T) {
	app := newIdentityApp(t)
	if err := ensureIdentityEventsCollection(app); err != nil {
		t.Fatalf("ensureIdentityEventsCollection: %v", err)
	}
	if err := ensureTenantIdentitiesCollection(app); err != nil {
		t.Fatalf("ensureTenantIdentitiesCollection: %v", err)
	}

	tenant, outcome, err := resolveIdentity(app, providerGoogle, "aud-1", "audit@example.com", true, "")
	if err != nil || outcome != IdentityCreated {
		t.Fatalf("setup: %v %s", err, outcome)
	}
	// A re-sign-in resolves to `bound` and must add its own row: an audit TRAIL records
	// attempts, so a second sign-in updating the first row would erase the history.
	if _, outcome, err = resolveIdentity(app, providerGoogle, "aud-1", "audit@example.com", true, ""); err != nil || outcome != IdentityBound {
		t.Fatalf("re-sign-in: %v %s", err, outcome)
	}
	if _, outcome, err = resolveIdentity(app, providerGoogle, "aud-2", "unverified@example.com", false, ""); err != nil || outcome != IdentityRefusedUnverified {
		t.Fatalf("unverified: %v %s", err, outcome)
	}
	if _, outcome, err = resolveIdentity(app, providerGoogle, "aud-3", "other@example.com", true, tenant.Id); err != nil || outcome != IdentityRefusedMismatch {
		t.Fatalf("mismatch: %v %s", err, outcome)
	}
	other, err := createTenantForEmail(app, "third@example.com")
	if err != nil {
		t.Fatalf("create other tenant: %v", err)
	}
	if _, outcome, err = resolveIdentity(app, providerGoogle, "aud-1", "audit@example.com", true, other.Id); err != nil || outcome != IdentityConflict {
		t.Fatalf("conflict: %v %s", err, outcome)
	}

	records, err := app.FindRecordsByFilter(identityEventCollection, "", "-created", 0, 0, nil)
	if err != nil {
		t.Fatalf("read the trail: %v", err)
	}
	byOutcome := map[string]*core.Record{}
	for _, row := range records {
		byOutcome[row.GetString("outcome")] = row
	}
	// One row per attempt, including the refusals — those are what an investigation looks for.
	if len(records) != 5 {
		t.Fatalf("expected one row per attempt, got %d", len(records))
	}
	for _, want := range []IdentityOutcome{
		IdentityCreated, IdentityBound, IdentityRefusedUnverified, IdentityRefusedMismatch, IdentityConflict,
	} {
		if byOutcome[string(want)] == nil {
			t.Errorf("no audit row for %s", want)
		}
	}
	if row := byOutcome[string(IdentityCreated)]; row != nil {
		if row.GetString("tenant") != tenant.Id {
			t.Errorf("the created row must name the tenant it made, got %q", row.GetString("tenant"))
		}
		if row.GetString("email_at_provider") != "audit@example.com" {
			t.Errorf("the row must carry the provider address, got %q", row.GetString("email_at_provider"))
		}
		if row.GetString("provider") != providerGoogle || row.GetString("subject") != "aud-1" {
			t.Errorf("the row must name the identity: %q %q", row.GetString("provider"), row.GetString("subject"))
		}
	}
	if row := byOutcome[string(IdentityRefusedUnverified)]; row != nil && row.GetString("tenant") != "" {
		t.Errorf("an unverified refusal has no tenant to name, got %q", row.GetString("tenant"))
	}
}

func TestResolveIdentitySurvivesAMissingAuditSink(t *testing.T) {
	// The write is best-effort on purpose: refusing a legitimate sign-in because the audit
	// sink is gone costs the user more than the gap it leaves, and the log line names it.
	app := newIdentityApp(t)
	if err := ensureIdentityEventsCollection(app); err != nil {
		t.Fatalf("ensureIdentityEventsCollection: %v", err)
	}
	collection, err := app.FindCollectionByNameOrId(identityEventCollection)
	if err != nil {
		t.Fatalf("find the audit collection: %v", err)
	}
	if err := app.Delete(collection); err != nil {
		t.Fatalf("drop the audit collection: %v", err)
	}

	if _, outcome, err := resolveIdentity(app, providerGoogle, "aud-x", "survivor@example.com", true, ""); err != nil || outcome != IdentityCreated {
		t.Fatalf("a missing audit sink must not break linking: %v %s", err, outcome)
	}
}

// §8's equivalence claim: the two signup doors — an emailed code and a Google
// assertion — produce the same tenant shape, so a future change that gives one door
// its own provisioning cannot pass unnoticed.
func TestBothSignupDoorsProduceEquivalentTenantRows(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()

	// Door 1: request-otp for an unknown address registers it (web_otp.go's
	// createTenantForEmail call).
	var sentCode string
	restore := stubOTPEmail(t, &sentCode)
	defer restore()
	rec := doJSON(mux, http.MethodPost, "/api/v1/web/request-otp", "",
		`{"email":"eq-otp@example.com"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("request-otp: %d %s", rec.Code, rec.Body.String())
	}
	otpTenant, err := app.FindFirstRecordByData("tenants", "email", "eq-otp@example.com")
	if err != nil {
		t.Fatalf("the OTP door must have registered the address: %v", err)
	}

	// Door 2: the Google web flow creates the account from the provider's assertion.
	googleTenant, outcome, err := resolveIdentity(app, providerGoogle, "eq-google",
		"eq-google@example.com", true, "")
	if err != nil || outcome != IdentityCreated {
		t.Fatalf("google door: %v %s", err, outcome)
	}

	// Every field the schema carries must match, except the ones that identify the row,
	// the credential material (random per tenant by design), and the verification state,
	// which the doors legitimately reach at different moments.
	exempt := map[string]bool{
		"id": true, "created": true, "updated": true, "email": true,
		"api_key": true, "api_key_lookup": true, "email_verified": true,
	}
	for _, field := range googleTenant.Collection().Fields {
		name := field.GetName()
		if exempt[name] {
			continue
		}
		got, want := otpTenant.Get(name), googleTenant.Get(name)
		if fmt.Sprint(got) != fmt.Sprint(want) {
			t.Errorf("field %q differs between the signup doors: OTP %v, Google %v",
				name, got, want)
		}
	}

	// The exemption is pinned rather than assumed: the OTP door withholds verification
	// until verify-otp runs, while the provider's own assertion is the proof.
	if otpTenant.GetBool("email_verified") {
		t.Error("the OTP door must not mark an address verified before verify-otp")
	}
	if !googleTenant.GetBool("email_verified") {
		t.Error("the Google door proved the address and must mark it verified")
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
