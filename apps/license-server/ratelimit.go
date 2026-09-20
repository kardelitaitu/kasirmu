package main

import (
	"log"
	"os"
	"runtime/debug"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// rateLimiter is a token-bucket per IP rate limiter with SQLite
// persistence (H2 audit) so server restarts cannot reset a brute-force
// attacker's rate-limit state. The in-memory map is the authority for
// allow() decisions during the request hot path; SQLite is mirrored via
// a write-through UPSERT after each in-memory update so a fresh process
// boot hydrates from disk. Background cleanup via a goroutine avoids
// O(N) lock contention on idle buckets.
type rateLimiter struct {
	mu             sync.Mutex
	buckets        map[string]*tokenBucket
	maxPerHr       int
	stopCleanup    chan struct{}
	cleanupRunning bool

	// db is the PocketBase app used for SQLite persistence of bucket
	// state. Wired by attachPersistence; may be nil (in tests that
	// don't set up an app, or before attachPersistence runs in
	// main.go). When set, allow() writes through to app.DB() after
	// each in-memory update.
	db core.App
}

type tokenBucket struct {
	tokens   int
	lastFill time.Time
}

const ipCleanupInterval = 30 * time.Minute
const ipBucketTTL = 2 * time.Hour

// attestMaxPerHr is the boot-time attest probe's own per-IP budget. It is
// deliberately 12x the credential budget: a plain app launch spends a token
// here, and five launches in an hour must not leave the user's activation
// attempts answering 429.
const attestMaxPerHr = 60

// ipRateLimiter limits activation attempts to 5 per IP per hour.
var ipRateLimiter = &rateLimiter{
	buckets:  make(map[string]*tokenBucket),
	maxPerHr: 5,
}

// attestLimiter is the SEPARATE per-IP budget for POST /api/v1/license/attest
// (see attest.go). It exists so the unauthenticated boot-time attest probe —
// which verifies no credential and mints only a fixed-size signature over a
// charset-bounded nonce — cannot drain the 5/hr credential budget shared by
// activate/recover/renew/status/pause/resume/trial/enterprise-trial. Launching
// the app is not an abuse signal; trying five license keys in an hour is.
//
// It stays in-memory only (like contactRateLimiter): the persisted
// rate_limit_ip_buckets table is keyed by IP alone, so a second persisted
// limiter would clobber ipRateLimiter's tokens for the same IP. A restart
// resetting a probe budget is harmless — the endpoint is cheap and the
// credential limiter keeps its restart-survival guarantee.
var attestLimiter = &rateLimiter{
	buckets:  make(map[string]*tokenBucket),
	maxPerHr: attestMaxPerHr,
}

// startCleanup launches a background goroutine that periodically sweeps
// expired buckets to prevent unbounded memory growth. Call stopCleanup
// to shut it down (e.g. in tests). Idempotent; no-op if already running.
func (rl *rateLimiter) startCleanup() {
	rl.mu.Lock()
	if rl.cleanupRunning {
		rl.mu.Unlock()
		return
	}
	rl.stopCleanup = make(chan struct{})
	rl.cleanupRunning = true
	ch := rl.stopCleanup
	rl.mu.Unlock()

	go func() {
		ticker := time.NewTicker(ipCleanupInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				rl.sweep()
			case <-ch:
				return
			}
		}
	}()
}

// stop terminates the background cleanup goroutine. Idempotent.
func (rl *rateLimiter) stop() {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	if !rl.cleanupRunning {
		return
	}
	close(rl.stopCleanup)
	rl.cleanupRunning = false
}

// sweep removes buckets that haven't been used in ipBucketTTL.
// Called by the background goroutine; also exposed for tests.
func (rl *rateLimiter) sweep() {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	for k, v := range rl.buckets {
		if now.Sub(v.lastFill) > ipBucketTTL {
			delete(rl.buckets, k)
		}
	}
}

