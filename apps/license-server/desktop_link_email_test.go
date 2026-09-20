package main

// Tests for the emailed-code device link (ADR #54 §2.6-§2.7).
//
// The property that matters most is the one §2.6 states: a code issued for one purpose
// is not spendable at the other door. The rest is the device-auth and address rules.

import (
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/tests"
)

func TestLinkCodesAreNotSpendableAsLogins(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	_, apiKey := seedLinkDevice(t, app)
	email := "owner@example.com"

	// A code minted for the link purpose must not open a login session...
	var sent string
	restore := stubOTPEmail(t, &sent)
	defer restore()
	rec := doJSON(mux, http.MethodPost, "/api/v1/desktop/link/email/request", "Bearer "+apiKey,
		`{"machine_id":"mach-1","email":"`+email+`"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("request: %d %s", rec.Code, rec.Body.String())
	}
	if sent == "" {
		t.Fatal("the request must have mailed a code")
	}
	login := doJSON(mux, http.MethodPost, "/api/v1/web/verify-otp", "",
		`{"email":"`+email+`","code":"`+sent+`"}`)
	if login.Code != http.StatusUnauthorized {
		t.Fatalf("a link code must not log anyone in, got %d: %s", login.Code, login.Body.String())
	}
	// The attempt must not have consumed it, and the reverse must hold too — both are pinned
	// in the store tests (`TestOtpStoreCodesArePurposeScoped`), because immediately after this
	// refusal the SHARED LOCKOUT is active by design: the second door escalates the same
	// counter, which is exactly what §2.6 asks for and why this test stops here.
}

func TestDesktopLinkEmailRefusesAForeignAddress(t *testing.T) {
	// The device proves WHICH tenant it holds; the address is a confirmation, so it cannot
	// be used to aim a code at a mailbox the device does not hold.
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	_, apiKey := seedLinkDevice(t, app)
	var sent string
	restore := stubOTPEmail(t, &sent)
	defer restore()

	rec := doJSON(mux, http.MethodPost, "/api/v1/desktop/link/email/request", "Bearer "+apiKey,
		`{"machine_id":"mach-1","email":"someone-else@example.com"}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for a foreign address, got %d: %s", rec.Code, rec.Body.String())
	}
	if sent != "" {
		t.Error("no code may be mailed for an address that is not the tenant's own")
	}
}

func TestDesktopLinkEmailNeedsDeviceCredentialsAndASixDigitCode(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	_, apiKey := seedLinkDevice(t, app)
	body := `{"machine_id":"mach-1","email":"owner@example.com"}`

	if rec := doJSON(mux, http.MethodPost, "/api/v1/desktop/link/email/request", "", body); rec.Code != http.StatusUnauthorized {
		t.Fatalf("no credentials must be 401, got %d", rec.Code)
	}
	if rec := doJSON(mux, http.MethodPost, "/api/v1/desktop/link/email/request", "Bearer wrong", body); rec.Code != http.StatusUnauthorized {
		t.Fatalf("an unknown key must be 401, got %d", rec.Code)
	}
	// A malformed code never reaches the store.
	short := doJSON(mux, http.MethodPost, "/api/v1/desktop/link/email/consume", "Bearer "+apiKey,
		`{"machine_id":"mach-1","code":"12"}`)
	if short.Code != http.StatusBadRequest {
		t.Fatalf("a 2-digit code must be refused, got %d", short.Code)
	}
}

func TestDesktopLinkEmailConsumeIsSingleUse(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	tenantID, apiKey := seedLinkDevice(t, app)
	var sent string
	restore := stubOTPEmail(t, &sent)
	defer restore()
	if rec := doJSON(mux, http.MethodPost, "/api/v1/desktop/link/email/request", "Bearer "+apiKey,
		`{"machine_id":"mach-1","email":"owner@example.com"}`); rec.Code != http.StatusOK {
		t.Fatalf("request: %d %s", rec.Code, rec.Body.String())
	}
	body := `{"machine_id":"mach-1","code":"` + sent + `"}`
	if rec := doJSON(mux, http.MethodPost, "/api/v1/desktop/link/email/consume", "Bearer "+apiKey, body); rec.Code != http.StatusOK {
		t.Fatalf("first consume: %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(mux, http.MethodPost, "/api/v1/desktop/link/email/consume", "Bearer "+apiKey, body); rec.Code != http.StatusBadRequest {
		t.Fatalf("a replayed code must be refused, got %d", rec.Code)
	}
	if !tenantHasVerifiedEmail(t, app, tenantID) {
		t.Error("a successful consume must leave the account verified")
	}
}

// tenantHasVerifiedEmail reads the flag the emailed-code path is responsible for.
func tenantHasVerifiedEmail(t *testing.T, app *tests.TestApp, tenantID string) bool {
	t.Helper()
	record, err := app.FindRecordById("tenants", tenantID)
	if err != nil {
		t.Fatalf("find tenant: %v", err)
	}
	return record.GetBool("email_verified")
}
