// Package main is the entry point for the kasir.mu license server.
// It extends PocketBase with custom Go hooks for license activation,
// renewal, and status checks with RSA-2048 signing.
//
// Windows manifest: the committed rsrc_windows_amd64.syso embeds
// app.manifest (asInvoker, numeric RT_MANIFEST type 24) into the Windows
// build so UAC never raises an elevation consent prompt. Regenerate it with:
//
//	go generate ./...          (runs: go-winres make --arch amd64)
//
// The .syso is committed so `go build` on Windows needs no extra tooling.
//
//go:generate go run github.com/tc-hib/go-winres@v0.3.3 make --arch amd64
package main

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	_ "embed"
	"encoding/base64"
	"encoding/pem"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// pbSchemaJSON is the PocketBase collections schema embedded at build time.
// A fresh deployment (empty pb_data volume) boots with only the default
// system collections; the business collections (license_keys, tenants,
// subscriptions, tenant_machines) are imported idempotently on first boot
// from this file so the server never starts "healthy" with activation
// endpoints failing with "collections not found".
//
//go:embed pb_schema.json
var pbSchemaJSON []byte

// requiredCollections are the business collections the license API depends
// on. If any is missing at serve time, the embedded pb_schema.json is
// imported (see ensureCollections).
var requiredCollections = []string{
	"license_keys",
	"tenants",
	"subscriptions",
	"tenant_machines",
	"trial_registrations",
	"trial_claims",
	"trial_email_log",
	"revenue_events",
	"revenue_adjustments",
}

// privateKey is the RSA-2048 private key loaded from the
// OZ_LICENSE_PRIVATE_KEY environment variable at startup.
var privateKey *rsa.PrivateKey

// clientIPObs is the process-wide bounded observer that logs the raw
// X-Forwarded-For chain + resolved client IP for the first
// clientIPObserveCap distinct IPs. It is a package-level singleton so every
// request shares one capped seen-set and counter (see helpers.go).
var clientIPObs = newClientIPObserver()

