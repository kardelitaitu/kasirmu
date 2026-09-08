package main

// Midtrans payment-notification webhook (Phase 2 of subscription-tiers.md
// §2, ADR #39).
//
// Midtrans POSTs payment notifications to /api/v1/midtrans/webhook for
// every transaction — including each recurring charge of a Subscription API
// subscription. The endpoint verifies the signature_key (SHA512 over
// order_id + status_code + gross_amount + serverkey — Midtrans's documented
// scheme, see docs.midtrans.com/reference/handle-notifications), dedups by
// transaction_id, then provisions/updates the same PocketBase records the
// Paddle webhook does, so the POS sees byte-identical RSA-signed payloads
// regardless of billing provider.
//
// Tier resolution: the checkout embeds tier_key in custom_field1 and the
// buyer email in custom_field2; the handler cross-checks gross_amount
// against the tier's fixed IDR price via MIDTRANS_PRICE_TIERS so a tampered
// amount cannot mint a higher tier. When custom_field1 is absent the amount
// map alone resolves the tier (and plan period).
//
// Failed charges (cancel/expire/deny) move the subscription to
// grace_period with grace_until at the current expires_at — the customer
// keeps access through the paid period, mirroring paddleSetGrace.
//
// Env vars:
//
//	MIDTRANS_SERVER_KEY   (required) — server key for signature verification
//	MIDTRANS_PRICE_TIERS  (required for provisioning) — comma-separated
//	                      "gross_amount:tier_key[:period]" pairs, e.g.
//	                      "149000:plus:month,1490000:plus:year"
//
// The webhook is server-to-server: it does NOT enforce the web CORS
// allowlist (Midtrans sends no Origin) — the signature is the gate.

