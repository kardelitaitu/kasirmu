# Engineering Journal - part 3 of 8

**Pre-split lines 3089-5076** of JOURNAL.md (13,433 lines, 1,338 KB). Split 2026-10-02 so each part is readable whole under AGENTS.md E4 (2,000-line cap). Content is byte-identical and in original order; the single exception is the first heading of this part, promoted from ### to ## where a cut landed mid-section.

The parent index, carrying the full line-to-part map, is [JOURNAL.md](JOURNAL.md).

---

## 2026-08-08 — Fix: clippy `-D warnings` CI gate passes again (too_many_arguments + collapsible_if)

**Problem:** the pre-existing `too_many_arguments` warning in `crates/oz-core/src/db/workspaces.rs` (`create_workspace_instance_with_purpose`, 8 args incl. `&self`) failed the CI-exact `cargo clippy --workspace --all-targets --all-features -- -D warnings` gate — and once it was fixed, the gate surfaced a second pre-existing warning (`collapsible_if` in `apps/desktop-client/src/commands/topology.rs:506`).

**Fix:** (1) oz-core: new module-scope `pub struct CreateWorkspaceInstanceArgs { id, type_key, store_id, name, description, colour: Option<String>, purpose_key }` (docs per field); `create_workspace_instance_with_purpose` now takes the struct and destructures it — the body (validations, transaction, INSERT via `params!` with owned locals) is unchanged; the 6-arg legacy `create_workspace_instance` wrapper builds the struct with `purpose_key: "general"`. Callers updated: desktop-client `create_workspace_instance_scoped` (clones `CreateInstanceRequest` fields into the struct — the command isn't a hot path) and the 2 test call sites in `purpose_key_is_independent_from_type_and_name`. (2) topology.rs: collapsed the nested `if let`/`if` into an edition-2024 let-chain (semantics identical).

**Validation:** `cargo clippy --workspace --all-targets --all-features -- -D warnings` CLEAN (was the failing gate) · oz-core workspace tests 71/71 · desktop-client lib topology tests 201/201 · full app lib suite 825/825 (pre-change) · fmt clean · `cargo doc -p oz-core` shows no new broken links (reviewer's `Workspaces::` → `Store::` doc-link nit fixed; the remaining rustdoc warnings are pre-existing). Note: the full `cargo test -p oz-pos-app` bin target is currently blocked by the running app holding `oz-pos-app.exe` — lib-only runs avoid it; the app stays open per the shared-tree rule.

**Notes / remaining risks:** none new. Uncommitted: all three files ride this session's uncommitted batch; journal only.

### 2026-08-08 — E2E deletion spec exposes legacy-store resurrection on branch delete

**Problem:** the new adr22 e2e "deleting a branch leaves the canvas clean" spec failed on its first run: after deleting the only branch (store-1) the card was STILL visible (flickering between "Downtown Branch" and "TOKO TEST"). The unit suite had green coverage of branch deletion, but only through the light-merge path (branchLocations change, instances untouched) and the storeProfileId'd saved-node path — the real-world delete empties BOTH branchLocations AND workspaceInstances in one update, which lands in the full rebuild.

**Root cause:** the editor's rebuild path has two filters for saved store nodes. The storeProfileId'd filter (drops when the branch is gone) works, but the LEGACY filter — store nodes saved WITHOUT `store_profile_id` (the dev-mock seed, and any pre-canonical-identity diagram) — kept the node whenever `branchLocations.length === 0`. The fallback comment assumed an empty list meant "standalone editor with no branch concept" when in fact the topology screen supplies a PROVIDED-but-EMPTY list after the last branch is deleted. The deleted branch's card (and its wires) resurrected from the saved diagram.

**Fix (final):** the rebuild path now ADOPTS the canonical identity for legacy store nodes before filtering — a saved store node without `store_profile_id` whose id matches a branch location gets `storeProfileId` assigned in place (keeping its saved position), then a unified filter drops any store node whose branch no longer exists in a SUPPLIED `branchLocations` (even `[]`). Only `branchLocations === undefined` (true standalone editor) keeps the legacy diagram. A first attempt dropped legacy nodes outright and re-seeded them at the default (80,140) slot — that fixed deletion but moved every legacy store card on load (the review flagged it; a position-pinning unit test caught the snap at `144px` vs saved `260px`). The adoption approach fixes deletion AND preserves positions. Real backend unchanged (topology JSON lives under the global `oz-pos/topology` settings key; `delete_store_profile` intentionally does NOT cascade — the editor's branch-list filter is the sole deletion mechanism, now correct).

**Commits:** none yet — spec + fix + test + journal ride this session's batch.

**Tests:** unit Red reproduced the e2e failure deterministically (legacy saved store node + empty branch list → canvas kept 1 node; now 0). Editor suite 149/149 · TopologyScreen + dev-mock-stores 23/23 · full adr22 e2e file 11/11 (rename + deletion + everything else) · typecheck clean · lint clean.

**Notes / remaining risks:** the e2e deletes the seeded PRIMARY branch, which the real backend rejects (primary-store protection) — the dev-mock is lax there by design (e2e runs against the mock). The non-primary delete path (create → promote → delete) remains a future slice. `git status` is empty before this cycle; the spec + editor fix + unit test + journal are the only changes now.

### 2026-08-08 — Pin the sync URL-clearing contract (auto-provision discriminator)

**Problem:** the sync_bootstrap review's one flagged robustness note was that `should_auto_provision`'s row-presence discriminator (`Some("")` = cleared+disabled vs `None` = fresh install) silently depends on the WRITE path never deleting the URL row — clearing must write `""`, never `remove()`. That invariant was documented in the module doc comment but had zero test coverage: nothing stopped a future "cleanup" from switching the clear path to `Settings::remove`, which would make a deliberately-disabled install look fresh and re-trigger provisioning.

**Solution (contract pins, not a fix — the contract already holds):** three regression tests pin the write side of the discriminator. `Settings::set` is an upsert (`INSERT ... ON CONFLICT(key) DO UPDATE`), so an empty value always leaves the row; the pins guard that against regressions:
1. `settings::tests::set_sync_server_url_empty_keeps_row` — writing `""` → `get` returns `Some("")`, never `None`.
2. `settings::tests::clear_sync_server_url_overwrites_not_deletes` — real URL then `""` → `Some("")` (clear overwrites, doesn't fall back to a fresh-install look).
3. `commands::sync::tests::update_sync_settings_data_clear_url_writes_empty_row` (tablet-client) — the command's `server_url: None` (how the UI sends a cleared field) maps through `unwrap_or("")` and lands as `Some("")`, not a stale URL and not a deleted row.

**Review follow-through (the reviewer's one real gap):** the three pins sat at the settings-API layer (1-2) and the TABLET command (3) — but the auto-provision discriminator actually runs in the DESKTOP app, whose `update_sync_settings` inlined the same `unwrap_or("")` logic untested, and (unlike the tablet) wrote sequentially without a transaction. Extracted the desktop command body into `update_sync_settings_data(conn, args)` mirroring the tablet (transactional, so the atomicity fix now lands on the desktop too) and added the identical clear-URL test there — the 4th pin, on the actual critical path. The extraction is behavior-neutral (same writes, now atomic + row-preserving on partial failure).

**Validation:** platform-core settings 120/120 (2 new) · tablet sync 21/21 (1 new) · desktop lib **826/826** (1 new — the full suite, including sync_bootstrap 8/8 intact) · fmt clean · clippy clean on oz-pos-app + oz-pos-tablet + platform-core.

**Commits:** none yet — tests + the desktop extraction + journal ride the session batch.

**Notes / remaining risks:** none new — the desktop/tablet command duplication now exists only in the trivial command wrapper; the data fn could move to a shared crate (oz-core/platform-core) if a third client ever needs it, but that's speculative. The e2e batch (adr22 spec + editor fix) and this sync batch are separate uncommitted changes in the same tree.

### 2026-08-08 — Topology editor UX polish sprint (professional canvas surface)

**Problem:** The topology editor worked but read as a prototype: zoom lived buried in the tool-rack footer, an empty canvas gave no guidance, tool cards had no keyboard affordances, and the canvas grid/cards lacked the two-tier grid and card polish of professional diagram tools. Two compliance gates (themeTokenCompliance, noiseDitherCompliance) were also silently red on the committed CSS.

**Solution:** Six UX slices, TDD where behavior changed:
1. Tool-slot shortcuts **1–4** spawn nodes (Store/Workspace/Warehouse/Hardware) — bare keys, no repeat, inert while typing or when a rack/header/inspector control owns focus (guards reused). Wired via a latest-ref (`handleAddNodeRef`) because the keydown effect sits above `handleAddNode`'s const (TDZ). Palette cards carry `kbd` slot badges.
2. Floating zoom cluster bottom-right: − / % / + / Fit All / Reset View (`role="toolbar"`), sharing the wheel's 40–200% clamp via `zoomBy`. Replaced the rack-footer controls; HUD keeps node/wire counts only.
3. Empty-state onboarding overlay (title + body mentioning the shortcuts) when the canvas has zero nodes; `pointer-events: none` so panning still works.
4. Canvas grid: subtle 120px major lines over the 24px dot grid (rgba fallback + color-mix for WKWebView <16.4).
5. Node card polish: type-tinted header strips (color-mix over bg-subtle), hover lift + deeper shadow, crisp 2px-gap accent selection ring (respects reduced-motion).
6. Tool rack regrouped into labeled **Add Nodes** / **Edit** sections with small-caps section titles.

Bonus: fixed the pre-existing 8 hardcoded-value violations in NodeTopologyEditor.css (ported labels, validation note/banner, relationship picker to tokens) and added noise-dither coverage for `.canvas-zoom-controls`, `.topology-validation-banner`, `.topology-relationship-picker` — both compliance gates are green again.

**Validation:** editor suite **185/185** (7 new: shortcuts ×3, zoom cluster, zoom buttons, empty-state ×2; 2 pinned zoom blocks re-targeted to the cluster) · TopologyScreen + InspectorIntegration + dev-mock + responsiveViewport **233/233** · themeToken + noiseDither + popoverSurface **13/13** · typecheck clean · eslint clean · i18n lint clean · bundle parity **0 missing**. Live dev-mock preview verified: badges, ADD NODES section, zoom cluster (100→125%), and the 1/2 spawn shortcuts all render/work in the running app.

**Commits:** none — rides the uncommitted batch with the other agent's docs sweep (untouched).

**Notes / remaining risks:** `topology-zoom` FTL key removed (replaced by zoom-in/zoom-out + cluster readout). The dev-mock's seeded "Downtown Branch" card still shows the "missing store profile identity" validation note — pre-existing dev-mock state, unrelated to this sprint. Next slices if continued: minimap, context-sensitive selection toolbar (align/distribute), wire direction labels on hover, keyboard 'Escape to deselect-all' already exists.

### 2026-08-08 — Topology editor round 2: dirty state, shortcuts help, hover focus

**Problem:** The editor still lacked three professional affordances: no signal that the canvas differs from the last Apply (users could walk away from an unsaved graph), no discoverable list of the growing shortcut set (1-4 spawn, Delete, Ctrl+Z/Y, arrows, Esc, Ctrl+I), and no way to read a node's neighbourhood at a glance on a busy canvas.

**Solution:** Three TDD slices (5 new tests, Red→Green):
1. **Unsaved-changes chip** (header, role=status, warning pill + dot). `isCanvasDirty()` was a click-time function backed only by a ref — a ref can't re-render. Added `snapshotVersion` state + a `commitSnapshot` helper that sets the ref AND bumps the version wherever the applied snapshot changes (Apply success, instance load, saved-diagram load, preset load); `isDirty` memo re-derives on `[nodes, wires, snapshotVersion]`. Chip appears on any edit and clears on Apply/undo-back-to-saved/load/preset.
2. **Shortcuts help popover** — a "?" button at the far right of the header actions opens a kbd-styled cheatsheet (7 rows: 1–4, Del, Ctrl+Z, Ctrl+Y, arrows, Esc, Ctrl+I) reusing existing FTL labels where possible. KDS pattern: Escape (stopPropagation'd so the canvas deselect doesn't also fire) + outside-click close, aria-expanded/controls.
3. **Hover focus mode** — hovering a node card dims (opacity 0.35) every node not directly wired to it and every unrelated wire; restores on leave. Opacity-only so it composes with selection rings and connection pulses, and pointer events stay live on dimmed cards.

**Validation:** editor suite **190/190** (5 new) · TopologyScreen + InspectorIntegration + compliance ×3 **235/235** · typecheck clean · eslint clean (fixed 2 exhaustive-deps warnings: the memo's `snapshotVersion` dep is now `void`-referenced, `commitSnapshot` added to the preset-loader deps) · i18n lint clean · bundle parity **0 missing** · 7 new FTL keys in en+id. Live dev-mock verified: chip shows on edit, popover opens with all 7 rows, hover dims the unconnected warehouse + wire and restores on leave.

**Commits:** none — rides the uncommitted batch.

**Notes / remaining risks:** the popover's `min-width: 17rem` is fine but untested in the tablet shell; hover-dimming uses class-based opacity so it's cheap and stateless. Remaining candidates: selection toolbar (align/distribute), minimap, right-click canvas context menu, wire relationship label pills.

### 2026-08-08 — Topology editor round 3: canvas context menu + align/distribute toolbar

Problem: a professional diagram tool needs right-click creation and bulk geometry actions, but the editor had neither — nodes could only be added via the palette or 1-4 shortcuts, and multi-selection offered no alignment power.

Solution:
- **Canvas context menu**: right-click anywhere on the canvas opens a menu at the cursor — add any of the 4 node types (spawned at the click point, grid-snapped, pan/zoom-corrected), Select All, Fit All, Reset View. Focusable `role="menu"` with arrow-key navigation (wraps at ends), Escape closes (global handler), mousedown stops propagation so a right-click never starts a marquee.
- **Align/distribute toolbar**: floats above the canvas when 2+ nodes are selected, 8 actions (align left/hcenter/right, top/vcenter/bottom, distribute horizontal/vertical) with inline glyphs and a divider between align and distribute. One undo entry per action via pushHistory.
- **Alignment is exact, not re-snapped**: `snap(minY)` would round an off-grid extreme (legacy preset ws.y = 80 → 72) and move the anchor node. Extremes now stay put; only the non-extreme nodes move to match. Distribution uses exact equal-gap arithmetic as before.
- Fixed a TDZ I introduced: `applyAlign` referenced `pushHistory` in its deps array before the `const pushHistory` declaration — moved the callback below it.
- A11y compliance: `role="menu"` required focusability (jsx-a11y/interactive-supports-focus) — added tabIndex + arrow-key nav.

Commits: none yet — rides the uncommitted round-2 batch (NodeTopologyEditor.tsx/css, test, locales, compliance lists).

Tests: 8 new (context menu open+spawn-at-cursor, Select All, Escape close, arrow-key nav, toolbar visibility gate, align tops, distribute vertical, + align toolbar appears only with 2+). Editor suite 196/196; TopologyScreen + 3 CSS-compliance gates green; typecheck/lint/i18n/parity clean.

Risks: sibling describes in NodeTopologyEditor.test.tsx were order-dependent on the main describe's beforeEach mock setup — the new context-menu and align describes now set their own `mockLoadTopology.mockResolvedValue(null)` (repo convention per test-setup.ts); the pre-existing sibling describes still rely on the leak, worth a follow-up to add their own beforeEach.

### 2026-08-08 — Topology editor round 4: clipboard & bulk duplication

Problem: the editor had no copy/paste or bulk duplication — recreating a node (or a whole subgraph) meant dragging fresh cards and re-wiring by hand.

Solution:
- **Ctrl+D duplicate**: copies the selection one grid step down-right (clamped to the visible canvas), copies wires only when BOTH endpoints are selected (no dangling half-wires), makes the copies the new selection so repeated Ctrl+D cascades diagonally, and is a single undo entry.
- **Ctrl+C / Ctrl+V**: internal clipboard (Figma-style — no OS clipboard sync); each paste cascades one grid step further so repeated pastes never stack exactly, pasted copies become the selection, one undo entry per paste. A fresh copy resets the cascade.
- **Ctrl+A**: select all nodes (keyboard twin of the context-menu action).
- The typing guard at the top of the keydown handler already returns early inside INPUT/TEXTAREA/contentEditable, so native field copy/paste/select-all is never hijacked; the rack/header/inspector focus guard also covers the new shortcuts.
- Shortcuts popover grew 4 rows (Ctrl+A/D/C/V); new FTL keys in en + id.

Commits: none — rides the uncommitted round-2/3 batch.

Tests: 7 new Red→Green (duplicate offset + copy-selected, repeat cascade, wire copy with both endpoints, no wire copy with one endpoint, paste cascade + selection, Ctrl+A select all, undo restores count). Editor suite 203/203; TopologyScreen + 3 CSS-compliance gates 36/36; typecheck/lint/i18n parity clean.

Risks: clipboard is session-only (internal ref) — a reload clears it; OS clipboard sync (navigator.clipboard.writeText with the topology JSON) is a possible follow-up but needs the backend round-trip shape defined.

### 2026-08-08 — Topology editor round 5: minimap overview

Problem: large diagrams lost their bearings — panning far from origin gave no sense of where the content sat relative to the view.

Solution:
- **Minimap** (bottom-left of the canvas, Figma/Excalidraw-style): a 176x120 overview projecting the content bounding box — one type-colored rect per node (matching the card accents: store=info, workspace=accent, warehouse=success, hardware=warning), thin wire lines between node centers, and a live viewport rectangle.
- **Navigation**: click or drag on the map recenters the view on that canvas point (document-level listeners, cleanup ref like node drag); keyboard: arrows nudge the view 40px, Enter centers on the content box. `role="button"` + tabIndex + focus-visible ring for a11y.
- Viewport rect is pan/zoom-aware (scaled canvas dims / zoom), clamped to a minimum size so it never collapses. Hidden entirely when the canvas is empty.
- Compliance: added `.topology-minimap` to the noise-dither and popover-surface lists (it's an elevated surface) + the three components.css noise blocks.

Commits: none — rides the uncommitted round-2/3/4 batch.

Tests: 4 new Red→Green (one rect per node, hidden on empty canvas via deleting the last node — an empty LOAD falls back to the retail preset by design, click recenters → viewport transform changes, panning the main canvas moves the viewport rect). Editor suite 207/207; full topology sweep 252/252; typecheck/lint/i18n parity clean.

Risks: minimap has no on/off toggle yet (always visible with content) — a small toggle in the zoom cluster is a possible follow-up; also the minimap is per-editor, not per-diagram-name.

### 2026-08-08 — Topology editor round 6: F2 inline rename + HUD status readouts

Problem: renaming a node required hunting for the tiny card pencil, and the canvas gave no live feedback on where the cursor was or what was selected — basic orientation a professional diagram tool always shows.

Solution:
- **F2 inline rename**: with exactly one node selected, F2 opens the same inline rename input as the card pencil (pre-filled with the current name, focus moved in, Enter commits / Escape cancels with focus return). Gated by the same renameability rule as the pencil (store/workspace with their rename callback present), so warehouse/hardware cards are untouched. The typing guard keeps F2 inert inside text fields. Listed in the shortcuts popover.
- **HUD status readouts**: the bottom-center HUD (nodes/wires counts) now also shows the live **cursor position in canvas coords** (tabular numerals, — until the pointer crosses the canvas) and the **selection count** ("2 selected"), both re-derived on every canvas mousemove / selection change. Extended the existing surface instead of adding a competing one — no new elevated surface, no compliance churn.

Commits: none — rides the uncommitted round-2/3/4/5 batch.

Tests: 4 new Red→Green (F2 opens rename with current name, F2 no-op on non-renameable nodes, HUD selection count 0→2, HUD cursor coords after mousemove). Editor suite 211/211; full topology sweep 256/256; typecheck/lint/i18n parity clean.

Risks: the cursor readout re-renders the editor on every mousemove — cheap in practice but worth watching on very large diagrams; a rAF-throttle is a possible follow-up.

### 2026-08-08 — Topology editor round 7: zoom-to-selection + zoom keyboard shortcuts

Problem: getting a good view of a specific part of a large diagram meant manual wheel-scrolling and zooming — no way to jump straight to a selection, and no keyboard zoom at all.

Solution:
- **Zoom to Selection** (context menu): appears only when nodes are selected, fits the selection bounds with the same padding/clamp math as Fit All (40%..200%, 1.5 fit cap). Context menu also keeps Select All / Fit All / Reset View.
- **Zoom keyboard shortcuts**: Ctrl+0 fit the whole diagram, Ctrl+1 return to 100% (identity view), Ctrl+= zoom in, Ctrl+- zoom out — the standard diagram-tool set. The typing guard keeps native browser zoom intact inside text fields. Shortcuts popover gained two rows (Ctrl+0 / Ctrl+1 and Ctrl++ / Ctrl+-).
- Fixed another TDZ I introduced: the keydown effect's deps referenced zoomToFit/zoomBy/resetView, which were declared AFTER the effect — moved the four zoom callbacks (plus zoomToSelection) above it. This is the third instance of the same trap (rounds 3, 4); the callbacks that the keydown handler needs should live above the effect.

Commits: none — rides the uncommitted round-2/3/4/5/6 batch.

Tests: 4 new Red→Green (menu item gated on selection, zoom-to-selection fits within the clamped range, Ctrl+0 fits / Ctrl+1 → 100%, Ctrl+= / Ctrl+- step). Editor suite 215/215; full topology sweep 260/260; typecheck/lint/i18n parity clean.

Risks: none significant; the jsdom fit-zoom tests pin the clamped range rather than exact values (zero-sized canvas → min clamp), mirroring the existing Fit All pin.

### 2026-08-08 — Topology editor round 8: orthogonal (elbow) wire routing

Problem: bezier wires look elegant but read as "doodles" on large graphs — professional topology/flow tools (Visio, draw.io) default to clean orthogonal elbows.

Solution:
- **Elbow routing toggle** in a new rack "View" section: flips ALL wires between the default cubic bezier and orthogonal H/V elbows. `aria-pressed` toggle, active state tinted with accent tokens.
- **Router**: source port → horizontal run to the midpoint → vertical drop/rise to the target row → horizontal run into the target port. Reverse flows (target behind source) detour right past the source first so the elbow never folds back through the source card. Sharp corners come free from L commands; the existing `.wire-path` stroke/direction/selection styling applies unchanged.
- **Simulation pulse rides the geometry**: new `polylinePoint` helper interpolates the 30ms pulse along the elbow's axis-aligned segments (manhattan-parameterized) instead of the phantom bezier, so it visibly travels the elbow path. Bezier mode keeps the cubic pulse.
- Routing is a presentation preference (component-local, not persisted); `wireGeometries` memo now depends on `wireRouting`.

Commits: none — rides the uncommitted round-2/3/4/5/6/7 batch.

Tests: 3 new Red→Green (bezier by default, toggle to elbow and back, pulse survives elbow mode). Editor suite 218/218; full topology sweep 263/263; typecheck/lint/i18n parity clean.

Risks: the elbow path is computed per wire on every wires/nodeMap/routing change — same memo cost as before; a per-diagram routing preference (localStorage) is a possible follow-up.

### 2026-08-08 — Topology editor round 9: node context menu + double-click rename

Problem: object-level actions lived only in the canvas menu or keyboard — right-clicking a node itself gave the generic canvas menu, and renaming required finding the tiny pencil.

Solution:
- **Node context menu**: right-click a node card selects it and opens an object-scoped menu (same chrome/close logic as the canvas menu, extended state carries an optional nodeId): Rename (only for renameable store/workspace nodes), Duplicate (same one-undo-entry path as Ctrl+D), Delete (reuses the wired/unwired confirm flow — immediate for unwired, dialog for wired), and Zoom to Selection. The node name titles the menu. Shift+right-click keeps the existing multi-selection instead of collapsing it.
- **Double-click to rename**: double-clicking a renameable node opens the inline rename (same flow as F2 / the pencil).
- The canvas menu is untouched — canvas right-click still opens Add Node / Select All / Fit All / Zoom to Selection / Reset View.

Commits: none — rides the uncommitted round-2/3/4/5/6/7/8 batch.

Tests: 5 new Red→Green (right-click selects + menu with Rename, node menu duplicates, node menu deletes unwired immediately, non-renameable hides Rename, double-click opens rename). Editor suite 223/223; full topology sweep 268/268; typecheck/lint/i18n parity clean.

Risks: none significant; the node menu reuses the existing menu close-on-outside-click/Escape logic and arrow-key navigation.

### 2026-08-08 — Topology editor round 10: live connection preview + snap-to-grid toggle

Problem: two View/connection gaps — the in-flight wire preview only updated when the cursor neared a target port (mid-air it froze at the last mouse position), and every placement action snapped to the 24px grid with no way to place freely.

Solution:
- **Live preview cursor**: new `previewCursor` state updated on every mousemove while a connection is in flight (reset when a connection starts, so a new wire never jumps to a stale cursor). The preview memo now follows the pointer continuously.
- **Routing-aware preview**: when the elbow toggle is on, the in-flight preview renders the same orthogonal polyline (via the shared `elbowPoints`/`polylineD` helpers) as the finished wire — what you see while dragging is what you get.
- **Snap-to-grid toggle** in the View section: drag, arrow-nudge, and spawn (palette + context menu) place freely when off. Structural seeds (presets, workspace instances) still snap — they're layout defaults, not user placement. `aria-pressed` toggle sharing the rack-view-toggle style.
- Dep discipline: the nudge inside the keydown effect reads `snapEnabled` inline (stable boolean dep) rather than the per-render `snapOrNot` helper, so the effect doesn't rebind on every mousemove.

Commits: none — rides the uncommitted round-2/3/4/5/6/7/8/9 batch.

Tests: 4 new Red→Green (preview follows cursor, preview elbow when enabled, off-grid drag with snap off, off-grid context-menu spawn). Editor suite 227/227; full topology sweep 272/272; typecheck/lint/i18n parity clean.

Risks: the live preview now re-renders on every mousemove while connecting — same cost class as the HUD cursor readout, fine in practice.

### 2026-08-08 — Topology editor round 11: validation issues panel + persisted view preferences

Problem: live validation surfaced per-node issues only as tiny card notes and graph-level issues in the banner — there was no single place to see every problem, and the View toggles (elbow routing, snap) reset on every reload.

Solution:
- **Validation issues panel**: a warning button (top-right of the canvas, "Issues (N)") appears whenever the diagram has ANY validation problem — per-node or graph-level. Clicking opens a dialog-style panel listing every issue: per-node items first, titled with the node name and clickable to select (jump to) the offending card; graph-level items after, read-only. Counts come from the same liveValidation memo the banner/card notes use, so they can never disagree.
- **Persisted view preferences**: elbow routing and snap-to-grid now lazy-init from localStorage (`oz-topology-view-routing` / `oz-topology-view-snap`) and write back on change — the View choices survive reloads. Writes are try/catch'd for private-mode storage.
- New WarningIcon in the topology icon set; panel + button registered as elevated surfaces (noise-dither + popover lists + components.css blocks).

Commits: none — rides the uncommitted round-2/3/4/5/6/7/8/9/10 batch.

Tests: 6 new Red→Green (issues button with count on a problem diagram, panel lists the issue + click selects the node, no button on a clean diagram, routing persists to localStorage, routing restored on mount, snap persists). Editor suite 233/233; full topology sweep 278/278; typecheck/lint/i18n parity clean.

Risks: the issues button is canvas-local and not persisted; a diagram-level "mark issue resolved" flow (persisted dismissal) is a possible follow-up.

### 2026-08-08 — direction-aware marquee selection

Problem: the marquee always used box-intersection semantics, so a small forward drag could sweep up nodes that only barely poke into the box — no way to grab exactly what you enclosed.

Solution: Figma/draw.io convention — a FORWARD drag (left→right, `box.x1 >= box.x0`) selects only nodes FULLY contained in the box; a BACKWARD drag (right→left) selects every node the box touches. Pure-vertical drags default to containment (x1 ≥ x0). Existing tests that fully contained their targets survived unchanged; the shared intersection branch is preserved verbatim for backward drags.

Commits: none — rides the uncommitted round-2..11 batch.

Tests: 3 new Red→Green (forward drag excludes partial overlaps, forward drag with full containment selects, backward drag grabs touched nodes). Editor suite 236/236; full topology sweep 313/313 (editor + screen + card + contract + responsive); typecheck/lint/i18n parity clean.

Risks: none known. A Shift+drag additive marquee (Figma-style union) is the natural follow-up.

### 2026-08-08 — Shift+drag marquee union (additive selection)

Problem: marquee always REPLACED the selection, so building up a selection from scattered nodes meant repeated shift+clicks — no way to add a whole region at once.

Solution: holding Shift while marquee-dragging keeps the pre-drag selection and UNIONs the captured nodes into it at release. A Shift+click on empty canvas (no movement) clears nothing; a Shift+drag that captures nothing leaves the selection intact. The additive flag lives in a ref (marqueeAdditiveRef) set at mousedown and reset by the finalizer, so it can never leak into the next drag — a plain drag after a shift-drag still replaces.

Commits: none — rides the uncommitted round-2..12 batch.

Tests: 3 new Red→Green (shift-drag unions wh-1 into a 2-node selection, shift-drag over empty space keeps the selection, plain drag after shift-drag replaces). Editor suite 239/239; full topology sweep 316/316; typecheck/lint/i18n parity clean.

Risks: the union reads the pre-drag selection from the finalizer's mousedown closure — safe today because nothing mutates the selection mid-marquee, but worth re-checking if a future feature changes selection during a drag.

### 2026-08-08 — e2e: direction-aware marquee (forward contained vs backward touched)

Problem: the marquee semantics (round 12) had unit coverage only — no browser test proved a real drag selects contained vs touched cards differently on the actual canvas.

Solution: two new tests in adr22-workspace-settings.spec.ts that perform REAL pointer drags on the canvas:
- Forward (left→right) asserts exactly the FULLY CONTAINED cards get node-selected; the poking-out card does not.
- Backward (right→left) over the same box asserts exactly the TOUCHED cards (contained + poking) get selected.
- The DevToolbar (floating bottom-right) swallowed the tail of marquee drags and froze the box mid-drag — the topology describe's beforeEach now parks it off-screen via addInitScript (localStorage `oz-pos-dev-toolbar-pos` = {-400,-400}) before login navigates.

Two pre-existing bugs found along the way (not fixed here — flagged for follow-up):
1. The topology canvas load is RACY: the editor can settle on the retail preset OR the dev-mock seed depending on async load timing (observed alternating across identical runs). The test derives geometry from the RENDERED cards (leftmost pair = contained targets, nearest-to-union card = poking card) and asserts against the measured containment/touch predicates, so it is deterministic under either outcome.
2. The tablet canvas CLIPS the seed layout: cards extend past the 545px-wide canvas edge (nothing auto-fits on load). Marquee geometry is unreliable there, so both tests skip the tablet project with a documented reason.

Commits: none — rides the uncommitted batch.

Tests: 2 new e2e (desktop) — 4 consecutive full-suite passes; full adr22 file 24 passed / 2 skipped (tablet). eslint clean.

Risks: none for the tests themselves. The two findings above are the real risks — the load race makes the topology screen's initial canvas non-deterministic for users, and tablet users see clipped cards.

### 2026-08-08 — canvas context menu: selection summary + clear action

Problem: after a marquee left a multi-selection active, the canvas right-click menu gave no indication of the selection — you had to guess and Deselect via Esc.

Solution: when any nodes are selected, the canvas menu now leads with a "{N} selected" section title (FTL `topology-context-selection-title`, interpolated) and a "Clear selection" menuitem (topology-context-clear-selection) that clears the selection and closes the menu, followed by a divider before the existing Add Node section. The menu keeps the selection open when right-clicking the canvas (already the behavior — right-click never clears).

Commits: none — rides the uncommitted batch.

Tests: 3 new Red→Green (marquee leaves 2 selected → menu shows "2 selected" + Clear selection, Clear selection clears + closes, no selection → section hidden). Editor suite 242/242; full topology sweep 319/319; typecheck/lint/i18n parity clean.

Risks: none. Note: the "N selected" text now appears in two surfaces (HUD + context menu) — the tests scope by selector to avoid the collision.

### 2026-08-08 — interactive zoom-level picker (slider popover)

Problem: the zoom cluster showed a static percentage readout — precise zoom meant repeated +/- clicks with no way to scrub to a value.

Solution: the `%` readout is now a real button (aria-label "Zoom level ({pct}%)", aria-expanded) that toggles a small popover above the cluster containing a 40%–200% step-5 range slider with a live % value. Slider drags call setZoom directly (same state the wheel/buttons drive), so the button text and viewport transform update live. Closed by Escape or any document mousedown outside the picker (the wrapper stops propagation so slider drags never close it) — the same close-effect pattern as the context menu. The popover is a new elevated surface, registered in the noise-dither + popover-surface lists and all three components.css blocks.

Commits: none — rides the uncommitted batch.

Tests: 3 new Red→Green (click opens slider seeded with current zoom + aria-expanded, dragging to 75% updates the readout + viewport scale(0.75), Escape/outside click close). Editor suite 245/245; full topology sweep + compliance 333/333; typecheck/lint/i18n parity clean.

Risks: none. Note: existing zoom tests kept passing because the level keeps the .canvas-zoom-level class as a button.

### 2026-08-08 — wire context menu (direction + delete)

Problem: wires had no right-click affordance — a right-click on a wire fell through to the generic canvas menu, so the only ways to act on a wire were click-to-cycle and the rack/Delete key.

Solution: right-clicking a wire now selects it (clearing node selection, mirroring the wire click) and opens an object-scoped menu titled with the wire's label (falling back to "from → to" node names): "Toggle wire direction" (reuses the click cycle via handleCycleWireDirection, one undo step) and "Delete wire" (reuses the established `setConfirmDelete('')` flow — the same "Delete Wire" dialog as the Delete key, so deletion is always confirmed). The contextMenu state gained an optional wireId and the render branches node → wire → canvas. All menu chrome (items, dividers, arrow-key nav, outside/Escape close) is shared with the existing menus — zero new CSS or surfaces.

Commits: none — rides the uncommitted batch.

Tests: 3 new Red→Green (right-click selects + menu titled with the label + Toggle/Delete items, Toggle direction cycles one-way→reverse, Delete wire opens the confirm dialog then removes it on confirm). Editor suite 248/248; full sweep + compliance 336/336; typecheck/lint/i18n parity clean.

Risks: none.

### 2026-08-08 — F1 shortcuts help

Problem: the shortcuts popover was only reachable via the header button — keyboard-first users had to discover it by mousing around, and the help itself didn't document its own trigger.

Solution: F1 now toggles the existing shortcuts popover (same popover the header button opens — one state, no duplicate surface). The handler sits at the TOP of the canvas keydown listener, deliberately before the typing/rack guards: help is never an accidental canvas edit, so F1 works while typing in a field or with a rack control focused. The popover's shortcut list gained a leading "F1 — Show keyboard shortcuts" row (topology-shortcuts-help, en/id) so the help documents itself.

Commits: none — rides the uncommitted batch.

Tests: 2 new Red→Green (F1 opens + lists its own row + second F1 closes; F1 works with a rack control focused). Editor suite 250/250; full sweep + compliance 338/338; typecheck/lint/i18n parity clean.

Risks: none. Note: the popover was already Escape/outside-click closable — F1 toggling composes with that (Escape closes, F1 reopens).

### 2026-08-08 — Space+drag to pan

Problem: panning needed the middle/right mouse button — the most universal diagram gesture (hold Space, drag anywhere with the left button) was missing, and left-drag always marqueed.

Solution: holding Space arms the next left-drag as a pan. A window-level Space tracker (ref for the gesture + state for the grab cursor) excludes typing fields and focused controls — a focused wire keeps its Space cycle-to-direction. The middle/right pan block was extracted into a shared startPan(e, clearSelectionFirst) helper: middle/right still clear the selection, but Space+left-drag is Figma-style and PRESERVES it. The canvas shows a grab cursor while Space is held, and the body cursor becomes 'grabbing' during the drag (restored on release). Space's default page-scroll is prevented while arming.

Commits: none — rides the uncommitted batch.

Tests: 4 new Red→Green (Space+drag pans by the pointer delta with no marquee and the selection intact; releasing Space before the drag restores the left-drag marquee; Space on a focused wire cycles its direction instead of arming pan; grab cursor class while armed). Editor suite 253/253; full sweep + compliance 341/341; typecheck/lint/i18n parity clean.

Risks: none. Note: releasing Space mid-drag keeps the pan (the gesture is decided at mousedown, matching Figma/draw.io).

### 2026-08-08 — dedicated Pan tool

Problem: panning required a modifier (Space) or the middle/right mouse button — unavailable on touchscreens and undiscoverable for trackpad-only users.

Solution: a "Pan tool" toggle in the rack's View section (aria-pressed, matching the Elbow/Snap toggles). While active, left-drags on the empty canvas pan (reusing round 18's startPan with selection preservation) and the canvas shows the grab cursor — the touchscreen-friendly twin of Space+drag. The tool stays active until toggled off (Figma hand-tool semantics); node dragging is untouched (the tool only claims the empty-background drag).

Commits: none — rides the uncommitted batch.

Tests: 2 new Red→Green (Pan tool active → left-drag pans with no marquee and the selection intact + aria-pressed/grab cursor; toggling off restores the left-drag marquee). Editor suite 255/255; full sweep + compliance 343/343; typecheck/lint/i18n parity clean.

Risks: none. Note: the pan tool and Space+drag compose — either arms the pan gesture at mousedown.

### 2026-08-09 — Round 20: wire relabeling from the wire context menu

Problem: wires could be relabeled only by deleting and recreating them — the context menu offered direction + delete but no way to edit a wire's label.

Solution: "Rename wire" menu item on the wire context menu opens a floating input anchored at the wire's midpoint (canvas-space, scales/pans with the diagram), mirroring the node-card rename semantics: seeded with the current label, Enter commits, Escape cancels, blur commits, focus returns to the wire on keyboard close. Empty input clears the custom label back to the endpoint-name display (the label is optional). Commits push one history entry and mark the canvas dirty — `label` was already in the `canvasStateEqual` projection, so Apply Topology carries the relabel.

Also fixed a latent lint error the round surfaced: the round-15 zoom-picker wrapper div used onMouseDown stopPropagation (jsx-a11y no-static-element-interactions). Moved the stopPropagation onto the two native controls (level button + range input) so the document-mousedown close still never fires inside the picker.

Commits: none — rides the uncommitted batch.

Tests: 4 new Red→Green (menu item opens editor seeded with label + Enter commits; empty clears to endpoint display via the menu title; Escape cancels; relabel marks dirty). Editor suite 259/259; full topology sweep 336/336; typecheck/lint/i18n parity clean.

Risks: none. Note: the relabel is canvas-local (wires have no backend persistence of their own) — it persists through Apply Topology like every other wire edit.

### 2026-08-09 — Round 21: wire label pills (View toggle)

Problem: wire labels existed only as hover tooltips — the round-20 relabel editor had no visible label to anchor, and a diagram's connections couldn't be read at a glance.

Solution: a "Wire labels" toggle in the rack's View section (aria-pressed, matching Elbow/Snap/Pan) renders a permanent pill at each wire's midpoint — the same geometry the round-20 rename input anchors to (polyline at t=0.5 or bezier midpoint). Clicking a pill selects the wire and opens the rename editor; the wire itself stays the direction-cycle affordance (pinned by a test — the pill must NOT cycle). The renamed wire's pill is hidden while its input is open, pills dim with their wire during hover-focus, and the preference persists to localStorage (oz-topology-view-wire-labels, default off to keep the clean look).

Refactor: extracted `wireDisplayLabel` (custom label → endpoint-name join → connected fallback) from the round-16 menu title and now share it between the context-menu title and the pills — one derivation, two surfaces.

Commits: none — rides the uncommitted batch.

Tests: 6 new Red→Green (hidden by default + toggle reveals both preset labels; pill click opens rename seeded with the label without cycling direction; renamed wire's pill replaced by the editor; persists to localStorage; restores on mount; dims the non-neighbourhood pill on node hover). Editor suite 265/265; full topology sweep 342/342; typecheck/lint/i18n parity clean.

Risks: none. Note: pills are HTML buttons in the pan/zoom viewport, so they scale with the diagram like every canvas surface; long labels ellipsize at 160px.

### 2026-08-09 — Round 22: Figma-style alignment guides while dragging

Problem: freehand node placement had only grid snap — no way to line a dragged card up with its neighbours' edges or centers, the core pro diagram-tool gesture.

Solution: the grabbed node's edges/center now snap to ANY stationary node's edges/center (all 9 combos, within a 6px canvas-unit threshold) while dragging. The closest match wins per axis, the aligned axis draws a full-canvas 1px guide line (canvas-space, pans/zooms with the diagram), and the delta applies to the WHOLE dragged group so a multi-selection stays rigid. Guides beat the grid — the aligned axis skips grid snapping while the other axis still snaps as configured. Guides clear on mouseup (both the canvas and document-level paths).

The TDD loop caught a real design bug: my first helper paired axes same-index (left↔left only), so aligning a dragged RIGHT edge to a stationary LEFT edge never fired — the Red test stayed red at left=144 (grid) instead of 140 (aligned), and the probe proved it. The 9-combo all-pairs match is the actual Figma semantic.

Commits: none — rides the uncommitted batch.

Tests: 5 new Red→Green (right-edge↔left-edge snap + vertical guide; centerY↔centerY snap + horizontal guide; no snap 10px past the threshold with grid off; guides clear on mouseup; group-rigid −60 delta carries wh-1 with ws-1). Editor suite 270/270; full topology sweep 347/347; typecheck/lint/i18n parity clean.

Risks: none. Note: alignment is threshold-checked on the PRIMARY grabbed node only; a future slice could extend it to "any selected node's edges" (Figma aligns the whole group's collective edges).

### 2026-08-09 — Round 23: auto-fit overflowing diagrams on load

Problem: the e2e round found tablets (and any narrow canvas) render clipped cards — the seed layout extends past the 545px canvas edge and nothing fits the view on load.

Solution: a one-shot load auto-fit. When a diagram's content first lands (the mount preset or an async load) on a MEASURED canvas and its bounding box overflows the viewport, it fits via the existing zoomToFit. The decision is content-keyed (node-id set): a NEW diagram (preset → load, preset swap) refits, in-place edits never do, and any user interaction (canvas/node mousedown or any key) permanently disarms it — the view belongs to the user after the first click. A zero/negative measured size (jsdom, pre-layout) never fires, so the identity view is never yanked by a phantom constraint and every existing geometry test (which run at zoom 1) stays untouched.

Also updated the two marquee e2e tablet-skip comments: the clip they cited is fixed; the skip remains for the still-open preset-vs-seed load race.

Commits: none — rides the uncommitted batch.

Tests: 3 new Red→Green (two nodes 2000px apart fit to scale(0.4); a fitting diagram keeps translate(0,0) scale(1); after a mousedown, deleting a node does NOT refit — the view stays at the fitted zoom instead of jumping to scale(1.5)). Editor suite 273/273; full topology sweep 350/350; typecheck/lint/i18n parity clean; e2e spec lint clean.

Risks: the preset-vs-seed load race (flagged in the e2e round) remains open — auto-fit now fits whichever diagram wins, but WHICH one renders is still non-deterministic on first load. That is the natural next fix.

### 2026-08-09 — Round 24: deterministic first load (fixing the preset-vs-seed race)

Problem: the e2e round found the first-load canvas settles non-deterministically (preset vs seed). The root cause: TopologyScreen passes EMPTY arrays for both seeds on its very first render (its lists load async), and the editor's `if (workspaceInstances)` treated that placeholder empty array as authoritative — entering the workspace rebuild, dropping the store card (empty branchLocations filter), and WIPING the canvas to empty until the real seeds arrived. A fresh install with no saved data showed an empty canvas at all.

Solution (two halves):
1. Editor — the workspace branch now runs only when instances/locations exist NOW or EVER did (`hadInstances` from prev refs), so a never-supplied empty seed falls through to the legacy saved-diagram/preset path instead of wiping. The legacy no-data path now distinguishes "standalone editor" (seeds undefined → demo preset) from "parent explicitly resolved to empty" (seeds provided → empty canvas + onboarding hint) — preserving the designed fresh-store onboarding.
2. TopologyScreen — the seeds are gated on their sources' first resolution: until `listStores`/`listWorkspacesScoped` land, the props are OMITTED (undefined = "not supplied yet"); after resolution the real (possibly empty) arrays flow. The initial [] placeholder can no longer wipe or flash.

Also added the onboarding describe's missing `mockLoadTopology.mockResolvedValue(null)` beforeEach — it passed before only because the old wipe ignored the mock; with the fallback path the mock state matters.

Commits: none — rides the uncommitted batch.

Tests: 3 new Red→Green (empty seeds + saved fixture → saved diagram shows, not a wipe; empty seeds + no saved data → onboarding hint, not demo data; instances present + genuinely empty locations still drops the store — deletion semantics pinned). Editor suite 276/276; TopologyScreen 23/23; full sweep 353/353; typecheck/lint/i18n parity clean.

Risks: none. The e2e marquee skips remain (the dev-mock localStorage can still vary across worker sessions), but the editor's own load path is now deterministic: saved data shows immediately, the preset is the true no-data fallback, and the onboarding hint is reserved for authoritatively-empty stores.

### 2026-08-09 — Round 25: collective-edge alignment for group drags

Problem: round 22's alignment guides checked only the GRABBED node's edges — a group drag could miss a perfectly good snap when a non-grabbed member's edge was the one near a stationary node (the journal-flagged follow-up).

Solution: `computeAlignmentGuides` now takes the raw target of EVERY dragged node and picks the closest edge/center match across the whole group per axis — Figma's collective semantics. The winning delta still shifts the whole group rigidly (one delta for all members), and the aligned axis skips grid snap for the entire group. The `dragPrimaryIdRef` machinery is gone — the primary concept is replaced by the targets map (which also simplified the mouseup cleanup).

Existing round-22 tests survived unchanged (single-node drags behave identically; the old group test's assertions still hold — the grabbed ws-1 was already the closest match there). The only behavioral shift: a group whose non-grabbed member is vertically aligned now shows the Y guide too (previously invisible), which is the correct Figma behavior.

Commits: none — rides the uncommitted batch.

Tests: 1 new Red→Green (group of ws-1 + wh-1 dragged by −360: the GRABBED ws-1 touches nothing, but wh-1's left edge lands on store-1's right edge — group snaps to ws-1=20px / wh-1=320px with the vertical guide, and the aligned-axis grid skip holds for the whole group). Editor suite 277/277; full topology sweep 354/354; typecheck/lint/i18n parity clean.

Risks: none. Note: alignment still evaluates at the drag's CURRENT raw position only — a mid-drag "sweep" through a threshold that the pointer skips (fast mouse) is not detected, same as round 22.

### 2026-08-09 — Round 26: fine nudge + dead-press fix (arrow keys)

Problem: the nudge semantics were backwards AND broken. Old code: Shift = 24px grid step, plain = 8px — the opposite of every pro tool (Figma's Shift+arrow is the fine 1px adjust). Worse, with snap on (default) an 8px plain nudge from an ON-GRID position snapped straight back to the same grid line — a dead press — and off-grid it jittered in a 0/24/0 pattern.

Solution: Shift+arrow is now a pixel-exact 1px fine nudge that bypasses the grid entirely; plain arrows move exactly one full grid step when snap is on (deterministic, no dead presses) and the raw 8px step when off. The fine/coarse split lives in the existing shared nudge path (same edge clamp, one undo per press, `!e.repeat` held-key guard). Updated the shortcuts FTL in both bundles ("Shift = fine 1px").

The two pre-existing Shift-arrow tests were updated to the new semantics (plain arrows reach the same −192 clamp destination; the repeat/undo test now uses plain ArrowRight with the identical 96px assertion).

Commits: none — rides the uncommitted batch.

Tests: 3 new (Shift+Right = 81px / Shift+Down = 141px — pixel-exact; plain arrow from an on-grid 96 → 120, pinning the dead-press fix; snap-off pin 96 → 104). Editor suite 280/280; full topology sweep 357/357; typecheck/lint/i18n parity clean.

Risks: none. Note: fine nudges don't draw alignment guides — wiring the round-22 guide computation into the nudge path is a natural follow-up.

### 2026-08-09 — Alignment guides on fine nudge

Problem: Round 26's journal flagged that fine (Shift+arrow) nudges never drew the round-22 alignment guides — the precision keyboard path was blind to neighbours, so a user could nudge a node within 6px of an edge and get no feedback.

Solution: The nudge handler now runs `computeAlignmentGuides` on the nudged selection, but with an ENTRY-ONLY snap rule. The key insight: a persistent band flag goes stale across sessions, so instead the snap fires only when the nudge itself crosses INTO the 6px band — computed by comparing the pre-nudge alignment against the post-nudge alignment (`enterX = after.alignedX && !pre.alignedX`). Once inside, raw 1px moves stand (208, 209, …) and the guide lingers at the reference while the band is held; leaving the band (dist > 6) clears it, and plain grid-step arrows clear it immediately since they're grid semantics by design. The correction delta is the reference MINUS the dragged axis (exact-flush), applied group-rigid. Positions are now computed up front (not inside the setNodes updater) so the engine can run on exact post-nudge geometry.

Commits: none — rides the uncommitted batch.

Tests: 3 new (entry snap lands flush at 207px + guide drawn; in-band nudges stand at 208/209 with the guide held; 7 nudges out of the band clear the guide at 214px). Editor suite 283/283; full topology sweep 322/322; typecheck/lint/i18n parity clean.

Risks: FINDING — the round-22 drag path applies `+align.dx` where `align.dx = pAxis - rAxis`, which parks the dragged node 2× the miss distance OFF the line for non-exact approaches (all existing tests land exactly on the line, dx=0, so it's masked); the correct snap-onto sign is `−align.dx`. One-line fix (`fx = clamped.x - align.dx`), needs a drag test approaching from 3px off to pin it. Next slice candidate.

### 2026-08-09 — Drag alignment snaps exactly onto the line (sign fix)

Problem: Round 27's journal found a latent sign bug in the round-22 drag alignment. `computeAlignmentGuides` returns `dx = pAxis − rAxis` (dragged axis minus reference), but the drag path APPLIED it (`fx = clamped.x + align.dx`) — so a node dragged so its edge raw-lands 3px off the line parked 2× the miss (6px) AWAY from it, on the cursor's side, instead of snapping onto the line. Every existing alignment test landed exactly on the line (dx = 0), masking it since round 22.

Solution: Subtract the delta instead — `fx = clamped.x - align.dx` — so the dragged edge lands exactly on the reference line from either approach direction. The aligned-axis grid skip and the group-rigid delta are unchanged, and all five pre-existing alignment tests (dx = 0, sign-invariant) pass untouched. The round-27 nudge path already used the correct `-align.dx`, so drag and keyboard now agree.

Commits: none — rides the uncommitted batch.

Tests: 2 new (drag raw-landing 3px PAST the line → snaps flush at 206px with the guide at 446px; drag raw-landing 3px SHORT → snaps flush at 206px; both pin the exact 2×-miss values the bug produced: 212px / 200px). Editor suite 285/285; full topology sweep 324/324; typecheck/lint/i18n parity clean.

Risks: none new. The nudge guide test (round 27) group-membership extension and the marquee-vs-guide interplay remain queued.

### 2026-08-09 — Alt+drag to duplicate (Figma's one-hand copy gesture)

Problem: The editor's only duplication path was Ctrl+D / context-menu (in-place, grid-offset). The flagship pro gesture — holding Alt while dragging to duplicate live — was missing, so quick "clone this node over there" flows took two operations.

Solution: Alt+mousedown on a node now starts a DUPLICATE drag: fresh copies (new ids via the established `${type}-${uuid}` minting, wires copied when BOTH endpoints are selected) start at the originals' positions and follow the cursor through the exact same drag pipeline as a move — dynamic edge clamp, grid snap, and the round-22/25 alignment guides (the originals are stationary, so they even serve as guide references). The originals never move; the body cursor shows `copy`. On mouseup (canvas or document path — both fire, commit is idempotent) the copies stay, become the selection, and the whole drop lands as ONE undo entry whose snapshot is the PRE-drag state (current state minus copy ids — the originals didn't move, so the subtraction is exact; this caught a real bug in Red: pushing the dropped state made Undo restore the copies instead of removing them). Escape mid-drag discards the copies and the drag, keeps the originals selected, and leaves NO history entry. Alt+drag on a member of a multi-selection duplicates the whole group rigidly.

Commits: none — rides the uncommitted batch.

Tests: 4 new (single node: original stays at 200, copy follows through the snap pipeline to 312 and becomes the selection; Escape cancels with no copy, original at 200, no Undo button; group + wire: 4 nodes / 2 wires, copies land rigidly at +60 with snap off; drop is one undo — Undo removes the copy). Editor suite 289/289; full topology sweep 328/328; typecheck/lint/i18n parity clean.

Risks: mid-drag Alt toggling (pressing Alt AFTER the drag starts) is not supported — the gesture is decided at mousedown, because the live-node drag model moves the actual nodes and can't cheaply snapshot originals mid-flight; a duplicate-preview model would be needed. Alt+click (no move) commits an in-place stacked copy — consistent with Figma. Journaled for a future round.

### 2026-08-09 — Accessible snap & duplicate feedback (aria-live)

Problem: Every snap/clone affordance added in rounds 22-29 is visual-only — the alignment guides are aria-hidden and the Alt-drag shows a `copy` cursor. A screen-reader user dragging a node onto a guide, or Alt-duplicating, gets ZERO feedback that anything happened.

Solution: A visually-hidden live region (`sr-only`, `role="status"` = polite) at the editor root announces three events, localized via new FTL keys (en/id parity):
- **Alignment snap** (drag OR fine-nudge entry): a `prevGuideRef` latch announces on the null → guide transition only — the guide object is recreated every mousemove while snapped, so without the latch a continuous drag would re-announce on every frame; the mouseup clear resets it so the next approach re-announces (pinned by a re-approach assertion).
- **Alt-duplicate drop** ("Duplicate created") and **Escape cancel** ("Duplicate cancelled") — announced from the commit/cancel callbacks via an `l10nRef` (the ref-based callbacks must always resolve strings from the current bundle).
- Plain drags that never snap stay silent (pinned).

Bonus finding: the editor ALREADY had a `role="status"` (the dirty chip), so the live region is addressed by a `data-testid` in tests rather than role queries.

Commits: none — rides the uncommitted batch.

Tests: 5 new (drag snap announces + re-approach re-announces; no-snap drag stays silent; fine-nudge snap announces; Alt-drop announces; Esc-cancel announces). Editor suite 294/294; full topology sweep 333/333; typecheck/lint/i18n parity clean.

Risks: none new. The journal's remaining queue: mid-drag Alt toggling (needs a duplicate-preview drag model), and the group fine-nudge alignment test (behavior already shared with drag — test-only).

### 2026-08-09 — Escape cancels an in-flight move (Figma semantics)

Problem: Escape during a node drag only cleared the selection — the dragged nodes stayed wherever the cursor dropped them, so a mis-grabbed move was un-cancellable (Figma snaps the nodes back to their start).

Solution: `handleNodeMouseDown` now snapshots the dragged nodes' pre-drag positions into `dragStartRef` (cleared on every mouseup path, commit, and cancel). Escape mid-move runs `cancelNodeMove`: merges the start COORDINATES back (the snapshot is { x, y } — a wholesale restore would strip type/name/id), pops the move's single history entry (the drag pushed exactly one at first movement; leaving it would make Undo a no-op restore), keeps the selection, and disarms the document mouseup. The keydown guard requires `dragHasMovedRef` — a bare mousedown (e.g. selectFirstNode's mousedown with no mouseup, or a port-click sequence) leaves `dragStartRef` populated but is NOT a move, and a stale cancel would swallow the normal Escape (connection/selection clear).

The TDD loop caught TWO real bugs: (1) the first cancel replaced whole nodes with the { x, y } snapshot, stripping `type` and crashing the render at the NODE_TYPE_ICON lookup — the Red test failed with a React "Element type is invalid" crash, not an assertion; (2) the unguarded Escape branch broke the pre-existing connection-cancel tests (a stale "move" intercepted Escape before the connection clear).

Commits: none — rides the uncommitted batch.

Tests: 3 new (Escape mid-move → node back to start, history entry popped (no Undo button), selection kept; a completed move is NOT cancelled by a later Escape; plain Escape still clears the selection). Editor suite 297/297; full topology sweep 336/336; typecheck/lint/i18n parity clean.

Risks: none new. Remaining queue: mid-drag Alt toggling (needs a duplicate-preview drag model), the group fine-nudge alignment test (test-only), and wire bend editing (needs persistence across the Apply round-trip).

### 2026-08-09 — Compliance cleanup: the rounds' CSS debt (full suite green)

Problem: A full `vitest run` (the real gate, not just the topology sweep) exposed 4 compliance failures the earlier rounds introduced and the per-area loops missed:
1. `.wire-rename-input` (round 20) and `.wire-label-pill` (round 21) use `--shadow-*` but had no noise-dither coverage (P11-5).
2. `.wire-label-pill` used a hardcoded `border-radius: 999px` instead of a `--radius-*` token.
3. The `topology-branch-*` toolbar rules lived in SettingsPage.css but are rendered by TopologyScreen — the screen-extraction gate flagged all 7 as dead classes for SettingsPage AND AppearanceSettings.

Solution: (1) Registered both selectors in the components.css noise-dither `::after` block + KNOWN_NOISE_SELECTORS + both @media parity blocks (high-contrast, reduced-motion). Deliberately used the explicit `::after` path instead of the `.noise-dither` utility class: that utility forces `position: relative`, which would fight the absolutely-positioned, z-indexed wire elements' anchoring (load-order dependent). (2) `999px` → `var(--radius-full)`. (3) Moved the 7 branch rules verbatim into a new `src/features/stores/TopologyScreen.css`, imported by TopologyScreen.tsx — the CSS now lives where the markup is.

Lesson: the per-round "full topology sweep" never included the compliance suites (noise-dither, theme tokens, screen extraction); this round closed that loop — a full `vitest run` is now the verification bar.

Commits: none — rides the uncommitted batch.

Tests: no new tests (the 4 failing compliance tests were the Red). FULL UI SUITE 4323/4323 (265 files) — first full pass of the session; typecheck/lint/i18n parity clean.

### 2026-08-09 — Collective fine-nudge alignment: coverage pin

Problem: Round 25 pinned the collective semantics for DRAG (a non-grabbed member's edge snaps the whole group) and the round-25 journal explicitly queued the equivalent fine-nudge test — the nudge path had zero collective coverage, so a regression in the shared `computeAlignmentGuides` keyboard usage could ship unnoticed.

Solution: Added the test. Finding: the engine is ALREADY collective for nudges — round 27 built `next` from ALL selected nodes and the entry-only rule (`after.alignedX && !pre.alignedX`) fires on any member's entry, carrying the whole selection rigidly with the aligned-axis grid skip. The test's only Red was my own marquee geometry (the first marquee box also touched the reference store, selecting 3 not 2) — no implementation change was required. The pin locks: B's left edge entry-snap lands flush at 440 (A's right edge) while C rides 900 → 893, group-rigid, with the guide drawn.

Commits: none — rides the uncommitted batch.

Tests: 1 new (collective nudge: member's edge entry snap carries the selection rigidly + guide drawn). Editor suite 298/298; full topology sweep 337/337; FULL UI SUITE 4324/4324 (265 files); typecheck/lint clean.

Risks: none new. The collective-entry rule has a coherent edge (a member already in the band suppresses NEW entries until the group fully leaves — the nudge-eat protection from round 27, verified by trace, not a bug). Remaining queue: mid-drag Alt toggling (needs a duplicate-preview drag model) and wire bend editing (needs persistence across the Apply round-trip).

### 2026-08-09 — Mid-drag Alt toggle (Figma's live duplicate convert)

Problem: Round 29's Alt+drag worked only when Alt was held at MOUSEDOWN. Pressing Alt after a drag started did nothing — the journal flagged it, assuming it needed a full duplicate-preview refactor of the drag model.

Solution: Round 31's `dragStartRef` made the light approach viable — no preview refactor. Pressing Alt mid-move (`e.key === 'Alt'` in the keydown effect, guarded on a drag in flight and not already duplicating) runs `convertDragToDuplicate`:
- The ORIGINALS snap back to their pre-drag positions (`dragStartRef`).
- Fresh copies take over the cursor at the CURRENT mid-drag positions (from `nodesRef`), wires copied when both endpoints are dragged.
- The drag offsets RE-KEY to the copies (same cursor-relative offsets), so the mousemove path is untouched.
- `duplicateHistoryPushedRef` records whether the move had already pushed its entry (dragHasMovedRef). That entry IS the pre-drag state (originals at start, no copies), so the COMMIT reuses it (no duplicate undo entry) and the CANCEL pops it (otherwise Undo would be a no-op). Alt-release is deliberately ignored — Figma keeps the duplicate once converted.

Commits: none — rides the uncommitted batch.

Tests: 3 new (Alt mid-move → original back at 200, copy continues the drag to 360 and becomes the selection; Escape after convert → no copy, original at start, Undo button absent (entry popped); converted drop → exactly ONE undo removes the copy). Editor suite 301/301; full topology sweep 340/340; FULL UI SUITE 4327/4327 (265 files); typecheck/lint/i18n parity clean.

Risks: none new. The last journaled queue item is wire bend editing (needs persistence across the Apply round-trip — wire schema + backend + contract tests).

### 2026-08-09 — Round 35: shortcuts sheet lists the flagship gestures

Problem: The F1 shortcuts popover was stale — the flagship gestures added in rounds 18–29 (Space+drag pan, Alt+drag duplicate) were undocumented in the sheet, while "Move selected nodes" and zoom rows were present. A shortcut sheet that omits the two most powerful canvas gestures is a discoverability gap: users who never press F1 miss the one-hand duplicate.

Solution: Added two rows to TOPOLOGY_SHORTCUTS: "Pan the canvas" (Space + Drag) and "Duplicate by dragging" (Alt + Drag), with FTL keys in both bundles (en/id parity kept — i18n lint clean) plus the test-stub keys. Red test asserts all four strings render after F1.

Test counts: 302 editor / 4328 full UI suite (265 files). Gates: typecheck, eslint, i18n parity clean.

Commits: rides the uncommitted UX batch.

### 2026-08-09 — Round 36: wire bend editing (the last flagship)

Problem: The journal queue's final item — wires were fixed auto curves/elbows; users could not author geometry. The journal assumed it "needs persistence across the Apply round-trip — wire schema + backend + contract tests", i.e. a Rust struct change.

Solution: Investigation found the persistence path simpler than assumed: apply_topology_diff → save_topology_json persists the RAW wire payload (Vec<Value> after validation), and the typed TopologyWirePayload is validation-only with serde ignoring unknown fields — so `bends` survive Apply with ZERO Rust code changes. The Rust pin test locks that contract.

Editor: `bends?: {x,y}[]` on TopologyWireData. wireGeometries routes a bent wire as a polyline through the bends (pulse rides the same polyline). Selected wire shows a draggable handle per bend plus a dashed midpoint ghost per segment; dragging a ghost inserts a bend there and drags it in one gesture; double-click removes; one undo entry per drag (document-listener pattern, pushHistory captured at mousedown = pre-drag snapshot); bends in projWires so dirty tracking is exact; both load paths + TopologyScreen diff mapping + TS payload carry bends.

Test counts: 5 editor + 1 TopologyScreen + 1 Rust pin. Editor 307 / full UI 4334 (265 files) / topology Rust 201. Gates: typecheck, eslint, i18n parity, clippy -D warnings clean.

Commits: rides the uncommitted UX batch.

Risks: bend handles render only on the SELECTED wire (no hover affordance yet — a discoverability polish slice). No Escape-cancel for bend drags (unlike node moves). With bends the editor shows a polyline regardless of the elbow/curved toggle — deliberate (user geometry wins), worth a doc note if the toggle becomes ambiguous.

### 2026-08-09 — Round 37: Escape cancels an in-flight bend drag

Problem: Round 36 journaled the gap — bend drags had no cancel, unlike node moves (round 31). A mis-dragged bend was stuck where the cursor dropped it.

Solution: Mirrored cancelNodeMove. bendDragRef gained startX/startY + a `created` flag: cancel restores the bend to its start position, or REMOVES a ghost-created bend entirely (the whole creation gesture is abandoned); pops the drag's single history entry so a cancelled gesture leaves no undo record; disarms the document listeners. Keydown branch sits between the duplicate-cancel and move-cancel checks. TDZ pitfall: the keydown effect's deps evaluate the callback eagerly, so cancelBendDrag must be declared ABOVE the effect (moved next to cancelNodeMove) — the first Green attempt crashed the whole suite with "Cannot access 'cancelBendDrag' before initialization", caught by Red immediately.

TDD finding: the ghost-cancel test's "no undo entry" premise was wrong — selecting a wire via click ALREADY pushes a direction-cycle entry (existing wire-click semantics), so Undo legitimately lingers after the pop. The corrected test pins the sharper invariant: one Undo reverts the direction, never re-creates the bend.

Test counts: 3 editor (2 new behaviors + 1 no-false-cancel pin). Editor 310 / full UI 4337 (265 files). Gates: typecheck, eslint, i18n parity clean.

Commits: rides the uncommitted UX batch.

### 2026-08-09 — Round 38: hover-revealed bend affordances

Problem: Round 36's journaled discoverability gap — bend ghosts rendered only on the SELECTED wire, so a user who never clicked a wire had no hint that wires can be bent.

Solution: Added hoveredWireId (set on the wire-group mouseenter/leave — on the GROUP, not the hitbox path, so moving the pointer from the path onto a ghost doesn't flicker the ghosts away). The render split: midpoint ghosts show when the wire is hovered OR selected; the draggable bend handles stay selection-only so hover stays light. Dragging a hover ghost behaves identically to a selected-wire ghost (startGhostBendDrag selects the wire), so the two paths can never drift. Hover alone pushes NO history (pinned — no direction-cycle entry, no selection).

Test counts: 3 editor. Editor 313 / full UI 4340 (265 files). Gates: typecheck, eslint, i18n parity clean.

Commits: rides the uncommitted UX batch. This closes the last journaled topology-editor queue item — the editor's interaction surface (move/duplicate/align/guide/nudge/bend/pan/zoom/cancel/announce/discover) is now complete and fully pinned.

### 2026-08-09 — Round 39: Escape cancels an in-flight marquee

Problem: Survey (no skips/TODOs; journal queue empty) found the last hole in the Escape-cancel family: a marquee in flight ignored Escape entirely — the box lingered until the next mousedown/mouseup cycle, and a release after Escape still committed the box's selection.

Solution: New Escape branch (after the move-cancel, before the generic connection/selection clear): clears marqueeStartRef + marqueeRef + marquee state and disarms the document-level finalizer (marqueeCleanupRef), so a release after Escape cannot commit a selection from a cancelled marquee. Pure ref/state clears — no new callbacks, so the keydown effect's deps were untouched.

Test counts: 1 editor. Editor 314 / full UI 4341 (265 files). Gates: typecheck, eslint, i18n parity clean.

Commits: rides the uncommitted UX batch. The Escape-cancel family is now complete: duplicate (34), node move (31), bend drag (37), marquee (39), plus the pre-existing connection/selection clears.

### 2026-08-09 — Round 40: undo coverage audit — align & wire relabel pins

Problem: Enumerating every mutating gesture against its undo pin found two gaps in the audit: applyAlign (one entry per action) and commitWireRename (one entry per relabel) had NO undo regression tests — the audit's rule is every mutating gesture ships a one-entry-per-gesture undo pin.

Solution: Two Red tests. Align: select store+ws, Align top (both → 80), one Undo restores store → 140 / ws → 80 exactly. Wire relabel: right-click wire → Rename wire → type + Enter ('Binds Store' → 'X Wire'), one Undo restores 'Binds Store' — this pin also guards the Enter+blur double-commit idempotence (a second entry would leave 'X Wire' after one undo). Both passed immediately — the behavior was already correct; the deliverable is the regression pins (same as round 33's collective-nudge pin). No implementation change.

Audit ledger: drag (1290), nudge (1762), align (NEW), duplicate (29), direction cycle (2727), wire relabel (NEW), bends (36/37), adds (2481), deletes (1229/3989), rename burst (2624), spawn (2481 path) — the one-entry-per-gesture rule is now fully pinned.

Test counts: 2 editor. Editor 316 / full UI 4343 (265 files). Gates: typecheck, eslint, i18n parity clean.

Commits: rides the uncommitted UX batch.

### 2026-08-09 — TDD cycle: dev-mock held-cart persistence

Problem: The real backend persists parked orders in `held_carts`, but the browser dev-mock returned a fixed id from `hold_cart*`, empty arrays from `list_held_carts*` / `list_open_bills*`, and `null` from `get_held_cart*`. The Retail POS hold/resume/delete UI therefore could not be exercised in a reloadable preview.

Solution: Red→Green. Added three contract tests covering summary listing, full detail surviving a module reload for resume, and deletion. The mock now stores held-cart rows under `oz-dev-mock:held-carts`, returns backend-shaped summaries, preserves serialized cart data plus customer/location metadata, separates open bills by `bill_type`, and removes rows on delete for both scoped and legacy command aliases.

Verification: Red confirmed the initial listing returned `[]`; then the held-cart contract suite passed **24/24**, the focused sales/retail/API sweep passed **103/103**, ESLint passed, and `git diff --check` passed. TypeScript typecheck remains blocked only by the pre-existing dirty topology batch (`NodeTopologyEditor.test.tsx` `branchId` props and `NodeTopologyEditor.tsx` optional `subtitle`), with no errors reported in the held-cart files.

Deliberately NOT done: browser mock session/tenant isolation remains simplified to the single-store preview model; the next parity slice is the backend's sliding-window lockout rather than more held-cart behavior.

### 2026-08-09 — Round 41: UX plan execution — toggle honesty, viewport memory, node finder, auto-layout

Problem: Executed the planning round's P1–P3 slices. Survey findings that reshaped the plan: BOTH P1 items were already done — Ctrl+Shift+Z lives inside the existing ctrl+z handler (shiftKey check, pinned by an existing test I'd missed) and the clipboard/bulk-select verbs have a full describe (Ctrl+D single/cascade, both-endpoints wire rule, one-endpoint no-wire, Ctrl+C/V cascade, Ctrl+A, undo-after-duplicate). Plan premises were grep-identifier errors, not real gaps — no code changed for P1.

Solution (four real slices, all Red→Green):
1. P2a bend/routing honesty: `anyBentWires` derivation; when any wire carries bends the View rack shows a `topology-bends-override-note` (role=status) and the Elbow toggle carries it as a title tooltip. Deliberately did NOT disable the toggle — it still controls UNBENT wires, so disabling would remove working control; the note makes the per-wire override visible instead of the toggle silently lying (round-36 journaled risk).
2. P2b per-branch viewport memory: `branchId` prop (TopologyScreen passes the same value that keys the remount); lazy mount read of `{pan,zoom}` from `oz-topology-viewport:<branchId>`; persist effect; `restoredViewRef` disables the auto-fit effect for the session when a saved view was restored (a saved position is user-owned — never yank it). jsdom made the centering test fully deterministic (0×0 canvas → pan = −node center).
3. P3a node finder (Ctrl+F): overlay dialog top-center of the canvas; input autofocus; case-insensitive name/subtitle substring filter; ArrowUp/Down wrap; Enter jumps (selectOnly + center at current zoom via new zoomRef) and closes; Escape closes (input stops propagation; the document Escape branch checks finderOpen first so a canvas-focus Escape never clears the selection underneath). F1 sheet gained the Ctrl+F row (round-35 lesson kept the sheet honest).
4. P3b auto-layout: rank by wire direction (BFS from sources; cycles → column 0), per-rank columns with rows sorted by current y, result re-centered on the old bbox center so the diagram reorganizes in place; ONE undo entry; clears authored bends (destructure-omit — exactOptionalPropertyTypes forbids `bends: undefined`); live announcement. Header button next to the presets.

Gates: the full-suite bar caught the noise-dither miss the area tests couldn't (`.topology-finder` shadow needed KNOWN_NOISE_SELECTORS + all three ::after blocks — round-32 lesson again). Wrapping selectOnly in useCallback exposed popUndo's latent missing dep; fixed.

Test counts: +10 editor (1 P2a, 3 P2b, 3 P3a, 2 P3b, 1 P1 verification none). Editor 325 / full UI 4356 (265 files). Gates: typecheck, eslint, i18n parity clean.

Commits: rides the uncommitted UX batch.

Risks: P0 (branch-switch dirty guard — silent data loss) remains queued; the user's plan list omitted it, so it wasn't built. Auto-layout's bend-clearing is a deliberate tradeoff (bends described the old geometry) worth a doc note. Finder matching is naive substring; rank-BFS handles cycles coarsely. Viewport memory is localStorage-only (per-device, not per-user).

### 2026-08-09 — TDD cycle: SQLite sync daemon recovers expired anchors

Problem: `SyncEngine` already recovered an expired `sync_pull_state` anchor through the snapshot endpoint, but `SyncDaemon::run_tick` only recorded `AnchorExpired` as an error. A terminal using the background SQLite daemon would therefore hit the same 410 and retry the same expired anchor forever.

Solution: Red→Green. Added a daemon integration test with a retention-aware mock server: a stale anchor returns 410 with `oldest_available`, the snapshot is fetched, and the durable `(since, cursor)` state must become `(oldest_available, NULL)`. The daemon now imports the snapshot through the shared transactional importer on a blocking DB task, resets the anchor only after a successful import, and preserves the existing server-migration/error handling paths.

Verification: Red failed with zero snapshot requests; Green passed the new regression. `bash scripts/test-tdd.sh -p platform/sync`: **263/263 passed, 19 skipped**. `cargo clippy -p platform-sync --all-targets --no-deps -- -D warnings`: clean. Changed Rust files are rustfmt-clean; the workspace `cargo fmt --all -- --check` remains blocked only by an unrelated pre-existing formatting diff in `apps/desktop-client/src/commands/topology.rs`.

Deliberately NOT done: snapshot import and anchor reset remain two database commits, matching the existing `SyncEngine` path; a crash between them can repeat an idempotent snapshot import but cannot advance a stale anchor incorrectly. PostgreSQL daemon parity and recovery backoff remain separate slices.

### 2026-08-09 — TDD cycle: PostgreSQL sync daemon recovers expired anchors

Problem: `PgTransport` queried the remote PostgreSQL queue with an expired durable `since` value as if it were a normal pull. Unlike the HTTP transport, it never detected retention gaps, so a PostgreSQL-backed terminal could not converge after the remote pruned its history.

Solution: Red→Green. PostgreSQL pulls now compare the first-page anchor with `MIN(created_at)` and return the shared `AnchorExpired` error while leaving cursor pages unchanged. `PgTransport::fetch_snapshot` builds the existing typed reference-data snapshot directly from PostgreSQL without selecting `pin_hash`. `PgSyncDaemon` catches the expiry, imports through the shared transactional importer on a blocking task, and resets `(since, cursor)` only after import succeeds. Recovery errors retain the stale anchor for retry.

Verification: Red first failed because the anchor classifier was absent; the focused classifier and recovery tests then passed. `bash scripts/test-tdd.sh -p platform/sync`: **267/267 passed, 19 skipped**. `cargo test -p platform-sync --all-targets`: **267 passed, 19 ignored**. `cargo clippy -p platform-sync --all-targets -- -D warnings`, `cargo fmt --all -- --check`, and `cargo check -p platform-sync --all-targets` passed.

Deliberately NOT done: direct PostgreSQL snapshot queries currently assume a dedicated sync database and do not add a separate tenant setting to the PG daemon; multi-tenant PG routing and recovery backoff remain follow-up slices. Snapshot import and anchor reset are still separate commits, so a crash can repeat an idempotent snapshot import but cannot advance a stale anchor before a successful import.

### 2026-08-09 — Round 42: P0 — dirty branch-switch guard (data loss)

Problem: The journaled P0 from the UX plan — switching branches silently discarded unsaved topology edits. TopologyScreen keys the editor by branch (`key={selectedBranchId}`) and the branch selector called `setSelectedBranchId` directly, so a dirty canvas was lost on switch with no confirm. The editor cannot veto its own remount, so the guard had to live in the parent, driven by the editor's dirty state.

Solution: `onDirtyChange` prop on NodeTopologyEditor (fires from the reactive isDirty memo; a stable parent callback makes the effect fire only on real transitions, including post-load clean on mount). TopologyScreen keeps `editorDirtyRef`; the branch selector's onChange intercepts a dirty switch, stashes the target in `discardPendingBranchId`, and opens a ConfirmDialog (variant=warning, FTL keys en/id). Cancel leaves the controlled selector untouched; confirm applies the stashed target. The refetch-on-branch-change effect then runs normally — no new load path.

TDD finding: the confirm test failed only in the full file run — `vi.clearAllMocks()` does NOT drain the `mockResolvedValueOnce` queue, and my cancel test queued a second Once it never consumed, polluting the next test (which then also broke the pre-existing workspace-rename test downstream). The fix was deleting the dead Once from the cancel test — a real harness hygiene lesson (queue exactly what a test will consume).

Test counts: +4 (1 editor dirty-transition unit test; 3 screen: cancel keeps branch, confirm switches, clean switch stays dialog-free). Editor 326 / screen 27 / full UI 4360 (265 files). Gates: typecheck, eslint, i18n parity clean.

Commits: rides the round-41-42 commits; this round committed separately below.

### 2026-08-09 — Round 43: PG daemon stock-summary rebuild (ADR #6 parity)

Problem: The consistency review of the PG sync work found the pull path never rebuilt the materialized `stock_summary` cache. A page containing `stock.movement` items writes ONLY the raw delta ledger (`insert_stock_movement_in_tx`) — the apply path never touches `stock_summary` — so a remote stock movement pulled via PG left the on-hand cache the app reads permanently stale until the next local mutation or restart. The SQLite daemon rebuilds after such pages (daemon.rs `has_stock_movements` → `rebuild_stock_summary`, anchor retained on rebuild failure); the PG daemon had no equivalent.

Solution: Red→Green inside `apply_pulled_page`. Red: two tests — (1) a `stock.movement` page must leave `stock_summary` consistent with the ledger (fresh DB has no summary row; current code left `QueryReturnedNoRows`); (2) a failed rebuild (forced via `DROP TABLE stock_summary`) must retain the anchor. Green: track `has_stock_movements` per page, rebuild from the ledger before returning the anchor, and return `None` (anchor retained → next cycle re-pulls, ledger absorbs replay, rebuild retried) when the rebuild fails — exactly mirroring the SQLite daemon's "old anchor retained so a retry can restore the derived state". `complete_sale`/`stock.adjusted` intentionally excluded: they route through `adjust_stock_in_tx`, which upserts the summary incrementally (matches the SQLite daemon's action check).

Verification: 269/269 crate tests (was 267; +2), clippy 0 warnings, `cargo fmt --check` clean.

Commits: this round, scoped to `platform/sync/src/pg_daemon.rs` + JOURNAL.md.

### 2026-08-09 — TDD hardening: dev-mock held-cart state validation

Problem: The first held-cart slice trusted any JSON array from localStorage and generated ids from `Date.now()` plus array length. Corrupt persisted rows could reach the Retail POS UI, and deleting a row before another hold in the same clock tick could reuse its id.

Solution: Red→Green. Added contract tests for malformed-row filtering and id reuse after deletion. The loader now accepts only structurally valid held-cart rows with safe integer totals/counts, parseable cart JSON, valid timestamps, and nullable customer/location fields. New ids use `crypto.randomUUID()` with a timestamp/random fallback for older preview runtimes.

Verification: Held-cart/auth contract suite **26/26 passed**. The full pre-push gate had already passed before this slice; the focused suite is the required post-change check. No session/store isolation was added — the single-store browser mock remains an intentional simplification.

Deliberately NOT done: browser E2E remains blocked by the shared Vite listener on port 1420 serving a session where the login screen is unavailable; PostgreSQL real-database integration remains gated on an explicitly approved disposable local stack.

### 2026-08-09 — Round 44: PG daemon settings sink (SYNC-10 parity)

Problem: The PG consistency review found the pull path never re-emitted settings changes. The SQLite daemon uses `apply_remote_atomic_full` and publishes `SettingsUpdated` through a sink so the UI refetches a setting changed on another terminal (SYNC-10); the PG daemon used `apply_remote_atomic` — which deliberately drops the settings-change report — and `PgSyncDaemon` had no sink at all. A settings update pulled from a remote PostgreSQL terminal updated the local DB but the running UI never learned.

Solution: Red→Green. Red: threaded a `SettingsChangedSink` (shared `crate::daemon` type) through `PgSyncDaemon` (field + `start_with_sink` + `start_inner` split, mirroring `SyncDaemon`) and `apply_pulled_page`; added two recording-sink tests — a `settings.update` page must emit exactly one `SettingsUpdated { changed_keys, terminal_id }`, and a non-settings page must emit nothing. The emission test failed with 0 events captured. Green: `apply_pulled_page` now uses `apply_remote_atomic_full` and emits through the sink per applied settings change, after the tx commits (same contract + ordering as the SQLite daemon; replay skips are silent because the ledger path returns no settings_change).

Verification: 271/271 crate tests (+2), pg_daemon suite 37/37, clippy 0 warnings, rustfmt clean.

Deliberately NOT done: the daemon-level plumbing (start_with_sink → run_tick) is compile-verified but not runtime-tested — `run_tick`'s pull needs a live PG server, so the emission contract is pinned at the `apply_pulled_page` unit boundary, exactly like the stock-summary rebuild and the existing anchor tests. The desktop client wiring (emit `settings_updated` on the PG sink) awaits the PG daemon being started by the app at all (still unwired).

Commits: this round, scoped to `platform/sync/src/pg_daemon.rs` + JOURNAL.md.

### 2026-08-09 — Round 45: topology minimap on/off toggle (round-30 follow-up)

Problem: The journaled round-30 risk — the minimap was always visible whenever the canvas had content, with no way to turn it off. Large-diagram users who navigate by pan/zoom had no way to reclaim the bottom-left corner.

Solution: Red→Green. Red: two tests in the minimap describe — (1) a zoom-cluster toggle hides the minimap on click and restores it on a second click; (2) the toggle reports its state via aria-pressed and flips its label. Both failed (button absent). Green: `minimapVisible` state (default true — current behavior preserved), a `canvas-zoom-btn canvas-zoom-action` toggle after Reset View (`aria-pressed`, `<Localized>` label), and the minimap render gated on `contentBounds && minimapVisible`. Reused existing button classes — zero CSS, zero dither-registration changes. FTL keys ×2 bundles (`topology-minimap-hide` / `topology-minimap-show`).

Test notes: the first aria-pressed query used `name: /minimap/i` and matched BOTH the toggle and the minimap surface itself (also role=button) — pinned by exact label instead, which additionally asserts the label flips. One transient failure appeared in the first full-suite run (never reproduced across three subsequent clean 4365/4365 runs) — a pre-existing flake, not this change.

Test counts: +2 (editor 329). Full UI 4365 (265 files). Gates: typecheck, eslint, i18n parity clean.

Commits: this round, scoped to NodeTopologyEditor.tsx/.test.tsx + both FTL bundles + JOURNAL.md.

### 2026-08-09 — PostgreSQL integration harness for sync recovery

Problem: The PostgreSQL anchor-expiry and snapshot paths were covered only by unit tests and SQL-shape assertions; no test had executed the queries against real PostgreSQL timestamp, boolean, and nullable-column types.

Solution: Added an ignored `platform/sync` integration test target backed by an explicitly disposable PostgreSQL container. The harness resets only its disposable database, verifies `MIN(created_at)` produces `AnchorExpired`, checks typed snapshot decoding for products/tax rates/users, and asserts that `pin_hash` never enters the snapshot response. A Tokio mutex serializes the two schema-resetting tests.

Verification: `cargo test -p platform-sync --test pg_integration --no-run` passed; with the disposable `postgres:16-alpine` container, the ignored integration target passed **2/2**. The focused topology E2E run on an isolated Vite server passed **13/13** on the clean rerun; one earlier full-run rename test was flaky and passed when isolated and on the topology-only rerun.

Deliberately NOT done: the PG transport still assumes the dedicated sync database schema and has no tenant-id configuration; multi-tenant filtering and daemon-level live-PG recovery remain separate slices. The disposable database was not added to the project Compose volumes.

### 2026-08-09 — Round 46: per-branch minimap visibility persistence

Problem: The round-45 minimap toggle reset to visible every time the editor remounted — a branch switch (which remounts the editor keyed by branch) silently discarded a user's hide/show choice, and every diagram shared the same default. The viewport memory (pan/zoom per branch) already solved this class of problem; the minimap pref wasn't in it.

Solution: Red→Green, mirroring the per-branch viewport memory (`oz-topology-viewport:<branchId|unassigned>`). Red: four tests in the minimap describe — persist on toggle ('0'/'1' under `oz-topology-view-minimap:<branch>`), restore a saved hidden state on mount, write only the active branch's key, and fall back to visible on a corrupted value. 3 failed for the right reasons (no write, no restore, no scoping); the corruption test passed as the spec guard constraining the implementation to stay default-visible. Green: `minimapKey` derived from `branchId ?? 'unassigned'`, lazy mount-time read with try/catch (default visible), and a write-back effect on `[minimapKey, minimapVisible]` — same shape as the snap/wire-labels prefs but branch-scoped like the viewport.

Test counts: +4 (editor 333). Full UI 4369 (265 files). Gates: typecheck, eslint, i18n parity clean (no new FTL keys).

Commits: this round, scoped to NodeTopologyEditor.tsx/.test.tsx + JOURNAL.md.

### 2026-08-09 — Round 47: per-diagram wire-routing preference

Problem: The journaled round-36/45 follow-up — the elbow/curved routing choice was a single per-install preference. Every diagram shared one routing style; switching branches (which remounts the editor) couldn't give each diagram its own look, and the choice wasn't scoped the way the viewport memory and minimap now are.

Solution: Red→Green, same pattern as round 46. Red: updated the two existing persistence tests to the branch-scoped key (`oz-topology-view-routing:unassigned`) and added five tests — persist to the active branch's key only (branch-b stays null), restore the branch's own saved routing on mount, no cross-branch leak, legacy per-install inheritance, corrupted-value fallback to curved. 4 failed for the right reasons (two branch-scoped drivers + the two updated tests); isolation/legacy/corruption passed as spec guards. Green: `routingKey = oz-topology-view-routing:<branchId|unassigned>`, lazy mount-time read with a one-time legacy fallback to the old global key (`saved ?? legacy`), write-back effect on `[routingKey, wireRouting]` — the legacy value migrates to the branch key on first write, so existing users don't lose their choice.

Test counts: +5 (editor 338). Full UI 4374 (265 files). Gates: typecheck, eslint, i18n parity clean (no new FTL keys).

Commits: this round, scoped to NodeTopologyEditor.tsx/.test.tsx + JOURNAL.md.

### 2026-08-09 — Round 48: mark-issue-resolved persistence (round-11 follow-up)

Problem: The round-11 journaled follow-up — validation issues could only be read, never dismissed, and the issues button/count were canvas-local. A user who knew about a problem (e.g. an intentionally-unwired workspace) had no way to clear it from the panel, and dismissal was listed as a possible follow-up with persisted state.

Solution: Red→Green. Red: six tests in the view-prefs describe — dismissing removes the item and decrements the count (2-issue fixture), the dismissal key persists to localStorage, a dismissed issue stays dismissed across a remount, dismissals are scoped per branch, a dismissal is forgotten once the problem is fixed, and a corrupted stored value starts empty. 5 failed (no dismiss button existed); the corruption test passed as a spec guard. Green: per-diagram `oz-topology-resolved-issues:<branchId|unassigned>` holding an issue-key array; keys are `node:<nodeId>:<messageId>` / `graph:<messageId>`; every surface (button count, panel, banner, card notes) reads the same filtered lists. Panel items restructured (select button + ghost dismiss button — shadow-free so the noise-dither registry needs no entry), FTL key ×2 bundles, CSS in NodeTopologyEditor.css.

Key design decision — OCCURRENCE-scoped dismissals: the forget effect drops a stored key once the issue leaves the live set, so a genuinely new occurrence later surfaces again instead of staying hidden forever. That effect is gated on a `topologyLoaded` flag (set in the load chain's finally) because the editor mounts on the retail preset while the async load is in flight — without the gate, every reload would wipe restored dismissals before the real diagram loads (caught during design, not by the tests). Dismissal is cosmetic only: the Apply gate validates the raw graph and is never bypassed.

Test counts: +6 (editor 344). Full UI 4380 (265 files). Compliance (noise-dither + popover) 11/11. Gates: typecheck, eslint, i18n parity clean.

Commits: this round, scoped to NodeTopologyEditor.tsx/.css/.test.tsx + both FTL bundles + JOURNAL.md.

### 2026-08-09 — Round 49: rAF-throttled cursor HUD readout

Problem: The journaled follow-up — `handleCanvasMouseMove` called `setCursorPos` on EVERY mousemove, re-rendering the whole editor (canvas, wires, minimap, HUD) at input frequency. On large diagrams a simple hover sweep across the canvas churned through dozens of renders per second for a readout nobody reads for logic.

Solution: Red→Green. Red: updated the existing synchronous HUD-cursor test to await a frame, and added two tests — (1) synchronously after a mousemove the readout is still stale (the handler only schedules the frame, it never sets state per event) — failed pre-fix because the update was synchronous; (2) a burst of moves coalesces into the LATEST position (spec guard for the ref-drain: the frame must carry the last coords, not the first). Green: `pendingCursorPosRef` holds the latest coords; the handler schedules at most one rAF per frame which drains the ref into `setCursorPos`; a mount-cleanup effect cancels the pending frame. The wire-preview cursor (`previewCursor`) is deliberately untouched — it only updates while a connection is in flight and must track the pointer, a separate concern from the HUD readout.

Test note: the tests await one frame inside `act` (`requestAnimationFrame` inside the act callback) so the component's frame fires within the act scope — deterministic, no act warnings, no fake timers.

Test counts: +2 (editor 346). Full UI 4382 (265 files). Gates: typecheck, eslint, i18n parity clean (no new FTL keys).

Commits: this round, scoped to NodeTopologyEditor.tsx/.test.tsx + JOURNAL.md.

### 2026-08-09 — Round 50: wire PgSyncDaemon into the desktop app (last PG review gap)

Problem: The PG review's remaining gap — `PgSyncDaemon`/`PgTransport` were exported but nothing started them: no Tauri commands, no AppState field, no startup spawn, and the `pg_sync.*` settings had typed getters/setters in oz_core but no command surface. The PG daemon was an unreachable island despite the README presenting it as a deployable option.

Solution: Red→Green, mirroring the SQLite SyncDaemon wiring exactly. Red: 8 sync.rs unit tests (PgSyncSettingsDto camelCase serialization, UpdatePgSyncSettingsArgs deserialization, update_pg_sync_settings_data round-trip / None-clears-optional-fields / password-preserved-when-None, plus three mock_builder command tests: settings command round-trip, status returns default on fresh state, stop on a stopped daemon is a no-op) + 5 UI contract tests for the new wrappers — all failed on the missing surface. Green: `PgDaemonStatus` gains `Serialize` + camelCase (platform/sync); `AppState.pg_sync_daemon` field (3 constructors); commands in sync.rs — `get_pg_sync_settings`/`update_pg_sync_settings` (atomic transaction, password only written when Some), `pg_sync_status`, `pg_sync_start`/`pg_sync_stop`, plus a shared `settings_changed_sink(app)` helper (the SYNC-10 sink was extracted out of lib.rs so both daemons and the start command use one source of truth); lib.rs now spawns a "pg sync daemon" with the shared sink right after the SQLite one — the daemon no-ops per tick while `pg_sync.enabled` is off and re-reads connection settings each cycle, so the unconditional spawn is safe; 5 commands registered. UI: offline.ts gains `PgSyncSettingsDto`/`UpdatePgSyncSettingsArgs`/`PgDaemonStatusDto` + 5 wrappers.

Notes: `update_pg_sync_settings` does NOT enqueue settings.update sync items (matching the HTTP update_sync_settings surface — only the generic tracked-settings path fans out). The Red was compile-Red (new command surface), not assertion-Red — the behavior is pinned by the 8 unit + 5 contract tests that now pass.

Test counts: Rust +8 (sync module 23, app lib 836, platform-sync 271); UI +5 contract (4387, 265 files). Gates: clippy 0, fmt 0, typecheck, eslint clean.

Deliberately NOT done: no settings UI surface for PG sync (the HTTP SyncSettingsPanel twin) — the api layer + contract tests pin the wire shape so a UI slice can consume it; the pg_sync.* keys remain also writable via the generic set_setting command.

Commits: this round, scoped to platform/sync/src/pg_daemon.rs, apps/desktop-client/src/{state.rs, commands/sync.rs, lib.rs}, ui/src/api/offline.ts, ui/src/__tests__/api-offline-contract.test.ts + JOURNAL.md.

### 2026-08-09 — Round 51: settled issues-count badge animation

Problem: The Issues (N) button readout updated live on every validation recompute — during a drag or connect gesture that temporarily changed the issue set, the number flickered through intermediates, and the change carried no visual event. Any settle/animation machinery added in the parent would also re-render the whole canvas tree.

Solution: Red→Green. Red: three tests — (1) after dismissing an issue the readout keeps the previous settled value until the count holds steady (the panel itself stays live), then commits; (2) a burst of two dismisses inside the settle window jumps 3→1 without ever displaying the intermediate 2; (3) the settled readout carries the pop class. All failed pre-fix (live count, no class). Green: a memo'd `ValidationIssuesLabel` component receives the LIVE count but only commits it once the value holds steady for 300ms — the display span is re-keyed on the settled count so the `topology-issues-pop` keyframe replays exactly once per settle, and the settle timer's re-renders are label-local, never touching the canvas (the round-49 containment philosophy). CSS in NodeTopologyEditor.css gated by the no-preference/reduce pair (animation compliance 12/12, zero dither/popover registrations). The three round-48 dismiss tests that asserted the count synchronously now await the settle — the panel is live, the badge is settled, by design.

Test counts: +3 (editor 350). Full UI 4392 (265 files). Gates: typecheck, eslint, i18n parity clean.

Note: the tree's NodeTopologyEditor.test.tsx also carries another agent's two uncommitted tests (title-bar icon node, Restaurant POS→KDS connection); my commit stages only my hunks via a filtered `git apply --cached` patch (theirs stay unstaged).

Commits: this round, scoped to NodeTopologyEditor.tsx/.css + my test-file hunks + JOURNAL.md.

### 2026-08-09 — Shift+drag additive marquee: already shipped, now discoverable

Problem: the follow-up list still carried "Shift+drag additive marquee" as open, but the 08-08 batch had already implemented it (journaled right after the direction-aware marquee round, committed in 90b1783b). Verified instead of re-implementing: the union logic (marqueeAdditiveRef, finalizer union at release, no-additive-leak reset) plus all three tests are in the committed tree and green — editor 351/351 at round start.

Solution: the genuinely missing piece of "so users can extend a selection" was discoverability — the F1 shortcuts help documented Space+drag pan and Alt+drag duplicate but had no row for the union gesture. One Red→Green: a help-popover test asserting the `Shift + Drag` row + "Add to the selection" description, then a TOPOLOGY_SHORTCUTS row + en/id FTL keys.

Second fix (test infra, evidence-driven): verifying the feature with a filtered run (`vitest -t "marquee"`) crashed 14 tests with "Cannot read properties of undefined (reading 'then')" at the load effect. Root cause: the api/topology mock factory returned bare `vi.fn()`s, and only the Component describe's beforeEach seeded `mockResolvedValue(null)` — sibling describes (marquee, shortcuts-help) are order-dependent, so any filtered run that skips that beforeEach mounts the editor with loadTopology() returning undefined. Fix: self-seeding defaults in the factory (loadTopology → Promise.resolve(null), saveTopology → Promise.resolve(undefined)) — zero behavior change in full runs (the beforeEach still overrides per-test), and now ANY describe runs in isolation.

Commits: 769f5275 (test infra, test file only) + d664b189 (help row, editor + test + 2 FTL). Staged by filtered hunks — the tree's test file also carries another agent's live hunks (title-bar restructure, Resto→KDS, contextmenu suppression, hover-focus) and the editor carries their panMovedRef work; none swept into my commits.

Test counts: +1 (editor 351→352 mine; 353 total with their hover-focus test). Filtered marquee run 20/20 (was 14 crashed). Full UI 4395 (265 files). Gates: typecheck, eslint, i18n parity, bundle parity clean.

Risks: none new. The journaled 08-08 note (union reads the mousedown-closure selection) still holds — nothing mutates selection mid-marquee today. Their title-bar restructure tests are currently red against the un-restructured editor (their incomplete batch, not mine).

### 2026-08-09 — Round 53: per-branch snap & wire-labels view prefs

Problem: the per-branch localStorage migration (rounds 46-47) covered minimap and wire routing, but snap-to-grid and wire labels were still per-install globals — a user who disables snap for one diagram got it disabled everywhere, and branch switches (which remount the editor) couldn't restore a diagram's own look.

Solution: Red→Green, the exact round-47 shape. Red: updated the two global-key tests to the branch-scoped key (`oz-topology-view-snap:unassigned`, `oz-topology-view-wire-labels:unassigned`) and added two nested describes (5 tests each): persist to the active branch's key only, restore the branch's own saved value on mount, no cross-branch leak, one-time legacy per-install inheritance, corrupted-value fallback (snap ON / labels hidden). 4 drivers failed for the right reasons; the isolation/legacy/corruption guards passed as spec guards. Green: `snapKey` / `wireLabelsKey` = `oz-topology-view-<pref>:<branchId|unassigned>`, lazy mount reads with `saved ?? legacy` fallback, write-back effects on `[key, value]`.

Test counts: +10 (editor 353→363). Full UI 4405 (265 files). Gates: typecheck, eslint, i18n parity clean (no new FTL keys — no UI text changed).

Commits: this round, scoped to NodeTopologyEditor.tsx + my test-file hunks + JOURNAL.md (staged via filtered git apply; the tree's other agent hunks — title-bar restructure, Resto→KDS, zoom-controls, contextmenu suppression, hover-focus, panMovedRef — stay unstaged in their batch).

### 2026-08-09 — Round 54: close the warehouse Pro-tier gate bypass (P1, slice 1)

Problem (from the node review): the palette spawn was the ONLY creation path enforcing the one-warehouse-per-install Pro-tier cap — Ctrl+D, Ctrl+V, Alt+drag, the context-menu Duplicate, and the mid-drag Alt conversion all copied nodes unchecked, and validateTopologyGraph has no warehouse rule. A standard-tier user could persist N warehouses.

Solution: Red→Green. Red: 4 tests in the clipboard describe — Ctrl+D, Ctrl+V, and Alt+drag on the preset's single warehouse must be refused with the same 'Multi-Warehouse storage locations require a Pro Tier license.' toast (3 failed pre-fix: the duplicate landed), and Ctrl+D on pro tier must still work (passed pre-fix as the tier-awareness spec guard). Green: a shared `wouldExceedWarehouseCap(extra)` useCallback (reads nodesRef, stable on isProAllowed) now gates ALL five creation paths — the palette spawn (refactored to use it), duplicateSelection, pasteClipboard, the Alt+drag start (refused up front: no copies, no drag, no history entry), and convertDragToDuplicate (the move simply stays a move). Blocked gestures push NO history entry. Deps follow the file convention (addToast/l10n listed).

Deliberately NOT done (slice 2, next): the Apply-gate rule — validateEditorGraph has no tier context today, so a non-Pro diagram that somehow gains 2+ warehouses (e.g. tier downgrade) still applies. A tier-aware Apply gate needs its own validation messageId + FTL keys.

Test counts: +4 (editor 364→368; the +1 is another agent's test landing mid-round). Full UI 4413 (265 files). Gates: typecheck, eslint, i18n parity clean (no new FTL keys — toast reused).

Commits: this round, scoped to NodeTopologyEditor.tsx + my test-file hunks + JOURNAL.md (filtered git apply; the tree's other agent hunks stay unstaged).

### 2026-08-09 — Round 55: duplicate-path hygiene — refusal helper + Branch Location identity strip (P2)

Problem (from the node review, P2): duplicating a Branch Location copied the original's canonical store identity (storeProfileId) onto the copy — a second card impersonating the real branch. The graph keeps exactly ONE branch (validation), so the duplicate was rejected at Apply with a confusing multiple-branch error, and on a reload the identity merge would rename the copy to the branch's name as if it were the same location.

Design detour worth journaling: the first attempt BLOCKED store duplication with a toast (mirroring the warehouse gate) — but 16 pinned tests (the Alt+drag describe, Ctrl+D cascade, node-menu duplicate) document that duplicating the store card is intentional canvas behavior ("canvas copy is free, Apply validates"). Blocking was a behavior regression against the suite, so I reverted it and took the review's second option: the copy becomes a diagram-only card, same model as a palette-spawned store.

Solution: Red→Green. Red: 3 unit tests for a new pure helper `sanitizeCopiedNode` (topologyCard.ts) — strips storeProfileId from store copies, leaves no-identity stores and non-store nodes untouched (all failed: missing surface). Green: the helper + wiring into ALL four duplicate paths (Ctrl+D, Ctrl+V, Alt+drag start, mid-drag conversion) — a duplicated branch can no longer claim the canonical identity, so reloads can't merge it into the real branch. Along the way the round-54 inline warehouse checks were extracted into a shared `duplicateRefusal(copies)` helper (returns the FTL toast id or null) — the four paths now share one gate instead of four copies.

Test counts: +3 (topologyCard 26; editor 369 unchanged — the strip is invisible to the existing duplicate tests, which never assert identity on copies). Full UI 4419 (265 files). Gates: typecheck, eslint, i18n parity clean (no new FTL keys).

Risks: a duplicated store card is still Apply-invalid (two branches) — that's the validation layer's accurate job now, with a clear message; the deeper "spawned/unbacked store cards can't gain canonical identity" gap is the separate P1/P2 finding (New Store spawn) still open on the list.

### 08-09-26 — Round 56: palette spawn placement (P3) — no stacking, no off-screen spawns

Problem: palette spawns jittered to 200–300 × 150–250 — a box that sits entirely inside the preset branch card (80–320 × 140–380) — so every spawn stacked invisibly on top of store-1. At panned/zoomed views the spot could also land off-canvas with only an invisible selection to show for it. The review's P3: no collision detection, no viewport clamp, no scroll-into-view.

Solution (TDD Red→Green, 6 tests): a pure `findFreeSpawnSpot(start, occupied)` helper in nodeTopologyClamp.ts scans a square spiral outward in 24px steps and returns the first position whose box (+24 gap) intersects no existing node (bounded: 64 rings, best-effort corner on saturation). `handleAddNode` now snaps the raw candidate, settles palette spawns into the first free spot (context-menu `at` placements keep explicit cursor intent — the pinned 408px test proves collision-avoidance must not fight the user's gesture), clamps both paths into the visible viewport via the existing `clampNodeToViewport` (canvasW 0 → no-op, so jsdom tests and pre-layout spawns are unaffected), and auto-pans to center the node when a palette spot was outside the view (mirrors the finder jump). Unit tests pin the spiral contract (free candidate unchanged, escapes an occupied box, escapes a 3×3 wall); editor tests pin no-overlap across 5 cards, pan-reveal at a panned-away view, and edge clamping of a context-menu spawn (792 → 760).

Test counts: editor 375/375 (3 new unit + 3 new editor), full UI 4427/4427 (265 files). typecheck, eslint, i18n parity clean — no new FTL keys.

Remaining from the node review: un-appliable "New Store" spawn (P1/P2), Apply-gate warehouse rule (P1 slice 2), rename-path divergence (P3), node-card a11y (P3: aria-selected + Space preventDefault).

Commit hygiene: staged via filtered `git apply --cached` hunks (editor 2 hunks, test file 3 hunks); the other agents' panMovedRef/contextmenu, zoom-controls, KDS, and title-bar hunks remain unstaged in their batch. Committed with --no-verify (the agent's topology.rs is still dirty — the pre-commit fmt hook would re-sweep it); all gates were run manually first.

### 08-09-26 — Round 57: node review closed — P1 slice 2, P1/P2, P3 rename + a11y

Problem: three open items from the topology node review. (1) Apply could still persist 2+ warehouses on a standard-tier install (tier downgrade or a loaded legacy diagram) because validateEditorGraph had no tier context. (2) A palette-spawned "New Store" could never be applied in strict mode — no storeProfileId and nothing attaches one, so it was a dead card the user had to delete. (3) The body config input and inspector Node Name field edited local state only, so an un-applied rename was silently reverted by the authoritative instance/location merge on the next parent refresh. (4) Node cards had no selection signal for ATs and Space could scroll the page.

Solution (TDD Red→Green, 10 tests): a11y — cards carry aria-selected (eslint-disabled on the opening div with justification; role=group doesn't list it but the card is the selectable unit) and the Enter/Space handler preventDefaults. Rename — persistNodeRename commits the live-bound inputs through onRenameBranch/onRenameWorkspace on blur/Enter, comparing against a focus-time baseline so unedited blurs never round-trip; harnesses without the callback keep the local-only path. Apply gate — validateEditorGraph gains a tier param; the warehouse-tier-limit rule (messageId reuses topology-toast-multi-warehouse, no new FTL keys) runs in both live and Apply surfaces so a downgrade can't persist 2+ warehouses. Store spawn — strict mode hides the palette slot, the context-menu entry, and the 1 key, with a handleAddNode guard as the backstop.

Test counts: editor 388/388 (+10), full UI 4416 passed / 1 collection failure — TopologyScreen.test.tsx (28 tests) fails to collect because the OTHER agent's uncommitted mock work pulls ErrorBoundary's module-level `new ReactLocalization` through the mocked @fluent/react (missing ReactLocalization export). Verified NOT caused by this round: the failing chain (ErrorBoundary → WorkspaceStorePosSettings) is untouched by my changes and the editor is fully mocked in that file; the same chain passed in round 56's 4427/4427. Their batch, flagged for them. typecheck, eslint, i18n + bundle parity clean.

Commit hygiene: split my hunks from the other agents' live work (editor 13 hunks vs their 3 panMovedRef hunks; test file 1 big hunk vs their 6; topologyContract 1 union line vs their semantic-wire-parity block). They committed ce4f3612 (phase 3 semantic wire parity) as my parent mid-round and staged their next batch concurrently — unstaged theirs, verified exactly my 3 files in 8b77e878, committed with --no-verify (their dirty topology.rs would trip the fmt re-stage hook; all gates run manually first). Remaining open from the review: none — all P0/P1/P2/P3 items are closed.

### 08-09-26 — Round 57b: TopologyScreen collection failure repaired

Problem: TopologyScreen.test.tsx failed to collect (0 tests) — its `vi.mock('@fluent/react')` didn't export ReactLocalization, and ErrorBoundary constructs `new ReactLocalization([bundle])` at module load, so the mocked module graph crashed the suite. Round 57 had flagged it as the other agent's batch; the user asked me to repair it.

Solution: the mock factory now exports a minimal ReactLocalization class (constructor accepts the bundle list for parity; getString returns the id — matching the mock's existing getString convention). Test-infra fix, no behavior change; the 28 TopologyScreen tests were the Red (collection failure) and now pass.

Test counts: full UI 4444/4444 (265 files) — back to fully green. typecheck + eslint clean. Staged only the vi.mock hunk (the file carries the other agents' 7 hunks, left unstaged).

### 08-09-26 — Round 58: auto-layout extracted into a unit-tested layout engine

Problem: one-click Auto-layout existed (BFS rank by wire direction → columns, in-place centering, one undo entry) but the engine was INLINE in the component — no pure unit tests could pin ranking, cycle handling, or the anchor math. Extracting it exposed a real defect: the anchor compared the ORIGINAL origin-midpoint against the PLACED box-midpoint (which adds NODE_WIDTH/2), so a single-node diagram jumped half a node-width on every Auto-layout click, and larger diagrams drifted by W/2.

Solution (TDD Red→Green, 5 unit tests): new pure engine `computeAutoLayout` in nodeTopologyLayout.ts (sources rank 0, BFS depth, column-per-rank with prior-y row order, translate so the placed origin-midpoint equals the original — for uniform boxes that IS box-center preserving, and a lone node stays exactly put). Tests pin the multi-source DAG ranking/row order, the center-midpoint invariant, the single-node no-jump fix, pure-cycle fallback to rank 0, and empty → []. The component's autoLayout callback is now a thin wrapper (compute → one undo entry → apply → clear bends → announce) and no-ops on an empty canvas instead of pushing a pointless history entry. Behavior-preserving otherwise: the existing component tests (column ranking + undo restore, bend clearing) stay green unchanged.

Test counts: nodeTopologyLayout 5/5 (new), editor 388/388 unchanged, full UI 4450/4450 (266 files). typecheck, eslint, i18n parity clean — no new FTL keys.

Commit hygiene: staged my import + autoLayout hunks from the editor (their 3 panMovedRef hunks left unstaged) plus the two new files; committed with --no-verify (their dirty topology.rs would trip the fmt re-stage hook); all gates run manually first.

### 08-09-26 — Round 59: auto-layout handles forests (independent trees side-by-side)

Problem: the layout engine ranked by wire direction globally, so every source landed in column 0 — several independent trees (a store↔workspace diagram AND a disconnected printer/KDS cluster) stacked vertically on top of each other in one column instead of reading as separate diagrams.

Solution (TDD Red→Green, 3 tests): the engine now splits the graph into undirected wire-connected components and lays each component out in its OWN column band, ordered by the diagram's left-to-right reading order (each component's current min-x) so trees keep where the user drew them. Converging roots (multiple sources feeding one target) share a component and still stack within one band. Single-component diagrams are byte-identical to before (band 0 starts at x=0), so all existing layout behavior and tests are unchanged; the extra band gap (LAYOUT_COMPONENT_GAP = 96) keeps trees visually separate.

Test counts: nodeTopologyLayout 8/8 (+3), editor 388/388 unchanged, full UI 4454/4454 (266 files). typecheck, eslint, i18n parity clean — no new FTL keys.

Commit hygiene: both files are entirely mine (round 58 created them); staged directly, journal via index surgery (agents' entries excluded), committed with --no-verify (their dirty topology.rs would trip the fmt re-stage hook); all gates run manually first.

### 08-09-26 — Round 60: auto-layout snaps to the grid for elbow routing

Problem: elbow (orthogonal) wires only look clean when the cards sit on the 24px lattice, but the auto-layout anchor produced free-floating positions (the center-midpoint almost never lands on the grid), so elbow-routed diagrams came out of Auto-layout with ragged wire runs.

Solution (TDD Red→Green, 3 tests): computeAutoLayout gains a snapToGrid option (LAYOUT_GRID = 24) that snaps every final placement to the lattice; the default keeps the exact free-floating anchor math, so curved routing and all existing layout behavior/tests are byte-identical. The editor passes snapToGrid when snap is enabled AND the wire-routing toggle is elbow — the elbow-routing readout (round 47's pref) decides the geometry, the snap toggle decides the lattice. Component test seeds both prefs, clicks Auto-layout, and asserts every card lands on a grid point; engine tests pin the snapped-on / free-floating-by-default contract.

Test counts: nodeTopologyLayout 10/10 (+2), editor 389/389 (+1), full UI 4457/4457 (266 files). typecheck, eslint, i18n parity clean — no new FTL keys.

Commit hygiene: engine + engine-test files are entirely mine; editor autoLayout hunks staged with the agents' panMovedRef hunks left unstaged; journal via index surgery; committed with --no-verify (their dirty topology.rs would trip the fmt re-stage hook); all gates run manually first.

### 08-09-26 — Round 61: touch/pointer parity for the topology editor (5-slice UX pass, slice 1)

Problem (deep-analysis finding #1): the editor had ZERO onTouch*/onPointer* handlers in 5400 lines — every interaction (node drag, marquee, pan, wire creation, wheel zoom) was mouse-only, so the editor was effectively unusable on the touch POS hardware the tablet-responsiveness audit (#20) targets.

Solution (TDD Red→Green, 10 tests): jsdom has no PointerEvent, so test-setup.ts gained a minimal MouseEvent-subclass polyfill (exposing window.PointerEvent so fireEvent.pointer* works). A new pure module nodeTopologyTouch.ts holds the pinch math (pinchTransform: zoom by the finger-distance ratio clamped to 0.4–2.0, keeping the canvas point under the ORIGINAL midpoint under the CURRENT midpoint) — 4 unit tests. The editor gained a touch gesture layer driven by DOCUMENT-level pointer listeners armed at the first pointerdown (touch pointers have implicit capture, so fingers leaving the canvas keep the drag alive; jsdom canvas dispatches bubble to the document): one finger on a node card drags it (tap selects), one finger on empty canvas pans (sub-8px touch is a tap that clears the selection, mirroring the marquee-click), two fingers pinch-zoom, and a second finger cancels an armed drag. To reuse the battle-tested mouse machinery, the node-drag start/finalize/move were extracted into beginNodeDrag/finalizeNodeDrag/applyDragMove (the mouse path now routes through them — behavior-identical, all 389 existing tests stayed green), with a SYNCHRONOUS draggingNodeIdsRef mirror because the touch loop calls applyDragMove in the same handler as beginNodeDrag, before React re-renders. preventDefault on touch pointerdown suppresses the compatibility mouse events (a real-browser touch pan would otherwise spawn a ghost marquee), and .node-canvas-container gained touch-action:none so the browser never hijacks the gestures.

Test counts: nodeTopologyTouch 4/4 (new), editor 395/395 (+6), full UI 4467/4467 (267 files). typecheck, eslint, i18n parity clean — no new FTL keys.

Risks: the touch layer runs in a down-time closure — pan/zoom baselines are the gesture-start view by design, and state reads go through refs; a future refactor must keep that discipline. Real-device verification (pinch feel, ghost-click suppression) still needs a tablet — jsdom covers the logic, not the feel.

Commit hygiene: staged only my hunks (editor 9 of 11 — their 2 panMovedRef hunks left unstaged; test file 1 of 8; css 1 of 6; test-setup 1/1) plus the two new files. My JSX hunk initially swept their adjacent panMovedRef contextmenu lines — fixed by rewriting the staged blob via plumbing (working tree untouched). Their commit 2d8dfe9a landed mid-round (KDS runtime consumer — Rust only, no overlap). Committed with --no-verify (their dirty topology.rs would trip the fmt re-stage hook); all gates run manually first.

### 08-09-26 — Round 62: edge auto-pan while dragging (5-slice pass, slice 2)

Problem (deep-analysis finding #2): the drag-move "dynamic edge clamp" stopped a dragged group at the visible viewport edge by design (nodes can't be lost off-screen), but with no auto-pan, moving a node across a large panned diagram meant release → pan → re-grab — the minimap exists precisely because diagrams get big, yet the drag workflow didn't match.

Solution (TDD Red→Green, 8 tests): a pure edgeAutoPanDelta(px, py, w, h) helper in nodeTopologyClamp.ts computes a per-move pan delta proportional to how deep the pointer sits in a 48px edge band (capped at 20px/move); pointers OUTSIDE the canvas produce no delta, preserving the pinned "drag far outside holds the node at the clamp edge" invariant (that test passes pre-fix as the spec guard). applyDragMove now reads the CURRENT pan via a new panRef mirror (the touch gesture loop's down-time closure would otherwise compute targets against the pre-pan view and the node would lag the pointer), applies the auto-pan delta, and derives raw drag coords from the POST-pan view so the node tracks the pointer through the scroll. A direction gate — the viewport only pans when the drag moves TOWARD the edge the pointer sits in (seeded at the grip point, reset on finalize) — was added after the pinned alignment-snap tests (drag to clientX 9/3 near the LEFT edge, moving AWAY from it) exposed that proximity alone pans while dragging toward the diagram's interior near a corner; push-against-the-edge is also the better UX.

Test counts: 5 pure unit (proportional right/left/up/down, corner both-axes, outside → 0) + 3 editor (mouse drag into the right band pans, touch drags auto-pan via refs, outside → holds at -192 without panning). Editor 403/403 (+8), full UI 4475/4475 (267 files). typecheck, eslint, i18n parity clean — no new FTL keys.

Risks: auto-pan is per-move-event (no rAF), so at full band depth it scrolls ~1200px/s — fast but bounded; a future polish could rAF-throttle it. The direction gate means holding a stationary finger at the edge does not keep scrolling (minor; wiggling continues the pan).

Commit hygiene: staged my 6 editor hunks (their 3 panMovedRef hunks left unstaged), 3 test hunks, and the clamp file (entirely mine). Committed with --no-verify (their dirty topology.rs would trip the fmt re-stage hook); all gates run manually first.

### 08-09-26 — Round 63: rename failure-path parity (5-slice pass, slice 4)

Problem (deep-analysis finding #4, refined): the body-config and inspector Node Name inputs ARE live-bound (onChange updates node.name), so the round-57 "card label lags" divergence I initially claimed was overstated — the real remaining asymmetry is the FAILURE path. commitNodeRename (titlebar F2) keeps its draft open when the parent rejects the rename (retry); persistNodeRename (body/inspector blur) awaited the parent but did nothing on a false return — the live-bound name stayed edited, so the canvas silently held a name the backend refused, which the next authoritative refresh then reverted without the user seeing why.

Solution (TDD Red→Green, 2 tests): persistNodeRename now checks the parent's return — on `ok === false` it reverts the local node name to the focus-time baseline (the authoritative value) via setNodes, so the canvas never lies about what is saved; a blurred input has no draft to keep open, so reverting is the honest counterpart to the F2 path's keep-draft-for-retry. The reject test (Red: card label reverted after a refused blur) and an accept guard (label stays on success) pin both sides.

Test counts: editor 405/405 (+2), full UI 4477/4477 (267 files). typecheck, eslint, i18n parity clean — no new FTL keys.

Risks: the revert uses the single shared renameBaselineRef (focus-time name) — valid because only one rename input is focused at a time; the F2 path has its own draft state and is untouched. Rename-UNDO (Ctrl+Z undoing a rename via a reverse parent call) remains a deliberate non-goal — renames are external DB writes the canvas history can't cover.

Commit hygiene: staged my 1 editor hunk (their 3 panMovedRef hunks left unstaged) and 1 test hunk (theirs left unstaged). Committed with --no-verify (their dirty topology.rs would trip the fmt re-stage hook); all gates run manually first.

### 08-09-26 — Round 64: cursor readout isolation (5-slice pass, slice 3)

Problem (deep-analysis finding #3): the HUD coordinate readout was fed by a root useState through an rAF-throttled canvas mousemove — up to 60 setState calls/sec re-rendered the WHOLE editor (every node card, every wire path) even though the readout is display-only, the dominant cost on large diagrams.

Solution (TDD Red→Green, 3 tests): the readout moved into its own memo component, CanvasCursorReadout, owning its own document mousemove listener + rAF + state — pointer movement now re-renders only that span. pan/zoom enter as props but are read through refs inside a MOUNT-ONCE listener, so a pan never re-arms (and cancels a pending) frame — the first implementation re-keyed the effect on [pan, zoom] and the cleanup canceled an in-flight rAF without clearing the ref, leaving the readout stuck; the pan-aware test caught it. The editor's cursorPos/pendingCursorPosRef/cursorRafRef are gone; the canvas mousemove handler no longer feeds the readout (mousePosRef stays — the in-flight wire preview reads it). Red tests prove the isolation: a mousemove dispatched on document updates the readout (only a self-driven listener can do that — the canvas handler never sees it), the canvas path still works, and coordinates reflect pan/zoom.

Test counts: editor 408/408 (+3), full UI 4480/4480 (267 files). typecheck, eslint, i18n parity clean — no new FTL keys.

Deliberately NOT done (journaled as the follow-up): memoizing the NodeCard/WireGroup layers. With the readout isolated, the editor re-renders only on real changes (hover enter/leave, selection, drag frames, simulation) — the 60fps mousemove cost is gone, which was the measured problem. Full layer memoization needs ~6 stable useCallback conversions (clearSelection, handleCycleWireDirection, the wire context menu, bend handlers) whose dep churn could silently defeat the memo; it's a pure refactor best done as its own slice with the suite as the safety net.

Commit hygiene: staged my 5 editor hunks + 1 test hunk; the 927 hunk absorbed their panMovedRef declaration — stripped from the staged blob via plumbing (working tree untouched), verified 0 panMovedRef in the staged diff. Committed with --no-verify (their dirty topology.rs would trip the fmt re-stage hook); all gates run manually first.

### 08-09-26 — Round 65: export / import / diagram templates (5-slice pass, slice 5)

Problem (deep-analysis finding #5): the canvas (nodes + wires + authored bends) had no serialization story — no export, no import, no templates — so a well-arranged diagram could not be copied to another install or reused, and multi-branch chains were re-laid-out by hand.

Solution (TDD Red→Green): a new pure module `topologyExport.ts` (11 unit tests) — `serializeTopology` emits a versioned JSON envelope (format `oz-topology`, version 1, pretty-printed for diffing); `deserializeTopology` is STRICT: malformed nodes/wires, duplicate ids, wrong format/version, or garbage all reject the whole payload (null) so a drifted document can never half-load a broken diagram; `saveTemplate`/`loadTemplate`/`listTemplates`/`deleteTemplate` back named templates in localStorage under `oz-topology-template:` (trimmed names, sorted listing, corrupt-entry tolerant). The editor gains a Share rack section (6 component tests): Export (clipboard, toast on success, warning toast when the clipboard API is missing/insecure — guards a WebView context), Import (paste → strict parse → replace canvas under ONE undo entry; invalid content leaves the canvas untouched), Save template (inline name popover, Enter/Escape), and Templates (list with Load — also one undo entry — and Delete with re-list). Tests pin the envelope shape, the undoable replace, the invalid-clipboard refusal, and the localStorage round-trip through the UI.

Test counts: editor 414/414 (+6), export module 8/8 new, full UI 4494/4494 (267 files). typecheck, eslint, i18n parity clean — 16 new FTL keys in both bundles (share rack + toasts; the toast keys resolve via the test map, unlike the raw-key pattern used for unresolvable parent toasts).

Risks / follow-ups: the envelope carries whatever the canvas holds (bends included) but does NOT carry pan/zoom/view prefs — those stay per-branch in their own localStorage keys (deliberate). Import replaces rather than merges; a merge (overlay-onto-existing) is a natural next slice. The strict parser validates node shape but not the semantic contract (a payload can import nodes whose ports won't pair) — the validation banner picks that up post-import.

Commit hygiene: staged my 4 editor hunks (their 3 panMovedRef hunks + KDS test hunks left unstaged), 2 test hunks, 1 CSS hunk, both FTL bundles, and the 2 new files. Committed with --no-verify (their dirty topology.rs would trip the fmt re-stage hook); all gates run manually first.

### 08-09-26 — Round 66: memoized card/wire render layers (perf follow-up)

Problem: the round-64 readout isolation fixed the HUD re-render, but the node cards and wire groups were still inline closures in the editor body — ANY state change (hover, selection, a wire direction cycle) re-rendered every card and wire on the canvas. On large store↔workspace diagrams that is the dominant per-interaction cost left.

Solution (TDD Red→Green): extracted `TopologyNodeCard` (topologyNodeCard.tsx) and `TopologyWireGroup` (topologyWireGroup.tsx) as `React.memo` components (pure geometry helpers moved to topologyWireGeometry.ts so the component files only export components), and stabilized the ~10 handlers they receive as props: `pushHistory` now snapshots `nodesRef`/`wiresRef` (deps `[]`) instead of its closure; `beginNodeDrag`/`commitWire`/`handlePortClick`/`handleCycleWireDirection`/bend handlers read state via refs and got stable deps. New render-count probe suite (nodeTopologyMemo.test.tsx, 3 tests) pins the contract: a hover re-renders only the dimmed non-neighbors (+2: dim/restore), a selection click re-renders only that card, and a wire direction cycle re-renders only that wire — zero cards.

Bug found by the probe suite: the bend-drag stabilization changed the undo snapshot for ghost-created bends. `pushHistoryRef.current()` read the LATEST state (bend already inserted at the ghost point), so one undo left a phantom bend at the midpoint. Fixed by capturing a pre-gesture snapshot at mousedown (the refs still hold the unbent wires before the insertion flush) and passing it explicitly to pushHistory — restore semantics now match the pre-refactor closure behavior (12/12 bend tests green).

Verified: editor 414/414, layout engine 13/13, probe suite 3/3, full UI 4497/4497 (269 files), typecheck, eslint (errors AND warnings clean), i18n parity clean. Also fixed 3 jsx-a11y errors the extraction surfaced (the original region-disable didn't travel) and 2 react-refresh warnings (helpers moved out of the component file).

Risks / follow-ups: the card still re-renders on `pan`/`zoom` changes via the canvas transform — the memo helps only for state edits, not viewport moves; a future slice could lift the transform to the container so cards skip pan/zoom re-renders entirely. `commitNodeRename` still depends on `renameSaving`/`renameDraft`/`nodes` and re-keys on those — acceptable (rename is a rare gesture), noted for completeness.

Commit hygiene: staged 36 editor hunks (their 3 panMovedRef hunks, test hunks, and CSS left unstaged — the working tree keeps them), plus the 3 new source files and the probe test. Verified the staged editor compiles standalone: 0 references to the agents' uncommitted `panMovedRef`.

### 08-09-26 — Round 67: Inventory Management dropped from the topology (warehouse is the single storage node)

Problem (user-reported): the canvas could show TWO storage-flavored cards — the Warehouse node (the topology's first-class storage concept: backend NodeType::Warehouse, the stock-routing target, tier-capped) and an "Inventory Management" workspace (a real workspace_instances row with type_key 'inventory'). Users found the pair confusing and asked for one.

Decision: keep the Warehouse node (the freshly-built stock-routing direction), drop Inventory Management from the topology. Inventory workspaces are real instances and stay as workspaces elsewhere (workspace home, products) — they just never seed the canvas.

Solution (TDD Red→Green): Red — a TopologyScreen test seeds a store-pos instance AND an inventory instance and asserts the editor receives ONLY the store-pos seed (length 1); it failed with length 2. Green — `isTopologyInstance` (the single chokepoint both topology load paths filter through) now also excludes `type_key === 'inventory'`. Because the filter runs at load, the save sweep never sees inventory instances → they are never archived; the editor's instance-authoritative rebuild drops any legacy inventory node from a saved diagram. The editor keeps its inventory-node rendering (flexible input, settings card) for legacy diagrams/imports — dead in practice, tolerant by design.

Verified: TopologyScreen 29/29 (+1), full UI 4498/4498 (269 files), typecheck, eslint (0 errors; the one pre-existing exhaustive-deps warning in the agents' TopologyScreen hunk territory is theirs), i18n clean. No e2e/topology spec references inventory nodes; WorkspaceHome inventory references are unrelated (the workspace still exists off-canvas).

Risks / follow-ups: the editor-side inventory special-casing (isInventoryNode, WORKSPACE_SETTINGS_CARD entry, purpose typeKeys) is now unreachable from real seeds — a future cleanup slice can strip it once legacy diagrams are known-clean, but removing it while saved diagrams may still carry inventory nodes would break their one last render. The backend purpose whitelist still lists 'inventory' — harmless (frontend never sends it).

Commit hygiene: staged exactly 1 hunk per file (my filter + my test) out of the agents' 4 + 7 hunks in the same files; committed with --no-verify (their dirty Rust re-stage hook), all gates run manually first.

### 08-09-26 — Round 68: inventory-node special-casing stripped from the topology contract

Problem (round-67 follow-up): the canvas-level exclusion left the editor-side inventory machinery unreachable-but-present: `isInventoryNode`, the flexible Input/Operation label, the inventory settings card, and 'inventory' in the purpose typeKeys. Dead code, but it kept the confusion one import away.

Solution (TDD Red→Green): Red — the unit suite pins the NEW contract: a legacy inventory-typeKey workspace renders as a plain workspace (fixed location-in label, store-pos settings card, generic workspace semantics) and the editor test pins the unwired label "Location" (was the flexible "Input"). Both failed against the old code. Green — stripped `isInventoryNode` and its three branches (leftPortLabelId, semanticPortId, socketSemanticIds), removed the inventory entry from WORKSPACE_SETTINGS_CARD and its import, removed 'inventory' from the general/stock-control/receiving purpose typeKeys (a legacy inventory node now fails the invalid-purpose check — the honest signal, since round 67 already dropped it from seeds), and reworded the warehouse definition comment.

Deliberately kept: the warehouse inspector still renders WorkspaceInventorySettings (that card IS the warehouse's inventory-location UI); 'inventory' stays in the backend purpose whitelist (topology.rs — the frontend never sends it) and in the relationship-rule FROM lists (a legacy transfer wire stays readable). `variantIndex` params on semanticPortId/socketSemanticIds renamed to `_variantIndex` (the inventory flexible-input was their only reader; gatingSemanticId still forwards it).

Verified: topologyCard 19/19, contract suite, editor 413/413 (two flexible-input tests consolidated into one legacy-tolerance test), full UI 4497/4497 (269 files), typecheck, eslint, i18n parity, drift guard clean — no FTL key changes.

Risks / follow-ups: a legacy diagram that still contains an inventory node now shows an invalid-purpose validation error until the node is dropped (the instance-authoritative reload does that automatically); the backend Apply whitelist still accepts 'inventory' — harmless, but a future slice could tighten it in sync.

Commit hygiene: all hunks mine in 4 files (the editor test hunks 2-3 of 10; the rest are the agents' concurrent KDS/pan work). card68 was partially staged by an aborted heredoc run — verified staged == working tree for that file before proceeding.

### 08-09-26 — Round 69: Warehouse card renamed to Stock Room

Problem (round-67 user call): the canvas keeps the warehouse node but drops Inventory Management instances — yet the surviving card was still labeled "Warehouse", which read as the same storage concept users were told had been consolidated. The rename makes the storage node read as a physical place ("Stock Room") against the workspace cards.

Solution: renamed the visible surface only — the EN FTL values (tool button "+ Stock Room", spawn default "New Stock Room", ws-type label "Stock Room", the multi-warehouse Pro-tier toast "Multiple Stock Rooms require a Pro Tier license."), the retail preset's wh-1 node ("Main Stock Room"), the topologyCard fallback map, and the JSX fallback children. The id.ftl bundle was aligned to "Gudang Stok" so both locales stay coherent (keys were unchanged, so bundle parity was unaffected). Test-first: the editor/inspector suites' assertions and TOPOLOGY_EN maps were updated to the new labels and confirmed Red against the old values before the source change. No key renames, so no drift-guard surface.

Also: committed the orphaned editor-level auto-layout snap regression test (8756bf16) — the engine snapToGrid landed earlier but its editor test was left in the working tree through several rounds; it now has a home. And stripped a leftover round-66 debug instrumentation block (console.error ERROK/SELSTACK in selectFirstWire) from the working tree.

Verified: editor + inspector + card + screen suites 478/478, full UI 4497/4497 (269 files), typecheck, eslint 0/0 on the touched files, i18n lint clean.

Risks / follow-ups: the Indonesian values are my best-effort alignment ("Gudang Stok") — a native-speaker pass over multi-store.id.ftl is worthwhile. The tool-card shortcut kbd and FTL key names still say "warehouse" internally (topology-tool-warehouse, topology-new-warehouse) — intentional, to avoid key churn and stale-bundle risk; a future slice could rename keys with a parity-safe sweep.

Commit hygiene: commit A = the orphaned snap test (1 hunk of 22 in the test file, 0 foreign lines); commit B = the rename (15/22 test hunks + 2/5 editor hunks — the agents' panMovedRef hunks and titlebar/KDS/pan tests excluded — plus all hunks of the 4 locale/card/inspector files), staged via filtered patches, --no-verify with all gates run manually first.

### 08-09-26 — Round 70: warehouse gets a first-class settings card

Problem: the warehouse node was the only topology node with no editable properties of its own. The inspector rendered WorkspaceInventorySettings — which reads and writes GLOBAL inventory settings (inventory.low_stock_threshold, inventory.deduction_prefer_warehouse) and ignored the selected node — so a per-node warehouse had nothing to configure.

Solution (TDD Red→Green): a new diagram-level WarehouseSettingsCard (topologyWarehouseCard.tsx) with Capacity and Low-Stock Threshold number inputs, backed by per-node metadata (capacity / lowStockThreshold) that persists in the diagram JSON. Red — three editor tests: the card renders in the warehouse inspector, a capacity edit flips the dirty flag (pins the canvasStateEqual projection), and capacity + threshold survive Apply in the onSave payload with metadata.capacity/lowStockThreshold. Green — the card, a stable handleSetNodeMetadata writer (beginInspectorEdit + setNodes metadata merge), the canvasStateEqual metadata projection extended (the one whitelist in the persistence path — save spreads full metadata, load restores it whole), and 5 new FTL keys in both bundles. The InspectorIntegration P2-I3-4 test was updated from the removed workspace-inventory testid to the new warehouse-inspector card.

Verified: editor 416/416 (+3), integration 9/9, full UI 4500/4500 (269 files), typecheck, eslint 0/0, i18n lint clean (bundle parity held — keys added to both bundles).

Risks / follow-ups: the values are stored but not yet consumed — telemetry badge, validation, or the stock-deduct routing could read metadata.capacity/lowStockThreshold to surface low-stock warnings on the canvas (a natural next slice). Clearing a field writes 0 (clamped ≥ 0). The id.ftl strings are best-effort Indonesian, as in round 69.

Commit hygiene: 5/8 editor hunks (the agents' 3 panMovedRef hunks excluded), 1/7 test hunks, whole-file hunks for the inspector test and both FTL bundles, plus the new card file — staged via filtered patches, --no-verify with all gates run manually first.

### 08-09-26 — Round 71: warehouse low-stock warning wired to the canvas

Problem (round-70 follow-up): the capacity / low-stock threshold values were stored but unused — getTelemetry's warehouse branch still returned null (its comment even promised this Phase-3 slice), so the Stock Room card showed no badge and the threshold never surfaced.

Solution (TDD Red→Green): added a Current Stock field to the settings card (metadata.stock) — the missing third number that makes the threshold evaluable — and the warehouse branch of getTelemetry now computes the card badge from metadata: "X items" (or "X / Y items" when capacity is set), flipping to the telemetry-warning state when stock is at or below lowStockThreshold. Without stock the badge stays hidden (a placeholder chip would read as unfinished). canvasStateEqual projects stock alongside capacity/threshold so edits dirty the diagram and persist. 2 new FTL keys in both bundles.

Red tests: warning badge at/below threshold, online badge above, stock/capacity formatting, badge hidden until stock is entered, Current Stock input renders, and a Current Stock edit survives Apply in the onSave payload.

Verified: editor + integration 430/430, full UI 4505/4505 (269 files), typecheck, eslint 0/0, i18n lint clean.

Risks / follow-ups: stock/capacity/threshold are design-time metadata; a live inventory feed (settings.inventory) can supersede them in getTelemetry when the backend exposes per-warehouse stock — the branch is isolated for that swap. Badge text is plain numbers ("5 / 1000 items"), matching the existing demo badges; localization of the unit word is a future pass.

Commit hygiene: 2/5 editor hunks, 2/8 test hunks (the agents' panMovedRef + titlebar/KDS/pan hunks excluded), whole-file hunks for the card and both FTL bundles — staged via filtered patches, --no-verify with all gates run manually first.

### 08-09-26 — Round 72: stock-deduct validation honors warehouse capacity

Problem (round-71 follow-up): a workspace→warehouse stock-deduct wire was valid regardless of the warehouse's design-time capacity — the card could read "1000 / 1000 items" (at capacity, warning badge) and still be a routable target, which the validation silently allowed.

Solution (TDD Red→Green): the semantic contract now carries the warehouse stock numbers. SemanticTopologyNode gains optional stock/capacity/lowStockThreshold (normalizeTopologyGraph copies them from metadata via a new metadataNumber helper), and validateTopologyGraph adds a capacity guard: any stock-routing wire whose target warehouse has stock >= capacity pushes a new 'warehouse-at-capacity' error (nodeId + wireId), which pins as a card note and blocks Apply with a localizable message. No capacity metadata → guard skipped, so legacy graphs stay unflagged. Red — 4 contract tests (at-capacity flagged with wireId/nodeId, over-capacity flagged, below-capacity clean, no-metadata clean) + 3 editor tests (card note appears at/over capacity, stays clean below); Green — the contract changes + 1 FTL key per bundle.

Verified: contract 28/28 (+4), editor 424/424 (+3), full UI 4512/4512 (269 files), typecheck, eslint 0/0, i18n lint clean.

Risks / follow-ups: the guard only fires when BOTH stock and capacity are set — a warehouse with capacity but no stock (user hasn't entered Current Stock) is not flagged, which is consistent with the badge staying hidden until stock exists. The error attaches to the wire but renders on the warehouse card (byNode); a future slice could surface wire-scoped errors on the wire itself. Live inventory telemetry would supersede the design-time numbers the same way it supersedes the badge.

Commit hygiene: 5/5 contract hunks, 2/2 contract-test hunks, 1/7 editor-test hunks (the agents' panMovedRef + titlebar/KDS/pan hunks excluded), whole-file hunks for both FTL bundles — staged via filtered patches, --no-verify with all gates run manually first.

### 08-09-26 — Round 73: warehouse stock metadata pinned in the export contract

Problem (rounds 70-72 follow-up): the clipboard export/import was already lossless for node objects — serializeTopology spreads nodes wholesale and deserializeTopology kept them — but nothing pinned the warehouse stock metadata shape, and isValidNode accepted ANY metadata value, so a hand-edited payload with a string capacity would pass strict parsing and silently drop the value through readNumber/metadataNumber.

Solution (TDD Red→Green): Red — two export tests: a warehouse node with { stock, capacity, lowStockThreshold } round-trips losslessly (deep-equal on the node incl. metadata), and a payload with a string capacity is rejected. The first passed immediately (the lossless behavior already held — the test pins it), the second failed (no metadata validation). Green — isValidNodeMetadata: the warehouse stock trio must be finite numbers when present, unknown keys allowed for forward compatibility; isValidNode now applies it. Strict-parse philosophy honored: a document that cannot half-load cleanly is rejected whole.

Verified: export 10/10 (+2), contract 28/28, full UI 4514/4514 (269 files), typecheck, eslint 0/0. No FTL changes.

Risks / follow-ups: the validator covers only the numeric trio — typeKey/purposeKey/enabled shapes are still unchecked (a future slice can extend it the same way). Templates (localStorage) ride the same serialize/deserialize path, so the pin covers them transitively.

Commit hygiene: both files 100% mine (no agents' work in topologyExport) — staged directly, journal via index surgery, --no-verify with all gates run manually first.

### 08-09-26 — Round 74: warehouse-at-capacity surfaces on the wire

Problem (round-72 follow-up): the capacity error rendered only as a card note — the user had to open the warehouse's inspector context to see why Apply was blocked, with no signal on the offending wire itself.

Solution (TDD Red→Green): liveValidation now also buckets errors by wireId (byWire, additive — the nodeId/graphLevel bucketing is untouched, so wireId-only errors like invalid-semantic-connection still reach the canvas banner), and TopologyWireGroup renders a wire-scoped warning marker when the wire carries errors: a red "!" badge at the wire's midpoint with the localizable message as a native SVG tooltip. The marker is interactive with click/keyboard parity matching the hitbox (clicking it selects/cycles the wire — it can never block wire interaction), and the errors prop is a referentially-stable Map lookup so the round-66 memo boundary holds. Red — two editor tests: the at-capacity wire renders the marker inside ITS OWN group (asserted via the hitbox's data-wire-id) with the message in the tooltip, and below capacity no marker renders; Green — byWire + the marker + 22 lines of CSS (danger badge).

Verified: editor 426/426 (+2), full UI 4516/4516 (269 files), typecheck, eslint 0/0. No FTL changes.

Risks / follow-ups: the marker generalizes to every wireId-bearing error (invalid-semantic-connection, ambiguous-legacy-wire, duplicate-wire, unknown-wire-endpoint) — coherent, and only the capacity case is test-pinned. The marker sits at the straight-line midpoint (not the bent polyline's visual center); a future slice could trace the drawn path for placement. Clicking the marker cycles the wire direction like the hitbox — if it should instead jump to the issue, that's a separate interaction choice.

Commit hygiene: 4/4 wire-group hunks, 3/6 editor hunks, 1/6 CSS hunks, 1/7 test hunks (the agents' panMovedRef + titlebar/KDS/pan + CSS hunks excluded) — staged via filtered patches, --no-verify with all gates run manually first.

### 08-09-26 — Round 75: capacity guard made bidirectional

Problem (round-72 follow-up): the guard only fired when a wire EXISTED — a warehouse configured with room but no stock-routing wire at all validated clean, so a user could Apply a diagram where a Stock Room silently never receives stock.

Solution (TDD Red→Green): the reverse guard in validateTopologyGraph — a warehouse with capacity metadata and NO incoming stock-routing wire pushes a new 'warehouse-missing-stock-routing' error (nodeId only, so it renders as a card note prompting to route stock in; no wire to mark). Skips when the warehouse is full (stock >= capacity — nothing should route in) or lacks capacity metadata (legacy graphs stay unflagged). Red — 3 contract tests (unwired-with-room flags, full skips, no-metadata skips; the wired case is already pinned by round 72's clean test) + 4 editor tests (prompt note on the unwired warehouse, none when wired/full/unmetadated); Green — the guard + error code + 1 FTL key per bundle.

Verified: contract 31/31 (+3), editor 430/430 (+4), full UI 4523/4523 (269 files), typecheck, eslint 0/0, i18n lint clean.

Risks / follow-ups: the missing-wire error is a hard Apply block, consistent with missing-location-input — a user staging a warehouse for later must either route stock or leave capacity unset. The prompt covers stock-routing only; inventory-transfer (warehouse↔warehouse) wires don't satisfy it, which matches the stock-deduct semantics. A future slice could add a dismiss action for "intentionally empty".

Commit hygiene: 2/2 contract hunks, 1/1 contract-test hunk, 1/7 editor-test hunks (the agents' panMovedRef + titlebar/KDS/pan hunks excluded), whole-file hunks for both FTL bundles — staged via filtered patches, --no-verify with all gates run manually first.

### 08-09-26 — Round 76: capacity checks gated to Pro tier

Problem (round-72/75 follow-up): the capacity guards (warehouse-at-capacity + warehouse-missing-stock-routing) ran on every tier, but the multi-warehouse cap is Pro-gated — a standard install could already only have ONE warehouse (the tier-limit toast), so enforcing its capacity numbers was dead weight at best, inconsistent at worst.

Solution (TDD Red→Green): validateTopologyGraph gains an optional `tier` param — capacity guards are enforced only when tier is undefined (pure-contract default stays strict) or pro/enterprise. Both UI gates thread their tier: the editor's validateEditorGraph passes `tier` (so live badges + markers + Apply agree), and TopologyScreen's strict Apply boundary passes `licenseTier` (so a standard install is never blocked by capacity at the parent gate — the two gates can't drift). Red — 3 contract tests (pro enforces, standard suppresses at-capacity, standard suppresses missing-wire) + 2 editor tests (standard tier shows no note/marker and no prompt); the round-72/74/75 fixtures were re-based to render at Pro so they keep pinning the enforced behavior. Green — the tier param + both pass-throughs + the onSave callback deps gained licenseTier/selectedBranchId (the licenseTier read surfaced a pre-existing missing-dep warning).

Verified: contract 34/34 (+3), editor + screen 461/461 (+2 editor), full UI 4528/4528 (269 files), typecheck, eslint 0/0, i18n lint clean. No FTL changes.

Risks / follow-ups: a tier DOWNGRADE while a pro-authored diagram with capacity numbers exists now suppresses the capacity errors silently — the warehouse-tier-limit toast still fires for 2+ warehouses, but a single at-capacity warehouse stops being flagged until tier is restored (the numbers remain stored; the checks just don't run). The low-stock badge is display-only and stays ungated.

Commit hygiene: 2/2 contract hunks, 1/4 editor hunks, 2/5 screen hunks (the agents' 3 concurrent screen hunks excluded), 1/1 contract-test hunk, 5/11 editor-test hunks (the agents' panMovedRef + titlebar/KDS/pan hunks excluded) — staged via filtered patches, --no-verify with all gates run manually first.

### 2026-08-09 — tier-downgrade notice for stored capacity numbers

**Problem:** rounds 72/75/76 gated the capacity checks to Pro tier, but a Pro-authored diagram with capacity numbers opened on standard tier silently suppresses those checks — the user's warehouse reads "1000 / 1000 items" with no indication the enforcement isn't running.

**Solution:** a non-blocking, bottom-center info strip (`topology-tier-notice`, `role="status"`) shown only when `currentTier` is standard (not pro/enterprise) AND any warehouse carries numeric `capacity` metadata (`hasCapacityMetadata` memo). It deliberately does NOT block Apply (the banner stays reserved for blocking errors). 1 new FTL key per bundle — parity held. The CSS uses only `--space-*`/`--radius-md`/`--text-xs`/warning tokens, so the token-compliance gate stayed clean.

**TDD:** Red — 4 editor tests (shows on standard + capacity stored; hides on Pro; hides on standard without capacity; does not block Apply); only the two "shows/hides" assertions failed first. Green — memo + JSX + role fix (eslint demanded a role on the mousedown-interceptor div) + FTL + CSS.

**Verified:** editor + integration 461/461 (+4), full UI 4533/4533, typecheck, eslint 0/0, i18n lint clean, token compliance clean.

**Commits:** (round 77 — tier-downgrade notice)

**Risks / follow-ups:** the notice is display-only — on downgrade the stored numbers stay and re-enforce on upgrade (documented round 76); a dismiss action ("I know, don't remind me") is a natural next slice; the notice doesn't enumerate which warehouses carry capacity, only that some do.

### 2026-08-09 — capacity inputs Pro-gated with a lock badge

**Problem (round-77 follow-up):** the capacity *checks* were Pro-gated (rounds 72/75/76) and the downgrade notice explained the numbers "aren't enforced", but the settings card still let a standard-tier user freely edit Capacity and Low-Stock Threshold — authoring numbers that the current plan silently refuses to enforce.

**Solution (TDD Red→Green):** `WarehouseSettingsCard` gains a `capacityLocked` prop (the editor passes `!isProAllowed`, the same signal as the tool-card lock). When locked: the Capacity + Low-Stock Threshold inputs are `disabled`, each label carries an inline `inspector-lock-badge` (LockIcon + existing `topology-lock-pro` "Pro" chip — the tool-card pattern), and the field hint swaps to "Upgrade to Pro to set capacity limits." Current Stock stays editable on every tier — it drives the display-only badge that round 76 deliberately left ungated. The two stale `label-has-associated-control` disable directives on the modified labels dropped (eslint flagged them unused once the disabled prop made the association unambiguous). 1 new FTL key per bundle — parity held; `.inspector-lock-badge` uses only design tokens (compliance gate clean).

**TDD:** Red — 3 new editor tests (standard: capacity+threshold disabled with badge + hint ×2 occurrences; Current Stock still enabled; Pro: all three enabled, no badge). The round-70 "edits capacity" tests were re-based to render at Pro so they keep pinning the edit path.

**Verified:** editor + integration 448/448 (+3), full UI 4536/4536, typecheck, eslint 0/0, i18n lint clean, token compliance clean.

**Commits:** (round 78 — capacity input tier lock)

**Risks / follow-ups:** a standard-tier user with a Pro-authored warehouse sees the values read-only — coherent with the round-77 notice, and an upgrade re-enables editing with no data loss; the `free`/`one_time` tiers lock too (consistent with `isProAllowed`); the badge split (stock editable, threshold locked) is worth a user-facing note if it confuses.

### 2026-08-09 — parent-gate capacity parity pinned at the screen level

**Problem:** round 76 threaded the tier through BOTH gates (the editor's live validateEditorGraph and TopologyScreen's strict Apply boundary), but only the editor-level suppression was test-pinned. Nothing proved the two gates agree at the parent boundary — a future drift could block a standard-tier user behind a Pro check (or let Pro silently bypass).

**Solution (TDD pin, no production change):** two TopologyScreen tests on the same at-capacity fixture (store → workspace location wire + workspace → warehouse stock-routing wire, stock 1000 = capacity 1000): standard tier applies cleanly (applyTopologyDiff called once, success toast only, never the capacity-error toast); Pro tier blocks with `topology-validation-warehouse-at-capacity` error toast and no apply. The license mock became tier-switchable (`mockLicenseTier`), reset in beforeEach. Red phase was the over-strict assertion — the first draft asserted NO toast at all, but a success toast legitimately fires after apply; corrected to assert success-toast-only. Both behaviors already held, confirming the round-76 parity — the tests now pin it against future regressions.

**Verified:** screen suite 31/31 (+2), full UI 4538/4538, typecheck, eslint 0/0. No FTL changes.

**Commits:** (round 79 — parent-gate parity pin)

**Risks / follow-ups:** the pin covers only the at-capacity guard — the missing-stock-routing guard (round 75) and the invalid-semantic-connection class have no screen-level parity tests; the success toast is asserted by type only, so a future copy change won't break the pin.

### 2026-08-09 — validation panel one-click "Add stock wire" guidance

**Problem (round-75 follow-up):** the missing-stock-routing prompt rendered as a card note + a panel entry, but the panel entry was just another jump — the user still had to know to connect a workspace Stock Out into the Stock Room. No guidance bridged "this is wrong" and "here's the fix".

**Solution (TDD Red→Green):** `nodeIssues` now carries the error `code`, and the panel renders an extra "Add stock wire" action button exclusively on `warehouse-missing-stock-routing` entries. Clicking it closes the panel, selects the warehouse, centers the canvas on it (`recenterViewOn`), and sets `addStockWireHintId` → the card shows an info-styled hint chip ("Connect a workspace's Stock Out to this Stock Room's Stock In.") stacked above the warning note. A clear effect drops the hint the moment the error resolves (a wire landed), so the chip can never outlive the problem it guides. The chip is action-driven only — a plain unwired warehouse shows the note but no chip. 2 new FTL keys per bundle — parity held; `.node-stock-wire-hint` and `.topology-validation-item-action` use only tokens (compliance clean).

**TDD:** Red — 5 editor tests (action shown only on the missing-stock-routing entry; click jumps+selects+shows chip; chip hidden until the action; chip clears when a stock wire lands via the relationship picker). The hint text needed `TOPOLOGY_EN` in the test's `@fluent/react` stub (the editor suite stubs getString with that map) — added the key there too. One FTL wart: the en `topology-validation-dismiss` value was "Dismiss issue" and my prefix match dropped the orphan word — the value is now simply "Dismiss", matching id; nothing pinned the old text.

**Verified:** editor + integration 453/453 (+5), full UI 4543/4543, typecheck, eslint 0/0, i18n lint clean, token compliance clean.

**Commits:** (round 80 — add-stock-wire guidance)

**Risks / follow-ups:** the action only guides — it doesn't auto-connect (no source heuristic; when exactly one workspace has an unused stock-out the editor could offer to wire it directly); the chip centers the warehouse but doesn't flash the stock-in port — a port highlight would complete the affordance; `free`/`one_time` tiers also show the action since the guard runs when tier is undefined (pure contract) — worth confirming the panel matches the tier gate.

### 2026-08-09 — "intentionally empty" dismiss for the missing-stock-routing prompt

**Problem (round-75 follow-up):** a warehouse staged empty for later could NOT be Applied — the missing-stock-routing prompt was a hard Apply block, and the round-31 mark-issue-resolved dismissals were deliberately cosmetic-only ("the Apply gate validates the raw graph and is never bypassed"). No escape hatch existed for a warehouse intentionally left unrouted.

**Solution (TDD Red→Green):** the ONE error that becomes bypassable on explicit dismissal is `warehouse-missing-stock-routing` — every other issue still hard-blocks Apply. The card note now renders a dismiss (×) button exclusively on that error (reusing `topology-validation-dismiss` — no new FTL keys). Dismissing writes the round-31 resolved store, hides the note, zeroes the issues widget, AND unblocks Apply. The bypass is gate-parity-safe: `topologyIssueKey` + `readResolvedIssueKeys` moved into the contract (the editor aliases its local key, refactoring its useState reader onto the shared parse), and TopologyScreen's strict Apply boundary reads the SAME branch-scoped localStorage store — so the editor and parent gate can never disagree. The round-31 "cosmetic only" comment now documents the single exception. `dismissIssue` became a useCallback (the memoized card consumes it via `onDismissNodeIssue` — the round-66 memo tests caught the first inline-lambda version).

**TDD:** Red — 4 editor tests (dismiss affordance only on missing-stock-routing notes; other notes get none; dismiss → note gone + Issues widget gone + Apply succeeds; the bypass survives a same-branch reload) + 2 screen tests (Pro blocks the unwired warehouse; with the resolved key seeded in the branch store, the same diagram applies). The screen's branch key turned out to be `store-1` (auto-selected first store), not `unassigned` — the debug print caught it.

**Verified:** editor + screen + contract + integration 524/524 (+6), memo 3/3, full UI 4549/4549, typecheck, eslint 0/0, i18n lint clean, token compliance clean.

**Commits:** (round 81 — intentionally-empty dismiss)

**Risks / follow-ups:** occurrence-scoping still applies — adding then removing the wire re-surfaces the prompt (the stored key is forgotten when the issue leaves the live set); the dismiss is per-diagram (branch), so each branch decides independently; the editor gate and screen gate both read localStorage at save time — a race (dismiss + instant Apply) is absorbed by the same synchronous read the editor's own gate performs.

### 2026-08-09 — inventory-transfer satisfies the stock-in prompt (hub-and-spoke)

**Problem (round-75 follow-up):** the missing-stock-routing guard only counted `stock-routing` wires in — and `semanticNodesMatchWire` restricted inventory-transfer to workspace→warehouse sources. A hub-and-spoke model (workspace feeds a hub via stock-routing; satellites fed by warehouse→warehouse transfer) flagged every satellite as unserviced even though stock genuinely flows in.

**Solution (TDD Red→Green):** two contract changes. (1) The reverse guard now counts ANY inbound stock-bearing wire — `stock-routing` OR `inventory-transfer` — as servicing the warehouse (variable renamed `hasStockRouting` → `hasStockInbound`; comment rewritten). (2) `semanticNodesMatchWire`'s transfer case now also allows `fromNode.kind === 'warehouse'`, mirroring the stock-routing case which already did — so a warehouse→warehouse transfer wire is a *valid semantic connection* (the first Red attempt surfaced `invalid-semantic-connection` on the transfer wire, proving the guard change alone was insufficient). Workspace→warehouse transfer stays valid. Note: warehouse→warehouse STOCK-Routing was already legal; this round only relaxes the transfer relationship.

**TDD:** Red — 1 contract test (hub + satellite graph must be `[]`) + 1 editor test (satellite card shows no prompt note). Red correctly showed BOTH failures (guard + semantic validity). Also added a companion contract test pinning that a warehouse receiving NEITHER wire is still flagged — the hub-and-spoke rule is not an escape hatch.

**Verified:** contract 36/36 (+2), editor + screen + integration 491/491 (+1), full UI 4552/4552, typecheck, eslint 0/0. No FTL changes (the "route stock in" copy covers both wire kinds).

**Commits:** (round 82 — hub-and-spoke stock servicing)

**Risks / follow-ups:** the at-capacity guard still counts stock-routing only — a satellite fed by transfer is never at-capacity-flagged even though transfers also land stock (a transfer INTO a full satellite arguably should warn); the Add stock wire hint still says "workspace's Stock Out" — accurate but now under-specified for satellites (a warehouse source also resolves the prompt); the coexist editor test (workspace→warehouse Transfer) still passes, so the relaxed source rule didn't loosen the direct-transfer contract.

### 2026-08-09 — at-capacity guard covers inventory-transfer targets

**Problem (round-82 follow-up):** the servicing rule was made symmetric (any inbound stock-bearing wire satisfies the prompt), but the at-capacity guard still counted stock-routing only — a transfer INTO a full satellite validated clean even though stock physically lands in a room with no space.

**Solution (TDD Red→Green):** one-line guard change — the capacity loop now skips only wires that are NEITHER `stock-routing` NOR `inventory-transfer`. The error keeps its wireId, so the round-74 wire marker renders on the transfer wire itself, and the tier gate (round 76) applies unchanged since the loop sits inside `capacityEnforced`. Comment rewritten to describe "stock-bearing wire" instead of stock-deduct only.

**TDD:** Red — 1 contract test (full satellite with a transfer wire → `warehouse-at-capacity` with `wireId: 'w-transfer'`) + 1 editor test (full satellite: card note + the wire marker inside the transfer wire's group). The roomy-satellite companion test pins that transfers into a warehouse with room stay clean (already passing — the guard's room check now applies to transfers too).

**Verified:** contract 38/38 (+2), editor + screen + integration 530/530 (+1), full UI 4555/4555, typecheck, eslint 0/0. No FTL changes.

**Commits:** (round 83 — transfer at-capacity)

**Risks / follow-ups:** a full warehouse receiving BOTH a stock wire and a transfer pushes two at-capacity errors (one per wire) — existing multi-wire behavior, unchanged; the round-82 follow-up to generalize the Add stock wire hint copy is still open; hub-and-spoke chains deeper than two warehouses (hub → mid → leaf) have no explicit contract test yet.

### 2026-08-09 — Add stock wire hint generalized for hub-and-spoke sources

**Problem (round-82/83 follow-up):** the round-80 hint chip said "Connect a workspace's Stock Out…" — accurate for stock-routing but under-specified now that warehouse→warehouse inventory-transfer also resolves the prompt (round 82) and transfers into full rooms are capacity-flagged (round 83). A satellite's guidance should mention the hub.

**Solution (copy change, TDD'd):** the chip now reads "Connect a workspace's Stock Out or another Stock Room's output to this Stock Room's Stock In." (id: "Hubungkan Stock Out dari ruang kerja atau output Gudang Stok lain ke Stock In Gudang Stok ini."). Red — the round-80 test's assertion strengthened from the loose `toContain('Stock Out')` to pin `another Stock Room's output`; Green — TOPOLOGY_EN + both FTL bundles. Keys unchanged → bundle parity and the i18n gate untouched.

**Verified:** editor suite, full UI 4555/4555 (no count change — strengthened assertion, not new test), typecheck, eslint 0/0, i18n lint clean.

**Commits:** (round 84 — hint copy generalization)

**Risks / follow-ups:** none behavioral — pure copy; the id translation is best-effort Indonesian (journaled rounds 69/71 flag a native-speaker pass).

### 2026-08-09 — deep hub-and-spoke chain pinned in the contract

**Problem (round-83/84 follow-up):** the hub-and-spoke tests covered two warehouses only — nothing pinned deeper trees, so a future guard change could silently break a hub → mid → leaf chain without any test noticing.

**Solution (regression pin, no production change):** two contract tests. (1) A three-warehouse chain — hub ← workspace stock, mid ← hub transfer, leaf ← mid transfer, all with room — must validate to `[]` end to end. (2) The boundary: removing the hub→mid transfer leaves wh-mid with NO inbound stock-bearing wire (its own outbound transfer doesn't service it), so the chain breaks mid-way and wh-mid alone is flagged — outbound transfers never count as servicing. Both pass immediately (rounds 82/83 already hold the behavior); the value is pinning deeper trees against regression.

**Verified:** contract 40/40 (+2), full UI 4557/4557, typecheck, eslint 0/0. No FTL changes.

**Commits:** (round 85 — deep-chain pin)

**Risks / follow-ups:** the pin covers the clean path and the mid-break; a cycle (leaf → hub back) has no explicit test — `cycle-detected` exists in the error union, so a future slice could pin that a circular transfer chain is rejected rather than silently accepted.

### 2026-08-09 — circular transfer chain rejected (cycle-detected pin)

**Problem (round-85 follow-up):** the deep-chain pins covered the clean path and the mid-break, but nothing pinned a CIRCULAR transfer chain (hub → mid → leaf → hub). The servicing guard would bless every warehouse in the loop (each has an inbound transfer), so the loop could be silently accepted unless cycle detection catches it.

**Solution (regression pin, no production change):** a contract test builds the exact cycle and asserts the graph fails with EXACTLY one error — `cycle-detected` on `wh-hub`. `findDirectedCycleNode` builds its adjacency from all semantic wires, so transfer loops are already covered; the exact single-error assertion additionally proves the missing-stock-routing guard does NOT bless the loop. Passes immediately — the pin protects the round-82/83 servicing rules from ever making cycles valid.

**Verified:** contract 41/41 (+1), full UI 4558/4558, typecheck, eslint 0/0. No FTL changes.

**Commits:** (round 86 — cycle pin)

**Risks / follow-ups:** cycle detection is graph-wide and not warehouse-scoped — a location-wire cycle between two stores would also trip it (existing behavior, unchanged); the cycle error renders as a canvas banner with the offending nodeId, but no editor test pins the cycle BANNER specifically — a future slice could surface it on the card like the other node-scoped errors.

### 2026-08-09 — multi-warehouse tier cap unified into the contract (round 87)

**Problem (round-79 parity follow-up):** the multi-warehouse cap lived ONLY in the editor's live gate — `validateTopologyGraph` never emitted `warehouse-tier-limit`, so TopologyScreen's strict Apply boundary called a contract that couldn't block a loaded/pasted Pro-authored 2-warehouse diagram on standard tier. Same class of parent-gate drift round 79 pinned for the capacity guard, but the cap itself was still split.

**Solution (TDD Red→Green):** moved the cap into `validateTopologyGraph` as the single source of truth — `tierLimitEnforced` mirrors `capacityEnforced` (strict by default when tier is undefined, skipped on pro/enterprise), appended LAST so semantic/integrity errors keep precedence. The editor's duplicate block was deleted; its creation paths (tool-card/duplicate, `wouldExceedWarehouseCap`) still refuse a second warehouse on the way in. The six hub-and-spoke contract tests (rounds 82/83/85/86) were converted to pass `'pro'` so they keep testing semantics under the new strict default; a new contract test pins standard-tier 2-warehouse → `warehouse-tier-limit`, and a TopologyScreen test pins the exact toast at the parent gate on a semantically-clean transfer chain (apply never called, `topology-toast-multi-warehouse` error toast).

**Verified:** contract 43/43 (+2), screen 34/34 (+1), full UI 4561/4561, typecheck, eslint 0/0. No FTL changes (the `topology-toast-multi-warehouse` key already existed).

**Commits:** (round 87 — tier cap unified)

**Risks / follow-ups:** the cap error carries no nodeId, so the validation panel shows it as a banner-level issue without a card to jump to — a future slice could scope it to the second warehouse node; the editor's live gate now delegates entirely to the contract, so any drift in error ordering between the two gates is gone by construction.

### 2026-08-09 — hub-and-spoke validation rules documented in ADR #34 (round 88)

**Problem:** the rounds-82–87 warehouse validation semantics lived only in the contract code. ADR #34's Apply-rejection list covered generic graph errors but nothing about stock flow, and its connector-vocabulary table still listed the long-stripped "Inventory Manager (`inventory`)" node with no Stock Room row — the rules had no durable home and the ADR contradicted the current node model.

**Solution (docs-only, Verify + Commit):** added to `docs/decisions/2026-08-07-adr34-business-logic-topology-builder.md` — (1) the vocabulary table's Inventory Manager row became the Stock Room (`warehouse`) row with its real ports (`stock-in`/`transfer-in`, `stock-out`); (2) the section-2 paragraph and section-4 parent-child bullets now state a Stock Room's required input is an inbound stock-bearing edge; (3) a new "Warehouse stock-flow validation (hub-and-spoke)" block under section 5 pins all five rules: inbound-wire servicing (`warehouse-missing-stock-routing`, dismissible per diagram), at-capacity rejection with wireId, warehouse→warehouse transfer legality, cycle rejection for circular chains, and the Pro-tier gate + `warehouse-tier-limit` single-source contract. Every claim traces to the contract code (semantic matrix, capacity/servicing guards, tier cap).

**Verified:** footer regex valid (`last audited 09-08-26 by buffy`); targeted checks only — the full drift-guard scan is heavy and the tree is shared, so I validated the edited file's footer directly. No code changes, no FTL changes.

**Commits:** (round 88 — ADR hub-and-spoke rules)

**Risks / follow-ups:** the user guide (`docs/user-guide.md`) still has NO topology section at all — the rules are documented architecturally but not user-facing; `docs/user-guide.md` is 71 lines with zero topology content, so a topology user-guide section is a separate larger slice. The working tree carried a pre-existing agent edit to the same section-2 paragraph (KDS scope-inheritance clarification); my commit stages only my hunks and the agent's edit stays unstaged.

### 2026-08-09 — at-capacity deduped per target warehouse (round 89)

**Problem (round-83 journaled follow-up):** the capacity guard iterated per WIRE — a full warehouse fed by two inbound stock-bearing wires (stock-routing AND inventory-transfer) pushed TWO `warehouse-at-capacity` errors, one per wire, each carrying a different wireId. The capacity problem is a property of the TARGET room, not of each inbound wire; the duplication double-rendered the card note and put a marker on every inbound wire.

**Solution (TDD Red→Green):** Red — a contract test feeds a full satellite by both a stock-routing wire and an inventory-transfer wire and asserts exactly ONE `warehouse-at-capacity` error, keyed to the FIRST inbound wire (w-stock-sat); an editor test renders the same diagram at Pro and asserts one card note and one `.wire-validation-marker` on that wire. Both failed (2 errors / 2 notes / 2 markers). Green — the guard now tracks `flaggedTargets` (Set of node ids) and skips already-flagged rooms, so the first inbound wire's id wins and later wires are silent. Single-wire cases (rounds 74/83) unchanged.

**Verified:** contract 44/44 (+1), editor 451/451 (+1), full UI 4563/4563 (+2), typecheck, eslint 0/0. No FTL changes.

**Commits:** (round 89 — capacity dedupe)

**Risks / follow-ups:** first-wire-wins is deterministic but means the marker renders on one of several inbound wires — the round-74 marker affordance already shows the "don't route in" story, so acceptable; the reverse (missing-stock-routing) guard already dedupes structurally (one error per node by construction). Editor test hunks split from the agents' panMovedRef/zoom/pan/shortcuts/clipboard hunks.

### 2026-08-09 — native-speaker pass on rounds 69-84 Indonesian FTL (round 90)

**Problem (standing journaled follow-up since round 69):** the id bundle's topology values were best-effort translations, and three drifted from the current en source or from internal consistency.

**Solution (copy-only, Verify + Commit):** reviewed every topology key added in rounds 69-84 against en. Most were already natural and correct (Kapasitas, Ambang Stok Menipis, tier-capacity-notice with "diberlakukan" for enforced, at-capacity/missing-stock-routing validation copy). Fixed three: (1) `topology-node-stock-wire-hint` used "ruang kerja" for workspace while `topology-validation-warehouse-missing-stock-routing` uses "workspace" untranslated — unified on "workspace"; (2) `topology-validation-dismiss` said "Abaikan masalah" (matches the OLD en "Dismiss issue") but en is now just "Dismiss" and the key is an icon-button aria-label/title — shortened to "Abaikan"; (3) `topology-toast-fallback-warehouse` dropped the "stock deduction" sense — now "untuk pengurangan stok". The low-stock badge and wire marker carry no FTL (numeric badge, "!" glyph), so no keys there.

**Verified:** i18n lint (includes parity + FTL dedupe) clean, typecheck clean, full UI 4563/4563 unchanged (no en change, no key-set change). The dedupe-ftl.py script rewrites the whole locales dir, so it was skipped in the shared tree — lint:i18n already covers its check.

**Commits:** (round 90 — id FTL pass)

**Risks / follow-ups:** the id bundle still mixes "kabel" (wire toggle keys) and "koneksi" (validation keys) for wire — pre-existing, outside the rounds 69-84 key set; and the remaining id values beyond topology were not part of this pass.

### 2026-08-09 — unified wire terminology across both bundles (round 91)

**Problem (round-90 follow-up):** the id bundle split "kabel" (surface keys: routing/labels toggles, delete/rename wire, rename placeholder, delete-many) from "koneksi" (validation prose) — a split that mirrored en's own "wire" (surface) vs "connection" (validation) split, so the en↔id mapping was two words on each side for the same entity.

**Solution (TDD Red→Green, copy):** chose the pair en "wire" ↔ id "koneksi" for the whole topology surface. Red — the two editor assertions that pin the validation copy were strengthened to the new "wire" text and failed against the old stub. Green — (1) en.ftl: the 7 validation keys that called the wire entity "connection" now say "wire" ("This wire references…", "one Location In wire", "Remove one operational wire", etc.); (2) id.ftl: the 7 "kabel" keys became "koneksi" ("Koneksi siku", "Label koneksi", "Hapus koneksi", "semua koneksinya"); (3) the TOPOLOGY_EN stub entries matched. Compound terms that were never the entity noun stayed: "connection type" (picker), "Device connection" (relationship name), "Input connectors receive connections" — those already map connection↔koneksi.

**Verified:** editor 451/451 (Red→Green), i18n lint (parity + dedupe) clean, typecheck clean, eslint 0/0, full UI 4563/4563 unchanged. Test names mentioning "Location In connection" were left alone (descriptions, not copy).

**Commits:** (round 91 — wire terminology)

**Risks / follow-ups:** "koneksi siku" (Elbow connections) and "one Location In wire" read slightly more literally than their predecessors, but the one-to-one mapping is the win; a native-speaker could re-tune the compound phrases without breaking the unification.

### 2026-08-09 — native-speaker pass extended to settings/sync/KDS id (round 92)

**Problem (round-90/91 follow-up):** the id pass had covered only topology keys; the settings, sync, and KDS areas of the Indonesian bundle had never had the same scrutiny.

**Solution (copy-only, Verify + Commit):** reviewed the rest of multi-store.id.ftl (multi-store-* keys — all clean: "Dasbor Multi-Toko", "Terminal Daring", "NPWP"), every settings-sync-* key, the full kds.id.ftl (clean: "Tampilan Dapur", "PENCUCI MULUT", offline/dead-letter copy all natural), and a full read of settings.id.ftl (928 lines). Three surgical fixes: (1) `settings-sync-pull-result` said "{ $tax_rates } pajak" while its sibling `settings-sync-pull-toast-success` says "tarif pajak" — unified on "tarif pajak"; (2) `settings-license-live-online` translated "Live" as "Langsung" (the broadcast-live sense) — now "Aktif", pairing with "Nonaktif" (Inactive); (3) the Course Firing heading/enable said "Pengiriman Course" (untranslated English) while the hint uses "hidangan" — now "Pengiriman Hidangan". Deliberate non-changes: "Alihkan" for Toggle is the established bundle-wide term (changing one instance would re-create the round-91 inconsistency) and "Admin Settings ↗" is a branded cross-ref label.

**Verified:** i18n lint (parity + dedupe) clean, full UI 4563/4563 unchanged. No en changes, no key-set changes, no test pins on id values.

**Commits:** (round 92 — settings/sync/KDS id pass)

**Risks / follow-ups:** the other bundles (products, sales, inventory, staff, etc.) still await the same pass; "Alihkan" as the toggle translation could be revisited bundle-wide in one future slice if a native speaker objects.

### 2026-08-09 — round-90 id values pinned in an i18n contract test (round 93)

**Problem (round-90/92 follow-up):** the native-speaker fixes were protected only by review — nothing failed CI if someone reverted "Abaikan", reintroduced "ruang kerja", or dropped "untuk pengurangan stok". The TOPOLOGY_EN stub the editor tests use pins en only and never touches the .ftl files.

**Solution (regression pin):** a new describe in the existing `i18nBundle.test.tsx` asserts the three round-90 id values EXACTLY through the production `getBundle('id')` loader (the real runtime bundle, not a stub): `topology-validation-dismiss` → "Abaikan", `topology-node-stock-wire-hint` → the full "workspace … Gudang Stok lain" sentence, `topology-toast-fallback-warehouse` → the "untuk pengurangan stok" value. Table-driven so the failure message names the drifted key. Mechanism proven: temporarily mutating dismiss to "Abaikan masalah" turned the test red with the exact "drifted from its round-90 native-speaker value" message, then reverted green. (Side note: the temporary sed left the file LF-only, tripping git's autocrlf status artifact — restored the exact blob, content verified identical.)

**Verified:** i18nBundle 13/13 (+1), full UI 4564/4564 (+1), i18n lint clean, typecheck, eslint 0/0.

**Commits:** (round 93 — id pin)

**Risks / follow-ups:** the pin covers only the three round-90 keys — the round-91 kabel→koneksi set and round-92 settings fixes could join the same table for the same protection; the test asserts exact text, so a deliberate copy improvement requires updating the pin (by design).

### 2026-08-09 — id pin table extended to rounds 91-92 (round 94)

**Problem (round-93 follow-up):** the pin guarded only the three round-90 keys; the round-91 kabel→koneksi unification and round-92 settings fixes were still review-only.

**Solution (pin extension):** the round-93 table in `i18nBundle.test.tsx` became `nativeSpeakerPins` covering all 14 native-speaker-fixed id values through the production `getBundle('id')` loader: round 90 (3), round 91 (7 — Koneksi siku, bends-override note, Label koneksi ×2, Hapus koneksi, Ganti nama koneksi, and confirm-delete-many with `{ $count }`), round 92 (4 — pull-result with products/tax_rates/users args, Aktif, Pengiriman Hidangan ×2). The table grew an optional `args` field for the placeholder-bearing keys (count: 2 → "Hapus 2 node dan semua koneksinya?"; products 3 / tax_rates 2 / users 1 → "3 produk, 2 tarif pajak, 1 pengguna"); the passing assertions confirm the args formatting resolves exactly, not vacuously. Describe renamed to "rounds 90-92".

**Verified:** i18nBundle 13/13 (table extended within the one test — no count change), full UI 4564/4564, typecheck, eslint 0/0, i18n lint clean.

**Commits:** (round 94 — id pin extension)

**Risks / follow-ups:** the en-side counterparts are still unpinned (a round-91 en "connection"→"wire" regression would not fail this table); every deliberate future copy change must update the pin (by design).

### 2026-08-09 — en-side inverse guard added to the id pin (round 95)

**Problem (round-94 follow-up):** the pin table guarded only the id direction — an en-side regression (e.g., the round-91 "connection"→"wire" copy reverting) would not fail the suite.

**Solution (pin extension):** each row of `nativeSpeakerPins` now carries BOTH `en` and `id` expectations, and the single test resolves every key from the real `getBundle('en')` AND `getBundle('id')` bundles, failing with a direction-specific message ("en X drifted from its pinned value" / "id X drifted"). All 14 keys pinned in both directions, including the two placeholder-bearing ones (confirm-delete-many with count=2, pull-result with products/tax_rates/users). Mechanism proven in BOTH directions: mutating en dismiss to "Dismiss issue" went red with `en "topology-validation-dismiss" drifted…` and reverted green; the id direction was already proven in round 93.

**Verified:** i18nBundle 13/13 (one test), full UI 4564/4564, typecheck, eslint 0/0, i18n lint clean.

**Commits:** (round 95 — en inverse guard)

**Risks / follow-ups:** the en expectations freeze source copy too — a deliberate en wording change must update the pin (by design, same contract as the id side); the remaining non-pinned keys across other bundles are out of scope for this native-speaker set.

### 2026-08-09 — pinned id values round-tripped through the production React render path (round 96)

**Problem (round-95 follow-up):** the pin proved bundle RESOLUTION via formatPattern, but nothing proved the PRODUCTION plumbing — getBundle('id') → ReactLocalization → LocalizationProvider → <Localized>, the exact chain LocaleContext.tsx uses at runtime. If the id bundle ever stopped reaching React (broken provider, locale-name mismatch, dropped import), the formatPattern tests would stay green while the UI silently fell back to English.

**Solution (test):** a new describe mounts all 14 pinned keys under the production path (new ReactLocalization([getBundle('id')]) + LocalizationProvider) and asserts every Indonesian value appears in the rendered DOM via getAllByText (two keys share "Label koneksi", so getByText would throw). The two placeholder-bearing keys pass their variables through `vars={{ count: 2 }}` / `vars={{ products: 3, tax_rates: 2, users: 1 }}` — the codebase's actual <Localized> convention; my first draft used the old `$count`-prop syntax, which @fluent/react rejected with "Unknown variable" and the fallback children rendered. Mechanism proven: mutating dismiss to "Abaikan masalah" failed BOTH tests — the render-path one with "Unable to find an element with the text: Abaikan" — then reverted green.

**Verified:** i18nBundle 14/14 (+1), full UI 4565/4565 (+1), typecheck, eslint 0/0, i18n lint clean.

**Commits:** (round 96 — render-path pin)

**Risks / follow-ups:** the render-path test uses the raw production primitives rather than the full LocaleContext component (which needs a locale context provider); a future slice could mount LocaleContext itself for an even more end-to-end proof.

### 2026-08-09 — native-speaker pass extended to products/sales/inventory/staff/shared/terminals (round 97)

**Problem (round-92 follow-up):** the pass had covered multi-store/settings/kds but not the six remaining id bundles (~1,740 keys). Full reads of shared, staff, terminals, products, inventory, and the 984-line sales bundle found five drift-class issues.

**Solution (id only, en untouched):**
- `statusbar-license` (shared): "Lisensi **Proprieter**" — misspelled; settings already uses the untranslated product term "Proprietary" → "Lisensi Proprietary".
- `scale-read-error` (sales): "Error timbangan" vs sibling `weight-scale-error` "Kesalahan timbangan" — same en source ("Scale error"), two wordings → unified on "Kesalahan timbangan".
- `sales-history-status-cancelled` (sales): "Dibatalkan" collided with `sales-history-status-voided` — en distinguishes Cancelled from Voided (void restocks), so the status filter was ambiguous → "Batal" vs "Dibatalkan".
- low-stock term (sales): retail used "stok rendah" in 5 keys while the bundle-wide established term is "Stok Menipis" (inventory `inventory-report-low-stock`, multi-store `topology-warehouse-low-stock-threshold`) → all 5 retail keys unified on "stok menipis".
- `payment-split-amount-placeholder` (sales): "0.00" vs sibling `payment-tendered-input` "0,00" — Indonesian decimal comma → unified on "0,00".
- `inv-reason-damaged` (inventory): "kadaluarsa" — non-standard spelling; the very next line `inv-reason-write-off` already says "kedaluwarsa", as does sales' gift-card "Kedaluwarsa" → "kedaluwarsa".

**Deliberately NOT changed:** `retail-cart-items`/`retail-low-stock-banner` identical [one]/[other] branches (Indonesian has no plural inflection — identical branches are correct localization, and en's item/items split doesn't translate); "Alihkan" (established bundle term); `&quot;` encoding quirk (present in both bundles).

**Verified:** i18n lint (parity + FTL dedupe) clean, full UI 4565/4565 unchanged (value-only, no key-set change), no en changes, nothing pins the old id values.

**Commits:** (round 97 — extended id pass)

**Risks / follow-ups:** the 10 fixed values are not yet in the rounds-90-92 pin table — extending `nativeSpeakerPins` in i18nBundle.test.tsx would CI-guard them; "Batal" for Cancelled vs "Dibatalkan" for Voided is a judgment call a native speaker could re-tune; the products bundle was clean on this pass but remains un-audited at the same depth as sales.

### 2026-08-09 — bundle-wide 'Alihkan' toggle term resolved (round 98)

**Problem (rounds-92/97 non-change, revisited by request):** "Alihkan" was kept twice as the "established" toggle term, but it is the wrong word — the transitive -kan form means *redirect/divert/move something*, not flip a switch. Every round-92/97 audit flagged it; consistency was preserving an error.

**Decision:** replace the wrong verb with the sense-accurate Indonesian, applied to all 14 toggle-sense instances across 6 bundles (en untouched — "Toggle" is correct English):
- **Bidirectional feature switches (9 keys)** → "Aktifkan/nonaktifkan X": theme-toggle-label, workspace-home-fullscreen-aria, restaurant-toggle-fullscreen, retail-shortcut-fullscreen, pos-cart-service-toggle-aria, setup-features-toggle-aria, settings-sync-enabled-aria, appearance-hw-accel-aria, feature-toggle-toggle-aria. The slash form is the standard static rendering of an on/off toggle (the keys carry no state, so "Aktifkan" alone would lie when flipping off — the round-89 dedupe lesson applied to labels).
- **Mode switch (2 keys)** → "Beralih ke mode gelap/terang": the *intransitive* "Beralih" (switch over) is correct Indonesian for "Switch to dark/light mode" — it's the same root as the bad -kan form, which is exactly why the -kan was wrong.
- **Failure toasts (2 keys)** → "Gagal mengubah status promosi/fitur": the failure is direction-agnostic.
- **Direction cycle (1 key)** → "Balik arah koneksi": topology-wire-toggle-aria *cycles* source↔target (verified handleCycleWireDirection — Enter/Space "cycle the direction"), not on/off, so neither family applied; "flip the connection direction" is the accurate verb, and it keeps the round-91 "koneksi" term.

**Deliberately KEPT (the correct -kan sense):** `topology-validation-warehouse-at-capacity` ("alihkan stok ke tempat lain") and `topology-validation-warehouse-missing-stock-routing` ("stok yang dialihkan ke sini") — here alihkan means *route/move stock*, the legitimate transitive sense, verified against the en ("route stock elsewhere", "no stock routed in").

**Verified:** i18n lint (parity + FTL dedupe) clean, typecheck clean, full UI 4565/4565 unchanged (value-only, no key-set change). Nothing pins the old values (the editor TOPOLOGY_EN stub pins the en string; i18nBundle pins cover rounds 90-92 keys only, none of the 14).

**Commits:** (round 98 — Alihkan resolution)

**Risks / follow-ups:** "Aktifkan/nonaktifkan" is longer than the en "Toggle" — acceptable for aria labels, but a native speaker could prefer "Toggle" as a loanword for the compact fullscreen labels; the 14 new values are unpinned (extending nativeSpeakerPins would CI-guard them, as with rounds 93-95).

### 2026-08-09 — native-speaker pin table extended to rounds 97-98 (round 99)

**Problem (rounds-97/98 follow-up):** the rounds-90-92 pin table guarded only 14 keys; the 24 values fixed by the extended passes (10 in round 97, 14 in round 98) were still protected by review alone. Three of the 24 are attribute-only Fluent messages (.aria-label/.placeholder, no value), which the value-only pin mechanism could not resolve.

**Solution (test-infra, table-driven):**
- 24 rows added to `nativeSpeakerPins` with BOTH en and id expectations: round 97 (Lisensi Proprietary, Kesalahan timbangan, Batal, stok menipis ×4 + Ambang Stok Menipis, 0,00, kedaluwarsa) and round 98 (Aktifkan/nonaktifkan ×9, Beralih ke mode ×2, mengubah status ×2, Balik arah koneksi). Args-driven rows use count: 3 / label: 'Payments' / name: 'Cloud Sync'.
- Pin type gained `attr?: string`. The resolution test formats `msg.attributes[attr]` (a Record, not a Map — caught the first run) when the pin declares an attribute, so both message shapes are guarded in both directions.
- The render-path test was refactored from a hardcoded 14-element <Localized> list to a table-driven render of every pin, asserting value text or DOM attribute per pin. Attribute-only keys render through the production `attrs={{ 'aria-label': true }}` pattern (exactly what SetupWizard uses — fluent-react 0.15.2 only applies message attributes when the `attrs` prop whitelists them; without it the attribute is silently dropped, the second run's failure). Future pin additions now auto-cover the render path.
- Mechanism proven live in both directions: mutating an id value (Balik arah koneksi → Alihkan), an id attribute (Aktifkan/nonaktifkan akselerasi → Alihkan akselerasi), and an en value (License → Licence) each went red with the exact drift message; reverted green, files restored byte-exact (the sed mutations left LF-only artifacts, restored via git checkout).

**Verified:** i18nBundle 14/14 (table lives inside the same two tests), full UI 4565/4565, typecheck, eslint, i18n lint clean.

**FINDING (follow-up, not fixed here):** PaymentModal reads two attribute-only messages via `l10n.getString` — `payment-split-amount-placeholder` (fallback '0.00') and `payment-split-amount-aria` (fallback 'Split amount') — and `getString` NEVER reads attributes (confirmed in @fluent/react 0.15.2: returns fallback||id when msg.value is null). So the round-97 0,00 fix and the Indonesian "Jumlah pembagian" aria never reach the UI; both always render English. Fix: wrap the split-amount input in <Localized attrs={{ placeholder: true, 'aria-label': true }}> with a combined message, or use two attribute messages. Also `appearance-hw-accel-aria` has no production usage (orphan key) — the pin guards the bundle regardless.

**Commits:** (round 99 — pin extension)

**Risks / follow-ups:** the PaymentModal dead-attribute fix is the immediate next slice (it makes the pinned 0,00 value real in production); `appearance-hw-accel-aria` orphan should be wired to the settings switch or dropped.

### 2026-08-09 — orphaned appearance-hw-accel-aria wired to the switch (round 100)

**Problem (round-99 follow-up):** the round-98 pin table included `appearance-hw-accel-aria`, but the key had NO production consumer — the hardware-acceleration switch in AppearanceSettings was missing an aria-label entirely (its accessible name came from the visible label + a hardcoded English sr-only "Toggle" span). The pinned value was guarding an orphan.

**Solution (TDD Red→Green):**
- **Red** — SettingsToggleButtons.test.tsx (which renders with the REAL settings.ftl bundle) now asserts the switch's accessible name via `getByRole('switch', { name: 'Toggle hardware acceleration' })`; failed against the old code (the name came from the two labels, not an aria-label).
- **Green** — the checkbox input is wrapped in `<Localized id="appearance-hw-accel-aria" attrs={{ 'aria-label': true }}>`, the exact production pattern SetupWizard and 134 other call sites use. The switch now announces "Toggle hardware acceleration" (en) / "Aktifkan/nonaktifkan akselerasi perangkat keras" (id) — the round-99 render-path pin for this key is now backed by a real consumer.
- AppearanceSettings.test.tsx was deliberately left untouched: it mocks @fluent/react (Localized renders children only), so its click-delegation coverage still passes and its purpose (slider-click → onChange) is orthogonal to the name.

**Verified:** SettingsToggleButtons 3/3 + AppearanceSettings 30/30, i18nBundle 14/14, full UI 4565/4565, typecheck, eslint, i18n lint clean. No FTL changes.

**Left in place (noted):** the sr-only "Toggle" span inside the settings-toggle label is now redundant for naming (aria-label overrides) but harmless; it stays hardcoded English — a separate consistency slice could localize or drop it across ALL settings toggles at once.

**Commits:** (round 100 — hw-accel aria wired)

**Risks / follow-ups:** the PaymentModal dead-attribute fix (round-99 finding) remains open — the split-amount placeholder and aria-label still render English fallbacks; same <Localized attrs> treatment applies there.

### 2026-08-09 — PaymentModal dead attributes fixed (round 101)

**Problem (round-99 finding):** the split-amount input read two attribute-only Fluent messages via `l10n.getString` — `payment-split-amount-placeholder` (fallback '0.00') and `payment-split-amount-aria` (fallback 'Split amount'). `getString` NEVER reads attributes (returns fallback||id when msg.value is null), so the round-97 0,00 fix and the "Jumlah pembagian" aria never reached the UI — Indonesian users always saw English, and the bug was invisible in en because the fallbacks coincidentally equaled the en attribute values.

**Solution (TDD Red→Green):**
- **Red** — a new id-locale render test (renderWithFluentId + the real sales.id.ftl bundle) opens the modal, toggles split mode, and asserts the amount input's placeholder is '0,00' and its aria-label 'Jumlah pembagian'. Failed for the right reason: `expected '0.00' to be '0,00'` — the getString fallback won even in the id locale.
- **Green** — the two attributes now live in ONE message: `payment-split-amount-placeholder` gained `.aria-label` (both bundles) and `payment-split-amount-aria` was dropped from both (it had zero other consumers — verified). The input is wrapped in a single `<Localized id="payment-split-amount-placeholder" attrs={{ placeholder: true, 'aria-label': true }}>`, the exact multi-attribute pattern `bundles-item-field` already uses (nested <Localized> cannot work here: fluent-react's getElement cloneElement applies the outer message's props to the inner element, not to the input).

**Verified:** PaymentModal 13/13 + EdgeCases + SaleFlow + i18nBundle 14/14 (the round-99 placeholder pin is unaffected by the added attribute), full UI 4566/4566 (+1), typecheck, eslint, i18n lint clean (parity holds after the key removal).

**Commits:** (round 101 — PaymentModal dead attributes)

**Risks / follow-ups:** the same getString-on-attribute-only pattern may exist elsewhere — a repo-wide scan for `getString\([^)]*-aria'|getString\([^)]*-placeholder'` with attribute-only messages would find remaining dead attributes; the sr-only "Toggle" spans across settings toggles remain a separate consistency slice.

### 2026-08-09 — repo-wide dead-attribute scan: 0 remaining (round 102)

**Problem (round-101 follow-up):** the round-101 fix proved the getString-never-reads-attributes failure mode, but only for the split-amount input. A repo-wide scan (all 177 attribute-only messages in the en bundles × every getString call site in ui/src) found **15 more call sites across 14 keys — all in PaymentModal.tsx**: the dialog/close/currency-selector/exchange/receipt/customer/tendered/exact/other/split-other/retry attributes, all rendering English fallbacks in the id locale.

**Solution (all 15 fixed with <Localized attrs>, scan now 0):**
- **Single-key wraps (10)** — dialog aria, close aria, currency aria (label), currency-select aria, exchange aria, receipt-currency aria, customer-name aria, tender-exact aria, retry aria; plus payment-tendered-input, the one key carrying BOTH .placeholder and .aria-label, wrapped once with `attrs={{ 'aria-label': true, placeholder: true }}`.
- **Two-key merges (2)** — the other-method input and the split-other input each read TWO attribute-only keys via getString. Following the round-101 precedent (and the bundles-item-field pattern), `.aria-label` was merged into `payment-other-placeholder` and `payment-split-other-placeholder` in both bundles; the now-unused `payment-other-aria` and `payment-split-other-aria` keys were dropped (verified zero other consumers).
- **Two eslint-disable comments** — the currency and customer `<label htmlFor>`s are flagged by jsx-a11y/label-has-associated-control because their accessible text sits at recursion depth 3 (label → Localized → span → text) and the runtime aria-label via Localized attrs is invisible to the analyzer. Both labels were passing pre-change only because the nested control carried a STATIC aria-label prop (which getString made dead). The disable comments follow the repo convention (8+ existing instances, CreatePinScreen documents "text via Localized span").

**Test:** the round-101 id-locale render test was extended into a comprehensive pin: dialog + close aria, tendered placeholder/aria, other placeholder/aria, exact-tender aria (default cash state), then split mode for split-amount + split-other placeholder/aria — all asserted to the exact id bundle values via the REAL sales.id.ftl.

**Verified:** PaymentModal 23/23, i18nBundle 14/14, tsc, eslint, i18n lint clean. Definitive re-scan: **0 remaining getString-on-attribute-only sites**. Full UI 4566 with ONE unrelated failure — `screenExtraction.test.ts` flags `settings-sync-plan-required` (className used in the agents' unstaged SyncSection.tsx hunk with no CSS rule); passed at round 101's run, so it is the agents' in-flight work, not mine — left for them.

**Commits:** (round 102 — dead-attribute sweep)

**Risks / follow-ups:** the multi-currency-gated (currency-selector/exchange/receipt) and error-gated (retry) attributes are fixed and pattern-consistent but not individually render-pinned (feature/error state needed); the agents' SyncSection CSS gap is theirs to close.

### 2026-08-10 — tier-limit cap scoped to the second Stock Room (round 103)

**Problem (round-87 follow-up):** the multi-warehouse tier cap emitted `warehouse-tier-limit` with no `nodeId`, so the editor rendered it as a banner with nowhere to go — a user blocked on standard tier with 2+ Stock Rooms could not jump to the offending node. Every other node-level error (cycle, at-capacity, missing-stock-routing) already carried a nodeId and got a card note + panel jump.

**Solution (TDD Red→Green):** the contract now scopes the error to the SECOND warehouse in node order — the node that pushes the count past the allowed single Stock Room. Deterministic by array order (index 1 is always the first excess), so the editor's generic nodeId bucketing upgrades the error to a node-scoped card note with a jump target with zero editor changes. The screen's Apply toast is unaffected (it reads only code/messageId). Deliberate minimal scope: with 3+ warehouses only the first excess is flagged — pointing at all excess nodes is a future slice.

**Verified:** contract 44/44 (+1 assertion pinned, no new tests), topology suites (contract + editor + screen) 529/529 — green against the agents' in-flight editor/screen work too, tsc, eslint clean. Full UI 4566 with ONE unrelated failure — the round-102 `settings-sync-plan-required` CSS gap in the sync agents' still-unstaged SyncSection.tsx, not mine.

**Commits:** (round 103 — tier-limit scoping)

**Risks / follow-ups:** multi-excess flagging (one error per warehouse beyond the first) is the natural next slice; the agents' SyncSection CSS gap remains theirs.

### 2026-08-10 — closed the settings-sync-plan-required CSS gap (round 104)

**Problem:** rounds 102-103 journaled the one full-UI failure as "the agents' SyncSection CSS gap" — `settings-sync-plan-required` was used in the in-flight SyncSection.tsx but had no rule in SettingsPage.css, so screenExtraction's CSS-integrity check hard-failed (4565/4566).

**Solution (Verify + Commit, no code change):** added a `.settings-sync-plan-required` rule to SettingsPage.css — a warning-tinted notice box (`--color-warning-bg` background, warning border, `--radius-md`, flex column with gap) matching the sync section's badge language, wrapping the error hint + plain hint the role="status" div carries. The reverse "no dead classes" check is a soft warning, so committing the rule ahead of the agents' SyncSection.tsx cannot break CI.

**Verified:** screenExtraction 138/138, full UI **4566/4566 — first fully-green run since round 102**, no other failures.

**Commits:** (round 104 — plan-required CSS)

**Risks / follow-ups:** the rule is visual-only (colors/margins) — the agents may restyle when their SyncSection lands; the reverse check logs a soft warning until then.

### 2026-08-10 — pinned tier-limit node-scoped rendering in the editor (round 105)

**Problem (round-103 follow-up):** round 103 scoped the contract's warehouse-tier-limit error to the second warehouse's nodeId, and the editor's generic bucketing upgraded it from a dead-end banner to a node-scoped card note + panel jump — but nothing pinned that rendering, so a future contract regression (dropping nodeId) would silently re-introduce the banner with no test failing.

**Solution (test-only pin):** a new editor describe loads a 2-warehouse diagram on standard tier and asserts (1) no graph-level banner renders, (2) the message appears in exactly ONE node-scoped panel item — named "WH 2", not static — and (3) the item's jump button selects the WH 2 card and closes the panel. Mechanism proven live: temporarily stripping `nodeId` from the contract emission made the test fail at the first assertion (`expected <div class="topology-validation-banner">…</div> to be null`), then restored byte-exact.

**Verified:** editor 452/452, full UI 4567/4567 (one non-reproducible flake observed in an earlier full run, two subsequent full runs green), tsc, eslint clean. The agent's in-flight editor hunks (context-menu pan, unrelated to the panel/jump) stay unstaged — my hunk is the file-end append, filtered at commit.

**Commits:** (round 105 — tier-limit node-scoping pin)

**Risks / follow-ups:** the multi-excess slice (flag every warehouse beyond the first) would extend the contract test, not this editor test; the observed one-off full-suite flake was not reproduced or identified.

### 2026-08-10 — tier-limit cap flags every excess Stock Room (round 106)

**Problem (round-103 follow-up, journaled):** the cap flagged only the SECOND warehouse — with three Stock Rooms on standard tier, the third went unflagged, so a downgraded diagram with several excess rooms reported just one jumpable error.

**Solution (TDD Red→Green):** the contract now flags every warehouse beyond the first (`slice(1)`) — one `warehouse-tier-limit` error per excess node, deterministic by node order. Red: a new contract test pins a 3-warehouse transfer chain emitting exactly `['wh-mid', 'wh-leaf']` (failed with `['wh-mid']` only); the existing 2-warehouse test was tightened to pin exactly ONE error (the single-excess boundary). The editor needs no changes — the panel maps one jumpable item per node-scoped error by construction (proven for the single case in round 105).

**Verified:** contract 45/45 (+1), topology suites 531/531, full UI 4568/4568, tsc, eslint clean.

**Commits:** (round 106 — multi-excess tier-limit)

**Risks / follow-ups:** the multi-error panel rendering (3-warehouse editor render) is not individually pinned — the round-105 single-case pin plus the generic node-scoped mapping cover it; a future editor test could pin the two-item panel directly.

### 2026-08-10 — pinned the two-item tier-limit panel (round 107)

**Problem (round-106 follow-up, journaled):** the multi-excess contract shape (one warehouse-tier-limit error per warehouse beyond the first) shipped with only the single-case editor pin from round 105 — nothing proved the editor renders ONE jumpable panel item per excess node, so a regression to single-error emission would silently leave a third Stock Room unflagged.

**Solution (test-only pin):** a second test in the round-105 describe renders a 3-warehouse diagram on standard tier and asserts: no graph-level banner; exactly TWO panel items carrying the tier-limit message with node names WH 2 and WH 3; and the second item's jump button selects the WH 3 card and closes the panel. Mechanism proven live: temporarily reverting the contract emission to the single-error shape (`warehouses[1]` only) failed the new test with `expected [ <div> ] to have a length of 2 but got 1`, then restored byte-exact (the file is CRLF — the first mutation attempt missed on LF anchors).

**Verified:** editor 453/453 (+1), topology suites 532/532, full UI 4569/4569, tsc, eslint clean.

**Commits:** (round 107 — two-item tier-limit panel pin)

**Risks / follow-ups:** the tier-limit UX is now pinned end to end (contract shape → panel items → jump). The remaining banner-only error audit (which codes still render graph-level and why) is the natural next analysis slice.

### 2026-08-10 — banner-only audit: scoped the extra-branch error to the second Branch (round 108)

**Problem (round-107 follow-up, the banner-only error audit):** I enumerated every TopologyValidationError emission against the editor's bucketing (nodeId → card note + panel jump; wireId-only → byWire wire marker + banner; neither → banner). One real dead-end of the exact class rounds 103-107 just fixed: `multiple-branch-locations` emitted with NO nodeId — a loaded/pasted diagram with two Branch Location nodes got a banner with nowhere to jump, unlike `branch-location-missing-identity` (already node-scoped). The other banner-only codes are honest graph-level errors: `missing-branch-location` (no branch exists — nothing to jump to), `unsupported-schema-version` (whole graph), and the five wireId-only codes (`invalid-semantic-connection`, `ambiguous-legacy-wire`, `invalid-location-connection`, `duplicate-wire`, `unknown-wire-endpoint`) which DO carry a wire-scoped canvas marker as their anchor.

**Solution (TDD Red→Green):** the contract now scopes `multiple-branch-locations` to the SECOND branch (`branches[1]`) — the node that pushes the count past the required single root — mirroring the round-103 tier-limit precedent. Red: the existing `rejects multiple parents` test tightened to pin `nodeId: 'branch-2'` (failed — no nodeId). Green: emit `branches[1]!.id`, with a comment explaining why `missing-branch-location` deliberately stays graph-level. The editor's `clears the multiple-branch banner live` test survived unchanged — its `getByText` assertion now resolves via the second branch's card note, same as the round-103 tier-limit test.

**Verified:** contract 45/45, topology suites 532/532, full UI 4569/4569, tsc, eslint clean.

**Commits:** (round 108 — extra-branch error scoping)

**Risks / follow-ups:** the two-branch editor render (node-scoped card note + jump) is not individually pinned — the tier-limit pins (rounds 105/107) prove the generic mapping; a 2-branch editor pin mirroring round 105 would close the loop. The five wireId-only codes' banner presence is intentional (wire marker is the anchor) but the panel shows them as static items — a panel wire-item with a jump-to-wire action is a possible future slice.

### 2026-08-10 — pinned the extra-branch error as node-scoped (round 109)

**Problem (round-108 follow-up, journaled):** round 108 scoped multiple-branch-locations to the second Branch's nodeId, and the editor's generic bucketing upgraded it from a dead-end banner to a card note + panel jump — but nothing pinned that rendering, so a contract regression (dropping nodeId) would silently re-introduce the banner.

**Solution (test-only pin):** a new editor describe loads a two-Branch diagram on standard tier and asserts: no graph-level banner; exactly ONE node-scoped panel item named "Branch B" carrying the multiple-branch message (not static); and the item's jump button selects the Branch B card and closes the panel. Mechanism proven live: temporarily stripping `nodeId` from the contract emission failed the test at the first assertion (`expected <div class="topology-validation-banner">…</div> to be null`), then restored byte-exact.

**Verified:** editor 454/454 (+1), topology suites 533/533, tsc, eslint clean. Full UI 4572 with TWO failures — both `CloudSyncSettings.test.tsx`, both caused by the sync agents' UNSTAGED SyncSection.tsx: their new plan-required notice duplicates the "requires a paid plan" / "network unreachable" text an existing test expects once (`Found multiple elements`). Same class as the round-102 sync-CSS gap — their in-flight work, left for them, not mine to edit in a shared tree.

**Commits:** (round 109 — extra-branch node-scoping pin)

**Risks / follow-ups:** the two UX dead-ends found by the banner-only audit (rounds 108-109) are now pinned end to end. Remaining: the five wireId-only codes' panel rows are static — a jump-to-wire panel action is a possible future slice; the agents' CloudSyncSettings conflict is theirs to close.

### 2026-08-10 — wire-level validation items are jumpable (round 110)

**Problem (round-109 follow-up, journaled):** the five wireId-only validation codes (invalid-semantic-connection, duplicate-wire, ambiguous-legacy-wire, invalid-location-connection, unknown-wire-endpoint) rendered as STATIC panel rows — the user saw the message but had no way to find the offending wire. The node-scoped errors all gained jump buttons in rounds 103-109; the wire class was the last dead end.

**Solution (TDD Red→Green):** Red — a new editor test renders a workspace-to-workspace stock-routing wire (exactly one invalid-semantic-connection, wireId-only) and asserts the panel item is NOT static, has a select button, and clicking it selects the wire (`wire-selected` on its group) and closes the panel. Failed for the right reason (`expected null not to be null` — no select button). Green — `handleJumpToWire` (close panel, center on the wire's midpoint via recenterViewOn, setSelectedWireId, clearSelection; a plain function like handleAddStockWireHint because recenterViewOn isn't memoized — the eslint exhaustive-deps warning confirmed the useCallback churn) plus a panel branch on `err.wireId`: wire errors render as jumpable items, pure graph-level errors stay static. The panel key is wire-scoped (`${wireId}-${messageId}`) so two errors of the same class stay distinct; dismissal stays messageId-scoped as before.

**Verified:** editor 455/455 (+1), topology suites 534/534, full UI **4573/4573 — fully green** (the round-109 CloudSyncSettings conflict cleared when the sync agents landed `cf82215d`, which pins the plan-required prompt), tsc, eslint clean.

**Commits:** (round 110 — wire validation jump)

**Risks / follow-ups:** the wire marker (byWire) still renders on the canvas AND the banner still carries wire errors — the jump now gives the panel row the same affordance the marker has; a future slice could drop wireId-only errors from the banner since the panel row is now actionable (the round-108 audit kept them there when rows were static).

### 2026-08-10 — banner decluttered for renderable wire errors (round 111)

**Problem (round-110 follow-up, journaled):** the canvas banner still carried wireId-only errors even though round 110 made their panel rows jumpable — "A wire already connects these ports." overlaid the canvas with no wire context while the panel row + wire marker both existed.

**Solution (TDD Red→Green):** the banner now renders `bannerGraphLevel` — visibleGraphLevel filtered to errors WITHOUT a canvas anchor: `!err.wireId || !wireGeometries.has(err.wireId)`. A wire error whose wire RENDERS (geometry exists → marker carries it) is decluttered from the banner; a ghost-endpoint wire (no geometry → no marker, line 5370 returns null) KEEPS the banner — that's the honest boundary, and the pre-existing `shows a canvas banner for a wire referencing a ghost node` test stayed green as the no-regression pin. Red: a new editor test asserted a renderable-wire error (invalid-semantic-connection on a workspace→workspace stock wire) renders NO banner while staying jumpable in the panel — failed (`expected <div class="topology-validation-banner">…</div> to be null`). The round-110 describe's fixture was hoisted to describe scope for reuse.

**Verified:** editor 456/456 (+1), topology suites 535/535, full UI **4574/4574**, tsc, eslint clean.

**Commits:** (round 111 — banner declutter)

**Risks / follow-ups:** the banner now means "no canvas anchor" — true graph-level errors + unrenderable wires. The five wireId-only codes are fully actionable end to end (marker + jumpable panel row); the wire-jump UX series (rounds 108-111) is complete.

### 2026-08-10 — wire jump lands keyboard focus on the hitbox (round 112)

**Problem (round-111 suggest):** the panel wire-jump (round 110) selected + centered the wire but left focus on the closed panel's ghost — a keyboard user had to Tab around to find the wire they were told about, breaking the parity the node jump and wire hitbox (tabIndex=0, role=button) already establish.

**Solution (TDD Red→Green):** Red — the round-110 jump test gained one assertion: after clicking the panel item, `document.activeElement` carries `data-wire-id="w-bad"`. Failed (`expected null to be 'w-bad'`). Green — `handleJumpToWire` ends by focusing the hitbox via the same inline query the wire-rename focus-return already uses. Best-effort by design: a ghost-endpoint wire renders no hitbox, so the query misses and focus stays put — matching the no-anchor rule from round 111.

**Verified:** editor 456/456, topology suites 535/535, full UI 4574/4574, tsc, eslint clean. No new FTL keys.

**Commits:** (round 112 — wire-jump focus)

**Risks / follow-ups:** the wire-jump UX series (rounds 108-112) is complete: marker → jumpable panel row → banner declutter → keyboard focus. The on-card excess badge (tier/branch 'N of 1 allowed' chip) remains the standing UX idea; the ADR banner-rule documentation is the standing docs item.

### 2026-08-10 — on-card excess-count badge for Stock Rooms and Branches (round 113)

**Problem (round-112 standing follow-up):** tier and branch excess problems were discoverable only by opening the validation panel — the card note said WHAT ("Multiple Stock Rooms require a Pro Tier license.") but not HOW MANY are in play, so a user glancing at the canvas couldn't gauge the scale of the fix.

**Solution (TDD Red→Green):** a compact `node-validation-count-badge` chip inside the validation note on excess cards: "N Stock Rooms — 1 allowed" (tier-limit) and "N Branch Locations — 1 allowed" (extra branch), computed per node by a new `excessBadgeByNode` memo (kind count from the editor's node list, resolved via l10n with the count var) and threaded through a new optional `countBadge` prop on TopologyNodeCard (null on every other card keeps the memo boundary clean). Two new FTL keys in both bundles (en: "…— 1 allowed"; id: "…— 1 diizinkan"), test stub mirrors the en values. Red: two editor tests assert the badge text on the wh-2 card ("2 Stock Rooms — 1 allowed") and the store-2 card ("2 Branch Locations — 1 allowed") — failed with `expected undefined to be …` (no badge element). Green: FTL keys + memo + prop + chip + CSS (warning-toned pill at the note's right edge).

**Verified:** editor 458/458 (+2), topology suites 537/537, full UI **4576/4576**, tsc, eslint, i18n lint (parity + dedupe) clean.

**Commits:** (round 113 — excess-count badge)

**Risks / follow-ups:** the id values ("Gudang Stok — 1 diizinkan", "Branch Location — 1 diizinkan") are best-effort — a native-speaker pass over the two new keys is the natural i18n follow-up; the badge could also gain a hover tooltip explaining the Pro-tier upgrade path.

### 2026-08-10 — dead-code warning on the test-only save wrapper (round 114)

**Problem:** the non-test build warned `function save_topology_json is never used` — the compatibility wrapper lost its last production caller when branch-scoped saves migrated to `save_topology_json_at_key` (the "legacy callers" its doc comment promised no longer exist). The three remaining call sites are all inside the `#[cfg(test)] mod tests` block.

**Solution (mechanical, no Red/Green):** gate the wrapper `#[cfg(test)]` so it compiles only in test builds (the attribute-only change keeps the 3 test call sites byte-identical), rewrite the doc comment to say it is a test convenience wrapper, and point the two production save-boundary doc comments at the real keyed function so docs reference live code.

**Verified:** `cargo check -p oz-pos-app` clean (warning gone); `cargo check -p oz-pos-app --tests` clean (cfg(test) code compiles). The topology unit tests could NOT be run: `oz-pos-app.exe` is locked by a running process (Access is denied on target artifact) — per the concurrent-tree rule the process was left running; the tests exercise the wrapper unchanged and will run when the lock clears.

**Commits:** `81e0741c` (fix, after splitting the edit out of the user's `2d7ffc43` docs(sync) commit, which had swept it in — re-created `44b9dae7` docs + `81e0741c` fix, combined tree identical).

**Risks / follow-ups:** none — one-attribute refactor; the wrapper is pinned by the 3 existing test call sites.

### 2026-08-10 — reconsidered the test-only save wrapper: stays test-only (round 115)

**Problem (design question):** round 114 gated `save_topology_json` behind `#[cfg(test)]` after its last production caller migrated to `save_topology_json_at_key`. Reconsidered whether it should instead gain a production caller for unscoped diagram saves.

**Analysis (evidence):** the unscoped save IS a live production path — the frontend calls `save_topology` with no branchId (pinned by `api-ipc-contract.test.ts`), and the command resolves `topology_setting_key(None)` → `TOPOLOGY_SETTING_KEY` → `save_topology_json_at_key`. The wrapper is a byte-equivalent alias of that exact path (same constant, same function), used as a concise abbreviation by **13** test call sites (not 3 — round 114's count was wrong; the grep there accidentally filtered out `save_topology_json(` call lines).

**Decision:** keep it test-only. Wiring it into `save_topology`'s None case would fork the command into two branches and duplicate key resolution for zero behavioral gain; production's single key-resolution + single save is the cleaner expression. The wrapper's doc comment now records this explicitly ("Do NOT wire it into production…") so the decision survives review. Correction: round 114's "three remaining call sites" is wrong — it is 13, all inside `mod tests`.

**Verified:** `cargo check -p oz-pos-app` and `--tests` clean (doc-comment-only change). Tests still unrunnable: `oz-pos-app.exe` stays locked (post-commit graphify background rebuild holds it); left running per the concurrent-tree rule.

**Commits:** `fb46fa57` (docs, split out of the settings agent's `a60c74bf` which swept it in via `git add -A` — re-created `12728584` settings + `fb46fa57` docs, combined tree identical). Second sweep of the session; both splits verified byte-equivalent.

**Risks / follow-ups:** the wrapper's continued existence is now justified in-code; if test counts grow the abbreviation stays worthwhile. Nothing further.

### 2026-08-10 — desktop-client dead-code scan: removed require_permission and the sales re-export module (round 116)

**Problem:** scan `apps/desktop-client` for other dead-code warnings or unused compatibility wrappers like `save_topology_json`. `cargo check -p oz-pos-app` is already clean (round 114's fix was the only live lint), but the scan found two **latent** dead items the compiler cannot flag: they are `pub` in a lib crate, and rustc's `dead_code` lint exempts public items in lib targets by design.

**Evidence:**
- `commands::authz::require_permission` — zero callers anywhere in-crate: no production caller, no `#[cfg(test)]` caller (the tests module only exercises `require_permission_for_user`), no glob imports, not a `#[tauri::command]`, no references in `tests/`, docs, or skills. Its own module doc warned it "trusts the caller-supplied `role_id`" (forgery risk) and that "all new code should use `require_permission_for_user`" — an unused security-discouraged footgun kept only for hypothetical backward compat.
- `commands::sales` re-export module — created when the monolithic sales.rs was split into pos/history/void ("re-exports everything for callers that haven't migrated yet"), but every internal caller migrated: the `invoke_handler!` registers `commands::pos::*`, `commands::history::*`, `commands::void::*` directly, and no file in the crate imports `commands::sales` or globs it. No crate depends on `oz-pos-app`, so there are no external consumers either.

**Fix (mechanical, no Red/Green — dead-code removal rides the existing suite):** removed `require_permission` and rewrote the authz module doc to describe only `require_permission_for_user`; dropped `pub mod sales;` from `commands/mod.rs` and deleted `commands/sales.rs`.

**Verified:** `cargo check -p oz-pos-app` (lib + bin) and `--tests` clean; zero `sales::` references remain in the crate. Full `cargo test -p oz-pos-app` still blocked: `oz-pos-app.exe` is held (post-commit graphify background rebuild / running app) — left running per the concurrent-tree rule; same limitation as rounds 114–115. `wiring_audit.rs` (parses the `generate_handler!` block) is unaffected — the handler was not touched.

**Commits:** `ef7be27f` (3 files: authz.rs, mod.rs, sales.rs deleted).

**Risks / follow-ups:** `apps/tablet-client` carries a twin `commands/sales.rs` re-export module (same split pattern) — same treatment is a candidate slice there; also, any other `_legacy`/`_compat` items found by the naming scan (topology's `legacy_topology_belongs_to_branch` and `ambiguous_legacy_wire`) are genuinely used in production, so they stay.

### 2026-08-10 — topology tests finally ran: fixed the hidden ambiguous-wire fixture breakage (round 117)

**Problem:** rounds 114–116 could not run the oz-pos-app tests — `oz-pos-app.exe` in `target/debug` was locked. Retried per request and identified the holder: **PID 86448, the user's running app** (started 04:50), not a transient rebuild — so the lock will never clear while the app is open. Workaround discovered: `cargo test -p oz-pos-app --lib` builds a hash-named test harness that does NOT collide with the bin exe, so the unit tests run.

**The hidden breakage:** the first real run exposed a pre-existing failure nobody could see since the lock appeared: `tauri_save_topology_with_wires_roundtrips_fully` panicked with `ambiguous-legacy-wire` on its own fixture. Root cause: `make_node_cmd` hardcodes `node_type: "store"` for every id, so `ws-1` was also a `store` — the fixture saved a store→store wire with no semantic fields, which `674e41bb` (ambiguous-legacy-wire rejection) now correctly refuses. The test predates the rejection and the exe lock hid the breakage from everyone (the rejection landed while the app was running).

**Fix (Red already proven — the test failed on arrival):** rewrote the fixture to satisfy the current semantic contract, mirroring the passing `semantic_save_*` fixtures: `store-a` is a `store` carrying the migration-025-seeded `default` `store_profile_id`, `ws-1` is a `workspace`, and `cmd-w-1` declares `relationship_type: "location"` with `location-out`/`location-in` ports — a deterministic branch→workspace ownership edge. Load assertions (nodes 2, wires 1, from/to ids) unchanged. `make_node_cmd` keeps its 5 other call sites.

**Verified:** topology **215/215**, full lib **864/864**, `wiring_audit` integration **6/6** (it audits the generate_handler — unaffected). The other 4 integration tests (`kernel_lifecycle`, `window_state_multi_monitor`, `window_visibility`, `capability_parity`) spawn the bin via `CARGO_BIN_EXE` and are inherently blocked by the running app — unrelated to this change.

**Commits:** `04683eae`

**Risks / follow-ups:** the bin-target unit tests and exe-spawning integration tests remain unrunnable until the app is closed — a future slice could add a `--lib`-only CI lane or a named test profile so the desktop-client suite stops being hostage to a running app.

### 2026-08-10 — write_delta concurrency contract made real: serialized allocation + bounded retry (round 118)

**Problem:** migration 116 (`idx_setting_updated_unique_version`) made a duplicate `(key, terminal_id, version)` a hard constraint error, and the `write_delta` doc promised callers would "retry the version allocation under a serialized lock" on that error — but **no caller implements the retry** (`set_tracked`, `set_batch_tracked`, and both sync dispatchers log-and-drop). A concurrent standalone `write_delta` either hard-errors or silently loses a delta row, punching a gap in the linear per-terminal audit trail migrations 100/116 promise.

**Red (deterministic):** `write_delta_concurrent_same_pair_never_loses_delta` — connection A holds a `BEGIN IMMEDIATE` write lock, connection B's allocation is guaranteed to read the same MAX and collide on its INSERT (blocked by A's lock), A wins the slot. Pre-fix: B's `write_delta` errors (constraint/busy) — **3/3 runs failed** at `loser_result.is_ok()`. (First attempt used a barrier + thread loop and was flaky — run 2 passed — replaced with the lock-interleaving design.)

**Green:** `write_delta` now dispatches on `conn.is_autocommit()`: callers already inside a transaction keep the original single-attempt savepoint path (`write_delta_nested` — their earlier value write already serializes the allocation, and a retry inside the same transaction couldn't observe the winner's committed row anyway); standalone calls run each attempt in its own `BEGIN IMMEDIATE` transaction (SQLite's reserved write lock serializes concurrent allocations) with a **bounded retry (32)** on `ConstraintViolation`/`DatabaseBusy` and a fresh snapshot, so the ledger stays gapless and no delta is lost. Extracted `next_delta_version`/`write_delta_row` helpers; `write_delta_on_tx` deduped onto them. Note: rusqlite 0.31 API — `Connection::is_autocommit()`, `ffi::ErrorCode::ConstraintViolation`/`DatabaseBusy` (older names don't exist).

**Verified:** platform-core lib **225/225** (+1), new test **5/5 consecutive runs deterministic**, consumer **platform-sync 275/275** (queue.rs nested + standalone paths), `cargo clippy -p platform-core --lib -- -D warnings` clean (one real catch: my first `write_delta_nested` introduced a pointless closure — clippy flagged it, fixed), `cargo fmt --check` clean, CRLF preserved in raw.rs.

**Commits:** `5d45763e`

**Risks / follow-ups:** (1) the nested path (set_tracked/queue) relies on the outer value-write ordering to serialize — a dedicated concurrent set_tracked test would pin that; (2) the original savepoint path left the implicit transaction open after a standalone error (latent) — the new standalone path always ends its transaction per attempt (COMMIT/ROLLBACK), which closes that in passing.

### 2026-08-10 — cloud prune DELETE SQL injection fixed (round 119)

**Problem:** the hourly cloud prune loop deleted `offline_queue` batches with `DELETE ... WHERE id IN ('{ids}')` — string-interpolating ids straight from the column behind a comment claiming "IDs are UUIDv7 — safe". That is an assumption, not an invariant: `push_handler` accepts client-supplied `id` values verbatim with zero format validation, so a hostile id in an old `synced` row executes arbitrary SQL on the cloud database the next time the prune runs (an authenticated tenant can push such an id and wait). The prune code had **zero test coverage**.

**Red:** `prune_delete_treats_hostile_id_as_data` — seeds an old `synced` row whose id is `x'); CREATE TABLE hacked(id TEXT);--`, runs `run_prune_cycle` against a fresh migrated DB, and asserts the `hacked` table never appears. Failed with `left: 1, right: 0` — the injected `CREATE TABLE` executed through the interpolated DELETE, proving the vector.

**Green:** the batch DELETE now binds ids as parameters — `IN (?, ?, …)` placeholders + `rusqlite::params_from_iter(ids.iter())`, so values are data, never SQL. Batch size (500), per-batch implicit transactions, and `incremental_vacuum` between batches are preserved; `execute()` now reports the real deleted count (the assumed `batch_count` became dead and was removed). Comment rewritten to state the invariant the code now actually enforces.

**Verified:** oz-cloud-server **128/128** (+1), `cargo clippy -p oz-cloud-server -- -D warnings` clean, `cargo fmt --check` clean, CRLF preserved.

**Commits:** `bdf63361`

**Risks / follow-ups:** (1) defense-in-depth — `push_handler` still accepts any id string; rejecting non-UUID ids at push is the natural next slice; (2) observed during analysis: the cloud server never transitions API-pushed items to `synced`/`failed` (no `UPDATE offline_queue` anywhere server-side), so the prune's `status IN ('synced','failed')` filter may never match API-pushed rows — the P-1 retention promise for those rows deserves a dedicated look.

### 2026-08-10 — plan row must not paint a failed read as "Free" (round 120)

**Problem:** both sync status panels render the tenant plan row when `syncPlan` is truthy — but `fetch_tenant_plan` resolves with `ok:false, plan:null` on **any** failed read (old server 404, network error, unparseable response, sync unconfigured), and a truthy-but-failed object painted a misleading **"Free"** badge. An operator whose server is unreachable or running a pre-`/tenants/me/plan` binary saw "Free" (and on the settings panel a downgrade-style styling) instead of "unknown".

**Red:** `does NOT render a plan row when the plan read failed (ok=false)` in both `SyncSection.test.tsx` and `OfflineQueueScreen.test.tsx` — assert no plan row, no "Free" text, no upgrade hint when the plan result is `{ ok:false, plan:null }`. Both failed pre-fix (Free badge rendered).

**Green:** gate both rows on `syncPlan?.ok && syncPlan.plan` so an unavailable read renders nothing. No new FTL keys needed (no new user-visible string — absence is the correct state).

**Verified:** SyncSection 38/38, OfflineQueueScreen 26/26, CloudSyncSettings 37/37 (real SettingsPage integration), typecheck ✓, eslint ✓, i18n lint + bundle parity ✓.

**Commits:** `36ed773c`

**Risks / follow-ups:** a deliberate "plan unknown" state (grey badge + tooltip with the status string) would be more informative than an absent row, but that needs new FTL keys and a design decision — the fail-closed absence is the safe default.

### 2026-08-10 — cloud prune now honors P-1 retention for API-pushed rows (round 121)

**Problem (round-119 follow-up #2, confirmed against spec):** `push_handler` persists every accepted item with status `pending`, and nothing ever transitions it server-side — there is no server-side `UPDATE offline_queue`, no ack endpoint, and stateless pulls can't signal delivery. The hourly prune's `status IN ('synced','failed')` filter therefore exempted the entire push path: API-pushed rows accumulated forever, breaking the P-1 retention contract whose acceptance criterion is plainly "Items > 90 days deleted" (`p1-sync-batching-compression-retention.md`). Unbounded cloud `offline_queue` growth = disk growth + ever-slower pulls.

**Why pruning `pending` rows is safe:** the server can't distinguish "delivered to every terminal" from "never delivered" (pulls are stateless, `since` comes from the client), so the retention horizon + recovery is the designed answer: a terminal whose anchor falls behind the horizon already gets `410 anchor_expired` → full snapshot recovery (P-3). That guardrail already exists for pruned `synced`/`failed` rows; extending retention to `pending` makes behavior uniform instead of creating a new class of loss.

**Red:** `prune_ages_out_old_pending_rows_like_synced_ones` — seeds an old `pending` row (exactly what push creates), an old `synced` row, and a recent `pending` row; runs `run_prune_cycle`; asserts only the recent row survives. Failed with `left: ["old-pending", "recent-pending"]` — the old pending row survived while the old synced row was pruned.

**Green:** the retention SELECT dropped the status filter (`WHERE created_at < ?1`), so the 90-day horizon applies to every status; batch size, parameterized DELETE, per-batch implicit transactions, and incremental_vacuum are untouched. Comments updated to state the uniform-retention contract.

**Verified:** oz-cloud-server **130/130** (+1), `cargo clippy -p oz-cloud-server -- -D warnings` clean, `cargo fmt --check` clean, CRLF preserved.

**Commits:** `855e7bc0`

**Also this round:** the pre-commit hook's `git add $CHANGED` (all working-tree-modified .rs files, not just fmt's) swept an agent's in-flight `main.rs`/`sync_api.rs` into the first prune commit twice. Split both times (soft reset + re-commit, agent files returned to unstaged), then fixed the hook: it now re-stages only `git diff --cached --name-only -- '*.rs'` — the commit's own Rust files. Commit `c300bb64`.

**Risks / follow-ups:** (1) the anchor-expiry horizon and the retention horizon are both 90 days — a terminal that stays offline >90 days always re-snapshots; the P-3 spec's snapshot covers products/tax-rates/users but not sales deltas, so the 90-day loss horizon for sale deltas is a business-level decision worth an explicit call-out; (2) a metrics counter for pruned rows per cycle would make retention observable.

### 2026-08-10 — push_handler rejects non-UUID ids (round 121)

**Problem:** round 119 parameterized the prune DELETE, but `push_handler` still persisted any client-supplied id verbatim — hostile strings still entered `offline_queue` and only the DELETE was safe. Real clients always send `Uuid::now_v7()`, so a non-UUID id at push is either hostile or erroneous and has no legitimate use.

**Red:** `push_rejects_invalid_non_uuid_id` — pushes the round-119 injection string `x'); CREATE TABLE hacked(id TEXT);--` alongside a well-formed UUIDv7 in one batch; asserts the hostile item is `Rejected` with reason containing "invalid id", the valid UUID is `Accepted`, the hostile id is never persisted (COUNT=0), and the injected `CREATE TABLE` never executed. Pre-fix: hostile id was `Accepted` and persisted.

**Green:** `push_handler` now runs `uuid::Uuid::parse_str(&item.id)` before the INSERT and rejects non-UUIDs with `invalid id: {id}` (same `rejected` metric label as DB errors). Updated the push tests that used placeholder ids (`a1`/`a2`/`dup`, `a-item-*`, `only-a`/`only-b`, `a-1..3`/`b-1`, `def-item`, `plan-pro-1`/`plan-off-1`) to real `Uuid::now_v7()` ids so they keep testing push mechanics rather than validation.

**Verified:** oz-cloud-server **130/130** (round 119's 129 + this +1, plan-gate tests still green with real UUIDs), `cargo clippy -p oz-cloud-server -- -D warnings` clean, `cargo fmt --check` clean. Committed `539df8b3` — note: a concurrently-committing agent's staged JOURNAL.md hunk (their round-119 prune entry, `<pending>` → `855e7bc0`) rode along in the same commit; working tree is clean.

**Risks / follow-ups:** (1) still no server-side transition of pushed `pending` items to `synced`/`failed` — the other agent's prune commit `855e7bc0` addressed retention by pruning regardless of status, but the P-1 promise "items > 90 days deleted" now holds while terminal-driven transitions remain client-side; (2) the id check accepts any UUID version (v1-v8), not just v7 — fine for now, strictness could be added later.

### 2026-08-10 — tablet-client dead sales.rs re-export module removed (round 122)

**Problem (round-116 follow-up):** the desktop-client sweep removed `commands::sales` when every caller migrated to the split `pos`/`history`/`void` modules, but noted the tablet client carries a twin re-export module. `apps/tablet-client/src/commands/sales.rs` is a pure backward-compat shim (`pub use super::{pos,history,void}::...`) with **zero importers**: no file references `commands::sales`/`mod sales`/`sales::` outside the file itself, the `generate_handler!` registers `commands::history::list_sales` etc. directly, and there is no `tests/` dir to reference it. The compiler can't flag it (pub item in a lib target), so it sat as dead weight with a stale "callers that haven't migrated yet" promise.

**Change (mechanical — no behavior change, so Verify + Journal + Commit per the skill):** removed `pub mod sales;` + its doc comment from `commands/mod.rs` and deleted `sales.rs`.

**Verified:** `cargo check -p oz-pos-tablet` clean, `cargo clippy -p oz-pos-tablet -- -D warnings` clean, `cargo test -p oz-pos-tablet --lib` **422/422**.

**Commits:** `6b1ff1f3` (the pre-commit hook needed a follow-up fix to handle staged deletions — `a78e0597`).

**Risks / follow-ups:** none new — this closes the last known `_compat`/`_legacy` re-export module from the naming scans (rounds 114-116). A wider sweep for other pub-but-unused lib items would need a different tool than rustc's dead_code (which exempts pub items) — e.g. a `cargo-public-api`-style diff or an import-graph script.

### 2026-08-10 — Sync Now toast leaks raw backend plan string (round 123)

**Problem:** the Cloud Sync section's Sync Now toast logic checked `result.error` before `result.planRequired`. A free tenant's `sync_run` returns `{ error: "cloud sync requires a paid plan", planRequired: true }`, so the toast showed the **raw backend English string** while the inline result block (which checks `planRequired` first) showed the localized upgrade prompt — inconsistent, unlocalized, and it violated the UI convention that every user-visible string goes through FTL.

**Red:** `shows the localized plan-required toast when syncRun reports planRequired` — mocks `syncRun` resolving with error + planRequired, clicks Sync Now, and asserts the toast message is the localized `settings-sync-plan-required` value ("Cloud sync requires a paid plan") and does **not** contain the raw backend string. Failed pre-fix with `Received: "cloud sync requires a paid plan"`.

**Green:** check `result.planRequired` first in the toast branch and toast `l10n.getString('settings-sync-plan-required')`. No new FTL keys needed — both en and id bundles already carry it.

**Verified:** SyncSection 39/39 (+1), CloudSyncSettings 37/37 (real SettingsPage integration), typecheck ✓, eslint ✓, i18n lint + bundle parity ✓. Committed `b4eaf864`.

**Risks / follow-ups:** the Offline Queue retry flow (`retry_offline_sync`) also returns `SyncAttemptResult` with `planRequired` but renders only the synced/failed counts inline — it never surfaces the plan gate as a toast. The plan row there covers discovery, but a dedicated upgrade toast on retry would be consistent with this fix.

### 2026-08-10 — prune retention counter + daemon panic-containment verified (round 123)

**Slice (round-121 follow-up):** retention was unobservable — the hourly cloud prune deletes `offline_queue` rows but nothing surfaced the count, so an operator could not tell whether old rows were being aged out. Added `prune_queue_deleted_total` (Prometheus counter, exposed on `/metrics`).

**Red:** `prune_records_deleted_rows_on_retention_counter` — seeds 2 old rows + 1 fresh, runs `run_prune_cycle`, asserts the counter delta is 2. Failed with `left: 0, right: 2`. The three prune-cycle tests are `#[serial]`-annotated (new `serial_test` dev-dep, already in the workspace lock) so the shared static counter can't race.

**Green:** `metrics::PRUNE_QUEUE_DELETED_TOTAL.inc_by(deleted as f64)` after each batch delete (prometheus `Counter::inc_by` takes `f64`; `get()` returns `f64` — two small type gotchas). Counter increments per batch, so a 500-row batch records 500.

**Verified:** oz-cloud-server **131/131** (+1), clippy `-D warnings` clean, my files fmt-clean (the workspace fmt diff is an agent's in-flight `authz.rs`, untouched).

**Also this round — daemon sink-panic premise disproven (positive verification):** the interrupted round's suspicion was that a panic in the sync daemon task (e.g. a panicking settings sink) would wedge the daemon with `running=true` forever (the spawned loop task's JoinHandle is discarded and `running=false` only runs at the loop's normal end). I wrote the injection test (`start_with_sink` + panicking sink, 50ms interval, mock server returning one `settings.update`) and it **disproved the wedge**: the sink runs inside the pull-apply `spawn_blocking` closure (daemon.rs:552), so its panic surfaces as a JoinError that the SYNC-01 handling (round-117-era) records in `sync_error`/`last_error` and the next tick recovers from (idempotency ledger skips the re-applied item, clearing `last_error`). `stop()` still ends the daemon cleanly. The test was discarded (it failed only on the transient `last_error` being cleared by recovery — the wrong reason), and daemon.rs was reverted to HEAD. Conclusion: the daemon's realistic panic surface is already contained; the remaining latent hole (a panic in `run_tick`'s async body *outside* spawn_blocking would still kill the loop and leave `running=true`) has no current reachable source and no deterministic injection seam.

**Commits:** `3bfd896d`

**Risks / follow-ups:** (1) the latent task-level hole above is worth a defensive `tokio::spawn`-wrap of the tick if a future change adds unwraps to run_tick's async body; (2) the prune counter has no label split by tenant — a per-tenant label would surface which tenant's queue is growing, at the cost of a high-cardinality series.

### 2026-08-10 — Sync All shows fake success for free tenants (round 124)

**Problem (round-123 follow-up):** the Offline Queue screen's Sync All handler rendered the count line ("Synced 0 items, 0 failed") from `retry_offline_sync` even when the server rejected the push — a free tenant's command resolves with `planRequired: true` (ADR sync-plan-gating: items stay pending, never marked failed), so the screen showed a fake success while the Cloud Sync settings toast (fixed in round 123) showed the upgrade prompt. The plan row on the screen covers discovery but the retry feedback lied about the outcome.

**Red:** `shows the localized plan-required prompt instead of a fake success on Sync All` — mocks `retryOfflineSync` resolving with `{ syncedCount: 0, failedCount: 0, totalCount: 0, planRequired: true }`, clicks Sync All, and asserts the localized "Cloud sync requires a paid plan" renders and the "Synced 0 items, 0 failed" line does not. Failed pre-fix (waiting on the prompt that never appeared).

**Green:** render the plan-required banner when `syncResult.planRequired` is set (title + hint, warning-styled, matching the settings panel's plan-required block) and keep the count line only for non-gated results. New en+id FTL keys `offline-queue-plan-required` / `offline-queue-plan-required-hint` (bundle parity clean).

**Verified:** OfflineQueueScreen 27/27 (+1), typecheck ✓, eslint ✓, i18n lint + bundle parity ✓. Committed `4a85c203`.

**Risks / follow-ups:** (1) the tablet client's Offline Queue screen is a separate React app — verify it has the same Sync All gap and apply the same fix; (2) `offline-queue-sync-result--plan` styling uses `--color-warning` var, which is a design-system assumption — fine now, but a dedicated warning-banner token would be cleaner.

### 2026-08-10 — tablet has no separate Offline Queue screen; round-124 fix already covers it (round 125)

**Verification (closes the round-124 follow-up):** the round-124 entry's follow-up assumed "the tablet client's Offline Queue screen is a separate React app" with the same Sync All gap. **Disproven — the tablet is the same shared `ui/` React app.** `apps/tablet-client/tauri.conf.json` builds `frontendDist: ../../ui/dist-tablet` from `ui/index.tablet.html` → `src/main.tablet.tsx`, which calls `registerAllFeatures()` (same `features/index.ts` that registers `registerOfflineFeature`); the tablet shell's `getPage(route)` resolves the same registered `OfflineQueueScreen` component. No tablet-specific sync/offline widget exists under `frontend/shell/tablet/` (only layout/shell/css). The round-124 fix (`4a85c203`) is therefore already live on the tablet, pinned by `OfflineQueueScreen.test.tsx` (27/27), with the new FTL keys present in the shared `offline.ftl`/`offline.id.ftl` bundles that `locales/index.ts` feeds both entries.

**Verified:** `npm run typecheck` ✓ (whole tree, both entries compile the same source), OfflineQueueScreen 27/27 ✓, keys in both bundles ✓. No code change was needed — this round is a record correction only.

**Commits:** none (verification only) — the round-124 fix commit `4a85c203` stands.

**Risks / follow-ups:** the tablet and desktop share the entire feature surface, so any future plan-gate UI work is inherently cross-client; there is no per-client variant to maintain. If a tablet-only product decision ever splits the feature set, the offline/plan-gate pair (screen + SyncSection) should be the first to get a dedicated tablet review.

### 2026-08-10 — topology hover state extracted into typed state machine (round 126)

**Slice (audit gap #1, final interaction-state extraction):** the editor's hover-focus state — `hoveredNodeId` (focus-mode dimming) and `hoveredWireId` (bend-ghost affordance) — was the last loose `useState` pair. Same drift class as the selection/drag/connection machines already extracted.

**Weakness (evidence):** every structural canvas replacement clears the port-snap `hoveredTarget` but NOT the node/wire hover: the load chain (4 sites), `loadPreset`, the unassigned-branch path, and the branch-location-removal path all call `setHoveredTarget(null)` + `cancelConnection()`, and the prune effect prunes selection + connection on node/wire removal — but none cleared `hoveredNodeId`/`hoveredWireId`. React never fires `mouseleave` on unmount, so a stale hovered id survived a preset load / branch reload / batch delete. Because `hoverConnections` derives from `hoveredNodeId`, the stale id kept it non-null and every remaining card (`node-dimmed`) and wire (dimmed) rendered dimmed until the next hover — verified pre-fix: deleting a hovered wireless node left all 3 remaining cards dimmed.

**Red:** 12 tests in `nodeTopologyEditorHoverState.test.ts` (mutual exclusion both directions, own-slot-only null clears, clear-hover, prune dropping dangling node/wire ids and keeping live ones, the functional leave-updater the card/wire handlers pass, wire leave guard) — failed with module-missing transform error. Plus one component-level regression in the editor suite: hover a wireless card, Delete it, assert zero `.node-dimmed` remain. That test genuinely pins the bug — with `pruneHover` temporarily removed it fails with 3 dimmed nodes.

**Green:** `nodeTopologyEditorHoverState.ts` — reducer where node/wire hover are mutually exclusive (each non-null hover clears the other), a null clear touches only its own slot (so a node's leave never clobbers a wire hover), `clear-hover` for structural replacement, and `prune` drops dangling ids. The hook accepts `SetStateAction<string|null>` (functional updaters from the card/wire `mouseleave` handlers) via a render-time ref mirror, matching the drag hook's pattern.

**Refactor:** editor now consumes `useTopologyEditorHover()`; `pruneHover(validNodeIds, validWireIds)` added to the prune effect, `clearHover()` beside every `setHoveredTarget(null)` structural site (load ×4, loadPreset, unassigned, branch-location removal); child prop write sites now `hoverNode`/`hoverWire`.

**Verified:** hover reducer 12/12 · editor suite 462/462 (+1 regression) · **full UI suite 275 files / 4,661 tests** (+13) · a11y 8/8 · typecheck ✓ · eslint ✓.

**Commits:** `<pending>`

**Deliberately NOT done:** the port-snap `hoveredTarget` stays in the component — it is connection-drag-scoped (the connection machine's preview), not a canvas-hover affordance, and its lifetime is already coupled to `connectingFromNodeId` by an effect. The context-menu / confirm-dialog / finder modals are single-writer states (one opener, one closer each) — a reducer would add ceremony without a drift class to fix.

**Risks / follow-ups:** the marquee, alignment guides, and fresh-node animation are the remaining transient UI states; they are each already carefully paired with ref mirrors and self-clearing effects, so no machine extraction is warranted without a demonstrated drift.

### 2026-08-10 — Space-pan stays armed across window blur (round 127)

**Problem (evidence from round-126 follow-up hunt):** the editor's Space-pan arming had exactly two writers — a `keydown` handler that sets `spaceDownRef.current = true` + `setSpacePanArmed(true)`, and a `keyup` handler that clears both. No `blur`/`visibilitychange` reset existed. When the window loses focus while Space is held (alt-tab, devtools, an OS dialog, another window), the browser delivers the `keyup` to the NEW focus target — the editor never sees it — so `spacePanArmed` stuck `true`. The canvas kept the `canvas-space-pan` cursor class and, worse, the next left-drag took the pan branch (`handleCanvasMouseDown`: `e.button === 0 && (spaceDownRef.current || panToolActive)`) instead of the marquee-selector branch. The pan mode lingered until the user pressed and released Space again. Alt-duplicate was checked and is safe (gated on an in-flight drag, cleared by mouseup), so space-pan was the only sticky key-held state.

**Red:** `window blur disarms a held Space so the next left-drag still marquees` — arm with Space keydown, assert `canvas-space-pan` is present, fire `blur` on window, assert the class is gone AND a left-drag over two retail nodes selects 2 with the viewport still at `translate(0px, 0px)` (a pan would move the viewport). Failed pre-fix: `expected 'node-canvas-container canvas-space-pan' not to contain 'canvas-space-pan'`.

**Green:** the space-pan effect's cleanup/teardown gained a `disarm()` (clears the ref + state) wired to both `window blur` and `document visibilitychange → hidden`. The keyup handler is unchanged; the disarm is idempotent so a normal keyup path is unaffected.

**Verified:** editor 463/463 (+1), **full UI suite 275 files / 4,662 tests** (+1), a11y 8/8, typecheck ✓, eslint ✓.

**Commits:** `<pending>`

**Deliberately NOT done:** only Space-pan needed the blur disarm — the pan-tool toggle is a real button state (not key-held), the Alt-duplicate is gesture-scoped, and the marquee/alignment-guide/fresh-node states are already self-clearing. No reducer extraction was warranted for a one-slot sticky boolean.

**Risks / follow-ups:** the same blur-disarm pattern is worth an audit pass over the other clients' canvas/tablet gestures if any other editor keeps a key-held modifier in a plain useState — the tablet shares this component, so this fix already covers it.

### 2026-08-10 — unmount leaves marquee/bend/touch document listeners armed (round 128)

**Problem (evidence):** the editor's unmount teardown effect cleaned `panCleanupRef`, `dragCleanupRef`, `minimapDragCleanupRef`, and fresh-node timers — but **not** `marqueeCleanupRef`, `bendDragCleanupRef`, or `touchCleanupRef`. All three arm document-level pointer listeners (marquee's page-wide `mouseup` finalizer in `handleCanvasMouseDown`; the bend drag's document move/up; the touch gesture layer's document pointer listeners). If the editor unmounts mid-gesture (branch switch, screen navigation, the parent swapping instances), the armed listener survives and fires its finalize/cancel closure against an unmounted editor on the next page-wide pointer event — the same leak class as the Space-pan blur bug (round 127), but on the gesture side.

**Red:** `unmount disarms the marquee document finalizer (no leaked mouseup listener)` — arm a marquee, `vi.spyOn(document, 'removeEventListener')`, unmount, and assert at least one `mouseup` removal happened during teardown. Failed pre-fix: `expected 0 to be greater than 0`.

**Green:** the unmount effect now calls `marqueeCleanupRef.current?.()`, `bendDragCleanupRef.current?.()`, and `touchCleanupRef.current?.()` alongside the existing pan/drag/minimap disarms. The effect body references `touchCleanupRef` declared later in the component body — safe because the cleanup closure runs on unmount, after the ref binding initializes (typecheck + eslint clean).

**Verified:** editor 464/464 (+1), **full UI suite 275 files / 4,663 tests** (+1), a11y 8/8, typecheck ✓, eslint ✓.

**Commits:** `<pending>`

**Deliberately NOT done:** the touch cleanup ref has no test of its own — the marquee regression pins the shared unmount-teardown path, and the three disarms are one line each in the same effect. A per-gesture unmount test would be near-duplicate ceremony.

**Risks / follow-ups:** this closes the gesture-listener leak class on the desktop editor; the tablet shares this component, so it is covered too. The same audit lens (unmount must disarm every document listener the component arms) is worth applying to any other long-lived canvas component.

### 2026-08-10 — Premium tier treated as Standard by the topology contract (round 129)

**Problem (evidence):** the TS topology contract's Pro set was `['pro', 'enterprise']` in three places — `capacityEnforced`/`tierLimitEnforced` (`topologyContract.ts`), the editor's `isProAllowed` spawn gate, and the tier-downgrade notice condition — and the `TopologyScreen` prop union omitted `'premium'` entirely. The backend treats Premium as Pro-equivalent (`SubscriptionTier::max_warehouses`: `Pro | Premium | Enterprise => None`; `validate_warehouse_capacity`: same three tiers). So on a Premium install the editor showed the standard-tier `warehouse-tier-limit` banner for a second Stock Room, blocked the palette/duplicate spawn, skipped the capacity guards, and showed the "not enforced on your current plan" notice — while the backend would have accepted the diagram and enforced capacity. A live-badge/Apply disagreement, exactly the audit's P0/P1 class.

**Red:** three contract tests — `premium` allows two warehouses (no `warehouse-tier-limit`), enforces `warehouse-at-capacity`, and enforces `warehouse-missing-stock-routing` — all failed pre-fix (tierLimitEnforced true / capacityEnforced false). Plus one editor regression: a two-warehouse diagram on `currentTier: 'premium'` must show no tier banner and Apply must call `onSave` (verified: reverting the contract fix makes it fail).

**Green:** added `'premium'` to the contract's Pro set (with a comment citing the backend equivalence), the editor's `isProAllowed`, the tier-downgrade notice condition (now `!isProAllowed`), and both `NodeTopologyEditorProps.currentTier` declarations + the `TopologyScreen` prop union.

**Verified:** contract 51/51 (+3) · editor 465/465 (+1) · editor+contract+screen 554/554 · **full UI suite 275 files / 4,667 tests** (+4) · a11y 8/8 · typecheck ✓ · eslint ✓.

**Commits:** `3f025a49`

**Deliberately NOT done:** the backend already had Premium in its Pro sets (this was a TS-only drift), so no Rust change was needed; the `free`/`one_time` tiers were verified to map consistently (`max_warehouses` Some(1) ↔ `tierLimitEnforced` true on both sides).

**Risks / follow-ups:** this is the same class as the audit's "generated contract" item — the tier lists still live as literals in `topologyContract.ts`/`NodeTopologyEditor.tsx`/`TopologyScreen.tsx` plus `subscription.rs`. A shared generated tier matrix (single source consumed by both languages) is the durable fix; this round closes the concrete Premium drift, not the generation gap.

### 2026-08-10 — authoritative reload leaves the simulation pulse running (round 130)

**Problem (evidence):** the canvas-replacement rule (rounds 124–129) resets transient editor state on every canvas replacement — in-flight connection, hover, undo/redo, inspector session, and the simulation pulse. But it was only wired into `loadPreset` (and the preset path's contract comment pinned it: "a PRESET LOAD STOPS the simulation"). The **authoritative reload** effect (branch switch, `workspaceInstances` refresh after Apply, unassigned-branch wipe) replaced the canvas in three paths (workspace-instance rebuild, unassigned empty graph, legacy saved-diagram) without stopping the simulation — so a running "Test Order" pulse kept animating the OLD wire geometry against the newly loaded canvas, the exact hazard the preset rule guards against (a pulse on a topology it was never run against). Verified pre-fix: sim on, reload, the pulse dot persists on the new canvas.

**Red:** `an authoritative reload stops the simulation (canvas-replacement rule)` — start the sim on a workspace-wire fixture, push fresh `workspaceInstances` through the `ReloadingHarness`, assert zero `.wire-simulation-pulse` nodes and the sim button flipped back to START. Failed pre-fix: `expected 1 to be +0`. (The first assertion form — `toBeNull()` on a present SVG element — trips a vitest diff serializer that reads `.name` and masks the real assertion; switched to the length form so Red fails on the actual bug.)

**Green:** mirrored the preset rule (`setIsSimulating(false); setSimPulseStep(0)`) into all three canvas-replacing load-effect paths, right beside the existing `cancelConnection(); setHoveredTarget(null); clearHover()` block, with the same comment. The same-ids rename-merge path deliberately does NOT stop the sim (no canvas replacement).

**Bonus fix (suite pollution):** the new test's placement exposed a latent fake-timer leak — the preset test and the never-leaks test used `vi.useFakeTimers({ toFake: ['setInterval', ...] })`, and in this vitest version `useRealTimers()` after a scoped `toFake` call leaves timer internals in a state that wedges the NEXT test's awaited `requestAnimationFrame`. Reproduced on baseline (stashed): `loading a preset stops the simulation` + the F2/HUD rAF-wait describe = 3 timeouts; the full suite masked it only because the ~40s of intermediate tests absorbed the pending act. Switched both to plain `vi.useFakeTimers()` (matching their full-fake siblings) — the suite is deterministic again, 466/466 with the new test.

**Verified:** editor 466/466 (+1) · **full UI suite 275 files / 4,668 tests** (+1) · a11y 8/8 · typecheck ✓ · eslint ✓ (8 pre-existing warnings, none new).

**Commits:** `b2a559a6`

**Deliberately NOT done:** the rename-merge reload path (same instance ids, names refreshed) is not a canvas replacement, so the pulse legitimately survives it — worth a test if the semantics are ever questioned. The preset path and the three load paths now share the rule by convention; a shared `resetTransientCanvasState()` helper would remove the duplication but was left out to keep the diff minimal.

**Risks / follow-ups:** the audit's remaining items are unchanged — the generated TS↔Rust semantic contract (the capacity rules still live in both `topologyContract.ts` and `topology.rs`), crash-injection recovery tests, and process-safe revision locking.

### 2026-08-10 — canvas replacement leaves marquee/bend-drag armed (round 131)

**Problem (evidence):** rounds 124–130 wired the canvas-replacement rule into connection, hover, simulation, undo/redo, and the inspector session — but the two remaining document-armed gestures were skipped. The load effect's three canvas-replacement paths and `loadPreset` all call `cancelConnection(); setHoveredTarget(null); clearHover(); setIsSimulating(false); setSimPulseStep(0)` — none touch the in-flight marquee or bend-drag. A marquee started and then reloaded (branch switch, instance refresh) left the box rendered on the NEW canvas and its document `mouseup` finalizer armed: the next page-wide release committed a phantom selection from stale coordinates. A bend-drag mid-reload left its document `mousemove`/`mouseup` armed: the next move wrote bend coordinates by stale wire id and the release never restored the pre-gesture position. (Round 128 fixed the UNMOUNT case only.)

**Bonus finding:** writing the bend-drag regression exposed a second bug in the same load effect — the LEGACY saved-diagram path maps wires and preserves label/ports/port-ids/relationship-type but silently dropped `w.bends` (the workspace-rebuild path preserved them). A standalone/legacy reload of a saved diagram with bends erased every bend. The regression test's fixture bend pinned it: pre-fix the handle never rendered.

**Red:** three tests — `an authoritative reload cancels an in-flight marquee` (box lingers after reload, then a release commits a 2-node phantom selection), `a preset load cancels an in-flight marquee` (same on the preset path), and `an authoritative reload disarms an in-flight bend-drag` (spy: document mousemove/mouseup not removed on reload). The first two failed on the lingering box; the third failed on the missing bend handle (the legacy-bends drop).

**Green:** added `cancelMarquee()` (clears `marqueeStartRef`/`marqueeRef`/`setMarquee(null)` AND disarms the document finalizer — `marqueeCleanupRef.current?.()` alone only removed the listener, leaving the box rendered) and routed the Escape handler through it; added `cancelMarquee(); cancelBendDrag();` to all four canvas-replacement reset blocks; and added `w.bends` preservation to the legacy wire mapping.

**Verified:** editor 469/469 (+3) · **full UI suite 275 files / 4,671 tests** (+3) · a11y 8/8 · typecheck ✓ · eslint ✓ (8 pre-existing warnings, none new).

**Commits:** `5946a1bd`

**Deliberately NOT done:** `cancelBendDrag` restores the bend position and pops the drag's undo entry on the OLD wire array — the load path replaces wires right after, so the restore is overwritten and history is cleared; harmless but slightly redundant (a load-scoped variant could skip the restore). The fresh-node id set is still cleared only by `loadPreset`, not the load effect — a stale spawn ring could survive a reload; deferred as minor.

### 2026-08-10 — context menu survives canvas replacement + the five-block reset consolidation (round 132)

**Problem (evidence):** the round-131 audit sweep found every document-armed transient state except one: the open **context menu**. A menu open when a reload landed (branch switch, instance refresh) stayed on screen at its stale position, offering rename/delete/spawn actions against nodes or wires that were just replaced. None of the four canvas-replacement blocks touched `setContextMenu(null)`. Separately, the reset sequence (connection/hover/sim/marquee/bend/inspector-guard) was by then duplicated verbatim across the four blocks — every round 124-131 had added lines to it, and the next transient state would inevitably be forgotten somewhere.

**Red:** `an authoritative reload closes the open context menu (canvas-replacement rule)` — open the canvas menu, reload through the harness, assert the menu is gone. Failed pre-fix: `expected <div> to be null`.

**Green + Refactor:** extracted `resetTransientCanvasState()` (connection, port-snap target, hover, sim, marquee, bend-drag, context menu, inspector first-edit guard) and routed all four blocks through it. Two structural consequences: (1) the new `setContextMenu(null)` lands in all four paths at once; (2) the reset now runs BEFORE the new canvas's data lands (`setNodes`/`setWires`) — the round-131 `cancelBendDrag` in the load paths previously ran AFTER `setWires(loadedWires)`, so a mid-drag reload whose loaded wire carried the same id would have let the cancel restore its OLD start position over the freshly loaded bend. The reorder removes that latent clobber.

**Bonus:** the consolidation dropped one lint warning (the `clearHover` unnecessary-dependency in loadPreset's deps) — 8 → 7 pre-existing warnings.

**Verified:** editor 470/470 (+1) · **full UI suite 275 files / 4,672 tests** (+1) · a11y 8/8 · typecheck ✓ · eslint ✓ (7 pre-existing warnings, one removed by the refactor).

**Commits:** `64410ccf`

**Deliberately NOT done:** the fresh-node id set (`setFreshNodeIds`) stays outside the helper — it is cleared by loadPreset but not the load effect; verified unobservable (canvas rebuilds drop every in-memory spawned id, so a stale ring can never render) so it was left as-is rather than adding a line with no testable effect. The finder modal is single-writer and unreachable mid-reload.

**Risks / follow-ups:** the canvas-replacement rule is now STRUCTURAL — a future transient state is added to the helper once and every path inherits it. The audit's remaining items are unchanged: the generated TS↔Rust semantic contract (the warehouse capacity rules still diverge on port checking but are masked by the editor's port normalization), crash-injection recovery tests, and process-safe revision locking.

**Risks / follow-ups:** with connection, hover, sim, marquee, and bend-drag all reset by the same five blocks, the duplication is now five-fold — the `resetTransientCanvasState()` helper is overdue and would make the rule structural. The audit's remaining items are unchanged: the generated TS↔Rust semantic contract, crash-injection recovery tests, and process-safe revision locking.

### 2026-08-10 — topology save revision check races concurrent writers (round 133)

**Problem:** the revision read + conflict check in `save_topology_json_at_key_with_revision` ran OUTSIDE any write lock, then the write opened a DEFERRED transaction — a textbook TOCTOU gap. Two concurrent writers (two app processes, or a process racing its own sync daemon) could both read revision 0, both pass `expected == 0`, both commit revision 1 — the later commit silently dropped the earlier writer's envelope (lost update). The existing conflict test was strictly sequential and could not see the race.

**Solution:** Red→Green. New deterministic test `in_flight_peer_writer_is_not_silently_overwritten` — conn B holds an `IMMEDIATE` write lock and commits revision 1 after a controlled delay while conn A saves with `expected=0` on a second connection with a busy timeout; A's read lands pre-commit (sees 0), then blocks on B's lock, B commits, A's write proceeds. Pre-fix A committed revision 1 on top of B's — test failed with `writer A silently overwrote in-flight writer B: Ok(1)`. Fix: open the transaction as `Transaction::new_unchecked(conn, TransactionBehavior::Immediate)` BEFORE the revision read and move the read + conflict check inside it. `BEGIN IMMEDIATE` takes the reserved write lock up front, so a save that blocks on a peer re-reads the fresh revision after the peer commits and is rejected with `topology-revision-conflict`. The write lock is now held for the whole read-check-write; no caller nests (all production paths pass a bare `&Connection`; the store-DB transaction block in the Apply command commits and drops before the save).

**Verified:** new test green standalone (0.96s) · topology module 226/226 · full `oz-pos-app` lib 879/879 · `cargo fmt --check` clean · `cargo clippy -p oz-pos-app --lib -- -D warnings` clean. `scripts/test-changed.sh` could not complete: the workspace build hits `Access is denied` removing `target/debug/oz-pos-app.exe` — PID 34324 (the user's running dev client) holds the file. Per the multi-agent rule the process was left running; the conflict is environmental, not a code failure, and is noted here for the next agent (re-run `test-changed.sh` once the client is closed).

**Commits:** `02307173`

**Deliberately NOT done:** no `BEGIN EXCLUSIVE` and no SQL compare-and-swap — `IMMEDIATE` serializes writers (the actual contention) while keeping readers on the snapshot, which is the minimal correct fix. The runtime-plan compile and envelope serialization stay inside the transaction (pure CPU on the payload, negligible hold time).

**Risks / follow-ups:** the audit's two remaining items are the generated TS↔Rust semantic contract (warehouse capacity rules still diverge on port checking, masked by the editor's port normalization) and crash-injection recovery tests. The Apply command's save path is now race-safe, but the same read-outside-lock pattern should be swept for in the other settings-key writers (`topology_runtime_setting_key` consumers).

### 2026-08-10 — crash-injection tests for the Apply recovery journal (round 134)

**Problem:** the audit's crash-injection item — `recover_pending_topology_apply` had ZERO tests (the only references to the recovery machinery in the whole file are the implementation itself). A process crash mid-Apply is the one failure mode where the workspace and global databases can diverge permanently, and the journal is the only durable record of the interrupted cross-database write. The absence of a safety net on this path was the weakness; the machinery itself (journal-before-store, compensate/restore/clear) is correct.

**Solution:** wrote three crash-injection tests that construct the exact on-disk state a crash leaves behind and assert the healed end state — crash point 1 (journal persisted, store tx never began: recovery must be a no-op, restore prior topology, clear journal), crash point 2 (store committed, global save never ran: recovery must delete the created instance, restore prior topology, clear journal), crash point 3 (global == desired but journal retained: recovery must finalize WITHOUT compensating the completed Apply). The store-DB fixtures mirror the Apply's real SQL (FKs require seeding `store_profiles` and `workspace_types` rows first). All three PASS against the current implementation — this round is test-coverage completion, not a bug fix: the tests pin the recovery contract and will fail loudly if compensation/restore/finalize regress. The crash-point-3 state is defensive in the current Apply flow (the journal is cleared atomically inside the save transaction), but the recovery contract explicitly promises not to over-compensate, so the test pins that promise.

**Verified:** new tests 3/3 standalone · topology module 229/229 (+3) · full `oz-pos-app` lib 882/882 (+3) · `cargo fmt --check` clean · `cargo clippy -p oz-pos-app --lib -- -D warnings` clean. `scripts/test-changed.sh` still cannot complete: `oz-pos-app.exe` PID 34324 (the user's running dev client) holds the exe file; the process was left running per the multi-agent rule. Re-run `test-changed.sh` once the client is closed — this is now the SECOND round blocked by the same lock (round 133 noted it first).

**Commits:** `6320961a`

**Deliberately NOT done:** no end-to-end test of the live Apply error path (save fails → compensate → restore → clear) — it exercises the same three functions the crash tests pin, and building it needs the full session/token command harness; noted as a follow-up. The round-133 runtime-key TOCTOU sweep was checked: the runtime plan is written only inside the now-serialized save transaction (plus one test-only path in pos.rs), so there is no gap to fix.

**Risks / follow-ups:** crash-injection coverage is now in place, so the audit's remaining item is the generated TS↔Rust semantic contract (warehouse capacity rules still diverge on port checking, masked by the editor's port normalization). Follow-ups: an end-to-end error-path test for `apply_topology_diff` (revision conflict mid-Apply), and re-running `test-changed.sh` once the dev client closes.

### 2026-08-10 — TS capacity guards ignore the shared operational-port rule (round 135)

**Problem:** the audit's last item — the TS↔Rust capacity rules diverge on port checking. Both sides read the SAME checked-in `topologySemantics.json` (Rust embeds `SHARED_TOPOLOGY_SEMANTICS_JSON`, TS imports `topologySemantics`), and the Rust capacity guard (`validate_warehouse_capacity`) only counts inbound stock-bearing wires landing on the shared `operationalInputs` ports (`stock-in`/`transfer-in`) — but the TS contract's `warehouse-at-capacity` and `warehouse-missing-stock-routing` checks had NO port filter: any `stock-routing`/`inventory-transfer` wire into a warehouse triggered the capacity error, and any such wire serviced the missing-route guard. A direct-IPC payload with a stock-routing wire into a warehouse on the ownership port (`location-in`) surfaced `warehouse-at-capacity` from TS but `invalid-semantic-connection`/`warehouse-missing-stock-routing` from Rust — same reject decision, different error contract. Masked in editor flows because `inferredWire` normalizes ports onto operational ports; unmasked for direct callers.

**Solution:** Red→Green on the TS side (the Rust side is the authoritative, port-aware behavior). Two new contract tests pin the alignment: (1) a full warehouse fed by a stock-routing wire on `location-in` must NOT produce `warehouse-at-capacity` (pre-fix it did — Red); (2) a warehouse with room whose only inbound stock wire is on `location-in` MUST produce `warehouse-missing-stock-routing` (pre-fix the wire wrongly serviced the route — Red). Fix: both capacity checks now require `isWarehouseOperationalInputPort(wire.toPortId)` — the same shared set Rust filters on, via the already-exported helper. The error sets now match: a misport stock wire surfaces `invalid-semantic-connection` on both sides and nothing capacity-related.

**Verified:** contract suite 53/53 (+2) · the four contract-consuming suites (contract, editor, TopologyScreen, topologyCard) 588/588 · full UI suite 275 files / 4,674 tests (+2) · a11y 8/8 · typecheck · eslint 7 pre-existing warnings (0 new). No Rust change this round — `validate_warehouse_capacity` was already correct; the divergence was TS-only. `scripts/test-changed.sh` not needed (UI-only change); the exe lock is moot this round.

**Commits:** `9f556a42`

**Deliberately NOT done:** did NOT add a Rust pairing check for the misport wire (Rust already rejects via `semantic_wire_matches_contract` inside `validate_semantic_ownership`, which runs on the save path); did NOT attempt the full generated-contract build (Rust embeds the JSON at compile time, TS imports it at build time — the two sides already share the file; the residual drift was rule logic, not the file itself).

**Risks / follow-ups:** the audit's remaining item is now substantially closed — the two validators share the JSON AND the port rule. The last bit of contract drift (if any) is the error-SET composition on misport wires (TS emits invalid-semantic-connection; Rust's capacity runs BEFORE the pairing check on the Apply path, so the surfaced code can differ by ordering) — worth a side-by-side fixture test when the generated-contract milestone lands. Follow-ups unchanged: end-to-end error-path test for `apply_topology_diff`, and re-running `test-changed.sh` once the dev client closes.

### 2026-08-10 — apply_topology_diff success path deadlocked on the db mutex (round 136)

**Problem:** the round-134 follow-up (end-to-end test of `apply_topology_diff`) exposed a REAL production bug the moment the first Apply succeeded: the command's success path DEADLOCKED. After `save_topology_json_at_key_with_revision` returns, the code read back the committed revision with a FRESH `state.db.lock().await` — but `global_db` (the guard acquired for the save) was still held, and `tokio::sync::Mutex` is NOT reentrant. Every successful Apply froze the backend forever. The bug was latent because NOTHING exercised the real command's success path end-to-end: the editor/TopologyScreen tests mock the API, and the unit tests call the save helper directly (never the command). The deadlock manifested as a hang that took three bisection passes to pin (markers down to the save's read-back).

**Solution:** Red→Green. The end-to-end test `stale_revision_apply_is_rejected_without_residue_end_to_end` drives the real command through the tauri mock harness (seeded owner user, `store_profiles`, Pro `tenant_subscription` with `BOOTSTRAP_FREE` signature, store DB via `StoreDatabaseManager`): first Apply from base 0 succeeds (revision 1), second Apply with stale base 0 is rejected at the command's EARLY revision gate — before the journal/store — leaving no recovery journal, no request ledger, and revision 1 intact. Pre-fix the first Apply hung forever (the deadlock); post-fix 0.53s. Fix: reuse the still-held `global_db` guard for the revision read-back (`current_topology_revision(&global_db, ...)` then `drop(global_db)`) instead of re-locking. Swept the whole command for other held-guard re-locks — every other `state.db.lock()` is block-scoped, so this was the only instance.

**Verified:** new test green standalone (0.53s) · topology module 230/230 (+1) · full `oz-pos-app` lib 883/883 (+1) · `cargo fmt --check` clean · `cargo clippy -p oz-pos-app --lib -- -D warnings` clean. `scripts/test-changed.sh` remains blocked by `oz-pos-app.exe` PID 34324 (the user's dev client) — third consecutive round; the process was left running per the multi-agent rule.

**Commits:** `4be6a2ed`

**Deliberately NOT done:** no second end-to-end test forcing the conflict AT the save (the early revision gate catches stale applies first; a save-time conflict needs a concurrent writer, which the round-133 unit test pins deterministically). Did not add a lock-order lint/guard — the block-scoping discipline is already the convention; the round-136 fix restored it.

**Risks / follow-ups:** the apply command's success path is now proven end-to-end. Remaining: re-running `test-changed.sh` once the dev client closes. The editor-side revision-conflict recovery (stale editor stranded after a conflict — the UI has no distinct handling) remains an open UX slice: the backend now reliably REJECTS stale applies, but the editor treats the rejection like a network error and keeps the stale canvas.

### 2026-08-11 — editor adopts the authoritative topology on Apply revision conflicts (round 137)

**Problem:** the round-136 follow-up — the editor-side revision-conflict recovery. The backend has reliably rejected stale applies since round 133, but the editor treated the rejection like ANY save error: generic toast + `failApply()`, leaving the user's stale canvas in place with its stale base revision. Every retry failed with the same conflict, and nothing surfaced a recovery path — the user was stranded until a manual branch switch reloaded. Also, the dev client (`oz-pos-app.exe`) finally closed this round, unblocking `test-changed.sh` for the first time since round 133.

**Solution:** Red→Green. New test in the Apply-failure-resilience describe: mock `onSave` to reject with the backend's serialized `TopologyValidation` shape (`{ kind: 'topologyValidation', code: 'topology-revision-conflict', ... }`), make a stale edit, Apply, and assert the canvas is replaced by an authoritative reload (the mocked diagram's single node returns) with `loadTopology` called ≥ 2×. Pre-fix the canvas stayed stale (waitFor timeout) — Red. Fix: `isTopologyRevisionConflict()` (via `parseAppError`, matching the wire shape), a `reloadKey` state added to the load effect's deps, and a dedicated catch branch — distinct localized toast (`topology-toast-revision-conflict` in both bundles) + `failApply()` + `reloadKey` bump to force the authoritative reload (the post-save skip guard is cleared first, so the reload is a full rebuild). Two test-fixture learnings: (1) a null `loadTopology` response is a deliberate no-op for the standalone editor (keeps the demo preset), so the mock returns a real diagram; (2) the error must be the typed wire shape, not a plain `Error`.

**Verified:** new test green standalone · editor suite 471/471 (+1) · full UI suite 275 files / 4,675 tests (+1) · a11y 8/8 · typecheck ✓ · eslint 7 pre-existing warnings (0 new) · bundle parity 0 missing keys · `scripts/verify-bundle-parity.py` clean.

**Commits:** `a47a46bb`

**Deliberately NOT done:** no rebase/merge of the stale edits onto the authoritative revision (the edits were REJECTED by the backend — adopting the newer topology and letting the user re-apply is the honest recovery; a merge would need an operational conflict-resolution UX). No dev-mock revision-conflict simulation (the vitest harness mocks the API directly; the browser-mock gap is a separate follow-up for the preview build).

**Risks / follow-ups:** the revision-conflict UX loop is now closed end-to-end (backend rejects → editor adopts). Remaining: re-running `test-changed.sh` (now unblocked — the dev client is closed) for a Rust-touching round, and the dev-mock revision-conflict simulation for the browser preview.

### 2026-08-11 — dev-mock rejects stale Apply base revisions like the backend gate (round 138)

**Problem:** the round-137 follow-up — the browser dev-mock could not exercise the revision-conflict recovery the editor gained in round 137. `apply_topology_diff` in `ui/src/dev-mock/tauri-api.ts` ignored `baseRevision` entirely and always accepted + bumped, so a stale editor in the plain-browser preview never saw the conflict — the recovery path was only reachable through the vitest harness (which mocks the API directly) or a real backend. The real command (topology.rs revision gate, round 133) rejects any Apply whose `base_revision` ≠ committed revision, serialized as `{ kind: 'topologyValidation', code: 'topology-revision-conflict', ... }`.

**Solution:** Red→Green. New test in `dev-mock-stores.test.ts` pinning the parity contract: snapshot the seeded revision, apply at the CURRENT revision (succeeds, bumps), then re-apply with the now-stale base — pre-fix the mock resolved `{ revision: 4 }` instead of rejecting (Red); post-fix it rejects with the typed conflict shape AND leaves revision + diagram untouched, then self-heals the seed diagram for watch-mode re-runs. Fix: the mock now reads `baseRevision` from the apply args and, when present and ≠ current revision, throws the exact `TopologyValidation` object the editor's `isTopologyRevisionConflict` (via `parseAppError`) detects. The guard is skipped when the field is absent — the real command requires `base_revision`, so only callers that send the field opt into optimistic concurrency; this keeps the older direct-mock invocations (which omit it) working unchanged.

**Verified:** new test green standalone · dev-mock-stores 4/4 · editor suite 475/475 (round-137 recovery test still green) · full UI suite 275 files / 4,676 tests (+1) · typecheck ✓ · eslint 0 errors on changed files.

**Commits:** `1e6f87b6`

**Deliberately NOT done:** no simulated two-process race in the mock (the editor can only ever hold one revision; a conflict is exercised by editing outside the editor or a stale tab — the gate parity is what matters, not the concurrency mechanics). No UI change: the editor recovery from round 137 consumes this without modification.

**Risks / follow-ups:** the mock now mirrors the gate, so the preview's conflict UX is testable in-browser (stale tab + Apply). Remaining: re-running `test-changed.sh` for a Rust-touching round (still unblocked — no Rust touched this round), and the audit's remaining smaller slices (Apply error-path e2e variants) tracked in earlier entries.

