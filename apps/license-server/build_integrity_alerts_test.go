package main

// Tests for the build-integrity ALERT scanner (ADR #57 §2.4, the §Q3/§Q4 reader).
//
// The scanner is what turns stored verdicts into a human reading them. These
// tests pin the two decisions that make it safe to run unattended:
//
//  1. Repetition, not a single report, drives the `unknown` alert (§Q4) — a
//     serialization bug must not read as an attack.
//  2. The cooldown suppresses repeats (§2.4) — a standing condition must not
//     mail daily until someone stops reading.
//
// and the invariant that outranks both: nothing here refuses a renewal or
// touches a session.

import (
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// seedIntegrityReport inserts one build-integrity report row.
func seedIntegrityReport(t *testing.T, app core.App, tenantID, device, verdict string, at time.Time) {
	t.Helper()
	coll, err := app.FindCollectionByNameOrId(buildIntegrityCollection)
	if err != nil {
		t.Fatalf("collection %s: %v", buildIntegrityCollection, err)
	}
	rec := core.NewRecord(coll)
	rec.Set("tenant_id", tenantID)
	rec.Set("machine_id", device)
	rec.Set("reported_fingerprint", unrelated)
	rec.Set("verdict", verdict)
	rec.Set("created", at.Format(time.RFC3339))
	if err := app.Save(rec); err != nil {
		t.Fatalf("seed report: %v", err)
	}
}

func TestBuildIntegrityScanner_OneUnknownDoesNotAlert(t *testing.T) {
	// §Q4 option B is "escalate after N". One `unknown` is the ordinary case for a
	// client that simply cannot produce a fingerprint, so alerting on it would
	// make the alert routine and unread.
	app, _ := dashboardMux(t)
	defer app.Cleanup()
	tenant := seedLifecycleTenant(t, app, "scan1@test.com", "active")
	now := time.Now().UTC()

	seedIntegrityReport(t, app, tenant.Id, "dev-1", buildVerdictUnknown, now)

	_, unknowns, err := collectBuildIntegrityFindings(app, now)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if len(unknowns) != 0 {
		t.Errorf("one unknown report must not escalate, got %d finding(s)", len(unknowns))
	}
}

func TestBuildIntegrityScanner_RepeatedUnknownEscalates(t *testing.T) {
	// At the threshold, the tenant escalates. This is the signal §2.1 is bypassed
	// by deleting the reporting line, so it must actually fire.
	app, _ := dashboardMux(t)
	defer app.Cleanup()
	tenant := seedLifecycleTenant(t, app, "scan2@test.com", "active")
	now := time.Now().UTC()

	for i := 0; i < buildIntegrityUnknownThreshold; i++ {
		seedIntegrityReport(t, app, tenant.Id, "dev-1", buildVerdictUnknown, now.Add(-time.Duration(i)*time.Hour))
	}

	_, unknowns, err := collectBuildIntegrityFindings(app, now)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if len(unknowns) != 1 {
		t.Fatalf("expected 1 finding at the threshold, got %d", len(unknowns))
	}
	if unknowns[0].condition != buildVerdictUnknownPersistent {
		t.Errorf("condition = %q, want %q", unknowns[0].condition, buildVerdictUnknownPersistent)
	}
	if unknowns[0].reports != buildIntegrityUnknownThreshold {
		t.Errorf("reports = %d, want %d", unknowns[0].reports, buildIntegrityUnknownThreshold)
	}
}

func TestBuildIntegrityScanner_UnknownOutsideTheWindowDoesNotEscalate(t *testing.T) {
	// §Q-C chose a ROLLING WINDOW, not a lifetime count: seven unreadable reports
	// spread over a year is not a persistent condition, and treating it as one
	// would let ancient noise escalate a tenant forever.
	//
	// HOW THIS IS TESTED, and the constraint that shapes it: a report’s `created`
	// is an OnCreate autodate, so PocketBase OVERWRITES any value a test supplies
	// (verified: seeding a 30-day-old row stores today’s date). A test therefore
	// cannot age a row — it moves the CLOCK instead. Passing a `now` beyond the
	// window puts these genuinely-current rows outside it, which asserts exactly
	// the same boundary: the filter is a window, not a lifetime count.
	app, _ := dashboardMux(t)
	defer app.Cleanup()
	tenant := seedLifecycleTenant(t, app, "scan3@test.com", "active")
	seeded := time.Now().UTC()

	for i := 0; i < buildIntegrityUnknownThreshold; i++ {
		seedIntegrityReport(t, app, tenant.Id, "dev-1", buildVerdictUnknown, seeded)
	}

	// Inside the window: the threshold escalates (guards against a test that
	// passes because the query returns nothing at all).
	_, inside, err := collectBuildIntegrityFindings(app, seeded.Add(time.Hour))
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if len(inside) != 1 {
		t.Fatalf("inside the window the threshold must escalate, got %d finding(s)", len(inside))
	}

	// Beyond the window: the same rows no longer count.
	_, beyond, err := collectBuildIntegrityFindings(app, seeded.Add(buildIntegrityUnknownWindow+time.Hour))
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if len(beyond) != 0 {
		t.Errorf("reports outside the window must not escalate, got %d finding(s)", len(beyond))
	}
}

func TestBuildIntegrityScanner_MismatchAlertsOnASingleReport(t *testing.T) {
	// A `mismatch` is POSITIVE evidence of a re-signed APK (§2.1), so unlike
	// `unknown` it does not need repetition — one report is the finding.
	app, _ := dashboardMux(t)
	defer app.Cleanup()
	tenant := seedLifecycleTenant(t, app, "scan4@test.com", "active")
	now := time.Now().UTC()

	seedIntegrityReport(t, app, tenant.Id, "dev-1", buildVerdictMismatch, now)

	mismatches, _, err := collectBuildIntegrityFindings(app, now)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if len(mismatches) != 1 {
		t.Fatalf("expected 1 mismatch finding, got %d", len(mismatches))
	}
	if mismatches[0].condition != buildVerdictMismatch {
		t.Errorf("condition = %q, want %q", mismatches[0].condition, buildVerdictMismatch)
	}
}

func TestBuildIntegrityScanner_CountsReportsPerDevice(t *testing.T) {
	// Seven reports from ONE device is a different situation from seven devices
	// each reporting once. The alert body distinguishes them, so the count must be
	// per-device-accurate rather than a bare total.
	app, _ := dashboardMux(t)
	defer app.Cleanup()
	tenant := seedLifecycleTenant(t, app, "scan5@test.com", "active")
	now := time.Now().UTC()

	for _, d := range []string{"dev-a", "dev-b", "dev-c"} {
		seedIntegrityReport(t, app, tenant.Id, d, buildVerdictMismatch, now)
	}
	seedIntegrityReport(t, app, tenant.Id, "dev-a", buildVerdictMismatch, now.Add(-time.Minute))

	mismatches, _, err := collectBuildIntegrityFindings(app, now)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if len(mismatches) != 1 {
		t.Fatalf("expected one finding per tenant, got %d", len(mismatches))
	}
	if mismatches[0].reports != 4 {
		t.Errorf("reports = %d, want 4", mismatches[0].reports)
	}
	if len(mismatches[0].devices) != 3 {
		t.Errorf("devices = %v, want 3 distinct", mismatches[0].devices)
	}
}

func TestBuildIntegrityScanner_AlertsAreSeparatedPerTenant(t *testing.T) {
	// One tenant must not mask another: two tenants with the same condition are
	// two findings, because they are two conversations with two merchants.
	app, _ := dashboardMux(t)
	defer app.Cleanup()
	one := seedLifecycleTenant(t, app, "scan6a@test.com", "active")
	two := seedLifecycleTenant(t, app, "scan6b@test.com", "active")
	now := time.Now().UTC()

	seedIntegrityReport(t, app, one.Id, "dev-1", buildVerdictMismatch, now)
	seedIntegrityReport(t, app, two.Id, "dev-2", buildVerdictMismatch, now)

	mismatches, _, err := collectBuildIntegrityFindings(app, now)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if len(mismatches) != 2 {
		t.Errorf("expected 2 findings, got %d", len(mismatches))
	}
}

func TestBuildIntegrityScanner_CooldownSuppressesARepeat(t *testing.T) {
	// §2.4: a standing condition re-alerts at most weekly. Without this a device
	// that keeps failing mails the operator every single day until it is ignored.
	app, _ := dashboardMux(t)
	defer app.Cleanup()
	tenant := seedLifecycleTenant(t, app, "scan7@test.com", "active")
	now := time.Now().UTC()

	// Not suppressed before any alert has been sent.
	if suppressedByCooldown(app, tenant.Id, buildVerdictMismatch, now) {
		t.Fatal("nothing has been alerted yet, so nothing should be suppressed")
	}

	recordBuildIntegrityAlert(app, buildIntegrityFinding{
		tenantID:  tenant.Id,
		condition: buildVerdictMismatch,
	}, now)

	// Suppressed immediately after.
	if !suppressedByCooldown(app, tenant.Id, buildVerdictMismatch, now.Add(time.Hour)) {
		t.Error("an alert sent an hour ago must suppress a repeat")
	}
	// But not after the cooldown lapses — otherwise the alert goes silent forever,
	// which is worse than a repeat.
	if suppressedByCooldown(app, tenant.Id, buildVerdictMismatch, now.Add(buildIntegrityAlertCooldown+time.Hour)) {
		t.Error("the cooldown must lapse, or a standing condition is never re-reported")
	}
}

func TestBuildIntegrityScanner_CooldownIsScopedToTenantAndCondition(t *testing.T) {
	// A tenant can legitimately have BOTH a mismatch and a persistent unknown
	// (different devices). Suppressing one because the other was alerted would
	// hide a genuine second finding.
	app, _ := dashboardMux(t)
	defer app.Cleanup()
	tenant := seedLifecycleTenant(t, app, "scan8@test.com", "active")
	now := time.Now().UTC()

	recordBuildIntegrityAlert(app, buildIntegrityFinding{
		tenantID:  tenant.Id,
		condition: buildVerdictMismatch,
	}, now)

	if suppressedByCooldown(app, tenant.Id, buildVerdictUnknownPersistent, now) {
		t.Error("a different condition for the same tenant must not be suppressed")
	}
}

func TestBuildIntegrityScanner_NoSmtpLogsButDoesNotRecordTheAlert(t *testing.T) {
	// With no relay configured, nobody was told — so the cooldown must NOT start,
	// or the finding would be hidden for a week on the strength of an email that
	// never left. The finding is logged instead.
	app, _ := dashboardMux(t)
	defer app.Cleanup()
	t.Setenv("OZ_SMTP_HOST", "")
	tenant := seedLifecycleTenant(t, app, "scan9@test.com", "active")
	now := time.Now().UTC()

	env := &buildIntegrityAlertEnv{to: "ops@test.com", smtpEnabled: false, now: now}
	sent := alertBuildIntegrityFinding(app, env, buildIntegrityFinding{
		tenantID:  tenant.Id,
		condition: buildVerdictMismatch,
		reports:   1,
	})
	if sent {
		t.Error("no alert should be reported as sent without a relay")
	}
	if suppressedByCooldown(app, tenant.Id, buildVerdictMismatch, now.Add(time.Minute)) {
		t.Error("no cooldown may start for an alert that was never delivered")
	}
}

func TestBuildIntegrityScanner_AlertBodyDistinguishesTheTwoConditions(t *testing.T) {
	// §Q4: a mismatch is evidence of tampering; a persistent unknown may well be
	// OUR bug. Telling an operator they are "under attack" when a serialization
	// bug is at fault is how alerts stop being read.
	mismatchSubject, mismatchBody := renderBuildIntegrityAlert(buildIntegrityFinding{
		tenantID: "t1", email: "a@test.com", condition: buildVerdictMismatch, reports: 1,
	})
	unknownSubject, unknownBody := renderBuildIntegrityAlert(buildIntegrityFinding{
		tenantID: "t1", email: "a@test.com", condition: buildVerdictUnknownPersistent, reports: 7,
	})

	if mismatchSubject == unknownSubject {
		t.Error("the two conditions must not share a subject line")
	}
	if !strings.Contains(mismatchBody, "does NOT lock") {
		t.Error("the mismatch alert must state that nothing auto-locks the device")
	}
	if !strings.Contains(unknownBody, "NOT evidence of tampering") {
		t.Error("the persistent-unknown alert must not read as an accusation")
	}
}

// ── The quota alert ──────────────────────────────────────────────

func TestQuotaAlert_NoSmtpLogsAndDoesNotStartACooldown(t *testing.T) {
	// Same rule as the fingerprint alerts: an alert nobody received must not
	// suppress the next one for a week.
	app, _ := dashboardMux(t)
	defer app.Cleanup()
	t.Setenv("OZ_SMTP_HOST", "")
	tenant := seedLifecycleTenant(t, app, "quotaalert@test.com", "active")
	now := time.Now().UTC()

	env := &buildIntegrityAlertEnv{to: "ops@test.com", smtpEnabled: false, now: now}
	sent := alertTenantOverPosQuota(app, env, tenantOverQuota{
		tenantID: tenant.Id, active: 3, cap: 2, tierKey: "pro",
	})
	if sent {
		t.Error("no alert can be sent without a relay")
	}
	if suppressedByCooldown(app, tenant.Id, quotaAlertCondition, now.Add(time.Minute)) {
		t.Error("a cooldown must not start for an alert that was never delivered")
	}
}

func TestQuotaAlert_DoesNotSuppressTheFingerprintAlert(t *testing.T) {
	// A tenant can be over quota AND have a tampered device. Those are two
	// separate conversations, so alerting on one must not silence the other.
	app, _ := dashboardMux(t)
	defer app.Cleanup()
	tenant := seedLifecycleTenant(t, app, "quotatwoalerts@test.com", "active")
	now := time.Now().UTC()

	recordBuildIntegrityAlert(app, buildIntegrityFinding{
		tenantID:  tenant.Id,
		condition: quotaAlertCondition,
	}, now)

	if suppressedByCooldown(app, tenant.Id, buildVerdictMismatch, now) {
		t.Error("a quota alert must not suppress a fingerprint alert for the same tenant")
	}
}
func TestQuotaAlert_BodyDoesNotAccuseTheMerchant(t *testing.T) {
	// §2.4: an over-cap count has innocent explanations. An alert that reads as
	// an accusation is one an operator learns to ignore, and it would contradict
	// the response policy the section chose.
	subject, body := renderQuotaAlert(tenantOverQuota{
		tenantID: "t1", email: "a@test.com", active: 4, cap: 2, tierKey: "pro",
	})
	if !strings.Contains(subject, "more terminals") {
		t.Errorf("subject should describe the condition, got %q", subject)
	}
	if !strings.Contains(body, "SIGNAL, not proof") {
		t.Error("the body must state the finding is a signal, not a verdict")
	}
	if !strings.Contains(body, "Nothing has been locked") {
		t.Error("the body must say nothing was locked, per the section anti-lockout policy")
	}
	if !strings.Contains(body, "4 active") {
		t.Errorf("the body must show the observed count, got:\n%s", body)
	}
	if !strings.Contains(body, "Allowed:  2") {
		t.Errorf("the body must show the cap, got:\n%s", body)
	}
}
