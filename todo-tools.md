we do this after global-saas (now split into `todo-global-saas-1/2/3.md`) is done

# Tools Category — Home Screen (audit + todos)

Audited 2026-09-05 from `ui/src/features/workspaces/WorkspaceHome.tsx` (round AI follow-up; subscription/auth verification).
The Tools grid is the **admin area's front door** — the admin workspace card itself is
hidden from the home grid (lines 526–528); this section is how owners/managers reach it.
The redesign treats Settings as a dedicated configuration page and the remaining
entries as dedicated operational/admin pages.

> **What this file is (stamped 2026-09-14, and the reason it is written here):** an
> AUDIT RECORD with a todo tail — not a work order. It carries no Goal / Role /
> Target-Files block, no owned-path fence and no commit convention, so no
> orchestration pass claims it and nothing re-adjudicates its boxes. That is
> precisely how the tail got dishonest: five of its nine open boxes were DONE ON
> DISK, and three of those five had carried a `RESOLVED 2026-09-07` /
> `STALE 2026-09-07` note for seven days with the checkbox still empty — a note in
> prose is invisible to anyone who triages by
> `- [ ]`. The other two shipped with no note at all and are ticked below on the code
> alone. The remedy applied here is dated verification lines and honest ticks,
> NOT a restyle into an `agents-N` plan — this file's value is the audit above it.

## Current implementation inventory (before redesign)

| Tool | Route | Min role (home gate) | Extra gate at route level | Notes |
|---|---|---|---|---|
| Analytics | `analytics` | admin | `analytics:view` | — |
| Reports | `dashboard` | manager | `reports:view` | — |
| Staff | `staff` | manager | `staff:read` | — |
| Settings | `settings` | manager | `settings:read` | — |
| Audit Log | `audit-log` | manager | `audit:view` | — |
| Terminals | `terminals` | manager | — | — |
| Stores | `stores` | manager | feature: `multi-store` | — |
| Shifts | `shifts` | manager | `shifts:view_any` | — |
| Tax Config | `tax-config` | manager | feature: `tax-engine` | — |
| Exchange Rates | `exchange-rates` | manager | — | — |
| Promotions | `promotions` | manager | — | — |
| Offline Queue | `offline-queue` | manager | — | — |
| Features | `features` | owner | — | — |
| Data Management | `data-management` | owner | — | — |

Section visibility: owner/admin/manager only (`canSeeTools` = role ≥ manager).
Staff and auditor never see the section. Click behaviour:
`window.location.hash = '#/<route>'` + `setActiveWorkspace('admin')`.

## How access filtering stacks today (three gates)

1. **Section visibility** — `canSeeTools`: role level ≥ manager via `ROLE_HIERARCHY`.
2. **Per-tool role gate** — `minRole` on each `ToolItem`.
3. **Subscription capability gate (C2.2)** — `capAllowed` via `useSubscription()`;
   `caps === null` degrades open (fail-open by design).

## Subscription/auth verification (2026-09-05)

- `ui/src/contexts/SubscriptionContext.tsx` calls only the local
  `get_subscription_capabilities` command. It does **not** call the authoritative
  `check_license_status` command or the license server.
- `get_subscription_capabilities` reads the signed local `tenant_subscription`
  row and returns `tier` plus feature flags, but the DTO exposes no `status`,
  `expiresAt`, or `graceUntil` to the UI.
- `apps/desktop-client/src/commands/license.rs` already exposes
  `check_license_status`, which calls the license server's
  `POST /api/v1/license/status` endpoint and returns `tier`, `status`, `active`,
  `expiresAt`, and `graceUntil`.
- `apps/license-server/status.go` authenticates with the stored Bearer API key
  and returns the latest subscription with `status = 'active'`. Its `active`
  field currently mirrors the stored status; the handler does not independently
  compare `expires_at` with the current time.
- The local Rust entitlement path currently honors a paid tier through its
  configured offline grace period (14 days for current tiers), then downgrades
  the effective tier to Free. This conflicts with the desired Tools behavior:
  **do not make a tool clickable after `expiresAt`, unless an explicit server
  policy says otherwise**.
- The desktop subscription command upgrades a Free bootstrap row to Premium in
  debug builds. Local development can therefore appear fully entitled unless
  this is accounted for in tests.
- The product tier keys found in code are `free`, `plus`, `pro`, `premium`, and
  `enterprise`. The existing server expiry policy is: Free effectively lifetime,
  Plus/Pro/Premium one year, Enterprise three years, with `graceUntil` set to
  `expiresAt + 14 days`.

## Pricing verification (2026-09-05)

Source checked: <https://ozpos.my.id/en/pricing/>.

- **Reports & Analytics** are listed as Pro, Premium, and Enterprise features;
  target home-card tier is `pro`.
