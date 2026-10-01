---
num: 49
area: desktop-client
title: ADR #49: Headless Command Bridge — Moving Command Bodies into crates/oz-bridge
status: Accepted (2026-09-11) — implemented for the desktop shell; tablet client not started
---
<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file: 188 lines, no audit stamp, no footer and no marker. Its status line is unusually precise — Accepted, implemented for the DESKTOP shell, tablet client not started — and that precision is the kind that survives a restructure, so it was the first thing checked. · AND IT IS STILL TRUE IN SUBSTANCE, because the bridge it created is the most structurally consequential artefact in the repository. `crates/kasirmu-bridge/src/` carries the shared command bodies this decision moved out of the shells — `ctx.rs`, `lib.rs`, `data.rs`, `features.rs` and `kds.rs` all present. The crate is now `kasirmu-bridge` rather than the `oz-bridge` the title names, but the boundary it established is the one every later document in this campaign has relied on: the platform-core boundary checker enforces a `bridge-toolkit-purity` rule specifically so a second renderer could bind, and ADR-44, audited in the previous round, sits alongside this one as the decision that made design rules enforceable rather than aspirational. · THE SHELL ASYMMETRY IS WORTH RECORDING, because the document is honest about it and the tree kept the shape. The decision moved command bodies into a headless bridge so the shells become delegates — which is exactly why `kasirmu-bridge` can be depended on by something that is not a Tauri app, and why the toolkit-purity gate exists. A reader trying to understand why that crate may not depend on `tauri` will find the answer in the gate definition and the rationale in this ADR. · NOT RE-MEASURED: whether the tablet shell has since been migrated. The status line says not started, and this pass did not walk both clients to confirm or refute it — the desktop-side bridge exists, and that is what the document's own claim rests on. A future pass wanting to close that leg should diff the two handler registries, which is what the ipc-parity gate does. · No stamp existed; this is the first. -->
# ADR #49: Headless Command Bridge — Moving Command Bodies into crates/oz-bridge

**Status:** Accepted (2026-09-11). The desktop side is built; the tablet side is not.
**Date:** 2026-09-11
**Recorded against:** branch `0.0.37` @ `abbedfb4b` (measurements taken from `3cc76b156` forward)
**Tags:** architecture, tauri, ipc, desktop-client, oz-bridge, testing, error-handling

> **Cite this record by filename, not by number.** `docs/decisions/README.md` documents
> that `#43` is claimed by two files, and `2026-08-08-adr44-typed-connection-gating.md`
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
Recorded for the ledger: the persistence slice was mid-flight when this record was
drafted (untracked at `3cc76b156`) and landed at `79e8c26f2` / `cf77cbbee`, so these
line numbers are the merged-tree ones and move with the next topology commit.

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

## Amendment 2026-10-04 — absence and failure are different answers

A bridge body that reads a hardware registry is where this decision's error boundary stops
being academic. `kasirmu_bridge::scale::list_scale_devices_scoped` is the first such body to
carry the rule explicitly, and the distinction is worth recording because the two neighbouring
bodies in the same module resolve it in *opposite* directions on purpose.

**The defect (fixed at `ac93cff77`).** The body walked `registry.scale_ids()` and paired each id
with `if let Some(scale) = registry.scale(&id).await`, pushing only the ones that resolved. A
lookup that came back `None` therefore **removed a device from the answer** — a device list
shorter than the registry actually holds, returned as `Ok`, with no error and no log. Nothing in
the result distinguished "this register has two scales" from "this register has two scales and
one of them was silently dropped". An operator sees a scale missing from the hardware view and
has nothing to act on.

**Why that is not the same as the sibling `None`.** `read_scale_weight_scoped` (same module)
maps a missing scale to `Ok(None)` deliberately: *no scale bound to this register* is a defined
state that the UI renders as "no weight". One `None` is a fact about the register; the other was
a fact about the read that had been laundered into a fact about the register. The amendment's
rule: **`None` may mean "absent" or it may mean "the lookup failed"; these must be different
types or the failure will eventually be read as an absence.**

**The fix is a registry accessor, not a retry loop.** `kasirmu-hal` gained
`DriverRegistry::scales() -> Vec<(String, Option<Arc<dyn WeightScale>>)>`, which takes *one*
read guard and returns every id together with its driver. The list can no longer be shortened by
a second lookup racing a concurrent change, because there is no second lookup. The `Option` is
always `Some` today — the map has no removal path — and is kept so the snapshot stays
self-describing for a caller that must not assume it. The command still guards the arm and
returns a loud `BridgeError::Internal` naming the id, rather than continuing with a shorter list.

**Test-support is a feature, not a `#[cfg(test)]` gate.** The pins need to bind a scale, and the
production writer (`register_scale`) was deleted 2026-09-27 as dead code. A `#[cfg(test)]` gate
cannot serve a downstream crate: cargo compiles `kasirmu-hal` **without** `cfg(test)` when it is a
dependency of `kasirmu-bridge`'s own test build. The capability is therefore a `test-support`
feature that the consuming `[dev-dependencies]` turns on, which leaves every release build
byte-identical. This is the pattern for any future fixture helper a sibling crate needs.

