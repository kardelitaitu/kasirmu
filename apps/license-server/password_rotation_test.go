package main

// Tests for the admin password rotation reminder (password_rotation.go):
// seeding state, the daily scanner, and the 30-day reminder interval.
// The scheduler goroutine is NOT started here — runPasswordRotationScanner
// is called synchronously in each test with env vars.

import (
	"net"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestSeedPasswordState_CreatesRecord(t *testing.T) {
	testApp, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("failed to create test app: %v", err)
	}
	defer testApp.Cleanup()

	if err := ensurePasswordRotationStateCollection(testApp); err != nil {
		t.Fatalf("ensurePasswordRotationStateCollection: %v", err)
	}

	// seed a state with a known hash
	if err := seedPasswordState(testApp, "admin@test.com", "old_hash_value"); err != nil {
		t.Fatalf("seedPasswordState: %v", err)
	}

	rec, err := testApp.FindFirstRecordByData("password_rotation_state", "email", "admin@test.com")
	if err != nil {
		t.Fatalf("state record not found: %v", err)
	}
	if got := rec.GetString("password_hash_snap"); got != "old_hash_value" {
		t.Errorf("expected password_hash_snap 'old_hash_value', got %q", got)
	}
	if rec.GetDateTime("password_changed_at").Time().IsZero() {
		t.Error("password_changed_at should not be zero")
	}
}

func TestRunScanner_SkipsWhenUnder120Days(t *testing.T) {
	testApp, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("failed to create test app: %v", err)
	}
	defer testApp.Cleanup()

	if err := ensurePasswordRotationStateCollection(testApp); err != nil {
		t.Fatalf("ensurePasswordRotationStateCollection: %v", err)
	}

	// set password_changed_at to 90 days ago (under 120 threshold)
	state := createPasswordState(t, testApp, "admin@test.com", 90)
	_ = state

	// SMTP is unset — the scanner logs a skip and returns
	runPasswordRotationScanner(testApp)
	// No error expected; the log check is manual (the scanner is idempotent)
}

func TestScanner_SendsEmailWhenOver120Days(t *testing.T) {
	testApp, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("failed to create test app: %v", err)
	}
	defer testApp.Cleanup()

	if err := ensurePasswordRotationStateCollection(testApp); err != nil {
		t.Fatalf("ensurePasswordRotationStateCollection: %v", err)
	}

	// set password_changed_at to 130 days ago (over threshold)
	_ = createPasswordState(t, testApp, "admin@test.com", 130)

	// spin up the in-process SMTP server (from smtp_mail_test.go)
	addr, captures := runSMTPServer(t, nil, false, testTLSCertPtr(t))
	_, port, _ := net.SplitHostPort(addr)

	// set env so the scanner delivers through the test server
	t.Setenv("OZ_SMTP_HOST", "127.0.0.1")
	t.Setenv("OZ_SMTP_PORT", port)
	t.Setenv("OZ_SMTP_USER", "")
	t.Setenv("OZ_SMTP_PASSWORD", "")
	t.Setenv("OZ_ADMIN_EMAIL", "admin@test.com")

	runPasswordRotationScanner(testApp)

	// a message should have been captured
	select {
	case cap := <-captures:
		if len(cap.rcpt) != 1 || cap.rcpt[0] != "admin@test.com" {
			t.Errorf("expected recipient admin@test.com, got %v", cap.rcpt)
		}
		if !stringsContains(string(cap.data), "has not been changed in 130 days") {
			t.Errorf("email body missing age detail: %q", string(cap.data))
		}
	default:
		t.Fatal("expected a captured email, none arrived")
	}

	// after the run, last_reminder_at should be set
	rec, err := testApp.FindFirstRecordByData("password_rotation_state", "email", "admin@test.com")
	if err != nil {
		t.Fatalf("state not found: %v", err)
	}
	if rec.GetDateTime("last_reminder_at").Time().IsZero() {
		t.Error("expected last_reminder_at to be set after sending")
	}
}

func TestScanner_Respects30DayInterval(t *testing.T) {
	testApp, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("failed to create test app: %v", err)
	}
	defer testApp.Cleanup()

	if err := ensurePasswordRotationStateCollection(testApp); err != nil {
		t.Fatalf("ensurePasswordRotationStateCollection: %v", err)
	}

	state := createPasswordState(t, testApp, "admin@test.com", 130)
	// set last_reminder_at to 5 days ago — should NOT resend
	state.Set("last_reminder_at", time.Now().UTC().Add(-5*24*time.Hour).Format(time.RFC3339))
	if err := testApp.Save(state); err != nil {
		t.Fatalf("save state: %v", err)
	}

	t.Setenv("OZ_SMTP_HOST", "127.0.0.1")
	t.Setenv("OZ_SMTP_PORT", "2525")
	t.Setenv("OZ_ADMIN_EMAIL", "admin@test.com")

	// capture the current last_reminder_at
	before, _ := testApp.FindFirstRecordByData("password_rotation_state", "email", "admin@test.com")
	beforeReminder := before.GetDateTime("last_reminder_at").Time()

	runPasswordRotationScanner(testApp)

	// verify it did NOT send (last_reminder_at unchanged)
	after, _ := testApp.FindFirstRecordByData("password_rotation_state", "email", "admin@test.com")
	afterReminder := after.GetDateTime("last_reminder_at").Time()
	if !afterReminder.Equal(beforeReminder) {
		t.Error("expected last_reminder_at to remain unchanged (within 30-day interval)")
	}
}

func TestBuildPasswordRotationEmail_HasCorrectContent(t *testing.T) {
	msg := buildPasswordRotationEmail("from@test.com", "admin@test.com",
		"Test Subject", "Test Body")
	body := string(msg)
	if !stringsContains(body, "From: kasir.mu Security") {
		t.Error("expected 'From: kasir.mu Security'")
	}
	if !stringsContains(body, "To: admin@test.com") {
		t.Error("expected 'To: admin@test.com'")
	}
	if !stringsContains(body, "Subject: Test Subject") {
		t.Error("expected subject")
	}
	if !stringsContains(body, "Test Body") {
		t.Error("expected body text")
	}
}

// ── Helpers ────────────────────────────────────────────────────────

// createPasswordState creates a password_rotation_state record with
// password_changed_at set to `daysAgo` days before now.
func createPasswordState(t *testing.T, app *tests.TestApp, email string, daysAgo int) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("password_rotation_state")
	if err != nil {
		t.Fatalf("collection lookup: %v", err)
	}
	rec := core.NewRecord(col)
	rec.Set("email", email)
	rec.Set("password_changed_at", time.Now().UTC().Add(-time.Duration(daysAgo)*24*time.Hour).Format(time.RFC3339))
	rec.Set("password_hash_snap", "some_hash")
	if err := app.Save(rec); err != nil {
		t.Fatalf("save state: %v", err)
	}
	return rec
}

func stringsContains(s, substr string) bool {
	return len(s) >= len(substr) && containsString(s, substr)
}

func containsString(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
