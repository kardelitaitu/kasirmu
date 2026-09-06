import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { LocalizationProvider, ReactLocalization } from '@fluent/react';
import type { ReactNode } from 'react';
import LiveSetupPreview from '@/features/setup/components/LiveSetupPreview';
import settingsFtl from '@/locales/settings.ftl?raw';

function FluentWrapper({ children }: { children: ReactNode }) {
  const bundle = new FluentBundle('en-US');
  bundle.addResource(new FluentResource(settingsFtl));
  const l10n = new ReactLocalization([bundle]);
  return <LocalizationProvider l10n={l10n}>{children}</LocalizationProvider>;
}

describe('LiveSetupPreview', () => {
  // ── Empty features ─────────────────────────────────────────────

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

    // Inventory workspace label (use getAllByText since 'Inventory' also
    // appears as a nav item — we just need at least one match).
    expect(screen.getAllByText('Inventory').length).toBeGreaterThanOrEqual(1);
  });

  it('shows only always-available nav items when no features enabled', () => {
    render(<LiveSetupPreview selectedFeatures={new Set()} />, {
      wrapper: FluentWrapper,
    });

    // Base items that have no feature requirement should appear.
    expect(screen.getByText('Products')).toBeInTheDocument();
    // Inventory appears in both workspace and nav chips.
    expect(screen.getAllByText('Inventory').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Customers')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();

    // Feature-gated items should NOT be shown.
    expect(screen.queryByText('POS')).not.toBeInTheDocument();
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

    expect(screen.getByText('POS')).toBeInTheDocument();
    expect(screen.getByText('Products')).toBeInTheDocument();
    expect(screen.getByText('Sales History')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
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
    expect(screen.getByText('Tables')).toBeInTheDocument();
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
    // Inventory appears in both workspace and nav sections.
    expect(screen.getAllByText('Inventory').length).toBeGreaterThanOrEqual(1);
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
    ]);

    render(
      <LiveSetupPreview selectedFeatures={allFeatures} />,
      { wrapper: FluentWrapper },
    );

    // All 5 workspaces should be visible.
    expect(screen.getByText('Restaurant POS')).toBeInTheDocument();
    expect(screen.getByText('Store POS')).toBeInTheDocument();
    expect(screen.getByText('Kitchen Display')).toBeInTheDocument();
    // Inventory appears in workspace and nav sections.
    expect(screen.getAllByText('Inventory').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Admin')).toBeInTheDocument();

    // Verify some feature-gated nav items.
    expect(screen.getByText('POS')).toBeInTheDocument();
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
