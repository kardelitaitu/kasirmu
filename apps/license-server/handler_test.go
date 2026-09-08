package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"runtime"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
	"unsafe"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/types"
)

// ── Test Infrastructure ──────────────────────────────────────────

func newTestAppFactory(t *testing.T) *tests.TestApp {
	t.Helper()

	// Detach stale SQLite handles from prior tests so that
	// attachPersistence in registerTestRoutes always binds to
	// THIS test's fresh app rather than holding a dangling
	// pointer to a previous test's (potentially cleaned-up) DB.
	// Without this, runScenario-based tests (which don't call
	// resetRateLimiters() themselves) can panic at rl.db.DB()
	// inside persistBucket when the handler fires allow().
	resetRateLimiters()

	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("failed to create test app: %v", err)
	}

	createTestCollections(t, app)
	registerTestRoutes(t, app)

	return app
}

func createTestCollections(t *testing.T, app *tests.TestApp) {
	t.Helper()

	tenants := core.NewBaseCollection("tenants")
	tenants.Fields.Add(
		&core.EmailField{Name: "email", Required: true},
		&core.TextField{Name: "phone"},
		&core.TextField{Name: "api_key", Required: true},
		&core.TextField{Name: "api_key_lookup"},
		&core.SelectField{Name: "status", Required: true, Values: []string{"active", "suspended", "revoked"}},
	)
	// Autodate created/updated mirror production so "-created" sorts work.
	tenants.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	tenants.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	tenants.CreateRule = types.Pointer("")
	tenants.ListRule = types.Pointer("")
	tenants.ViewRule = types.Pointer("")
	if err := app.Save(tenants); err != nil {
		t.Fatalf("failed to create tenants collection: %v", err)
	}

	licenseKeys := core.NewBaseCollection("license_keys")
	licenseKeys.Fields.Add(
		&core.TextField{Name: "key", Required: true},
		&core.SelectField{Name: "tier_key", Required: true, Values: []string{"free", "plus", "pro", "premium", "enterprise"}},
		&core.NumberField{Name: "max_stores"},
		&core.NumberField{Name: "max_pos_instances"},
		&core.JSONField{Name: "allowed_types"},
		&core.SelectField{Name: "status", Required: true, Values: []string{"unused", "activated", "expired", "revoked"}},
		&core.DateField{Name: "expires_at", Required: true},
		&core.DateField{Name: "activated_at"},
		&core.RelationField{Name: "activated_by", CollectionId: tenants.Id, MaxSelect: 1},
		&core.DateField{Name: "revoked_at"},
		&core.TextField{Name: "notes"},
		&core.TextField{Name: "paddle_sub_id"},
	)
	// Autodate created/updated mirror the production pb_schema.json so
	// handlers sorting by "-created" (e.g. /web/me license lookup) work
	// identically in tests.
	licenseKeys.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	licenseKeys.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	licenseKeys.CreateRule = types.Pointer("")
	licenseKeys.ListRule = types.Pointer("")
	licenseKeys.ViewRule = types.Pointer("")
	licenseKeys.UpdateRule = types.Pointer("")
	if err := app.Save(licenseKeys); err != nil {
		t.Fatalf("failed to create license_keys collection: %v", err)
	}

	subscriptions := core.NewBaseCollection("subscriptions")
	subscriptions.Fields.Add(
		&core.RelationField{Name: "tenant_id", Required: true, CollectionId: tenants.Id, MaxSelect: 1},
		&core.SelectField{Name: "tier_key", Required: true, Values: []string{"free", "plus", "pro", "premium", "enterprise"}},
		&core.NumberField{Name: "max_stores"},
		&core.NumberField{Name: "max_pos_instances"},
		&core.JSONField{Name: "allowed_types"},
		&core.SelectField{Name: "status", Required: true, Values: []string{"active", "expired", "grace_period", "revoked", "paused"}},
		&core.DateField{Name: "starts_at", Required: true},
		&core.DateField{Name: "expires_at", Required: true},
		&core.DateField{Name: "grace_until"},
		&core.DateField{Name: "paused_at"},
		&core.DateField{Name: "paused_until"},
		&core.TextField{Name: "signed_payload", Required: true},
		&core.TextField{Name: "signature", Required: true},
		&core.TextField{Name: "paddle_sub_id"},
	)
	// Autodate created/updated mirror production so "-created" sorts work.
	subscriptions.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	subscriptions.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	subscriptions.CreateRule = types.Pointer("")
	subscriptions.ListRule = types.Pointer("")
	subscriptions.ViewRule = types.Pointer("")
	subscriptions.UpdateRule = types.Pointer("")
	if err := app.Save(subscriptions); err != nil {
		t.Fatalf("failed to create subscriptions collection: %v", err)
	}

	tenantMachines := core.NewBaseCollection("tenant_machines")
	tenantMachines.Fields.Add(
		&core.RelationField{Name: "tenant_id", Required: true, CollectionId: tenants.Id, MaxSelect: 1},
		&core.DateField{Name: "first_seen_at"},
		&core.DateField{Name: "last_seen_at"},
		&core.TextField{Name: "machine_id"},
		&core.DateField{Name: "revoked_at"},
	)
	// Autodate created/updated mirror production so "-created" sorts work.
	tenantMachines.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	tenantMachines.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	tenantMachines.CreateRule = types.Pointer("")
	tenantMachines.ListRule = types.Pointer("")
	tenantMachines.ViewRule = types.Pointer("")
	if err := app.Save(tenantMachines); err != nil {
		t.Fatalf("failed to create tenant_machines collection: %v", err)
	}

	// Hardware-fingerprint trial lock (SPEC-2026-TRIAL-LOCK): one trial
	// per physical device. Mirrors the production pb_schema.json so
	// /api/v1/license/trial and the activation-time gate find it.
	trialRegs := core.NewBaseCollection("trial_registrations")
	trialRegs.Fields.Add(&core.TextField{Name: "hardware_fingerprint", Required: true, Max: 128})
	trialRegs.Fields.Add(&core.DateField{Name: "first_seen_at", Required: true})
	trialRegs.Fields.Add(&core.DateField{Name: "trial_expires_at", Required: true})
	trialRegs.Fields.Add(&core.SelectField{Name: "platform", Required: true, Values: []string{"windows", "android", "linux", "macos", "unknown"}, MaxSelect: 1})
	trialRegs.Fields.Add(&core.TextField{Name: "app_version", Required: true, Max: 32})
	trialRegs.Fields.Add(&core.RelationField{Name: "tenant_id", CollectionId: tenants.Id, MaxSelect: 1})
	trialRegs.Fields.Add(&core.TextField{Name: "ip_address", Max: 64})
	trialRegs.Indexes = append(trialRegs.Indexes,
		"CREATE UNIQUE INDEX idx_trial_registrations_hw ON trial_registrations (hardware_fingerprint) WHERE hardware_fingerprint IS NOT NULL AND hardware_fingerprint != ''")
	trialRegs.CreateRule = types.Pointer("")
	trialRegs.ListRule = types.Pointer("")
	trialRegs.ViewRule = types.Pointer("")
	trialRegs.UpdateRule = types.Pointer("")
	if err := app.Save(trialRegs); err != nil {
		t.Fatalf("failed to create trial_registrations collection: %v", err)
	}

	// Lightweight repeat-email detector: hash of (email, device id) with a
	// claim counter. Mirrors the production pb_schema.json so the detector
	// (recordTrialClaim in trial.go) finds its table in tests.
	trialClaims := core.NewBaseCollection("trial_claims")
	trialClaims.Fields.Add(&core.TextField{Name: "claim_hash", Required: true, Pattern: "^[a-f0-9]{64}$", Min: 64, Max: 64})
	trialClaims.Fields.Add(&core.TextField{Name: "email", Required: true, Max: 320})
	trialClaims.Fields.Add(&core.TextField{Name: "device_id", Required: true, Max: 128})
	trialClaims.Fields.Add(&core.RelationField{Name: "tenant_id", CollectionId: tenants.Id, MaxSelect: 1})
	trialClaims.Fields.Add(&core.NumberField{Name: "claim_count", Required: true, Min: types.Pointer(1.0), OnlyInt: true})
	trialClaims.Fields.Add(&core.DateField{Name: "first_claimed_at", Required: true})
	trialClaims.Fields.Add(&core.DateField{Name: "last_claimed_at", Required: true})
	trialClaims.Fields.Add(&core.TextField{Name: "trial_keys", Max: 2048})
	trialClaims.Indexes = append(trialClaims.Indexes,
		"CREATE UNIQUE INDEX idx_trial_claims_hash ON trial_claims (claim_hash) WHERE claim_hash IS NOT NULL AND claim_hash != ''")
	trialClaims.CreateRule = types.Pointer("")
	trialClaims.ListRule = types.Pointer("")
	trialClaims.ViewRule = types.Pointer("")
	trialClaims.UpdateRule = types.Pointer("")
	if err := app.Save(trialClaims); err != nil {
		t.Fatalf("failed to create trial_claims collection: %v", err)
	}

	revenueEvents := core.NewBaseCollection("revenue_events")
	revenueEvents.Fields.Add(
		&core.RelationField{Name: "tenant_id", Required: true, CollectionId: tenants.Id, MaxSelect: 1},
		&core.TextField{Name: "event_id", Required: true, Max: 128},
		&core.SelectField{Name: "provider", Required: true, Values: []string{"paddle", "midtrans"}},
		&core.NumberField{Name: "amount_usd"},
		&core.NumberField{Name: "amount_idr", OnlyInt: true},
		&core.SelectField{Name: "currency", Required: true, Values: []string{"USD", "IDR"}},
		&core.SelectField{Name: "tier_key", Required: false, Values: []string{"plus", "pro", "premium", "enterprise"}},
		&core.TextField{Name: "subscription_id", Max: 128},
		&core.TextField{Name: "notes", Max: 512},
	)
	revenueEvents.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	revenueEvents.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	revenueEvents.Indexes = append(revenueEvents.Indexes,
		"CREATE UNIQUE INDEX idx_revenue_events_event ON revenue_events (event_id)")
	revenueEvents.CreateRule = types.Pointer("")
	revenueEvents.ListRule = types.Pointer("")
	revenueEvents.ViewRule = types.Pointer("")
	revenueEvents.UpdateRule = types.Pointer("")
	if err := app.Save(revenueEvents); err != nil {
		t.Fatalf("failed to create revenue_events collection: %v", err)
	}

	revenueAdjustments := core.NewBaseCollection("revenue_adjustments")
	revenueAdjustments.Fields.Add(
		&core.RelationField{Name: "tenant_id", CollectionId: tenants.Id, MaxSelect: 1},
		&core.TextField{Name: "event_id", Required: true, Max: 128},
		&core.SelectField{Name: "provider", Required: true, Values: []string{"paddle", "midtrans"}},
		&core.SelectField{Name: "kind", Required: true, Values: []string{"refund", "partial_refund", "chargeback"}},
		&core.NumberField{Name: "amount_usd"},
		&core.NumberField{Name: "amount_idr", OnlyInt: true},
		&core.SelectField{Name: "currency", Required: true, Values: []string{"USD", "IDR"}},
		&core.TextField{Name: "notes", Max: 512},
	)
	revenueAdjustments.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	revenueAdjustments.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	revenueAdjustments.Indexes = append(revenueAdjustments.Indexes,
		"CREATE UNIQUE INDEX idx_adj_event ON revenue_adjustments (event_id)")
	revenueAdjustments.CreateRule = types.Pointer("")
	revenueAdjustments.ListRule = types.Pointer("")
	revenueAdjustments.ViewRule = types.Pointer("")
	revenueAdjustments.UpdateRule = types.Pointer("")
	if err := app.Save(revenueAdjustments); err != nil {
		t.Fatalf("failed to create revenue_adjustments collection: %v", err)
	}
}

func registerTestRoutes(t *testing.T, app *tests.TestApp) {
	t.Helper()
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		// Wire rate-limiter persistence to SQLite for H2-audit tests.
		// Tests calling resetRateLimiters() detach the db before the
		// next test, so cross-test pollution is bounded even though
		// the tracker variables are package globals.
		ipRateLimiter.attachPersistence(app)
		keyFailTracker.attachPersistence(app)
		// Mirror production boot: add the email_verified + password_hash
		// fields to the tenants collection (createTestCollections
		// deliberately omits them so the migration paths are exercised).
		if err := ensureEmailVerifiedField(app); err != nil {
			return err
		}
		if err := ensurePasswordHashField(app); err != nil {
			return err
		}
		if err := ensurePasswordResetAtField(app); err != nil {
			return err
		}
		// Mirror production boot: add the license_keys.is_trial bool
		// (segmented trials, C2.1) via the same idempotent migration path
		// the deployed server uses.
		if err := ensureIsTrialField(app); err != nil {
			return err
		}
		// Mirror production boot: add the midtrans_sub_id / midtrans_order_id
		// fields and the payment_provider discriminator (C3.1) via the same
		// idempotent migration paths the deployed server uses.
		if err := ensureMidtransFields(app); err != nil {
			return err
		}
		if err := ensurePaymentProviderField(app); err != nil {
			return err
		}
		// Mirror production boot: manual grants widen payment_provider
		// (ADR #42 Phase 4).
		if err := ensureManualPaymentProvider(app); err != nil {
			return err
		}
		// Mirror production boot: add the bundle_id field (vertical-bundle
		// checkout, C3.2) via the same idempotent migration path the
		// deployed server uses.
		if err := ensureBundleIDField(app); err != nil {
			return err
		}
		// Mirror production boot: ensure the trial_registrations collection
		// (hardware-fingerprint trial lock, SPEC-2026-TRIAL-LOCK) exists.
		if err := ensureTrialRegistrations(app); err != nil {
			return err
		}
		// Mirror production boot: ensure the trial_claims collection
		// (lightweight repeat-email detector) exists.
		if err := ensureTrialClaims(app); err != nil {
			return err
		}
		// C4.2: enterprise self-serve trial approval codes
		if err := ensureEnterpriseApprovals(app); err != nil {
			return err
		}
		// C4.3: add-on marketplace field on license_keys
		if err := ensureAddonsField(app); err != nil {
			return err
		}

		se.Router.POST("/api/v1/license/activate", handleActivate(app))
		// LSE-11 phase A: recovery-code endpoint — mirror production boot.
		se.Router.POST("/api/v1/license/recover", handleLicenseRecover(app))
		se.Router.POST("/api/v1/license/renew", handleRenew(app))
		// Hardware-fingerprint trial lock (SPEC-2026-TRIAL-LOCK) — mirror
		// production boot.
		se.Router.POST(trialPath, handleTrial(app))
		se.Router.POST("/api/v1/license/status", handleStatus(app))
		se.Router.POST("/api/v1/web/contact", handleContact(app))
		se.Router.POST("/api/v1/web/request-otp", handleRequestOTP(app))
		se.Router.POST("/api/v1/web/verify-otp", handleVerifyOTP(app))
		se.Router.POST("/api/v1/web/login", handleLoginPassword(app))
		se.Router.POST("/api/v1/web/set-password", handleSetPassword(app))
		se.Router.POST("/api/v1/web/register", handleRegister(app))
		se.Router.POST("/api/v1/web/request-password-reset", handleRequestPasswordReset(app))
		se.Router.POST("/api/v1/web/reset-password", handleResetPassword(app))
		se.Router.GET("/api/v1/web/me", handleMe(app))
		se.Router.POST("/api/v1/web/logout", handleLogout(app))
		se.Router.POST("/api/v1/web/exchange-issue", handleExchangeIssue(app))
		se.Router.POST("/api/v1/web/exchange-consume", handleExchangeConsume(app))
		// ADR #42 dashboard endpoints (user + admin).
		se.Router.GET("/api/v1/web/usage", handleWebUsage(app))
		se.Router.GET("/api/v1/web/devices", handleWebDevices(app))
		se.Router.POST("/api/v1/web/devices/{id}/revoke", handleWebRevokeDevice(app))
		se.Router.GET("/api/v1/admin/tenants", handleAdminListTenants(app))
		se.Router.GET("/api/v1/admin/tenants/{id}", handleAdminGetTenant(app))
		se.Router.PATCH("/api/v1/admin/tenants/{id}", handleAdminUpdateTenant(app))
		se.Router.POST("/api/v1/admin/tenants/{id}/activate", handleAdminActivate(app))
		se.Router.POST("/api/v1/admin/tenants/{id}/renew", handleAdminRenew(app))
		se.Router.POST("/api/v1/admin/tenants/{id}/revoke", handleAdminRevoke(app))
		se.Router.POST("/api/v1/admin/tenants/{id}/tier-override", handleAdminTierOverride(app))
		se.Router.POST("/api/v1/admin/tenants/{id}/grant-subscription", handleAdminGrantSubscription(app))
		se.Router.POST("/api/v1/admin/tenants/{id}/devices/{deviceId}/revoke", handleAdminRevokeDevice(app))
		se.Router.DELETE("/api/v1/admin/tenants/{id}", handleAdminDeleteTenant(app))
		se.Router.GET("/api/v1/admin/health", handleAdminHealth(app))
		se.Router.GET("/api/v1/admin/stats", handleAdminStats(app))
		se.Router.POST(paddleWebhookPath, handlePaddleWebhook(app))
		// Midtrans webhook + Snap checkout (C3.1) — mirror production boot.
		se.Router.POST(midtransWebhookPath, handleMidtransWebhook(app))
		se.Router.POST(midtransSnapPath, handleMidtransSnap(app))
		// C3.3: Pause/resume subscription endpoints.
		se.Router.POST("/api/v1/license/pause", handlePause(app))
		se.Router.POST("/api/v1/license/resume", handleResume(app))
		// C4.2: Enterprise self-serve trial + admin endpoints.
		se.Router.POST("/api/v1/license/enterprise-trial", handleEnterpriseTrial(app))
		se.Router.POST("/api/v1/admin/enterprise-codes", handleGenerateEnterpriseCode(app))
		se.Router.GET("/api/v1/admin/enterprise-codes", handleListEnterpriseCodes(app))
		// C4.3: Add-on marketplace admin endpoints
		se.Router.POST("/api/v1/admin/license-addons", handleAddLicenseAddon(app))
		se.Router.DELETE("/api/v1/admin/license-addons", handleRemoveLicenseAddon(app))
		se.Router.GET("/api/v1/admin/license-addons", handleListLicenseAddons(app))
		return se.Next()
	})
}

func runScenario(t *testing.T, scenario *tests.ApiScenario) {
	t.Helper()
	if scenario.TestAppFactory == nil {
		scenario.TestAppFactory = func(t testing.TB) *tests.TestApp {
			return newTestAppFactory(t.(*testing.T))
		}
	}
	scenario.Test(t)
}

// ── Seed helpers ─────────────────────────────────────────────────

func seedTenant(t *testing.T, app *tests.TestApp, tenantID, apiKey, status string) {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("tenants")
	if err != nil {
		t.Fatalf("tenants collection not found: %v", err)
	}
	rec := core.NewRecord(col)
	rec.Set("id", tenantID)
	// Stored emails are normalized to lowercase to match the
	// case-insensitive lookup performed by the activate handler
	// (which lowercases incoming requests before searching by email).
	rec.Set("email", strings.ToLower(tenantID+"@example.com"))
	rec.Set("phone", "-")
	// The handler verifies against a bcrypt hash; seed the hashed form so the
	// presented plaintext apiKey authenticates (matching production at-rest
	// storage).
	hash, lookup, err := hashAPIKey(apiKey)
	if err != nil {
		t.Fatalf("failed to hash api_key in seedTenant: %v", err)
	}
	rec.Set("api_key", hash)
	rec.Set("api_key_lookup", lookup)
	rec.Set("status", status)
	if err := app.Save(rec); err != nil {
		t.Fatalf("failed to seed tenant %q: %v", tenantID, err)
	}
}

// setupDirectApp creates a TestApp with collections, generates a throwaway RSA
// key for signing, creates a router, triggers OnServe to register custom
// routes, and returns both the app (for direct DB inspection) and the
// ServeEvent (whose Router can handle httptest requests).
//
// This bypasses ApiScenario's transaction isolation so that subscriptions
// seeded via seedSubscription and tenants seeded via seedTenant are visible
// to FindRecordsByFilter during handler execution.
func setupDirectApp(t *testing.T) (*tests.TestApp, *core.ServeEvent) {
	t.Helper()

	// Ensure a throwaway RSA key exists so signSubscription doesn't panic.
	initPrivateKey(t)

	app := newTestAppFactory(t)

	router, err := apis.NewRouter(app)
	if err != nil {
		t.Fatalf("failed to create router: %v", err)
	}

	se := &core.ServeEvent{
		App:    app,
		Router: router,
	}

	// Fire OnServe to register routes from registerTestRoutes bindings.
	if err := app.OnServe().Trigger(se, func(e *core.ServeEvent) error {
		return nil
	}); err != nil {
		t.Fatalf("OnServe trigger failed: %v", err)
	}

	return app, se
}

