package main

// Revenue pipeline tests: saveRevenueEvent helper, Paddle/Midtrans
// capture, and stats endpoint real-revenue aggregation.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// ── saveRevenueEvent unit tests ───────────────────────────────────

func TestRevenueEvent_SaveAndDedup(t *testing.T) {
	resetRateLimiters()
	app, _ := dashboardMux(t)
	defer app.Cleanup()
	tenantID, _ := seedDashboardTenant(t, app, "rev-test@test.com")

	// First save: should succeed. LSE-7: NativeAmountMinor is i64 minor
	// units (USD cents here — 9.99 USD = 999 cents).
	saved, err := saveRevenueEvent(app, revenueEvent{
		Provider:          "paddle",
		EventID:           "evt-paddle-001",
		TenantID:          tenantID,
		TierKey:           "pro",
		NativeAmountMinor: 999,
		NativeCurrency:    "USD",
		Notes:             "subscription_id=sub_001",
	})
	if err != nil {
		t.Fatalf("first save: %v", err)
	}
	if !saved {
		t.Fatal("expected first save to return saved=true")
	}

	// Duplicate event_id: should be skipped (idempotency).
	saved, err = saveRevenueEvent(app, revenueEvent{
		Provider:          "paddle",
		EventID:           "evt-paddle-001",
		TenantID:          tenantID,
		TierKey:           "pro",
		NativeAmountMinor: 999,
		NativeCurrency:    "USD",
	})
	if err != nil {
		t.Fatalf("duplicate save: %v", err)
	}
	if saved {
		t.Fatal("expected duplicate save to return saved=false")
	}

	// Check the record was stored with correct fields.
	rec, err := app.FindFirstRecordByData("revenue_events", "event_id", "evt-paddle-001")
	if err != nil {
		t.Fatalf("find record: %v", err)
	}
	if rec.GetString("provider") != "paddle" {
		t.Errorf("expected provider=paddle, got %q", rec.GetString("provider"))
	}
	if rec.GetFloat("amount_usd") != 9.99 {
		t.Errorf("expected amount_usd=9.99, got %f", rec.GetFloat("amount_usd"))
	}
	if rec.GetInt("amount_idr") <= 0 {
		t.Errorf("expected amount_idr > 0 (FX-converted), got %d", rec.GetInt("amount_idr"))
	}
}

func TestRevenueEvent_MidtransIDR(t *testing.T) {
	resetRateLimiters()
	app, _ := dashboardMux(t)
	defer app.Cleanup()
	tenantID, _ := seedDashboardTenant(t, app, "rev-midtrans@test.com")

	saved, err := saveRevenueEvent(app, revenueEvent{
		Provider:          "midtrans",
		EventID:           "txn-midtrans-001",
		TenantID:          tenantID,
		TierKey:           "plus",
		NativeAmountMinor: 149000,
		NativeCurrency:    "IDR",
	})
	if err != nil {
		t.Fatalf("save midtrans revenue: %v", err)
	}
	if !saved {
		t.Fatal("expected save to succeed")
	}

	rec, err := app.FindFirstRecordByData("revenue_events", "event_id", "txn-midtrans-001")
	if err != nil {
		t.Fatalf("find record: %v", err)
	}
	if rec.GetString("currency") != "IDR" {
		t.Errorf("expected currency=IDR, got %q", rec.GetString("currency"))
	}
	if rec.GetInt("amount_idr") != 149000 {
		t.Errorf("expected amount_idr=149000, got %d", rec.GetInt("amount_idr"))
	}
	if rec.GetFloat("amount_usd") <= 0 {
		t.Errorf("expected amount_usd > 0 (FX-converted), got %f", rec.GetFloat("amount_usd"))
	}
}

func TestRevenueEvent_EmptyEventID(t *testing.T) {
	app, _ := dashboardMux(t)
	defer app.Cleanup()

	saved, err := saveRevenueEvent(app, revenueEvent{
		Provider:          "paddle",
		EventID:           "",
		TenantID:          "x",
		NativeAmountMinor: 500,
		NativeCurrency:    "USD",
	})
	if err != nil {
		t.Fatalf("empty event_id: %v", err)
	}
	if saved {
		t.Fatal("expected saved=false for empty event_id")
	}
}

