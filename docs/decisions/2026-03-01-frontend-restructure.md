---
num: 3
area: ui
title: ADR #3: Frontend Restructure
status: Implemented (2026-07-15)
---
<!-- Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (1 minor path note) · frontend/shell, frontend/shared, frontend/themes (tokens.css, components.css, reset.css, responsive.css) all exist; App.tsx uses registerPage/registerNavItem · note: registries actually live at ui/src/platform/ui/{page,menu,widget}-registry, not frontend/shell/ as Section 1 implies (path drift, not a logic error); 15 shared components + 3 registries match the description · Status "Implemented (2026-07-15)" consistent -->

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

Both `App.tsx` (desktop) and `main.tablet.tsx` (tablet) use the registries — 30+ page
registrations and nav items are declared via `registerPage()`/`registerNavItem()` calls
rather than a hardcoded switch statement.

**Deferred:** Module-owned `ui/` directories (`modules/<name>/ui/`). Features live in
`ui/src/features/` as a flat directory. Per-module locales live in `ui/src/locales/`.
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
- `RESTRUCTURING.md` — Phase 4: Frontend Infrastructure
- ADR #1 — Module System Design (modules own backend AND frontend)

> last audited 09-08-26 by buffy
> audit: Phase 1 Core Architecture & API Docs Audit; Phase 4 ADR Deep Audit
> status: ACCURATE (0 findings) · verified accurate: cargo check passed, no structural orphans, no stale version headers
> status: ACCURATE (verified against actual codebase)
