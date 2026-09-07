package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// ── Test helpers ────────────────────────────────────────────────────

// signPaddle computes a Paddle-Signature header value for a raw body.
func signPaddle(secret, body string, ts int64) string {
	signed := fmt.Sprintf("%d:%s", ts, body)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(signed))
	return fmt.Sprintf("ts=%d;h1=%s", ts, hex.EncodeToString(mac.Sum(nil)))
}

// stubReceiptEmail captures the license key passed to sendReceiptEmail.
func stubReceiptEmail(t *testing.T, captured *string) func() {
	t.Helper()
	t.Setenv("OZ_SMTP_HOST", "test.local")
	orig := sendReceiptEmail
	sendReceiptEmail = func(to, key, tier, expires string) error {
		*captured = key
		return nil
	}
	return func() { sendReceiptEmail = orig }
}

// setPaddleEnv configures the webhook env vars shared by most tests.
// The plus entry mirrors the production six-price PADDLE_PRICE_TIERS
// (Plus/Pro/Premium × monthly/yearly); tests pass the monthly test ids.
func setPaddleEnv(t *testing.T) {
	t.Helper()
	t.Setenv("PADDLE_WEBHOOK_SECRET", "test-webhook-secret")
	t.Setenv("PADDLE_PRICE_TIERS", "pri_test_plus:plus:year,pri_test_pro:pro:year,pri_test_premium:premium:year")
}

// paddleCreatedBody renders a subscription.created payload. email "" omits
// custom_data (forcing the API-fetch path).
func paddleCreatedBody(eventID, subID, customerID, email, priceID string) string {
	custom := ""
	if email != "" {
		custom = fmt.Sprintf(`,"custom_data": {"email": %q}`, email)
	}
	return fmt.Sprintf(`{
  "event_id": %q,
  "event_type": "subscription.created",
  "data": {
    "id": %q,
    "status": "active",
    "customer_id": %q%s,
    "items": [{"price": {"id": %q, "product_id": "pro_test"}, "quantity": 1}],
    "current_billing_period": {"starts_at": %q, "ends_at": %q}
  }
}`, eventID, subID, customerID, custom, priceID,
		time.Now().UTC().AddDate(0, 0, -1).Format(time.RFC3339),
		time.Now().UTC().AddDate(1, 0, 0).Format(time.RFC3339))
}

// seedPaddleTenant creates a tenant in the state the Paddle webhook leaves
// behind: an active tenant whose api_key is a placeholder hash nobody knows
// (the customer's real key is minted at first activation).
func seedPaddleTenant(t *testing.T, app *tests.TestApp, email string) string {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("tenants")
	if err != nil {
		t.Fatalf("tenants collection not found: %v", err)
	}
	rec := core.NewRecord(col)
	rec.Set("email", email)
	rec.Set("phone", "-")
	placeholder := generateAPIKey()
	h, l, hashErr := hashAPIKey(placeholder)
	if hashErr != nil {
		t.Fatalf("hashAPIKey failed: %v", hashErr)
	}
	rec.Set("api_key", h)
	rec.Set("api_key_lookup", l)
	rec.Set("status", "active")
	if err := app.Save(rec); err != nil {
		t.Fatalf("failed to seed paddle tenant %q: %v", email, err)
	}
	return rec.Id
}

// seedLicenseKeyPaddle creates a webhook-issued license key (paddle_sub_id set).
func seedLicenseKeyPaddle(t *testing.T, app *tests.TestApp, key, tierKey, status, expiresAt, paddleSubID string) {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("license_keys")
	if err != nil {
		t.Fatalf("license_keys collection not found: %v", err)
	}
	rec := core.NewRecord(col)
	rec.Set("key", key)
	rec.Set("tier_key", tierKey)
	rec.Set("max_stores", 0)
	rec.Set("max_pos_instances", 0)
	rec.Set("allowed_types", `["restaurant-pos","store-pos","inventory","warehouse","admin","kds"]`)
	rec.Set("status", status)
	rec.Set("expires_at", expiresAt)
	rec.Set("paddle_sub_id", paddleSubID)
	if err := app.Save(rec); err != nil {
		t.Fatalf("failed to seed paddle license key %q: %v", key, err)
	}
}

func countRecords(t *testing.T, app *tests.TestApp, collection string) int {
	t.Helper()
	recs, err := app.FindRecordsByFilter(collection, "", "", 0, 0, nil)
	if err != nil {
		t.Fatalf("count %s failed: %v", collection, err)
	}
	return len(recs)
}

// ── Signature verification ──────────────────────────────────────────

func TestPaddleWebhook_ValidSignature_ProvisioningFlow(t *testing.T) {
	resetPaddleDedup()
	setPaddleEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	var emailedKey string
	restore := stubReceiptEmail(t, &emailedKey)
	defer restore()

	body := paddleCreatedBody("evt_created_001", "sub_created_001", "cus_001", "buyer@example.com", "pri_test_pro")
	header := signPaddle("test-webhook-secret", body, time.Now().Unix())

	req := httptest.NewRequest(http.MethodPost, paddleWebhookPath, strings.NewReader(body))
	req.Header.Set(paddleSignatureHeader, header)
	rec := httptest.NewRecorder()
	mux, _ := se.Router.BuildMux()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// Tenant upserted by email.
	tenant, err := app.FindFirstRecordByData("tenants", "email", "buyer@example.com")
	if err != nil {
		t.Fatalf("tenant not created: %v", err)
	}
	if tenant.GetString("phone") != "-" {
		t.Errorf("expected phone default '-', got %q", tenant.GetString("phone"))
	}

	// License key minted with the tier-derived prefix.
	keyRec, err := app.FindFirstRecordByData("license_keys", "paddle_sub_id", "sub_created_001")
	if err != nil {
		t.Fatalf("license key not created: %v", err)
	}
	key := keyRec.GetString("key")
	if !strings.HasPrefix(key, "OZ-PRO-") {
		t.Errorf("expected key prefix OZ-PRO-, got %q", key)
	}
	if keyRec.GetString("status") != "unused" {
		t.Errorf("expected key status unused, got %q", keyRec.GetString("status"))
	}
	if emailedKey != key {
		t.Errorf("expected receipt email with key %q, got %q", key, emailedKey)
	}

	// Subscription created with an RSA-signed payload.
	subRec, err := app.FindFirstRecordByData("subscriptions", "paddle_sub_id", "sub_created_001")
	if err != nil {
		t.Fatalf("subscription not created: %v", err)
	}
	payload := subRec.GetString("signed_payload")
	if !strings.Contains(payload, `"tier_key":"pro"`) {
		t.Errorf("expected signed payload to carry tier pro, got: %s", payload)
	}
	if subRec.GetString("signature") == "" {
		t.Error("expected a non-empty signature")
	}
	if subRec.GetString("status") != "active" {
		t.Errorf("expected sub status active, got %q", subRec.GetString("status"))
	}

	// The tier quota block must be persisted on the subscription record so
	// /status and subscription.updated / canceled re-signs read real values
	// instead of zero values.
	if subRec.GetInt("max_stores") != 2 || subRec.GetInt("max_pos_instances") != 5 {
		t.Errorf("expected pro tier to persist quotas (2 stores, 5 registers), got max_stores=%d max_pos_instances=%d",
			subRec.GetInt("max_stores"), subRec.GetInt("max_pos_instances"))
	}
	if got := subRec.GetString("allowed_types"); !strings.Contains(got, "restaurant-pos") {
		t.Errorf("expected allowed_types to persist workspace types, got %q", got)
	}
}

func TestPaddleWebhook_InvalidSignature_401(t *testing.T) {
	resetPaddleDedup()
	setPaddleEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	body := paddleCreatedBody("evt_bad_001", "sub_bad_001", "cus_001", "x@example.com", "pri_test_pro")
	// Sign the original body, then send a tampered one (trailing space).
	header := signPaddle("test-webhook-secret", body+" ", time.Now().Unix())

	req := httptest.NewRequest(http.MethodPost, paddleWebhookPath, strings.NewReader(body))
	req.Header.Set(paddleSignatureHeader, header)
	rec := httptest.NewRecorder()
	mux, _ := se.Router.BuildMux()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
	if countRecords(t, app, "tenants") != 0 {
		t.Error("no tenant should be created on a bad signature")
	}
}