// ── parseMidtransGrossAmountMinor tests ───────────────────────────

func TestParseMidtransGrossAmountMinor(t *testing.T) {
	cases := []struct {
		input string
		want  int64
	}{
		{"149000", 149000},
		{"149000.00", 149000},
		{"149000.40", 149000},
		{"149000.50", 149001},
		{"0", 0},
		{"", 0},
		{"  ", 0},
		{"abc", 0},
		{"999999999", 999999999},
	}
	for _, c := range cases {
		got := parseMidtransGrossAmountMinor(c.input)
		if got != c.want {
			t.Errorf("parseMidtransGrossAmountMinor(%q) = %d, want %d", c.input, got, c.want)
		}
	}
}

// ── Paddle transaction parsing tests ──────────────────────────────

func TestPaddleTransactionTotalCents(t *testing.T) {
	// Transaction with grand_total at the top level.
	txn1 := &paddleTransaction{
		Totals: &struct {
			Subtotal   int64 `json:"subtotal"`
			Total      int64 `json:"total"`
			Tax        int64 `json:"tax"`
			GrandTotal int64 `json:"grand_total"`
		}{GrandTotal: 1499},
	}
	if got := paddleTransactionTotalCents(txn1); got != 1499 {
		t.Errorf("expected 1499, got %d", got)
	}

	// Transaction with no grand_total but item-level totals.
	txn2 := &paddleTransaction{
		Items: []struct {
			Price struct {
				ID        string `json:"id"`
				ProductID string `json:"product_id"`
			} `json:"price"`
			Totals *struct {
				Subtotal int64 `json:"subtotal"`
				Total    int64 `json:"total"`
				Tax      int64 `json:"tax"`
			} `json:"totals"`
		}{
			{Totals: &struct {
				Subtotal int64 `json:"subtotal"`
				Total    int64 `json:"total"`
				Tax      int64 `json:"tax"`
			}{Total: 999}},
			{Totals: &struct {
				Subtotal int64 `json:"subtotal"`
				Total    int64 `json:"total"`
				Tax      int64 `json:"tax"`
			}{Total: 500}},
		},
	}
	if got := paddleTransactionTotalCents(txn2); got != 1499 {
		t.Errorf("expected 1499 from item totals, got %d", got)
	}

	// Empty transaction.
	txn3 := &paddleTransaction{}
	if got := paddleTransactionTotalCents(txn3); got != 0 {
		t.Errorf("expected 0 for empty, got %d", got)
	}
}

func TestPaddleTransactionTier(t *testing.T) {
	t.Setenv("PADDLE_PRICE_TIERS", "pri_plus:plus:month,pri_pro:pro:year")

	txn := &paddleTransaction{
		Items: []struct {
			Price struct {
				ID        string `json:"id"`
				ProductID string `json:"product_id"`
			} `json:"price"`
			Totals *struct {
				Subtotal int64 `json:"subtotal"`
				Total    int64 `json:"total"`
				Tax      int64 `json:"tax"`
			} `json:"totals"`
		}{
			{Price: struct {
				ID        string `json:"id"`
				ProductID string `json:"product_id"`
			}{ID: "pri_plus"}},
		},
	}
	if got := paddleTransactionTier(txn); got != "plus" {
		t.Errorf("expected tier=plus, got %q", got)
	}
}

// ── Paddle capture revenue integration test ───────────────────────

