---
num: 63
area: architecture
title: ADR-63: The EventSink Seam — grading R10 #3 with a rule that arrived at zero
status: Implemented (2026-10-04) — rule `event-sink-seam` landed in scripts/verify-architecture-boundaries.py at zero findings with no baseline; the four remaining raw-handle broadcasts were routed through BridgeCtx::emitter; R10's other three invariants are disposed of by measurement (D6 — #1 a written convention, #2/#4 struck)
---

# ADR-63: The EventSink Seam

**Status:** Implemented (2026-10-04) — rule `event-sink-seam` landed in
`scripts/verify-architecture-boundaries.py` at zero findings with no baseline entry; the four remaining
raw-handle broadcasts in the two shells were routed through `BridgeCtx::emitter`. D6 records the
disposition of R10's other three invariants (one convention, two struck).
**Date:** 2026-10-04
**Recorded against:** branch `0.0.40`
**Tags:** architecture, boundaries, gates, renderer, event-bus, bridge

## Context

**1. R10 made the four Item-7 invariants a graded contract.** The ruling
(`docs/plans/_active/notes.md:1558`) is: "The four Item-7 invariants become a graded contract, and their
home is `scripts/verify-architecture-boundaries.py`'s RULES dict." The four are: DTOs carry data never
presentation; every business rule sits at a choke point; **events cross the seam through `EventSink`**; a new
shell needs only a `BridgeCtx`, a command registration and a locale reader. R10 asks for the shape *"a rule
that arrived at genuine zero and needed no baseline row"* — a ratchet is the fallback, not the goal.

**2. Only #3 has a clean gradable population, and that was measured, not assumed.** The R10 addendum
(`notes.md:1560`, dated 2026-09-16 against the old `oz-*` tree) counted 11 violations, all `app.emit(` in
`apps/tablet-client/src/commands/` (renamed since to `apps/mobile-tauri/`). The other three invariants either
have no mechanical shape yet or a population that is prose, not syntax. #3's population is a literal call
pattern in shell sources.

**3. The seam already existed and was already load-bearing.** ADR #49 moved command bodies into
`crates/kasirmu-bridge` headless, with events leaving through `pub trait EventSink: Send + Sync`
(`crates/kasirmu-bridge/src/ctx.rs:57`). `BridgeCtx::emitter: Option<Arc<dyn EventSink>>` (`:96`) is the
injected door; every shell implements it over its own `AppHandle` (`desktop`,
`apps/desktop-tauri/src/commands/authz.rs:31` `struct TauriEventSink`). A command body that keeps its own
handle and calls `app.emit(..)` on it forks that path: the shell then holds two ways to broadcast, and a
third shell has to find and copy the forked one. The rule grades the fork, not the seam.

**4. ADR-61 set the precedent for a *named* rule.** `core-type-shim` was given its own name, severity and
hint rather than folded into a blanket allow, because "a checker that cannot distinguish two different debts
cannot prioritise them" (ADR-61 Context §1). The same argument applies to a second event path: it deserves
its own name, not a wildcard.

## Decision

**D1 — `event-sink-seam` is a named rule (severity P1).** It is added to `RULES` in
`scripts/verify-architecture-boundaries.py` with `category: renderer`. It flags a raw-handle broadcast —
`app.emit(`, `app_handle.emit(` or `handle.emit(` — in `apps/**/*.rs`. `sink.emit(`,
`emitter.emit(` and `self.emit(` are the seam and never match. Severity is P1, not P2: a forked event path
is a second shell's problem to discover at runtime, not a stylistic drift.

**D2 — The seam's own implementation is the exemption, not a finding.** The rule brace-walks every
`impl EventSink for ...` block and skips its whole body: inside it, `handle.emit(..)` is exactly the
delegation the trait wants. The exemption is derived from the source (the `impl` keyword), not a baseline
row, so it cannot silently widen.

**D3 — The platform emit hook is exempt by paren-walking its argument list.** The desktop composition root
installs `platform_startup::event_handlers::set_settings_emit_fn` (`platform/startup/src/event_handlers.rs:559`)
with a closure over its own handle. That hook speaks a plain
`Box<dyn Fn(&str, serde_json::Value) + Send + Sync>`, not `EventSink`, so the handle conversion at exactly
this boundary is the hook's *installation*, not a second event path. `EVENT_SINK_HOOK_PATTERN` skips the
whole argument list. This is the only such hook; a second one would need its own justification here.

**D4 — Lifetimes are neutralized before masking, because the simple masker is not lifetime-aware.**
`mask_comments_and_strings` reads a lifetime apostrophe (`'_`, `'a`, `'static`) as a character-literal
opener and then swallows the following code as a "string" until the next apostrophe. Shell command
signatures are full of `State<'_, AppState>`, so a naive pass hides real sites — this was found on
`apps/mobile-tauri/src/commands/hardware.rs:181`, where two `app.emit` calls sat invisible behind a
lifetime. `neutralize_lifetimes` blanks each lifetime to equal-width spaces (offset-preserving, so reported
line numbers still match), and only then is the text masked.