// ── Misconfiguration test helpers ────────────────────────────────
//
// createMinimalCollections creates only the collections NOT listed in the
// skip set. This lets us simulate a misconfigured server where a required
// collection (tenants, tenant_machines, subscriptions) is missing.
func createMinimalCollections(t *testing.T, app *tests.TestApp, skip map[string]bool) {
	t.Helper()

	// Create tenants first so other collections can reference its ID.
	var tenantsID string
	if !skip["tenants"] {
		tenants := core.NewBaseCollection("tenants")
		tenants.Fields.Add(
			&core.EmailField{Name: "email", Required: true},
			&core.TextField{Name: "phone"},
			&core.TextField{Name: "api_key", Required: true},
			&core.TextField{Name: "api_key_lookup"},
			&core.SelectField{Name: "status", Required: true, Values: []string{"active", "suspended", "revoked"}},
		)
		tenants.CreateRule = types.Pointer("")
		tenants.ListRule = types.Pointer("")
		tenants.ViewRule = types.Pointer("")
		if err := app.Save(tenants); err != nil {
			t.Fatalf("failed to create tenants collection: %v", err)
		}
		tenantsID = tenants.Id
	}

	// license_keys is always required (the handler validates keys before
	// reaching any misconfiguration path). Its activated_by relation field
	// references tenants — only add it when tenants is present.
	licenseKeys := core.NewBaseCollection("license_keys")
	licenseKeys.Fields.Add(
		&core.TextField{Name: "key", Required: true},
		&core.SelectField{Name: "tier_key", Required: true, Values: []string{"free", "plus", "pro", "premium", "enterprise"}},
		&core.NumberField{Name: "max_stores"},
		&core.NumberField{Name: "max_pos_instances"},
		&core.JSONField{Name: "allowed_types"},
		&core.SelectField{Name: "status", Required: true, Values: []string{"unused", "activated", "expired", "revoked"}},
		&core.DateField{Name: "expires_at", Required: true},
		&core.DateField{Name: "activated_at"},
		&core.DateField{Name: "revoked_at"},
		&core.TextField{Name: "notes"},
		&core.TextField{Name: "paddle_sub_id"},
	)
	if tenantsID != "" {
		licenseKeys.Fields.Add(&core.RelationField{Name: "activated_by", CollectionId: tenantsID, MaxSelect: 1})
	}
	// Autodate created/updated mirror the production pb_schema.json so
	// handlers sorting by "-created" (e.g. /web/me license lookup) work
	// identically in tests.
	licenseKeys.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	licenseKeys.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	licenseKeys.CreateRule = types.Pointer("")
	licenseKeys.ListRule = types.Pointer("")
	licenseKeys.ViewRule = types.Pointer("")
	licenseKeys.UpdateRule = types.Pointer("")
	if err := app.Save(licenseKeys); err != nil {
		t.Fatalf("failed to create license_keys collection: %v", err)
	}

	if !skip["tenant_machines"] && tenantsID != "" {
		tenantMachines := core.NewBaseCollection("tenant_machines")
		tenantMachines.Fields.Add(
			&core.RelationField{Name: "tenant_id", Required: true, CollectionId: tenantsID, MaxSelect: 1},
			&core.DateField{Name: "first_seen_at"},
			&core.DateField{Name: "last_seen_at"},
			&core.TextField{Name: "machine_id"},
			&core.DateField{Name: "revoked_at"},
		)
		tenantMachines.CreateRule = types.Pointer("")
		tenantMachines.ListRule = types.Pointer("")
		tenantMachines.ViewRule = types.Pointer("")
		if err := app.Save(tenantMachines); err != nil {
			t.Fatalf("failed to create tenant_machines collection: %v", err)
		}
	}

	if !skip["subscriptions"] && tenantsID != "" {
		subscriptions := core.NewBaseCollection("subscriptions")
		subscriptions.Fields.Add(
			&core.RelationField{Name: "tenant_id", Required: true, CollectionId: tenantsID, MaxSelect: 1},
			&core.SelectField{Name: "tier_key", Required: true, Values: []string{"free", "plus", "pro", "premium", "enterprise"}},
			&core.NumberField{Name: "max_stores"},
			&core.NumberField{Name: "max_pos_instances"},
			&core.JSONField{Name: "allowed_types"},
			&core.SelectField{Name: "status", Required: true, Values: []string{"active", "expired", "grace_period", "revoked"}}, &core.DateField{Name: "starts_at", Required: true},
			&core.DateField{Name: "expires_at", Required: true},
			&core.DateField{Name: "grace_until"},
			&core.TextField{Name: "signed_payload", Required: true},
			&core.TextField{Name: "signature", Required: true},
			&core.TextField{Name: "paddle_sub_id"},
		)
		subscriptions.CreateRule = types.Pointer("")
		subscriptions.ListRule = types.Pointer("")
		subscriptions.ViewRule = types.Pointer("")
		subscriptions.UpdateRule = types.Pointer("")
		if err := app.Save(subscriptions); err != nil {
			t.Fatalf("failed to create subscriptions collection: %v", err)
		}
	}
}

// setupDirectAppWithoutCollection creates a TestApp and ServeEvent with all
// collections EXCEPT the ones listed in skip. This is used to test the
// "server misconfiguration" error paths in the handlers.
func setupDirectAppWithoutCollection(t *testing.T, skip map[string]bool) (*tests.TestApp, *core.ServeEvent) {
	t.Helper()

	// Detach stale SQLite handles from prior tests now that this
	// test creates its own TestApp. Without this, the previous
	// test's closed tests.TestApp would still be referenced by
	// tracker.db; any handler call here would panic at the driver
	// level (mitigated downstream by defer/recover on persist
	// calls, but cleaner at the test boundary).
	resetRateLimiters()

	initPrivateKey(t)

	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("failed to create test app: %v", err)
	}

	createMinimalCollections(t, app, skip)

	// Register routes manually instead of using registerTestRoutes so that
	// we match the same set of collections the handler expects.
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.POST("/api/v1/license/activate", handleActivate(app))
		se.Router.POST("/api/v1/license/renew", handleRenew(app))
		se.Router.POST("/api/v1/license/status", handleStatus(app))
		se.Router.POST("/api/v1/web/contact", handleContact(app))
		se.Router.POST("/api/v1/web/request-otp", handleRequestOTP(app))
		se.Router.POST("/api/v1/web/verify-otp", handleVerifyOTP(app))
		se.Router.POST("/api/v1/web/login", handleLoginPassword(app))
		se.Router.POST("/api/v1/web/set-password", handleSetPassword(app))
		se.Router.POST("/api/v1/web/register", handleRegister(app))
		se.Router.POST("/api/v1/web/request-password-reset", handleRequestPasswordReset(app))
		se.Router.POST("/api/v1/web/reset-password", handleResetPassword(app))
		se.Router.GET("/api/v1/web/me", handleMe(app))
		se.Router.POST("/api/v1/web/logout", handleLogout(app))
		se.Router.POST(paddleWebhookPath, handlePaddleWebhook(app))
		return se.Next()
	})

	router, err := apis.NewRouter(app)
	if err != nil {
		t.Fatalf("failed to create router: %v", err)
	}

	se := &core.ServeEvent{
		App:    app,
		Router: router,
	}

	if err := app.OnServe().Trigger(se, func(e *core.ServeEvent) error {
		return nil
	}); err != nil {
		t.Fatalf("OnServe trigger failed: %v", err)
	}

	return app, se
}

// seedSubscription inserts a subscription record directly via app.Save
// (bypassing ApiScenario transaction isolation). Only use with setupDirectApp.
func seedSubscription(t *testing.T, app *tests.TestApp, tenantID, tierKey, status string) {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("subscriptions")
	if err != nil {
		t.Fatalf("subscriptions collection not found: %v", err)
	}
	rec := core.NewRecord(col)
	// Relation fields store as JSON arrays; supply as []string to match
	// PocketBase's internal JSON_EXTRACT filter resolution.
	rec.Set("tenant_id", []string{tenantID})
	rec.Set("tier_key", tierKey)
	rec.Set("max_stores", 5)
	rec.Set("max_pos_instances", 3)
	rec.Set("allowed_types", `["restaurant-pos", "store-pos"]`)
	rec.Set("status", status)
	rec.Set("starts_at", time.Now().UTC().Format(time.RFC3339))
	rec.Set("expires_at", time.Now().UTC().AddDate(1, 0, 0).Format(time.RFC3339))
	rec.Set("grace_until", time.Now().UTC().AddDate(1, 0, 14).Format(time.RFC3339))
	rec.Set("signed_payload", "{}")
	rec.Set("signature", "dummy-sig")
	if err := app.Save(rec); err != nil {
		t.Fatalf("failed to seed subscription for %q: %v", tenantID, err)
	}
}

// seedSubscriptionWithLimits is seedSubscription with caller-supplied
// per-tier quota fields. Used by M5-audit tests to seed an active
// Enterprise subscription at non-default limits, before renewing with
// a Pro key to verify the Enterprise→Pro downgrade path.
func seedSubscriptionWithLimits(t *testing.T, app *tests.TestApp, tenantID, tierKey, status string, maxStores, maxPOSInstances int, allowedTypes string) {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("subscriptions")
	if err != nil {
		t.Fatalf("subscriptions collection not found: %v", err)
	}
	rec := core.NewRecord(col)
	rec.Set("tenant_id", []string{tenantID})
	rec.Set("tier_key", tierKey)
	rec.Set("max_stores", maxStores)
	rec.Set("max_pos_instances", maxPOSInstances)
	rec.Set("allowed_types", allowedTypes)
	rec.Set("status", status)
	rec.Set("starts_at", time.Now().UTC().Format(time.RFC3339))
	rec.Set("expires_at", time.Now().UTC().AddDate(1, 0, 0).Format(time.RFC3339))
	rec.Set("grace_until", time.Now().UTC().AddDate(1, 0, 14).Format(time.RFC3339))
	rec.Set("signed_payload", "{}")
	rec.Set("signature", "dummy-sig")
	if err := app.Save(rec); err != nil {
		t.Fatalf("failed to seed subscription for %q: %v", tenantID, err)
	}
}

func seedLicenseKey(t *testing.T, app *tests.TestApp, key, tierKey, status, expiresAt string) {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("license_keys")
	if err != nil {
		t.Fatalf("license_keys collection not found: %v", err)
	}
	rec := core.NewRecord(col)
	rec.Set("key", key)
	rec.Set("tier_key", tierKey)
	rec.Set("max_stores", 5)
	rec.Set("max_pos_instances", 3)
	rec.Set("allowed_types", `["restaurant-pos", "store-pos"]`)
	rec.Set("status", status)
	rec.Set("expires_at", expiresAt)
	if err := app.Save(rec); err != nil {
		t.Fatalf("failed to seed license key %q: %v", key, err)
	}
}

// seedLicenseKeyWithLimits is seedLicenseKey with caller-supplied
// per-tier quota fields (max_stores, max_pos_instances, allowed_types).
// Used by M5-audit tests to express distinct limits per key so the
// handler's fix (source quotas from NEW key, not OLD sub) can be
// unambiguously observed.
func seedLicenseKeyWithLimits(t *testing.T, app *tests.TestApp, key, tierKey, status, expiresAt string, maxStores, maxPOSInstances int, allowedTypes string) {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("license_keys")
	if err != nil {
		t.Fatalf("license_keys collection not found: %v", err)
	}
	rec := core.NewRecord(col)
	rec.Set("key", key)
	rec.Set("tier_key", tierKey)
	rec.Set("max_stores", maxStores)
	rec.Set("max_pos_instances", maxPOSInstances)
	rec.Set("allowed_types", allowedTypes)
	rec.Set("status", status)
	rec.Set("expires_at", expiresAt)
	if err := app.Save(rec); err != nil {
		t.Fatalf("failed to seed license key %q: %v", key, err)
	}
}

// seedTrialKey seeds a segmented-trial license key (license_keys.is_trial =
// true). Trial activation mints a short Plus/Pro license from the request's
// trial_vertical, ignoring the key's own tier/quota defaults (C2.1).
func seedTrialKey(t *testing.T, app *tests.TestApp, key, tierKey, status, expiresAt string) {
	t.Helper()
	seedLicenseKey(t, app, key, tierKey, status, expiresAt)
	rec, err := app.FindFirstRecordByData("license_keys", "key", key)
	if err != nil {
		t.Fatalf("seeded trial key %q not found: %v", key, err)
	}
	rec.Set("is_trial", true)
	if err := app.Save(rec); err != nil {
		t.Fatalf("failed to mark trial key %q: %v", key, err)
	}
}

// ── Tests: Status Handler ────────────────────────────────────────

// TestStatusHandler_UnknownAPIKey verifies that a request with an api_key
// that does not match any tenant in the database returns 401, not 404.
// This is the C1-audit successor to the old TestStatusHandler_TenantNotFound:
// with Bearer authentication, the server can no longer leak whether a given
// tenant_id vs. api_key-vs-tenant combination is "valid".
func TestStatusHandler_UnknownAPIKey(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/license/status", nil)
	req.Header.Set("Authorization", "Bearer notarealapikey0001")
	rec := httptest.NewRecorder()
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "invalid api_key") {
		t.Errorf("expected 'invalid api_key' in response, got: %s", rec.Body.String())
	}
}

func TestStatusHandler_TenantNoSubscription(t *testing.T) {
	// Seeds a tenant without any subscription — handler should return
	// fallback response with active:false and tier:"unknown".
	// Auth happens via Bearer header (C1 audit fix); no path or query
	// parameters carry credentials.
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTenant(t, app, "nosubtest000001", "nosubapikey0001", "active")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/license/status", nil)
	req.Header.Set("Authorization", "Bearer nosubapikey0001")
	rec := httptest.NewRecorder()
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if body["tenant_id"] != "nosubtest000001" {
		t.Errorf("expected tenant_id 'nosubtest000001', got %v", body["tenant_id"])
	}
	if body["active"] != false {
		t.Errorf("expected active=false, got %v", body["active"])
	}
	if body["tier"] != "unknown" {
		t.Errorf("expected tier 'unknown', got %v", body["tier"])
	}
}

// TestStatusHandler_RateLimited verifies that /status shares the persisted
// 5-per-IP-per-hour token bucket (it used to be completely unthrottled,
// letting an attacker hammer the bcrypt verification without touching the
// activate/renew budget). The bucket is drained BEFORE auth — like
// /activate and /renew — so failed attempts cannot bypass the limiter.
func TestStatusHandler_RateLimited(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	const tenantID = "statusratelim01" // 15 chars (PocketBase implicit id field)
	const apiKey = "statusratekey0001"
	seedTenant(t, app, tenantID, apiKey, "active")
	seedSubscriptionStatus(t, app, tenantID, "pro", "active", time.Now().AddDate(0, -1, 0))

	mux, _ := se.Router.BuildMux()

	// First 5 calls in the hour succeed (each consumes a token).
	for i := 1; i <= 5; i++ {
		req := httptest.NewRequest("POST", "/api/v1/license/status", nil)
		req.Header.Set("Authorization", "Bearer "+apiKey)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("call %d should succeed, got %d: %s", i, rec.Code, rec.Body.String())
		}
	}

	// The 6th call in the hour is rejected with 429.
	req := httptest.NewRequest("POST", "/api/v1/license/status", nil)
	req.Header.Set("Authorization", "Bearer "+apiKey)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 on the 6th call, got %d: %s", rec.Code, rec.Body.String())
	}
}

// ── Tests: Activate Handler ──────────────────────────────────────

func TestActivateHandler_MissingFields(t *testing.T) {
	runScenario(t, &tests.ApiScenario{
		Method: "POST",
		URL:    "/api/v1/license/activate",
		Body:   strings.NewReader(`{}`),
		// A present (but irrelevant) Bearer header lets the request past
		// auth so it hits the required-field validation (the header-only
		// auth would otherwise 401 first on a credential-less request).
		Headers:         map[string]string{"Authorization": "Bearer dummy"},
		ExpectedStatus:  400,
		ExpectedContent: []string{`"error"`, "required"},
	})
}

func TestActivateHandler_InvalidKey(t *testing.T) {
	runScenario(t, &tests.ApiScenario{
		Method: "POST",
		URL:    "/api/v1/license/activate",
		Body: strings.NewReader(`{
			"key": "OZINVALIDKEY001",
			"email": "testactivate001@example.com",
			"machine_id": "machinetest0001"
		}`),
		ExpectedStatus:  401,
		ExpectedContent: []string{`"error"`},
	})
}

func TestActivateHandler_InvalidJSON(t *testing.T) {
	runScenario(t, &tests.ApiScenario{
		Method:          "POST",
		URL:             "/api/v1/license/activate",
		Body:            strings.NewReader(`not json`),
		ExpectedStatus:  400,
		ExpectedContent: []string{`"error"`},
	})
}

func TestActivateHandler_AlreadyUsedKey_WrongEmail(t *testing.T) {
	// Seed a license key with status "activated". With a non-matching email, handler should return 401.
	runScenario(t, &tests.ApiScenario{
		Method: "POST",
		URL:    "/api/v1/license/activate",
		Body: strings.NewReader(`{
			"key": "OZ-USED-KEY-00001",
			"email": "wrongemail@example.com",
			"machine_id": "usedmachin00001"
		}`),
		Headers:         map[string]string{"Authorization": "Bearer dummy"},
		ExpectedStatus:  401,
		ExpectedContent: []string{`"error"`, "invalid or already used license key"},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedLicenseKey(t.(*testing.T), app,
				"OZ-USED-KEY-00001", "pro", "activated",
				"2099-12-31 23:59:59.000Z")
		},
	})
}

func TestActivateHandler_ExpiredKey(t *testing.T) {
	// Seed an unused but expired license key — handler should return 410.
	runScenario(t, &tests.ApiScenario{
		Method: "POST",
		URL:    "/api/v1/license/activate",
		Body: strings.NewReader(`{
			"key": "OZ-EXPIRED-KEY01",
			"email": "expiredkeytes001@example.com",
			"machine_id": "expmachint00001"
		}`),
		Headers:         map[string]string{"Authorization": "Bearer dummy"},
		ExpectedStatus:  410,
		ExpectedContent: []string{`"error"`, "expired"},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedLicenseKey(t.(*testing.T), app,
				"OZ-EXPIRED-KEY01", "pro", "unused",
				"2020-01-01 00:00:00.000Z")
		},
	})
}

func TestActivateHandler_RevokedKey(t *testing.T) {
	// Seed a revoked license key — handler should return 401.
	runScenario(t, &tests.ApiScenario{
		Method: "POST",
		URL:    "/api/v1/license/activate",
		Body: strings.NewReader(`{
			"key": "OZ-REVOKED-KEY01",
			"email": "revokedkeyte0001@example.com",
			"machine_id": "revmachint00001"
		}`),
		Headers:         map[string]string{"Authorization": "Bearer dummy"},
		ExpectedStatus:  401,
		ExpectedContent: []string{`"error"`, "already used"},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedLicenseKey(t.(*testing.T), app,
				"OZ-REVOKED-KEY01", "pro", "revoked",
				"2099-12-31 23:59:59.000Z")
		},
	})
}

// ── Tests: Renew Handler ─────────────────────────────────────────

func TestRenewHandler_MissingFields(t *testing.T) {
	runScenario(t, &tests.ApiScenario{
		Method: "POST",
		URL:    "/api/v1/license/renew",
		Body:   strings.NewReader(`{}`),
		// A present (but irrelevant) Bearer header lets the request past
		// auth so it hits the required-field validation (the header-only
		// auth would otherwise 401 first on a credential-less request).
		Headers:         map[string]string{"Authorization": "Bearer dummy"},
		ExpectedStatus:  400,
		ExpectedContent: []string{`"error"`, "required"},
	})
}

func TestRenewHandler_InvalidAPIKey(t *testing.T) {
	runScenario(t, &tests.ApiScenario{
		Method: "POST",
		URL:    "/api/v1/license/renew",
		Body: strings.NewReader(`{
			"tenant_id": "tsxinvalid00001",
			"key": "OZ-RENEW-KEY"
		}`),
		// Send the invalid key via the header so the test exercises the
		// invalid-key path (not the missing-credential path).
		Headers:         map[string]string{"Authorization": "Bearer invalidkey00001"},
		ExpectedStatus:  401,
		ExpectedContent: []string{`"error"`},
	})
}

func TestRenewHandler_InvalidJSON(t *testing.T) {
	runScenario(t, &tests.ApiScenario{
		Method:          "POST",
		URL:             "/api/v1/license/renew",
		Body:            strings.NewReader(`not json`),
		ExpectedStatus:  400,
		ExpectedContent: []string{`"error"`},
	})
}

func TestRenewHandler_WrongTenantID(t *testing.T) {
	resetRateLimiters()
	// Seed a tenant with api_key "wrongapik000001" and id "wrongtenant0002",
	// then send a request with a different tenant_id.
	// The handler should authenticate via api_key but reject the mismatched tenant_id.
	runScenario(t, &tests.ApiScenario{
		Method: "POST",
		URL:    "/api/v1/license/renew",
		Body: strings.NewReader(`{
			"tenant_id": "wrongtenant0001",
			"key": "OZ-RENEW-KEY"
		}`),
		Headers:         map[string]string{"Authorization": "Bearer wrongapik000001"},
		ExpectedStatus:  401,
		ExpectedContent: []string{`tenant_id does not match api_key`},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedTenant(t.(*testing.T), app, "wrongtenant0002", "wrongapik000001", "active")
		},
	})
}

func TestRenewHandler_SuspendedTenant(t *testing.T) {
	resetRateLimiters()
	// Seed a tenant with status "suspended" — the handler should reject renewal.
	runScenario(t, &tests.ApiScenario{
		Method: "POST",
		URL:    "/api/v1/license/renew",
		Body: strings.NewReader(`{
			"tenant_id": "susptest0000001",
			"key": "OZ-RENEW-KEY"
		}`),
		Headers:         map[string]string{"Authorization": "Bearer suspapikey00001"},
		ExpectedStatus:  401,
		ExpectedContent: []string{`not active`},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedTenant(t.(*testing.T), app, "susptest0000001", "suspapikey00001", "suspended")
		},
	})
}

// ── Direct Tests (bypass ApiScenario for subscription lookups) ───
//
// These tests use setupDirectApp (apis.NewRouter + OnServe.Trigger) instead
// of ApiScenario because ApiScenario's transaction isolation prevents
// FindRecordsByFilter on relation fields (subscriptions.tenant_id) from
// seeing records seeded in BeforeTestFunc.

