<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · Clean pass, and worth recording that a plan this old is still accurate — this file was the only one in this batch with NO audit stamp and NO footer at all, so nothing had ever checked it. Every anchor the design depends on is real and was located: the `media_assets` and `media_thumbnails` tables exist, defined in `crates/kasirmu-core/migrations/20260824_media_edc.sql:18` and carried into the base schema at `crates/kasirmu-core/migrations/20260813_init.pg.sql:1703`; `content_hash` is a real field the pipeline uses (`crates/kasirmu-media/src/pipeline.rs`, with tests in `pipeline_tests.rs`); the `MediaLimits` guard this plan specifies (`max_input_bytes`, `max_pixels`, `max_side`) exists in the same crate; and the RLS reference in rule 4 points at a script that is still present, `scripts/generate-pg-migration.py`. So the central decision — metadata rows flow through the sync engine, bytes never do — was not only followed but is still the shape of the code. · NOT re-measured: the three Open items (object-storage credential config surface, cloud-side thumbnail job, CDN invalidation) are tracked work, not claims about what exists, and this file lives in `docs/archived/` so its items are informational rather than live. The settings keys it reserves (`media.storage_backend`, `media.root_path`) are named as reserved, which is a proposal. · No stamp or footer existed on this file before this pass. -->
# Media Binary Sync Strategy — PLANNED

**Status:** PLANNED — design decision made now, so the `media_assets` schema,
the sync engine, and the media pipeline are built on the right foundation.

## Decision

**Media files sync as *metadata rows + out-of-band bytes*, never inline in the
row replication stream.**

- The `media_assets` / `media_thumbnails` rows (id, owner, path, mime, hash,
  dimensions, size) are ordinary tenant-scoped rows and flow through the
  existing sync engine exactly like `products` or `sales`.
- The actual image **bytes** are *not* carried in the sync snapshot. They live
  in the storage backend (`LocalStorage` on Tauri, `ObjectStorage` on cloud)
  and are transferred out-of-band.

## Why

1. **Snapshot bloat.** A 2 MB photo replicated as a base64 blob inside every
   snapshot makes pull/push payloads explode. Rows stay small; images stay big.
2. **Cloud object storage is the natural source of truth.** The cloud already
   needs an object store (or S3-compatible bucket) for images; duplicating
   them as SQL blobs adds nothing.
3. **Incremental sync stays cheap.** Change tracking (`offline_queue`) only
   sees the small metadata row change, not a multi-MB delta.

## Rules for implementers

1. **Bytes live in storage, paths live in DB.** `media_assets.file_path` is a
   logical key resolved against the configured storage backend
   (`media.storage_backend` / `media.root_path` settings).
2. **The sync snapshot never contains image bytes.** If a new feature needs to
   replicate an image to another terminal, add an explicit out-of-band transfer
   path (e.g. object storage presigned URL, or a separate binary channel) — do
   not add a BLOB column "for convenience".
3. **Dedup by `content_hash`.** The SHA-256 of the bytes is stored on
   `media_assets.content_hash`; the pipeline should skip storing bytes that
   already exist under the same `(tenant_id, content_hash)`.
4. **Tenant isolation is non-negotiable.** Every media table row carries
   `tenant_id` and is covered by the PG RLS policy (see the RLS array in
   `scripts/generate-pg-migration.py`). Cloud object storage keys must include
   the tenant id (e.g. `{tenant}/{owner_type}/{owner_id}/{file}`).
5. **Decompression-bomb guard.** The pipeline enforces `MediaLimits`
   (`max_input_bytes`, `max_pixels`, `max_side`) before decoding, so an
   attacker-supplied image cannot exhaust memory on the cloud.

## Open items (tracked, not blocking)

- Object storage credentials/endpoint config surface (settings keys reserved:
  `media.storage_backend`, `media.root_path`).
- Background job on cloud for post-upload thumbnail generation (async pipeline).
- CDN / cache invalidation after asset replacement or deletion.

> last audited 29-09-26 by docs-auditor
