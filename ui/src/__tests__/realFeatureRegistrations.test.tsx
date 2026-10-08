// Real feature registrations, not synthetic ones.
//
// WHY THIS FILE EXISTS. AppShellFeatureGateRoute.test.tsx pins the pageDenied
// hazard against SYNTHETIC registrations and says so in its own header:
//   "Real feature registrations are NOT imported — they are lazy
//    (ui/src/features/*/register.tsx; 12 of those files carry feature: on
//    registerPage) ... Every page below is a SYNTHETIC registration of the same
//    shape, so real registration order / route-override behaviour is not
//    exercised."
// This file closes that one gap and nothing else. It does NOT re-pin the hazard
// (that is the other file's job) — it answers a narrower question the synthetic
// pages cannot: does the real registry, populated by the real register*
// functions, produce the shapes the gate logic assumes?
//
// It is a REGISTRY test, not a render test. No shell is mounted and no component
// renders: the claim is about what registerPage()/registerNavItem() put INTO the
// registries and what the pure readers then report. Keeping it at that layer is
// what makes it cheap and what keeps it honest about what it covers.
//
// The other three gaps the companion file lists are still open here, and are
// NOT addressed by this file: TabletAppShell's mirrored expression, the mocked
// getEnabledFeatures backend, and App.tsx not being mounted.

import { describe, it, expect, beforeEach } from 'vitest';
import { clearPages, getAllPages, getEnabledPages, getPage, isPageAccessible } from '@/registries/page-registry';
import { clearNavItems, getNavItems } from '@/registries/menu-registry';
import { registerCategoriesFeature } from '@/features/categories/register';
import { registerTaxFeature } from '@/features/tax/register';
import { registerKdsFeature } from '@/features/kds/register';
import { registerReportsFeature } from '@/features/reports/register';

beforeEach(() => {
  clearPages();
  clearNavItems();
});

describe('real registrations — what the shipped register* functions install', () => {
  it('categories/register.tsx installs its feature-gated page and nav row', () => {
    registerCategoriesFeature();
    const page = getPage('categories');
    expect(page).toBeDefined();
    expect(page!.feature).toBe('categories-enabled');
    // The nav row carries the SAME feature as the page — the property the gate
    // hazard depends on: nav filtering and route gating read one registration.
    const nav = getNavItems(undefined, 'manager').find((n) => n.route === 'categories');
    expect(nav?.feature).toBe('categories-enabled');
  });

  it('tax/register.tsx installs tax-config behind tax-engine', () => {
    registerTaxFeature();
    expect(getPage('tax-config')?.feature).toBe('tax-engine');
  });

  it('kds/register.tsx installs BOTH of its routes behind the one feature', () => {
    registerKdsFeature();
    // Two registerPage calls share 'kitchen-display'. A reader assuming one
    // page per feature would be wrong; this pins the real cardinality.
    expect(getPage('kds')?.feature).toBe('kitchen-display');
    expect(getPage('kds-expo')?.feature).toBe('kitchen-display');
  });

  it('reports/register.tsx mixes gated and ungated pages in one function', () => {
    registerReportsFeature();
    // Only menu-engineering carries a feature; the other four are role-gated
    // instead. This is the real mixture the synthetic suite models only singly.
    expect(getPage('menu-engineering')?.feature).toBe('restaurant');
    expect(getPage('dashboard')?.feature).toBeUndefined();
    expect(getPage('reports')?.feature).toBeUndefined();
  });

  it('several real features can coexist without route collisions', () => {
    // Registration ORDER is the thing the synthetic suite cannot exercise. Run
    // the real functions in a plausible boot order and assert every route kept
    // its own feature rather than being overwritten by a later registration.
    registerCategoriesFeature();
    registerTaxFeature();
    registerKdsFeature();
    registerReportsFeature();

    expect(getPage('categories')?.feature).toBe('categories-enabled');
    expect(getPage('tax-config')?.feature).toBe('tax-engine');
    expect(getPage('kds')?.feature).toBe('kitchen-display');
    expect(getPage('menu-engineering')?.feature).toBe('restaurant');

    // And registerPage is a Map keyed by route, so the count is exact: 1 + 1 + 2 + 5.
    expect(getAllPages()).toHaveLength(9);
  });

  it('re-registering the same real feature is idempotent, not additive', () => {
    registerCategoriesFeature();
    const once = getAllPages().length;
    registerCategoriesFeature();
    expect(getAllPages()).toHaveLength(once);
  });
});

describe('real registrations — the feature door is open on the render path', () => {
  // The companion file's hazard, re-read against REAL registrations. It is the
  // same finding, but stated on the shipped data rather than a synthetic page:
  // feature filters the NAV readers and is invisible to isPageAccessible.
  it('getEnabledPages honours the feature door', () => {
    registerCategoriesFeature();
    // NOTE the role argument, which an earlier version of this case omitted.
    // getEnabledPages is FAIL-CLOSED on role: with userRole undefined, a page
    // requiring 'manager' is denied even when its feature IS enabled, so
    // getEnabledPages(new Set(['categories-enabled'])) reads 0 — not because the
    // feature door failed, but because the role door did. Passing a real role
    // isolates the feature door, which is what this case is about.
    expect(getEnabledPages(new Set(), 'manager')).toHaveLength(0);
    expect(getEnabledPages(new Set(['categories-enabled']), 'manager')).toHaveLength(1);
    // The fail-closed behaviour itself, pinned so a reader does not rediscover it:
    expect(getEnabledPages(new Set(['categories-enabled']))).toHaveLength(0);
    expect(getEnabledPages(new Set(['categories-enabled']), 'cashier')).toHaveLength(0);
  });

  it('isPageAccessible does NOT consult the feature door', () => {
    registerCategoriesFeature();
    const page = getPage('categories')!;
    // Same registration, empty feature set. The role is satisfied, so it passes
    // regardless — which is the hazard, pinned here on a real page.
    expect(isPageAccessible(page, 'manager', undefined)).toBe(true);
  });

  it('nav still hides the row when the feature is off, so the two disagree', () => {
    registerCategoriesFeature();
    expect(getNavItems(undefined, 'manager').some((n) => n.route === 'categories')).toBe(true);
    expect(getNavItems(new Set(), 'manager').some((n) => n.route === 'categories')).toBe(false);
  });
});
