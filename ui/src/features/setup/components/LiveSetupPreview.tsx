/**
 * LiveSetupPreview — real-time preview of which workspaces and
 * navigation items will be unlocked by the currently-selected features.
 *
 * Embedded in SetupWizard (Review step) and FeatureToggleScreen.
 */
import { useMemo } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { WorkspaceIcon as SharedWorkspaceIcon } from '@/components/WorkspaceIcon';
import { getNavItems } from '@/registries/menu-registry';
import { FEATURES, type FeatureKey } from '@/hooks/useFeatures';
import './LiveSetupPreview.css';

// ── Workspace definitions ───────────────────────────────────────────

interface WorkspaceDef {
  key: string;
  i18nKey: string;
  colorClass: string;
  /**
   * Feature keys that unlock this workspace (any match).
   *
   * Typed as FeatureKey, not string: as a bare string[] a typo compiled and
   * silently never matched — the workspace would just never light up, with no
   * type error and no failing test (verified by planting 'inventory-trackin').
   */
  features: FeatureKey[];
}

const WORKSPACES: WorkspaceDef[] = [
  {
    key: 'restaurant-pos',
    i18nKey: 'ws-preview-name-restaurant-pos',
    colorClass: 'lsp-ws--restaurant-pos',
    features: [FEATURES.RESTAURANT],
  },
  {
    key: 'store-pos',
    i18nKey: 'ws-preview-name-store-pos',
    colorClass: 'lsp-ws--store-pos',
    features: [FEATURES.SIMPLE_RETAIL],
  },
  {
    key: 'kds',
    i18nKey: 'ws-preview-name-kds',
    colorClass: 'lsp-ws--kds',
    features: [FEATURES.KITCHEN_DISPLAY],
  },
  {
    key: 'warehouse',
    i18nKey: 'ws-preview-name-warehouse',
    colorClass: 'lsp-ws--warehouse',
    features: [FEATURES.INVENTORY_TRACKING],
  },
  {
    key: 'admin',
    i18nKey: 'ws-preview-name-admin',
    colorClass: 'lsp-ws--admin',
    features: [], // always available
  },
];

// ── Known nav items ─────────────────────────────────────────────────
//
// Read from the PAGE REGISTRY rather than kept as a list here.
//
// This used to be a hand-written table of 34 {route, label, feature} rows
// duplicating what every `registerPage(...)` call already declares. It drifted:
// measured 2026-09-23, NINE registered routes were missing (analytics,
// menu-engineering, kds-expo, sales, dashboard, custom-report, security-trail,
// design, tooltips), so the "X / N items unlocked" count this component renders
// on the live features page under-reported the denominator.
//
// Reading the registry removes the duplication rather than correcting one copy of
// it, so the count cannot drift again. `getNavItems` applies the same feature and
// role gates the sidebar itself applies, which is the point: this preview
// answers "what will I be able to reach", and the sidebar is the thing that decides.

export interface NavItemDef {
  route: string;
  label: string;
  /** Explicitly `| undefined`: `exactOptionalPropertyTypes` is on, and the
   *  registry's registrations carry the key whether or not a gate is set. */
  feature: string | undefined;
}

/**
 * Pages the owner will actually be able to reach, given a feature set.
 *
 * `role` is forwarded so role-gated pages are filtered the same way the nav bar
 * filters them. Omitted, `getNavItems` fails CLOSED on role-gated items — which
 * under-counts (measured: 10 total instead of 39), so this is threaded rather
 * than left to the default.
 */
function reachableNavItems(enabled: Set<string> | undefined, role?: string): NavItemDef[] {
  return getNavItems(enabled, role)
    // The DEV section (Design System, Tooltip Preview) is registered like any other
    // page but is not something a merchant can use, so counting it would overstate
    // what the feature set unlocks.
    .filter((item) => item.section !== 'dev')
    .map((item) => ({
      route: item.route,
      label: item.label,
      feature: item.feature,
    }));
}

// ── Workspace icons (inline SVGs) ───────────────────────────────────

function WorkspaceIcon({ wsKey }: { wsKey: string }) {
  return <SharedWorkspaceIcon wsKey={wsKey} />;
}

// ── Props ───────────────────────────────────────────────────────────

export interface LiveSetupPreviewProps {
  /** Set of feature keys that are currently enabled. */
  selectedFeatures: Set<string>;
  /**
   * Role to evaluate role-gated items against.
   *
   * Defaults to 'owner' because that is the only role that can reach this screen
   * (FeatureToggleScreen is registered `requiredRole: 'owner'`, settings/register.tsx:21).
   * Omitting it is NOT safe: `getNavItems` treats an unknown role as failing every
   * role-gated item, so the count collapses (measured: 10 total instead of the real
   * set) and the preview would under-report what a feature unlocks.
   */
  userRole?: string;
}

// ── Component ───────────────────────────────────────────────────────

/** Real-time preview of which workspaces and navigation items are unlocked by the currently-selected feature set. */
export default function LiveSetupPreview({ selectedFeatures, userRole = 'owner' }: LiveSetupPreviewProps) {
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

  // The registry applies the feature gate itself; the preview only supplies the
  // set. `role` is not threaded here yet because the prop carries only the feature
  // set — a role-gated page is therefore counted as reachable, which for an OWNER
  // (the only role that can open this screen) is correct.
  const navItems = useMemo(
    () => reachableNavItems(selectedFeatures, userRole),
    [selectedFeatures, userRole],
  );

  const activeNavItems = navItems;
  const unlockedCount = activeNavItems.length;
  // The denominator is what the OWNER could reach with EVERY feature on, not with
  // the current set — otherwise "3 / 3 unlocked" would read as complete when the
  // merchant has most of the product switched off.
  // `getNavItems()` with NO feature set returns every item the ROLE can reach (its
  // own doc: "If enabledFeatures is omitted, all pages are returned"), which is the
  // honest denominator — the most this merchant could ever unlock.
  const totalNavItems = useMemo(
    () => reachableNavItems(undefined, userRole).length,
    [userRole],
  );

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
