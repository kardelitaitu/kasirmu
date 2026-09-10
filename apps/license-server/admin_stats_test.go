package main

// Tests for the admin dashboard stats endpoint (admin_stats.go) — bug hunt
// round 6. B25: the FX cache pinned a transient upstream failure to the
// 16000 fallback for the full 1-hour success TTL. (B26 was investigated
// and dropped — see the warning note at the bottom of this file.)

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// ── B25: FX negative cache ───────────────────────────────────────────

func resetFxCacheForTest() {
	fxCacheMu.Lock()
	defer fxCacheMu.Unlock()
	fxCache = nil
}

func TestGetFxRateFailureIsNotPinnedToSuccessTTL(t *testing.T) {
	resetFxCacheForTest()
	defer resetFxCacheForTest()
	origFetcher, origRetry := fxFetcher, fxRetryTTL
	defer func() { fxFetcher, fxRetryTTL = origFetcher, origRetry }()

	// Negative-cache TTL made observable: a failed fetch must be retried
	// after fxRetryTTL (short), NOT after fxCacheTTL (1 hour). The test
	// sets it negative so the very next call re-fetches deterministically.
	fxRetryTTL = -time.Second

	// First call: upstream down → fallback 16000, live=false.
	fxFetcher = func() (float64, bool) { return 0, false }
	rate, _, live := getFxRate()
	if rate != 16000 || live {
		t.Fatalf("expected fallback 16000/live=false, got rate=%v live=%v", rate, live)
	}

	// Upstream recovers immediately. B25: the old code cached the failure
	// with the SAME 1h TTL as a success, so this call returned the stale
	// fallback for an hour — the dashboard showed a wrong rate the whole
	// time (IDR conversions ~3% off) even though the API was healthy.
	fxFetcher = func() (float64, bool) { return 17123.45, true }
	rate, _, live = getFxRate()
	if !live || rate != 17123.45 {
		t.Fatalf("B25: failure pinned to success TTL — got rate=%v live=%v, want live 17123.45", rate, live)
	}
}

func TestGetFxRateSuccessCachedForTTL(t *testing.T) {
	resetFxCacheForTest()
	defer resetFxCacheForTest()
	origFetcher := fxFetcher
	defer func() { fxFetcher = origFetcher }()

	calls := 0
	fxFetcher = func() (float64, bool) { calls++; return 16500, true }
	if rate, _, live := getFxRate(); rate != 16500 || !live {
		t.Fatalf("live fetch expected, got rate=%v live=%v", rate, live)
	}
	getFxRate()
	if calls != 1 {
		t.Fatalf("success must cache for fxCacheTTL: fetcher called %d times, want 1", calls)
	}
}

// ── B32: top subscribers renewal is a raw PocketBase datetime ────────

