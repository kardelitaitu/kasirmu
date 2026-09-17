import { Localized, useLocalization } from '@fluent/react';
import { requiredLocalized } from '@/components';
import { getWidgets, getDeniedWidgets, useWidgetUser } from '@/registries/widget-registry';
import { useFeatures } from '@/hooks/useFeatures';
import { Card } from '@/components/Card';
import { LazyBoundary } from '@/components/LazyBoundary';
import './widgets/widgets.css';
import './SalesDashboardScreen.css';

/**
 * Sales Dashboard page — renders all registered reporting widgets
 * from the WidgetRegistry on a responsive grid.
 *
 * Widgets are filtered by enabled features so feature-gated widgets
 * only appear when their feature is turned on, and by the same
 * role/permission gate pages and nav items pass through
 * (`passesGate` in registries/page-registry, reached here through
 * `getWidgets`/`getDeniedWidgets`).
 *
 * A widget the user may NOT see still occupies its slot, as a denied
 * tile: a filtered-out dashboard tile is indistinguishable from a
 * broken or removed one, which is the failure mode this host refuses
 * to produce.
 */
export default function SalesDashboardScreen() {
  const { l10n } = useLocalization();
  const { enabled } = useFeatures();
  const user = useWidgetUser();
  const widgets = getWidgets(enabled, user);
  // Feature-visible, gate-failed: the complement, never a silent hole.
  const refused = getDeniedWidgets(enabled, user);

  const widthClass = (w: { width?: 1 | 2 | 3 }) =>
    w.width === 2 ? 'widget-width-2' : 'widget-width-1';

  return (
    <div className="reporting-dashboard" role="region" aria-label={requiredLocalized(l10n, 'sales-dashboard-region-aria')}>
      <Localized id="sales-dashboard-title">
        <h1 className="reporting-dashboard-title">Sales Dashboard</h1>
      </Localized>

      {widgets.length === 0 && refused.length === 0 ? (
        <div className="reporting-dashboard-empty">
          <Localized id="sales-dashboard-no-data">
            <p>No widgets registered. Enable features to see reporting data.</p>
          </Localized>
        </div>
      ) : (
        <div className="reporting-dashboard-grid" role="list" aria-label={requiredLocalized(l10n, 'sales-dashboard-grid-aria')}>
          {widgets.map((w) => {
            const WidgetComponent = w.component;
            return (
              <div key={w.id} role="listitem" aria-label={w.title}>
                <Card shadow="sm" className={widthClass(w)}>
                  {/* PERF-01: lazy widgets need a Suspense boundary per card */}
                  <LazyBoundary>
                    <WidgetComponent />
                  </LazyBoundary>
                </Card>
              </div>
            );
          })}
          {refused.map((w) => (
            <div key={w.id} role="listitem" aria-label={w.title}>
              {/* Refused, not removed: the host's own Card, width and grid slot
                  stay, so the tile still reads as a tile. Only the interior
                  changes, and every class here is one this screen already owns
                  (SalesDashboardScreen.css) — the widget tiles' chrome belongs to
                  widgets.css and a screen may not borrow it. */}
              <Card shadow="sm" className={widthClass(w)}>
                <div className="reporting-dashboard-empty">
                  <h3 className="reporting-dashboard-title">
                    <Localized id="permission-denied-title">
                      Access Denied
                    </Localized>
                  </h3>
                  <Localized id="permission-denied-perm-desc" vars={{ action: w.title }}>
                    <p>You don&apos;t have permission to access this widget.</p>
                  </Localized>
                  {w.requiredPermission && (
                    <Localized id="permission-denied-perm-key" vars={{ permission: w.requiredPermission }}>
                      <p>(required permission: {w.requiredPermission})</p>
                    </Localized>
                  )}
                </div>
              </Card>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
