import { describe, expect, it, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { LocalizationProvider, ReactLocalization } from '@fluent/react';
import type { ReactNode } from 'react';
import LiveSetupPreview from '@/features/setup/components/LiveSetupPreview';
import { registerAllFeatures } from '@/features';
import { getNavItems } from '@/registries/menu-registry';
import settingsFtl from '@/locales/settings.ftl?raw';

// The preview reads the PAGE REGISTRY, which the app populates at boot
// (App.tsx:8). A test that renders the component alone would see an empty
// registry and report "0 / 0 items unlocked" — passing while measuring nothing.
// Registering here is the same call the entry point makes; WorkspaceHomeTools
// tests already follow this pattern.
beforeAll(() => {
  registerAllFeatures();
});

function FluentWrapper({ children }: { children: ReactNode }) {
  const bundle = new FluentBundle('en-US');
  bundle.addResource(new FluentResource(settingsFtl));
  const l10n = new ReactLocalization([bundle]);
  return <LocalizationProvider l10n={l10n}>{children}</LocalizationProvider>;
}

describe('LiveSetupPreview', () => {
  // ── Empty features ─────────────────────────────────────────────

  it('counts nav items from the registry, so the denominator cannot drift', () => {
    // The preview used to keep its own table of 34 {route,label,feature} rows and
    // render "X / 34 items unlocked". Measured 2026-09-23 that table was missing
    // NINE registered routes, so the denominator under-reported what a feature set
    // unlocks. It now reads the menu registry — the same call the real sidebar
    // makes (AppLayout.tsx:118) — so this asserts the two cannot disagree.
    render(<LiveSetupPreview selectedFeatures={new Set()} />, { wrapper: FluentWrapper });

    // The set the SIDEBAR would render for an owner, dev pages excluded.
    const sidebar = getNavItems(new Set(), 'owner').filter((i) => i.section !== 'dev');
    expect(sidebar.length).toBeGreaterThan(20);

    // The denominator the component computes is every item the role can reach with
    // ALL features on — never a hardcoded figure.
    const total = getNavItems(undefined, 'owner').filter((i) => i.section !== 'dev').length;
    // Fluent wraps each interpolated number in bidi ISOLATE marks (U+2068/U+2069),
    // so match on the element's normalised text rather than the raw string.
    const rendered = document.querySelector('.lsp-nav-count')!.textContent!.replace(/[\u2068\u2069]/g, '');
    expect(rendered).toBe(`${sidebar.length} / ${total} items unlocked`);
  });
  it('renders title and sections', () => {
    render(<LiveSetupPreview selectedFeatures={new Set()} />, {
      wrapper: FluentWrapper,
    });

    expect(screen.getByText('Feature Preview')).toBeInTheDocument();
    expect(screen.getByText('Workspaces')).toBeInTheDocument();
    expect(screen.getByText('Navigation Items')).toBeInTheDocument();
  });

  it('shows only admin workspace as active when no features are enabled', () => {
    render(<LiveSetupPreview selectedFeatures={new Set()} />, {
      wrapper: FluentWrapper,
    });

    // Admin is always active.
    expect(screen.getByText('Admin')).toBeInTheDocument();

    // Other workspaces should exist in the DOM but be visually dimmed.
    expect(screen.getByText('Restaurant POS')).toBeInTheDocument();
    expect(screen.getByText('Store POS')).toBeInTheDocument();
    expect(screen.getByText('Kitchen Display')).toBeInTheDocument();

    // The warehouse workspace. Its FTL label is 'Warehouse' — this assertion used
    // to read 'Inventory' and passed only because the hand-maintained nav table
    // happened to contain an invented 'Inventory' chip. With the nav list coming
    // from the registry (which has no such route) the label is unambiguous.
    expect(screen.getByText('Warehouse')).toBeInTheDocument();
  });

  it('shows only always-available nav items when no features enabled', () => {
    render(<LiveSetupPreview selectedFeatures={new Set()} />, {
      wrapper: FluentWrapper,
    });

    // The nav chips now come from the MENU REGISTRY, so this asserts the contract
    // rather than a hand-listed set: with no features on, whatever is ungated AND
    // not role-gated is exactly what the real sidebar would show.
    const ungated = getNavItems(new Set()).filter((i) => i.section !== 'dev');
    for (const item of ungated) {
      expect(screen.getByText(item.label)).toBeInTheDocument();
    }
    // A concrete member, so the loop above cannot pass vacuously on an empty list.
    expect(ungated.length).toBeGreaterThan(0);
    expect(screen.getByText('Products')).toBeInTheDocument();

    // Feature-gated items should NOT be shown. 'POS Terminal' is the registry's
    // label for the route the old table called 'POS'.
    expect(screen.queryByText('POS Terminal')).not.toBeInTheDocument();
    expect(screen.queryByText('KDS')).not.toBeInTheDocument();
    expect(screen.queryByText('Tables')).not.toBeInTheDocument();
  });

  // ── Simple Retail features ──────────────────────────────────────

  it('shows Store POS workspace active with simple-retail feature', () => {
    render(
      <LiveSetupPreview selectedFeatures={new Set(['simple-retail'])} />,
      { wrapper: FluentWrapper },
    );

    // Store POS should be rendered (we check for its label text via FTL)
    expect(screen.getByText('Store POS')).toBeInTheDocument();
  });

  it('shows POS navigation items with simple-retail feature', () => {
    render(
      <LiveSetupPreview selectedFeatures={new Set(['simple-retail'])} />,
      { wrapper: FluentWrapper },
    );

    // Registry labels, not the old table's abbreviations: 'POS Terminal' is the
    // label registerPage gives route 'pos'.
    expect(screen.getByText('POS Terminal')).toBeInTheDocument();
    expect(screen.getByText('Products')).toBeInTheDocument();
    expect(screen.getByText('Sales History')).toBeInTheDocument();
    // getAllByText: the registry holds TWO routes labelled 'Dashboard' —
    // 'sales-dashboard' (simple-retail gated) and 'dashboard' (ungated, manager).
    // The hand-maintained table had only the first, so a getByText passed there.
    expect(screen.getAllByText('Dashboard').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Orders')).toBeInTheDocument();

    // KDS should NOT be shown without kitchen-display
    expect(screen.queryByText('KDS')).not.toBeInTheDocument();
  });

  // ── Restaurant features ─────────────────────────────────────────

  it('shows Restaurant POS workspace active with restaurant feature', () => {
    render(
      <LiveSetupPreview selectedFeatures={new Set(['restaurant'])} />,
      { wrapper: FluentWrapper },
    );

    expect(screen.getByText('Restaurant POS')).toBeInTheDocument();
    // 'Tables' was an invented nav chip: no registerPage call creates that route.
    // The real restaurant-gated items are Menu Engineering and the Expo screen.
    expect(screen.getByText('Menu Engineering')).toBeInTheDocument();
  });

  // ── KDS features ────────────────────────────────────────────────

  it('shows KDS workspace active with kitchen-display feature', () => {
    render(
      <LiveSetupPreview
        selectedFeatures={new Set(['restaurant', 'kitchen-display'])}
      />,
      { wrapper: FluentWrapper },
    );

    expect(screen.getByText('KDS')).toBeInTheDocument();
    expect(screen.getByText('Kitchen Display')).toBeInTheDocument();
  });

  // ── Inventory features ──────────────────────────────────────────

  it('shows Warehouse workspace and inventory nav items with inventory-tracking', () => {
    render(
      <LiveSetupPreview
        selectedFeatures={new Set(['inventory-tracking', 'stock-counting', 'stock-transfers'])}
      />,
      { wrapper: FluentWrapper },
    );

    // 'Warehouse' appears in the workspace chip; inventory nav chips follow.
    expect(screen.getAllByText('Warehouse').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Stock Counts')).toBeInTheDocument();
    expect(screen.getByText('Stock Transfers')).toBeInTheDocument();
  });

  // ── Multi-store features ────────────────────────────────────────

  it('shows Locations nav item with multi-store feature', () => {
    render(
      <LiveSetupPreview selectedFeatures={new Set(['multi-store'])} />,
      { wrapper: FluentWrapper },
    );

    expect(screen.getByText('Locations')).toBeInTheDocument();
  });

  // ── Combined features ───────────────────────────────────────────

  it('shows multiple workspaces with combined features', () => {
    render(
      <LiveSetupPreview
        selectedFeatures={
          new Set(['simple-retail', 'inventory-tracking', 'kitchen-display'])
        }
      />,
      { wrapper: FluentWrapper },
    );

    // All non-admin workspaces should be present.
    expect(screen.getByText('Store POS')).toBeInTheDocument();
    expect(screen.getByText('Kitchen Display')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    // The warehouse workspace. 'Inventory' was the invented nav chip's label, so
    // this now names the workspace the assertion is actually about.
    expect(screen.getByText('Warehouse')).toBeInTheDocument();
  });

  // ── All features ────────────────────────────────────────────────

  it('shows all nav items when all features are enabled', () => {
    const allFeatures = new Set([
      'simple-retail',
      'restaurant',
      'kitchen-display',
      'self-service-kiosk',
      'inventory-tracking',
      'categories-enabled',
      'stock-counting',
      'stock-transfers',
      'purchase-orders',
      'gift-cards',
      'tax-engine',
      'multi-store',
      // 'Tables' is gated on this, not on 'restaurant': registerPage for route
      // 'tables' carries feature 'table-management'.
      'table-management',
    ]);

    render(
      <LiveSetupPreview selectedFeatures={allFeatures} />,
      { wrapper: FluentWrapper },
    );

    // All 5 workspaces should be visible.
    expect(screen.getByText('Restaurant POS')).toBeInTheDocument();
    expect(screen.getByText('Store POS')).toBeInTheDocument();
    expect(screen.getByText('Kitchen Display')).toBeInTheDocument();
    expect(screen.getByText('Warehouse')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();

    // Verify some feature-gated nav items, by the labels the NAV BAR actually
    // shows. These come from each registerPage call: the preview used to keep its
    // own invented short labels ('POS' for 'POS Terminal'), which is part of how
    // the table drifted from the registry it duplicated.
    expect(screen.getByText('POS Terminal')).toBeInTheDocument();
    expect(screen.getByText('KDS')).toBeInTheDocument();
    expect(screen.getByText('Tables')).toBeInTheDocument();
    expect(screen.getByText('Kiosk')).toBeInTheDocument();
    expect(screen.getByText('Gift Cards')).toBeInTheDocument();
    expect(screen.getByText('Locations')).toBeInTheDocument();
    expect(screen.getByText('Tax Rates')).toBeInTheDocument();

    // No navigation-empty message when items exist.
    expect(
      screen.queryByText('No navigation items unlocked'),
    ).not.toBeInTheDocument();
  });
});
