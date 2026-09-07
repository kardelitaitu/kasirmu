package main

import (
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// ── Signature + payload helpers ─────────────────────────────────────

// signMidtrans recomputes Midtrans's documented notification signature:
// SHA512(order_id + status_code + gross_amount + serverkey).
func signMidtrans(serverKey, orderID, statusCode, grossAmount string) string {
	sum := sha512.Sum512([]byte(orderID + statusCode + grossAmount + serverKey))
	return hex.EncodeToString(sum[:])
}

// setMidtransEnv configures the webhook env vars shared by most tests.
// The plus entry mirrors the production six-price MIDTRANS_PRICE_TIERS
// shape (tier:period pairs keyed by the fixed IDR gross_amount).
func setMidtransEnv(t *testing.T) {
	t.Helper()
	t.Setenv("MIDTRANS_SERVER_KEY", "test-midtrans-server-key")
	t.Setenv("MIDTRANS_PRICE_TIERS", "149000:plus:month,1490000:plus:year,249000:pro:month,499000:pro:year")
}

// midtransPaymentBody renders a Midtrans payment notification.
// subscriptionID "" omits subscription_id (a first charge that predates
// the subscription record); tierField/email "" omit the custom fields.
func midtransPaymentBody(transactionID, orderID, subscriptionID, status, statusCode, grossAmount, tierField, email string) string {
	sub, cf1, cf2 := "", "", ""
	if subscriptionID != "" {
		sub = fmt.Sprintf(`,"subscription_id": %q`, subscriptionID)
	}
	if tierField != "" {
		cf1 = fmt.Sprintf(`,"custom_field1": %q`, tierField)
	}
	if email != "" {
		cf2 = fmt.Sprintf(`,"custom_field2": %q`, email)
	}
	return fmt.Sprintf(`{
  "transaction_id": %q,
  "order_id": %q,
  "transaction_status": %q,
  "status_code": %q,
  "gross_amount": %q,
  "fraud_status": "accept",
  "payment_type": "qris",
  "signature_key": "SIGNATURE",
  "settlement_time": "2026-08-18 10:00:00"%s%s%s
}`, transactionID, orderID, status, statusCode, grossAmount, sub, cf1, cf2)
}

// midtransSignedBody renders a fully signed payment notification.
func midtransSignedBody(serverKey, transactionID, orderID, subscriptionID, status, statusCode, grossAmount, tierField, email string) string {
	body := midtransPaymentBody(transactionID, orderID, subscriptionID, status, statusCode, grossAmount, tierField, email)
	sig := signMidtrans(serverKey, orderID, statusCode, grossAmount)
	return strings.Replace(body, `"signature_key": "SIGNATURE"`, fmt.Sprintf(`"signature_key": %q`, sig), 1)
}

// serveMidtrans posts a signed (or unsigned) notification body to the
// webhook endpoint.
func serveMidtrans(t *testing.T, se *core.ServeEvent, body string) *httptest.ResponseRecorder {
	t.Helper()
	return servePost(t, se, midtransWebhookPath, "", nil, body)
}

// ── Webhook: mint / signature / dedup / renew / grace ───────────────

// TestMidtransWebhook_MintSettledCharge drives the plus-tier mint over HTTP:
// a settled QRIS charge provisions a 1-store/2-register license keyed by
// subscription_id with payment_provider=midtrans, and the signed subscription
// carries the plus quota block with a ~+1y expiry (yearly plan period).
func TestMidtransWebhook_MintSettledCharge(t *testing.T) {
	resetMidtransDedup()
	resetRateLimiters()
	setMidtransEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	var emailedKey string
	restore := stubReceiptEmail(t, &emailedKey)
	defer restore()

	body := midtransSignedBody("test-midtrans-server-key", "txn_mt_001", "OZ-PLUS-1755-001",
		"sub_mt_001", "settlement", "200", "1490000", "plus", "midbuyer@example.com")
	rec := serveMidtrans(t, se, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 from midtrans webhook, got %d: %s", rec.Code, rec.Body.String())
	}

	// Minted license keyed by subscription_id: OZ-PLUS- prefix + plus quota
	// block (no kds), payment_provider=midtrans.
	keyRec, err := app.FindFirstRecordByData("license_keys", "midtrans_sub_id", "sub_mt_001")
	if err != nil {
		t.Fatalf("midtrans license key not minted: %v", err)
	}
	key := keyRec.GetString("key")
	if !strings.HasPrefix(key, "OZ-PLUS-") {
		t.Errorf("expected OZ-PLUS- key prefix, got %q", key)
	}
	if keyRec.GetString("payment_provider") != "midtrans" {
		t.Errorf("expected payment_provider=midtrans, got %q", keyRec.GetString("payment_provider"))
	}
	if keyRec.GetString("midtrans_order_id") != "OZ-PLUS-1755-001" {
		t.Errorf("expected midtrans_order_id on key, got %q", keyRec.GetString("midtrans_order_id"))
	}
	if emailedKey != key {
		t.Errorf("expected receipt email with key %q, got %q", key, emailedKey)
	}
	assertPlusQuotaBlock(t, keyRec.GetString("tier_key"), keyRec.GetInt("max_stores"), keyRec.GetInt("max_pos_instances"), mustParseAllowedTypes(t, keyRec.GetString("allowed_types")))

	// Signed subscription persisted with the plus quota block, the provider
	// discriminator, and a ~+1y expiry (yearly period from the price map).
	subRec, err := app.FindFirstRecordByData("subscriptions", "midtrans_sub_id", "sub_mt_001")
	if err != nil {
		t.Fatalf("midtrans subscription not persisted: %v", err)
	}
	if subRec.GetString("status") != "active" {
		t.Errorf("expected sub status active, got %q", subRec.GetString("status"))
	}
	if subRec.GetString("payment_provider") != "midtrans" {
		t.Errorf("expected sub payment_provider=midtrans, got %q", subRec.GetString("payment_provider"))
	}
	if !strings.Contains(subRec.GetString("signed_payload"), `"tier_key":"plus"`) {
		t.Errorf("expected signed payload tier_key plus, got: %s", subRec.GetString("signed_payload"))
	}
	expiry := subRec.GetDateTime("expires_at").Time()
	if diff := expiry.Sub(time.Now().UTC().AddDate(1, 0, 0)); diff > 5*time.Minute || diff < -5*time.Minute {
		t.Errorf("minted plus subscription should expire ~+1y, got %v (diff %v)", expiry, diff)
	}

	// The tenant was created by the webhook from custom_field2.
	tenant, err := app.FindFirstRecordByData("tenants", "email", "midbuyer@example.com")
	if err != nil {
		t.Fatalf("webhook-created tenant not found: %v", err)
	}
	if tenant.GetString("status") != "active" {
		t.Errorf("expected tenant active, got %q", tenant.GetString("status"))
	}
}

// TestMidtransWebhook_TierAmountCrossCheck rejects a charge whose
// checkout-embedded tier disagrees with the fixed IDR amount — a tampered
// custom_field1 must not mint a higher tier.
func TestMidtransWebhook_TierAmountCrossCheck(t *testing.T) {
	resetMidtransDedup()
	resetRateLimiters()
	setMidtransEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	// custom_field1 says premium, but 1490000 maps to plus:year.
	body := midtransSignedBody("test-midtrans-server-key", "txn_mt_xc01", "OZ-PLUS-1755-XC1",
		"sub_mt_xc01", "settlement", "200", "1490000", "premium", "tamper@example.com")
	rec := serveMidtrans(t, se, body)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 from tier mismatch, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := app.FindFirstRecordByData("license_keys", "midtrans_sub_id", "sub_mt_xc01"); err == nil {
		t.Fatal("expected NO license key minted for a rejected charge")
	}
}

// TestMidtransWebhook_InvalidSignature401 rejects a notification whose
// signature_key doesn't match the canonical SHA512 over the fields.
func TestMidtransWebhook_InvalidSignature401(t *testing.T) {
	resetMidtransDedup()
	resetRateLimiters()
	setMidtransEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	body := midtransPaymentBody("txn_mt_bad01", "OZ-PLUS-1755-BAD", "sub_mt_bad01",
		"settlement", "200", "1490000", "plus", "bad@example.com")
	// Sign with the wrong key — the server key is "test-midtrans-server-key".
	body = strings.Replace(body, `"signature_key": "SIGNATURE"`,
		fmt.Sprintf(`"signature_key": %q`, signMidtrans("wrong-key", "OZ-PLUS-1755-BAD", "200", "1490000")), 1)
	rec := serveMidtrans(t, se, body)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 from invalid signature, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := app.FindFirstRecordByData("license_keys", "midtrans_sub_id", "sub_mt_bad01"); err == nil {
		t.Fatal("expected NO license key minted for an unsigned charge")
	}
}

// TestMidtransWebhook_DuplicateReplay dedups a re-delivered notification
// (Midtrans retries) — the second POST is a no-op and only one key exists.
func TestMidtransWebhook_DuplicateReplay(t *testing.T) {
	resetMidtransDedup()
	resetRateLimiters()
	setMidtransEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	body := midtransSignedBody("test-midtrans-server-key", "txn_mt_dup01", "OZ-PLUS-1755-DUP",
		"sub_mt_dup01", "settlement", "200", "1490000", "plus", "dup@example.com")

	rec1 := serveMidtrans(t, se, body)
	if rec1.Code != http.StatusOK {
		t.Fatalf("expected 200 on first delivery, got %d: %s", rec1.Code, rec1.Body.String())
	}
	rec2 := serveMidtrans(t, se, body)
	if rec2.Code != http.StatusOK || !strings.Contains(rec2.Body.String(), "duplicate") {
		t.Fatalf("expected 200 duplicate on replay, got %d: %s", rec2.Code, rec2.Body.String())
	}

	keys, err := app.FindRecordsByFilter("license_keys", "midtrans_sub_id = 'sub_mt_dup01'", "", 10, 0, nil)
	if err != nil || len(keys) != 1 {
		t.Fatalf("expected exactly one license key after replay, got %d (err %v)", len(keys), err)
	}
}

// TestMidtransWebhook_RenewalRefreshesSameKey covers the recurring-charge
// path: a later charge on the same subscription (new order_id, same
// subscription_id) refreshes the SAME license key instead of minting a
// second one, and extends the expiry.
func TestMidtransWebhook_RenewalRefreshesSameKey(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping midtrans webhook integration test in short mode")
	}
	resetMidtransDedup()
	resetRateLimiters()
	setMidtransEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	restore := stubReceiptEmail(t, new(string))
	defer restore()

	// ── First charge ──
	rec1 := serveMidtrans(t, se, midtransSignedBody("test-midtrans-server-key", "txn_mt_rn01",
		"OZ-PLUS-1755-RN1", "sub_mt_rn01", "settlement", "200", "1490000", "plus", "renew@example.com"))
	if rec1.Code != http.StatusOK {
		t.Fatalf("expected 200 on first charge, got %d: %s", rec1.Code, rec1.Body.String())
	}
	keyRec1, err := app.FindFirstRecordByData("license_keys", "midtrans_sub_id", "sub_mt_rn01")
	if err != nil {
		t.Fatalf("first charge key not minted: %v", err)
	}
	keyA := keyRec1.GetString("key")
	expiry1 := keyRec1.GetDateTime("expires_at").Time()

	// ── Recurring charge: new order_id, same subscription_id ──
	// The expiry extends from the charge time by the plan period; space the
	// charges >1s apart so the +1y windows are provably different (in
	// production the recurring charge lands ~a period later anyway).
	time.Sleep(1100 * time.Millisecond)
	rec2 := serveMidtrans(t, se, midtransSignedBody("test-midtrans-server-key", "txn_mt_rn02",
		"OZ-PLUS-1756-RN2", "sub_mt_rn01", "settlement", "200", "1490000", "plus", "renew@example.com"))
	if rec2.Code != http.StatusOK {
		t.Fatalf("expected 200 on recurring charge, got %d: %s", rec2.Code, rec2.Body.String())
	}

	keys, err := app.FindRecordsByFilter("license_keys", "midtrans_sub_id = 'sub_mt_rn01'", "", 10, 0, nil)
	if err != nil || len(keys) != 1 {
		t.Fatalf("expected exactly one key after renewal, got %d (err %v)", len(keys), err)
	}
	keyRec2 := keys[0]
	if keyRec2.GetString("key") != keyA {
		t.Errorf("expected renewal to refresh the same key %q, got %q", keyA, keyRec2.GetString("key"))
	}
	expiry2 := keyRec2.GetDateTime("expires_at").Time()
	if !expiry2.After(expiry1) {
		t.Errorf("expected renewal to extend expiry (%v -> %v)", expiry1, expiry2)
	}
	if keyRec2.GetString("midtrans_order_id") != "OZ-PLUS-1756-RN2" {
		t.Errorf("expected order_id refreshed on key, got %q", keyRec2.GetString("midtrans_order_id"))
	}

	// The subscription record was refreshed too (same record, new expiry).
	subs, err := app.FindRecordsByFilter("subscriptions", "midtrans_sub_id = 'sub_mt_rn01'", "", 10, 0, nil)
	if err != nil || len(subs) != 1 {
		t.Fatalf("expected exactly one subscription record after renewal, got %d (err %v)", len(subs), err)
	}
	if subs[0].GetString("status") != "active" {
		t.Errorf("expected sub active after renewal, got %q", subs[0].GetString("status"))
	}
}