func TestPaddleWebhook_MissingSignature_401(t *testing.T) {
	resetPaddleDedup()
	setPaddleEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	rec := webRequest(t, se, http.MethodPost, paddleWebhookPath,
		paddleCreatedBody("evt_nosig_001", "sub_nosig_001", "cus_001", "x@example.com", "pri_test_pro"), "", "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPaddleWebhook_StaleTimestamp_401(t *testing.T) {
	resetPaddleDedup()
	setPaddleEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	body := paddleCreatedBody("evt_stale_001", "sub_stale_001", "cus_001", "x@example.com", "pri_test_pro")
	// 10 minutes in the past — outside the 5-minute replay window.
	header := signPaddle("test-webhook-secret", body, time.Now().Unix()-600)

	req := httptest.NewRequest(http.MethodPost, paddleWebhookPath, strings.NewReader(body))
	req.Header.Set(paddleSignatureHeader, header)
	rec := httptest.NewRecorder()
	mux, _ := se.Router.BuildMux()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for stale ts, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPaddleWebhook_KeyRotation_AcceptsNewSecret(t *testing.T) {
	resetPaddleDedup()
	setPaddleEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	body := paddleCreatedBody("evt_rot_001", "sub_rot_001", "cus_001", "x@example.com", "pri_test_pro")
	ts := time.Now().Unix()
	oldSig := signPaddle("old-secret", body, ts)
	newSig := signPaddle("test-webhook-secret", body, ts)
	header := oldSig + " " + newSig

	req := httptest.NewRequest(http.MethodPost, paddleWebhookPath, strings.NewReader(body))
	req.Header.Set(paddleSignatureHeader, header)
	rec := httptest.NewRecorder()
	mux, _ := se.Router.BuildMux()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 with key-rotation header, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPaddleWebhook_NoSecret_503(t *testing.T) {
	resetPaddleDedup()
	t.Setenv("PADDLE_WEBHOOK_SECRET", "")
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	body := paddleCreatedBody("evt_nosecret_001", "sub_nosecret_001", "cus_001", "x@example.com", "pri_test_pro")
	header := signPaddle("whatever", body, time.Now().Unix())
	req := httptest.NewRequest(http.MethodPost, paddleWebhookPath, strings.NewReader(body))
	req.Header.Set(paddleSignatureHeader, header)
	rec := httptest.NewRecorder()
	mux, _ := se.Router.BuildMux()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPaddleWebhook_NotBlockedByBrowserOrigin(t *testing.T) {
	// The webhook is server-to-server and must NOT be behind the web CORS
	// allowlist — a signature-valid request from any Origin processes.
	resetPaddleDedup()
	setPaddleEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	body := paddleCreatedBody("evt_origin_001", "sub_origin_001", "cus_001", "x@example.com", "pri_test_pro")
	header := signPaddle("test-webhook-secret", body, time.Now().Unix())
	req := httptest.NewRequest(http.MethodPost, paddleWebhookPath, strings.NewReader(body))
	req.Header.Set(paddleSignatureHeader, header)
	req.Header.Set("Origin", "http://evil.example")
	rec := httptest.NewRecorder()
	mux, _ := se.Router.BuildMux()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 (no CORS gate), got %d: %s", rec.Code, rec.Body.String())
	}
}

// ── Provisioning / event handling ───────────────────────────────────

func TestPaddleWebhook_DuplicateEventID_Noop(t *testing.T) {
	resetPaddleDedup()
	setPaddleEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	body := paddleCreatedBody("evt_dup_001", "sub_dup_001", "cus_001", "dup@example.com", "pri_test_pro")
	header := signPaddle("test-webhook-secret", body, time.Now().Unix())
	req := func() *http.Request {
		r := httptest.NewRequest(http.MethodPost, paddleWebhookPath, strings.NewReader(body))
		r.Header.Set(paddleSignatureHeader, header)
		return r
	}
	mux, _ := se.Router.BuildMux()

	rec1 := httptest.NewRecorder()
	mux.ServeHTTP(rec1, req())
	if rec1.Code != http.StatusOK {
		t.Fatalf("first delivery expected 200, got %d", rec1.Code)
	}
	rec2 := httptest.NewRecorder()
	mux.ServeHTTP(rec2, req())
	if rec2.Code != http.StatusOK {
		t.Fatalf("replay expected 200, got %d", rec2.Code)
	}
	if !strings.Contains(rec2.Body.String(), "duplicate") {
		t.Errorf("expected duplicate marker, got %s", rec2.Body.String())
	}

	// Exactly one key + one subscription + one tenant.
	if n := countRecords(t, app, "license_keys"); n != 1 {
		t.Errorf("expected 1 license key, got %d", n)
	}
	if n := countRecords(t, app, "subscriptions"); n != 1 {
		t.Errorf("expected 1 subscription, got %d", n)
	}
}

func TestPaddleWebhook_RedeliveryAfterRestart_UpsertsNotDuplicates(t *testing.T) {
	resetPaddleDedup()
	setPaddleEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	body := paddleCreatedBody("evt_again_001", "sub_again_001", "cus_001", "again@example.com", "pri_test_pro")
	header := signPaddle("test-webhook-secret", body, time.Now().Unix())
	send := func() {
		req := httptest.NewRequest(http.MethodPost, paddleWebhookPath, strings.NewReader(body))
		req.Header.Set(paddleSignatureHeader, header)
		rec := httptest.NewRecorder()
		mux, _ := se.Router.BuildMux()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}
	}
	send()
	// Simulate a restart losing the in-memory dedup map.
	resetPaddleDedup()
	send()

	if n := countRecords(t, app, "license_keys"); n != 1 {
		t.Errorf("expected 1 license key after re-delivery, got %d", n)
	}
	if n := countRecords(t, app, "subscriptions"); n != 1 {
		t.Errorf("expected 1 subscription after re-delivery, got %d", n)
	}
}

func TestPaddleWebhook_UnmappedPrice_500(t *testing.T) {
	resetPaddleDedup()
	setPaddleEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	body := paddleCreatedBody("evt_unmapped_001", "sub_unmapped_001", "cus_001", "x@example.com", "pri_unknown_plan")
	header := signPaddle("test-webhook-secret", body, time.Now().Unix())
	req := httptest.NewRequest(http.MethodPost, paddleWebhookPath, strings.NewReader(body))
	req.Header.Set(paddleSignatureHeader, header)
	rec := httptest.NewRecorder()
	mux, _ := se.Router.BuildMux()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 (Paddle retries), got %d: %s", rec.Code, rec.Body.String())
	}
	if n := countRecords(t, app, "tenants"); n != 0 {
		t.Error("no tenant should be created for an unmapped price")
	}
}

func TestPaddleWebhook_EmailFromCustomData(t *testing.T) {
	resetPaddleDedup()
	setPaddleEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	body := paddleCreatedBody("evt_cd_001", "sub_cd_001", "cus_001", "customdata@example.com", "pri_test_pro")
	header := signPaddle("test-webhook-secret", body, time.Now().Unix())
	req := httptest.NewRequest(http.MethodPost, paddleWebhookPath, strings.NewReader(body))
	req.Header.Set(paddleSignatureHeader, header)
	rec := httptest.NewRecorder()
	mux, _ := se.Router.BuildMux()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := app.FindFirstRecordByData("tenants", "email", "customdata@example.com"); err != nil {
		t.Fatalf("tenant should be created from custom_data.email: %v", err)
	}
}

func TestPaddleWebhook_EmailFromAPIFetch(t *testing.T) {
	resetPaddleDedup()
	setPaddleEnv(t)
	t.Setenv("PADDLE_API_KEY", "test-api-key")
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	orig := fetchPaddleCustomer
	fetchPaddleCustomer = func(customerID string) string {
		if customerID == "cus_api_001" {
			return "api@example.com"
		}
		return ""
	}
	defer func() { fetchPaddleCustomer = orig }()

	// No custom_data email → must fall back to the API fetch.
	body := paddleCreatedBody("evt_api_001", "sub_api_001", "cus_api_001", "", "pri_test_pro")
	header := signPaddle("test-webhook-secret", body, time.Now().Unix())
	req := httptest.NewRequest(http.MethodPost, paddleWebhookPath, strings.NewReader(body))
	req.Header.Set(paddleSignatureHeader, header)
	rec := httptest.NewRecorder()
	mux, _ := se.Router.BuildMux()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := app.FindFirstRecordByData("tenants", "email", "api@example.com"); err != nil {
		t.Fatalf("tenant should be created from API-fetched email: %v", err)
	}
}

func TestPaddleWebhook_UnresolvableEmail_500(t *testing.T) {
	resetPaddleDedup()
	setPaddleEnv(t)
	// No PADDLE_API_KEY, no custom_data email, no embedded customer.
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	body := paddleCreatedBody("evt_noemail_001", "sub_noemail_001", "cus_noemail_001", "", "pri_test_pro")
	header := signPaddle("test-webhook-secret", body, time.Now().Unix())
	req := httptest.NewRequest(http.MethodPost, paddleWebhookPath, strings.NewReader(body))
	req.Header.Set(paddleSignatureHeader, header)
	rec := httptest.NewRecorder()
	mux, _ := se.Router.BuildMux()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 (Paddle retries until email is resolvable), got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPaddleWebhook_TransactionCompleted_Acknowledged(t *testing.T) {
	resetPaddleDedup()
	setPaddleEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	body := `{"event_id":"evt_tx_001","event_type":"transaction.completed","data":{"id":"txn_001","status":"completed"}}`
	header := signPaddle("test-webhook-secret", body, time.Now().Unix())
	req := httptest.NewRequest(http.MethodPost, paddleWebhookPath, strings.NewReader(body))
	req.Header.Set(paddleSignatureHeader, header)
	rec := httptest.NewRecorder()
	mux, _ := se.Router.BuildMux()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if n := countRecords(t, app, "tenants"); n != 0 {
		t.Error("transaction.completed must not provision (no lifetime tier yet)")
	}
}

func TestPaddleWebhook_UnknownEventType_Acknowledged(t *testing.T) {
	resetPaddleDedup()
	setPaddleEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	body := `{"event_id":"evt_cust_001","event_type":"customer.created","data":{"id":"cus_001"}}`
	header := signPaddle("test-webhook-secret", body, time.Now().Unix())
	req := httptest.NewRequest(http.MethodPost, paddleWebhookPath, strings.NewReader(body))
	req.Header.Set(paddleSignatureHeader, header)
	rec := httptest.NewRecorder()
	mux, _ := se.Router.BuildMux()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 ack, got %d: %s", rec.Code, rec.Body.String())
	}
}

// subscriptionLifecycle provisions a sub first, then returns its records.
func provisionForEvents(t *testing.T, app *tests.TestApp, se *core.ServeEvent, subID string) {
	t.Helper()
	body := paddleCreatedBody("evt_lc_"+subID, subID, "cus_lc_001", "lc@example.com", "pri_test_pro")
	header := signPaddle("test-webhook-secret", body, time.Now().Unix())
	req := httptest.NewRequest(http.MethodPost, paddleWebhookPath, strings.NewReader(body))
	req.Header.Set(paddleSignatureHeader, header)
	rec := httptest.NewRecorder()
	mux, _ := se.Router.BuildMux()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("provision failed: %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPaddleWebhook_SubscriptionUpdated_SyncsTierAndExpiry(t *testing.T) {
	resetPaddleDedup()
	setPaddleEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	provisionForEvents(t, app, se, "sub_upd_001")

	// Upgrade pro → premium and extend the period.
	body := fmt.Sprintf(`{
  "event_id": "evt_upd_001",
  "event_type": "subscription.updated",
  "data": {
    "id": "sub_upd_001",
    "status": "active",
    "customer_id": "cus_lc_001",
    "items": [{"price": {"id": "pri_test_premium", "product_id": "pro_test"}, "quantity": 1}],
    "current_billing_period": {"starts_at": %q, "ends_at": %q}
  }
}`, time.Now().UTC().Format(time.RFC3339),
		time.Now().UTC().AddDate(2, 0, 0).Format(time.RFC3339))
	header := signPaddle("test-webhook-secret", body, time.Now().Unix())
	req := httptest.NewRequest(http.MethodPost, paddleWebhookPath, strings.NewReader(body))
	req.Header.Set(paddleSignatureHeader, header)
	rec := httptest.NewRecorder()
	mux, _ := se.Router.BuildMux()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	subRec, err := app.FindFirstRecordByData("subscriptions", "paddle_sub_id", "sub_upd_001")
	if err != nil {
		t.Fatalf("subscription not found: %v", err)
	}
	if subRec.GetString("tier_key") != "premium" {
		t.Errorf("expected tier premium after update, got %q", subRec.GetString("tier_key"))
	}
	if !strings.Contains(subRec.GetString("signed_payload"), `"tier_key":"premium"`) {
		t.Errorf("signed payload should reflect the new tier, got: %s", subRec.GetString("signed_payload"))
	}

	// The license key must be kept in sync (tier + expiry).
	keyRec, err := app.FindFirstRecordByData("license_keys", "paddle_sub_id", "sub_upd_001")
	if err != nil {
		t.Fatalf("license key not found: %v", err)
	}
	if keyRec.GetString("tier_key") != "premium" {
		t.Errorf("expected key tier premium after update, got %q", keyRec.GetString("tier_key"))
	}
	if keyRec.GetString("expires_at") != subRec.GetString("expires_at") {
		t.Errorf("expected key expiry synced to sub expiry (%s), got %s",
			subRec.GetString("expires_at"), keyRec.GetString("expires_at"))
	}

	// The record's grace_until must be refreshed with the new period: the
	// re-signed payload already carries calculateGraceUntil(new expires_at),
	// and /me (subscriptionSummary) reads the record — a stale value would
	// make the dashboard's "Grace until" disagree with the signed payload.
	wantGrace := calculateGraceUntil(subRec.GetDateTime("expires_at").Time())
	gotGrace := subRec.GetDateTime("grace_until").Time()
	if !wantGrace.Equal(gotGrace) {
		t.Errorf("expected grace_until refreshed to %s after period extension, got %s",
			wantGrace.Format(time.RFC3339), gotGrace.Format(time.RFC3339))
	}
	if !strings.Contains(subRec.GetString("signed_payload"), fmt.Sprintf(`"grace_until":%q`, wantGrace.Format(time.RFC3339))) {
		t.Errorf("signed payload should carry the same refreshed grace_until, got: %s", subRec.GetString("signed_payload"))
	}
}

func TestPaddleWebhook_SubscriptionCanceled_GracePeriod(t *testing.T) {
	resetPaddleDedup()
	setPaddleEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	provisionForEvents(t, app, se, "sub_can_001")

	graceUntil := time.Now().UTC().AddDate(0, 1, 0).Format(time.RFC3339)
	body := fmt.Sprintf(`{
  "event_id": "evt_can_001",
  "event_type": "subscription.canceled",
  "data": {
    "id": "sub_can_001",
    "status": "canceled",
    "customer_id": "cus_lc_001",
    "items": [{"price": {"id": "pri_test_pro", "product_id": "pro_test"}, "quantity": 1}],
    "scheduled_change": {"effective_at": %q, "status": "active"}
  }
}`, graceUntil)
	header := signPaddle("test-webhook-secret", body, time.Now().Unix())
	req := httptest.NewRequest(http.MethodPost, paddleWebhookPath, strings.NewReader(body))
	req.Header.Set(paddleSignatureHeader, header)
	rec := httptest.NewRecorder()
	mux, _ := se.Router.BuildMux()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	subRec, err := app.FindFirstRecordByData("subscriptions", "paddle_sub_id", "sub_can_001")
	if err != nil {
		t.Fatalf("subscription not found: %v", err)
	}
	if subRec.GetString("status") != "grace_period" {
		t.Errorf("expected status grace_period, got %q", subRec.GetString("status"))
	}
	// PocketBase normalizes date storage ("2026-09-15T23:10:49Z" →
	// "2026-09-15 23:10:49.000Z") — compare via the DateTime accessor.
	wantT, err1 := time.Parse(time.RFC3339, graceUntil)
	gotT := subRec.GetDateTime("grace_until").Time()
	if err1 != nil || !wantT.Equal(gotT) {
		t.Errorf("expected grace_until %s, got %s", graceUntil, gotT.Format(time.RFC3339))
	}
	if !strings.Contains(subRec.GetString("signed_payload"), `"status":"grace_period"`) {
		t.Errorf("signed payload should reflect grace_period, got: %s", subRec.GetString("signed_payload"))
	}
}

// ── Activation integration ──────────────────────────────────────────

func TestActivate_PaddleKeyWithoutAPIKey_MintsKeyAndReusesSubscription(t *testing.T) {
	resetPaddleDedup()
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	tenantID := seedPaddleTenant(t, app, "paddle-activate@example.com")
	expiresAt := time.Now().UTC().AddDate(1, 0, 0).Format(time.RFC3339)
	seedLicenseKeyPaddle(t, app, "OZ-PRO-PADDLE-0001", "pro", "unused", expiresAt, "sub_act_001")
	// The webhook-created active subscription (signed_payload "{}" marks it).
	seedSubscription(t, app, tenantID, "pro", "active")

	body := `{"key":"OZ-PRO-PADDLE-0001","machine_id":"aaaaaaaaaaaaaaa","email":"paddle-activate@example.com"}`
	rec := webRequest(t, se, http.MethodPost, "/api/v1/license/activate", body, "", "")

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("response not JSON: %v", err)
	}
	apiKey, _ := resp["api_key"].(string)
	if apiKey == "" {
		t.Fatal("expected a freshly minted api_key in the response")
	}
	if resp["signed_payload"] != "{}" {
		t.Errorf("expected the webhook-created subscription to be reused, got signed_payload %v", resp["signed_payload"])
	}

	// The minted api_key must actually authenticate /status (tenant rotated).
	if _, err := findTenantByAPIKey(app, apiKey); err != nil {
		t.Errorf("minted api_key should resolve the tenant: %v", err)
	}

	// The key must be marked activated and NO duplicate subscription created.
	keyRec, err := app.FindFirstRecordByData("license_keys", "key", "OZ-PRO-PADDLE-0001")
	if err != nil {
		t.Fatalf("key not found: %v", err)
	}
	if keyRec.GetString("status") != "activated" {
		t.Errorf("expected key activated, got %q", keyRec.GetString("status"))
	}
	subs, err := app.FindRecordsByFilter("subscriptions", "tenant_id = {:tid}", "", 0, 0,
		map[string]any{"tid": tenantID})
	if err != nil {
		t.Fatalf("subscription query failed: %v", err)
	}
	if len(subs) != 1 {
		t.Errorf("expected exactly 1 subscription (no duplicate), got %d", len(subs))
	}
}

func TestActivate_ManualKeyExistingTenantStillRequiresAPIKey(t *testing.T) {
	// Regression: the paddle-key exception must NOT weaken manual keys —
	// activating an unused manual key onto an existing tenant still requires
	// the tenant's api_key.
	resetPaddleDedup()
	resetRateLimiters()
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	seedTenant(t, app, "manualtenant001", "manualkey000001", "active")
	expiresAt := time.Now().UTC().AddDate(1, 0, 0).Format(time.RFC3339)
	seedLicenseKey(t, app, "OZ-PRO-MANUAL-0001", "pro", "unused", expiresAt)

	body := `{"key":"OZ-PRO-MANUAL-0001","machine_id":"aaaaaaaaaaaaaaa","email":"MANUALTENANT001@example.com"}`
	rec := webRequest(t, se, http.MethodPost, "/api/v1/license/activate", body, "", "")

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 (api_key required for manual keys), got %d: %s", rec.Code, rec.Body.String())
	}
}

