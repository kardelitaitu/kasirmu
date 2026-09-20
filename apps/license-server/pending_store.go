package main

// Single-use pending state for the OAuth-style flows (ADR #54).
//
// Both flows need the same primitive: a state value minted at the start, usable once,
// with a TTL and a ceiling. Extracted here rather than copied, because a second copy of
// a security control is how one of them quietly loses a bound the other still has — and
// the ceiling and the sweep are exactly the parts worth having in one place.
//
// Expired entries are swept opportunistically on insert rather than by a goroutine:
// these maps are bounded by their ceiling and their TTL, so a sweeper would be
// machinery without a purpose.

import (
	"sync"
	"time"
)

// pendingEntry is the one thing the store needs from a payload: when it dies.
type pendingEntry interface {
	expires() time.Time
}

// pendingStore holds in-flight flows keyed by their state value.
type pendingStore[T pendingEntry] struct {
	mu      sync.Mutex
	pending map[string]T
	max     int
}

// newPendingStore creates a store that refuses to hold more than max flows at once.
func newPendingStore[T pendingEntry](max int) *pendingStore[T] {
	return &pendingStore[T]{pending: make(map[string]T), max: max}
}

// put records a pending flow, dropping anything already expired.
//
// Returns false at the ceiling. The start endpoints are unauthenticated (web) or
// cheap to call (desktop), so an unbounded map would let one caller hold the
// process's memory for a TTL window.
func (s *pendingStore[T]) put(state string, p T) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for key, entry := range s.pending {
		if now.After(entry.expires()) {
			delete(s.pending, key)
		}
	}
	if len(s.pending) >= s.max {
		return false
	}
	s.pending[state] = p
	return true
}

// take atomically reads and deletes the pending flow for a state value.
//
// A missing, expired, or already-used state returns the zero value and false — all
// three are the same answer to a caller, which is what makes a replay
// indistinguishable from a bad request.
func (s *pendingStore[T]) take(state string) (T, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var zero T
	p, exists := s.pending[state]
	if !exists {
		return zero, false
	}
	delete(s.pending, state) // single-use, whether or not it is still valid
	if time.Now().After(p.expires()) {
		return zero, false
	}
	return p, true
}

// len reports how many flows are in flight (tests and diagnostics).
func (s *pendingStore[T]) len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.pending)
}