// TestMidtransWebhook_FailedChargeGrace moves a provisioned subscription to
// grace_period when a later charge expires/cancels — the customer keeps
// access through the paid period (grace_until = expires_at).
func TestMidtransWebhook_FailedChargeGrace(t *testing.T) {
	resetMidtransDedup()
	resetRateLimiters()
	setMidtransEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	// Provision first, then a cancel notification on the same subscription.
	rec1 := serveMidtrans(t, se, midtransSignedBody("test-midtrans-server-key", "txn_mt_gr01",
		"OZ-PLUS-1755-GR1", "sub_mt_gr01", "settlement", "200", "1490000", "plus", "grace@example.com"))
	if rec1.Code != http.StatusOK {
		t.Fatalf("expected 200 on settled charge, got %d: %s", rec1.Code, rec1.Body.String())
	}

	rec2 := serveMidtrans(t, se, midtransSignedBody("test-midtrans-server-key", "txn_mt_gr02",
		"OZ-PLUS-1755-GR2", "sub_mt_gr01", "cancel", "410", "1490000", "plus", "grace@example.com"))
	if rec2.Code != http.StatusOK {
		t.Fatalf("expected 200 on cancel notification, got %d: %s", rec2.Code, rec2.Body.String())
	}

	subRec, err := app.FindFirstRecordByData("subscriptions", "midtrans_sub_id", "sub_mt_gr01")
	if err != nil {
		t.Fatalf("subscription not found: %v", err)
	}
	if subRec.GetString("status") != "grace_period" {
		t.Errorf("expected grace_period after cancel, got %q", subRec.GetString("status"))
	}
	if subRec.GetString("grace_until") != subRec.GetString("expires_at") {
		t.Errorf("expected grace_until = expires_at, got grace=%q expires=%q",
			subRec.GetString("grace_until"), subRec.GetString("expires_at"))
	}
	if !strings.Contains(subRec.GetString("signed_payload"), `"status":"grace_period"`) {
		t.Errorf("expected re-signed payload status grace_period, got: %s", subRec.GetString("signed_payload"))
	}

	// A failed charge for an unknown order is acknowledged, not an error.
	rec3 := serveMidtrans(t, se, midtransSignedBody("test-midtrans-server-key", "txn_mt_gr03",
		"OZ-PLUS-1755-GR3", "", "expire", "407", "1490000", "plus", "nobody@example.com"))
	if rec3.Code != http.StatusOK {
		t.Fatalf("expected 200 acknowledging unknown-order failure, got %d: %s", rec3.Code, rec3.Body.String())
	}
}

