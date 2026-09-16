package main

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"net/mail"
	"os"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// Contact form limits — kept in sync with the website's ContactForm.tsx
// (name ≤100, email ≤200, message 10–2000). The server re-validates even
// though the client enforces maxLength, because the endpoint is public.
const (
	contactMaxBodyBytes = 16 * 1024 // generous headroom over the form payload
	contactNameMax      = 100
	contactEmailMax     = 200
	contactMessageMin   = 10
	contactMessageMax   = 2000
	// discordContentMax is Discord's webhook `content` limit (2000 chars);
	// we keep a safety margin below it.
	discordContentMax = 1900
	// contactWebhookTimeout bounds the outgoing Discord call so a slow
	// webhook can't pin a request goroutine forever.
	contactWebhookTimeout = 10 * time.Second
)

// contactRateLimiter limits support-form submissions to 5 per IP per hour.
// It deliberately uses its OWN in-memory-only bucket instead of sharing the
// persisted ipRateLimiter: the contact form is an unauthenticated public
// surface, so a spammer must not be able to drain the license-activation
// budget, and vice versa. It is intentionally NOT persisted to SQLite —
// the persistence table rate_limit_ip_buckets is keyed by IP alone, so two
// limiters sharing it would clobber each other's tokens. A restart resetting
// an in-memory contact bucket is acceptable for a support form.
var contactRateLimiter = &rateLimiter{
	buckets:  make(map[string]*tokenBucket),
	maxPerHr: 5,
}

// handleContact accepts a support message and forwards it to the team's
// Discord channel via the OZ_DISCORD_WEBHOOK URL.
//
// POST /api/v1/web/contact
// Content-Type: application/json
//
//	{
//	  "name": "Budi Santoso",          // required, ≤100 chars
//	  "email": "budi@example.com",     // required, ≤200 chars, valid address
//	  "message": "QRIS is not showing",// required, 10–2000 chars
//	  "website": ""                    // honeypot — if set, silently accepted
//	}
//
// Behaviour:
//   - Rate limited to 5/IP/hour (429), checked BEFORE validation so failed
//     attempts burn the same budget.
//   - The honeypot `website` field, when non-empty, is silently accepted
//     (200) without forwarding — naive bots pass, humans never see it.
//   - OZ_DISCORD_WEBHOOK unset → 503 "not configured" (the site degrades to
//     the mailto fallback). The server still boots without it.
//   - Discord unreachable or non-2xx → 502 (client can show the generic
//     error and retry later).
//
// The webhook URL is read per-request so tests can t.Setenv it and operators
// can correct it with a redeploy; it is never echoed in responses or logs.
func handleContact(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		e.Request.Body = http.MaxBytesReader(e.Response, e.Request.Body, contactMaxBodyBytes)

		// ── Rate limit: 5 per IP per hour (dedicated bucket) ──
		if !contactRateLimiter.allow(e.RealIP()) {
			return e.JSON(http.StatusTooManyRequests, map[string]any{
				"error": "rate limit exceeded, try again later",
			})
		}

		// ── Decode + validate ──────────────────────────────────
		var req struct {
			Name    string `json:"name"`
			Email   string `json:"email"`
			Message string `json:"message"`
			Website string `json:"website"` // honeypot
		}
		if err := json.NewDecoder(e.Request.Body).Decode(&req); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "invalid JSON body",
			})
		}

		// Honeypot: pretend success without forwarding.
		if strings.TrimSpace(req.Website) != "" {
			log.Printf("/web/contact: honeypot triggered (message dropped)")
			return e.JSON(http.StatusOK, map[string]any{"status": "sent"})
		}

		name := strings.TrimSpace(req.Name)
		email := strings.TrimSpace(req.Email)
		message := strings.TrimSpace(req.Message)
		if name == "" || len(name) > contactNameMax {
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "name is required and must be at most 100 characters",
			})
		}
		if email == "" || len(email) > contactEmailMax {
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "email is required and must be at most 200 characters",
			})
		}
		addr, err := mail.ParseAddress(email)
		if err != nil || addr.Address != email {
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "email must be a valid address",
			})
		}
		if len(message) < contactMessageMin || len(message) > contactMessageMax {
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error": "message must be between 10 and 2000 characters",
			})
		}

		webhook := os.Getenv("OZ_DISCORD_WEBHOOK")
		if strings.TrimSpace(webhook) == "" {
			log.Printf("/web/contact: OZ_DISCORD_WEBHOOK not configured — dropping message from %q", email)
			return e.JSON(http.StatusServiceUnavailable, map[string]any{
				"error": "contact forwarding is not configured",
			})
		}

		if err := postToDiscord(webhook, name, email, message); err != nil {
			log.Printf("/web/contact: Discord forward failed for %q: %v", email, err)
			return e.JSON(http.StatusBadGateway, map[string]any{
				"error": "could not deliver the message, please try again later",
			})
		}

		log.Printf("/web/contact: forwarded message from %q (%q)", email, name)
		return e.JSON(http.StatusOK, map[string]any{"status": "sent"})
	}
}

// postToDiscord POSTs the support message to the channel webhook. The message
// body is wrapped in a code block so Discord can't reinterpret user text as
// markdown, and truncated to stay under Discord's content limit.
func postToDiscord(webhook, name, email, message string) error {
	const header = "**New support message**"
	// Discord content limit is 2000; budget: header + name/email lines + code fence.
	msgBudget := discordContentMax - len(header) - len(name) - len(email) - 64
	if msgBudget < contactMessageMin {
		msgBudget = contactMessageMin
	}
	if len(message) > msgBudget {
		// Rune-safe truncation: byte-slicing could split a multi-byte
		// character and produce invalid UTF-8 in the JSON payload.
		runes := []rune(message)
		if len(runes) > msgBudget {
			runes = runes[:msgBudget]
		}
		message = string(runes)
	}

	content := header + "\n**Name:** " + name + "\n**Email:** " + email +
		"\n**Message:**\n```\n" + message + "\n```"

	// LSE-20: disable all Discord mentions. name/email come from an
	// unauthenticated public form and are interpolated as markdown OUTSIDE
	// the code fence — without allowed_mentions a `@everyone` in the name
	// field pings the whole support channel (webhook mentions are on by
	// default).
	payload, err := json.Marshal(map[string]any{
		"content":          content,
		"username":         "kasir.mu Support",
		"allowed_mentions": map[string]any{"parse": []string{}},
	})
	if err != nil {
		return err
	}

	client := &http.Client{Timeout: contactWebhookTimeout}
	req, err := http.NewRequest(http.MethodPost, webhook, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "oz-pos-license-server/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		return &webhookStatusError{code: resp.StatusCode}
	}
	return nil
}

// webhookStatusError reports a non-2xx Discord response.
type webhookStatusError struct{ code int }

func (e *webhookStatusError) Error() string {
	return "discord webhook returned " + http.StatusText(e.code)
}
