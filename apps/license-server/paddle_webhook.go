package main

// Paddle Billing webhook endpoint (Phase 4 of website-plan.md).
//
// Paddle sends subscription lifecycle events to POST /api/v1/paddle/webhook.
// The endpoint verifies the Paddle-Signature header (HMAC-SHA256 over
// "ts:rawBody" with the PADDLE_WEBHOOK_SECRET), dedups by event_id (Paddle
// retries non-2xx responses), then provisions/updates the PocketBase
// records the dashboard and POS depend on:
//
//   - upsert the tenants record by email (created at first purchase)
//   - mint a human-readable license key string (license_keys record)
//   - create/update the RSA-signed subscriptions record
//
// The two "keys" are deliberately distinct (see website-plan.md §7): the
// license key the customer types into the POS (a license_keys record) and
// the RSA-signed subscription payload (signed_payload + signature on
// subscriptions). The webhook generates the first and signs the second.
//
// Env vars:
//
//	PADDLE_WEBHOOK_SECRET  (required) — HMAC secret for signature verification
//	PADDLE_PRICE_TIERS     (required for provisioning) — comma-separated
//	                       "price_id:tier_key[:bundle_id]" pairs, e.g.
//	                       "pri_01h7...:pro" or "pri_01h7...:plus:restaurant_starter"
//	PADDLE_API_URL         (default https://api.paddle.com) — customer fetch
//	PADDLE_API_KEY         (optional) — server-side API key used to resolve
//	                       the customer email when it isn't in custom_data
//	PADDLE_WEBHOOK_MAX_AGE (default 5m) — replay window for the ts value
//
// The webhook is server-to-server: it does NOT enforce the web CORS
// allowlist (Paddle sends no Origin header) — the signature is the gate.

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// paddleWebhookPath is the route registered in main.go.
const paddleWebhookPath = "/api/v1/paddle/webhook"

// paddleSignatureHeader is the Paddle-Signature request header carrying
// "ts=<unix>;h1=<hex>" (possibly repeated, space-separated, for key
// rotation).
const paddleSignatureHeader = "Paddle-Signature"

// defaultPaddleMaxAge bounds how old a webhook ts may be before replay
// protection rejects it. Overridable with PADDLE_WEBHOOK_MAX_AGE.
const defaultPaddleMaxAge = 5 * time.Minute

// paddleDedupTTL keeps a processed event_id in memory long enough to cover
// Paddle's retry window (24h). A restart forgets it; provisioning is
// idempotent anyway (paddle_sub_id upserts), so a re-delivered event after
// a restart converges instead of duplicating.
const paddleDedupTTL = 24 * time.Hour

// ── Event dedup ──────────────────────────────────────────────────────

// paddleDedupStore remembers processed event_ids so Paddle retries are
// no-ops. Mirrors the otpStore pattern (in-memory, bounded by TTL).
type paddleDedupStore struct {
	mu     sync.Mutex
	events map[string]time.Time
}

var paddleDedup = &paddleDedupStore{events: make(map[string]time.Time)}

// seen records eventID (if new) and reports whether it was already seen
// within the TTL window. Prunes expired entries on each call so the map
// stays bounded by the retry window rather than growing forever.
func (s *paddleDedupStore) seen(eventID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	if exp, ok := s.events[eventID]; ok && now.Before(exp) {
		return true
	}
	for id, exp := range s.events {
		if !now.Before(exp) {
			delete(s.events, id)
		}
	}
	s.events[eventID] = now.Add(paddleDedupTTL)
	return false
}

// resetPaddleDedup clears the dedup map (test hook, mirroring
// resetRateLimiters).
func resetPaddleDedup() {
	paddleDedup.mu.Lock()
	defer paddleDedup.mu.Unlock()
	paddleDedup.events = make(map[string]time.Time)
}

// ── Payload types ────────────────────────────────────────────────────

// paddleEvent is the envelope Paddle sends for every webhook. Data is kept
// raw so the handler can dispatch without decoding fields it doesn't need.
type paddleEvent struct {
	EventID   string          `json:"event_id"`
	EventType string          `json:"event_type"`
	Data      json.RawMessage `json:"data"`
}

// paddleSubscription is the subset of the Paddle Billing subscription
// entity the provisioning logic needs. All times are RFC 3339 strings.
//
// custom_data echoes back what the website's checkout (paddle.ts
// Paddle.Checkout.open) embedded at purchase — the register-first account
// email plus the optional C3.2 vertical bundle:
//
//	custom_data.email  = buyer email (register-first, the webhook upserts
//	                     the tenant by it — same as Midtrans's
//	                     custom_field2)
//	custom_data.bundle = bundle_id (C3.2 vertical bundles — cross-checked
//	                     against the price map, never trusted alone)
//
// The signup vertical is NOT carried here (trial segmentation is a
// desktop-activation concern — see trial_vertical in activate.go), and
// custom_data.phone may be present when the Paddle checkout collects it
// (backfilled onto the tenant when non-empty).
type paddleSubscription struct {
	ID         string            `json:"id"`
	Status     string            `json:"status"`
	CustomerID string            `json:"customer_id"`
	CustomData map[string]string `json:"custom_data"`
	Customer   *paddleCustomer   `json:"customer"`
	Items      []struct {
		Price struct {
			ID        string `json:"id"`
			ProductID string `json:"product_id"`
		} `json:"price"`
		Quantity int `json:"quantity"`
	} `json:"items"`
	CurrentBillingPeriod *struct {
		StartsAt string `json:"starts_at"`
		EndsAt   string `json:"ends_at"`
	} `json:"current_billing_period"`
	BillingCycle *struct {
		Interval  string `json:"interval"`
		Frequency int    `json:"frequency"`
	} `json:"billing_cycle"`
	ScheduledChange *struct {
		EffectiveAt string `json:"effective_at"`
		Status      string `json:"status"`
	} `json:"scheduled_change"`
	CreatedAt string `json:"created_at"`
}

// paddleCustomer is only populated on payloads that embed the customer
// entity (not the subscription default — most events carry customer_id
// only and require the API fetch below).
type paddleCustomer struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}

// ── Signature verification ───────────────────────────────────────────

// paddleWebhookSecret returns the configured HMAC secret, or "" when
// PADDLE_WEBHOOK_SECRET is unset (the endpoint then answers 503).
func paddleWebhookSecret() string {
	return strings.TrimSpace(os.Getenv("PADDLE_WEBHOOK_SECRET"))
}

// paddleMaxAge returns the replay window (PADDLE_WEBHOOK_MAX_AGE, default
// 5 minutes).
func paddleMaxAge() time.Duration {
	v := strings.TrimSpace(os.Getenv("PADDLE_WEBHOOK_MAX_AGE"))
	if v == "" {
		return defaultPaddleMaxAge
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		log.Printf("paddle webhook: invalid PADDLE_WEBHOOK_MAX_AGE=%q (using default %v): %v",
			v, defaultPaddleMaxAge, err)
		return defaultPaddleMaxAge
	}
	return d
}