func main() {
	app := pocketbase.New()

	// ── Bootstrap: load RSA private key ──────────────────────────
	keyPEM := os.Getenv("OZ_LICENSE_PRIVATE_KEY")
	if keyPEM == "" {
		log.Fatal("OZ_LICENSE_PRIVATE_KEY environment variable is required")
	}

	block, _ := pem.Decode([]byte(normalizePEM(keyPEM)))
	if block == nil {
		log.Fatalf("failed to decode PEM block from OZ_LICENSE_PRIVATE_KEY (key length: %d bytes, starts with: %q)",
			len(keyPEM), safePrefix(keyPEM, 40))
	}

	var err error
	privateKey, err = x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		// Try PKCS8 format (more common with modern tools)
		pkcs8Key, err2 := x509.ParsePKCS8PrivateKey(block.Bytes)
		if err2 != nil {
			log.Fatalf("failed to parse RSA private key (PKCS1: %v, PKCS8: %v)", err, err2)
		}
		var ok bool
		privateKey, ok = pkcs8Key.(*rsa.PrivateKey)
		if !ok {
			log.Fatal("key is not an RSA private key")
		}
	}
	log.Println("RSA private key loaded successfully")

	// ── Bootstrap: SMTP sender identity ──────────────────────────
	// Fail fast when email delivery is configured but OZ_SMTP_FROM is
	// unset or rejected by the relay: signup codes and purchase receipts
	// would silently fail in production (see verifySMTPConfig). Skipped
	// when OZ_SMTP_HOST is unset — request-otp answers 503 by design then.
	if err := verifySMTPConfig(); err != nil {
		log.Fatal(err)
	}

	// ── Bootstrap: webhook config ────────────────────────────────
	// Fail fast when a webhook would answer 503/500 on every event
	// (missing secret or price→tier map): purchases would provision
	// nothing and the provider would retry forever (see verifyPaddleConfig
	// / verifyMidtransConfig).
	if err := verifyPaddleConfig(); err != nil {
		log.Fatal(err)
	}
	if err := verifyMidtransConfig(); err != nil {
		log.Fatal(err)
	}

	// ── Register custom license API routes ───────────────────────
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		// Rate-limit keying fix (H2 confirmed defect): every limiter keys on
		// e.RealIP(), and RealIP() only trusts X-Forwarded-For once
		// Settings.TrustedProxy.Headers is seeded. Without it the Caddy
		// reverse_proxy peer (localhost:8080) collapsed every client onto the
		// loopback address, so all clients worldwide shared ONE budget.
		//
		// Seed the trusted-proxy setting and register a router-level middleware
		// that collapses the XFF chain to the single real client IP BEFORE any
		// route handler runs — so RealIP() (and therefore every limiter) sees the
		// client, not 127.0.0.1. UseLeftmostIP stays false: because the
		// middleware already reduces XFF to exactly ONE value, leftmost/rightmost
		// is irrelevant.
		hops := resolveTrustedHops()
		if err := seedClientIPSettings(app); err != nil {
			log.Printf("[client-ip] failed to seed TrustedProxy settings: %v", err)
		} else {
			log.Printf("[client-ip] TrustedProxy seeded: X-Forwarded-For trusted, %d hop(s) from edge", hops)
		}
		se.Router.BindFunc(func(e *core.RequestEvent) error {
			// Capture the RAW inbound forwarded chain BEFORE the collapse below,
			// so the bounded observer can report what the edge actually sent.
			rawXFF := e.Request.Header.Get("X-Forwarded-For")
			remoteIP := stripPort(e.Request.RemoteAddr)
			clientIP := normalizeClientIP(e.Request.Header, remoteIP, hops)
			// Collapse to exactly one value so RealIP() re-parses a single clean
			// entry regardless of leftmost/rightmost policy.
			e.Request.Header.Set("X-Forwarded-For", clientIP)
			// Bounded observability: log the raw chain + remote + resolved IP for
			// the first clientIPObserveCap distinct resolved IPs only, so we learn
			// in production whether the edges append or replace X-Forwarded-For
			// without probing the rate-limited service. No-op after the cap and
			// never per-request (guarded by the mutex/counter in helpers.go).
			clientIPObs.LogResolveInfo(rawXFF, remoteIP, clientIP)
			clientIPObs.LogResolveMatchesRemote(rawXFF, remoteIP, clientIP)
			return e.Next()
		})

		// First boot on an empty pb_data volume: import the embedded
		// collections schema so /activate, /renew, and /status find their
		// collections instead of a fresh-but-broken deployment.
		// Idempotent: no-op once all required collections exist.
		if err := ensureCollections(app); err != nil {
			return err
		}
		// Add the api_key_lookup field to existing deployments that predate
		// api_key hashing. Fresh boots get it from the embedded pb_schema.json;
		// this is the idempotent in-place upgrade for already-provisioned
		// pb_data volumes, so the SHA-256 lookup index used by
		// findTenantByAPIKey exists on every boot.
		if err := ensureAPIKeyLookupField(app); err != nil {
			return err
		}
		// Idempotent in-place upgrade for deployments that predate the
		// tenants.region residency field (ADR #59 §2.1a sequencing step 1):
		// fresh boots get it from the embedded pb_schema.json; existing
		// pb_data volumes get it added and their rows backfilled to "global",
		// which is the launch region and the correct semantics for every
		// tenant that predates the field.
		if err := ensureRegionField(app); err != nil {
			return err
		}
		// Idempotent in-place upgrade for deployments that predate the
		// email_verified field (added with the register-first dashboard):
		// fresh boots get it from the embedded pb_schema.json; existing
		// pb_data volumes get it added without reimporting the schema.
		if err := ensureEmailVerifiedField(app); err != nil {
			return err
		}
		// Idempotent in-place upgrade for deployments that predate the
		// password_hash field (added with password login): fresh boots get
		// it from the embedded pb_schema.json; existing pb_data volumes get
		// it added without reimporting the schema. Existing tenants keep an
		// empty password_hash — OTP remains their only login until they set
		// one from the dashboard.
		if err := ensurePasswordHashField(app); err != nil {
			return err
		}
		// Idempotent in-place upgrade for deployments that predate the
		// password_reset_at field (added with the forgot-password flow):
		// fresh boots get it from the embedded pb_schema.json; existing
		// pb_data volumes get it added without reimporting the schema.
		// Existing records keep a zero value — no cooldown, resets allowed.
		if err := ensurePasswordResetAtField(app); err != nil {
			return err
		}
		// Idempotent in-place upgrade for deployments that predate the
		// segmented-trial flag (C2.1): fresh boots get it from the embedded
		// pb_schema.json; existing pb_data volumes get it added without
		// reimporting the schema. Existing keys keep is_trial=false — the
		// correct semantics (only trial keys minted going forward flip it).
		if err := ensureIsTrialField(app); err != nil {
			return err
		}
		// Idempotent in-place upgrade for deployments that predate the
		// Midtrans webhook (C3.1): fresh boots get the midtrans_sub_id /
		// midtrans_order_id fields from the embedded pb_schema.json; existing
		// pb_data volumes get them added without reimporting the schema.
		// Existing records keep empty values — they were Paddle-minted.
		if err := ensureMidtransFields(app); err != nil {
			return err
		}
		// Idempotent in-place upgrade for deployments that predate the
		// payment_provider discriminator (C3.1): fresh boots get it from the
		// embedded pb_schema.json; existing pb_data volumes get it added and
		// their records backfilled to "paddle" (everything pre-Midtrans was
		// Paddle-minted). Webhooks set it explicitly going forward.
		if err := ensurePaymentProviderField(app); err != nil {
			return err
		}
		// Manual grants (ADR #42 Phase 4): widen the payment_provider
		// select with "manual" for existing deployments that already have
		// the field with the old paddle|midtrans enum. Fresh boots get it
		// from the embedded pb_schema.json. Idempotent value-append.
		if err := ensureManualPaymentProvider(app); err != nil {
			return err
		}
		// Idempotent in-place upgrade for deployments that predate the
		// vertical-bundle checkout (C3.2 website leg): fresh boots get the
		// license_keys.bundle_id field from the embedded pb_schema.json;
		// existing pb_data volumes get it added without reimporting the
		// schema. Existing records keep empty values — nothing before the
		// bundle checkout shipped had a bundle.
		if err := ensureBundleIDField(app); err != nil {
			return err
		}
		// Idempotent in-place upgrade for deployments that predate the
		// hardware-fingerprint trial lock (SPEC-2026-TRIAL-LOCK): fresh
		// boots get the trial_registrations collection from the embedded
		// pb_schema.json; existing pb_data volumes get it created here
		// without reimporting the whole schema.
		if err := ensureTrialRegistrations(app); err != nil {
			return err
		}
		// Idempotent in-place upgrade for deployments that predate the
		// lightweight repeat-email detector: same pattern — fresh boots
		// get trial_claims from pb_schema.json, existing pb_data volumes
		// get it created here.
		if err := ensureTrialClaims(app); err != nil {
			return err
		}
		// C3.3: pause subscription fields
		if err := ensurePauseFields(app); err != nil {
			return err
		}
		// C4.2: enterprise self-serve trial approval codes
		if err := ensureEnterpriseApprovals(app); err != nil {
			return err
		}
		// ADR #59 §2.1a step 3: the durable audit collection for residency
		// moves. Created programmatically because the region route writes to it
		// and a missing collection would drop the audit trail of a real move.
		if err := ensureTenantRegionEvents(app); err != nil {
			return err
		}
		// ADR #57 §Q-B: the release-channel pin store §2.1 compares a reported
		// APK signing certificate against. Created programmatically because the
		// admin write path targets it and a missing collection would make every
		// pin write a silent no-op.
		if err := ensureReleaseChannels(app); err != nil {
			return err
		}
		// ADR #57 §2.4: the durable build-integrity report store the status
		// endpoint writes and the operator queue reads.
		if err := ensureBuildIntegrityReports(app); err != nil {
			return err
		}
		// ADR #57 §2.4: the alert cooldown store the build-integrity scanner
		// reads and writes. Created here so a missing collection cannot silently
		// make every scan re-alert.
		if err := ensureBuildIntegrityAlertState(app); err != nil {
			return err
		}
		// C4.3: add-on marketplace field on license_keys
		if err := ensureAddonsField(app); err != nil {
			return err
		}
		// Phase D2: feature_grants json field on subscriptions so the admin
		// authoring endpoint and the build-site grafts have a persisted grant
		// source on every deployment (fresh boots get it from the embedded
		// pb_schema.json).
		if err := ensureFeatureGrantsField(app); err != nil {
			return err
		}
		// ADR #58 §2.4: add hardware_fingerprint text field to tenant_machines
		// for continuous machine attestation and hardware token verification.
		if err := ensureTenantMachinesHardwareFingerprint(app); err != nil {
			return err
		}
		// Admin identity precondition (admin registration squat guard):
		// createTenant now refuses self-signup for the admin email on
		// every registration path, so the admin tenants row is a hard
		// precondition that must be provisioned out of band. Warn — but
		// never fail boot — when it is missing or not email_verified:
		// without this the fail-closed outcome would be invisible.
		warnAdminTenantState(app)
		// Wire rate-limiter persistence to SQLite (H2 audit). Idempotent
		// and logs-and-returns on schema/hydrate failure so the server can
		// still boot in degraded in-memory-only mode if SQLite is unavailable.
		// Runs BEFORE route registration — once routes are mounted, /activate
		// and /renew requests immediately call allow()/recordFailure() which
		// need the persistence handle.
		ipRateLimiter.attachPersistence(app)
		keyFailTracker.attachPersistence(app)
		// Escalating brute-force login lockout (H2 audit restart survival)
		registerLoginLockoutPersistence(app)

		se.Router.POST("/api/v1/license/activate", handleActivate(app))
		// LSE-11 phase A: emails a recovery code (inbox proof) that lets a
		// re-activating caller rotate the tenant api_key. Requires the same
		// email + license-key proof as activation; see license_recover.go.
		se.Router.POST("/api/v1/license/recover", handleLicenseRecover(app))
		se.Router.POST("/api/v1/license/renew", handleRenew(app))
		// Hardware-fingerprint trial lock (SPEC-2026-TRIAL-LOCK): claims a
		// device's one trial; answers 403 TRIAL_ALREADY_CLAIMED on reuse.
		se.Router.POST(trialPath, handleTrial(app))
		// /status uses POST + Authorization: Bearer <api_key> to keep the
		// credential out of URLs (which would otherwise leak it to webserver
		// access logs, CDN logs, browser history, and Referer headers).
		se.Router.POST("/api/v1/license/status", handleStatus(app))
		// Origin attestation (ADR #55): unauthenticated by design -- the client has
		// no credential until it has attested the host it is about to use.
		se.Router.POST("/api/v1/license/attest", handleAttest(app))
		// Certificate/Licence Revocation List (ADR #58 §2.1/§2.2): public,
		// cryptographically signed list of revoked keys and tenants.
		se.Router.GET("/api/v1/license/crl", handleLicenseCrl(app))
		// C3.3: Pause/resume subscription endpoints
		se.Router.POST("/api/v1/license/pause", handlePause(app))
		se.Router.POST("/api/v1/license/resume", handleResume(app))
		// C4.2: Enterprise self-serve trial (gated by approval code)
		se.Router.POST("/api/v1/license/enterprise-trial", handleEnterpriseTrial(app))
		// C4.2: Admin endpoints for enterprise approval code management
		se.Router.POST("/api/v1/admin/enterprise-codes", handleGenerateEnterpriseCode(app))
		se.Router.GET("/api/v1/admin/enterprise-codes", handleListEnterpriseCodes(app))
		// C4.3: Add-on marketplace admin endpoints
		se.Router.POST("/api/v1/admin/license-addons", handleAddLicenseAddon(app))
		se.Router.DELETE("/api/v1/admin/license-addons", handleRemoveLicenseAddon(app))
		se.Router.GET("/api/v1/admin/license-addons", handleListLicenseAddons(app))
		// Public website support form → Discord channel (see contact.go).
		se.Router.POST("/api/v1/web/contact", handleContact(app))
		// Website tenant-email OTP auth + account dashboard (see web_otp.go).
		// request-otp / verify-otp are the login flow; /me reads the session;
		// logout invalidates it. All four enforce the CORS allowlist from
		// OZ_WEB_ALLOWED_ORIGINS and per-email/IP rate limits in-handler.
		se.Router.POST("/api/v1/web/request-otp", handleRequestOTP(app))
		se.Router.POST("/api/v1/web/verify-otp", handleVerifyOTP(app))
		// Password login + set-password (see web_password.go). login is the
		// email+password alternative to request-otp; set-password is
		// session-authenticated (the account sets its own password from the
		// dashboard). Both enforce the same CORS allowlist.
		se.Router.POST("/api/v1/web/login", handleLoginPassword(app))
		se.Router.POST("/api/v1/web/set-password", handleSetPassword(app))
		// Signup + forgot-password (see web_password.go). register pairs
		// email+password and emails a confirmation code (verify-otp
		// completes it); request-password-reset / reset-password implement
		// the OTP-proved password reset with a 7-day cooldown. All enforce
		// the same CORS allowlist + per-email/IP rate limits.
		se.Router.POST("/api/v1/web/register", handleRegister(app))
		se.Router.POST("/api/v1/web/request-password-reset", handleRequestPasswordReset(app))
		se.Router.POST("/api/v1/web/reset-password", handleResetPassword(app))
		se.Router.GET("/api/v1/web/me", handleMe(app))
		se.Router.POST("/api/v1/web/logout", handleLogout(app))
		// One-time session exchange (hardening F1) — lets the login flow hand
		// a session to the Worker without the token ever appearing in a URL.
		se.Router.POST("/api/v1/web/exchange-issue", handleExchangeIssue(app))
		se.Router.POST("/api/v1/web/exchange-consume", handleExchangeConsume(app))
		// Google sign-in (ADR #54): start redirects to the consent screen, callback
		// completes the flow and hands the Worker a one-time code.
		se.Router.GET("/api/v1/web/oauth/google/start", handleWebOAuthGoogleStart(app))
		se.Router.GET("/api/v1/web/oauth/google/callback", handleWebOAuthGoogleCallback(app))
		// Desktop device link (ADR #54 §2.5).
		se.Router.POST("/api/v1/desktop/link/google/start", handleDesktopLinkStart(app))
		se.Router.GET("/api/v1/desktop/link/google/callback", handleDesktopLinkCallback(app))
		se.Router.POST("/api/v1/desktop/link/consume", handleDesktopLinkConsume(app))
		// The emailed-code alternative (ADR #54 §2.6): no browser, so the tablet can use it.
		se.Router.POST("/api/v1/desktop/link/email/request", handleDesktopLinkEmailRequest(app))
		se.Router.POST("/api/v1/desktop/link/email/consume", handleDesktopLinkEmailConsume(app))
		// Tablet device-code pairing (ADR #56 §2.5 / §5 Q1).
		se.Router.POST("/api/v1/pairing/start", handlePairingStart(app))
		se.Router.POST("/api/v1/pairing/claim", handlePairingClaim(app))
		se.Router.POST("/api/v1/pairing/poll", handlePairingPoll(app))
		// User dashboard (ADR #42 Phase 2) — session-authed read endpoints.
		se.Router.GET("/api/v1/web/usage", handleWebUsage(app))
		se.Router.GET("/api/v1/web/devices", handleWebDevices(app))
		// Linked sign-in methods (ADR #54).
		se.Router.GET("/api/v1/web/identities", handleWebIdentities(app))
		se.Router.DELETE("/api/v1/web/identities/{id}", handleWebUnlinkIdentity(app))
		se.Router.POST("/api/v1/web/devices/{id}/revoke", handleWebRevokeDevice(app))
		// Admin dashboard (ADR #42 Phase 3) — OZ_ADMIN_KEY gated.
		se.Router.GET("/api/v1/admin/tenants", handleAdminListTenants(app))
		se.Router.GET("/api/v1/admin/tenants/{id}", handleAdminGetTenant(app))
		se.Router.PATCH("/api/v1/admin/tenants/{id}", handleAdminUpdateTenant(app))
		se.Router.POST("/api/v1/admin/tenants/{id}/region", handleAdminSetRegion(app))
		// ADR #57 §Q-B: the release-channel pin store's read and write routes.
		// Admin-authored only — §Q-A makes an attacker who can append to the pin
		// set the failure this control exists to prevent.
		se.Router.GET("/api/v1/admin/release-channels/{channel}/pins", handleAdminGetReleasePins(app))
		se.Router.POST("/api/v1/admin/release-channels/{channel}/pins", handleAdminSetReleasePins(app))
		se.Router.POST("/api/v1/admin/tenants/{id}/activate", handleAdminActivate(app))
		se.Router.POST("/api/v1/admin/tenants/{id}/renew", handleAdminRenew(app))
		se.Router.POST("/api/v1/admin/tenants/{id}/revoke", handleAdminRevoke(app))
		se.Router.POST("/api/v1/admin/tenants/{id}/tier-override", handleAdminTierOverride(app))
		se.Router.POST("/api/v1/admin/tenants/{id}/grant-subscription", handleAdminGrantSubscription(app))
		// Phase D2: per-feature grant authoring (admin-only, OZ_ADMIN_KEY).
		se.Router.POST("/api/v1/admin/subscriptions/{id}/feature-grants", handleAdminSetFeatureGrants(app))
		se.Router.POST("/api/v1/admin/tenants/{id}/devices/{deviceId}/revoke", handleAdminRevokeDevice(app))
		se.Router.DELETE("/api/v1/admin/tenants/{id}", handleAdminDeleteTenant(app))
		se.Router.GET("/api/v1/admin/health", handleAdminHealth(app))
		// Admin dashboard stats (ADR #42 Phase 3+) — real aggregates.
		se.Router.GET("/api/v1/admin/stats", handleAdminStats(app))
		// Midtrans Snap checkout (see midtrans_checkout.go) — session-authed
		// web endpoint like /api/v1/web/*: the id-locale pricing button
		// requests a snap token for a tier + period, which Snap.js opens.
		se.Router.POST(midtransSnapPath, handleMidtransSnap(app))
		// Paddle Billing webhook — signature-verified, server-to-server (see
		// paddle_webhook.go). NOT behind the web CORS allowlist: Paddle sends
		// no Origin, and the Paddle-Signature header is the gate.
		se.Router.POST(paddleWebhookPath, handlePaddleWebhook(app))
		// Midtrans payment-notification webhook — signature-verified,
		// server-to-server (see midtrans_webhook.go). NOT behind the web CORS
		// allowlist: Midtrans sends no Origin, and the signature_key is the
		// gate.
		se.Router.POST(midtransWebhookPath, handleMidtransWebhook(app))
		// P8-2: Machine-level revocation is integrated into the /status
		// endpoint (send revoke:true with machine_id in the request body).
		// /api/health: PocketBase's built-in endpoint registers before this
		// hook, so it can't be replaced by re-registering the route; a root
		// middleware short-circuits it with our extended payload (health.go).
		bindHealthOverride(app, se)

		// ── Trial-to-paid email scheduler (C2.2, §4) ───────────────
		// Runs daily at 08:00 UTC to scan active trial subscriptions and
		// send milestone emails (day 7 weekly summary, day 14 last-day
		// warning). Idempotent: trial_email_log prevents double-sends.
		if err := ensureTrialEmailLogCollection(app); err != nil {
			log.Printf("warning: failed to create trial_email_log collection: %v", err)
		}
		// Federated identity links (ADR #54): created programmatically so a fresh
		// volume and an existing one take the same path.
		if err := ensureTenantIdentitiesCollection(app); err != nil {
			return err
		}
		if err := ensureIdentityEventsCollection(app); err != nil {
			return err
		}
		go startTrialEmailScheduler(app)

		// ── Auto-resume scanner (LSE-15) ───────────────────────────
		// Daily scan that resumes paused subscriptions whose pause window
		// has passed — extending expires_at and re-signing the payload,
		// exactly like a manual /resume call.
		go startAutoResumeScanner(app)

		// ── Admin password rotation reminder (ADR #42 security) ────
		// Emails the superuser when the admin password is older than 120
		// days, repeating every 30 days until changed. The hook stamps
		// password_changed_at on every detected hash change; the daily
		// scheduler sends the reminder. Idempotent via last_reminder_at.
		if err := ensurePasswordRotationStateCollection(app); err != nil {
			log.Printf("warning: failed to create password_rotation_state collection: %v", err)
		}
		bindPasswordRotationHook(app)
		go startPasswordRotationScheduler(app)

		// ── Build-integrity alert scanner (ADR #57 §2.4) ───────────
		// The READER half of ADR #57: §2.1 ships the reporting and the
		// server classifies every report, so without this the verdicts are
		// a log nobody reads. Daily at 08:00 UTC, the same rhythm as the
		// password reminder. It never locks a device — §Q4 routes every
		// finding to this human rather than to an automatic refusal —
		// and it re-alerts at most weekly per tenant and condition.
		go startBuildIntegrityScheduler(app)

		// ── Root → PocketBase admin UI redirect ───────────────────
		// The bare domain (https://license.kasir.mu) 301-redirects to
		// the PocketBase admin console at /_/ — which then auto-navigates
		// to #/login when no session exists. Done server-side so the
		// redirect can't be confused with a proxy loop (Cloudflare Page
		// Rules reject this exact target for that reason).
		se.Router.BindFunc(func(e *core.RequestEvent) error {
			if e.Request.URL.Path == "/" || e.Request.URL.Path == "" {
				return e.Redirect(http.StatusMovedPermanently, "/_/")
			}
			return e.Next()
		})

		return se.Next()
	})

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}

