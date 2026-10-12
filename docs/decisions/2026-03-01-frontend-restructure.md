---
num: 3
area: ui
title: ADR #3: Frontend Restructure
status: Implemented (2026-07-15)
---

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (2 minor, 1 major) · Full re-audit; the 2026-09-29 and 2026-07-22 stamps are merged at the bottom as original evidence. · MAJOR (as a class): the Implementation Summary is a status page for a restructure that kept moving, and four of its coordinates are now wrong — the tablet entry point is `ui/src/main.mobile.tsx` (not `main.tablet.tsx`), per-module locales are `shared-ui/locales/` (not `ui/src/locales/`, which does not exist), the `frontend/{shell,shared,themes}` roots do not exist (the implemented homes are `ui/src/app/`, `ui/src/components/`, `ui/src/theme/`), and the registries are at `ui/src/registries/{page,menu,widget}-registry/index.ts` — the location the 2026-07-22 stamp "corrected" to `ui/src/platform/ui/` has itself since become wrong, the second such move this file has recorded. The two single-token path errors (`main.tablet.tsx`, `ui/src/locales/`) were repaired in place; the rest is stated in a correction note directly above the **Deferred** paragraph rather than rewritten into the decision sections, because an ADR says what was decided and the decision (registry-driven shell, deferred module-owned `ui/`) has not changed. · ALSO MEASURED: registration volume is 115 `registerPage(` / 53 `registerNavItem(` / 25 `registerWidget(` calls across `ui/src` — well past the "30+" the summary states, which stays true and understated. · VERIFIED UNCHANGED: `registerPage`/`getEnabledPages` (`ui/src/registries/page-registry/index.ts:102/147`) and `registerNavItem`/`getNavItems` (`ui/src/registries/menu-registry/index.ts:83/94`) exist with those names; the `SectionName` union has exactly the 10 sections the summary says `getNavItems` is "with"; `registerWidget`/`getWidgets` exist; `App.tsx` and `main.mobile.tsx` both call `registerAllFeatures()`; the four theme files exist; and three of the four named shell components exist (`AppShell`/`AppLayout` at `ui/src/app/`, `TabletAppShell`/`TabletAppLayout` at `ui/src/app/tablet/`). · DEAD REFERENCE: the Related list cites `RESTRUCTURING.md` for Phase 4; no such file exists tracked or on disk (confirmed via `git ls-files`), so it is struck through with the reason kept, matching ADR #1 and #2. · Repaired against branch 0.0.41 at ea89612c3. -->

<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — superseded bodies kept verbatim as original evidence:

<!-- Superseded audit marker (2026-07-22, body kept verbatim) · Hermes-Agent · status: ACCURATE (1 minor path note) · frontend/shell, frontend/shared, frontend/themes (tokens.css, components.css, reset.css, responsive.css) all exist; App.tsx uses registerPage/registerNavItem · note: registries actually live at ui/src/platform/ui/{page,menu,widget}-registry, not frontend/shell/ as Section 1 implies (path drift, not a logic error); 15 shared components + 3 registries match the description · Status "Implemented (2026-07-15)" consistent -->

<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · ⚠️ THE PRIOR AUDIT'S OWN PATH NOTE HAS ITSELF DRIFTED, and that is the finding here. The 2026-07-22 stamp records "registries actually live at ui/src/platform/ui/{page,menu,widget}-registry, not frontend/shell/ as Section 1 implies". Those directories do not exist. The registries are now at `ui/src/registries/page-registry/index.ts` and `ui/src/registries/menu-registry/index.ts`, with `ui/src/registries/` as the root. So the correction written into this file's evidence has been overtaken by a second move, and a reader who followed the note would now land in the wrong place — the same failure mode as the stale `tokens.css` path recorded in three other documents in this campaign, and the reason such notes are worth re-measuring rather than trusted. · The rest of the prior verification holds: the `frontend/shell`, `frontend/shared` and `frontend/themes` roots exist, `App.tsx` still uses `registerPage`/`registerNavItem`, and the shared components and three registries match the description. Status "Implemented (2026-07-15)" is consistent with the front matter, and the ADR status checker reports no drift for this row. · Body left as written, including Section 1's description of where registries live: this is the record of the restructure as decided, and an ADR's job is to say what was decided, not where everything ended up. The registries and `tokens.css` both moved after the decision; correcting the body would turn a decision record into a status page. · The 2026-07-22 Hermes stamp is retained as the original evidence, re-labelled rather than superseded, and the two stacked `> status: ACCURATE` lines under the old footer are collapsed to one machine-read line. -->
-->

# ADR #3: Frontend Restructure

**Status:** Implemented (2026-07-15)
**Date:** 2026-03-01
**Author:** Architecture Team
**Tags:** architecture, frontend, ui, registries

---

## Implementation Summary

The registry-driven shell architecture is fully implemented. The four migration steps
are complete:

1. **`frontend/shell/`** — `AppShell`, `AppLayout`, `TabletAppShell`, `TabletAppLayout`,
   registry-driven routing with `type_key`-based component dispatch.
