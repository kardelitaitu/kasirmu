/**
 * Widget Registry — modules register dashboard widgets here so the
 * dashboard screen can render them dynamically.
 *
 * @example
 * ```tsx
 * import { registerWidget } from '@/platform/ui/widget-registry';
 * import SalesSummaryWidget from './SalesSummaryWidget';
 *
 * registerWidget({
 *   id: 'sales-summary',
 *   component: SalesSummaryWidget,
 *   title: 'Sales Summary',
 *   feature: 'simple-retail',
 *   requiredPermission: 'reports:export',
 * });
 *
 * // host
 * const user = useWidgetUser();
 * const visible = getWidgets(enabled, user);
 * const refused = getDeniedWidgets(enabled, user);
 * ```
 */

import type { ComponentType, LazyExoticComponent } from 'react';
import { passesGate, type RequiredRole } from '@/platform/ui/page-registry';
import { useAuth } from '@/contexts/AuthContext';

// ── Types ──────────────────────────────────────────────────────────

/** A widget component may be plain or `lazy()`-loaded (PERF-01). */
export type WidgetComponent =
  | ComponentType
  | LazyExoticComponent<ComponentType>;

/** A dashboard widget registered with the widget system. */
export interface WidgetRegistration {
  /** Unique widget identifier. */
  id: string;
  /** The React component to render (may be lazy). */
  component: WidgetComponent;
  /** Display title for the widget card. */
  title: string;
  /** Optional feature key that must be enabled for this widget to appear. */
  feature?: string;
  /** Optional grid width (in columns, default 1). */
  width?: 1 | 2 | 3;
  /** Optional grid height (in rows, default 1). */
  height?: 1 | 2;
  /** Optional role required to see this widget. 'manager' includes owner. */
  requiredRole?: RequiredRole;
  /**
   * Optional permission key required (0046 registry, e.g. `reports:export`).
   * Authoritative when the session carries granted keys; falls back to
   * `requiredRole` without them. Evaluated by `passesGate` — the SAME gate pages
   * (`page-registry:129`) and nav items (`menu-registry:103`) are filtered by,
   * so a widget is never gated by a second spelling of the rule.
   */
  requiredPermission?: string;
}

/** The widget's access requirement on its own, for a caller that has no
 *  registration in hand (a component checking itself). */
export type WidgetGate = Pick<WidgetRegistration, 'requiredRole' | 'requiredPermission'>;

/** The user a widget gate answers for. */
export interface WidgetUser {
  /**
   * The session's granted keys. `undefined` means the caller has NO session data
   * at all — which is not the same as `[]) (logged in, granted nothing) and does
   * not deny: see `passesGate` in page-registry for the page/menu precedent.
   */
  permissions: string[] | undefined;
  /** Display name of the active role, for a `requiredRole` fallback. */
  userRole: string | undefined;
}

// ── Registry ───────────────────────────────────────────────────────

const widgets = new Map<string, WidgetRegistration>();

/**
 * Register a widget. Duplicate IDs will be overwritten.
 */
export function registerWidget(registration: WidgetRegistration): void {
  widgets.set(registration.id, registration);
}

/**
 * Read the user widget gating answers for, without hard-requiring an
 * `<AuthProvider>`.
 *
 * `useAuth()` THROWS outside its provider, and a widget host renders its tiles
 * inside `<Suspense>`/`<LazyBoundary>` with no error boundary of its own, so a
 * throw here takes the whole page down (measured: five host tests). An absent
 * provider therefore reads as "no session data" (`permissions: undefined`), which
 * does not deny — the asymmetry `passesGate()` already documents for pages.
 * Production always mounts `AuthProvider` (`contexts/AppProviders.tsx:60`), so
 * this only fires in a harness; a logged-out session still grants `[]` and DOES
 * deny.
 */
export function useWidgetUser(): WidgetUser {
  try {
    // Not a conditional hook call: `useAuth()` runs exactly once per render and
    // its throw comes from the provider lookup AFTER its own `useContext`, so
    // hook order is identical on both paths. It is guarded because an absent
    // provider must degrade to "no session data", not take the page down.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { session } = useAuth();
    return {
      userRole: session?.role_name,
      permissions: session ? session.permissions : [],
    };
  } catch {
    return { userRole: undefined, permissions: undefined };
  }
}

/**
 * Check whether a widget (or a bare gate) is accessible to the given user.
 * Returns true when the registration carries no gate or the gate is satisfied.
 * Mirrors `isPageAccessible()`; the decision itself is `passesGate()`'s.
 */
export function isWidgetAccessible(
  gate: WidgetGate | undefined,
  user?: WidgetUser,
): boolean {
  return passesGate(
    gate?.requiredRole,
    gate?.requiredPermission,
    user?.userRole,
    user?.permissions,
  );
}

/** Feature gate: enabled, or no enabled-set supplied, means visible. */
function featureVisible(
  registration: WidgetRegistration,
  enabledFeatures?: Set<string>,
): boolean {
  if (!registration.feature) return true;
  if (!enabledFeatures) return true;
  return enabledFeatures.has(registration.feature);
}

/**
 * Get all registered widgets the user may SEE, filtered by enabled features and
 * by the same role/permission gate pages and nav items pass through.
 *
 * Role gating is fail-closed: an omitted `userRole` denies a role-gated widget.
 * A widget missing here is not necessarily gone — a host that owes the user an
 * explanation renders `getDeniedWidgets()` in the same slots.
 */
export function getWidgets(
  enabledFeatures?: Set<string>,
  user?: WidgetUser,
): WidgetRegistration[] {
  return Array.from(widgets.values()).filter(
    (w) => featureVisible(w, enabledFeatures) && isWidgetAccessible(w, user),
  );
}

/**
 * The visible-refusal half of the registry: widgets whose FEATURE is enabled but
 * whose access gate this user failed — exactly the complement of `getWidgets()`
 * over the feature-visible set. A dashboard renders these as a denied tile so a
 * removed permission never looks like a broken or deleted feature.
 */
export function getDeniedWidgets(
  enabledFeatures?: Set<string>,
  user?: WidgetUser,
): WidgetRegistration[] {
  return Array.from(widgets.values()).filter(
    (w) => featureVisible(w, enabledFeatures) && !isWidgetAccessible(w, user),
  );
}

/**
 * Clear all registrations (useful for testing).
 */
export function clearWidgets(): void {
  widgets.clear();
}
