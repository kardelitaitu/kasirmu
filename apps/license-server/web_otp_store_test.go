package main

// Direct unit tests for the in-memory OTP/session store (web_otp.go). The
// HTTP-level tests exercise storeCode→takeCode→createSession through the
// endpoints, but the store methods' branch logic — expiry, single-use,
// sliding TTL, idempotency, and the sweep — has no direct unit coverage.
// These pin the store contract so a subtle change (e.g. forgetting to delete
// an expired code) is caught at the unit boundary, not by an auth flake.

import (
	"testing"
	"time"
)

func TestStore_StoreAndTakeCode(t *testing.T) {
	s := &otpStore{codes: map[string]*otpCode{}, sessions: map[string]*webSession{}}
	s.storeCode("a@b.com", "abc123")
	h, ok := s.takeCode("a@b.com")
	if !ok || h != "abc123" {
		t.Fatalf("takeCode = (%q,%v), want (abc123,true)", h, ok)
	}
	// Single-use: the second take must miss.
	if _, ok := s.takeCode("a@b.com"); ok {
		t.Error("takeCode should be single-use — second take must miss")
	}
}

// §2.6: the store keys by purpose as well as by email. The property has two halves, and the
// second is the one a careless implementation drops — the wrong door must refuse WITHOUT
// consuming, or a login attempt could destroy the link code the user was just sent.
func TestStore_CodesArePurposeScoped(t *testing.T) {
	s := &otpStore{codes: map[string]*otpCode{}, sessions: map[string]*webSession{}}
	s.storeCodeFor(purposeLink, "a@b.com", "link-hash")

	if _, ok := s.takeCode("a@b.com"); ok {
		t.Fatal("a link code must not be spendable as a login code")
	}
	if hash, ok := s.takeCodeFor(purposeLink, "a@b.com"); !ok || hash != "link-hash" {
		t.Fatal("the wrong door must refuse without consuming the code")
	}

	s.storeCode("a@b.com", "login-hash")
	if _, ok := s.takeCodeFor(purposeLink, "a@b.com"); ok {
		t.Fatal("a login code must not be spendable as a link code")
	}
	if hash, ok := s.takeCode("a@b.com"); !ok || hash != "login-hash" {
		t.Fatal("the link door must refuse without consuming a login code")
	}
}

func TestStore_TakeCodeExpired(t *testing.T) {
	s := &otpStore{codes: map[string]*otpCode{}, sessions: map[string]*webSession{}}
	s.codes["a@b.com"] = &otpCode{purpose: purposeLogin, hash: "abc123", expiresAt: time.Now().Add(-time.Minute)}
	if _, ok := s.takeCode("a@b.com"); ok {
		t.Error("takeCode must miss for an expired code")
	}
	// And it must be removed (sweep not required for a consumed/expired code).
	if _, exists := s.codes["a@b.com"]; exists {
		t.Error("expired code should be removed by takeCode")
	}
}

func TestStore_DeleteCodeIdempotent(t *testing.T) {
	s := &otpStore{codes: map[string]*otpCode{}, sessions: map[string]*webSession{}}
	s.storeCode("a@b.com", "abc123")
	s.deleteCode("a@b.com")
	s.deleteCode("a@b.com") // idempotent, no panic
	if _, exists := s.codes["a@b.com"]; exists {
		t.Error("deleteCode should remove the code")
	}
}

func TestStore_CreateAndGetSession(t *testing.T) {
	s := &otpStore{codes: map[string]*otpCode{}, sessions: map[string]*webSession{}}
	s.createSession("tokhash1", "tenant1")
	if got := s.getSession("tokhash1"); got != "tenant1" {
		t.Fatalf("getSession = %q, want tenant1", got)
	}
}

func TestStore_GetSessionUnknown(t *testing.T) {
	s := &otpStore{codes: map[string]*otpCode{}, sessions: map[string]*webSession{}}
	if got := s.getSession("nope"); got != "" {
		t.Fatalf("getSession for unknown token = %q, want empty", got)
	}
}

func TestStore_GetSessionExpired(t *testing.T) {
	s := &otpStore{codes: map[string]*otpCode{}, sessions: map[string]*webSession{}}
	s.sessions["tokhash1"] = &webSession{tenantID: "tenant1", expiresAt: time.Now().Add(-time.Minute)}
	if got := s.getSession("tokhash1"); got != "" {
		t.Fatalf("getSession for expired token = %q, want empty", got)
	}
	// And the expired session must be cleaned up.
	if _, exists := s.sessions["tokhash1"]; exists {
		t.Error("expired session should be removed by getSession")
	}
}

func TestStore_DeleteSessionIdempotent(t *testing.T) {
	s := &otpStore{codes: map[string]*otpCode{}, sessions: map[string]*webSession{}}
	s.createSession("tokhash1", "tenant1")
	s.deleteSession("tokhash1")
	s.deleteSession("tokhash1") // idempotent, no panic
	if got := s.getSession("tokhash1"); got != "" {
		t.Errorf("session should be gone after deleteSession, got %q", got)
	}
}

func TestStore_TouchSessionExtendsTTL(t *testing.T) {
	s := &otpStore{codes: map[string]*otpCode{}, sessions: map[string]*webSession{}}
	s.createSession("tokhash1", "tenant1")
	before := s.sessions["tokhash1"].expiresAt
	time.Sleep(5 * time.Millisecond) // ensure expiry would differ
	s.touchSession("tokhash1")
	after := s.sessions["tokhash1"].expiresAt
	if !after.After(before) {
		t.Errorf("touchSession should extend TTL: before=%v after=%v", before, after)
	}
}

func TestStore_TouchSessionUnknownNoOp(t *testing.T) {
	s := &otpStore{codes: map[string]*otpCode{}, sessions: map[string]*webSession{}}
	s.touchSession("nope") // must not panic or add a session
	if _, exists := s.sessions["nope"]; exists {
		t.Error("touchSession must not create a session for an unknown token")
	}
}

func TestStore_SweepRemovesExpiredCodesAndSessions(t *testing.T) {
	s := &otpStore{codes: map[string]*otpCode{}, sessions: map[string]*webSession{}}
	s.codes["expired"] = &otpCode{purpose: purposeLogin, hash: "x", expiresAt: time.Now().Add(-time.Minute)}
	s.codes["fresh"] = &otpCode{purpose: purposeLogin, hash: "y", expiresAt: time.Now().Add(time.Hour)}
	s.sessions["sess-expired"] = &webSession{tenantID: "t", expiresAt: time.Now().Add(-time.Minute)}
	s.sessions["sess-fresh"] = &webSession{tenantID: "t", expiresAt: time.Now().Add(time.Hour)}

	s.sweep()

	if _, exists := s.codes["expired"]; exists {
		t.Error("sweep should remove the expired code")
	}
	if _, exists := s.codes["fresh"]; !exists {
		t.Error("sweep should keep the fresh code")
	}
	if _, exists := s.sessions["sess-expired"]; exists {
		t.Error("sweep should remove the expired session")
	}
	if _, exists := s.sessions["sess-fresh"]; !exists {
		t.Error("sweep should keep the fresh session")
	}
}