import (
	"crypto/sha512"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// midtransWebhookPath is the route registered in main.go.
const midtransWebhookPath = "/api/v1/midtrans/webhook"

// midtransDedupTTL keeps a processed transaction_id in memory long enough to
// cover Midtrans's retry window. A restart forgets it; provisioning is
// idempotent anyway (midtrans_sub_id/midtrans_order_id upserts), so a
// re-delivered notification after a restart converges instead of
// duplicating.
const midtransDedupTTL = 24 * time.Hour

// midtransDedupStore remembers processed transaction_ids so Midtrans
// retries are no-ops. Mirrors paddleDedup.
type midtransDedupStore struct {
	mu     sync.Mutex
	events map[string]time.Time
}

var midtransDedup = &midtransDedupStore{events: make(map[string]time.Time)}

// seen records id (if new) and reports whether it was already seen within
// the TTL window. Prunes expired entries on each call so the map stays
// bounded by the retry window rather than growing forever.
func (s *midtransDedupStore) seen(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	wasSeen := false
	if exp, ok := s.events[id]; ok && now.Before(exp) {
		wasSeen = true
	}
	for oldID, exp := range s.events {
		if !now.Before(exp) {
			delete(s.events, oldID)
		}
	}
	if !wasSeen {
		s.events[id] = now.Add(midtransDedupTTL)
	}
	return wasSeen
}

// remember records id unconditionally (used after the dedup gate, so a
// refund notification that reuses the transaction_id never re-enters the
// success path's dedup window as a false duplicate).
func (s *midtransDedupStore) remember(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.events[id] = time.Now().Add(midtransDedupTTL)
}

// resetMidtransDedup clears the dedup map (test hook, mirroring
// resetPaddleDedup).
func resetMidtransDedup() {
	midtransDedup.mu.Lock()
	defer midtransDedup.mu.Unlock()
	midtransDedup.events = make(map[string]time.Time)
}

// ── Payload type ─────────────────────────────────────────────────────

// midtransNotification is the subset of a Midtrans payment notification the
// provisioning logic needs. Unknown fields are ignored (encoding/json) —
// Midtrans recommends a non-strict parse because it adds fields over time.
// custom_field1/2/3/4 are echoed back from the checkout's custom fields:
//
//	custom_field1 = tier_key
//	custom_field2 = buyer email (register-first, same as Paddle's
//	               custom_data.email)
//	custom_field3 = billing period (month/year — cross-checked against
//	               the price-map period, so a tampered cadence can't
//	               drift the expiry; monthly/yearly also accepted)
//	custom_field4 = bundle_id (C3.2 vertical bundles — cross-checked
//	               against the price map, never trusted alone)
type midtransNotification struct {
	TransactionID     string `json:"transaction_id"`
	OrderID           string `json:"order_id"`
	SubscriptionID    string `json:"subscription_id"`
	TransactionStatus string `json:"transaction_status"`
	StatusCode        string `json:"status_code"`
	FraudStatus       string `json:"fraud_status"`
	GrossAmount       string `json:"gross_amount"`
	RefundAmount      string `json:"refund_amount"`
	PaymentType       string `json:"payment_type"`
	SignatureKey      string `json:"signature_key"`
	SettlementTime    string `json:"settlement_time"`
	CustomField1      string `json:"custom_field1"`
	CustomField2      string `json:"custom_field2"`
	CustomField3      string `json:"custom_field3"`
	CustomField4      string `json:"custom_field4"`
}

// ── Signature verification ───────────────────────────────────────────

// midtransServerKey returns the configured server key, or "" when
// MIDTRANS_SERVER_KEY is unset (the endpoint then answers 503).
func midtransServerKey() string {
	return strings.TrimSpace(os.Getenv("MIDTRANS_SERVER_KEY"))
}

// verifyMidtransSignature recomputes the notification's signature_key as
// SHA512(order_id + status_code + gross_amount + serverkey) — Midtrans's
// documented scheme — and compares constant-time. Returns false when the
// secret or signature is missing.
func verifyMidtransSignature(n midtransNotification, secret string) bool {
	if n.SignatureKey == "" || secret == "" {
		return false
	}
	canonical := n.OrderID + n.StatusCode + n.GrossAmount + secret
	sum := sha512.Sum512([]byte(canonical))
	expected := hex.EncodeToString(sum[:])
	return len(n.SignatureKey) == len(expected) &&
		subtle.ConstantTimeCompare([]byte(n.SignatureKey), []byte(expected)) == 1
}

// ── Tier & amount resolution ─────────────────────────────────────────

// midtransPriceTiers parses MIDTRANS_PRICE_TIERS: comma-separated
// "gross_amount:tier_key[:period][:bundle_id]" pairs. The period (default
// "year") is the plan's billing cycle — the recurring charge cadence that
// expiry extends by. The optional bundle_id (C3.2) marks a vertical-bundle
// price: the fixed amount pays for the tier PLUS the bundle, so the webhook
// mints with tierQuotas(tier, bundle) and the checkout charges the same
// amount (e.g. "1740000:plus:year:restaurant_starter").
//
// An unknown bundle id is rejected at parse time rather than no-op'd: a
// typo'd bundle in the map must fail provisioning loudly (webhook 500 +
// Midtrans retry), never silently mint a plain license for a bundle-priced
// amount.
func midtransPriceTiers() (map[string]string, error) {
	v := strings.TrimSpace(os.Getenv("MIDTRANS_PRICE_TIERS"))
	if v == "" {
		return nil, fmt.Errorf("MIDTRANS_PRICE_TIERS is required — without it every Midtrans webhook fails provisioning with 500; set it to comma-separated gross_amount:tier_key[:period][:bundle_id] pairs, e.g. 149000:plus:month,1740000:plus:year:restaurant_starter")
	}
	m := make(map[string]string)
	for _, pair := range strings.Split(v, ",") {
		parts := strings.Split(strings.TrimSpace(pair), ":")
		if len(parts) < 2 || len(parts) > 4 {
			return nil, fmt.Errorf("MIDTRANS_PRICE_TIERS has a malformed entry %q — expected gross_amount:tier_key[:period][:bundle_id] pairs, e.g. 149000:plus:month or 1740000:plus:year:restaurant_starter", strings.TrimSpace(pair))
		}
		amount := normalizeMidtransAmount(parts[0])
		tier := strings.TrimSpace(parts[1])
		if amount == "" || tier == "" {
			return nil, fmt.Errorf("MIDTRANS_PRICE_TIERS has a malformed entry %q — expected gross_amount:tier_key[:period][:bundle_id] pairs", strings.TrimSpace(pair))
		}
		period := "year"
		if len(parts) >= 3 && strings.TrimSpace(parts[2]) != "" {
			period = strings.TrimSpace(parts[2])
		}
		bundle := ""
		if len(parts) == 4 {
			bundle = normalizeBundleID(parts[3])
			if bundle == "" {
				return nil, fmt.Errorf("MIDTRANS_PRICE_TIERS entry %q has an unknown bundle_id %q — recognized bundles: restaurant_starter", strings.TrimSpace(pair), strings.TrimSpace(parts[3]))
			}
		}
		m[amount] = tier + ":" + period + ":" + bundle
	}
	return m, nil
}

// normalizeMidtransAmount canonicalizes Midtrans's gross_amount formatting
// ("149000.00", "149000", "5539") to the integer form the price map is
// keyed by.
func normalizeMidtransAmount(amount string) string {
	a := strings.TrimSpace(amount)
	if i := strings.IndexByte(a, '.'); i >= 0 {
		a = a[:i]
	}
	return strings.TrimLeft(a, "0")
}

// midtransPriceForAmount resolves the price-map entry (tier:period) for a
// gross_amount, or ("", false) when the amount is not mapped — the handler
// then answers 500 so Midtrans retries until the operator fixes the map.
func midtransPriceForAmount(amount string) (string, bool) {
	m, err := midtransPriceTiers()
	if err != nil {
		return "", false
	}
	entry, ok := m[normalizeMidtransAmount(amount)]
	return entry, ok
}

// midtransTierForNotification resolves the tier, period, and bundle for a
// notification. The fixed IDR amount is authoritative: custom_field1 (tier),
// custom_field3 (period), and custom_field4 (bundle, C3.2) set by our
// checkout are cross-checked against the price-map entry, so a tampered
// custom field can never mint a higher tier, a bundle the buyer didn't pay
// for, or a period that drifts the renewal cadence. Falls back to the amount
// map alone when the checkout didn't embed a field.
func midtransTierForNotification(n midtransNotification) (tier, period, bundle string, err error) {
	priceEntry, ok := midtransPriceForAmount(n.GrossAmount)
	if !ok {
		return "", "", "", fmt.Errorf("gross_amount %q is not mapped in MIDTRANS_PRICE_TIERS", n.GrossAmount)
	}
	tier, rest, _ := strings.Cut(priceEntry, ":")
	period, bundle, _ = strings.Cut(rest, ":")
	if cf := strings.TrimSpace(n.CustomField1); cf != "" && cf != tier {
		return "", "", "", fmt.Errorf("custom_field1 tier %q disagrees with price-mapped tier %q for amount %q — rejecting", cf, tier, n.GrossAmount)
	}
	// The period must match the price the buyer actually paid — a renewal
	// charging the yearly amount but claiming a monthly cadence (or vice
	// versa) would otherwise let midtransChargeExpiry extend the wrong
	// interval. The website's monthly/yearly vocabulary is normalized so a
	// legacy charge that embedded it still passes.
	if cf := strings.TrimSpace(n.CustomField3); cf != "" && normalizeMidtransPeriod(cf) != period {
		return "", "", "", fmt.Errorf("custom_field3 period %q disagrees with price-mapped period %q for amount %q — rejecting", cf, period, n.GrossAmount)
	}
	// A bundle claim must match the price the buyer actually paid — paying
	// the plain amount and claiming a bundle in custom_field4 is rejected
	// (the 500 makes Midtrans retry and the operator sees the mismatch).
	if cf := strings.TrimSpace(n.CustomField4); cf != "" && cf != bundle {
		return "", "", "", fmt.Errorf("custom_field4 bundle %q disagrees with price-mapped bundle %q for amount %q — rejecting", cf, bundle, n.GrossAmount)
	}
	return tier, period, bundle, nil
}

// normalizeMidtransPeriod is an alias for the shared normalizeBillingPeriod
// helper, used by the webhook's custom_field3 cross-check. Both the checkout
// (midtransAmountForTier) and the webhook use the same vocabulary normalization
// so they agree on what "monthly" means.
var normalizeMidtransPeriod = normalizeBillingPeriod

// ── Charge status mapping ────────────────────────────────────────────

// midtransChargeSucceeded reports whether the notification is a settled
// charge: status_code 200 + transaction_status settlement/capture + fraud
// accept when present (Midtrans's documented success triple).
func midtransChargeSucceeded(n midtransNotification) bool {
	if n.StatusCode != "200" {
		return false
	}
	switch n.TransactionStatus {
	case "settlement", "capture":
	default:
		return false
	}
	return n.FraudStatus == "" || strings.EqualFold(n.FraudStatus, "accept")
}

// midtransChargeFailed reports whether the notification is a definitive
// failure that should move the subscription to grace.
func midtransChargeFailed(n midtransNotification) bool {
	switch n.TransactionStatus {
	case "cancel", "expire", "deny", "refund", "partial_refund":
		return true
	default:
		return false
	}
}

// ── Webhook handler ──────────────────────────────────────────────────

func handleMidtransWebhook(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		// Cap the body: notifications are small, but an oversized payload
		// must not pin memory (mirrors the other handlers' caps).
		e.Request.Body = http.MaxBytesReader(e.Response, e.Request.Body, 256*1024)
		rawBody, err := io.ReadAll(e.Request.Body)
		if err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "failed to read body"})
		}

		secret := midtransServerKey()
		if secret == "" {
			log.Printf("midtrans webhook: MIDTRANS_SERVER_KEY not configured")
			return e.JSON(http.StatusServiceUnavailable, map[string]any{
				"error": "midtrans webhook is not configured",
			})
		}

		// Non-strict parse: ignore unknown fields (Midtrans adds fields).
		var n midtransNotification
		if err := json.Unmarshal(rawBody, &n); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "malformed JSON"})
		}
		if n.TransactionID == "" {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "missing transaction_id"})
		}
		if !verifyMidtransSignature(n, secret) {
			log.Printf("midtrans webhook: invalid signature (transaction=%s order=%s)", n.TransactionID, n.OrderID)
			return e.JSON(http.StatusUnauthorized, map[string]any{"error": "invalid signature"})
		}
		// Replay protection: only deduplicate SUCCESSFUL charge notifications
		// (settlement / capture).  Refund / cancel / expire / deny
		// notifications reuse the same transaction_id but carry a different
		// status, so they must NOT be treated as duplicates.
		switch {
		case midtransChargeSucceeded(n):
			if midtransDedup.seen(n.TransactionID) {
				log.Printf("midtrans webhook: duplicate transaction_id=%s ignored", n.TransactionID)
				return e.JSON(http.StatusOK, map[string]any{"status": "duplicate"})
			}
			midtransDedup.remember(n.TransactionID)
			if err := midtransProvision(app, n); err != nil {
				log.Printf("midtrans webhook: provisioning failed for transaction=%s: %v", n.TransactionID, err)
				return e.JSON(http.StatusInternalServerError, map[string]any{
					"error": "provisioning failed",
				})
			}
			// Revenue capture (best-effort, logged only).
			midtransCaptureRevenue(app, n)
			return e.JSON(http.StatusOK, map[string]any{"status": "ok"})

		case midtransChargeFailed(n):
			if err := midtransSetGrace(app, n); err != nil {
				log.Printf("midtrans webhook: grace update failed for transaction=%s: %v", n.TransactionID, err)
				return e.JSON(http.StatusInternalServerError, map[string]any{
					"error": "update failed",
				})
			}
			// Revenue adjustment (best-effort): a refund / partial refund
			// reduces the keepable gross — record it so the dashboard can
			// show the operator how much was clawed back.
			midtransCaptureAdjustment(app, n)
			return e.JSON(http.StatusOK, map[string]any{"status": "ok"})

		default:
			// pending / authorize / challenge — acknowledge so Midtrans
			// doesn't retry events that need no action.
			log.Printf("midtrans webhook: transaction_status=%s (transaction=%s) acknowledged",
				n.TransactionStatus, n.TransactionID)
			return e.JSON(http.StatusOK, map[string]any{"status": "ok"})
		}
	}
}