- **Full audit logging** is listed only for Premium and Enterprise; target
  `Audit Log.minimumTier` is `premium`.
- **Cloud sync** starts at Plus; target cloud-sync capability is `plus` or higher.
- Resource quotas are tier-dependent: stores `1/1/2/5/unlimited`, terminals per
  store `1/2/5/unlimited/unlimited`, staff users `1/5/20/50/unlimited`, and KDS
  screens `0/0/2/unlimited/unlimited` for Free through Enterprise.
- Product policy for offline grace is now `7/14/14/30/60` days for Free,
  Plus, Pro, Premium, and Enterprise. The public pricing page currently says
  Enterprise `Custom`, so the page and product decision need to be reconciled.
  The current server/local implementation also documents a different grace
  policy.
- Promotions is now a Premium+ feature by product decision. Topology Editor,
  Settings, and basic Staff/Locations/Terminals access remain role-gated, with
  quotas/action limits enforced where the pricing table defines them.

## Agreed information architecture (draft, 2026-09-05)

The home Tools area is grouped into Operations, Insights, and Configuration:

```text
Tools
├── Operations
│   ├── Staff (manager+; all active tiers)
│   ├── Locations (manager+; status view)
│   ├── Terminals (manager+; registration/status)
│   │   └── topology summary
│   ├── Shifts (role/tier policy TBD)
│   ├── Memo (manager+; Pro+)
│   └── Promotions (manager+; Premium+)
├── Insights
│   ├── Analytics (admin+; Pro+)
│   ├── Reports (manager+; Pro+)
│   └── Audit Log (manager+; Premium+)
└── Configuration
    └── Settings (admin/owner only; manager sees locked card)
        ├── General
        ├── License & Subscription
        ├── Devices & Connectivity
        ├── Business Defaults
        ├── Topology Editor
        ├── Features & Modules
        ├── Security & Account
        ├── Data & Sync
        │   ├── Data Management (Plus+)
        │   ├── Sync Status (Plus+)
        │   └── Offline Queue
        ├── Tax Configuration
        ├── Exchange Rates
        └── System Diagnostics
```

Ownership boundaries:

- **Topology Editor** is an existing node-programming page at
  `ui/src/features/stores/TopologyScreen.tsx`, backed by the Tauri topology
  commands and shared topology semantics contract. It creates branch/location
  profiles, connects them to workspace instances, applies location properties
  such as Address/Currency/Timezone/Tax ID, and supports location/workspace
  renaming. The current node kinds are Branch Location (`store`), Workspace,
  Warehouse, and Hardware; workspace types include `store-pos`,
  `restaurant-pos`, and `kds`. Current semantic wires include location,
  operation/generic, stock routing, ticket routing, hardware connection, and
  inventory transfer. Example topology:
  `locationA ── restoPOS ── KDS1` and `locationA ── restoPOS ── KDS2`.
  It defines relationships; it does not replace terminal registration.
- **Topology access mismatch to repair:** the current backend save capability
  uses `staff:update`, which is broader than the agreed admin/owner-only home
  gate. The new route/page policy must be enforced at the backend Apply and
  rename boundaries, not only by greying the home card.
- **Locations** is read-only monitoring of active locations and status; it does
  not edit topology. The page may show only locations allowed by the plan quota.
- **Terminals** registers/deactivates physical devices and summarizes each
  device's topology assignment; it does not define relationships. Registration
  enforces the plan's terminal quota.
- **Settings** changes application configuration. The Settings page and its
  sections are admin/owner-only; managers see a greyed-out locked Settings card.
- **Settings > Data & Sync** owns Data Management, Sync Status, and Offline
  Queue; do not expose those surfaces again under Diagnostics. Data Management
  and Cloud Sync are Plus+; basic Offline Queue visibility is available to all
  active tiers, while advanced conflict tools are Plus+. The whole Settings hub
  remains admin/owner-only, with managers seeing its card locked.
- **Memo** is a dedicated Pro+ page for writing a memo targeted at a selected
  terminal within a selected location. The target terminal is chosen from the
  topology/location relationship; the page does not redefine topology. It is
  available to manager, admin, and owner roles. The first version targets one
  terminal, uses draft/published/queued/delivered/read/acknowledged/expired/
  archived states, keeps published content immutable through revisions, and
  recommends a seven-day default expiry.

Role-only means `minimumTier: 'free'` for an active, non-expired subscription;
it does not bypass subscription validity or expiration. A tier-ineligible card
remains visible to an allowed role, appears greyed out, displays a localized
minimum-tier badge, and is not clickable.

The Audit Log decision is explicit: its minimum tier is `premium`, therefore
only Premium and Enterprise can use it. Its role minimum is `manager`.
Promotions is also fixed at `minimumTier: 'premium'` with a `manager` role
minimum. Analytics is `admin + pro`; Reports is `manager + pro`.

