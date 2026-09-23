package main

// Tablet Device-Code Pairing (ADR #56 §2.5 / §5 Q1).
//
// Tablets cannot complete Google OAuth in embedded WebViews (ADR #54 §1.7).
// Device-code pairing enables seamless linking:
//  1. Tablet calls POST /api/v1/pairing/start with machine_id.
//     Server creates a pairing session with an 8-character human-friendly Crockford code
//     (e.g. ABCD-1234), a secure poll_token, and a pairing QR URL (https://kasir.mu/pair?code=ABCD-1234).
//  2. Operator scans the QR or visits kasir.mu on their phone (where Google OAuth is supported),
//     authenticates, and calls POST /api/v1/pairing/claim with the code.
//     Server assigns the tenant, registers a sync terminal, and marks the session claimed.
//  3. Tablet polls POST /api/v1/pairing/poll with poll_token.
//     Returns { "status": "pending" } while waiting.
//     Returns { "status": "claimed", "tenant_id": "...", "email": "...", "terminal": { ... } } once claimed.
//     Idempotent: holds the session until TTL so network drops can re-poll without creating duplicate terminals.

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

const (
	pairingSessionTTL  = 10 * time.Minute
	pairingMaxSessions = 5000
	crockfordAlphabet  = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
)

// pairingSession represents an in-flight or claimed device pairing request.
type pairingSession struct {
	Code       string         `json:"code"`
	PollToken  string         `json:"poll_token"`
	MachineID  string         `json:"machine_id"`
	DeviceName string         `json:"device_name"`
	CreatedAt  time.Time      `json:"created_at"`
	ExpiresAt  time.Time      `json:"expires_at"`
	Status     string         `json:"status"` // "pending" | "claimed"
	TenantID   string         `json:"tenant_id,omitempty"`
	Email      string         `json:"email,omitempty"`
	ClaimedAt  time.Time      `json:"claimed_at,omitempty"`
	Terminal   map[string]any `json:"terminal,omitempty"`
}

// pairingStore holds active pairing sessions in memory.
type pairingStore struct {
	mu      sync.Mutex
	byCode  map[string]*pairingSession // keyed by normalized code
	byToken map[string]*pairingSession // keyed by poll token
	max     int
}

var globalPairingStore = &pairingStore{
	byCode:  make(map[string]*pairingSession),
	byToken: make(map[string]*pairingSession),
	max:     pairingMaxSessions,
}

var (
	pairingStartLimiter = &windowLimiter{limit: 30, window: 1 * time.Minute, entries: make(map[string]*windowEntry)}
	pairingClaimLimiter = &windowLimiter{limit: 15, window: 1 * time.Minute, entries: make(map[string]*windowEntry)}
)

func generatePairingCode() (string, error) {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	var sb strings.Builder
	for i, v := range b {
		if i == 4 {
			sb.WriteByte('-')
		}
		sb.WriteByte(crockfordAlphabet[int(v)%len(crockfordAlphabet)])
	}
	return sb.String(), nil
}

func normalizePairingCode(code string) string {
	code = strings.ToUpper(strings.TrimSpace(code))
	code = strings.ReplaceAll(code, "-", "")
	code = strings.ReplaceAll(code, " ", "")
	code = strings.ReplaceAll(code, "O", "0")
	code = strings.ReplaceAll(code, "I", "1")
	code = strings.ReplaceAll(code, "L", "1")
	return code
}

func generatePollToken() (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}

func (s *pairingStore) put(session *pairingSession) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now()
	for k, v := range s.byCode {
		if now.After(v.ExpiresAt) {
			delete(s.byCode, k)
			delete(s.byToken, v.PollToken)
		}
	}

	if len(s.byCode) >= s.max {
		return false
	}

	norm := normalizePairingCode(session.Code)
	s.byCode[norm] = session
	s.byToken[session.PollToken] = session
	return true
}

func (s *pairingStore) getByCode(code string) (*pairingSession, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	norm := normalizePairingCode(code)
	session, ok := s.byCode[norm]
	if !ok || time.Now().After(session.ExpiresAt) {
		return nil, false
	}
	return session, true
}

func (s *pairingStore) getByToken(token string) (*pairingSession, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	session, ok := s.byToken[token]
	if !ok || time.Now().After(session.ExpiresAt) {
		return nil, false
	}
	return session, true
}

func (s *pairingStore) claim(code, tenantID, email string, terminalPayload map[string]any) (*pairingSession, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	norm := normalizePairingCode(code)
	session, ok := s.byCode[norm]
	if !ok || time.Now().After(session.ExpiresAt) {
		return nil, errors.New("invalid or expired pairing code")
	}
	if session.Status == "claimed" {
		return nil, errors.New("pairing code already used")
	}

	session.Status = "claimed"
	session.TenantID = tenantID
	session.Email = email
	session.ClaimedAt = time.Now()
	session.Terminal = terminalPayload
	return session, nil
}

// ── POST /api/v1/pairing/start ──────────────────────────────────────