// ── Snap checkout endpoint ──────────────────────────────────────────

// TestMidtransSnap_CheckoutToken exercises POST /api/v1/midtrans/snap:
// session auth, tier/period → fixed IDR amount from the price map, and the
// charge handed to the Snap API carries the tenant email (never a client
// body value).
func TestMidtransSnap_CheckoutToken(t *testing.T) {
	resetRateLimiters()
	setMidtransEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	// seedTenant uses its first arg as the record id (≥15 chars) AND email
	// prefix.
	seedTenant(t, app, "snapbuyer000001", "snap-api-key-001", "active")
	token := "snap-session-0001"
	webOtpStore.createSession(hashWebToken(token), "snapbuyer000001")

	var got midtransSnapCharge
	orig := createMidtransSnap
	createMidtransSnap = func(charge midtransSnapCharge) (midtransSnapResult, error) {
		got = charge
		return midtransSnapResult{Token: "snap-token-001", RedirectURL: "https://app.midtrans.com/snap/v1/transactions/snap-token-001"}, nil
	}
	defer func() { createMidtransSnap = orig }()

	// Yearly plus → 1490000 (the fixed IDR price from MIDTRANS_PRICE_TIERS).
	rec := servePost(t, se, midtransSnapPath, "Bearer "+token, nil, `{"tier_key":"plus","period":"yearly"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 from snap endpoint, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Token   string `json:"token"`
		OrderID string `json:"order_id"`
		Amount  string `json:"amount"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse snap response: %v", err)
	}
	if resp.Token != "snap-token-001" || resp.Amount != "1490000" || resp.OrderID == "" {
		t.Errorf("unexpected snap response: token=%q amount=%q order=%q", resp.Token, resp.Amount, resp.OrderID)
	}
	if got.GrossAmount != "1490000" || got.Period != "yearly" || got.TierKey != "plus" {
		t.Errorf("unexpected snap charge: %+v", got)
	}
	if got.Email != "snapbuyer000001@example.com" {
		t.Errorf("expected tenant email in snap charge, got %q", got.Email)
	}
	if !strings.HasPrefix(got.OrderID, "OZ-PLUS-") {
		t.Errorf("expected OZ-PLUS- order id, got %q", got.OrderID)
	}

	// Monthly plus → 149000 (the monthly price); period omitted defaults to
	// yearly (the pricing page's default billing period).
	rec2 := servePost(t, se, midtransSnapPath, "Bearer "+token, nil, `{"tier_key":"plus","period":"monthly"}`)
	if rec2.Code != http.StatusOK {
		t.Fatalf("expected 200 for monthly period, got %d: %s", rec2.Code, rec2.Body.String())
	}
	var resp2 struct {
		Amount string `json:"amount"`
	}
	if err := json.Unmarshal(rec2.Body.Bytes(), &resp2); err != nil {
		t.Fatalf("failed to parse second snap response: %v", err)
	}
	if resp2.Amount != "149000" {
		t.Errorf("expected monthly amount 149000, got %q", resp2.Amount)
	}

	// Unknown tier → 400 (a misconfigured map must not mint an unbilled tier).
	rec3 := servePost(t, se, midtransSnapPath, "Bearer "+token, nil, `{"tier_key":"premium","period":"yearly"}`)
	if rec3.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for unmapped tier, got %d: %s", rec3.Code, rec3.Body.String())
	}

	// No session → 401.
	rec4 := servePost(t, se, midtransSnapPath, "Bearer bogus", nil, `{"tier_key":"plus"}`)
	if rec4.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without session, got %d: %s", rec4.Code, rec4.Body.String())
	}
}