// midtransProvision handles a settled charge: upsert tenant by email, mint
// (or refresh) the license key, and create (or update) the RSA-signed
// subscription — the same records the Paddle webhook writes, so the POS
// sees identical signed payloads. sendReceipt is always true: Midtrans
// charges are buyer-initiated, so every settled charge emails the key once.
func midtransProvision(app core.App, n midtransNotification) error {
	// Resolve the buyer email (register-first checkout embeds it).
	email := strings.TrimSpace(n.CustomField2)
	if email == "" {
		return fmt.Errorf("cannot resolve buyer email for transaction %s (custom_field2 empty — checkout must embed it)", n.OrderID)
	}

	tier, period, bundle, err := midtransTierForNotification(n)
	if err != nil {
		return err
	}

	// ── Upsert tenant by email (shared with the Paddle webhook) ──
	tenant, err := upsertTenantByEmail(app, email, "", "midtrans")
	if err != nil {
		return err
	}

	startsAt := time.Now().UTC().Format(time.RFC3339)
	expiresAt := midtransChargeExpiry(period).Format(time.RFC3339)

	// ── Mint or refresh the license key ───────────────────────
	// Idempotent: keyed by subscription (recurring charges refresh the same
	// key); a first charge without a subscription_id yet is keyed by order.
	keyRecord, err := findMidtransKey(app, n)
	if err != nil {
		keyColl, collErr := app.FindCollectionByNameOrId("license_keys")
		if collErr != nil {
			return fmt.Errorf("license_keys collection not found: %w", collErr)
		}
		key, genErr := generateLicenseKey(tier)
		if genErr != nil {
			return fmt.Errorf("failed to generate license key: %w", genErr)
		}
		keyRecord = core.NewRecord(keyColl)
		keyRecord.Set("key", key)
		keyRecord.Set("tier_key", tier)
		keyRecord.Set("status", "unused")
		keyRecord.Set("expires_at", expiresAt)
		maxStores, maxPOS, allowedTypes := tierQuotas(tier, bundle)
		keyRecord.Set("max_stores", maxStores)
		keyRecord.Set("max_pos_instances", maxPOS)
		if b, err := json.Marshal(allowedTypes); err == nil {
			keyRecord.Set("allowed_types", string(b))
		}
		keyRecord.Set("bundle_id", bundle)
		keyRecord.Set("midtrans_sub_id", n.SubscriptionID)
		keyRecord.Set("midtrans_order_id", n.OrderID)
		keyRecord.Set("payment_provider", "midtrans")
		if saveErr := app.Save(keyRecord); saveErr != nil {
			return fmt.Errorf("failed to save license key for transaction %s: %w", n.OrderID, saveErr)
		}
		log.Printf("midtrans webhook: minted key %q (tier=%s, bundle=%s) for order %s", maskLicenseKey(key), tier, bundle, n.OrderID)
		// Non-fatal: a failed receipt must not fail provisioning.
		if mailErr := sendReceiptEmail(email, key, tier, expiresAt); mailErr != nil {
			log.Printf("midtrans webhook: receipt email to %q failed (non-fatal): %v", email, mailErr)
		}
	} else {
		// Refresh tier/expiry on the existing key (renewal / re-delivery).
		// A recurring-charge notification may not echo custom_field4, so the
		// bundle falls back to what was persisted at mint — a bundle the
		// customer is still paying for must survive renewals. When the price
		// map resolves a bundle for the charged amount it wins (plan change).
		if bundle == "" {
			bundle = keyRecord.GetString("bundle_id")
		}
		keyRecord.Set("tier_key", tier)
		keyRecord.Set("expires_at", expiresAt)
		keyRecord.Set("midtrans_order_id", n.OrderID)
		if saveErr := app.Save(keyRecord); saveErr != nil {
			return fmt.Errorf("failed to refresh license key for order %s: %w", n.OrderID, saveErr)
		}
	}

	// ── Upsert the RSA-signed subscription ────────────────────
	// The signed payload carries the bundle-widened allowed types, so the
	// POS trusts the same payload shape regardless of how the bundle got
	// there (checkout webhook or trial activation).
	maxStores, maxPOS, allowedTypes := tierQuotas(tier, bundle)
	graceUntil := calculateGraceUntil(tier, mustParseTime(expiresAt)).Format(time.RFC3339)
	payload := SubscriptionPayload{
		TenantID:        tenant.Id,
		TierKey:         tier,
		Status:          "active",
		MaxLocations:    maxStores,
		MaxPOSInstances: maxPOS,
		AllowedTypes:    allowedTypes,
		StartsAt:        startsAt,
		ExpiresAt:       expiresAt,
		GraceUntil:      graceUntil,
		IssuedAt:        time.Now().UTC().Format(time.RFC3339),
	}
	// D2: carry any admin-authored per-feature grants into the signed payload.
	payload.Features = featureGrantsForTenant(app, tenant.Id)
	payloadStr, signature, err := signSubscription(payload)
	if err != nil {
		return fmt.Errorf("failed to sign subscription: %w", err)
	}

	subRecord, err := findMidtransSubscription(app, n)
	if err != nil {
		subColl, collErr := app.FindCollectionByNameOrId("subscriptions")
		if collErr != nil {
			return fmt.Errorf("subscriptions collection not found: %w", collErr)
		}
		subRecord = core.NewRecord(subColl)
		subRecord.Set("midtrans_sub_id", n.SubscriptionID)
		subRecord.Set("midtrans_order_id", n.OrderID)
	}
	subRecord.Set("payment_provider", "midtrans")
	subRecord.Set("bundle_id", bundle)
	subRecord.Set("tenant_id", []string{tenant.Id})
	subRecord.Set("tier_key", tier)
	subRecord.Set("status", "active")
	subRecord.Set("starts_at", startsAt)
	subRecord.Set("expires_at", expiresAt)
	subRecord.Set("grace_until", graceUntil)
	subRecord.Set("max_stores", maxStores)
	subRecord.Set("max_pos_instances", maxPOS)
	if b, err := json.Marshal(allowedTypes); err == nil {
		subRecord.Set("allowed_types", string(b))
	}
	subRecord.Set("signed_payload", payloadStr)
	subRecord.Set("signature", signature)
	if err := app.Save(subRecord); err != nil {
		return fmt.Errorf("failed to save subscription for order %s: %w", n.OrderID, err)
	}
	log.Printf("midtrans webhook: provisioned subscription (tier=%s, expires=%s) for order %s", tier, expiresAt, n.OrderID)
	return nil
}

