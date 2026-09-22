/**
 * LiveSetupPreview — real-time preview of which workspaces and
 * navigation items will be unlocked by the currently-selected features.
 *
 * Embedded in SetupWizard (Review step) and FeatureToggleScreen.
 */
import { useMemo } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { WorkspaceIcon as SharedWorkspaceIcon } from '@/components/WorkspaceIcon';
import './LiveSetupPreview.css';

// ── Workspace definitions ───────────────────────────────────────────

interface WorkspaceDef {
  key: string;
  i18nKey: string;
  colorClass: string;
  /** Feature keys that unlock this workspace (any match). */
  features: string[];
}

const WORKSPACES: WorkspaceDef[] = [
  {
    key: 'restaurant-pos',
    i18nKey: 'ws-preview-name-restaurant-pos',
    colorClass: 'lsp-ws--restaurant-pos',
    features: ['restaurant'],
  },
  {
    key: 'store-pos',
    i18nKey: 'ws-preview-name-store-pos',
    colorClass: 'lsp-ws--store-pos',
    features: ['simple-retail'],
  },
  {
    key: 'kds',
    i18nKey: 'ws-preview-name-kds',
    colorClass: 'lsp-ws--kds',
    features: ['kitchen-display'],
  },
  {
    key: 'warehouse',
    i18nKey: 'ws-preview-name-warehouse',
    colorClass: 'lsp-ws--warehouse',
    features: ['inventory-tracking'],
  },
  {
    key: 'admin',
    i18nKey: 'ws-preview-name-admin',
    colorClass: 'lsp-ws--admin',
    features: [], // always available
  },
];

// ── Known nav items ─────────────────────────────────────────────────

interface NavItemDef {
  route: string;
  label: string;
  feature?: string;
}

const KNOWN_NAV_ITEMS: NavItemDef[] = [
  { route: 'pos', label: 'POS', feature: 'simple-retail' },
  { route: 'kds', label: 'KDS', feature: 'kitchen-display' },
  { route: 'tables', label: 'Tables', feature: 'restaurant' },
  { route: 'kiosk', label: 'Kiosk', feature: 'self-service-kiosk' },
  { route: 'products', label: 'Products' },
  { route: 'categories', label: 'Categories', feature: 'categories-enabled' },
  { route: 'bundles', label: 'Bundles' },
  { route: 'inventory', label: 'Inventory' },
  { route: 'inventory-adjustment', label: 'Stock Adjust' },
  { route: 'stock-counts', label: 'Stock Counts', feature: 'stock-counting' },
  { route: 'stock-transfers', label: 'Stock Transfers', feature: 'stock-transfers' },
  { route: 'purchase-orders', label: 'Purchase Orders', feature: 'purchase-orders' },
  { route: 'suppliers', label: 'Suppliers', feature: 'purchase-orders' },
  { route: 'sales-history', label: 'Sales History', feature: 'simple-retail' },
  { route: 'sales-dashboard', label: 'Dashboard', feature: 'simple-retail' },
  { route: 'orders', label: 'Orders', feature: 'simple-retail' },
  { route: 'customers', label: 'Customers' },
  { route: 'gift-cards', label: 'Gift Cards', feature: 'gift-cards' },
  { route: 'loyalty', label: 'Loyalty' },
  { route: 'promotions', label: 'Promotions' },
  { route: 'reports', label: 'Sales Report' },
  { route: 'eod-report', label: 'EOD Report' },
  { route: 'inventory-report', label: 'Inventory Report' },
  { route: 'tax-config', label: 'Tax Rates', feature: 'tax-engine' },
  { route: 'exchange-rates', label: 'Exchange Rates' },
  { route: 'staff', label: 'Staff' },
  { route: 'shifts', label: 'Shifts' },
  { route: 'terminals', label: 'Terminals' },
  { route: 'locations', label: 'Locations', feature: 'multi-store' },
  { route: 'settings', label: 'Settings' },
  { route: 'features', label: 'Features' },
  { route: 'data-management', label: 'Data' },
  { route: 'audit-log', label: 'Audit Log' },
  { route: 'offline-queue', label: 'Offline Queue' },
];

