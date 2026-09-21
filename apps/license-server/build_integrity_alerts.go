package main

// Build-integrity alert scanner — the READER half of ADR #57 §2.4.
//
// §2.1 ships the reporting and the server classifies every report
// (build_integrity.go, build_integrity_reports). Without this file those
// verdicts are a log nobody reads: the residual ADR #57 §3.3 carries is exactly
// "the deception is recorded; no human is told". This closes it.
//
// Key functions:
// - startBuildIntegrityScheduler — daily tick at 08:00 UTC (the password-rotation
//   shape, so the two scanners read alike).
// - runBuildIntegrityScanner — alert once per tenant per condition.
//
// Env:
//
//	OZ_ADMIN_EMAIL — alert recipient (default: defaultAdminEmail).
//	OZ_SMTP_HOST   — unset means no email delivery; the scan still RUNS and logs,
//	                 so the alert is never silently skipped.
//
// Invariants:
// - NEVER locks a device or refuses a renewal. §Q4: escalation routes to a human,
//   because a serialization bug or a partially-rolled-out client would otherwise
//   dark a fleet of legitimate tills.
// - At most ONE alert per tenant per condition per cooldown window, so a device
//   that keeps failing does not mail daily until someone stops it.
// - A `mismatch` and a persistent `unknown` are reported as DIFFERENT findings.
//   They are not the same event: one is "we can see, and it is wrong", the other
//   is "we cannot see". Collapsing them would make a broken client look like a
//   pirate.