func (rl *rateLimiter) allow(ip string) bool {
	rl.mu.Lock()

	bucket, ok := rl.buckets[ip]
	if !ok {
		bucket = &tokenBucket{tokens: rl.maxPerHr, lastFill: time.Now()}
		rl.buckets[ip] = bucket
	}

	// Refill tokens if an hour has passed since the last fill.
	if time.Since(bucket.lastFill) >= time.Hour {
		bucket.tokens = rl.maxPerHr
		bucket.lastFill = time.Now()
	}

	allowed := false
	if bucket.tokens > 0 {
		bucket.tokens--
		allowed = true
	}

	// Snapshot for persistence, then release the lock so other IPs
	// (and the keyFailTracker) can flow concurrently while SQLite is
	// being written to. In-memory is the authority for the allow()
	// decision; SQLite is just for restart survival.
	dbAttached := rl.db != nil
	var (
		snapIP       string
		snapTokens   int
		snapLastFill time.Time
	)
	if dbAttached {
		snapIP = ip
		snapTokens = bucket.tokens
		snapLastFill = bucket.lastFill
	}
	rl.mu.Unlock()

	if dbAttached {
		if err := rl.persistBucket(snapIP, snapTokens, snapLastFill); err != nil {
			log.Printf("ipRateLimiter: persist error for ip=%q (in-memory still authoritative): %v",
				ip, err)
		}
	}
	return allowed
}

// ── Persistence (H2 audit) ────────────────────────────────────────

// attachPersistence wires the rate limiter to a PocketBase app's
// SQLite so bucket state survives server restarts. Idempotent: no-op
// if already attached. createSchema then hydrate. Logs and returns on
// schema/hydrate errors so in-memory-only mode is the last-resort
// fallback (tests + warm-up phases benefit from graceful degradation).
func (rl *rateLimiter) attachPersistence(app core.App) {
	if app == nil {
		return
	}
	rl.mu.Lock()
	if rl.db != nil {
		rl.mu.Unlock()
		return
	}
	rl.db = app
	rl.mu.Unlock()

	if err := rl.createSchema(); err != nil {
		log.Printf("ipRateLimiter: failed to create schema (in-memory-only mode): %v", err)
		return
	}
	if err := rl.hydrate(); err != nil {
		log.Printf("ipRateLimiter: hydrate error (in-memory state may be partial): %v", err)
	}
}

// createSchema runs once on attach. PocketBase does not auto-migrate
// table-only collections, so we drive the DDL ourselves.
func (rl *rateLimiter) createSchema() error {
	_, err := rl.db.DB().NewQuery(
		`CREATE TABLE IF NOT EXISTS rate_limit_ip_buckets (
			ip TEXT PRIMARY KEY,
			tokens INTEGER NOT NULL,
			last_fill TEXT NOT NULL
		)`,
	).Execute()
	return err
}

// hydrate loads non-stale rows from SQLite into the in-memory map.
// Stale rows (last_fill older than ipBucketTTL=2h) are skipped:
// they're effectively expired and would only slow the next
// read-modify-write without affecting the allow() decision.
func (rl *rateLimiter) hydrate() error {
	rows, err := rl.db.DB().NewQuery(
		`SELECT ip, tokens, last_fill FROM rate_limit_ip_buckets`,
	).Rows()
	if err != nil {
		return err
	}
	defer rows.Close()

	type loaded struct {
		ip       string
		tokens   int
		lastFill time.Time
	}
	var pending []loaded
	now := time.Now()
	for rows.Next() {
		var ip, lastFillStr string
		var tokens int
		if err := rows.Scan(&ip, &tokens, &lastFillStr); err != nil {
			return err
		}
		lastFill, err := time.Parse(time.RFC3339, lastFillStr)
		if err != nil {
			log.Printf("ipRateLimiter: skipping row with unparseable last_fill=%q: %v",
				lastFillStr, err)
			continue
		}
		if now.Sub(lastFill) > ipBucketTTL {
			continue
		}
		pending = append(pending, loaded{ip: ip, tokens: tokens, lastFill: lastFill})
	}

	rl.mu.Lock()
	defer rl.mu.Unlock()
	for _, p := range pending {
		rl.buckets[p.ip] = &tokenBucket{tokens: p.tokens, lastFill: p.lastFill}
	}
	return nil
}