// midtransChargeExpiry extends from the charge time by the plan period
// (Midtrans notifications don't carry the billing period — it lives in the
// price map). Defaults to yearly.
func midtransChargeExpiry(period string) time.Time {
	now := time.Now().UTC()
	switch period {
	case "month":
		return now.AddDate(0, 1, 0)
	case "year":
		return now.AddDate(1, 0, 0)
	default:
		return now.AddDate(1, 0, 0)
	}
}

// findMidtransKey locates the license key a notification refers to: by
// subscription when present (recurring charges share it), else by order.
// Returns an error when neither matches (the caller then mints).
func findMidtransKey(app core.App, n midtransNotification) (*core.Record, error) {
	if n.SubscriptionID != "" {
		if r, err := app.FindFirstRecordByData("license_keys", "midtrans_sub_id", n.SubscriptionID); err == nil {
			return r, nil
		}
	}
	if n.OrderID != "" {
		if r, err := app.FindFirstRecordByData("license_keys", "midtrans_order_id", n.OrderID); err == nil {
			return r, nil
		}
	}
	return nil, fmt.Errorf("no license key for subscription %q / order %q", n.SubscriptionID, n.OrderID)
}

// findMidtransSubscription locates the subscriptions record a notification
// refers to, mirroring findMidtransKey.
func findMidtransSubscription(app core.App, n midtransNotification) (*core.Record, error) {
	if n.SubscriptionID != "" {
		if r, err := app.FindFirstRecordByData("subscriptions", "midtrans_sub_id", n.SubscriptionID); err == nil {
			return r, nil
		}
	}
	if n.OrderID != "" {
		if r, err := app.FindFirstRecordByData("subscriptions", "midtrans_order_id", n.OrderID); err == nil {
			return r, nil
		}
	}
	return nil, fmt.Errorf("no subscription for subscription %q / order %q", n.SubscriptionID, n.OrderID)
}

