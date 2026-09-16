package main

// Midtrans Snap checkout endpoint (ADR #39 D1) — the Indonesian billing
// path. The website's id-locale pricing button calls POST
// /api/v1/midtrans/snap (session-authed, register-first) to build a Snap
// charge for a tier + billing period; the endpoint returns the snap token
// the page hands to Snap.js. The tier's fixed IDR gross_amount comes from
// MIDTRANS_PRICE_TIERS — the SAME map the webhook cross-checks — so a
// tampered client amount can't mint a higher tier. The buyer email is the
// session tenant's, embedded in custom_field2, which the webhook reads to
// upsert the tenant (mirroring Paddle's customData.email).
//
// Env vars:
//
//	MIDTRANS_SERVER_KEY  (required) — server key (Basic auth to Snap API)
//	MIDTRANS_SNAP_URL    (default https://app.midtrans.com) — API base
//
// This IS a web endpoint: it enforces the web CORS allowlist + session
// auth like /api/v1/web/* (the browser calls it).

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// midtransSnapPath is the route registered in main.go.
const midtransSnapPath = "/api/v1/midtrans/snap"

// midtransSnapCharge is what the Snap API needs to create a token.
type midtransSnapCharge struct {
	OrderID     string
	GrossAmount string
	TierKey     string
	Period      string
	Bundle      string
	Email       string
}

// midtransSnapResult is the token + redirect the website hands to Snap.js.
type midtransSnapResult struct {
	Token       string
	RedirectURL string
}

// midtransSnapURL returns the Snap API base (default production).
func midtransSnapURL() string {
	u := strings.TrimRight(strings.TrimSpace(os.Getenv("MIDTRANS_SNAP_URL")), "/")
	if u == "" {
		return "https://app.midtrans.com"
	}
	return u
}

// midtransAmountForTier resolves the fixed IDR gross_amount for a
// tier + period (+ optional bundle) from MIDTRANS_PRICE_TIERS (the reverse
// of the webhook's amount→tier lookup). Returns ("", false) when the
// tier/period/bundle combination isn't mapped — the checkout then answers
// 400: a misconfigured map must not mint an unbilled tier.
func midtransAmountForTier(tier, period, bundle string) (string, bool) {
	// Normalize the website's BillingPeriod vocabulary (monthly/yearly) to
	// the price map's plan-period vocabulary (month/year).
	period = normalizeBillingPeriod(period)
	bundle = normalizeBundleID(bundle)
	m, err := midtransPriceTiers()
	if err != nil {
		return "", false
	}
	for amount, entry := range m {
		t, rest, _ := strings.Cut(entry, ":")
		p, b, _ := strings.Cut(rest, ":")
		if t == tier && p == period && b == bundle {
			return amount, true
		}
	}
	return "", false
}

// midtransBundleItemSuffix returns the Snap item-name suffix for a bundle
// (" + Restaurant Starter", or "" for no bundle) so the buyer sees what
// they're paying for in the Snap UI.
func midtransBundleItemSuffix(bundle string) string {
	switch normalizeBundleID(bundle) {
	case "restaurant_starter":
		return " + Restaurant Starter"
	default:
		return ""
	}
}

// midtransOrderID builds a unique order id for a charge:
// OZ-<TIER>-<unix>-<hex rand>. The webhook keys provisioning on this until
// the subscription's first charge carries a subscription_id.
func midtransOrderID(tier string) string {
	b := make([]byte, 3)
	_, _ = rand.Read(b) // crypto/rand failure is not fatal for an order id
	return fmt.Sprintf("OZ-%s-%d-%x", strings.ToUpper(tier), time.Now().Unix(), b)
}

// createMidtransSnap is a package-level var so tests can stub the Snap API
// call (mirrors fetchPaddleCustomer / sendOTPEmail).
var createMidtransSnap = createMidtransSnapHTTP

