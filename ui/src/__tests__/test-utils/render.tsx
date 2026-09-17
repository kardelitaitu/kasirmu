// ── Shared render helpers for tests ──────────────────────────────────
//
// Eliminates the repeated `wrap` + `withFluent` + `renderInAct` pattern
// found across 38+ test files. Each file previously had:
//
//   import { withFluent } from '@/locales/test-utils';
//   import { renderInAct } from '@/test-utils/renderInAct';
//   const wrap = (children: ReactNode) => withFluent(children, fooFtl, barFtl);
//   await renderInAct(wrap(<MyComponent />));
//
// Now reduced to:
//
//   import { renderWithFluent } from '@/__tests__/test-utils/render';
//   await renderWithFluent(<MyComponent />, fooFtl, barFtl);

import { type ReactNode, type ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import { withFluent } from '@/locales/test-utils';
import { ThemeProvider } from '@/app/ThemeProvider';
import { ZoomProvider } from '@/contexts/ZoomContext';
import { ToastProvider } from '@/components/Toast';
import { BrandProvider } from '@/contexts/BrandContext';

/**
 * Render a component wrapped with Fluent i18n bundles.
 *
 * Combines `withFluent` + `renderInAct` in one call. Accepts
 * any number of `.ftl?raw` strings — these are passed directly to
 * `withFluent(children, ...ftlContents)`.
 *
 * Uses `renderInAct` (async, wraps in `act()`) for components that
 * trigger state updates on mount. For simple renders use `renderFluentSync`.
 */
export async function renderWithFluent(
  ui: ReactElement,
  ...ftlContents: string[]
): Promise<RenderResult> {
  return renderInAct(withFluent(ui, ...ftlContents));
}

/**
 * Synchronous variant for components that don't trigger async state
 * updates on mount. Uses plain `render()` instead of `renderInAct()`.
 * Faster and avoids act() warnings for simple presentational components.
 */
export function renderWithFluentSync(
  ui: ReactElement,
  ...ftlContents: string[]
): RenderResult {
  return render(withFluent(ui, ...ftlContents));
}

// ── Provider-wrapped variants ─────────────────────────────────────
//
// For components that need ThemeProvider, ToastProvider, ZoomProvider,
// and Fluent i18n bundles. Exposes sync and async variants matching
// the renderWithFluent/renderWithFluentSync dual-API.

// eslint-disable-next-line react-refresh/only-export-components
const DefaultProviders = ({ children }: { children: ReactNode }) => (
  <BrandProvider>
    <ThemeProvider>
      <ToastProvider>
        <ZoomProvider>{children}</ZoomProvider>
      </ToastProvider>
    </ThemeProvider>
  </BrandProvider>
);

/**
 * Async variant — wraps with ThemeProvider, ToastProvider, ZoomProvider,
 * and Fluent i18n. Uses `renderInAct` internally for components that
 * trigger state updates on mount.
 */
export async function renderWithProviders(
  ui: ReactElement,
  ...ftlContents: string[]
): Promise<RenderResult> {
  return renderInAct(
    withFluent(
      <DefaultProviders>{ui}</DefaultProviders>,
      ...ftlContents,
    ),
  );
}

/**
 * Sync variant — same providers as renderWithProviders but uses plain
 * `render()` internally. Use for components that don't trigger async
 * state updates on mount.
 */
 
export function renderWithProvidersSync(
  ui: ReactElement,
  ...ftlContents: string[]
): RenderResult {
  return render(
    withFluent(
      <DefaultProviders>{ui}</DefaultProviders>,
      ...ftlContents,
    ),
  );
}

/**
 * Re-render a `renderWithProvidersSync`/`renderWithProviders` result with
 * the same provider stack (Theme/Toast/Zoom/Brand + Fluent). The raw
 * `result.rerender(ui)` from testing-library replaces the root element
 * WITHOUT the providers, so components that consume contexts (Toast, etc.)
 * would throw — this keeps the wrapper intact for prop-driven re-renders.
 */
export function rerenderWithProviders(
  result: RenderResult,
  ui: ReactElement,
  ...ftlContents: string[]
): void {
  result.rerender(
    withFluent(
      <DefaultProviders>{ui}</DefaultProviders>,
      ...ftlContents,
    ),
  );
}
