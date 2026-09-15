# Orchestrator Agent 5: Dev-Mock Router Consolidation — finish `tauri-api.ts` into a register-only entry router

<!-- Authorship: opened 2026-09-15 at HEAD d6d06c3c7 by DSH, on the owner directive "continue the implementation, we go with your recommendation" after done-todo-refactor-devmock-agents-3.md's close surfaced that the router consolidation had no live owner. Every number below carries its command and is stamped to this commit; they move with every router edit. -->

**Document:** `todo-refactor-devmock-router-consolidation.md`
**Role:** Orchestrator Agent 5 (Dev-Mock Router Consolidation)
**Goal:** Remove the last literal command entries from `ui/src/dev-mock/tauri-api.ts` so the file registers existing domain handler maps and nothing else — the end-state every one of the four `refactor-devmock-agents-*` lanes named but none actually executed.

**Target File:** `ui/src/dev-mock/tauri-api.ts` (and `ui/src/dev-mock/core/mockDispatcher.ts` only if a shared-state seam is needed).

## Why this order exists (the orphan, measured)

All four sibling lanes are now `done-todo-`: `-1` and `-2` archived, `-4` archived, and this lane's predecessor `done-todo-refactor-devmock-agents-3.md` (root). The one job that touches all of them — reducing `tauri-api.ts` to a clean entry router — was claimed by Agent 4's **phase 4.5** ("OWNS the router consolidation", `done-todo-refactor-devmock-agents-4.md:166`) but that phase archived with the step in **future tense**: `:174` "reduce the router **as far as Agent 4's fence permits**", `:182` "the final cleanup commit is **held until Agent 2 and Agent 3 complete their fences … the router WILL be reduced to** [dispatcher form]", and `:181` "Run full UI tests … `[ ]`" left **unchecked**. The fences were later met (Agent 3 landed `1fb272000`/`abb87ba37`/`b27fad9ba`), so the hold released — but Agent 4 had already closed, and nobody came back. This order claims the released job.

## Baseline (measured 2026-09-15 at HEAD `d6d06c3c7`; re-derive before trusting)