// ── Remaining lifecycle + robustness paths ─────────────────────────

// sendPaddleEvent signs and delivers a raw webhook body to the router.
func sendPaddleEvent(t *testing.T, se *core.ServeEvent, body string) *httptest.ResponseRecorder {
	t.Helper()
	header := signPaddle("test-webhook-secret", body, time.Now().Unix())
	req := httptest.NewRequest(http.MethodPost, paddleWebhookPath, strings.NewReader(body))
	req.Header.Set(paddleSignatureHeader, header)
	rec := httptest.NewRecorder()
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}
	mux.ServeHTTP(rec, req)
	return rec
}

// subEventBody renders a minimal subscription.<event_type> payload.
func subEventBody(eventType, eventID, subID, status string) string {
	return fmt.Sprintf(`{
  "event_id": %q,
  "event_type": %q,
  "data": {
    "id": %q,
    "status": %q,
    "customer_id": "cus_lc_001",
    "items": [{"price": {"id": "pri_test_pro", "product_id": "pro_test"}, "quantity": 1}]
  }
}`, eventID, eventType, subID, status)
}

func TestPaddleWebhook_SubscriptionPaused_GracePeriod(t *testing.T) {
	resetPaddleDedup()
	setPaddleEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	provisionForEvents(t, app, se, "sub_pause_001")

	rec := sendPaddleEvent(t, se, subEventBody("subscription.paused", "evt_pause_001", "sub_pause_001", "paused"))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	subRec, err := app.FindFirstRecordByData("subscriptions", "paddle_sub_id", "sub_pause_001")
	if err != nil {
		t.Fatalf("subscription not found: %v", err)
	}
	if subRec.GetString("status") != "grace_period" {
		t.Errorf("expected paused -> grace_period, got %q", subRec.GetString("status"))
	}
}