// ── Workspace icons (inline SVGs) ───────────────────────────────────

function WorkspaceIcon({ wsKey }: { wsKey: string }) {
  return <SharedWorkspaceIcon wsKey={wsKey} />;
}

// ── Props ───────────────────────────────────────────────────────────

export interface LiveSetupPreviewProps {
  /** Set of feature keys that are currently enabled. */
  selectedFeatures: Set<string>;
}

// ── Component ───────────────────────────────────────────────────────

/** Real-time preview of which workspaces and navigation items are unlocked by the currently-selected feature set. */
export default function LiveSetupPreview({ selectedFeatures }: LiveSetupPreviewProps) {
  const { l10n } = useLocalization();

  // ── Compute active workspaces ──────────────────────────────────

  const activeWorkspaces = useMemo(
    () =>
      WORKSPACES.filter(
        (ws) => ws.features.length === 0 || ws.features.some((f) => selectedFeatures.has(f)),
      ),
    [selectedFeatures],
  );

  // ── Compute active nav items ───────────────────────────────────

  const activeNavItems = useMemo(
    () =>
      KNOWN_NAV_ITEMS.filter(
        (item) => !item.feature || selectedFeatures.has(item.feature),
      ),
    [selectedFeatures],
  );

  const totalNavItems = KNOWN_NAV_ITEMS.length;
  const unlockedCount = activeNavItems.length;

  return (
    <div className="lsp-root">
      <div className="lsp-header">
        <Localized id="lsp-title">
          <h3 className="lsp-title">Feature Preview</h3>
        </Localized>
        <Localized id="lsp-subtitle" vars={{ count: unlockedCount }}>
          <span className="lsp-subtitle" />
        </Localized>
      </div>

      {/* ── Workspaces section ────────────────────────────────── */}
      <div className="lsp-section">
        <Localized id="lsp-section-workspaces">
          <h4 className="lsp-section-title">Workspaces</h4>
        </Localized>
        <div className="lsp-workspace-list" role="group" aria-label={l10n.getString('lsp-workspaces-aria')}>
          {WORKSPACES.map((ws) => {
            const active = activeWorkspaces.includes(ws);
            return (
              <div
                key={ws.key}
                className={`lsp-ws-chip ${ws.colorClass}${active ? ' lsp-ws-chip--active' : ''}`}
                role="status"
                aria-label={l10n.getString(
                  active ? 'lsp-ws-status-active' : 'lsp-ws-status-inactive',
                  { name: l10n.getString(ws.i18nKey) },
                )}
              >
                <span className="lsp-ws-icon">
                  <WorkspaceIcon wsKey={ws.key} />
                </span>
                <span className="lsp-ws-label">
                  <Localized id={ws.i18nKey}>
                    <span>{ws.key}</span>
                  </Localized>
                </span>
                <span className={`lsp-ws-dot${active ? ' lsp-ws-dot--on' : ''}`} aria-hidden="true" />
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Nav items section ─────────────────────────────────── */}
      <div className="lsp-section">
        <Localized id="lsp-section-nav">
          <h4 className="lsp-section-title">Navigation Items</h4>
        </Localized>
        <div className="lsp-nav-list" role="group" aria-label={l10n.getString('lsp-nav-aria')}>
          {activeNavItems.length === 0 ? (
            <Localized id="lsp-nav-empty">
              <span className="lsp-nav-empty">No navigation items unlocked</span>
            </Localized>
          ) : (
            activeNavItems.map((item) => (
              <span key={item.route} className="lsp-nav-chip">
                {item.label}
              </span>
            ))
          )}
        </div>
        <div className="lsp-nav-footer">
          <Localized id="lsp-nav-count" vars={{ count: unlockedCount, total: totalNavItems }}>
            <span className="lsp-nav-count" />
          </Localized>
        </div>
      </div>
    </div>
  );
}