// ensureSuperuserOnlyRules normalizes an existing collection's API rules to
// superuser-only (nil). LSE-5 repair: several older migrations created
// collections with empty-string rules under the assumption that "" meant
// "server-only" — in PocketBase the semantics are the opposite: a nil rule
// means superuser-only, while an EMPTY STRING rule means EVERYBODY
// (including unauthenticated guests) through the generic
// /api/collections/{name}/records endpoints. Any deployment whose
// trial_registrations / trial_claims / enterprise_approvals /
// trial_email_log / password_rotation_state collections were created by
// those migrations exposed rows to anonymous read/write; this repair runs
// idempotently on every boot (schema-fresh collections already have all-nil
// rules and no-op here).
func ensureSuperuserOnlyRules(app core.App, coll *core.Collection) error {
	if coll.ListRule == nil && coll.ViewRule == nil && coll.CreateRule == nil &&
		coll.UpdateRule == nil && coll.DeleteRule == nil {
		return nil // already superuser-only
	}
	coll.ListRule = nil
	coll.ViewRule = nil
	coll.CreateRule = nil
	coll.UpdateRule = nil
	coll.DeleteRule = nil
	if err := app.Save(coll); err != nil {
		return fmt.Errorf("failed to normalize %s API rules to superuser-only: %w", coll.Name, err)
	}
	log.Printf("migrated: normalized %s API rules to superuser-only (LSE-5 repair: empty-string rules were PUBLIC)", coll.Name)
	return nil
}

