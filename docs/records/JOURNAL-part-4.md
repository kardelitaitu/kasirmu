# Engineering Journal - part 4 of 8

**Pre-split lines 5077-6265** of JOURNAL.md (13,433 lines, 1,338 KB). Split 2026-10-02 so each part is readable whole under AGENTS.md E4 (2,000-line cap). Content is byte-identical and in original order; the single exception is the first heading of this part, promoted from ### to ## where a cut landed mid-section.

The parent index, carrying the full line-to-part map, is [JOURNAL.md](JOURNAL.md).

---

## 2026-08-11 — editor revision-conflict recovery driven through the real dev-mock IPC (round 139)

**Problem:** the round-138 follow-up — the recovery chain was proven in two disjoint halves: round 137 mocked the API at the editor boundary (onSave rejects with the typed shape) and round 138 pinned the dev-mock's gate in isolation, but nothing drove the editor through the REAL production chain (editor → `@/api/topology` → `loggedInvoke` → dev-mock handlers). A future drift in the middle — `parseAppError` no longer recognizing the mock's thrown plain object, `loggedInvoke` wrapping errors, the serve-mode alias changing — could break the browser preview's conflict recovery with neither existing test noticing.

**Solution:** Red→Green (coverage completion — the chain was already correct). New file `NodeTopologyEditorDevMock.test.tsx` stiches the real chain: `vi.mock('@tauri-apps/api/core')` routes `invoke` to the REAL dev-mock module (the same alias `vite.config.ts` applies in serve mode; jsdom has no `__TAURI_INTERNALS__` so the mock routes to its in-memory handlers), and the editor's `onSave` is wired to the real `applyTopologyDiff` like `TopologyScreen.handleTopologySave` (minus the screen's diff/validation layer, which has its own coverage). Flow: snapshot the seeded dev-mock state → render → a concurrent writer applies a NEWER diagram (revision bumps) → the stale editor user spawns a node → Apply → the dev-mock gate rejects → the editor toasts, reloads, and the authoritative diagram replaces the canvas (user's stale spawn gone). Self-heals the seed diagram for watch re-runs.

**Mutation check (the test was green from the start — it had to prove it pins the chain):** temporarily disabled the dev-mock's conflict throw; the test FAILED at the reload assertion (`Authoritative Branch` never appears — the stale Apply silently succeeds and the canvas stays stale). Restored the gate; green again. The integration between the gate (138) and the recovery (137) is now pinned end-to-end.

**Verified:** new test green · editor + dev-mock + new suites 476/476 · full UI suite 276 files / 4,677 tests (+1) · typecheck ✓ · eslint 0 errors on the new file. No production code changed (tauri-api.ts mutation reverted to the committed round-138 state — confirmed `git diff` empty).

**Commits:** `cc9ed3ee`

**Deliberately NOT done:** no browser-Playwright E2E — the vitest jsdom chain already proves the wiring, and the dev server alias is identical; no TopologyScreen-level diff logic (creations/updates/archives) — that layer has its own coverage and would make the test a screen test, not a chain test.

**Risks / follow-ups:** the conflict loop is now proven through the real IPC chain in every surface. Remaining: a Rust-touching round to finally run the long-unblocked `test-changed.sh`, and the audit's remaining smaller slices tracked in earlier entries.

### 2026-08-11 — drag drops settle clear of other node cards (round 140)

**Problem:** the editor's explicit invariant is that node cards never overlap — palette spawns settle into a collision-free spot (`findFreeSpawnSpot`) and loads spread on a grid — but a DRAG could drop a node on top of another card, stacking it invisibly. The bottom card became unselectable except by grabbing its exposed grip. Nothing enforced the invariant on movement, and no test covered it.

**Solution:** Red→Green. New integration test: drag node A onto node B (A's box lands inside B's), drop, assert the cards don't intersect — pre-fix the drop landed stacked (Red). New pure helpers in `nodeTopologyClamp.ts`: `nodeBoxesOverlap` (strict zero-gap box intersection) and `resolveDropOverlaps` (each overlapping MOVED node settles into the nearest collision-free spot via a 24px outward spiral from its drop position, iterating to convergence; returns `null` when nothing moves so the caller skips the state write). `finalizeNodeDrag` hooks it in — capture the dragged set + duplicate flag + moved flag BEFORE `commitDuplicateDrag`/`endDrag` clear them, then resolve and merge only the positions back onto the full nodes (a first attempt at `setNodes(resolved)` replaced whole objects and crashed the card render — the helper is position-focused by design).

**Three deliberate behavior gates, each found by a broken existing test:** (1) DUPLICATE drags are excluded — Alt+drag copies start at the originals' positions and the group-copy test pins copies overlapping originals at exact coordinates; the landing spot of a deliberate creation gesture is the intent. (2) FLUSH alignment (zero gap, produced by the alignment guides) is NOT an overlap and survives — the drop-overlap test for a guide-landed drop passes unchanged. (3) The resolution only fires when the drag actually MOVED — the memo test's fixture stacks ws-1/ws-2 by 60px, and a plain click re-rendering ws-1 twice exposed that a no-move click must never yank a pre-existing overlap (that's data quality, not a gesture). Two other existing tests were UPDATED to the new contract because their drags genuinely landed 4px into the preset's Retail POS card — their coordinate assertions were incidental (the purposes — off-grid placement; committed move survives Escape — are preserved).

**Verified:** editor suite 477/477 (+6: 2 integration + 4 pure) · memo 3/3 · touch 4/4 · full UI suite 276 files / 4,683 tests (+6) · typecheck ✓ · eslint 0 errors (8 pre-existing warnings).

**Commits:** `e5594bdf`

**Deliberately NOT done:** no nudge blocking (arrow keys can still step a node into a neighbour — nudges are 1px/8-24px steps where auto-resolving to a 24px-away spot would be jarring; blocking is a small follow-up); no loaded-diagram overlap repair (pre-existing overlap from saved data is left alone until the user moves the node — a silent jump on load would be worse); no overlap warning indicator.

**Risks / follow-ups:** the movement invariant now holds for drags (mouse + touch share `finalizeNodeDrag`). Follow-ups: blocking nudges that would overlap (the keyboard path), and a sweep for other movement paths that bypass the resolver (e.g., duplicate-commit settle, if the duplicate-in-place UX is ever revisited).

### 2026-08-11 — arrow nudges blocked at a neighbour's wall (round 141)

**Problem:** the round-140 follow-up — the keyboard movement path still violated the no-overlap invariant. A selected node could be arrow-nudged INTO a neighbour (1px fine steps or 8/24px grid steps), stacking it under the other card. Auto-resolving a nudge to a distant spot would be jarring for 1px steps, so the least-surprising behavior is a wall: block the whole nudge (selection stays put, no history entry).

**Solution:** Red→Green. New tests: (1) a node flush against a neighbour (0 gap — the guide landing) nudged one grid step right must stay put AND create no undo entry, while nudging away still works; (2) a 1px gap to flush must remain reachable (fine Shift+nudge lands flush, not blocked). Pre-fix the flush node stepped to 96px (Red). Fix: in the arrow-key handler, compute the would-be positions (same clamp/snap pipeline) BEFORE `pushHistory()`, then block if any nudged node's box intersects a STATIONARY node's box via the round-140 `nodeBoxesOverlap`. Selection members move rigidly, so they can't newly overlap each other — only stationary nodes matter. A blocked nudge returns before the history push, so it is not an edit (undo stays clean).

**Two alignment-guide tests updated, same honest contract change as round 140:** the fine-nudge fixture (A right edge 440, B left edge 447) deliberately nudged A 1–7px PAST B's flush edge (208/209/213/214) to exercise the guide's entry-snap and band-exit mechanics. Those positions are now forbidden — nudging into the neighbour is a wall at flush. Both tests were adapted to exercise the SAME mechanics in the reachable direction (away from the wall): entry-snap applies once and raw 1px moves stand (207 → 206 → 205, guide persists), the band clears at 7px (201 in-band → 200 clears), and the wall itself is pinned (207 → 208 blocked, guide persists). A subtle first adaptation error — asserting the wall at 205 when 206 (edge 446, still 1px short of 447) is legal — was caught by the run and corrected; the wall is exactly at flush.

**Verified:** editor suite 479/479 (+2) · full UI suite 276 files / 4,685 tests (+2) · typecheck ✓ · eslint 0 errors (8 pre-existing warnings).

**Commits:** `80919173`

**Deliberately NOT done:** no auto-nudge/settle for the keyboard path (the wall is the design — auto-resolving a 1px step to a 24px-away spot would be jarring); no duplicate-commit settle (duplicate-in-place copies still overlap their originals by design — the creation-gesture exception from round 140 carries over to the keyboard; Ctrl+D places copies one grid step away, which the wall does not affect).

**Risks / follow-ups:** the no-overlap invariant now holds for drags AND nudges. Remaining movement paths: `computeAutoLayout` output is not guaranteed collision-free (the same `resolveDropOverlaps` primitive could settle it — suggested as a follow-up), and loaded diagrams with pre-existing overlaps are still left alone until the user moves the node (deliberate).

### 2026-08-11 — auto-layout no-overlap invariant pinned (round 142)

**Problem:** the round-141 follow-up claimed `computeAutoLayout` output was "not guaranteed collision-free" and suggested settling it with `resolveDropOverlaps`. Investigation DISPROVED the claim: the engine's minimum origin gaps are structural — rows 288px (`NODE_HEIGHT + LAYOUT_GAP_Y`), columns 304px (`NODE_WIDTH + LAYOUT_GAP_X`), component bands 400px — and on the 24px lattice every gap snaps to at least `NODE_WIDTH` (288/304/400 → snapped 288/312/384-or-408, all ≥ 240). The anchor translation is rigid (same dx/dy for every node), so it cannot introduce relative overlap, and a lone node's Math.round keeps ≥303px gaps. The engine is collision-free by construction in BOTH snap modes — no production fix was needed.

**Solution:** coverage completion — a property test pins the invariant as a regression guard so a future engine change (smaller gaps, tighter bands, per-node snap) cannot silently start stacking cards that the movement paths (rounds 140–141) then refuse to create or fix. The fixture deliberately exercises every gap class: a 3-rank tree with a converging-roots column (row AND column gaps) plus an independent second tree (band gap), with scattered input positions so the anchor lands mid-layout. Runs the full pairwise no-overlap check with `snapToGrid: false` AND `true`. Two mutation checks: (1) collapsing `LAYOUT_GAP_X` to 8 did NOT trip it — columns at 248px snap to exactly flush (240, zero gap, not an overlap — good, the strict test is honest); (2) collapsing the row formula to `NODE_HEIGHT − 40` DID trip it (`b/c overlap (snapToGrid=false)`), proving the guard genuinely catches overlap regressions.

**Verified:** layout suite 11/11 (+1) · editor suite 479/479 · full UI suite 276 files / 4,686 tests (+1) · typecheck ✓ · eslint 0 errors. No production code changed (`nodeTopologyLayout.ts` mutations reverted — confirmed empty `git diff`).

**Commits:** `6782261b`

**Deliberately NOT done:** no `resolveDropOverlaps` settle on the layout output — the engine cannot produce overlaps, so settling would add a state write that never fires (dead code with a misleading purpose). No warning badge for pre-existing loaded overlaps (a separate UX slice, still open).

**Risks / follow-ups:** every movement path now provably preserves the no-overlap invariant (spawns, loads, drops, nudges, auto-layout). Open: a load-time indicator for pre-existing overlaps from saved diagrams (the invariant only guards NEW movement), and the long-deferred Rust-touching round to finally run `test-changed.sh`.

### 2026-08-11 — pre-existing overlap badge on loaded cards (round 143)

**Problem:** the round-142 follow-up (load-time indicator for pre-existing overlaps) was the last open editor slice. The no-overlap invariant guards NEW movement — spawns settle, drops settle (140), nudges hit a wall (141), auto-layout is structurally collision-free (142) — but old saved diagrams can still LOAD stacked, and the bottom card becomes unselectable except by its exposed grip. The invariant can't fix a loaded diagram silently (an auto-jump on load would be a worse surprise, per the round-140 design note), so the honest behavior is a non-destructive indicator: a badge on the offending cards, gone the moment the user drags one clear.

**Solution:** `findOverlappingNodeIds` in `nodeTopologyClamp.ts` (strict pairwise `nodeBoxesOverlap` → set of offender ids, the same zero-gap semantics the movement paths use — flush is not an overlap, so a guide-snapped layout never badges). A `hasOverlap: boolean` prop on the memoized `TopologyNodeCard` (stable boolean keeps the memo boundary clean), rendered as a warning chip in the body-status row with `role="status"`, FTL `topology-overlap-badge` in both bundles, and CSS. The editor derives it from a `useMemo` over live node positions, so it disappears the moment a drag settles clear.

**Verified:** editor suite 481/481 (+2: badge shows on an overlapping card, and dragging the card clear removes it) · full UI suite 276 files / 4,688 tests (+2) · typecheck ✓ · eslint 0 errors (one new-error caught and fixed: the badge span's stopPropagation needed the file's standard jsx-a11y disable-with-reason, mirroring the validation-note pattern) · lint:i18n clean (bundle parity) · drift guard clean.

**Commits:** `8a255ba5`

**Deliberately NOT done:** no auto-settle on load — a silent position change on load would fight the user's saved layout and the round-140 design note explicitly avoided it. No overlap count on the badge ("2 cards overlap" localization churn for marginal value — the badge marks each offender). No badge for the duplicate-drag creation gesture — copies deliberately overlap their originals (round-140 exception).

**Risks / follow-ups:** the badge is geometry-derived and static while selected-drag ghosts float (transient visual overlap mid-drag is expected and never badged). Open: the long-deferred Rust-touching round so `test-changed.sh` finally runs in a cycle's verification.

### 2026-08-11 — align & distribute settle instead of stacking cards (round 144)

**Problem:** the multi-select drag suggestion from round 143 was investigated and DISPROVEN — group drag already exists and is tested (`dragging one selected node moves the whole group by the same delta`, line 5455). The real gap found with evidence: `applyAlign` computed new positions with ZERO collision handling, making it the last movement path that can create the stacking defect rounds 140-143 exist to prevent. Align left on two same-row cards (store-1 at 80,140 and wh-1 at 680,140 — both at y=140) collapses both to x=80, stacking one EXACTLY over the other; Align hcenter on the pair moves BOTH to x=380, colliding with each other AND with the unselected ws-1 (380,80) parked on that column. No feedback, no badge-driven escape: the hidden card is unselectable except by its exposed grip.

**Solution:** in `applyAlign`, after computing the aligned positions, derive the moved set (selected cards whose x/y actually changed — the anchor already on the line keeps it), then run the round-140 `resolveDropOverlaps` spiral over those moved cards against ALL others (moved and stationary). Result: non-conflicting cards land exactly on the alignment line (existing tests assert exact positions and stay green); a moved card that would stack settles into the nearest collision-free spot — the same movement-settles design language as drags (140), with flush alignment preserved (zero gap is not an overlap). Two integration tests: (1) Align left same-row pair — anchor stays at (80,140), moved card settles clear; (2) Align hcenter pair — BOTH moved cards settle clear of each other and of the unselected ws-1, pairwise no-overlap asserted across all three.

**Verified:** align suite 5/5 (+2) · editor suite 483/483 (+2) · full UI suite 276 files / 4,690 tests (+2) · typecheck ✓ · eslint 0 errors (8 pre-existing warnings) · drift guard clean · pre-commit hook clean.

**Commits:** `10cf77d0`

**Deliberately NOT done:** no block-on-align (unlike the round-141 nudge wall) — a silently-doing-nothing "Align left" with no feedback is more confusing than a settle; the settle mirrors the established drag semantics. No settling of pre-existing overlaps among stationary cards — only moved cards resolve, so a stacked pair the user is NOT touching stays put (badge still shows it). No second pure unit test — `resolveDropOverlaps` is already unit-tested from round 140; the two integration tests pin the align-specific behavior (anchor-keeps-line, both-moved-vs-stationary).

**Risks / follow-ups:** every card-movement path now provably preserves the no-overlap invariant — spawns, loads, drops (140), nudges (141), auto-layout (142), and align/distribute (144). A settle can move a card a visible distance (the spiral must clear a full 240px card when the align collapses an identical box) — acceptable per the round-140 semantics, worth a manual look in the browser. Open: the long-deferred Rust-touching round so `test-changed.sh` finally runs in a cycle's verification.

### 2026-08-11 — capability probe pinned to the Apply permission gate (round 145)

**Problem:** the 8-round-open follow-up finally resolved — a Rust-touching round so `test-changed.sh` runs in verification (blocked by `oz-pos-app.exe` from rounds 133-136; the client closed at round 137, but every round since was UI-only). Investigation of the topology backend found `can_save_topology` — the registered command behind the editor's Save-toolbar gate (TopologyScreen → `canSaveTopology` → `can_save_topology`) — was the ONLY topology command with NO direct Rust test: the TS side is pinned by `api-ipc-contract.test.ts:290`, the Rust side by nothing. The drift risk is real and asymmetric: if the probe's permission ever diverged from `apply_topology_diff`'s gate, the UI would offer a Save that always fails (probe allows, Apply denies) or hide editing from a manager who can apply.

**Solution:** coverage completion (the command was correct — no production change). A direct end-to-end test through the same tauri mock harness as round 136's apply test: seeds `seed_default_roles` + an owner user AND a cashier user on the GLOBAL identity DB (the authz gate must resolve from the global DB, not the store-scoped one — the round-133 lesson), two sessions, then asserts owner → `Ok(true)` and cashier → `PermissionDenied` (cashier's preset lacks STAFF_UPDATE). **Mutation check** (the test passed immediately — essential to prove non-vacuous): swapped the probe's permission to `SALES_PROCESS` (which cashier holds) → the cashier assertion FAILED with `got Ok(true)`; restored `STAFF_UPDATE` → green. The test genuinely pins the probe to the Apply gate's permission.

**Verified:** new test standalone (0.17s) · topology module 231/231 (+1) · **`scripts/test-changed.sh` COMPLETED — 5,982 tests passed, 7 skipped — the first time it has run to completion since round 133** (the exe lock is gone; it detected the full `origin/main..HEAD` Rust delta including rounds 133-136) · `cargo fmt --all -- --check` clean · `cargo clippy -p oz-pos-app --lib -- -D warnings` clean. UI untouched (its contract was already pinned).

**Commits:** `28b9e34d`

**Deliberately NOT done:** no production change — the probe was already correct; the round is the missing pin. No UI test — `api-ipc-contract.test.ts` already pins the TS wrapper's invoke shape. No test of the unknown-token path (shared `resolve_session` infrastructure, covered elsewhere).

**Risks / follow-ups:** `test-changed.sh` is now part of the routine verification loop for Rust-touching rounds. The backend topology surface is comprehensively covered (231 tests). Remaining open items: none journaled — the overlap story (140-144) and the capability gate (145) are both closed; future rounds can pick genuinely new editor capabilities (wire auto-routing around cards, a fit-to-selection shortcut surface, branch-diff preview) rather than hardening.

### 2026-08-11 — crossing wires drawn over cards so they read as continuous (round 146)

**Problem:** the wire SVG renders BENEATH the cards, so a wire passing under a card it does not connect to vanished under the card and re-emerged as two visually broken pieces. Evidence: the RESTAURANT template's own `w-3` (store → kitchen warehouse) runs straight through the middle Resto POS card — in BOTH routing modes (the bezier crosses the box; the elbow's vertical jog at x=500 drops through it) — so the defect was visible in the DEFAULT diagram on first open. No test pinned wire/card crossing behavior at all. (The round-145 "auto-routing around cards" suggestion was deliberately NOT taken — obstacle-avoiding routing is a large feature; the minimal honest fix is legibility: draw the hidden segment on top.)

