# Orchestrator Agent 2: Email PG Daemon & Outbound Dispatch

<!-- Execution stamp: 2026-09-13 · DSH · DONE as 01e62dec1. `email_pg.rs`
(1,590) split into `email_pg/{queue_worker,settings_store,analytics,
popularity}.rs` + a 75-line facade; `cargo test -p oz-cloud-server`
312/312 + email 18/18 green at HEAD, all four modules <1,000 lines.
DEVIATION from Phase 2.1's named targets: the module was NOT split into
`templates.rs`/`smtp_client.rs` because neither body exists here — template
rendering lives in `oz_core::export::email_report::ReportEmailBuilder` and
the SMTP client is `crate::email::send_email`, both already external. The
real seams in this file were the send loop, the scoped-settings access, the
report queries, and the popularity/forecast queries; the split follows
those. The advisory-lock guard (AdvisoryLockGuard) moved to queue_worker
with pub fields so the existing PG integration tests keep resolving it
through the facade under cfg(test). `outbound_webhooks.rs` (801 lines) was
left intact — it is already under the 1,000-line cap and is a separate
concern from this decomposition; no checklist item asked to split it. -->

**Document:** `todo-refactor-cloud-sync-agents-2.md`  
**Role:** Orchestrator Agent 2 (Cloud Notification & Worker Architect)  
**Goal:** Modularize `apps/cloud-server/src/email_pg.rs` (1,510 lines) and outbound webhooks into dedicated worker pools, queue readers, and template formatters.

**Target Crate:** `apps/cloud-server/src/`  
**Sibling Documents:**
- [`todo-refactor-cloud-sync-agents-1.md`](../../todo-refactor-cloud-sync-agents-1.md) (Agent 1 — Cloud Sync Engine & Protocol Handler)
- [`todo-refactor-cloud-sync-agents-3.md`](./todo-refactor-cloud-sync-agents-3.md) (Agent 3 — Tenant Migration & Schema Synchronization)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `refactor(cloud-email): ...`
2. **Owned Path Fence (Exclusive to Agent 2):**
   - `apps/cloud-server/src/email_pg.rs` & `email_pg_tests.rs`
   - `apps/cloud-server/src/email.rs` & `email_tests.rs`
   - `apps/cloud-server/src/outbound_webhooks.rs`
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `sync_store.rs` or `sync_api.rs` (Owned by Agent 1).
   - DO NOT edit migration scripts (Owned by Agent 3).

---

## 📋 Task Checklist

### Phase 2.0: Baseline Audit
- [x] Run `cargo test -p oz-cloud-server email` to establish baseline.

### Phase 2.1: Decompose `email_pg.rs`
- [x] Extract PostgreSQL queue polling into `email/queue_worker.rs`.
      → landed as `email_pg/queue_worker.rs` (loop + advisory-lock guard +
      tenant enumeration + period claim).
- [x] Extract HTML/text template rendering into `email/templates.rs`.
      → **NOT APPLICABLE — there is no template code in this file**; the
      report HTML/text is built by `oz_core::export::email_report::
      ReportEmailBuilder`. What WAS extracted instead: `email_pg/
      settings_store.rs` (scoped KV access) and `email_pg/analytics.rs`
      (the ten report queries + bundle assembly).
- [x] Extract SMTP client retry and exponential backoff into `email/smtp_client.rs`.
      → **NOT APPLICABLE — there is no SMTP client in this file**; sending
      is `crate::email::send_email`. The popularity/forecast queries
      became `email_pg/popularity.rs` to keep `analytics.rs` under the cap.
- [x] Verify `cargo test -p oz-cloud-server email` passes.
- [x] **Commit Milestone:**
  ```bash
  git commit -m "refactor(cloud-email): modularize email_pg into worker, templates, and smtp client"
  ```