func TestPaddleRevenueCapture(t *testing.T) {
	resetRateLimiters()
	resetPaddleDedup()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedDashboardTenant(t, app, "paddle-rev@test.com")
	t.Setenv("PADDLE_WEBHOOK_SECRET", "test-webhook-secret")
	t.Setenv("PADDLE_PRICE_TIERS", "pri_test_pro:pro:year")

	body := `{
		"event_id": "evt-paddle-rev-001",
		"event_type": "transaction.completed",
		"data": {
			"id": "txn_test_001",
			"status": "completed",
			"currency_code": "USD",
			"customer_id": "ctm_test",
			"custom_data": {"email": "paddle-rev@test.com"},
			"items": [{"price": {"id": "pri_test_pro", "product_id": "pro_test"}, "quantity": 1, "totals": {"total": 999, "subtotal": 999}}],
			"totals": {"grand_total": 999, "total": 999, "subtotal": 999, "tax": 0},
			"created_at": "2026-08-18T10:00:00Z"
		}
		}`
	header := signPaddle("test-webhook-secret", body, time.Now().Unix())
	req := httptest.NewRequest(http.MethodPost, paddleWebhookPath, strings.NewReader(body))
	req.Header.Set(paddleSignatureHeader, header)
	rec := httptest.NewRecorder()
	mux, _ := se.Router.BuildMux()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// Verify revenue_events record was created.
	rev, err := app.FindFirstRecordByData("revenue_events", "event_id", "evt-paddle-rev-001")
	if err != nil {
		t.Fatalf("revenue event not found: %v", err)
	}
	if rev.GetString("provider") != "paddle" {
		t.Errorf("expected provider=paddle, got %q", rev.GetString("provider"))
	}
	if rev.GetString("tier_key") != "pro" {
		t.Errorf("expected tier_key=pro, got %q", rev.GetString("tier_key"))
	}
	if rev.GetFloat("amount_usd") != 9.99 {
		t.Errorf("expected amount_usd=9.99 (cents=999 → 9.99), got %f", rev.GetFloat("amount_usd"))
	}
}

// ── Midtrans capture revenue integration test ─────────────────────