func TestStatusHandler_WithSubscription(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	// Seed tenant + subscription directly on the app.
	seedTenant(t, app, "stathappy000001", "stathappykey001", "active")
	seedSubscription(t, app, "stathappy000001", "pro", "active")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/license/status", nil)
	req.Header.Set("Authorization", "Bearer stathappykey001")
	rec := httptest.NewRecorder()
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	if body["tier"] != "pro" {
		t.Errorf("expected tier 'pro', got %v", body["tier"])
	}
	if body["active"] != true {
		t.Errorf("expected active=true, got %v", body["active"])
	}
	if body["tenant_id"] != "stathappy000001" {
		t.Errorf("expected tenant_id, got %v", body["tenant_id"])
	}
	if _, ok := body["expires_at"]; !ok {
		t.Error("expected expires_at in response")
	}
	if _, ok := body["grace_until"]; !ok {
		t.Error("expected grace_until in response")
	}
	// 1g dual-emit: the status endpoint serves both wire names with the
	// same value until the client fleet has rotated. seedSubscription
	// stores max_stores=5.
	if body["max_locations"] != float64(5) {
		t.Errorf("expected max_locations 5, got %v", body["max_locations"])
	}
	if body["max_stores"] != float64(5) {
		t.Errorf("expected legacy max_stores 5, got %v", body["max_stores"])
	}
}

// resetLimiterBuckets clears only the in-memory rate-limiter buckets,
// WITHOUT detaching the SQLite DB handle. Unlike resetRateLimiters (which
// nils out .db so the next attachPersistence binds to a fresh app), this is
// safe to call between subtests that SHARE one TestApp — it lets repeated
// requests pass the limiter while keeping the app's persistence attached.
func resetLimiterBuckets() {
	ipRateLimiter.mu.Lock()
	ipRateLimiter.buckets = make(map[string]*tokenBucket)
	ipRateLimiter.mu.Unlock()

	contactRateLimiter.mu.Lock()
	contactRateLimiter.buckets = make(map[string]*tokenBucket)
	contactRateLimiter.mu.Unlock()

	webLoginLimiter.mu.Lock()
	webLoginLimiter.entries = make(map[string]*windowEntry)
	webLoginLimiter.mu.Unlock()
	otpRequestLimiter.mu.Lock()
	otpRequestLimiter.entries = make(map[string]*windowEntry)
	otpRequestLimiter.mu.Unlock()
	otpVerifyLimiter.mu.Lock()
	otpVerifyLimiter.entries = make(map[string]*windowEntry)
	otpVerifyLimiter.mu.Unlock()
	otpIPLimiter.mu.Lock()
	otpIPLimiter.entries = make(map[string]*windowEntry)
	otpIPLimiter.mu.Unlock()
	webRegisterLimiter.mu.Lock()
	webRegisterLimiter.entries = make(map[string]*windowEntry)
	webRegisterLimiter.mu.Unlock()
	webResetRequestLimiter.mu.Lock()
	webResetRequestLimiter.entries = make(map[string]*windowEntry)
	webResetRequestLimiter.mu.Unlock()
	webResetVerifyLimiter.mu.Lock()
	webResetVerifyLimiter.entries = make(map[string]*windowEntry)
	webResetVerifyLimiter.mu.Unlock()
	exchangeConsumeLimiter.mu.Lock()
	exchangeConsumeLimiter.entries = make(map[string]*windowEntry)
	exchangeConsumeLimiter.mu.Unlock()
}

// ── Test infrastructure: shared-app helpers ──────────────────────
//
// sharedApp wraps one TestApp that multiple subtests reuse, cutting the
// per-subtest setup cost (each newTestApp + createTestCollections +
// registerTestRoutes is ~250ms). resetLimiterBuckets() (above) clears
// only in-memory limiter state between subtests without detaching the
// app's SQLite handle.

func resetRateLimiters() {
	ipRateLimiter.stop()
	keyFailTracker.stop()
	contactRateLimiter.stop()

	ipRateLimiter.mu.Lock()
	ipRateLimiter.buckets = make(map[string]*tokenBucket)
	// Detach the DB handle so the next attachPersistence binds to its
	// own TestApp rather than holding a dangling pointer to the
	// previous test's (potentially closed) SQLite file.
	ipRateLimiter.db = nil
	ipRateLimiter.mu.Unlock()

	keyFailTracker.mu.Lock()
	keyFailTracker.failures = make(map[string]*keyFailures)
	keyFailTracker.db = nil
	keyFailTracker.mu.Unlock()

	contactRateLimiter.mu.Lock()
	contactRateLimiter.buckets = make(map[string]*tokenBucket)
	// contactRateLimiter is intentionally in-memory only (see contact.go).
	contactRateLimiter.db = nil
	contactRateLimiter.mu.Unlock()

	// Web OTP stores + windowed limiters (web_otp.go) are in-memory and
	// keyed by email/IP — clear them so tests start from a clean slate.
	webOtpStore.mu.Lock()
	webOtpStore.codes = make(map[string]*otpCode)
	webOtpStore.sessions = make(map[string]*webSession)
	webOtpStore.mu.Unlock()

	otpRequestLimiter.mu.Lock()
	otpRequestLimiter.entries = make(map[string]*windowEntry)
	otpRequestLimiter.mu.Unlock()
	otpVerifyLimiter.mu.Lock()
	otpVerifyLimiter.entries = make(map[string]*windowEntry)
	otpVerifyLimiter.mu.Unlock()
	otpIPLimiter.mu.Lock()
	otpIPLimiter.entries = make(map[string]*windowEntry)
	otpIPLimiter.mu.Unlock()
	webLoginLimiter.mu.Lock()
	webLoginLimiter.entries = make(map[string]*windowEntry)
	webLoginLimiter.mu.Unlock()
	webRegisterLimiter.mu.Lock()
	webRegisterLimiter.entries = make(map[string]*windowEntry)
	webRegisterLimiter.mu.Unlock()
	webResetRequestLimiter.mu.Lock()
	webResetRequestLimiter.entries = make(map[string]*windowEntry)
	webResetRequestLimiter.mu.Unlock()
	webResetVerifyLimiter.mu.Lock()
	webResetVerifyLimiter.entries = make(map[string]*windowEntry)
	webResetVerifyLimiter.mu.Unlock()
	exchangeConsumeLimiter.mu.Lock()
	exchangeConsumeLimiter.entries = make(map[string]*windowEntry)
	exchangeConsumeLimiter.mu.Unlock()

	// Escalating brute-force login lockout (login_lockout.go) — clear so
	// tests that exercise repeated failed attempts start from a clean slate.
	loginLockoutTrackerInst.mu.Lock()
	loginLockoutTrackerInst.entries = make(map[string]*loginFailures)
	loginLockoutTrackerInst.db = nil
	loginLockoutTrackerInst.mu.Unlock()

	// LSE-11 limiters: the rotation cooldown and recovery budget clear too.
	// Tests that must preserve one across a reset (e.g. the recovery cycle
	// test asserting the 24h rotation cooldown) use targeted resets instead.
	apiRotationLimiter.mu.Lock()
	apiRotationLimiter.entries = make(map[string]*windowEntry)
	apiRotationLimiter.mu.Unlock()
	recoverLimiter.mu.Lock()
	recoverLimiter.entries = make(map[string]*windowEntry)
	recoverLimiter.mu.Unlock()

	ipRateLimiter.startCleanup()
	keyFailTracker.startCleanup()
	contactRateLimiter.startCleanup()
}

// resetIPBudget clears only the per-IP activation token bucket, leaving
// webOtpStore.codes and the apiRotationLimiter/recoverLimiter state intact.
// Used by the LSE-11 recovery-cycle test, which must keep the stored
// recovery code and the 24h rotation cooldown across phases.
func resetIPBudget() {
	ipRateLimiter.mu.Lock()
	ipRateLimiter.buckets = make(map[string]*tokenBucket)
	ipRateLimiter.mu.Unlock()
}

func TestRenewHandler_NoSubscription(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	// Seed an active tenant but NO subscription.
	seedTenant(t, app, "rnwsub000000001", "rnwsubkey000001", "active")

	// Need a seeded unused key too so it passes key validation before checking subscriptions
	seedLicenseKey(t, app, "rnwsubkey000001-key", "pro", "unused", "2099-12-31 23:59:59.000Z")

	body := strings.NewReader(`{"tenant_id":"rnwsub000000001","key":"rnwsubkey000001-key"}`)
	req := httptest.NewRequest("POST", "/api/v1/license/renew", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer rnwsubkey000001")
	rec := httptest.NewRecorder()
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "no active subscription found") {
		t.Errorf("expected 'no active subscription found', got: %s", rec.Body.String())
	}
}

func TestRenewHandler_WithSubscription(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	// Seed tenant + active subscription.
	seedTenant(t, app, "rnwhappy0000001", "rnwhappykey0001", "active")
	seedSubscription(t, app, "rnwhappy0000001", "pro", "active")

	// Seed valid unused key for renewal
	seedLicenseKey(t, app, "rnwhappykey0001-key", "pro", "unused", "2099-12-31 23:59:59.000Z")

	body := strings.NewReader(`{"tenant_id":"rnwhappy0000001","key":"rnwhappykey0001-key"}`)
	req := httptest.NewRequest("POST", "/api/v1/license/renew", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer rnwhappykey0001")
	rec := httptest.NewRecorder()
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	if _, ok := resp["signed_payload"]; !ok {
		t.Error("expected signed_payload in response")
	}
	if _, ok := resp["signature"]; !ok {
		t.Error("expected signature in response")
	}

	// Verify the signed payload includes quota fields carried over from the old subscription.
	if payloadStr, ok := resp["signed_payload"].(string); ok {
		var sp SubscriptionPayload
		if err := json.Unmarshal([]byte(payloadStr), &sp); err != nil {
			t.Errorf("failed to parse signed_payload: %v", err)
		} else {
			if sp.MaxLocations != 5 {
				t.Errorf("expected max_locations=5 in renewal payload, got %d", sp.MaxLocations)
			}
			// 1g dual-emit: the legacy wire name must ride along at the same
			// value so pre-rename clients keep parsing the quota.
			if sp.MaxStores != 5 {
				t.Errorf("expected legacy max_stores=5 in renewal payload, got %d", sp.MaxStores)
			}
			if sp.MaxPOSInstances != 3 {
				t.Errorf("expected max_pos_instances=3 in renewal payload, got %d", sp.MaxPOSInstances)
			}
		}
	}

	// Verify old subscription is now expired.
	subs, err := app.FindRecordsByFilter(
		"subscriptions",
		"tenant_id = {:tenant_id}",
		"", 2, 0,
		map[string]any{"tenant_id": "rnwhappy0000001"},
	)
	if err != nil {
		t.Fatalf("failed to query subscriptions: %v", err)
	}
	if len(subs) != 2 {
		t.Fatalf("expected 2 subscriptions, got %d", len(subs))
	}
	// Order is non-deterministic (records may share the same starts_at).
	// Just verify one is active and one is expired.
	var foundActive, foundExpired bool
	for _, s := range subs {
		switch s.GetString("status") {
		case "active":
			foundActive = true
		case "expired":
			foundExpired = true
		}
	}
	if !foundActive {
		t.Error("expected one active subscription after renewal")
	}
	if !foundExpired {
		t.Error("expected one expired subscription after renewal")
	}
}

func TestRenewHandler_PlusTier(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	// Seed tenant + active plus subscription, then a valid unused plus key
	// carrying the plus quota block (1 store / 2 registers, no kds).
	seedTenant(t, app, "rnwplus00000001", "rnwpluskey00001", "active")
	seedSubscription(t, app, "rnwplus00000001", "plus", "active")
	seedLicenseKeyWithLimits(t, app, "rnwpluskey00001-key", "plus", "unused",
		"2099-12-31 23:59:59.000Z", 1, 2, `["restaurant-pos", "store-pos", "admin", "inventory", "warehouse"]`)

	body := strings.NewReader(`{"tenant_id":"rnwplus00000001","key":"rnwpluskey00001-key"}`)
	req := httptest.NewRequest("POST", "/api/v1/license/renew", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer rnwpluskey00001")
	rec := httptest.NewRecorder()
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	payloadStr, ok := resp["signed_payload"].(string)
	if !ok {
		t.Fatal("expected signed_payload in response")
	}

	var sp SubscriptionPayload
	if err := json.Unmarshal([]byte(payloadStr), &sp); err != nil {
		t.Fatalf("failed to parse signed_payload: %v", err)
	}
	if sp.TierKey != "plus" {
		t.Errorf("expected tier_key=plus in renewal payload, got %q", sp.TierKey)
	}
	if sp.MaxLocations != 1 {
		t.Errorf("expected max_locations=1 in renewal payload, got %d", sp.MaxLocations)
	}
	if sp.MaxPOSInstances != 2 {
		t.Errorf("expected max_pos_instances=2 in renewal payload, got %d", sp.MaxPOSInstances)
	}
	// Plus renews for +1 year (same as pro/premium). The seeded active
	// subscription already expires +1y out, so renewal appends another year.
	expiresAt, err := time.Parse(time.RFC3339, sp.ExpiresAt)
	if err != nil {
		t.Fatalf("failed to parse expires_at: %v", err)
	}
	diff := expiresAt.Sub(time.Now().UTC().AddDate(2, 0, 0))
	if diff > time.Hour || diff < -time.Hour {
		t.Errorf("plus renewal expiry should be ~2 years from now, got diff %v", diff)
	}
}

// TestRenewHandler_TierChange_UsesNewKeyLimits verifies the M5-audit fix:
// when a customer churns to a different tier via renewal, the renewed
// subscription's quota fields (max_stores, max_pos_instances, allowed_types)
// MUST come from the NEW license key, not the OLD subscription. Previously
// an upgrade (Pro→Enterprise) silently capped the customer at Pro limits,
// and a downgrade (Enterprise→Pro) silently over-provisioned them at
// Enterprise limits until the next renewal carried the correct values.
func TestRenewHandler_TierChange_UsesNewKeyLimits(t *testing.T) {
	// Reuse ONE app across both subtests — they use distinct tenant IDs,
	// so there is no state collision. Saves ~1 app creation (~0.3s).
	app, se := setupDirectApp(t)
	defer app.Cleanup()
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}

	t.Run("ProToEnterprise_Upgrade", func(t *testing.T) {
		resetLimiterBuckets()

		// Tenant starts on Pro (max_stores=5, max_pos=3, 2 types).
		seedTenant(t, app, "rnwupgradetn001", "rnwupgradetn001-key", "active")
		seedSubscription(t, app, "rnwupgradetn001", "pro", "active")

		// New Enterprise key with HIGHER limits.
		seedLicenseKeyWithLimits(t, app,
			"OZ-RNW-UPG-ENT01",
			"enterprise", "unused", "2099-12-31 23:59:59.000Z",
			20, 10, `["restaurant-pos","store-pos","kds"]`)

		body := strings.NewReader(`{"tenant_id":"rnwupgradetn001","key":"OZ-RNW-UPG-ENT01"}`)
		req := httptest.NewRequest("POST", "/api/v1/license/renew", body)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer rnwupgradetn001-key")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}
		var resp map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to parse response: %v", err)
		}
		var sp SubscriptionPayload
		payloadStr, _ := resp["signed_payload"].(string)
		if err := json.Unmarshal([]byte(payloadStr), &sp); err != nil {
			t.Fatalf("failed to parse signed_payload: %v", err)
		}

		// M5 audit assertion: quotas must come from the NEW Enterprise
		// key, NOT from the OLD Pro subscription (which had 5/3/2).
		if sp.MaxLocations != 20 {
			t.Errorf("Pro→Enterprise upgrade: expected max_locations=20 (from NEW key), got %d", sp.MaxLocations)
		}
		if sp.MaxPOSInstances != 10 {
			t.Errorf("Pro→Enterprise upgrade: expected max_pos_instances=10 (from NEW key), got %d", sp.MaxPOSInstances)
		}
		if len(sp.AllowedTypes) != 3 {
			t.Errorf("Pro→Enterprise upgrade: expected 3 allowed_types (from NEW key), got %v", sp.AllowedTypes)
		}
	})

	t.Run("EnterpriseToPro_Downgrade", func(t *testing.T) {
		resetLimiterBuckets()

		// Tenant starts on Enterprise (max_stores=20, max_pos=10, 3 types).
		seedTenant(t, app, "rnwdowngrade001", "rnwdowngrade001-key", "active")
		seedSubscriptionWithLimits(t, app, "rnwdowngrade001", "enterprise", "active",
			20, 10, `["restaurant-pos","store-pos","kds"]`)

		// New Pro key with LOWER limits.
		seedLicenseKeyWithLimits(t, app,
			"OZ-RNW-DWN-PRO01",
			"pro", "unused", "2099-12-31 23:59:59.000Z",
			5, 3, `["restaurant-pos","store-pos"]`)

		body := strings.NewReader(`{"tenant_id":"rnwdowngrade001","key":"OZ-RNW-DWN-PRO01"}`)
		req := httptest.NewRequest("POST", "/api/v1/license/renew", body)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer rnwdowngrade001-key")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}
		var resp map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to parse response: %v", err)
		}
		var sp SubscriptionPayload
		payloadStr, _ := resp["signed_payload"].(string)
		if err := json.Unmarshal([]byte(payloadStr), &sp); err != nil {
			t.Fatalf("failed to parse signed_payload: %v", err)
		}

		// M5 audit assertion: quotas must come from the NEW Pro key,
		// NOT from the OLD Enterprise subscription (which had 20/10/3).
		if sp.MaxLocations != 5 {
			t.Errorf("Enterprise→Pro downgrade: expected max_locations=5 (from NEW key), got %d", sp.MaxLocations)
		}
		if sp.MaxPOSInstances != 3 {
			t.Errorf("Enterprise→Pro downgrade: expected max_pos_instances=3 (from NEW key), got %d", sp.MaxPOSInstances)
		}
		if len(sp.AllowedTypes) != 2 {
			t.Errorf("Enterprise→Pro downgrade: expected 2 allowed_types (from NEW key), got %v", sp.AllowedTypes)
		}
	})
}

// TestRenewHandler_ConcurrentSameKey_OnlyOneWins verifies the C2/C3 audit
// fix: when N parallel requests try to renew with the SAME license key
// for the SAME tenant, exactly one wins (200 + signed_payload) and the
// others get 401 "invalid or already used license key". The
// activationLocks wrapper around the key-status check in renew.go
// serialises concurrent attempts so the loser goroutines see
// key.status="activated" (saved by the winner) and short-circuit.
//
// Without this lock, two goroutines can both read key.status="unused"
// before either saves "activated", silently granting an extra renewed
// subscription for one key purchase — the worst data-integrity bug in
// the audit. N=5 chosen so all 5 goroutines pass ipRateLimiter.maxPerHr
// (5 tokens/hr per IP) and reach the activationLocks contention.
func TestRenewHandler_ConcurrentSameKey_OnlyOneWins(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	const tenantID = "racerenew000001"
	const apiKey = "racerenewkey00001"
	const newKey = "OZ-RACE-RENEW-01"

	seedTenant(t, app, tenantID, apiKey, "active")
	seedSubscriptionStatus(t, app, tenantID, "pro", "active", time.Now().AddDate(0, -1, 0))
	seedLicenseKey(t, app, newKey, "pro", "unused", "2099-12-31 23:59:59.000Z")

	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}

	const N = 5
	var wg sync.WaitGroup
	var codesMu sync.Mutex
	codes := make([]int, N)
	bodies := make([]string, N)

	// Start-gate: fan out with zero stagger so the 5 goroutines hit
	// the activationLocks window within the same scheduler tick. Without
	// this, per-goroutine spawn-stagger (10s of µs) can let goroutine 1
	// finish its renewal and unlock before goroutine 2 enters, which still
	// proves the lock works but lets the test pass even if the lock were
	// only PARTIALLY effective.
	start := make(chan struct{})

	for i := 0; i < N; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-start
			body := strings.NewReader(
				`{"tenant_id":"racerenew000001","key":"OZ-RACE-RENEW-01"}`)
			req := httptest.NewRequest("POST", "/api/v1/license/renew", body)
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", "Bearer racerenewkey00001")
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)
			codesMu.Lock()
			codes[idx] = rec.Code
			bodies[idx] = rec.Body.String()
			codesMu.Unlock()
		}(i)
	}
	close(start)
	wg.Wait()

	successes, failLose := 0, 0
	var firstWinBody, firstLoseBody string
	for i, c := range codes {
		switch c {
		case http.StatusOK:
			successes++
			if firstWinBody == "" {
				firstWinBody = bodies[i]
			}
		case http.StatusUnauthorized:
			failLose++
			if firstLoseBody == "" {
				firstLoseBody = bodies[i]
			}
		}
	}
	if successes != 1 {
		t.Errorf("expected exactly 1 winning renewal (race winner), got %d — all codes: %v",
			successes, codes)
	}
	if successes+failLose != N {
		t.Errorf("internal: result count %d != N=%d (all codes: %v)",
			successes+failLose, N, codes)
	}
	// Pin the expected error message: the 4 losers should all report
	// "invalid or already used license key" because the winner saved
	// key.status="activated" before their key-record lookup. A regression
	// returning 401 with a different body (e.g. "rate limit") would mean
	// the rate limit caught them — which means the test setup leaked
	// tokens and the lock was bypassed by ordering, not by fixing the
	// race. Catch it explicitly.
	if firstLoseBody != "" && !strings.Contains(firstLoseBody, "invalid or already used") {
		t.Errorf("expected loser body to contain 'invalid or already used license key', got: %s", firstLoseBody)
	}
	if firstWinBody != "" && !strings.Contains(firstWinBody, "signed_payload") {
		t.Errorf("expected winner body to contain 'signed_payload', got: %s", firstWinBody)
	}
}

