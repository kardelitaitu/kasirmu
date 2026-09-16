# Appraisal: `todo-review-type.md` (Local-First & Frontend Architecture)

Recorded against: branch `0.0.39` @ `9ac839264` · 2026-09-15
Scope: sections 1–4 of the root todo, plus its implied Slint/embedded direction.

> last audited 15-09-26 by Budak-Korporat

## Verdict

The document is a competent **generic** Tauri v2 + React blueprint. It is not a blueprint
for *this* repository. Roughly half of it restates things OZ-POS already decided
differently, by ADR, for recorded reasons — and the two sections that would cost the most
to retrofit (§1 specta-generated bindings, §2 Zustand) are the two that a Slint target
would throw away anyway.

Do not execute it as written. The salvageable intent is small and sharp: kill DTO drift,
and make the offline model explicit. Both are achievable without a new dependency.

---

## §1 — Type-safe IPC via specta / ts-rs

**Measured:** neither `specta` nor `ts-rs` appears anywhere in the workspace source.
`schemars` matches only inside `target/` build artifacts (transitive). The only mention of
either name in tracked files is the todo itself.

**How types are actually kept in sync:** by hand, deliberately.
`ui/src/types/domain.ts` opens with *"Domain types mirrored from `oz-core` (Rust)"* and
brands the newtypes (`CartId`, `Sku`, `LineId`); 51 per-domain files under `ui/src/api/`
carry the camelCase DTOs. `Money` is `{ minor_units: number; currency: string }` —
`i64` minor units on the Rust side (`foundation/src/money.rs:19`), float forbidden by
comment and by convention.

**Concrete conflicts in the sample code:**

| Doc says | Repo says |
|---|---|
| `timestamp: u64` (epoch) | `created_at: String`, ISO-8601 (`crates/oz-core/src/audit.rs:36`) |
| `AuditLog { location_id, item_sku, quantity_delta }` | No such shape. `AuditEntry` is `{ id, user_id, action, target_type, target_id, details, outcome, created_at }` — an action/security trail. Stock deltas live in `stock_movements` (ADR #6), not in the audit table. |
| `item_sku`, `quantity_delta` (snake_case in TS) | Tauri v2 takes **camelCase** JS args: UI sends `sessionToken` → Rust `session_token: String` (`apps/desktop-client/src/commands/audit.rs:47-49`) |
| `invoke('get_local_audit_logs')`, no token | Every scoped command takes a session token. `scripts/verify-invoke-parity.py` **fails** a UI invoke whose Rust signature requires `session_token` without a `sessionToken` payload; `scripts/verify-ipc-parity.py` **fails** a command string not registered in a shell's `generate_handler![]`. |

**The real finding:** the drift risk the section names is genuine and **currently
unguarded**. The five parity gates cover command *names* (ipc-parity), invoke *tokens*
(invoke-parity), scoped-variant coverage, plugins and topology — none compares field
shape between a Rust `*Dto` and its TS mirror.

**Recommendation:** do not adopt specta yet. It would put codegen in front of ~8.7k lines
of hand-written API surface and, by default, emit snake_case — colliding with the
camelCase Tauri convention above. The cheap 80% is a new `scripts/verify-dto-parity.py`
that parses Rust `*Dto` structs and asserts field-for-field agreement with the TS mirrors:
no runtime dependency, and it slots into the existing gate pattern in `scripts/gates.json`.
If codegen is still wanted afterwards, it is an ADR, not a todo line.

---

## §2 — Zustand store, optimistic UI, CRDT events

**Measured:** `zustand` appears in no `package.json`, no doc, no source file. State lives
in React Context (12 providers under `ui/src/contexts/`) plus ~36 hooks. There is no
global store library and no recorded decision to add one.

**The bigger problem is the failure model.** The doc's store does optimistic insert →
`invoke` → *roll back on error*. The repo's actual offline model (ADR #6, and
`ui/src/api/offline.ts`) is a **durable outbox**: an action is enqueued as
`{ action, payload /* JSON string */, tenantId, priority: critical|normal|low }` and the
sync result reports `syncedCount / failedCount / conflictCount`. A queued item persists and
is retried. Rolling the UI back on a transient IPC error would hide a sale that the outbox
is about to push successfully — and worse, `invoke` failing does **not** mean enqueue
failed.

**Events in the doc do not exist.** The measured `emit` set is `kds:orders-changed`,
`receipt:printed`, `barcode:scanned`, `barcode:error`, `settings_updated`. There is no
`db-crdt-sync-complete` or `db-sync-started`; sync status reaches the UI through
`useSyncConnection` and the queue-summary commands, not through those events.

**Keep the intent, fix the shape:** optimistic mark → enqueue (with an idempotency key
generated client-side) → reconcile against the sync result. Never roll back a durable
queue item.

