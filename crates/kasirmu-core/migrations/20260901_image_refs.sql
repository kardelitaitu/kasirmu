-- 20260901_image_refs.sql
--
-- Cloud content spine for product images (spec 0046b §3.7).
--
-- `image_refs` tracks every hash that is referenced by at least one product
-- in the tenant's catalog. The refcount is maintained transactionally:
-- each time a product_image row is inserted/updated the refcount increments,
-- and each time one is deleted it decrements. When refcount reaches 0 the
-- row is kept for a grace period (cloud GC sweeps refcount=0 rows older
-- than the grace window).
--
-- `missing_hashes` on the catalog snapshot response is computed as
-- set-difference: hashes referenced by product_images minus hashes present
-- in image_refs (refcount > 0 AND file exists). At <= 50k hashes/tenant an
-- exact set difference is cheaper than a bloom filter.
--
-- `image_push_queue` persists pending image uploads on the desktop device.
-- The push scheduler drains it in batches with jitter and backoff.

CREATE TABLE IF NOT EXISTS image_refs (
    tenant_id  TEXT NOT NULL,
    hash       TEXT NOT NULL,
    refcount   INTEGER NOT NULL DEFAULT 0,
    bytes      INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (tenant_id, hash)
);

CREATE INDEX IF NOT EXISTS idx_image_refs_tenant ON image_refs(tenant_id);

CREATE TABLE IF NOT EXISTS image_push_queue (
    hash            TEXT NOT NULL PRIMARY KEY,
    size_bytes      INTEGER NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    enqueued_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);