func TestActivateHandler_RateLimited(t *testing.T) {
	resetRateLimiters()

	app, se := setupDirectApp(t)
	defer app.Cleanup()

	// Exhaust rate limiter for a specific IP. PocketBase's RealIP()
	// parses RemoteAddr via net.SplitHostPort; supply port:IP form.
	testIP := "10.99.99.99"
	testAddr := testIP + ":1234"
	for i := 0; i < ipRateLimiter.maxPerHr; i++ {
		ipRateLimiter.allow(testIP)
	}

	body := strings.NewReader(`{"key":"OZ-RATELIM-KEY01","email":"rlimtenant00001@example.com","machine_id":"rlimmachin00001"}`)
	req := httptest.NewRequest("POST", "/api/v1/license/activate", body)
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = testAddr
	rec := httptest.NewRecorder()
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "rate limit") {
		t.Errorf("expected rate-limit error message, got: %s", rec.Body.String())
	}
}

func TestActivateHandler_KeyBruteForceBlocked(t *testing.T) {
	resetRateLimiters()

	app, se := setupDirectApp(t)
	defer app.Cleanup()

	// Exhaust the key failure tracker — handler checks this before
	// looking up the key, so no seedLicenseKey needed.
	for i := 0; i < keyFailTracker.maxAttempts; i++ {
		keyFailTracker.recordFailure("OZ-BRUTE-KEY001")
	}

	body := strings.NewReader(`{"key":"OZ-BRUTE-KEY001","email":"brutteten00001@example.com","machine_id":"bruttemach00001"}`)
	req := httptest.NewRequest("POST", "/api/v1/license/activate", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "too many attempts") {
		t.Errorf("expected brute-force error message, got: %s", rec.Body.String())
	}
}

func TestActivateHandler_Success(t *testing.T) {
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	// Seed an unused license key.
	seedLicenseKey(t, app, "OZ-HAPPY-KEY0001", "pro", "unused",
		"2099-12-31 23:59:59.000Z")

	body := strings.NewReader(`{
		"key": "OZ-HAPPY-KEY0001",
		"email": "hppytenant00001@example.com",
		"machine_id": "hppymachine0001"
	}`)
	req := httptest.NewRequest("POST", "/api/v1/license/activate", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	if _, ok := resp["signed_payload"]; !ok {
		t.Error("expected signed_payload in response")
	}
	if _, ok := resp["signature"]; !ok {
		t.Error("expected signature in response")
	}
	if _, ok := resp["api_key"]; !ok {
		t.Error("expected api_key in response")
	}

	// Verify the signed payload includes quota fields.
	if payloadStr, ok := resp["signed_payload"].(string); ok {
		var sp SubscriptionPayload
		if err := json.Unmarshal([]byte(payloadStr), &sp); err != nil {
			t.Errorf("failed to parse signed_payload: %v", err)
		} else {
			if sp.MaxLocations != 5 {
				t.Errorf("expected max_locations=5 in payload, got %d", sp.MaxLocations)
			}
			if sp.MaxPOSInstances != 3 {
				t.Errorf("expected max_pos_instances=3 in payload, got %d", sp.MaxPOSInstances)
			}
			if len(sp.AllowedTypes) != 2 || sp.AllowedTypes[0] != "restaurant-pos" || sp.AllowedTypes[1] != "store-pos" {
				t.Errorf("expected allowed_types=[restaurant-pos, store-pos] in payload, got %v", sp.AllowedTypes)
			}
		}
	}

	// Verify tenant was created.
	tenant, err := app.FindFirstRecordByData("tenants", "email", "hppytenant00001@example.com")
	if err != nil {
		t.Fatalf("tenant should be created: %v", err)
	}
	tenantID := tenant.Id
	if tenant.GetString("status") != "active" {
		t.Errorf("tenant status should be active, got %s", tenant.GetString("status"))
	}

	// Verify key was marked activated.
	keyRec, err := app.FindFirstRecordByData("license_keys", "key", "OZ-HAPPY-KEY0001")
	if err != nil {
		t.Fatalf("license key should exist: %v", err)
	}
	if keyRec.GetString("status") != "activated" {
		t.Errorf("key status should be activated, got %s", keyRec.GetString("status"))
	}

	// Verify subscription was created.
	subs, err := app.FindRecordsByFilter(
		"subscriptions",
		"tenant_id = {:tenant_id}",
		"-starts_at", 1, 0,
		map[string]any{"tenant_id": tenantID},
	)
	if err != nil || len(subs) == 0 {
		t.Fatal("subscription should have been created")
	}
	if subs[0].GetString("status") != "active" {
		t.Errorf("subscription status should be active, got %s", subs[0].GetString("status"))
	}
	// Quota block must be persisted on the subscription record (mirrors the
	// signed payload and renew.go's M5-audit fix).
	if subs[0].GetInt("max_stores") != 5 || subs[0].GetInt("max_pos_instances") != 3 {
		t.Errorf("expected quota block persisted on subscription, got max_stores=%d max_pos_instances=%d",
			subs[0].GetInt("max_stores"), subs[0].GetInt("max_pos_instances"))
	}
	if got := subs[0].GetString("allowed_types"); !strings.Contains(got, "store-pos") {
		t.Errorf("expected allowed_types persisted on subscription, got %q", got)
	}

	// Verify machine was registered.
	machines, err := app.FindRecordsByFilter(
		"tenant_machines",
		"tenant_id = {:tenant_id}",
		"", 1, 0,
		map[string]any{"tenant_id": tenantID},
	)
	if err != nil || len(machines) == 0 {
		t.Fatal("machine should have been registered")
	}
}

// TestTrialVerticalSegmentation verifies C2.1: trial keys
// (license_keys.is_trial) mint segmented short-duration licenses from the
// request's trial_vertical — blank/unset → 14-day Plus, restaurant/cafe →
// 14-day Pro, enterprise_referral → 30-day Pro — with the tier's quota
// block and a 14-day offline grace (subscription-tiers.md §4).
func TestTrialVerticalSegmentation(t *testing.T) {
	cases := []struct {
		name     string
		vertical string
		tier     string
		days     int
	}{
		{"blank_vertical_mints_plus_14d", "", "plus", 14},
		{"restaurant_vertical_mints_pro_14d", "restaurant", "pro", 14},
		{"cafe_vertical_mints_pro_14d", "cafe", "pro", 14},
		{"enterprise_referral_mints_pro_30d", "enterprise_referral", "pro", 30},
	}

	// Reuse ONE app across all subtests (avoids 4 app creations, ~1s).
	// Each case uses a unique key + email + machine_id, and
	// resetLimiterBuckets() clears only the in-memory limiter state between
	// cases without detaching the shared app's SQLite handle.
	app, se := setupDirectApp(t)
	defer app.Cleanup()
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}

	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resetLimiterBuckets()

			key := fmt.Sprintf("OZ-TRIAL-%04d", i)
			// The key record's own tier is the DEFAULT for blank verticals;
			// a vertical re-segments the minted license regardless of it.
			seedTrialKey(t, app, key, "plus", "unused", "2099-12-31 23:59:59.000Z")

			// Unique machine per case so the shared app doesn't trip the
			// hardware-fingerprint trial lock (SPEC-2026-TRIAL-LOCK).
			machineID := fmt.Sprintf("trialmachin%04d", i)
			body := strings.NewReader(fmt.Sprintf(`{
				"key": %q,
				"email": "trialseg%04d@example.com",
				"machine_id": %q,
				"trial_vertical": %q
			}`, key, i, machineID, tc.vertical))
			req := httptest.NewRequest("POST", "/api/v1/license/activate", body)
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
			}

			var resp map[string]any
			if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
				t.Fatalf("failed to parse response: %v", err)
			}
			payloadStr, ok := resp["signed_payload"].(string)
			if !ok {
				t.Fatal("expected signed_payload in response")
			}

			var sp SubscriptionPayload
			if err := json.Unmarshal([]byte(payloadStr), &sp); err != nil {
				t.Fatalf("failed to parse signed_payload: %v", err)
			}
			if sp.TierKey != tc.tier {
				t.Errorf("vertical %q: expected tier_key=%s, got %q", tc.vertical, tc.tier, sp.TierKey)
			}

			// Quota block must come from the segmented tier, not the key's
			// default (plus = 1 store / 2 registers, pro = unlimited + kds).
			expectedStores, expectedPOS, expectedTypes := tierQuotas(tc.tier, "")
			if sp.MaxLocations != expectedStores {
				t.Errorf("vertical %q: expected max_locations=%d, got %d", tc.vertical, expectedStores, sp.MaxLocations)
			}
			if sp.MaxPOSInstances != expectedPOS {
				t.Errorf("vertical %q: expected max_pos_instances=%d, got %d", tc.vertical, expectedPOS, sp.MaxPOSInstances)
			}
			if !slices.Equal(sp.AllowedTypes, expectedTypes) {
				t.Errorf("vertical %q: expected allowed_types=%v, got %v", tc.vertical, expectedTypes, sp.AllowedTypes)
			}

			// Expiry is now + days; grace is expiry + 14 days.
			expiresAt, err := time.Parse(time.RFC3339, sp.ExpiresAt)
			if err != nil {
				t.Fatalf("failed to parse expires_at: %v", err)
			}
			expDiff := expiresAt.Sub(time.Now().UTC().AddDate(0, 0, tc.days))
			if expDiff > time.Hour || expDiff < -time.Hour {
				t.Errorf("vertical %q: expected expiry ~%d days from now, got %v (diff %v)", tc.vertical, tc.days, expiresAt, expDiff)
			}
			graceUntil, err := time.Parse(time.RFC3339, sp.GraceUntil)
			if err != nil {
				t.Fatalf("failed to parse grace_until: %v", err)
			}
			graceDiff := graceUntil.Sub(expiresAt.AddDate(0, 0, 14))
			if graceDiff > time.Minute || graceDiff < -time.Minute {
				t.Errorf("vertical %q: expected grace_until = expiry + 14d, got diff %v", tc.vertical, graceDiff)
			}

			// The key is consumed and the subscription persisted with the
			// segmented tier.
			keyRec, err := app.FindFirstRecordByData("license_keys", "key", key)
			if err != nil {
				t.Fatalf("trial key not found: %v", err)
			}
			if keyRec.GetString("status") != "activated" {
				t.Errorf("expected key status activated, got %q", keyRec.GetString("status"))
			}
			subs, err := app.FindRecordsByFilter(
				"subscriptions",
				"tier_key = {:tier}",
				"", 1, 0,
				map[string]any{"tier": tc.tier},
			)
			if err != nil || len(subs) == 0 {
				t.Fatalf("expected a persisted %s subscription, err=%v", tc.tier, err)
			}
		})
	}
}

// TestSignedPayload_CarriesTrialState verifies Phase C (todo-global-saas-2
// md, "trial state, client-visible"): a trial-key activation publishes
// is_trial and trial_ends_at INSIDE the signed payload, so the client can
// render trial UI without the tier collapse throwing the fact away
// (SubscriptionTier::from_db("trial") => Free stays the quota answer).
// trial_ends_at must be valid RFC3339 and the trial's own deadline — the
// same instant as expires_at, not a billing period.
func TestSignedPayload_CarriesTrialState(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}

	seedTrialKey(t, app, "OZ-TRIALPC-001", "plus", "unused", "2099-12-31 23:59:59.000Z")
	body := strings.NewReader(`{
		"key": "OZ-TRIALPC-001",
		"email": "trialphasec001@example.com",
		"machine_id": "trialpcmach0001",
		"trial_vertical": ""
	}`)
	req := httptest.NewRequest("POST", "/api/v1/license/activate", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	payloadStr, ok := resp["signed_payload"].(string)
	if !ok {
		t.Fatal("expected signed_payload in response")
	}

	// Assert on the RAW JSON, not just a decoded struct: a key that is
	// absent and a key that is present-but-false are the same answer to the
	// client but different claims about what the server actually emitted.
	var raw map[string]any
	if err := json.Unmarshal([]byte(payloadStr), &raw); err != nil {
		t.Fatalf("failed to parse signed_payload: %v", err)
	}
	if v, present := raw["is_trial"]; !present {
		t.Error("trial payload must carry is_trial")
	} else if v != true {
		t.Errorf("expected is_trial=true, got %v", v)
	}
	endRaw, present := raw["trial_ends_at"]
	if !present {
		t.Fatal("trial payload must carry trial_ends_at")
	}
	endStr, isStr := endRaw.(string)
	if !isStr {
		t.Fatalf("expected trial_ends_at to be a string, got %T", endRaw)
	}

	var sp SubscriptionPayload
	if err := json.Unmarshal([]byte(payloadStr), &sp); err != nil {
		t.Fatalf("failed to parse signed_payload: %v", err)
	}
	if !sp.IsTrial {
		t.Error("decoded IsTrial must be true for a trial key")
	}
	endAt, err := time.Parse(time.RFC3339, endStr)
	if err != nil {
		t.Fatalf("trial_ends_at must be RFC3339, got %q: %v", endStr, err)
	}
	expAt, err := time.Parse(time.RFC3339, sp.ExpiresAt)
	if err != nil {
		t.Fatalf("failed to parse expires_at: %v", err)
	}
	if d := endAt.Sub(expAt); d > time.Second || d < -time.Second {
		t.Errorf("trial_ends_at (%v) must be the trial's own expiry (%v), diff %v", endAt, expAt, d)
	}
	// Blank vertical mints a 14-day Plus trial (§4), so the deadline is
	// ~14 days out — proving it tracked the segmented trial length rather
	// than the key's own expiry (seeded at 2099).
	if d := time.Until(endAt); d < 13*24*time.Hour || d > 15*24*time.Hour {
		t.Errorf("expected trial_ends_at ~14 days out, got %v", d)
	}
}

// TestSignedPayload_PaidKeyOmitsTrialFields verifies the other half of
// Phase C: a paid activation carries NEITHER field. Both are omitempty, so
// a paid payload is byte-identical to a pre-Phase-C payload and the client
// needs no dual-read — "absent" and "not a trial" are one code path.
func TestSignedPayload_PaidKeyOmitsTrialFields(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}

	seedLicenseKey(t, app, "OZ-PAIDPC-001", "pro", "unused", "2099-12-31 23:59:59.000Z")
	body := strings.NewReader(`{
		"key": "OZ-PAIDPC-001",
		"email": "paidphasec001@example.com",
		"machine_id": "paidpcmach0001"
	}`)
	req := httptest.NewRequest("POST", "/api/v1/license/activate", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	payloadStr, ok := resp["signed_payload"].(string)
	if !ok {
		t.Fatal("expected signed_payload in response")
	}
	if strings.Contains(payloadStr, "is_trial") {
		t.Errorf("paid payload must not carry is_trial: %s", payloadStr)
	}
	if strings.Contains(payloadStr, "trial_ends_at") {
		t.Errorf("paid payload must not carry trial_ends_at: %s", payloadStr)
	}

	var sp SubscriptionPayload
	if err := json.Unmarshal([]byte(payloadStr), &sp); err != nil {
		t.Fatalf("failed to parse signed_payload: %v", err)
	}
	if sp.IsTrial {
		t.Error("a paid key must never decode as a trial")
	}
	if sp.TrialEndsAt != "" {
		t.Errorf("expected empty TrialEndsAt, got %q", sp.TrialEndsAt)
	}
	// The paid period's own expiry is untouched by the new fields.
	if _, err := time.Parse(time.RFC3339, sp.ExpiresAt); err != nil {
		t.Errorf("paid expires_at must still be RFC3339: %v", err)
	}
}

