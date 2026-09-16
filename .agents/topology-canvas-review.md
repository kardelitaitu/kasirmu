# Topology canvas review — Phase 7 (F6) of `todo-topology-editor.md`

**Date:** 2026-09-15 (this pass measured 07:44Z → 07:52Z).
**Written at tip `72b28d025`** — `git rev-parse --short HEAD` printed this at the moment of writing. The tip moves under this file: the same command printed `1fb8cc643` when the pass opened and `3e306f879` mid-pass, because four other lanes commit to `0.0.39` concurrently. **Every number below is a working-tree reading at a tip, not a property of any commit.**
**Author:** one docs subagent, 14-minute budget, write fence = this file.
**What this document is:** a referee record for the seven Phase-7 boxes — for each box without a gate, what would have to exist before its acceptance could fail, plus what was measured about its target. It is **not** a review of topology in general, and it contains no finding about what the canvas *does*.

## Scope limit — what this document does NOT examine

1. **No production code was read.** `NodeTopologyEditor.tsx`, `nodeTopologyEditorPointer.ts`, `nodeTopologyEditorKeyboard.ts` and `topologyContract.ts` were **counted, not read**. Nothing here asserts anything about canvas behaviour, state, or correctness.
2. **No test was run.** Zero Vitest, zero `cargo`, zero node test invocation. The run that `a5222df23` named as `:418`'s falsifiable form was **not executed**; the cost of that decision is stated in that box's section, as the plan's disposition discipline requires.
3. **Nothing outside `ui/src/**` that a Phase-7 box names** — not `apps/desktop-client/**`, not `crates/oz-bridge/**`, not `crates/oz-hal/**` (all three under live edits by other lanes), and not the backend command layer Phases 1–6 already reviewed.
4. **The plan's three `[carried]` inventory rows were not re-derived** — `~94 files / ~26,254 lines (4,225 CSS)`, `~65 files / ~33,587 lines, ~1,244 declarations`, and the `~35 files / ~15,600 lines` canvas sub-surface. The plan labels them `[carried]` from a teammate's exploration; this pass neither adopted nor refuted them.
5. **No CSS, i18n or a11y question.** `ui/src/features/locations/NodeTopologyEditor.css` was counted (3,152 lines, matching the plan) and not opened.
6. **Nothing was fixed.** This lane's commit contains exactly one path; `:421` below.
7. **No disposition was re-adjudicated or re-classified.** The five classes were assigned by `a5222df23`; this file re-measures the populations behind them and changes none.

## Coordinates, measured here because the plan's own citations do not resolve

The Phase-7 boxes are cited `:416`–`:422`. In the working tree those seven boxes sit at **447, 449, 451, 453, 455, 457, 459** of a 524-line file. The citations are to the file **as of `a5222df23^`**: `git show a5222df23^:todo-topology-editor.md | grep -n 'Review the canvas sub-surface\|Commit the review document'` → **416** and **422**. `a5222df23` inserted one disposition line under each box, and that insertion is the entire offset.

| Cited | Working tree | Box | Class per `a5222df23` |
|---|---|---|---|
| `:416` | 447 | Review canvas sub-surface for the F5 pattern | NO REFEREE |
| `:417` | 449 | Handlers for the F1 pattern | NO REFEREE |
| `:418` | 451 | Assess `NodeTopologyEditor.test.tsx` size | NO REFEREE |
| `:419` | 453 | dev-mock handlers, the third implementation | NO REFEREE |
| `:420` | 455 | Write this document | **ACTIONABLE — the only referee** |
| `:421` | 457 | Do **not** fix anything | NO REFEREE |
| `:422` | 459 | Commit the review document | ACTIONABLE, contingent on `:420` |

**Trap recorded so the next reader does not pay for it:** resolving `a5222df23^` through cmd.exe (the default shell for many scripted git calls on this platform) eats the caret and silently shows the **post**-disposition file instead of the parent. That is how this pass first "disproved" the mapping above and had to redo it under bash.

## The six boxes that cannot fail, and what was measured

### `:416` — F5 sweep of the canvas sub-surface · NO REFEREE

