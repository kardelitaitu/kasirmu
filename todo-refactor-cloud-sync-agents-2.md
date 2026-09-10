# Orchestrator Agent 2: Email PG Daemon & Outbound Dispatch

**Document:** `todo-refactor-cloud-sync-agents-2.md`  
**Role:** Orchestrator Agent 2 (Cloud Notification & Worker Architect)  
**Goal:** Modularize `apps/cloud-server/src/email_pg.rs` (1,510 lines) and outbound webhooks into dedicated worker pools, queue readers, and template formatters.

**Target Crate:** `apps/cloud-server/src/`  
**Sibling Documents:**
- [`todo-refactor-cloud-sync-agents-1.md`](./todo-refactor-cloud-sync-agents-1.md) (Agent 1 — Cloud Sync Engine & Protocol Handler)
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
- [ ] Run `cargo test -p oz-cloud-server email` to establish baseline.

### Phase 2.1: Decompose `email_pg.rs`
- [ ] Extract PostgreSQL queue polling into `email/queue_worker.rs`.
- [ ] Extract HTML/text template rendering into `email/templates.rs`.
- [ ] Extract SMTP client retry and exponential backoff into `email/smtp_client.rs`.
- [ ] Verify `cargo test -p oz-cloud-server email` passes.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(cloud-email): modularize email_pg into worker, templates, and smtp client"
  ```