// TestTrialVerticalSegmentation_PaidKeyIgnored verifies the C2.1 security
// gate: trial_vertical is read ONLY for trial keys. A paid key activated
// with trial_vertical="restaurant" must keep its own tier, quota block,
// and +1y expiry — a client-supplied parameter must never shorten or
// downgrade a paying customer's license.
func TestTrialVerticalSegmentation_PaidKeyIgnored(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedLicenseKeyWithLimits(t, app, "OZ-PAID-TRIAL-001", "pro", "unused",
		"2099-12-31 23:59:59.000Z", 5, 3, `["restaurant-pos","store-pos"]`)

	body := strings.NewReader(`{
		"key": "OZ-PAID-TRIAL-001",
		"email": "paidtrial0001@example.com",
		"machine_id": "trialmachin0001",
		"trial_vertical": "restaurant"
	}`)
	req := httptest.NewRequest("POST", "/api/v1/license/activate", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	payloadStr, _ := resp["signed_payload"].(string)
	var sp SubscriptionPayload
	if err := json.Unmarshal([]byte(payloadStr), &sp); err != nil {
		t.Fatalf("failed to parse signed_payload: %v", err)
	}

	// The key's own tier/quota/expiry win — the forged vertical is ignored.
	if sp.TierKey != "pro" {
		t.Errorf("paid key must keep tier pro, got %q", sp.TierKey)
	}
	if sp.MaxLocations != 5 {
		t.Errorf("paid key must keep max_locations=5, got %d", sp.MaxLocations)
	}
	if sp.MaxPOSInstances != 3 {
		t.Errorf("paid key must keep max_pos_instances=3, got %d", sp.MaxPOSInstances)
	}
	expiresAt, err := time.Parse(time.RFC3339, sp.ExpiresAt)
	if err != nil {
		t.Fatalf("failed to parse expires_at: %v", err)
	}
	expDiff := expiresAt.Sub(time.Now().UTC().AddDate(1, 0, 0))
	if expDiff > time.Hour || expDiff < -time.Hour {
		t.Errorf("paid key must keep +1y expiry (calculateExpiry(pro)), got diff %v", expDiff)
	}
}

// TestActivateHandler_ExistingTenantRequiresAPIKey verifies the H1-audit gate:
// an activation request that targets an EXISTING tenant but supplies no
// api_key must be rejected with 401. Without this gate, anyone who knew
// a tenant's email + a valid license key could exfiltrate the tenant's
// signed_payload (which is sufficient to forge a working offline license
// until expires_at, since the Rust client verifies the RSA signature
// locally and trusts the payload).
func TestActivateHandler_ExistingTenantRequiresAPIKey(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	// Seed a pre-existing tenant with a known api_key.
	seedTenant(t, app, "existtenan00001", "existapikey0001", "active")

	// Seed an unused license key.
	seedLicenseKey(t, app, "OZ-EXIST-KEY001", "pro", "unused",
		"2099-12-31 23:59:59.000Z")

	// Activate with the existing tenant's email but NO api_key.
	// Must be rejected (H1 audit fix).
	body := strings.NewReader(`{
		"key": "OZ-EXIST-KEY001",
		"email": "existtenan00001@example.com",
		"machine_id": "existmachin0001"
	}`)
	req := httptest.NewRequest("POST", "/api/v1/license/activate", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 (H1 gate), got %d: %s", rec.Code, rec.Body.String())
	}
	// Must not reveal which factor failed (email-existing vs. api_key-mismatch).
	if !strings.Contains(rec.Body.String(), "api_key required") {
		t.Errorf("expected 'api_key required' error, got: %s", rec.Body.String())
	}
}

// TestActivateHandler_ExistingTenantRejectsWrongAPIKey verifies that supplying
// any wrong api_key against an existing tenant is rejected with 401, regardless
// of whether the api_key is missing, malformed, or belongs to a different
// tenant. This guarantees the gate cannot be bypassed by guessing.
func TestActivateHandler_ExistingTenantRejectsWrongAPIKey(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTenant(t, app, "wrongkeyten0001", "correctkey0000001", "active")
	seedLicenseKey(t, app, "OZ-WRONGKEY-001", "pro", "unused",
		"2099-12-31 23:59:59.000Z")

	body := strings.NewReader(`{
		"key": "OZ-WRONGKEY-001",
		"email": "wrongkeyten0001@example.com",
		"machine_id": "wrongkeymach001",
		"api_key": "this-is-the-wrong-key00"
	}`)
	req := httptest.NewRequest("POST", "/api/v1/license/activate", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 (wrong api_key), got %d: %s", rec.Code, rec.Body.String())
	}
	// Do NOT leak the real api_key (or any other tenant-record field) on failure.
	bodyStr := rec.Body.String()
	if strings.Contains(bodyStr, "correctkey0000001") {
		t.Error("response leaked the real tenant api_key on wrong-key rejection")
	}
}

// TestActivateHandler_ExistingTenantAcceptsValidAPIKey verifies the happy
// path of the H1 gate: a caller who proves tenant-administrator status by
// supplying the correct api_key for an existing tenant CAN re-activate and
// receives the signed_payload, but the server does NOT re-emit the api_key
// in the response (the caller already proved they have it; echoing it back
// would be redundant on the wire and risks accidental logging leakage).
func TestActivateHandler_ExistingTenantAcceptsValidAPIKey(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTenant(t, app, "validkeyten0001", "validkeykey00001", "active")
	seedLicenseKey(t, app, "OZ-VALIDKEY-001", "pro", "unused",
		"2099-12-31 23:59:59.000Z")

	body := strings.NewReader(`{
		"key": "OZ-VALIDKEY-001",
		"email": "validkeyten0001@example.com",
		"machine_id": "validmachin0001"
	}`)
	req := httptest.NewRequest("POST", "/api/v1/license/activate", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer validkeykey00001")
	rec := httptest.NewRecorder()
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 (correct api_key), got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	// Core fields must be present.
	if _, ok := resp["signed_payload"]; !ok {
		t.Error("expected signed_payload in response")
	}
	if _, ok := resp["signature"]; !ok {
		t.Error("expected signature in response")
	}
	if _, ok := resp["tenant_id"]; !ok {
		t.Error("expected tenant_id in response")
	}

	// api_key must NOT be re-issued on an existing-tenant first-time
	// activation of an unused key — caller proved they already have it.
	if _, ok := resp["api_key"]; ok {
		t.Error("api_key must NOT be re-issued when caller proved they already hold it (no leak on the wire)")
	}
}

// ── Tests: Misconfiguration error paths ──────────────────────────
//
// These tests verify that handleActivate returns 500 with a descriptive
// "server misconfiguration" message when a required PocketBase collection
// is missing from the database schema.

func TestActivateHandler_MissingTenantsCollection(t *testing.T) {
	app, se := setupDirectAppWithoutCollection(t, map[string]bool{"tenants": true})
	defer app.Cleanup()

	// Seed a valid license key so we pass the key-validation step.
	seedLicenseKey(t, app, "OZ-MISCFG-KEY01", "pro", "unused",
		"2099-12-31 23:59:59.000Z")

	body := strings.NewReader(`{
		"key": "OZ-MISCFG-KEY01",
		"email": "miscfgtenan0001@example.com",
		"machine_id": "miscfgmachin001"
	}`)
	req := httptest.NewRequest("POST", "/api/v1/license/activate", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "tenants collection not found") {
		t.Errorf("expected 'tenants collection not found', got: %s", rec.Body.String())
	}
}

func TestActivateHandler_MissingMachinesCollection(t *testing.T) {
	app, se := setupDirectAppWithoutCollection(t, map[string]bool{"tenant_machines": true})
	defer app.Cleanup()

	seedLicenseKey(t, app, "OZ-MISCFG-KEY02", "pro", "unused",
		"2099-12-31 23:59:59.000Z")

	body := strings.NewReader(`{
		"key": "OZ-MISCFG-KEY02",
		"machine_id": "miscfgmachin002",
		"email": "test@example.com"
	}`)
	req := httptest.NewRequest("POST", "/api/v1/license/activate", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 (machine registration is non-fatal), got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "signed_payload") {
		t.Errorf("expected successful activation with signed_payload, got: %s", rec.Body.String())
	}
}

func TestActivateHandler_MissingSubscriptionsCollection(t *testing.T) {
	app, se := setupDirectAppWithoutCollection(t, map[string]bool{"subscriptions": true})
	defer app.Cleanup()

	seedLicenseKey(t, app, "OZ-MISCFG-KEY03", "pro", "unused",
		"2099-12-31 23:59:59.000Z")

	body := strings.NewReader(`{
		"key": "OZ-MISCFG-KEY03",
		"tenant_id": "miscfgtenan0003",
		"machine_id": "miscfgmachin003",
		"contact_name": "Test",
		"email": "test@example.com"
	}`)
	req := httptest.NewRequest("POST", "/api/v1/license/activate", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "subscriptions collection not found") {
		t.Errorf("expected 'subscriptions collection not found', got: %s", rec.Body.String())
	}
}

// ── Tests: Renew handler misconfiguration ────────────────────────
//
// handleRenew first calls FindRecordsByFilter("subscriptions", ...) to
// locate the current active subscription. When the subscriptions collection
// is entirely missing, this returns an error (caught by the if-err guard),
// so the handler returns 404 "no active subscription found" rather than
// reaching the later FindCollectionByNameOrId misconfiguration 500 path.
// This test verifies that defensive behavior.

func TestRenewHandler_MissingSubscriptionsCollection(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectAppWithoutCollection(t, map[string]bool{"subscriptions": true})
	defer app.Cleanup()

	// Seed an active tenant so authentication succeeds.
	seedTenant(t, app, "rnwmiscfg000001", "rnwmiscfgkey001", "active")
	// Seed an unused key so key validation succeeds
	seedLicenseKey(t, app, "rnwmiscfgkey001-key", "pro", "unused", "2099-12-31 23:59:59.000Z")

	body := strings.NewReader(`{
		"tenant_id": "rnwmiscfg000001",
		"key": "rnwmiscfgkey001-key"
	}`)
	req := httptest.NewRequest("POST", "/api/v1/license/renew", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer rnwmiscfgkey001")
	rec := httptest.NewRecorder()
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}
	mux.ServeHTTP(rec, req)

	// Missing subscriptions caught by FindRecordsByFilter guard → 404.
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "no active subscription found") {
		t.Errorf("expected 'no active subscription found', got: %s", rec.Body.String())
	}
}

// ── Tests: Activate handler regression coverage ───────────────────
//

// seedActivatedLicenseKey seeds a license key with a non-empty
// activated_by relation field, simulating a key that was already
// activated by the given tenant_id. Use this in tests that exercise
// the "key reused by same tenant" branch of the handler.
func seedActivatedLicenseKey(t *testing.T, app *tests.TestApp, key, tierKey, status, expiresAt, activatedBy string) {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("license_keys")
	if err != nil {
		t.Fatalf("license_keys collection not found: %v", err)
	}
	rec := core.NewRecord(col)
	rec.Set("key", key)
	rec.Set("tier_key", tierKey)
	rec.Set("max_stores", 5)
	rec.Set("max_pos_instances", 3)
	rec.Set("allowed_types", `["restaurant-pos", "store-pos"]`)
	rec.Set("status", status)
	rec.Set("expires_at", expiresAt)
	rec.Set("activated_at", time.Now().UTC().Format(time.RFC3339))
	if activatedBy != "" {
		// Relation fields are stored as JSON arrays internally;
		// pass a single-element slice to match PocketBase's layout.
		rec.Set("activated_by", []string{activatedBy})
	}
	if err := app.Save(rec); err != nil {
		t.Fatalf("failed to seed activated license key %q: %v", key, err)
	}
}

// TestActivateHandler_SameTenantKeyReuse verifies that a tenant who
// already activated a key can re-activate it (after re-install /
// new-machine setup) and receive the cached subscription payload.
// Previously broken: the activated_by relation field was stored as a
// JSON-encoded array (no MaxSelect), so keyRecord.GetString("activated_by")
// returned "[\"<id>\"]" which never string-matched the bare tenantID,
// causing spurious 401 "invalid or already used" errors on legitimate
// re-activation.
func TestActivateHandler_SameTenantKeyReuse(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	// Seed an active tenant.
	seedTenant(t, app, "reuseten0000001", "reuseApikey00001", "active")

	// Seed an active subscription for the tenant — the reuse
	// branch in activate.go looks up an existing subscription
	// to return its already-signed payload.
	seedSubscription(t, app, "reuseten0000001", "pro", "active")

	// Seed a license key already activated by that tenant.
	seedActivatedLicenseKey(t, app, "OZ-REUSE-KEY0001", "pro", "activated",
		"2099-12-31 23:59:59.000Z", "reuseten0000001")

	body := strings.NewReader(`{
		"key": "OZ-REUSE-KEY0001",
		"email": "reuseTen0000001@example.com",
		"machine_id": "newmachine00001"
	}`)
	req := httptest.NewRequest("POST", "/api/v1/license/activate", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer reuseApikey00001")
	rec := httptest.NewRecorder()
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 (same-tenant reuse), got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if _, ok := resp["signed_payload"]; !ok {
		t.Error("expected signed_payload in response")
	}
	if _, ok := resp["signature"]; !ok {
		t.Error("expected signature in response")
	}
	// api_key is NOT re-emitted on same-tenant key reuse: the stored value
	// is now a one-way bcrypt hash, and this caller already presented the
	// correct key — so there is no rotation and no re-emit. A caller who
	// lost the key reaches the same branch without a valid api_key and
	// receives a freshly rotated key instead.
	if _, ok := resp["api_key"]; ok {
		t.Error("api_key must NOT be re-emitted when the caller already proved they hold it (write-only secret)")
	}
}

// TestActivateHandler_EmailCaseInsensitive verifies that the activate
// handler normalizes incoming email so an arbitrary casing matches the
// existing tenant. Without this, "User@…com" and "user@…com" create
// duplicate tenants — each with its own api_key — and the user sees
// "invalid or already used license key" when their key was bound to
// the lower-case variant they originally typed.
func TestActivateHandler_EmailCaseInsensitive(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	// Seed an existing tenant at lowercase email.
	seedTenant(t, app, "caseinsen000001", "caseInsenKey0001", "active")

	// Seed an unused license key.
	seedLicenseKey(t, app, "OZ-CASE-INSEN01", "pro", "unused",
		"2099-12-31 23:59:59.000Z")

	// POST with UPPERCASE email + the existing tenant's api_key.
	// The handler must:
	// (a) normalize the email to lowercase and reuse the existing
	//     tenant (matched on email) — NOT create a new one.
	// (b) pass the H1 api_key gate since we provided the correct key.
	body := strings.NewReader(`{
		"key": "OZ-CASE-INSEN01",
		"email": "CASEINSEN000001@EXAMPLE.COM",
		"machine_id": "casemachin00001"
	}`)
	req := httptest.NewRequest("POST", "/api/v1/license/activate", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer caseInsenKey0001")
	rec := httptest.NewRecorder()
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 (case-insensitive email match), got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	// api_key must NOT be returned — if it is, that means a NEW tenant
	// was created (isNewTenant=true), which would mean our
	// normalization failed and we leaked credentials.
	if _, ok := resp["api_key"]; ok {
		t.Error("api_key must NOT be returned (existing tenant must be matched, no new tenant created)")
	}

	// Confirm only ONE tenant exists at the lowercase email — a
	// failure here means our normalization didn't take effect.
	tenants, err := app.FindRecordsByFilter(
		"tenants", "email = {:email}", "", 0, 0,
		map[string]any{"email": "caseinsen000001@example.com"},
	)
	if err != nil {
		t.Fatalf("failed to query tenants: %v", err)
	}
	if len(tenants) != 1 {
		t.Errorf("expected exactly 1 tenant matching lowercased email, got %d", len(tenants))
	}
}

// ── Tests: keyFailTracker cooldown env override ───────────────────

// TestKeyFailureTracker_CooldownEnvOverride verifies that the
// LICENSE_KEY_COOLDOWN env var shortens the per-key cooldown for
// development use, while preserving the production default (15
// minutes) when the env is unset.
func TestKeyFailureTracker_CooldownEnvOverride(t *testing.T) {
	// 1) Override path: short cooldown via env var.
	t.Setenv("LICENSE_KEY_COOLDOWN", "30ms")
	kf := &keyFailureTracker{
		failures:    make(map[string]*keyFailures),
		maxAttempts: 3,
		cooldown:    parseCooldown(),
	}
	if kf.cooldown != 30*time.Millisecond {
		t.Fatalf("expected cooldown=30ms after env override, got %v", kf.cooldown)
	}

	kf.recordFailure("OZ-COOL-OVR-001")
	kf.recordFailure("OZ-COOL-OVR-001")
	kf.recordFailure("OZ-COOL-OVR-001")

	if blocked, _ := kf.isBlocked("OZ-COOL-OVR-001"); !blocked {
		t.Error("expected key to be blocked immediately after 3 failures")
	}

	// Wait past the short cooldown and confirm the lock releases.
	time.Sleep(50 * time.Millisecond)

	if blocked, _ := kf.isBlocked("OZ-COOL-OVR-001"); blocked {
		t.Error("expected key to be unblocked after 200ms cooldown expired")
	}

	// 2) Default path: unset env falls back to production default.
	t.Setenv("LICENSE_KEY_COOLDOWN", "")
	if got := parseCooldown(); got != defaultKeyCooldown {
		t.Errorf("expected defaultKeyCooldown=%v with empty env, got %v", defaultKeyCooldown, got)
	}

	// 3) Malformed env falls back to default (and logs a warning
	//    that's acceptable to ignore here).
	t.Setenv("LICENSE_KEY_COOLDOWN", "not-a-duration")
	if got := parseCooldown(); got != defaultKeyCooldown {
		t.Errorf("expected defaultKeyCooldown=%v with malformed env, got %v", defaultKeyCooldown, got)
	}
}

// ── Tests: Persistence (H2 audit) ────────────────────────────────

// TestRateLimiters_Persistence_IP verifies the H2 audit fix:
// ipRateLimiter bucket state survives an end-to-end "restart" via
// SQLite persistence. Three sub-claims covered in sequence:
//
//  1. allow() writes through to SQLite — the row appears with the
//     post-decrement token count after a single call.
//  2. After a simulated restart (resetRateLimiters + reattach), hydrate
//     loads non-stale rows from SQLite into the in-memory map.
//  3. Stale rows (last_fill older than ipBucketTTL=2h) are filtered
//     out by hydrate and never land in in-memory.
func TestRateLimiters_Persistence_IP(t *testing.T) {
	resetRateLimiters()
	app, _ := setupDirectApp(t)
	defer app.Cleanup()

	// Phase 1 — write-through. setupDirectApp already triggered OnServe
	// which called ipRateLimiter.attachPersistence(app), so the table
	// is in place and the tracker is wired to this test's SQLite.
	const freshIP = "192.0.2.10"
	if !ipRateLimiter.allow(freshIP) {
		t.Fatalf("first allow(%q) should have returned true", freshIP)
	}

	rows, err := app.DB().NewQuery(
		`SELECT tokens FROM rate_limit_ip_buckets WHERE ip = {:ip}`,
	).Bind(map[string]any{"ip": freshIP}).Rows()
	if err != nil {
		t.Fatalf("failed to query persisted row: %v", err)
	}
	if !rows.Next() {
		rows.Close()
		t.Fatal("expected hydration target row to exist in DB after allow()")
	}
	var dbTokens int
	if err := rows.Scan(&dbTokens); err != nil {
		rows.Close()
		t.Fatalf("Scan failed: %v", err)
	}
	rows.Close()
	// 5 fresh tokens, decremented to 4 on first allow.
	if dbTokens != 4 {
		t.Errorf("expected persisted tokens=4 after first allow, got %d", dbTokens)
	}

	// Phase 2 — restart-survival. resetRateLimiters clears in-memory +
	// detaches db. Re-attach should hydrate the row written in phase 1.
	resetRateLimiters()
	ipRateLimiter.attachPersistence(app)

	ipRateLimiter.mu.Lock()
	b, ok := ipRateLimiter.buckets[freshIP]
	ipRateLimiter.mu.Unlock()
	if !ok {
		t.Fatalf("expected hydrate to load %q from persist (phase 1 wrote tokens=4)", freshIP)
	}
	if b.tokens != 4 {
		t.Errorf("expected hydrated tokens=4, got %d", b.tokens)
	}

	// Phase 3 — stale-row filter. Insert a row whose last_fill is well
	// beyond ipBucketTTL=2h. Hydrate should skip it.
	resetRateLimiters()
	staleTime := time.Now().Add(-3 * ipBucketTTL).Format(time.RFC3339)
	if _, err := app.DB().NewQuery(
		`INSERT INTO rate_limit_ip_buckets (ip, tokens, last_fill)
		 VALUES ({:ip}, {:tokens}, {:last_fill})`,
	).Bind(map[string]any{
		"ip":        "10.0.0.99",
		"tokens":    0,
		"last_fill": staleTime,
	}).Execute(); err != nil {
		t.Fatalf("failed to seed stale row: %v", err)
	}
	ipRateLimiter.attachPersistence(app)

	ipRateLimiter.mu.Lock()
	_, hasStale := ipRateLimiter.buckets["10.0.0.99"]
	ipRateLimiter.mu.Unlock()
	if hasStale {
		t.Errorf("expected stale row (last_fill %v ago) to be filtered out by hydrate", staleTime)
	}
}

// TestRateLimiters_Persistence_KeyFail verifies the H2 audit fix:
// keyFailTracker failure state survives end-to-end restart.
//
//  1. recordFailure() writes through to SQLite (the DB row matches the
//     in-memory count after 1 failure).
//  2. After restart + reattach, hydrate loads failure rows from SQLite
//     back into the in-memory map (with non-zero count).
//  3. Stale partial-failure rows (last_attempt older than
//     keyPartialFailureTTL=1h AND count < max=3) are filtered out at
//     hydrate time and never land in in-memory.
func TestRateLimiters_Persistence_KeyFail(t *testing.T) {
	resetRateLimiters()
	app, _ := setupDirectApp(t)
	defer app.Cleanup()

	// Phase 1 — write-through. setupDirectApp already wired persistence.
	const recordKey = "OZ-PERSIST-001"
	keyFailTracker.recordFailure(recordKey)

	rows, err := app.DB().NewQuery(
		`SELECT count FROM rate_limit_key_failures WHERE key = {:key}`,
	).Bind(map[string]any{"key": recordKey}).Rows()
	if err != nil {
		t.Fatalf("failed to query persisted row: %v", err)
	}
	if !rows.Next() {
		rows.Close()
		t.Fatal("expected persistence row to exist after recordFailure")
	}
	var dbCount int
	if err := rows.Scan(&dbCount); err != nil {
		rows.Close()
		t.Fatalf("Scan failed: %v", err)
	}
	rows.Close()
	if dbCount != 1 {
		t.Errorf("expected persisted count=1 after first recordFailure, got %d", dbCount)
	}

	// Phase 2 — restart-survival.
	resetRateLimiters()
	keyFailTracker.attachPersistence(app)

	keyFailTracker.mu.Lock()
	f, ok := keyFailTracker.failures[recordKey]
	keyFailTracker.mu.Unlock()
	if !ok {
		t.Fatalf("expected hydrate to load %q from persist", recordKey)
	}
	if f.count != 1 {
		t.Errorf("expected hydrated count=1, got %d", f.count)
	}

	// Phase 3 — stale-row filter. last_attempt > keyPartialFailureTTL=1h
	// ago AND count=1 < max=3 → should NOT be rehydrated.
	resetRateLimiters()
	staleTime := time.Now().Add(-3 * keyPartialFailureTTL).Format(time.RFC3339)
	if _, err := app.DB().NewQuery(
		`INSERT INTO rate_limit_key_failures (key, count, last_attempt)
		 VALUES ({:key}, {:count}, {:last_attempt})`,
	).Bind(map[string]any{
		"key":          "OZ-PERSIST-STALE",
		"count":        1, // partial failure — below max=3
		"last_attempt": staleTime,
	}).Execute(); err != nil {
		t.Fatalf("failed to seed stale failure row: %v", err)
	}
	keyFailTracker.attachPersistence(app)

	keyFailTracker.mu.Lock()
	_, hasStale := keyFailTracker.failures["OZ-PERSIST-STALE"]
	keyFailTracker.mu.Unlock()
	if hasStale {
		t.Errorf("expected stale partial-failure row (last_attempt %v ago) to be filtered out by hydrate", staleTime)
	}
}

// TestRateLimiter_PermittedAfterDBClose exercises the defer/recover
// safety net in persistBucket and persistFailure (H2 audit fix).
// After SQLite is closed mid-test (simulating a connection-pool
// exhaustion or a server restart race), the in-memory allow() and
// recordFailure() decisions must NOT panic. The recovery turns a
// closed-connection panic into a logged error and nil return;
// in-memory state remains authoritative for the allow decision.
//
// Without this test, the recover is unverified code that could
// silently rot. Without the recover itself, this test would panic
// at runtime and fail the suite — proving the safeguard is wired.
// TestRateLimiter_PermittedAfterSQLiteClosed exercises the
// defer/recover safety net in persistBucket and persistFailure
// (H2 audit fix). After the test app's SQLite is closed mid-test
// (simulating a closed DB at the driver layer — e.g. server restart
// race or connection-pool exhaustion), the in-memory allow() and
// recordFailure() decisions must NOT panic. The recovery turns a
// closed-connection panic into a logged error and nil return;
// in-memory state remains authoritative for the allow decision.
//
// Without this test, the recover is unverified code that could
// silently rot. Without the recover itself, this test would panic
// at runtime and fail the suite — proving the safeguard is wired.
//
// Implementation note: `app.DB()` returns PocketBase's *dbx.Builder
// query wrapper which intentionally has no Close() method (close
// is encapsulated in app.Cleanup() to avoid partial closes). We
// invoke Cleanup() directly to break the SQLite connection; if
// Close existed, we'd call that instead.
func TestRateLimiter_PermittedAfterSQLiteClosed(t *testing.T) {
	resetRateLimiters()
	app, _ := setupDirectApp(t)

	// Phase 1 — happy-path write-through. Confirms the fresh
	// tracker.db is wired correctly via attachPersistence.
	if !ipRateLimiter.allow("192.0.2.50") {
		t.Fatal("first allow should succeed (5 fresh tokens)")
	}

	// Phase 2 — close SQLite via app.Cleanup(). Subsequent persist
	// attempts hit a closed DB; defer/recover inside persistBucket
	// and persistFailure must swallow any panic and return nil so
	// the handler hot-path stays operational.
	app.Cleanup()

	// Phase 3 — second allow on the SAME ip (4 tokens left in
	// memory). Reaching this assertion alive proves the recovery
	// fired — otherwise the test would have panicked mid-call.
	if !ipRateLimiter.allow("192.0.2.50") {
		t.Error("second allow should succeed post-cleanup (4 fresh tokens in memory)")
	}

	// Phase 4 — recordFailure must also be panic-safe post-cleanup.
	// Reaching here without panic confirms the recovery is correctly
	// scoped to BOTH tracker persist calls.
	keyFailTracker.recordFailure("OZ-CLOSED-DB001")
}

// TestRateLimiter_PersistBucket_MonotonicUnderConcurrentWrites proves
// the MIN/MAX UPSERT guards introduced in the H2 audit fix hold under
// concurrent writers. The attack scenario the guards defend against:
//
//   - N concurrent requests all try to UPSERT the same (ip) row.
//   - allow() releases the in-memory mutex BEFORE write-through, so
//     UPSERTs can land in any order from SQLite's perspective.
//   - Without MIN/MAX, the LAST UPSERT wins; persisted tokens could
//     end up anywhere in the set of snap values, letting an attacker
//     bypass the rate limit after a server restart.
//
// The inner burst races N=20 persistBucket calls into the same row with
// distinct snapTokens ∈ {0..19} and monotonically increasing last_fill
// timestamps plus a pre-seeded tokens=5 (the production maxPerHr). The
// final persisted row MUST reflect MIN(tokens) over all writers (=0) and
// MAX(last_fill) (= the latest snap's timestamp) regardless of UPSERT
// ordering. Deterministic with MIN/MAX; flaky / wrong without.
//
// Outer loop (iters=50) amplifies catch-rate when MIN/MAX guards are
// absent: a single-run stale-snapshot winner arriving last has only a
// 1-in-N+1 chance of coincidentally being snapTokens=0. Repeating the
// burst under independent ticker interleavings 50× raises the probability
// of catching the regression to ~91% (1 - (20/21)^50). With MIN/MAX
// every iteration is deterministic so this loop adds no flakiness.
func TestRateLimiter_PersistBucket_MonotonicUnderConcurrentWrites(t *testing.T) {
	resetRateLimiters()
	app, _ := setupDirectApp(t)
	defer app.Cleanup()

	const (
		fixedIP         = "192.0.2.99"
		N               = 20
		iters           = 10
		preSeedTokens   = 5
		preSeedLastFill = "2025-12-31T23:59:00Z"
	)

	for iter := 0; iter < iters; iter++ {
		// Per-iter reset — drop the previous iteration's row so the
		// pre-seed INSERT below always wins the (ip) primary key on
		// iter 1+, and the test doesn't grow stale carry-over state.
		if _, err := app.DB().NewQuery(
			`DELETE FROM rate_limit_ip_buckets WHERE ip = {:ip}`,
		).Bind(map[string]any{"ip": fixedIP}).Execute(); err != nil {
			t.Fatalf("iter %d: pre-iter delete failed: %v", iter, err)
		}

		// Pre-seed a row at tokens=5 (maxPerHr) with an older
		// last_fill. This stands in for an "earlier happy state" that
		// a concurrent burst must NOT regress to when a throttled
		// state arrives later.
		if _, err := app.DB().NewQuery(
			`INSERT INTO rate_limit_ip_buckets (ip, tokens, last_fill)
			 VALUES ({:ip}, {:tokens}, {:last_fill})`,
		).Bind(map[string]any{
			"ip":        fixedIP,
			"tokens":    preSeedTokens,
			"last_fill": preSeedLastFill,
		}).Execute(); err != nil {
			t.Fatalf("iter %d: pre-seed insert failed: %v", iter, err)
		}

		// Concurrent burst. start-gate + sync.WaitGroup ensures
		// deterministic fan-out (avoids spawn-stagger variance that
		// could let writer N-1 finish before writer 0 enters the
		// UPSERT window).
		var (
			start = make(chan struct{})
			wg    sync.WaitGroup
		)
		for i := 0; i < N; i++ {
			wg.Add(1)
			// Pass iter explicitly to the goroutine. Without this
			// the test relies on Go 1.22+ per-iteration loop-variable
			// scoping; on Go 1.21- every t.Errorf would report the
			// final iter value (50), making error attribution useless
			// on a flake.
			go func(snapTokens int, iterID int) {
				defer wg.Done()
				<-start // synchronize fan-out
				snapFill := time.Date(2026, 1, 1, 0, 0, snapTokens, 0, time.UTC)
				if err := ipRateLimiter.persistBucket(fixedIP, snapTokens, snapFill); err != nil {
					t.Errorf("iter %d: persistBucket(snapTokens=%d) failed: %v", iterID, snapTokens, err)
				}
			}(i, iter)
		}
		close(start)
		wg.Wait()

		// Read back the row and assert MIN/MAX held. The MIN is
		// computed across the snap set {0..19} plus the pre-seed {5}:
		// the absolute minimum is 0. Without MIN/MAX the value would
		// be the LAST UPSERT's snapTokens ∈ {0..19}, and the LAST
		// fill depends on which goroutine arrived last.
		rows, err := app.DB().NewQuery(
			`SELECT tokens, last_fill FROM rate_limit_ip_buckets WHERE ip = {:ip}`,
		).Bind(map[string]any{"ip": fixedIP}).Rows()
		if err != nil {
			t.Fatalf("iter %d: query failed: %v", iter, err)
		}
		if !rows.Next() {
			rows.Close()
			t.Fatalf("iter %d: persisted row missing after concurrent write burst", iter)
		}
		var dbTokens int
		var dbLastFill string
		if err := rows.Scan(&dbTokens, &dbLastFill); err != nil {
			rows.Close()
			t.Fatalf("iter %d: scan failed: %v", iter, err)
		}
		rows.Close()

		// MIN over snap tokens {0..19} ∪ pre-seed = 0 (snapTokens=0
		// is the strict minimum). Without MIN/MAX the race could
		// land us at any value in {0..19, pre-seed=5}.
		const expectedMinTokens = 0
		if dbTokens != expectedMinTokens {
			t.Errorf("iter %d: MIN(tokens) over concurrent UPSERTs should be %d, got %d (without MIN/MAX the LAST write wins, producing a non-deterministic value)",
				iter, expectedMinTokens, dbTokens)
		}

		// MAX over last_fill values: pre-seed is the oldest, snap
		// fills are 2026-01-01T00:00:00Z .. 2026-01-01T00:00:19Z.
		// snap N-1=19 wins.
		expectedMaxFill := time.Date(2026, 1, 1, 0, 0, N-1, 0, time.UTC).Format(time.RFC3339)
		if dbLastFill != expectedMaxFill {
			t.Errorf("iter %d: MAX(last_fill) over concurrent UPSERTs should be %s, got %s",
				iter, expectedMaxFill, dbLastFill)
		}
	}
}

// TestKeyFailureTracker_PersistFailure_MonotonicUnderConcurrentWrites
// proves the MAX UPSERT guards on rate_limit_key_failures hold under
// concurrent writers. Mirrors the rateLimiter race test: N goroutines
// race into the same (key) row with monotonically increasing snap counts
// and cooldown timestamps; the final persisted values MUST be MAX(count)
// and MAX(cooldown_until) regardless of UPSERT ordering.
//
// The attack scenario this defends against: an attacker brute-forces a
// key, the server enforces cooldown, server restarts. Without MAX
// guards, the LAST UPSERT could land at a stale lower count or shorter
// cooldown window, allowing continued attacks after a server restart.
//
// Outer loop (iters=50) amplifies catch-rate: under MAX guards every
// iteration is deterministic (= max snapCount). Without MAX the LAST
// UPSERT could land on any of {0..9}, only 1/N chance per iter of
// coincidentally winning. 50 iters → ~99.5% catch rate.
func TestKeyFailureTracker_PersistFailure_MonotonicUnderConcurrentWrites(t *testing.T) {
	resetRateLimiters()
	app, _ := setupDirectApp(t)
	defer app.Cleanup()

	const (
		fixedKey = "OZ-MINMAX-RACE-1"
		N        = 10 // includes snapCounts 0..9; counts >=3 (= max) carry cooldowns
		iters    = 10
	)
	baseTime := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	for iter := 0; iter < iters; iter++ {
		// Per-iter reset — drop the previous iteration's row so the
		// burst starts from a clean slate, not from the last iter's
		// wins. (No pre-seed here because persistFailure itself
		// handles cold starts by INSERT on first conflict.)
		if _, err := app.DB().NewQuery(
			`DELETE FROM rate_limit_key_failures WHERE key = {:key}`,
		).Bind(map[string]any{"key": fixedKey}).Execute(); err != nil {
			t.Fatalf("iter %d: pre-iter delete failed: %v", iter, err)
		}

		// Concurrent burst with snap counts {0, 1, ..., 9}. Counts
		// 0..2 don't trigger cooldown (max=3); counts 3+ do.
		// Cooldown timestamps monotonically increase so MAX is
		// testable.
		var (
			start = make(chan struct{})
			wg    sync.WaitGroup
		)
		for i := 0; i < N; i++ {
			wg.Add(1)
			go func(snapCount int, iterID int) {
				defer wg.Done()
				<-start // synchronize fan-out
				snapLastAttempt := baseTime.Add(time.Duration(snapCount) * time.Second)
				var snapCooldown time.Time
				if snapCount >= 3 {
					// Distinct cooldown timestamps for each writer
					// so MAX picks exactly the latest (= writer N-1).
					snapCooldown = baseTime.Add(time.Duration(snapCount) * time.Minute)
				}
				if err := keyFailTracker.persistFailure(fixedKey, snapCount, snapLastAttempt, snapCooldown); err != nil {
					t.Errorf("iter %d: persistFailure(snapCount=%d) failed: %v", iterID, snapCount, err)
				}
			}(i, iter)
		}
		close(start)
		wg.Wait()

		// Read back the row and assert MAX held.
		rows, err := app.DB().NewQuery(
			`SELECT count, last_attempt, cooldown_until FROM rate_limit_key_failures WHERE key = {:key}`,
		).Bind(map[string]any{"key": fixedKey}).Rows()
		if err != nil {
			t.Fatalf("iter %d: query failed: %v", iter, err)
		}
		if !rows.Next() {
			rows.Close()
			t.Fatalf("iter %d: persisted row missing after concurrent write burst", iter)
		}
		var dbCount int
		var dbLastAttempt, dbCooldown string
		if err := rows.Scan(&dbCount, &dbLastAttempt, &dbCooldown); err != nil {
			rows.Close()
			t.Fatalf("iter %d: scan failed: %v", iter, err)
		}
		rows.Close()

		// MAX over snap counts {0..9} = 9 (writer N-1). Without MAX
		// last-write-wins could land us at any snap count ∈ {0..9}.
		const expectedMaxCount = N - 1
		if dbCount != expectedMaxCount {
			t.Errorf("iter %d: MAX(count) over concurrent UPSERTs should be %d, got %d (without MAX the LAST write wins, producing a non-deterministic value)",
				iter, expectedMaxCount, dbCount)
		}

		// MAX over last_attempt: base + snapCount*1s. Writer N-1=9
		// had base+9s. MAX = base+9s.
		expectedMaxLastAttempt := baseTime.Add(time.Duration(N-1) * time.Second).Format(time.RFC3339)
		if dbLastAttempt != expectedMaxLastAttempt {
			t.Errorf("iter %d: MAX(last_attempt) over concurrent UPSERTs should be %s, got %s",
				iter, expectedMaxLastAttempt, dbLastAttempt)
		}

		// MAX over cooldown_until: only writers with snapCount >= 3
		// carry a non-empty cooldown. The largest snap (9) wins:
		// base + 9*1min = base + 9 minutes.
		expectedMaxCooldown := baseTime.Add(time.Duration(N-1) * time.Minute).Format(time.RFC3339)
		if dbCooldown != expectedMaxCooldown {
			t.Errorf("iter %d: MAX(cooldown_until) over concurrent UPSERTs should be %s, got %s",
				iter, expectedMaxCooldown, dbCooldown)
		}
	}
}

// ── Tests: ActivationLocks (Memory-Leak Audit) ─────────────────

// TestActivationLocks_BoundedMemory verifies that the activationLocks
// pool is bounded to a fixed-size shard array regardless of how many
// distinct keys are acquired (Memory-Leak Audit fix). The previous
// unbounded per-key map allocated a *sync.Mutex for every unique key
// passed to /activate or /renew and never evicted; an attacker spamming
// random distinct key strings could OOM the server. With 256 fixed
// shards, the struct is compile-time constant at ≈2 KB regardless of
// how many keys have ever been processed — even after 1 million distinct
// keys.
//
// The test asserts three properties:
//  1. STRUCTURAL: no field is a map. Catches any future regression that
//     re-introduces unbounded per-key state (a pointer-based or map-
//     based design would surface as reflect.Map and fail loudly here
//     rather than only failing the softer memory-stat check below).
//  2. Compile-time struct size is bounded (rejects non-shard field
//     additions that would re-introduce per-key memory).
//  3. Heap usage stays bounded across a 100,000-distinct-key workload
//     (catches binary-level allocations introduced elsewhere).
func TestActivationLocks_BoundedMemory(t *testing.T) {
	kal := &keyActivationLocks{}

	// (1) STRUCTURAL reflection check: no field may be a map. With
	// a regression to the prior map-based design this field's type
	// would be reflect.Map and the test would fail loudly here, not
	// silently in a memory-stat heuristic.
	expectedType := reflect.TypeOf([activationLockShards]sync.Mutex{})
	// reflect.TypeOf(kal).Elem() gives the struct type without copying
	// the underlying value (which contains sync.Mutex). This avoids the
	// go vet "copies lock value" warning that reflect.TypeOf(*kal)
	// would trigger.
	rt := reflect.TypeOf(kal).Elem()
	if rt.NumField() != 1 {
		t.Fatalf("activationLocks has %d fields; expected exactly 1 (the [256]sync.Mutex shards array). Extra fields likely indicate per-key state regression.",
			rt.NumField())
	}
	if rt.Field(0).Type != expectedType {
		t.Fatalf("activationLocks field 0 has type %v; expected exactly %v (regression to map/slice/other unbounded design)",
			rt.Field(0).Type, expectedType)
	}

	// (2) Compile-time size check: the struct must remain the
	// fixed-size [256]sync.Mutex array. sync.Mutex is ≈8 bytes on
	// x86_64/arm64. The previous unbounded-map design would have
	// been 0 bytes for the struct itself (just a nil map pointer)
	// but allocated unboundedly on the heap via the map.
	const maxAllowedBytes = activationLockShards * 16 // 4 KB upper bound (vs ~2 KB expected)
	gotSize := unsafe.Sizeof(*kal)
	if gotSize > maxAllowedBytes {
		t.Errorf("activationLocks struct grew to %d bytes; expected %d bytes (256 * sizeof(sync.Mutex))",
			gotSize, maxAllowedBytes)
	}

	// (3) Heap-boundedness check across 10,000 distinct keys. Without
	// the unbounded-map fix, the prior design would have grown
	// ≈ N * 24 bytes ≈ 240 KB for mutex pointers and map entries.
	// 10k keys still proves the struct is fixed-size; the heap check
	// is proportional so fewer keys means a tighter threshold.
	var memBefore, memAfter runtime.MemStats
	runtime.ReadMemStats(&memBefore)

	const N = 10_000
	for i := 0; i < N; i++ {
		key := fmt.Sprintf("OZ-DOS-KEY-%08d", i)
		unlock := kal.lock(key)
		unlock() // immediate release — only per-key allocation matters
	}
	runtime.ReadMemStats(&memAfter)

	heapGrowthMB := float64(int64(memAfter.HeapAlloc)-int64(memBefore.HeapAlloc)) / 1024 / 1024
	// Baseline overhead: fmt.Sprintf scratch (~200 KB) + closure
	// allocations (~100 KB) + runtime internals ≈ 0.5 MB total.
	// Broken per-key-map design would add ~240 KB for map entries
	// plus Go map overhead (~200 KB) = ~0.9 MB total. Threshold at
	// 0.8 MB catches the regression with headroom for GC variance.
	if heapGrowthMB > 0.8 {
		t.Errorf("activationLocks heap grew by %.2f MB after %d distinct keys; expected <0.8 MB (prior unbounded-map design would have grown ~0.9 MB from N mutex entries + map overhead)",
			heapGrowthMB, N)
	}
}

// TestActivationLocks_DistributesKeysAcrossShards verifies that the
// FNV-1a hash distributes distinct keys roughly uniformly across the
// 256-shard pool. Catches regressions where the bucket index
// calculation collapses to a single value (e.g., someone replaces
// `idx := hash % 256` with `idx := 0`), which would defeat the
// entire memory-leak fix by making all keys serialise on one mutex.
//
// Distribution invariants:
//   - All 256 buckets receive at least one key (no collapsed bucket).
//   - Max bucket count is within reasonable bounds (no hot spot).
//   - Mean is ≈ N/256 (sanity).
func TestActivationLocks_DistributesKeysAcrossShards(t *testing.T) {
	const N = 2_048 // 8 keys per bucket — enough to hit all 256 buckets

	counts := make([]int, activationLockShards)
	for i := 0; i < N; i++ {
		key := fmt.Sprintf("OZ-DIST-KEY-%08d", i)
		counts[bucketFor(key)]++
	}

	emptyBuckets := 0
	maxCount := 0
	for _, c := range counts {
		if c == 0 {
			emptyBuckets++
		}
		if c > maxCount {
			maxCount = c
		}
	}
	if emptyBuckets > 0 {
		t.Errorf("hash distribution has %d empty buckets out of %d (FNV-1a is broken or hash space collapsed)",
			emptyBuckets, activationLockShards)
	}
	// For 2,048 keys across 256 buckets, expected mean is ~8. A
	// max > 4x the mean suggests a hot spot.
	meanCount := N / activationLockShards
	if maxCount > 4*meanCount {
		t.Errorf("hash distribution hot spot: max bucket has %d keys, mean is %d (expected max < 4x mean)",
			maxCount, meanCount)
	}
}

// TestActivationLocks_ConcurrentSameKeyBlocks verifies that two
// goroutines calling lock() with the SAME key always hash to the SAME
// shard, so the second call blocks until the first unlocks. This is the
// correctness invariant the per-key activation lock was added to defend
// (C2/C3 audit): without it, two concurrent renewals for the same key
// could both pass the keyRecord.GetString("status") == "unused" check
// before either saves "activated", silently granting an extra renewed
// subscription for one key purchase.
//
// The sharded implementation MUST preserve this invariant — different
// keys may collide on the same shard (false contention, acceptable),
// but the SAME key must always map to the SAME shard (correctness,
// required).
func TestActivationLocks_ConcurrentSameKeyBlocks(t *testing.T) {
	kal := &keyActivationLocks{}
	const fixedKey = "OZ-ACTLOCK-SAME-001"

	// Goroutine A: acquire, signal that lock is held, then wait for
	// permission to release. This guarantees the lock is held before
	// goroutine B starts trying to acquire.
	var aLockAcquired sync.WaitGroup
	var aCanRelease sync.WaitGroup
	aLockAcquired.Add(1)
	aCanRelease.Add(1)
	go func() {
		unlock := kal.lock(fixedKey)
		aLockAcquired.Done() // signal "lock held"
		aCanRelease.Wait()
		unlock()
	}()
	aLockAcquired.Wait()

	// Goroutine B: tries to acquire the same key. MUST block while A
	// holds the lock; this is the C2/C3 invariant.
	bAcquired := make(chan struct{})
	go func() {
		unlock := kal.lock(fixedKey)
		close(bAcquired)
		unlock()
	}()

	select {
	case <-bAcquired:
		t.Error("B acquired lock while A held it — same-key serialisation is broken")
	default:
		// B is correctly blocked. Allow a generous sleep to confirm
		// the lock holder is definitely blocked, not racing. 100ms
		// is wide enough to absorb Go scheduler latency spikes on
		// heavily-loaded CI runners (which can hit 10–20ms inside
		// containers) while keeping the test fast.
		time.Sleep(100 * time.Millisecond)
		select {
		case <-bAcquired:
			t.Error("B acquired lock while A still held it after 100ms grace")
		default:
			// Still blocked. ✓
		}
	}

	// Release A; B should now acquire within a reasonable window.
	aCanRelease.Done()
	select {
	case <-bAcquired:
		// ✓ B acquired after A released.
	case <-time.After(500 * time.Millisecond):
		t.Error("B did not acquire lock after A released within 500ms — same-key acquisition is broken")
	}
}

// TestActivationLocks_BoundedUnderHighChurn is the production-load stress
// test for the sharded mutex pool (Memory-Leak Audit). Whereas
// TestActivationLocks_BoundedMemory uses a single goroutine acquiring
// 100k keys sequentially, this test fans 50 goroutines across 10k unique
// keys each (500k total unique lock+unlock operations) under a start-gate.
// Catches any future regression that re-introduces per-key state
// (e.g., a sync.Map for per-key telemetry, a per-key counter) that would
// be invisibly small in unit tests but observable under realistic
// concurrent load. Heap growth must stay <4 MB.
//
// The 4 MB threshold allows ~8 bytes per operation across 500k ops,
// plus runtime internals (slice growth, channel buffers, stack
// pre-allocation). With the prior unbounded-map design the per-key
// *sync.Mutex alone (24 bytes) + map entry overhead would have grown
// >10 MB across 500k unique keys.
//
// IMPORTANT: the per-worker key strings are pre-allocated into
// []string slices BEFORE the heap measurement starts. This isolates
// the ~10MB of fmt.Sprintf scratch from the measured delta — without
// it, the test's threshold would be dominated by the formatter
// itself rather than the sharded-mutex pool's actual growth.
func TestActivationLocks_BoundedUnderHighChurn(t *testing.T) {
	const (
		goroutines    = 10
		keysPerWorker = 2_000
		maxHeapGrowth = 1 * 1024 * 1024 // 1 MB (20k ops, not 500k)
	)
	kal := &keyActivationLocks{}

	// Pre-allocate each worker's key set BEFORE the MemStats snapshot.
	// Building 500k keys via fmt.Sprintf allocates ~10MB of strings;
	// the GC may keep some of that alive past the MemStats call below.
	// Building them up-front ensures the measured delta reflects only
	// the sharded-mutex pool's actual growth, not the test scaffolding.
	workerKeys := make([][]string, goroutines)
	for g := 0; g < goroutines; g++ {
		workerKeys[g] = make([]string, keysPerWorker)
		for i := 0; i < keysPerWorker; i++ {
			workerKeys[g][i] = fmt.Sprintf("OZ-CHURN-G%04d-K%08d", g, i)
		}
	}

	// Force a GC before the baseline so memBefore is a post-GC
	// steady-state snapshot rather than a measurement mid-flight.
	// Without this, a pre-emptive GC during the churn could lower
	// the post-snapshot HeapInuse (closer heap reclaimed) and make
	// the measured delta artificially negative or near-zero, letting
	// the test pass for a false reason ("GC timing reduced the
	// heap under us") rather than "no per-key state was allocated".
	var memBefore, memAfter runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&memBefore)

	// Start-gate: all goroutines block on <-start, then fan out
	// simultaneously. Avoids spawn-stagger variance that could let
	// worker 0 finish before worker 1 enters the lock window.
	start := make(chan struct{})
	var wg sync.WaitGroup
	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func(gID int) {
			defer wg.Done()
			<-start
			for i := 0; i < keysPerWorker; i++ {
				unlock := kal.lock(workerKeys[gID][i])
				unlock()
			}
		}(g)
	}
	close(start)
	wg.Wait()

	// Force a GC after wg.Wait() so the lock() closure objects are
	// collected before the post-snapshot. A per-key-state regression
	// (the failure mode this test catches) would still register in the
	// delta because the regression's state remains referenced; transient
	// closure heap would be freed.
	//
	// HeapInuse (not HeapAlloc) is the metric of choice because it
	// includes in-use span overhead, which makes per-key-state
	// regressions register slightly earlier in the delta. With the
	// symmetric GC above, HeapAlloc would also be stable — but
	// HeapInuse is preferred for the slightly earlier detection.
	// The two GCs together bracket the churn: only growth that
	// survives BOTH GCs is attributed to the activationLocks pool.
	runtime.GC()
	runtime.ReadMemStats(&memAfter)

	heapGrowth := int64(memAfter.HeapInuse) - int64(memBefore.HeapInuse)
	if heapGrowth > maxHeapGrowth {
		t.Errorf("activationLocks heap grew by %d bytes (%.2f MB) after %d unique lock+unlock ops across %d goroutines; expected <%d bytes (4 MB). Possible per-key state regression.",
			heapGrowth, float64(heapGrowth)/1024/1024,
			goroutines*keysPerWorker, goroutines, maxHeapGrowth)
	}
}

func TestActivateHandler_MachineAlreadyExists(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTenant(t, app, "reinstallten001", "reinstallkey0001", "active")
	seedLicenseKey(t, app, "OZ-REINSTALL-01", "pro", "unused", "2099-12-31 23:59:59.000Z")

	body := strings.NewReader(`{
		"key": "OZ-REINSTALL-01",
		"email": "reinstallten001@example.com",
		"machine_id": "reinstallmac001"
	}`)
	req := httptest.NewRequest("POST", "/api/v1/license/activate", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer reinstallkey0001")
	rec := httptest.NewRecorder()
	mux, _ := se.Router.BuildMux()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("first activation failed: %v", rec.Body.String())
	}

	body2 := strings.NewReader(`{
		"key": "OZ-REINSTALL-01",
		"email": "reinstallten001@example.com",
		"machine_id": "reinstallmac001"
	}`)
	req2 := httptest.NewRequest("POST", "/api/v1/license/activate", body2)
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("Authorization", "Bearer reinstallkey0001")
	rec2 := httptest.NewRecorder()
	mux.ServeHTTP(rec2, req2)

	if rec2.Code != http.StatusOK {
		t.Fatalf("second activation failed (machine already exists): %v", rec2.Body.String())
	}
}

// ── Tests: C1-followup auth migration (Bearer header is the SOLE channel) ──
//
// status.go was already migrated to Bearer-only in the C1 audit. The
// C1-followup hardening then removed the legacy body `api_key` fallback
// from activate.go and renew.go entirely — a body credential leaks into
// CDN / webserver access logs that capture request bodies, and two
// credential channels can disagree. These tests verify:
//   - Authorization: Bearer <api_key> is the ONLY accepted credential
//   - Body api_key alone is rejected with 401 + a WWW-Authenticate hint
//   - Both present and matching works (header is authoritative)
//   - Both present and mismatched: the header wins, the body is ignored
// plus the logger-redaction helper that future debug-logging can use to
// safely print request bodies.

// TestRedactRequestBody verifies the logger-redaction helper that masks
// the api_key field in a JSON payload. This is the test the user
// explicitly asked for: any future debug-level log call that wants to
// print the request body must use this helper so the credential never
// lands in log files (which are typically retained longer, shared more
// broadly, and may be scraped by log-aggregation tools).
func TestRedactRequestBody(t *testing.T) {
	cases := []struct {
		name           string
		in             string
		mustContain    []string // substrings that MUST appear in output
		mustNotContain []string // substrings that MUST NOT appear in output
	}{
		{
			name:           "redacts api_key field with [REDACTED]",
			in:             `{"tenant_id":"t1","api_key":"supersecret123","key":"OZ-123"}`,
			mustContain:    []string{`"api_key":"[REDACTED]"`, `"tenant_id":"t1"`, `"key":"OZ-123"`},
			mustNotContain: []string{"supersecret123"},
		},
		{
			name:        "no api_key field passes through unchanged",
			in:          `{"tenant_id":"t1","key":"OZ-123"}`,
			mustContain: []string{`"tenant_id":"t1"`, `"key":"OZ-123"`},
		},
		{
			name:        "empty api_key is preserved (not redacted to [REDACTED])",
			in:          `{"api_key":"","key":"OZ-123"}`,
			mustContain: []string{`"api_key":""`, `"key":"OZ-123"`},
		},
		{
			name:        "malformed JSON returns original bytes (for debug usefulness)",
			in:          `not json at all`,
			mustContain: []string{"not json at all"},
		},
		{
			name:        "empty body returns empty",
			in:          ``,
			mustContain: nil,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			out := redactRequestBody([]byte(tc.in))
			for _, want := range tc.mustContain {
				if !strings.Contains(out, want) {
					t.Errorf("expected substring %q in output, got: %s", want, out)
				}
			}
			for _, dontWant := range tc.mustNotContain {
				if strings.Contains(out, dontWant) {
					t.Errorf("forbidden substring %q present in output: %s", dontWant, out)
				}
			}
		})
	}
}

