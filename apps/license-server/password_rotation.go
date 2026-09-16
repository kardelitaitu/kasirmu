package main

// Admin password rotation reminder — emails the superuser when the admin
// password has not been changed in 120 days, repeating every 30 days until
// the password is changed. Uses OnRecordAfterUpdateRequest on _superusers
// to detect password changes and stamp password_changed_at.
//
// Schema:
//
//	password_rotation_state:
//	  email               Text (unique)  — superuser email
//	  password_changed_at DateTime       — when the password was last changed
//	  last_reminder_at    DateTime       — when the last reminder email was sent
//	  password_hash_snap  Text           — last observed password hash (hook diff)
//
// Env:
//
//	OZ_ADMIN_EMAIL — superuser email to check (default: adikaradwiatmaja@gmail.com)
//	OZ_SMTP_*     — shared SMTP config (same as trial_emails)

import (
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

const (
	// passwordRotationDays is the threshold: if the admin password hasn't
	// changed in this many days, a reminder email is sent.
	passwordRotationDays = 120
	// passwordRotationReminderInterval is the minimum gap between repeated
	// reminder emails (30 days, so the 3rd reminder lands at day 180, etc.).
	passwordRotationReminderInterval = 30 * 24 * time.Hour
)

// defaultAdminEmail is the fallback superuser email when OZ_ADMIN_EMAIL is
// not set. The dev's email is the canonical admin.
const defaultAdminEmail = "adikaradwiatmaja@gmail.com"

// ── Collection setup ───────────────────────────────────────────────

// ensurePasswordRotationStateCollection creates the password_rotation_state
// collection if it doesn't exist (idempotent migration).
func ensurePasswordRotationStateCollection(app core.App) error {
	existing, err := app.FindCollectionByNameOrId("password_rotation_state")
	if err == nil {
		// LSE-5 repair: legacy migrations created this collection with
		// empty-string rules on all five actions, which PocketBase treats
		// as PUBLIC guest access (nil is superuser-only). Anonymous writes
		// could suppress or forge rotation reminders.
		return ensureSuperuserOnlyRules(app, existing)
	}

	collection := core.NewBaseCollection("password_rotation_state")
	// Superuser-only (LSE-5): nil rules; "" would be PUBLIC guest access.
	collection.ListRule = nil
	collection.ViewRule = nil
	collection.CreateRule = nil
	collection.UpdateRule = nil
	collection.DeleteRule = nil

	collection.Fields.Add(&core.TextField{
		Name:     "email",
		Required: true,
		Max:      255,
	})
	collection.Fields.Add(&core.DateField{
		Name:     "password_changed_at",
		Required: true,
	})
	collection.Fields.Add(&core.DateField{
		Name:     "last_reminder_at",
		Required: false,
	})
	collection.Fields.Add(&core.TextField{
		Name:     "password_hash_snap",
		Required: false,
		Max:      512,
	})

	return app.Save(collection)
}

// ── Superuser password change hook ─────────────────────────────────

// bindPasswordRotationHook registers the OnRecordAfterUpdateSuccess hook
// on _superusers. RecordEvent has no OldRecord, so the hook diffs the
// new password hash against the last snapshot stored in password_rotation_state
// (persisted after every detected change) to decide whether the password
// actually changed.
func bindPasswordRotationHook(app core.App) {
	app.OnRecordAfterUpdateSuccess("_superusers").BindFunc(func(e *core.RecordEvent) error {
		email := e.Record.GetString("email")
		if email == "" {
			return e.Next()
		}
		newHash := e.Record.GetString("passwordHash")

		state, err := e.App.FindFirstRecordByData("password_rotation_state", "email", email)
		if err != nil || state == nil {
			// No state yet — seed the snapshot without stamping a change.
			if err := seedPasswordState(e.App, email, newHash); err != nil {
				log.Printf("password-rotation: failed to seed state for superuser %q: %v", email, err)
			}
			return e.Next()
		}

		if state.GetString("password_hash_snap") != newHash {
			// Password hash changed — stamp password_changed_at and update the snapshot.
			now := time.Now().UTC().Format(time.RFC3339)
			state.Set("password_changed_at", now)
			state.Set("password_hash_snap", newHash)
			state.Set("last_reminder_at", nil) // reset the reminder counter
			if err := e.App.Save(state); err != nil {
				log.Printf("password-rotation: failed to stamp password_changed_at for superuser %q: %v", email, err)
			} else {
				log.Printf("password-rotation: stamped password_changed_at for superuser %q", email)
			}
		}
		return e.Next()
	})
}

// seedPasswordState creates the password_rotation_state record for a
// superuser that has no state yet, storing the current hash snapshot.
func seedPasswordState(app core.App, email, hash string) error {
	collection, err := app.FindCollectionByNameOrId("password_rotation_state")
	if err != nil {
		return fmt.Errorf("password_rotation_state collection not found: %w", err)
	}
	record := core.NewRecord(collection)
	record.Set("email", email)
	// Backfill password_changed_at from the superuser's created date so the
	// 120-day clock starts from when the account was created.
	su, err := app.FindAuthRecordByEmail(core.CollectionNameSuperusers, email)
	if err == nil && su != nil {
		record.Set("password_changed_at", su.GetDateTime("created").Time().Format(time.RFC3339))
	} else {
		record.Set("password_changed_at", time.Now().UTC().Format(time.RFC3339))
	}
	record.Set("password_hash_snap", hash)
	return app.Save(record)
}

// ── Daily scheduler ───────────────────────────────────────────────

// startPasswordRotationScheduler runs the password rotation scanner daily
// at 08:00 UTC. Blocks forever (intended as a goroutine from OnServe).
func startPasswordRotationScheduler(app core.App) {
	now := time.Now().UTC()
	next8AM := time.Date(now.Year(), now.Month(), now.Day()+1, 8, 0, 0, 0, time.UTC)
	if now.Hour() < 8 {
		next8AM = time.Date(now.Year(), now.Month(), now.Day(), 8, 0, 0, 0, time.UTC)
	}
	time.Sleep(time.Until(next8AM))

	runPasswordRotationScanner(app)
	ticker := time.NewTicker(24 * time.Hour)
	for range ticker.C {
		runPasswordRotationScanner(app)
	}
}

// runPasswordRotationScanner checks if the admin password is overdue for a
// change and sends a reminder email if needed.
func runPasswordRotationScanner(app core.App) {
	if os.Getenv("OZ_SMTP_HOST") == "" {
		log.Println("password-rotation-scanner: OZ_SMTP_HOST not configured — skipping")
		return
	}

	adminEmail := os.Getenv("OZ_ADMIN_EMAIL")
	if adminEmail == "" {
		adminEmail = defaultAdminEmail
	}

	log.Printf("password-rotation-scanner: checking password age for %q", adminEmail)

	// Get or create the password rotation state record.
	state, err := findOrCreatePasswordState(app, adminEmail)
	if err != nil {
		log.Printf("password-rotation-scanner: failed to get state: %v", err)
		return
	}

	passwordChangedAt := state.GetDateTime("password_changed_at").Time()
	if passwordChangedAt.IsZero() {
		log.Printf("password-rotation-scanner: password_changed_at is zero for %q — skipping", adminEmail)
		return
	}

	daysSinceChange := int(time.Now().UTC().Sub(passwordChangedAt).Hours() / 24)
	if daysSinceChange < passwordRotationDays {
		log.Printf("password-rotation-scanner: password is %d days old (< %d) — no reminder needed", daysSinceChange, passwordRotationDays)
		return
	}

	// Check the last reminder interval.
	lastReminder := state.GetDateTime("last_reminder_at").Time()
	if !lastReminder.IsZero() && time.Since(lastReminder) < passwordRotationReminderInterval {
		log.Printf("password-rotation-scanner: last reminder was %s — waiting for 30-day interval", time.Since(lastReminder).Round(time.Hour))
		return
	}

	// Send the reminder email.
	subject := "Reminder: Change your kasir.mu admin password — it's been %d days"
	subject = fmt.Sprintf(subject, daysSinceChange)
	body := fmt.Sprintf(`Hi,

This is an automated reminder from kasir.mu.

Your admin account password has not been changed in %d days.
For security, kasir.mu requires the admin password to be rotated at least every 120 days.

Please change your password now:
https://kasir.mu/account

If you do not change it, you will receive another reminder in 30 days.

— The kasir.mu Team`, daysSinceChange)

	if err := sendPasswordRotationEmail(adminEmail, subject, body); err != nil {
		log.Printf("password-rotation-scanner: failed to send reminder to %q: %v", adminEmail, err)
		return
	}

	// Update the last_reminder_at timestamp.
	state.Set("last_reminder_at", time.Now().UTC().Format(time.RFC3339))
	if err := app.Save(state); err != nil {
		log.Printf("password-rotation-scanner: warning — email sent but state update failed for %q: %v", adminEmail, err)
	}

	log.Printf("password-rotation-scanner: sent password rotation reminder to %q (password is %d days old)", adminEmail, daysSinceChange)
}

// findOrCreatePasswordState returns the password_rotation_state record for
// the admin email, creating it with a default password_changed_at if missing.
func findOrCreatePasswordState(app core.App, email string) (*core.Record, error) {
	record, err := app.FindFirstRecordByData("password_rotation_state", "email", email)
	if err == nil && record != nil {
		return record, nil
	}

	// Create a new record. Default password_changed_at to the superuser's
	// created date (so the clock starts from when the account was created).
	collection, err := app.FindCollectionByNameOrId("password_rotation_state")
	if err != nil {
		return nil, fmt.Errorf("password_rotation_state collection not found: %w", err)
	}

	record = core.NewRecord(collection)
	record.Set("email", email)

	// Try to find the PocketBase superuser to get their created_at date.
	su, _ := app.FindAuthRecordByEmail(core.CollectionNameSuperusers, email)
	if su != nil {
		record.Set("password_changed_at", su.GetDateTime("created").Time().Format(time.RFC3339))
	} else {
		record.Set("password_changed_at", time.Now().UTC().Format(time.RFC3339))
	}

	if err := app.Save(record); err != nil {
		return nil, fmt.Errorf("failed to create password_rotation_state: %w", err)
	}
	log.Printf("password-rotation-scanner: created initial password_rotation_state for %q", email)
	return record, nil
}

// ── Email delivery ────────────────────────────────────────────────

// sendPasswordRotationEmail builds and sends the password rotation reminder
// email via SMTP (same relay as the trial email system).
func sendPasswordRotationEmail(to, subject, body string) error {
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
		from = "no-reply@kasir.mu"
	}

	msg := buildPasswordRotationEmail(from, to, subject, body)
	return sendMailSMTP(host, port, user, password, from, []string{to}, msg)
}

// buildPasswordRotationEmail renders an RFC 5322 message.
func buildPasswordRotationEmail(from, to, subject, body string) []byte {
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
