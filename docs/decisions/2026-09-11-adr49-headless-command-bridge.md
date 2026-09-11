---
num: 49
area: desktop-client
title: ADR #49: Headless Command Bridge — Moving Command Bodies into crates/oz-bridge
status: Accepted (2026-09-11) — implemented for the desktop shell; tablet client not started
---
# ADR #49: Headless Command Bridge — Moving Command Bodies into crates/oz-bridge

**Status:** Accepted (2026-09-11). The desktop side is built; the tablet side is not.
**Date:** 2026-09-11
**Recorded against:** branch `0.0.37` @ `3cc76b156`
**Tags:** architecture, tauri, ipc, desktop-client, oz-bridge, testing, error-handling

> **Cite this record by filename, not by number.** `docs/decisions/README.md` documents
> that `#43` is claimed by two files, and `2026-08-08-adr34-typed-connection-gating.md`
> carries `num: 44` in its front matter. Filename-plus-number is the only safe form here.

---

## Context

Business logic in the desktop client was only reachable through Tauri. A command body —
the SQL, the permission gate, the lock order, the event publish — sat inside a
`#[tauri::command]` function taking `State<'_, AppState>`, so nothing could drive it
without a running shell, and a body could only be tested by constructing app state inside
the app crate.

The objective was to make that logic callable **headlessly** without changing what the UI
can ask the app to do. `crates/oz-bridge` was scaffolded at `de293ff66` (“scaffold
headless oz-bridge crate with BridgeCtx and BridgeError”, 2026-09-10); 130 `bridge`-tagged
commits had landed by 2026-09-11.

The crate is headless **by dependency, not by convention**: `crates/oz-bridge/Cargo.toml`
carries no `tauri`, `gtk`, `webkit2gtk` or `tauri-plugin-*` dependency and says so in a
comment above `[dependencies]`. `platform-sync` is absent from that list too, which is
load-bearing — see §What was NOT extracted.

## Decision

**1. Move the bodies, keep the surface.** Every `#[tauri::command]` function in
`apps/desktop-client/src/commands/*.rs` stays in place with its name, attribute set and
signature. Its body becomes three moves: obtain a `BridgeCtx`, call the bridge, map the
error with `.map_err(Into::into)`. The context is built by `AppState::bridge_ctx()`
(`apps/desktop-client/src/commands/authz.rs:186`), which borrows `AppState` for the
lifetime of the call.

The IPC surface is unchanged **by design, and it was measured that way throughout**:
452 UI command strings, 448 registered, 27 unregistered references (desktop) —
re-confirmed against this HEAD by `python scripts/verify-ipc-parity.py` (exit 0). The
command-site invariants held too: **488** `pub async fn` at the top level of `commands/`,
**500** recursive; the 12-site difference is `commands/topology/`.

**2. `BridgeCtx` carries services, not paths.** The struct
(`crates/oz-bridge/src/ctx.rs:59-94`) has **14 public fields** — the global db handle,
`db_manager`, `sessions`, `session_ttl_seconds`, `cache`, `kernel`, `terminal_id`,
`media_cache_dir`, `picker_ticket_secret`, `registry`, `plugins`, `emitter`,
`scanner_cancel`, `topology_apply_lock` — plus 12 helper methods spanning resolve
(`resolve_session` / `resolve_scope` / `resolve_store`), permission
(`require_session_permission`, `require_permission_for_user`,
`require_user_permission_scoped`, `require_permission_for_session_resource`), lock
(`lock_global`, `store`, `store_with_tid`, `terminal_id`) and publish (`publish_event`).

> **THE DECISION THAT MATTERS MOST: filesystem paths are NOT added to `BridgeCtx`.**
> Where a body needs a path or a compile-time-constant string, **the shim computes it and
> passes it as a parameter.** This is not a stylistic preference and not a transitional
> state to clean up later. The rationale is recorded in code at
> `crates/oz-bridge/src/settings.rs:20-23`: `BridgeCtx` carries the app *cache* dir, which
> is a **different directory** from the `db_path` parent the shell derives, so the shim
> threads `base_dir` in rather than letting the bridge re-derive it.

Three independent cases validated the rule — each a wire-visible break that a verbatim
move would have shipped:

