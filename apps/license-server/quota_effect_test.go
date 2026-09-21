package main

// Tests for §2.4’s quota-effect detection.
//
// The signal is only meaningful if it is immune to client claims: these tests
// build the CONDITION in server-held tables and assert the detector finds it.

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// Machine ids must satisfy the schema pattern ^[a-f0-9]{15}$, which is why
// these are literal hex rather than "m1"/"m2". Named constants keep the tests
// readable while staying schema-valid.
const (
	quotaDevA = "aaaa00000000001"
	quotaDevB = "aaaa00000000002"
	quotaDevC = "aaaa00000000003"
	quotaDevD = "aaaa00000000004"
	quotaDevE = "aaaa00000000005"
)

// seedQuotaMachine registers one device, optionally revoked.
//
// Distinct from `seedMachine` (handler_test.go), which takes its arguments in a
// different order and cannot express revocation.
func seedQuotaMachine(t *testing.T, app core.App, tenantID, machineID string, revoked bool) {
	t.Helper()
	coll, err := app.FindCollectionByNameOrId("tenant_machines")
	if err != nil {
		t.Fatalf("tenant_machines collection: %v", err)
	}
	rec := core.NewRecord(coll)
	rec.Set("tenant_id", tenantID)
	rec.Set("machine_id", machineID)
	if revoked {
		rec.Set("revoked_at", "2026-01-01T00:00:00Z")
	}
	if err := app.Save(rec); err != nil {
		t.Fatalf("seed machine: %v", err)
	}
}

func TestQuotaEffect_DetectsMoreDevicesThanTheCap(t *testing.T) {
	// The core signal: three active devices against a cap of 2.
	app, _ := dashboardMux(t)
	defer app.Cleanup()
	tenant := seedLifecycleTenant(t, app, "quotaover@test.com", "active")
	seedSubscriptionWithLimits(t, app, tenant.Id, "pro", "active", 1, 2, "[]")
	seedQuotaMachine(t, app, tenant.Id, quotaDevA, false)
	seedQuotaMachine(t, app, tenant.Id, quotaDevB, false)
	seedQuotaMachine(t, app, tenant.Id, quotaDevC, false)

	found := findTenantsOverPosQuota(app)
	if len(found) != 1 {
		t.Fatalf("expected 1 over-quota tenant, got %d: %+v", len(found), found)
	}
	if found[0].active != 3 || found[0].cap != 2 {
		t.Errorf("reported active=%d cap=%d, want 3/2", found[0].active, found[0].cap)
	}
}

func TestQuotaEffect_AtTheCapIsNotAViolation(t *testing.T) {
	// Exactly at the cap is compliance, not abuse. An off-by-one here would
	// flag every correctly-sized tenant.
	app, _ := dashboardMux(t)
	defer app.Cleanup()
	tenant := seedLifecycleTenant(t, app, "quotaatcap@test.com", "active")
	seedSubscriptionWithLimits(t, app, tenant.Id, "pro", "active", 1, 2, "[]")
	seedQuotaMachine(t, app, tenant.Id, quotaDevA, false)
	seedQuotaMachine(t, app, tenant.Id, quotaDevB, false)

	if found := findTenantsOverPosQuota(app); len(found) != 0 {
		t.Errorf("2 devices at a cap of 2 must not report, got %+v", found)
	}
}

func TestQuotaEffect_RevokedDevicesDoNotCount(t *testing.T) {
	// A revoked machine is no longer a terminal the tenant runs. Counting it
	// would report a tenant over quota for a device an operator already locked.
	app, _ := dashboardMux(t)
	defer app.Cleanup()
	tenant := seedLifecycleTenant(t, app, "quotarevoked@test.com", "active")
	seedSubscriptionWithLimits(t, app, tenant.Id, "pro", "active", 1, 2, "[]")
	seedQuotaMachine(t, app, tenant.Id, quotaDevA, false)
	seedQuotaMachine(t, app, tenant.Id, quotaDevB, true)
	seedQuotaMachine(t, app, tenant.Id, quotaDevC, true)

	if found := findTenantsOverPosQuota(app); len(found) != 0 {
		t.Errorf("revoked devices must not count toward the cap, got %+v", found)
	}
}