// TestRenewHandler_AuthPaths verifies the C1-followup auth migration
// for /renew: Authorization: Bearer <api_key> is preferred, body
// api_key still works for backward-compat, both-present-and-match
// succeeds, both-present-and-mismatch is rejected (no silent
// guessing about which credential the client intended).
func TestRenewHandler_AuthPaths(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	const tenantID = "authtenantrnw00" // 15 chars (PocketBase implicit id field)
	const apiKey = "authtestkey123456"
	seedTenant(t, app, tenantID, apiKey, "active")
	seedSubscriptionStatus(t, app, tenantID, "pro", "active", time.Now().AddDate(0, -1, 0))

	cases := []struct {
		name       string
		authHeader string
		bodyAPIKey string
		expectCode int
	}{
		{
			name:       "Bearer header only (preferred path)",
			authHeader: "Bearer " + apiKey,
			bodyAPIKey: "",
			expectCode: http.StatusOK,
		},
		{
			name:       "body api_key only (rejected — header is the sole credential channel)",
			authHeader: "",
			bodyAPIKey: apiKey,
			expectCode: http.StatusUnauthorized,
		},
		{
			name:       "both present and matching (idempotent)",
			authHeader: "Bearer " + apiKey,
			bodyAPIKey: apiKey,
			expectCode: http.StatusOK,
		},
		{
			name:       "both present and mismatched (header wins, body ignored)",
			authHeader: "Bearer " + apiKey,
			bodyAPIKey: "wrongapikeyrnw001",
			expectCode: http.StatusOK,
		},
	}

	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// Each subtest needs its own unused key because the
			// handler marks the key as activated on successful
			// renewal (no two subtests can share a key).
			newKey := fmt.Sprintf("OZ-AUTHPATH-%02d", i)
			seedLicenseKey(t, app, newKey, "pro", "unused", "2099-12-31 23:59:59.000Z")

			body := fmt.Sprintf(`{"tenant_id":"%s","api_key":"%s","key":"%s"}`,
				tenantID, tc.bodyAPIKey, newKey)
			req := httptest.NewRequest("POST", "/api/v1/license/renew", strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			if tc.authHeader != "" {
				req.Header.Set("Authorization", tc.authHeader)
			}

			rec := httptest.NewRecorder()
			mux, _ := se.Router.BuildMux()
			mux.ServeHTTP(rec, req)

			if rec.Code != tc.expectCode {
				t.Errorf("expected %d, got %d. Body: %s", tc.expectCode, rec.Code, rec.Body.String())
			}
			if tc.expectCode == http.StatusUnauthorized {
				if got := rec.Header().Get("WWW-Authenticate"); got == "" {
					t.Errorf("expected WWW-Authenticate hint on 401, got none")
				}
			}
		})
	}
}