| Case | What a verbatim move would have changed | Evidence in code |
|---|---|---|
| **branding** | `app_data_dir` and `media_cache_dir` are different directories. `validate_logo_path` requires the logo to sit *inside the application data directory*, so the ctx's cache dir would reject or relocate valid logos | `crates/oz-bridge/src/branding.rs:71-74`; `ctx.rs:74-75` |
| **health** | `env!` / `option_env!` resolve **per crate at compile time**. Moved verbatim, `CARGO_PKG_NAME` answers `"oz-bridge"` instead of `"oz-pos-app"` (`apps/desktop-client/Cargo.toml`: `name = "oz-pos-app"`), and `option_env!("TARGET")` falls to `"unknown"` because `crates/oz-bridge` ships no `build.rs` setting `TARGET` | `crates/oz-bridge/src/health.rs:5-9` (doc); `apps/desktop-client/src/commands/health.rs:26-29` and `:46-49` (the `env!` reads, kept in the shim) |
| **backup / db_path** | `AppState::db_path` is unreachable from the bridge and the backup target is *derived* from it, so the shim clones it and passes `&Path` to all four commands; `default_backup_path` moved **with** the bodies so the derivation stays shared by all four | `apps/desktop-client/src/commands/data.rs:6-8`; `crates/oz-bridge/src/data.rs:146-148`, `:274`, `:294` |

**3. Two error types, one conversion seam.** Bridge code returns `BridgeError`
(`crates/oz-bridge/src/error.rs:15`); desktop code returns `AppError`. The single seam is
`impl From<BridgeError> for AppError` at
`apps/desktop-client/src/commands/authz.rs:227-258`. It maps variant-for-variant and
critically **preserves `Core`**: `BridgeError::Core { sub_kind, message } => Self::Core { … }`
(`authz.rs:236`). Tests that match on `AppError::Core` with a message substring therefore
still pass through the two-hop path
`CoreError → BridgeError::Core` (`error.rs:62-69`) `→ AppError::Core`, because the
message is carried unchanged.

**Stated honestly:** a new `BridgeError` variant **requires an explicit mapper arm**.
`BridgeError` is `#[non_exhaustive]` (`error.rs:14`), so a cross-crate `match` *must*
carry a wildcard arm (`authz.rs:230-233` records exactly that), and that arm —
`authz.rs:255`, `other => Self::Internal(other.to_string())` — **silently degrades an
unmapped variant to `AppError::Internal`**. The compiler will not catch the omission: the
wire shape turns a typed error into an internal one and the build stays green.
`BridgeError::TopologyValidation` (`error.rs:45-56`) was added for the topology group for
this reason — the structured failure (code / node_id / wire_id / port_id) had to survive
the hop field-for-field (`authz.rs:242-254`), and it would have been flattened otherwise.

**4. The parity iron rule.** As the campaign stated it: extracted code is
**byte-identical** on SQL text, permission gate **kind and order**, lock acquisition order
and **count**, transaction boundaries, event publish order, log text and fields, and error
variants and strings. **Pre-existing defects are PRESERVED AND REPORTED, never fixed
inside an extraction** — a bug repaired under a `refactor` commit is an unreviewed
behaviour change. Gates that are not scope-aware **stay not scope-aware**; an extraction is
not the place to widen a gate. What the rule preserved is registered, one line per item,
in [`docs/records/audit-open-findings.md`](../records/audit-open-findings.md)
§*Bridge extraction (`crates/oz-bridge`)*.

## Consequences

**Gained.** Bodies are callable without a shell, and the headless harness
(`crates/oz-bridge/src/testing.rs`) builds a real `BridgeCtx`. Test relocation followed
the bodies (e.g. `1f7552878` “relocate settings unit tests to oz-bridge”), which is why
the campaign has been deleting desktop adapters as their tests move out.

**Costs accepted, in the same candour.**

- **Visibility widened purely to cross the crate boundary.** Measured across the three
  landed topology commits (`27621900f`, `01f7b10ae`, `748ef59cd`): **28** items went
  `pub(crate) → pub` in the topology group (11 + 10 + 7). **4 of them exist only because a
  test reaches them** — `ser_f64_finite`, `de_f64_or_null`, `de_direction_or_null`,
  `default_direction` (`crates/oz-bridge/src/topology/model.rs:27`, `:35`, `:55`, `:250`),
  referenced nowhere else but `model.rs` and `model_tests.rs`. Those four narrow back to
  `pub(crate)` the moment `model_tests.rs` moves; the other 24 never can. All 28 are now
  reachable from any crate that depends on `oz-bridge`.
- **Some import lines are load-bearing and must survive a move.** An import that looks
  unused is often a **re-export device** feeding a sibling module or a root `cfg(test)`
  glob: `pub use oz_bridge::data::{…}` (`apps/desktop-client/src/commands/data.rs:24`),
  `pub use oz_bridge::browser::urlencoding;` (`…/browser.rs:22`),
  `#[allow(unused_imports)] // sibling sync_tests.rs depends on it` (`…/sync.rs:28-29`),
  and the `use super::*` device lines at `crates/oz-bridge/src/topology/persistence.rs:15-17`
  whose module doc explains they exist so moved `super::` paths still resolve. Delete one
  and what breaks is a *test file that names it*, not the code beside it.
