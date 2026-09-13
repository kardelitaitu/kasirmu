# Orchestrator Agent 3: Station UI, Modifier Badges & Expo Screen

**Document:** `todo-kds-agents-3.md`  
**Role:** Orchestrator Agent 3 (Kitchen UI & Expo Experience Architect)  
**Goal:** Build the dedicated Kitchen Station views and the Expediter (Expo) screen with multi-course consolidation, modifier badges (e.g. "NO ONIONS", "EXTRA CHEESE"), and priority VIP highlight tags.

**Target File:** `ui/src/features/kds/`  
**Sibling Documents:**
- [`todo-kds-agents-1.md`](./todo-kds-agents-1.md) (Agent 1 — Multi-Station KDS Routing Engine)
- [`todo-kds-agents-2.md`](./todo-kds-agents-2.md) (Agent 2 — LAN Order Event Dispatcher & State Sync)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `feat(kds-ui): ...`
2. **Owned Path Fence (Exclusive to Agent 3):**
   - `ui/src/features/kds/ExpoScreen.tsx` (NEW)
   - `ui/src/features/kds/components/ModifierBadge.tsx` (NEW)
   - `ui/src/features/kds/components/StationSelectorModal.tsx` (NEW)
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit backend routing rules (Owned by Agent 1).
   - DO NOT edit network transport (Owned by Agent 2).

---

## 📋 Task Checklist

### Phase 3.0: Baseline Audit
- [x] Inspect existing `KdsScreen.tsx` and design language CSS.

### Phase 3.1: Build Modifier Badges & Course Groups
- [x] Create `<ModifierBadge />` highlighting special instructions with red/green contrast badges.
- [x] Group order items by kitchen course (Appetizers, Mains, Desserts).
  - ⚠ STAMP: course grouping ALREADY EXISTED on the ticket card (`groupByCourse` +
    `COURSE_ORDER` + per-course collapse headers in `components/KdsTicketCard.tsx`,
    covered by `KdsTicketCardGroupByCourse.test.ts`). This pass verified it, surfaced
    the same groups on the Expo screen (which renders `KdsTicketCard`), and replaced
    only the raw modifier bullet rows with the new badges. Nothing was re-implemented.
