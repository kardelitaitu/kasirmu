package main

// Admin dashboard stats endpoint (ADR #42 Phase 3+) — real aggregates from
// tenants, subscriptions, and tenant_machines. Returns the same shape as the
// mock data so the frontend switches seamlessly.
//
// GET /api/v1/admin/stats
//
// Auth: adminAuth (OZ_ADMIN_KEY bearer or admin tenant session)
//
// Income/gross figures (monthlyGross*, lifetimeUsd/Idr, revenueTrend) come
// from the revenue_events ledger — written ONLY by signature-verified
// Paddle/Midtrans webhooks (see provider_revenue.go) — so admin DB edits
// (tier overrides, renews, grants) can never move the money numbers. MRR is
// computed from active subscriptions × tier price map and is always labeled
// a subscription estimate, distinct from (and never recycled into) the
// provider-verified gross. The FX rate for USD→IDR is fetched from
// open.er-api.com with a 1-hour cache (5-minute cache for the revenue
// snapshot).

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// TierPriceUSD maps each tier key to its monthly USD price. Enterprise is
// custom; the default is an estimate that can be overridden via env.
var TierPriceUSD = map[string]float64{
	"free":       0,
	"plus":       4.99,
	"pro":        9.99,
	"premium":    39.99,
	"enterprise": 99.99,
}

// ── Server-side FX rate cache (1-hour TTL) ───────────────────────────

type fxCacheEntry struct {
	rate      float64
	updatedAt time.Time
	live      bool
	ttl       time.Duration // success → fxCacheTTL; failure → fxRetryTTL
}

var (
	fxCache   *fxCacheEntry
	fxCacheMu sync.Mutex
	// fxFetcher is the test seam: returns a live USD→IDR rate or
	// (0, false) on any upstream failure. getFxRate owns caching/fallback.
	fxFetcher = fetchFxRateLive
	// fxRetryTTL is the negative-cache window after a failed fetch.
	fxRetryTTL = 1 * time.Minute
)

const fxCacheTTL = 1 * time.Hour