// midtransSetGrace handles failed charges: the customer keeps access
// through the paid period, so the subscription moves to grace_period with
// grace_until at the current expires_at — mirroring paddleSetGrace.
func midtransSetGrace(app core.App, n midtransNotification) error {
	subRecord, err := findMidtransSubscription(app, n)
	if err != nil {
		log.Printf("midtrans webhook: %s for unknown order=%s (no local record)", n.TransactionStatus, n.OrderID)
		return nil
	}

	graceUntil := subRecord.GetString("expires_at")
	subRecord.Set("status", "grace_period")
	subRecord.Set("grace_until", graceUntil)

	payload := SubscriptionPayload{
		TenantID:        subRecord.GetString("tenant_id"),
		TierKey:         subRecord.GetString("tier_key"),
		Status:          "grace_period",
		MaxLocations:    subRecord.GetInt("max_stores"),
		MaxPOSInstances: subRecord.GetInt("max_pos_instances"),
		AllowedTypes:    parseAllowedTypes(subRecord.GetString("allowed_types")),
		StartsAt:        subRecord.GetString("starts_at"),
		ExpiresAt:       subRecord.GetString("expires_at"),
		GraceUntil:      graceUntil,
		IssuedAt:        time.Now().UTC().Format(time.RFC3339),
	}
	// D2: carry any admin-authored per-feature grants into the signed payload.
	payload.Features = featureGrantsForTenant(app, subRecord.GetString("tenant_id"))
	payloadStr, signature, err := signSubscription(payload)
	if err != nil {
		return fmt.Errorf("failed to sign grace subscription: %w", err)
	}
	subRecord.Set("signed_payload", payloadStr)
	subRecord.Set("signature", signature)
	if err := app.Save(subRecord); err != nil {
		return fmt.Errorf("failed to save grace subscription for order %s: %w", n.OrderID, err)
	}
	log.Printf("midtrans webhook: %s -> grace_period for order %s (grace_until=%s)", n.TransactionStatus, n.OrderID, graceUntil)
	return nil
}