2. **`frontend/shared/`** — 15 shared components (Badge, Button, Card, EmptyState,
   ErrorState, Input, Localized, Modal, PermissionDenied, Skeleton, Spinner, Toast, useSound).
3. **`frontend/themes/`** — `tokens.css`, `components.css`, `reset.css`, `responsive.css`.
4. **Registries** — `PageRegistry` (`registerPage`, `getEnabledPages`), `MenuRegistry`
   (`registerNavItem`, `getNavItems` with 10 sections), `WidgetRegistry` (`registerWidget`,
   `getWidgets`). All three support feature-toggle and role-based filtering.

Both `App.tsx` (desktop) and `main.mobile.tsx` (tablet) use the registries — 30+ page
registrations and nav items are declared via `registerPage()`/`registerNavItem()` calls
rather than a hardcoded switch statement.

> **Correction (11-10-26, docs-auditor).** Two coordinates above are stale and one claim needs reading carefully:
> - The tablet entry point is `ui/src/main.mobile.tsx`, not `main.tablet.tsx` (it imports `@/app/tablet/TabletAppShell` and calls `registerAllFeatures()`); the old name was corrected in place.
> - Per-module locales live in `shared-ui/locales/`, not `ui/src/locales/` (which does not exist); corrected in place in the **Deferred** paragraph too.
> - The `frontend/shell`, `frontend/shared` and `frontend/themes` roots do **not** exist at the paths Section 1 names. The implemented homes are `ui/src/app/` (AppShell, AppLayout, `tablet/TabletAppShell`, `tablet/TabletAppLayout`), `ui/src/components/` (71 files) and `ui/src/theme/` (`tokens.css`, `components.css`, `reset.css`, `responsive.css`, plus `fonts.css`). Section 1's wording is the restructure *as decided* and is left as the record; the paths under "Migration Plan" below say `frontend/…` for the same reason.
> - Registration is **much** larger than "30+": 115 `registerPage(` calls across 40 files, 53 `registerNavItem(` calls across 33 files, and 25 `registerWidget(` calls across 4 files, all under `ui/src`. The "30+" remains true, just heavily understated.
> - The registries live at `ui/src/registries/{page,menu,widget}-registry/index.ts` — not `ui/src/platform/ui/` as the 2026-07-22 stamp corrected it to, and not `frontend/shell/`. See the 2026-09-29 stamp for that two-move history.

**Deferred:** Module-owned `ui/` directories (`modules/<name>/ui/`). Features live in
`ui/src/features/` as a flat directory. Per-module locales live in `shared-ui/locales/`.
Moving files into module-owned directories would be a large, mechanical reorganization
that provides no architectural benefit beyond what the registries already deliver —
modules are already decoupled from the shell via the registry pattern.

---

## Context

The original kasir.mu frontend in `ui/src/` had a flat structure where all features, components, API calls, and styles lived in top-level directories. The primary goals were:

- Replace the hardcoded navigation, routing, and menu structures in `App.tsx`.
- Extract shared components into `frontend/shared/`.
- Extract theming into `frontend/themes/`.
- Shell (`frontend/shell/`) is registry-driven — pages, menus, and widgets are registered declaratively.

The aspirational goal of module-owned `ui/` directories (`modules/<name>/ui/`)
was deferred — see Implementation Summary above.

The target directory structure is:

```
frontend/
├── shell/         App host (layout, sidebar, routing)
├── shared/        Reusable UI components
├── desktop/       Desktop-specific layouts
├── tablet/        Tablet-specific layouts
├── widgets/       Dashboard widget framework
└── themes/        Branding and theming
```

```
modules/sales/ui/
├── pages/         Full-page routes (SaleScreen, HistoryScreen)
├── components/    Module-specific components (CartLine, PaymentModal)
└── widgets/       Dashboard widgets (DailySalesWidget)
```

---

## Decision

### 1. Registry-Based Shell

The `frontend/shell/` crate replaces the hardcoded routing and navigation in `App.tsx` with registries:

- **PageRegistry** — Modules register page components with a route path.
  ```typescript
  registry.registerPage('/sales', () => <SaleScreen />);
  registry.registerPage('/sales/history', () => <HistoryScreen />);
  ```

- **MenuRegistry** — Modules register nav items with ordering.
  ```typescript
  registry.registerMenuItem({ id: 'sales', label: 'Sales', icon: CartIcon, order: 10 });
  ```

- **WidgetRegistry** — Modules register dashboard widgets.
  ```typescript
  registry.registerWidget({ id: 'daily-sales', component: DailySalesWidget, order: 0 });
  ```

The shell reads from these registries at render time. `App.tsx` becomes a thin orchestrator:

```typescript
function App() {
  const pages = usePageRegistry();
  const menuItems = useMenuRegistry();

  return (
    <AppShell menuItems={menuItems}>
      <Router pages={pages} />
    </AppShell>
  );
}
```

### 2. Module-Owned Frontend

Every backend module has a corresponding `ui/` directory containing its frontend code:

