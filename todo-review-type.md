# Local-First & Frontend Architecture — work queue
> **2026-09-15 · 11:45 · DSH · the 17 decision-required rows in the triage section at the foot of this file now live on the owner page: `docs/plans/notes.md` item 25 -- rulings R1-R10 plus one refused work order. Read item 25 before asking anyone to rule on any of them. Nothing here was ticked, moved or renamed: the rows stay as the evidence behind those rulings, and this file still has no acceptance command, so it is not renameable.**
> **2026-09-15 · 12:25 · DSH · whole-suite numbers, recorded as an attributed report and not as this queue's debt.** An ops lane reports the full front-end run at tip `36ca7fc6b` as **Test Files 2 failed / 578 passed of 580** and **Tests 2 failed / 9,955 passed / 25 skipped / 3 todo of 9,985**, the chain red on (i) a FOREIGN UNCOMMITTED `box-shadow` declaration at `ui/src/features/sales/CartPanelLineItem.css:437` -- a working-tree edit that occurs 0 times in that file's HEAD blob -- and (ii) one undo-history-cap test that timed out under load. **NOT RUN by this pass** (`check:all` is barred tonight and the chain takes ~390s; this file's own `## Acceptance` finding, that the queue has no single acceptance command, is untouched by any of it). **The foreign red is not this queue's debt:** the compliance walkers that flagged it read the disk through `fs` with no channel to the commit they are quoted against. Four boxes were ticked by this pass at tip `b3dee11f8`, each on its own re-run green; `:92`, `:190`, `:192` were deliberately left open with a dated line each.**

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

> **2026-09-15 · 12:55 · DSH · sixth disposition pass, tip `93c178fd` — 5 boxes ticked (`:78`, `:83`, `:187`, `:203`, `:224`), 21 given a dated refusal naming exactly what each waits for (`:112`; the five Item-2 rows `:120`/`:121`/`:125`/`:126`/`:128`; `:139`/`:141`/`:146`; `:148`; `:181`/`:183`/`:185`; `:223`/`:226`/`:229`; the five Item-7 rows `:237`-`:243`), and left as they were on `:64`, on `:93` (it already carries its own dispositions at `:103`-`:106`) and on the four Item-5 offline rows `:197`/`:199`/`:201`/`:202`, which wait on the ledger ruling in flight. Counts: open 32 -> 27, ticked 4 -> 9, total 36 unchanged.** No file outside this one was edited, and no code was written here. Every tick this pass is gated on the question 'can it disagree?': `:78` was ticked only after the fixture plant made the boundaries checker exit `1` (`scripts/__tests__/verify-architecture-boundaries.test.mjs:277`-`:286`), and `:187` only after `verify-ftl-orphans.py --self-test` printed `6 directions exercised, 75 one-sided keys detected` with exit `0`. Two rows were refused for the same reason in the other direction, and the file-and-line is in the line: `:93`/`:237` still name a `ui-framework-vocabulary` rule that returns **0** hits in `scripts/verify-architecture-boundaries.py`, so a `--strict` exit `0` there grades four other rules plus toolkit purity, not vocabulary — the third wrong-tick mode, live. `:83` was written as a refusal at ~12:50 on ten dirty paths and became true at `93c178fd` while it was being typed; it is now ticked with both readings kept, because a lane that hides its own staleness is worse than one that shows it. `check-dead-refs.py` ran before and after: **8 unresolved reference(s) in 1 live doc(s)** both times, so nothing added here points at anything missing.
> last audited 15-09-26 by Budak-Korporat

---

## Effort estimate (2026-09-15)

Anchors are measured, not guessed: **127** Rust `*Dto` structs vs **336** TS interfaces under
`ui/src/api/`; tablet has **449** command sites across **98** files of which only **15** files
call `oz_bridge`, against desktop's finished **61 of 70**; the vocabulary leak is **37 lines in
19 files**.

| Item | Work | Effort | Gate |
|---|---|---|---|
| 1 | Lock the seam (1A purity now, 1B fixes now, 1C vocabulary last) | **~1 day** | none — start 1A/1B here |
| 2 | ADR: embedded shell | ~0.5 day to draft | **owner decision** |
| 3a | ADR #49 tablet half | **~6–10 days** | biggest item by far |
| 3b | `verify-dto-parity.py` + manifest/docs | ~1.5–2 days | new-gate cost |
| 3c | Offline payload tagged union | ~0.5–1 day | — |
| 4 | i18n prototype + script extension | ~1.5–2 days | prototype result |
| 5 | Offline outbox-reconcile | ~1–2 days | — |
| 6 | Perf adoption (mostly deletion) | ~0.5 day | — |

**Total ≈ 15–22 person-days.** With 2–3 agents in parallel and no blockers: **~1.5–2 weeks**.
Add owner latency on Items 2 and 4 and the realistic wall clock is **3–4 weeks**.

**Calibrate before committing to 3a.** The 6–10 day figure is extrapolated from file counts and
ADR #49's own note that the desktop half took **130 `bridge`-tagged commits** — it is a proxy,
not a measurement. Do **one** tablet command file end-to-end first, time it, and multiply.

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
**Sequencing (agreed 2026-09-15).** Several agents commit to this checkout concurrently, and a
`--strict` gate in `dev-ci.yml#static-gates` is a shared blast radius: one false positive is red
for everyone, not just the author. So Item 1 is split by blast radius, not by effort — **1A and
1B now, 1C last.**

- [x] **1A (now) — rule `bridge-toolkit-purity`.** Fail if `crates/oz-bridge/Cargo.toml` gains
      `tauri`, `gtk`, `webkit2gtk` or a `tauri-plugin-*`, or if `crates/oz-bridge/src/**`
      references them. Narrow scope, **zero findings expected today**, so no baseline and no
      expiry debt. This is the one rule that protects the Slint option itself — a `tauri` import
      into the bridge is unrecoverable cheaply later, and nobody is likely to trip it by accident.
      - **TICKED 2026-09-15 ~12:50 at tip `f26f66ce8`, on the disagreement test and not on a green.** `python scripts/verify-architecture-boundaries.py --strict` -> exit `0`; the rule is a `RULES` key at `scripts/verify-architecture-boundaries.py:42` (category `renderer`, severity `P1`), emitting findings at `:499` (Cargo.toml dependency keys) and `:509` (`src/**/*.rs` through the comment mask); and the baseline holds **zero** purity rows -- `python -c "import json,collections;d=json.load(open('scripts/architecture-boundaries-baseline.json'))['entries'];print(len(d),collections.Counter(x['rule'] for x in d))"` -> `8 Counter({'core-upward-dependency': 8})`, which is exactly this row's promise of 'zero findings expected today, so no baseline and no expiry debt'. **Can it disagree? Measured: yes, and only because a plant makes it fire.** `node --test --test-name-pattern='UI toolkit dependency' scripts/__tests__/verify-architecture-boundaries.test.mjs` -> `# tests 1 / # pass 1 / # fail 0`: the case at `:277`-`:286` plants `tauri = "2"` in a fixture `crates/oz-bridge/Cargo.toml` and `use tauri::Manager;` in a fixture `src/lib.rs`, then asserts `result.code == 1` and `assert.match(result.output, /bridge-toolkit-purity/)`; its sibling at `:268`-`:274` asserts the CLEAN direction, that a comment reading `// depends on no tauri, gtk or webkit type` yields exit `0` -- so the mask keeps the crate from self-reporting and the exit `0` in this checkout is graded, not assumed. Whole file: `node --test scripts/__tests__/verify-architecture-boundaries.test.mjs` -> `# tests 21 / # pass 21 / # fail 0`. **What this does NOT prove:** that 1C exists (`grep -c ui-framework-vocabulary scripts/verify-architecture-boundaries.py` -> `0`, exit `1`), nor that any leak named at `:83` is gone. This rule grades toolkit purity, not prose. Nothing outside this file was touched: `git status --porcelain -- scripts/verify-architecture-boundaries.py scripts/__tests__/verify-architecture-boundaries.test.mjs scripts/architecture-boundaries-baseline.json` printed no path, so all three readings are of the committed tree at this tip.
- [x] **1B (now) — fix the measured leaks before the gate exists.** Comment-only, no behaviour
      change, cannot block anyone, and it retires the debt *before* there is a rule to baseline
      it. 37 lines across 19 files:
      - `crates/oz-core/src/session.rs:55` — *"Workspace type key — determines which React
        component to render."* The core should not know what a React component is.
      - `modules/{crm,inventory,loyalty,sales,settings}/src/lib.rs` — module docs describe
        "frontend (React screens, API calls, Fluent locale)".
      - `crates/oz-bridge/src/{data.rs:286,331, pos.rs:918,1240}` and
        `crates/oz-core/src/db/regional.rs:7,20`, `ozpkg.rs:145-150` — caller references to
        `.tsx` paths that will not exist under another renderer.
      - **TICKED 2026-09-15 ~12:55 at tip `93c178fd`, and NOT by this pass -- this line first read as a refusal, and the refusal became false while it was being written.** At ~12:50 every path this row names was ` M` with another session's in-flight partial, so the sweep was barred (no Rust change in this lane's remit, and a pathspec commit there would have filed a stranger's work under this message). Then `93c178fd docs(core): drop React and tsx references from app-layer comments` landed and the same `git status --porcelain --` over those 10 paths printed **nothing**, so the dirt this row was waiting on is gone. **Each named bullet, re-taken at `93c178fd`:** `grep -n 'component to render\|React component' crates/oz-core/src/session.rs` -> no output (the `:55` wording is gone); `grep -rn 'frontend (React' modules/*/src/lib.rs` -> no output; `grep -rn '\.tsx' crates/oz-bridge/src/data.rs crates/oz-bridge/src/pos.rs crates/oz-core/src/db/regional.rs crates/oz-core/src/ozpkg.rs | wc -l` -> **0**. **The honest limit, stated rather than smoothed:** the tree-wide version of this row's own census still reads `grep -rniE 'react|\.tsx|\.css|component to render' crates modules platform --include='*.rs' | wc -l` -> **46** in **14** files, down from the **48** in **16** the triage measured at `af4b27238`, so the leaks *this row enumerates* are closed and the pattern still matches elsewhere; nothing in `crates/`, `modules/` or `platform/` is now gated against regaining one, because the rule that would catch it is 1C (`:93`), refused at `:103`-`:106`. **Waits for nothing; graded on the enumerated bullets only.**
- [ ] **1C (last) — rule `ui-framework-vocabulary`.** Fail when `crates/`, `modules/` or
      `platform/` name a UI framework, a UI file or a UI concept (`React`, `.tsx`, `.css`,
      "component to render"). Repo-wide, comments-only hits, highest false-positive risk —
      exactly the rule that should not be imposed on a busy shared tree. Two known false
      positives to exclude when it lands: `crates/oz-bridge/src/settings_tests.rs:773` lists
      `.css`/`.ts`/`.tsx` as file extensions in a fixture, and `oz-bridge/src/lib.rs:5` +
      `ctx.rs:8` name `tauri, gtk, webkit` in the sentences that assert this very rule. Note the
      script's `mask_comments_and_strings` helper *strips* comments — this rule needs the
      opposite.
      - **NOT TICKED, 2026-09-15 ~12:25 at tip `b3dee11f8`, and it is the easiest row in this file to tick wrongly: `python scripts/verify-architecture-boundaries.py --strict` -> exit `0` with `8` `[tracked]` baseline lines.** What that green PROVES is that the boundaries gate runs and the baseline sits at 8 rows. What it LEAVES OPEN is this row itself: `grep -c ui-framework-vocabulary scripts/verify-architecture-boundaries.py` -> **0** (exit 1), so the rule named in the title is not in the `RULES` dict at all, and a gate exiting 0 is not evidence that it exists. Box stays open -- do not tick it off against someone else's green.**
      - **DISPOSITION 2026-09-15 ~12:55 at tip `7edfd2280`. This row stays OPEN: it is a claim about a gate that was never written, not work that was declined. Recommendation -- do NOT add `ui-framework-vocabulary` as titled.** The census words were re-run THROUGH THE MASK, not through a raw grep: importing `mask_comments_and_strings` from `scripts/verify-architecture-boundaries.py:233` ("Mask comments and string contents while preserving offsets and lines.", applied at `:361` and `:469`) and counting before/after over every `.rs` under `crates`, `modules` and `platform` gives `document\.` **raw 27 -> 0 surviving**, `window\.` **raw 65 -> 24 surviving in 5 files**, and `react|.tsx|.css|component to render` **raw 49 -> 13 surviving in 4 files** (those 13 were not graded one by one, so they are claimed neither true nor false here).
      - **The two populations are disjoint, and that is the whole finding.** Every surviving `window.` hit is a **field access on a domain struct named `window`** -- `window.effective_from`, `write.window.effective_to`, `window.validate()` in `crates/oz-api/src/pg.rs`, `crates/oz-core/src/db/tax/scopes.rs`, `crates/oz-bridge/src/tax_tests.rs`, `crates/oz-core/src/db/tax_tests.rs` -- tax-validity code, not UI code: 24 matches, **0** of them in the sense the title means. Conversely the only genuine UI vocabulary in the scanned trees is JavaScript embedded in Rust strings -- 22 of the 27 `document.` hits are `document.getElementById(...)` inside `crates/qris-core/examples/web_inspector.rs`, a **foreign UNTRACKED** crate (`git ls-files crates/qris-core | wc -l` = 0; `git status --porcelain -- crates/qris-core` = `??`) -- and the mask removes exactly that text, so `document.` survives at **0**. **A gate keyed on these words fires on 24 non-UI field names and is blind to the one UI surface that exists.**
      - **The cost of getting this wrong lands in the baseline file, which has no line numbers to hide behind.** Reading `scripts/architecture-boundaries-baseline.json` prints **8** entries keyed `rule` + `path` + `target` + `reason` + `owner` + `introduced` + `expires` -- **no line field** -- so 24 false hits would seed one dated 3-month row per file/target, each re-rolled whenever its `reason` prose is edited, each expiring into a stranger's red gate in November. **If anything is ever keyed here, key it on a path-reference shape instead**: a `ui/...` token ending `.tsx`/`.css`/`.ts` inside Rust text -- **43 sites** by `grep -rnoE 'ui/[A-Za-z0-9_./-]+\.(tsx|css|ts)' crates modules platform --include=*.rs | wc -l` -- a small real population, but it lives in the masked-out copy, so wiring it means deliberately scanning the text this checker exists to discard. That trade-off is not this row's to take and no file was edited to measure it.
      - **Why the box is still open at ~12:55:** ticking it would record "not done" as a decision, and `grep -c ui-framework-vocabulary scripts/verify-architecture-boundaries.py` -> `0` (exit 1) says the rule was never written. Close it by deleting the row, or by filing the path-shape question above as its own ADR -- not by quoting a gate exit that grades a different rule.**
- [x] **Do 1C after 1B, and the baseline is empty.** Landing the fixes first means the rule can
      ship with no baseline rows at all — no 3-month expiry clock (existing entries run
      ~3 months), nothing to expire into someone else's red gate in November. That is the whole
      argument for this order.
      - **TICKED 2026-09-15 ~12:25, at tip `b3dee11f8`, on this pass's own re-run: `python -c "import json;print(len(json.load(open('scripts/architecture-boundaries-baseline.json'))['entries']))"` -> `8`, exit `0`.** The row's claim is that the count stays 8 because 1B landed first, and it is 8. **What this does NOT prove:** that 1C itself shipped -- the rule at `:92` is still open and `grep -c ui-framework-vocabulary scripts/verify-architecture-boundaries.py` -> `0` (exit 1), so this row grades the ORDER, not the landing.**
- [ ] Keep the precedent: `crates/oz-core/src/ozpkg.rs:154` moved the ozpkg password rule out
      of a React component into the choke point every caller passes. That is the pattern —
      a rule that only a UI enforces is a rule the next UI must re-implement.
      - **NOT TICKED, 2026-09-15 ~12:50 at tip `f26f66ce8`: 'keep the precedent' has no acceptance command, and the precedent's file is another session's.** The precedent is still real -- `crates/oz-core/src/ozpkg.rs` carries the `if password.trim().is_empty()` guard inside the choke point, with its comment 'A crypto-critical precondition belongs at the choke point every caller must pass through, not in one screen's validation' -- but that file reads ` M` in this checkout, so any line number quoted from it tonight is a working-tree reading of foreign work, not a claim about a tip. **Waits for:** ruling R10 on `docs/plans/notes.md` item 25. A precedent is kept by a gate, and no gate here asks *where* a rule is enforced.

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
      - **NOT TICKED, all five Item-2 rows (`:120`, `:121`, `:125`, `:126`, `:128`), 2026-09-15 ~12:50 at tip `f26f66ce8`.** These are owner rulings, already moved to `docs/plans/notes.md` item 25 (R1 device class and OS target, R3 Slint licence terms, and the rows that answer to them), and there is no artefact for a command to grade: `find . -name '*.slint' -not -path './node_modules/*' | wc -l` -> **0**. **Waits for:** the R1 and R3 sign-offs -- an owner decision, not a build and not a tick.

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
      - **NOT TICKED, these three (`:139`, `:141`, `:146`), 2026-09-15 ~12:50 at tip `f26f66ce8`.** `:139` is owned elsewhere -- the triage's kind 4 points it at `todo-open-debt-program.md` Phase 2 -- and `crates/oz-bridge/src/data.rs` and `pos.rs` are both ` M`, so no lane may enter the bridge tonight. `:141` cannot be closed before a ruling *and* a script: `test -f scripts/verify-dto-parity.py` -> **absent**, and writing it is outside this file's fence (the file's own kind-4 note calls it WO1, an unapproved work order on the owner page). `:146` is a decision that measurement cannot settle either way: `grep -c specta Cargo.toml` -> `0` and `grep -c specta ui/package.json` -> `0`, exit `1` -- the absence of codegen is not a verdict against it. **Waits for:** the ledger ruling in flight (`:139`), the R-filing for the DTO-parity comparison (`:141`), and the specta/ts-rs decision (`:146`) on `docs/plans/notes.md` item 25.
- [ ] Type-safe the offline boundary: `OfflineQueueItemDto.payload` is a **JSON string**,
      so type safety is lost exactly where it matters most. Give the payload a tagged union
      and deserialise at the edge.
      - **NOT TICKED, 2026-09-15 ~12:50 at tip `f26f66ce8`: the row is still true of the tree and the fix is a Rust change.** `grep -n 'pub payload' crates/oz-bridge/src/offline.rs` -> `40`, `88`, `134`, all `pub payload: String`, so the untyped boundary has not moved (that file is clean here; `git status --porcelain -- crates/oz-bridge/src/offline.rs` printed nothing -- the dirt is in its neighbours `data.rs` and `pos.rs`). **Waits for:** a Rust lane with a build budget, opened after the partial in `crates/oz-bridge/src/**` lands -- a tagged union across three DTOs is not a docs edit.

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
      - **NOT TICKED, the three open Item-4 rows (`:181`, `:183`, `:185`), 2026-09-15 ~12:50 at tip `f26f66ce8`: no subject, so any gate over them would be an empty set.** `grep -c fluent-bundle crates/*/Cargo.toml Cargo.toml` -> **0** hits, and `find . -name '*.slint' -not -path './node_modules/*' | wc -l` -> **0**. A prototype needs a second renderer to prototype, and a `.slint`-aware parity extension has no population to scan -- that is the vacuous green AGENTS.md's CSS section documents. **Waits for:** ruling R6 on `docs/plans/notes.md` item 25 (`.ftl` as the single content set), then R1 for the device class.
- [x] Keep the two-sided FTL rule: a key you add must be referenced, and a reference you delete
      must not strand a key.
      - **TICKED 2026-09-15 ~12:50 at tip `f26f66ce8`, on the disagreement test rather than on presence.** The checker proves itself: `python scripts/verify-ftl-orphans.py --self-test` -> exit `0` printing `self-test: OK (6 directions exercised, 75 one-sided keys detected)` -- the `75` is its own detection working, not a baseline restated. Both sides of the rule sit in the commit path: `grep -n 'verify-bundle-parity\|verify-ftl-orphans' .githooks/pre-commit` -> `verify-bundle-parity.py --staged-only` at `:130` (a reference naming a key no bundle defines) and `verify-ftl-orphans.py --staged-only` at `:257` (a key added without a reference, or stranded by a deleted one); `grep -c ftl .githooks/pre-commit` -> `11`; and the hook *runs* here -- `git config --get core.hooksPath` -> `.githooks`. The file itself states the two sides at its `:1` docstring ('Gate Fluent keys that nothing references -- the direction nobody checks') and its numbered pair. **What this does NOT prove:** CI enforcement of the orphan half. CI has no index to diff, so it runs `--self-test` blocking and `--census` informational; the whole-tree orphan debt is untouched by this tick, and this row asks only that the two-sided commit rule be kept -- which it is, by two named call sites that can and do disagree.

## Item 5 — Offline model: outbox-reconcile, not optimistic-rollback

The previous draft's "optimistic insert, roll back on error" is the wrong failure model.
The repo has a **durable outbox** (`ui/src/api/offline.ts`, ADR #6): an action is enqueued
and retried; an `invoke` failure does not mean the enqueue failed, so rolling back hides a
sale that is about to be pushed successfully.

- [ ] Rewrite the pattern as: optimistic mark → enqueue → reconcile against the sync result
      (`syncedCount` / `failedCount` / `conflictCount`). <!-- 2026-09-15 ~12:25, tip b3dee11f8: NOT TICKED. `ls ui/src/__tests__ | grep -i offline | wc -l` -> 10 files, which proves a graded HOME exists for this pattern, not that the pattern was rewritten. Existence of a home is not the work. Box stays open. -->
- [ ] Never roll back a durable queue item; surface `failedCount` and let the user retry.
      - **NOT TICKED, 2026-09-15 ~12:25 at tip `b3dee11f8`.** `grep -oE "syncedCount|failedCount|conflictCount" ui/src/api/offline.ts | sort | uniq -c` -> **syncedCount 3 / failedCount 3 / conflictCount 1**. This file's own triage recorded the trio as **3 / 3 / 3**; the denominator has since **drifted to 3 / 3 / 1**, and it is reported here rather than either number being restated as truth. **What the print proves:** the three tallies are named in `ui/src/api/offline.ts`. **What it leaves open:** that no durable item is ever rolled back -- a name in a source file is not a behaviour, and nothing pins the never-rollback rule. Box stays open.**
- [x] Add a **client-side idempotency key** at enqueue time so a retry cannot double-apply.
      - **ALREADY PAID one layer below — dispositioned 2026-09-15 ~15:04 at tip `7d627d2e9`.** The box text was wrong; the requirement is not open. **There is no enqueue boundary in `ui/src/api/offline.ts` to key:** `grep -cE '^export const' ui/src/api/offline.ts` → **20** exported functions (`export function`: 0), and `grep -ciE 'enqueue' ui/src/api/offline.ts` → **1** — that single hit is `export interface EnqueueOfflineArgs` at `:28`, which `grep -rn EnqueueOfflineArgs ui/src` also returns **1** for, itself. Nothing writes that type, so a TS-side "key at enqueue" would have keyed a declaration no call path reaches; the nearest thing to a drain, `retryOfflineSyncScoped` at `:81`, hands the whole queue to Rust and takes back three counts. **The idempotency key exists, four layers down, and these four pointers were re-read this pass** (both line numbers handed over had already drifted — `offline.rs` was edited today — so these are the live ones):
          - **Minted exactly once, on construction:** `crates/oz-core/src/offline.rs:129` — `id: uuid::Uuid::now_v7().to_string()` — sits in `OfflineQueueItem::new`, and `with_tenant` at `:143` (with `with_priority` below it) delegate to `Self::new`, so every construction path mints one id and none re-mints. Uuid v7: time-ordered as well as unique.
          - **INSERTed, not held in memory:** `crates/oz-core/src/db/offline.rs:231` `enqueue_offline_inner` builds the item at `:242` and writes it at `:245` — `INSERT INTO offline_queue (id, action, payload, status, retry_count, last_error, created_at, synced_at, tenant_id, priority)` — tenant+priority variant at `:293`. The key is the row's identity, so it survives a restart: this is the durable outbox ADR #6 claims.
          - **Carried unchanged through every retry:** `crates/oz-core/src/sync_client.rs:384` — `let pending = store.list_pending_offline()?;` inside `sync_pending` — reads those rows back. Nothing re-mints between attempt 1 and attempt n, which is exactly the property the box was asking for.
          - **And the receiving side already keeps the matching ledger:** `sync_applied_items`, guarded at `crates/oz-core/src/db/offline.rs:687` (`SELECT EXISTS(SELECT 1 FROM sync_applied_items WHERE item_id = ?1)`) and written `INSERT OR IGNORE INTO sync_applied_items (item_id, action)` at `:700`, again at `:851` on the batch path — in-tx, co-located with the domain mutation, keyed by the same item id.
      - **THE RESIDUAL — a different requirement, recorded as one, not ticked away:** no per-item identity ever crosses **back** to the client. A bulk retry returns `syncedCount / failedCount / totalCount` (`ui/src/api/offline.ts:44`-`:53`; the command is `-> Result<SyncResult, AppError>` at `apps/tablet-client/src/commands/offline.rs:465`), so when one operation of twenty fails the UI can report *that* one failed and nothing about *which* — and cannot reconcile a single failed operation, because it never learns an id. Identity is not the missing piece (`OfflineQueueItemDto.id`, `ui/src/api/offline.ts:8`-`:9`, is already listable); **outcome granularity is.** Anyone promoting that to work should write it as its own box with its own fence: double-apply is closed by the code above, per-item reporting is open and un-boxed.
      - **What it cost to answer this honestly, recorded because it is the transferable part.** A green was on offer and cheap: mint a uuid in TS, thread it through the call, assert it against the `loggedInvoke` mock, tick. Three-line diff, tests the mock rather than the wire — and it would have created a **second** id per operation, since `offline.rs:129` already mints the one that is INSERTed and deduped. So the manufactured version is not merely weak, it is actively wrong on the tree. The lane reported the dead interface and the four pointers instead, which means this `[x]` rests on code nobody wrote for this box — hence a mechanism above rather than a diff of its own.
- [ ] Use the priority tiers that already exist: `critical` | `normal` | `low`.
- [x] Use real event names. The measured emit set is `kds:orders-changed`,
      `receipt:printed`, `barcode:scanned`, `barcode:error`, `settings_updated`. There is no
      `db-crdt-sync-complete` / `db-sync-started`; sync status comes from
      `useSyncConnection` and the queue-summary commands.
      - **TICKED 2026-09-15 ~12:50 at tip `f26f66ce8`, because the census closes and the claim is falsifiable in both directions.** Per-name counts (`grep -rn --include='*.ts' --include='*.tsx' --include='*.rs' <name> ui/src crates apps modules platform | wc -l`): `kds:orders-changed` **42**, `receipt:printed` **9**, `barcode:scanned` **10**, `barcode:error` **10**, `settings_updated` **52** -- five named events, five real call sites. The two invented names are absent: the same command for `db-crdt-sync-complete` -> **0** and `db-sync-started` -> **0**. And the list is **complete**, which is the half that could have been wrong: the emit harvest `grep -rhoE 'emit\("[^"]+"' crates modules platform apps ui/src --include='*.rs' --include='*.ts' --include='*.tsx' | sed 's/emit("//;s/"//' | sort -u` returns exactly five distinct strings -- `barcode:error`, `barcode:scanned`, `kds:orders-changed`, `receipt:printed`, `settings_updated` -- with no sixth, and `grep -rnE 'emit\(&?(format!|format)' crates modules platform apps --include='*.rs' | wc -l` -> **0**, so no dynamically composed name hides outside the harvest. `useSyncConnection` resolves in **15** files under `ui/src`, as the row says sync status comes from. **What this does NOT prove:** that sync status is *only* read there -- the row's second clause is a design claim about which command supplies status, and this census graded the event-name half, which is the half that was wrong in the earlier draft.
- [x] Do **not** add a global state library. State today is 11 Contexts under <!-- 2026-09-15 ~12:25, tip `b3dee11f8`: the figure was 12 as written and the tree prints 11 (`ls ui/src/contexts/*.tsx | wc -l` = 11, re-run this pass). Sentence kept, number repaired. -->
      `ui/src/contexts/` plus ~36 hooks; `zustand` appears nowhere. Adding one is an ADR.
      - **TICKED on this pass's own re-run at tip `b3dee11f8`: `grep -c zustand ui/package.json` -> `0` with exit `1`** -- a no-match exit, so "appears nowhere" is literally what the tree says; and the contexts census moved this row's own figure from 12 to 11 (`ls ui/src/contexts/*.tsx | wc -l`). **What this does NOT prove:** that nobody adds one tomorrow. The row's force is a prohibition, and a prohibition has no gate here; "Adding one is an ADR" stays unenforced by anything in this repo.**

## Item 6 — List rendering and perf: adopt what exists

Both the previous §3 and most of §4 are already decided, differently.

- [x] Bounded pagination is the cross-feature contract: `LIST_PAGE_SIZE = 50`,
      `ui/src/utils/list-policy.ts` (PERF-07). Use `usePagedList`; do not hand-roll slices.
      - **TICKED 2026-09-15 ~12:25 at tip `b3dee11f8`, re-run: `grep -n LIST_PAGE_SIZE ui/src/utils/list-policy.ts` -> `:20 export const LIST_PAGE_SIZE = 50` and `:30 export function paginate<T>(items: T[], page: number, pageSize: number = LIST_PAGE_SIZE)`** -- the value and its default are both there as written. **What this does NOT prove:** that every data screen goes through `usePagedList`; a hand-rolled slice anywhere still passes, because nothing greps for one.**
- [x] Virtualization only where interaction semantics allow it, and only with
      **`react-window`** (already a dependency, used by `ProductLookupScreen` and
      `RetailProductGrid`). `@tanstack/react-virtual` is not a dependency — do not add a
      second virtualization library.
      - **TICKED 2026-09-15 ~12:25 at tip `b3dee11f8`, re-run: `grep -c react-window ui/package.json` -> `2`; `grep -c tanstack ui/package.json` -> `0` (exit 1).** One virtualizer, as required. **What this does NOT prove:** the "only where interaction semantics allow it" half -- a judgement no dependency count can grade, and the same judgement `:212` leaves unowned.**
- [ ] Dense grids with sort headers, sticky rows or variable heights stay on paging.
- [x] Drop "disable StrictMode in production": its double-invoke is development-only, so a
      production build does not double-render either way. `ui/src/main.tsx` needs no change.
      - **TICKED 2026-09-15 ~12:50 at tip `f26f66ce8`, on two greps each of which could have come back the other way.** `grep -nE 'StrictMode|import.meta.env|MODE' ui/src/main.tsx` -> only `14:  <React.StrictMode>` and `16:  </React.StrictMode>,`, so the wrapper is unconditional -- there is no environment branch to delete, which is what 'needs no change' asserts, and a conditional would have failed this row. And the claim is dead in the docs: `grep -rniE 'disable .*StrictMode|StrictMode.*production' --include='*.md' docs ui README.md AGENTS.md` -> **1** hit, `docs/records/2026-09-15-frontend-architecture-todo-appraisal.md:110`, which is the appraisal's own refutation ('wrong premise ... Drop the item'), not an instruction to do it. The recommendation has been dropped where it was written; nothing left standing tells anyone to disable StrictMode. `ui/src/main.tsx` is clean at this tip (` M` list does not name it), so the file was not edited -- none of the files read for this tick were.
- [ ] Correct the IPC note: Tauri v2 serializes command args as JSON both ways. Pass raw
      objects (a manual `JSON.stringify` double-encodes), but the real levers are route-level
      code splitting (PERF-01), bounded pages (PERF-07) and `loggedInvoke` telemetry.
- [ ] Hard rules for any new UI code: strings come from Fluent (`scripts/lint-i18n.sh`),
      colours come from theme tokens (`ui/src/frontend/themes/tokens.css`) — never literals.
      - **NOT TICKED, `:223`, `:226` and this row `:229`, 2026-09-15 ~12:50 at tip `f26f66ce8`.** `:223` (dense grids stay on paging) is a design preference with no measurable predicate -- no script grades 'sort headers, sticky rows or variable heights'. `:226` (correct the IPC note) is a prose claim whose only live restatement is the appraisal's own refutation at `docs/records/2026-09-15-frontend-architecture-todo-appraisal.md:114`, and `grep -c 'binary serial' todo-review-type.md` -> **0** with exit `1` (the one line in this file matching the looser pattern `'binary'` is the disposition quoting that measurement, so the looser grep is self-referential and is not the claim); nothing left standing in this file carries the false note, so the row is spent, not done. This row is a duplicate per the triage's kind 4 (`todo-font-system.md`, `todo-payment.md`, `todo-open-debt-program.md` carry it), and its enforcement is one-sided and measured: strings are gated by `scripts/lint-i18n.sh`, colours are not gated by any linter at all -- `grep -cE 'stylelint|postcss|prettier' ui/package.json` -> **0** (exit `1`) and `grep -ci css ui/eslint.config.js` -> **0**, so the colour half rests on the five Vitest sheet-walkers, which read the working tree through `fs`. **Waits for:** the owning plan's decision for `:229`; for `:226` a ruling that the row be deleted as spent; `:223` is a judgement row and should be retired to an ADR rather than ticked.

## Item 7 — Year 4–5: renderer swap stays cheap

The acceptance test for "the UI is replaceable" is a checklist, not a feeling. All of these
should be true continuously, not at swap time:

- [ ] No UI-framework vocabulary below `crates/oz-bridge` (Item 1's gate is green).
      - **DISPOSITION 2026-09-15 ~13:05 at tip `18950285e` · RULING, from the owner: this row is RETIRED AS UNBUILDABLE, and it is NOT ticked.** The load-bearing fact, inked here because no other lane will rediscover it: **`--strict` exits 0 on this tree while the row it is cited as satisfying names a rule that occurs 0 times in the checker -- a passing gate and an absent rule are indistinguishable to a reader who only runs the command.** Measured twice at this tip: `grep -c ui-framework-vocabulary scripts/verify-architecture-boundaries.py` -> `0` with exit **1**, while `python scripts/verify-architecture-boundaries.py --strict` -> exit **0** printing `8` `[tracked]` baseline lines. That green belongs to five other rules (`module-to-module`, `core-upward-dependency`, `platform-to-business`, `ui-direct-invoke`, `bridge-toolkit-purity`, at `scripts/verify-architecture-boundaries.py:38`-`:42`) and to none of this row.
      - **Half 1, the vocabulary census -- RETIRED, do not build.** Re-run through the checker's own `mask_comments_and_strings` (imported from `scripts/verify-architecture-boundaries.py`, applied there at `:361` and `:469`) over all **882** `.rs` files under `crates`, `modules` and `platform`: the row's words `react|.tsx|.css|component to render` read **raw 49 in 14 files -> 13 surviving in 4 files**, and those 13 are one thing -- `reactivate` / `Reactivate` / `reactivates`, in `crates/oz-core/tests/{gift_card,inventory,staff,terminal}_integration.rs`, a loyalty-and-card verb whose spelling happens to contain `react`. **Zero UI-vocabulary positives survive the mask, and every hit a substring rule would catch instead is a domain verb misfiring.** A rule keyed on these words grades text the checker has already thrown away, which is worse than no checker at all: its green would mean nothing. The ruling cites **61 of 62 candidate hits as comments**, measured at tip `7edfd2280` -- `git log --format='%h %s' -1 7edfd2280` -> `7edfd2280 docs(plans): tick the four review-queue rows that grade green as written and leave three tempting ones open`, kept here as the dated SHA that killed the row; this pass's own re-run reads 49 -> 13 with all 13 survivors `reactivate*`. Both readings agree on the only thing that decides the build: the gradable population is empty. Word-boundary hits exist (`grep -rnoiwE 'React|tsx|css' crates modules platform --include='*.rs' | wc -l` -> **16**), but the genuine ones are fixture and string text the same mask discards (`crates/oz-bridge/src/settings_tests.rs:773`, already named at this row's `:96`-`:99`), so a boundary-keyed variant re-buys an empty rule plus a fresh exemption list to argue about.
      - **Half 2, the real finding -- recorded as a NEW PROPOSAL, not as a rule, and not approved by this disposition.** What actually lives in this population is not vocabulary but **DEAD PATH REFERENCE**: a literal `ui/...tsx|ts|css` path cited inside Rust that no longer resolves at HEAD. Population measured at this tip with the same import-and-mask harness: **43 sites / 21 distinct paths, of which 2 sites resolve to nothing** -- `ui/src/features/stores/topologyCard.ts`, cited at `crates/oz-core/src/topology.rs:194` and `:203`. Dead at the revision, not merely on disk: `git cat-file -e HEAD:ui/src/features/stores/topologyCard.ts` -> `fatal: path ... does not exist in 'HEAD'`, `git ls-tree -r --name-only HEAD | grep -c '^ui/src/features/stores/'` -> **0**, and the live file is `ui/src/features/locations/topologyCard.ts`. **That is the shape this row should always have had: it fires on a moved file (2 named sites) and stays quiet on every comment that merely names React (41 of the 43 resolve, and all 13 mask survivors are `reactivate`) -- falsifiable in both directions, which is exactly what the census was not.**
      - **Its doctrine parent, so nobody calls it novel:** `.agents/skills/docs-auditor/scripts/check-dead-refs.py` already refuses unresolved references -- in markdown -- and it is the one checker here whose every finding a reader can disprove by opening the path (`is_historical_doc()` at its `:193`, exemption applied at `:213`). The successor is that same doctrine pointed at path tokens inside Rust source.
      - **The honest cost, so it is not discovered as a surprise:** writing it means (a) a new `RULES` entry in `scripts/verify-architecture-boundaries.py`, (b) a row for it in `scripts/gates.json`, (c) a baseline seeded with the 2 known-dead sites, each carrying an `introduced`/`expires` pair, because this gate is `--strict` in `dev-ci.yml#static-gates` and one false positive is red for every lane, and (d) a deliberate decision to scan the UNMASKED text -- every one of these citations sits in a comment, so the successor must read the copy this checker exists to discard. The opposite of half 1, and the reason it is not free. **That is code, and this disposition approves none of it.** Nothing outside this file was touched to measure any of it: `git status --porcelain -- scripts/verify-architecture-boundaries.py scripts/gates.json scripts/architecture-boundaries-baseline.json` printed no path, and `grep -c 'dead-path' scripts/verify-architecture-boundaries.py` -> `0` with exit `1` -- no successor name exists in the checker today, so no line here may be read as a shipped gate.
      - **What the box waits for now:** retirement is a verdict on the rule, not a completion of the invariant. Close it by (i) deleting the row from Item 7's checklist, or (ii) approving and landing the dead-path-reference successor; the sibling question of whether the Item-7 invariants become a graded contract at all is still open as R10 on `docs/plans/notes.md` item 25. Until then the box stays `- [ ]` -- ticking it would credit a green gate to an absent rule, which is the exact defect this row is retired for.
- [ ] DTOs describe *data*, never presentation — no HTML, no colour, no layout, no route names.
- [ ] Every business rule is enforced at a choke point every caller passes, not in a screen
      (the `ozpkg.rs:154` precedent).
- [ ] Events cross the seam through `EventSink`, so a new renderer subscribes rather than
      re-implements publishing.
- [ ] A new shell needs: a `BridgeCtx`, a registration of the commands it exposes, and a
      locale reader. Nothing else. If it needs more, that is the finding.
      - **NOT TICKED, all five Item-7 rows (`:237`, `:238`, `:239`, `:241`, `:243`), 2026-09-15 ~12:50 at tip `f26f66ce8`, and `:237` carries the finding that decides its own case.** `:237` reads 'No UI-framework vocabulary below `crates/oz-bridge` (Item 1's gate is green)' -- the parenthetical grades something else entirely: `grep -c ui-framework-vocabulary scripts/verify-architecture-boundaries.py` -> **0** with exit **1**, while `python scripts/verify-architecture-boundaries.py --strict` -> exit `0`. The green is the *other four* rules (`module-to-module`, `core-upward-dependency`, `platform-to-business`, `ui-direct-invoke`) plus `bridge-toolkit-purity` -- no vocabulary rule exists to be green, so ticking `:237` on that exit code is exactly the third wrong-tick mode this file already documents at `:102` and `:285`. `:241` is the same shape one layer down: `grep -rl 'EventSink' scripts/ | wc -l` -> **0**, so no script grades the seam, and the emitter is `Option<Arc<dyn EventSink>>` (`crates/oz-bridge/src/ctx.rs:84`) where `crates/oz-bridge/src/hardware.rs:13` states 'A `None` sink is a silent no-op' and `crates/oz-bridge/src/testing.rs:381` builds one -- an invariant that cannot fail its own check cannot be ticked as held. `:238` ('DTOs describe data, never presentation') and `:239` ('every business rule at a choke point') have no predicate at all, and `:243` needs a second shell to price, of which the tree has **0** (`.slint` count above). **Waits for:** ruling R10 on `docs/plans/notes.md` item 25, which asks whether these four become a graded contract.

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

## Acceptance — the command this queue does not have (2026-09-15, read-only audit at HEAD `2a47052ba1`)

- **A briefing tonight described this file as "25 open boxes and ZERO mentions of any command, exit code, or gate". Measured here, that is not this file, and the difference matters to anyone sizing the item off the shorthand.** `wc -l < todo-review-type.md` → **250**; open boxes `grep -cE '^[[:space:]]*[-*][[:space:]]+\[[[:space:]]\]' todo-review-type.md` → **36**, ticked → **0**; command-and-gate mentions `grep -ciE 'npm run|npx |vitest|cargo |python |exit 0|check:all|verify-' todo-review-type.md` → **13**; and `## Definition of done` at `:236` already lists six run-before-finishing commands under "Per item, before it is finished — run, do not assume". The zero-mention file the same sweep named second, `todo-payment-agents-4.md`, is 175 lines with 0 boxes and 0 mentions — the shape the shorthand describes. Re-derive the whole set at the root: `for f in *todo-*.md; do printf '%s lines=%s open=%s ticked=%s cmd=%s\n' "$f" "$(wc -l < "$f")" "$(grep -cE '^[[:space:]]*[-*][[:space:]]+\[[[:space:]]\]' "$f")" "$(grep -cE '^[[:space:]]*[-*][[:space:]]+\[[xX]\]' "$f")" "$(grep -ciE 'npm run|npx |vitest|cargo |python |exit 0|check:all|verify-' "$f")"; done` — twenty plans, and none of them is 25-open-and-command-less.
- **Verdict: NOT OBSERVABLE as one command, measured rather than asserted.** The three cheap gates the DoD names are **green today on an untouched queue where all 36 boxes are open**: `python scripts/verify-ipc-parity.py` → `IPC parity: OK`, exit **0** · `python scripts/verify-invoke-parity.py` → `verify-invoke-parity: 0 violation(s).`, exit **0** · `python scripts/verify-bundle-parity.py --report-only` → `verify-bundle-parity: 0 missing key(s).`, exit **0**. A command that passes while every row is open cannot be the queue's verdict, so none is written here — an acceptance gate already green on an untouched queue measures nothing, and staging one would be exactly the declaring-victory move this section exists to prevent. What those three exits do mean is the thing the DoD already says: they grade an item's own surface as it is worked, item by item, and they are re-runnable by a stranger from the line above.
- **What is not a tool yet, and what moved under this file's own sentence.** `test -f scripts/verify-dto-parity.py` → **absent** (Item 3b's own row, and `:135` states "**There is no such gate today**"). `scripts/verify-architecture-boundaries.py` → **exists**, and Item 1's premise has already shifted beneath it: `grep -rl 'oz-bridge' scripts/ | wc -l` → **3**, where `:58`-`:59` reads "no script under `scripts/` mentions `oz-bridge`, and `scripts/gates.json` has no bridge entry" — the second half still holds (`grep -c bridge scripts/gates.json` → **0**). The sentence at `:58` is left as written because it is the reading it was measured against; this line is the dated correction, not an edit of it.
- **Consequence, in the same breath as the verdict.** Under AGENTS.md §4 a `done-` prefix is earned only when *the file's own* acceptance command was run and passed, and no such command can honestly cover `:226` "DTOs describe *data*, never presentation", `:227` "every business rule is enforced at a choke point every caller passes" or the Item 7 checklist at `:225`–`:232` — those are judgement rows with no exit code, so **this queue can never be accepted as one object**; its prefix is reachable only by declaring victory. The action that follows is therefore not a run and not a tick: rows that can carry a command — Item 1's boundary extension plus its `gates.json` row, Item 3b's DTO parity script, Item 6's deletions — should be split out as sized plans whose acceptance is that command, and rows that cannot should be retired to an ADR or a dated verdict. Nothing is ticked by this section, nothing is renamed, no ruling is taken, and no line above it is deleted.
  - **Dated addendum, this file's own rule applied to a run that did not exist when the four bullets above were written — 2026-09-15 ~16:05 at tip `1dafb894c`, zero dirty paths under `apps/tablet-client`, so it is a commit fact and not a working-tree reading:** `python scripts/verify-ipc-parity.py` → **exit 0**, printing `IPC parity: OK` with the populations unmoved at **458 UI command strings / 453 registered desktop / 322 registered tablet**; `cargo test -p oz-pos-tablet` with no filter → **exit 0**, `test result: ok. 660 passed; 0 failed; 0 ignored` — an ops pass read it warm at 84.12 s and this lane re-ran it at the same tip for the same 660 in 79.05 s; and `RUSTFLAGS='-D warnings' cargo check -p oz-pos-tablet --all-targets` → exit 0, where the figure that makes that mean anything is the **78.4 s cold re-run under `CARGO_INCREMENTAL=0`**, because a `-D warnings` pass that answers in well under a second is a cache hit on a stale fingerprint, so the cold number is the one graded. **None of the three is an acceptance for any box on this page, and none is claimed as one:** 660 green plus a parity figure that did not move is evidence that the tablet re-export work broke nothing — not a gate over this queue's 26 open rows — and **no `[x]` moved in this file on account of it**, which is the same sentence the four bullets above already reach for and the reason they stay standing.

## Triage of the 36 open boxes into four kinds (2026-09-15, read-only pass at tip `af4b27238` — nothing above edited, nothing ticked, no row moved)

**The counts and the sum they close on.** Open boxes → **36** (`grep -cE '^[[:space:]]*[-*][[:space:]]+\[[[:space:]]\]' todo-review-type.md`), ticked → **0**, `wc -l < todo-review-type.md` → **257**. The four kinds are **10 command-carrying + 17 decision-required + 7 obsolete + 2 duplicates-of-other-live-plans = 36**; every box is named by the line it sits on, the four sets are disjoint, and their union is exactly the 36 lines that grep lists. Twenty-two commands were attempted for these verdicts and **seven returned no such file, no such population, or a figure that contradicts the row it was meant to grade** — `scripts/verify-dto-parity.py` absent; `.slint` files = 0; `specta` = 0; `idempoten` in `ui/src/api/offline.ts` = 0; contexts = 11 not 12; the vocabulary leak = 48 lines in 16 files, not 37 in 19; bridge adoption = 67 desktop / 15 tablet files, not 61 of 70. Those seven are filed below as decision-required or obsolete, and **no command was invented for any of them**.

### 1 · 10 command-carrying rows (a command exists in this checkout today and its exit grades the row)

· **`:81` (1B fix the leaks)** — `grep -rniE 'react|\.tsx|\.css|component to render' crates modules platform --include='*.rs' | wc -l` → **48**, and the same grep with `-l` → **16** files. The row’s own denominator (37 in 19) is stale; the fix drives this number toward 0 and the gate named one row down is its verdict.
· **`:91` (1C rule `ui-framework-vocabulary`)** — `python scripts/verify-architecture-boundaries.py --strict` → exit **0**, eight `[tracked]` baseline lines, nothing new; the rule’s home is the `RULES` dict at `scripts/verify-architecture-boundaries.py:37`.
· **`:100` (1C lands on an empty baseline)** — the baseline file’s `entries` list holds **8** rows today, each with `introduced`/`expires`; the row claims that number stays 8 if 1B ships first, which is a count a stranger can re-take.
· **`:140` (tagged-union offline payload)** — `grep -nE 'payload' crates/oz-bridge/src/offline.rs` → `pub payload: String` at `:40` and `:88`, so the row is still true of the tree. Its verdict command is `cd ui && npx vitest run src/__tests__/api-offline-contract.test.ts` — that file exists; **it was not run this pass, no vitest was permitted here.**
· **`:189` (optimistic → enqueue → reconcile)** and **`:191` (never roll back a durable item)** — `ls ui/src/__tests__ | grep -i offline` → 10 files including `api-offline-contract.test.ts`, `KdsOfflineRearmDeadLetters.test.ts` and `KdsOfflineReadWriteLS.test.ts`, and `grep -oE 'syncedCount|failedCount|conflictCount' ui/src/api/offline.ts` → 3/3/3, so both the reconcile shape and the dead-letter path already have a graded home. **Dated addendum 2026-09-15 ~12:55, tip `7edfd2280`, this pass's own re-run: the same command now prints syncedCount 3 / failedCount 3 / conflictCount 1 -- `grep -oE 'syncedCount|failedCount|conflictCount' ui/src/api/offline.ts | sort | uniq -c` -- so the 3/3/3 recorded above stands as the dated reading of an earlier tree and is kept, not corrected. `conflictCount` has fallen from 3 mentions to 1; nothing here says whether that is a deletion or a rename, and neither number grades a box either way.**
· **`:198` (no global state library)** — `grep -c zustand ui/package.json` → **0**; `ls ui/src/contexts/*.tsx | wc -l` → **11**, not the 12 the row states.
· **`:205` (bounded pagination is the contract)** — `grep -n LIST_PAGE_SIZE ui/src/utils/list-policy.ts` → `:20 export const LIST_PAGE_SIZE = 50`, defaulted by `paginate` at `:30`.
· **`:207` (one virtualizer only)** — `grep -c react-window ui/package.json` → **2**, `grep -c tanstack ui/package.json` → **0**.
· **`:225` (no UI vocabulary below the bridge)** — `grep -c ui-framework-vocabulary scripts/verify-architecture-boundaries.py` → **0** while the gate still exits 0, so the parenthetical “Item 1’s gate is green” grades a rule that does not check vocabulary. Command-carrying, premise false.

### 2 · 17 decision-required rows (no command exists; none invented)

Item 2 whole — **`:112`**, **`:113`**, **`:117`**, **`:118`**, **`:120`** — because `find . -name '*.slint' | wc -l` → **0**: no artefact exists for a command to grade, and `:110` says so itself. · **`:133`** `verify-dto-parity.py` — `test -f scripts/verify-dto-parity.py` → **absent**; before any command can exist someone must rule on the comparison itself (per-struct case mirroring, 127 DTOs against 336 TS interfaces), and `:137` already states there is no such gate. · **`:138`** specta/ts-rs — `grep -c specta Cargo.toml ui/package.json` → 0 and 0: no dependency, no codegen, and the row’s own verb is “Decide … or not at all”. · **`:173`**, **`:175`**, **`:177`** — `grep -c fluent-bundle crates/*/Cargo.toml Cargo.toml` → **0** hits and 0 `.slint` files, so the prototype has no subject and the parity-extension has no population: a gate over an empty set is exactly the vacuous green the CSS section of AGENTS.md documents. · **`:192`** client-side idempotency key — `grep -cE 'idempoten' ui/src/api/offline.ts` → **0**, so nothing local anchors a command; where the key lives is a ruling, and the repo’s other idempotency decisions are made in their own plans (`todo-payment.md:610`, `:695`; `todo-topology-editor.md:259`), none of which covers this item. · **`:211`** dense grids stay on paging — a semantics ruling no grep distinguishes. · **`:104`**, **`:226`**, **`:227`**, **`:229`**, **`:231`** — five judgement rows, the class the `## Acceptance` section above already named as the reason this queue cannot be accepted as one object; `:104` additionally restates `:227` inside this same file.

### 3 · 7 obsolete rows (the tree already contains, or already contradicts, the work)

**`:62`** — its premise is false now: `grep -rl 'oz-bridge' scripts/ | wc -l` → **3** (`verify-architecture-boundaries.py`, `architecture-cargo-metadata.json`, `__tests__/verify-architecture-boundaries.test.mjs`) where `:58` reads “no script under `scripts/` mentions `oz-bridge`”, and the gate is registered — `grep -n -A6 architecture-boundaries scripts/gates.json` → id `architecture-boundaries`, `status: required`, ci block `dev-ci.yml/static-gates` at `:102`-`:107`. Only `grep -c bridge scripts/gates.json` → **0** survives, which is a naming choice inside a gate that exists, not a missing entry. · **`:76` (1A)** — **already shipped**: `bridge-toolkit-purity` is a `RULES` key at `scripts/verify-architecture-boundaries.py:42` with `BRIDGE_TOOLKIT_PATTERN = re.compile(r'tauri|webkit|gtk')` at `:46`, and the gate exits 0 on it. · **`:179`** — the two-sided FTL rule is enforced today: `grep -c ftl .githooks/pre-commit` → **11** (steps 2 and 7). · **`:193`** — the tiers already exist, measured 3/3/3 above; a no-op instruction. · **`:194`** — `grep -rn 'db-crdt-sync-complete' ui/src --include='*.ts*' | wc -l` → **0**, so the events named as fictional are absent and nothing needs changing. · **`:212`** — `grep -c StrictMode ui/src/main.tsx` → **2**: the disable-in-production instruction was never applied, so there is nothing to drop. · **`:214`** — same class: a correction to this file’s own superseded draft, no code surface, no exit code.

### 4 · 2 duplicates of other live plans

**`:131`** (finish ADR #49 for the tablet client) is `todo-open-debt-program.md` **Phase 2 — Tablet ↔ desktop wire parity** at `:123`, whose fence at `:125` is `apps/tablet-client/src/**` plus shared DTOs under `crates/oz-bridge/src/**`; `todo-operational-integrity.md:212` puts the tablet wire parity out of its own scope and points there, and `todo-refactor-oz-pos-app-agents-3.md:119`-`:120` has already ticked the two tablet-adoption boxes that overlap it. Measured adoption now: `grep -rl 'oz_bridge' apps/desktop-client/src | wc -l` → **67** against **15** under `apps/tablet-client/src`. · **`:217`** (strings from Fluent, colours from tokens) is carried twice over — `lint-i18n` appears in `todo-open-debt-program.md` and `tokens.css` in both `todo-font-system.md` and `todo-payment.md`.

### What this section deliberately does not do

No row was moved out and no slice authored, so **nothing here licenses renaming this file**: the `## Acceptance` verdict above stands — three cheap gates pass on an untouched queue, therefore the queue has no single acceptance command and its prefix is unreachable without declaring victory. If the 10 command-carrying rows are ever split into sized plans, this file goes **retired with a pointer to those slices, never `done-`**, because AGENTS.md §4 earns `done-` only on the file’s own acceptance command having run and passed. No plan was created, nothing was renamed, no box was ticked, no line above this one was deleted. Every figure here is a working-tree reading taken at tip `af4b27238` on 2026-09-15 in a checkout other sessions edit continuously — the same dirt caveat this repo’s CSS section carries: a green run here is a property of this disk, not of a commit.