// ensureCollections verifies that every business collection the license API
// depends on exists, importing the embedded pb_schema.json on first boot
// when any is missing (idempotent). Without this, a fresh deployment boots
// "healthy" but every /activate, /renew, and /status call fails with
// "collections not found" until an operator manually imports the schema.
//
// ImportCollectionsByMarshaledJSON runs in a single transaction; deleteMissing
// is false so existing collections are never dropped.
func ensureCollections(app core.App) error {
	for _, name := range requiredCollections {
		if _, err := app.FindCollectionByNameOrId(name); err == nil {
			continue // collection already exists
		}
		// At least one required collection is missing — import the full
		// embedded schema (idempotent for the collections that exist).
		log.Printf("missing required collection %q — importing pb_schema.json", name)
		if err := app.ImportCollectionsByMarshaledJSON(pbSchemaJSON, false); err != nil {
			return fmt.Errorf("failed to auto-import pb_schema.json: %w", err)
		}
		return nil
	}
	return nil
}

// ensureAPIKeyLookupField adds the `api_key_lookup` field (and its unique
// partial index) to the tenants collection if it doesn't exist yet.
//
// Fresh deployments receive the field via the embedded pb_schema.json. This
// migration covers pb_data volumes created before api_key hashing, so the
// deterministic lookup column used by findTenantByAPIKey is always present.
// The index is partial (excluding empty values) so legacy rows that haven't
// been lazily migrated yet don't collide on the empty string.
func ensureAPIKeyLookupField(app core.App) error {
	collection, err := app.FindCollectionByNameOrId("tenants")
	if err != nil {
		return fmt.Errorf("tenants collection not found: %w", err)
	}
	if collection.Fields.GetByName("api_key_lookup") != nil {
		return nil
	}
	collection.Fields.Add(&core.TextField{Name: "api_key_lookup", Hidden: true})
	collection.Indexes = append(collection.Indexes,
		"CREATE UNIQUE INDEX idx_tenants_api_key_lookup ON tenants (api_key_lookup) WHERE api_key_lookup IS NOT NULL AND api_key_lookup != ''")
	if err := app.Save(collection); err != nil {
		return fmt.Errorf("failed to add api_key_lookup field: %w", err)
	}
	log.Println("migrated tenants collection: added api_key_lookup field + unique partial index")
	return nil
}

// ensureRegionField adds the tenants.region select field to existing
// deployments that predate it (fresh boots get it from the embedded
// pb_schema.json). Idempotent: no-op once the field exists.
//
// ADR #59 §2.1a sequencing step 1: the tenants collection had NO region field
// at all. The value is the RESIDENCY axis (a deployment selector from the
// closed RegionCode set in kasirmu-core/src/regional.rs) and is deliberately
// not an ISO-3166 market code — the market anchor lives on the tenant's own
// database as legal_entities.country_code.
//
// Existing records are backfilled to `global`, which is the launch
// region and means "no residency commitment yet" (ADR #59 §Q6) — the correct
// semantics for every tenant that predates the field, since no other region
// has ever existed. PocketBase does not apply a select field's default to
// existing rows, so the backfill is explicit.
func ensureRegionField(app core.App) error {
	collection, err := app.FindCollectionByNameOrId("tenants")
	if err != nil {
		return fmt.Errorf("tenants collection not found: %w", err)
	}
	if collection.Fields.GetByName("region") == nil {
		collection.Fields.Add(&core.SelectField{
			Name:      "region",
			MaxSelect: 1,
			Values:    []string{regionGlobal},
			Help:      regionFieldHelp,
		})
		if err := app.Save(collection); err != nil {
			return fmt.Errorf("failed to add region field: %w", err)
		}
		log.Println("migrated tenants collection: added region field")
	}
	return backfillTenantRegions(app)
}

// backfillTenantRegions sets region = `global` on any tenants row that has
// no region yet. Separate from ensureRegionField so it also repairs rows a
// partial migration left blank, and so it is idempotent on its own.
//
// Records are read and saved one at a time rather than by raw SQL: PocketBase
// owns this schema, and going around it with an UPDATE would bypass whatever
// record validation the collection carries.
func backfillTenantRegions(app core.App) error {
	records, err := app.FindAllRecords("tenants")
	if err != nil {
		return fmt.Errorf("failed to list tenants for region backfill: %w", err)
	}
	backfilled := 0
	for _, rec := range records {
		if strings.TrimSpace(rec.GetString("region")) != "" {
			continue
		}
		rec.Set("region", regionGlobal)
		if err := app.Save(rec); err != nil {
			return fmt.Errorf("failed to backfill region for tenant %s: %w", rec.Id, err)
		}
		backfilled++
	}
	if backfilled > 0 {
		log.Printf("migrated tenants collection: backfilled region=%s on %d tenant(s)", regionGlobal, backfilled)
	}
	return nil
}

// regionGlobal is the only residency region at launch (ADR #59 §Q6). It mirrors
// RegionCode::Global in kasirmu-core/src/regional.rs and the values list in the
// embedded pb_schema.json; three spellings of one region would be a routing bug
// that looks like a data bug, so the literal is named once per process.
const regionGlobal = "global"

// regionFieldHelp documents the residency axis on the schema itself, so the
// distinction from the market anchor survives a reader who never opens ADR #59.
//
// Deliberately short: PocketBase caps a field's help string at 300 characters,
// and that cap is load-bearing here — expanding this text is what broke the
// migration the first time it ran. The full ruling is in ADR #59 §2.2/§Q2; this
// is the pointer, not a copy of it.
const regionFieldHelp = "Residency (which deployment holds this tenant's data), NOT the market anchor " +
	"— that is legal_entities.country_code. Closed set, admin-only (ADR #59 §2.2/§Q2)."

// ensureEmailVerifiedField adds the tenants.email_verified bool to existing
// deployments that predate it (fresh boots get it from the embedded
// pb_schema.json). Idempotent: no-op once the field exists. Existing
// records default to false — which is the correct semantics (only
// verify-otp flips it to true).
func ensureEmailVerifiedField(app core.App) error {
	collection, err := app.FindCollectionByNameOrId("tenants")
	if err != nil {
		return fmt.Errorf("tenants collection not found: %w", err)
	}
	if collection.Fields.GetByName("email_verified") != nil {
		return nil
	}
	collection.Fields.Add(&core.BoolField{
		Name: "email_verified",
		Help: "True once the tenant has completed OTP verification (verify-otp). Set false on self-signup and on webhook-created tenants; the dashboard shows this state.",
	})
	if err := app.Save(collection); err != nil {
		return fmt.Errorf("failed to add email_verified field: %w", err)
	}
	log.Println("migrated tenants collection: added email_verified field")
	return nil
}

// ensurePasswordHashField adds the hidden tenants.password_hash text field
// to existing deployments that predate password login (fresh boots get it
// from the embedded pb_schema.json). Idempotent: no-op once the field
// exists. Existing records keep an empty password_hash — the correct
// semantics, since only the account holder (via an authenticated session)
// can set one.
func ensurePasswordHashField(app core.App) error {
	collection, err := app.FindCollectionByNameOrId("tenants")
	if err != nil {
		return fmt.Errorf("tenants collection not found: %w", err)
	}
	if collection.Fields.GetByName("password_hash") != nil {
		return nil
	}
	collection.Fields.Add(&core.TextField{
		Name:   "password_hash",
		Hidden: true,
		Help:   "Bcrypt hash of the optional web login password (set via the account dashboard). Empty for OTP-only accounts; login-with-password requires this field.",
	})
	if err := app.Save(collection); err != nil {
		return fmt.Errorf("failed to add password_hash field: %w", err)
	}
	log.Println("migrated tenants collection: added password_hash field")
	return nil
}

// warnAdminTenantState reports (once per boot, read-only) whether the
// deployment's admin identity has the tenants row the admin reservation
// guard now hard-requires. createTenant refuses self-signup for the admin
// email on every registration path, so the row can only exist if it was
// provisioned out of band (Paddle webhook, seed, or manual creation):
//   - missing row: the owner cannot provision the account themselves and
//     adminAuth has nothing to map a session to — fix out of band.
//   - row with email_verified=false: login never reads the flag, so an
//     unverified admin row is exactly what a pre-guard self-signup squat
//     looks like; verify inbox ownership or rotate its password before
//     trusting admin access.
//
// This logs and returns; it NEVER creates or edits a row and never fails
// boot — unlike the ensure* migrations above, there is nothing to repair
// automatically and a missing admin row is an operator decision.
func warnAdminTenantState(app core.App) {
	adminEmail := strings.TrimSpace(os.Getenv("OZ_ADMIN_EMAIL"))
	if adminEmail == "" {
		adminEmail = defaultAdminEmail
	}
	// Stored emails are lowercase (normalizeEmail at every write path).
	tenant, _ := app.FindFirstRecordByData("tenants", "email", strings.ToLower(adminEmail))
	if tenant == nil {
		log.Printf("WARNING: no tenants row for the admin identity %q — self-signup for it is refused, so provision it out of band (Paddle webhook or manual creation) before the owner can sign in", adminEmail)
		return
	}
	if !tenant.GetBool("email_verified") {
		log.Printf("WARNING: the admin tenants row for %q exists but is not email_verified — if this row was not provisioned deliberately, treat it as a possible pre-guard self-signup squat (verify inbox ownership via verify-otp or rotate its password)", adminEmail)
	}
}

