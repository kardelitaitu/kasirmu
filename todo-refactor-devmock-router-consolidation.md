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

### Phase 5.0 — Baseline & guardrails — LANDED 2026-09-15
- [x] *Re-derive counts + classify the current `check:all` red.* Measured at HEAD `1fd7ced54`:
  router **851 lines**, last commit `b27fad9ba` (untouched since — this order is genuinely unstarted);
  `entryHandlers` literal holds **54** inline quoted keys (`:477`–`:662`, `grep -cE "^\s*'[a-z_0-9]+':\s"`
  over `git show HEAD:…tauri-api.ts`) plus **22** `handlers[…]` patches. **Correction to the two claims
  in this box when it was written:** the `popoverSurfaceCompliance` red on `RestaurantMenu.css` has since
  **cleared** — re-run scoped at `3aa02090f` it prints `Tests 3 passed (3)`; some other lane fixed it. So
  the only remaining known `check:all` red is `themeTokenCompliance` on `CartPanelLineItem.css`, which is
  **` M` (uncommitted)** — a working-tree read, not a fact about any commit (AGENTS.md CSS section:
  "a walker has no channel to the revision it is being asked about"). Neither is this lane's, and neither
  was "fixed" here. This box was graded by that scoped suite run, not a full `check:all` (the full command
  is 4 min and re-reads foreign WIP). This lane's own done-state stays §4-gated on a whole-tree green —
  see the precedent in `done-todo-refactor-devmock-agents-3.md`.
- [x] *Capture the registered-command before-snapshot.* Mechanism reused from
  `dev-mock-scoped-aliases.test.ts`: importing the entry file runs every registration + the final
  `applyScopedAliases()`, so `Object.keys(handlers)` **is** the authoritative dispatcher view. A throwaway
  dump test (written, run, **deleted** — left no artifact in `__tests__`) captured:
  **count = 681**, **sha256(sorted keys) = `105d29730df27be6a344554705cd92930283aa0c65ae1d8c391d9d4c3f60681c`**,
  full sorted list in the gitignored `ui/zz-snap.log`. **The consolidation invariant is now concrete: any
  Phase 5.1+ end-state must reproduce exactly this 681-key set** — same count, same digest — or a command
  has silently dropped to the `[TAURI MOCK] Unhandled command` warn. Re-derive with the same throwaway
  pattern if `zz-snap.log` is gone.

> **Triage of the other 15 open `todo-*` plans (read-only, 2026-09-15): this order's ownership is
> unique, but it is not the only lane in the tree.** No other open plan claims "reduce `tauri-api.ts`
> to a register-only router" — that is exclusively Agent 5's. **Two live coordination hazards the next
> worker must respect:**
> 1. **`todo-refactor-oz-pos-app-agents-3.md` (T7-4 / T10 / T19, still `[ ]`) is editing the same
>    `ui/src/dev-mock/handlers/*` modules right now** — commits `3f026e6a2` (deleted 7 no-command
>    handlers), `2422eddfe` (moved the key-rotation handler), `683c9f2b9` (added a
>    `refresh_picker_ticket` handler) landed after this order opened. Consequence: **the 681-key
>    before-snapshot above is a timestamp, not a constant** — it will move from *their* registrations,
>    not this lane's. Re-derive it at the top of every Phase 5.x move and diff against the *then*-current
>    set, never against 681 as a magic number.
> 2. **`todo-topology-editor.md` §7 (`:473`) wants the `handlers/topology*.ts` mock reconciled to the
>    "third implementation" it flagged** — that file is this lane's own closed `agents-3` output, so any
>    Phase 5.x that relocates `mockStores`/topology state must not break the topology lane's follow-up.
> 3. `todo-open-debt-program.md` is a program umbrella (owner-decision items R4–R10, not code work);
>    no box there overlaps this router order.
>
> Net: proceed, but `git status --porcelain -- ui/src/dev-mock/` before every move, and treat the
> 681 as "re-derive, then diff."

### Phase 5.1 — Relocate the shared state