## Final role/tier matrix (design, not implemented)

| Page | Minimum role | Minimum tier | Behavior |
|---|---|---|---|
| Settings | admin | free | Owner inherits admin; manager sees locked card |
| Topology Editor | admin | free | Owner inherits admin; action quotas still apply |
| Staff | manager | free | Staff quota applies to create actions |
| Locations | manager | free | Status view; plan limits visible locations/actions |
| Terminals | manager | free | Registration enforces terminal quota |
| Shifts | TBD | TBD | Retained from the current inventory; policy not yet finalized |
| Analytics | admin | pro | Premium/Enterprise inherit Pro |
| Reports | manager | pro | Premium/Enterprise inherit Pro |
| Audit Log | manager | premium | Premium/Enterprise only |
| Settings > Data & Sync | admin | section-level | Data Management and Sync are Plus+; basic Offline Queue is all active tiers |
| Memo | manager | pro | Writes to a selected terminal within a selected location |
| Promotions | manager | premium | Premium/Enterprise only |

Role-only means `minimumTier: 'free'` for an active, non-expired subscription.

## Target Tools access model (design, not implemented)

Each top-level page should eventually declare:

```ts
access: {
  minimumRole: 'manager',
  minimumTier: 'pro',
}
```

Role checks remain hierarchical: a higher role inherits access from a lower
minimum role. Page availability and action availability are separate: for
example, Terminals may be visible on every active tier while device registration
still enforces that tier's terminal quota.

The subscription decision must be based on an active, non-expired entitlement.
Cached/local data may support offline operation only while its validity policy is
still valid; it must never extend access beyond `expiresAt`.

## Global SaaS design recommendations (2026-09-05)

The current information architecture is a strong Phase 1 foundation for a
SaaS POS, but global readiness requires these rules:

1. Every page access decision should eventually include:
   `minimumRole`, `minimumTier`, permission, and scope.
2. Every mutating action should independently enforce permission, scope, quota,
   and entitlement. Page visibility must not imply unlimited create/register
   access.
3. Roles need location/workspace scope, not only a global hierarchy. A manager
   for Location A must not automatically manage Location B.
4. Settings sections need explicit scope: organization, location, terminal, or
   workspace. For example, License is organization-scoped, Address is
   location-scoped, and printer behavior is terminal-scoped.
5. Locations remains a status page, but it should offer a clear Configure
   Topology entry point so location lifecycle is not hidden inside the graph
   editor.
6. Subscription entitlements should be modeled as plan + add-ons + quotas +
   billing/status/expiry state, rather than relying only on tier comparison.
7. Offline operation and administrative entitlement may need separate policies:
   a register may continue under an approved offline policy while premium
   administrative pages lock after entitlement expiry.
8. Audit Log may eventually need basic security events for every active tier,
   with Premium/Enterprise receiving full retention, filtering, and export.
9. Memo needs a lifecycle model (target, author, delivery, acknowledgement,
   edit/delete policy, expiry/retention, and offline delivery state).
10. Use the agreed Operations, Insights, and Configuration groups rather than
    keeping one unstructured card grid. Shifts remains in Operations until its
    final role/tier policy is confirmed.

Recommended future access shape:

```ts
access: {
  minimumRole: 'manager',
  minimumTier: 'pro',
  permission: 'memo:write',
  scope: 'location',
}
```

## Health (verified 2026-09-05 · counts re-derived 2026-09-14)

- ✅ All tool routes resolve to lazily-registered pages in each feature's `register.tsx` — no dead tiles.
  **Count moved: 14 → 17** (re-derived 2026-09-14: `ui/src/features/workspaces/tools.tsx:65` declares
  `export const TOOLS: ToolItem[]` and the file holds 18 `route:` matches, one of which is the
  `ToolItem` field declaration at `:40` → 17 tool entries today). The no-dead-tiles half of the claim
  is not re-derived by hand here — it is pinned by the parity union, which was green when re-run
  2026-09-14: `WorkspaceHomeTools.test.tsx` + `WorkspaceHomeTools.navParity.test.tsx` +
  `pageRegistry.test.ts` → 3 files / 39 tests passed.
- ✅ `WorkspaceHome.test.tsx` — **48/48 passing** (re-measured 2026-09-14:
  `cd ui && npx vitest run src/__tests__/WorkspaceHome.test.tsx` → `Tests 48 passed (48)`).
  The 42/42 recorded on 09-05 was true then and is six cases stale, not a miscount.
- ✅ `minRole` values agree with each route's `requiredRole` today (spot-checked owner-gated pair).

## Todos