// ── Vertical-bundle minting (C3.2) ───────────────────────────────────

// midtransSignedBodyBundle is midtransSignedBody plus a custom_field4
// (bundle_id). Custom fields are NOT part of the signature canonical string
// (order_id + status_code + gross_amount + serverkey), so the field is
// injected after signing.
func midtransSignedBodyBundle(serverKey, transactionID, orderID, subscriptionID, status, statusCode, grossAmount, tierField, email, bundle string) string {
	body := midtransSignedBody(serverKey, transactionID, orderID, subscriptionID, status, statusCode, grossAmount, tierField, email)
	if bundle == "" {
		return body
	}
	return strings.Replace(body, "\n}", fmt.Sprintf(",\n  \"custom_field4\": %q\n}", bundle), 1)
}

// midtransSignedBodyPeriod is midtransSignedBody plus a custom_field3
// (billing period). Custom fields are NOT part of the signature canonical
// string (order_id + status_code + gross_amount + serverkey), so the field
// is injected after signing.
func midtransSignedBodyPeriod(serverKey, transactionID, orderID, subscriptionID, status, statusCode, grossAmount, tierField, email, period string) string {
	body := midtransSignedBody(serverKey, transactionID, orderID, subscriptionID, status, statusCode, grossAmount, tierField, email)
	if period == "" {
		return body
	}
	return strings.Replace(body, "\n}", fmt.Sprintf(",\n  \"custom_field3\": %q\n}", period), 1)
}