// ensurePasswordResetAtField adds the tenants.password_reset_at date field
// to existing deployments that predate the forgot-password flow (fresh
// boots get it from the embedded pb_schema.json). Idempotent: no-op once
// the field exists. Existing records keep a zero value — the correct
// semantics, since the 7-day reset cooldown only starts after a completed
// reset (see web_password.go).
func ensurePasswordResetAtField(app core.App) error {
	collection, err := app.FindCollectionByNameOrId("tenants")
	if err != nil {
		return fmt.Errorf("tenants collection not found: %w", err)
	}
	if collection.Fields.GetByName("password_reset_at") != nil {
		return nil
	}
	collection.Fields.Add(&core.DateField{Name: "password_reset_at"})
	if err := app.Save(collection); err != nil {
		return fmt.Errorf("failed to add password_reset_at field: %w", err)
	}
	log.Println("migrated tenants collection: added password_reset_at field")
	return nil
}

// ensureIsTrialField adds the license_keys.is_trial bool to existing
// deployments that predate segmented trials (fresh boots get it from the
// embedded pb_schema.json). Idempotent: no-op once the field exists.
// Existing records default to false — the correct semantics, since only
// trial keys minted going forward are marked (paid keys never are).
func ensureIsTrialField(app core.App) error {
	collection, err := app.FindCollectionByNameOrId("license_keys")
	if err != nil {
		return fmt.Errorf("license_keys collection not found: %w", err)
	}
	if collection.Fields.GetByName("is_trial") != nil {
		return nil
	}
	collection.Fields.Add(&core.BoolField{
		Name: "is_trial",
		Help: "True for segmented-trial keys (C2.1): activation mints a short Plus/Pro license from the request's trial_vertical instead of the key's own tier/expiry/quota. Paid keys leave this unset.",
	})
	if err := app.Save(collection); err != nil {
		return fmt.Errorf("failed to add is_trial field: %w", err)
	}
	log.Println("migrated license_keys collection: added is_trial field")
	return nil
}

// ensureMidtransFields adds the midtrans_sub_id / midtrans_order_id text
// fields to license_keys and subscriptions for existing deployments that
// predate the Midtrans webhook (fresh boots get them from the embedded
// pb_schema.json). Idempotent: no-op once both fields exist. Existing
// records keep empty values — they were minted by the Paddle webhook.
func ensureMidtransFields(app core.App) error {
	for _, name := range []string{"license_keys", "subscriptions"} {
		collection, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			return fmt.Errorf("%s collection not found: %w", name, err)
		}
		if collection.Fields.GetByName("midtrans_sub_id") != nil && collection.Fields.GetByName("midtrans_order_id") != nil {
			continue
		}
		if collection.Fields.GetByName("midtrans_sub_id") == nil {
			collection.Fields.Add(&core.TextField{
				Name: "midtrans_sub_id",
				Max:  100,
				Help: "Midtrans Subscription API subscription id this record mirrors — the lookup key for recurring-charge refreshes.",
			})
		}
		if collection.Fields.GetByName("midtrans_order_id") == nil {
			collection.Fields.Add(&core.TextField{
				Name: "midtrans_order_id",
				Max:  100,
				Help: "Midtrans order_id of the most recent charge that provisioned/refreshed this record.",
			})
		}
		if err := app.Save(collection); err != nil {
			return fmt.Errorf("failed to add midtrans fields to %s: %w", name, err)
		}
		log.Printf("migrated %s collection: added midtrans_sub_id / midtrans_order_id fields", name)
	}
	return nil
}

// ensureManualPaymentProvider appends "manual" to the payment_provider
// select values on license_keys and subscriptions (admin dashboard grants
// for transfer-paid customers, ADR #42 Phase 4). Deployments whose field
// was created by ensurePaymentProviderField carry only paddle|midtrans;
// fresh boots get all three from the embedded pb_schema.json. Idempotent.
func ensureManualPaymentProvider(app core.App) error {
	for _, name := range []string{"license_keys", "subscriptions"} {
		collection, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			return fmt.Errorf("%s collection not found: %w", name, err)
		}
		field, ok := collection.Fields.GetByName("payment_provider").(*core.SelectField)
		if !ok {
			continue // field absent — ensurePaymentProviderField adds it
		}
		known := false
		for _, v := range field.Values {
			if v == "manual" {
				known = true
				break
			}
		}
		if known {
			continue
		}
		field.Values = append(field.Values, "manual")
		if err := app.Save(collection); err != nil {
			return fmt.Errorf("failed to add manual to %s payment_provider: %w", name, err)
		}
		log.Printf("migrated %s collection: payment_provider now accepts manual grants", name)
	}
	return nil
}

// ensurePaymentProviderField adds the payment_provider select field
// ("paddle" | "midtrans") to license_keys and subscriptions for existing
// deployments that predate the Midtrans webhook (fresh boots get it from the
// embedded pb_schema.json). Idempotent: no-op once the field exists. Existing
// records backfill to "paddle" — everything before Midtrans was Paddle-minted;
// the webhooks set the value explicitly going forward.
func ensurePaymentProviderField(app core.App) error {
	for _, name := range []string{"license_keys", "subscriptions"} {
		collection, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			return fmt.Errorf("%s collection not found: %w", name, err)
		}
		if collection.Fields.GetByName("payment_provider") == nil {
			collection.Fields.Add(&core.SelectField{
				Name:      "payment_provider",
				Values:    []string{"paddle", "midtrans"},
				MaxSelect: 1,
				Help:      "Billing provider that issued this record: \"paddle\" (global, USD cards) or \"midtrans\" (Indonesian QRIS/VA/e-wallet, fixed IDR). Backfilled to paddle for pre-Midtrans records.",
			})
			if err := app.Save(collection); err != nil {
				return fmt.Errorf("failed to add payment_provider to %s: %w", name, err)
			}
			log.Printf("migrated %s collection: added payment_provider field", name)
		}

		// Backfill existing records (a deployment that already had the field
		// never needs this — webhooks always set it).
		records, err := app.FindAllRecords(name)
		if err != nil {
			return fmt.Errorf("failed to list %s for payment_provider backfill: %w", name, err)
		}
		for _, rec := range records {
			if rec.GetString("payment_provider") == "" {
				rec.Set("payment_provider", "paddle")
				if err := app.Save(rec); err != nil {
					return fmt.Errorf("failed to backfill payment_provider for %s %q: %w", name, rec.Id, err)
				}
			}
		}
		if len(records) > 0 {
			log.Printf("migrated %s collection: backfilled payment_provider=paddle on %d record(s)", name, len(records))
		}
	}
	return nil
}

// ensureBundleIDField adds the license_keys / subscriptions bundle_id text
// field for existing deployments that predate the vertical-bundle checkout
// (fresh boots get it from the embedded pb_schema.json). Idempotent: no-op
// once the field exists. Existing records keep empty values — the webhook
// sets it at mint for bundle purchases and refresh falls back to it on
// renewals.
func ensureBundleIDField(app core.App) error {
	for _, name := range []string{"license_keys", "subscriptions"} {
		collection, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			return fmt.Errorf("%s collection not found: %w", name, err)
		}
		if collection.Fields.GetByName("bundle_id") != nil {
			continue
		}
		collection.Fields.Add(&core.TextField{
			Name: "bundle_id",
			Max:  64,
			Help: "Vertical-bundle id (subscription-tiers.md §3, C3.2) this license was purchased with — \"restaurant_starter\" widens the Plus quota block with the kds workspace type. Set at webhook mint; renewals fall back to it when the charge notification carries no bundle.",
		})
		if err := app.Save(collection); err != nil {
			return fmt.Errorf("failed to add bundle_id to %s: %w", name, err)
		}
		log.Printf("migrated %s collection: added bundle_id field", name)
	}
	return nil
}