// fetchFxRateLive performs the actual upstream call (no caching).
func fetchFxRateLive() (float64, bool) {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get("https://open.er-api.com/v6/latest/USD")
	if err != nil {
		log.Printf("admin-stats: FX rate fetch failed: %v — using fallback", err)
		return 0, false
	}
	defer resp.Body.Close()
	var body struct {
		Rates map[string]float64 `json:"rates"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		log.Printf("admin-stats: FX rate decode failed: %v — using fallback", err)
		return 0, false
	}
	if body.Rates == nil || body.Rates["IDR"] == 0 {
		log.Printf("admin-stats: FX rate response missing IDR — using fallback")
		return 0, false
	}
	return body.Rates["IDR"], true
}

// getFxRate returns the USD→IDR rate. On first call or after TTL expiry it
// fetches from open.er-api.com; fallback is 16000.
func getFxRate() (rate float64, updatedAt time.Time, live bool) {
	fxCacheMu.Lock()
	defer fxCacheMu.Unlock()

	now := time.Now()
	if fxCache != nil && now.Sub(fxCache.updatedAt) < fxCache.ttl {
		return fxCache.rate, fxCache.updatedAt, fxCache.live
	}

	rate, live = fxFetcher()
	ttl := fxCacheTTL
	if !live {
		rate = 16000
		// B25: negative-cache for fxRetryTTL only — one upstream blip
		// must not pin the fallback (wrong IDR conversions) for an hour.
		ttl = fxRetryTTL
	}
	fxCache = &fxCacheEntry{rate: rate, updatedAt: now, live: live, ttl: ttl}
	return rate, now, live
}

// ── Per-market price maps (saas-3 billing, owner go D95) ───────────

// marketPriceTiersPrefix is the env-var prefix for the optional
// per-market tier price maps: PRICE_TIERS_<CURRENCY>="tier=amount,..."
// (amounts in that currency's MAJOR units, the same convention as
// TierPriceUSD), e.g. PRICE_TIERS_IDR="plus=74900,pro=149900".
const marketPriceTiersPrefix = "PRICE_TIERS_"

// marketPriceTiers parses every PRICE_TIERS_<CURRENCY> env var into
// currency → tier → monthly price.
//
// ADDITIVE-OPTIONAL BY DESIGN (the exact inverse of the per-PROVIDER
// maps): PADDLE_PRICE_TIERS / MIDTRANS_PRICE_TIERS provision
// subscriptions and must boot-fail when missing; a market map is a
// billing-estimate refinement, so an absent map just means the USD+FX
// fallback covers that market and a MALFORMED map is skipped and
// reported rather than fatal. Returns (maps, per-market parse errors);
// both are empty when nothing is configured.
func marketPriceTiers() (map[string]map[string]float64, map[string]error) {
	maps := map[string]map[string]float64{}
	errs := map[string]error{}
	for _, kv := range os.Environ() {
		k, v, ok := strings.Cut(kv, "=")
		if !ok || !strings.HasPrefix(k, marketPriceTiersPrefix) {
			continue
		}
		cur := strings.ToUpper(strings.TrimPrefix(k, marketPriceTiersPrefix))
		if cur == "" || strings.TrimSpace(v) == "" {
			continue
		}
		prices := map[string]float64{}
		var bad error
		for _, pair := range strings.Split(v, ",") {
			parts := strings.SplitN(strings.TrimSpace(pair), "=", 2)
			if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
				bad = fmt.Errorf("PRICE_TIERS_%s has a malformed entry %q — expected tier=amount pairs, e.g. plus=74900,pro=149900", cur, strings.TrimSpace(pair))
				break
			}
			amt, err := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
			if err != nil || amt < 0 {
				bad = fmt.Errorf("PRICE_TIERS_%s entry %q has a non-numeric amount — expected tier=amount pairs", cur, strings.TrimSpace(pair))
				break
			}
			prices[strings.TrimSpace(parts[0])] = amt
		}
		if bad != nil {
			errs[cur] = bad
			continue
		}
		if len(prices) > 0 {
			maps[cur] = prices
		}
	}
	return maps, errs
}

// tenantMarkets resolves each tenant's charging currency from its
// provider-verified revenue events (latest event wins) — the ONLY
// market signal the hub has, because the subscriptions collection
// carries no market field. Written only by signature-verified webhooks,
// so the attribution is provider-verified, not admin-editable. Tenants
// with no events stay absent → the USD fallback path covers them.
func tenantMarkets(app core.App) map[string]string {
	markets := map[string]string{}
	events, _ := app.FindRecordsByFilter("revenue_events", "currency != ''", "-created", 0, 0)
	for _, ev := range events {
		tid := ev.GetString("tenant_id")
		if _, seen := markets[tid]; !seen {
			markets[tid] = ev.GetString("currency")
		}
	}
	return markets
}

// ── Stats handler ────────────────────────────────────────────────────

func handleAdminStats(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		if !adminAuth(app, e) {
			return nil
		}

		// ── KPIs ────────────────────────────────────────────────────
		totalUsers := countRecordsByFilter(app, "tenants", "")
		activeUsers := countRecordsByFilter(app, "tenants", "status = 'active'")

		// Active non-free subscriptions.
		activeSubs, _ := app.FindRecordsByFilter("subscriptions",
			"status = 'active' && tier_key != 'free'",
			"-created", 0, 0)
		totalSubscribers := len(activeSubs)

		// MRR: sum of active non-free subscriptions' tier prices.
		// Per-market price maps (PRICE_TIERS_<CURRENCY>, saas-3 D95) are
		// additive-optional: a subscription whose tenant charges in a
		// currency with a configured map contributes its LOCAL price to
		// that market's sum (its operator-set real price) and is REMOVED
		// from the USD aggregate so no sub is double-reported; everything
		// else — no market signal, unconfigured market, or tier missing
		// from the market's map — keeps the exact USD fallback path
		// (TierPriceUSD, FX untouched). The per-market sums are local
		// currency: no cross-currency conversion is invented here.
		mrrUsd := 0.0
		marketMaps, _ := marketPriceTiers()
		markets := tenantMarkets(app)
		type marketSum struct {
			Currency    string  `json:"currency"`
			Subscribers int     `json:"subscribers"`
			MrrLocal    float64 `json:"mrrLocal"`
		}
		mrrByMarket := map[string]*marketSum{}
		for _, sub := range activeSubs {
			tier := sub.GetString("tier_key")
			if pm := marketMaps[markets[sub.GetString("tenant_id")]]; pm != nil {
				if price, ok := pm[tier]; ok {
					cur := markets[sub.GetString("tenant_id")]
					ms := mrrByMarket[cur]
					if ms == nil {
						ms = &marketSum{Currency: cur}
						mrrByMarket[cur] = ms
					}
					ms.Subscribers++
					ms.MrrLocal += price
					continue
				}
			}
			mrrUsd += TierPriceUSD[tier]
		}
		marketPriceErrors := map[string]string{}
		if _, merrs := marketPriceTiers(); len(merrs) > 0 {
			for cur, err := range merrs {
				marketPriceErrors[cur] = err.Error()
			}
		}
		arpuUsd := 0.0
		if totalSubscribers > 0 {
			arpuUsd = math.Round(mrrUsd/float64(totalSubscribers)*100) / 100
		}

		// Active devices (tenant_machines without revoked_at).
		//
		// Corrected 2026-09-22: this read `revoked_at IS NULL`, which is SQL but
		// NOT PocketBase filter syntax — the parser rejects it with "expected a
		// sign operator, got IS". countRecordsByFilter swallows the error and
		// returns 0, so this statistic reported ZERO active devices on every
		// dashboard load, silently, and no test had seeded a machine to notice.
		// `= null` is the correct spelling.
		activeDevices := countRecordsByFilter(app, "tenant_machines", "revoked_at = null")

		// Trial → paid rate (approximate: trial tenant → active subscription).
		// Query subscriptions that were once trials (is_trial = true) and
		// are now active with a paid tier.
		paidFromTrial, _ := app.FindRecordsByFilter("subscriptions",
			"is_trial = true && status = 'active' && tier_key != 'free'",
			"", 0, 0)
		allTrials, _ := app.FindRecordsByFilter("subscriptions",
			"is_trial = true", "", 0, 0)
		trialToPaidRate := 0.0
		if len(allTrials) > 0 {
			trialToPaidRate = math.Round(float64(len(paidFromTrial))/float64(len(allTrials))*1000) / 10
		}

		fxRate, fxUpdatedAt, fxLive := getFxRate()

		// ── Provider-verified revenue (income/gross source of truth) ──
		// Income/gross figures come from revenue_events — the append-only
		// ledger written ONLY by signature-verified Paddle/Midtrans webhooks
		// (see provider_revenue.go).  Admin DB edits (tier overrides, renew,
		// grants, subscription rows) cannot move these numbers: they never
		// touch revenue_events.  The price-map estimate below survives only
		// as a clearly-labeled fallback for months with no provider events.
		// ?refresh=1 bypasses the 5-minute cache to show the latest data.
		if e.Request.URL.Query().Get("refresh") == "1" {
			resetProviderRevenueCache()
		}
		rev := getProviderRevenue(app)
		realByMonth := rev.ByMonth
		lifetimeUsd, lifetimeIdr := rev.LifetimeUsd, rev.LifetimeIdr

		// ── Time series (12 months) ─────────────────────────────────
		now := time.Now()
		type monthBucket struct {
			Month       string  `json:"month"`
			Usd         float64 `json:"usd"`
			Idr         float64 `json:"idr"`
			PaddleUsd   float64 `json:"paddleUsd,omitempty"`
			PaddleIdr   float64 `json:"paddleIdr,omitempty"`
			MidtransUsd float64 `json:"midtransUsd,omitempty"`
			MidtransIdr float64 `json:"midtransIdr,omitempty"`
			RefundUsd   float64 `json:"refundUsd,omitempty"`
			RefundIdr   float64 `json:"refundIdr,omitempty"`
			Trials      int     `json:"trials,omitempty"`
			Paid        int     `json:"paid,omitempty"`
			Count       int     `json:"count"`
			Churn       int     `json:"churn"`
			Source      string  `json:"source,omitempty"`
		}
		// Build 12-month window.
		buckets := make([]monthBucket, 12)
		bucketKeys := make([]string, 12)
		for i := 0; i < 12; i++ {
			t := now.AddDate(0, -11+i, 0)
			key := fmt.Sprintf("%d-%02d", t.Year(), t.Month())
			bucketKeys[i] = key
			buckets[i] = monthBucket{Month: key}
		}

		// Revenue trend: provider-verified revenue_events only (no
		// subscription-price projection — see the trend build below).
		// Subscriber growth: cumulative count over time.
		// Signups: group tenants.created by month.
		// Churn: group expired/revoked subscriptions by expires_at month.

		// Scan subscriptions for subscriber growth + churn.  Revenue is NOT
		// derived here — the price-map estimate that used to be recycled
		// into the money chart was removed so manual DB tier overrides can
		// never move gross income (no webhook payment = no revenue).
		subGrowthByMonth := make(map[string]int)
		churnByMonth := make(map[string]int)

		// All subscriptions (active + expired + revoked) for time series.
		allSubs, _ := app.FindRecordsByFilter("subscriptions",
			"tier_key != 'free'",
			"-created", 0, 0)
		for _, sub := range allSubs {
			// Active: add to subscriber growth.
			if sub.GetString("status") == "active" {
				startsAt := sub.GetDateTime("starts_at").Time()
				key := fmt.Sprintf("%d-%02d", startsAt.Year(), startsAt.Month())
				subGrowthByMonth[key]++
			}

			// Expired/revoked: add to churn.
			if sub.GetString("status") == "expired" || sub.GetString("status") == "revoked" {
				expiresAt := sub.GetDateTime("expires_at").Time()
				if !expiresAt.IsZero() {
					key := fmt.Sprintf("%d-%02d", expiresAt.Year(), expiresAt.Month())
					churnByMonth[key]++
				}
			}
		}

		// Build revenue trend, subscriber growth, churn arrays.
		// Revenue trend uses the provider-verified revenue_events ledger
		// ONLY: months without webhook-verified payments are 0.  No
		// subscription/price-map projection is ever recycled into the
		// money chart — a manual DB tier override (free→plus) creates a
		// subscription row but no webhook payment, so it must not move
		// the trend. MRR is reported separately and labeled.
		revenueTrend := make([]monthBucket, 0, 12)
		subGrowth := make([]monthBucket, 0, 12)
		churnArr := make([]monthBucket, 0, 12)
		cumulative := 0
		for _, key := range bucketKeys {
			if m, ok := realByMonth[key]; ok && m.Count > 0 && (m.Usd > 0 || m.Idr > 0) {
				// Provider-verified webhook revenue (refunds included when
				// revenue_adjustments rows exist for the month).
				revenueTrend = append(revenueTrend, monthBucket{
					Month:       key,
					Usd:         math.Round(m.Usd*100) / 100,
					Idr:         math.Round(m.Idr),
					PaddleUsd:   math.Round(m.PaddleUsd*100) / 100,
					PaddleIdr:   math.Round(m.PaddleIdr),
					MidtransUsd: math.Round(m.MidtransUsd*100) / 100,
					MidtransIdr: math.Round(m.MidtransIdr),
					RefundUsd:   math.Round(m.RefundUsd*100) / 100,
					RefundIdr:   math.Round(m.RefundIdr),
					Count:       m.Count,
					Source:      providerRevenueSource(m),
				})
			} else if m, ok := realByMonth[key]; ok && (m.RefundUsd > 0 || m.RefundIdr > 0) {
				// A month with refunds but no recorded gross (edge case:
				// claw-back arrived without a matching revenue_events row) —
				// still surface the refund so it is never silently dropped.
				revenueTrend = append(revenueTrend, monthBucket{
					Month:     key,
					RefundUsd: math.Round(m.RefundUsd*100) / 100,
					RefundIdr: math.Round(m.RefundIdr),
					Source:    "provider",
				})
			} else {
				// No provider-verified income this month — explicit zero.
				revenueTrend = append(revenueTrend, monthBucket{
					Month:  key,
					Source: "estimate",
				})
			}
			cumulative += subGrowthByMonth[key]
			subGrowth = append(subGrowth, monthBucket{
				Month: key, Count: cumulative,
			})
			churnArr = append(churnArr, monthBucket{
				Month: key, Churn: churnByMonth[key],
			})
		}

		// Signups per month.
		signupsByMonth := make(map[string]int)
		tenants, _ := app.FindRecordsByFilter("tenants", "status != ''", "-created", 0, 0)
		for _, t := range tenants {
			created := t.GetDateTime("created").Time()
			key := fmt.Sprintf("%d-%02d", created.Year(), created.Month())
			signupsByMonth[key]++
		}
		signupsArr := make([]monthBucket, 0, 12)
		for _, key := range bucketKeys {
			signupsArr = append(signupsArr, monthBucket{
				Month: key, Count: signupsByMonth[key],
			})
		}

		// ── Tier distribution ───────────────────────────────────────
		tierCount := make(map[string]int)
		for _, sub := range activeSubs {
			tier := sub.GetString("tier_key")
			tierCount[tier]++
		}
		tierDist := make([]map[string]any, 0)
		for _, t := range []string{"plus", "pro", "premium", "enterprise"} {
			if c := tierCount[t]; c > 0 {
				tierDist = append(tierDist, map[string]any{"tier": t, "count": c})
			}
		}

		// ── Payment provider split ─────────────────────────────────
		providerCount := make(map[string]int)
		for _, sub := range activeSubs {
			p := sub.GetString("payment_provider")
			if p == "" {
				p = "unknown"
			}
			providerCount[p]++
		}
		providerSplit := make([]map[string]any, 0)
		for _, p := range []string{"paddle", "midtrans", "unknown"} {
			if c := providerCount[p]; c > 0 {
				providerSplit = append(providerSplit, map[string]any{"provider": p, "count": c})
			}
		}

		// ── Top subscribers ─────────────────────────────────────────
		type topSub struct {
			Email    string  `json:"email"`
			Tier     string  `json:"tier"`
			MrrUsd   float64 `json:"mrrUsd"`
			Renewal  string  `json:"renewal"`
			Provider string  `json:"provider"`
		}
		topSubs := make([]topSub, 0)
		// Sort active subs by tier price descending.
		sort.Slice(activeSubs, func(i, j int) bool {
			return TierPriceUSD[activeSubs[i].GetString("tier_key")] > TierPriceUSD[activeSubs[j].GetString("tier_key")]
		})
		limit := 20
		if len(activeSubs) < limit {
			limit = len(activeSubs)
		}
		for _, sub := range activeSubs[:limit] {
			tenantID := sub.GetString("tenant_id")
			tenant, err := app.FindRecordById("tenants", tenantID)
			if err != nil {
				continue
			}
			tier := sub.GetString("tier_key")
			// B32: GetString("expires_at") leaked the raw PocketBase
			// datetime ("2027-01-01 00:00:00.000Z") into the Top
			// Subscribers table — render the same clean date as
			// recentSignups/expiringSoon; zero datetime → empty.
			renewal := ""
			if dt := sub.GetDateTime("expires_at"); !dt.IsZero() {
				renewal = dt.Time().Format("2006-01-02")
			}
			topSubs = append(topSubs, topSub{
				Email:    tenant.GetString("email"),
				Tier:     tier,
				MrrUsd:   TierPriceUSD[tier],
				Renewal:  renewal,
				Provider: sub.GetString("payment_provider"),
			})
		}

		// ── Recent signups ──────────────────────────────────────────
		type recentSignup struct {
			Email    string `json:"email"`
			Created  string `json:"created"`
			Verified bool   `json:"verified"`
			Tier     string `json:"tier"`
		}
		recentSignups := make([]recentSignup, 0)
		recentTenants, _ := app.FindRecordsByFilter("tenants",
			"status != ''", "-created", 10, 0)
		for _, t := range recentTenants {
			// Find the tenant's latest subscription tier.
			tier := "free"
			subs, _ := app.FindRecordsByFilter("subscriptions",
				"tenant_id = {:tid}", "-starts_at", 1, 0,
				map[string]any{"tid": t.Id})
			if len(subs) > 0 && subs[0].GetString("tier_key") != "" {
				tier = subs[0].GetString("tier_key")
			}
			recentSignups = append(recentSignups, recentSignup{
				Email:    t.GetString("email"),
				Created:  t.GetDateTime("created").Time().Format("2006-01-02"),
				Verified: t.GetBool("email_verified"),
				Tier:     tier,
			})
		}

		// ── Expiring soon (within 30 days) ─────────────────────────
		type expiring struct {
			Email     string `json:"email"`
			Tier      string `json:"tier"`
			ExpiresAt string `json:"expiresAt"`
			DaysLeft  int    `json:"daysLeft"`
		}
		expiringSoon := make([]expiring, 0)
		cutoff := now.Add(30 * 24 * time.Hour).Format(time.RFC3339)
		expiringSubs, _ := app.FindRecordsByFilter("subscriptions",
			"status = 'active' && tier_key != 'free' && expires_at <= {:cutoff} && expires_at >= {:now}",
			"-expires_at", 50, 0,
			map[string]any{"cutoff": cutoff, "now": now.Format(time.RFC3339)})
		for _, sub := range expiringSubs {
			tenantID := sub.GetString("tenant_id")
			tenant, err := app.FindRecordById("tenants", tenantID)
			if err != nil {
				continue
			}
			expAt := sub.GetDateTime("expires_at").Time()
			expiringSoon = append(expiringSoon, expiring{
				Email:     tenant.GetString("email"),
				Tier:      sub.GetString("tier_key"),
				ExpiresAt: expAt.Format("2006-01-02"),
				DaysLeft:  int(time.Until(expAt).Hours() / 24),
			})
		}

		// ── Current month provider gross (income/gross source of truth) ─
		curKey := fmt.Sprintf("%d-%02d", now.Year(), now.Month())
		monthlyGrossUsd, monthlyGrossIdr := 0.0, 0.0
		monthlyPaddleUsd, monthlyPaddleIdr := 0.0, 0.0
		monthlyMidUsd, monthlyMidIdr := 0.0, 0.0
		monthlyRefundUsd, monthlyRefundIdr := 0.0, 0.0
		grossSource := "estimate"
		if cm, ok := realByMonth[curKey]; ok && cm.Count > 0 && (cm.Usd > 0 || cm.Idr > 0) {
			monthlyGrossUsd = math.Round(cm.Usd*100) / 100
			monthlyGrossIdr = math.Round(cm.Idr)
			monthlyPaddleUsd = math.Round(cm.PaddleUsd*100) / 100
			monthlyPaddleIdr = math.Round(cm.PaddleIdr)
			monthlyMidUsd = math.Round(cm.MidtransUsd*100) / 100
			monthlyMidIdr = math.Round(cm.MidtransIdr)
			monthlyRefundUsd = math.Round(cm.RefundUsd*100) / 100
			monthlyRefundIdr = math.Round(cm.RefundIdr)
			grossSource = providerRevenueSource(cm)
		} else if cm, ok := realByMonth[curKey]; ok && (cm.RefundUsd > 0 || cm.RefundIdr > 0) {
			// Refund-only month (no gross): still surface the claw-back.
			monthlyRefundUsd = math.Round(cm.RefundUsd*100) / 100
			monthlyRefundIdr = math.Round(cm.RefundIdr)
			grossSource = "provider"
		} else {
			// No provider-verified revenue events this month — the gross
			// must be zero.  MRR (computed from active subscriptions × tier
			// price) is a subscription projection, not received income, and
			// must never be recycled into monthlyGross where it would
			// falsely report a manual DB tier override as revenue.
			grossSource = "estimate"
		}

		// ── Needs-attention items (alert panel) ──────────────────────
		// Three actionable conditions for the operator, in priority order:
		// 1) grace_period subscriptions (payment failed / past due),
		// 2) expired subscriptions whose license key is still active
		//    (un-revoked key — someone keeps using a dead plan),
		// 3) refunds/chargebacks in the last 30 days.
		type attentionItem struct {
			Type   string `json:"type"` // grace_period | expired_active | refund
			Email  string `json:"email"`
			Tier   string `json:"tier,omitempty"`
			Detail string `json:"detail"`
			At     string `json:"at"` // date the condition was noticed
		}
		needsAttention := make([]attentionItem, 0)

		// 1. Grace-period subscriptions (payment failed).
		graceSubs, _ := app.FindRecordsByFilter("subscriptions",
			"status = 'grace_period' && tier_key != 'free'",
			"-updated", 20, 0)
		for _, gs := range graceSubs {
			tenantID := gs.GetString("tenant_id")
			tenant, err := app.FindRecordById("tenants", tenantID)
			if err != nil {
				continue
			}
			graceUntil := gs.GetDateTime("grace_until").Time()
			at := ""
			if !graceUntil.IsZero() {
				at = graceUntil.Format("2006-01-02")
			}
			needsAttention = append(needsAttention, attentionItem{
				Type:   "grace_period",
				Email:  tenant.GetString("email"),
				Tier:   gs.GetString("tier_key"),
				Detail: "payment failed — grace until " + at,
				At:     at,
			})
		}

		// 2. Expired subscriptions with still-active license keys.
		expiredWithKey := 0
		expiredSubs, _ := app.FindRecordsByFilter("subscriptions",
			"status = 'expired' && tier_key != 'free'",
			"-expires_at", 30, 0)
		for _, es := range expiredSubs {
			if len(needsAttention) >= 20 {
				break
			}
			subID := es.Id
			// Find an active license key bound to this subscription.
			key, err := app.FindFirstRecordByFilter("license_keys",
				"status = 'active' && (paddle_sub_id = {:sid} || midtrans_sub_id = {:sid})",
				map[string]any{"sid": subID})
			if err != nil || key == nil {
				continue
			}
			expiredWithKey++
			tenant, terr := app.FindRecordById("tenants", es.GetString("tenant_id"))
			if terr != nil {
				continue
			}
			needsAttention = append(needsAttention, attentionItem{
				Type:   "expired_active",
				Email:  tenant.GetString("email"),
				Tier:   es.GetString("tier_key"),
				Detail: "expired but key " + key.GetString("key") + " still active",
				At:     es.GetDateTime("expires_at").Time().Format("2006-01-02"),
			})
		}

		// 3. Recent refunds (last 30 days) from the adjustment ledger.
		refundCutoff := now.AddDate(0, 0, -30).Format(time.RFC3339)
		adjSubs, _ := app.FindRecordsByFilter("revenue_adjustments",
			"created >= {:cutoff}",
			"-created", 10, 0,
			map[string]any{"cutoff": refundCutoff})
		for _, ar := range adjSubs {
			tenantID := ar.GetString("tenant_id")
			email := ""
			if tenantID != "" {
				if tenant, err := app.FindRecordById("tenants", tenantID); err == nil {
					email = tenant.GetString("email")
				}
			}
			kind := ar.GetString("kind")
			if kind == "" {
				kind = "adjustment"
			}
			needsAttention = append(needsAttention, attentionItem{
				Type:   "refund",
				Email:  email,
				Detail: kind + " — Rp " + fmt.Sprintf("%d", ar.GetInt("amount_idr")),
				At:     ar.GetDateTime("created").Time().Format("2006-01-02"),
			})
		}

		// ── Trial→paid funnel (#6) ───────────────────────────────────
		// Per month: trial registrations started (first_seen_at) vs paid
		// conversions (subscriptions with tier != free and webhook-verified
		// payment_provider).  The conversion rate = paid / trials.
		trialsByMonth := make(map[string]int)
		trialRecs, _ := app.FindRecordsByFilter("trial_registrations",
			"id != ''", "", 0, 0)
		for _, tr := range trialRecs {
			firstSeen := tr.GetDateTime("first_seen_at").Time()
			if firstSeen.IsZero() {
				continue
			}
			key := fmt.Sprintf("%d-%02d", firstSeen.Year(), firstSeen.Month())
			trialsByMonth[key]++
		}
		paidByMonth := make(map[string]int)
		paidSubs, _ := app.FindRecordsByFilter("subscriptions",
			"tier_key != 'free'", "-starts_at", 0, 0)
		for _, sub := range paidSubs {
			pp := sub.GetString("payment_provider")
			if pp != "paddle" && pp != "midtrans" {
				continue
			}
			startsAt := sub.GetDateTime("starts_at").Time()
			if startsAt.IsZero() {
				continue
			}
			key := fmt.Sprintf("%d-%02d", startsAt.Year(), startsAt.Month())
			paidByMonth[key]++
		}
		funnelArr := make([]monthBucket, 0, 12)
		for _, key := range bucketKeys {
			funnelArr = append(funnelArr, monthBucket{
				Month:  key,
				Trials: trialsByMonth[key],
				Paid:   paidByMonth[key],
			})
		}
		// ── Recent revenue events feed (#5) ──────────────────────────
		// The last N webhook-verified charges (revenue_events ledger) with
		// the paying tenant's email, so the operator sees money arriving in
		// near-real-time. Refunds live in a separate ledger and surface via
		// needsAttention, not here — this feed is income only.
		type revenueFeedRow struct {
			Email     string  `json:"email"`
			Provider  string  `json:"provider"`
			Tier      string  `json:"tier"`
			AmountUsd float64 `json:"amountUsd"`
			AmountIdr int64   `json:"amountIdr"`
			Created   string  `json:"created"`
		}
		recentRevenueEvents := make([]revenueFeedRow, 0, 8)
		feedEvents, _ := app.FindRecordsByFilter("revenue_events",
			"id != ''", "-created", 8, 0)
		for _, fe := range feedEvents {
			email := ""
			tenantID := fe.GetString("tenant_id")
			if tenantID != "" {
				if tenant, err := app.FindRecordById("tenants", tenantID); err == nil {
					email = tenant.GetString("email")
				}
			}
			created := fe.GetDateTime("created").Time()
			recentRevenueEvents = append(recentRevenueEvents, revenueFeedRow{
				Email:     email,
				Provider:  fe.GetString("provider"),
				Tier:      fe.GetString("tier_key"),
				AmountUsd: math.Round(fe.GetFloat("amount_usd")*100) / 100,
				AmountIdr: int64(fe.GetInt("amount_idr")),
				Created:   created.Format(time.RFC3339),
			})
		}

		// ── Response ────────────────────────────────────────────────
		return e.JSON(http.StatusOK, map[string]any{
			"kpis": map[string]any{
				"totalUsers":          totalUsers,
				"activeUsers":         activeUsers,
				"totalSubscribers":    totalSubscribers,
				"mrrUsd":              math.Round(mrrUsd*100) / 100,
				"mrrByMarket":         mrrByMarket,
				"marketPriceErrors":   marketPriceErrors,
				"mrrIdr":              math.Round(mrrUsd * fxRate),
				"monthlyGrossUsd":     monthlyGrossUsd,
				"monthlyGrossIdr":     monthlyGrossIdr,
				"monthlyRefundUsd":    monthlyRefundUsd,
				"monthlyRefundIdr":    monthlyRefundIdr,
				"monthlyPaddleUsd":    monthlyPaddleUsd,
				"monthlyPaddleIdr":    monthlyPaddleIdr,
				"monthlyMidtransUsd":  monthlyMidUsd,
				"monthlyMidtransIdr":  monthlyMidIdr,
				"grossSource":         grossSource,
				"lifetimeUsd":         math.Round(lifetimeUsd*100) / 100,
				"lifetimeIdr":         math.Round(lifetimeIdr),
				"lifetimeRefundUsd":   math.Round(rev.LifetimeRefundUsd*100) / 100,
				"lifetimeRefundIdr":   math.Round(rev.LifetimeRefundIdr),
				"lifetimePaddleUsd":   math.Round(rev.LifetimePaddleUsd*100) / 100,
				"lifetimePaddleIdr":   math.Round(rev.LifetimePaddleIdr),
				"lifetimeMidtransUsd": math.Round(rev.LifetimeMidUsd*100) / 100,
				"lifetimeMidtransIdr": math.Round(rev.LifetimeMidIdr),
				"arpuUsd":             arpuUsd,
				"activeDevices":       activeDevices,
				"trialToPaidRate":     trialToPaidRate,
				"fxRate":              fxRate,
				"fxLive":              fxLive,
				"fxUpdatedAt":         fxUpdatedAt.Format(time.RFC3339),
				// When the revenue snapshot was last refreshed (provider
				// ledger cache TTL). Lets the hero show how fresh the
				// income/gross figures are.
				"revenueCachedAt": rev.UpdatedAt.Format(time.RFC3339),
			},
			"revenueTrend":        revenueTrend,
			"subscriberGrowth":    subGrowth,
			"signupsPerMonth":     signupsArr,
			"churnPerMonth":       churnArr,
			"tierDistribution":    tierDist,
			"providerSplit":       providerSplit,
			"topSubscribers":      topSubs,
			"recentSignups":       recentSignups,
			"expiringSoon":        expiringSoon,
			"needsAttention":      needsAttention,
			"recentRevenueEvents": recentRevenueEvents,
			"trialFunnel":         funnelArr,
		})
	}
}

// countRecords returns the number of records matching the filter.
func countRecordsByFilter(app core.App, collection, filter string) int {
	if filter == "" {
		recs, err := app.FindRecordsByFilter(collection, "id != ''", "", 0, 0)
		if err != nil {
			return 0
		}
		return len(recs)
	}
	recs, err := app.FindRecordsByFilter(collection, filter, "", 0, 0)
	if err != nil {
		return 0
	}
	return len(recs)
}

func init() {
	// Ensure TierPriceUSD can be overridden via env for enterprise.
	v := strings.TrimSpace(os.Getenv("OZ_ENTERPRISE_MRR_USD"))
	if v != "" {
		var f float64
		if _, err := fmt.Sscanf(v, "%f", &f); err == nil && f > 0 {
			TierPriceUSD["enterprise"] = f
		}
	}
}