func TestPaddleWebhook_SubscriptionResumed_BackToActive(t *testing.T) {
	resetPaddleDedup()
	setPaddleEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	provisionForEvents(t, app, se, "sub_res_001")
	// Pause first, then resume.
	sendPaddleEvent(t, se, subEventBody("subscription.paused", "evt_res_pause_001", "sub_res_001", "paused"))
	rec := sendPaddleEvent(t, se, subEventBody("subscription.resumed", "evt_res_001", "sub_res_001", "active"))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	subRec, err := app.FindFirstRecordByData("subscriptions", "paddle_sub_id", "sub_res_001")
	if err != nil {
		t.Fatalf("subscription not found: %v", err)
	}
	if subRec.GetString("status") != "active" {
		t.Errorf("expected resumed -> active, got %q", subRec.GetString("status"))
	}
	if !strings.Contains(subRec.GetString("signed_payload"), `"status":"active"`) {
		t.Errorf("resumed subscription must be re-signed as active, got: %s", subRec.GetString("signed_payload"))
	}

	// Resume starts a fresh billing period (no period in the test payload →
	// calculateExpiry from now), so the record's grace_until must be
	// refreshed and the license key's expiry re-synced — otherwise /me shows
	// a stale grace date and the key expires at the old date while the
	// subscription says otherwise.
	wantGrace := calculateGraceUntil(subRec.GetDateTime("expires_at").Time())
	gotGrace := subRec.GetDateTime("grace_until").Time()
	if !wantGrace.Equal(gotGrace) {
		t.Errorf("expected grace_until refreshed to %s after resume, got %s",
			wantGrace.Format(time.RFC3339), gotGrace.Format(time.RFC3339))
	}
	keyRec, err := app.FindFirstRecordByData("license_keys", "paddle_sub_id", "sub_res_001")
	if err != nil {
		t.Fatalf("license key not found: %v", err)
	}
	if keyRec.GetString("expires_at") != subRec.GetString("expires_at") {
		t.Errorf("expected key expiry re-synced to resumed sub expiry (%s), got %s",
			subRec.GetString("expires_at"), keyRec.GetString("expires_at"))
	}
}