// TestMidtransWebhook_PeriodCrossCheck rejects a renewal whose
// checkout-embedded period disagrees with the price-map period — a tampered
// custom_field3 must not drift the expiry cadence (monthly amount charged
// as yearly, or vice versa). The fixed IDR amount stays authoritative.
func TestMidtransWebhook_PeriodCrossCheck(t *testing.T) {
	resetMidtransDedup()
	resetRateLimiters()
	setMidtransEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	// 1490000 maps to plus:year, but custom_field3 claims a monthly
	// cadence — a forged period must not let midtransChargeExpiry extend
	// by a month instead of a year.
	body := midtransSignedBodyPeriod("test-midtrans-server-key", "txn_mt_pd01", "OZ-PLUS-1755-PD1",
		"sub_mt_pd01", "settlement", "200", "1490000", "plus", "period@example.com", "month")
	rec := serveMidtrans(t, se, body)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 from period mismatch, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := app.FindFirstRecordByData("license_keys", "midtrans_sub_id", "sub_mt_pd01"); err == nil {
		t.Fatal("expected NO license key minted for a period-tampered charge")
	}

	// The website's monthly/yearly vocabulary is accepted for the matching
	// period — 149000 maps to plus:month, and "monthly" normalizes to it.
	body2 := midtransSignedBodyPeriod("test-midtrans-server-key", "txn_mt_pd02", "OZ-PLUS-1755-PD2",
		"sub_mt_pd02", "settlement", "200", "149000", "plus", "period@example.com", "monthly")
	rec2 := serveMidtrans(t, se, body2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("expected 200 for matching period vocabulary, got %d: %s", rec2.Code, rec2.Body.String())
	}
	keyRec, err := app.FindFirstRecordByData("license_keys", "midtrans_sub_id", "sub_mt_pd02")
	if err != nil {
		t.Fatalf("period-valid charge key not minted: %v", err)
	}
	if diff := keyRec.GetDateTime("expires_at").Time().Sub(time.Now().UTC().AddDate(0, 1, 0)); diff > 5*time.Minute || diff < -5*time.Minute {
		t.Errorf("monthly charge should expire ~+1mo, got %v (diff %v)", keyRec.GetDateTime("expires_at").Time(), diff)
	}
}

func TestMidtransPriceTiers_BundleSegment(t *testing.T) {
	t.Setenv("MIDTRANS_PRICE_TIERS", "149000:plus:month,1740000:plus:year:restaurant_starter")
	m, err := midtransPriceTiers()
	if err != nil {
		t.Fatalf("bundle entry should parse: %v", err)
	}
	if entry, ok := m["1740000"]; !ok || entry != "plus:year:restaurant_starter" {
		t.Errorf("1740000 → %q, want plus:year:restaurant_starter", entry)
	}
	if entry, ok := m["149000"]; !ok || entry != "plus:month:" {
		t.Errorf("149000 → %q, want plus:month: (no bundle)", entry)
	}
	t.Setenv("MIDTRANS_PRICE_TIERS", "1740000:plus:year:fancy_bundle")
	if _, err := midtransPriceTiers(); err == nil {
		t.Error("unknown bundle_id must fail parsing loudly")
	}
	t.Setenv("MIDTRANS_PRICE_TIERS", "1740000:plus:year:restaurant_starter:extra")
	if _, err := midtransPriceTiers(); err == nil {
		t.Error("5-segment entry must fail parsing")
	}
}