- **`tauri-api.ts` = 851 lines** — `git show HEAD:ui/src/dev-mock/tauri-api.ts | Measure-Object -Line` prints 780 and UNDER-counts blank lines; trust `(git show HEAD:ui/src/dev-mock/tauri-api.ts).Count` = **851**. Last commit to touch it is **`b27fad9ba`** (this lane's own settings move) — `git log -1 -- ui/src/dev-mock/tauri-api.ts` — i.e. nobody has consolidated since.
- **The remaining literal is `entryHandlers`** — `const entryHandlers: Record<string, MockHandler> = { … }` at **`:477`**, closed and registered by **`registerHandlers(entryHandlers)` at `:663`**. It holds **54** inline quoted command keys (`grep -cE "^\s*'[A-Za-z0-9_]+'\s*:" ui/src/dev-mock/tauri-api.ts`, matches counted 2026-09-15) — locations/profiles, ticket prefix, regional config, receipt format/layout/content, device binding, brand settings, KDS devices, bundles, low-stock, cash drawer, print receipt, and the sync family.
- **Plus 22 `handlers['x'] = …` patches** below the registration block (e.g. `:799`, `:827`, `:828`, `:831`) — cross-domain stubs and quota-remediation counters.
- **The 16 domain registrations already exist and STAY**: `registerHandlers(entryHandlers)` `:663`, then `topologyHandlers :670`, `workspaceHandlers :676`, `createCatalogHandlers({unwrapArgs}) :682`, `inventoryHandlers :683`, `shiftHandlers :684`, `createSalesHandlers({…}) :685`, `createPaymentHandlers({unwrapArgs}) :686`, `loyaltyHandlers :687`, `kdsHandlers :688`, `analyticsHandlers :689`, `createLocationsHandlers({unwrapArgs}) :690`, `systemHandlers :691`, `staffHandlers :692`, `floorplanHandlers :693`, `crmHandlers :694`, `settingsWriteHandlers :810`.
- **`applyScopedAliases()` runs once at `:848`**, after every registration (the one call site that must remain last).

## The real blocker (do not skip this — it is why `-4` deferred the job)

`entryHandlers`' location/receipt/brand/device entries read **module-local mutable state** declared in the router, not in a module: `mockStores` (`:58`), `mockTicketPrefixes` (`:116`), and the `unwrapArgs` envelope helper (`:63`). Agent 4 recorded this precisely at `done-todo-refactor-devmock-agents-4.md:177-180`: its 9 `a4_locations` entries "**will move once Agent 3 extracts its fence and `mockStores` is no longer needed by the router**." So the consolidation is not copy-paste — the shared state must be given a home first, and `agents-3` kept its node/wire diagram in localStorage specifically to dodge the `get_setting` unset/`""` defect (see `done-todo-refactor-devmock-agents-3.md`, the `get_setting` blockquote) — the successor must read that note before routing topology persistence through any settings mock.

**The existing pattern to follow** is the factory handlers already in use: `createCatalogHandlers({ unwrapArgs })`, `createSalesHandlers({ … })`, `createLocationsHandlers({ unwrapArgs })` take their dependencies injected and return a typed map. Anything touching `mockStores`/`mockTicketPrefixes` must become a `createXHandlers({ mockStores, mockTicketPrefixes, unwrapArgs })` factory, with the state itself relocated to a module — `handlers/locations.ts` already owns `createLocationsHandlers`, so it is the natural home for `mockStores`; verify before creating a parallel one.

## Path fence (dissolved intra-refactor, but respect authorship)

All four sibling refactor lanes are closed, so the old cross-lane fence no longer has an active counterparty. Their handler modules are still other authors' code, so: **prefer new modules** (`handlers/bundles.ts`, `handlers/sync.ts`, `handlers/device-binding.ts`, `handlers/receipt-format.ts`) and **fold the location stubs into the existing `handlers/locations.ts`** rather than editing `agents-2`/`agents-4` modules wholesale. Keep every edit to an existing module surgical and its behavior identical.

## Commit convention

`refactor(devmock-router): …`, one line, explicit pathspec (AGENTS.md Git & Commit Policy §3). One new module per commit; the new-file `git add && git commit` chain is the only sanctioned add, and only for genuinely untracked files.

## Task checklist

### Phase 5.0 — Baseline & guardrails
- [ ] Re-derive the counts above; record that the current `check:all` red is the **two foreign CSS suites** (`popoverSurfaceCompliance` on `RestaurantMenu.css`, `themeTokenCompliance` on the uncommitted `CartPanelLineItem.css`) and **not** this lane. Do NOT fix them by editing foreign CSS; this lane is judged by typecheck + the devmock suites, and its done-state is separately gated by `check:all` per §4 (see the precedent in `done-todo-refactor-devmock-agents-3.md`).
- [ ] Capture the current registered-command key set (dispatcher view) as a before-snapshot to diff against after each move — the consolidation must be **registration-identity**, no command silently dropped to the `Unhandled command` warn.

### Phase 5.1 — Relocate the shared state
- [ ] Move `mockStores` (+ `listMockLocations`/`getMockLocation`/`createMockLocation`/`updateMockLocation`/`setMockPrimaryLocation`/`deleteMockLocation` and `mockTicketPrefixes`/prefix helpers) out of the router into `handlers/locations.ts` (or a state module if that creates an import cycle — `mockDispatcher.ts:16` warns the dispatcher must not import the router).
- [ ] Convert the location / receipt-format / brand-settings / device-binding entries in `entryHandlers` into a `createXHandlers({ … })` factory consuming the relocated state; register it; delete the corresponding `entryHandlers` keys.
- [ ] Verify: `cd ui && npx tsc --noEmit -p tsconfig.json` and `cd ui && npx vitest run src/__tests__/dev-mock-scoped-aliases.test.ts`.

### Phase 5.2 — Bundles
- [ ] Move the 7 bundle command pairs (`create/delete/get/list/update/lookup_bundle_by_sku` ± `_scoped`) out of `entryHandlers` into `handlers/bundles.ts`; register; delete from the literal.

### Phase 5.3 — Sync / cash drawer / low-stock / local-ip
- [ ] Move the sync family (`sync_run`, `sync_pull`, `pending_sync_count`, `retry_offline_sync`, `get/update_sync_settings` ± scoped, `test_sync_connection`, `request_sync_token`), `open_cash_drawer`, `get_low_stock_alerts`, `get_local_ip` into `handlers/sync.ts` / their existing domain module; register; delete from the literal.

### Phase 5.4 — KDS devices & the 22 patches
- [ ] Move `list/register/get/update_status/deactivate_kds_device` into `handlers/kds.ts`.
- [ ] Re-home the 22 `handlers['x'] = …` patches into their domain modules (or a single documented `entryHandlers` residue, with a comment per remaining stub explaining why it has no other home — `agents-4:193` says only "scoped-alias stubs and cross-domain patches" may remain).

### Phase 5.5 — Reduce the router
- [ ] `entryHandlers` empty or gone; `tauri-api.ts` reduced to: the vite-alias header, `export { convertFileSrc, invoke, isTauri }`, the `createXHandlers`/`registerHandlers` sequence, any documented residue, then the single `applyScopedAliases()`. Target: **`tauri-api.ts` < 200 lines** — `git show HEAD:ui/src/dev-mock/tauri-api.ts | wc -l`.
- [ ] No dead imports / unused local helpers left behind.

### Acceptance
- [ ] Before-snapshot registered-command set == after-snapshot set (no command dropped to the warn) — prove by diffing the two dispatcher key lists.
- [ ] `cd ui && npx tsc --noEmit -p tsconfig.json` → exit 0.
- [ ] `cd ui && npx vitest run src/__tests__/dev-mock-scoped-aliases.test.ts` (+ any `invoke-coverage`/`dev-mock-*` suites found in 5.0) → exit 0.
- [ ] `cd ui && npm run check:all` → exit 0 **only once the two foreign CSS reds are independently resolved**; until then this box is legitimately unmet and, per the §4 rule and the `agents-3` precedent, the file stays `todo-` however clean the router becomes.

> **§4 naming rule reminder:** this file earns `done-todo-` only when its own acceptance command was RUN and PASSED. Router line-count reduction is the objective; the whole-tree green is the gate, and it is currently blocked on surfaces outside this order's fence.