**D5 — The rule arrived at zero and took no baseline row.** The four surviving raw-handle broadcasts — two
`receipt:printed` emits in `apps/mobile-tauri/src/commands/hardware.rs` (`print_receipt_scoped`,
`print_sales_receipt_scoped`), `emit_orders_changed` in `apps/mobile-tauri/src/commands/kds.rs`, and the
sync daemon's settings sink in `apps/desktop-tauri/src/commands/sync.rs` /
`apps/desktop-tauri/src/lib.rs` — were routed through the seam as part of this decision. `emit_orders_changed`
now emits `serde_json::Value::Null`, matching `crates/kasirmu-bridge/src/kds.rs:378`. The gate reports
0 tracked / 0 blocking / 0 stale with the new rule live, which is the R10 shape: no entry exists to expire.

**D6 — The other three invariants are disposed of by measurement, not left as aspiration.** R10 asks for a
graded contract over four invariants; only #3 had a clean population, and this decision records what the
current tree says about the rest rather than pretending they are pending.

- **#1 (DTOs describe data, never presentation) — the vocabulary decision is made here: `icon` and
  `colour` are DOMAIN data, not presentation.** Re-measured 2026-10-04: **101** `pub struct *Dto`
  declarations across `crates/`, `modules/`, `platform/`, `foundation/` and `apps/` (the R10 addendum
  counted 121 against the old `oz-*` tree). Fields matching a presentation vocabulary are only ever
  `icon` and `colour`, on five files — `foundation/src/inventory.rs`, `foundation/src/loyalty.rs`,
  `crates/kasirmu-bridge/src/categories.rs`, `crates/kasirmu-bridge/src/workspaces.rs`,
  `crates/kasirmu-core/src/db/workspaces.rs` — plus `width`/`height` (media pixel dimensions,
  `crates/kasirmu-media/src/lib.rs`), `padding` (a fiscal sequence number, `crates/kasirmu-core/src/db/fiscal.rs`),
  and `layout` (a `ReceiptLayout` enum, `crates/kasirmu-core/src/db/receipt_formats.rs`). A category's
  colour and a workspace's icon are values a MERCHANT chooses and stores, exactly like a name — they render,
  but they are not renderer vocabulary. So the predicate for #1 is: a field is presentation only when its
  type is a renderer type (`Html`, `Style`, `Route`, a widget handle), never when its value is a
  merchant-chosen string. Under that predicate the tree has **zero** violations, and #1 is a
  **convention, not a gate**: a checker keyed on field NAMES would flag `colour`/`icon` and be wrong on
  every one of them, which is the false-positive a `--strict` leg cannot carry.
- **#2 (every business rule at a choke point) — struck.** It has no token, type or call shape; the R10
  addendum already recommended prose, and nothing in the current tree changes that.
- **#4 (a new shell needs only a `BridgeCtx`, a command registration and a locale reader) — struck as a
  gate, retained as an acceptance test.** Re-measured: **0** `.slint` files; **2** shells carry a
  `src/lib.rs` (`apps/desktop-tauri`, `apps/mobile-tauri`). The invariant is evaluated by BUILDING the
  third shell, which no static check can substitute for.

**D6 is the R10 contract's honest limit: one of four invariants became a gate; one became a written
convention with its vocabulary decided; two are struck. Writing a guessing gate for the struck two would be
the failure this repository has already named — a rule that arrives with a baseline nothing can burn down.**

## Consequences

- **Good:** the fourth Item-7 invariant is now a graded contract with a mechanical population; a future shell
  cannot add a raw-handle broadcast without reddening the gate; and the rule proves the "arrive at zero" route
  is actually available for a shell seam, which is the precedent the other three invariants can cite.
- **Cost, accepted:** the checker walks `apps/**/*.rs` once more (286 shell files scanned) and carries two
  exemption walkers. Both are derived from the source; neither is a baseline file.
- **Not done:** invariants #1, #2 and #4 are not graded — D6 disposes of each by measurement (#1 a written
  convention, #2/#4 struck), so this is a recorded limit of R10, not an outstanding ticket.
- **Verification:** `python scripts/verify-architecture-boundaries.py --strict` → exit 0, 0 tracked / 0
  blocking / 0 stale, population line "286 shell .rs file(s) scanned for the event seam";
  `cargo check` clean for `kasirmu-app` and `kasirmu-mobile`;
  `cargo clippy -p kasirmu-app -p kasirmu-mobile -p kasirmu-bridge --all-targets -- -D warnings` clean;
  `cargo test -p kasirmu-app --lib` 174 passed, `cargo test -p kasirmu-mobile --lib` 692 passed.
  Commit `db321e3a1`.

## References

- `scripts/verify-architecture-boundaries.py` — `RULES`, `event_sink_findings`,
  `exempt_event_impl_lines`, `neutralize_lifetimes`, `EVENT_SINK_HOOK_PATTERN`
- `crates/kasirmu-bridge/src/ctx.rs` — `trait EventSink` (:57), `BridgeCtx::emitter` (:96)
- `apps/desktop-tauri/src/commands/authz.rs` — `struct TauriEventSink` (:31)
- `platform/startup/src/event_handlers.rs` — `set_settings_emit_fn` (:559)
- `docs/plans/_active/notes.md:1558` — the R10 ruling; `:1560-1565` — the census addendum
  (the disposition D6 re-measures), `:1573` — the ten-item disposal table
- ADR-61 — the tier/named-rule precedent; ADR-62 — the module seam taxonomy; ADR #49 / #53 — the headless
  bridge and the UI-vocabulary rule this one sits beside