func TestQuotaEffect_AnUnlimitedCapIsNeverAViolation(t *testing.T) {
	// 0 reads as UNLIMITED throughout this codebase (effective_max_locations).
	// Treating it as a cap of zero would report every unlimited tenant.
	app, _ := dashboardMux(t)
	defer app.Cleanup()
	tenant := seedLifecycleTenant(t, app, "quotaunlimited@test.com", "active")
	seedSubscriptionWithLimits(t, app, tenant.Id, "pro", "active", 1, 0, "[]")
	for _, m := range []string{quotaDevA, quotaDevB, quotaDevC, quotaDevD, quotaDevE} {
		seedQuotaMachine(t, app, tenant.Id, m, false)
	}

	if found := findTenantsOverPosQuota(app); len(found) != 0 {
		t.Errorf("cap 0 is unlimited and must never report, got %+v", found)
	}
}

func TestQuotaEffect_AnInactiveSubscriptionIsNotChecked(t *testing.T) {
	// Only ACTIVE subscriptions carry a current cap. A lapsed tenant is not
	// over quota; it is lapsed, which other machinery handles.
	app, _ := dashboardMux(t)
	defer app.Cleanup()
	tenant := seedLifecycleTenant(t, app, "quotainactive@test.com", "active")
	seedSubscriptionWithLimits(t, app, tenant.Id, "pro", "expired", 1, 1, "[]")
	seedQuotaMachine(t, app, tenant.Id, quotaDevA, false)
	seedQuotaMachine(t, app, tenant.Id, quotaDevB, false)

	if found := findTenantsOverPosQuota(app); len(found) != 0 {
		t.Errorf("an expired subscription must not be checked, got %+v", found)
	}
}

// ── Regression: the active-device statistic ──────────────────────

// This statistic silently read ZERO on every dashboard load because
// `countRecordsByFilter` swallows the query error and returns 0, and the filter
// used SQL's `IS NULL` — which PocketBase's parser REJECTS ("expected a sign
// operator, got IS"). No test had seeded a machine, so nothing noticed.
//
// The assertion is deliberately on the SEEDED count rather than on "not zero":
// a regression to any wrong predicate would change the number, and 0 is just the
// most likely wrong one.
func TestActiveDevicesStat_CountsUnrevokedMachines(t *testing.T) {
	app, _ := dashboardMux(t)
	defer app.Cleanup()
	tenant := seedLifecycleTenant(t, app, "activedevices@test.com", "active")
	seedQuotaMachine(t, app, tenant.Id, quotaDevA, false)
	seedQuotaMachine(t, app, tenant.Id, quotaDevB, false)
	seedQuotaMachine(t, app, tenant.Id, quotaDevC, true) // revoked: must not count

	got := countRecordsByFilter(app, "tenant_machines", "revoked_at = null")
	if got != 2 {
		t.Errorf("active devices = %d, want 2 (two unrevoked, one revoked)", got)
	}
}

// The predicate itself is the bug, so pin that the OTHER spelling is rejected.
// If a future PocketBase starts accepting `IS NULL`, this test fails and whoever
// sees it learns why the comment above exists — rather than silently regaining an
// ambiguous filter.
func TestActiveDevicesStat_NullComparisonUsesEqualsNotNull(t *testing.T) {
	app, _ := dashboardMux(t)
	defer app.Cleanup()
	tenant := seedLifecycleTenant(t, app, "activedevices2@test.com", "active")
	seedQuotaMachine(t, app, tenant.Id, quotaDevA, false)

	// The correct form finds the row.
	if got := countRecordsByFilter(app, "tenant_machines", "revoked_at = null"); got != 1 {
		t.Errorf("`= null` found %d rows, want 1", got)
	}
	// The SQL spelling must NOT be relied upon: it raises a filter-syntax error,
	// which countRecordsByFilter converts into a misleading 0.
	if got := countRecordsByFilter(app, "tenant_machines", "revoked_at IS NULL"); got != 0 {
		t.Errorf("`IS NULL` returned %d; it is expected to fail and yield 0. If that changed, revisit admin_stats.go", got)
	}
}