// TestRenewHandler_RejectsBodyAPIKey verifies the C1-followup hardening:
// the legacy body `api_key` field is no longer a credential — a request
// that sends the key ONLY in the body is rejected with 401, a
// `WWW-Authenticate: Bearer` hint, and an error message pointing at the
// Authorization header. The Bearer path succeeds without any deprecation
// log (there is nothing left to deprecate).
//
// log.SetOutput is package-global, so we restore os.Stderr via
// t.Cleanup. Do NOT add t.Parallel() to this test (would race with the
// captured buffer; the other tests in this package run sequentially
// anyway, which is fine).
func TestRenewHandler_RejectsBodyAPIKey(t *testing.T) {
	resetRateLimiters()

	var buf bytes.Buffer
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })

	app, se := setupDirectApp(t)
	defer app.Cleanup()

	const tenantID = "renwdeprenwtest" // 15 chars (PocketBase implicit id field)
	const apiKey = "renwdeptestkey001"
	seedTenant(t, app, tenantID, apiKey, "active")
	seedSubscriptionStatus(t, app, tenantID, "pro", "active", time.Now().AddDate(0, -1, 0))

	mux, _ := se.Router.BuildMux()

	// ── Case 1: body-only api_key is REJECTED (401 + hint) ──────
	buf.Reset()
	seedLicenseKey(t, app, "OZ-DEPRNW-BODY01", "pro", "unused", "2099-12-31 23:59:59.000Z")
	body := fmt.Sprintf(`{"tenant_id":"%s","api_key":"%s","key":"OZ-DEPRNW-BODY01"}`,
		tenantID, apiKey)
	req := httptest.NewRequest("POST", "/api/v1/license/renew", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for body-only api_key, got %d: %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("WWW-Authenticate"); got == "" {
		t.Errorf("expected WWW-Authenticate hint on 401, got none")
	}
	if !strings.Contains(rec.Body.String(), "Authorization: Bearer") {
		t.Errorf("expected error message pointing at the Authorization header, got: %s", rec.Body.String())
	}
	// A rejected body-only attempt must not authenticate, so no success-path
	// log line can fire for it.
	if strings.Contains(buf.String(), "DEPRECATION: /renew") {
		t.Errorf("DEPRECATION log must be gone after the fallback removal, got buffer: %q", buf.String())
	}

	// ── Case 2: Bearer header succeeds, no deprecation noise ────
	buf.Reset()
	seedLicenseKey(t, app, "OZ-DEPRNW-BEARER1", "pro", "unused", "2099-12-31 23:59:59.000Z")
	body2 := fmt.Sprintf(`{"tenant_id":"%s","key":"OZ-DEPRNW-BEARER1"}`, tenantID)
	req2 := httptest.NewRequest("POST", "/api/v1/license/renew", strings.NewReader(body2))
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("Authorization", "Bearer "+apiKey)
	rec2 := httptest.NewRecorder()
	mux.ServeHTTP(rec2, req2)

	if rec2.Code != http.StatusOK {
		t.Fatalf("bearer setup failed: %d, %s", rec2.Code, rec2.Body.String())
	}
	if strings.Contains(buf.String(), "DEPRECATION: /renew") {
		t.Errorf("expected NO DEPRECATION log when Bearer header is used, got buffer: %q", buf.String())
	}
}

// TestActivateHandler_AuthPaths mirrors TestRenewHandler_AuthPaths for
// /activate. The api_key check is only enforced for EXISTING tenants
// (first-time activation issues a new api_key in the response). The
// test focuses on the existing-tenant path to exercise the
// C1-followup migration.
func TestActivateHandler_AuthPaths(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	const tenantID = "actauthtenant01" // 15 chars max — PocketBase implicit id field
	const apiKey = "actauthtestkey123"
	const email = "actauthtenant01@example.com"
	seedTenant(t, app, tenantID, apiKey, "active")
	seedSubscriptionStatus(t, app, tenantID, "pro", "active", time.Now().AddDate(0, -1, 0)) // decorative — kept to mirror TestRenewHandler_WithSubscription 3-step setup

	cases := []struct {
		name       string
		authHeader string
		bodyAPIKey string
		expectCode int
	}{
		{
			name:       "Bearer header only (preferred path)",
			authHeader: "Bearer " + apiKey,
			bodyAPIKey: "",
			expectCode: http.StatusOK,
		},
		{
			name:       "body api_key only (rejected — header is the sole credential channel)",
			authHeader: "",
			bodyAPIKey: apiKey,
			expectCode: http.StatusUnauthorized,
		},
		{
			name:       "both present and matching (idempotent)",
			authHeader: "Bearer " + apiKey,
			bodyAPIKey: apiKey,
			expectCode: http.StatusOK,
		},
		{
			name:       "both present and mismatched (header wins, body ignored)",
			authHeader: "Bearer " + apiKey,
			bodyAPIKey: "wrongapikeyact001",
			expectCode: http.StatusOK,
		},
	}

	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// Each subtest needs its own unused key because the
			// handler marks the key as activated on successful
			// activation.
			newKey := fmt.Sprintf("OZ-ACTPATH-%02d", i)
			seedLicenseKey(t, app, newKey, "pro", "unused", "2099-12-31 23:59:59.000Z")

			body := fmt.Sprintf(`{"key":"%s","email":"%s","machine_id":"actpathmac%05d","api_key":"%s"}`,
				newKey, email, i, tc.bodyAPIKey)
			req := httptest.NewRequest("POST", "/api/v1/license/activate", strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			if tc.authHeader != "" {
				req.Header.Set("Authorization", tc.authHeader)
			}

			rec := httptest.NewRecorder()
			mux, _ := se.Router.BuildMux()
			mux.ServeHTTP(rec, req)

			if rec.Code != tc.expectCode {
				t.Errorf("expected %d, got %d. Body: %s", tc.expectCode, rec.Code, rec.Body.String())
			}
			if tc.expectCode == http.StatusUnauthorized {
				if got := rec.Header().Get("WWW-Authenticate"); got == "" {
					t.Errorf("expected WWW-Authenticate hint on 401, got none")
				}
			}
		})
	}
}

// ── Tests: Activation End-to-End Lifecycle ───────────────────────
//
// TestActivateHandler_Lifecycle exercises the full activation flow in a
// single sequential test that simulates a real customer journey:
//
//  1. First activation of an unused key → creates tenant + subscription +
//     returns api_key.
//  2. Re-activation of the same key+email (with api_key) → returns cached
//     subscription (key-reuse branch).
//  3. Re-activation with wrong email → rejected 401 "Wrong email or phone
//     number".
//  4. Activation of a new key on the existing tenant WITHOUT api_key →
//     rejected 401 "api_key required" (H1 gate).
//  5. Activation of a new key with WRONG api_key → rejected 401 (H1 gate).
//
// While the five scenarios each have individual unit tests (above), this
// lifecycle test chains them sequentially against a SINGLE TestApp instance
// — verifying that state persisted by step N is correctly observed by step
// N+1. Example regressions caught only here: the tenant email
// normalization accidentally creating a second tenant for step-3's wrong
// email; the key-reuse branch in step-2 clobbering the subscription
// created in step-1; the H1 gate in step-4 leaking whether the api_key
// parameter was missing vs. mismatched.
func TestActivateHandler_Lifecycle(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	// ── Shared test constants ─────────────────────────────────
	const (
		email      = "lifecycletest001@example.com"
		machineID  = "lifecyclemac001"
		key1       = "OZ-LIFECYCLE-KEY1" // used for steps 1, 2, 3
		key2       = "OZ-LIFECYCLE-KEY2" // used for steps 4, 5
		wrongEmail = "lifecycletest002@example.com"
		wrongKey   = "wrong-api-key-xxxxxxxxxx"
		phoneNum   = "+15551234567"
	)

	// Seed both license keys as unused.
	seedLicenseKey(t, app, key1, "pro", "unused", "2099-12-31 23:59:59.000Z")
	seedLicenseKey(t, app, key2, "pro", "unused", "2099-12-31 23:59:59.000Z")

	var apiKey string // populated from step 1
	var tenantID string

	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}

	// ── Step 1: first activation (create tenant + subscription) ──
	t.Run("step1_first_activation", func(t *testing.T) {
		body := strings.NewReader(fmt.Sprintf(`{
			"key": "%s",
			"email": "%s",
			"machine_id": "%s",
			"phone": "%s"
		}`, key1, email, machineID, phoneNum))
		req := httptest.NewRequest("POST", "/api/v1/license/activate", body)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		var resp map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to parse response: %v", err)
		}

		// Assert: response contains signed_payload, signature, tenant_id, api_key.
		if _, ok := resp["signed_payload"]; !ok {
			t.Error("expected signed_payload")
		}
		if _, ok := resp["signature"]; !ok {
			t.Error("expected signature")
		}
		if _, ok := resp["tenant_id"]; !ok {
			t.Error("expected tenant_id")
		}
		if v, ok := resp["api_key"]; ok {
			apiKey = v.(string)
			if !strings.HasPrefix(apiKey, "oz_") {
				t.Errorf("api_key should start with 'oz_', got: %s", apiKey)
			}
		} else {
			t.Fatal("expected api_key for new tenant")
		}
		tenantID = resp["tenant_id"].(string)

		// Verify DB state: tenant created.
		tenant, err := app.FindFirstRecordByData("tenants", "email", email)
		if err != nil {
			t.Fatalf("tenant should be created: %v", err)
		}
		if tenant.GetString("status") != "active" {
			t.Errorf("tenant status should be active")
		}
		// The stored value is a bcrypt hash, not the plaintext key.
		if !verifyAPIKey(tenant.GetString("api_key"), apiKey) {
			t.Errorf("stored api_key hash does not verify against the issued key %q", apiKey)
		}

		// Verify the persisted phone matches the request (not the old "-" placeholder).
		if tenant.GetString("phone") != "+15551234567" {
			t.Errorf("expected phone=+15551234567 in DB, got %q", tenant.GetString("phone"))
		}

		// Verify DB state: key marked activated.
		kr, err := app.FindFirstRecordByData("license_keys", "key", key1)
		if err != nil {
			t.Fatalf("key should exist: %v", err)
		}
		if kr.GetString("status") != "activated" {
			t.Errorf("key status should be activated, got %s", kr.GetString("status"))
		}

		// Verify DB state: subscription created.
		subs, err := app.FindRecordsByFilter("subscriptions",
			"tenant_id = {:tenant_id}", "", 1, 0,
			map[string]any{"tenant_id": tenantID})
		if err != nil || len(subs) == 0 {
			t.Fatal("subscription should have been created")
		}
		if subs[0].GetString("status") != "active" {
			t.Errorf("subscription status should be active")
		}

		// Verify DB state: machine registered.
		mach, err := app.FindRecordsByFilter("tenant_machines",
			"tenant_id = {:tenant_id}", "", 1, 0,
			map[string]any{"tenant_id": tenantID})
		if err != nil || len(mach) == 0 {
			t.Fatal("machine should have been registered")
		}
	})

	// ── Step 2: re-activate same key+email (WITH api_key) ───────
	// Should hit the key-reuse branch and return cached subscription.
	t.Run("step2_reactivate_same_key_returns_cached_subscription", func(t *testing.T) {
		body := strings.NewReader(fmt.Sprintf(`{
			"key": "%s",
			"email": "%s",
			"machine_id": "%s"
		}`, key1, email, "lifecyclemac002"))
		req := httptest.NewRequest("POST", "/api/v1/license/activate", body)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+apiKey)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 (key reuse by same tenant), got %d: %s", rec.Code, rec.Body.String())
		}

		var resp map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to parse response: %v", err)
		}

		// Must return signed_payload and signature.
		if _, ok := resp["signed_payload"]; !ok {
			t.Error("expected signed_payload on reuse")
		}
		if _, ok := resp["signature"]; !ok {
			t.Error("expected signature on reuse")
		}
		// On key reuse, api_key is NOT re-emitted: the stored value is a
		// one-way bcrypt hash, and this caller already presented the
		// correct key. (A caller without a valid key gets a freshly
		// rotated key instead — verified in the no-api_key sub-request
		// below.)
		if _, ok := resp["api_key"]; ok {
			t.Error("api_key must NOT be re-emitted on key reuse when the caller already holds it")
		}
		if v, ok := resp["tenant_id"]; !ok || v.(string) != tenantID {
			t.Errorf("expected tenant_id=%q on reuse, got %v", tenantID, resp["tenant_id"])
		}

		// Must NOT have created a second subscription.
		subs, err := app.FindRecordsByFilter("subscriptions",
			"tenant_id = {:tenant_id}", "", 5, 0,
			map[string]any{"tenant_id": tenantID})
		if err != nil {
			t.Fatalf("failed to query subscriptions: %v", err)
		}
		if len(subs) != 1 {
			t.Errorf("expected exactly 1 subscription after reuse, got %d", len(subs))
		}

		// Key status must still be "activated" (not re-activated as a new key).
		kr, _ := app.FindFirstRecordByData("license_keys", "key", key1)
		if kr != nil && kr.GetString("status") != "activated" {
			t.Errorf("key status should remain activated after reuse, got %s", kr.GetString("status"))
		}

		// Re-activation also works WITHOUT the api_key (documented behavior:
		// the email + key pair is sufficient proof of ownership). Send a
		// second request without api_key to verify this path.
		body2 := strings.NewReader(fmt.Sprintf(`{
			"key": "%s",
			"email": "%s",
			"machine_id": "%s"
		}`, key1, email, "lifecycmac002b"))
		req2 := httptest.NewRequest("POST", "/api/v1/license/activate", body2)
		req2.Header.Set("Content-Type", "application/json")
		rec2 := httptest.NewRecorder()
		mux.ServeHTTP(rec2, req2)

		if rec2.Code != http.StatusOK {
			t.Fatalf("expected 200 (key reuse WITHOUT api_key), got %d: %s", rec2.Code, rec2.Body.String())
		}
		var resp2 map[string]any
		if err := json.Unmarshal(rec2.Body.Bytes(), &resp2); err != nil {
			t.Fatalf("failed to parse response (no-api_key reuse): %v", err)
		}
		if _, ok := resp2["signed_payload"]; !ok {
			t.Error("expected signed_payload on reuse without api_key")
		}
		// LSE-11 phase A: losing the api_key no longer triggers an instant
		// rotation. The caller still gets the signed subscription (enough
		// to run the POS) but the api_key is re-emitted only after inbox
		// proof (a recovery code).
		if v, ok := resp2["api_key"]; ok {
			t.Errorf("api_key must NOT be re-emitted without a recovery code, got %v", v)
		}
		rot, ok := resp2["api_key_rotation"].(map[string]any)
		if !ok {
			t.Errorf("expected api_key_rotation hint on reuse without api_key, got %v", resp2["api_key_rotation"])
		} else if rot["status"] != "recovery_required" {
			t.Errorf("expected api_key_rotation.status=recovery_required, got %v", rot["status"])
		}
	})

	// ── Step 2c: LSE-11 phase A — repeat re-activation stays safe ──
	// A THIRD re-activation without api_key or recovery code must keep
	// answering 200 + recovery_required: no rotation, no api_key, no
	// throttling ping-pong — the caller just keeps the signed payload.
	t.Run("step2c_recovery_required_repeat", func(t *testing.T) {
		resetRateLimiters() // isolate from the IP bucket
		body := strings.NewReader(fmt.Sprintf(`{
			"key": "%s",
			"email": "%s",
			"machine_id": "%s"
		}`, key1, email, "lifecycmac002c"))
		req := httptest.NewRequest("POST", "/api/v1/license/activate", body)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 (recovery_required), got %d: %s", rec.Code, rec.Body.String())
		}
		var resp map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to parse response: %v", err)
		}
		if _, ok := resp["signed_payload"]; !ok {
			t.Error("expected signed_payload on repeat reuse")
		}
		if _, ok := resp["api_key"]; ok {
			t.Error("api_key must NOT be re-emitted without a recovery code")
		}
		rot, ok := resp["api_key_rotation"].(map[string]any)
		if !ok {
			t.Errorf("expected api_key_rotation hint, got %v", resp["api_key_rotation"])
		} else if rot["status"] != "recovery_required" {
			t.Errorf("expected api_key_rotation.status=recovery_required, got %v", rot["status"])
		}
	})

	// ── Step 3: re-activate with wrong email ────────────────────
	// Should be rejected with 401 "invalid or already used license key".
	t.Run("step3_wrong_email_rejected", func(t *testing.T) {
		body := strings.NewReader(fmt.Sprintf(`{
			"key": "%s",
			"email": "%s",
			"machine_id": "%s"
		}`, key1, wrongEmail, "lifecyclemac003"))
		req := httptest.NewRequest("POST", "/api/v1/license/activate", body)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 (wrong email), got %d: %s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "invalid or already used license key") {
			t.Errorf("expected 'invalid or already used license key', got: %s", rec.Body.String())
		}

		// Must NOT have created a spurious tenant for the wrong email.
		wrongTenant, _ := app.FindFirstRecordByData("tenants", "email", wrongEmail)
		if wrongTenant != nil {
			t.Error("a tenant was created for the wrong email — this should not happen")
		}
	})

	// ── Step 4: new key on existing tenant WITHOUT api_key ─────
	// Should be rejected with 401 "api_key required" (H1 gate).
	t.Run("step4_new_key_no_api_key_rejected", func(t *testing.T) {
		resetRateLimiters()
		body := strings.NewReader(fmt.Sprintf(`{
			"key": "%s",
			"email": "%s",
			"machine_id": "%s"
		}`, key2, email, "lifecyclemac004"))
		req := httptest.NewRequest("POST", "/api/v1/license/activate", body)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 (no api_key for existing tenant), got %d: %s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "api_key required") {
			t.Errorf("expected 'api_key required', got: %s", rec.Body.String())
		}

		// Key must still be "unused" (the H1 gate blocked it before
		// the handler reached the key-save path).
		kr, _ := app.FindFirstRecordByData("license_keys", "key", key2)
		if kr != nil && kr.GetString("status") != "unused" {
			t.Errorf("key2 should still be unused after blocked attempt, got %s", kr.GetString("status"))
		}
	})

	// ── Step 5: new key with WRONG api_key ────────────────────
	// Should be rejected with 401.
	t.Run("step5_new_key_wrong_api_key_rejected", func(t *testing.T) {
		resetRateLimiters()
		body := strings.NewReader(fmt.Sprintf(`{
			"key": "%s",
			"email": "%s",
			"machine_id": "%s"
		}`, key2, email, "lifecyclemac005"))
		req := httptest.NewRequest("POST", "/api/v1/license/activate", body)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+wrongKey)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 (wrong api_key), got %d: %s", rec.Code, rec.Body.String())
		}

		// Verify the response contains the expected error message.
		if !strings.Contains(rec.Body.String(), "api_key required") {
			t.Errorf("expected 'api_key required (or mismatched)' error, got: %s", rec.Body.String())
		}

		// Response must NOT leak the real api_key.
		if strings.Contains(rec.Body.String(), apiKey) {
			t.Error("response leaked the real api_key on wrong-key rejection")
		}

		// Key must still be "unused" (the H1 gate blocked it before
		// the handler reached the key-save path).
		kr, _ := app.FindFirstRecordByData("license_keys", "key", key2)
		if kr != nil && kr.GetString("status") != "unused" {
			t.Errorf("key2 should still be unused after blocked attempt, got %s", kr.GetString("status"))
		}
	})
}