**The pins, and what they honestly cover.** Four tests: a registered scale is reported with its
identity; an unconfigured register reports an empty list rather than an error; the listed count
always accounts for every id the registry reports; and `scales()` pairs each id with its driver.
The third was verified RED-then-GREEN against the fix. Stated plainly: **no test can drive the
`None` arm through the public registry**, because no code path ever removes a scale — the arm is a
guard, not a reachable state. The count invariant and the `scales()` pairing pin the *contract*
that made the omission impossible, which is the part a regression would break.

**Still open, and now recorded as the tablet twin's debt.**
`apps/mobile-tauri/src/commands/scale.rs:66-73` carries the identical `if let Some(..)` swallow and
does **not** route through the bridge yet (that is this ADR's own §What was NOT done, item 1 — the
tablet is still a second copy of every body). The desktop shell
(`apps/desktop-tauri/src/commands/scale.rs:19-39`) delegates to the bridge and inherits the fix.
A future pass closing the tablet migration should fix the twin by delegating, not by re-patching
the copy.

## Amendment 2026-10-04 (b) — the tablet twin is delegated, not re-patched

The amendment above closed with the tablet twin at
`apps/mobile-tauri/src/commands/scale.rs` carrying the same silent-omission swallow. It has
now been fixed the way that note said it should be — by delegating, not by re-patching the copy
(`18fbdff99`).

**The blocker in the file's own header was stale.** `scale.rs` claimed the bodies stayed
tablet-native because the bridge's scoped twins "take a `BridgeCtx` the tablet `AppState` cannot
yet build". That stopped being true when `AppState::bridge_ctx()` landed
(`apps/mobile-tauri/src/state.rs:473`), and the ctx already carries `registry`
(`:499`). Every other tablet command had been delegating for some time — `analytics.rs:28`,
`audit.rs:123` and the rest — so the scale module was the last holdout carrying a comment that
described a world that no longer existed. **A stale "cannot yet" is a standing instruction to
copy, and copies drift.** The header now says what is true.

**The copy had already drifted into the defect.** The native `list_scale_devices_scoped` was
`scale_ids()` plus `if let Some(scale) = state.registry.scale(&id).await` — the identical
silent-omission shape the bridge had before `ac93cff77`. So this was not a tidy-up: the tablet
still shipped the bug the bridge had just shed, and only delegating could carry the fix across.

**One body had to be added rather than moved.** The tablet exposes an *unscoped*
`read_scale_weight` door; the bridge only had the scoped twin. The unscoped body now lives in
`kasirmu_bridge::scale::read_scale_weight` with a doc noting it performs no scope resolution, so
the scoped form is preferred wherever a token exists. This is the ADR's own §`currency_info`
precedent in reverse: a body that genuinely wants no context should not be invented in the shell
when the headless crate can own it and both shells can share it.

**The pin that guards against a returning copy, and the trap it walked into.** The tablet now
asserts its own source carries no `scale_ids()` walk and no `registry.scale(` lookup. The first
version scanned the whole file and **failed on the correct module** — the new module doc names
`scale_ids()` while explaining what was removed. That is the failure mode to watch for in any
source-text pin: it matched the prose, not the code, and a pin that fails on a correct file gets
deleted by the next reader. The pin now starts at the first `use` and inspects only code, and it
panics with an explanatory message if that anchor disappears. Re-verified RED-then-GREEN by
reintroducing the registry walk.

**Still open (the tablet migration itself).** This closes the *scale* leg, not §What was NOT
done item 1: the tablet is still a second copy of most other bodies. The count is now one
module smaller, and `apps/mobile-tauri/src/commands/scale.rs` no longer contributes to the
divergence the ipc-parity gate watches.

## Amendment 2026-10-04 (c) — a preference that cannot be read is not an unset preference

The hardware bridge is where this decision's error boundary meets a settings read, and the
second such site this campaign has found. `scanner_prefs` (`crates/kasirmu-bridge/src/hardware.rs`)
returns the operator's saved scanner Device ID and input mode, and it returned a bare
`(String, String)` while folding **all three** of its reads into defaults: a FAILED
`hardware_profiles` query fell through via `.ok()`, a stored profile that would not parse fell
through via `.and_then(..ok())`, and both legacy keys via `unwrap_or_default()`.

**What that produced.** An unreadable `settings` table — SQLITE_BUSY, corrupt, locked — answered
`("", "auto")`, byte-identical to a terminal that was never configured. `preferred` empty makes
`prefer_first` a no-op, so the Device ID the operator saved stops being fronted; and an empty
mode falls to the `_ => ids` arm of `ids_for_mode`, so a `keyboard`-wedge terminal opens COM
ports and a serial-only terminal is handed a HID device. Those are precisely the failures
`ids_for_mode` was introduced to prevent — the read failure re-created them silently.

