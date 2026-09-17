---
num: 31
area: module-system
title: ADR #31: Decentralized UI Feature Module Registration
status: Accepted (2026-07-24)
---
<!-- Audit stamp: 2026-07-24 · Hermes-Agent · status: ACTIVE · ADR #31: Decentralized UI Feature Module Registration -->

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

> last audited 09-08-26 by buffy
> audit: Phase 1 Core Architecture & API Docs Audit

> status: ACCURATE (0 findings) · verified accurate: cargo check passed, no structural orphans, no stale version headers

