package main

// Sync-terminal registration at link time (ADR #54 §2.5 steps 6-7).
//
// Linking a device to an account is also the moment the device earns a SYNC credential:
// `POST /api/v1/terminals` on the sync service mints a device secret, stores only its hash and
// shows it once. The licence server makes that call because it holds the admin key and because
// a credential must never travel through the renderer.
//
// Availability: this is the one cross-service call in the link path, so it is BEST-EFFORT —
// linking is the primary purpose and must not fail because the sync service is unreachable.
// The response says which happened (`terminal.issued`), so nothing degrades silently, and a
// failure is logged loudly.
//
// Configuration: `OZ_SYNC_API_URL` is the service address (no default: ADR #55's rule is that
// addresses are declared, never guessed), and `OZ_ADMIN_KEY` is the admin key — the SAME
// variable the sync service reads, which is right in the unified deployment where one container
// carries both. Two services with different keys simply get `issued:false` and a log line.

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// syncTerminalPath is the sync service's terminal-registration route.
const syncTerminalPath = "/api/v1/terminals"

// syncTerminalHeader is the header the sync service reads its admin key from
// (crates/kasirmu-api/src/routes/tokens.rs:68).
const syncTerminalHeader = "x-admin-key"

// syncTerminalTimeout bounds the whole registration: a slow sync service must not hold a
// user's link open.
const syncTerminalTimeout = 10 * time.Second

// terminalCredential is what the sync service hands back, shown once.
type terminalCredential struct {
	TerminalID   string
	DeviceSecret string
}

// registerSyncTerminal asks the sync service to mint (or rotate) this device's credentials.
//
// The terminal id is the machine id: stable per installation, and re-registering rotates the
// secret rather than piling up rows.
func registerSyncTerminal(machineID, tenantID string) (*terminalCredential, error) {
	base := strings.TrimSpace(os.Getenv("OZ_SYNC_API_URL"))
	if base == "" {
		return nil, errors.New("OZ_SYNC_API_URL is not configured")
	}
	adminKey := strings.TrimSpace(os.Getenv("OZ_ADMIN_KEY"))
	if adminKey == "" {
		return nil, errors.New("OZ_ADMIN_KEY is not configured")
	}
	body, err := json.Marshal(map[string]string{
		"terminal_id": machineID,
		"label":       "OZ-POS " + machineID,
		"tenant_id":   tenantID,
	})
	if err != nil {
		return nil, fmt.Errorf("encode request: %w", err)
	}
	req, err := http.NewRequest(http.MethodPost, strings.TrimSuffix(base, "/")+syncTerminalPath, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(syncTerminalHeader, adminKey)

	client := &http.Client{Timeout: syncTerminalTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("sync service unreachable: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("sync service answered %d: %s", resp.StatusCode, strings.TrimSpace(string(detail)))
	}
	var parsed struct {
		TerminalID   string `json:"terminal_id"`
		DeviceSecret string `json:"device_secret"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	if parsed.TerminalID == "" || parsed.DeviceSecret == "" {
		return nil, errors.New("sync service answered without a credential")
	}
	return &terminalCredential{TerminalID: parsed.TerminalID, DeviceSecret: parsed.DeviceSecret}, nil
}

// terminalPayloadForLink registers the terminal and shapes the response field.
//
// Best-effort by design: `issued` is always present, so a caller can tell a device that was
// linked but holds no sync credential from one that got everything.
func terminalPayloadForLink(machineID, tenantID string) map[string]any {
	credential, err := registerSyncTerminal(machineID, tenantID)
	if err != nil {
		// Loud, because the account is linked but this device cannot sync yet.
		log.Printf("/desktop/link: no sync credential for tenant %s (machine %s): %v", tenantID, machineID, err)
		return map[string]any{"issued": false, "reason": err.Error()}
	}
	log.Printf("/desktop/link: sync terminal %s registered for tenant %s", credential.TerminalID, tenantID)
	return map[string]any{
		"issued":       true,
		"terminalId":   credential.TerminalID,
		"deviceSecret": credential.DeviceSecret,
	}
}