- [x] Verify: `npm run typecheck` → zero `features/kds` errors (foreign reds live in
  `src/dev-mock/**` — a sibling session's in-flight zone — and were left untouched).
- [x] **Commit Milestone:** `67b2849ddc feat(kds-ui): implement modifier badges and course grouping on KDS tickets`
  - Fence note: badge integration necessarily edited `components/KdsTicketCard.tsx`
    (the file that renders ticket modifiers) and removed the two orphaned
    `.kds-ticket-modifier-row` rules from `KdsScreen.css` to keep the dead-class scan
    clean. Both paths are inside the Agent-3 directory fence (`ui/src/features/kds/**`).

### Phase 3.2: Build Dedicated Expo Screen (`ExpoScreen.tsx`)
- [x] Create `ExpoScreen.tsx` providing an aggregated bird's-eye view of all prep stations.
  - Station columns are the board's `kitchen_zone` partition (`groupByStation`);
    registration is the lazy page + nav pair in `register.tsx` (route `kds-expo`,
    nav key `nav-kds-expo`, section `operations`, feature gate `kitchen-display`).
- [x] Highlight tickets when all individual prep stations have bumped their items ("Ready to Serve").
  - Ticket-level `status === 'ready'` is the existing encoding of "kitchen is up":
    green ring on the ticket slot + a polite `role="status"` pass strip + the per
    station `n/m up` pill. Serve (ready → served) is the expediter's action on the
    shared forward-only ladder (`nextKdsStatus`).
- [x] Include recall history modal to recover mistakenly bumped tickets within 15 minutes.
  - ⚠ STAMP — what the existing commands CAN do: the modal lists tickets still in
    `served` status whose `served_at` falls inside the 15-minute window
    (`list_kds_orders_scoped` unfiltered, one call per poll), newest first, and the
    "Bring back" button calls `update_kds_status_scoped(id, 'ready')`.
  - ⚠ STAMP — what needs backend support and is therefore NOT delivered:
    1. a true per-bump *history* (which station bumped which item when) has no read
       command in `ui/src/api/kds.ts` — a dedicated reopen/recall-audit endpoint is
       the missing capability (Agent 2's event work);
    2. the served → ready BACKWARD transition could not be verified against the Rust
       status ladder from the UI (no existing screen performs a reverse move — the
       Completed tab's "Reopen" only switches tabs). If the backend rejects it the
       operator sees the localized `kds-expo-recall-failed` banner and nothing else
       changes.
- [ ] Run pre-commit checks: `npm run check:all`.
  - ⚠ NOT RUN, deliberately: the orchestrator brief bans `check:all` for this task
    (Docker E2E). Replaced by: scoped vitest (77 kds-adjacent files, 1218 tests),
    `npx eslint` on every touched file (0 errors), `npm run typecheck` (0 kds errors),
    and the live pre-commit gates (bundle parity 0 missing, FTL dedupe, FTL orphans OK)
    on each milestone commit.
- [x] **Commit Milestone:** `687d87bb24 feat(kds-ui): build Expediter (Expo) screen with cross-station order consolidation`

### Phase 3.3 (brief): Dedicated Station View
- [x] `components/StationSelectorModal.tsx` — accessible radiogroup modal (All sentinel
  `''`, roving tabindex, focus trap, Escape) choosing which station the Expo board
  follows; options come from the live board's zones. ⚠ STAMP: a device-authoritative
  station list is not derivable from existing payloads (`KdsDevice.station_ids` holds
  topology ids, there is no zone↔device mapping command) — zone discovery is used until
  Agent 1's routing metadata lands.
- [x] Selection persists per user via `kdsStationPrefs.ts` (`oz-kds-expo-station-<userId>`,
  localStorage; deliberately NOT the shared `kds_zone` server preference, which drives
  the kitchen board's zone chips).
- [x] **Commit Milestone:** `bbb4402c42 feat(kds-ui): add station selector modal with per-user station focus on Expo`

---

## ✅ Closure record (2026-09-08)

- Strings added: 27 keys × both bundles (`kds.ftl` + `kds.id.ftl`), every one referenced
  by this feature's code (staged FTL-orphan gate passed on both commits). `nav-kds-expo`
  lives in `kds.ftl` (shared.ftl is outside this agent's fence; Fluent merges all bundles,
  and the parity script's nav-key surface globs the whole locale dir, so membership is
  bundle-agnostic — verified: `nav-kds` itself lives in shared.ftl).
- screenExtraction: new `ExpoScreen` entry (tsx + `ExpoScreen.css` +
  `StationSelectorModal.tsx` additionalTsx) landed in the same commits as the classes;
  the `KdsScreen` entry gained `ModifierBadge.{tsx,css}` and two
  `knownDynamicFragments` (`removal`/`addition` — ternary comparison strings inside the
  badge's className template, the documented category).
- Foreign observations (NOT touched, per fence): `screenExtraction` WorkspaceHome entry
  dead-class red introduced by `091ffe2e29 refactor(tools-ui)` before this work; ~15
  typecheck errors in `ui/src/dev-mock/**` from a sibling session's in-flight edits.
- No nav-count/route-pin tests broke: `WorkspaceHomeTools.navParity` asserts
  tools→nav (one direction); adding a nav item cannot redden it. No pinned count of
  pages/nav items exists for `kds` registrations.
- Polling posture: Expo refreshes via the existing `kds:orders-changed` push, a 5s
  `list_kds_orders_scoped` backstop, and a visibility-change refetch — it works fully
  under polling while Agent 2's LAN events land.
