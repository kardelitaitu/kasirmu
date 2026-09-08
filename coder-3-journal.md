# coder-3 journal

## 2026-09-08 — Learned the four planning files (orientation pass)

Read end to end (500-line chunks): `todo-global-saas-1.md` (3738 ln),
`todo-global-saas-2.md` (2423 ln), `todo-global-saas-3.md` (568 ln),
`todo-tools.md` (516 ln). No code changes. Summary of state absorbed:

### Shared contract (saas-1, normative for all phases)
- Hierarchy: Organization/Tenant → Legal Entity → Location → Terminals →
  workspace runtimes (`retail-pos`, `resto-pos`, `kds`, `warehouse` — never
  rename these; `inventory_locations` stock points and the `Store<'a>` DB
  facade are also rename-exempt).
- Access contract: `subject + permission + scope + resource + entitlement`;
  page access never replaces action-level enforcement.
- §B: admin features lock at `expiresAt`; POS runs through tier grace
  (7/14/14/30/60); after grace → read-only lock. Fail-closed everywhere.
- Quotas server-issued, over-quota resources marked not deleted.

### State (all Phase 1 P0 boxes CLOSED with evidence)
- Store→Location rename 1a–1g done (incl. license-server dual-emit/dual-read
  wire compat `851d9a02`+`662e7f3a`).
- ADR #47 scoped authorization slices 1–3 done (`94e8a100`, `453c629f`,
  `8c0ae0b4`+`7f7d4ec4`); table is `assignments` (NOT `role_assignments`).
- ADR #46 topology revision history Phase 1 RATIFIED complete
  (`ec46e6b7` extraction, `8ce2c805` change-note, `d8ffa281` racing test).
- Tenant isolation: RLS coverage gate closed (`07197574`); 27 covered,
  7 documented-exempt.
- Subscription lifecycle fail-closed (`9896dac4` family), grace reconciliation
  (`09d389a6`, `499bb1b0`), quota centralization (`73e77c5f`, `de6d2df2`).

### Phase 2 open work
- Downgrade behavior: detection landed (`869de0ce`); OPEN: owner-facing
  remediation view, persisted over_quota marker, per-location dims.
- Entitlements beyond tiers: 4-phase design written (A one read model,
  B one limit table, C trial state, D server-issued grants); A+B are
  client-core-only, no migration. NOT implemented.
- Audit baseline + retention schedule: OPEN.
- Regional configuration, tax separation: OPEN.
- Locations→Topology entry point: OPEN.

### Phase 3 open work
- Feature-flag observability: core resolver (`869de0ce` availability.rs),
  tablet IPC (`e17a4e32`/`dfbc41b2`), UI client+dev-mock (`9c9b6f53`/
  `987d5698`), desktop IPC (`ff85e7be`) all landed. OPEN: Settings→
  Diagnostics screen (separate slice); `scope_granted` ruling (Amendment 4
  recommends v1 = compute from `session.store_id`, awaiting maintainer).
- Custom roles: safety half done; feature half unblocked via
  `roles.permissions` JSON key-set rows + IPC. OPEN.
- Regional billing, support tooling, service health contracts, multi-org
  switching: OPEN. Data residency doc: DONE (`docs/security/data-residency-and-retention.md`).

### todo-tools state
- Home Tools rebuild DONE (`ab410844`): `ui/src/features/workspaces/tools.tsx`
  catalogue (17 tools, groups Operations/Insights/Configuration, declarative
  `access`), `ui/src/utils/tierLevel.ts` fail-closed ordering, gate stack,
  57 tests.
- OPEN: IA/gate parity test; Locations→Topology entry; optional shortcuts/pins.

### Standing process rules (learned from supervisor logs — binding)
- Pathspec-scoped commits only; never `git add -A`/`stash`; untracked files
  carry no author trail — check the todo journals before committing files you
  did not write. Flip checkboxes in the landing commit.
- Journal appends use absolute repo-root paths (two stray-file incidents).
- `verify-ipc-parity.py` is NOT a pre-commit step; run it directly before
  calling any IPC slice done. dev-ci.yml has no push trigger.
- Tauri invoke args bind camelCase (`sessionToken`); typecheck proves nothing
  about that untyped boundary (defect 1, saas-3 Amendment 3).
- Caps-vs-verdict invariant is PER-CLIENT (desktop has debug Free→Premium
  upgrade, tablet must not mirror it — `dfbc41b2`).
- WSL bash hangs; use `C:\Program Files\Git\bin\bash.exe`.
- Money = i64 minor units; rusqlite transactions; forward-slash paths.