// persistBucket UPSERTs the bucket state. Called outside the in-memory
// mutex so concurrent IPs flow freely; last-write-wins is correct
// because all concurrent writers commit the same post-decrement value
// for the same (ip) row.
func (rl *rateLimiter) persistBucket(ip string, tokens int, lastFill time.Time) (err error) {
	if rl.db == nil {
		return nil
	}
	defer func() {
		if r := recover(); r != nil {
			log.Printf("ipRateLimiter: recovered persist panic for ip=%q (in-memory still authoritative): %v\n%s", ip, r, string(debug.Stack()))
			err = nil
		}
	}()
	// MIN/MAX guards prevent token regression under concurrent UPSERTs
	// (H2 audit): allow() releases the in-memory mutex BEFORE writing
	// through, so multiple writers can race into SQLite. MIN(tokens, ...)
	// ensures the persisted bucket can only ever drop, never refill
	// via a stale snapshot — closing the restart-survival bypass where
	// the LAST UPSERT wins regardless of "last"-ness. MAX(last_fill, ...)
	// keeps the refill-marker monotonic so an out-of-order writer can't
	// rewind it.
	_, err = rl.db.DB().NewQuery(
		`INSERT INTO rate_limit_ip_buckets (ip, tokens, last_fill)
		 VALUES ({:ip}, {:tokens}, {:last_fill})
		 ON CONFLICT(ip) DO UPDATE SET
		   tokens = MIN(tokens, excluded.tokens),
		   last_fill = MAX(last_fill, excluded.last_fill)`,
	).Bind(map[string]any{
		"ip":        ip,
		"tokens":    tokens,
		"last_fill": lastFill.Format(time.RFC3339),
	}).Execute()
	return err
}

// keyFailureTracker tracks per-key brute-force attempts with a TTL and
// persists state to SQLite (H2 audit) so server restarts cannot reset an
// attacker's cooldown window. Mirrors rateLimiter: in-memory is the
// request-hot-path authority, SQLite is mirrored via write-through.
type keyFailureTracker struct {
	mu             sync.Mutex
	failures       map[string]*keyFailures
	maxAttempts    int
	cooldown       time.Duration
	stopCleanup    chan struct{}
	cleanupRunning bool

	// db is the PocketBase app used for SQLite persistence. Wired by
	// attachPersistence. When set, recordFailure() writes through to
	// app.DB() after each in-memory update.
	db core.App
}

type keyFailures struct {
	count       int
	cooldownAt  time.Time
	lastAttempt time.Time
}

const keyCleanupInterval = 1 * time.Hour
const keyPartialFailureTTL = 1 * time.Hour // decay partial failures after 1h idle

// defaultKeyCooldown is the cooldown applied after maxAttempts failures
// are recorded against a single key. Production default; overridable via
// the LICENSE_KEY_COOLDOWN env var (e.g. for development to use a much
// shorter cooldown that doesn't punish legitimate retries).
const defaultKeyCooldown = 15 * time.Minute

// parseCooldown returns the cooldown duration to apply to keyFailTracker,
// honoring the LICENSE_KEY_COOLDOWN env var. Falls back to the production
// default if the env var is unset or unparseable — never weakens security
// implicitly.
func parseCooldown() time.Duration {
	v := os.Getenv("LICENSE_KEY_COOLDOWN")
	if v == "" {
		return defaultKeyCooldown
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		log.Printf("keyFailTracker: invalid LICENSE_KEY_COOLDOWN=%q (using default %v): %v",
			v, defaultKeyCooldown, err)
		return defaultKeyCooldown
	}
	log.Printf("keyFailTracker: cooldown overridden to %v via LICENSE_KEY_COOLDOWN", d)
	return d
}