// createMidtransSnapHTTP calls the Midtrans Snap API
// (POST {base}/snap/v1/transactions, Basic auth with the server key) and
// returns the snap token + redirect URL.
func createMidtransSnapHTTP(charge midtransSnapCharge) (midtransSnapResult, error) {
	key := midtransServerKey()
	if key == "" {
		return midtransSnapResult{}, fmt.Errorf("MIDTRANS_SERVER_KEY not configured")
	}
	payload := map[string]any{
		"transaction_details": map[string]any{
			"order_id":     charge.OrderID,
			"gross_amount": charge.GrossAmount,
		},
		"item_details": []map[string]any{{
			"id":       charge.TierKey + "-" + charge.Period,
			"price":    charge.GrossAmount,
			"quantity": 1,
			"name":     "kasir.mu " + strings.ToUpper(charge.TierKey) + " (" + charge.Period + ")" + midtransBundleItemSuffix(charge.Bundle),
		}},
		"customer_details": map[string]any{
			"email": charge.Email,
		},
		"custom_field1": charge.TierKey,
		"custom_field2": charge.Email,
		"custom_field3": charge.Period,
		// custom_field4 = bundle_id (C3.2): the webhook cross-checks it
		// against the price map, so it only labels what the amount paid for.
		"custom_field4": charge.Bundle,
		// Local methods first: QRIS is the Phase 2 headline, then VAs,
		// e-wallets, and cards as a fallback.
		"enabled_payments": []string{
			"qris", "bank_transfer", "echannel", "gopay", "shopeepay", "credit_card",
		},
		"credit_card": map[string]any{"secure": true},
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return midtransSnapResult{}, fmt.Errorf("failed to marshal snap charge: %w", err)
	}
	req, err := http.NewRequest(http.MethodPost, midtransSnapURL()+"/snap/v1/transactions", strings.NewReader(string(raw)))
	if err != nil {
		return midtransSnapResult{}, fmt.Errorf("failed to build snap request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(key+":")))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return midtransSnapResult{}, fmt.Errorf("snap API call failed: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return midtransSnapResult{}, fmt.Errorf("snap API returned %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}
	var out struct {
		Token       string `json:"token"`
		RedirectURL string `json:"redirect_url"`
	}
	if err := json.Unmarshal(respBody, &out); err != nil {
		return midtransSnapResult{}, fmt.Errorf("failed to decode snap response: %w", err)
	}
	if out.Token == "" {
		return midtransSnapResult{}, fmt.Errorf("snap API returned no token")
	}
	return midtransSnapResult{Token: out.Token, RedirectURL: out.RedirectURL}, nil
}

// handleMidtransSnap implements POST /api/v1/midtrans/snap. Session auth
// mirrors handleMe: the browser sends the register-first session token,
// and the buyer email comes from the tenant record — never from the
// request body, so a buyer can't attach a charge to someone else's email.
func handleMidtransSnap(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		if !webOriginAllowed(e) {
			return e.JSON(http.StatusForbidden, map[string]any{
				"error": "origin not allowed",
			})
		}

		token, err := extractBearerToken(e)
		if err != nil {
			return e.JSON(http.StatusUnauthorized, map[string]any{
				"error": "missing or invalid session token",
			})
		}
		tenantID := webOtpStore.getSession(hashWebToken(token))
		if tenantID == "" {
			return e.JSON(http.StatusUnauthorized, map[string]any{
				"error": "invalid or expired session",
			})
		}
		tenant, err := app.FindRecordById("tenants", tenantID)
		if err != nil {
			return e.JSON(http.StatusUnauthorized, map[string]any{
				"error": "invalid or expired session",
			})
		}

		var req struct {
			TierKey string `json:"tier_key"`
			Period  string `json:"period"`
			Bundle  string `json:"bundle"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(e.Response, e.Request.Body, 16*1024)).Decode(&req); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "malformed JSON"})
		}
		tier := strings.ToLower(strings.TrimSpace(req.TierKey))
		period := strings.ToLower(strings.TrimSpace(req.Period))
		bundle := normalizeBundleID(req.Bundle)
		if period == "" {
			period = "year"
		}

		amount, ok := midtransAmountForTier(tier, period, bundle)
		if !ok {
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": fmt.Sprintf("tier %q (%s, bundle=%s) is not mapped in MIDTRANS_PRICE_TIERS", tier, period, bundle),
			})
		}

		orderID := midtransOrderID(tier)
		result, err := createMidtransSnap(midtransSnapCharge{
			OrderID:     orderID,
			GrossAmount: amount,
			TierKey:     tier,
			Period:      period,
			Bundle:      bundle,
			Email:       tenant.GetString("email"),
		})
		if err != nil {
			log.Printf("midtrans snap: token creation failed for tenant %q: %v", tenant.GetString("email"), err)
			return e.JSON(http.StatusBadGateway, map[string]any{
				"error": "checkout provider error",
			})
		}
		return e.JSON(http.StatusOK, map[string]any{
			"token":        result.Token,
			"redirect_url": result.RedirectURL,
			"order_id":     orderID,
			"amount":       amount,
		})
	}
}