**`scanner_prefs` now returns `Result<_, BridgeError>` and propagates.** The profile query uses
`.optional()` so a MISSING row remains the one legitimate absence and still falls through to the
legacy keys; a non-parsing profile is an error rather than a silent fall-through, because a
configuration the operator did save must not be ignored; the two legacy reads use `?`. Both
callers thread the result — `saved_scanner_prefs` for the bridge, `list_scanners_scoped` for the
tablet.

**The outer default was doubly wrong, which is the general lesson.** The getters already carry
their own documented defaults for an absent key — an empty device id, and `"auto"` for the mode
(`platform/core/src/settings/typed.rs:272`). An `unwrap_or_default()` written outside them could
therefore only ever fire on an error, AND it would have replaced that documented `"auto"` with an
empty string. **A default written one layer above the layer that already owns the default is a
swallow wearing a policy's clothes.** That is the same reading that made the receipt-format fills
safe to convert to `?` — the defaults belonged below, where they still are.

**Pins.** `an_unreadable_settings_table_is_not_an_unconfigured_terminal` makes `settings` present
but unreadable (a BLOB `value`) and asserts the read refuses; verified RED with the swallow
restored (it answered `("", "auto")`) and GREEN with the fix.
`a_missing_profile_row_falls_through_to_the_legacy_keys` pins the one absence that must NOT error,
and in doing so records the getter's own `"auto"` default so a future edit cannot quietly drop it.

## Amendment 2026-10-04 (d) — a list that cannot be read must not come back full of blanks

The previous three amendments were about a `None` that could mean either absence or failure. This
one is the harder version of the same bug: a value that is present, well-typed, and **wrong**.

`list_staff_scoped` makes three reads per member — the profile, the assignment, and the badge
code — and all three swallowed their error (`.ok().flatten()` twice, `.unwrap_or(None)` for the
code). A failure anywhere in the loop therefore returned a roster that still *looked* populated
while every entry carried a blank profile and a blank `staff_code`. Nothing in the response
distinguished it from a correct roster of members who simply had not filled anything in. The same
three reads appear again in `restore_staff_scoped` and `list_staff_trash_scoped`, so a manager
could restore a member and receive back a DTO that reads as incomplete.

**Why this is worse than the earlier sites.** An absent value can at least be reasoned about — a
blank footer, a missing scale, an unset preference. A list of correctly-shaped objects carrying
silently-emptied fields cannot: every field is present and every field is a lie, and the caller has
no signal to branch on. The rule the earlier amendments stated (absence and failure must be
distinguishable) was satisfied here on paper — the function returned `Ok` — while being violated in
substance.

**Fixed by propagating, with the loops made explicit.** All three sites use `?`; the two
`.iter().map(..).collect()` loops became `for` loops because the body can now fail, which also
makes the per-member cost visible. A roster either reflects the store or fails.

**Pin.** `a_failed_roster_read_refuses_instead_of_listing_blanks` drops `users.index_id` — the
column `get_staff_code` reads and `list_users` does not — together with the index over it (SQLite
refuses `DROP COLUMN` while an index covers it), so the loop is entered and its later read fails.
Verified RED with the swallows restored, returning a full roster with every `staff_code: None` and
`is_profile_complete: false`, and GREEN with the fix.

## Amendment 2026-10-04 (e) — the last four swallows, and what made them findable

Amendment (d) fixed the roster loop. Sweeping for the same shape found five more, all in this
crate and all the same one: a Base62 **code** read through `unwrap_or(None)`.

`to_location_dto` and `to_terminal_dto` enrich a DTO with its code via `get_location_code` /
`get_terminal_code`, and both swallowed. These two helpers sit on the read path for every scoped
location and terminal command — including the write responses the UI echoes straight back — so a
locked or corrupt table would have blanked the code across the list **and** on create and update.
Three more sat in `staff.rs`: the code in `create_staff_scoped`, and the pair in
`update_staff_scoped`.

**What made them findable is worth recording, because it is a technique rather than a fix.** The
`update_staff_scoped` site reads:

```
    (
        store.assignment_for_user(&args.id)?,
        store.get_staff_code(&args.id).unwrap_or(None),
    )
```

Two reads of the same row, adjacent, one propagating and one swallowing. The inconsistency is the
tell. It is the same signal that located the receipt-footer defect (every other settings read in
that function used `?`) and the scanner-preference defect. **When a function handles one kind of
read two different ways, the divergent one is the bug** — no amount of grepping for a pattern finds
that as reliably as reading the neighbour.

**Fixed.** Both `to_*_dto` helpers return `Result` and propagate; the three `staff.rs` reads do
the same. Callers thread it — `.collect::<Result<Vec<_>, _>>()?` for the list sites and
`.transpose()?` for the optional ones, which is the idiomatic spelling and worth noting since the
first attempt at each was a `?` in the wrong position.

**Pin.** `a_failed_location_code_read_refuses_instead_of_returning_a_blank_code` assigns the
seeded location an index id (the migration does not), proves the code round-trips, then drops
`locations.index_id` and the index over it so the code read fails. Verified RED with the swallow
restored — the full DTO returned with `code: None` — and GREEN with the fix.
> last audited 29-09-26 by docs-auditor