**Also worth noting:** `OfflineQueueItemDto.payload` is a **JSON string**. Type safety is
lost exactly where §1 wants to add it. That is the sharper version of the §1 point and
worth more than the specta proposal.

---

## §3 — Virtualization

Already decided, and differently. `ui/src/utils/list-policy.ts` (PERF-07) makes **bounded
pagination** the cross-feature contract (`LIST_PAGE_SIZE = 50`) and reserves
virtualization for surfaces whose interaction semantics allow it. Dense grids with sort
headers, sticky rows and variable-height cells — i.e. an audit grid — are explicitly the
paging case.

Further, the sample imports `@tanstack/react-virtual`, which is not a dependency;
`react-window@2.2.7` is, and is what `ProductLookupScreen` / `RetailProductGrid` use.

Two more things in that snippet would fail a commit: the strings are hardcoded English
(they must come from Fluent — 54 `.ftl` files, `lint-i18n.sh` and the bundle-parity
pre-commit step), and the colours are Tailwind literals (`bg-slate-900`,
`text-emerald-400`) instead of theme tokens (`ui/src/frontend/themes/tokens.css`).

**Verdict:** drop. Use `usePagedList` + `list-policy`. If a named surface genuinely needs
virtualization, use `react-window` and record why at the call site.

---

## §4 — Performance checklist

- **"Turn off React StrictMode in production"** — wrong premise. StrictMode's
  double-invoke is development-only; a production build does not double-render whether or
  not the wrapper is present. `ui/src/main.tsx:12` wraps `<App />` in StrictMode and it
  costs the shipped bundle nothing. Drop the item.
- **"Tauri's binary serialization processes Rust structures directly"** — false as stated.
  Tauri v2 serializes command arguments as JSON (`serde_json`) on both sides; there is no
  automatic binary layout for command args. Passing raw objects is still correct — because
  the framework serializes once and a manual `JSON.stringify` would double-encode — but the
  stated reason is invented. The real levers in this repo are route-level code splitting
  (PERF-01), bounded pages (PERF-07) and `loggedInvoke` telemetry.
- **"Keep core state in Rust threads"** — agrees with the repo, and is already true: ADR
  #49 moved command bodies into `crates/oz-bridge`, which is headless *by dependency* (no
  `tauri`, `gtk`, `webkit2gtk` in its manifest).

---

## The Slint / embedded angle — the part that changes the ordering

The todo is written as if React+Tauri were the permanent front end and Slint a later
addition. That assumption inverts the priority order:

1. **§1 and §2 do not transfer to Slint at all.** A Slint shell is Rust calling
   `oz_bridge::*` directly. No IPC, no JSON, no TypeScript bindings, no Zustand. The
   artifact Slint will bind to is `BridgeCtx` + `crates/oz-bridge` — which exists
   *specifically* so logic can be driven without a shell (ADR #49).
2. **Therefore finish ADR #49's tablet half and settle DTO drift *before* any UI
   framework work.** The todo currently front-loads the most shell-coupled item.
3. **A third shell is a third gate surface.** `verify-ipc-parity.py` carries dated
   allowlist sections for desktop and tablet; `verify-scoped-coverage.sh` (H-1/H-2: every
   command needs a `_scoped` variant) will grade whatever the new shell registers. This is
   real work, not free.
4. **i18n is a second pipeline, and it is the largest hidden cost.** Fluent is React-bound
   (`@fluent/react`, 54 `.ftl` files). Slint's translation story is different. Either the
   embedded UI ships untranslated — not acceptable for an ID+EN product — or there is a
   second localization pipeline and a second parity gate. The todo does not mention it.
5. **Licensing and target class are owner decisions.** Slint's license terms, and the
   embedded target (ARM/Linux framebuffer vs Android), need a decision before code. Note
   that the existing `profile_type` lockdown axis already has `kds_kiosk` and
   `customer_display` — an embedded shell most likely maps onto those rather than being a
   third full POS, which would sharply reduce the surface it needs.

---

## Suggested rewrite of the todo (ordered)

1. **ADR: embedded shell** — device class, why Slint, licence, and scope (KDS / customer
   display / full register?). Anchor it to the existing `profile_type` values.
2. **Finish ADR #49 for the tablet client** and land `verify-dto-parity.py` (or decide
   specta by ADR). This is the seam Slint binds to.
3. **Decide the second i18n pipeline** before the first `.slint` file exists.
4. **Rewrite the offline section** as outbox-reconcile with client-side idempotency keys,
   not optimistic-rollback.
5. **Delete §3 and §4** and replace them with: adopt PERF-07 paging; `react-window` only
   where interaction semantics allow; keep business state in `oz-bridge`.
