package main

// Shared SMTP delivery for the OTP and receipt senders (web_otp.go and
// paddle_webhook.go both call sendMailSMTP). Config is read per call by
// the callers so tests can t.Setenv and ops can fix a relay with a
// redeploy; credentials are never echoed in responses or logs.
//
// Transport selection by port:
//
//   - 465  → implicit TLS: the connection is TLS-encrypted from the very
//     first byte (Brevo Option B, plus common relays such as SendGrid's
//     465 endpoint). Go's smtp.SendMail cannot do this (it only supports
//     STARTTLS), so this path dials TLS itself and drives the SMTP
//     conversation manually.
//   - anything else (587, 2525, 25) → smtp.SendMail, i.e. a plaintext
//     connection upgraded with STARTTLS when the server advertises it
//     (Brevo Options A/C).
//
// Auth is always PLAIN over the encrypted channel (implicit TLS, or
// STARTTLS negotiated by SendMail). OZ_SMTP_USER empty → unauthenticated.

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"log"
	"net"
	"net/smtp"
	"net/textproto"
	"os"
	"strings"
	"time"
)

// sendMailSMTP delivers msg to the recipients via host:port using the
// given credentials, choosing the transport by port (see file comment).
//
// LSE-21: the non-465 path REQUIRES STARTTLS — smtp.SendMail upgrades
// only when the server advertises it and silently continues in plaintext
// otherwise, which would leak the auth credentials and the message body
// (OTP codes) to a relay that skips — or a MITM that strips — the
// advertisement. A relay that cannot do STARTTLS must be configured on
// port 465 (implicit TLS) instead.
func sendMailSMTP(host, port, user, password, from string, to []string, msg []byte) error {
	addr := net.JoinHostPort(host, port)
	var auth smtp.Auth
	if user != "" {
		auth = smtp.PlainAuth("", user, password, host)
	}
	if port == "465" {
		return sendMailImplicitTLS(addr, host, auth, from, to, msg)
	}
	return sendMailSTARTTLS(addr, host, auth, from, to, msg)
}

// sendMailSTARTTLS delivers msg over a plaintext connection upgraded with
// STARTTLS (mandatory) and bounded by smtpSendTimeout end to end.
func sendMailSTARTTLS(addr, host string, auth smtp.Auth, from string, to []string, msg []byte) error {
	conn, err := net.DialTimeout("tcp", addr, smtpSendTimeout)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	if err := conn.SetDeadline(time.Now().Add(smtpSendTimeout)); err != nil {
		conn.Close()
		return fmt.Errorf("set deadline: %w", err)
	}
	c, err := smtp.NewClient(conn, host)
	if err != nil {
		conn.Close()
		return fmt.Errorf("smtp.NewClient: %w", err)
	}
	defer c.Close()

	ok, _ := c.Extension("STARTTLS")
	if !ok {
		return fmt.Errorf("relay %s does not advertise STARTTLS — refusing to send credentials/message in plaintext; use port 465 (implicit TLS) instead", addr)
	}
	startTLSCfg := &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}
	if smtpTLSRootCAs != nil {
		startTLSCfg.RootCAs = smtpTLSRootCAs
	}
	if err := c.StartTLS(startTLSCfg); err != nil {
		return fmt.Errorf("starttls: %w", err)
	}
	return deliverSMTPMessage(c, auth, from, to, msg)
}

// deliverSMTPMessage runs AUTH (when credentials are given — refusing to
// send silently unauthenticated), MAIL FROM, RCPT TO for every recipient,
// DATA, and QUIT on an established client.
func deliverSMTPMessage(c *smtp.Client, auth smtp.Auth, from string, to []string, msg []byte) error {
	if auth != nil {
		if ok, _ := c.Extension("AUTH"); !ok {
			return fmt.Errorf("relay does not advertise AUTH but credentials were configured")
		}
		if err := c.Auth(auth); err != nil {
			return fmt.Errorf("smtp.Auth: %w", err)
		}
	}
	if err := c.Mail(from); err != nil {
		return fmt.Errorf("smtp.Mail: %w", err)
	}
	for _, rcpt := range to {
		if err := c.Rcpt(rcpt); err != nil {
			return fmt.Errorf("smtp.Rcpt(%s): %w", rcpt, err)
		}
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("smtp.Data: %w", err)
	}
	if _, err := w.Write(msg); err != nil {
		return fmt.Errorf("smtp data write: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp data close: %w", err)
	}
	if err := c.Quit(); err != nil {
		return fmt.Errorf("smtp.Quit: %w", err)
	}
	return nil
}

// smtpTLSRootCAs is a package-level test hook: nil uses the system root
// pool (production — real relays have publicly trusted certs). Tests point
// it at the in-process server's self-signed cert so the implicit-TLS dial
// verifies without weakening the production path.
var smtpTLSRootCAs *x509.CertPool

// smtpProbeTimeout bounds the boot-time sender-identity probe (dial,
// STARTTLS, AUTH, MAIL FROM) so a slow or dead relay cannot hang deploys.
const smtpProbeTimeout = 5 * time.Second

// smtpSendTimeout bounds the whole message-delivery conversation (dial,
// STARTTLS, AUTH, MAIL/RCPT/DATA). Without it a relay that accepts the
// connection but stalls pins a request goroutine forever — OTP emails are
// sent inside request handlers (LSE-22).
const smtpSendTimeout = 15 * time.Second

// smtpDefaultFrom is the fallback the senders use when OZ_SMTP_FROM is
// unset. The value is a real verified sender on Brevo — relays accept it
// once the DNS records (DKIM, DMARC) are in place. When OZ_SMTP_HOST is
// set but OZ_SMTP_FROM is empty, this default is used and the boot-time
// SMTP probe verifies the relay actually accepts it.
const smtpDefaultFrom = "no-reply@kasir.mu"