// midtransCaptureRevenue records a settled Midtrans charge as a
// revenue_events row (revenue-data-pipeline-plan.md Phase C). Best-effort:
// failures are logged, never returned (the webhook already 200'd).
func midtransCaptureRevenue(app core.App, n midtransNotification) {
	email := strings.TrimSpace(n.CustomField2)
	if email == "" {
		return
	}
	tenant, err := app.FindFirstRecordByData("tenants", "email", email)
	if err != nil {
		log.Printf("midtrans revenue: tenant not found for email=%s (transaction=%s): %v", email, n.TransactionID, err)
		return
	}
	// LSE-7: gross_amount is parsed to i64 whole rupiah (minor units).
	amountIDRMinor := parseMidtransGrossAmountMinor(n.GrossAmount)
	if amountIDRMinor <= 0 {
		return
	}
	tier, _, _, _ := midtransTierForNotification(n)
	notes := "payment_type=" + n.PaymentType
	if n.SubscriptionID != "" {
		notes += " subscription_id=" + n.SubscriptionID
	}
	saveRevenueEvent(app, revenueEvent{
		Provider:          "midtrans",
		EventID:           n.TransactionID,
		TenantID:          tenant.Id,
		TierKey:           tier,
		NativeAmountMinor: amountIDRMinor,
		NativeCurrency:    "IDR",
		SubscriptionID:    n.SubscriptionID,
		Notes:             notes,
	})
}

