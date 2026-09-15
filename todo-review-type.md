# Local-First & Frontend Architecture — work queue

Rewritten 2026-09-15 against branch `0.0.39` @ `9ac839264`. Supersedes the earlier generic
Tauri/React blueprint in this file's history; the appraisal that produced this list is
`docs/records/2026-09-15-frontend-architecture-todo-appraisal.md`.

**Standing direction:** a **Slint shell for embedded devices** is planned. That target calls
`crates/oz-bridge` directly in Rust — no IPC, no JSON, no TypeScript — so the ordering below
puts the shell-independent work first and defers anything that only serves the React shell.

> last audited 15-09-26 by Budak-Korporat

---

## Item 1 — ADR: the embedded shell (decision, no code)

Owner decision required before any `.slint` file is written.

- [ ] Device class and OS target (ARM/Linux framebuffer, Android, or both).
- [ ] **Scope.** The `profile_type` lockdown axis already has `kds_kiosk` and
      `customer_display` (`crates/oz-core/src/terminal_profile.rs`). Confirm the shell maps
      onto those rather than becoming a third full POS — that decision alone sets how much
      surface it needs.
- [ ] Slint licence terms (owner sign-off, not an engineering call).
- [ ] Explicit non-goals: no second business-logic implementation, no second permission
      model, no second sync engine. It renders and calls `oz_bridge::*`.
- [ ] Third-shell cost, written into the ADR:
      - `scripts/verify-ipc-parity.py` carries dated allowlist sections per shell — a new
        shell is a new section.
      - `scripts/verify-scoped-coverage.sh` (H-1/H-2) grades whatever the shell registers.
      - `apps/*/src/commands/registration_gate_tests.rs` pins a registered-name floor —
        re-measure it at execution time, do not quote a remembered number.

## Item 2 — Finish the headless seam, then kill DTO drift

This is the surface Slint binds to. Do it before any UI-framework work.

- [ ] Finish ADR #49 (`docs/decisions/2026-09-11-adr49-headless-command-bridge.md`) for the
      **tablet** client — currently desktop only.
- [ ] Add `scripts/verify-dto-parity.py`: parse Rust `*Dto` structs, assert field-for-field
      agreement with the TS mirrors under `ui/src/api/`, and register it in
      `scripts/gates.json`. **There is no such gate today** — the five existing parity
      scripts cover command names, invoke tokens, scoped coverage, plugins and topology, not
      field shape.
- [ ] Decide specta/ts-rs **by ADR, or not at all**. Default: no. Codegen would sit in
      front of ~8.7k lines of hand-written API surface and emit snake_case by default.
- [ ] Type-safe the offline boundary: `OfflineQueueItemDto.payload` is a **JSON string**,
      so type safety is lost exactly where it matters most. Give the payload a tagged union
      and deserialise at the edge.

### Conventions an agent must hit (verified)

| Rule | Evidence |
|---|---|
| Mirror the Rust DTO field-for-field, **per struct** — do not globally restyle case | `Money.minor_units` is snake; `OfflineQueueItemDto.retryCount` is camel (`#[serde(rename_all = "camelCase")]`, `crates/oz-bridge/src/offline.rs:33`) |
| Tauri v2 command args are **camelCase** in JS | UI sends `sessionToken` → Rust `session_token: String` (`apps/desktop-client/src/commands/audit.rs:47-49`) |
| Every scoped command carries a session token | `scripts/verify-invoke-parity.py` fails otherwise |
| Money is `i64` minor units; float is forbidden | `foundation/src/money.rs:19` |
| Timestamps are **ISO-8601 strings**, not epochs | `AuditEntry.created_at: String` (`crates/oz-core/src/audit.rs:36`) |
| Business state lives in Rust | ADR #49 — `crates/oz-bridge` has no `tauri`/`gtk`/`webkit2gtk` dependency |

Reference shape for a command wrapper — do not invent new patterns:

```ts
export const listAuditLogScoped = (
  sessionToken: string,
  args: ListAuditLogScopedArgs,
): Promise<AuditLogPageDto> =>
  loggedInvoke<AuditLogPageDto>('list_audit_log_scoped', { sessionToken, args });
```

