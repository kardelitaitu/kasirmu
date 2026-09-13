package main

import (
	"fmt"
	"log"
	netmail "net/mail"
	"os"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// trialEmailMilestone defines a day-offset and the email template to send.
type trialEmailMilestone struct {
	// DayOffset is days after trial starts_at when the email fires.
	DayOffset int
	// Segment determines which template set to use ("plus" or "pro").
	Segment string
	// SubjectEN / SubjectID are the bilingual subject lines.
	SubjectEN, SubjectID string
	// BodyEN / BodyID are the bilingual plain-text bodies.
	BodyEN, BodyID string
}

// trialMilestones defines the email schedule per segment (§4).
// Plus trial: day 7 (weekly summary) + day 14 (last day warning).
// Pro trial:  day 7 (kitchen orders) + day 14 (last day warning).
var trialMilestones = []trialEmailMilestone{
	// ── Plus trial (general signup) ──────────────────────────────
	{
		DayOffset: 7,
		Segment:   "plus",
		SubjectEN: "Your first week with OZ-POS — here's what happened",
		SubjectID: "Minggu pertama Anda dengan OZ-POS — ini yang terjadi",
		BodyEN: "Hi there,\n\n" +
			"You've been using OZ-POS for a week now. Here's a quick summary of your activity:\n\n" +
			"• Total sales: %s\n" +
			"• Revenue: %s\n\n" +
			"You're on a 14-day Plus trial, which includes the Daily Sales Dashboard, QRIS payments, and cloud sync.\n\n" +
			"Keep using OZ-POS — your trial continues for %d more days.\n\n" +
			"Questions? Reply to this email or visit https://ozpos.my.id/support\n\n" +
			"— The OZ-POS Team",
		BodyID: "Halo,\n\n" +
			"Anda sudah menggunakan OZ-POS selama seminggu. Berikut ringkasan aktivitas Anda:\n\n" +
			"• Total penjualan: %s\n" +
			"• Pendapatan: %s\n\n" +
			"Anda berada di percobaan Plus 14 hari, yang mencakup Dasbor Penjualan Harian, pembayaran QRIS, dan sinkronisasi cloud.\n\n" +
			"Terus gunakan OZ-POS — percobaan Anda berlanjut selama %d hari lagi.\n\n" +
			"Pertanyaan? Balas email ini atau kunjungi https://ozpos.my.id/support\n\n" +
			"— Tim OZ-POS",
	},
	{
		DayOffset: 14,
		Segment:   "plus",
		SubjectEN: "Your OZ-POS Plus trial ends tomorrow",
		SubjectID: "Percobaan OZ-POS Plus Anda berakhir besok",
		BodyEN: "Hi there,\n\n" +
			"Your 14-day OZ-POS Plus trial ends tomorrow. After that:\n\n" +
			"• The Daily Sales Dashboard will be locked\n" +
			"• QRIS payments will be disabled\n" +
			"• Cloud sync will stop\n" +
			"• Your sales history will be limited to 30 days\n\n" +
			"To keep all these features, upgrade to Plus now:\n" +
			"https://ozpos.my.id/pricing\n\n" +
			"Upgrade ke Plus untuk tetap melihat riwayat penjualan Anda.\n\n" +
			"— The OZ-POS Team",
		BodyID: "Halo,\n\n" +
			"Percobaan OZ-POS Plus 14 hari Anda berakhir besok. Setelah itu:\n\n" +
			"• Dasbor Penjualan Harian akan dikunci\n" +
			"• Pembayaran QRIS akan dinonaktifkan\n" +
			"• Sinkronisasi cloud akan berhenti\n" +
			"• Riwayat penjualan Anda dibatasi 30 hari\n\n" +
			"Untuk mempertahankan semua fitur ini, upgrade ke Plus sekarang:\n" +
			"https://ozpos.my.id/pricing\n\n" +
			"Upgrade ke Plus untuk tetap melihat riwayat penjualan Anda.\n\n" +
			"— Tim OZ-POS",
	},
	// ── Pro trial (restaurant / cafe vertical) ───────────────────
	{
		DayOffset: 7,
		Segment:   "pro",
		SubjectEN: "Your kitchen display this week — OZ-POS Pro trial",
		SubjectID: "Tampilan dapur Anda minggu ini — percobaan OZ-POS Pro",
		BodyEN: "Hi there,\n\n" +
			"You've been using OZ-POS Pro with KDS (Kitchen Display System) for a week. Here's your summary:\n\n" +
			"• Total sales: %s\n" +
			"• Revenue: %s\n\n" +
			"Your Pro trial includes KDS, analytics, and multi-terminal support.\n\n" +
			"You have %d days left in your trial.\n\n" +
			"Questions? Reply to this email or visit https://ozpos.my.id/support\n\n" +
			"— The OZ-POS Team",
		BodyID: "Halo,\n\n" +
			"Anda sudah menggunakan OZ-POS Pro dengan KDS (Tampilan Dapur) selama seminggu. Berikut ringkasannya:\n\n" +
			"• Total penjualan: %s\n" +
			"• Pendapatan: %s\n\n" +
			"Percobaan Pro Anda mencakup KDS, analytics, dan dukungan multi-terminal.\n\n" +
			"Anda memiliki %d hari lagi dalam percobaan.\n\n" +
			"Pertanyaan? Balas email ini atau kunjungi https://ozpos.my.id/support\n\n" +
			"— Tim OZ-POS",
	},
	{
		DayOffset: 14,
		Segment:   "pro",
		SubjectEN: "Your OZ-POS Pro trial ends tomorrow",
		SubjectID: "Percobaan OZ-POS Pro Anda berakhir besok",
		BodyEN: "Hi there,\n\n" +
			"Your 14-day OZ-POS Pro trial ends tomorrow. After that:\n\n" +
			"• KDS (Kitchen Display System) will be deactivated\n" +
			"• Analytics and reports will be locked\n" +
			"• Multi-terminal support will be limited to 1 register\n\n" +
			"To keep these features, upgrade to Pro now:\n" +
			"https://ozpos.my.id/pricing#pro\n\n" +
			"KDS akan dinonaktifkan. Upgrade ke Pro untuk melanjutkan.\n\n" +
			"— The OZ-POS Team",
		BodyID: "Halo,\n\n" +
			"Percobaan OZ-POS Pro 14 hari Anda berakhir besok. Setelah itu:\n\n" +
			"• KDS (Tampilan Dapur) akan dinonaktifkan\n" +
			"• Analytics dan laporan akan dikunci\n" +
			"• Dukungan multi-terminal dibatasi 1 register\n\n" +
			"Untuk mempertahankan fitur ini, upgrade ke Pro sekarang:\n" +
			"https://ozpos.my.id/pricing#pro\n\n" +
			"KDS akan dinonaktifkan. Upgrade ke Pro untuk melanjutkan.\n\n" +
			"— Tim OZ-POS",
	},
}

// trialEmailLog tracks which emails have been sent to avoid duplicates.
// Stored in PocketBase as the "trial_email_log" collection.
type trialEmailLog struct {
	ID           string `json:"id"`
	Subscription string `json:"subscription"` // subscription record ID
	DayOffset    int    `json:"day_offset"`   // which milestone
	SentAt       string `json:"sent_at"`      // RFC3339 timestamp
}

// startTrialEmailScheduler runs the trial email scanner daily at 08:00 UTC.
// It blocks forever (intended to run as a goroutine from OnServe).
func startTrialEmailScheduler(app core.App) {
	// Wait for the first scan until 08:00 UTC tomorrow (or today if
	// it's before 08:00).
	now := time.Now().UTC()
	next8AM := time.Date(now.Year(), now.Month(), now.Day()+1, 8, 0, 0, 0, time.UTC)
	if now.Hour() < 8 {
		next8AM = time.Date(now.Year(), now.Month(), now.Day(), 8, 0, 0, 0, time.UTC)
	}
	time.Sleep(time.Until(next8AM))

	// Run immediately, then every 24 hours.
	runTrialEmailScanner(app)
	ticker := time.NewTicker(24 * time.Hour)
	for range ticker.C {
		runTrialEmailScanner(app)
	}
}

// runTrialEmailScanner scans active trial subscriptions and sends milestone
// emails. Called daily by the scheduler goroutine.
func runTrialEmailScanner(app core.App) {
	if os.Getenv("OZ_SMTP_HOST") == "" {
		log.Println("trial-email-scanner: OZ_SMTP_HOST not configured — skipping")
		return
	}

	log.Println("trial-email-scanner: starting daily scan")

	// 1. Find all active trial subscriptions.
	subs, err := app.FindRecordsByFilter("subscriptions",
		"is_trial = true && status = 'active'",
		"-created", 0, 0)
	if err != nil {
		log.Printf("trial-email-scanner: failed to query subscriptions: %v", err)
		return
	}

	now := time.Now().UTC()
	sent := 0

	for _, sub := range subs {
		// LSE-23: PocketBase datetimes are "2006-01-02 15:04:05.000Z" (no
		// "T"), which time.Parse(RFC3339, ...) always rejects — the old
		// code skipped EVERY subscription, so the scanners never sent a
		// single email. Use the PocketBase DateTime accessor instead.
		startsAt := sub.GetDateTime("starts_at").Time()
		if startsAt.IsZero() {
			log.Printf("trial-email-scanner: skipping sub %s — missing starts_at", sub.Id)
			continue
		}

		daysSinceStart := int(now.Sub(startsAt).Hours() / 24)
		tierKey := sub.GetString("tier_key")

		// Determine segment from tier: plus → "plus", pro → "pro".
		segment := "plus"
		if tierKey == "pro" {
			segment = "pro"
		}

		// Check each milestone for this segment.
		for _, milestone := range trialMilestones {
			if milestone.Segment != segment {
				continue
			}
			// LSE-24: >= (not ==) so a scan skipped by downtime catches up;
			// the trial_email_log idempotency check below prevents
			// duplicates, which is exactly what the log exists for.
			if daysSinceStart < milestone.DayOffset {
				continue
			}

			// Idempotency check: has this email already been sent?
			if emailAlreadySent(app, sub.Id, milestone.DayOffset) {
				continue
			}

			// Get the tenant email.
			tenantID := sub.GetString("tenant_id")
			tenant, err := app.FindRecordById("tenants", tenantID)
			if err != nil {
				log.Printf("trial-email-scanner: skipping sub %s — tenant %s not found: %v", sub.Id, tenantID, err)
				continue
			}
			toEmail := tenant.GetString("email")
			if toEmail == "" {
				log.Printf("trial-email-scanner: skipping sub %s — tenant has no email", sub.Id)
				continue
			}

			// Get usage data for personalized content.
			salesCount, revenue := getTrialUsageSummary(sub)

			// Calculate days remaining.
			expiresAt := sub.GetDateTime("expires_at").Time()
			daysRemaining := int(time.Until(expiresAt).Hours() / 24)
			if daysRemaining < 0 {
				daysRemaining = 0
			}

			// Build the email body with usage data.
			locale := detectLocale(tenant)
			subject := milestone.SubjectEN
			body := fmt.Sprintf(milestone.BodyEN, salesCount, revenue, daysRemaining)
			if locale == "id" {
				subject = milestone.SubjectID
				body = fmt.Sprintf(milestone.BodyID, salesCount, revenue, daysRemaining)
			}

			// Send the email.
			if err := sendTrialEmail(toEmail, subject, body); err != nil {
				log.Printf("trial-email-scanner: failed to send email to %s for sub %s day %d: %v",
					toEmail, sub.Id, milestone.DayOffset, err)
				continue
			}

			// Log for idempotency.
			if err := logTrialEmailSent(app, sub.Id, milestone.DayOffset); err != nil {
				log.Printf("trial-email-scanner: warning — email sent but log write failed for sub %s day %d: %v",
					sub.Id, milestone.DayOffset, err)
			}

			sent++
			log.Printf("trial-email-scanner: sent %s day-%d email to %s", segment, milestone.DayOffset, toEmail)
		}
	}

	log.Printf("trial-email-scanner: scan complete — %d emails sent", sent)

	// Win-back scan: find recently expired subscriptions and send re-engagement emails.
	runWinBackScanner(app)
}

// emailAlreadySent checks the trial_email_log collection for an existing entry.
func emailAlreadySent(app core.App, subscriptionID string, dayOffset int) bool {
	record, err := app.FindFirstRecordByFilter("trial_email_log",
		"subscription = {:sub} && day_offset = {:day}",
		map[string]any{"sub": subscriptionID, "day": dayOffset})
	return err == nil && record != nil
}

// logTrialEmailSent writes an entry to the trial_email_log collection.
func logTrialEmailSent(app core.App, subscriptionID string, dayOffset int) error {
	collection, err := app.FindCollectionByNameOrId("trial_email_log")
	if err != nil {
		return fmt.Errorf("trial_email_log collection not found: %w", err)
	}

	record := core.NewRecord(collection)
	record.Set("subscription", subscriptionID)
	record.Set("day_offset", dayOffset)
	record.Set("sent_at", time.Now().UTC().Format(time.RFC3339))

	return app.Save(record)
}

// getTrialUsageSummary returns a formatted sales count and revenue string
// for the trial period. These are best-effort — if the data isn't available,
// we return placeholder text.
func getTrialUsageSummary(sub *core.Record) (salesCount string, revenue string) {
	// The subscription record doesn't directly contain sales data.
	// We return placeholder text that the client app can fill in
	// via a future enhancement. For now, the email is useful even
	// without personalized metrics — the upgrade CTA is the key element.
	return "several", "Rp ---"
}

// detectLocale returns "id" if the tenant's email or name suggests
// an Indonesian user, otherwise "en". This is a best-effort heuristic.
func detectLocale(tenant *core.Record) string {
	// Check if the tenant has a phone number starting with +62 (Indonesian).
	phone := tenant.GetString("phone")
	if strings.HasPrefix(phone, "+62") || strings.HasPrefix(phone, "62") {
		return "id"
	}
	return "en"
}

// sendTrialEmail builds and sends a trial milestone email via SMTP.
func sendTrialEmail(to, subject, body string) error {
	// LSE-25: `to` lands in an RFC 5322 header AND an RCPT TO command —
	// reject anything that is not a single well-formed address (blocks
	// CRLF/control-character injection; the PocketBase email field is the
	// primary defense, this is defense in depth).
	addr, err := netmail.ParseAddress(to)
	if err != nil || addr.Address != to {
		return fmt.Errorf("invalid recipient address %q", to)
	}

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

	msg := buildTrialEmail(from, to, subject, body)
	return sendMailSMTP(host, port, user, password, from, []string{to}, msg)
}

// buildTrialEmail renders an RFC 5322 message with the given subject and body.
func buildTrialEmail(from, to, subject, body string) []byte {
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

// ensureTrialEmailLogCollection creates the trial_email_log collection
// if it doesn't exist (idempotent migration for existing deployments).
func ensureTrialEmailLogCollection(app core.App) error {
	existing, err := app.FindCollectionByNameOrId("trial_email_log")
	if err == nil {
		// LSE-5 repair: legacy migrations created this collection with
		// empty-string create/update/delete rules, which PocketBase treats
		// as PUBLIC guest writes (nil is superuser-only). Anonymous row
		// tampering would break the email idempotency log.
		return ensureSuperuserOnlyRules(app, existing)
	}

	collection := core.NewBaseCollection("trial_email_log")
	// Superuser-only (LSE-5): nil rules; "" would be PUBLIC guest access.
	collection.ListRule = nil
	collection.ViewRule = nil
	collection.CreateRule = nil
	collection.UpdateRule = nil
	collection.DeleteRule = nil

	collection.Fields.Add(&core.TextField{
		Name:     "subscription",
		Required: true,
		Max:      15,
	})
	collection.Fields.Add(&core.NumberField{
		Name:     "day_offset",
		Required: true,
	})
	collection.Fields.Add(&core.DateField{
		Name:     "sent_at",
		Required: true,
	})

	return app.Save(collection)
}

// ── Win-back campaigns (§7) ──────────────────────────────────────

// winBackMilestones defines when to send win-back emails after churn.
// Day 7 after expiry: "We miss you" with special offer.
// Day 30 after expiry: "Last chance" with deeper discount.
var winBackMilestones = []struct {
	DayOffset            int
	SubjectEN, SubjectID string
	BodyEN, BodyID       string
	LogKey               string // unique key for idempotency
}{
	{
		DayOffset: 7,
		LogKey:    "winback_7d",
		SubjectEN: "We miss you at OZ-POS — here's 20%% off for 3 months",
		SubjectID: "Kami merindukan Anda di OZ-POS — diskon 20%% untuk 3 bulan",
		BodyEN: "Hi there,\n\n" +
			"We noticed your OZ-POS subscription has ended. We'd love to have you back!\n\n" +
			"As a welcome-back offer, here's 20%% off for the next 3 months:\n" +
			"https://ozpos.my.id/pricing?offer=winback20\n\n" +
			"Your data is still safe — upgrade now and pick up right where you left off.\n\n" +
			"— The OZ-POS Team",
		BodyID: "Halo,\n\n" +
			"Kami perhatikan langganan OZ-POS Anda sudah berakhir. Kami ingin Anda kembali!\n\n" +
			"Sebagai penawaran kembali, berikut diskon 20%% untuk 3 bulan ke depan:\n" +
			"https://ozpos.my.id/pricing?offer=winback20\n\n" +
			"Data Anda masih aman — upgrade sekarang dan lanjutkan dari mana Anda berhenti.\n\n" +
			"— Tim OZ-POS",
	},
	{
		DayOffset: 30,
		LogKey:    "winback_30d",
		SubjectEN: "Last chance: 30%% off OZ-POS — your data expires soon",
		SubjectID: "Kesempatan terakhir: diskon 30%% OZ-POS — data Anda segera expired",
		BodyEN: "Hi there,\n\n" +
			"It's been a month since your OZ-POS subscription ended. This is our final offer.\n\n" +
			"Upgrade now with 30%% off for 3 months:\n" +
			"https://ozpos.my.id/pricing?offer=winback30\n\n" +
			"After this, your data will be permanently deleted per our retention policy.\n\n" +
			"— The OZ-POS Team",
		BodyID: "Halo,\n\n" +
			"Sudah sebulan sejak langganan OZ-POS Anda berakhir. Ini penawaran terakhir kami.\n\n" +
			"Upgrade sekarang dengan diskon 30%% untuk 3 bulan:\n" +
			"https://ozpos.my.id/pricing?offer=winback30\n\n" +
			"Setelah ini, data Anda akan dihapus permanen sesuai kebijakan retensi kami.\n\n" +
			"— Tim OZ-POS",
	},
}

// runWinBackScanner finds expired subscriptions and sends win-back emails.
func runWinBackScanner(app core.App) {
	if os.Getenv("OZ_SMTP_HOST") == "" {
		return
	}

	log.Println("winback-scanner: starting daily scan")

	// Find expired subscriptions (status = 'expired' or 'grace_period' past grace_until).
	subs, err := app.FindRecordsByFilter("subscriptions",
		"(status = 'expired' || (status = 'grace_period' && grace_until != '' && grace_until < {:now}))",
		"-created", 0, 0,
		map[string]any{"now": time.Now().UTC().Format(time.RFC3339)})
	if err != nil {
		log.Printf("winback-scanner: failed to query subscriptions: %v", err)
		return
	}

	now := time.Now().UTC()
	sent := 0

	for _, sub := range subs {
		// LSE-23: GetDateTime, not RFC3339 parse of the raw PB string.
		expiresAt := sub.GetDateTime("expires_at").Time()
		if expiresAt.IsZero() {
			continue
		}
		daysSinceExpiry := int(now.Sub(expiresAt).Hours() / 24)

		for _, milestone := range winBackMilestones {
			// LSE-24: catch-up semantics, same rationale as the trial scanner.
			if daysSinceExpiry < milestone.DayOffset {
				continue
			}

			// Idempotency: check trial_email_log for this subscription + log key.
			if winBackAlreadySent(app, sub.Id, milestone.LogKey) {
				continue
			}

			// Get tenant email.
			tenantID := sub.GetString("tenant_id")
			tenant, err := app.FindRecordById("tenants", tenantID)
			if err != nil {
				continue
			}
			toEmail := tenant.GetString("email")
			if toEmail == "" {
				continue
			}

			locale := detectLocale(tenant)
			subject := milestone.SubjectEN
			body := milestone.BodyEN
			if locale == "id" {
				subject = milestone.SubjectID
				body = milestone.BodyID
			}

			if err := sendTrialEmail(toEmail, subject, body); err != nil {
				log.Printf("winback-scanner: failed to send to %s for sub %s day %d: %v",
					toEmail, sub.Id, milestone.DayOffset, err)
				continue
			}

			// Log for idempotency (reuse trial_email_log with a negative day_offset
			// to distinguish from trial milestone emails).
			if err := logWinBackEmailSent(app, sub.Id, milestone.LogKey); err != nil {
				log.Printf("winback-scanner: warning — email sent but log write failed: %v", err)
			}

			sent++
			log.Printf("winback-scanner: sent %s to %s", milestone.LogKey, toEmail)
		}
	}

	log.Printf("winback-scanner: scan complete — %d emails sent", sent)
}

// winBackAlreadySent checks if a win-back email was already sent.
func winBackAlreadySent(app core.App, subscriptionID, logKey string) bool {
	record, err := app.FindFirstRecordByFilter("trial_email_log",
		"subscription = {:sub} && day_offset = {:day}",
		map[string]any{"sub": subscriptionID, "day": hashLogKey(logKey)})
	return err == nil && record != nil
}

// logWinBackEmailSent records a win-back email as sent.
func logWinBackEmailSent(app core.App, subscriptionID, logKey string) error {
	collection, err := app.FindCollectionByNameOrId("trial_email_log")
	if err != nil {
		return err
	}
	record := core.NewRecord(collection)
	record.Set("subscription", subscriptionID)
	record.Set("day_offset", hashLogKey(logKey)) // negative = win-back
	record.Set("sent_at", time.Now().UTC().Format(time.RFC3339))
	return app.Save(record)
}

// hashLogKey converts a string log key to a deterministic integer for
// storage in the day_offset field. Negative values indicate win-back emails.
func hashLogKey(key string) int {
	h := 0
	for _, c := range key {
		h = h*31 + int(c)
	}
	return -(h%9000 + 1000) // negative, between -1000 and -9999
}
