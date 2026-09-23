package main

// Tests for the §2.5 renewal refusal (ADR #57).
//
// §2.5 is the only place this record DENIES something, so its scope is the
// whole point: the refusal must hit the DEVICE that failed its build check and
// leave the tenant’s other terminals alone. These tests pin that scope, the
// fail-open arms, and the indistinguishability §Q-D requires.

import (
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// seedBuildIntegrityReport writes one stored verdict for a device.
func seedBuildIntegrityReport(t *testing.T, app core.App, tenantID, machineID, verdict string) {
	t.Helper()
	coll, err := app.FindCollectionByNameOrId(buildIntegrityCollection)
	if err != nil {
		t.Fatalf("collection %s: %v", buildIntegrityCollection, err)
	}
	rec := core.NewRecord(coll)
	rec.Set("tenant_id", tenantID)
	rec.Set("machine_id", machineID)
	rec.Set("verdict", verdict)
	if err := app.Save(rec); err != nil {
		t.Fatalf("seed report: %v", err)
	}
}

// The core scope guarantee: a device with a mismatch is refused.
func TestRenewHandler_RefusesADeviceWithAFingerprintMismatch(t *testing.T) {
	resetRateLimiters()
	runScenario(t, &tests.ApiScenario{
		Method: "POST",
		URL:    "/api/v1/license/renew",
		Body: strings.NewReader(`{
			"tenant_id": "tampertenant001",
			"key": "OZ-RENEW-KEY",
			"machine_id": "tampered-device"
		}`),
		Headers:        map[string]string{"Authorization": "Bearer tamperapikey0001"},
		ExpectedStatus: 401,
		// §Q-D: the refusal must be INDISTINGUISHABLE from an ordinary lapse.
		// A distinct message would tell an attacker exactly which control fired.
		ExpectedContent: []string{`invalid api_key or tenant is not active`},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			tt := t.(*testing.T)
			seedTenant(tt, app, "tampertenant001", "tamperapikey0001", "active")
			seedBuildIntegrityReport(tt, app, "tampertenant001", "tampered-device", buildVerdictMismatch)
		},
	})
}

// The scope guarantee, other half: an HONEST device of the SAME tenant must
// still renew. This is the test that would fail under a tenant-level flag, and
// it is the reason the refusal is keyed on the device.
func TestRenewHandler_AllowsAnotherDeviceOfTheSameTenant(t *testing.T) {
	resetRateLimiters()
	runScenario(t, &tests.ApiScenario{
		Method: "POST",
		URL:    "/api/v1/license/renew",
		Body: strings.NewReader(`{
			"tenant_id": "mixedtenant0001",
			"key": "OZ-RENEW-KEY",
			"machine_id": "honest-device"
		}`),
		Headers: map[string]string{"Authorization": "Bearer mixedapikey00001"},
		// The device is CLEAN, so it gets past the §2.5 gate and fails later for
		// an unrelated reason: the seeded key is not a real purchasable key.
		// 401 + that specific message is the proof it reached the KEY check —
		// which is downstream of the fingerprint gate — rather than being
		// refused for the mismatch its sibling device reported.
		ExpectedStatus:  401,
		ExpectedContent: []string{"invalid or already used license key"},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			tt := t.(*testing.T)
			seedTenant(tt, app, "mixedtenant0001", "mixedapikey00001", "active")
			seedBuildIntegrityReport(tt, app, "mixedtenant0001", "tampered-device", buildVerdictMismatch)
		},
	})
}

// ── The fail-open arms ───────────────────────────────────────────

// An OLDER client sends no machine_id. It must renew exactly as before: the
// field may only ever ADD a refusal, never manufacture one from absence.
func TestRenewHandler_OldClientWithoutMachineIDStillRenews(t *testing.T) {
	resetRateLimiters()
	runScenario(t, &tests.ApiScenario{
		Method: "POST",
		URL:    "/api/v1/license/renew",
		Body: strings.NewReader(`{
			"tenant_id": "oldclienttenant",
			"key": "OZ-RENEW-KEY"
		}`),
		Headers: map[string]string{"Authorization": "Bearer oldclientkey0001"},
		// Reaches the key check, i.e. passed §2.5 with no device identity.
		ExpectedStatus:  401,
		ExpectedContent: []string{"invalid or already used license key"},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			tt := t.(*testing.T)
			seedTenant(tt, app, "oldclienttenant", "oldclientkey0001", "active")
			// A mismatch exists for SOME device, but not one this client names.
			seedBuildIntegrityReport(tt, app, "oldclienttenant", "some-other-device", buildVerdictMismatch)
		},
	})
}

// A persistent `unknown` must NOT refuse a renewal. §2.2 makes absence a verdict,
// but §Q4 routes it to the operator queue precisely because a serialization bug
// or a partially-rolled-out client produces it from legitimate devices — so
// refusing on it would let OUR bug stop merchants renewing.
func TestRenewHandler_PersistentUnknownDoesNotRefuse(t *testing.T) {
	resetRateLimiters()
	runScenario(t, &tests.ApiScenario{
		Method: "POST",
		URL:    "/api/v1/license/renew",
		Body: strings.NewReader(`{
			"tenant_id": "unknowntenant00",
			"key": "OZ-RENEW-KEY",
			"machine_id": "unreadable-device"
		}`),
		Headers:         map[string]string{"Authorization": "Bearer unknownkey000001"},
		ExpectedStatus:  401,
		ExpectedContent: []string{"invalid or already used license key"},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			tt := t.(*testing.T)
			seedTenant(tt, app, "unknowntenant00", "unknownkey000001", "active")
			seedBuildIntegrityReport(tt, app, "unknowntenant00", "unreadable-device", buildVerdictUnknown)
		},
	})
}

// A `valid` report for the device must not refuse either — the ordinary case.
func TestRenewHandler_ValidDeviceRenews(t *testing.T) {
	resetRateLimiters()
	runScenario(t, &tests.ApiScenario{
		Method: "POST",
		URL:    "/api/v1/license/renew",
		Body: strings.NewReader(`{
			"tenant_id": "validtenant0001",
			"key": "OZ-RENEW-KEY",
			"machine_id": "clean-device"
		}`),
		Headers:         map[string]string{"Authorization": "Bearer validkey0000001"},
		ExpectedStatus:  401,
		ExpectedContent: []string{"invalid or already used license key"},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			tt := t.(*testing.T)
			seedTenant(tt, app, "validtenant0001", "validkey0000001", "active")
		},
	})
}

// The helper’s own contract, at the unit level: absence of rows, an empty
// machine_id, and an unrelated verdict all answer false.
func TestDeviceHasFingerprintMismatch_FailsOpenOnEveryUncertainty(t *testing.T) {
	app, _ := dashboardMux(t)
	defer app.Cleanup()
	tenant := seedLifecycleTenant(t, app, "gatefailopen@test.com", "active")

	if deviceHasFingerprintMismatch(app, "") {
		t.Error("an empty machine_id asserts no identity and must not refuse")
	}
	if deviceHasFingerprintMismatch(app, "no-such-device") {
		t.Error("an unknown device has no verdict and must not refuse")
	}
	seedBuildIntegrityReport(t, app, tenant.Id, "unknown-dev", buildVerdictUnknown)
	if deviceHasFingerprintMismatch(app, "unknown-dev") {
		t.Error("`unknown` is not a refusal: §Q4 routes it to a human")
	}
	seedBuildIntegrityReport(t, app, tenant.Id, "bad-dev", buildVerdictMismatch)
	if !deviceHasFingerprintMismatch(app, "bad-dev") {
		t.Error("a stored mismatch must refuse this device")
	}
}