// TestMidtransWebhook_BundleMintAndRenew drives the bundle purchase over
// HTTP: a settled charge at the bundle price (custom_field4 labels it)
// mints a plus key whose quota block includes kds and persists bundle_id on
// the key + subscription. A later renewal at the PLAIN price (no
// custom_field4) refreshes the SAME key and keeps kds via the stored
// bundle_id — a bundle the customer is still paying for survives renewals.
func TestMidtransWebhook_BundleMintAndRenew(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping midtrans webhook integration test in short mode")
	}
	resetMidtransDedup()
	resetRateLimiters()
	setMidtransEnv(t)
	t.Setenv("MIDTRANS_PRICE_TIERS", "149000:plus:month,1490000:plus:year,1740000:plus:year:restaurant_starter")
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	restore := stubReceiptEmail(t, new(string))
	defer restore()

	// ── First charge at the bundle price, custom_field4 labels it ──
	rec1 := serveMidtrans(t, se, midtransSignedBodyBundle("test-midtrans-server-key", "txn_mt_bnd01",
		"OZ-PLUS-1755-BND1", "sub_mt_bnd01", "settlement", "200", "1740000", "plus", "bundlebuyer@example.com", "restaurant_starter"))
	if rec1.Code != http.StatusOK {
		t.Fatalf("expected 200 on bundle charge, got %d: %s", rec1.Code, rec1.Body.String())
	}
	keyRec, err := app.FindFirstRecordByData("license_keys", "midtrans_sub_id", "sub_mt_bnd01")
	if err != nil {
		t.Fatalf("bundle license key not minted: %v", err)
	}
	key := keyRec.GetString("key")
	if keyRec.GetString("bundle_id") != "restaurant_starter" {
		t.Errorf("expected bundle_id=restaurant_starter on key, got %q", keyRec.GetString("bundle_id"))
	}
	if !hasKDS(mustParseAllowedTypes(t, keyRec.GetString("allowed_types"))) {
		t.Errorf("bundle mint must include kds in allowed_types, got %q", keyRec.GetString("allowed_types"))
	}
	subRec, err := app.FindFirstRecordByData("subscriptions", "midtrans_sub_id", "sub_mt_bnd01")
	if err != nil {
		t.Fatalf("bundle subscription not persisted: %v", err)
	}
	if subRec.GetString("bundle_id") != "restaurant_starter" {
		t.Errorf("expected sub bundle_id=restaurant_starter, got %q", subRec.GetString("bundle_id"))
	}
	if !strings.Contains(subRec.GetString("signed_payload"), "kds") {
		t.Errorf("signed payload must carry kds in allowed_types, got: %s", subRec.GetString("signed_payload"))
	}

	// ── Renewal at the plain price, no custom_field4: the stored
	//    bundle_id keeps kds on the SAME key, expiry extends ──
	time.Sleep(1100 * time.Millisecond) // prove expiry extension
	rec2 := serveMidtrans(t, se, midtransSignedBody("test-midtrans-server-key", "txn_mt_bnd02",
		"OZ-PLUS-1755-BND2", "sub_mt_bnd01", "settlement", "200", "1490000", "plus", "bundlebuyer@example.com"))
	if rec2.Code != http.StatusOK {
		t.Fatalf("expected 200 on renewal, got %d: %s", rec2.Code, rec2.Body.String())
	}
	keyRec2, err := app.FindFirstRecordByData("license_keys", "midtrans_sub_id", "sub_mt_bnd01")
	if err != nil {
		t.Fatalf("renewed key not found: %v", err)
	}
	if keyRec2.GetString("key") != key {
		t.Errorf("renewal must refresh the SAME key, got %q (first %q)", keyRec2.GetString("key"), key)
	}
	if keyRec2.GetString("bundle_id") != "restaurant_starter" {
		t.Errorf("renewal must keep the stored bundle_id, got %q", keyRec2.GetString("bundle_id"))
	}
	if !hasKDS(mustParseAllowedTypes(t, keyRec2.GetString("allowed_types"))) {
		t.Errorf("renewal must keep kds in allowed_types, got %q", keyRec2.GetString("allowed_types"))
	}
	if !keyRec2.GetDateTime("expires_at").Time().After(keyRec.GetDateTime("expires_at").Time()) {
		t.Errorf("renewal must extend expiry (was %v, now %v)", keyRec.GetDateTime("expires_at").Time(), keyRec2.GetDateTime("expires_at").Time())
	}
}

// TestMidtransWebhook_BundleTamperRejected pays the PLAIN plus amount but
// claims a bundle in custom_field4 — the fixed price is authoritative, so
// the charge is rejected and no key is minted.
func TestMidtransWebhook_BundleTamperRejected(t *testing.T) {
	resetMidtransDedup()
	resetRateLimiters()
	setMidtransEnv(t)
	t.Setenv("MIDTRANS_PRICE_TIERS", "149000:plus:month,1490000:plus:year,1740000:plus:year:restaurant_starter")
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	body := midtransSignedBodyBundle("test-midtrans-server-key", "txn_mt_tmp01",
		"OZ-PLUS-1755-TMP", "sub_mt_tmp01", "settlement", "200", "1490000", "plus", "tamper@example.com", "restaurant_starter")
	rec := serveMidtrans(t, se, body)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 from bundle mismatch, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := app.FindFirstRecordByData("license_keys", "midtrans_sub_id", "sub_mt_tmp01"); err == nil {
		t.Fatal("expected NO license key minted for a bundle-claim tamper")
	}
}

// ── Plus-tier E2E (snap → mint → activate → recurring renewal) ───────