// keyFailTracker limits to 3 failed attempts per key, then a cooldown
// (default 15 min; LICENSE_KEY_COOLDOWN env var overrides for dev).
var keyFailTracker = &keyFailureTracker{
	failures:    make(map[string]*keyFailures),
	maxAttempts: 3,
	cooldown:    defaultKeyCooldown,
}

// startCleanup launches a background goroutine that sweeps expired entries.
// Idempotent; no-op if already running.
func (kf *keyFailureTracker) startCleanup() {
	kf.mu.Lock()
	if kf.cleanupRunning {
		kf.mu.Unlock()
		return
	}
	kf.stopCleanup = make(chan struct{})
	kf.cleanupRunning = true
	ch := kf.stopCleanup
	kf.mu.Unlock()

	go func() {
		ticker := time.NewTicker(keyCleanupInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				kf.sweep()
			case <-ch:
				return
			}
		}
	}()
}

// stop terminates the background cleanup goroutine. Idempotent.
func (kf *keyFailureTracker) stop() {
	kf.mu.Lock()
	defer kf.mu.Unlock()
	if !kf.cleanupRunning {
		return
	}
	close(kf.stopCleanup)
	kf.cleanupRunning = false
}

// sweep removes stale partial-failure entries and expired cooldowns.
func (kf *keyFailureTracker) sweep() {
	kf.mu.Lock()
	defer kf.mu.Unlock()
	now := time.Now()
	for k, v := range kf.failures {
		// Partial failures that haven't been seen in keyPartialFailureTTL are stale.
		if v.count < kf.maxAttempts && now.Sub(v.lastAttempt) > keyPartialFailureTTL {
			delete(kf.failures, k)
			continue
		}
		// Cooldown entries that have passed their cooldown.
		if v.count >= kf.maxAttempts && now.After(v.cooldownAt) {
			delete(kf.failures, k)
		}
	}
}

func (kf *keyFailureTracker) calculateCooldown(attempts int) time.Duration {
	if kf.cooldown != defaultKeyCooldown {
		return kf.cooldown
	}
	switch attempts {
	case 1, 2:
		return 0
	case 3:
		return 15 * time.Second
	case 4:
		return 30 * time.Second
	case 5:
		return 1 * time.Minute
	case 6:
		return 2 * time.Minute
	case 7:
		return 4 * time.Minute
	default:
		return 10 * time.Minute
	}
}

func (kf *keyFailureTracker) isBlocked(key string) (bool, time.Duration) {
	kf.mu.Lock()
	defer kf.mu.Unlock()

	f, ok := kf.failures[key]
	if !ok {
		return false, 0
	}

	// Decay partial failures: if the user made a few wrong attempts
	// but hasn't tried again in keyPartialFailureTTL, reset the counter
	// so they get a fresh start (prevents "one typo away from block" forever).
	if f.count < kf.maxAttempts && time.Since(f.lastAttempt) > keyPartialFailureTTL {
		f.count = 0
		f.lastAttempt = time.Now()
		return false, 0
	}

	// Clean up entries that have reached maxAttempts AND passed cooldown.
	if f.count >= kf.maxAttempts && time.Now().After(f.cooldownAt) {
		delete(kf.failures, key)
		return false, 0
	}
	if f.count >= kf.maxAttempts {
		return true, time.Until(f.cooldownAt)
	}
	return false, 0
}

// isBlockedBool is a test helper that returns only the boolean part of isBlocked.
func (kf *keyFailureTracker) isBlockedBool(key string) bool {
	blocked, _ := kf.isBlocked(key)
	return blocked
}