func TestAdminStatsB32_TopSubsRenewalIsCleanDate(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	seedDashboardTenant(t, app, "stats-b32@test.com")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	rec := doJSON(mux, http.MethodGet, "/api/v1/admin/stats", "Bearer secret-admin-key", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var body struct {
		TopSubscribers []struct {
			Email   string `json:"email"`
			Renewal string `json:"renewal"`
		} `json:"topSubscribers"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if len(body.TopSubscribers) == 0 {
		t.Fatal("expected the seeded pro subscription in topSubscribers")
	}
	// recentSignups/expiringSoon render as 2006-01-02; the renewal column
	// used GetString("expires_at") and leaked the raw PocketBase format
	// ("2027-01-01 00:00:00.000Z") into the dashboard table.
	for _, ts := range body.TopSubscribers {
		if ts.Renewal == "" {
			continue // no expiry — empty is fine
		}
		if _, err := time.Parse("2006-01-02", ts.Renewal); err != nil {
			t.Fatalf("B32: renewal=%q is not a clean 2006-01-02 date", ts.Renewal)
		}
	}
}

// ── B26 (DROPPED hypothesis, kept as a warning) ──────────────────────
//
// Round-6 first read the revenue merge as "IDR-only months collapse to
// $0" and test-driven a fix that added realIdr/fxRate to realUsd. The
// pre-existing TestAdminStats_RealRevenue (revenue_events_test.go) then
// FAILED — and it was right: revenue_events.go stores BOTH currencies of
// every payment (native amount + FX-converted counterpart at write time),
// so amount_usd already includes Midtrans IDR revenue. Adding idr/fx
// double-counts every payment. Hypothesis dropped, merge reverted.
// Lesson: check the WRITER's data model before "fixing" a reader.

// ── #4 needsAttention panel ──────────────────────────────────────────
func TestAdminStats_NeedsAttention(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	tenantID, _ := seedDashboardTenant(t, app, "attention@test.com")
	// The seed created an ACTIVE pro subscription. Flip it to grace_period
	// so the needs-attention scan finds it.
	subs, _ := app.FindRecordsByFilter("subscriptions", "tenant_id = {:tid}", "", 1, 0, map[string]any{"tid": tenantID})
	if len(subs) == 0 {
		t.Fatal("expected the seeded subscription")
	}
	sub := subs[0]
	sub.Set("status", "grace_period")
	sub.Set("grace_until", time.Now().Add(7*24*time.Hour).Format(time.RFC3339))
	sub.Set("expires_at", time.Now().Add(-1*24*time.Hour).Format(time.RFC3339))
	if err := app.Save(sub); err != nil {
		t.Fatalf("flip to grace_period: %v", err)
	}

	rec := doJSON(mux, http.MethodGet, "/api/v1/admin/stats", "Bearer secret-admin-key", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var body struct {
		NeedsAttention []struct {
			Type  string `json:"type"`
			Email string `json:"email"`
			Tier  string `json:"tier"`
		} `json:"needsAttention"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	var found bool
	for _, item := range body.NeedsAttention {
		if item.Type == "grace_period" && item.Email == "attention@test.com" && item.Tier == "pro" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected a grace_period needs-attention item for attention@test.com, got %+v", body.NeedsAttention)
	}
}

// ── #6 trial→paid funnel test ────────────────────────────────────────

func TestAdminStats_TrialFunnel(t *testing.T) {
	resetProviderRevenueCache()
	resetRateLimiters()
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	tenantID, _ := seedDashboardTenant(t, app, "funnel@test.com")

	// Seed a trial_registration row.
	col, _ := app.FindCollectionByNameOrId("trial_registrations")
	trial := core.NewRecord(col)
	trial.Set("hardware_fingerprint", "fp-funnel-001")
	trial.Set("first_seen_at", time.Now().UTC().Format(time.RFC3339))
	trial.Set("trial_expires_at", time.Now().UTC().Add(7*24*time.Hour).Format(time.RFC3339))
	trial.Set("platform", "windows")
	trial.Set("app_version", "0.0.35")
	if err := app.Save(trial); err != nil {
		t.Fatalf("save trial registration: %v", err)
	}

	// The seeded subscription from seedDashboardTenant is active with tier_key=pro.
	// Set payment_provider to paddle so it counts as a paid conversion.
	subs, _ := app.FindRecordsByFilter("subscriptions", "tenant_id = {:tid}", "", 1, 0, map[string]any{"tid": tenantID})
	if len(subs) > 0 {
		subs[0].Set("payment_provider", "paddle")
		subs[0].Set("starts_at", time.Now().UTC().Format(time.RFC3339))
		if err := app.Save(subs[0]); err != nil {
			t.Fatalf("set payment_provider: %v", err)
		}
	}

	rec := doJSON(mux, http.MethodGet, "/api/v1/admin/stats", "Bearer secret-admin-key", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var body struct {
		TrialFunnel []struct {
			Month  string `json:"month"`
			Trials int    `json:"trials"`
			Paid   int    `json:"paid"`
		} `json:"trialFunnel"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if len(body.TrialFunnel) != 12 {
		t.Fatalf("expected 12 funnel months, got %d", len(body.TrialFunnel))
	}
	curKey := time.Now().UTC().Format("2006-01")
	var found bool
	for _, f := range body.TrialFunnel {
		if f.Month == curKey {
			found = true
			if f.Trials < 1 {
				t.Errorf("current month trials = %d, want >= 1", f.Trials)
			}
			if f.Paid < 1 {
				t.Errorf("current month paid = %d, want >= 1", f.Paid)
			}
			break
		}
	}
	if !found {
		t.Errorf("current month %q not found in funnel", curKey)
	}
}

// ── Per-market price maps (saas-3 billing, owner go D95) ────────────

func TestAdminStats_MarketPriceMapRoutesLocalAndKeepsUsdFallback(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	idrTenant, _ := seedDashboardTenant(t, app, "market-idr@test.com")
	seedDashboardTenant(t, app, "market-usd@test.com")

	// The IDR tenant's charging currency is provider-verified via its
	// revenue event (the subscriptions collection carries no market field).
	revCol, _ := app.FindCollectionByNameOrId("revenue_events")
	rev := core.NewRecord(revCol)
	rev.Set("event_id", "evt-market-idr")
	rev.Set("provider", "midtrans")
	rev.Set("tenant_id", idrTenant)
	rev.Set("currency", "IDR")
	rev.Set("amount_idr", 149000)
	if err := app.Save(rev); err != nil {
		t.Fatalf("save revenue event: %v", err)
	}

	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")
	t.Setenv("PRICE_TIERS_IDR", "pro=149900")

	rec := doJSON(mux, http.MethodGet, "/api/v1/admin/stats", "Bearer secret-admin-key", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var body struct {
		Kpis struct {
			MrrUsd      float64 `json:"mrrUsd"`
			MrrByMarket map[string]struct {
				Currency    string  `json:"currency"`
				Subscribers int     `json:"subscribers"`
				MrrLocal    float64 `json:"mrrLocal"`
			} `json:"mrrByMarket"`
			MarketPriceErrors map[string]string `json:"marketPriceErrors"`
		} `json:"kpis"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	// The IDR sub is priced at the operator's local 149900, NOT the USD
	// fallback (9.99) — and it must not ALSO appear in mrrUsd.
	if len(body.Kpis.MrrByMarket) != 1 {
		t.Fatalf("expected exactly 1 market, got %d: %v", len(body.Kpis.MrrByMarket), body.Kpis.MrrByMarket)
	}
	idr, ok := body.Kpis.MrrByMarket["IDR"]
	if !ok || idr.Subscribers != 1 || idr.MrrLocal != 149900 {
		t.Fatalf("expected IDR market 1 subscriber at 149900 local, got %+v (have %v)", idr, body.Kpis.MrrByMarket)
	}
	if body.Kpis.MrrUsd != 9.99 {
		t.Errorf("mrrUsd must count only the USD-fallback sub, got %v want 9.99", body.Kpis.MrrUsd)
	}
	if len(body.Kpis.MarketPriceErrors) != 0 {
		t.Errorf("expected no market price errors, got %v", body.Kpis.MarketPriceErrors)
	}
}

func TestAdminStats_UsdFallbackUnchangedWithoutMarketMaps(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	seedDashboardTenant(t, app, "fallback-a@test.com")
	seedDashboardTenant(t, app, "fallback-b@test.com")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")
	// Deliberately NO PRICE_TIERS_* env: every sub stays on the USD path.
	rec := doJSON(mux, http.MethodGet, "/api/v1/admin/stats", "Bearer secret-admin-key", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var body struct {
		Kpis struct {
			MrrUsd      float64        `json:"mrrUsd"`
			MrrByMarket map[string]any `json:"mrrByMarket"`
		} `json:"kpis"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if body.Kpis.MrrUsd != 19.98 {
		t.Errorf("two pro subs on the USD path = 19.98, got %v", body.Kpis.MrrUsd)
	}
	if len(body.Kpis.MrrByMarket) != 0 {
		t.Errorf("no market maps configured — mrrByMarket must be empty, got %v", body.Kpis.MrrByMarket)
	}
}

func TestAdminStats_MalformedMarketVarSkippedNotFatal(t *testing.T) {
	app, mux := dashboardMux(t)
	defer app.Cleanup()
	seedDashboardTenant(t, app, "malformed@test.com")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")
	t.Setenv("PRICE_TIERS_IDR", "pro=notanumber")
	// A broken market var must NOT boot-fail or zero out the stats (the
	// additive-optional contract, the inverse of the per-PROVIDER maps):
	// the sub falls back to USD and the parse error is reported.
	rec := doJSON(mux, http.MethodGet, "/api/v1/admin/stats", "Bearer secret-admin-key", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var body struct {
		Kpis struct {
			MrrUsd            float64           `json:"mrrUsd"`
			MarketPriceErrors map[string]string `json:"marketPriceErrors"`
		} `json:"kpis"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if body.Kpis.MrrUsd != 9.99 {
		t.Errorf("broken market map must fall back to USD, got %v want 9.99", body.Kpis.MrrUsd)
	}
	if !strings.Contains(body.Kpis.MarketPriceErrors["IDR"], "PRICE_TIERS_IDR") {
		t.Errorf("expected the IDR parse error to surface, got %v", body.Kpis.MarketPriceErrors)
	}
}