*What would have to exist for its acceptance to be able to fail:* a finding row per candidate assertion — file, line, the asserted expression, and the production line it restates — **plus** a floor on the walk (N files examined, printed by the walk itself). Without that, a reviewer looks, reports nothing, and no command exits non-zero. That is the class defect, and it is why the row stays open regardless of how clean the sweep is.

*Measured:* the plan's own sweep, re-derived exactly as it wrote it — `grep -rn '|| !' ui/src/__tests__/topology*.test.ts ui/src/__tests__/NodeTopologyEditor*.test.tsx | grep -cE '\|\| !'` → **1**, and the one hit is the comment at `ui/src/__tests__/topologyExport.test.ts:356` documenting the tautology `c442feecd` removed. The plan's population is still empty at this tip.

*Measured wider than the plan did (the one new sweep in this document):* the same shape over **every** `*.test.ts`/`*.test.tsx` under `ui/src` matched 6 candidate `x || !y` lines; a strict same-operand scan — `([A-Za-z_$][\w$.]*)[[:space:]]*\|\|[[:space:]]*!\1\b` — keeps 2, of which one is that same comment and the other (`ui/src/__tests__/i18nStrayAttributeSyntax.test.ts:39`, `if (!m || !m[1]) continue;`) is a null-guard on two different values. → **0 live `A || !A` assertions in the whole UI test tree**, statically. This is a grep, not a review, so it does not tick the box.