> **IN FLIGHT under another session — do not touch `tauri-api.ts` (2026-09-15, HEAD `26ed71623`).**
> A parallel lane is executing this exact phase right now: `ui/src/dev-mock/handlers/locationState.ts`
> exists **untracked** with a header that names "todo-refactor-devmock-router-consolidation.md Phase 5.1"
> as its reason, and `tauri-api.ts` is **` M`** with the `locationState` import block added at `:43-53`.
> It is **mid-edit and does not compile** — the lane added the imports but has not yet deleted the local
> duplicates, so `npx tsc --noEmit` returns exit 2 with TS2440 "Import declaration conflicts with local
> declaration" for `unwrapArgs`/`listMockLocations`/`createMockLocation`/`getMockStores`(unused) and 9
> others. **This lane must not touch the router or that new file while the tree holds edits that are not
> ours** (AGENTS.md §3; this file's own rule "if it holds edits that are not yours, stop"). The boxes
> below stay unchecked because 5.1 is neither complete nor ours to finish in their session. Re-inspect
> `git status --porcelain -- ui/src/dev-mock/` before any move; when the lane commits a *compiling* 5.1,
> re-derive the 681 snapshot (it will legitimately have changed if they also dropped `entryHandlers` keys)
> and confirm TS2440 is gone before either of us claims the phase.
>
> **RESOLVED 2026-09-16:** that session never committed — its untracked `locationState.ts` and its
> ` M tauri-api.ts` are gone from the tree (the pre-move porcelain at `ui/src/dev-mock/` came back empty;
> the same lane filed the checkout-as-undo hazard hours earlier at `ad21cbff5`). The phase was therefore
> **re-derived from zero on a clean tree**, not resumed: the state-move half landed at `99a68348f` with
> before/after snapshots re-measured at the then-current HEAD (681 / `105d29730df2` on both sides),
> tsc exit 0, dev-mock suites 96/96. See the EXECUTED note on the first box.

- [ ] Move `mockStores` (+ `listMockLocations`/`getMockLocation`/`createMockLocation`/`updateMockLocation`/`setMockPrimaryLocation`/`deleteMockLocation` and `mockTicketPrefixes`/prefix helpers) out of the router into `handlers/locations.ts` (or a state module if that creates an import cycle — `mockDispatcher.ts:16` warns the dispatcher must not import the router).
  <!-- EXECUTED (state-move half only) 2026-09-16, HEAD 3aa02090f -> 99a68348f. The box names
       handlers/locations.ts first and offers a state module as the escape; the state module was
       taken — handlers/locationState.ts — because locations.ts's own header documents that it
       DELIBERATELY abstained from this state ("mockStores ... stays in the router because it is
       shared with receipt/workspace mocks", :8-10 written by agents-4), and pushing it there
       would invert that file's stated scope. The helpers moved VERBATIM; the router's four
       surviving regional/receipt readers call getMockStores(); the orphaned Legal-Entity comment
       (left dangling by an earlier move) was deleted with the block. Measurements are run
       properties of THIS pass, per the net-rule: before-snapshot 681/105d29730df2 re-derived at
       this HEAD, after-snapshot identical (throwaway dump test run both sides and deleted);
       `npx tsc --noEmit` 0; dev-mock-scoped-aliases + siblings 7 files / 96 tests; router
       851 -> 767 lines. Box STAYS UNTICKED: the conversion sibling below has not run — the
       location/receipt/brand/device keys still sit in entryHandlers, now referencing the
       imported helpers. This lane claims the phase. -->
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
- [ ] `cd ui && npm run check:all` → exit 0. **Update 2026-09-15:** the gate is now **one** red, not two —
  the `popoverSurfaceCompliance` blocker self-cleared (see Phase 5.0); only `themeTokenCompliance` on the
  **uncommitted** `CartPanelLineItem.css` remains, and it is a working-tree read another lane must resolve
  (by committing a clean version or reverting), not this order's to fix. Until that lands green, this box
  is legitimately unmet and, per the §4 rule and the `agents-3` precedent, the file stays `todo-` however
  clean the router becomes.

> **§4 naming rule reminder:** this file earns `done-todo-` only when its own acceptance command was RUN and PASSED. Router line-count reduction is the objective; the whole-tree green is the gate, and it is currently blocked on surfaces outside this order's fence.