// verifyPaddleSignature checks the Paddle-Signature header against the
// raw request body. Header format: "ts=<unix>;h1=<hex>" with additional
// signature groups space-separated (Paddle emits one group per secret
// during key rotation). Each group is verified independently: a single
// matching (ts, h1) pair within the replay window validates the request.
func verifyPaddleSignature(header string, rawBody []byte, secret string) bool {
	if header == "" || secret == "" {
		return false
	}
	now := time.Now().Unix()
	maxAge := paddleMaxAge()

	for _, group := range strings.Fields(header) {
		var ts string
		var h1s []string
		for _, pair := range strings.Split(group, ";") {
			k, v, ok := strings.Cut(pair, "=")
			if !ok {
				continue
			}
			switch k {
			case "ts":
				ts = v
			case "h1":
				h1s = append(h1s, v)
			}
		}
		if ts == "" || len(h1s) == 0 {
			continue
		}
		tsInt, err := strconv.ParseInt(ts, 10, 64)
		if err != nil {
			continue
		}
		// Replay window: reject timestamps too far in the past (or future).
		delta := now - tsInt
		if delta < 0 {
			delta = -delta
		}
		if delta > int64(maxAge.Seconds()) {
			continue
		}
		signed := ts + ":" + string(rawBody)
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write([]byte(signed))
		expected := hex.EncodeToString(mac.Sum(nil))
		for _, h1 := range h1s {
			if len(h1) == len(expected) &&
				subtle.ConstantTimeCompare([]byte(h1), []byte(expected)) == 1 {
				return true
			}
		}
	}
	return false
}

// ── Email resolution ─────────────────────────────────────────────────

// fetchPaddleCustomer is a package-level var so tests can stub the Paddle
// API call. Production impl: fetchPaddleCustomerHTTP.
var fetchPaddleCustomer = fetchPaddleCustomerHTTP