// ensureTrialRegistrations creates the trial_registrations collection for
// deployments that predate the hardware-fingerprint trial lock
// (SPEC-2026-TRIAL-LOCK). Fresh boots get it from the embedded
// pb_schema.json; this is the idempotent in-place upgrade for already-
// provisioned pb_data volumes so POST /api/v1/license/trial and the
// activation-time trial gate always find their collection.
func ensureTrialRegistrations(app core.App) error {
	if existing, err := app.FindCollectionByNameOrId("trial_registrations"); err == nil {
		// LSE-5 repair: normalize legacy empty-string (PUBLIC) rules.
		return ensureSuperuserOnlyRules(app, existing)
	}
	coll := core.NewBaseCollection("trial_registrations")
	// LSE-6: resolve the relation target dynamically — the schema stores a
	// collection ID (e.g. 64d11bd2cc57a18), not the name; a literal
	// "tenants" fails relation validation whenever this creator path
	// actually runs (production usually pre-creates the collection via the
	// embedded schema import instead).
	tenantsColl, err := app.FindCollectionByNameOrId("tenants")
	if err != nil {
		return fmt.Errorf("tenants collection not found (required before creating trial_registrations): %w", err)
	}
	coll.Fields.Add(&core.TextField{Name: "hardware_fingerprint", Required: true, Max: 128})
	coll.Fields.Add(&core.DateField{Name: "first_seen_at", Required: true})
	coll.Fields.Add(&core.DateField{Name: "trial_expires_at", Required: true})
	coll.Fields.Add(&core.SelectField{Name: "platform", Required: true, Values: []string{"windows", "android", "linux", "macos", "unknown"}, MaxSelect: 1})
	coll.Fields.Add(&core.TextField{Name: "app_version", Required: true, Max: 32})
	coll.Fields.Add(&core.RelationField{Name: "tenant_id", CollectionId: tenantsColl.Id, MaxSelect: 1})
	coll.Fields.Add(&core.TextField{Name: "ip_address", Max: 64})
	coll.Indexes = append(coll.Indexes,
		"CREATE UNIQUE INDEX idx_trial_registrations_hw ON trial_registrations (hardware_fingerprint) WHERE hardware_fingerprint IS NOT NULL AND hardware_fingerprint != ''")
	// Superuser-only (LSE-5): a nil rule means superusers only; the old
	// empty-string rules meant PUBLIC guest access.
	coll.CreateRule = nil
	coll.ListRule = nil
	coll.ViewRule = nil
	coll.UpdateRule = nil
	if err := app.Save(coll); err != nil {
		return fmt.Errorf("failed to create trial_registrations collection: %w", err)
	}
	log.Println("migrated: created trial_registrations collection (hardware-fingerprint trial lock)")
	return nil
}

// ensureTrialClaims creates the trial_claims collection for deployments
// that predate the lightweight repeat-email detector (hash of email +
// device id, recorded per successful trial claim — see recordTrialClaim in
// trial.go). Fresh boots get it from the embedded pb_schema.json; this is
// the idempotent in-place upgrade for already-provisioned pb_data volumes.
// ensureAddonsField adds the addons JSON array field to license_keys
// (C4.3 add-on marketplace). Idempotent — skips if the field already exists.
func ensureAddonsField(app core.App) error {
	collection, err := app.FindCollectionByNameOrId("license_keys")
	if err != nil {
		return fmt.Errorf("license_keys collection not found: %w", err)
	}
	if collection.Fields.GetByName("addons") != nil {
		return nil // already exists
	}
	collection.Fields.Add(&core.TextField{
		Name: "addons",
		Max:  1024,
		Help: "C4.3: JSON array of add-on identifiers purchased with this license.",
	})
	if err := app.Save(collection); err != nil {
		return fmt.Errorf("failed to add addons to license_keys: %w", err)
	}
	log.Println("migrated license_keys collection: added addons field")
	return nil
}

// ensureEnterpriseApprovals creates the enterprise_approvals collection for
// storing approval codes used by the enterprise self-serve trial (C4.2, §19).
// Codes are generated by the admin endpoint and redeemed by prospects.
func ensureEnterpriseApprovals(app core.App) error {
	if existing, err := app.FindCollectionByNameOrId("enterprise_approvals"); err == nil {
		// LSE-5 repair: legacy migrations left listRule/viewRule as an
		// empty string — PUBLIC guest reads of the approval codes.
		return ensureSuperuserOnlyRules(app, existing)
	}
	coll := core.NewBaseCollection("enterprise_approvals")
	coll.Fields.Add(&core.TextField{Name: "code", Required: true, Max: 64, Min: 8})
	coll.Fields.Add(&core.TextField{Name: "email", Max: 254})
	coll.Fields.Add(&core.TextField{Name: "prospect_name", Max: 256})
	coll.Fields.Add(&core.SelectField{Name: "status", Required: true, Values: []string{"unused", "redeemed", "expired"}, MaxSelect: 1})
	coll.Fields.Add(&core.TextField{Name: "created_by", Max: 256})
	// Superuser-only (LSE-5): nil rules; the old empty-string list/view
	// rules exposed every approval code to anonymous reads.
	coll.ListRule = nil
	coll.ViewRule = nil
	coll.CreateRule = nil // only server-side
	coll.UpdateRule = nil
	coll.DeleteRule = nil
	coll.Indexes = append(coll.Indexes,
		"CREATE UNIQUE INDEX idx_enterprise_approvals_code ON enterprise_approvals (code)",
		"CREATE INDEX idx_enterprise_approvals_status ON enterprise_approvals (status)")
	if err := app.Save(coll); err != nil {
		return fmt.Errorf("failed to create enterprise_approvals collection: %w", err)
	}
	log.Println("migrated: created enterprise_approvals collection (enterprise self-serve trial)")
	return nil
}

// ensureTenantRegionEvents creates the durable audit collection for residency
// moves (ADR #59 §2.1a step 3).
//
// Why a row and not just the log line handleAdminUpdateTenant emits: a region
// change moves where a tenant's DATA lives, so "why did this tenant's data
// move" is precisely the question an incident review asks — and a log line is
// rotated away while the answer must outlive the deploy that produced it. The
// row records actor, from-region, to-region and the reason.
//
// Superuser-only (LSE-5): the rules are nil, NOT the empty string. An empty
// string is PUBLIC in PocketBase, which is exactly the repair
// ensureSuperuserOnlyRules exists to apply to older collections — so a new
// collection must never be born with one.
func ensureTenantRegionEvents(app core.App) error {
	if existing, err := app.FindCollectionByNameOrId(tenantRegionEventsCollection); err == nil {
		return ensureSuperuserOnlyRules(app, existing)
	}
	tenantsColl, err := app.FindCollectionByNameOrId("tenants")
	if err != nil {
		return fmt.Errorf("tenants collection not found (required before creating %s): %w", tenantRegionEventsCollection, err)
	}
	coll := core.NewBaseCollection(tenantRegionEventsCollection)
	coll.Fields.Add(&core.RelationField{Name: "tenant_id", Required: true, CollectionId: tenantsColl.Id, MaxSelect: 1})
	// The actor is whoever held the admin credential when the move ran. Stored
	// as the resolved agent string rather than a user id, because admin auth is
	// a shared key or an admin-tenant session and neither is a stable user row.
	coll.Fields.Add(&core.TextField{Name: "actor", Required: true, Max: 256})
	coll.Fields.Add(&core.TextField{Name: "from_region", Max: 64})
	coll.Fields.Add(&core.TextField{Name: "to_region", Required: true, Max: 64})
	coll.Fields.Add(&core.TextField{Name: "reason", Required: true, Max: 1024})
	// created/updated are NOT implicit on a programmatically-built collection —
	// unlike the JSON schema import, NewBaseCollection starts with only the id.
	// The index below references created, so the fields must be added first;
	// omitting them is what made the first version of this migration fail with
	// "no such column: created".
	coll.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	coll.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	coll.ListRule = nil
	coll.ViewRule = nil
	coll.CreateRule = nil
	coll.UpdateRule = nil
	coll.DeleteRule = nil
	// Append-only by convention: no endpoint exposes an update or delete. The
	// index makes "what happened to this tenant" a cheap query, which is the
	// only read the collection is for.
	coll.Indexes = append(coll.Indexes,
		"CREATE INDEX idx_tenant_region_events_tenant ON tenant_region_events (tenant_id, created)")
	if err := app.Save(coll); err != nil {
		return fmt.Errorf("failed to create %s collection: %w", tenantRegionEventsCollection, err)
	}
	log.Printf("migrated: created %s collection (ADR #59 region-change audit trail)", tenantRegionEventsCollection)
	return nil
}

// tenantRegionEventsCollection is the audit collection name, named once so the
// writer, the migration and the tests cannot drift apart.
const tenantRegionEventsCollection = "tenant_region_events"