// TestMidtransPlus_SnapToRenew_EndToEnd is the Midtrans twin of
// TestPaddlePlus_WebhookToRenew_EndToEnd: the full plus-tier lifecycle over
// the app mux — snap token → settled-charge mint → POS activation (tenant
// api_key issued) → recurring-charge renewal. The Midtrans renewal model
// differs from Paddle's: instead of a second purchase + renew-endpoint call,
// a later settled charge on the same subscription refreshes the SAME key and
// extends expiry (midtransProvision's findMidtransKey idempotency).
func TestMidtransPlus_SnapToRenew_EndToEnd(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping midtrans webhook integration test in short mode")
	}
	resetMidtransDedup()
	resetRateLimiters()
	setMidtransEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	var emailedKey string
	restore := stubReceiptEmail(t, &emailedKey)
	defer restore()

	// ── 1. Snap token for the plus tier (yearly = the pricing default) ──
	seedTenant(t, app, "snapbuyer000001", "snap-api-key-001", "active")
	snapToken := "snap-session-0001"
	webOtpStore.createSession(hashWebToken(snapToken), "snapbuyer000001")

	orig := createMidtransSnap
	createMidtransSnap = func(charge midtransSnapCharge) (midtransSnapResult, error) {
		return midtransSnapResult{Token: "snap-token-e2e-001", RedirectURL: "https://app.midtrans.com/snap/v1/transactions/snap-token-e2e-001"}, nil
	}
	defer func() { createMidtransSnap = orig }()

	rec := servePost(t, se, midtransSnapPath, "Bearer "+snapToken, nil, `{"tier_key":"plus","period":"yearly"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 from snap endpoint, got %d: %s", rec.Code, rec.Body.String())
	}
	var snapResp struct {
		Token   string `json:"token"`
		OrderID string `json:"order_id"`
		Amount  string `json:"amount"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &snapResp); err != nil {
		t.Fatalf("failed to parse snap response: %v", err)
	}
	if snapResp.Token != "snap-token-e2e-001" || snapResp.Amount != "1490000" || snapResp.OrderID == "" {
		t.Fatalf("unexpected snap response: %+v", snapResp)
	}

	// ── 2. Settled charge for the snap order mints the license ──
	// The checkout's custom fields echo back: tier (custom_field1) and the
	// register-first buyer email (custom_field2) that keys the tenant.
	body := midtransSignedBody("test-midtrans-server-key", "txn_mt_e2e_001", snapResp.OrderID,
		"sub_mt_e2e_001", "settlement", "200", "1490000", "plus", "snapbuyer000001@example.com")
	rec2 := serveMidtrans(t, se, body)
	if rec2.Code != http.StatusOK {
		t.Fatalf("expected 200 from mint webhook, got %d: %s", rec2.Code, rec2.Body.String())
	}

	keyRec, err := app.FindFirstRecordByData("license_keys", "midtrans_sub_id", "sub_mt_e2e_001")
	if err != nil {
		t.Fatalf("plus license key not minted: %v", err)
	}
	key := keyRec.GetString("key")
	if !strings.HasPrefix(key, "OZ-PLUS-") {
		t.Errorf("expected OZ-PLUS- key prefix, got %q", key)
	}
	if keyRec.GetString("midtrans_order_id") != snapResp.OrderID {
		t.Errorf("key must record the snap order id, got %q want %q", keyRec.GetString("midtrans_order_id"), snapResp.OrderID)
	}
	if keyRec.GetString("payment_provider") != "midtrans" {
		t.Errorf("expected payment_provider=midtrans, got %q", keyRec.GetString("payment_provider"))
	}
	if emailedKey != key {
		t.Errorf("expected receipt email with key %q, got %q", key, emailedKey)
	}
	assertPlusQuotaBlock(t, keyRec.GetString("tier_key"), keyRec.GetInt("max_stores"), keyRec.GetInt("max_pos_instances"), mustParseAllowedTypes(t, keyRec.GetString("allowed_types")))

	subRec, err := app.FindFirstRecordByData("subscriptions", "midtrans_sub_id", "sub_mt_e2e_001")
	if err != nil {
		t.Fatalf("plus subscription not persisted: %v", err)
	}
	if subRec.GetString("status") != "active" {
		t.Errorf("expected sub status active, got %q", subRec.GetString("status"))
	}
	if !strings.Contains(subRec.GetString("signed_payload"), `"tier_key":"plus"`) {
		t.Errorf("expected signed payload tier_key plus, got: %s", subRec.GetString("signed_payload"))
	}
	mintExpiry := subRec.GetDateTime("expires_at").Time()
	if diff := mintExpiry.Sub(time.Now().UTC().AddDate(1, 0, 0)); diff > 5*time.Minute || diff < -5*time.Minute {
		t.Errorf("minted plus subscription should expire ~+1y, got %v (diff %v)", mintExpiry, diff)
	}

	// ── 3. Activate the minted key → tenant api_key issued ───────
	actBody := fmt.Sprintf(`{"key":%q,"email":"snapbuyer000001@example.com","machine_id":"e2emachine00001"}`, key)
	actRec := servePost(t, se, "/api/v1/license/activate", "", nil, actBody)
	if actRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from activate, got %d: %s", actRec.Code, actRec.Body.String())
	}
	var actResp map[string]any
	if err := json.Unmarshal(actRec.Body.Bytes(), &actResp); err != nil {
		t.Fatalf("failed to parse activate response: %v", err)
	}
	apiKey, _ := actResp["api_key"].(string)
	if apiKey == "" {
		t.Fatal("expected api_key in activate response")
	}
	actPayload := signedPayloadFrom(t, actRec.Body.Bytes())
	assertPlusQuotaBlock(t, actPayload.TierKey, actPayload.MaxLocations, actPayload.MaxPOSInstances, actPayload.AllowedTypes)

	keyAfterActivate, err := app.FindFirstRecordByData("license_keys", "key", key)
	if err != nil || keyAfterActivate.GetString("status") != "activated" {
		t.Fatalf("expected key %q activated, got status %q (err %v)", key, keyAfterActivate.GetString("status"), err)
	}

	// ── 4. Recurring charge on the same subscription refreshes the
	//       SAME key and extends expiry (Midtrans's renewal model) ──
	time.Sleep(1100 * time.Millisecond) // prove the expiry extension
	rec3 := serveMidtrans(t, se, midtransSignedBody("test-midtrans-server-key", "txn_mt_e2e_002",
		"OZ-PLUS-1755-E2E2", "sub_mt_e2e_001", "settlement", "200", "1490000", "plus", "snapbuyer000001@example.com"))
	if rec3.Code != http.StatusOK {
		t.Fatalf("expected 200 from renewal webhook, got %d: %s", rec3.Code, rec3.Body.String())
	}

	keyRec2, err := app.FindFirstRecordByData("license_keys", "midtrans_sub_id", "sub_mt_e2e_001")
	if err != nil {
		t.Fatalf("renewed key not found: %v", err)
	}
	if keyRec2.GetString("key") != key {
		t.Errorf("recurring renewal must refresh the SAME key, got %q (first %q)", keyRec2.GetString("key"), key)
	}
	if keyRec2.GetString("midtrans_order_id") == snapResp.OrderID {
		t.Errorf("renewal must record the new order id, still %q", keyRec2.GetString("midtrans_order_id"))
	}
	if !keyRec2.GetDateTime("expires_at").Time().After(mintExpiry) {
		t.Errorf("renewal must extend expiry beyond the mint expiry (mint %v, now %v)", mintExpiry, keyRec2.GetDateTime("expires_at").Time())
	}

	// Renewed subscription keeps the plus quota block and a new expiry.
	subRec2, err := app.FindFirstRecordByData("subscriptions", "midtrans_sub_id", "sub_mt_e2e_001")
	if err != nil {
		t.Fatalf("renewed subscription not found: %v", err)
	}
	assertPlusQuotaBlock(t, subRec2.GetString("tier_key"), subRec2.GetInt("max_stores"), subRec2.GetInt("max_pos_instances"), mustParseAllowedTypes(t, subRec2.GetString("allowed_types")))
	if !subRec2.GetDateTime("expires_at").Time().After(mintExpiry) {
		t.Errorf("renewed subscription expiry must extend beyond mint expiry")
	}
}