// TestWebhookLifecycle_MeTracksCancelAndResume drives the full subscription
// lifecycle through the REAL webhook endpoint and asserts the dashboard
// (/api/v1/web/me) payload after every transition: created → updated (tier
// change + period extension) → canceled (grace) → resumed (active). This is
// the surface subscriptionSummary / licenseSummary feed — a stale grace_until
// or unsynced key expiry here is exactly what the account page would show.
func TestWebhookLifecycle_MeTracksCancelAndResume(t *testing.T) {
	resetPaddleDedup()
	resetRateLimiters()
	setPaddleEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	provisionForEvents(t, app, se, "sub_life_001")

	tenant, err := app.FindFirstRecordByData("tenants", "email", "lc@example.com")
	if err != nil {
		t.Fatalf("webhook-created tenant not found: %v", err)
	}
	token := "lifecycle-session-0001"
	webOtpStore.createSession(hashWebToken(token), tenant.Id)

	me := func(t *testing.T) (license, sub map[string]any) {
		t.Helper()
		rec := webRequest(t, se, http.MethodGet, "/api/v1/web/me", "",
			"http://localhost:4321", "Bearer "+token)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected /me 200, got %d: %s", rec.Code, rec.Body.String())
		}
		var resp struct {
			License map[string]any `json:"license"`
			Sub     map[string]any `json:"subscription"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to parse /me: %v", err)
		}
		return resp.License, resp.Sub
	}

	// 1. created → active pro subscription + minted key surfaced.
	license, sub := me(t)
	if sub == nil || sub["status"] != "active" || sub["tierKey"] != "pro" {
		t.Fatalf("expected active pro sub after created, got %v", sub)
	}
	if license == nil || license["key"] == "" {
		t.Fatalf("expected minted license key after created, got %v", license)
	}

	// 2. updated → premium + period extended to +2y. PocketBase stores
	// whole seconds, so truncate the expectation or Equal() fails on the
	// fractional-second difference Format() hides.
	newEnds := time.Now().UTC().Truncate(time.Second).AddDate(2, 0, 0)
	body := fmt.Sprintf(`{
  "event_id": "evt_life_upd_001",
  "event_type": "subscription.updated",
  "data": {
    "id": "sub_life_001",
    "status": "active",
    "customer_id": "cus_lc_001",
    "items": [{"price": {"id": "pri_test_premium", "product_id": "pro_test"}, "quantity": 1}],
    "current_billing_period": {"starts_at": %q, "ends_at": %q}
  }
}`, time.Now().UTC().Format(time.RFC3339), newEnds.Format(time.RFC3339))
	if rec := sendPaddleEvent(t, se, body); rec.Code != http.StatusOK {
		t.Fatalf("updated webhook failed: %d: %s", rec.Code, rec.Body.String())
	}
	license, sub = me(t)
	if sub["tierKey"] != "premium" || sub["status"] != "active" {
		t.Errorf("expected premium active after update, got %v", sub)
	}
	if license["tierKey"] != "premium" {
		t.Errorf("expected license tier synced to premium, got %v", license["tierKey"])
	}
	subRec, err := app.FindFirstRecordByData("subscriptions", "paddle_sub_id", "sub_life_001")
	if err != nil {
		t.Fatalf("subscription not found: %v", err)
	}
	wantGrace := calculateGraceUntil(newEnds)
	if got := subRec.GetDateTime("grace_until").Time(); !wantGrace.Equal(got) {
		t.Errorf("after update: expected record grace_until %s, got %s",
			wantGrace.Format(time.RFC3339), got.Format(time.RFC3339))
	}
	if sub["graceUntil"] != subRec.GetDateTime("grace_until").Time().UTC().Format(time.RFC3339) {
		t.Errorf("after update: /me graceUntil (%v) must be RFC3339 UTC (%s)",
			sub["graceUntil"], subRec.GetDateTime("grace_until").Time().UTC().Format(time.RFC3339))
	}

	// 3. canceled → grace_period until the scheduled change (whole-second
	// expectation — see note above).
	effective := time.Now().UTC().Truncate(time.Second).AddDate(0, 2, 0)
	body = fmt.Sprintf(`{
  "event_id": "evt_life_can_001",
  "event_type": "subscription.canceled",
  "data": {
    "id": "sub_life_001",
    "status": "canceled",
    "customer_id": "cus_lc_001",
    "items": [{"price": {"id": "pri_test_premium", "product_id": "pro_test"}, "quantity": 1}],
    "scheduled_change": {"effective_at": %q, "status": "canceled"}
  }
}`, effective.Format(time.RFC3339))
	if rec := sendPaddleEvent(t, se, body); rec.Code != http.StatusOK {
		t.Fatalf("canceled webhook failed: %d: %s", rec.Code, rec.Body.String())
	}
	_, sub = me(t)
	if sub == nil || sub["status"] != "grace_period" {
		t.Fatalf("expected grace_period after cancel, got %v", sub)
	}
	subRec, err = app.FindFirstRecordByData("subscriptions", "paddle_sub_id", "sub_life_001")
	if err != nil {
		t.Fatalf("subscription not found: %v", err)
	}
	if got := subRec.GetDateTime("grace_until").Time(); !effective.Equal(got) {
		t.Errorf("after cancel: expected grace_until %s, got %s",
			effective.Format(time.RFC3339), got.Format(time.RFC3339))
	}
	if sub["graceUntil"] != subRec.GetDateTime("grace_until").Time().UTC().Format(time.RFC3339) {
		t.Errorf("after cancel: /me graceUntil (%v) must be RFC3339 UTC (%s)",
			sub["graceUntil"], subRec.GetDateTime("grace_until").Time().UTC().Format(time.RFC3339))
	}

	// 4. resumed → back to active with a fresh grace window.
	if rec := sendPaddleEvent(t, se, subEventBody("subscription.resumed", "evt_life_res_001", "sub_life_001", "active")); rec.Code != http.StatusOK {
		t.Fatalf("resumed webhook failed: %d: %s", rec.Code, rec.Body.String())
	}
	license, sub = me(t)
	if sub == nil || sub["status"] != "active" || sub["tierKey"] != "premium" {
		t.Fatalf("expected active premium after resume, got %v", sub)
	}
	subRec, err = app.FindFirstRecordByData("subscriptions", "paddle_sub_id", "sub_life_001")
	if err != nil {
		t.Fatalf("subscription not found: %v", err)
	}
	wantGrace = calculateGraceUntil(subRec.GetDateTime("expires_at").Time())
	if got := subRec.GetDateTime("grace_until").Time(); !wantGrace.Equal(got) {
		t.Errorf("after resume: expected record grace_until %s, got %s",
			wantGrace.Format(time.RFC3339), got.Format(time.RFC3339))
	}
	if sub["graceUntil"] != subRec.GetDateTime("grace_until").Time().UTC().Format(time.RFC3339) {
		t.Errorf("after resume: /me graceUntil (%v) must be RFC3339 UTC (%s)",
			sub["graceUntil"], subRec.GetDateTime("grace_until").Time().UTC().Format(time.RFC3339))
	}
	keyRec, err := app.FindFirstRecordByData("license_keys", "paddle_sub_id", "sub_life_001")
	if err != nil {
		t.Fatalf("license key not found: %v", err)
	}
	if keyRec.GetString("expires_at") != subRec.GetString("expires_at") {
		t.Errorf("after resume: key expiry (%s) must match sub expiry (%s)",
			keyRec.GetString("expires_at"), subRec.GetString("expires_at"))
	}
	if license["key"] == "" {
		t.Error("after resume: license key must still be surfaced")
	}
}

func TestPaddleWebhook_SubscriptionPastDue_StaysActive(t *testing.T) {
	resetPaddleDedup()
	setPaddleEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	provisionForEvents(t, app, se, "sub_due_001")

	rec := sendPaddleEvent(t, se, subEventBody("subscription.past_due", "evt_due_001", "sub_due_001", "past_due"))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	// past_due is acknowledged without touching the subscription (Paddle is
	// still retrying the payment) — it must remain active.
	subRec, err := app.FindFirstRecordByData("subscriptions", "paddle_sub_id", "sub_due_001")
	if err != nil {
		t.Fatalf("subscription not found: %v", err)
	}
	if subRec.GetString("status") != "active" {
		t.Errorf("expected past_due to leave subscription active, got %q", subRec.GetString("status"))
	}
}

func TestPaddleWebhook_ReceiptEmailFailure_NonFatal(t *testing.T) {
	// Provisioning must succeed even when the receipt email fails — the key
	// is also visible in the dashboard, so a mail hiccup must not block it.
	resetPaddleDedup()
	setPaddleEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	orig := sendReceiptEmail
	sendReceiptEmail = func(to, key, tier, expires string) error {
		return fmt.Errorf("relay down")
	}
	defer func() { sendReceiptEmail = orig }()

	body := paddleCreatedBody("evt_rcpt_fail_001", "sub_rcpt_fail_001", "cus_001", "buyer@example.com", "pri_test_pro")
	rec := sendPaddleEvent(t, se, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 despite email failure, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := app.FindFirstRecordByData("license_keys", "paddle_sub_id", "sub_rcpt_fail_001"); err != nil {
		t.Fatalf("license key must still be minted when the receipt fails: %v", err)
	}
}

func TestPaddleWebhook_UpdateUnknownSubscription_Acknowledged(t *testing.T) {
	// subscription.updated for a paddle_sub_id we have no local record for
	// (e.g. created before the webhook shipped) must acknowledge, not 500 —
	// otherwise Paddle retries forever.
	resetPaddleDedup()
	setPaddleEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	rec := sendPaddleEvent(t, se, subEventBody("subscription.updated", "evt_unknown_upd_001", "sub_unknown_001", "active"))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 ack, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPaddleWebhook_CancelUnknownSubscription_Acknowledged(t *testing.T) {
	resetPaddleDedup()
	setPaddleEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	rec := sendPaddleEvent(t, se, subEventBody("subscription.canceled", "evt_unknown_can_001", "sub_unknown_001", "canceled"))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 ack, got %d: %s", rec.Code, rec.Body.String())
	}
}

// ── Boot-time webhook config gate (verifyPaddleConfig) ───────────────

func TestVerifyPaddleConfig_SecretMissing_Fails(t *testing.T) {
	t.Setenv("PADDLE_WEBHOOK_SECRET", "")
	t.Setenv("PADDLE_PRICE_TIERS", "pri_test_pro:pro:year")
	err := verifyPaddleConfig()
	if err == nil {
		t.Fatal("missing PADDLE_WEBHOOK_SECRET must fail boot")
	}
	if !strings.Contains(err.Error(), "PADDLE_WEBHOOK_SECRET is required") {
		t.Errorf("error = %q, want a clear PADDLE_WEBHOOK_SECRET message", err)
	}
}

func TestVerifyPaddleConfig_PriceTiersMissing_Fails(t *testing.T) {
	t.Setenv("PADDLE_WEBHOOK_SECRET", "test-webhook-secret")
	t.Setenv("PADDLE_PRICE_TIERS", "")
	err := verifyPaddleConfig()
	if err == nil {
		t.Fatal("missing PADDLE_PRICE_TIERS must fail boot")
	}
	if !strings.Contains(err.Error(), "PADDLE_PRICE_TIERS is required") {
		t.Errorf("error = %q, want a clear PADDLE_PRICE_TIERS message", err)
	}
}

func TestVerifyPaddleConfig_MalformedPriceTiers_Fails(t *testing.T) {
	t.Setenv("PADDLE_WEBHOOK_SECRET", "test-webhook-secret")
	for _, bad := range []string{"pro", "pri_x:pro,:pro", "pri_x:pro,pri_y", "pri_x:pro, :premium"} {
		t.Setenv("PADDLE_PRICE_TIERS", bad)
		if err := verifyPaddleConfig(); err == nil {
			t.Fatalf("malformed PADDLE_PRICE_TIERS=%q must fail boot", bad)
		}
	}
}

func TestVerifyPaddleConfig_ValidPasses(t *testing.T) {
	t.Setenv("PADDLE_WEBHOOK_SECRET", "test-webhook-secret")
	t.Setenv("PADDLE_PRICE_TIERS", "pri_test_pro:pro:year,pri_test_premium:premium:year")
	if err := verifyPaddleConfig(); err != nil {
		t.Fatalf("valid config should pass the gate: %v", err)
	}
}

func TestPaddleTierForPrice_StillWorksViaParser(t *testing.T) {
	t.Setenv("PADDLE_PRICE_TIERS", "pri_test_pro:pro:year,pri_test_premium:premium:year")
	if tier, period, bundle, ok := paddleTierForPrice("pri_test_premium"); !ok || tier != "premium" || bundle != "" {
		t.Errorf("pri_test_premium → (%q, %q, %q, %v), want (premium, year, %q, true)", tier, period, bundle, ok, "")
	}
	if _, _, _, ok := paddleTierForPrice("pri_unknown"); ok {
		t.Error("unmapped price must return ok=false")
	}
	if _, _, _, ok := paddleTierForPrice(""); ok {
		t.Error("empty price must return ok=false")
	}
}

func TestPaddlePriceTiers_BundleSegment(t *testing.T) {
	t.Setenv("PADDLE_PRICE_TIERS", "pri_test_plus:plus:year,pri_test_bundle:plus:month:restaurant_starter")
	m, err := paddlePriceTiers()
	if err != nil {
		t.Fatalf("bundle entry should parse: %v", err)
	}
	if entry, ok := m["pri_test_bundle"]; !ok || entry != "plus:month:restaurant_starter" {
		t.Errorf("pri_test_bundle → %q, want plus:month:restaurant_starter", entry)
	}
	t.Setenv("PADDLE_PRICE_TIERS", "pri_test_bad:plus:year:fancy_bundle")
	if _, err := paddlePriceTiers(); err == nil {
		t.Error("unknown bundle_id must fail parsing loudly")
	}
	t.Setenv("PADDLE_PRICE_TIERS", "pri_test_malformed")
	if _, err := paddlePriceTiers(); err == nil {
		t.Error("malformed entry (single segment) must fail parsing")
	}
}

func TestPaddlePriceTiers_PeriodSegment(t *testing.T) {
	t.Setenv("PADDLE_PRICE_TIERS", "pri_test_monthly:plus:month,pri_test_yearly:pro:year")
	m, err := paddlePriceTiers()
	if err != nil {
		t.Fatalf("period entries should parse: %v", err)
	}
	if entry, ok := m["pri_test_monthly"]; !ok || entry != "plus:month:" {
		t.Errorf("pri_test_monthly → %q, want plus:month:", entry)
	}
	if entry, ok := m["pri_test_yearly"]; !ok || entry != "pro:year:" {
		t.Errorf("pri_test_yearly → %q, want pro:year:", entry)
	}
	// Backward compat: 2-part entry defaults period to year.
	t.Setenv("PADDLE_PRICE_TIERS", "pri_test_legacy:premium")
	m2, err := paddlePriceTiers()
	if err != nil {
		t.Fatalf("legacy 2-part entry should parse: %v", err)
	}
	if entry, ok := m2["pri_test_legacy"]; !ok || entry != "premium:year:" {
		t.Errorf("pri_test_legacy → %q, want premium:year:", entry)
	}
}

// ── Plus tier end-to-end (PADDLE_PRICE_TIERS → activate → renew) ──────

// servePost routes one HTTP request through the app mux.
func servePost(t *testing.T, se *core.ServeEvent, path, auth string, headers map[string]string, body string) *httptest.ResponseRecorder {
	t.Helper()
	mux, err := se.Router.BuildMux()
	if err != nil {
		t.Fatalf("BuildMux failed: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

// signedPayloadFrom extracts the RSA-signed payload from a JSON response.
func signedPayloadFrom(t *testing.T, body []byte) SubscriptionPayload {
	t.Helper()
	var resp map[string]any
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	payloadStr, ok := resp["signed_payload"].(string)
	if !ok || payloadStr == "" {
		t.Fatal("expected signed_payload in response")
	}
	var sp SubscriptionPayload
	if err := json.Unmarshal([]byte(payloadStr), &sp); err != nil {
		t.Fatalf("failed to parse signed_payload: %v", err)
	}
	return sp
}

// assertPlusQuotaBlock checks the plus-tier quota contract (1 store / 2
// registers / no kds) on a payload or record's allowed_types JSON.
func assertPlusQuotaBlock(t *testing.T, tier string, maxStores, maxPOS int, allowed []string) {
	t.Helper()
	if tier != "plus" {
		t.Errorf("expected tier_key plus, got %q", tier)
	}
	if maxStores != 1 {
		t.Errorf("expected max_stores=1, got %d", maxStores)
	}
	if maxPOS != 2 {
		t.Errorf("expected max_pos_instances=2, got %d", maxPOS)
	}
	hasKDS := false
	for _, w := range allowed {
		if w == "kds" {
			hasKDS = true
		}
	}
	if hasKDS {
		t.Errorf("plus must not allow kds (Pro+), got %v", allowed)
	}
	if !slices.Contains(allowed, "restaurant-pos") || !slices.Contains(allowed, "store-pos") ||
		!slices.Contains(allowed, "inventory") || !slices.Contains(allowed, "warehouse") {
		t.Errorf("plus allowed_types missing core workspace types, got %v", allowed)
	}
}

// TestPaddlePlus_WebhookToRenew_EndToEnd drives the full plus-tier lifecycle
// over HTTP: the PADDLE_PRICE_TIERS plus entry provisions a 1-store/
// 2-register license on subscription.created, activation issues the tenant
// api_key, a second purchase mints a renewal key, and the renew endpoint
// appends +1 year while keeping the plus quota block intact.
func TestPaddlePlus_WebhookToRenew_EndToEnd(t *testing.T) {
	resetPaddleDedup()
	resetRateLimiters()
	setPaddleEnv(t)
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	var emailedKey string
	restore := stubReceiptEmail(t, &emailedKey)
	defer restore()

	// ── 1. First purchase: subscription.created @ the plus price ──
	body := paddleCreatedBody("evt_plus_e2e_001", "sub_plus_e2e_001", "cus_plus_e2e_001", "plusbuyer@example.com", "pri_test_plus")
	rec := servePost(t, se, paddleWebhookPath, "", map[string]string{
		paddleSignatureHeader: signPaddle("test-webhook-secret", body, time.Now().Unix()),
	}, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 from plus webhook, got %d: %s", rec.Code, rec.Body.String())
	}

	// Minted license: OZ-PLUS- prefix + plus quota block, no kds.
	keyRec, err := app.FindFirstRecordByData("license_keys", "paddle_sub_id", "sub_plus_e2e_001")
	if err != nil {
		t.Fatalf("plus license key not minted: %v", err)
	}
	keyA := keyRec.GetString("key")
	if !strings.HasPrefix(keyA, "OZ-PLUS-") {
		t.Errorf("expected OZ-PLUS- key prefix, got %q", keyA)
	}
	if emailedKey != keyA {
		t.Errorf("expected receipt email with key %q, got %q", keyA, emailedKey)
	}
	var keyATypes []string
	if err := json.Unmarshal([]byte(keyRec.GetString("allowed_types")), &keyATypes); err != nil {
		t.Fatalf("parse key allowed_types: %v", err)
	}
	assertPlusQuotaBlock(t, keyRec.GetString("tier_key"), keyRec.GetInt("max_stores"), keyRec.GetInt("max_pos_instances"), keyATypes)

	// The signed subscription is persisted with the plus quota block and a
	// ~+1y expiry (the billing period in paddleCreatedBody).
	subRec1, err := app.FindFirstRecordByData("subscriptions", "paddle_sub_id", "sub_plus_e2e_001")
	if err != nil {
		t.Fatalf("plus subscription not persisted: %v", err)
	}
	if subRec1.GetString("status") != "active" {
		t.Errorf("expected sub status active, got %q", subRec1.GetString("status"))
	}
	if !strings.Contains(subRec1.GetString("signed_payload"), `"tier_key":"plus"`) {
		t.Errorf("expected signed payload tier_key plus, got: %s", subRec1.GetString("signed_payload"))
	}
	mintExpiry := subRec1.GetDateTime("expires_at").Time()
	if diff := mintExpiry.Sub(time.Now().UTC().AddDate(1, 0, 0)); diff > 5*time.Minute || diff < -5*time.Minute {
		t.Errorf("minted plus subscription should expire ~+1y, got %v (diff %v)", mintExpiry, diff)
	}

	// ── 2. Activate the minted key → tenant api_key issued ─────────
	actBody := fmt.Sprintf(`{"key":%q,"email":"plusbuyer@example.com","machine_id":"e2emachine00001"}`, keyA)
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

	keyAfterActivate, err := app.FindFirstRecordByData("license_keys", "key", keyA)
	if err != nil || keyAfterActivate.GetString("status") != "activated" {
		t.Fatalf("expected key %q activated, got status %q (err %v)", keyA, keyAfterActivate.GetString("status"), err)
	}

	// ── 3. Second purchase mints a distinct renewal key for the tenant ──
	body2 := paddleCreatedBody("evt_plus_e2e_002", "sub_plus_e2e_002", "cus_plus_e2e_002", "plusbuyer@example.com", "pri_test_plus")
	rec2 := servePost(t, se, paddleWebhookPath, "", map[string]string{
		paddleSignatureHeader: signPaddle("test-webhook-secret", body2, time.Now().Unix()),
	}, body2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("expected 200 from second plus webhook, got %d: %s", rec2.Code, rec2.Body.String())
	}
	keyBRec, err := app.FindFirstRecordByData("license_keys", "paddle_sub_id", "sub_plus_e2e_002")
	if err != nil {
		t.Fatalf("renewal key not minted: %v", err)
	}
	keyB := keyBRec.GetString("key")
	if keyB == keyA || !strings.HasPrefix(keyB, "OZ-PLUS-") {
		t.Fatalf("expected a distinct OZ-PLUS- renewal key, got %q (first %q)", keyB, keyA)
	}

	// ── 4. Renew with the tenant api_key + the new key → +1 year ──
	tenant, err := app.FindFirstRecordByData("tenants", "email", "plusbuyer@example.com")
	if err != nil {
		t.Fatalf("tenant not found: %v", err)
	}
	renewBody := fmt.Sprintf(`{"tenant_id":%q,"key":%q}`, tenant.Id, keyB)
	renewRec := servePost(t, se, "/api/v1/license/renew", "Bearer "+apiKey, nil, renewBody)
	if renewRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from renew, got %d: %s", renewRec.Code, renewRec.Body.String())
	}

	// Renewed payload keeps the plus quota block and appends +1y onto the
	// second webhook subscription (already +1y) → ~2 years from now.
	renPayload := signedPayloadFrom(t, renewRec.Body.Bytes())
	assertPlusQuotaBlock(t, renPayload.TierKey, renPayload.MaxLocations, renPayload.MaxPOSInstances, renPayload.AllowedTypes)
	renExpiry, err := time.Parse(time.RFC3339, renPayload.ExpiresAt)
	if err != nil {
		t.Fatalf("failed to parse renewed expires_at: %v", err)
	}
	if diff := renExpiry.Sub(time.Now().UTC().AddDate(2, 0, 0)); diff > time.Hour || diff < -time.Hour {
		t.Errorf("plus renewal should extend to ~+2y from now, got %v (diff %v)", renExpiry, diff)
	}

	// The renewed subscription record persists the plus quota block too.
	newSubs, err := app.FindRecordsByFilter(
		"subscriptions",
		"tenant_id = {:tenant_id} && status = 'active'",
		"-starts_at", 1, 0,
		map[string]any{"tenant_id": tenant.Id},
	)
	if err != nil || len(newSubs) == 0 {
		t.Fatal("expected an active subscription after renewal")
	}
	newSub := newSubs[0]
	assertPlusQuotaBlock(t, newSub.GetString("tier_key"), newSub.GetInt("max_stores"), newSub.GetInt("max_pos_instances"), mustParseAllowedTypes(t, newSub.GetString("allowed_types")))
}

// mustParseAllowedTypes decodes the persisted allowed_types JSON column.
func mustParseAllowedTypes(t *testing.T, raw string) []string {
	t.Helper()
	var out []string
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		t.Fatalf("parse allowed_types %q: %v", raw, err)
	}
	return out
}

// ── Vertical-bundle minting (C3.2) ───────────────────────────────────

// paddleCreatedBodyBundle is paddleCreatedBody plus a bundle entry inside
// custom_data (what the checkout's openPaddleCheckout embeds).
func paddleCreatedBodyBundle(eventID, subID, customerID, email, priceID, bundle string) string {
	body := paddleCreatedBody(eventID, subID, customerID, email, priceID)
	if bundle == "" {
		return body
	}
	needle := fmt.Sprintf(`"custom_data": {"email": %q}`, email)
	replacement := fmt.Sprintf(`"custom_data": {"email": %q, "bundle": %q}`, email, bundle)
	return strings.Replace(body, needle, replacement, 1)
}

// TestPaddleWebhook_BundleMint drives a bundle purchase over HTTP: a
// subscription.created at the bundle price (custom_data.bundle labels it)
// mints a plus key whose quota block includes kds and persists bundle_id on
// the key + subscription.
func TestPaddleWebhook_BundleMint(t *testing.T) {
	resetPaddleDedup()
	resetRateLimiters()
	setPaddleEnv(t)
	t.Setenv("PADDLE_PRICE_TIERS", "pri_test_plus:plus:year,pri_test_pro:pro:year,pri_test_premium:premium:year,pri_test_bundle:plus:year:restaurant_starter")
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	restore := stubReceiptEmail(t, new(string))
	defer restore()

	body := paddleCreatedBodyBundle("evt_bundle_001", "sub_bundle_001", "cus_bundle_001",
		"bundlebuyer@example.com", "pri_test_bundle", "restaurant_starter")
	rec := servePost(t, se, paddleWebhookPath, "", map[string]string{
		paddleSignatureHeader: signPaddle("test-webhook-secret", body, time.Now().Unix()),
	}, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 from bundle webhook, got %d: %s", rec.Code, rec.Body.String())
	}

	keyRec, err := app.FindFirstRecordByData("license_keys", "paddle_sub_id", "sub_bundle_001")
	if err != nil {
		t.Fatalf("bundle license key not minted: %v", err)
	}
	if keyRec.GetString("bundle_id") != "restaurant_starter" {
		t.Errorf("expected bundle_id=restaurant_starter on key, got %q", keyRec.GetString("bundle_id"))
	}
	if !hasKDS(mustParseAllowedTypes(t, keyRec.GetString("allowed_types"))) {
		t.Errorf("bundle mint must include kds in allowed_types, got %q", keyRec.GetString("allowed_types"))
	}

	subRec, err := app.FindFirstRecordByData("subscriptions", "paddle_sub_id", "sub_bundle_001")
	if err != nil {
		t.Fatalf("bundle subscription not persisted: %v", err)
	}
	if subRec.GetString("bundle_id") != "restaurant_starter" {
		t.Errorf("expected sub bundle_id=restaurant_starter, got %q", subRec.GetString("bundle_id"))
	}
	if !strings.Contains(subRec.GetString("signed_payload"), "kds") {
		t.Errorf("signed payload must carry kds in allowed_types, got: %s", subRec.GetString("signed_payload"))
	}
}

// TestPaddleWebhook_BundleTamperRejected buys the PLAIN plus price but
// claims a bundle in custom_data — the price's bundle segment is
// authoritative, so the event is rejected and no key is minted.
func TestPaddleWebhook_BundleTamperRejected(t *testing.T) {
	resetPaddleDedup()
	resetRateLimiters()
	setPaddleEnv(t)
	t.Setenv("PADDLE_PRICE_TIERS", "pri_test_plus:plus:year,pri_test_pro:pro:year,pri_test_premium:premium:year,pri_test_bundle:plus:year:restaurant_starter")
	app, se := setupDirectApp(t)
	defer app.Cleanup()

	body := paddleCreatedBodyBundle("evt_bundle_tamper", "sub_bundle_tamper", "cus_bundle_tamper",
		"tamper@example.com", "pri_test_plus", "restaurant_starter")
	rec := servePost(t, se, paddleWebhookPath, "", map[string]string{
		paddleSignatureHeader: signPaddle("test-webhook-secret", body, time.Now().Unix()),
	}, body)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 from bundle mismatch, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := app.FindFirstRecordByData("license_keys", "paddle_sub_id", "sub_bundle_tamper"); err == nil {
		t.Fatal("expected NO license key minted for a bundle-claim tamper")
	}
}

// ── Receipt email builder tests ──────────────────────────────────────

func TestBuildReceiptEmail_RFC5322Headers(t *testing.T) {
	msg := buildReceiptEmail(
		"no-reply@ozpos.my.id", "buyer@example.com",
		"OZ-PRO-XXXX-YYYY-ZZZZ", "pro", "2027-01-01T00:00:00Z",
	)
	s := string(msg)

	for _, want := range []string{
		"From: OZ-POS <no-reply@ozpos.my.id>",
		"To: buyer@example.com",
		"Subject: Your OZ-POS license key",
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=utf-8",
		"Date:",
	} {
		if !strings.Contains(s, want) {
			t.Errorf("missing header %q in receipt email", want)
		}
	}
}

func TestBuildReceiptEmail_ContainsLicenseKey(t *testing.T) {
	key := "OZ-PLUS-AAAA-BBBB-CCCC-DDDD"
	msg := buildReceiptEmail("from@test.com", "to@test.com", key, "plus", "2027-06-01T00:00:00Z")
	s := string(msg)

	if !strings.Contains(s, key) {
		t.Error("receipt email must contain the license key")
	}
}

func TestBuildReceiptEmail_ContainsTierAndExpiry(t *testing.T) {
	msg := buildReceiptEmail("from@test.com", "to@test.com", "KEY", "premium", "2028-12-31T23:59:59Z")
	s := string(msg)

	if !strings.Contains(s, "premium") {
		t.Error("receipt email must mention the tier name")
	}
	if !strings.Contains(s, "2028-12-31T23:59:59Z") {
		t.Error("receipt email must contain the expiry date")
	}
}

func TestBuildReceiptEmail_RFC5322LineEndings(t *testing.T) {
	msg := buildReceiptEmail("from@test.com", "to@test.com", "KEY", "plus", "2027-01-01")
	s := string(msg)

	// RFC 5322 requires \r\n line endings in headers.
	lines := strings.Split(s, "\n")
	for i, line := range lines {
		if strings.HasPrefix(line, "From:") || strings.HasPrefix(line, "To:") || strings.HasPrefix(line, "Subject:") {
			if i > 0 && !strings.HasSuffix(lines[i-1], "\r") {
				t.Errorf("header at line %d missing \r before \n (RFC 5322 requires CRLF)", i)
			}
		}
	}
}
