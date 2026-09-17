-- 20260902_outbox.sql
--
-- Transactional outbox for async email + webhook delivery (ADR #43 D7).
--
-- The outbox holds delivery tasks that are written in the same transaction
-- as the source event.  A background drainer polls for pending entries,
-- delivers them (email via SMTP, webhook via HTTP POST), and records the
-- outcome.  Entries that fail after `max_attempts` are moved to the
-- dead-letter state for manual inspection.
--
-- Design:
-- - `topic` distinguishes delivery channels (`email_report`, `webhook`).
-- - `payload` is a JSON blob with the delivery-specific data.
-- - `status` lifecycle: pending → delivering → delivered | failed | dead_letter.
-- - `next_attempt_at` enables exponential-backoff retry (2^n minutes).
-- - The drainer checks `idx_outbox_due` for the next due entry.

CREATE TABLE IF NOT EXISTS outbox (
    id              TEXT PRIMARY KEY,
    topic           TEXT NOT NULL,
    payload         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'delivering', 'delivered', 'failed', 'dead_letter')),
    priority        INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 5,
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,       -- RFC 3339 timestamp
    created_at      TEXT NOT NULL,
    last_error      TEXT
);

CREATE INDEX IF NOT EXISTS idx_outbox_due
    ON outbox(status, next_attempt_at, priority DESC);