// ── Boot-time config gate ───────────────────────────────────────────

func TestVerifyMidtransConfig_EmptyKeyReturnsNil(t *testing.T) {
	// When MIDTRANS_SERVER_KEY is unset, verifyMidtransConfig must NOT
	// return an error — the server should start with Midtrans disabled
	// (webhook returns 503, Snap checkout returns error). This is a
	// grace degradation, not a fatal misconfiguration.
	t.Setenv("MIDTRANS_SERVER_KEY", "")
	t.Setenv("MIDTRANS_PRICE_TIERS", "")
	if err := verifyMidtransConfig(); err != nil {
		t.Errorf("expected nil error when MIDTRANS_SERVER_KEY is empty, got: %v", err)
	}
}

func TestVerifyMidtransConfig_KeySetWithoutTiersReturnsError(t *testing.T) {
	// When the key IS set but the price map is missing, provisioning
	// would fail on every webhook — this must be a hard error.
	t.Setenv("MIDTRANS_SERVER_KEY", "SB-Mid-server-test")
	t.Setenv("MIDTRANS_PRICE_TIERS", "")
	if err := verifyMidtransConfig(); err == nil {
		t.Error("expected error when MIDTRANS_PRICE_TIERS is empty but server key is set")
	}
}

func TestVerifyMidtransConfig_KeyAndTiersReturnNil(t *testing.T) {
	// Both set and valid → nil error.
	t.Setenv("MIDTRANS_SERVER_KEY", "SB-Mid-server-test")
	t.Setenv("MIDTRANS_PRICE_TIERS", "149000:plus:month")
	if err := verifyMidtransConfig(); err != nil {
		t.Errorf("expected nil with valid config, got: %v", err)
	}
}