func TestMidtransRevenueCapture(t *testing.T) {
	resetRateLimiters()
	resetMidtransDedup()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedDashboardTenant(t, app, "midtrans-rev@test.com")
	t.Setenv("MIDTRANS_SERVER_KEY", "test-midtrans-srv-key")
	t.Setenv("MIDTRANS_PRICE_TIERS", "149000:plus:month")

	body := midtransSignedBody("test-midtrans-srv-key",
		"txn-midtrans-rev-001", "OZ-PLUS-1234", "sub_001",
		"settlement", "200", "149000", "plus", "midtrans-rev@test.com")
	rec := serveMidtrans(t, se, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// Verify revenue_events record was created.
	rev, err := app.FindFirstRecordByData("revenue_events", "event_id", "txn-midtrans-rev-001")
	if err != nil {
		t.Fatalf("revenue event not found: %v", err)
	}
	if rev.GetString("provider") != "midtrans" {
		t.Errorf("expected provider=midtrans, got %q", rev.GetString("provider"))
	}
	if rev.GetString("tier_key") != "plus" {
		t.Errorf("expected tier_key=plus, got %q", rev.GetString("tier_key"))
	}
	if rev.GetInt("amount_idr") != 149000 {
		t.Errorf("expected amount_idr=149000, got %d", rev.GetInt("amount_idr"))
	}
}

// ── Stats endpoint real-revenue test ───────────────────────────────

func TestAdminStats_RealRevenue(t *testing.T) {
	resetRateLimiters()
	app, mux := dashboardMux(t)
	defer app.Cleanup()

	tenantID, _ := seedDashboardTenant(t, app, "stats-rev@test.com")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")

	// Seed a revenue_events record manually.
	col, err := app.FindCollectionByNameOrId("revenue_events")
	if err != nil {
		t.Fatalf("find collection: %v", err)
	}
	rev := core.NewRecord(col)
	rev.Set("event_id", "evt-stats-test-001")
	rev.Set("provider", "paddle")
	rev.Set("tenant_id", tenantID)
	rev.Set("currency", "USD")
	rev.Set("amount_usd", 42.50)
	rev.Set("amount_idr", 680000)
	rev.Set("tier_key", "pro")
	if err := app.Save(rev); err != nil {
		t.Fatalf("save revenue event: %v", err)
	}

	// Fetch the stats endpoint.
	rec := doJSON(mux, http.MethodGet, "/api/v1/admin/stats", "Bearer secret-admin-key", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		KPIs struct {
			LifetimeUsd float64 `json:"lifetimeUsd"`
			LifetimeIdr float64 `json:"lifetimeIdr"`
		} `json:"kpis"`
		RevenueTrend []struct {
			Month string  `json:"month"`
			Usd   float64 `json:"usd"`
		} `json:"revenueTrend"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if body.KPIs.LifetimeUsd != 42.50 {
		t.Errorf("expected lifetimeUsd=42.50, got %v", body.KPIs.LifetimeUsd)
	}
	if body.KPIs.LifetimeIdr != 680000 {
		t.Errorf("expected lifetimeIdr=680000, got %v", body.KPIs.LifetimeIdr)
	}
	// Check that the revenue trend includes the event (the current month).
	found := false
	for _, m := range body.RevenueTrend {
		if m.Usd >= 42.00 && m.Usd <= 43.00 {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected revenue trend to include the seeded revenue event")
	}
}

// ── #5: recent revenue events feed ───────────────────────────────────

func TestAdminStats_RecentRevenueFeed(t *testing.T) {
	resetProviderRevenueCache()
	resetRateLimiters()
	app, mux := dashboardMux(t)
	defer app.Cleanup()

	tenantID, _ := seedDashboardTenant(t, app, "feed@test.com")
	t.Setenv("OZ_ADMIN_KEY", "secret-admin-key")
	col, _ := app.FindCollectionByNameOrId("revenue_events")

	seed := func(eventID, provider, tier string, usd float64, idr int64) {
		rev := core.NewRecord(col)
		rev.Set("event_id", eventID)
		rev.Set("provider", provider)
		rev.Set("tenant_id", tenantID)
		rev.Set("currency", "USD")
		rev.Set("amount_usd", usd)
		rev.Set("amount_idr", idr)
		rev.Set("tier_key", tier)
		if err := app.Save(rev); err != nil {
			t.Fatalf("save revenue event %s: %v", eventID, err)
		}
	}
	seed("evt-feed-paddle", "paddle", "pro", 42.50, 680000)
	seed("evt-feed-midtrans", "midtrans", "plus", 9.30, 149000)

	rec := doJSON(mux, http.MethodGet, "/api/v1/admin/stats?refresh=1", "Bearer secret-admin-key", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var body struct {
		RecentRevenueEvents []struct {
			Email     string  `json:"email"`
			Provider  string  `json:"provider"`
			Tier      string  `json:"tier"`
			AmountUsd float64 `json:"amountUsd"`
			AmountIdr int64   `json:"amountIdr"`
			Created   string  `json:"created"`
		} `json:"recentRevenueEvents"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if len(body.RecentRevenueEvents) < 2 {
		t.Fatalf("expected >=2 feed rows, got %d", len(body.RecentRevenueEvents))
	}
	// The feed resolves the tenant email and carries provider/tier/amounts.
	var sawPaddle, sawMidtrans bool
	for _, row := range body.RecentRevenueEvents {
		if row.Email != "feed@test.com" {
			t.Errorf("feed row email = %q, want feed@test.com", row.Email)
		}
		if row.Provider == "paddle" {
			sawPaddle = true
			if row.AmountUsd != 42.50 || row.AmountIdr != 680000 || row.Tier != "pro" {
				t.Errorf("paddle row amounts/tier wrong: %+v", row)
			}
		}
		if row.Provider == "midtrans" {
			sawMidtrans = true
			if row.Tier != "plus" {
				t.Errorf("midtrans row tier = %q, want plus", row.Tier)
			}
		}
		if row.Created == "" {
			t.Error("feed row missing created timestamp")
		}
	}
	if !sawPaddle || !sawMidtrans {
		t.Errorf("feed missing providers: paddle=%v midtrans=%v", sawPaddle, sawMidtrans)
	}
}
