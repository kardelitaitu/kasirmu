/**
 * Page Registry — modules register their screens here so App.tsx
 * can render them dynamically instead of a hardcoded switch.
 *
 * @example
 * ```tsx
 * import { registerPage } from '@/registries/page-registry';
 * import PosScreen from './PosScreen';
 *
 * registerPage({
 *   route: 'sales',
 *   component: PosScreen,
 *   label: 'POS Terminal',
 *   feature: 'simple-retail',
 * });
 * ```
 */

import type { ComponentType, LazyExoticComponent } from 'react';

// ── Types ──────────────────────────────────────────────────────────

/**
 * Role levels used for page access gating.
 * - 'manager'    — owner, admin, and manager only (Staff is checkout-only and
 *                  excluded; see the User Roles plan).
 * - 'management' — owner, admin, and manager only (analytics, taxonomy-0046).
 * - 'owner'      — owner only.
 */
export type RequiredRole = 'manager' | 'owner' | 'management';

/**
 * A page component may be a plain component or a `lazy()`-loaded
 * chunk (PERF-01 route-level code splitting). Render sites must wrap
 * the component in a `<Suspense>` boundary (see `LazyBoundary`).
 */
export type PageComponent =
  | ComponentType
  | LazyExoticComponent<ComponentType>;

/** A page registered with the dynamic routing system. */
export interface PageRegistration {
  /** Route name used for navigation (e.g. 'sales', 'products'). */
  route: string;
  /** The React component to render for this route (may be lazy). */
  component: PageComponent;
  /** Human-readable label for nav items. */
  label: string;
  /** Optional feature key that must be enabled for this page to appear. */
  feature?: string;
  /** Optional role required to access this page. 'manager' includes owner. */
  requiredRole?: RequiredRole;
  /**
   * Optional permission key required to access this page (0046 registry,
   * e.g. `analytics:view`). When set AND the session carries granted keys,
   * the permission check is authoritative (wildcard-aware); without
   * permission data (mocks/tests) it falls back to `requiredRole`.
   */
  requiredPermission?: string;
  /** Optional SVG icon element for nav items. */
  icon?: React.ReactNode;
  /** When true, the page renders fullscreen without sidebar or topbar. */
  fullscreen?: boolean;
}

// ── Registry ───────────────────────────────────────────────────────

const pages = new Map<string, PageRegistration>();

/**
 * Register a page with the registry. Duplicate route names will be
 * overwritten by the last registration (allows feature modules to
 * override defaults).
 */
export function registerPage(registration: PageRegistration): void {
  pages.set(registration.route, registration);
}

/**
 * Get a registered page by route name.
 * Returns undefined if no page is registered for the route.
 */
export function getPage(route: string): PageRegistration | undefined {
  return pages.get(route);
}

/**
 * Check whether a page is accessible by the given user role (and, when the
 * session carries granted keys, the page's required permission).
 * Returns true if the page has no gate, or the gate is satisfied.
 */
export function isPageAccessible(
  registration: PageRegistration | undefined,
  userRole: string | undefined,
  permissions?: string[],
): boolean {
  if (!registration) return true;
  return passesGate(
    registration.requiredRole,
    registration.requiredPermission,
    userRole,
    permissions,
  );
}

/**
 * Get all registered pages (in registration order).
 */
export function getAllPages(): PageRegistration[] {
  return Array.from(pages.values());
}

/**
 * Get pages that are enabled given the current feature set and user role.
 * If `enabledFeatures` is omitted, all pages are returned.
 * Role gating is fail-closed: an omitted `userRole` DENIES role-gated
 * pages (a gate with a required role is not satisfied by an unknown
 * user). Omit it only when no gated pages should be reachable.
 */
export function getEnabledPages(
  enabledFeatures?: Set<string>,
  userRole?: string,
  permissions?: string[],
): PageRegistration[] {
  return Array.from(pages.values()).filter((p) => {
    if (p.feature && enabledFeatures && !enabledFeatures.has(p.feature)) {
      return false;
    }
    return passesGate(p.requiredRole, p.requiredPermission, userRole, permissions);
  });
}

/**
 * Combined access gate: a registration with `requiredPermission` is
 * authoritative when the session carries granted keys (wildcard-aware,
 * mirroring the backend `has_permission`); without permission data it falls
 * back to `requiredRole`. Registrations with neither gate pass.
 */
export function passesGate(
  requiredRole: RequiredRole | undefined,
  requiredPermission: string | undefined,
  userRole: string | undefined,
  permissions: string[] | undefined,
): boolean {
  if (requiredPermission) {
    if (permissions !== undefined) {
      return hasGrantedPermission(permissions, requiredPermission);
    }
    return requiredRole ? hasRequiredRole(userRole, requiredRole) : true;
  }
  if (requiredRole) {
    return hasRequiredRole(userRole, requiredRole);
  }
  return true;
}

/**
 * Backend-mirroring permission check (platform-core `has_permission`):
 * exact key match, the global `*` wildcard, or a `<domain>:*` wildcard.
 * Never use a raw `Array.includes` on the granted keys — the Owner preset
 * grants `["*"]`.
 */
export function hasGrantedPermission(
  granted: string[] | undefined,
  required: string,
): boolean {
  if (!granted) return false;
  const domain = required.includes(':') ? required.split(':')[0]! : required;
  const wildcardDomain = `${domain}:*`;
  return granted.some((key) =>
    key === required || key === '*' || key === wildcardDomain
  );
}

/**
 * Check if the user's role satisfies a required role.
 * 'owner' satisfies 'manager' and 'owner'.
 * 'manager' satisfies 'manager' only.
 */
function hasRequiredRole(userRole: string | undefined, required: RequiredRole): boolean {
  if (!userRole) return false;
  const role = userRole.toLowerCase();
  const isOwner = role === 'owner' || role === 'role-owner';
  const isAdmin = isOwner || role === 'admin' || role === 'role-admin';
  const isManager = isAdmin || role === 'manager' || role === 'role-manager';

  if (required === 'owner') return isOwner;
  if (required === 'management') return isManager;
  return isManager;
}

/**
 * Clear all registrations (useful for testing).
 */
export function clearPages(): void {
  pages.clear();
}