import (
	"fmt"
	"log"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// THE ESCALATION RULE EXISTS TWICE, deliberately: these constants are the FIRING
// copy, and `kasirmu_core::build_fingerprint` is the specification they mirror.
//
// `fold_build_integrity` / `BuildIntegritySignal` / `UNKNOWN_REPORTS_BEFORE_ESCALATION`
// in `crates/kasirmu-core/src/build_fingerprint.rs` encode the same rule WITH the
// reasoning this file's constants cannot carry (why the counter RESETS on a usable
// report rather than decaying, and why escalation never locks). That Rust module has
// **no production caller** — the scanner below is what actually fires. So the pair is
// a spec/implementation split, not dead code: the Rust side is where the rule is
// DECIDED, this side is where it RUNS.
//
// The risk is silent drift, so `TestEscalationRuleMatchesTheRustSpecification` exists
// on BOTH sides, pinning the shared numbers. A change to one without the other fails a
// build rather than diverging quietly.
const (
	// buildIntegrityUnknownWindow is the rolling window §Q-C decided for the
	// repeated-unknown rule, expressed in calendar days. §Q-C chose calendar time
	// over sync cycles because the operator queue is read in day-scale units, and
	// because "cycle" has no meaning for the sync-disabled tenant ADR #56 §2.4
	// exempts.
	//
	// Mirrors the WINDOW half of the Rust spec (§Q-C: "at least K reports inside a
	// rolling 7-day window").
	buildIntegrityUnknownWindow = 7 * 24 * time.Hour
	// buildIntegrityUnknownThreshold is N from §Q4 (7 consecutive reports).
	//
	// Mirrors `kasirmu_core::build_fingerprint::UNKNOWN_REPORTS_BEFORE_ESCALATION`.
	//
	// §Q4 fixes N=7 and §Q-C fixes the unit; §Q-C also calls both "tuning
	// parameters, not security boundaries — the routing to a human IS the
	// boundary". So this number may change without a new decision, and changing it
	// must not be read as weakening anything — but it must change on BOTH sides.
	buildIntegrityUnknownThreshold = 7
	// buildIntegrityAlertCooldown is the minimum gap between repeat alerts for the
	// SAME tenant and condition. 7 days matches the window above: an ongoing
	// condition re-alerts weekly rather than daily, which is what makes the alert
	// readable instead of filtered.
	buildIntegrityAlertCooldown = 7 * 24 * time.Hour
)

// buildIntegrityAlertStateCollection remembers what has already been alerted.
//
// Why state rather than a pure query: the trigger is "≥N reports in a window",
// and without a record of the last alert the same standing condition would mail
// on every single scan. The password-rotation scanner carries the identical
// field (`last_reminder_at`) for the identical reason.
const buildIntegrityAlertStateCollection = "build_integrity_alert_state"

// startBuildIntegrityScheduler runs the scanner daily at 08:00 UTC.
// Blocks forever (intended as a goroutine from OnServe), mirroring
// startPasswordRotationScheduler so the two operator-facing scanners share one
// rhythm — an operator who knows when one runs knows when the other does.
func startBuildIntegrityScheduler(app core.App) {
	now := time.Now().UTC()
	next8AM := time.Date(now.Year(), now.Month(), now.Day()+1, 8, 0, 0, 0, time.UTC)
	if now.Hour() < 8 {
		next8AM = time.Date(now.Year(), now.Month(), now.Day(), 8, 0, 0, 0, time.UTC)
	}
	time.Sleep(time.Until(next8AM))

	runBuildIntegrityScanner(app)
	ticker := time.NewTicker(24 * time.Hour)
	for range ticker.C {
		runBuildIntegrityScanner(app)
	}
}

// runBuildIntegrityScanner finds tenants with a build-integrity signal and
// alerts the operator. Called daily by the scheduler.
func runBuildIntegrityScanner(app core.App) {
	// Deliberately NOT an early return: an operator with no SMTP configured must
	// still see the finding in the log, otherwise the scan is silently skipped and
	// the residual is wider than ADR #57 §3.3 claims. The send below reports the
	// missing config itself.
	log.Println("build-integrity-scanner: starting daily scan")

	env := &buildIntegrityAlertEnv{
		to:          adminAlertRecipient(),
		smtpEnabled: strings.TrimSpace(os.Getenv("OZ_SMTP_HOST")) != "",
		now:         time.Now().UTC(),
	}

	mismatches, unknowns, err := collectBuildIntegrityFindings(app, env.now)
	if err != nil {
		log.Printf("build-integrity-scanner: scan failed: %v", err)
		return
	}

	sent := 0
	for _, f := range mismatches {
		if alertBuildIntegrityFinding(app, env, f) {
			sent++
		}
	}
	for _, f := range unknowns {
		if alertBuildIntegrityFinding(app, env, f) {
			sent++
		}
	}

	// §2.4’s other half: the quota-EFFECT signal. Independent of the fingerprint
	// work — it compares what the tenant HAS against what their tier allows, so
	// it catches a client that skips its local quota gates without consulting
	// anything that client claims.
	overQuota := findTenantsOverPosQuota(app)
	for _, q := range overQuota {
		if alertTenantOverPosQuota(app, env, q) {
			sent++
		}
	}

	log.Printf("build-integrity-scanner: scan complete — %d integrity findings, %d quota findings, %d alerts sent",
		len(mismatches)+len(unknowns), len(overQuota), sent)
}

// buildIntegrityAlertEnv carries the per-scan configuration.
type buildIntegrityAlertEnv struct {
	to          string
	smtpEnabled bool
	now         time.Time
}

// buildIntegrityFinding is one actionable condition for one tenant.
type buildIntegrityFinding struct {
	tenantID string
	email    string
	// condition is the alert-state key: "mismatch" or "unknown_persistent".
	condition string
	reports   int
	devices   []string
}

// adminAlertRecipient resolves the operator address, defaulting when unset.
func adminAlertRecipient() string {
	if v := strings.TrimSpace(os.Getenv("OZ_ADMIN_EMAIL")); v != "" {
		return v
	}
	return defaultAdminEmail
}

// collectBuildIntegrityFindings returns the tenants worth alerting about.
//
// Two independent queries rather than one grouped pass, because the two
// conditions have different thresholds and different meanings:
//
//   - `mismatch` — a well-formed fingerprint that is not pinned. This is
//     POSITIVE evidence of a re-signed APK (§2.1), so ONE report is enough.
//   - `unknown` — an absent or unusable report. NEVER evidence on its own
//     (§2.2), because a serialization bug produces it from healthy devices. It
//     escalates only on repetition (§Q4): at least N reports inside the rolling
//     window.
func collectBuildIntegrityFindings(app core.App, now time.Time) (mismatches, unknowns []buildIntegrityFinding, err error) {
	windowStart := now.Add(-buildIntegrityUnknownWindow).Format(time.RFC3339)

	mismatchRecs, qErr := app.FindRecordsByFilter(buildIntegrityCollection,
		"verdict = {:v}", "-created", 0, 0,
		map[string]any{"v": buildVerdictMismatch})
	if qErr != nil {
		return nil, nil, fmt.Errorf("mismatch query: %w", qErr)
	}
	mismatches = groupBuildIntegrityFindings(app, mismatchRecs, buildVerdictMismatch)

	// `created >= {:cutoff}` is the rolling window. PocketBase compares the
	// stored autodate (RFC 3339) against this bound textually, which is correct
	// for that format because it is lexicographically ordered.
	unknownRecs, qErr := app.FindRecordsByFilter(buildIntegrityCollection,
		"verdict = {:v} && created >= {:cutoff}", "-created", 0, 0,
		map[string]any{"v": buildVerdictUnknown, "cutoff": windowStart})
	if qErr != nil {
		return nil, nil, fmt.Errorf("unknown query: %w", qErr)
	}
	grouped := groupBuildIntegrityFindings(app, unknownRecs, buildVerdictUnknown)
	for _, f := range grouped {
		// The repetition test. One `unknown` is noise; N inside the window is the
		// signal §Q4 defined.
		if f.reports >= buildIntegrityUnknownThreshold {
			f.condition = buildVerdictUnknownPersistent
			unknowns = append(unknowns, f)
		}
	}
	return mismatches, unknowns, nil
}

// buildVerdictUnknownPersistent is the alert-condition key for a repeated-unknown
// signal. It is NOT a stored verdict (build_integrity_reports only ever holds
// `mismatch`/`unknown`); it names the DERIVED condition, per §Q4, which is why it
// lives here rather than beside the verdicts.
const buildVerdictUnknownPersistent = "unknown_persistent"

// groupBuildIntegrityFindings folds report rows into one finding per tenant.
//
// Deduplicates devices as well as counting reports: seven reports from ONE device
// is a different situation from seven devices each reporting once, and the alert
// body says which. Without the dedupe an operator cannot tell them apart.
func groupBuildIntegrityFindings(app core.App, recs []*core.Record, condition string) []buildIntegrityFinding {
	type acc struct {
		reports int
		devices map[string]bool
	}
	byTenant := map[string]*acc{}
	order := make([]string, 0, len(recs))
	for _, r := range recs {
		tid := r.GetString("tenant_id")
		if tid == "" {
			continue
		}
		a, ok := byTenant[tid]
		if !ok {
			a = &acc{devices: map[string]bool{}}
			byTenant[tid] = a
			order = append(order, tid)
		}
		a.reports++
		if d := r.GetString("machine_id"); d != "" {
			a.devices[d] = true
		}
	}

	out := make([]buildIntegrityFinding, 0, len(order))
	for _, tid := range order {
		a := byTenant[tid]
		devices := make([]string, 0, len(a.devices))
		for d := range a.devices {
			devices = append(devices, d)
		}
		sort.Strings(devices)
		out = append(out, buildIntegrityFinding{
			tenantID:  tid,
			email:     tenantEmailFor(app, tid),
			condition: condition,
			reports:   a.reports,
			devices:   devices,
		})
	}
	return out
}

// tenantEmailFor resolves a tenant id to its contact address, "" when absent.
//
// Best-effort: a missing tenant must not drop the finding, because the finding
// is about the DEVICE and the operator can still act on the id.
func tenantEmailFor(app core.App, tenantID string) string {
	tenant, err := app.FindRecordById("tenants", tenantID)
	if err != nil {
		return ""
	}
	return tenant.GetString("email")
}

// alertBuildIntegrityFinding sends one alert unless the cooldown suppresses it.
// Returns true when an email was actually sent.
func alertBuildIntegrityFinding(app core.App, env *buildIntegrityAlertEnv, f buildIntegrityFinding) bool {
	if suppressedByCooldown(app, f.tenantID, f.condition, env.now) {
		// Logged at debug-ish level rather than as a finding: the condition IS
		// still present, and an operator reading a quiet day must not conclude it
		// resolved. The next scan re-reports it once the cooldown lapses.
		log.Printf("build-integrity-scanner: %s for tenant %s within cooldown — not re-alerting",
			f.condition, f.tenantID)
		return false
	}

	subject, body := renderBuildIntegrityAlert(f)
	// Always log the finding, SMTP or not: the log is the fallback channel, and an
	// operator with no mail relay still needs to see that a device failed.
	log.Printf("build-integrity-scanner: %s — tenant=%s email=%q reports=%d devices=%d",
		f.condition, f.tenantID, f.email, f.reports, len(f.devices))

	if !env.smtpEnabled {
		log.Printf("build-integrity-scanner: OZ_SMTP_HOST not configured — alert for %s logged only", f.tenantID)
		// Deliberately NOT recording alert state: no one was told, so the next scan
		// must try again rather than consider this handled.
		return false
	}

	if err := sendBuildIntegrityAlert(env.to, subject, body); err != nil {
		log.Printf("build-integrity-scanner: failed to send alert for tenant %s: %v", f.tenantID, err)
		return false
	}
	recordBuildIntegrityAlert(app, f, env.now)
	log.Printf("build-integrity-scanner: alerted %q about %s for tenant %s", env.to, f.condition, f.tenantID)
	return true
}

// renderBuildIntegrityAlert builds the subject and body for a finding.
//
// The two conditions get DIFFERENT text on purpose (§Q4): a `mismatch` is
// evidence of tampering and should be investigated as such, while a persistent
// `unknown` may well be OUR bug — a renamed field, a bad rollout. Telling an
// operator they are "under attack" when a serialization bug is at fault is how
// alerts stop being read.
func renderBuildIntegrityAlert(f buildIntegrityFinding) (subject, body string) {
	devices := "none reported"
	if len(f.devices) > 0 {
		devices = strings.Join(f.devices, ", ")
	}
	tenant := f.email
	if tenant == "" {
		tenant = "(no email on record)"
	}

	switch f.condition {
	case buildVerdictMismatch:
		subject = "kasir.mu: build integrity mismatch detected"
		body = fmt.Sprintf(`Hi,

An installation reported an APK signing certificate that does not match any
pinned certificate for its release channel. This is positive evidence that the
APK was modified and re-signed.

  Tenant:   %s (%s)
  Devices:  %s
  Reports:  %d

What this does and does not do:

  - It does NOT lock the device. Nothing in this system auto-terminates an
    account, and that is deliberate: a false positive must never dark a shop.
  - The device CANNOT renew its subscription (ADR #57 section 2.5), so a
    tampered installation will lapse at its next renewal.

What to check:

  1. Is this a device we shipped? An operator-run re-sign (a rebuild with a
     different keystore) looks identical to an attack from here.
  2. If the keystore was legitimately rotated, pin the new certificate at
     POST /api/v1/admin/release-channels/%s/pins and this clears.
  3. Otherwise review the tenant and consider revoking the device.

--- The kasir.mu Team`, tenant, f.tenantID, devices, f.reports, defaultReleaseChannel)
	case buildVerdictUnknownPersistent:
		subject = "kasir.mu: build integrity reporting unreadable for one tenant"
		body = fmt.Sprintf(`Hi,

A tenant has reported an unreadable build fingerprint %d times inside the last
%d days. This is NOT evidence of tampering — it means we cannot see what the
device is running.

  Tenant:   %s (%s)
  Devices:  %s
  Reports:  %d

Most likely causes, in order:

  1. A client bug or a renamed field, so legitimate builds report nothing.
  2. A partially-rolled-out client that predates the reporting code.
  3. A patched client whose reporting line was removed.

Items 1 and 2 are OUR faults, which is exactly why this alert exists rather
than an automatic lockout: the same signal covers a broken release and a
deliberate bypass, and only a human can tell them apart.

What to check:

  - Whether other tenants on the same build are reporting the same way.
  - Whether a release went out around the first report.

--- The kasir.mu Team`, f.reports, int(buildIntegrityUnknownWindow.Hours()/24), tenant, f.tenantID, devices, f.reports)
	default:
		subject = "kasir.mu: build integrity finding"
		body = fmt.Sprintf("Tenant %s (%s) reported %s %d times.", tenant, f.tenantID, f.condition, f.reports)
	}
	return subject, body
}

// ── Alert state (cooldown) ────────────────────────────────────────

// suppressedByCooldown reports whether this tenant+condition was alerted
// recently enough that re-sending would be noise.
//
// Keyed on BOTH tenant and condition: a tenant can legitimately have a mismatch
// and a persistent-unknown at once (different devices), and suppressing one
// because the other was alerted would hide a genuine second finding.
func suppressedByCooldown(app core.App, tenantID, condition string, now time.Time) bool {
	rec, err := app.FindFirstRecordByFilter(buildIntegrityAlertStateCollection,
		"tenant_id = {:t} && condition = {:c}",
		map[string]any{"t": tenantID, "c": condition})
	if err != nil || rec == nil {
		return false
	}
	last := rec.GetDateTime("last_alert_at").Time()
	if last.IsZero() {
		return false
	}
	return now.Sub(last) < buildIntegrityAlertCooldown
}

// recordBuildIntegrityAlert stamps the cooldown after a successful send.
//
// Only ever called when an email actually left, so a delivery failure does not
// start a cooldown that would hide the finding for a week.
func recordBuildIntegrityAlert(app core.App, f buildIntegrityFinding, now time.Time) {
	coll, err := app.FindCollectionByNameOrId(buildIntegrityAlertStateCollection)
	if err != nil {
		log.Printf("build-integrity-scanner: alert state collection unavailable: %v", err)
		return
	}
	rec, err := app.FindFirstRecordByFilter(buildIntegrityAlertStateCollection,
		"tenant_id = {:t} && condition = {:c}",
		map[string]any{"t": f.tenantID, "c": f.condition})
	if err != nil || rec == nil {
		rec = core.NewRecord(coll)
		rec.Set("tenant_id", f.tenantID)
		rec.Set("condition", f.condition)
	}
	rec.Set("last_alert_at", now.Format(time.RFC3339))
	if err := app.Save(rec); err != nil {
		// Logged, not fatal: the alert DID go out, and the worst case is a repeat
		// next scan, which is strictly better than dropping the alert entirely.
		log.Printf("build-integrity-scanner: warning — alert sent but state write failed for %s: %v",
			f.tenantID, err)
	}
}

// ── Email delivery ────────────────────────────────────────────────

// sendBuildIntegrityAlert delivers the alert over the shared SMTP relay.
//
// Uses sendMailSMTP (smtp_mail.go) rather than re-deriving the transport: that
// function owns the implicit-TLS/STARTTLS decision and the timeout, and a
// second copy of it is how one relay path silently loses a security fix. Only
// the message envelope is built here, matching the other senders in this
// package.
func sendBuildIntegrityAlert(to, subject, body string) error {
	host := strings.TrimSpace(os.Getenv("OZ_SMTP_HOST"))
	if host == "" {
		return fmt.Errorf("OZ_SMTP_HOST is not configured")
	}
	port := strings.TrimSpace(os.Getenv("OZ_SMTP_PORT"))
	if port == "" {
		port = "587"
	}
	from := strings.TrimSpace(os.Getenv("OZ_SMTP_FROM"))
	if from == "" {
		from = "no-reply@kasir.mu"
	}

	msg := buildBuildIntegrityAlertEmail(from, to, subject, body)
	return sendMailSMTP(
		host, port,
		os.Getenv("OZ_SMTP_USER"), os.Getenv("OZ_SMTP_PASSWORD"),
		from, []string{to}, msg)
}

// buildBuildIntegrityAlertEmail renders an RFC 5322 message.
func buildBuildIntegrityAlertEmail(from, to, subject, body string) []byte {
	var sb strings.Builder
	fmt.Fprintf(&sb, "From: kasir.mu Security <%s>\r\n", from)
	fmt.Fprintf(&sb, "To: %s\r\n", to)
	fmt.Fprintf(&sb, "Subject: %s\r\n", subject)
	sb.WriteString("MIME-Version: 1.0\r\n")
	sb.WriteString("Content-Type: text/plain; charset=utf-8\r\n")
	fmt.Fprintf(&sb, "Date: %s\r\n", time.Now().UTC().Format(time.RFC1123Z))
	sb.WriteString("\r\n")
	sb.WriteString(body)
	return []byte(sb.String())
}

// ensureBuildIntegrityAlertState creates the cooldown store.
//
// Why a table rather than a field on the report: the cooldown is per
// TENANT+CONDITION, which is a different grain from the per-REPORT rows in
// build_integrity_reports. Storing it there would mean either a scan-side
// MAX(created) over a filtered set on every check, or a denormalised field
// updated in place — and the former is exactly the kind of query that silently
// degrades as report volume grows.
func ensureBuildIntegrityAlertState(app core.App) error {
	if existing, err := app.FindCollectionByNameOrId(buildIntegrityAlertStateCollection); err == nil {
		return ensureSuperuserOnlyRules(app, existing)
	}
	coll := core.NewBaseCollection(buildIntegrityAlertStateCollection)
	// Plain text, not a relation: the alert must survive a tenant row being
	// removed, and a dangling finding is better kept than cascade-deleted.
	coll.Fields.Add(&core.TextField{Name: "tenant_id", Required: true, Max: 64})
	coll.Fields.Add(&core.SelectField{Name: "condition", Required: true, MaxSelect: 1, Values: []string{buildVerdictMismatch, buildVerdictUnknownPersistent}})
	coll.Fields.Add(&core.DateField{Name: "last_alert_at"})
	// created/updated are NOT implicit on a programmatically-built collection.
	coll.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	coll.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	// Superuser-only: nil is server-only; an empty-string rule would be PUBLIC (LSE-5),
	// which here would let anyone write a future timestamp and SUPPRESS a real alert.
	coll.ListRule = nil
	coll.ViewRule = nil
	coll.CreateRule = nil
	coll.UpdateRule = nil
	coll.DeleteRule = nil
	// The cooldown lookup is a point read on this pair, and the writer relies on
	// uniqueness to avoid racing duplicates from overlapping scans.
	coll.Indexes = append(coll.Indexes,
		"CREATE UNIQUE INDEX idx_build_integrity_alert_state ON build_integrity_alert_state (tenant_id, condition)")
	if err := app.Save(coll); err != nil {
		return fmt.Errorf("failed to create %s collection: %w", buildIntegrityAlertStateCollection, err)
	}
	log.Printf("migrated: created %s collection (ADR #57 §2.4 alert cooldown)", buildIntegrityAlertStateCollection)
	return nil
}

// ── Quota-effect alert (ADR #57 §2.4, second signal) ──────────────

// quotaAlertCondition is the alert-state key for this finding. Distinct from the
// fingerprint conditions so the two never suppress each other: a tenant can be
// over quota AND have a tampered device, and those are different conversations.
const quotaAlertCondition = "pos_over_quota"

// alertTenantOverPosQuota notifies the operator of one over-quota tenant.
//
// **The finding is a SIGNAL, not a verdict, and the body says so.** §2.4’s own
// reasoning lists why an over-cap count is not proof of tampering: a legitimate
// support correction, a restore from backup, or a tier change mid-sync all
// produce it. The operator is asked to investigate, which is exactly the
// response policy §2.4 chose over auto-termination.
//
// Reuses the fingerprint path’s cooldown machinery so an ongoing condition
// re-alerts weekly rather than daily, and the no-SMTP arm still logs (and does
// NOT start a cooldown) — an undelivered alert must not suppress the next one.
func alertTenantOverPosQuota(app core.App, env *buildIntegrityAlertEnv, q tenantOverQuota) bool {
	if suppressedByCooldown(app, q.tenantID, quotaAlertCondition, env.now) {
		log.Printf("build-integrity-scanner: %s for tenant %s within cooldown — not re-alerting",
			quotaAlertCondition, q.tenantID)
		return false
	}

	log.Printf("build-integrity-scanner: %s — tenant=%s email=%q active=%d cap=%d tier=%s",
		quotaAlertCondition, q.tenantID, q.email, q.active, q.cap, q.tierKey)

	if !env.smtpEnabled {
		log.Printf("build-integrity-scanner: OZ_SMTP_HOST not configured — quota alert for %s logged only", q.tenantID)
		return false
	}

	subject, body := renderQuotaAlert(q)
	if err := sendBuildIntegrityAlert(env.to, subject, body); err != nil {
		log.Printf("build-integrity-scanner: failed to send quota alert for tenant %s: %v", q.tenantID, err)
		return false
	}
	recordBuildIntegrityAlert(app, buildIntegrityFinding{
		tenantID:  q.tenantID,
		condition: quotaAlertCondition,
	}, env.now)
	log.Printf("build-integrity-scanner: alerted %q about %s for tenant %s", env.to, quotaAlertCondition, q.tenantID)
	return true
}

// renderQuotaAlert builds the subject and body for an over-quota finding.
func renderQuotaAlert(q tenantOverQuota) (subject, body string) {
	tenant := q.email
	if tenant == "" {
		tenant = "(no email on record)"
	}
	subject = "kasir.mu: a tenant is running more terminals than their tier allows"
	body = fmt.Sprintf(`Hi,

A tenant has more active POS devices registered than their subscription permits.

  Tenant:   %s (%s)
  Devices:  %d active
  Allowed:  %d
  Tier:     %s

This is a SIGNAL, not proof of wrongdoing. A local quota gate normally prevents
this, so the usual innocent explanations are:

  1. A tier change that has not fully synced to the affected terminal.
  2. A restore from a backup taken on a larger plan.
  3. A support correction that raised or lowered a limit by hand.

The one explanation that is not innocent is a modified client that skipped the
gate, which is what this signal exists to catch. Nothing about this report can
tell those apart - only a person can.

What to check:

  - Whether the tenant recently changed tier or restored a backup.
  - Whether the extra devices look like real terminals the merchant owns.
  - If it looks deliberate, revoke the offending device from the admin surface.

Nothing has been locked. This system deliberately never auto-terminates an
account; a false positive must not dark a shop.

--- The kasir.mu Team`, tenant, q.tenantID, q.active, q.cap, q.tierKey)
	return subject, body
}