- **The file-size cap moved; it did not improve.** `AGENTS.md:155` requires production
  `.rs` files under 1,000 lines. `apps/desktop-client/src/commands/settings.rs` was
  **1,215** lines at `7360f14eb`; `crates/oz-bridge/src/settings.rs` is **1,179** today
  (the desktop file is now 375). The breach was **relocated, not resolved** — and it is now
  *less* visible, because the audit stamp policing it is scoped `crate: desktop-client`.

## What was NOT extracted — parked, not unfinished

A future reader will otherwise file these as gaps. Each is a boundary decision.

| Surface | Why it stays in the shell |
|---|---|
| `pg_sync_status_scoped`, `pg_sync_start_scoped`, `pg_sync_stop_scoped` | They drive the `PgSyncDaemon` handle on `AppState` (`apps/desktop-client/src/state.rs:119`; type at `platform/sync/src/pg_daemon.rs:66`). `oz-bridge` does not and must not depend on `platform-sync`. **Parked owner decision: `BridgeCtx` has no port for long-lived services.** Kept in-file at `apps/desktop-client/src/commands/sync.rs:14-16`, `:194`, `:204`, `:221` |
| `pick_logo_file`, `pick_logo_file_scoped` | `tauri::dialog`, no seam. Noted at `crates/oz-bridge/src/branding.rs:4-5`; bodies at `apps/desktop-client/src/commands/branding.rs:102`, `:164` |
| `open_in_browser` | `tauri-plugin-opener`. The bridge took only the URL builder; the open stays with the plugin (`crates/oz-bridge/src/browser.rs:9-12`; `apps/desktop-client/src/commands/browser.rs:9-12`, `:44`). This is the pattern the two pickers cite |
| `local_api_*` (6 scoped commands) | Device-level lifecycle bound to `AppState::local_api_op` and the shell's own server handle — `apps/desktop-client/src/commands/local_api.rs:14-19` |
| `plugins.rs` | A 3-line placeholder for a future plugin IPC surface — there is no body to move (`apps/desktop-client/src/commands/plugins.rs:2`) |
| `settings_changed_sink` | Stays desktop-side because **production calls it**: `apps/desktop-client/src/lib.rs:249` builds the daemon's sink with it. It *implements* the `EventSink` boundary rather than consuming one (`commands/sync.rs:117`) |
| `recover_pending_topology_apply_at_startup` | Keeps a desktop adapter because `apps/desktop-client/src/lib.rs:135` calls it with `&AppState` (`commands/topology/persistence.rs:38-39`) |

**The one documented exception to “ctx first”.** The topology helpers above take their
*parts* — a connection handle, `&StoreDatabaseManager`, the apply-lock
`&tokio::sync::Mutex<()>` — instead of a `BridgeCtx`, because the caller that needs them
(`lib.rs:135`) has an `AppState`, not a ctx:
`crates/oz-bridge/src/topology/persistence.rs:418`
(`recover_pending_topology_apply_at_startup`), `:440` (`recover_pending_topology_apply`),
`:493` (`snapshot_workspace_rows`), `:532` (`compensate_workspace_diff`); the module doc at
that file's `:10-13` names them “the four helpers that took `&AppState`”, with
`validate_apply_gate` as the in-file precedent for taking `&[&Connection]` over a ctx.
Recorded for the ledger: **that file is still untracked at `3cc76b156`** — the topology
persistence slice was in flight while this ADR was written, so its line numbers can move.

**`currency_info` is the in-tree precedent for the opposite choice:** a body that
genuinely wants no context drops context entirely — `pub fn currency_info(code: &str)`
(`crates/oz-bridge/src/currency.rs:43`) takes no ctx, while its scoped sibling (`:55`)
takes one. “ctx first” is a default, not a mandate; the burden sits on *removing* it.

## What was NOT done (open as of this record)

1. **The tablet client is untouched.** `apps/tablet-client/src` contains **zero**
   references to `oz_bridge` across its 95 command files — even though
   `crates/oz-bridge/Cargo.toml`'s `description` already advertises the crate as shared
   “by the desktop **and tablet** IPC shims”. Until the tablet migrates, its commands are
   a second, independent copy of every body, divergence there is silent, and the crate
   description overstates current reach.
2. **Neither ADR index was updated by this commit.** `#49` still needs its row in the
   numbered table of `docs/decisions/README.md`, and the generated
   `docs/records/README.md` needs `node scripts/generate-records-index.mjs` (per
   `docs/README.md`, nothing regenerates it automatically). Both are shared files in a tree
   with three concurrent manager sessions, and were left to their owners rather than
   rewritten from under them.
3. **The findings this decision preserved are not fixed.** They are registered, not
   remediated.