```
modules/sales/
├── src/                     # Rust backend
├── migrations/              # SQL migrations
└── ui/                      # Frontend
    ├── pages/               # Page components registered with shell
    ├── components/          # Module-specific components
    ├── locales/             # Module-specific Fluent .ftl files
    ├── hooks/               # Module-specific React hooks
    └── index.ts             # Module entry point (registers pages, menus, widgets)
```

The `modules/sales/ui/index.ts` entry point:

```typescript
import { registry } from 'frontend/shell';
import SaleScreen from './pages/SaleScreen';
import HistoryScreen from './pages/HistoryScreen';
import DailySalesWidget from './widgets/DailySalesWidget';

export function register() {
  registry.registerPage('/sales', SaleScreen);
  registry.registerPage('/sales/history', HistoryScreen);
  registry.registerWidget('daily-sales', DailySalesWidget);
}
```

### 3. Shared Components in `frontend/shared/`

Components used by multiple modules move to `frontend/shared/`:

- `Button`, `Card`, `Badge`, `Modal`, `Input`, `Spinner`, `Toast`, `EmptyState`, `ErrorState`
- `DataTable`, `SearchBar`, `ConfirmDialog`, `PageHeader`

Existing components in `ui/src/components/` are the source; they are migrated during Phase 4.

### 4. Theming in `frontend/themes/`

All design tokens and CSS live in `frontend/themes/`:

- `tokens.css` — Design tokens (colors, spacing, typography, breakpoints).
- `components.css` — Component-specific styles.
- `reset.css` — CSS reset.

Extracted from the current `ui/src/styles/` directory.

### 5. Per-Module Locale Files

Each module's `ui/locales/` directory contains its own Fluent `.ftl` files. The existing domain `.ftl` files (created in Phase 1.4) are the source — they move alongside their respective module during module extraction.

---

## Options Considered

### Option A — Registry-Based Shell with Dynamic Registration (Chosen)

- **Pro:** Fully decoupled — modules can be added/removed without touching the shell.
- **Pro:** Feature toggles directly control which registrations are active.
- **Pro:** Multiple app shells (desktop, tablet) can register different page sets.
- **Con:** Startup requires all modules to register before rendering.
- **Mitigation:** Registration is synchronous and fast (O(n) in modules).

### Option B — Lazy Routes with Static Imports (Rejected)

Modules export route config arrays that are statically imported in `App.tsx`.

```typescript
import { salesRoutes } from '@/features/sales/routes';
```

- **Pro:** Simple, no registry infrastructure needed.
- **Con:** `App.tsx` must be edited every time a module is added/removed.
- **Con:** Feature toggles require conditional logic in `App.tsx` rather than being data-driven.

### Option C — Micro-Frontend (Rejected)

Each module is a separately-built micro-frontend, composed at runtime.

- **Pro:** Independent build, deploy, and versioning per module.
- **Con:** Massive overhead for a local POS application (build tooling, shared dependency management, cross-module communication).
- **Con:** Tauri's single-window model does not benefit from micro-frontend isolation.

### Option D — File-System Based Routing (Deferred)

Routes derived from the file system (like Next.js pages router).

- **Pro:** Zero-config routing, familiar pattern.
- **Con:** Ties routing to file system structure, which conflicts with the module-owned UI structure.
- **Con:** Loses the flexibility of runtime registration based on feature toggles.

---

## Consequences

### Positive

- Modules are self-contained — a module can be fully removed by deleting one directory.
- The shell is thin and framework-agnostic — registries are plain TypeScript.
- Multiple app targets (desktop, tablet) can register different page sets from the same modules.
- Feature toggles naturally filter registrations — disabled features never render.

### Negative

- Registry lookups add a tiny overhead on every render (solved with memoization).
- The shell must wait for all modules to register before first render.
- Shared components need clear ownership — "shared" can become a dumping ground.

### Mitigations

- Registration is synchronous and completes before React hydration.
- Shared component ownership is enforced by code review — a component belongs in a module unless at least 3 modules use it.
- The widget framework is optional — modules that don't need dashboards simply don't register widgets.

---

## Migration Plan

All four steps are complete (2026-07-15):

1. ✅ **Extract `frontend/shell/`** — `AppLayout`, `AppShell`, `TabletAppShell`, `TabletAppLayout`.
2. ✅ **Extract `frontend/shared/`** — 15 shared components.
3. ✅ **Extract `frontend/themes/`** — `tokens.css`, `components.css`, `reset.css`, `responsive.css`.
4. ✅ **Build registries** — PageRegistry, MenuRegistry, WidgetRegistry. `App.tsx` uses `registerPage()`/`registerNavItem()` instead of a hardcoded switch.

Module-owned `ui/` directories (`modules/<name>/ui/`) were deferred — the registries provide
the same decoupling without reorganizing 30 feature directories.

---

## Related

- `ARCHITECTURE.md` — Target architecture (Frontend section, Repository Structure)
- ~~`RESTRUCTURING.md`~~ — Phase 4: Frontend Infrastructure \*(dead pointer: no such file exists in the repository, tracked or on disk; noted 11-10-26 by docs-auditor, kept so the reference is not silently erased)\*
- ADR #1 — Module System Design (modules own backend AND frontend)

> last audited 11-10-26 by docs-auditor