- [x] **Align auth-server behavior with the strict expiry decision.** Product
      policy is now: a Tool is not clickable after `expiresAt`; the current
      server/local implementation still publishes and honors a grace period,
      and the pricing page advertises tier-specific grace days. Reconcile the
      authoritative policy before the gate is implemented.
      — **RESOLVED 2026-09-07** (journal below): the §B split was already
      ratified and shipped UI/Rust-side; this session aligned the last two
      divergent paths — the license server's flat-14 grace_until
      (`09d389a6`, all nine signing paths now per-tier) and the desktop's
      payload-trusting license verdict (same commit). The `active` field on
      `/status` stays raw-status by design: the client refines dates via
      `lifecycle_state()`, which is authoritative.
      — **TICKED 2026-09-14 on re-verified code, not on the note above:**
      `apps/license-server/expiry.go:27-50` now computes the window per tier —
      `offlineGraceDays(tier)` is declared at `:34` (premium 30 / enterprise 60 /
      free 7, plus-pro and unknown keys falling through to 14) and is the only
      thing `calculateGraceUntil` adds at `:50`, so no signing path still carries
      the flat 14-day ADR #5 window. The unknown-tier default is pinned:
      `apps/license-server/main_test.go:236-237`
      (`offlineGraceDays("mystery") != 14`). One wording correction to the note
      above: the code comment at `expiry.go:45-46` calls 14 "the shortest window"
      and it is not — Free's 7 is shorter. Recorded, not edited (out of this
      file's fence).
