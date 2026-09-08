# Coder-2 Journal

## 2026-09-08 — Learned the four todo-plan files (user-requested onboarding)

Read all four planning files end to end at repo root:

### todo-global-saas-1.md (3738 lines) — Phase 1: P0 Platform Foundations
- Carries the SHARED CONTRACT all phases must preserve: current baseline, core
  access contract (subject+permission+scope+resource+entitlement), canonical
  hierarchy (Org → Legal Entity → Location → Terminals/workspace runtimes),
  adopted target policy §A/B/E/F/G/H/I, decisions list.
- **ALL eleven P0 boxes are now checked** (supervisor Round 199-201 resync +
  Round 182): scoped authorization (ADR #47 slices 1-3 landed `94e8a100`,
  `453c629f`, `8c0ae0b4`+`7f7d4ec4`), tenant hierarchy, Store→Location rename
  (closed `180255cb`, 1g wire rename `851d9a02`+`662e7f3a`), Legal Entity + §G
  default-entity migration, subscription fail-closed (`9896dac4` lifecycle
  state machine), expiry/grace policy (§B: admin locks at expiresAt; POS
  runtime rides tier grace 7/14/14/30/60; read-only lock after grace
  `bcaa5033`), operational/administrative split (`useAdminGate` `ed3731b2`),
  topology backend enforcement (`topology:write` `b0667ab4`+`3233a99d`),
  centralized quotas (`73e77c5f`, `de6d2df2`), Settings scope map
  (`77b0ce21`), tenant isolation (RLS gate `07197574`; 27 RLS-covered + 7
  documented-exempt).
- ADR #46 (topology revision history) Phase 1 RATIFIED COMPLETE (`d8ffa281`
  racing test + `9b9a1d8a`); Phase 2 (browser overlay) unblocked.
- Home Tools rebuilt `ab410844`: `tools.tsx` catalogue (17 tools, 3 groups),
  `tierLevel.ts`, gate stack, WorkspaceHomeTools.test.tsx.
- Terminology: Store → Location rename DONE; exceptions preserved = the 4
  workspace types (retail-pos/resto-pos/kds/warehouse), `inventory_locations`
  stock points, `Store<'a>` DB facade, legacy `store-pos`/`restaurant-pos`
  runtime aliases.
- Extensive supervisor log (Rounds 1-206): pathspec-scoped commits rule,
  journal-append absolute-path rule (2 stray-file incidents), gate-skip
  documentation, extraction waiver, tooltip saga.

### todo-global-saas-2.md (2423 lines) — Phase 2: P1 Product Maturity
- Domain specs: Memo lifecycle (§C), Shifts (§D), downgrades (§J),
  entitlements beyond tiers, offline outbox, audit baseline,
  Locations/Topology navigation.
- **P1 status:** DONE = numeric plan limits (`883386f4`), offline sync
  guarantees, scale navigation, Memo lifecycle (functionally complete
  end-to-end incl. cloud-read path `eb71d071`→`a009d3cf`→`2c5dde8a`→`52af7f9b`
  →`b9278fb0`; two orthogonal state machines MemoStatus×DeliveryStatus;
  memo:stop A2 `a23d81bd`; 30d retention `c8d2a54f`; revise `9062a7c1`;
  multi-location `4df091d3`+`b40593a0`), revise_memo IPC.
- **OPEN P1:** regional configuration; tax config separation; entitlements
  beyond tiers (⚠ read §"Entitlement enforcement consolidation" design
  first — 4 phases A-D; `oz_core::availability` explains but gates don't
  enforce from it); downgrade behavior (PARTIAL `869de0ce` detection layer
  landed; open: owner-facing remediation view, persisted over_quota marker,
  per-location dims); audit baseline + retention schedule (90/180/365/3y);
  Locations-to-Topology entry point; topology version/publish (Phase-1-scope
  done, browser overlay UX remains as Phase 2 ADR work).
- Key rulings: memo:stop = A2 (Owner/Admin presets), 30-day fixed memo
  retention, drafts never expire (rule dropped), "staff login screen" = once
  PIN pad is up (no pre-auth read), FK policy memos RESTRICT parents /
  CASCADE children (`f5d6482f`), cloud-read over REST not sync replication.
- Memo display: bottom-left chat bubble (max 3 stack, 60ms stagger, spring
  `--memo-spring` linear() easing, zoom-from-origin FLIP-lite, big X = durable
  ack, Escape/backdrop = no-ack; `eef79ebd`→`303b2189`); KDS cadence = 2× base
  (server-issued); render isolation proven (`9201e909`); WorkspaceContext
  value memoized (`bdd12854`).

### todo-global-saas-3.md (568 lines) — Phase 3: P2 Scale & Operations
- §K regional/compliance policy; P2 items: custom roles (safety half enforced;
  feature half unblocked by ADR #47; table is `assignments` NOT
  `role_assignments` — grep trap; key-set home = `roles.permissions` JSON),
  regional billing, data residency (DONE `docs/security/data-residency-and-retention.md`;
  open gaps: no sync-DB purge, no self-service deletion, backup windows),
  support tooling, service health contracts, feature-flag observability,
  multi-Org user switching, multi-location memos (DONE).
- Feature-flag observability: DESIGN + core resolver landed
  (`oz_core::availability` `869de0ce`+`2e86fb9b`, 13 tests; precedence
  server_policy > lifecycle > tier > quota > role > scope). IPC landed:
  tablet (`e17a4e32`+`dfbc41b2`), desktop (`ff85e7be`), UI client + dev-mock
  (`9c9b6f53`+`987d5698` — wire-key defect fixed: camelCase sessionToken).
  **Remaining: Settings → Diagnostics UI screen (separate slice) + the scope
  reason code ruling** (Amendment 4 recommends v1 = compute scope_granted
  from caller's session location `session.store_id`; explicit target arg
  later on evidence).
- ADR #47 ruling recorded: 1A-5A all adopted (assignments w/ nullable scope
  pairs, single choke point, downward-only inheritance, custom roles = key-set
  rows in registry, org-wide backfill).

### todo-tools.md (516 lines) — Tools Category home screen (audit + todos)
- GATED on global-saas completion (its header says so). Much content mirrors
  saas-1 (IA, role/tier matrix, scope map, grace reconciliation, `ab410844`
  journal).
- Its own todos: several marked RESOLVED/STALE/DONE pointing at Phase 1 work;
  still-open = IA/gate parity test, Topology Editor alignment with home
  policy, SaaS authorization scope (now delivered via ADR #47),
  Locations-to-Topology entry, custom-roles mapping decision, two optional
  items (keyboard shortcuts, favourites/pins for tools).

### Cross-file state summary (as of 2026-09-08 reading)
- Branch 0.0.37; last observed HEAD in journals: `bd60ed2a` (agent resync).
- P0 tier essentially cleared; remaining P1s: regional config, tax separation,
  entitlement enforcement consolidation (design written), downgrade
  remediation view, audit baseline. P2: custom-role authoring, observability
  UI screen, support tooling, health contracts, multi-Org switching.
- Standing process rules learned: pathspec-scoped commits only (never
  `git add -A`), flip checkbox in the landing commit, journal appends with
  absolute repo-root path, run `verify-ipc-parity.py` manually (not in
  pre-commit; dev-ci has no push trigger), don't trust raw greps for
  tenant isolation (34 tables tenant_id / 27 RLS / 7 exempt), (unanchored
  regex + substring labels = vacuous tests.