func (kf *keyFailureTracker) recordFailure(key string) {
	kf.mu.Lock()

	f, ok := kf.failures[key]
	if !ok {
		f = &keyFailures{count: 0}
		kf.failures[key] = f
	}
	f.count++
	f.lastAttempt = time.Now()
	if f.count >= kf.maxAttempts {
		f.cooldownAt = time.Now().Add(kf.calculateCooldown(f.count))
	}

	// Snapshot for persistence, then release the lock so other keys can
	// flow concurrently while SQLite is being written to. In-memory is
	// the authority; SQLite is just for restart survival.
	dbAttached := kf.db != nil
	var (
		snapKey         string
		snapCount       int
		snapLastAttempt time.Time
		snapCooldownAt  time.Time
	)
	if dbAttached {
		snapKey = key
		snapCount = f.count
		snapLastAttempt = f.lastAttempt
		snapCooldownAt = f.cooldownAt
	}
	kf.mu.Unlock()

	if dbAttached {
		if err := kf.persistFailure(snapKey, snapCount, snapLastAttempt, snapCooldownAt); err != nil {
			log.Printf("keyFailTracker: persist error for key=%q (in-memory still authoritative): %v",
				maskLicenseKey(key), err)
		}
	}
}

// clearKey removes a key from the failure tracker (in-memory + SQLite).
// Used when a legitimate re-activation succeeds, so accumulated failure
// counts from auth mismatches don't block the same key forever.
func (kf *keyFailureTracker) clearKey(key string) {
	kf.mu.Lock()
	delete(kf.failures, key)
	kf.mu.Unlock()

	if kf.db != nil {
		if _, err := kf.db.DB().NewQuery(
			`DELETE FROM rate_limit_key_failures WHERE key = {:key}`,
		).Bind(map[string]any{"key": key}).Execute(); err != nil {
			log.Printf("keyFailTracker: failed to delete persisted failure for key=%q: %v", maskLicenseKey(key), err)
		}
	}
}

// ── Persistence (H2 audit) ────────────────────────────────────────

// attachPersistence wires the tracker to a PocketBase app's SQLite
// for restart-survival (H2 audit). Idempotent: no-op if already
// attached. Logs and returns on schema/hydrate errors so in-memory
// mode is the last-resort fallback.
func (kf *keyFailureTracker) attachPersistence(app core.App) {
	if app == nil {
		return
	}
	kf.mu.Lock()
	if kf.db != nil {
		kf.mu.Unlock()
		return
	}
	kf.db = app
	kf.mu.Unlock()

	if err := kf.createSchema(); err != nil {
		log.Printf("keyFailTracker: failed to create schema (in-memory-only mode): %v", err)
		return
	}
	if err := kf.hydrate(); err != nil {
		log.Printf("keyFailTracker: hydrate error (in-memory state may be partial): %v", err)
	}
}

// createSchema runs once on attach. cooldown_until is intentionally
// nullable because not all rows have an active cooldown.
func (kf *keyFailureTracker) createSchema() error {
	_, err := kf.db.DB().NewQuery(
		`CREATE TABLE IF NOT EXISTS rate_limit_key_failures (
			key TEXT PRIMARY KEY,
			count INTEGER NOT NULL,
			last_attempt TEXT NOT NULL,
			cooldown_until TEXT
		)`,
	).Execute()
	return err
}

// hydrate loads failure rows from SQLite into the in-memory map.
// Stale partial-failure rows (last_attempt older than
// keyPartialFailureTTL=1h) are skipped. Rows with an expired
// cooldown_until are kept; isBlocked() treats them as not-blocked
// during request handling and the sweep goroutine cleans them up.
func (kf *keyFailureTracker) hydrate() error {
	rows, err := kf.db.DB().NewQuery(
		`SELECT key, count, last_attempt, COALESCE(cooldown_until, '') AS cooldown_until FROM rate_limit_key_failures`,
	).Rows()
	if err != nil {
		return err
	}
	defer rows.Close()

	type loaded struct {
		key         string
		count       int
		lastAttempt time.Time
		cooldownAt  time.Time
	}
	var pending []loaded
	now := time.Now()
	for rows.Next() {
		var key, lastAttemptStr, cooldownStr string
		var count int
		if err := rows.Scan(&key, &count, &lastAttemptStr, &cooldownStr); err != nil {
			return err
		}
		lastAttempt, err := time.Parse(time.RFC3339, lastAttemptStr)
		if err != nil {
			log.Printf("keyFailTracker: skipping row with unparseable last_attempt=%q: %v",
				lastAttemptStr, err)
			continue
		}
		var cooldownAt time.Time
		if cooldownStr != "" {
			t, err := time.Parse(time.RFC3339, cooldownStr)
			if err != nil {
				log.Printf("keyFailTracker: skipping row with unparseable cooldown_until=%q: %v",
					cooldownStr, err)
				continue
			}
			cooldownAt = t
		}
		if count < kf.maxAttempts && now.Sub(lastAttempt) > keyPartialFailureTTL {
			continue
		}
		pending = append(pending, loaded{
			key:         key,
			count:       count,
			lastAttempt: lastAttempt,
			cooldownAt:  cooldownAt,
		})
	}

	kf.mu.Lock()
	defer kf.mu.Unlock()
	for _, p := range pending {
		kf.failures[p.key] = &keyFailures{
			count:       p.count,
			cooldownAt:  p.cooldownAt,
			lastAttempt: p.lastAttempt,
		}
	}
	return nil
}