## Item 3 — Second i18n pipeline (decide before the first `.slint` file)

Largest hidden cost in the Slint plan, and the previous draft omitted it.

- [ ] Current state is React-bound: `@fluent/react`, **54 `.ftl` files** (27 bundles × ID/EN).
- [ ] Choose: reuse the `.ftl` content through a Slint-side Fluent shim, or run a second
      pipeline. Untranslated embedded UI is not acceptable for an ID+EN product.
- [ ] Whichever is chosen needs its own parity check — `scripts/verify-bundle-parity.py` and
      `scripts/verify-ftl-orphans.py` read TSX and will not see `.slint` files.
- [ ] Remember the two-sided FTL rule: a key you add must be referenced, and a reference you
      delete must not strand a key.

## Item 4 — Offline model: outbox-reconcile, not optimistic-rollback

The previous draft's "optimistic insert, roll back on error" is the wrong failure model.
The repo has a **durable outbox** (`ui/src/api/offline.ts`, ADR #6): an action is enqueued
and retried; an `invoke` failure does not mean the enqueue failed, so rolling back hides a
sale that is about to be pushed successfully.

- [ ] Rewrite the pattern as: optimistic mark → enqueue → reconcile against the sync result
      (`syncedCount` / `failedCount` / `conflictCount`).
- [ ] Never roll back a durable queue item; surface `failedCount` and let the user retry.
- [ ] Add a **client-side idempotency key** at enqueue time so a retry cannot double-apply.
- [ ] Use the priority tiers that already exist: `critical` | `normal` | `low`.
- [ ] Use real event names. The measured emit set is `kds:orders-changed`,
      `receipt:printed`, `barcode:scanned`, `barcode:error`, `settings_updated`. There is no
      `db-crdt-sync-complete` / `db-sync-started`; sync status comes from
      `useSyncConnection` and the queue-summary commands.
- [ ] Do **not** add a global state library. State today is 12 Contexts under
      `ui/src/contexts/` plus ~36 hooks; `zustand` appears nowhere. Adding one is an ADR.

## Item 5 — List rendering and perf: adopt what exists

Both the previous §3 and most of §4 are already decided, differently.

- [ ] Bounded pagination is the cross-feature contract: `LIST_PAGE_SIZE = 50`,
      `ui/src/utils/list-policy.ts` (PERF-07). Use `usePagedList`; do not hand-roll slices.
- [ ] Virtualization only where interaction semantics allow it, and only with
      **`react-window`** (already a dependency, used by `ProductLookupScreen` and
      `RetailProductGrid`). `@tanstack/react-virtual` is not a dependency — do not add a
      second virtualization library.
- [ ] Dense grids with sort headers, sticky rows or variable heights stay on paging.
- [ ] Drop "disable StrictMode in production": its double-invoke is development-only, so a
      production build does not double-render either way. `ui/src/main.tsx` needs no change.
- [ ] Correct the IPC note: Tauri v2 serializes command args as JSON both ways. Pass raw
      objects (a manual `JSON.stringify` double-encodes), but the real levers are route-level
      code splitting (PERF-01), bounded pages (PERF-07) and `loggedInvoke` telemetry.
- [ ] Hard rules for any new UI code: strings come from Fluent (`scripts/lint-i18n.sh`),
      colours come from theme tokens (`ui/src/frontend/themes/tokens.css`) — never literals.

---

## Definition of done

Per item, before it is called finished — run, do not assume:

- `python scripts/verify-ipc-parity.py` and `python scripts/verify-invoke-parity.py`
- `bash scripts/verify-scoped-coverage.sh`
- `cd ui && npx tsc --noEmit`
- `cd ui && npx vitest run <affected suites>`
- `bash scripts/lint-i18n.sh`
- `python scripts/verify-bundle-parity.py --report-only`

Commit discipline: one line, explicit pathspec —
`git commit -m "<type>(<area>): <subject>" -- path/one path/two`. No `git add` except the
new-file chain, no `-a`, no `--amend`. Re-read the dirty set immediately before every commit;
this is a shared checkout.