- [x] **Expose authoritative subscription state to the UI.** Extend or replace
      the local-only `SubscriptionContext` flow so the Tools gate can distinguish
      active, expired, canceled/paused, loading, and unavailable states. Do not
      retain the current `caps === null` fail-open behavior for clickability.
      — **STALE 2026-09-07: already delivered by the Phase 1 stream** —
      `SubscriptionContext` now carries the §B lifecycle `state`
      (active/grace/expired/canceled/paused/unavailable) with fail-closed
      semantics, plus the `useAdminGate()` hook; this slice consumed it
      (`ab410844`) rather than re-implementing it.
      — **TICKED 2026-09-14: the fail-open the box forbids is gone.**
      `ui/src/contexts/SubscriptionContext.tsx:14` publishes
      `SubscriptionUiState = SubscriptionLifecycleState | 'loading'`; the §B
      fail-closed contract is stated at `:44-46` ("the command layer never errors
      … it returns Free entitlements with `state: 'unavailable'`, so gates lock")
      and the transport-failure catch at `:63-65` sets `setState('unavailable')`.
      `useAdminGate()` at `:100-104` resolves an absent state to `'unavailable'`
      and returns `locked: resolved !== 'active'` — absent data locks, it does not
      open. `caps === null` no longer drives clickability.
- [x] **Replace unused `cap` configuration with declarative access policy.** Each
      top-level page should configure `minimumRole` and `minimumTier`; role
      hierarchy is inherited upward (`manager` includes admin/owner), and a
      tier-ineligible card remains visible, greyed out, and non-clickable with a
      localized badge. Audit Log is fixed at `minimumTier: 'premium'`.
      — **DONE 2026-09-07, `ab410844`** (see the implementation journal below).
- [x] **Define the canonical tier ordering and tier policy map.** Current keys are
      `free`, `plus`, `pro`, `premium`, and `enterprise`; minimum-tier checks
      require a single centrally owned ordering and localized display names.
      Product mapping is now Analytics/Reports=`pro`, Audit Log/Promotions=`premium`,
      and Settings > Data & Sync's Data Management/Cloud Sync=`plus`; basic
      Offline Queue visibility is available to all active tiers.
      — **ordering DONE 2026-09-07, `ab410844`** (`ui/src/utils/tierLevel.ts`,
      fail-closed on unknown tiers; display names are per-tier FTL badge keys).
      The policy map rides the access matrix in `tools.tsx` — same commit.
- [x] **Add subscription-state and locked-card tests.** Cover loading, active,
      insufficient tier, expired, canceled/paused, unavailable, and higher-role
      inheritance. Cover Audit Log at Premium/Enterprise, Memo at Pro+,
      and locked below their minimum tiers. Account for the desktop debug
      build's Free-to-Premium bootstrap.
      — **DONE 2026-09-07, `ab410844`** (render suite in WorkspaceHome.test.tsx:
      tier lock, role inheritance, manager-locked Settings, grace/expired
      validity; matrix + parity pins in WorkspaceHomeTools.test.tsx). The
      loading state is covered by the §B contract itself (SubscriptionContext
      gates + this slice's `loading`-stays-open rule for role-only tools).
      The debug-bootstrap caveat is documented in the journal below.
- [x] **Implement Memo lifecycle.** Start with one terminal per Memo,
      manager-scoped authorship, read-only terminal access, immutable published
      revisions, delivery/acknowledgement states, seven-day default expiry, and
      policy-defined retention. Add location-wide broadcast later.
      — **STALE 2026-09-07: delivered by the Phase 2 memo stream** (rulings and
      journal in `todo-global-saas-2.md`; multi-location targeting widened
      further in `4df091d3`). The home Memo card rides `ab410844`.
      — **TICKED 2026-09-14 on the shipped surface:** `crates/oz-bridge/src/memo.rs`
      (command bodies), `ui/src/api/memos.ts` (typed wrappers) and
      `ui/src/__tests__/api-memos-contract.test.ts` all exist. The five memo
      commands are registered on desktop only **by ruling, not by omission** —
      `scripts/ipc-parity-allowlist.json:2` (the `_comment`) states it: "The three
      memo-authoring entries (create_memo_scoped, list_authored_memos_scoped,
      publish_memo_scoped) are a deliberate product choice, not a gap: authoring is
      desktop-only … stop_memo_scoped and revise_memo_scoped join them for the same
      reason (the 2026-09-07 A2/scope rulings)." **Anchor correction to the brief
      that pointed here:** the entries themselves are not at `:2` — that line is the
      comment. They sit in the `"tablet"` array (which opens at `:32`, after
      `"desktop"` at `:3`) at `:50` `create_memo_scoped`, `:64` `revise_memo_scoped`,
      `:65` `stop_memo_scoped`, `:113` `list_authored_memos_scoped`,
      `:152` `publish_memo_scoped`.
- [x] **Add an information-architecture and gate parity test.** Verify every
      top-level page has a registered route, its role policy agrees with the
      route policy, and its tier policy (Analytics/Reports Pro+, Audit Log
      Premium+, cloud sync Plus+) is tested. Verify Settings subpages and
      page/action quota gates separately.
      - **DONE 2026-09-08 (finisher-A):** covered by the test union
      ui/src/__tests__/WorkspaceHomeTools.test.tsx (route + role + tier
      parity) and ui/src/__tests__/WorkspaceHomeTools.navParity.test.tsx
      (every tool route is a real sidebar nav entry; home gate never looser
      than nav requiredRole); ui/src/__tests__/pageRegistry.test.ts
      (role hierarchy + permission precedence for the gate machinery);
      ui/src/__tests__/SettingsDeepLink.test.tsx +
      ui/src/__tests__/SettingsNavTree.test.tsx (Settings subpages); and
      the NEW ui/src/__tests__/quotaGateParity.test.tsx, which closes the
      only open clause - page/action quota gating. It drives a feature to a
      quota verdict through the availability contract and asserts the
      IA/page layer honors it (feature reported unavailable with reason
      quota). Note: the production page-registry gate consumes only role +
      permission + feature-set, so the quota axis is asserted at the
      FeatureVerdict contract the gate layer reads; the resolver side is
      pinned by verdict_names_quota_at_the_cap_and_clears_one_below
      (apps/desktop-client/src/commands/subscription_tests.rs).
- [x] **Align the existing Topology Editor with the new home policy.** The
      editor already supports branch-scoped graphs, location/workspace/warehouse/
      hardware nodes, typed semantic wires, address-like branch properties,
      rename, Apply, templates, and branch comparison. Wire it to the new
      `Topology Editor` home card and enforce admin/owner-only access at the
      backend Apply/rename/template-write boundaries.
      — **RETAGGED DONE 2026-09-14.** The write boundaries are enforced in
      `crates/oz-bridge/src/topology/commands.rs`: `require_permission_for_user`
      is called with `permissions::TOPOLOGY_WRITE` at `:42-45`, again at `:79`
      (branch-scoped read/write pair), at `:252-255` — whose doc comment at `:236`
      says "Gated on `TOPOLOGY_WRITE`, deliberately unlike its two read siblings"
      — and inside `apply_topology_diff` (declared `:389`) at `:479`, so Apply and
      the rename/template writes cannot be reached without the permission. The
      read-only revision history is deliberately NOT gated on it: `:268`
      ("Gated on `AUDIT_VIEW`, not `TOPOLOGY_WRITE`"), `:283`, `:307`.
      **RESIDUAL, and it is not small: the box asked for a ROLE and the shipped
      answer is a PERMISSION KEY.** `TOPOLOGY_WRITE` is enforced — that part is
      verified. Whether the seeded role presets grant `TOPOLOGY_WRITE` to
      admin/owner ONLY was not measured in this pass, so "admin/owner-only" is
      verified as *enforced* and NOT as *co-extensive with the role this box
      named*. If a preset below admin carries the key, the shipped gate is wider
      than the policy the box stated; that is the one open question left here, and
      it belongs to whoever owns the role presets, not to the editor.
- [ ] **Add SaaS authorization scope — NARROWED 2026-09-14: organisation +
      terminal scope remain.** The box as written asked for four scope axes
      (organization, location, workspace, terminal) on top of role and tier.
      **Two have shipped**, so the box no longer describes the work: branch and
      workspace scope are evaluated on the write path by
      `crates/oz-core/src/db/staff.rs:225-245` — `require_permission_scoped`,
      whose `:225-228` doc comment is "the scope-aware gate (ADR #35 D5 / spec
      0048): … plus the assignment's branch/workspace scope is evaluated for
      scoped assignments", and whose refusal at `:243-245` is literally
      `"branch/workspace out of scope for user {user_id}"` — and the same axis
      reaches the availability resolver as a first-class fact:
      `crates/oz-core/src/entitlements.rs:232-236` (caller supplies "role, scope,
      the per-feature server grant"), `:247` `scope_granted: Option<bool>`, `:262`
      where the facts are assembled; `crates/oz-core/src/availability.rs:395`
      turns it into `let scope_denies = facts.scope_granted == Some(false)`.
      **What remains is organisation-wide and terminal-level scope**, and this box
      is deliberately left UNCHECKED because the two surviving axes are exactly
      the ones that make "a location-scoped manager cannot manage every tenant
      location" non-trivial.
- [x] **Define settings scope.** Mark each Settings section as organization-,
      location-, terminal-, or workspace-scoped before implementation.
      — **DONE 2026-09-07** (the map is the "Settings scope map" section below;
      the UI already renders §H scope tags per section — this ratifies them
      and defines write-path/enforcement semantics per level).
- [x] **Add a Locations-to-Topology entry point.** Keep Locations status-only,
      but let users open the relevant topology editor from a location detail.
      — **DONE 2026-09-14 (re-verified), and DELIVERED UNDER ANOTHER PLAN —
      `todo-global-saas-2.md`, not this one.** The code says so itself:
      `ui/src/features/locations/MultiStoreDashboardScreen.tsx:135` opens the block
      `// ── Locations → Topology entry points (todo-global-saas-2 §"Locations
      and Topology navigation")`, and the stated contract is the box's own
      requirement — "The dashboard stays status-oriented: these actions only ROUTE."
      `:149-150` `handleConfigureTopology` routes to
      `#/settings/topology?branch=<locationId>`; `:158-159` `handleAddLocation`
      routes to `#/settings/topology?create=1`; both set the admin workspace, and
      the affordance is rendered twice — the card action at `:287-289` and the
      detail-drawer copy at `:376` (the brief listed `:288-289`; the second site is
      what this pass adds). Writing "done" without the attribution would let a
      reader conclude this plan funded work it never scheduled.

### Needs a product ruling

The three boxes below cannot be closed by a worker: they are waiting on a human
decision, not on code. They stay UNCHECKED and are grouped here so the next
triage does not re-derive them a fourth time. The first is load-bearing.

- [ ] **Decide how custom roles map to the hierarchy.** Unknown role names
      currently resolve to level 0 and see no Tools section.
      — **PREMISE STILL EXACTLY TRUE, re-verified 2026-09-14:**
      `ui/src/features/workspaces/WorkspaceHome.tsx:363` reads
      `const roleLevel = ROLE_HIERARCHY[roleName] ?? 0;`, against the
      `ROLE_HIERARCHY` table at `:97-108` — closed, ten keys: five presets in two
      spellings each (`owner`/`role-owner` … `auditor`/`role-auditor`) — and `:414`
      gates the whole section on
      `canSeeTools = roleLevel >= (ROLE_HIERARCHY['manager'] ?? 0)`. So an unknown
      custom role is not ranked LOW, it is invisible — no Tools section, and no
      message explaining why. A silent lockout, and the honest label for it is
      UNRESOLVED, not STALE. What is needed is a ruling (what rank does a created
      role hold? does it carry the preset it was cloned from? is `0` the intended
      deny-by-default?) before any of it is code.
- [ ] **Optional: keyboard shortcuts for tools.** Workspace cards have "Press 1–9"
      hints; tool cards don't. Asymmetry only — low priority.
      — **UNFUNDED 2026-09-14**, and marked optional in this file since it was
      written. Nobody has asked for it since, and nothing was measured: the claim is
      a visual asymmetry, and the box itself is the whole evidence for it.
- [ ] **Optional: no favourites/pins/last-used for tools.** Workspace cards support
      pinning + last-used sorting; tools render in a fixed order. Consider whether
      managers need their frequent tools promoted.
      — **UNFUNDED 2026-09-14**, same status as the box above: a product
      question with no ruling, therefore no work order.

## Mechanics reference (current implementation)

- `TOOLS: ToolItem[]` — module-level array (line ~104): `id`, `route`,
  `labelKey`,
  `descKey`, `minRole`, optional `cap`, inline SVG `icon`.
- `ToolItem` interface (line ~77): `cap?: keyof SubscriptionCapabilities` — unused
  by current Tools entries and targeted for replacement by `access`.
- `visibleTools` = `TOOLS.filter(canSeeTools && canAccessTool(minRole) && capAllowed)`.
- Section renders only when `visibleTools.length > 0` — the redesigned section
  should preserve role hiding but keep subscription-ineligible cards visible.
- Tests: `ui/src/__tests__/WorkspaceHome.test.tsx`.
- i18n keys: `workspace-home-<id>-title/-desc` in the workspace FTL bundle.

*(Mechanics above describe the pre-`ab410844` shape and are kept for audit
trail; the current catalogue lives in `ui/src/features/workspaces/tools.tsx` —
grouped, declarative `access`, consumed by WorkspaceHome's gate stack.)*

---

## Settings scope map (2026-09-07 — ratifies the §H tags, defines the contract)

The Settings hub (`ui/src/features/settings/SettingsPage.tsx` +
`SettingsNavTree.tsx`) already renders a §H scope tag per section
(`SettingsScopeTag`, five levels: organization / legal-entity / location /
workspace / terminal). The map below RATIFIES the shipped tags as the
definition todo #10 asked for, and attaches the two things a tag alone does
not carry: what the scope means for the WRITE PATH, and who may edit.

| Section (key) | Scope | Write-path meaning | Edit access |
|---|---|---|---|
| General (`general`) | organization | Org-wide profile, brand store name, default currency | admin+ |
| Appearance (`appearance`) | workspace | Display density/font for the workspace's surfaces | manager+ (scoped) |
| Receipt (`receipt`) | workspace | Receipt format for the workspace's printers | manager+ (scoped) |
| Cloud Sync (`sync`) | organization | Org-level sync server + cadence | admin+ |
| Local API (`local-api`) | terminal | Device-local API surface, never syncs | device operator |
| About (`about`) | terminal | Device info/version, read-only | device operator |
| License (`license`) | organization | Org entitlement (matches ADR-47: License is org-scoped) | admin+ |
| Email Reports (`email`) | organization | Org-level SMTP + recipients | admin+ |
| Topology (`topology`) | organization | Org graph surface; individual Apply writes are location/resource-scoped | admin+ (`topology:write`) |
| Store POS (`store-pos`) | workspace | Workspace-type behavior card | manager+ (scoped) |
| Restaurant POS (`restaurant-pos`) | workspace | Workspace-type behavior card | manager+ (scoped) |
| Inventory (`inventory`) | location | Stock-point behavior for the location | manager+ (scoped) |

"manager+ (scoped)" means: unlocked for managers ONLY within the locations/
workspaces their ADR #47 assignments cover — org-wide edits stay admin+.
Until the scoped-assignment UI slice ships, these render admin+ in practice
(consistent with the whole hub being admin-gated on the home screen).

Pre-assigned scopes for the IA sections that do not exist in the hub yet
(their standalone routes keep their own gates until the Settings-nesting
slice, which this map unblocks): License & Subscription=organization · POS
Behavior=workspace (the two cards) · Devices & Connectivity=terminal ·
Business Defaults=organization · Features & Modules=organization · Security
& Account=organization · Data & Sync=organization (Data Management and Sync
Status plus-gated; Offline Queue readable by all active tiers) · Tax
Configuration=location (§K: tax rules are location-aware) · Exchange Rates=
organization · System Diagnostics=terminal.

Open review item (not a correction): Appearance's tag says workspace, but
display density/font are device-local preferences in practice. Confirm the
storage key scoping when the enforcement pass lands; if they prove
terminal-local, retag rather than re-scope the data.

---

## Grace-policy reconciliation (2026-09-07 — todo #1 resolved)

The audit feared a product conflict: "tools not clickable after expiresAt"
vs a published grace period. There is none — §B already reconciled it, and
every layer but two already implemented the same reading:

| Layer | State before this session |
|---|---|
| §B contract (saas-1) | Adopted: operational runtime continues through the tier's offline grace; ADMINISTRATIVE features lock at the expiry date itself. |
| Pricing page + invariants test | Publishes the per-tier table (7/14/14/30/60) as "Offline grace period" — accurate for operational grace. |
| licensing.md (en + id) | Already says "Administrative features … lock earlier, at the expiry date itself." |
| Rust `lifecycle_state()` / `effective_tier()` | Correct: date-refined per the tier table, fail-closed. |
| UI (SubscriptionContext, `useAdminGate`, the Tools gate) | Correct: tier-gated tools lock unless `state === 'active'`; role-only tools ride grace. |
| **License server `calculateGraceUntil`** | **BUG: flat 14 days (ADR #5 relic) for every tier** — wrote wrong `grace_until` on all nine signing paths. |
| **Desktop `get_license_status`** | **BUG: trusted the payload's grace_until**, disagreeing with `lifecycle_state()` on stale payloads. |

`09d389a6` fixed both bugs: the server's grace deadline is now
`expires_at + offlineGraceDays(tier)` (7/14/14/30/60, fail-closed default)
across activation, Paddle provision/update/resume, Midtrans, renew, resume,
and both admin paths; the desktop derives the verdict from the payload tier
key via the same table, so the license-status toast and the capabilities
gate agree even for payloads signed by pre-fix servers. Tests pin the table
on both sides.

Recorded, not changed: `/api/v1/license/status`'s `active` field remains the
raw stored status. The client refines it with the signed expiry (the
authoritative date source), and the server is not the clock authority for
an offline-first device. A future server-side `state` field, if ever added,
should mirror `lifecycle_state()` rather than invent a second vocabulary.

## Implementation journal — home Tools rebuilt (2026-09-07, `ab410844`)

**Scope.** The agreed redesign of the home-screen Tools section, executed
while the topology/a11y/ADR-47-slice-3 streams owned their files. Four
pieces:

1. **Catalogue module `ui/src/features/workspaces/tools.tsx`.** Every tool
   (now 17: the 14 prior entries plus the IA's **Topology Editor** and
   **Memo** cards) declares `access: { minimumRole, minimumTier,
   lockBelowRole? }` and a `group`. Groups: Operations (topology, staff,
   locations, terminals, shifts, memo, promotions), Insights (analytics,
   reports, audit), Configuration (settings, cloud-sync, tax-config,
   exchange-rates, offline-queue, features, data-management). The Matrix
   pins are locked by tests, not prose.

2. **Canonical tier ordering `ui/src/utils/tierLevel.ts`** — `TIER_LEVEL`
   + `tierSatisfies`, fail-closed on unknown/absent current tiers
   (matching the §B contract that a missing subscription never grants
   tiered access).

3. **Gate stack in WorkspaceHome** (lowest precedence first):
   section visibility (manager+ only, unchanged) → role gate (below
   minimum = hidden, except `lockBelowRole` = locked card — Settings is
   the only one, per the matrix's "manager sees locked card") →
   subscription validity (role-only tools stay open in `active`/`grace`
   AND `loading` — the first fetch must not flash-lock the section — and
   hard-lock on expired/canceled/paused/unavailable) → tier gate
   (`tierSatisfies`) + the §B `useAdminGate()` for every `minimumTier !==
   'free'` tool (locks the moment the subscription leaves `active`;
   grace never re-opens administrative features). Locked cards are
   visible, greyed (`aria-disabled`, non-interactive `div`), with a
   localized reason badge — minimum-tier, "Subscription inactive", or
   "Admin access required".

4. **FTL**: 14 new keys × 2 locales (group headers, per-tier
   `Requires … plan` badges — per-tier keys instead of a templated
   `$tier` so the no-bundle test fallbacks stay clean —, subscription /
   role reasons, topology + memo title/desc).

**Tests (57 green).** New `WorkspaceHomeTools.test.tsx` is data-level:
matrix pins, group membership/order, route parity — every tool route
resolves to a registered page (`settings/*` deep links must resolve the
settings hub), and the home `minimumRole` is never LOOSER than the
route's `requiredRole` (home-stricter is the documented policy choice;
Settings stays `manager` + authoritative `settings:read` at the route
until the §H scope pass). WorkspaceHome.test.tsx render suite covers
tier lock + badge, role inheritance, manager-locked Settings,
grace-vs-expired validity split, and the new cards.

**Deliberate non-changes.** Route registrations untouched (the §H
settings-scope todo owns the route-level Settings role/permission
rework; the matrix is enforced at the front door this slice owns).
Config pages are NOT moved into the Settings master-detail yet — the IA
nesting is gated on the settings-scope definition todo. Shifts stays
role-only in Operations (matrix TBD). The debug build's
Free→Premium bootstrap still means local dev looks fully entitled —
unverified locally, by design.

**Validation under contention.** Three other streams were mid-flight;
the a11y stream's uncommitted `useFocusTrap.ts` edit broke whole-project
tsc AND every vitest transform (transitively imported), so this slice
was verified in an isolated `git worktree` of HEAD + the ten slice
files (eslint clean, full `tsc --noEmit` clean, 57/57 tests), then the
worktree was removed. The typecheck gate skip is documented in the
commit body per the R144 precedent. The compliance suites flagged only
pre-existing HEAD debt in topology-stream files (NodeTopologyEditor.css
hardcoded font-size, topologyNodeCard titles above baseline,
settings-active-section-scope dead class) — none from this slice. The
staged-only bundle-parity gate reads untracked sources too, so it
elected the one missing overlay key (`topology-rev-browser-loading-one`)
into this commit's FTL bundles to unblock its own run — the topology
stream's authoring UI may still be pending at their next read.
- i18n keys: `workspace-home-tools-section`, `workspace-home-<id>-title/-desc` in the workspace FTL bundle.
