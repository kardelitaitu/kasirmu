---
num: 31
area: module-system
title: ADR #31: Decentralized UI Feature Module Registration
status: Accepted (2026-07-24)
---
<!-- Superseded audit marker (2026-07-24 · Hermes-Agent, body kept verbatim) · hermes · status: ACTIVE · ADR #31: Decentralized UI Feature Module Registration -->

<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · ACCURATE, and its mechanism is more load-bearing than the ADR's own framing suggests. The three registration functions it specifies are the registry layer this campaign has been re-measuring all session: `registerPage` at `ui/src/registries/page-registry/index.ts`, `registerNavItem` at `ui/src/registries/menu-registry/index.ts`, and `registerWidget` at `ui/src/registries/widget-registry/index.ts`. All three are live and centralised under `ui/src/registries/`. · A PATH FINDING THAT UPDATES THIS CAMPAIGN'S OWN RECORD. The 2026-07-24 Hermes stamp on this file (retained below, re-labelled) records the registries at `ui/src/platform/ui/{page,menu,widget}-registry` -- and in round 15 that location was found to be already stale, with the registries now at `ui/src/registries/`. So this file's prior stamp is one of the two in the repository documenting a location the tree has since left, and the current position is `ui/src/registries/`, as recorded there and here. It is a concrete illustration of why a stamp is a dated observation rather than a durable fact: the stamp was correct, and it is now wrong, and neither state is a defect in it. · The ADR's thesis also shows up in a document audited elsewhere in this campaign: the workspace-settings Phase 0a record describes screens that "register lazily (`lazy(...)` + `registerPage`/`registerNavItem` in `ui/src/features/*/register.tsx`)", which is this ADR's mechanism in use, and the project rule telling authors to grep for a screen name and its `route:` precisely because a registered screen leaves no static import is a direct consequence of decentralising registration this way. · Status checker reports no drift for this row. The prior stamp said "status: ACTIVE", a marker rather than a claim; the front matter says "Accepted (2026-07-24)" and the index agrees. Stacked footer collapsed; prior stamp retained as original evidence. -->
# ADR #31: Decentralized UI Feature Module Registration

**Status:** Accepted (2026-07-24)  
**Date:** 2026-07-24  
**Author:** Architecture Team  
**Tags:** architecture, ui, module-system, react, frontend  

---

## Context

In the kasir.mu React/TypeScript UI (`ui/src`), feature components live in modular directories under `ui/src/features/<feature>/` (e.g. `sales`, `inventory`, `customers`, `staff`, `reports`).

However, page and navigation registration was previously centralized inside `ui/src/App.tsx`. `App.tsx` imported over 35 screen components directly and contained ~40 sequential calls to `registerPage(...)` and `registerNavItem(...)`.

This monolithic pattern created several frontend maintenance friction points:
1. **App.tsx Bloat**: `App.tsx` grew to 250+ lines of imperative setup, coupling the root component to every individual screen in the application.
2. **Brittle Feature Addition**: Adding or modifying a feature required editing `App.tsx` directly rather than keeping all feature assets self-contained in `ui/src/features/<feature>/`.
3. **Violates Module Autonomy**: Features were not self-registering; `App.tsx` had to know exact screen export names, route keys, i18n keys, icons, required roles, and feature flags.

---

## Decision

We will execute **P2: Decentralized Feature Registration in `App.tsx`** by establishing a self-registration standard for all UI feature modules.

### 1. Feature Module Self-Registration Standard

Each feature directory under `ui/src/features/<feature>/` will export a `register()` function (or `register<Feature>()` function) from its `index.ts` (or `register.ts`) entry point.

The registration function encapsulates:
- All `registerPage()` calls for the feature's screens.
- All `registerNavItem()` calls for the feature's sidebar menu items.
- Any feature-specific widget registrations (e.g., `registerSalesWidgets()`).

```typescript
// ui/src/features/sales/index.ts
import { registerPage } from '@/platform/ui/page-registry';
import { registerNavItem } from '@/platform/ui/menu-registry';
import PosScreen from './PosScreen';
import SalesHistoryScreen from './SalesHistoryScreen';
// ...

export function registerSalesFeature() {
  registerPage({ route: 'sales', component: PosScreen, label: 'POS Terminal', feature: 'simple-retail' });
  registerNavItem({ route: 'sales', label: 'POS Terminal', feature: 'simple-retail', i18nKey: 'nav-pos-terminal', section: 'operations', icon: ... });
  // ...
}
```

### 2. Central Orchestration Entrypoint

A central orchestrator function `registerAllFeatures()` located in `ui/src/features/index.ts` will import and invoke the registration function for every feature domain.

```typescript
// ui/src/features/index.ts
import { registerSalesFeature } from './sales';
import { registerInventoryFeature } from './inventory';
// ...

export function registerAllFeatures() {
  registerSalesFeature();
  registerInventoryFeature();
  // ...
}
```

### 3. Clean Root Initialization in `App.tsx`

`App.tsx` will no longer import individual screen components or call `registerPage` / `registerNavItem` manually. It will simply import and call `registerAllFeatures()` before mounting the `AppShell`.

```typescript
// ui/src/App.tsx
import { registerAllFeatures } from '@/features';

// Initialize all UI features
registerAllFeatures();

export default function App() {
  return (
    <ThemeProvider>
      <BrandProvider>
        ...
        <AppShell />
      </BrandProvider>
    </ThemeProvider>
  );
}
```

---

## Consequences

### Positive
- **Modular Autonomy**: Feature screens, routes, menu items, and icons are co-located inside their feature directory.
- **Clean Root Component**: `App.tsx` is reduced from 250+ lines of imperative setup to a clean ~30-line shell provider wrapper.
- **Scalable Feature Addition**: Adding a new feature requires creating a `register()` function in `ui/src/features/<new-feature>/` and adding one line to `registerAllFeatures()`.

### Negative / Trade-offs
- One additional `index.ts` file per feature folder for exporting the `register()` function.

> last audited 29-09-26 by docs-auditor

