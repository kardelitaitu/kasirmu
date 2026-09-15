# Local-First & Frontend Architecture — work queue

Rewritten 2026-09-15 against branch `0.0.39` @ `9ac839264`. Supersedes the earlier generic
Tauri/React blueprint in this file's history; the appraisal that produced this list is
`docs/records/2026-09-15-frontend-architecture-todo-appraisal.md`.

**Horizon (owner, 2026-09-15).** Years 1–3: **Tauri v2** on Windows, macOS, Linux, Android and
iOS; **Slint** for embedded devices and Linux with no desktop environment. Years 4–5: possibly
Slint everywhere, or another renderer. **The goal is separation between app and UI — the UI must
be replaceable.**

That goal, not any one framework, drives the ordering below. A Slint shell calls
`crates/oz-bridge` directly in Rust — no IPC, no JSON, no TypeScript — so work splits into
*spent once, used twice* (below the bridge) and *spent once, used once* (above it).

**Mobile is already in flight, not new work.** `apps/tablet-client/tauri.conf.json` carries
`bundle.targets: "all"`, `android.minSdkVersion: 26` and an `iOS` section, and
`apps/tablet-client/gen/android` exists. The item is keeping that path green, not starting it.

> last audited 15-09-26 by Budak-Korporat

---

## Item 1 — Lock the seam before anything else

**Invariant:** everything below `crates/oz-bridge` is the *application*; everything above it is
an *adapter*. An adapter may be replaced; the application must not notice.

The separation is already largely real — `BridgeCtx` carries `emitter: Option<Arc<dyn EventSink>>`
with `pub trait EventSink` (`crates/oz-bridge/src/ctx.rs:45,84`), and ADR #49 removed the
toolkit dependencies. **But nothing enforces either half**, measured: no script under `scripts/`
mentions `oz-bridge`, and `scripts/gates.json` has no bridge entry. One `tauri` import would
silently end the Slint option.

- [ ] **Extend `scripts/verify-architecture-boundaries.py`** — do NOT create new scripts. It
      already exists (511 lines), is registered as gate `architecture-boundaries` in
      `scripts/gates.json`, is declared by `check.sh`, runs in CI as `dev-ci.yml#static-gates`
      with `--strict`, and carries `scripts/architecture-boundaries-baseline.json` (8 entries,
      each with `introduced`/`expires`; a stale entry fails, so a fix without its baseline
      removal is a red gate). Adding two entries to its `RULES` dict buys both checks and
      inherits CI for free. Two new scripts would instead have to be added to `gates.json`
      **and** `check.sh` **and** `docs/operations/ci-pipeline.md`, because
      `verify-ci-docs-drift.py` fails a manifest gate no runner declares.
- [ ] Rule `bridge-toolkit-purity`: fail if `crates/oz-bridge/Cargo.toml` gains `tauri`, `gtk`,
      `webkit2gtk` or a `tauri-plugin-*`, or if `crates/oz-bridge/src/**` references them.
      ADR #49's load-bearing claim, currently unguarded.
- [ ] Rule `ui-framework-vocabulary`: fail when `crates/`, `modules/` or `platform/` name a UI
      framework, a UI file or a UI concept (`React`, `.tsx`, `.css`, "component to render").
      Baseline the hits that exist today — all **comments**, which is the good news: the
      coupling is documentary, not typing. Two known false positives to exclude:
      `crates/oz-bridge/src/settings_tests.rs:773` lists `.css`/`.ts`/`.tsx` as file
      extensions in a fixture, and `oz-bridge/src/lib.rs:5` + `ctx.rs:8` name `tauri, gtk,
      webkit` in the sentences that assert this very rule. Note the script's
      `mask_comments_and_strings` helper *strips* comments — this rule needs the opposite.
- [ ] Pick baseline expiries deliberately (existing entries run ~3 months). Deferred debt
      expires into a red gate, and CI runs `--strict`, so a false positive is red for every
      agent, not just the author.
- [ ] Fix the measured leaks (all comment/doc level, all cheap):
      - `crates/oz-core/src/session.rs:55` — *"Workspace type key — determines which React
        component to render."* The core should not know what a React component is.
      - `modules/{crm,inventory,loyalty,sales,settings}/src/lib.rs` — module docs describe
        "frontend (React screens, API calls, Fluent locale)".
      - `crates/oz-bridge/src/{data.rs:286,331, pos.rs:918,1240}` and
        `crates/oz-core/src/db/regional.rs:7,20`, `ozpkg.rs:145-150` — caller references to
        `.tsx` paths that will not exist under another renderer.
- [ ] Keep the precedent: `crates/oz-core/src/ozpkg.rs:154` moved the ozpkg password rule out
      of a React component into the choke point every caller passes. That is the pattern —
      a rule that only a UI enforces is a rule the next UI must re-implement.

## Item 2 — ADR: the embedded shell (decision, no code)

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

## Item 3 — Finish the headless seam, then kill DTO drift

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

## Item 4 — i18n: one source of truth, two bindings

Revised. Earlier I called this the largest hidden cost and assumed a second pipeline. That was
too pessimistic: **Fluent is a format, not a React feature.** The 54 `.ftl` files are the
content; `@fluent/react` is only one reader. `fluent-bundle` (projectfluent/fluent-rs,
Apache-2.0 OR MIT) is the Rust reader, and a Slint shell sets text from Rust like any other
string. So one content set can serve both renderers.

- [ ] Decide now: `.ftl` is the single source of truth; the Slint shell resolves strings in
      Rust via `fluent-bundle`. No second content pipeline, no duplicated ID/EN strings.
- [ ] Prototype it before the first real screen: load one bundle in Rust, format one message,
      push it into a Slint property. If that is awkward, the decision changes — find out cheap.
- [ ] Extend `scripts/verify-bundle-parity.py` and `scripts/verify-ftl-orphans.py`: both read
      TSX today and will not see `.slint` or Rust-side key usage.
- [ ] Keep the two-sided FTL rule: a key you add must be referenced, and a reference you delete
      must not strand a key.

## Item 5 — Offline model: outbox-reconcile, not optimistic-rollback

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

## Item 6 — List rendering and perf: adopt what exists

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

## Item 7 — Year 4–5: renderer swap stays cheap

The acceptance test for "the UI is replaceable" is a checklist, not a feeling. All of these
should be true continuously, not at swap time:

- [ ] No UI-framework vocabulary below `crates/oz-bridge` (Item 1's gate is green).
- [ ] DTOs describe *data*, never presentation — no HTML, no colour, no layout, no route names.
- [ ] Every business rule is enforced at a choke point every caller passes, not in a screen
      (the `ozpkg.rs:154` precedent).
- [ ] Events cross the seam through `EventSink`, so a new renderer subscribes rather than
      re-implements publishing.
- [ ] A new shell needs: a `BridgeCtx`, a registration of the commands it exposes, and a
      locale reader. Nothing else. If it needs more, that is the finding.

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