*The canvas sub-surface, sized:* `find ui/src -iname '*canvas*' -type f | wc -l` → **8** files, of which **2** are tests (`ui/src/__tests__/canvasStateEqual.test.ts`, `ui/src/__tests__/useCanvasChart.test.tsx`). The two canvas-chrome components the editor draws — `ui/src/features/locations/topologyCanvasCursorReadout.tsx` and `ui/src/features/locations/topologyCanvasZoomControls.tsx` — are named by exactly one file each: `ui/src/features/locations/NodeTopologyEditor.tsx`. **No test file names either one.** That is the concrete finding this pass produced; it is not evidence they are untested (they may be exercised through the editor's renders), and no run was done to settle it.

### `:417` — pointer / drag / keyboard / touch handlers vs the F1 pattern · NO REFEREE

*What would have to exist:* a table, one row per handler, naming **both** consumers and the file each reads. The box is a claim about two sources of truth for one scope, and an exit code cannot express it; two file paths on a line can. Absent such a table the row is not dispatchable, which is what `a5222df23` said and this pass has no reason to dispute.

*Measured (population and sizes, the plan's table row by row):* `wc -l ui/src/features/locations/nodeTopologyEditorPointer.ts ui/src/features/locations/nodeTopologyEditorKeyboard.ts ui/src/features/locations/NodeTopologyEditor.tsx ui/src/features/locations/topologyContract.ts` → **1,100 · 591 · 2,478 · 1,056**, total 5,225. Every one of those four still matches the plan at this tip — the number that rotted in Phase 7 is `:418`'s, not these.

*Measured (dirtiness):* `git status --porcelain -- ui/src/features/locations/` → **no output** at this tip, so this pass read a clean surface for those paths. Re-run it before dispatching anything; four lanes are writing code in this checkout right now, in `apps/tablet-client` and `apps/desktop-client`.

*Not examined:* the handlers were not read, so no pairing of consumers is offered here, in either direction.

### `:418` — "does its size hide skipped or vacuous assertions?" · NO REFEREE, and a rotted number

*Re-measured with the command, not the claim:* `wc -l < ui/src/__tests__/NodeTopologyEditor.test.tsx` → **12260**. The row in the plan says 12,257 (`a5222df23` already recorded that repair at this box's disposition line, including the same 12,260); this pass reproduces 12,260 exactly, so the file did **not** move between the two passes and the plan's figure is stale by 3, not growing. Declarations: `grep -cE '^[[:space:]]*(it|test)\(' ui/src/__tests__/NodeTopologyEditor.test.tsx` → **547** against the `[carried]` `~549` at the plan's structural-facts row.

*Path correction, and this pass had to eat its own dogfood to record it:* the test is `ui/src/__tests__/NodeTopologyEditor.test.tsx`. The briefing that dispatched this pass named a file reached through `ui/src/features/locations/` with a nested `__tests__` segment, and **no such directory exists** in that tree. The first draft of this sentence printed the composed path, and `python .agents/skills/docs-auditor/scripts/check-dead-refs.py` immediately flagged it — **1 unresolved reference, attributed to this file, checker exit 1** — so the sentence is now written as a shape and not as a path. That is the whole reason to be careful here: this document lives under `.agents/`, which the checker **does** scan (`todo-*` name-exemption does not apply to it), so a review doc that cites a wrong path becomes its own finding. Re-derived after this repair: this file contributes **0**.

*One real finding, static, no run needed:* `grep -nE '[.]skip\(|describe[.]skip\(|it[.]only\(' ui/src/__tests__/NodeTopologyEditor.test.tsx` → **1 hit**, `it.skip('rides the simulation pulse over the card it passes under', async () => {` at **line 6607**. No `it.todo`, no `xit`/`xdescribe`. So for the *skipped* half of the box's question the answer, measured at this tip, is **yes — one, at :6607**, and 546 other cases in the file are not skipped.

*The vacuous half is unanswered and was not attempted:* `cd ui && npx vitest run src/__tests__/NodeTopologyEditor.test.tsx --reporter=verbose` **was NOT run**. Vitest, not grep, is what reports cases with no `expect`.

*What it cost to decide that:* (i) 12,260 lines behind a cold Vitest start means a Vite transform of the whole import graph, and the budget for this lane was 14 minutes on a tree four other lanes are editing; (ii) a green from a working-tree run would be attributable to **no revision** — `ui/src/**` is live here, and `.agents/AGENTS.md` already records that exact hazard for the CSS walkers ("a walker has no channel to the revision it is being asked about"), so a run taken now would have to be re-taken by whoever reads this; (iii) the load-bearing half of the box — the hidden skip — was reachable statically and was reached. **The run is still owed; this document does not discharge it.**

### `:419` — `ui/src/dev-mock/handlers/`, the third implementation of the same contract · NO REFEREE

*What would have to exist:* a named divergence — "field X is derived by rule R in `ui/src/features/locations/topologyContract.ts` but by rule R' in `ui/src/dev-mock/handlers/topology.ts`, so a UI test can pass against the mock and fail against the shell" — plus a check that reads two implementations and compares them. A contract test is the only shape that can fail; today a reviewer can inspect all three and report nothing, and the tree is unchanged.

*Measured:* the population the plan confirmed is still there — `ls ui/src/dev-mock/handlers/ | grep -i topo` → `topology-state.ts`, `topology.ts` — sized `wc -l ui/src/dev-mock/handlers/topology.ts ui/src/dev-mock/handlers/topology-state.ts` → **211 / 86** (297 together). `git status --porcelain -- ui/src/dev-mock/handlers/` → **no output** at this tip.

*Not examined:* no comparison was performed against the contract module or the Rust command layer. **No divergence is claimed here, and none is refuted** — the plan's "plausible place for the next divergence" is left exactly as found.

### `:421` — "Do **not** fix anything found" · NO REFEREE (a prohibition)

*What would have to exist:* something that compares a commit's **file list** against an allowlist. It does exist, but only as a discipline the reader applies after the fact — `git show --stat` — and no hook in this repo can tell a pathspec commit from a bare one, which `.agents/AGENTS.md` §3 states outright. So the row cannot become a tick, and this pass adds no proposal to make it one.

*Measured about its own lane:* this file's commit lists one path, in Verification below; no write tool was pointed at any path outside `.agents/`.

### `:422` — "Commit the review document" · ACTIONABLE NOW, contingent on `:420`

*What makes it gradable:* a file list, not a subject line — `git show --stat` must print `.agents/topology-canvas-review.md` and nothing else, and print it as a **create mode**, since the file enters the repo in this commit. That is what protects the next lane from the shared-index hazard `a5222df23` cites; a commit that also carried another session's staged file would satisfy the box's prose and betray it.

*Measured:* pasted in Verification. This is the one Phase-7 box besides `:420` whose referee is a command rather than a judgement, and it grades the *shape* of the commit, never the content of the review.

## `:420` — the only Phase-7 box with a referee, and how far that referee reaches

The plan's acceptance for this document is three clauses: **exists** · **carries a dated audit stamp** · **states its own scope limit**. `test -f` grades the first and only the first. Clauses two and three are read by a human or by the next docs pass; nothing in this repo checks that a review doc names its own limits. Stated plainly, so this artifact is not over-read: the referee is a **partial** referee — it can fail on existence and cannot fail on content.

- Referee, **before**: `test -f .agents/topology-canvas-review.md && echo PRESENT || echo ABSENT` → **`ABSENT`**, measured at tip `1fb8cc643` when this pass opened (matching the plan's own `a5222df23` measurement of ABSENT).
- Referee, **after**: the same command → **`PRESENT`**, measured at the tip in the Verification block.

## Verification (commands run by this pass, tails as printed)

```
$ git rev-parse --short HEAD                 # at the moment of writing
72b28d025
$ test -f .agents/topology-canvas-review.md && echo PRESENT || echo ABSENT
ABSENT   # before this file existed
$ wc -l < ui/src/__tests__/NodeTopologyEditor.test.tsx
12260
$ find ui/src -ipath '*topolog*' -type f -print0 | xargs -0 wc -l | tail -1
  57620 total        # the plan quotes 57,567 in a row that carries this command; +53 at this tip, no cause claimed
$ find ui/src -ipath '*topolog*' -type f | wc -l
142
$ git status --porcelain -- ui/src/features/locations/ ui/src/__tests__/NodeTopologyEditor.test.tsx ui/src/dev-mock/handlers/
(empty — all three surfaces clean when read)
```

**checker, before:** `python .agents/skills/docs-auditor/scripts/check-dead-refs.py` → exit **1**, tail: `indexed 8875 files / 1148 dirs; scanned 411 markdown files (1 live with hits)` … `check-dead-refs: 8 unresolved reference(s) in 1 live doc(s).` The one live doc is `.agents/manager-journal-open-debt-program-review-waves.md`, not this file.
**checker, after the repair:** same command → exit **1**, `indexed 8876 files / 1148 dirs; scanned 412 markdown files (1 live with hits)` … `check-dead-refs: 8 unresolved reference(s) in 1 live doc(s).` Identical totals to the BEFORE run: the scanned count moved 411 → 412 because this file joined the set, and this file contributes **0** items. The exit stayed 1 throughout, on another lane's doc — **this pass neither fixed nor caused it**. It caused and fixed one of its own first, which is the second half of the `:418` path note above.
**plan file:** `git status --porcelain -- todo-topology-editor.md` → clean, **not edited by this pass**. The 12,257 → 12,260 repair is already recorded inside the plan at this box's own disposition line by `a5222df23` and this measurement reproduces it, so an edit would duplicate a recorded correction; the 547-vs-`[carried]`-549 delta sits in a row the plan itself flags as carried; and re-classifying a box belongs to the lane that dispositioned it an hour ago.


## Follow-up 2026-09-16 — the `:473` third-implementation check, executed with the concrete claim attached

**Written by the devmock-router lane** (tip `93ed08fc5`+; every path cited below clean at its read moment). The review pass above correctly declined to run this box without "the concrete claim attached (which of the three implementations diverges, and against what)" — here it is, attached. Read in full: `ui/src/dev-mock/handlers/topology.ts` (211 lines), `ui/src/dev-mock/handlers/topology-state.ts` (86 lines). Compared against: `ui/src/api/topology.ts`, `ui/src/features/locations/topologyApply.ts`, `crates/oz-bridge/src/topology/commands.rs` + `persistence.rs` (targeted greps, cited per claim). No file was modified by this section — Phase 7 is read-only; the findings land here and the fixes are the plan's to phase.

### T-1 — LIVE divergence: the diagram is per-branch in the real backend and global in the mock

The real path keys EVERY read and write through `topology_setting_key(branch_id)` (`persistence.rs:101`; called at `commands.rs:69-84` for the envelope, `:107` for template reads, `:494` for recovery) — one diagram, one revision counter, **per branch**. The mock keeps ONE global `mockTopology` slice under `MOCK_TOPOLOGY_KEY` (`topology.ts:66`): `load_topology` ignores its `branchId` argument entirely (`:79-84`), `apply_topology_diff` bumps and persists the single shared revision (`:145-146`), while the REVISION HISTORY IS branch-scoped — rows carry `branchId` (`topology-state.ts:44`), the KEEP-deflate filters by it (`:73-78`), and `list`/`load` filter by it (`topology.ts:175`, `:187`).

Consequence, in one sentence a browser-preview user can trigger: **editing branch A moves branch B's canvas and burns a number B's history will show as a gap** — a state the real backend cannot produce, because its envelopes and counters are branch-keyed like the mock's history already is. The mock is internally inconsistent in a direction the split *between its two files* hides: `topology-state.ts` got the branch scoping right (it mirrors `revisions.rs`, its header says so); `topology.ts`'s envelope did not.

This is exactly the "plausible place for the next divergence" the review §7 flagged — found, stated, not fixed (read-only fence). Severity: dev-preview only; no production path touches this file. The honest fix, whenever the plan wants it, is scoping the envelope slice by branchId in `topology.ts` — three functions, one key change (`readSlice`/`writeSlice` accept a computed key; `mockDatabase` already keys strings).

### T-2 — LAXNESS, unreachable by the live UI: the mock's revision gate is opt-in

`apply_topology_diff` rejects only `if (baseRevision !== undefined && …)` (`topology.ts:107`); the real command's `base_revision: u64` is a REQUIRED parameter (`commands.rs:398`) and the gate always fires (`:530`). Not a live divergence: the only UI call site always sends it (`topologyApply.ts:144`, `ctx.baseRevision ?? 0`) and the api wrapper's default is a number, never absent (`api/topology.ts:271`) — so `!== undefined` holds for every app-driven Apply. Only a hand-rolled `invoke('apply_topology_diff', …)` omitting the field can observe the hole; the mock's own comment (`:101-105`) knows and says so. Record, do not fix: widening a dev-mock guard to a signature error the TS call sites never make buys nothing.

### T-3 — UNMODELED by design: the requestId ledger

The real Apply holds an idempotency ledger — replay returns the original revision (`commands.rs:445`, `:508-514`), same-id-different-payload refuses (`:503-506`), the pre-fingerprint entry removal path exists (`:516-519`) — all three branches are now pinned by the Phase-4 tests (`32dcef1d3`/`e13ee0fe4`). The mock DROPS requestId without reading it (`topology.ts:90-100` destructure has no such field) and every call increments. Why that is HARMLESS: the UI mints a fresh `crypto.randomUUID()` per Apply (`topologyApply.ts:145`), so the ledger's real purpose — protecting a TRANSPORT retry of the same payload — has no analog in browser mode, where `invoke()` is a direct function call with no retry layer. Caveat for the future: anyone writing a dev-mode double-submit E2E will get revision+2 from the mock where the backend answers revision+1 idempotently — the preview cannot demonstrate the F4 property, in either direction.

### T-4 — One line for completeness: `can_save_topology: () => true` (`topology.ts:78`)

The mock models no permission layer anywhere; this is the global mock convention, not a topology divergence. Recorded so the next reader does not re-file it.

### What this section did NOT examine

The `pin_topology_revision` stub in `handlers/staff.ts` (imported state, same module family — unchecked), the node/wire PAYLOAD shapes against `topologyContract.ts` (the ADR #46 keep-rule above is the only shape compared), and localStorage seed drift (`readSlice` failure modes). T-1 is the finding; the rest is inventory.

## Reviewer pass 2026-09-16 — Phase 7's two NO-REFEREE rows, executed read-only

Per the plan's own prescription (`todo-topology-editor.md:473`): *"what would make it gradable is a written finding per handler naming both consumers and the file each reads — a table, not an exit code."* Nothing was fixed; the fence held (this section and its plan ticks are the pass's only diff).

### F5 sweep over the canvas sub-surface (plan `:470`) — PAID, zero live hits

Population: 53 files (`Get-ChildItem ui/src/__tests__` filtered `topolog|Topology|canvasState|Inspector`). Three shape families grepped, then every hit read:

| Shape | Live hits | Reading |
|---|---|---|
| `\|\| !` / `expect(true)` / self-equal | **0** | The topology-named files' single cited hit is STILL the `topologyExport.test.ts:356` COMMENT documenting the tautology `c442feecd` deleted (confirmed by that file's git log) — it is the fix's receipt, not a finding. |
| expected computed by a production call (`toEqual(X(` / `toBe(x(`) | 7 candidates | All seven are cross-consumer EQUIVALENCE properties, each falsifiable: `topologyCard.test.ts:77/:105` (two INPUTS of `settingsCardForTypeKey` asserted equal = fallback law), `nodeTopologyLayout.test.ts:52-53` (median preserved between two DATASETS), `topologyKindRegistry.test.ts:129-130` (`nodeKindToken` vs `cardKindToken` AGREE — the healthy inverse of F1), `:206-211` (renderer's `visiblePortsForNode` ⇄ data's `leftPortVariants.length>0` agree exactly — this suite ASSERTS the two-consumers-one-scope property F1 violates), `topologyContract.test.ts:1367` (two diagrams share an error CODE), `NodeTopologyEditor.test.tsx:8123` (DOM attribute ⇄ DOM element). |

Verdict: the F5 class is empty across the canvas sub-surface, not merely across the topology-named files the earlier measurement covered. The 12k-line monolith's share contains none.

**Measurement self-caught, recorded because it would fool the next sweeper:** the first re-run printed 0 because PowerShell passed `ui/src/__tests__/topology*.test.ts` as a LITERAL file argument (no glob expansion for native commands) — rg erroring on a nonexistent literal, `2>$null` swallowing it, and a "clean sweep" meaning "nothing ran". Corrected to an explicit file list before the numbers above were taken. A green from a command that saw no files is the loudest kind of silence.

### F1 pattern over pointer/drag/keyboard/touch (plan `:472`) — no divergence; structurally excluded

Six handler files, six greps (`storeProfileId|store_id|sessionStore|branchLocation|selectedBranch|instanceId`): pointer (1,100ln) 0, keyboard (591ln) 0, drag-state (86ln) 0, editor-touch (322ln) 0, touch (43ln) 0, bend-drag (207ln) 0. **The handler family reads ZERO tenant scope** — it is geometry-only; every scope read lives one layer up, so the F1 shape (two consumers, same scope, different sources) has no habitat here. The consumers table, for the layer that does read scope:

| Consumer | File | Branch/store key it reads |
|---|---|---|
| Canvas load | `nodeTopologyEditorLoadLifecycle.ts` (via `NodeTopologyEditor` `useWorkspace`) | `branchId` prop; session from `useWorkspace` (R1-threaded) |
| Apply | `topologyApply.ts:35/:143` + `:206` | `ctx.branchId`; store is the diagram's `store_profile_id` — the R4-ratified design, backend resolves effective |
| Compare | `TopologyScreen.tsx:333-334`, gated `:843` `stores.length >= 2 && selectedBranchId` | live `selectedBranchId` — truthy by the button's own gate |
| History snapshot | `TopologyScreen.tsx:861`, gated `:848` `&& selectedBranchId` | same key as the browser itself renders under (`:880`) |
| Revision fetch | `TopologyScreen.tsx:208` | same key |
| Null-branch view | `TopologyScreen.tsx:475/:484` (unfiltered instances) | default slot — LOAD and SAVE agree on that meaning; one source, not two |

No two rows disagree about any scope. **One second-order finding, test-scaffold:** `TopologyRevisionBrowser.test.tsx:74` snapshots `baseRevision` via `api.loadTopology(TOKEN)` with NO branchId while `deploy()` may apply WITH a branchId — against the real backend those are different keys, and the helper would read the wrong slot. It passes only because the mock's envelope is global (exactly the T-1 divergence), so this is live evidence that T-1 has already taught a test to rely on the wrong shape. Not a production defect; it is a consequence of the one open mock ruling — if T-1 is ever fixed, this helper must key by branch in the same commit.