// persistFailure UPSERTs a row's failure state. cooldown_until is
// RFC3339 when non-zero, empty string when no cooldown. hydrate()
// interprets empty as zero time on read.
func (kf *keyFailureTracker) persistFailure(key string, count int, lastAttempt, cooldownAt time.Time) (err error) {
	if kf.db == nil {
		return nil
	}
	defer func() {
		if r := recover(); r != nil {
			log.Printf("keyFailTracker: recovered persist panic for key=%q (in-memory still authoritative): %v\n%s", maskLicenseKey(key), r, string(debug.Stack()))
			err = nil
		}
	}()
	var cooldownArg string
	if !cooldownAt.IsZero() {
		cooldownArg = cooldownAt.Format(time.RFC3339)
	}
	// MAX guards (H2 audit): MIN/MAX style monotonic UPSERT — under
	// concurrent writers, recordFailure() releases kf.mu BEFORE the
	// SQLite write, so the LAST UPSERT would otherwise win regardless
	// of "last"-ness. MAX(count, ...) keeps the failure counter
	// monotonic (no regression to a lower failure count after a
	// stale writer arrives last). MAX(last_attempt, ...) and
	// MAX(cooldown_until, ...) extend the cooldown only — never
	// shorten or rewind — defeating restart-survival bypass for an
	// attacker whose stale record arrives out of order. Empty-string
	// cooldown_until sorts before any RFC3339 timestamp under SQLite's
	// default BINARY collation, so MAX('', '2026-...') = '2026-...'.
	_, err = kf.db.DB().NewQuery(
		`INSERT INTO rate_limit_key_failures (key, count, last_attempt, cooldown_until)
		 VALUES ({:key}, {:count}, {:last_attempt}, {:cooldown_until})
		 ON CONFLICT(key) DO UPDATE SET
		   count = MAX(count, excluded.count),
		   last_attempt = MAX(last_attempt, excluded.last_attempt),
		   cooldown_until = MAX(cooldown_until, excluded.cooldown_until)`,
	).Bind(map[string]any{
		"key":            key,
		"count":          count,
		"last_attempt":   lastAttempt.Format(time.RFC3339),
		"cooldown_until": cooldownArg,
	}).Execute()
	return err
}

func init() {
	// Apply the LICENSE_KEY_COOLDOWN env override (or fall back to
	// defaultKeyCooldown) before cleanup goroutines start.
	keyFailTracker.cooldown = parseCooldown()

	ipRateLimiter.startCleanup()
	keyFailTracker.startCleanup()
	contactRateLimiter.startCleanup()
	attestLimiter.startCleanup()

	// Web OTP store + windowed limiters (web_otp.go) sweep on the same
	// 30-min cadence so expired codes/sessions and old windows don't
	// accumulate in memory.
	go webSweepLoop()
	go windowSweepLoop()
	go exchangeSweepLoop()
}

// ── Tenant-level activation lock (Fix #3: renewal TOCTOU) ─────────

// tenantLockShards is the number of fixed-size mutex shards used for
// per-tenant mutual exclusion during renewals. Fewer distinct tenants
// than license keys, so 64 shards keep collision rate low (~1.6%).
const tenantLockShards = 64