// recordRegionChange appends one durable audit row for a residency move.
//
// Best-effort by design, and the direction matters: the field write has already
// committed by the time this runs, so failing the request here would report an
// error for a change that DID happen — the operator would retry and see an
// idempotent no-op, which is a worse lie than a missing audit line. The loss is
// logged instead, so it is visible rather than silent.
//
// The same reasoning ADR #59 §2.1a uses for the ordering applies: record the
// reason before flipping the pointer, never after.
func recordRegionChange(app core.App, tenantID, actor, from, to, reason string) {
	coll, err := app.FindCollectionByNameOrId(tenantRegionEventsCollection)
	if err != nil {
		log.Printf("region audit: collection %s unavailable, event dropped (tenant=%s %s→%s reason=%q): %v",
			tenantRegionEventsCollection, tenantID, from, to, reason, err)
		return
	}
	rec := core.NewRecord(coll)
	rec.Set("tenant_id", tenantID)
	rec.Set("actor", actor)
	rec.Set("from_region", from)
	rec.Set("to_region", to)
	rec.Set("reason", reason)
	if err := app.Save(rec); err != nil {
		log.Printf("region audit: failed to record tenant=%s %s→%s (reason=%q): %v",
			tenantID, from, to, reason, err)
	}
}

// releaseChannelsCollection holds the accepted APK signing-certificate pins
// per release channel (ADR #57 §Q-B option A).
//
// The name is a const so the migration, the admin writer and the tests cannot
// drift apart — the same discipline `tenantRegionEventsCollection` follows.
const releaseChannelsCollection = "release_channels"

// ensureReleaseChannels creates the release-channel pin store (ADR #57 §Q-B).
//
// **Why this collection exists.** ADR #57 §2.1 says the server compares a
// reported fingerprint "against the fingerprint(s) *it* holds for that tenant
// release channel" — but §Q-B found that phrase appeared nowhere else in the
// repository, so as originally written the comparison was against data nothing
// produced. This is that store. §Q-B chose a channel-keyed record over a
// per-tenant field because a keystore rotation is then ONE write rather than an
// N-tenant coordinated update.
//
// **The pin is a SET, not a scalar** (§Q-A option B): during a keystore
// rotation both the outgoing and incoming certificate must verify, so the field
// is a JSON array. A scalar would make rotation an outage.
//
// **Not an unbounded allow-list.** §Q-A is explicit that an attacker who could
// append to this set would have defeated §2.1, so membership is admin-authored
// only: this collection is superuser-only (nil rules) and no public endpoint
// touches it. The bound on set SIZE is enforced by the admin write path rather
// than by a schema constraint, because PocketBase's JSON field has no length
// rule; see `handleAdminSetReleasePins`.
//
// **Empty is meaningful, and means Unknown rather than Mismatch.** A channel
// with no pins has made no claim about the build, and
// `classify_build_fingerprint` (kasirmu-core) reads an empty accepted set as
// `Unknown` on purpose — treating it as a mismatch would refuse renewal for
// every tenant on a channel nobody has pinned yet.
func ensureReleaseChannels(app core.App) error {
	if existing, err := app.FindCollectionByNameOrId(releaseChannelsCollection); err == nil {
		return ensureSuperuserOnlyRules(app, existing)
	}
	coll := core.NewBaseCollection(releaseChannelsCollection)
	// The channel name. Today there is exactly one release keystore, so this is
	// a set of one — the indirection is chosen for the rotation path, not for a
	// multiplicity that exists yet.
	coll.Fields.Add(&core.TextField{Name: "channel", Required: true, Max: 64})
	// JSON array of accepted SHA-256 signing-certificate fingerprints. Stored as
	// JSON rather than a relation so a rotation is one atomic field write.
	coll.Fields.Add(&core.JSONField{Name: "accepted_pins", MaxSize: 64 * 1024})
	// Free-text note recording WHY the current set is what it is (e.g. "rotated
	// 2026-09-21, old cert kept until v0.0.40 is fully rolled out"). The next
	// operator reading a surprising pin needs this, and §Q-A's rotation clause is
	// unactionable without it.
	coll.Fields.Add(&core.TextField{Name: "note", Max: 1024})
	// The actor who last wrote the set, resolved the same way the region audit
	// resolves it (a shared key or an admin-tenant session — neither is a stable
	// user row).
	coll.Fields.Add(&core.TextField{Name: "updated_by", Max: 256})
	// created/updated are NOT implicit on a programmatically-built collection —
	// unlike a JSON schema import, NewBaseCollection starts with only the id. The
	// index below references created, so these must be added first; omitting them
	// is what made the region-audit migration fail with "no such column: created".
	coll.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	coll.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	// Superuser-only. An empty-string rule would mean PUBLIC in PocketBase (LSE-5),
	// which on this collection would let anyone append a pin and defeat §2.1.
	coll.ListRule = nil
	coll.ViewRule = nil
	coll.CreateRule = nil
	coll.UpdateRule = nil
	coll.DeleteRule = nil
	// One row per channel: the upsert in the admin writer relies on this.
	coll.Indexes = append(coll.Indexes,
		"CREATE UNIQUE INDEX idx_release_channels_channel ON release_channels (channel)")
	if err := app.Save(coll); err != nil {
		return fmt.Errorf("failed to create %s collection: %w", releaseChannelsCollection, err)
	}
	log.Printf("migrated: created %s collection (ADR #57 §Q-B release-channel pin store)", releaseChannelsCollection)
	return nil
}

func ensureTrialClaims(app core.App) error {
	if existing, err := app.FindCollectionByNameOrId("trial_claims"); err == nil {
		// LSE-5 repair: normalize legacy empty-string (PUBLIC) rules —
		// they exposed claim emails, device ids, and trial keys.
		return ensureSuperuserOnlyRules(app, existing)
	}
	coll := core.NewBaseCollection("trial_claims")
	// LSE-6: resolve the relation target dynamically (see
	// ensureTrialRegistrations) — a literal "tenants" fails relation
	// validation because the schema stores a collection ID.
	tenantsColl, err := app.FindCollectionByNameOrId("tenants")
	if err != nil {
		return fmt.Errorf("tenants collection not found (required before creating trial_claims): %w", err)
	}
	coll.Fields.Add(&core.TextField{Name: "claim_hash", Required: true, Pattern: "^[a-f0-9]{64}$", Min: 64, Max: 64})
	coll.Fields.Add(&core.TextField{Name: "email", Required: true, Max: 320})
	coll.Fields.Add(&core.TextField{Name: "device_id", Required: true, Max: 128})
	coll.Fields.Add(&core.RelationField{Name: "tenant_id", CollectionId: tenantsColl.Id, MaxSelect: 1})
	coll.Fields.Add(&core.NumberField{Name: "claim_count", Required: true, Min: types.Pointer(1.0), OnlyInt: true})
	coll.Fields.Add(&core.DateField{Name: "first_claimed_at", Required: true})
	coll.Fields.Add(&core.DateField{Name: "last_claimed_at", Required: true})
	coll.Fields.Add(&core.TextField{Name: "trial_keys", Max: 2048})
	coll.Indexes = append(coll.Indexes,
		"CREATE UNIQUE INDEX idx_trial_claims_hash ON trial_claims (claim_hash) WHERE claim_hash IS NOT NULL AND claim_hash != ''")
	// Superuser-only (LSE-5): nil rules; "" would be PUBLIC guest access.
	coll.CreateRule = nil
	coll.ListRule = nil
	coll.ViewRule = nil
	coll.UpdateRule = nil
	if err := app.Save(coll); err != nil {
		return fmt.Errorf("failed to create trial_claims collection: %w", err)
	}
	log.Println("migrated: created trial_claims collection (lightweight repeat-email detector)")
	return nil
}

// ensurePauseFields adds the paused status value and paused_at/paused_until
// date fields to the subscriptions collection for existing deployments that
// predate the pause-subscription feature (C3.3). Fresh boots get these from
// the embedded pb_schema.json.
func ensurePauseFields(app core.App) error {
	collection, err := app.FindCollectionByNameOrId("subscriptions")
	if err != nil {
		return fmt.Errorf("subscriptions collection not found: %w", err)
	}

	// Add "paused" to the status select if not present
	statusField, ok := collection.Fields.GetByName("status").(*core.SelectField)
	if ok {
		hasPaused := false
		for _, v := range statusField.Values {
			if v == "paused" {
				hasPaused = true
				break
			}
		}
		if !hasPaused {
			statusField.Values = append(statusField.Values, "paused")
			if err := app.Save(collection); err != nil {
				return fmt.Errorf("failed to add paused status to subscriptions: %w", err)
			}
			log.Println("migrated: added paused status to subscriptions.status select")
		}
	}

	// Add paused_at field if not present
	if collection.Fields.GetByName("paused_at") == nil {
		collection.Fields.Add(&core.DateField{
			Name:     "paused_at",
			Required: false,
			Help:     "When the subscription was paused (C3.3).",
		})
		if err := app.Save(collection); err != nil {
			return fmt.Errorf("failed to add paused_at to subscriptions: %w", err)
		}
		log.Println("migrated: added paused_at field to subscriptions")
	}

	// Add paused_until field if not present
	if collection.Fields.GetByName("paused_until") == nil {
		collection.Fields.Add(&core.DateField{
			Name:     "paused_until",
			Required: false,
			Help:     "When the pause expires and billing resumes (C3.3).",
		})
		if err := app.Save(collection); err != nil {
			return fmt.Errorf("failed to add paused_until to subscriptions: %w", err)
		}
		log.Println("migrated: added paused_until field to subscriptions")
	}

	return nil
}

