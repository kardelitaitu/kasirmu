package main

import (
	"log"
	"net/http"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// handleHealth returns the server health status.
//
// GET /api/health — public, no auth required.
//
// PocketBase v0.39.6 registers its own /api/health before our OnServe hook
// runs, so this handler cannot be registered as a plain route (route
// conflict). Instead it is mounted via bindHealthOverride as a root-group
// middleware that short-circuits the built-in endpoint — see main.go.
//
// Used by Docker healthcheck and monitoring systems.
func handleHealth(app core.App) func(e *core.RequestEvent) error {
	startTime := time.Now()

	return func(e *core.RequestEvent) error {
		uptime := time.Since(startTime).Seconds()

		// Quick DB connectivity check via PocketBase's internal DB.
		dbConnected := true
		dbErr := ""
		if _, err := app.DB().NewQuery("SELECT 1").Execute(); err != nil {
			dbConnected = false
			dbErr = err.Error()
			log.Printf("/health: DB ping failed: %v", err)
		}

		status := http.StatusOK
		statusText := "ok"
		if !dbConnected {
			status = http.StatusServiceUnavailable
			statusText = "degraded"
		}

		return e.JSON(status, map[string]any{
			"status":        statusText,
			"db_connected":  dbConnected,
			"db_error":      dbErr,
			"smtp":          smtpHealthSnapshot(),
			"admin":         adminEmailHealthSnapshot(app),
			"paddle":        paddleHealthStatus(),
			"midtrans":      midtransHealthStatus(),
			"market_prices": marketPriceHealthStatus(),
			"rsa":           rsaHealthStatus(),
			"discord":       discordHealthStatus(),
			"uptime_secs":   int(uptime),
			"go_version":    runtime.Version(),
			"go_os":         runtime.GOOS,
			"go_arch":       runtime.GOARCH,
		})
	}
}

// ── Admin-identity health status ──────────────────────────────────────

// adminEmailHealthSnapshot reports the OZ_ADMIN_EMAIL configuration state
// so a misconfigured deployment is diagnosable from /api/health instead of
// arriving as a validation-shaped error.
//
// WHY THIS EXISTS: since the guard started failing closed, an unset
// OZ_ADMIN_EMAIL turns the duplicate-email 409 at
// admin_tenant_lifecycle.go:105 into the guard 400 at :96, and makes every
// cascade delete answer 403 at :340 even with a correct confirm_email
// (the confirm check at :337 runs first). A missing environment variable
// then looks exactly like bad input, which is how a support ticket ends up
// saying the rename button is broken.
//
// THE ASYMMETRY IS THE WHOLE POINT, so the two readings are computed on
// purpose by different rules:
//
//	source        — what AUTHENTICATION would anchor on: the trimmed
//	                OZ_ADMIN_EMAIL ("env"), else the compiled
//	                defaultAdminEmail ("fallback").
//	matching_rows — how many tenants rows carry that address. When source
//	                is "env" this is also exactly what the guard compares
//	                against, so it IS the guard view. When source is
//	                "fallback" it is NOT: the guard does not fall back at
//	                all, it protects every row. That gap — auth would
//	                still match one literal address while the guard
//	                refuses everything — is the finding this field exists
//	                to make visible.
//	verified      — true only when source is "env" AND matching_rows is 1:
//	                a named address resolving to exactly one tenant.
//
// health.go reads defaultAdminEmail DIRECTLY rather than calling
// adminEmailTarget / adminEmailTargetWithDefault. Legal because it is the
// same package, deliberate because if the resolver ever drops the fallback
// then source="fallback" would become unreachable through it — and the
// asymmetric state is exactly the one worth reporting.
//
// NO ADDRESS IS EVER ECHOED: not the env value, not the compiled default,
// not a masked, hashed or truncated form of either. /api/health is public
// (no auth — see handleHealth) and the admin identity is the one account an
// attacker needs to be able to name. Only the shape is reported.
//
// Read per request, no cache: unlike the SMTP probe this costs one pass
// over the tenants table, not a network round trip to a relay.
func adminEmailHealthSnapshot(app core.App) map[string]any {
	source := "fallback"
	address := strings.TrimSpace(os.Getenv("OZ_ADMIN_EMAIL"))
	if address == "" {
		address = defaultAdminEmail
	} else {
		source = "env"
	}

	// -1 means "could not count" — an unreadable tenants collection must
	// never be reported as the 0 that means "configured, but no such row".
	matching := -1
	if rows, err := app.FindAllRecords("tenants"); err != nil {
		log.Printf("/health: admin email snapshot could not read tenants: %v", err)
	} else {
		matching = 0
		for _, r := range rows {
			// EqualFold mirrors the guard comparison, so a differently cased
			// stored address counts the same way it is protected.
			if strings.EqualFold(r.GetString("email"), address) {
				matching++
			}
		}
	}

	return map[string]any{
		"source":        source,
		"matching_rows": matching,
		"verified":      source == "env" && matching == 1,
	}
}

// bindHealthOverride intercepts GET /api/health (PocketBase's built-in
// endpoint is registered before the OnServe hook, so it cannot be replaced
// by re-registering the route) and serves the extended handleHealth payload
// instead. All other requests pass through to their normal handlers.
//
// The gate blocks (paddle, midtrans, rsa, discord, smtp) are STATUS, not liveness:
// none of them fail the HTTP check (only a DB outage does), so a broken
// relay or missing optional webhook shows up for monitors without making
// the container flap.

// paddleHealthStatus mirrors the boot-time Paddle gate (verifyPaddleConfig)
// as a read-only status: per-component booleans so monitors can see WHICH
// piece is missing, the mapping count when the tier map parses, and the
// parse error when it doesn't.
func paddleHealthStatus() map[string]any {
	status := map[string]any{
		"secret_configured":      paddleWebhookSecret() != "",
		"price_tiers_configured": false,
		"price_tiers_mappings":   0,
		"error":                  "",
	}
	m, err := paddlePriceTiers()
	if err != nil {
		status["error"] = err.Error()
	} else {
		status["price_tiers_configured"] = true
		status["price_tiers_mappings"] = len(m)
	}
	return status
}

// midtransHealthStatus mirrors the boot-time Midtrans gate
// (verifyMidtransConfig) as a read-only status: per-component booleans so
// monitors can see WHICH piece is missing (server key vs. the price map),
// the mapping count when the tier map parses, and the parse error when it
// doesn't (DEPLOY.md §12 — the runbook's monitoring step alerts on this).
func midtransHealthStatus() map[string]any {
	status := map[string]any{
		"server_key_configured":  midtransServerKey() != "",
		"price_tiers_configured": false,
		"price_tiers_mappings":   0,
		"error":                  "",
	}
	m, err := midtransPriceTiers()
	if err != nil {
		status["error"] = err.Error()
	} else {
		status["price_tiers_configured"] = true
		status["price_tiers_mappings"] = len(m)
	}
	return status
}

// marketPriceHealthStatus reports the OPTIONAL per-market price maps
// (PRICE_TIERS_<CURRENCY>, saas-3 D95) alongside the per-provider
// price_tiers_* reports. Unlike those boot gates these maps never fail
// the server: absent = {configured:false} (the USD+FX fallback covers
// everything), configured = market → mapping count, malformed = the
// parse error under that market so the operator can fix the var
// without a deploy and without an outage.
func marketPriceHealthStatus() map[string]any {
	status := map[string]any{
		"configured": false,
		"markets":    map[string]any{},
		"errors":     map[string]string{},
	}
	maps, errs := marketPriceTiers()
	markets := map[string]any{}
	for cur, m := range maps {
		markets[cur] = map[string]any{"mappings": len(m)}
	}
	errors := map[string]string{}
	for cur, err := range errs {
		errors[cur] = err.Error()
	}
	if len(markets) > 0 {
		status["configured"] = true
	}
	status["markets"] = markets
	status["errors"] = errors
	return status
}

// rsaHealthStatus reports whether the signing key is loaded. The boot
// gate in main.go exits when it's missing, so this is normally always
// true at runtime — the field lets monitors confirm the state without
// reading logs.
func rsaHealthStatus() map[string]any {
	return map[string]any{"configured": privateKey != nil}
}

// discordHealthStatus reports whether the support-contact webhook is
// configured. It's an optional feature (contact.go answers 503 without
// it), so this is informational — a missing webhook never fails the
// health check.
func discordHealthStatus() map[string]any {
	return map[string]any{"configured": strings.TrimSpace(os.Getenv("OZ_DISCORD_WEBHOOK")) != ""}
}
func bindHealthOverride(app core.App, se *core.ServeEvent) {
	se.Router.BindFunc(func(e *core.RequestEvent) error {
		if strings.TrimSuffix(e.Request.URL.Path, "/") == "/api/health" {
			return handleHealth(app)(e)
		}
		return e.Next()
	})
}

// ── SMTP sender-identity health status ───────────────────────────────

// smtpHealthRefreshInterval bounds how often /api/health re-runs the
// sender-identity probe. Docker polls every 15s; re-probing the relay on
// every poll would hammer it, so the result is cached for 60s.
const smtpHealthRefreshInterval = 60 * time.Second

// smtpHealthState caches the last probe result so health checks are cheap.
type smtpHealthState struct {
	mu        sync.Mutex
	checkedAt time.Time
	snapshot  map[string]any
}

var smtpHealth smtpHealthState

// smtpHealthSnapshot returns the cached sender-identity status, re-running
// the probe (auth + MAIL FROM only — nothing is ever queued) when the
// cache is stale. Mirrors verifySMTPConfig's classification: permanent
// rejection surfaces as verified=false with the relay's error; transient
// failures also report verified=false but with a warning-style error, so a
// relay hiccup is visible in the health payload without failing the check.
func smtpHealthSnapshot() map[string]any {
	smtpHealth.mu.Lock()
	defer smtpHealth.mu.Unlock()
	if time.Since(smtpHealth.checkedAt) < smtpHealthRefreshInterval && smtpHealth.snapshot != nil {
		return smtpHealth.snapshot
	}
	smtpHealth.snapshot = runSMTPHealthProbe()
	smtpHealth.checkedAt = time.Now()
	return smtpHealth.snapshot
}

// runSMTPHealthProbe executes one sender-identity probe and shapes the
// result for the health payload. Env is read per call, matching the
// senders (a redeploy with fixed env is picked up without a restart).
func runSMTPHealthProbe() map[string]any {
	host := strings.TrimSpace(os.Getenv("OZ_SMTP_HOST"))
	if host == "" {
		return map[string]any{
			"configured": false,
			"verified":   false,
			"error":      "",
		}
	}
	port := strings.TrimSpace(os.Getenv("OZ_SMTP_PORT"))
	if port == "" {
		port = "587"
	}
	user := os.Getenv("OZ_SMTP_USER")
	password := os.Getenv("OZ_SMTP_PASSWORD")
	from := strings.TrimSpace(os.Getenv("OZ_SMTP_FROM"))

	res := map[string]any{
		"configured": true,
		"verified":   false,
		"error":      "",
	}
	if from == "" || from == smtpDefaultFrom {
		res["error"] = "OZ_SMTP_FROM is unset or still the unowned default " + smtpDefaultFrom
		return res
	}
	if err := probeSMTPFrom(host, port, user, password, from); err != nil {
		res["error"] = err.Error()
		return res
	}
	res["verified"] = true
	return res
}

// resetSMTPHealthCache clears the cached probe result so tests can re-run
// the probe with different env without waiting out the refresh interval.
func resetSMTPHealthCache() {
	smtpHealth.mu.Lock()
	defer smtpHealth.mu.Unlock()
	smtpHealth.snapshot = nil
	smtpHealth.checkedAt = time.Time{}
}