// tenantActivationLocks provides per-tenant mutual exclusion so that
// two concurrent renewals with DIFFERENT keys for the SAME tenant
// serialize correctly. Without this lock, both renewals read the same
// currentSub, compute the same newExpiresAt, and save - the second
// write wins, wasting one key purchase.
//
// Lock ordering: tenantLock → keyLock (consistent, no deadlock).
// Tenant lock is acquired AFTER authentication succeeds so
// unauthenticated requests don't waste lock slots.
type tenantActivationLocks struct {
	shards [tenantLockShards]sync.Mutex
}

var tenantLocks = &tenantActivationLocks{}

// bucketForTenant hashes the tenant ID to a stable shard index.
func bucketForTenant(tenantID string) int {
	return int(fnv1aHash(tenantID) % tenantLockShards)
}

// fnv1aHash computes a 64-bit FNV-1a hash of the input string.
// Shared by bucketFor and bucketForTenant so the constants and
// algorithm cannot drift between key-lock and tenant-lock sharding.
func fnv1aHash(s string) uint64 {
	const (
		fnvOffset uint64 = 14695981039346656037
		fnvPrime  uint64 = 1099511628211
	)
	var hash uint64 = fnvOffset
	for i := 0; i < len(s); i++ {
		hash ^= uint64(s[i])
		hash *= fnvPrime
	}
	return hash
}

// lock acquires the per-tenant mutex shard. Returns a deferred-unlock closure.
func (tal *tenantActivationLocks) lock(tenantID string) func() {
	idx := bucketForTenant(tenantID)
	tal.shards[idx].Lock()
	return func() { tal.shards[idx].Unlock() }
}

// activationLockShards is the number of fixed-size mutex shards used
// for per-key mutual exclusion. 256 buckets yield a ~0.4% random-
// collision rate per distinct key — acceptable for a license-server
// workload where lock-held time is bounded by request duration
// (≤100 ms) and unrelated-key serialization adds latency, not
// correctness issues. Fixed shard memory is ≈2 KB regardless of how
// many distinct keys the server has ever processed, closing the
// Memory-Leak Audit DoS vector.
const activationLockShards = 256

// keyActivationLocks provides per-key mutual exclusion via a fixed-size
// pool of sharded mutexes (Memory-Leak Audit fix). Replaced the previous
// unbounded per-key map, which allocated a new *sync.Mutex for every
// distinct key passed to /activate or /renew and never evicted — letting
// an attacker spamming random key strings OOM the server.
//
// Trade-off: distinct keys can hash to the same shard and serialize
// under load. Acceptable here because (a) the lock-held window is short
// (one HTTP request), (b) the license-server activation throughput per
// IP is bounded by ipRateLimiter (=5/hr), and (c) false contention adds
// latency, never security-relevant behaviour. Correctness is preserved:
// same-key calls always hash to the same shard and serialize as before
// (the C2/C3 invariant).
type keyActivationLocks struct {
	shards [activationLockShards]sync.Mutex
}

var activationLocks = &keyActivationLocks{}

// bucketFor hashes the given key with FNV-1a to a stable shard index in
// [0, activationLockShards). Exposed as a method for testability (see
// TestActivationLocks_DistributesKeysAcrossShards) so the test exercises
// the production hash directly rather than re-implementing it inline -
// any divergence between test and production math would be caught.
func bucketFor(key string) int {
	return int(fnv1aHash(key) % activationLockShards)
}

// lock hashes the given key with FNV-1a to a stable shard index and
// locks that shard. Returns a closure that unlocks the same shard on
// invoke. FNV-1a is sufficient for in-process mutex sharding — we only
// need a uniform distribution across the buckets; we do NOT need
// cryptographic strength (an attacker knowing their own shard gains
// nothing — they're still serialised against themselves).
func (kal *keyActivationLocks) lock(key string) func() {
	idx := bucketFor(key)
	kal.shards[idx].Lock()
	return func() { kal.shards[idx].Unlock() }
}
