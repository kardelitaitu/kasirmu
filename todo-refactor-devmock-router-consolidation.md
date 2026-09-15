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

- [x] Move `mockStores` (+ `listMockLocations`/`getMockLocation`/`createMockLocation`/`updateMockLocation`/`setMockPrimaryLocation`/`deleteMockLocation` and `mockTicketPrefixes`/prefix helpers) out of the router into `handlers/locations.ts` (or a state module if that creates an import cycle — `mockDispatcher.ts:16` warns the dispatcher must not import the router).
  <!-- TICKED 2026-09-16 by the SAME lane, once the conversion box below landed (`93ed08fc5`):
       this box was always move-then-convert, and the half-open state it insisted on ("Box STAYS
       UNTICKED: the conversion sibling below has not run") is now closed — the state exists in
       exactly one module outside the router, and the router registers it. Evidence rides both
       notes below. -->
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
- [x] Convert the location / receipt-format / brand-settings / device-binding entries in `entryHandlers` into a `createXHandlers({ … })` factory consuming the relocated state; register it; delete the corresponding `entryHandlers` keys.
  <!-- IN FLIGHT (this session's round-6 live observation, 2026-09-16, HEAD 04c1e56d0). A parallel
       lane is executing exactly this conversion-half on an UNCOMMITTED working tree, built on top of
       my intact 5.2/5.3/5.4 (their WIP still calls registerHandlers(bundlesHandlers/syncHandlers/
       kdsDeviceHandlers) — no clobber of my work; f73756c09..HEAD has ZERO dev-mock commits, so my
       phases are the latest on the router). Evidence read off their dirty files: new untracked
       `handlers/regional.ts` (createRegionalHandlers factory) and `handlers/terminals.ts`; modified
       `tauri-api.ts` now WIRES them — registerHandlers(createLocationProfileHandlers()) :258 and
       registerHandlers(createRegionalHandlers({ unwrapArgs, getMockStores, updateMockLocation }))
       :259 — plus modified locationState.ts / settings.ts (they are re-homing the device/terminal
       family, so this session must NOT duplicate that). The line numbers I "read" as the router's
       state earlier this round were the peer's WORKING tree, not HEAD: git-clean ≠ free, and a
       pathspec commit on tauri-api.ts would have swept their untracked regional.ts into my message
       (the AGENTS.md §3 incident verbatim). This session stands down from the router this round; no
       code was written or committed here. Box stays UNTICKED (not ours to close while their edits are
       uncommitted); re-derive the 681 baseline and re-check porcelain before either lane moves. ROUND-7 (HEAD 2387c0fe3): same 5 files still uncommitted and
        the lane is LIVE (their own `__tests__/zz-dump-registered-b.test.ts` probe was 2 min old at read;
        the alias test went dirty) — so I again touched zero router files and left their probe alone. My
        one safe contribution: I MEASURED their pending conversion, which no box had ever checked. On their
        working tree `tsc` is exit 0 and a throwaway dump (mine, run+deleted) reads **681 / sha256
        `105d29730df2…60681c`, byte-identical to the 5.0–5.4 baseline** → their `createLocationProfileHandlers()`
        + `createRegionalHandlers({unwrapArgs,getMockStores,updateMockLocation})` refactor is
        registration-identity preserving. LABELLED AS A RUN-PROPERTY OF THEIR UNCOMMITTED TREE (a working-tree
        green proves nothing about a commit, per repo rule) — box stays UNTICKED until they actually land it,
        then re-dump at HEAD. My 5.2/5.3/5.4 remain the latest dev-mock commits, intact. -->
  <!-- EXECUTED 2026-09-16 (the lane whose uncommitted WIP the note above observed and — correctly —
       stood down from; the observation was mutual: this lane saw the 5.2/5.3/5.4 commits land
       mid-round and released its own claims rather than racing them). Landed as three commits per
       the :35 one-new-module rule: `55a71106d` opens handlers/regional.ts, `ca08178ae` opens
       handlers/terminals.ts, `93ed08fc5` wires the router (−307 lines of literal and local state,
       +94 of imports/registrations; 710 -> 447 lines; entryHandlers literal keys 26 -> 4). The 22:
       NINE location/prefix keys became createLocationProfileHandlers() INSIDE handlers/
       locationState.ts (pure bindings of the relocated helpers — a factory for state that already
       owns its module needs no new file); the TWO regional + THREE receipt-format keys became
       createRegionalHandlers({ unwrapArgs, getMockStores, updateMockLocation }) — the regional pair
       joined the receipt trio on the router's own section-banner grouping, because NO later phase
       owned them and they would have stranded past 5.5; the SIX device-binding and TWO brand
       entries are stateless and moved verbatim into named static maps (deviceBindingHandlers in
       terminals.ts — the properly-named home workspaces.ts:17-19 had declined and thereby asked
       for; brandHandlers in settings.ts) rather than zero-arg factories: the box's factory FORM
       exists to consume the relocated state, which these never had, and the sibling's
       kdsDeviceHandlers static map is the precedent for stateless sixes. GUARD HIT AND HONESTLY
       RE-MEASURED: the brand twins grew settings.ts's explicit-_scoped population and
       dev-mock-scoped-aliases "settings twins were NOT overwritten" failed 9-vs-frozen-8 — the
       guard's own comment ("Re-measured, not copied") is the update path; the list and its line
       citations were re-measured with dated attribution INSIDE the wiring commit, non-clobbering
       re-verified (both twins explicit, distinct objects). Verification at the COMMITTED state,
       closing the sibling's condition: re-dump after `93ed08fc5` → 681 commands / sha256
       105d29730df2… — byte-identical through ALL five Phase 5.x moves (throwaway, run + deleted);
       tsc exit 0; dev-mock/invoke-coverage/regional/receipt 13 files / 146 green; whole-tree
       vitest 1 failed | 582 passed — the sole red still the sales lane's UNCOMMITTED --shadow-md
       tail, unchanged by this commit (touches no CSS). -->
- [x] Verify: `cd ui && npx tsc --noEmit -p tsconfig.json` and `cd ui && npx vitest run src/__tests__/dev-mock-scoped-aliases.test.ts`.
  <!-- DONE at the wired state, both commands this lane: tsc exit 0; dev-mock-scoped-aliases 41/41
       green AFTER the documented re-measure (its one legitimately moved frozen figure), and the
       suites above re-run once everything was committed — the whole-tree print 1 red is the
       foreign CSS tail named in Acceptance, not this order's surface. -->

> **Independent verification at clean HEAD `e16499e67` (this session, 2026-09-16) — supersedes my
> own earlier "does not compile / TS2440" note.** After the parallel lane finished the dedup and
> committed the state-move (`99a68348f`, `tauri-api.ts` 851 → 767, `handlers/locationState.ts` now
> tracked), I re-verified the *committed* artifact, not their working tree: `npx tsc --noEmit` **exit 0**;
> a throwaway dispatcher dump (run + deleted) prints **681 registered commands, sha256
> `105d29730df2…60681c` — identical to the Phase 5.0 before-snapshot**, so the state-move preserved
> **registration-identity exactly** (their 5.1 note predicted it "will legitimately have changed if they
> also dropped `entryHandlers` keys" — measured: they dropped none, count unchanged at **54 inline keys**).
> **Status:** 5.1 state-move **landed & independently green**; 5.1 conversion-half (`createXHandlers`
> factory over the relocated state) and 5.2–5.5 **remain open**. The lane's own note says "This lane
> claims the phase" — so this session stands down from `tauri-api.ts` (concurrent-editor / AGENTS.md §3
> clobber risk), and the remaining phases are for whoever holds the router next, re-deriving the 681
> baseline before each move. No file outside this doc was touched by this verification.

### Phase 5.2 — Bundles
- [x] **LANDED 2026-09-16 (this session, HEAD `ed75932bd`).** Moved the 12 bundle keys (`list_bundles`/
  `get_bundle`/`create_bundle`/`update_bundle`/`delete_bundle`/`lookup_bundle_by_sku` ± `_scoped`,
  `tauri-api.ts:511-546`) verbatim into new `ui/src/dev-mock/handlers/bundles.ts` as `bundlesHandlers`,
  registered with `registerHandlers(bundlesHandlers)` immediately after the entry literal; router diff
  **+6/−36**, no foreign hunks. These twelve are self-contained stubs (no `mockStores`/`unwrapArgs`
  dependency), so unlike Phase 5.1 this needed no state seam. **Registration-identity proven, not
  asserted:** dispatcher snapshot re-dumped via throwaway (run + deleted) after the move → **681 commands,
  sha256 `105d29730df2…60681c` — identical to the Phase 5.0/5.1 before-snapshot**; `npx tsc --noEmit`
  exit 0; `dev-mock-scoped-aliases.test.ts` 41 passed. Router now **767 → 737 lines**. `check:all`
  whole-tree still gated by the foreign `CartPanelLineItem.css` red (Phase 5.0) — unchanged by this move,
  which touches no CSS.

### Phase 5.3 — Sync / cash drawer / low-stock / local-ip
- [x] **LANDED (sync/hardware half) 2026-09-16, HEAD `b49c1259b`.** Moved the 11 self-contained sync /
  cash-drawer / receipt-hardware stubs (`open_cash_drawer`, `print_receipt`, `retry_offline_sync`,
  `get_sync_settings` ± `_scoped`, `update_sync_settings`, `sync_run`, `pending_sync_count`, `sync_pull`
  incl. its SYNC-03 destructive-consent `throw`, `test_sync_connection`, `request_sync_token`) verbatim into
  new `ui/src/dev-mock/handlers/sync.ts`, registered right after `bundlesHandlers`. **Registration-identity
  proven:** after-snapshot dump (throwaway, run+deleted) → **681 commands, sha256 `105d29730df2…60681c`,
  identical**; `npx tsc --noEmit` exit 0; `dev-mock-scoped-aliases.test.ts` 41 passed. Router 737 → **723**
  (the 11 keys span 21 physical lines → 7, net −14).
- [ ] **Partial, deliberate:** `get_local_ip` (`:400`, a system singleton) and `get_low_stock_alerts`
  (`:499`, an inventory singleton) are in this phase's old list but were **left in the router on purpose** —
  filing them under a "sync" module would misname it; they want their own home (system.ts / inventory.ts).

### Phase 5.4 — KDS devices & the 22 patches
- [x] **LANDED (KDS-device half) 2026-09-16, HEAD `c338c9ac8`.** Moved the 5 KDS device-management keys
  (`list/register/get/update_status/deactivate_kds_device_scoped`) verbatim into a NEW
  `ui/src/dev-mock/handlers/kds-devices.ts`, registered after `syncHandlers`. **Refinement over the plan:**
  these went to their own module, not `handlers/kds.ts` as this line said — `kds.ts` is another domain's
  actively-edited *order-workflow* file; device-registration/presence is a different concern, so a new file
  keeps the extraction surgical (zero concurrent-edit surface) and honest. All 5 are `_scoped`-only (no
  unscoped base → `applyScopedAliases` has nothing to mirror). **Registration-identity proven:** after-dump
  (throwaway, run+deleted) → **681 commands, sha256 `105d29730df2…60681c`, identical**; `tsc` exit 0;
  `dev-mock-scoped-aliases.test.ts` 41 passed. Router 723 → **710** (−13).
- [x] **22 `handlers['x'] = …` patches — RE-HOMED or documented as sanctioned residue (this session, through HEAD `4b53fd215`, 2026-09-16).** The analytics/inventory cross-domain stubs were folded into their plan-correct domain modules, each verified single-defined (`git grep`) + 681-identity-held + dev-mock suites green before commit: 11 analytics cards → `analytics.ts` (`9caafa16e`), 2 customer handlers → `crm.ts` (`758c72020`, plus the now-dead `MOCK_CUSTOMERS` import removed), 2 sync-conflict → `sync.ts` (`584bb5c59`), 2 workspace §J remediation (+ their rationale comment) → `workspaces.ts` (`c0a15224f`). Also re-homed: the three deferred `entryHandlers` singletons (`get_local_ip`→`system.ts`, `get_low_stock_alerts`→`inventory.ts`, `print_sales_receipt`(+scoped)→`sync.ts`) which emptied the literal to its two imported spreads (`1ac117450`), and `list_in_transit_transfers_scoped` → `inventory.ts` beside its stock-transfer siblings (`4b53fd215` — correcting an earlier round-13 mis-classification that had left it in the residue block). **Remaining documented residue is now just 2 stubs** — `get_sale_line_margins_scoped` (HPP: a cost/margin read spanning sales×inventory×analytics, no single owner) and `list_warehouse_products_at_location` (a catalog×location preview join; moving it would force a catalog import edge for one stub) — each carrying the plan's required per-stub "why no other home" comment. Both genuinely lack a clean domain home, so `agents-4:193`'s "cross-domain patches may remain" applies. **Residue clause satisfied.**

### Phase 5.5 — Reduce the router
- [ ] `entryHandlers` empty or gone; `tauri-api.ts` reduced to: the vite-alias header, `export { convertFileSrc, invoke, isTauri }`, the `createXHandlers`/`registerHandlers` sequence, any documented residue, then the single `applyScopedAliases()`. Target: **`tauri-api.ts` < 200 lines** — `git show HEAD:ui/src/dev-mock/tauri-api.ts | wc -l`.

  > **Phase 5.5 structure DONE (this session, 2026-09-16, commit `1ac117450`): the `entryHandlers` literal now
  > contains ONLY its two imported spreads (`...licenseHandlers`, `...settingsHandlers`) — verified zero direct
  > `'key':` entries remain (regex walk). The last three deferred singletons were given their proper homes:
  > `get_local_ip`→`system.ts`, `get_low_stock_alerts`→`inventory.ts` (beside the transfer/adjust commands),
  > `print_sales_receipt`(+`_scoped`)→`sync.ts` (beside its sibling `print_receipt`) — each `git grep`-confirmed
  > single-defined first. Verified together: `tsc` 0, **681 / `105d29730df2…` identical**, all 7 `dev-mock-*`
  > suites (96 tests) green; 4 files, +37/−12, no foreign hunks. So the literal's CODE is fully extracted;
  > `wc -l` now reads **370 total = ~133 code + ~195 comment + blanks**. The box stays UNTICKED **solely**
  > because of the `<200` **total-line** number, which (see the finding below) is now a documentation-
  > compression / owner judgment, not remaining handler code to move.

  > **Phase 5.5 progress (this session, 2026-09-16, commits `758c72020` CRM pair + `584bb5c59` sync-conflict
  > pair). Two more self-contained stub groups re-homed to plan-correct homes (crm.ts, sync.ts); router
  > 380 → 364 (−16), plus a now-dead `MOCK_CUSTOMERS` import dropped. Each verified: **681 / sha256
  > `105d29730df2…60681c` identical**, all 7 `dev-mock-*` suites (96 tests) green, `tsc` 0 — throwaway dumps
  > run+deleted, both files uncontested pre-commit, no foreign hunks.**
  >
  > **Decisive structural finding for the `< 200` target — this line-count is now documentation, not code.**
  > Measuring the committed router at HEAD `584bb5c59`: **364 total lines = 195 comment-only + 36 blank +
  > only ~133 actual code lines.** The dispatcher code has been substantially extracted already: the
  > `entryHandlers` literal (`:158-234`) is now almost entirely stale banners of *completed* moves; the
  > real remaining handler code is ~5 one-line stubs (`list_in_transit_transfers_scoped`,
  > `get_sale_line_margins_scoped` → inventory; `suspend/recover_workspace_instances_scoped` → workspaces;
  > `list_warehouse_products_at_location`, which reads `MOCK_PRODUCTS`) plus the live stateful seeds (KDS
  > orders, lockout, date helpers) the peer's Phase 5.1 kept. **So `git … | wc -l` < 200 is NOT achievable
  > by further pure-copy code moves — the code mass is ~133 lines and the gap is explanatory documentation
  > the repo deliberately keeps (the scoped-alias rationale at `:292-302`, the §J count-type correction at
  > `:327-339`, etc.). Reaching the literal < 200 would mean *deleting rationale*, which is a judgment call
  > outside the safe/owned scope here and would regress the documentation these very moves were adding.**
  > Recommend: either (a) treat the substantive goal — dispatcher code extracted — as met and relax the
  > numeric target to "code lines < 200" (already true at ~133), or (b) an owner decision to compress
  > banners. NOT more stub-shuffling into shared modules for ~5 lines at rising collision risk.

- [x] **No dead imports / unused local helpers left behind — VERIFIED (2026-09-16, at HEAD `4b53fd215`, router 368).** `tsc` here does not enable `noUnusedLocals` (that is exactly how the one genuinely-dead import, `MOCK_CUSTOMERS`, sat undetected until I removed it by hand in `758c72020`), so this was checked by explicit audit, not by a green typecheck: (1) every named import (`convertFileSrc…kdsDeviceHandlers`) counted ≥ 2 occurrences in the file → all live (each `*Handlers` reaches a `registerHandlers`, each dep symbol a factory call, `MOCK_PRODUCTS` the warehouse stub); (2) the only module-level `function`/`const`/`let` defs are `entryHandlers` (registered) and `pushKdsOrderFromCart` (in the `createSalesHandlers` deps); `courseForSku` is a nested local inside the KDS seed builder, used there. No orphans. (Re-audit after every future move.)

  > **Round 12 (`c0a15224f`): workspace pair re-homed.** The §J quota-remediation stubs
  > (`suspend_surplus_workspace_instances_scoped`, `recover_workspace_instances_scoped`, both `() => 0`)
  > moved verbatim — **with their full rationale comment** — into `handlers/workspaces.ts` (their plan-correct
  > home; that module already imports `MOCK_WORKSPACES_SEED` the comment references). Both keys single-defined
  > (git grep). Verified: **681 / `105d29730df2…` identical**, 7 `dev-mock-*` suites (96 tests) green, `tsc` 0;
  > router 364 → **352**. Note: the commit first hit a transient `.git/index.lock` from a concurrent peer commit
  > (shared checkout, §3) — retried after it cleared, with a fresh pre-commit guard proving still only my 2 files
  > were dirty and the diff unchanged; no force-remove, no data loss.
  >
  > **Residue decision (this is where pure-copy extraction rightly stops):** the only remaining handler *code*
  > in the router is `list_in_transit_transfers_scoped` + `get_sale_line_margins_scoped` (both `() => []`) and
  > `list_warehouse_products_at_location` (reads `MOCK_PRODUCTS`). The first two are genuinely cross-domain
  > (transfers/HPP have no single obvious home) and the plan explicitly permits **"a single documented
  > `entryHandlers` residue, with a comment per remaining stub"** — I am leaving them as sanctioned residue
  > rather than filing them under a module that would misrepresent the concern (my stated principle).
  > `list_warehouse_products_at_location` would need a new catalog→module import edge for ~1 stub; not worth the
  > coupling. The substantive objective — **dispatcher code extracted from the router** — is effectively met
  > (~133 code lines at round-11 measure, now fewer); the literal `< 200` remains a documentation-compression
  > call for the owner, not more code to move. Boxes stay UNTICKED pending an owner decision + `check:all`.

> **Phase 5.5 progress (this session, 2026-09-16, commit `9caafa16e`): router 447 → 380 (−67).** Folded the
> 11 scoped analytics-card stubs out of the router's in-place `handlers['x'] = …` patches into
> `handlers/analytics.ts`'s `analyticsHandlers` map (their plan-correct domain home). Before moving I
> `git grep`-confirmed each key is **single-defined** (one file) and its body is self-contained — so this is
> a pure copy, not an override relocation, and folding into the map can't flip which body wins. The keys
> moved from patch-order (`:333`, after `registerHandlers(analyticsHandlers)`) to map-order (`:285`) —
> verified behaviour- AND identity-preserving: after-dump **681 / sha256 `105d29730df2…60681c`, identical**;
> all **seven `dev-mock-*` suites (96 tests) green** (the audit/envelope/role-holder suites assert handler
> output shapes, so they would catch a diverged body); `tsc` exit 0. **Remaining to `< 200`:** the
> crm/sync/inventory patches (`search_customers_scoped` & `get_customer_history_scoped` → `crm.ts`;
> `list_sync_conflicts_scoped`/`resolve_sync_conflict_scoped` → `sync.ts`; `list_in_transit_transfers_scoped`
> & `get_sale_line_margins_scoped` → inventory; `suspend_surplus_workspace_instances_scoped`/`recover_…` →
> `workspaces.ts`; `list_warehouse_products_at_location`) and trimming the entry-literal's stale banners.
> Boxes stay UNTICKED — the end-state (`< 200`, `entryHandlers` gone) is not reached and `check:all` is
> untouched this round.

### Acceptance
- [ ] Before-snapshot registered-command set == after-snapshot set (no command dropped to the warn) — prove by diffing the two dispatcher key lists.
- [ ] `cd ui && npx tsc --noEmit -p tsconfig.json` → exit 0.
- [ ] `cd ui && npx vitest run src/__tests__/dev-mock-scoped-aliases.test.ts` (+ any `invoke-coverage`/`dev-mock-*` suites found in 5.0) → exit 0.
  > **Milestone (this session, 2026-09-16 05:49, HEAD `5748f8262`; dev-mock tip `93ed08fc5`).** All
  > seven `dev-mock-*` suites run together against a **clean** working tree (porcelain for
  > `ui/src/dev-mock/` empty before and after, so the green is attributable to HEAD's dev-mock
  > content, not a stranger's mid-run edit): **7 files / 96 tests passed, `vitest exit 0`**. Complements
  > the identity re-derivation at this HEAD (**681 commands, sha256 `105d29730df2…60681c`, byte-identical**
  > to the 5.0–5.4 baseline) and `tsc` exit 0. Together the three measurements say the *landed*
  > state — my 5.2 / 5.3 / 5.4 (each verified applied at HEAD, keys absent from `entryHandlers`,
  > each `registerHandlers(...)` call appearing exactly once) plus the peer's `55a71106d` regional /
  > `ca08178ae` terminals / `93ed08fc5` conversion burst — is **sound at the commit**, not just on
  > the working tree. Box stays **UNTICKED**: Phase 5.5 (router 447 → <200) is open, the whole-tree
  > `check:all` gate is untouched this round, and the re-home could regress any of it — a
  > milestone is not an acceptance.
- [ ] `cd ui && npm run check:all` → exit 0. **Update 2026-09-15:** the gate is now **one** red, not two —
  the `popoverSurfaceCompliance` blocker self-cleared (see Phase 5.0); only `themeTokenCompliance` on the
  **uncommitted** `CartPanelLineItem.css` remains, and it is a working-tree read another lane must resolve
  (by committing a clean version or reverting), not this order's to fix. Until that lands green, this box
  is legitimately unmet and, per the §4 rule and the `agents-3` precedent, the file stays `todo-` however
  clean the router becomes.

> **§4 naming rule reminder:** this file earns `done-todo-` only when its own acceptance command was RUN and PASSED. Router line-count reduction is the objective; the whole-tree green is the gate, and it is currently blocked on surfaces outside this order's fence.