// ── Tests: Regression coverage (activation flow audit) ─────────────

// TestActivateHandler_SuccessClearsKeyFailures verifies that a successful
// first activation clears any accumulated brute-force failure tracking for
// the key. Without this, a legitimate user who fat-fingers the key 3+
// times before getting it right would be permanently blocked from
// re-activating (e.g., after reinstalling on a new machine) until the
// cooldown expires.
func TestActivateHandler_DifferentTenantReturnsWrongEmailError(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	// Seed tenant A (the one that exists under the request's email).
	seedTenant(t, app, "tenanta00000001", "tenantakey000001", "active")

	// Seed tenant B (the one that actually activated the key).
	seedTenant(t, app, "tenantb00000001", "tenantbkey000001", "active")

	// Seed a key activated by tenant B.
	seedActivatedLicenseKey(t, app, "OZ-DIFF-TENANT01", "pro", "activated",
		"2099-12-31 23:59:59.000Z", "tenantb00000001")

	// Send activation with tenant A's email + tenant A's api_key,
	// but the key belongs to tenant B.
	body := strings.NewReader(`{
		"key": "OZ-DIFF-TENANT01",
		"email": "tenanta00000001@example.com",
		"machine_id": "difftenmac00001"
	}`)
	req := httptest.NewRequest("POST", "/api/v1/license/activate", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer tenantakey000001")
	rec := httptest.NewRecorder()
	mux, _ := se.Router.BuildMux()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 (wrong email for key), got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "invalid or already used license key") {
		t.Errorf("expected 'invalid or already used license key', got: %s", rec.Body.String())
	}
}

// TestActivateHandler_SuccessClearsKeyFailures verifies that a successful
// first activation clears any accumulated brute-force failure tracking for
// the key. Without this, a legitimate user who fat-fingers the key a few
// times before getting it right could be blocked from subsequent
// re-activations.
//
// Approach: pre-fail 2 times (below maxAttempts=3, so the handler's
// isBlocked check won't block the activation). After successful activation,
// record 2 more failures — if clearKey was NOT called, the accumulated
// count would be 4 (>= maxAttempts=3 → blocked). If clearKey WAS called,
// the count resets to just 2 (not blocked).
func TestActivateHandler_SuccessClearsKeyFailures(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	const testKey = "OZ-CLR-FAIL-KEY1"
	seedLicenseKey(t, app, testKey, "pro", "unused", "2099-12-31 23:59:59.000Z")

	// Record 2 failed attempts (below maxAttempts=3, so isBlocked
	// returns false and the handler can proceed with activation).
	keyFailTracker.recordFailure(testKey)
	keyFailTracker.recordFailure(testKey)

	// Verify the key is NOT blocked (2 < maxAttempts=3).
	if blocked, _ := keyFailTracker.isBlocked(testKey); blocked {
		t.Fatal("precondition: key should NOT be blocked after only 2 failures")
	}

	// Perform a successful first activation — the handler calls clearKey.
	body := strings.NewReader(`{"key":"` + testKey + `","email":"clrfailtest001@example.com","machine_id":"clrfailmac00001"}`)
	req := httptest.NewRequest("POST", "/api/v1/license/activate", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux, _ := se.Router.BuildMux()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 (successful activation), got %d: %s", rec.Code, rec.Body.String())
	}

	// After successful activation, clearKey should have removed all
	// prior failures. Record 2 more failures — if clearKey was NOT
	// called, the count would now be 4 (blocked). If it WAS called,
	// the count is just 2 (not blocked).
	keyFailTracker.recordFailure(testKey)
	keyFailTracker.recordFailure(testKey)
	if blocked, _ := keyFailTracker.isBlocked(testKey); blocked {
		t.Error("expected key to NOT be blocked (clearKey should have reset the counter); got blocked")
	}
}

// ── Tests: Renew handler audit fixes ───────────────────────────────

// TestRenewHandler_SuccessClearsKeyFailures verifies that a successful
// renewal clears accumulated brute-force failure tracking for the key.
// Mirrors TestActivateHandler_SuccessClearsKeyFailures for renew.
func TestRenewHandler_SuccessClearsKeyFailures(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	const (
		tenantID = "rnwclearfn00001"
		apiKey   = "rnwclearfn000001"
		newKey   = "OZ-RNW-CLR-KEY1"
	)
	seedTenant(t, app, tenantID, apiKey, "active")
	seedSubscriptionStatus(t, app, tenantID, "pro", "active", time.Now().AddDate(0, -1, 0))
	seedLicenseKey(t, app, newKey, "pro", "unused", "2099-12-31 23:59:59.000Z")

	// Record 2 failed attempts (below maxAttempts=3).
	keyFailTracker.recordFailure(newKey)
	keyFailTracker.recordFailure(newKey)

	if blocked, _ := keyFailTracker.isBlocked(newKey); blocked {
		t.Fatal("precondition: key should NOT be blocked after only 2 failures")
	}

	// Successful renewal.
	body := strings.NewReader(fmt.Sprintf(`{"tenant_id":"%s","key":"%s"}`, tenantID, newKey))
	req := httptest.NewRequest("POST", "/api/v1/license/renew", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	rec := httptest.NewRecorder()
	mux, _ := se.Router.BuildMux()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 (successful renewal), got %d: %s", rec.Code, rec.Body.String())
	}

	// After success, clearKey should have reset the counter.
	// Record 2 more failures — count should be 2 (not 4 → blocked).
	keyFailTracker.recordFailure(newKey)
	keyFailTracker.recordFailure(newKey)
	if blocked, _ := keyFailTracker.isBlocked(newKey); blocked {
		t.Error("expected key to NOT be blocked (clearKey should have reset the counter); got blocked")
	}
}

// TestRenewHandler_ExpiredKeyRejected verifies that an unused key with
// an expiry date in the past cannot be used for renewal.
func TestRenewHandler_ExpiredKeyRejected(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	const (
		tenantID = "rnwexpiry000001"
		apiKey   = "rnwexpiry000001"
		expKey   = "OZ-RNW-EXPIRED01"
	)
	seedTenant(t, app, tenantID, apiKey, "active")
	seedSubscriptionStatus(t, app, tenantID, "pro", "active", time.Now().AddDate(0, -1, 0))

	// Seed a key that is unused but expired.
	seedLicenseKey(t, app, expKey, "pro", "unused", "2020-01-01 00:00:00.000Z")

	body := strings.NewReader(fmt.Sprintf(`{"tenant_id":"%s","key":"%s"}`, tenantID, expKey))
	req := httptest.NewRequest("POST", "/api/v1/license/renew", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	rec := httptest.NewRecorder()
	mux, _ := se.Router.BuildMux()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusGone {
		t.Fatalf("expected 410 (key expired), got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "expired") {
		t.Errorf("expected 'expired' in response, got: %s", rec.Body.String())
	}
}

// ── Tests: Status handler audit fixes ──────────────────────────────

// TestStatusHandler_ExcludesInactiveSubscription verifies that /status
// filters by active subscriptions only. Without the status filter, an
// expired subscription from a prior churn could shadow an active one.
func TestStatusHandler_ExcludesInactiveSubscription(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	const (
		tenantID = "statexpin000000"
		apiKey   = "statexpinkey001"
	)
	seedTenant(t, app, tenantID, apiKey, "active")

	// Seed an expired subscription (MORE RECENT starts_at — should sort first without status filter).
	seedSubscriptionStatus(t, app, tenantID, "pro", "expired", time.Now())

	// Seed an active subscription (OLDER starts_at — only returned with status filter).
	seedSubscriptionStatus(t, app, tenantID, "pro", "active", time.Now().AddDate(0, -1, 0))

	req := httptest.NewRequest("POST", "/api/v1/license/status", nil)
	req.Header.Set("Authorization", "Bearer "+apiKey)
	rec := httptest.NewRecorder()
	mux, _ := se.Router.BuildMux()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	// Must return active=true because the active subscription should
	// be found, not the expired one.
	if body["active"] != true {
		t.Errorf("expected active=true (found active subscription), got %v; status filter may not be working", body["active"])
	}
}

// seedSubscriptionStatus is seedSubscription with an explicit starts_at
// timestamp (for tests that need to control subscription ordering).
func seedSubscriptionStatus(t *testing.T, app *tests.TestApp, tenantID, tierKey, status string, startsAt time.Time) {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("subscriptions")
	if err != nil {
		t.Fatalf("subscriptions collection not found: %v", err)
	}
	rec := core.NewRecord(col)
	rec.Set("tenant_id", []string{tenantID})
	rec.Set("tier_key", tierKey)
	rec.Set("max_stores", 5)
	rec.Set("max_pos_instances", 3)
	rec.Set("allowed_types", `["restaurant-pos", "store-pos"]`)
	rec.Set("status", status)
	rec.Set("starts_at", startsAt.Format(time.RFC3339))
	rec.Set("expires_at", startsAt.AddDate(1, 0, 0).Format(time.RFC3339))
	rec.Set("grace_until", startsAt.AddDate(1, 0, 14).Format(time.RFC3339))
	rec.Set("signed_payload", "{}")
	rec.Set("signature", "dummy-sig")
	if err := app.Save(rec); err != nil {
		t.Fatalf("failed to seed subscription for %q: %v", tenantID, err)
	}
}

// seedMachine inserts a tenant_machines record directly via app.Save.

// ── Tests: Machine Revocation via /status (P8-2) ──────────────────
//
// Machine-level revocation is performed via the /api/v1/license/status
// endpoint by including revoke:true and machine_id in the request body.
// This avoids needing a separate route (PocketBase chi router routing

// ── Tests: Machine Revocation via /status (P8-2) ──────────────────

func TestStatusHandler_MachineNotFound(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTenant(t, app, "devmachnotfnd01", "devmachnotfndkey", "active")

	body := strings.NewReader(`{"machine_id":"abababababababa"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/license/status", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer devmachnotfndkey")
	rec := httptest.NewRecorder()
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if resp["device_revoked"] != false {
		t.Errorf("expected device_revoked=false for unknown machine, got %v", resp["device_revoked"])
	}
}

func TestStatusHandler_RevokeMachine(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTenant(t, app, "revstat00000001", "revstatkey000001", "active")
	seedMachine(t, app, "deadbeef0000001", "revstat00000001")

	body := strings.NewReader(`{"machine_id":"deadbeef0000001","revoke":true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/license/status", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer revstatkey000001")
	rec := httptest.NewRecorder()
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if resp["device_revoked"] != true {
		t.Errorf("expected device_revoked=true after revoke, got %v", resp["device_revoked"])
	}
	if resp["revoke_performed"] != true {
		t.Errorf("expected revoke_performed=true, got %v", resp["revoke_performed"])
	}

	machines, err := app.FindRecordsByFilter(
		"tenant_machines",
		"machine_id = {:machine_id} && tenant_id = {:tenant_id}",
		"", 1, 0,
		map[string]any{
			"machine_id": "deadbeef0000001",
			"tenant_id":  "revstat00000001",
		},
	)
	if err != nil || len(machines) == 0 {
		t.Fatal("machine should exist")
	}
	if machines[0].GetDateTime("revoked_at").Time().IsZero() {
		t.Error("revoked_at should be set after revoke")
	}
}

func TestStatusHandler_RevokeAlreadyRevoked(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTenant(t, app, "revdupstenant01", "revdupstatekey001", "active")
	seedMachine(t, app, "cafebabe0000001", "revdupstenant01")

	body := strings.NewReader(`{"machine_id":"cafebabe0000001","revoke":true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/license/status", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer revdupstatekey001")
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}

	rec1 := httptest.NewRecorder()
	mux.ServeHTTP(rec1, req)
	if rec1.Code != http.StatusOK {
		t.Fatalf("first revoke expected 200, got %d: %s", rec1.Code, rec1.Body.String())
	}
	var resp1 map[string]any
	json.Unmarshal(rec1.Body.Bytes(), &resp1)
	if resp1["revoke_performed"] != true {
		t.Errorf("expected revoke_performed=true on first revoke, got %v", resp1["revoke_performed"])
	}

	rec2 := httptest.NewRecorder()
	// Create a fresh request with a new body reader (the original body was consumed on first ServeHTTP).
	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/license/status", strings.NewReader(`{"machine_id":"cafebabe0000001","revoke":true}`))
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("Authorization", "Bearer revdupstatekey001")
	mux.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("second revoke expected 200, got %d: %s", rec2.Code, rec2.Body.String())
	}
	var resp2 map[string]any
	json.Unmarshal(rec2.Body.Bytes(), &resp2)
	if resp2["device_revoked"] != true {
		t.Errorf("expected device_revoked=true on second revoke, got %v", resp2["device_revoked"])
	}
	if resp2["revoke_performed"] == true {
		t.Errorf("expected revoke_performed=false (already revoked), got true")
	}
}

func TestStatusHandler_RevokeWithoutMachineID(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTenant(t, app, "devnomachreq001", "devnomachreqkey0", "active")

	body := strings.NewReader(`{"revoke":true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/license/status", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer devnomachreqkey0")
	rec := httptest.NewRecorder()
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if resp["device_revoked"] != false {
		t.Errorf("expected device_revoked=false (no machine_id), got %v", resp["device_revoked"])
	}
	if resp["revoke_performed"] == true {
		t.Errorf("expected revoke_performed=false (no machine_id), got true")
	}
}

func TestStatusHandler_RevokeDifferentTenantMachine(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTenant(t, app, "tenanta00000001", "tenanta-key000001", "active")
	seedTenant(t, app, "tenantb00000001", "tenantb-key000001", "active")
	seedMachine(t, app, "beefcafe0000001", "tenanta00000001")

	body := strings.NewReader(`{"machine_id":"beefcafe0000001","revoke":true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/license/status", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer tenantb-key000001")
	rec := httptest.NewRecorder()
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if resp["device_revoked"] != false {
		t.Errorf("expected device_revoked=false (machine belongs to different tenant), got %v", resp["device_revoked"])
	}

	machines, err := app.FindRecordsByFilter(
		"tenant_machines",
		"machine_id = {:machine_id} && tenant_id = {:tenant_id}",
		"", 1, 0,
		map[string]any{
			"machine_id": "beefcafe0000001",
			"tenant_id":  "tenanta00000001",
		},
	)
	if err == nil && len(machines) > 0 {
		if !machines[0].GetDateTime("revoked_at").Time().IsZero() {
			t.Error("Tenant A's machine should NOT be revoked after Tenant B's request")
		}
	}
}

// seedMachine inserts a tenant_machines record directly via app.Save.
// The machine_id must be exactly 15 hex characters (matching the
// ^[a-f0-9]{15}$ pattern defined in pb_schema.json). The record id
// is auto-generated by PocketBase (do NOT set it explicitly).
func seedMachine(t *testing.T, app *tests.TestApp, machineIDHex, tenantID string) {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("tenant_machines")
	if err != nil {
		t.Fatalf("tenant_machines collection not found: %v", err)
	}
	rec := core.NewRecord(col)
	// Do NOT set id — PocketBase auto-generates it.
	rec.Set("tenant_id", []string{tenantID})
	rec.Set("machine_id", machineIDHex)
	rec.Set("first_seen_at", time.Now().UTC().Format(time.RFC3339))
	rec.Set("last_seen_at", time.Now().UTC().Format(time.RFC3339))
	if err := app.Save(rec); err != nil {
		t.Fatalf("failed to seed machine %q for tenant %q: %v", machineIDHex, tenantID, err)
	}
}