**Solution:** Red→Green. A pure helper `wireUnderCardSegments` in `topologyWireGeometry.ts`: polylines (elbow/bends) are axis-aligned so each H/V segment is clipped exactly against each box; bezier wires are sampled at 24 points with maximal in-box runs becoming polylines (convex box → chords stay in-box; sampling invisible at the 3px stroke). STRICT interior test — flush (a wire running exactly along a card edge) is NOT a crossing, matching the rounds 140-141 zero-gap-is-not-an-overlap semantic (found by my own flush unit test failing on the first inclusive boundary). A `wireUnderCardPaths` memo in the editor derives the sub-paths per wire (endpoint cards excluded — ports sit exactly on the box edge), and a second pointer-events-none SVG renders them ON TOP of the cards after the card map, mirroring the base `.wire-path` stroke exactly (dotted 3px accent) so the wire reads as one continuous connection. Pointer-events-none: the overlay never steals card clicks or hover.

**Two honest test-design lessons from the loop:** (1) my first fixture used camelCase wire keys (`fromNodeId`) but the load contract is snake_case (`from_node_id`) — the wire loaded with undefined endpoints, got dropped from geometry, and the test failed at `getWireCount()===1` with 0 wires, not at the overlay assertion (fixed the fixture to the real contract); (2) the middle card initially sat at y=80 but ports sit at `node.y + NODE_PORT_Y` (224) — the wire ran at y=364 BELOW the box, so it never crossed (repositioned to y=260). Both were fixture bugs, not code bugs — the debug instrumentation (temporary console logs, removed) proved the load resolved correctly.

**Verified:** integration 2/2 (crossing renders the overlay with pointer-events-none; retail preset renders none) · pure unit 6/6 (bezier crossing, empty, elbow exact clip, flush not-under, multi-box, dimensions) · editor suite 485/485 · full UI suite 278 files / 4,699 tests (+9) · typecheck ✓ · eslint 0 errors (8 pre-existing warnings) · **mutation check**: shifted every box left by 99999 → 3 crossing unit tests failed, restored → green. Drift guard clean.

**Commits:** `73152086`

**Deliberately NOT done:** no auto-routing around cards — the legibility overlay is the minimal fix; obstacle-avoiding routing remains a possible future capability. No hover/selected state on the overlay — the under-card segment keeps the base accent while the exposed parts brighten (subtle, deliberate). No pulse/label ride on the overlay — the simulation pulse still passes under the card transiently (visible pre/post); a follow-up if it reads poorly in the browser.

**Risks / follow-ups:** the overlay is geometry-derived, so it updates live as cards/wires move — a drag that clears the crossing removes the segment immediately. Remaining: the pulse-under-card transient and hover-state mismatch are both worth a manual browser look; branch-diff preview remains the leading new-capability candidate.

### 2026-08-11 — simulation pulse rides the crossing overlay (round 147)

**Problem:** round 146 made crossing WIRES read continuous over cards, but left the simulation PULSE on the base path — at the moment it passed under a card it blinked out and re-emerged, breaking exactly the continuity the overlay just restored. The restaurant template's w-3 simulation is the live case: the pulse travels y=364 through the middle POS card's box. This was the round-146 journal's explicitly-flagged follow-up ("worth a manual browser look rather than more code" — investigation showed it was a real, reproducible visual defect, so it got the fix instead).

**Solution:** Red→Green. A pure `pointUnderCards(pt, boxes)` helper in `topologyWireGeometry.ts` (strict interior, matching the round-146 segment semantic — flush is never under). In the editor, the pulse point is now computed ONCE per render into a `pulsePoints` map (previously the wires.map computed it inline); any pulse point strictly inside another card's box collects into `hiddenPulseDots` and renders on the crossing overlay as a `wire-simulation-pulse` circle (same class → same info-blue dot, pointer-events-none). The overlay now gates on paths OR hidden dots. Recomputed every render (the pulse advances on a 30ms interval — deliberately NOT a memo). One test-design lesson: `vi.useFakeTimers()` set BEFORE the async load made `waitFor` hang (frozen time) — the fake timers are armed only after `getWireCount()===1` settles.