// midtransCaptureAdjustment records a Midtrans refund / partial refund as
// a revenue_adjustments row (Phase D of the revenue pipeline). Best-effort:
// failures are logged, never returned (the webhook already 200'd). Only
// genuine claw-backs count — cancel/expire/deny notifications move the
// subscription to grace but never charged, so they must NOT be recorded as
// adjustments.
func midtransCaptureAdjustment(app core.App, n midtransNotification) {
	kind := ""
	switch n.TransactionStatus {
	case "refund":
		kind = "refund"
	case "partial_refund":
		kind = "partial_refund"
	default:
		return // not a claw-back
	}
	// Refund amount: prefer the notification's refund_amount when present,
	// else the full gross (full refunds don't always carry a separate
	// field). A partial refund without a refund_amount can't be quantified
	// honestly — skip it instead of overstating the claw-back.
	amountStr := strings.TrimSpace(n.RefundAmount)
	if amountStr == "" && kind == "partial_refund" {
		log.Printf("midtrans adjustment: partial_refund without refund_amount (transaction=%s) — skipping", n.TransactionID)
		return
	}
	if amountStr == "" {
		amountStr = n.GrossAmount
	}
	amountIDRMinor := parseMidtransGrossAmountMinor(amountStr)
	if amountIDRMinor <= 0 {
		return
	}
	tenantID := ""
	email := strings.TrimSpace(n.CustomField2)
	if email != "" {
		if tenant, err := app.FindFirstRecordByData("tenants", "email", email); err == nil && tenant != nil {
			tenantID = tenant.Id
		}
	}
	notes := "payment_type=" + n.PaymentType
	if n.OrderID != "" {
		notes += " order_id=" + n.OrderID
	}
	if n.SubscriptionID != "" {
		notes += " subscription_id=" + n.SubscriptionID
	}
	saveRevenueAdjustment(app, revenueAdjustment{
		Provider:          "midtrans",
		EventID:           midtransAdjustmentEventID(kind, n.TransactionID),
		TenantID:          tenantID,
		Kind:              kind,
		NativeAmountMinor: amountIDRMinor,
		NativeCurrency:    "IDR",
		Notes:             notes,
	})
}

// verifyMidtransConfig is the boot-time webhook gate (called from main
// before the server starts serving). It fails fast when the Midtrans
// webhook is configured to answer 503/500 on every event instead of
// provisioning purchases — mirroring verifyPaddleConfig.
func verifyMidtransConfig() error {
	if midtransServerKey() == "" {
		log.Printf("WARNING: MIDTRANS_SERVER_KEY not set — Midtrans webhook and Snap checkout are disabled (the server starts without them; set the key to enable Midtrans payments)")
		return nil
	}
	m, err := midtransPriceTiers()
	if err != nil {
		return err
	}
	log.Printf("Midtrans webhook config verified: %d amount→tier mapping(s)", len(m))
	return nil
}