// ensureTenantMachinesHardwareFingerprint adds the hardware_fingerprint text field
// to tenant_machines for machine attestation (ADR #58 §2.4). Idempotent.
func ensureTenantMachinesHardwareFingerprint(app core.App) error {
	collection, err := app.FindCollectionByNameOrId("tenant_machines")
	if err != nil {
		return nil
	}
	if collection.Fields.GetByName("hardware_fingerprint") != nil {
		return nil // already exists
	}
	collection.Fields.Add(&core.TextField{
		Name: "hardware_fingerprint",
		Max:  128,
		Help: "Hardware-bound fingerprint (hw_<64hex>) bound during activation/heartbeat.",
	})
	if err := app.Save(collection); err != nil {
		return fmt.Errorf("failed to add hardware_fingerprint to tenant_machines: %w", err)
	}
	log.Println("migrated tenant_machines collection: added hardware_fingerprint field")
	return nil
}

// normalizePEM attempts to repair common formatting issues that occur when
// a multi-line PEM key is stored as an environment variable (e.g. in
// Northflank, Docker secrets, or CI/CD variables). It handles:
//   - The entire PEM on a single line (newlines stripped by the platform)
//   - Literal "\\n" escape sequences (double-escaped in JSON/YAML)
//   - Surrounding whitespace and quotes
func normalizePEM(raw string) string {
	// Strip surrounding whitespace.
	raw = strings.TrimSpace(raw)
	// Strip surrounding quotes, then re-trim in case quotes hid whitespace.
	raw = strings.TrimSpace(strings.Trim(raw, "\"'"))

	// Replace literal backslash-n sequences with real newlines.
	raw = strings.ReplaceAll(raw, "\\n", "\n")

	// If the PEM already has newlines in the expected places, return as-is.
	if strings.Contains(raw, "-----\n") || strings.Contains(raw, "-----\r\n") {
		return raw
	}

	// If there are no PEM markers at all, the user may have pasted only
	// the raw base64 body. Wrap it in a PKCS#8 PEM envelope.
	if !strings.Contains(raw, "-----BEGIN") && !strings.Contains(raw, "-----END") {
		return wrapPEM(raw, "PRIVATE KEY")
	}

	// The PEM is on a single line. Find the BEGIN and END marker boundaries.
	// Format: -----BEGIN <TYPE>-----<base64>-----END <TYPE>-----
	// The header line is everything from the first "-----" through the next "-----".
	beginMarker := strings.Index(raw, "-----BEGIN ")
	if beginMarker == -1 {
		return raw // not a recognizable PEM, let pem.Decode fail naturally
	}

	// The header closes with "-----" after the type name.
	// Skip past "-----BEGIN " (11 chars) to find the closing "-----".
	afterType := raw[beginMarker+11:]
	headerClose := strings.Index(afterType, "-----")
	if headerClose == -1 {
		return raw
	}
	headerClose += beginMarker + 11 + 5
	header := raw[beginMarker:headerClose]

	// Find the footer: "-----END " through its closing "-----".
	endMarker := strings.LastIndex(raw, "-----END ")
	if endMarker == -1 || endMarker < headerClose {
		return raw
	}
	afterEndType := raw[endMarker+9:] // skip "-----END "
	footerClose := strings.Index(afterEndType, "-----")
	if footerClose == -1 {
		return raw
	}
	footerClose += endMarker + 9 + 5
	footer := raw[endMarker:footerClose]

	base64data := raw[headerClose:endMarker]

	// Reconstruct with proper line breaks (64-char base64 lines).
	var sb strings.Builder
	sb.WriteString(header)
	sb.WriteByte('\n')
	for i := 0; i < len(base64data); i += 64 {
		end := i + 64
		if end > len(base64data) {
			end = len(base64data)
		}
		sb.WriteString(base64data[i:end])
		sb.WriteByte('\n')
	}
	sb.WriteString(footer)
	sb.WriteByte('\n')
	return sb.String()
}

// wrapPEM wraps raw base64 data in a PEM envelope with the given type label
// and standard 64-character line width.
func wrapPEM(base64data, label string) string {
	var sb strings.Builder
	sb.WriteString("-----BEGIN ")
	sb.WriteString(label)
	sb.WriteString("-----\n")
	for i := 0; i < len(base64data); i += 64 {
		end := i + 64
		if end > len(base64data) {
			end = len(base64data)
		}
		sb.WriteString(base64data[i:end])
		sb.WriteByte('\n')
	}
	sb.WriteString("-----END ")
	sb.WriteString(label)
	sb.WriteString("-----\n")
	return sb.String()
}

// safePrefix returns the first n bytes of s, escaping non-printable chars
// for safe inclusion in log messages.
func safePrefix(s string, n int) string {
	if len(s) > n {
		s = s[:n]
	}
	return strings.ReplaceAll(s, "\n", "\\n")
}

// SubscriptionPayload is the JSON structure signed by the license server.
// This is the payload the POS stores locally and verifies against the
// embedded public key. Must stay in sync with Rust SignedSubscriptionPayload
// in crates/kasirmu-core/src/license_verification.rs.
type SubscriptionPayload struct {
	TenantID string `json:"tenant_id"`
	TierKey  string `json:"tier_key"`
	Status   string `json:"status"`
	// MaxLocations is the primary quota field (1g Store → Location wire
	// rename, todo-global-saas-1.md); new clients parse this name.
	MaxLocations int `json:"max_locations"`
	// MaxStores is the pre-rename wire name, kept for the client rotation
	// window. signSubscription forces it to mirror MaxLocations, so old
	// clients — which parse only max_stores and default to 0 when it is
	// absent — keep seeing the correct quota. PocketBase storage keeps the
	// historical max_stores field name; only the wire is renamed.
	MaxStores       int      `json:"max_stores"`
	MaxPOSInstances int      `json:"max_pos_instances"`
	AllowedTypes    []string `json:"allowed_types"`
	StartsAt        string   `json:"starts_at"`
	ExpiresAt       string   `json:"expires_at"`
	GraceUntil      string   `json:"grace_until"`
	IssuedAt        string   `json:"issued_at"`
	// IsTrial and TrialEndsAt publish trial state to the client
	// (entitlements consolidation Phase C, todo-global-saas-2.md). Additive
	// only — no existing field was renamed or removed, and both are omitted
	// unless this subscription period actually IS a trial, so a payload
	// signed before this change and a paid payload read identically: the
	// client needs no dual-read. trial_ends_at is RFC3339 and is the trial's
	// own end (the segmented-trial expiry), not the tier's billing expiry.
	//
	// Only the activation path can set them: is_trial lives on license_keys,
	// and the subscriptions rows the webhook/renew/resume re-sign paths read
	// have no such field (Phase C is deliberately JSON-only, no schema
	// migration). Those paths therefore emit no trial fields, which is the
	// correct answer — a period produced by a paid re-sign is not a trial.
	IsTrial     bool   `json:"is_trial,omitempty"`
	TrialEndsAt string `json:"trial_ends_at,omitempty"`
	// Features is the Phase D wire block: an explicit per-feature server
	// instruction keyed by the client's canonical feature key — the
	// AvailabilityFeature wire names such as "supports_analytics", NOT a
	// shortened "analytics". Semantics: an absent key leaves the tier's own
	// answer in place, false withholds even where the tier would allow, and
	// true grants beyond tier. omitempty, so a payload carrying no grants
	// marshals byte-identically to a pre-Phase-D one.
	//
	// AUTHORING IS DELIBERATELY NOT THIS SLICE (owed D2): neither
	// license_keys nor subscriptions has a field to flow this from, so no
	// build site sets it today and no payload emitted by the current server
	// actually carries the block. The wire field is the deliverable — a
	// payload CAN carry it, and the client already honours it.
	Features map[string]bool `json:"features,omitempty"`
}

// signDetached signs arbitrary bytes with the license RSA-2048 key using
// PKCS1v15/SHA-256 and returns the base64 signature. Origin attestation
// (ADR #55) needs the same primitive the subscription payloads use, and one
// implementation of a signing primitive is the point.
func signDetached(payload []byte) (string, error) {
	hash := sha256.Sum256(payload)
	sig, err := rsa.SignPKCS1v15(rand.Reader, privateKey, crypto.SHA256, hash[:])
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(sig), nil
}

// signSubscription marshals the payload to JSON, SHA-256 hashes it,
// and signs it with the RSA-2048 private key using PKCS1v15.
func signSubscription(sub SubscriptionPayload) (payload string, signature string, err error) {
	// 1g dual-emit: the legacy wire name always mirrors max_locations at
	// the single choke point every payload passes through, so a build
	// site that forgets to set one field can never emit a divergent (or
	// silently zero) legacy value to un-updated clients.
	sub.MaxStores = sub.MaxLocations
	payloadBytes, err := jsonMarshal(sub)
	if err != nil {
		return "", "", err
	}
	signature, err = signDetached(payloadBytes)
	if err != nil {
		return "", "", err
	}
	return string(payloadBytes), signature, nil
}