**Verified:** integration 1/1 (pulse at t=0.5 sits at (500,364) — inside ws-1's box — the overlay shows the dot; advanced to t=0.95 (x≈662, clear) the dot vanishes) · pure unit 4/4 (inside, outside, flush edges, multi-box) · editor suite 486/486 · full UI suite 277 files / 4,703 tests · typecheck ✓ · eslint 0 errors (8 pre-existing warnings) · **mutation check**: shifting every box left by 99999 failed the two crossing unit tests, restored → green. Drift guard clean.

**Commits:** `65b73324`

**Deliberately NOT done:** no hover/selected-state on the overlay segment (the round-146 note stands — the under-card segment keeps the base accent while exposed parts brighten; a deliberate, subtle tradeoff). No pulse on the label pill. No branch-diff preview this round — it remains the leading new-capability candidate.

**Risks / follow-ups:** the wire/overlay story is now visually continuous end to end (wire + pulse). The overlay hover mismatch remains the one open cosmetic item; branch-diff preview is the headline new-capability candidate for a future round.

### 2026-08-11 — Apply button previews what it will commit (round 148)

**Problem:** the dirty state was a bare boolean — a canvas with one moved node and one with a dozen added nodes looked identical until Apply fired (the save-side diff lives inside TopologyScreen's giant handleTopologySave callback with no direct unit coverage). After the revision-conflict saga (133-139), the Apply button gave zero pre-commit signal about scale or the revision it would produce. Branch-diff preview was the headline candidate; investigation showed the full workspace-instance preview (create/update/archive) is a cross-component feature (parent-owned instances/stores/license), so this round ships the editor-scoped slice: the canvas diff vs the last committed snapshot + the revision bump.

**Solution:** Red→Green. A pure `computeCanvasDiff(prevNodes, prevWires, nextNodes, nextWires)` in a new `topologyCanvasDiff.ts` (type-only import of the node/wire types — erased at runtime, so no react-refresh cycle): identity by node/wire id, position changes (x/y) count as MOVED, added/removed counted by id presence. The dirty chip (which already re-derives from [nodes, wires, snapshotVersion]) now renders a summary line — `{added} added · {removed} removed · {moved} moved · rev {from} → {to}` — from `appliedSnapshotRef` vs the live canvas; `from` is the last committed revision, `to` is +1. New FTL key in both bundles; the test harness's `getString` mock was generalized from a count-only substitution to any `{var}` (a realism improvement — Fluent substitutes all variables). One CSS lesson: my insertion duplicated a trailing block (the first str_replace was a no-op and the second left the original block's tail) — caught by inspection and fixed.

**Verified:** integration 1/1 (fresh preset: chip hidden because the snapshot equals the canvas — `appliedSnapshotRef` initializes to the preset; spawn + Store Node → chip shows `1 added · 0 removed · 0 moved · rev 0 → 1`) · pure unit 5/5 (identical→zeros, add/remove/move split, wire add/remove, wire-endpoint rewrite is NOT a change — id is identity, never-committed → everything added) · editor suite 487/487 · full UI suite 278 files / 4,709 tests (+6) · typecheck ✓ · eslint 0 errors (8 pre-existing warnings) · lint:i18n clean · **mutation check**: inverting the added/removed predicate failed 3 unit tests, restored → green. Drift guard clean.

**Commits:** `a047829e`

**Deliberately NOT done:** no workspace-instance semantics (create/update/archive counts) — those live in the parent; the editor-scoped canvas diff is the honest first slice, and the pure function is the foundation a future preview can build on. No type-change remap preview. No "moved" differentiation for wires (a wire is identified by id; endpoint rewrites read as no-change by design).

**Risks / follow-ups:** the summary counts the CANVAS diff, not the backend workspace diff — a user renaming a workspace sees the move counted, a user re-wiring sees wire changes; the revision bump assumes no concurrent writer (the conflict recovery handles the real case). The richer branch-diff (create/update/archive preview) remains the natural next slice — `computeTopologyDiff` extraction in TopologyScreen would make it unit-testable the same way.

### 2026-08-11 — Extract the save diff into a pure, unit-tested computeTopologyDiff (round 149)

**Problem:** round 148 closed by flagging the richer branch-diff as the natural next slice: TopologyScreen's handleTopologySave embeds the workspace-instance diff (create/update/archive vectors, store_id resolution, type-change remap) as a giant untestable block — the semantics that actually matter to the backend had zero direct unit coverage. Only the screen-boundary tests (TopologyScreen.test.tsx, through onSave) pinned them; a change to the diff logic would only fail there.

**Solution:** Red→Green (refactor with the existing suite as the safety net). Red: a new pure unit suite `topologyDiff.test.ts` — 10 tests pinning the workspace-instance semantics directly on the not-yet-existing function (creates with store_id resolved from the location wire, rename updates merging backend purpose_key, inspector purposeKey override, archive sweep for removed instances, identical-canvas no-op, typeKey-change archive+recreate with a deterministic injected makeId, type-change plus rename emitting NO separate update, KDS store scope inherited through the operation-source recursion, the legacy store-node compatibility boundary, and the explicit no-ownership throw). Green: extracted the block verbatim into `topologyDiff.ts` as `computeTopologyDiff(nodes, wires, workspaceInstances, stores, makeId?)` — the handler now delegates with a one-call diff build and keeps only the screen-level concerns (session, validation, diagram payloads, atomic apply). Two test-fixture lessons: the KDS test needed the POS seeded as an existing instance (otherwise both nodes read as creations), and exactOptionalPropertyTypes rejected `storeProfileId: undefined` — the legacy store node is built literally without the field.

**Verified:** diff unit 10/10 · TopologyScreen integration 38/38 (behavior-identical extraction) · editor suite 487/487 + canvas-diff 5/5 · **full UI suite 279 files / 4,719 tests (+10)** · typecheck ✓ (exactOptionalPropertyTypes caught the legacy fixture) · eslint 0 errors (8 pre-existing warnings) · **mutation check**: inverting the archive-sweep condition failed 6 unit tests → restored, green. Drift guard clean.

**Commits:** `10d6412b`

**Deliberately NOT done:** no UI change — the editor preview still shows the CANVAS diff (round 148); the workspace-instance preview would need the editor to compute the backend diff itself (cross-component). No change to the store_id resolution logic — moved verbatim, including the legacy compatibility boundary. No pure-function change to diagram payload building (that stays in the handler, where it owns the semantic wire identity).

**Risks / follow-ups:** the pure function now computes its own normalizeTopologyGraph — the handler computes a second copy for validation/payloads (pure, idempotent, negligible cost; noted so a future round can share the graph if it bothers anyone). The editor-scoped preview and the screen-scoped diff still disagree on semantics (canvas counts vs workspace vectors) — wiring the workspace-instance counts into the editor preview remains the full branch-diff feature, now directly unit-testable at the foundation.

### 2026-08-11 — The chip previews the workspace-instance diff, not canvas counts (round 150)

**Problem:** the round-148/149 preview was the CANVAS diff — identity by id, moves only by x/y — so the counts could lie about what Apply commits: a rename-only edit (name or purpose change) showed `0 added · 0 removed · 0 moved` while Apply committed a workspace update, and a user re-wiring saw wire counts the backend doesn't care about. The workspace-instance vectors (create/update/archive) are what actually mutate the backend, but the payload builder (computeTopologyDiff) THROWS on a workspace with no resolvable store ownership — and mid-wiring canvases are exactly the state the chip must survive.

**Solution:** Red→Green. Red: 4 pure planTopologyDiff tests (classification split, orphan total-ness, type-change = 1 create + 1 archive, sweep) + 4 integration tests seeding instances + branchLocations (store spawn → `0 created · 0 updated · 0 archived` with the rev bump — a diagram-only change; `+ Retail POS` → `1 created`; rename → `1 updated`; delete → `1 archived`). Green: split `planTopologyDiff(nodes, workspaceInstances, makeId?)` out of computeTopologyDiff — the total classifier (never resolves store_id, never throws) — and rebuilt the payload builder ON the plan (create payloads add resolveStoreId + the type-change remap), so the preview and the Apply share one classification and cannot drift. The chip renders the plan when `workspaceInstances` is provided (prop presence = real mode; the demo/dev canvas without a seed keeps the round-148 canvas summary as its honest fallback). New `topology-apply-workspace-diff` FTL key in both bundles (the old key stays for the fallback). Two fixture lessons: the exactOptionalPropertyTypes gate rejected `purpose_key: undefined` in the seed mapping (omit the key), and `workspaceInstances !== undefined` (prop presence) is the right discriminator — an empty array is a legitimate empty before-side.

**Verified:** plan unit 4/4 · diff suite 14/14 · TopologyScreen integration 38/38 (payload builder refactor behavior-identical — the Apply payloads did not change) · editor suite 491/491 (+4) · **full UI suite 279 files / 4,727 tests (+8)** · typecheck ✓ · eslint 0 errors (8 pre-existing warnings) · lint:i18n clean (bundle parity counts the new key) · **mutation check**: flipping the create/update classification failed 6 pure + 1 integration test → restored, green. Drift guard clean.

**Commits:** `74620278`

**Deliberately NOT done:** no rename-through-snapshot for the canvas fallback (demo mode has no backend truth to diff against — the canvas summary is the honest demo answer). No type-change count in the chip (a type change reads as 1 created + 1 archived — true to the backend vectors). No purpose-key drill-down on the chip. No plan-based refactor of TopologyScreen's diagram-payload building (that stays in the handler).

**Risks / follow-ups:** the chip and the save path both use planTopologyDiff now, so the preview is honest — but the revision bump (`to`) still assumes no concurrent writer (the conflict recovery handles the real case, round 133-139). The demo/dev canvas (no instance seed) keeps the older canvas-summary format — a future round could unify by giving dev mode a seed. Remaining cosmetic item: the crossing-overlay hover mismatch (round 146).

### 2026-08-11 — The crossing overlay mirrors the base wire's interaction states (round 151)

**Problem (evidence, not assumption):** round 146's overlay made crossing wires read continuous in the static render — but the moment the user INTERACTED with a wire, the continuity broke again. The base wire brightens + thickens on hover (`.wire-group:hover .wire-path` → accent-hover, 4px), turns info-blue when selected (`.wire-selected`), and fades to 0.25 opacity in hover-focus mode (`.wire-group.wire-dimmed`) — while the round-146 overlay path rendered with NO class and no CSS for any of those states. So hovering a crossing wire showed bright exposed ends with a dim under-card middle (the wire visibly split), and in node-hover focus mode the under-card segment GLOWED while the rest of the wire faded. The two previously-flagged candidates were ruled out with evidence first: the un-ownable-creation chip hint is redundant (the editor already surfaces it via the role=alert validation banner + issues widget), and the editor's 8 eslint exhaustive-deps warnings are architecture noise (the keydown effect re-binds on a huge dep array every render, and the codebase deliberately mirrors live state through refs — no stale closure to reproduce).

**Solution:** Red→Green. Red: three integration tests on the round-146 crossing fixture — mouseEnter on the wire group → overlay path gains `node-wires-crossing-hover` (pre-fix: class stayed null); click the wire hitbox → `node-wires-crossing-selected`; mouseEnter on the middle (unconnected) POS card → `node-wires-crossing-dimmed` (the crossing store→warehouse wire dims with the base). Green: the overlay path now derives its class from the same state the base wire uses — `hoveredWireId`, `selectedWireId`, and the hover-focus `dimmed` condition (wire lookup by id, `hoverConnections !== null` and neither endpoint is the hovered node) — with CSS mirroring the base exactly (selected → info + 4px, dimmed → opacity 0.25, hover declared LAST so it wins the same-wire tie against selected, matching the base hover rule's higher specificity).

**Verified:** crossing integration 3/3 (hover/selected/dimmed) · editor suite 494/494 (+3) · wire-geometry 10/10 · **full UI suite 279 files / 4,730 tests (+3)** · typecheck ✓ · eslint 0 errors (8 pre-existing warnings, unchanged) · **mutation check**: dropping the hover class from the `cls` array failed the hover test → restored, green. Drift guard clean.

**Commits:** `54ecc9bc`

**Deliberately NOT done:** no hover state on the pulse dots (they ride the overlay as transient info-blue dots — a hover class on them would read as the wire itself changing). No refactor of the 8 eslint warnings (churn with behavioral risk and no test to pin — journaled as deliberate noise). No dimmed propagation into the overlay via a shared memo (the wire lookup at render is O(n) over few crossing wires; a memo would need the wire map anyway).

**Risks / follow-ups:** with the interaction states mirrored, the wire/overlay story is complete: static, hover, selected, and hover-focus all read continuous. The remaining open items are the demo/dev canvas format unify (round 150) and — if a browser pass ever flags it — the pulse dot's hover look. The eslint warnings remain as the one known piece of lint debt in the editor.

### 2026-08-11 — The chip flags type changes as destructive recreates (round 152)

**Problem:** the round-150 chip counted a workspace type change as `1 created · 1 archived` — true to the backend vectors but actively hiding the destructive part: a type change (Critical #1) archives the old instance and creates a NEW one with a fresh UUID, so instance identity is destroyed and external references break. The worst case is non-obvious even to the user who made the change: toggling a workspace's type back and forth creates a brand-new instance each Apply (the idMap remap), and the chip gave zero hint. The post-Apply toast already says `type-changed` — only the pre-commit chip hid it.

**Solution:** Red→Green. Red: 5 pure `summarizeTopologyPlan` tests (type-change only → `{0,0,0,1}`; plain create + type-change split → `{1,0,0,1}`; sweep archive split → `{0,0,1,0}`; rename → `{0,1,0,0}`; identical → zeros) + an integration test — seed an instance, switch the workspace's type in the inspector → the chip shows `1 type-changed` and `0 created · 0 archived` (pre-fix: `1 created · 0 updated · 1 archived` with no type-changed segment). Green: `summarizeTopologyPlan(plan)` in topologyDiff.ts — `typeChanged = typeChanges.size`, with created/archived EXCLUDING the recreate so a node is never double-counted — and the chip renders the new `typeChanged` var. FTL key extended in both bundles (`{ typeChanged } type-changed` / id: `diubah jenisnya`), matching the toast's established `type-changed` wording.

**Verified:** summary unit 5/5 · diff suite 19/19 · TopologyScreen integration 38/38 (payload builder untouched — this is display-only) · editor suite 495/495 (+1) · **full UI suite 279 files / 4,736 tests (+6)** · typecheck ✓ · eslint 0 errors (8 pre-existing warnings) · lint:i18n clean (bundle parity counts the extended key) · **mutation check**: pinning typeChanged to 0 failed 2 pure + 1 integration test → restored, green. Drift guard clean.

**Commits:** `92ea6d10`

**Deliberately NOT done:** no change to the plan or payload builder — the recreate split is a pure display concern (created/archived/typeChanged always sum to the true vectors). No per-node recreate badge on cards. No warning styling on the chip for recreates (the count carries the signal; a browser pass could add emphasis later).

**Risks / follow-ups:** the chip now shows the honest pre-commit signal for every vector the backend commits — created, updated, archived, type-changed, and the revision bump. The remaining open item is the demo/dev canvas format unify (round 150), and the eslint warnings stay as the editor's known lint debt.

### 2026-08-11 — The Apply chip is one format everywhere — the canvas-count fallback is retired (round 153)

**Problem:** the round-150/152 chip showed the workspace-instance format only when instances were seeded; a standalone/demo canvas fell back to the round-148 canvas-count format. Two issues: (1) the fallback could OVER-report — spawning a Store node showed `1 added` even though Apply commits zero workspace vectors (a store node is diagram-only); (2) two formats meant the chip's meaning depended on which mode the editor was in, and the real app could transiently show the canvas format before instances loaded. The round-150 journal left this as the open unify item.

**Solution:** Red→Green (refactor + behavior change, both pinned). Red: rewrote the round-148 test to the unified expectation — standalone canvas, spawn + Store Node → `0 created · 0 updated · 0 archived · 0 type-changed · rev 0 → 1`, then spawn + Retail POS → `1 created` (pre-fix the chip still showed `1 added · 0 removed · 0 moved`). Green: the chip now has ONE plan-based path — `planTopologyDiff` against a before-side that is the loaded instances when provided, or **synthesized from the committed snapshot** (`appliedSnapshotRef.current.nodes` — the preset or last-loaded diagram) on a standalone canvas. The snapshot source matters: the standalone editor can load fixtures, so synthesizing from the mount canvas would produce phantom diffs after a load; the committed snapshot tracks the actual before-state exactly like the canvas-count fallback did, but in workspace terms. The `topology-apply-diff` FTL key was removed from both bundles and the orphaned `topologyCanvasDiff.ts` module (+ its 5 tests) deleted — computeCanvasDiff had no production callers left.

**Verified:** standalone-chip integration 1/1 (rewritten) · seeded-chip 4/4 unchanged · editor suite 495/495 · diff suite 19/19 · TopologyScreen 38/38 · **full UI suite 278 files / 4,731 tests** (−1 file, −5 deleted tests) · typecheck ✓ · eslint 0 errors (8 pre-existing warnings) · lint:i18n clean · **mutation check**: synthesizing the standalone seed from the LIVE canvas (instead of the snapshot) made a spawned workspace invisible to the chip (`0 created`) — failed the rewritten test → restored, green. Drift guard clean.

**Commits:** `9aedb551`

**Deliberately NOT done:** no keep-dead-code — computeCanvasDiff was fully superseded and deleted with its tests (the branch-compare idea can build on planTopologyDiff + wireGeometry instead). No change to the seeded path (instances remain the before-side when provided). No standalone-specific revision semantics — the `rev {from} → {to}` bump reads the same everywhere.

**Risks / follow-ups:** the chip is now a single honest format in every mode. The eslint warnings remain the editor's known lint debt, and the pulse dot's hover look is still flagged for a browser pass. The plan/diff machinery (planTopologyDiff, summarizeTopologyPlan) is the reusable foundation if a branch-to-branch comparison ever lands.

### 2026-08-11 — Branch-to-branch topology comparison, and the bare-Fluent-placeholder defect (round 154)

**Problem:** two findings. (1) FEATURE: an operator with several locations has no way to see how two branches' saved topologies differ before editing — which workspaces exist in one but not the other, which shared ones are wired differently. The round-153 journal flagged this as the natural next capability. (2) DEFECT FOUND EN ROUTE WITH EVIDENCE: `topology-apply-workspace-diff` (the round-150/152 Apply chip) and `topology-discard-changes-msg` were authored with BARE `{ created }` / `{name}` placeholders. Fluent treats a bare identifier as a TERM reference, so the REAL runtime rendered the literal `{created}` text (with isolating-error markers) instead of the numbers/name — a real user-visible bug in shipped code that the mocked-Fluent editor/screen tests could never see (they interpolate by hand).

**Solution:** Red→Green. (1) FEATURE: 7 pure `compareBranchTopologies` tests (only-in-current/only-in-other, shared count, wiring differences on a shared id, name vs type differences, identical diagrams, null-as-empty, direction-is-presentation — wires compare as undirected connections) + 2 screen integration tests (compare panel loads BOTH diagrams and renders the counts + name lists; close button + "No differences" for identical diagrams). Green: `topologyBranchCompare.ts` — a pure, display-only engine (no store ownership, no apply payloads — planTopologyDiff owns the commit side); the screen's branch toolbar gains a Compare button (two+ branches), opening a panel with an other-branch selector that fetches both saved diagrams fresh and renders the summary. All 11 new FTL keys use `$`-prefixed variables. (2) DEFECT: 1 real-bundle regression test in `i18nBundle.test.tsx` formats both broken keys through `getBundle('en'/'id')` (useIsolating:false) and asserts the exact rendered strings + zero Fluent errors — RED against the broken bundles. Green: `{ created }` → `{ $created }` and `{name}` → `{ $name }` in BOTH bundles; the two test mocks' interpolation now handles `$`-style templates (the bare templates they still carry for other keys keep working — a `{$${key}}` typo was caught by the editor suite and fixed to `{${key}}`).

**Verified:** compare engine 7/7 · screen integration 40/40 (2 new) · editor suite 495/495 · i18nBundle 15/15 (1 new) · **full UI suite 279 files / 4,741 tests (+10)** · typecheck ✓ · eslint 0 errors (8 pre-existing warnings, unchanged) · lint:i18n clean · **mutation checks**: making `setsEqual` always-true killed the wiring-difference test; reverting `{ $created }` → `{ created }` in the id bundle failed the real-bundle regression test → both restored, green. Drift guard clean.

**Commits:** `29113c52` (feat(topology): compare branch topologies, fix Fluent placeholders)

**Deliberately NOT done:** no backend/apply integration — the comparison is display-only by design; no side-by-side canvas rendering (the summary panel lists names; a visual overlay diff is a future round); no compare against the live unsaved canvas (the panel fetches the SAVED states — honest about what's persisted). The pre-existing bare-placeholder style elsewhere in the codebase (outside topology) was not touched — scope was the two topology keys.

**Risks / follow-ups:** the comparison classifies by workspace id — two branches whose saved diagrams predate the instance id conventions could show false differences (id drift is a known data-healing concern, not new here). The other two topology FTL files' placeholder conventions could be swept for the same bare-`{}` defect family in a future round. The editor's 8 eslint warnings remain deliberate lint debt.

### 2026-08-11 — The branch comparison tolerates id drift — no more phantom differences (round 155)

**Problem:** the round-154 comparison classified strictly by workspace id. A saved diagram that predates the instance-id conventions — or a workspace archived-and-recreated under a new UUID (exactly the destructive type-change round 152 flags) — therefore reported the SAME logical workspace as phantom only-in-current + only-in-other entries, undercounted `shared`, and made any wiring difference on it invisible (it never reached the differing pass). The round-154 journal listed this as the known follow-up.

**Solution:** Red→Green. Red: 5 pure tests — (1) same-name same-type workspace with a drifted id pairs, nothing phantom, `shared` counts it; (2) a wiring difference on a drifted-id workspace lands in `differing` (not phantom entries); (3) ambiguity — TWO same-key candidates on the other side → no pairing, no guessing; (4) a wire between TWO drifted workspaces compares correctly after both endpoints remap; (5) type differs → no pairing (a type change is a different instance, consistent with round 152). Green: `findDriftPairs` — a second pass that pairs each unmatched current workspace with the ONE unmatched other workspace sharing name AND typeKey (both required; one-to-one, first-claim-wins, conservative on ambiguity), and `wiringByNodeRemapped` which rewrites the other diagram's wire endpoints through the drift map so wiring is compared on equal id ground. Exact-id behavior, the only-in lists, and the panel interface are untouched — display-only, still no store ownership or payloads.

**Verified:** engine suite 12/12 (+5) · screen integration + diff suite 59/59 (interface unchanged) · **full UI suite 279 files / 4,746 tests (+5)** · typecheck ✓ · eslint clean on the changed files · **mutation checks**: neutering `findDriftPairs` failed the 3 drift tests; loosening the semantic key to name-only failed the type-mismatch boundary test → both restored, green. Drift guard clean.

**Commits:** `895ec186` (feat(topology): tolerate id drift in the branch comparison)

**Deliberately NOT done:** no name-only matching (renames are common; too many false merges); no matching by wiring similarity (wire endpoints carry the drifted ids — circular); no UI change — the panel renders the same summary, it just stops lying about drifted workspaces. A genuine type change on a drifted id still reads as only-in-both (honest: it IS a different instance).

**Risks / follow-ups:** pairing is conservative — a genuinely ambiguous same-key collision stays as only-in entries (correct but noisy). The panel has no affordance to explain WHY two same-name entries aren't merged; a future round could surface "matched by name+type" vs "different type" subtly. The other two topology FTL files' placeholder conventions could still be swept for the bare-`{}` defect family. The editor's 8 eslint warnings remain deliberate lint debt.

### 2026-08-11 — The bare-Fluent-placeholder defect is now a permanent gate (round 156)

**Problem:** the round-154 fix removed the two bare-`{}` placeholders (Apply chip + discard dialog) and pinned them with a real-bundle test — but nothing PREVENTED the defect class from shipping again: bundle parity counts keys, it doesn't format them, and mocked-Fluent tests interpolate by hand. The round-154 journal's follow-up ("sweep the other topology FTL files") needed evidence, and the sweep itself needed to be permanent.

**Solution (evidence first, then a guard):** (1) FORMAT SWEEP — every message value + attribute in multi-store/settings (en+id) formatted through the real `@fluent/bundle` runtime: CLEAN. (2) STATIC SWEEP — regex over all 48 locale files for `{ ident }` where `ident` is not a defined message in that file (the exact defect signature — Fluent parses it as a message reference): CLEAN. So the journaled follow-up resolves as a non-finding: the round-154 fix already killed the whole family. The durable value is the guard. (3) GUARD — Red: 8 tests in `barePlaceholderScan.test.ts` (7 pure `findBarePlaceholders` cases — bare ident flagged, `$var`/`-term`/defined-message-reference/selectors/quoted-literals ignored, attribute + line-number reporting — plus a repo-integrity test asserting `scanLocaleFiles()` is empty). Green: `src/i18n/barePlaceholderScan.ts` — pure scanner, `import.meta.glob` over `../locales/*.ftl`. (4) GATE WIRING — the same repo scan is asserted inside `i18nBundle.test.tsx` because `lint-i18n.sh` runs that file via vitest and fails closed on its exit code.

**Verified:** scanner 8/8 · i18nBundle 25/25 (+1) · **full UI suite 279 files / 4,755 tests (+9)** · typecheck ✓ · eslint clean on changed files · lint-i18n clean · **mutation proof (end-to-end)**: injecting `bare-placeholder-mut = { created } created` into `shared.ftl` (a) failed the repo-integrity test naming file+line, and (b) failed the actual `lint-i18n.sh` gate with exit=1 (the round-156 scan assertion) — restored, green. Drift guard clean.

**Commits:** `fffc4771` (fix(i18n): gate bare Fluent placeholders across all locale bundles)

**Deliberately NOT done:** no python duplicate scanner in lint-i18n.sh — the vitest placement covers both the UI CI step and the gate with one code path; no scan of OTHER codebases' placeholder conventions (scope was the defect family that shipped). The `nodeTopologyMemo.test.tsx` render-count test failed once under full-suite load then passed in isolation + a clean re-run — pre-existing intermittent flakiness, journaled, not caused by this round.

**Risks / follow-ups:** the memo render-count flake (wire-direction cycling) deserves its own investigation round if it recurs — counting tests under parallel load are timing-sensitive. The ghost-overlay branch diff (round-155 recommendation) remains the open feature: it would build on the compare engine + `wireUnderCardSegments` geometry.

### 2026-08-11 — The memo render-count flake is de-flaked: a settle-aware baseline (round 157)

**Problem:** `nodeTopologyMemo.test.tsx` — the editor's own render-count safety net — failed once in the full-suite run (`AssertionError: expected 2 to be 1` in "cycling a wire direction re-renders only that wire"), then passed in isolation and on re-runs. A count-based test that flakes under machine load is the worst kind of safety net: it erodes trust exactly when the suite gets busy. The test harness snapshotted its baseline at the FIRST moment the loaded diagram was visible (`waitFor` on a node element) — but the editor's mount settles AFTER that (async settings invokes resolve on a ~50ms timer; a parent can hand the editor real instances right after load, re-running the load effect and re-applying the diagram, which re-renders every wire). Any such render landing between the baseline and the interaction's delta inflates the delta by exactly one.

**Investigation (evidence over assertion):** I could NOT reproduce the flake in isolation (25+ runs), under CPU contention (6 runs with 3 heavy files saturating), or in-process (1000 click-cycles, all delta-1) — but I verified what it was NOT: (1) the click batches into ONE render (probe: 1000 cycles all delta 1 — `selectWire` + `setWires` + history updates coalesce; the memo boundary holds), (2) the load effect fires exactly ONCE on a standalone mount and applies nodes+wires atomically, (3) the Tauri settings resolution does not re-render wires. The residual mechanism is a timer/macrotask-driven mount render landing inside the baseline→delta window — load-timing dependent by nature.

**Solution (Red→Green):** Red — made the race DETERMINISTIC with a real production flow: the mock resolves on a ~100ms timer (a macroTASK settle, like the settings invokes), and the test re-renders the editor with `workspaceInstances` after first visibility — the parent-handing-instances flow that re-applies the diagram. Against the old harness this reproduces the exact documented signature: `expected 2 to be 1` (re-apply render + click read as 2 from a naive baseline). Green — `settleCounts()`: the baseline waits for render-count quiescence with a 150ms floor (longer than the longest known mount-time timer — the 50ms settings invoke; the quiescence check alone proved insufficient: a timer armed just before the settle fires AFTER one stable sample, which the first draft of the test caught). `renderWithPreset` settles before snapshotting; the regression test asserts the settled measurement reads delta 1 with the re-apply absorbed, plus all-zero deltas for non-clicked elements. Also added `rerenderWithProviders` to `test-utils/render.tsx` — the provider-preserving rerender the regression test needs (the raw `result.rerender` drops the Theme/Toast/Zoom/Brand+Fluent stack).

**Verified:** memo suite 4/4 (+1 regression) · editor suite + test-utils 499/499 · **full UI suite 279 files / 4,756 tests (+1)** · typecheck ✓ · eslint clean on changed files · **mutation check**: neutering `settleCounts` failed the regression test with the exact flake signature (`expected 1 to be 2`) → restored, green · drift guard clean.

**Commits:** `605bfdf4` (test(topology): settle-aware baseline de-flakes the memo render-count harness)

**Deliberately NOT done:** no production change — the memo boundary is sound (1000-click probe proves it); no weakening of the exact-delta assertions — the settle removes the race by construction instead; no change to the other two render-count tests' semantics (the settle only delays their baseline). The 100ms mock delay adds ~300ms per test file — accepted for determinism.

**Risks / follow-ups:** the settle's 150ms floor is calibrated to the known timers (50ms settings invoke; 100ms simulated load) — a NEW mount-time timer longer than the floor would re-open the race; the floor is a documented constant. The round-155 ghost-overlay branch diff remains the open feature.
### 2026-08-11 — the branch-diff ghost overlay: the canvas shows WHERE branches differ (round 158)

**Problem:** the round-154 compare panel is a text summary — counts and lists. A multi-store operator reading "2 only here, 1 differs" still cannot see *where* those locations are on the map. Round 154 journaled the "no visual overlay" gap; the engine's classification (only-here / only-there / shared-differing, plus the round-155 id-drift pairing) had no spatial rendering.

**Solution:** a display-only overlay composed of three pieces. (1) `buildTopologyOverlay` (engine, pure): turns `onlyInOther` into ghost descriptors at the OTHER diagram's saved positions, `onlyInCurrent` into a red-marker id list, `differing` into an amber list — each filtered to workspaces present on the live canvas. (2) `TopologyScreen` stores the other branch's diagram and passes the overlay into the editor. (3) `NodeTopologyEditor` renders ghost cards (dashed success-green card with the workspace name, pointer-events-none + aria-hidden so it never steals a click or keyboard stop) and marker rings (red = only this branch, amber = shared but wired/named differently; flat rings, deliberately no `--shadow-*` so they are not elevated surfaces). Drifted-id pairs (round 155) that differ land amber like any other differing workspace.

**TDD:** Red = 5 pure `buildTopologyOverlay` tests (ghost shape, ghost position comes from the OTHER diagram, marker classification, drift-pair as differing, null/empty diagrams) + 1 screen integration test (overlay prop flows from the loaded other branch) + 1 editor DOM test (ghost renders at its saved x/y with the right name, aria-hidden, markers applied only to classified cards). Green = the three pieces above. Two mutations caught (neuter ghosts → 4 tests fail; drop markers → 3 tests fail). The screen test initially asserted the canvas DOM — but `NodeTopologyEditor` is mocked in `TopologyScreen.test.tsx`, so the screen test pins the prop wiring and the editor test owns the DOM; the first fixture also had no wires, so `ws-pos` compared as identical — fixed by wiring it differently.

**Verify:** engine 17/17 (+5) · screen 41/41 (+1) · editor suite 496/496 (+1) · **full UI 280 files / 4,763 tests (+7)** · typecheck ✓ · eslint 0 errors (8 pre-existing warnings) · **two compliance gates caught real defects**: `themeTokenCompliance` flagged a hardcoded `13px` ghost-name font-size (fixed to `--text-sm`) and `noiseDitherCompliance` flagged the two marker box-shadows as elevated surfaces (replaced `--shadow-md` with flat rings) · drift guard clean.

**Commits:** `db7f8e8c` (feat(topology): ghost overlay renders the branch diff on the canvas)

**Deliberately NOT done:** no ghost WIRES — the other branch's wiring could ghost over the canvas, but wire geometry is computed live from the current diagram and a second wire set has no safe geometry source (the round-146 `wireUnderCardSegments` machinery is current-side only); no ghost interaction (clicks, hover, drag) — decorative by design; no overlay toggle yet — the overlay is only visible while the compare panel is open (the panel's close clears it).

**Risks / follow-ups:** ghost positions are the other diagram's SAVED coordinates — if that branch was authored on a different canvas size or after a big pan/zoom, ghosts can sit off-screen or overlapping live cards (the layer is pointer-events-none, so overlap is visual noise, not breakage); a follow-up could clamp or re-layout ghosts into the visible canvas. The overlay does not dim the rest of the canvas — operators see the markers in context rather than a focus mode; a "compare focus" toggle (dim non-matching cards) is a possible next slice.
### 2026-08-11 — ghost overlay clamps into the visible canvas (round 159)

**Problem:** the round-158 ghost overlay placed other-branch workspaces at the OTHER diagram's SAVED world coordinates. A branch authored on a different canvas size — or after a big pan/zoom — left ghosts off-screen (the overlay silently lost the difference) or piled onto live cards (visual noise). The round-158 journal recorded this as the overlay's known weakness and the standing next slice.

**Solution:** `layoutGhosts` (pure, in the compare engine) lays every ghost card into the VISIBLE world-rect — derived from the canvas client size and the pan/zoom transform (`world = (screen − pan) / zoom`) — and resolves collisions deterministically. Clamping is two-step: the card's top-left is anchored inside the rect, then (when the rect is big enough) pulled fully inside. Collisions resolve by dropping below the lowest blocker; when the vertical stack runs out of room, the ghost wraps LEFT of the column — every move keeps the card inside the visible rect, so a pile-up stays legible instead of cascading off-screen. The editor wires it in a `useMemo` with the viewport from `canvasRef` (800×600 fallback pre-layout, which is also what jsdom sees) and `occupied` = the live workspace cards, so ghosts also step aside from real cards. Display-only and deterministic — the same input always lays out the same way.

**TDD:** Red = 11 pure `layoutGhosts` tests (in-view ghost untouched; right/below/top-left off-canvas clamped with the card fully inside; zoom 2× halves the world-rect; pan moves the rect; same-corner pile-ups wrap side-by-side; ghost steps off a live card; three-ghost chain stacks deterministically in input order; empty → empty; rect smaller than the card anchors the top-left without NaN) + 1 editor DOM test (a ghost at 4000,4000 renders clamped to 560,360 in the default 800×600 viewport while an in-view ghost at 120,360 keeps its position). Green = the pure function + the editor memo. Two mutations caught (no clamping → 9 tests fail; no collision walk → 3 tests fail).

**Verify:** engine 28/28 (+11) · editor 497/497 (+1) · screen 41/41 · **full UI 280 files / 4,775 tests (+12)** · typecheck ✓ · eslint 0 errors (8 pre-existing warnings) · drift guard clean.

**Commits:** `23673cec` (feat(topology): clamp ghost overlay into the visible canvas)

**Deliberately NOT done:** no ghost WIRE layout — a ghost workspace's connecting wires have no geometry source on the current canvas (round-158 decision stands); no animated transitions when a ghost clamps (the position snaps; a CSS transition on the ghost layer would be a cheap polish slice); no resize-observer reactivity — the layout recomputes on pan/zoom/overlay/nodes changes; a window resize alone doesn't re-lay ghosts until the user pans or zooms (the canvas size rarely changes mid-session, and the memo reads `clientWidth` live at each recompute).

**Risks / follow-ups:** the collision walk is bounded at 64 iterations per ghost — a pathological layout (hundreds of ghosts in a tiny rect) accepts overlap rather than looping forever, which is the right failure mode but worth knowing; the wrap is horizontal only (left of the column) — a vertical-then-right waterfall would fill small viewports more densely, at the cost of more moving parts; the 800×600 fallback means pre-layout ghosts clamp as if the canvas were 800×600 — once a real size is measured the next pan/zoom recomputes correctly.
### 2026-08-11 — ghost-wire stubs: the compared branch's ghost cluster reads as a topology (round 160)

**Problem:** ghost cards alone read as floating boxes. A multi-workspace satellite missing from the current branch (several workspaces wired together, none present here) showed as disconnected rectangles — the operator could see WHERE the locations were but not HOW they connected. The round-158/159 journals recorded the geometry-source problem for ghost wires and deferred them.

**Solution:** dashed stubs for the other branch's ghost-to-ghost wiring, drawn between the LAID-OUT ghost positions. `buildGhostWireStubs(wires, ghosts)` (pure, in the compare engine) walks the other diagram's wires and emits one stub per wire whose BOTH endpoints are ghosts, with edge-to-edge midpoints (right/left for side-by-side pairs, top/bottom for vertical ones — mirrored when the authoring order flips). `TopologyOverlay` gains `otherWires` (populated by `buildTopologyOverlay`) so the editor has the wiring without a new prop. The editor renders the stubs as a dashed success-green `<svg>` layer inside the ghost layer (stroke props are token-gate-exempt; the colour still comes from a token), sized to cover the laid-out ghosts, pointer-events-none with the rest of the overlay.

**TDD:** Red = 5 pure tests (both-endpoints-ghost filter; right→left edge midpoints; mirrored edges on flipped order; top/bottom edges for vertical pairs; no stubs for ghost→shared / non-ghost pairs / empty inputs) + overlay-shape assertions updated for `otherWires` + 1 editor DOM test. The editor test initially hardcoded expected coordinates and failed because round-159's layout pushed one ghost off a preset card — the assertion now derives the expected endpoints from the RENDERED ghost cards (the stub must connect the displayed cards edge-to-edge, whatever the layout decided), which pins the stub↔layout coupling honestly. Green = the pure builder + overlay field + editor SVG layer + CSS. Two mutations caught (dropping the both-endpoints filter → 2 tests fail; centers instead of edges → 5 tests fail).

**Verify:** engine 33/33 (+5) · editor 498/498 (+1) · screen 41/41 (overlay shape updated) · **full UI 280 files / 4,781 tests (+6)** · typecheck ✓ · eslint 0 errors · drift guard clean.

**Commits:** `b7454b9f` (feat(topology): ghost-wire stubs connect the compared branch's ghosts)

**Deliberately NOT done:** no ghost→shared stubs — a ghost wired to a SHARED workspace would need drift-resolved, live-position far ends (the shared card's position on the current canvas, resolved through the round-155 pairing); that's a real follow-up, sketched below; no wire labels or relationship-type styling on stubs (they are decorative hints, not inspectable wires); no stub clipping when a ghost pair is far apart (the SVG spans the ghost extents, so stubs between far-apart ghosts draw across the canvas — acceptable for a decorative layer).

**Risks / follow-ups:** the ghost→shared stub slice is the natural next step — it needs the overlay (or the editor) to carry the other-side→current-side shared-id mapping so a ghost's wire to a shared workspace can target the LIVE card; a wire between two ghosts whose laid-out positions overlap (layout accepted overlap in a tiny rect) draws a degenerate stub — harmless decoration. Also cleaned up a stale `// MUTATION: no clamping` comment left in `layoutGhosts` from the round-159 mutation check.
### 2026-08-11 — ghost→shared wire stubs: the single-ghost diff now reads as a connection (round 161)

**Problem:** round 160 drew stubs only between ghost↔ghost pairs. The MOST common diff — a branch with ONE extra workspace wired to a shared location ("Branch B has an extra Stock Room feeding its shared Retail POS") — still showed a floating ghost with no stub. The round-160 journal called this the natural follow-up and sketched the design: carry the shared-id pairing through the overlay so a ghost's wire can target the LIVE card.

**Solution:** two pieces. (1) `TopologyOverlay` gains `sharedByOtherId: Array<{ otherId, currentId }>` — populated by `buildTopologyOverlay` from the drift pairing (round 155) plus exact id matches (deterministic order: drift pairs first). (2) `buildGhostWireStubs` gains a third param `farByOtherId: ReadonlyMap<otherId, GhostBounds>` — the far end of a wire with exactly one ghost endpoint resolves through it (a shared workspace whose current card is NOT live — deleted unsaved — resolves to nothing and the stub is skipped); `stubEndpoints` refactored to take bounds so ghost→shared and ghost↔ghost share one geometry path. The editor builds `farByOtherId` from `sharedByOtherId` + its live workspace cards, so the stub targets the card the operator actually sees.

**TDD:** Red = 2 `sharedByOtherId` tests (drift pair + exact match both listed; empty when nothing is shared) + 3 ghost→shared stub tests (exact edge midpoints to the far card; skip when the far card isn't live; ghost↔ghost and ghost→shared coexist) + 1 editor DOM test (stub connects the rendered ghost card to the LIVE shared card, positions derived from the DOM). Green = the engine + editor pieces. Two mutations caught (dropping the ghost→shared branch → 2 tests fail; offsetting the far rect → 1 geometry test fails). One test self-corrected: my first expectation asserted a wrong edge midpoint (300+120=420, not 360) — the failure taught the arithmetic, and an earlier "identical diagrams → empty sharedByOtherId" assertion was simply wrong (identical diagrams SHARE every workspace).

**Verify:** engine 38/38 (+5) · editor 499/499 (+1) · screen 41/41 (overlay shape updated) · **full UI 280 files / 4,787 tests (+6)** · typecheck ✓ · eslint 0 errors · drift guard clean.

**Commits:** `5cb928e1` (feat(topology): ghost-to-shared stubs reach the live shared card)

**Deliberately NOT done:** no stub LABELS or relationship styling (stubs stay decorative hints — a live-wire label would imply inspectability); no stub for a ghost wired to a non-workspace (hardware) — the far end isn't a shared workspace, so there's nothing to anchor to; no handling for the rare ghost whose far shared card was dragged unsaved — the LIVE card position is used, which is exactly what the operator sees.

**Risks / follow-ups:** the compare overlay series (rounds 154-161) is now functionally complete: classification, drift pairing, ghost cards + markers, in-view layout, ghost↔ghost AND ghost→shared stubs. The next open items are the "compare focus" mode (dim non-matching cards while the panel is open) and — a smaller polish — animated transitions when a ghost clamps. The overlay's `sharedByOtherId` grows with the number of shared workspaces; it's rebuilt only when a compare loads, so no perf concern.
### 2026-08-11 — compare focus: the spatial diff becomes a review mode (round 162)

**Problem:** the overlay renders differences in full context — red/amber rings, ghosts, stubs — but nothing recedes, so the differing locations don't actually POP. An operator comparing two branches still scans the whole canvas to find what changed. The round-161 journal listed "compare focus" (dim non-matching cards) as the open workflow item.

**Solution:** a focus toggle in the compare panel. `compareFocusDimIds(overlay)` (pure, in the engine) derives the dim set from the overlay's own classification: shared-identical current-side ids = `sharedByOtherId` currentIds MINUS `differing` — only the workspaces that are the SAME in both branches dim. The editor takes a `compareFocus` prop (default false), builds the dim set in a memo (empty when no overlay), and ORs it into the card `isDimmed` alongside the existing hover-focus dimming. The screen owns `compareFocus` state, renders a localized toggle button (`aria-pressed`, `topology-compare-focus` in both bundles), passes it to the editor, and resets it on close. No new CSS — the existing `node-dimmed` (0.35 opacity) and its transition apply; the rings/ghosts/stubs stay full-strength so the differences read instantly.

**TDD:** Red = 2 pure tests (focus dims ONLY shared-identical — differing/only-here/ghost ids stay bright; empty overlay → nothing) + 2 editor DOM tests (with focus on, the shared-identical card dims while only-here and differing cards don't; with focus off, nothing dims even with an overlay) + 1 screen test (toggle flips `compareFocus` to the editor, close resets it with the overlay). Green = the three pieces + FTL keys. Mutation caught (dropping the differing-exclusion → the classification test fails). Two harness lessons: the fixture needed a ghost wired to the DIFFERING workspace (any ghost→shared wire makes that shared workspace differ, so a truly identical shared workspace needs the ghost attached elsewhere), and `renderReady(2)` needs the 2-instance + 2-store mocks the overlay test already had.

**Verify:** engine 40/40 (+2) · editor 501/501 (+2) · screen 42/42 (+1) · i18n bundle 16/16 (new key passes parity) · **full UI 280 files / 4,792 tests (+5)** · typecheck ✓ · eslint 0 errors · drift guard clean.

**Commits:** `bbfb5e39` (feat(topology): compare focus dims identical cards for a review view)

**Deliberately NOT done:** no focus-scoped WIRE dimming — wires stay full-strength because they carry topology meaning beyond the card classification (the round-155 wiring comparison is per-workspace, so a wire's "shared-identical" status isn't defined); no dimming of ghost stubs' shared far-end anchors — a ghost→shared stub pointing at a dimmed card still reads (the connection is legible, just quieter); no persistence of the toggle across sessions (it resets when the panel closes — a deliberate choice; reopening the panel starts fresh).

**Risks / follow-ups:** hover-focus (round-146 era) and compare-focus compose by OR — when both are active, a card dims if EITHER mode dims it, which is correct but untested in combination (the hover tests run without an overlay); the dim-set memo rebuilds per overlay/nodes change — trivial cost. This closes the eight-round compare series (154-162): classification, drift pairing, ghosts + markers, in-view layout, ghost↔ghost + ghost→shared stubs, and now focus mode.
### 2026-08-11 — hover inspection beats compare-focus dimming (round 163)

**Problem:** the round-162 journal recorded a risk: the hover-focus and compare-focus dim modes compose by OR but were never tested together. Writing that test exposed a real interaction bug, not just a gap — hovering a shared-identical card under compare focus kept the INSPECTED card dimmed. `hoverConnections` includes the hovered node itself, and the OR expression `(hoverConnections !== null && !has(node)) || compareDimSet.has(node)` re-applied the compare dim to a card the operator was actively inspecting. The same hit any compare-dimmed neighbour of the hovered card.

**Solution:** hover focus is the transient, specific intent — while active it fully takes over: `isDimmed = (hoverConnections !== null && !hoverConnections.has(node.id)) || (compareDimSet.has(node.id) && hoverConnections === null)`. Compare dimming applies outside hover; during hover the connected subgraph lights up exactly as hover-focus has always behaved. One-line semantic change, no CSS, no state.

**TDD:** Red = 2 editor tests (hovering the compare-dimmed card itself lights it back up, and restoring dim on leave; hovering a CONNECTED card also lights the compare-dimmed neighbour). Both failed for the right reason (`node-dimmed` still present). Green = the composed expression — all 3 round-162 focus tests, the hover-focus suite, and the full editor suite stayed green. Mutation caught (reverting to the naive OR fails the first regression test).

**Verify:** editor 503/503 (+2) · engine 40/40 · screen 42/42 · **full UI 280 files / 4,794 tests (+2)** · typecheck ✓ · eslint 0 errors · drift guard clean.

**Commits:** `8d7fd565` (fix(topology): hover inspection lights up despite compare-focus dim)

**Deliberately NOT done:** no change to hover-focus wire dimming (wires were never compare-dimmed — round 162's deliberate choice stands); no persistence of compare focus across hovers (the toggle stays as set; hover is a transient overlay on it); no test for compare-dimmed + hover-dimmed simultaneously (a card both not-connected under hover AND shared-identical is dimmed by both — visually identical, one assertion would be redundant).

**Risks / follow-ups:** the FTL `vars`-cross-check guard remains the open defect-class item from the round-163 recommendation — `<Localized>` sites whose `vars` keys don't match an FTL message's `$vars` render the raw id at runtime, invisible to bundle parity (which counts keys, not variables). Same shape as the round-156 bare-placeholder gate.
### 2026-08-11 — FTL vars cross-check gate + three real i18n defects fixed (round 164)

**Problem:** bundle parity counts keys, not variables. A `<Localized id="…" vars={{ … }}>` site whose vars don't exactly match the FTL message's declared `$vars` renders the raw id (or a partial message) in the real runtime — invisible to mocked Fluent (which interpolates by hand) and to the round-156 bare-placeholder gate (which only catches `{ ident }` placeholders, not `$var` drift). Journaled as the top open defect class since round 156.

**Solution:** the round-156 scanner (`barePlaceholderScan.ts`) grew a vars cross-check. `messageDeclaredVars` parses the en bundles with the REAL `@fluent/bundle` parser and walks the AST for `{ type: 'var' }` nodes — value vars and per-attribute vars separately (a site only pays the attributes it actually localizes via `attrs`). `findLocalizedSites` statically reads each `<Localized>` tag's `vars`/`attrs` object-literal keys. `varsMismatch` (pure, extracted for direct testing) computes missing/extra; `scanLocalizedVars` reports repo-wide hits and runs inside the same `lint:i18n` gate (wired alongside `scanLocaleFiles` in `i18nBundle.test.tsx`).

**The scan found 3 REAL defects:**
1. `fastpin-enter-pin` — site passed `$user` but the FTL message declared nothing → Indonesian users saw the raw id. Added the variable.
2. Terminal confirm/cancel messages — sites localize a `.aria-label` that doesn't exist in the FTL → hardcoded English for Indonesian users. Added the attributes.
3. `payment-table-number` — the FTL had the `.aria-label` attribute BEFORE the value line; FTL grammar reads that as attribute-only, so the message had NO value and the localized `Meja { $number }` never rendered (English fallback always). Reordered value-first.

**TDD:** Red = 7 `messageDeclaredVars` unit tests (value vars, per-attribute vars, member access, term-call args, multi-message) + 7 `findLocalizedSites` tests (explicit/shorthand/quoted keys, nested objects/spreads, attrs keys, unresolvable vars → null, multiline line numbers) + 5 `varsMismatch` tests + the repo-integrity assertion that surfaced the real mismatches, one at a time. The repo-integrity scan ran on real files, so each defect was found by a failing test BEFORE any fix. Green = the scanner on the real parser (replaced the round-164 first-draft hand-rolled regex — it mis-split value/attribute for attribute-first messages, which is exactly how the real defect hid) + the three defect fixes. Mutations caught: dropping the attribute-vars contribution (2 tests), dropping the extra check (2), dropping the missing check (3). Two scanner lessons: the glob must EXCLUDE `*.id.ftl` (Indonesian translations may legitimately drop a var — a shorter translation — and were overwriting the en contract); the en-only glob pattern is the `!` exclusion form, not the round-156 bare `*.ftl` form.

**Verify:** gate files 45/45 (i18nBundle 17/17 incl. new gate test) · **full UI 280 files / 4,815 tests (+21)** · typecheck ✓ · eslint 0 errors (dead `VAR_PLACEHOLDER` regex removed after the real-parser rewrite) · `lint:i18n.sh` clean end-to-end · drift guard clean.

**Commits:** `88eb4bb8` (feat(i18n): gate Localized-vars against FTL $vars, fix 3 real defects)

**Deliberately NOT done:** no `id.ftl` var cross-check (a translation legitimately dropping `$var` is correct FTL, not a defect — only en is canonical); no check of the `attrs` values against the message's declared attributes (a site localizing a nonexistent attribute is the parity gate's key-level job; the round-164 terminal fix needed a NEW key lookup, not the vars scan); no dynamic-vars sites (non-literal `vars={expr}` are skipped as unresolvable — documented, none problematic in the tree).

**Risks / follow-ups:** a `<Localized>` opening tag whose `>` is inside nested JSX truncates the tag window early (possible false-positive on var-bearing messages — none exist today); the real-parser import pulls `@fluent/bundle` into the scan module (already a runtime dependency, no bundle impact — vite tree-shakes the test-only path); term-call args are now captured as declared vars — if a future message passes a var into a term call whose term does NOT use it, the scan requires it (slight over-require, no current instance).
### 2026-08-11 — translation-var drift gate on the id bundles (round 165)

**Problem:** the round-164 gate aligns every `<Localized>` site to the EN contract, but nothing checked the INDONESIAN translations against it. The site can only ever provide the vars the en message declares — so an id translation referencing any other variable name (a translator renaming `$number` to `$nomor`) renders a literal `{$nomor}` placeholder for Indonesian users. Round-164 journal listed this as the last open hole in the invisible-i18n-defect family.

**Solution:** `translationVarDrift(idContract, enContract)` (pure) plus `scanTranslationVars()` (repo-wide, same gate). The direction is SUBSET, deliberately: a translation DROPPING a var is safe in Fluent (unused vars are ignored) — only DRIFT (a var the en counterpart never declares) is a defect. That is why no skip list is needed: legitimate omissions are safe by construction (the recommendation's "skip mechanism" turned out to be unnecessary once the direction was right). Comparison is per value and per attribute, attributes compared only when present in BOTH bundles — an id-only attribute is never localized by the site (attrs come from en), an en-only attribute is a separate omission defect class, both documented as out of scope.

**TDD:** Red = 6 pure tests (mirror clean; DROP allowed — the direction pin; value name-drift flagged; attribute name-drift flagged; id-only attribute ignored; en-only attribute ignored) + repo-integrity assertion. Green = the two functions. **The scan found ZERO real drift across all 24 id bundles** — so the gate is prophylactic, and the honest proof that it bites came from a planted-defect check: renaming `$number` → `$nomor` in `sales.id.ftl` failed the scan with the var named, then reverted. Pure-function mutations caught: dropping the attribute comparison (1 test), flipping to superset direction (6 tests). One test bug self-corrected (the id-only/en-only attribute test passed an id contract without an `attributes` field — not iterable).

**Verify:** gate files 53/53 (i18nBundle 18/18 incl. new gate test) · **full UI 280 files / 4,823 tests (+8)** · typecheck ✓ · eslint 0 errors · `lint:i18n.sh` clean end-to-end · drift guard clean.

**Commits:** `c2770f5e` (feat(i18n): gate id translations against en $vars for var drift)

**Deliberately NOT done:** no en-only-attribute check (an id translation omitting an attribute the site localizes silently leaves it unset for Indonesian users — a real a11y gap but a separate defect class; the round-164 journal already scoped it out, still open); no id-only-key check (the parity gate owns key presence); no attribute-presence parity between en and id (same omission class).

**Risks / follow-ups:** the en-only-attribute omission check is the natural next slice (requires attribute-level presence parity — a different scan shape than var drift, needs site `attrs` data to know which attributes are actually rendered); the line-number computation uses `indexOf(\`${id} =\`)` — a message id that is a PREFIX of another message's first line could resolve to the wrong line (no such case today — ids are distinct); the en glob and id glob are the round-164/round-156 forms respectively, both proven to match.
### 2026-08-11 — localized-attribute omission gate + six live fixes (round 166)

**Problem:** a site localizes an attribute via `attrs={{ 'aria-label': true }}`. When the id translation OMITS that attribute — the message exists but lacks the key — the attribute is silently unset for Indonesian users: no error, no fallback. Key-level parity counts messages, not attributes; the round-165 var-drift scan sees no vars involved. The round-165 journal scoped this as the natural next slice, driven by the site's attrs (only rendered attributes matter).

**Solution:** `localizedAttributeOmission(attrsKeys, enAttrs, idAttrs)` (pure) + `scanAttributeOmissions()` (repo-wide, same gate). Per site: the localized attrs that exist in the en message's attributes but are missing from the id translation's. An attribute en ALSO lacks is a site-side bug (both locales unset) — deliberately out of scope, pinned by a test. Sites with unresolvable attrs and ids missing from en/id are skipped (documented; the parity gate owns key presence).

**The scan found 6 REAL defects** — all in the same shape: en has an ATTRIBUTE-ONLY message (`.placeholder` / `.aria-label`, no value); the id translation made it VALUE-only (no attribute). Indonesian users saw the English JSX fallback placeholder (`e.g. 150.00` — wrong unit guidance; the id translation `mis. 15000 untuk Rp150.000` never rendered) or an unlabeled column header (`loyalty-table-actions` had no aria-label at all). Fixed all six to mirror the en attribute-only shape: 5 placeholders in sales.id.ftl (discount %, discount label, counted-cash, shift notes, opening balance) + 1 aria-label in loyalty.id.ftl.

**TDD:** Red = 5 pure tests (mirror clean; omitted flagged; mixed set flags only omitted; en-also-lacks ignored; empty attrs clean) + repo-integrity assertion that surfaced the six, one at a time via the report. Green = the scan + six FTL fixes. Planted-defect check proved the gate bites (reverting one fix → scan failed with the attribute named, then restored). Pure mutations caught: dropping the en-presence condition (2 tests), dropping the id-presence condition (3 tests).

**Verify:** gate files 60/60 (i18nBundle 19/19 incl. new gate test) · **full UI 280 files / 4,830 tests (+7)** · typecheck ✓ · eslint 0 errors · `lint:i18n.sh` clean end-to-end · drift guard clean.

**Commits:** `9ed6d636` (feat(i18n): gate localized attrs against id translations, fix 6)

**Deliberately NOT done:** no en-missing-attribute check (a site localizing an attribute NEITHER bundle defines — the round-164 journal's noted gap — is a site-side bug, still open); no value/attribute-shape parity beyond presence (a message whose en side is value-only but id side is attribute-only, or vice versa, is only caught when a site localizes the attribute — the shape mismatch without a site is dead translation text, harmless); no check that attribute VALUES in id use only en-declared vars (the round-165 drift scan already covers var names in attributes present in both).

**Risks / follow-ups:** the en-missing-attribute site bug is the remaining open i18n defect class (a site `attrs` key pointing at a message attribute that exists in neither bundle — silently unset for ALL users); the scan re-parses all bundles per call (en + id + tsx — same cost profile as the other three scans, fine for a lint gate); attribute-presence and var-drift scans both compare id-against-en — they could share the en/id parse maps, a trivial refactor if a fifth scan ever appears.
### 2026-08-11 — en-side attribute gate + 31 live fixes across 17 locale files (round 167)

**Problem:** the round-166 gate only caught id-side omissions (en has the attr, id drops it). A site-localized attribute missing from the EN message is silently unset for ALL users — the JSX fallback (usually hardcoded English) shows instead. The round-166 journal carried this as the last open i18n defect class.

**Solution:** `localizedAttributeMissing(attrsKeys, enAttrs)` (pure) + the round-166 scan extended: every site-localized attr must exist in the EN message (round 167), and when en has it, in the id translation too (round 166). The two checks are disjoint (missing requires ¬enHas) so they share one hit shape and one scan. **Design refinement over the recommendation:** the probe showed the en-side defect splits into TWO live sub-classes — absent from both bundles (26 site-instances) AND present only in id (5: currency ×2, inventory ×3 — en users still lose it, id is not canonical). The gate flags ALL attrs absent from en; the "neither-bundle" formulation would have missed 5 real defects.

**The scan found 31 REAL defects** (26 site-instances / 24 unique ids absent from both, 5 en-only-missing): every one was a message authored VALUE-only ("`x = Close`", "`x = At least 4 digits`") that a site localizes ONLY as an attribute (`attrs={{ 'aria-label': true }}` / `attrs={{ placeholder: true }}`) — so the translation never applied. Indonesian users saw hardcoded English (e.g. the shift-count hint "e.g. 15000 for $150.00" instead of "mis. 15000 untuk Rp150.000") or an unlabeled control (customer history, variant edit/delete, refund qty buttons, retail modal close ×3, appearance logo alt). Fixed all 29 unique messages (17 files, 9 en/id pairs + currency en-only) by converting value-only → attribute-only with the same text — verified every id is used ONLY by attr-localizing sites (0 value-rendering sites), so the conversion changes nothing for the visible text except restoring the intended JSX fallback (e.g. the × close icon instead of the word "Close").

**TDD:** Red = 4 pure tests (en-absent flagged; mixed set flags only missing; clean when present in en; empty clean) + repo-integrity assertion that surfaced all 31. Green = the check + 29 message conversions. Planted check proved the gate bites (reverting one en fix → scan failed naming the attr, restored). Pure mutation caught (inverting the en-absence check → 4 tests). Verified each fix against the round-164 vars contract (the `$name`-bearing aria-labels moved from value to attribute; the site vars/attrs still satisfy the exact-match gate).

**Verify:** gate files 64/64 (i18nBundle 19/19) · **full UI 280 files / 4,834 tests (+4)** · typecheck ✓ · eslint 0 errors · `lint:i18n.sh` clean end-to-end · drift guard clean.

**Commits:** `700ccbc0` (feat(i18n): gate site-localized attrs against the en message, fix 31)

**Deliberately NOT done:** no fix of the value→attribute pattern at the SITE level (a future author can still write a value-only message for an attr-only site — the gate catches it at commit time, which is the point); no removal of now-dead values (all converted messages were value-only, so nothing became dead); no check for sites localizing an attribute the message has but with a different NAME intent (that's a naming convention, not a defect).

**Risks / follow-ups:** this round fixed the LAST member of the i18n defect family (bare placeholders 156, site-vars 164, var drift 165, id-omission 166, en-absence 167) — 43 real defects total across the family; the four scans still re-parse all bundles per call (a shared parse module is the trivial next refactor); the round-165 line-number computation (`indexOf`) is now used by three scans and remains prefix-unsafe in theory.
### 2026-08-11 — shared bundle/site maps: the five scans parse once (round 168)

**Problem:** rounds 156-167 shipped five scans in one module, each globbing and parsing the bundles itself — nine `import.meta.glob` calls across four distinct glob forms (`*.ftl` all-locale, the en-only `!`-exclusion pair, `*.id.ftl`, the tsx `!__tests__` pair). Three copies of the en glob meant the round-164 lesson (id translations overwriting en contracts) had to be remembered in three places, and the round-165 `indexOf` line helper was drifting toward duplication.

**Solution:** a single source of truth for the glob forms and parses, in the same module: `loadLocaleSources` (all-locale), `loadEnSources` (en-only), `loadIdSources`, `loadTsxSources` (tests excluded), plus three derived maps — `loadEnContracts`, `loadIdContracts` (message → variable contract via the real Fluent parser), and `loadLocalizedSites` (file → sites). All four scans refactored onto them: 9 globs → 4, the en/id/tsx exclusion logic lives in exactly one place each, and the parses happen once per scan call as before. Pure refactor — every scan's behavior is unchanged.

**TDD:** Red = 5 pins, written first: the en map carries `category-colour-swatch-aria` with `$colour` in its aria-label (DISCRIMINATING — the id translation drops `$colour`, so a regressed all-locale glob fails this pin, re-triggering the round-164 bug); the id map carries the same id WITHOUT `$colour`; the site map finds FastPINOverlay's `staff-login-clear-aria` with `attrsKeys: ['aria-label']`; the tsx map excludes `__tests__`; the all-locale map still contains `.id.ftl` files for the bare-placeholder scan. Green = the loaders + maps + scan refactor. Mutations caught: dropping the en-only exclusion → 2 failures (the pin AND the round-164 scanLocalizedVars repo test — the mutation re-created the exact bug the pin exists to catch); dropping the tsx test exclusion → 1 failure. All 45 pre-existing scan tests stayed green through the refactor.

**Verify:** gate files 69/69 (i18nBundle 19/19) · **full UI 280 files / 4,839 tests (+5)** · typecheck ✓ · eslint 0 errors · `lint:i18n.sh` clean end-to-end (still one pass — the lint gate's i18nBundle test exercises all five scans) · drift guard clean.

**Commits:** `9b61b0a3` (refactor(i18n): consolidate the five scans onto shared bundle maps)

**Deliberately NOT done:** no new module file (the scanner module IS the i18n-scan home — exporting the loaders keeps the diff minimal and the types adjacent); no caching/memoization of the maps (each scan call still parses once per run, same cost as before; a gate-level cache is premature); no extraction of the round-165 `indexOf` line helper (used once — extracting it would be speculative).

**Risks / follow-ups:** the five gates are now locked to one glob set each — the pins are the regression surface if a glob ever needs to change; `loadLocalizedSites` runs `findLocalizedSites` over every tsx file eagerly (the same work the scans did before, just centralized); this closes the i18n family cleanly — with the shared maps in place, a future sixth scan (e.g. attribute-presence parity for site `attrs` vs en/id) composes in three lines.
### 2026-08-11 — ghost glide: ghosts ease into place instead of snapping (round 169)

**Problem:** the round-159 journal carried it as the open polish item: ghosts SNAP when the overlay clamps them into the visible canvas — they pop in at their clamped positions when compare opens, and jump when a resize or re-layout re-clamps them. The round-168 recommendation picked this as the topology track's next slice.

**Solution:** ghosts now position via `transform: translate(x, y)` instead of `left`/`top` — compositor-friendly, so easing them never layout-thrashes — and the layer's animate class applies a 280ms ease-out transform transition (re-clamps glide) plus a fade-and-rise mount keyframe (the open pop softens). The transition is GATED behind `panGestureActive` state: a mouse-pan drag drops the class so an edge-anchored ghost tracks the pointer instead of trailing it 280ms behind, and release restores it. One render-line change (left/top → transform), one new state mirroring the existing `isPanningRef` (a ref alone can't re-render the class), two setState calls in the well-understood startPan/cleanup path.

**TDD:** Red = a `ghostXY` test helper (parses `translate(xpx, ypx)`) + the 4 position assertions migrated from `style.left`/`top` to it (they failed for the right reason — the render still emitted left/top, so the helper read NaN) + a new pan-gating test (idle → animate class present; middle-button drag → dropped through the gesture; mouseup → restored). Green = render, state, CSS. Mutations caught: reverting the render to left/top → 4 position tests fail; dropping the gating (always-animate class) → the pan-gating test fails. Deliberate scope: wheel-zoom and touch-pinch are NOT gated (wheel ticks are discrete enough that 280ms inter-tick easing reads smooth; touch is a tablet rarity) and node-drag step-asides gliding is the desired feel — both documented.

**Verify:** editor 504/504 (+1 net) · **full UI 280 files / 4,840 tests (+1)** · typecheck ✓ · eslint 0 errors (8 pre-existing hook-dep warnings, none near the change) · css-token scanner: 0 var() refs added (its 117/360/22 findings are a pre-existing standalone-informational baseline, not a gated check) · drift guard clean.

**Commits:** `c2e3099d` (feat(topology): ghost glide eases clamp repositions instead of snapping)

**Deliberately NOT done:** no left/top transition (the layout-thrash version — transform is the point); no saved-position → clamped-position entrance animation (would need a two-phase mount effect for a small win — the fade-and-rise covers the pop); no touch/wheel gating (see scope above); no `will-change` (many compositor layers for a few ghosts is the kind of premature hint that hurts more than helps).

**Risks / follow-ups:** the animate class is computed inline in the render — a `--dragging`-style refactor that consolidates gesture flags could fold `panGestureActive` in later if touch/pinch gating is ever wanted; the keyframes' `both` fill holds the final state (matches the inline transform, so no visual drift); the -0 world-position guard from round 159 still holds — transform renders `translate(0px, 0px)` identically to `left: 0`.
### 2026-08-11 — lua_sandbox fuzz target: stale os-is-nil assert panicked on every input (round 170)

**Problem:** the overnight honggfuzz campaign flagged a crash in `lua_sandbox` (20260811-041231): SIGABRT on the 4-byte input `loca` (a truncated Lua keyword) within 2 seconds. The suspect was the sandbox crate, but the root cause was the TARGET, not the crate: the target asserted `os` must be nil after loading malicious input, while oz-lua's sandbox deliberately keeps a RESTRICTED os table (date/time/clock, read-only — documented in the crate) for scripts that need the clock. The assert therefore panicked on EVERY input; `loca` is just the minimized form. A Rust panic under the fuzz profile (panic=abort) surfaces as SIGABRT.

**Solution:** the target now checks the actual sandbox contract instead of an oversimplified nil rule: os is either nil or the restricted table with date/time/clock present and execute/remove/rename/exit nil; every other dangerous global (io, loadfile, dofile, require, package, debug, rawget/rawset/rawequal/rawlen, collectgarbage, module, load) must be nil. The durable pin lives in oz-lua itself — a regression test `sandbox_contract_survives_the_fuzz_crash_input` loads the exact crash input `loca`, asserts the post-load sandbox state, and proves the VM stays recoverable (apply_discount returns Ok after the failed load).

**TDD:** reproduced first with a scratch test (panic message: `dangerous global 'os' should be nil after malicious input`) — evidence, not speculation. Red = the oz-lua contract test. Green = the target fix + the passing test (oz-lua 63/63, +1). Planted-check equivalent: replaying the exact crash input against the fixed, instrumented target in WSL prints `This crashfile didn't trigger any panics...` — before the fix it aborted in 2 seconds.

**Verify:** WSL replay of the real crash input (clean, exit 0) · oz-lua 63/63 (Windows) · cargo fmt ✓ · clippy -p oz-lua -D warnings ✓ · only `lua_sandbox.rs` had the stale assert (grep across fuzz targets). The hfuzz build env quirks are documented: `RUSTC_WRAPPER=` (empty) disables the sccache interception, and CARGO_TARGET_DIR must point at a space-free dir.

**Commits:** `ccca7cbb` (fix(lua): align fuzz-target sandbox assert with the restricted-os contract)

**Deliberately NOT done:** no sandbox change (the crate is correct — restricted os date/time/clock is intentional); no change to the other six fuzz targets (audited — only lua_sandbox had drifted); no lldb/gdb setup to capture a post-fix backtrace (the replay's clean exit is the evidence; a debugger adds nothing now that nothing crashes). NOTE: `/fuzz/hfuzz/` is gitignored wholesale (repo convention, `.gitignore` line 26 — instrumented builds, corpora, and crash reports are local/dev-only), so the target fix itself is not versioned; the oz-lua contract test is the durable regression pin, and the crash input stays in `fuzz/hfuzz/crash_reports/20260811-041231/` for local replay.

**Risks / follow-ups:** the remaining fuzz targets' post-load asserts deserve the same contract audit (this drift went unnoticed because only lua_sandbox's sandbox has a "safe table" exception — the others are strict-nil); the cargo-hfuzz instrumented-binary copy path silently skipped when CARGO_TARGET_DIR pointed at the cache — worth a follow-up verifying `hfuzz_target/<target>/` exists after `cargo hfuzz build`; the crash input stays in `fuzz/hfuzz/crash_reports/20260811-041231/` as a permanent regression corpus member.
### 2026-08-11 — libfuzzer lua_sandbox target: stale os-is-nil assert still in the versioned tree (round 171)

**Problem:** round 170 fixed the crash class in the HONGFUZZ target and pinned the contract in oz-lua — but the versioned cargo-fuzz/libfuzzer copy at fuzz/fuzz_targets/lua_parse.rs still asserted `os` must be nil after loading malicious input. Same assert, same panic-on-every-input class, still in the tree. It survived because (1) round 170's fix went into the gitignored /fuzz/hfuzz/ copy ("the target fix itself is not versioned") and (2) CI builds lua_sandbox but never RUNS it — it was dropped from the tier-1 fuzz run loop as collateral in the 6e7c37b6 tier split (the build loop kept it; the run loop kept only sku_parse/money_parse). Reproduced on the real target in WSL: the trivial input `x = 1` (5 bytes < 500) → panic at fuzz_targets/lua_parse.rs:53:17 → `SUMMARY: libFuzzer: deadly signal`.

**Solution:** the versioned target now asserts the real contract, mirroring the round-170 hfuzz fix exactly (same check, same messages): `os` is either nil or the restricted table with date/time/clock present and execute/remove/rename/exit nil; every other dangerous global (io, loadfile, dofile, require, package, debug, rawget/rawset/rawequal/rawlen, collectgarbage, module, load) must be nil. Doc comments updated to name the os exception and the crash class. Durable guard: lua_sandbox re-added to the tier-1 CI fuzz run loop (`timeout 65 cargo fuzz run lua_sandbox -- -max_total_time=60`) with a comment explaining it MUST run, not just build — a future stale assert now panics the advisory fuzz job instead of passing silently.

**TDD:** Red = real-target reproduction, not speculation: built the libfuzzer target with nightly + cargo-fuzz in WSL (CARGO_TARGET_DIR=/home/user/oz-fuzz-target — space-free, per the round-170 env note), fed `x = 1`, observed the deadly signal at the stale assert (lua_parse.rs:53). Green = the contract check lands; the SAME command replays clean (`Executed /tmp/tiny.lua in 4 ms`, exit 0), the round-170 crash input `loca` also replays clean, and a 30s mutation session ran 202,535 executions (6,533 exec/s) with zero crashes. The durable contract pin (oz-lua `sandbox_contract_survives_the_fuzz_crash_input`) was already in place from round 170 — the target now finally asserts exactly what that pin proves.

**Verify:** WSL: real-target replay clean · `loca` crash input clean · 30s fuzz clean (202,535 runs, peak RSS 440 MB) · oz-lua 63/63 (incl. the round-170 contract pin) · `rustfmt --check` on the target ✓ · drift guard clean. Windows note: libFuzzer cannot link on MSVC (`clang_rt.asan_dynamic_runtime_thunk-x86_64.lib` missing; `--sanitizer none` leaves `__stop___sancov_pcs` unresolved) — WSL remains the fuzz execution environment, as in round 170.

**Commits:** `c327f17a` (fix(lua): align libfuzzer sandbox assert with the restricted-os contract)

**Deliberately NOT done:** no extraction of the check into a testable lib function (the oz-lua contract pin + the CI run of the real target cover the regression; a lib would need new CI wiring to run anyway — noted as a follow-up); no change to the other six fuzz targets (re-audited this round: none has a post-load sandbox assert — the round-170 "contract audit" follow-up found exactly one stale copy, this one); no clippy on the fuzz crate (not a repo gate; no_main + libFuzzer linkage makes it awkward).

**Risks / follow-ups:** the other five run loops are unchanged (cart_deser/ozpkg/manifest already execute in CI); the fuzz job is advisory (continue-on-error) so a regression surfaces via the crash-artifact upload rather than blocking PRs — the strongest guard is the oz-lua contract pin, which DOES fail the main gate; the round-170 follow-up about verifying `hfuzz_target/<target>/` after `cargo hfuzz build` is still open; making the sandbox check a shared unit-testable function in the fuzz crate would let `cargo test` pin it in seconds instead of a 60s fuzz run, if the crate ever gains a test step.
### 2026-08-11 — CRM-02: list_customers_scoped enforces customers:view (round 172)

**Problem:** audit/01 CRM-02 (P1) — `list_customers_scoped` resolved the session store but never enforced the declared `customers:view` permission, so any valid session (kitchen, permission-less custom roles) could enumerate every customer record (name, email, phone, notes) over IPC. The frontend registers CustomerManagement as manager-only, but the UI role gate is not a security boundary (the LOY-01 lesson — the audit said it outright: "UI role gating was not a security boundary"). Search and history reads were already gated; the full list was the hole, in BOTH desktop and tablet clients.

**Solution:** `list_customers_scoped` now resolves the session and calls `require_customer_permission(..., CUSTOMERS_VIEW)` before touching the store — exactly the `search_customers_scoped` pattern — in both clients, with doc comments naming the CRM-02 rationale. Cashier keeps `customers:view` in ROLE_PRESETS, so PaymentModal's session-scoped customer lookup is unaffected; the gate only blocks roles that lack the declared permission.

**TDD:** Red = `list_customers_scoped_denies_user_without_view_permission` in both clients (kitchen session — ROLE_PRESETS grants it only KDS_VIEW/KDS_UPDATE/SALES_VIEW/WORKSPACES_SWITCH): failed before the fix with Ok (enumeration succeeded) where the assertion expected PermissionDenied. Green = the two-line gate; both tests pass and the pre-existing owner-listing isolation test (the positive path) stays green. 46/46 customers tests per client.

**Verify:** oz-pos-app + oz-pos-tablet customers modules 46/46 each · clippy -D warnings clean on both clients · cargo fmt --all -- --check clean · drift guard clean.

**Commits:** `31b1fe6d` (test(loyalty): pin the earn/redeem projection guards from migration 107) · `ab070ee0` (fix(crm): enforce customers:view on list_customers_scoped)

**Audit-status finding (why the loyalty slice died):** LOY-02 (earn idempotency) and LOY-04's DB boundary are ALREADY remediated — migration 107_loyalty_integrity.sql (dedupe + balance rebuild + uq_loyalty_earn_sale/uq_loyalty_redeem_sale + tier triggers) and the app-level dedup landed in 12547e9d (2026-08-01), one day AFTER the 07-31 audit, and the audit report was never re-stamped. The audit's Open markers for LOY-02/LOY-04 are stale. The DB-boundary guards were completely unpinned though — shipped as a separate `test(loyalty)` commit closing the LOY-12 duplicate-sale/redemption test gap.

**Deliberately NOT done:** no change to legacy `get_customer` (still registered, global-DB, no session/permission — a scoped `get_customer_scoped` + UI switch is a contract change, tracked as follow-up); no UI change (the screen is manager-only in the registry; a denied non-manager direct-IPC caller now gets the correct PermissionDenied, and CRM-03's silent-swallow UX is a separate finding); no change to the dev-mock (it mirrors command NAMES; permission enforcement is server-side by design).

**Risks / follow-ups:** `get_customer` remains a permission-less global read (single-record PII, same class as this fix) — the scoped variant is the natural next slice; CRM-03 (load failures render as "No customers yet") makes a denied list look like an empty database on the screen — fix the error/retry state; audit/01-04 fix-status tables need a re-stamp pass (loyalty is done; CRM-02 now done; REP/CUR P0s still open).
### 2026-08-11 — REP-02: multi-currency report periods no longer collapse into one total (round 173)

**Problem:** audit/03 REP-02 (P0) — the backend correctly groups revenue by currency, but SalesReportScreen collapsed every row into one `totalRevenue` and formatted it with the FIRST row's currency. A period spanning USD + IDR rendered "Total: $5,100.00" — 10000 USD + 500000 IDR summed as raw minor units — a mathematically invalid total. The period-comparison delta had the same defect (one % over collapsed mixed-currency money). Export CSV was already per-row correct (each row carries its own currency column).

**Solution:** a pure `sumRevenueByCurrency` helper (in ui/src/features/reports/revenueTotals.ts) sums minor units per currency, preserving first-seen order. SalesReportScreen now renders per-currency totals joined with " · " ("$100.00 · IDR 500,000") when the period spans currencies, and the %/vs comparison delta is hidden whenever EITHER period spans more than one currency (a single percentage over mixed currencies is meaningless; the orders delta, currency-free, is untouched). Single-currency periods render byte-identical to before — the existing "$3,500.00" test stays green unchanged.

**TDD:** Red = two component tests (totals: per-currency values present, the collapsed "$5,100.00" absent; comparison: no % when either period is multi-currency) — both failed against the old code with the collapsed total in the DOM. Green = helper + display + delta gating; 32/32 screen tests. Refactor = moved the helper to its own file after the react-refresh lint warning (the rule's own recommendation: "use a new file to share functions") + a 3-assertion unit test for the pure logic (order preservation, single-currency, empty).

**Verify:** SalesReportScreen 32/32 (+2) · revenueTotals 3/3 · DashboardScreen/SalesDashboard/MultiStoreDashboard 26/26 unchanged · tsc --noEmit clean · eslint 0 errors, 0 warnings on changed files · drift guard clean.

**Commits:** `d8bdc38f` (fix(reports): never collapse multi-currency revenue into one total)

**Deliberately NOT done:** no DashboardScreen change (same defect class — the todayCurrency KPI and the mixed-scale weekly bars still collapse; tracked as the immediate next slice); no chart fix (the recharts tooltip still formats every bar with the first currency — per-currency series is a display-policy slice); no printReport change (it still collapses totalMinor into a single-currency receipt — needs a multi-currency receipt policy); no export change (already per-row). Policy note: the audit offered three options — this slice chose "render separate totals per currency" over "restrict the report to one currency" or "convert via recorded exchange rates" (no rate conversion exists in the product yet; conversion would need a recorded-rate policy).

**Risks / follow-ups:** DashboardScreen (KPI + weekly bar scale) is the same bug class and still collapses — natural next slice; printReport can still print a single-currency total for a multi-currency period; the joined totals string is a plain-currency read for operators — a dedicated multi-currency layout is product work, not a defect fix.
### 2026-08-11 — CUR-05: create_exchange_rate validates currency pair, codes, and date (round 174)

**Problem:** audit/04 CUR-05 (P1) — `create_exchange_rate` (desktop AND tablet clients) validated only non-empty strings and a strictly positive rate. A same-currency pair, a non-ISO-4217 code, or a malformed effective date would persist as semantically invalid configuration — and the CUR-04 "latest effective rate" selection can never match a malformed date, so bad rows silently poison future conversions.

**Solution:** field-level validation before any write, mirrored in both clients: `from != to`; both codes must parse as ISO-4217 (3 ASCII letters, uppercase-normalized — the same `Currency::from_str` the `currency_info` command uses); an explicit `effective_date` must parse strictly as YYYY-MM-DD via `chrono::NaiveDate`. Each failure returns `AppError::Invalid` with the field name in the message (the repo's field-specific convention). The UI already prevents same-pair (`formValid`) and produces YYYY-MM-DD via `type=date` inputs — this closes the direct-IPC caller hole the audit named, without breaking the visible form.

**TDD:** Red = 3 command tests (same-pair "USD/USD", non-ISO code "US1", impossible date "2026-02-30") + 1 positive-path guard, written first: the three validation tests failed against the pre-fix command (it proceeded to DB access on the unmigrated test DB and returned a non-Invalid error) and the positive path passed. Green = the three checks; desktop 4/4. The tablet client (identical gap, mirror of the desktop file) received the same fix + mirrored tests, and a planted mutation (disabling the from==to guard) was caught by the tablet same-pair test — proving the mirror bites too.

**Verify:** oz-pos-app + oz-pos-tablet exchange_rates modules 4/4 each · clippy -D warnings clean on both clients · cargo fmt --all -- --check clean · drift guard clean.

**Commits:** `ca759a73` (fix(currency): validate currency pair, ISO codes, and effective date on create)

**Deliberately NOT done:** no repository-level validation inside modules/currency (the command boundary is the IPC surface; a second direct caller of `CurrencyRepository` would need its own guard — follow-up); no source-length bound (the audit's minor item); no UI change (already prevents same-pair + type=date); no CUR-03 work (scoping is a separate finding).

**Risks / follow-ups:** the checks live in two mirrored client files (the repo's established pattern; a shared validator belongs in modules/currency if a third caller appears); `list_exchange_rates` / `get_default_currency` / `set_default_currency` remain unscoped and unpermissioned (CUR-03, P0) — the round-172 pattern is the natural next currency slice; repository-level validation and source-length bounds are the open CUR-05 residuals.

### 2026-08-11 — 0046: code-resident permission registry with write-time grant validation (round 175)

**Problem:** roles store flat JSON permission lists and accept any string at
write time, so nothing classified a key as operational (wildcard-eligible) or
sensitive (explicit-only) — ADR #35 D2's "sensitive keys are never
wildcarded" rule was unenforceable. The inventory also had gaps the audit
missed: legacy seeds use `products:crud` and `categories:manage` (no
constants), and a test fixture used `products:view`.

**Solution:** new `platform-core::permission_registry` (spec 0046): all 68
enforced keys classified by family + sensitivity (8 sensitive: sales:void,
sales:refund, payments:refund, payments:settle, staff:manage_roles,
staff:delete, reports:export, audit:export), a bidirectional inventory test
(constants == registry, so a new key is either registered everywhere or
nowhere), and `validate_grants` rejecting unregistered keys, wildcards that
would grant sensitive keys, and the global `*` (reserved for the Owner seed,
which bypasses this path via direct insert). Wired into `Store::create_role`
→ `CoreError::Validation`. Added `PRODUCTS_CRUD` / `CATEGORIES_MANAGE`
constants (legacy seed keys, byte-identical) and updated two integration
fixtures that used synthetic keys (`module:N:action`, `["test"]`) plus one
`products:view` → `products:read` (nothing enforces products:view).

**Verify:** registry 9/9, oz-core lib 1678/1678, staff_integration 25/25,
oz-pos-app staff 40/40, oz-pos-tablet staff 19/19, fmt + clippy -D warnings
+ drift guard clean. `test-changed.sh` blocked by the locked oz-pos-app.exe
(running process — left alone per the shared-tree rule).

**Commits:** `bde2962d` (feat) + `7fa406a4` (refactor).

**Risks / follow-ups:** the registry is the foundation for the gate (0047)
and the profile sensitive keys (0049: staff:read_identity / read_payroll /
edit_notes register when enforced). Manifest `permissions` arrays are a
separate declarative DSL (format-validated only), not RBAC enforcement — a
future slice may reconcile them. `products:crud` / `categories:manage` stay
as registered legacy composites so seeds remain byte-identical.

### 2026-08-11 — 0047: centralized fail-closed enforcement gate with pinned gated-command census (round 176)

**Problem:** enforcement was per-command `require_permission_for_user(...)`
with the user→role→authorize resolution duplicated in both clients'
`authz.rs` — "did every command gate itself?" was answered by review and
audit, both of which missed instances (rounds 172/174 found a command that
skipped its gate and one that skipped validation). The gate also had no
deny-by-default: an unregistered key or an unresolvable role was handled
inconsistently (role-missing surfaced as `Internal`, not a denial).

**Solution:** `Store::require_permission(user_id, required)` is now the single
gate in `oz-core` (ADR #35 D3): the 0046 registry is the only vocabulary
(unregistered key denies even the `"*"` Owner grant), user resolution +
active check + role lookup all fail closed as `CoreError::PermissionDenied`
(role-missing is a denial, never `Internal`). Both clients' `authz.rs` are
thin wrappers mapping `CoreError::PermissionDenied` → the existing
`AppError::PermissionDenied` wire shape (`kind: "permissionDenied"` — no UI
contract change), killing the duplicated resolution logic; the tablet's
dead role-based `require_permission` (zero callers, a second parallel
enforcement path) was removed per spec §7. A new `gate_audit.rs` integration
test pins the full gated-command census of both clients — every command
module with its gate-call count and permission keys, bidirectionally — so a
new command, a dropped gate call, or a changed key surface fails the suite
and forces a deliberate pin update (the spec's review signal). Every gated
key is resolved through its real constant to `is_registered` (renaming a
constant breaks the match arm), and raw string-literal permissions at gate
call sites are pinned out of existence.

**Verify:** gate 8/8 (oz-core db::staff 50/50), desktop authz/customers/
exchange_rates --lib 56/56, tablet 55/55, gate_audit 3/3, fmt + clippy -D
warnings (oz-core, both clients) + drift guard clean. `test-changed.sh`
blocked by running app binaries (oz-pos-app running via another agent's
`cargo run`; oz-pos-tablet via `tauri dev`) — left alone per the shared-tree
rule; the audit test was run by executing the built harness directly against
current sources.

**Commits:** `47fcf6a5` (feat: centralized gate + client wrappers), `ef0707e1`
(test: pinned gated-command census), `34464e79` (docs: spec moved to
`_done`).

**Risks / follow-ups:** the census pins *modules*, not command fns — a new
command inside an already-pinned module with a gate call changes the count
and is caught, but a new command inside a pinned module that silently skips
the gate is not (no intent signal exists); that remains the job of review.
Assignment scopes (0048) will extend the gate with scope_mode + branch/
workspace resolution. The 0047 spec moves to `_done` once the user closes
the slice.

### 2026-08-11 — 0048 cycle 1: assignment schema + explicit-all scope evaluation API (round 177)

**Problem:** a single global `users.role_id` cannot express ADR #35 D5's
shapes — "Manager for branches A+B, workspaces retail-pos only" or "Staff for
the kds workspace" — and there was no structure to migrate legacy rows into.
The audit's CUR-03 (command scoping) is the P0 this model fixes, and D9 steps
3-4 depend on the assignment tables existing.

**Solution:** migration `128_assignments.sql` (registered, `expected_tables`
extended): `assignments` (user_id PK, role_id, scope_mode global|scoped,
branch_scope / workspace_scope explicit all|list, expires_at deferred),
`assignment_branches`, `assignment_workspaces`. Every existing user is
backfilled with one effective assignment — owner/manager/staff/custom keep
global mode; legacy role-cashier / role-kitchen users resolve to role-staff
with the scoped workspace their grants imply (`retail-pos` / `kds`, both
seeded). Two per-dimension scope flags were added beyond the spec's column
list because "empty lists never mean all" needs an explicit marker — the
spec lists only `scope_mode`, but its invariants require the all/list
semantics. New `db::assignments` model: `ScopeMode`, `Assignment` with
fail-closed `matches_scope` (global ignores dimensions; scoped requires each
dimension to be explicit `all` or contain the request id; `None` context on a
list dimension denies; empty list is deny, never all), and
`Store::assignment_for_user` (unparsable scope_mode -> None, fail closed).

**Deliberate sequencing decision:** the retirement of role-cashier /
role-kitchen is NOT in 128. Re-pointing `users.role_id` to role-staff would
change what the 0047 gate (still resolving through role_id) grants kitchen
users until the gate rewires to assignments — a behavior change at the
migration boundary. So 128 is purely additive and behavior-neutral; the
retirement + re-point land with the gate rewire in cycle 2. Two workspaces
tests pinned the seeded set at 5; they now expect 6 (retail-pos is a
first-class workspace per the ADR).

**Verify:** oz-core lib 1697/1697 (assignments 12/12, migration_128 1/1,
expected_tables), staff_integration 25/25, both clients compile, fmt +
clippy -D warnings + drift guard clean. `test-changed.sh` still blocked by
running app binaries (documented in rounds 172-176).

**Commits:** `3447c0cf` (feat: assignment model + migration 128).

**Risks / follow-ups:** cycle 2 wires the gate + create_staff writes to
assignments, seeds the five-role taxonomy (Owner/Admin/Auditor), retires
cashier/kitchen via a second migration, and sweeps the role-id test seeds
across both clients; cycle 3 is the UI (five-role list, assignment editor,
i18n, staff IPC contract test). `role-staff` grants must cover the folded
cashier/kitchen operational keys once the gate reads assignments.

### 2026-08-11 — 0048 cycle 2a: five-role taxonomy seeds + 2b: assignment-aware gate (round 178)

**Problem:** D4's five-role taxonomy did not exist (only Owner/Manager/
Cashier/Kitchen/Staff/Custom), and the 0047 gate still resolved the role
from `users.role_id`, ignoring the assignments migration 128 created — so
the assignment model was a parallel structure with no consumer.

**Solution (2a — taxonomy, additive):** `rbac.rs` gains `role-admin` and
`role-auditor` presets (Admin = the operational set + role management +
plugins, explicit list never `*`, staff:delete stays owner-only per D4's
"irreversible org actions"; Auditor = read-only view keys, no exports, no
writes). Staff AND Manager gain `kds:view`/`kds:update` so folded kitchen
users keep KDS access through role-staff (and managers oversee kitchens).
Cashier/kitchen presets remain during the transition; their removal is the
next step with the seed sweep.

**Solution (2b — assignment-aware gate):** `Store::require_permission`
resolves the role through the user's assignment first, falling back to
`users.role_id` for legacy users — behavior-identical for every existing
user (no assignments yet in fixtures). New `Store::require_permission_scoped`
evaluates `matches_scope` for scoped assignments (deny when branch/workspace
out of scope; global + legacy ignore scope). `create_user` now writes a
default global assignment and `update_user` keeps the assignment role in
sync (scope columns/rows preserved via ON CONFLICT role-only update). Both
clients' `authz.rs` gain `require_permission_for_user_scoped`; the existing
wrapper is unchanged in signature and now assignment-aware underneath.

**Verify:** platform-core 236/236 (preset tests incl. new admin/auditor
tests), oz-core lib 1705/1705 (8 new gate/write tests, Red proven first),
desktop authz+staff 46/46, tablet authz+staff 24/24, staff_integration
25/25, fmt + clippy -D warnings (all four crates) + drift guard clean.
`list_roles_seeded` updated for the 8 seeded roles (admin/auditor added).

**Commits:** `5dacef8e` (taxonomy), `054b3f7c` (gate rewire).

**Risks / follow-ups:** cashier/kitchen presets are still seeded — the
retirement (migration 129 + preset removal + the ~22-file role-id seed
sweep across both clients) is the next cycle step; the scope-aware gate is
available but no command adopts it yet (adoption happens where commands
carry branch/workspace context); the staff screen still lists six roles
(UI is cycle 3). Auditor's exports are deliberately excluded — revisit if
the product wants auditor-export.

### 2026-08-11 — 0049 c1: user profile schema + validation + store API

Problem: ADR #35 D6 (spec 0049) defines the user-profile data contract — 9
mandatory-at-creation items (username + full name on `users`, plus 8 new
profile fields) and optional fields — but `users` has none of the columns and
no field-level validation, so the staff screen cannot collect or round-trip
the contract.

Solution: migration 130 adds the 17 profile columns to `users` (nullable in
SQL — "mandatory" is enforced at creation, legacy rows enter the
incomplete-profile state instead of being rejected) plus unique indexes on
email and national_id ("unique when present": SQLite UNIQUE allows multiple
NULLs). New `db::profile` module: `UserProfile` with `is_complete()`
(8 required fields) and `validate()` (required-first field errors,
ssn=9/nik=16 digit shape, email well-formed, phone E.164 7..=14 digits,
DOB not in the future, pay strictly positive). Store API: `get_user_profile`,
`create_user_with_profile` (validates then inserts user + assignment +
profile in one transaction so a profile conflict rolls the user back),
`update_user_profile` (maps unique-index violations to field-level
`Conflict`). The D6 not-collected fields (gender, religion, marital status,
ethnicity, blood type, bank account, shift/availability) are absent from the
schema by design and pinned by the migration test.

Decisions: (1) nullable SQL + creation-time enforcement, not CHECK
constraints — keeps the incomplete-profile state reachable for legacy rows
and direct-SQL inserts; (2) phone capped at 14 digits after `+` per the
spec's pinned test (stricter than ITU-T's real 15-digit E.164 max);
(3) atomic create via `unchecked_transaction` — the duplicate-email test
exposed that a naive user-then-profile sequence leaves a partial row.

Commits: 6b76d3e0 (feat: profile schema + validation + store API)
Tests: 12 profile + 1 migration new; oz-core lib 1717/1717, staff_integration
25/25, fmt/clippy -D warnings/drift clean.

### 2026-08-11 — 0049 c2: sensitive keys + at-rest encryption, masking, read-audit, residency, retention gating

Problem: the profile columns from cycle 1 were plaintext at rest, readable by
anyone with `staff:read` (which the spec's sensitive fields must not ride),
and there was no masking, read-audit, residency, retention, or
incomplete-profile enforcement.

Solution: (2a) three sensitive registry keys — `staff:read_identity`,
`staff:read_payroll`, `staff:edit_notes` — classified sensitive (never
wildcard-eligible), granted to Manager/Admin/Staff presets, deliberately
withheld from Auditor, pinned by a registry test. (2b) In oz-core:
`national_id` and `monthly_take_home_minor` are now encrypted at rest via new
domain-separated `crypto::encrypt_profile_field`/`decrypt_profile_field`
(static-key precedent, survives DB restore on another machine); a migration
131 `national_id_hash` column + unique index preserves "unique when present"
because nonce-randomised ciphertext would dodge the old index. New
`Store::get_user_profile_viewed_by` returns a `ProfileView` that withholds
full national_id/tax_id/pay without the explicit grants, always renders
national_id last-4 masked (`mask_last4`), audits every sensitive read
(`staff.identity.read` / `staff.payroll.read` — access, never values), and
fails closed on corrupt ciphertext. New `Store::assign_role_guarded` denies
management-role assignment when the target profile is incomplete and the new
role grants sensitive permissions (non-sensitive roles stay assignable so
legacy checkout users keep working). Retention pinned: deactivation never
deletes profile data. Residency pinned: sync `SnapshotUser` wire format has
no profile fields (test asserts the safe key set).

Deviations from the spec (journaled): "keyring-backed" became the repo's
actual precedent — `oz_core::crypto` AES-256-GCM domain-separated (oz-core
cannot depend on oz-security, which depends on oz-core); masking helper lives
in oz-core for the same reason, not `oz_security::mask`.

Commits: d9990925 (feat(perms): sensitive profile keys + preset grants),
abc7949e (feat(profile): encrypt, mask, audit, gate, retain)
Tests: 1 registry + 3 crypto + 6 profile + 1 migration + 1 sync new;
oz-core lib 1727/1727, platform-core 237/237, platform-sync 276/276,
fmt/clippy -D warnings/drift clean.

### 2026-08-11 — 0049 c3: profile IPC args + staff screen (masked ID, incomplete gating, contract test)

Problem: the profile contract from cycles 1-2 had no front-end: the staff
IPC args carried no profile fields, so creation could not collect the 9
mandatory items and the list/detail could not render the masked national id
or the incomplete-profile flag.

Solution: both clients' CreateStaffScopedArgs/UpdateStaffScopedArgs gain the
17 ADR #35 D6 profile fields. create_staff_scoped now goes through the
validating, transactional create_user_with_profile. update_staff_scoped runs
require_role_assignable (the incomplete-profile gate) and writes the profile
columns atomically inside its existing transaction via the new
transaction-safe write_user_profile, restoring the profile on
workspace-assignment rollback. New get_staff_profile_scoped command returns
the viewer-gated ProfileViewDto (full sensitive values only with
staff:read_identity / staff:read_payroll; reads audited by oz-core). The
staff screen collects all 17 fields with localized per-field validation of
the 9 mandatory ones, renders the masked national id column, flags
incomplete profiles with a badge, and disables the role + workspace
assignment controls for incomplete members; the api-staff-contract test pins
the new wire shape; i18n keys land in both bundles (parity verified).

Decisions: (1) transaction-safe write_user_profile — update_user_profile
opened its own transaction, which would nest-BEGIN inside the client's
update transaction; the shared single-statement write is safe in both
contexts. (2) The incomplete gate only fires when the role actually changes
(re-saving the same role is not a new grant) — otherwise every edit of an
owner's name would be denied for legacy rows. (3) UI form collects the full
17-field set (matching the agreed optional list); a disabled fieldset drops
its children from the a11y tree, so the incomplete-disabled assertion targets
the fieldset role.

Commits: ecae8b52 (feat(profile): staff IPC profile fields + viewer-gated
profile command + staff screen), 57e98628 (feat(ui): staff profile form),
0a909c4b (docs(0049): spec progress)
Tests: desktop staff 40/40, tablet staff 19/19, UI screen 17/17,
contract 4/4; oz-core 1727/1727, platform-core 237/237, platform-sync
276/276; fmt/clippy (changed area)/bundle-parity/drift clean. Two pre-existing
clippy errors in topology.rs (untouched) noted.

### 2026-08-11 — 0048 2c: retire cashier/kitchen roles + seed sweep

Problem: the five-role taxonomy (Owner/Admin/Auditor/Manager/Staff/Custom)
was live, but the legacy `role-cashier` / `role-kitchen` role rows, presets,
constants, and ~22 seed fixtures still referenced them — the taxonomy was
half-retired. Migration 129 removed the rows, so every fixture seeding those
ids violated the FK at test time.

Solution: completed the retirement in one sweep:
- Migration `129` re-points `users.role_id` and `assignments.role_id` from
  cashier/kitchen to `role-staff` and deletes the role rows (idempotent).
- platform-core: CASHIER/KITCHEN constants, presets, and their index
  assertions removed; regression test pins no preset id is cashier/kitchen.
- Seed sweep with two mappings: **staff-like fixtures → `role-staff`**
  (shifts, sales, reports, session, integrations, auth, tax/settings — the
  latter two because staff still lacks settings:*) and **limited-access
  assertions → a narrow custom `role-lite`** (gate/loyalty/inventory/customer/
  category/transfer/topology/workspace/staff denial tests, which pinned
  cashier's narrow grants that role-staff now supersedes).
- The staff command tests needed a second distinction: update-target args use
  `role-lite` (same role → the incomplete-profile gate skips), create-target
  args use `role-staff` (an existing preset).
- gate_audit census pins for staff.rs bumped 5→6: 0049 cycle 3's
  `get_staff_profile_scoped` added a gate call without updating the pin —
  the deliberate-pin review signal caught it.

Decisions: (1) `role-lite` is a per-fixture custom role with exactly the
grant the test needs, NOT a new taxonomy role — it is never seeded by
presets. (2) Kept the migration-128 round-trip test's legacy cashier/kitchen
seed data — it tests the migration itself and is the correct historical
record. (3) `modules/staff` CASHIER/KITCHEN consts were dead code — removed.
(4) Did NOT fix the pre-existing topology.rs clippy errors (MutexGuard across
await, assert_eq literal bool) — unchanged from HEAD, outside this slice.

Commits: 880be215 (feat(rbac): retire cashier/kitchen roles + sweep), df3c30ae (docs)
Tests: oz-core 1728/1728, platform-core 236/236, platform-sync, both clients
(890 + 428), oz-api/oz-cli, gate_audit 3/3; fmt/clippy (changed area)/drift
guard clean. Note: `modules-inventory` currently does not compile — another
agent's in-flight ADR #36/37 field additions (models.rs has new Product
fields, repository.rs not yet updated); unrelated to this slice, left
untouched.

### 2026-08-11 — 0048 cycle 3: assignment write path + five-role staff screen

Problem: the assignment model (migration 128) had no write path — `set_user_workspaces_legacy` still wrote the STORE-scoped legacy tables, so the staff screen could never express `scope_mode` or the branch dimension, and `list_roles_scoped` returned every DB role instead of the ADR #35 D4 taxonomy.

Solution:
- oz-core: `Store::set_assignment` (transactional) + `write_assignment_scope` (in-tx writer, joins an open transaction — no nested BEGIN), both replacing the dimension rows so toggling list→all never leaves stale grants; `create_user_with_profile` takes an optional `AssignmentSpec` so a scoped assignment is atomic with user creation. Red-first: `set_assignment_writes_scoped_dimensions`, `set_assignment_replaces_existing_scope_and_clears_stale_rows`, `write_assignment_scope_joins_an_open_transaction`.
- Both clients: `AssignmentDto` on `StaffMemberDto` (legacy users resolve global all/all), optional `assignment` args on create/update, written inside the existing update transaction (profile + role + scope are one commit now — no compensation needed for the new model; the legacy `workspace_keys` path stays for compat).
- UI: the role dropdown filters to the five preset ids in Owner→Auditor order (custom roles have no UI per 0048 non-goals); the assignment editor gained scope_mode radios and per-dimension branch (store profiles) + workspace pickers with explicit all/list; save blocks an empty list dimension; the workspace table column derives from the DTO assignment (dropped the per-member `get_user_workspaces_scoped` round trips). i18n keys in both bundles; `api-staff-contract` pins the wire shape (7/7); screen tests 21/21 (taxonomy, pre-fill, scoped save, empty-list block).

Decisions:
- Branch picker source is `list_store_profiles` (store_profiles.id is the branch id the assignment model scopes on — no FK, semantic reference per ADR #35 D5).
- The editor stays edit-only (as before); create keeps the default global assignment unless args carry one.
- The assignment write deliberately REPLACES the legacy store-DB workspace write for UI callers, but `workspace_keys` remains on the wire for backward compat (the workspace login picker still reads legacy tables).

Remaining risks / follow-ups:
- The workspace LOGIN picker still resolves legacy `user_workspaces`/instances; a future slice can rewire it to the assignment model (audit/06 territory).
- The legacy `workspace_keys` arg is now dead UI-side; removing it from the wire is a compat decision for a later slice.
- Two unblocking fixes land in the worktree only (NOT committed): cache.rs test literals and both clients' products.rs fixture completed for the other agent's in-flight ADR #36 fields — they compile only with that WIP present, so they must ride with it.

Commits: ea826188 (feat(rbac): assignment write path + DTO surface), 782a6bc0 (feat(rbac): five-role staff screen + assignment editor), 0c32994e (docs)
Tests: oz-core 1746/1746 (assignments 13, profile 17), desktop 893/893 (staff 41), tablet 429/429 (staff 19), gate_audit 3/3, contract 7/7, staff screen 21/21; fmt/clippy (changed area)/drift/bundle-parity/i18n-lint all clean.

### 2026-08-11 — 0048 closed out to _done

All five cycles (1 schema, 2a taxonomy, 2b gate, 2c retirement, 3
write path + UI) shipped and verified: oz-core 1746/1746, desktop
893/893, tablet 429/429, gate_audit 3/3, contract 7/7, screen 21/21,
fmt/clippy/drift/parity clean. spec.yaml flipped to `implemented`;
folder moved to `docs/specs/_done/0048-rbac-assignment-model-and-taxonomy`.
Remaining follow-ups recorded in the cycle-3 entry: the workspace login
picker still resolves legacy tables (audit/06 territory) and the legacy
`workspace_keys` arg is now dead UI-side.

### 2026-08-11 — picker rewire: scoped assignments constrain the login picker

Problem: the pre-session workspace picker (`list_workspaces` via picker
ticket) resolved workspaces through the legacy model only — role
workspace types, user_store_access, explicit instance assignment — so a
scoped assignment set in the 0048 staff editor had no effect on what a
member could pick at login.

Solution: both clients' `list_workspaces` now load the user's assignment
from the global identity DB alongside the real role and scope-filter the
legacy listing through `matches_scope(store_id, type_key)` — the store
(branch) and the workspace type must both be in scope, fail closed.
Global assignments and legacy users without an assignment row pass
through unchanged. Red-first: `scoped_assignment_filters_picker_workspace_list`
(owner scoped to store-pos must not see the kds instance) and
`scoped_assignment_branch_dimension_denies_out_of_scope_store` (store-b
lists nothing) on both clients.

Decisions: workspace key == instance type_key (the vocabulary the ADR's
`workspaces(key)` dimension uses), branch == store_profiles.id (the
requested store). Filtering happens after the legacy resolution so the
owner bypass / store access / role types still apply first.

Remaining risks / follow-ups: the POST-session listings
(`list_workspaces_scoped`, `list_workspaces_for_store_scoped`) and the
session gate (`require_permission_for_session` → non-scoped
`require_permission_for_user`) are not yet assignment-aware — a scoped
member could switch workspaces within their session into an
out-of-scope type. A "scoped sessions" slice should extend the gate and
the session-scoped listings.

Commits: fdafcd73 (code), 53b30d02 (docs)
Tests: desktop 895/895 (workspaces 20 incl. 2 new), tablet 431/431
(workspaces 16 incl. 2 new); fmt/clippy/drift clean.

### 2026-08-11 — Sessions assignment-aware end to end (0048 follow-up)

Problem: the pre-session picker was scope-filtered, but after login a scoped
member could still operate through the session gate and the session-scoped
listings — `require_permission_for_session` used the non-scoped
`require_permission_for_user`, and `list_workspaces_scoped` /
`list_workspaces_for_store_scoped` returned every instance the role could see.
The scope wall stopped at login.

Solution: TDD red/green on the desktop client (the tablet has no
session-scoped listings or session gate — its boot flow was already
assignment-filtered in the picker slice).
- `require_permission_for_session` now delegates to
  `require_permission_for_user_scoped` with the session's `store_id` (branch)
  and `type_key` (workspace) — ~78 session-gated commands become scope-aware
  in one place. Scoped assignments deny when the session context is out of
  scope; global assignments and legacy users (no assignment row) pass
  unchanged.
- Both listings load the caller's assignment from the global identity DB and
  filter through `matches_scope(store_id, type_key)`: an out-of-scope store
  lists nothing (fail closed) and an out-of-scope workspace type is hidden,
  so the terminal-management screen can't switch a scoped member sideways.
- Red tests: session-gate workspace-dimension denial, branch-dimension
  denial, legacy/global pass-through; listing workspace + branch filters.
  `restaurant-pos` is the out-of-scope fixture type because the Free tier
  allows it — tier entitlement filtering alone cannot hide it, only the
  assignment can.

Decision: switched the existing session gate in place (one function, ~78
call sites) instead of adding a parallel scope-aware variant — a parallel
variant would leave the default gate un-scoped, which is exactly the hole
this slice closes. The gate reads the session's resolved context, so a
scoped member's session can never be in a store/type their assignment does
not cover (the picker now prevents minting one; a stale or bound session is
denied fail-closed on the first command).

Also repaired: the gate_audit census drifted at HEAD — the other agent's
ADR #36/#37/#38 `browser` module (committed 2913d49c, zero permission-gated
commands) was never added to either client's pinned census, failing
`desktop_command_census_matches_pin` / `tablet_command_census_matches_pin`.
Added `("browser", 0, &[])` to both pins (census is fail-closed on
unpinned modules).

Commits: fdafcd73 (code), 53b30d02 (docs)
Tests: desktop lib 901/901 (authz 9 incl. 3 new, workspaces 23 incl. 3 new),
gate_audit 3/3; fmt/clippy/drift clean. NOTE: the working tree currently
does not compile — another agent's in-flight `reports.rs` / `oz_reporting`
change (ReportingError without an AppError From impl, landed 21:18 after
this verification) blocks oz-pos-app. My committed state was green before
it landed; their files are untouched.

### 2026-08-11 — Retire the legacy workspace surface (0048 follow-up)

Problem: after the assignment model (ADR #35 D5 / spec 0048) went end to
end, the legacy `user_workspaces` key-based surface was dead weight with
three stale entry points: `workspace_keys` on the staff update args (STAFF-05
wrote it to the STORE-scoped DB via `set_user_workspaces_legacy`, needing the
cross-DB compensation block), the `set_user_workspaces_scoped` /
`get_user_workspaces_scoped` commands (zero UI callers), and the legacy
oz-core write methods.

Solution: TDD red/green on the retirement — the census pin is the spec. Set
the desktop workspaces.rs pin 8 -> 6, watched the census fail, then removed:
- `set_user_workspaces_scoped` / `get_user_workspaces_scoped` + their
  unscoped stubs + lib.rs registrations + wiring_audit entries (the
  instance-based `*_workspace_instances*` commands stay — that table is still
  read by `list_workspaces_inner`, so it is NOT fully superseded).
- `workspace_keys` from `UpdateStaffScopedArgs` (both clients; the create
  args never had it) and the whole STAFF-05 store-DB write + compensation
  block — the profile, PIN, and assignment now ride ONE global-DB
  transaction, so a failure rolls everything back atomically (previously
  pinned by the now-deleted `scoped_update_staff_rolls_back_profile_when_workspace_assignment_fails`
  test; the atomicity is pinned structurally by oz-core's in-tx writer test).
- `set_user_workspaces_legacy` / `get_user_workspace_keys_legacy` from
  oz-core + their tests; `list_workspaces_legacy_with_user_override` now
  seeds the row via direct SQL so the legacy READER stays pinned. The
  `user_workspaces` table itself is kept (still read by `list_workspaces_legacy`).
- `workspace_keys` from the TS `UpdateStaffScopedArgs`, the two api functions,
  and the stale dev-mock / screen-test mock cases.

Also fixed a pre-existing gap found by the full UI suite: commit 57e98628
(0049 c3) added the profile-form classes `staff-mgmt-incomplete-badge`,
`staff-mgmt-incomplete-hint`, `staff-mgmt-profile-section`,
`staff-mgmt-field-error` with NO CSS rules — the screenExtraction integrity
test had been red since then and the form rendered unstyled. Added the
missing rules matching the design tokens (--color-warning / --color-danger).

Decision: did NOT drop the `user_workspaces` table or the legacy READERS
(`list_workspaces_legacy` / `list_all_workspace_types` — the latter still
feeds the live `list_all_workspaces_scoped` admin dropdown from the old
`workspaces` table). Those are a separate "old tables" surface; the natural
follow-up is to migrate `list_all_workspaces_scoped` onto the new
`workspace_types` table and then drop the old tables with a migration.

Note: my dev-mock removal of the two legacy command mocks rode into the
other agent's `3236d8bf` commit (they swept the file) — end state correct.

Commits: 9d7d5f9d (code), 9e1814d5 (docs)
Tests: oz-core 1749/1749 (workspaces 52), desktop 900/900, tablet 431/431,
gate_audit 3/3, wiring_audit 6/6, UI 4874/4874 (283 files) incl. staff
screen 21 + contract 7 + screenExtraction 138; fmt/clippy/drift clean.

### 2026-08-11 — Staff analytics page (analytics:view)

Problem: owner/admin/manager had no consolidated per-staff view of shifts and
sales over time — the data existed across `shifts` and `sales` in each
store-scoped DB but nothing aggregated it per staff member, and the UI role
gates silently ignored `admin` (a taxonomy gap: an Admin session saw zero
manager-gated nav items).

Solution: a new analytics surface built on the 0046 registry + 0048 scopes.
- oz-core `db::analytics`: `staff_analytics_summary` (per-staff shifts, closed
  shifts, shift sales, completed sale count/total) and `staff_analytics_daily`
  (per-day series for one staff member). Both join `shifts`/`sales` by
  `user_id`, zero-fill the missing side, respect the date range, and exclude
  pending/voided/no-cashier sales. 7 tests, Red-first.
- `analytics:view` permission const + registry entry; preset grants to
  Owner/Admin/Manager only (Staff deliberately excluded — a taxonomy
  decision, not an oversight). platform-core preset test pins Staff = Manager
  minus settings minus analytics.
- Both clients: `get_staff_analytics_scoped` / `get_staff_analytics_daily_scoped`
  gated by the scope-aware session gate with display-name enrichment from the
  GLOBAL identity DB. The tablet had NO session gate at all — added
  `require_permission_for_session` mirroring the desktop (scope-aware) so the
  analytics commands enforce the same fail-closed scope there.
- UI: AnalyticsScreen (summary table + daily series + date range + staff
  select), nav under a new `management` required-role level
  (owner/admin/manager, excluding staff). The legacy `'manager'` gate keeps
  staff (backend grants Staff REPORTS_VIEW / SHIFTS_VIEW_ANY); `'management'`
  is the new tighter tier. Fixed `hasRequiredRole`/`hasNavRole`/AuthContext
  to recognize `admin`/`role-admin` (before, an Admin saw nothing gated).
- i18n in new `analytics.ftl`/`analytics.id.ftl` (parity + i18n lint clean);
  `nav-analytics` in both shared bundles.

Decisions / tradeoffs:
- Chose a `management` role level over reusing `'manager'` because the legacy
  gate includes staff; reusing it would have leaked analytics to staff.
- The UI gates on role names, not permission keys (the session DTO carries
  only `role_name`). Carrying the granted permission keys on the session DTO
  would let the UI mirror the backend exactly — flagged as a follow-up.
- Kept the analytics aggregates in store-scoped DBs (per-store by design);
  the GLOBAL identity DB is only read for display names.

Commits: 7a042477 (backend), bd9465a9 (ui), docs (this commit)
Tests: oz-core 1758/1758 (analytics 7), platform-core 236/236, desktop
905/905 (analytics+authz 14, gate_audit 3, wiring_audit 6), tablet 434/434,
UI 4884/4884 (285 files) incl. AnalyticsScreen 6 + contract 2 +
screenExtraction 138; typecheck 0, fmt/clippy/drift/i18n-parity clean.

### 2026-08-11 — Granted permission keys ride the login session (0046)

Problem: the UI gated analytics (and would gate future permission-based
features) on role-name strings, because the session DTO carried only
`role_name`. That diverged from the backend registry the moment a custom
role granted a key its role name doesn't imply — and it forced the role
gates to hand-maintain the taxonomy.

Solution: carry the role's granted permission keys on the session, verbatim
from the role's permissions JSON, and make the UI gate on them when present.
- `LoginSession` (platform-core auth) gains `permissions: Vec<String>` with
  `#[serde(default)]` so older persisted sessions / older clients still
  parse. `modules_staff::models::Role::permission_keys()` parses the JSON
  (malformed -> empty, authorizes nothing). Both clients populate it at
  `staff_login` and `bootstrap_owner`.
- UI: `LoginSessionDto.permissions: string[]`; new `hasGrantedPermission`
  TS helper that EXACTLY mirrors the backend `has_permission` wildcard
  semantics (`*`, `<domain>:*`) — a naive `includes` would deny the Owner,
  whose preset grants `["*"]`. Page/Nav registrations accept an optional
  `requiredPermission`; `passesGate` makes the permission check
  authoritative when the session carries keys and falls back to
  `requiredRole` otherwise (mocks/tests). AppShell/TabletAppShell thread
  `session.permissions` into `getEnabledPages`/`getNavItems`/`isPageAccessible`
  via conditional spread (exactOptionalPropertyTypes). The analytics page
  now registers `requiredPermission: 'analytics:view'` alongside
  `requiredRole: 'management'`; dev-mock login fixtures return realistic
  grants (owner `["*"]`, manager incl. analytics, cashier without).

Decisions / tradeoffs:
- Kept `requiredRole` as the fallback path rather than deleting it: dev-mock
  and older test fixtures without keys still resolve, and it preserves the
  existing role-gate tests. When a session IS present the permission check
  is authoritative (an explicit empty list denies — never an implicit grant).
- The DTO carries the RAW keys (including `*`) and the UI applies wildcard
  semantics, so the UI mirrors the backend exactly and stays correct if a
  preset's grant set changes.
- Red discipline note: a struct-field addition's Red is inherently a compile
  failure, so I scaffolded the field + fixtures first (mechanical), then the
  behavioral tests (staff_login returns `["*"]` for owner, round-trip,
  malformed-JSON) pinned the new behavior before wiring the population.

Commits: dcf576e0 (backend), 3e0b32b5 (ui), docs (this commit)
Tests: platform-core 237, modules-staff 12 (permission_keys 3), desktop
auth+staff 56, tablet auth+staff 29, gate_audit 3, wiring_audit 6; UI
AnalyticsScreen 9 (gate + hasGrantedPermission) + shells/auth/workspace 77;
typecheck 0, fmt/clippy/drift/i18n-parity clean.

### 2026-08-11 — Permission-aware PermissionDenied screen

Problem: after the session began carrying granted permission keys (0046),
the analytics page (and any future permission-gated page) was refused by a
`PermissionDenied` screen that only said "X requires a <role> role". That
was misleading — the real gate is the registry grant, not the role name,
and a custom role could be denied despite a manager-level role name.

Solution: `PermissionDenied` accepts an optional `requiredPermission`. When
set, it reports "You don't have permission to access {action}" and shows
the raw key (e.g. `analytics:view`) as a muted mono diagnostic line so an
admin can see exactly which grant is missing; without it, the original
role message renders unchanged. Both shells pass the page registration's
`requiredPermission` through. New `permission-denied-perm-desc` /
`permission-denied-perm-key` strings in both shared bundles (parity clean);
the key line uses the existing `permission-denied-key` class (screenExtraction
clean). The prop is declared `string | undefined` to satisfy
exactOptionalPropertyTypes when a page registration has no key.

Red-first: the new test asserted the permission message + key line render
and the role message is absent, and failed before the component change.

Commits: a25f31fb
Tests: PermissionDenied 10, screenExtraction 138, full UI 4890/4890 (285
files); typecheck 0, fmt/clippy/drift/i18n-parity clean.

### 2026-08-11 — Role grants visible in the staff screen (0046)

Problem: an admin could pick a role for a staff member but had no way to
see what that role could actually do — the permission registry (0046)
stayed invisible behind the backend gate.

Solution: `list_roles_scoped` now carries each role's granted permission
keys verbatim (`RoleDto.permissions` via `Role::permission_keys()`, the
same resolution the login session uses), and the staff editor renders the
selected role's keys as read-only mono chips under the role selector.
Owner shows `*`, manager shows its exact grants, staff its narrow set —
what you see is the registry, not a hand-maintained list. Both clients
mirror the DTO; dev-mock roles return realistic grants; new
`staff-role-permissions-label` strings in both staff bundles (parity
clean); chips use the `--color-bg-subtle` token fallback pattern already
established in this file.

Red-first: the desktop Rust test pinned Owner -> `["*"]` and a narrow
custom role -> `["sales:view"]` and failed on empty lists before the
mapping was wired (partial-move fix: compute `permission_keys()` before
moving `r.description`). UI: the screen test asserts the chip row renders
for a selected role, swaps on role change, and is absent before
selection; the contract test pins `list_roles_scoped`'s sessionToken +
no-args shape and the returned grants.

Commits: a4aa2e23 (backend), 29215c3a (ui + docs)
Tests: desktop staff 41, tablet 435, gate_audit 3, wiring_audit 6; UI
4893/4893 (285 files) incl. staff screen 22 + contract 8; typecheck 0,
fmt/clippy/drift/i18n-parity clean.