// verifySMTPConfig is the boot-time sender-identity gate (called from
// main before the server starts serving). It fails fast when email
// delivery is configured but the sender cannot work:
//
//   - OZ_SMTP_HOST unset → no-op (SMTP not configured; request-otp
//     answers 503 by design, and local dev runs without a relay).
//   - OZ_SMTP_FROM unset → falls back to smtpDefaultFrom, and the
//     relay probe verifies it works (permanent rejection → hard error).
//   - Permanent relay rejection of the sender (5xx on AUTH or MAIL FROM,
//     e.g. Brevo's "550 Sender address is not verified") → hard error.
//   - Transient failures (relay unreachable, 4xx) → log a warning and
//     continue: a relay hiccup at deploy time should not block boot, and
//     the sender check is about identity, not uptime.
//
// The probe never queues a message: it stops at MAIL FROM (no RCPT/DATA),
// so no test email is ever sent.
func verifySMTPConfig() error {
	host := strings.TrimSpace(os.Getenv("OZ_SMTP_HOST"))
	if host == "" {
		return nil
	}
	port := strings.TrimSpace(os.Getenv("OZ_SMTP_PORT"))
	if port == "" {
		port = "587"
	}
	user := os.Getenv("OZ_SMTP_USER")
	password := os.Getenv("OZ_SMTP_PASSWORD")
	from := strings.TrimSpace(os.Getenv("OZ_SMTP_FROM"))

	if from == "" {
		from = smtpDefaultFrom
		log.Printf("OZ_SMTP_FROM not set — falling back to default sender %q (probed at boot)", from)
	}

	if err := probeSMTPFrom(host, port, user, password, from); err != nil {
		var protoErr *textproto.Error
		if errors.As(err, &protoErr) && protoErr.Code >= 500 {
			return fmt.Errorf("SMTP sender identity check failed (permanent rejection): %w", err)
		}
		log.Printf("WARNING: SMTP sender identity probe could not complete (%v) — booting anyway, but signup codes and receipts will fail until the relay is reachable and %q is a verified sender", err, from)
		return nil
	}
	log.Printf("SMTP sender identity verified: %s via %s:%s", from, host, port)
	return nil
}

// probeSMTPFrom opens an SMTP session to host:port (implicit TLS on 465,
// STARTTLS otherwise), authenticates when credentials are given, and
// issues MAIL FROM only. Relays enforce sender identity here — an
// unverified sender gets a permanent 5xx — so nothing is ever queued.
func probeSMTPFrom(host, port, user, password, from string) error {
	addr := net.JoinHostPort(host, port)

	var conn net.Conn
	var err error
	if port == "465" {
		cfg := &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}
		if smtpTLSRootCAs != nil {
			cfg.RootCAs = smtpTLSRootCAs
		}
		conn, err = tls.DialWithDialer(&net.Dialer{Timeout: smtpProbeTimeout}, "tcp", addr, cfg)
	} else {
		conn, err = net.DialTimeout("tcp", addr, smtpProbeTimeout)
	}
	if err != nil {
		return fmt.Errorf("relay unreachable at %s: %w", addr, err)
	}
	// Bound the whole probe (greeting, STARTTLS, AUTH, MAIL FROM reads)
	// in addition to the dial itself.
	conn.SetDeadline(time.Now().Add(smtpProbeTimeout))

	c, err := smtp.NewClient(conn, host)
	if err != nil {
		conn.Close()
		return fmt.Errorf("smtp handshake: %w", err)
	}
	defer c.Close()

	if port != "465" {
		// LSE-21: STARTTLS is mandatory on the probe path too — the probe
		// transmits the auth credentials, which must never cross plaintext.
		ok, _ := c.Extension("STARTTLS")
		if !ok {
			return fmt.Errorf("relay %s does not advertise STARTTLS — refusing to send credentials in plaintext; use port 465 (implicit TLS) instead", addr)
		}
		startTLSCfg := &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}
		if smtpTLSRootCAs != nil {
			startTLSCfg.RootCAs = smtpTLSRootCAs
		}
		if err := c.StartTLS(startTLSCfg); err != nil {
			return fmt.Errorf("starttls: %w", err)
		}
	}
	if user != "" {
		if ok, _ := c.Extension("AUTH"); ok {
			if err := c.Auth(smtp.PlainAuth("", user, password, host)); err != nil {
				return fmt.Errorf("relay rejected credentials: %w", err)
			}
		}
	}
	if err := c.Mail(from); err != nil {
		return fmt.Errorf("relay rejected sender %q (unverified sender identity?): %w", from, err)
	}
	return nil
}

// sendMailImplicitTLS delivers msg over a connection that is TLS-encrypted
// from the first byte (port 465), bounded by smtpSendTimeout end to end.
func sendMailImplicitTLS(addr, host string, auth smtp.Auth, from string, to []string, msg []byte) error {
	cfg := &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}
	if smtpTLSRootCAs != nil {
		cfg.RootCAs = smtpTLSRootCAs
	}
	conn, err := tls.DialWithDialer(&net.Dialer{Timeout: smtpSendTimeout}, "tcp", addr, cfg)
	if err != nil {
		return fmt.Errorf("tls.Dial: %w", err)
	}
	if err := conn.SetDeadline(time.Now().Add(smtpSendTimeout)); err != nil {
		conn.Close()
		return fmt.Errorf("set deadline: %w", err)
	}
	c, err := smtp.NewClient(conn, host)
	if err != nil {
		conn.Close()
		return fmt.Errorf("smtp.NewClient: %w", err)
	}
	defer c.Close()

	return deliverSMTPMessage(c, auth, from, to, msg)
}
