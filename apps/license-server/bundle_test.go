package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// ── tierQuotas bundle awareness (C3.2) ──────────────────────────────

// TestBundleQuotas is the C3.2 gate: "restaurant_starter" unlocks the kds
// workspace type at the Plus tier and only there. Bundles are Plus+ per
// subscription-tiers.md §3 — Free stays locked, Pro+ already includes kds,
// and a bundle never changes the store/instance numbers, only the types.
func TestBundleQuotas(t *testing.T) {
	cases := []struct {
		name   string
		tier   string
		bundle string
		hasKDS bool
	}{
		{"plus_no_bundle_has_no_kds", "plus", "", false},
		{"plus_restaurant_starter_unlocks_kds", "plus", "restaurant_starter", true},
		{"plus_unknown_bundle_is_noop", "plus", "fancy_bundle", false},
		{"free_bundle_stays_locked", "free", "restaurant_starter", false},
		{"pro_always_has_kds", "pro", "", true},
		{"pro_bundle_unchanged", "pro", "restaurant_starter", true},
		{"premium_bundle_unchanged", "premium", "restaurant_starter", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			maxStores, maxPOS, allowed := tierQuotas(tc.tier, tc.bundle)
			hasKDS := false
			for _, w := range allowed {
				if w == "kds" {
					hasKDS = true
				}
			}
			if hasKDS != tc.hasKDS {
				t.Errorf("tier=%q bundle=%q: expected hasKDS=%v, got allowed=%v", tc.tier, tc.bundle, tc.hasKDS, allowed)
			}
			// A bundle must never change the quota numbers, only the types.
			baseStores, basePOS, _ := tierQuotas(tc.tier, "")
			if maxStores != baseStores || maxPOS != basePOS {
				t.Errorf("tier=%q bundle=%q must not change quotas (%d/%d -> %d/%d)",
					tc.tier, tc.bundle, baseStores, basePOS, maxStores, maxPOS)
			}
		})
	}
}

// ── Activation E2E: the trial-only trust boundary ───────────────────

// hasKDS reports whether the kds workspace type is in an allowed-types
// list. Shared by the bundle webhook tests (midtrans/paddle) and the
// activation E2Es below.
func hasKDS(allowed []string) bool {
	for _, w := range allowed {
		if w == "kds" {
			return true
		}
	}
	return false
}

// activateWithBundle posts an activation for key with the given bundle_id
// and returns the signed subscription payload.
func activateWithBundle(t *testing.T, se *core.ServeEvent, key, bundle string) SubscriptionPayload {
	t.Helper()
	body := strings.NewReader(fmt.Sprintf(`{
		"key": %q,
		"email": "bundlebuyer@example.com",
		"machine_id": "bundlemachine01",
		"bundle_id": %q
	}`, key, bundle))
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
	payloadStr, ok := resp["signed_payload"].(string)
	if !ok {
		t.Fatal("expected signed_payload in response")
	}
	var sp SubscriptionPayload
	if err := json.Unmarshal([]byte(payloadStr), &sp); err != nil {
		t.Fatalf("failed to parse signed_payload: %v", err)
	}
	return sp
}

func containsType(allowed []string, w string) bool {
	for _, a := range allowed {
		if a == w {
			return true
		}
	}
	return false
}

// TestBundleActivation_TrialKeyUnlocksKds: a Plus trial key activated with
// bundle_id=restaurant_starter mints a signed subscription whose
// allowed_types includes kds (the general 14-day Plus trial + bundle).
func TestBundleActivation_TrialKeyUnlocksKds(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTrialKey(t, app, "OZ-TRIAL-BNDL-001", "plus", "unused", "2099-12-31 23:59:59.000Z")
	sp := activateWithBundle(t, se, "OZ-TRIAL-BNDL-001", "restaurant_starter")

	if sp.TierKey != "plus" {
		t.Errorf("expected plus trial tier, got %q", sp.TierKey)
	}
	if !containsType(sp.AllowedTypes, "kds") {
		t.Errorf("expected restaurant_starter bundle to unlock kds, got allowed=%v", sp.AllowedTypes)
	}
	if sp.MaxStores != 1 || sp.MaxPOSInstances != 2 {
		t.Errorf("plus bundle must keep 1 store / 2 registers, got %d/%d", sp.MaxStores, sp.MaxPOSInstances)
	}

	// The persisted subscription record carries the same block.
	subs, err := app.FindRecordsByFilter("subscriptions", "tier_key = 'plus' && status = 'active'", "-starts_at", 1, 0, nil)
	if err != nil || len(subs) == 0 {
		t.Fatalf("expected a persisted plus trial subscription (err %v)", err)
	}
	if !strings.Contains(subs[0].GetString("allowed_types"), "kds") {
		t.Errorf("expected kds persisted on subscription record, got %q", subs[0].GetString("allowed_types"))
	}
}

// TestBundleActivation_TrialKeyWithoutBundle: the same trial without a
// bundle_id keeps the plain Plus quota block — no kds.
func TestBundleActivation_TrialKeyWithoutBundle(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTrialKey(t, app, "OZ-TRIAL-BNDL-002", "plus", "unused", "2099-12-31 23:59:59.000Z")
	sp := activateWithBundle(t, se, "OZ-TRIAL-BNDL-002", "")

	if sp.TierKey != "plus" {
		t.Errorf("expected plus trial tier, got %q", sp.TierKey)
	}
	if containsType(sp.AllowedTypes, "kds") {
		t.Errorf("plain plus trial must NOT include kds, got allowed=%v", sp.AllowedTypes)
	}
}

// TestBundleActivation_PaidKeyIgnoresBundle: a forged bundle_id on a paid
// key is ignored — a client-supplied bundle must never widen a paying
// license beyond what was purchased.
func TestBundleActivation_PaidKeyIgnoresBundle(t *testing.T) {
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedLicenseKeyWithLimits(t, app, "OZ-PAID-BNDL-001", "plus", "unused",
		"2099-12-31 23:59:59.000Z", 1, 2, `["restaurant-pos","store-pos","admin","inventory"]`)
	sp := activateWithBundle(t, se, "OZ-PAID-BNDL-001", "restaurant_starter")

	if sp.TierKey != "plus" {
		t.Errorf("paid key must keep tier plus, got %q", sp.TierKey)
	}
	if containsType(sp.AllowedTypes, "kds") {
		t.Errorf("paid key must ignore forged bundle_id, got allowed=%v", sp.AllowedTypes)
	}
}