func handlePairingStart(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		e.Request.Body = http.MaxBytesReader(e.Response, e.Request.Body, webMaxBodyBytes)
		var req struct {
			MachineID  string `json:"machine_id"`
			DeviceName string `json:"device_name"`
		}
		if err := json.NewDecoder(e.Request.Body).Decode(&req); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "invalid JSON body"})
		}
		req.MachineID = strings.TrimSpace(req.MachineID)
		if req.MachineID == "" {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "machine_id is required"})
		}

		if !pairingStartLimiter.allow(e.RealIP()) {
			return e.JSON(http.StatusTooManyRequests, map[string]any{"error": "rate limit exceeded, try again later"})
		}

		code, err := generatePairingCode()
		if err != nil {
			log.Printf("/pairing/start: failed to generate code: %v", err)
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "could not generate pairing code"})
		}

		pollToken, err := generatePollToken()
		if err != nil {
			log.Printf("/pairing/start: failed to generate poll token: %v", err)
			return e.JSON(http.StatusInternalServerError, map[string]any{"error": "could not generate poll token"})
		}

		now := time.Now()
		expiresAt := now.Add(pairingSessionTTL)
		session := &pairingSession{
			Code:       code,
			PollToken:  pollToken,
			MachineID:  req.MachineID,
			DeviceName: strings.TrimSpace(req.DeviceName),
			CreatedAt:  now,
			ExpiresAt:  expiresAt,
			Status:     "pending",
		}

		if !globalPairingStore.put(session) {
			return e.JSON(http.StatusServiceUnavailable, map[string]any{"error": "pairing capacity reached, please try again later"})
		}

		qrURL := fmt.Sprintf("%s/pair?code=%s", oauthSiteURL(), code)
		log.Printf("/pairing/start: created pairing session for machine %s (code %s)", req.MachineID, code)

		return e.JSON(http.StatusOK, map[string]any{
			"code":       code,
			"poll_token": pollToken,
			"expires_at": expiresAt.UTC().Format(time.RFC3339),
			"qr_url":     qrURL,
		})
	}
}

// ── POST /api/v1/pairing/claim ──────────────────────────────────────

func handlePairingClaim(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		e.Request.Body = http.MaxBytesReader(e.Response, e.Request.Body, webMaxBodyBytes)
		var req struct {
			Code     string `json:"code"`
			TenantID string `json:"tenant_id"`
		}
		if err := json.NewDecoder(e.Request.Body).Decode(&req); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "invalid JSON body"})
		}

		if !pairingClaimLimiter.allow(e.RealIP()) {
			return e.JSON(http.StatusTooManyRequests, map[string]any{"error": "rate limit exceeded, try again later"})
		}

		var tenant *core.Record
		if adminKeyOK(e) {
			if strings.TrimSpace(req.TenantID) == "" {
				return e.JSON(http.StatusBadRequest, map[string]any{"error": "tenant_id required when claiming via admin key"})
			}
			tRecord, err := app.FindRecordById("tenants", strings.TrimSpace(req.TenantID))
			if err != nil {
				return e.JSON(http.StatusNotFound, map[string]any{"error": "tenant not found"})
			}
			tenant = tRecord
		} else {
			webTenant, ok := resolveWebSession(app, e)
			if !ok {
				return nil // resolveWebSession wrote 401
			}
			tenant = webTenant
		}

		code := strings.TrimSpace(req.Code)
		if len(normalizePairingCode(code)) != 8 {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "valid 8-character pairing code required"})
		}

		session, ok := globalPairingStore.getByCode(code)
		if !ok {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "invalid or expired pairing code"})
		}
		if session.Status == "claimed" {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "pairing code already used"})
		}

		// Issue sync terminal credentials for this paired device
		terminalPayload := terminalPayloadForLink(session.MachineID, tenant.Id)

		claimedSession, err := globalPairingStore.claim(code, tenant.Id, tenant.GetString("email"), terminalPayload)
		if err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": err.Error()})
		}

		log.Printf("/pairing/claim: paired device %s (code %s) with tenant %s", session.MachineID, code, tenant.Id)

		return e.JSON(http.StatusOK, map[string]any{
			"status":    "claimed",
			"tenant_id": tenant.Id,
			"code":      claimedSession.Code,
		})
	}
}

// ── POST /api/v1/pairing/poll ───────────────────────────────────────

func handlePairingPoll(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		e.Request.Body = http.MaxBytesReader(e.Response, e.Request.Body, webMaxBodyBytes)
		var req struct {
			PollToken string `json:"poll_token"`
		}
		if err := json.NewDecoder(e.Request.Body).Decode(&req); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "invalid JSON body"})
		}

		pollToken := strings.TrimSpace(req.PollToken)
		if pollToken == "" {
			return e.JSON(http.StatusBadRequest, map[string]any{"error": "poll_token is required"})
		}

		session, ok := globalPairingStore.getByToken(pollToken)
		if !ok {
			return e.JSON(http.StatusNotFound, map[string]any{"error": "session not found or expired"})
		}

		if session.Status == "pending" {
			return e.JSON(http.StatusOK, map[string]any{
				"status": "pending",
			})
		}

		return e.JSON(http.StatusOK, map[string]any{
			"status":    "claimed",
			"tenant_id": session.TenantID,
			"email":     session.Email,
			"terminal":  session.Terminal,
		})
	}
}