// fetchPaddleCustomerHTTP resolves a customer's email from the Paddle
// Billing API (GET /customers/{id}) using PADDLE_API_KEY. Returns "" when
// the API key is unset, the customer is not found, or the call fails.
func fetchPaddleCustomerHTTP(customerID string) string {
	apiKey := strings.TrimSpace(os.Getenv("PADDLE_API_KEY"))
	if apiKey == "" || customerID == "" {
		return ""
	}
	base := strings.TrimRight(os.Getenv("PADDLE_API_URL"), "/")
	if base == "" {
		base = "https://api.paddle.com"
	}
	req, err := http.NewRequest(http.MethodGet, base+"/customers/"+customerID, nil)
	if err != nil {
		log.Printf("paddle webhook: customer fetch request build failed for %q: %v", customerID, err)
		return ""
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("paddle webhook: customer fetch failed for %q: %v", customerID, err)
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		log.Printf("paddle webhook: customer fetch %s -> %d for %q", base, resp.StatusCode, customerID)
		return ""
	}
	var out struct {
		Data paddleCustomer `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64*1024)).Decode(&out); err != nil {
		log.Printf("paddle webhook: customer fetch decode failed for %q: %v", customerID, err)
		return ""
	}
	return strings.TrimSpace(strings.ToLower(out.Data.Email))
}

// resolvePaddleEmail finds the customer email for a subscription event:
// custom_data.email (set at checkout) → embedded customer entity (defensive)
// → Paddle API fetch. Returns "" when unresolvable.
func resolvePaddleEmail(sub *paddleSubscription) string {
	if e := strings.TrimSpace(strings.ToLower(sub.CustomData["email"])); e != "" {
		return e
	}
	if sub.Customer != nil {
		if e := strings.TrimSpace(strings.ToLower(sub.Customer.Email)); e != "" {
			return e
		}
	}
	if e := strings.TrimSpace(strings.ToLower(fetchPaddleCustomer(sub.CustomerID))); e != "" {
		return e
	}
	return ""
}

// ── Tier mapping ─────────────────────────────────────────────────────

// paddlePriceTiers parses PADDLE_PRICE_TIERS
// ("pri_x:pro:year,pri_y:premium:month[:bundle_id]") into a
// price→"tier:period:bundle" map. The period ("month" or "year") is the
// billing cycle the price represents — the webhook cross-checks it
// against the subscription's billing_cycle.interval so a tampered
// interval can't drift the expiry cadence (mirroring the Midtrans
// custom_field3 period cross-check). The optional bundle_id (C3.2)
// marks a vertical-bundle price: the buyer pays for the tier PLUS the
// bundle, so the webhook mints with tierQuotas(tier, bundle).
//
// Backward compatibility: entries with only 2 parts (price_id:tier_key)
// default period to "year" — the legacy format before the period
// cross-check shipped.
//
// Returns an error for an unset or malformed value so the boot gate
// (verifyPaddleConfig) fails fast instead of letting every subscription
// event 500 during provisioning.
func paddlePriceTiers() (map[string]string, error) {
	v := strings.TrimSpace(os.Getenv("PADDLE_PRICE_TIERS"))
	if v == "" {
		return nil, fmt.Errorf("PADDLE_PRICE_TIERS is required — without it every subscription webhook fails provisioning with 500; set it to comma-separated price_id:tier_key:period[:bundle_id] pairs, e.g. pri_01h7abc123:pro:year or pri_01h7xyz789:plus:month:restaurant_starter")
	}
	m := make(map[string]string)
	for _, pair := range strings.Split(v, ",") {
		parts := strings.Split(strings.TrimSpace(pair), ":")
		if len(parts) < 2 || len(parts) > 4 {
			return nil, fmt.Errorf("PADDLE_PRICE_TIERS has a malformed entry %q — expected price_id:tier_key:period[:bundle_id] pairs, e.g. pri_01h7abc123:pro:year", strings.TrimSpace(pair))
		}
		k := strings.TrimSpace(parts[0])
		tier := strings.TrimSpace(parts[1])
		if k == "" || tier == "" {
			return nil, fmt.Errorf("PADDLE_PRICE_TIERS has a malformed entry %q — expected price_id:tier_key:period[:bundle_id] pairs", strings.TrimSpace(pair))
		}
		// Period defaults to "year" for backward-compatible 2-part entries.
		period := "year"
		if len(parts) >= 3 && strings.TrimSpace(parts[2]) != "" {
			period = strings.TrimSpace(parts[2])
		}
		bundle := ""
		if len(parts) == 4 {
			bundle = normalizeBundleID(parts[3])
			if bundle == "" {
				return nil, fmt.Errorf("PADDLE_PRICE_TIERS entry %q has an unknown bundle_id %q — recognized bundles: restaurant_starter", strings.TrimSpace(pair), strings.TrimSpace(parts[3]))
			}
		}
		m[k] = tier + ":" + period + ":" + bundle
	}
	return m, nil
}

// paddleTierForPrice maps a Paddle price id to (tier, period, bundle) via
// PADDLE_PRICE_TIERS. Returns ("", "", "", false) when the price is not in
// the map — the handler then answers 500 so Paddle retries until the
// operator fixes the map. Env is re-read per call so a redeploy can fix it.
func paddleTierForPrice(priceID string) (string, string, string, bool) {
	if priceID == "" {
		return "", "", "", false
	}
	m, err := paddlePriceTiers()
	if err != nil {
		return "", "", "", false
	}
	entry, ok := m[priceID]
	if !ok {
		return "", "", "", false
	}
	tier, rest, _ := strings.Cut(entry, ":")
	period, bundle, _ := strings.Cut(rest, ":")
	return tier, period, bundle, true
}

// verifyPaddleConfig is the boot-time webhook gate (called from main
// before the server starts serving). It fails fast when the Paddle
// webhook is configured to answer 503/500 on every event instead of
// provisioning purchases:
//
//   - PADDLE_WEBHOOK_SECRET unset → hard error: every event answers 503
//     and Paddle retries forever.
//   - PADDLE_PRICE_TIERS unset or malformed → hard error: every
//     subscription event 500s during provisioning.
//
// Both values are still read per-request afterwards, so a redeploy with
// fixed env is enough to recover.
func verifyPaddleConfig() error {
	if paddleWebhookSecret() == "" {
		return fmt.Errorf("PADDLE_WEBHOOK_SECRET is required — without it every Paddle webhook answers 503 and Paddle retries forever; set it to the endpoint secret from Paddle → Developer tools → Notifications → Edit destination")
	}
	m, err := paddlePriceTiers()
	if err != nil {
		return err
	}
	log.Printf("Paddle webhook config verified: %d price→tier mapping(s)", len(m))
	return nil
}

// tierQuotas returns the subscription quota block for a tier, mirroring
// the plan's product table and maxMachinesForTier semantics. 0 = unlimited.
// bundle is an optional vertical-bundle id (subscription-tiers.md §3,
// C3.2): "restaurant_starter" unlocks the kds workspace type at the Plus
// tier (bundles are Plus+ per §3 — Pro+ already includes kds, so a bundle
// only ever widens Plus). Webhook minting passes the bundle from the
// checkout when the website leg ships; activation passes the request's
// normalized bundle_id.
func tierQuotas(tier, bundle string) (maxStores, maxPOSInstances int, allowedTypes []string) {
	all := []string{"restaurant-pos", "store-pos", "inventory", "warehouse", "admin", "kds"}
	switch tier {
	case "enterprise":
		return 0, 0, all // unlimited stores/instances, all workspace types
	case "pro":
		return 2, 5, all
	case "premium":
		// C4.2: Premium allows up to 5 stores self-serve; >5 requires
		// Enterprise contract. Unlimited instances and all workspace types.
		return 5, 0, all
	case "plus":
		// 1 store, 2 registers/store, no kds (§3 Workspace Types — kds is Pro+).
		// maxWarehouses is enforced client-side via SubscriptionTier::max_warehouses().
		types := []string{"restaurant-pos", "store-pos", "admin", "inventory", "warehouse"}
		if bundle == "restaurant_starter" {
			types = append(types, "kds")
		}
		return 1, 2, types
	case "free":
		return 1, 1, []string{"restaurant-pos", "store-pos", "admin"}
	default:
		return 1, 1, []string{"restaurant-pos", "store-pos", "admin"}
	}
}

// ── License key minting ──────────────────────────────────────────────

// licenseKeyAlphabet excludes confusable characters (0/O, 1/I) so a key
// typed by hand is unambiguous.
const licenseKeyAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// generateLicenseKey returns a human-readable key in the form
// OZ-<TIER>-XXXX-XXXX-XXXX-XXXX using crypto/rand. The TIER segment is
// uppercased; uniqueness is enforced by the license_keys unique index.
func generateLicenseKey(tier string) (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("crypto/rand.Read failed: %w", err)
	}
	alphabet := []byte(licenseKeyAlphabet)
	var sb strings.Builder
	sb.WriteString("OZ-")
	sb.WriteString(strings.ToUpper(tier))
	for i := 0; i < 16; i++ {
		if i%4 == 0 {
			sb.WriteByte('-')
		}
		sb.WriteByte(alphabet[int(b[i])%len(alphabet)])
	}
	return sb.String(), nil
}

// ── Status mapping ───────────────────────────────────────────────────

// mapPaddleStatus converts a Paddle Billing subscription status to the
// local subscriptions.status vocabulary. Returns ("", false) for statuses
// the handler should not persist.
func mapPaddleStatus(paddle string) (string, bool) {
	switch paddle {
	case "active", "trialing", "past_due":
		return "active", true
	case "paused":
		// Deliberately paused — treat as grace so existing activations
		// keep working through the paid period while no new value accrues.
		return "grace_period", true
	case "canceled":
		return "grace_period", true
	default:
		return "", false
	}
}

// ── Receipt email ────────────────────────────────────────────────────

// sendReceiptEmail is a package-level var so tests can stub delivery
// (mirrors sendOTPEmail in web_otp.go). Production impl: net/smtp.
var sendReceiptEmail = sendReceiptEmailSMTP

// sendReceiptEmailSMTP emails the customer their license key after a
// successful Paddle purchase, using the same OZ_SMTP_* config as the OTP
// sender. Non-fatal at the call site: provisioning must not fail because
// email delivery hiccuped (the key is also visible in the dashboard).
func sendReceiptEmailSMTP(to, licenseKey, tier, expiresAt string) error {
	host := strings.TrimSpace(os.Getenv("OZ_SMTP_HOST"))
	if host == "" {
		return fmt.Errorf("OZ_SMTP_HOST is not configured")
	}
	port := strings.TrimSpace(os.Getenv("OZ_SMTP_PORT"))
	if port == "" {
		port = "587"
	}
	user := os.Getenv("OZ_SMTP_USER")
	password := os.Getenv("OZ_SMTP_PASSWORD")
	from := strings.TrimSpace(os.Getenv("OZ_SMTP_FROM"))
	if from == "" {
		from = "no-reply@ozpos.my.id"
	}

	msg := buildReceiptEmail(from, to, licenseKey, tier, expiresAt)
	return sendMailSMTP(host, port, user, password, from, []string{to}, msg)
}

// buildReceiptEmail renders the plain-text license-key receipt email
// (RFC 5322 message bytes).
func buildReceiptEmail(from, to, licenseKey, tier, expiresAt string) []byte {
	subject := "Your OZ-POS license key"
	body := fmt.Sprintf(
		"Thank you for purchasing OZ-POS %s!\n\n"+
			"Your license key is:\n\n%s\n\n"+
			"It is valid until %s. Activate it in the OZ-POS desktop app "+
			"(Settings → License) with the email address you used to purchase.\n\n"+
			"You can also view your subscription at any time from the account page on our website.\n",
		tier, licenseKey, expiresAt)

	var sb strings.Builder
	fmt.Fprintf(&sb, "From: OZ-POS <%s>\r\n", from)
	fmt.Fprintf(&sb, "To: %s\r\n", to)
	fmt.Fprintf(&sb, "Subject: %s\r\n", subject)
	sb.WriteString("MIME-Version: 1.0\r\n")
	sb.WriteString("Content-Type: text/plain; charset=utf-8\r\n")
	fmt.Fprintf(&sb, "Date: %s\r\n", time.Now().UTC().Format(time.RFC1123Z))
	sb.WriteString("\r\n")
	sb.WriteString(body)
	return []byte(sb.String())
}

// ── Handler ──────────────────────────────────────────────────────────

// handlePaddleWebhook implements POST /api/v1/paddle/webhook.
//
// Response contract (Paddle retries non-2xx):
//
//   - 401: missing/tampered signature or stale ts (never disclose why)
//   - 503: PADDLE_WEBHOOK_SECRET not configured
//   - 400: malformed JSON, missing event_id, or missing subscription id
//   - 500: provisioning failure (unmapped price, unresolvable email, DB
//     error) — Paddle retries until the operator fixes the config
//   - 200: processed (or deliberately acknowledged + logged)
func handlePaddleWebhook(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		// Cap the body: Paddle subscription entities can be a few tens of
		// KB, but an oversized payload must not pin memory (mirrors the
		// other handlers' MaxBytesReader caps).
		e.Request.Body = http.MaxBytesReader(e.Response, e.Request.Body, 256*1024)
		rawBody, err := io.ReadAll(e.Request.Body)
		if err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "failed to read body"})
		}

		secret := paddleWebhookSecret()
		if secret == "" {
			log.Printf("paddle webhook: PADDLE_WEBHOOK_SECRET not configured")
			return e.JSON(http.StatusServiceUnavailable, map[string]any{
				"error": "paddle webhook is not configured",
			})
		}
		if !verifyPaddleSignature(e.Request.Header.Get(paddleSignatureHeader), rawBody, secret) {
			log.Printf("paddle webhook: invalid signature (len=%d)", len(rawBody))
			return e.JSON(http.StatusUnauthorized, map[string]any{
				"error": "invalid signature",
			})
		}

		var ev paddleEvent
		if err := json.Unmarshal(rawBody, &ev); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "malformed JSON"})
		}
		if ev.EventID == "" {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "missing event_id"})
		}
		// Replay protection: a duplicated event (Paddle retry) is a no-op.
		if paddleDedup.seen(ev.EventID) {
			log.Printf("paddle webhook: duplicate event_id=%s (%s) ignored", ev.EventID, ev.EventType)
			return e.JSON(http.StatusOK, map[string]any{"status": "duplicate"})
		}

		switch ev.EventType {
		case "subscription.created", "subscription.activated", "subscription.trialing":
			if err := paddleProvision(app, ev, ev.EventType == "subscription.created"); err != nil {
				log.Printf("paddle webhook: %s failed for event=%s: %v", ev.EventType, ev.EventID, err)
				return e.JSON(http.StatusInternalServerError, map[string]any{
					"error": "provisioning failed",
				})
			}
			return e.JSON(http.StatusOK, map[string]any{"status": "ok"})

		case "subscription.updated":
			if err := paddleUpdate(app, ev); err != nil {
				log.Printf("paddle webhook: subscription.updated failed for event=%s: %v", ev.EventID, err)
				return e.JSON(http.StatusInternalServerError, map[string]any{
					"error": "update failed",
				})
			}
			return e.JSON(http.StatusOK, map[string]any{"status": "ok"})

		case "subscription.canceled", "subscription.paused":
			if err := paddleSetGrace(app, ev); err != nil {
				log.Printf("paddle webhook: %s failed for event=%s: %v", ev.EventType, ev.EventID, err)
				return e.JSON(http.StatusInternalServerError, map[string]any{
					"error": "update failed",
				})
			}
			return e.JSON(http.StatusOK, map[string]any{"status": "ok"})

		case "subscription.resumed":
			if err := paddleResume(app, ev); err != nil {
				log.Printf("paddle webhook: subscription.resumed failed for event=%s: %v", ev.EventID, err)
				return e.JSON(http.StatusInternalServerError, map[string]any{
					"error": "update failed",
				})
			}
			return e.JSON(http.StatusOK, map[string]any{"status": "ok"})

		case "subscription.past_due":
			// Payment failed but the subscription is still within Paddle's
			// retry window — keep licensing active and flag for follow-up.
			log.Printf("paddle webhook: subscription.past_due event=%s (subscription=%s) — flag for follow-up",
				ev.EventID, string(ev.Data))
			return e.JSON(http.StatusOK, map[string]any{"status": "ok"})

		case "transaction.completed", "transaction.payment_failed":
			// Record revenue for completed transactions (skip payment_failed).
			if ev.EventType == "transaction.completed" {
				paddleCaptureRevenue(app, ev)
			}
			log.Printf("paddle webhook: %s event=%s acknowledged", ev.EventType, ev.EventID)
			return e.JSON(http.StatusOK, map[string]any{"status": "ok"})

		case "transaction.revoked", "transaction.refunded":
			// A revoked / refunded transaction claws back previously captured
			// gross — record the adjustment so the dashboard can show it.
			paddleCaptureAdjustment(app, ev, "refund")
			log.Printf("paddle webhook: %s event=%s acknowledged", ev.EventType, ev.EventID)
			return e.JSON(http.StatusOK, map[string]any{"status": "ok"})

		case "subscription.payment_refunded":
			// Paddle sends this when a subscription payment is refunded.
			paddleSubscriptionRefundAdjustment(app, ev)
			log.Printf("paddle webhook: %s event=%s acknowledged", ev.EventType, ev.EventID)
			return e.JSON(http.StatusOK, map[string]any{"status": "ok"})

		default:
			// customer.*, address.*, discount.*, etc. — acknowledge so
			// Paddle doesn't retry events we deliberately don't process.
			log.Printf("paddle webhook: event_type=%s event=%s acknowledged", ev.EventType, ev.EventID)
			return e.JSON(http.StatusOK, map[string]any{"status": "ok"})
		}
	}
}

// parsePaddleSubscription decodes the event data as a subscription entity.
func parsePaddleSubscription(ev paddleEvent) (*paddleSubscription, error) {
	var sub paddleSubscription
	if err := json.Unmarshal(ev.Data, &sub); err != nil {
		return nil, fmt.Errorf("failed to decode subscription entity: %w", err)
	}
	if sub.ID == "" {
		return nil, fmt.Errorf("subscription entity has no id")
	}
	return &sub, nil
}

// paddleTransaction is the subset of the Paddle Billing transaction entity
// used to record a revenue event on transaction.completed. Amounts are in
// minor units (cents for USD); currency_code is ISO 4217.
type paddleTransaction struct {
	ID             string `json:"id"`
	Status         string `json:"status"`
	CurrencyCode   string `json:"currency_code"`
	CustomerID     string `json:"customer_id"`
	SubscriptionID string `json:"subscription_id"`
	CreatedAt      string `json:"created_at"`
	Items          []struct {
		Price struct {
			ID        string `json:"id"`
			ProductID string `json:"product_id"`
		} `json:"price"`
		Totals *struct {
			Subtotal int64 `json:"subtotal"`
			Total    int64 `json:"total"`
			Tax      int64 `json:"tax"`
		} `json:"totals"`
	} `json:"items"`
	Totals *struct {
		Subtotal   int64 `json:"subtotal"`
		Total      int64 `json:"total"`
		Tax        int64 `json:"tax"`
		GrandTotal int64 `json:"grand_total"`
	} `json:"totals"`
	CustomData map[string]string `json:"custom_data"`
	Customer   *paddleCustomer   `json:"customer"`
}

// parsePaddleTransaction decodes the event data as a transaction entity.
func parsePaddleTransaction(ev paddleEvent) (*paddleTransaction, error) {
	var txn paddleTransaction
	if err := json.Unmarshal(ev.Data, &txn); err != nil {
		return nil, fmt.Errorf("failed to decode transaction entity: %w", err)
	}
	if txn.ID == "" {
		return nil, fmt.Errorf("transaction entity has no id")
	}
	return &txn, nil
}

// paddleTransactionTotalCents returns the charged amount in minor units
// (grand_total at transaction level, else sum of item totals, else 0).
func paddleTransactionTotalCents(txn *paddleTransaction) int64 {
	if txn.Totals != nil {
		if txn.Totals.GrandTotal > 0 {
			return txn.Totals.GrandTotal
		}
		if txn.Totals.Total > 0 {
			return txn.Totals.Total
		}
	}
	var sum int64
	for _, it := range txn.Items {
		if it.Totals != nil && it.Totals.Total > 0 {
			sum += it.Totals.Total
		}
	}
	return sum
}

// paddleTransactionTier resolves the tier for a transaction from its price
// ids against the PADDLE_PRICE_TIERS map (may be empty for one-off items).
func paddleTransactionTier(txn *paddleTransaction) string {
	tiers, err := paddlePriceTiers()
	if err != nil || len(tiers) == 0 {
		return ""
	}
	for _, it := range txn.Items {
		if val, ok := tiers[it.Price.ID]; ok {
			// Map value is "tier:period:bundle" — split to get the tier.
			parts := strings.SplitN(val, ":", 2)
			if len(parts) >= 1 && parts[0] != "" {
				return parts[0]
			}
		}
	}
	return ""
}

// paddleCaptureRevenue parses a transaction.completed event and records
// the payment as a revenue_events record. Best-effort: failures are logged
// but never returned (the webhook already acknowledged the event).
func paddleCaptureRevenue(app core.App, ev paddleEvent) {
	txn, err := parsePaddleTransaction(ev)
	if err != nil {
		log.Printf("paddle revenue: failed to parse transaction: %v", err)
		return
	}
	if txn.Status != "completed" {
		return
	}
	// Resolve the buyer email (custom_data > customer entity).
	email := ""
	if e := strings.TrimSpace(strings.ToLower(txn.CustomData["email"])); e != "" {
		email = e
	} else if txn.Customer != nil {
		email = strings.TrimSpace(strings.ToLower(txn.Customer.Email))
	}
	if email == "" {
		log.Printf("paddle revenue: no email for transaction=%s", txn.ID)
		return
	}
	tenant, err := app.FindFirstRecordByData("tenants", "email", email)
	if err != nil {
		log.Printf("paddle revenue: tenant not found for email=%s (transaction=%s): %v", email, txn.ID, err)
		return
	}
	// LSE-7: Paddle totals already arrive as USD cents (i64) — pass the
	// minor units straight through instead of converting to float dollars.
	cents := paddleTransactionTotalCents(txn)
	notes := ""
	if txn.SubscriptionID != "" {
		notes = "subscription_id=" + txn.SubscriptionID
	}
	saveRevenueEvent(app, revenueEvent{
		Provider:          "paddle",
		EventID:           ev.EventID,
		TenantID:          tenant.Id,
		TierKey:           paddleTransactionTier(txn),
		NativeAmountMinor: cents,
		NativeCurrency:    "USD",
		SubscriptionID:    txn.SubscriptionID,
		Notes:             notes,
	})
}

// paddleCaptureAdjustment records a revoked/refunded Paddle transaction as
// a revenue_adjustments row. Best-effort: failures are logged, never
// returned (the webhook already acknowledged the event).
func paddleCaptureAdjustment(app core.App, ev paddleEvent, kind string) {
	txn, err := parsePaddleTransaction(ev)
	if err != nil {
		log.Printf("paddle adjustment: failed to parse transaction: %v", err)
		return
	}
	// Resolve the buyer email (custom_data > customer entity).
	email := ""
	if e := strings.TrimSpace(strings.ToLower(txn.CustomData["email"])); e != "" {
		email = e
	} else if txn.Customer != nil {
		email = strings.TrimSpace(strings.ToLower(txn.Customer.Email))
	}
	tenantID := ""
	if email != "" {
		if tenant, terr := app.FindFirstRecordByData("tenants", "email", email); terr == nil && tenant != nil {
			tenantID = tenant.Id
		}
	}
	cents := paddleTransactionTotalCents(txn)
	if cents <= 0 {
		log.Printf("paddle adjustment: no positive total for event=%s", ev.EventID)
		return
	}
	notes := ""
	if txn.SubscriptionID != "" {
		notes = "subscription_id=" + txn.SubscriptionID
	}
	saveRevenueAdjustment(app, revenueAdjustment{
		Provider:          "paddle",
		EventID:           ev.EventID,
		TenantID:          tenantID,
		Kind:              kind,
		NativeAmountMinor: cents,
		NativeCurrency:    "USD",
		Notes:             notes,
	})
}

// paddleSubscriptionRefundAdjustment handles subscription.payment_refunded:
// the payload is a subscription entity with items, not a transaction, so it
// is parsed separately and the refund amount approximated from the item
// price totals. Best-effort.
func paddleSubscriptionRefundAdjustment(app core.App, ev paddleEvent) {
	var sub struct {
		ID         string `json:"id"`
		CustomerID string `json:"customer_id"`
		Items      []struct {
			Price struct {
				ID string `json:"id"`
			} `json:"price"`
			Quantity int `json:"quantity"`
		} `json:"items"`
	}
	if err := json.Unmarshal(ev.Data, &sub); err != nil || sub.ID == "" {
		log.Printf("paddle adjustment: failed to decode subscription refund payload: %v", err)
		return
	}
	// Sum the item price amounts via the price-map tiers map (value is
	// "tier:period:bundle" — no amount), so fall back to a search of the
	// subscriptions record for the tier price. Simplest robust source: the
	// local subscription record's tier_key → TierPriceUSD.
	var cents int64
	var tier string
	tiers, terr := paddlePriceTiers()
	if terr == nil {
		for _, it := range sub.Items {
			if val, ok := tiers[it.Price.ID]; ok {
				parts := strings.SplitN(val, ":", 2)
				if len(parts) >= 1 && parts[0] != "" {
					tier = parts[0]
					break
				}
			}
		}
	}
	if tier != "" {
		if price, ok := TierPriceUSD[tier]; ok {
			cents = int64(price * 100)
		}
	}
	if cents <= 0 {
		// Fall back to the local subscription record.
		if subRec, err := app.FindFirstRecordByData("subscriptions", "paddle_sub_id", sub.ID); err == nil {
			tier = subRec.GetString("tier_key")
			if price, ok := TierPriceUSD[tier]; ok {
				cents = int64(price * 100)
			}
		}
	}
	if cents <= 0 {
		log.Printf("paddle adjustment: cannot determine refund amount for subscription=%s", sub.ID)
		return
	}
	tenantID := ""
	if subRec, err := app.FindFirstRecordByData("subscriptions", "paddle_sub_id", sub.ID); err == nil && subRec != nil {
		tenantID = subRec.GetString("tenant_id")
	}
	notes := "subscription_id=" + sub.ID
	if tier != "" {
		notes += " tier=" + tier
	}
	saveRevenueAdjustment(app, revenueAdjustment{
		Provider:          "paddle",
		EventID:           ev.EventID,
		TenantID:          tenantID,
		Kind:              "refund",
		NativeAmountMinor: cents,
		NativeCurrency:    "USD",
		Notes:             notes,
	})
}

// subscriptionTimes resolves starts_at/expires_at from the Paddle payload:
// current_billing_period when present, else a duration from billing_cycle,
// else the tier default. Paddle timestamps are RFC 3339.
func subscriptionTimes(sub *paddleSubscription, tier string) (startsAt, expiresAt string) {
	now := time.Now().UTC()
	startsAt = now.Format(time.RFC3339)
	expiresAt = calculateExpiry(tier).Format(time.RFC3339)

	if sub.CurrentBillingPeriod != nil {
		if t, err := time.Parse(time.RFC3339, sub.CurrentBillingPeriod.StartsAt); err == nil {
			startsAt = t.UTC().Format(time.RFC3339)
		}
		if t, err := time.Parse(time.RFC3339, sub.CurrentBillingPeriod.EndsAt); err == nil {
			expiresAt = t.UTC().Format(time.RFC3339)
		}
		return startsAt, expiresAt
	}
	if sub.BillingCycle != nil {
		freq := sub.BillingCycle.Frequency
		if freq <= 0 {
			freq = 1
		}
		var end time.Time
		switch sub.BillingCycle.Interval {
		case "day":
			end = now.AddDate(0, 0, freq)
		case "week":
			end = now.AddDate(0, 0, 7*freq)
		case "year":
			end = now.AddDate(freq, 0, 0)
		default: // month
			end = now.AddDate(0, freq, 0)
		}
		expiresAt = end.Format(time.RFC3339)
	}
	return startsAt, expiresAt
}

// paddleProvision handles subscription.created / activated / trialing:
// upsert tenant by email, mint (or refresh) the license key, and create
// (or update) the RSA-signed subscription. sendReceipt is true only for
// subscription.created, so renewals don't re-email the key.
func paddleProvision(app core.App, ev paddleEvent, sendReceipt bool) error {
	sub, err := parsePaddleSubscription(ev)
	if err != nil {
		return err
	}

	// Resolve tier (+ period + bundle) from the first item's price id.
	// The price is authoritative: custom_data.bundle (C3.2) only labels
	// what the price paid for — a buyer claiming a bundle on a plain price
	// is rejected. The billing_cycle.interval is cross-checked against the
	// price-map period so a tampered interval can't drift the expiry
	// cadence (mirroring the Midtrans custom_field3 cross-check).
	if len(sub.Items) == 0 || sub.Items[0].Price.ID == "" {
		return fmt.Errorf("subscription %s has no priced items", sub.ID)
	}
	priceID := sub.Items[0].Price.ID
	tier, period, bundle, ok := paddleTierForPrice(priceID)
	if !ok {
		return fmt.Errorf("price %q is not mapped in PADDLE_PRICE_TIERS", priceID)
	}
	if cf := strings.TrimSpace(sub.CustomData["bundle"]); cf != "" && cf != bundle {
		return fmt.Errorf("custom_data.bundle %q disagrees with price-mapped bundle %q for price %q — rejecting", cf, bundle, priceID)
	}
	// Cross-check the billing cycle interval against the price-map period.
	// A tampered interval (e.g. "year" on a monthly price) would let the
	// subscriptionTimes fallback extend the wrong cadence.
	if sub.BillingCycle != nil && sub.BillingCycle.Interval != "" {
		interval := strings.ToLower(strings.TrimSpace(sub.BillingCycle.Interval))
		// Normalize: Paddle uses "month"/"year" which matches the price map.
		if interval != period {
			return fmt.Errorf("billing_cycle.interval %q disagrees with price-mapped period %q for price %q — rejecting", interval, period, priceID)
		}
	}

	// Resolve the customer email (custom_data → embedded customer → API).
	email := resolvePaddleEmail(sub)
	if email == "" {
		return fmt.Errorf("cannot resolve customer email for subscription %s (set custom_data.email or PADDLE_API_KEY)", sub.ID)
	}

	// ── Upsert tenant by email (shared with the Midtrans webhook) ──
	tenant, err := upsertTenantByEmail(app, email, strings.TrimSpace(sub.CustomData["phone"]), "paddle")
	if err != nil {
		return err
	}

	startsAt, expiresAt := subscriptionTimes(sub, tier)

	// ── Mint or refresh the license key ───────────────────────
	// Idempotent: a re-delivered subscription.created (after a restart
	// cleared the dedup map) must not mint a second key.
	keyRecord, err := app.FindFirstRecordByData("license_keys", "paddle_sub_id", sub.ID)
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
		keyRecord.Set("paddle_sub_id", sub.ID)
		keyRecord.Set("payment_provider", "paddle")
		if saveErr := app.Save(keyRecord); saveErr != nil {
			return fmt.Errorf("failed to save license key for subscription %s: %w", sub.ID, saveErr)
		}
		log.Printf("paddle webhook: minted key %q (tier=%s, bundle=%s) for subscription %s", maskLicenseKey(key), tier, bundle, sub.ID)
		if sendReceipt {
			// Non-fatal: a failed receipt must not fail provisioning.
			if mailErr := sendReceiptEmail(email, key, tier, expiresAt); mailErr != nil {
				log.Printf("paddle webhook: receipt email to %q failed (non-fatal): %v", email, mailErr)
			}
		}
	} else {
		// Refresh tier/expiry on the existing key (renewal / re-delivery).
		// Paddle renewals echo custom_data, but fall back to the persisted
		// bundle_id anyway: a bundle the customer is still paying for must
		// survive renewals. When the price map resolves a bundle for the
		// charged price it wins (plan change).
		if bundle == "" {
			bundle = keyRecord.GetString("bundle_id")
		}
		keyRecord.Set("tier_key", tier)
		keyRecord.Set("expires_at", expiresAt)
		if saveErr := app.Save(keyRecord); saveErr != nil {
			return fmt.Errorf("failed to refresh license key for subscription %s: %w", sub.ID, saveErr)
		}
	}

	// ── Upsert the RSA-signed subscription ────────────────────
	// The signed payload carries the bundle-widened allowed types, so the
	// POS trusts the same payload shape regardless of how the bundle got
	// there (checkout webhook or trial activation).
	maxStores, maxPOS, allowedTypes := tierQuotas(tier, bundle)
	status := "active"
	graceUntil := calculateGraceUntil(tier, mustParseTime(expiresAt)).Format(time.RFC3339)
	payload := SubscriptionPayload{
		TenantID:        tenant.Id,
		TierKey:         tier,
		Status:          status,
		MaxLocations:    maxStores,
		MaxPOSInstances: maxPOS,
		AllowedTypes:    allowedTypes,
		StartsAt:        startsAt,
		ExpiresAt:       expiresAt,
		GraceUntil:      graceUntil,
		IssuedAt:        time.Now().UTC().Format(time.RFC3339),
	}
	payloadStr, signature, err := signSubscription(payload)
	if err != nil {
		return fmt.Errorf("failed to sign subscription: %w", err)
	}

	subRecord, err := app.FindFirstRecordByData("subscriptions", "paddle_sub_id", sub.ID)
	if err != nil {
		subColl, collErr := app.FindCollectionByNameOrId("subscriptions")
		if collErr != nil {
			return fmt.Errorf("subscriptions collection not found: %w", collErr)
		}
		subRecord = core.NewRecord(subColl)
		subRecord.Set("paddle_sub_id", sub.ID)
	}
	subRecord.Set("payment_provider", "paddle")
	subRecord.Set("bundle_id", bundle)
	subRecord.Set("tenant_id", []string{tenant.Id})
	subRecord.Set("tier_key", tier)
	subRecord.Set("status", status)
	subRecord.Set("starts_at", startsAt)
	subRecord.Set("expires_at", expiresAt)
	subRecord.Set("grace_until", graceUntil)
	// Persist the tier's quota block on the subscription so /status and the
	// subscription.updated / canceled re-signs read current values instead of
	// zero values (mirrors renew.go's M5-audit fix).
	subRecord.Set("max_stores", maxStores)
	subRecord.Set("max_pos_instances", maxPOS)
	if b, err := json.Marshal(allowedTypes); err == nil {
		subRecord.Set("allowed_types", string(b))
	}
	subRecord.Set("signed_payload", payloadStr)
	subRecord.Set("signature", signature)
	if saveErr := app.Save(subRecord); saveErr != nil {
		return fmt.Errorf("failed to save subscription %s: %w", sub.ID, saveErr)
	}
	log.Printf("paddle webhook: provisioned subscription %s (tier=%s, tenant=%s)", sub.ID, tier, tenant.Id)
	return nil
}

// mustParseTime parses an RFC 3339 timestamp, falling back to now (the
// callers always pass values they just formatted, so this is defensive).
func mustParseTime(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Now().UTC()
	}
	return t
}

// upsertTenantByEmail finds or creates the tenants record for a webhook
// purchase, shared by the Paddle and Midtrans webhooks so both billing
// paths mint identical tenant records. The phone is backfilled when
// non-empty (Paddle checkout may collect it; Midtrans notifications do not
// carry one). New tenants get a placeholder api_key — the real key is
// minted at first activation (see activate.go), which is when the POS
// learns it — and have not completed OTP verification (register-first means
// buyers usually have, but the flag's meaning is "proved inbox ownership via
// verify-otp").
func upsertTenantByEmail(app core.App, email, phone, provider string) (*core.Record, error) {
	tenant, err := app.FindFirstRecordByData("tenants", "email", email)
	if err == nil {
		if phone != "" && (tenant.GetString("phone") == "" || tenant.GetString("phone") == "-") {
			tenant.Set("phone", phone)
			if saveErr := app.Save(tenant); saveErr != nil {
				log.Printf("%s webhook: failed to backfill phone for tenant %q: %v", provider, email, saveErr)
			}
		}
		return tenant, nil
	}

	tenantColl, collErr := app.FindCollectionByNameOrId("tenants")
	if collErr != nil {
		return nil, fmt.Errorf("tenants collection not found: %w", collErr)
	}
	tenant = core.NewRecord(tenantColl)
	tenant.Set("email", email)
	if phone != "" {
		tenant.Set("phone", phone)
	} else {
		tenant.Set("phone", "-")
	}
	// Placeholder api_key (never revealed): the customer's real api_key is
	// minted at first activation (see activate.go), which is when the POS
	// learns it. The bcrypt hash keeps the unique index satisfied.
	placeholder := generateAPIKey()
	hash, lookup, hashErr := hashAPIKey(placeholder)
	if hashErr != nil {
		return nil, fmt.Errorf("failed to hash placeholder api_key: %w", hashErr)
	}
	tenant.Set("api_key", hash)
	tenant.Set("api_key_lookup", lookup)
	tenant.Set("status", "active")
	// Purchase-created tenants have not completed OTP verification
	// (register-first means buyers usually have, but the flag's meaning is
	// "proved inbox ownership via verify-otp" — they can do that anytime
	// via request-otp).
	tenant.Set("email_verified", false)
	if saveErr := app.Save(tenant); saveErr != nil {
		return nil, fmt.Errorf("failed to save tenant %q: %w", email, saveErr)
	}
	log.Printf("%s webhook: created tenant %q (id=%s)", provider, email, tenant.Id)
	return tenant, nil
}

// paddleUpdate handles subscription.updated: refresh tier/status/expiry on
// the subscriptions record and keep the license key's tier/expiry in sync
// (so activation's expiry gate and machine limits match the Paddle truth).
func paddleUpdate(app core.App, ev paddleEvent) error {
	sub, err := parsePaddleSubscription(ev)
	if err != nil {
		return err
	}
	subRecord, err := app.FindFirstRecordByData("subscriptions", "paddle_sub_id", sub.ID)
	if err != nil {
		// Unknown subscription (e.g. created before the webhook shipped) —
		// acknowledge and let provisioning happen on the next created event.
		log.Printf("paddle webhook: subscription.updated for unknown paddle_sub_id=%s (no local record)", sub.ID)
		return nil
	}

	priceID := ""
	if len(sub.Items) > 0 {
		priceID = sub.Items[0].Price.ID
	}
	if priceID != "" {
		if tier, _, bundle, ok := paddleTierForPrice(priceID); ok {
			subRecord.Set("tier_key", tier)
			// A plan-change price may carry no bundle segment; keep the
			// persisted bundle so an update event never strips kds from a
			// key that's still paying for it.
			if bundle == "" {
				bundle = subRecord.GetString("bundle_id")
			}
			subRecord.Set("bundle_id", bundle)
			// Refresh the tier's quota block so the re-sign below reads the new
			// tier's limits, not the ones captured at provisioning time.
			maxStores, maxPOS, allowedTypes := tierQuotas(tier, bundle)
			subRecord.Set("max_stores", maxStores)
			subRecord.Set("max_pos_instances", maxPOS)
			if b, err := json.Marshal(allowedTypes); err == nil {
				subRecord.Set("allowed_types", string(b))
			}
			if keyRecord, err := app.FindFirstRecordByData("license_keys", "paddle_sub_id", sub.ID); err == nil {
				keyRecord.Set("tier_key", tier)
				keyRecord.Set("bundle_id", bundle)
				keyRecord.Set("max_stores", maxStores)
				keyRecord.Set("max_pos_instances", maxPOS)
				if b, err := json.Marshal(allowedTypes); err == nil {
					keyRecord.Set("allowed_types", string(b))
				}
				if saveErr := app.Save(keyRecord); saveErr != nil {
					log.Printf("paddle webhook: failed to sync key tier for %s: %v", sub.ID, saveErr)
				}
			}
		}
	}

	// Only downgrade to grace when Paddle says so; past_due stays active
	// (Paddle is still retrying the payment).
	if status, ok := mapPaddleStatus(sub.Status); ok {
		subRecord.Set("status", status)
	}

	startsAt, expiresAt := subscriptionTimes(sub, subRecord.GetString("tier_key"))
	subRecord.Set("starts_at", startsAt)
	subRecord.Set("expires_at", expiresAt)
	// Persist the refreshed grace window too — the dashboard reads
	// grace_until from this record, so a stale value would make the account
	// page's "Grace until" disagree with the re-signed payload below.
	graceUntil := calculateGraceUntil(subRecord.GetString("tier_key"), mustParseTime(expiresAt)).Format(time.RFC3339)
	subRecord.Set("grace_until", graceUntil)
	if keyRecord, err := app.FindFirstRecordByData("license_keys", "paddle_sub_id", sub.ID); err == nil {
		keyRecord.Set("expires_at", expiresAt)
		if saveErr := app.Save(keyRecord); saveErr != nil {
			log.Printf("paddle webhook: failed to sync key expiry for %s: %v", sub.ID, saveErr)
		}
	}

	// Re-sign with the current tier/status/expiry.
	payload := SubscriptionPayload{
		TenantID:        subRecord.GetString("tenant_id"),
		TierKey:         subRecord.GetString("tier_key"),
		Status:          subRecord.GetString("status"),
		MaxLocations:    subRecord.GetInt("max_stores"),
		MaxPOSInstances: subRecord.GetInt("max_pos_instances"),
		AllowedTypes:    parseAllowedTypes(subRecord.GetString("allowed_types")),
		StartsAt:        startsAt,
		ExpiresAt:       expiresAt,
		GraceUntil:      graceUntil,
		IssuedAt:        time.Now().UTC().Format(time.RFC3339),
	}
	payloadStr, signature, err := signSubscription(payload)
	if err != nil {
		return fmt.Errorf("failed to sign updated subscription: %w", err)
	}
	subRecord.Set("signed_payload", payloadStr)
	subRecord.Set("signature", signature)
	if err := app.Save(subRecord); err != nil {
		return fmt.Errorf("failed to save updated subscription %s: %w", sub.ID, err)
	}
	log.Printf("paddle webhook: updated subscription %s (status=%s, expires=%s)", sub.ID, payload.Status, expiresAt)
	return nil
}

// paddleSetGrace handles subscription.canceled / paused: the customer keeps
// access through the paid period, so the subscription moves to grace_period
// with grace_until at the scheduled cancellation (or billing period end).
func paddleSetGrace(app core.App, ev paddleEvent) error {
	sub, err := parsePaddleSubscription(ev)
	if err != nil {
		return err
	}
	subRecord, err := app.FindFirstRecordByData("subscriptions", "paddle_sub_id", sub.ID)
	if err != nil {
		log.Printf("paddle webhook: %s for unknown paddle_sub_id=%s (no local record)", ev.EventType, sub.ID)
		return nil
	}

	graceUntil := subRecord.GetString("expires_at")
	if sub.ScheduledChange != nil && sub.ScheduledChange.EffectiveAt != "" {
		graceUntil = sub.ScheduledChange.EffectiveAt
	} else if sub.CurrentBillingPeriod != nil && sub.CurrentBillingPeriod.EndsAt != "" {
		graceUntil = sub.CurrentBillingPeriod.EndsAt
	}
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
	payloadStr, signature, err := signSubscription(payload)
	if err != nil {
		return fmt.Errorf("failed to sign %s subscription: %w", ev.EventType, err)
	}
	subRecord.Set("signed_payload", payloadStr)
	subRecord.Set("signature", signature)
	if err := app.Save(subRecord); err != nil {
		return fmt.Errorf("failed to save %s subscription %s: %w", ev.EventType, sub.ID, err)
	}
	log.Printf("paddle webhook: %s -> grace_period for subscription %s (grace_until=%s)", ev.EventType, sub.ID, graceUntil)
	return nil
}

// paddleResume handles subscription.resumed: back to active with the
// current billing period.
func paddleResume(app core.App, ev paddleEvent) error {
	sub, err := parsePaddleSubscription(ev)
	if err != nil {
		return err
	}
	subRecord, err := app.FindFirstRecordByData("subscriptions", "paddle_sub_id", sub.ID)
	if err != nil {
		log.Printf("paddle webhook: subscription.resumed for unknown paddle_sub_id=%s", sub.ID)
		return nil
	}
	subRecord.Set("status", "active")
	startsAt, expiresAt := subscriptionTimes(sub, subRecord.GetString("tier_key"))
	subRecord.Set("starts_at", startsAt)
	subRecord.Set("expires_at", expiresAt)
	// Resume starts a fresh billing period — persist the refreshed grace
	// window on the record AND re-sync the license key's expiry, or /me and
	// the POS would keep the canceled-era dates while the signed payload
	// says otherwise.
	graceUntil := calculateGraceUntil(subRecord.GetString("tier_key"), mustParseTime(expiresAt)).Format(time.RFC3339)
	subRecord.Set("grace_until", graceUntil)
	if keyRecord, err := app.FindFirstRecordByData("license_keys", "paddle_sub_id", sub.ID); err == nil {
		keyRecord.Set("expires_at", expiresAt)
		if saveErr := app.Save(keyRecord); saveErr != nil {
			log.Printf("paddle webhook: failed to sync key expiry on resume for %s: %v", sub.ID, saveErr)
		}
	}
	payload := SubscriptionPayload{
		TenantID:        subRecord.GetString("tenant_id"),
		TierKey:         subRecord.GetString("tier_key"),
		Status:          "active",
		MaxLocations:    subRecord.GetInt("max_stores"),
		MaxPOSInstances: subRecord.GetInt("max_pos_instances"),
		AllowedTypes:    parseAllowedTypes(subRecord.GetString("allowed_types")),
		StartsAt:        startsAt,
		ExpiresAt:       expiresAt,
		GraceUntil:      graceUntil,
		IssuedAt:        time.Now().UTC().Format(time.RFC3339),
	}
	payloadStr, signature, err := signSubscription(payload)
	if err != nil {
		return fmt.Errorf("failed to sign resumed subscription: %w", err)
	}
	subRecord.Set("signed_payload", payloadStr)
	subRecord.Set("signature", signature)
	if err := app.Save(subRecord); err != nil {
		return fmt.Errorf("failed to save resumed subscription %s: %w", sub.ID, err)
	}
	log.Printf("paddle webhook: resumed subscription %s -> active", sub.ID)
	return nil
}

// parseAllowedTypes decodes the JSON array stored on subscriptions
// (defensive: a legacy record may hold an empty string).
func parseAllowedTypes(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return []string{}
	}
	var out []string
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return []string{}
	}
	return out
}
