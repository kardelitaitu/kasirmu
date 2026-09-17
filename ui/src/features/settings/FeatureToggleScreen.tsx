//! Feature flag management screen — Settings → Features
//!
//! Displays all 32 feature flags grouped by category with toggle
//! switches. Users can enable/disable features after the initial
//! Setup Wizard. Dependencies are resolved automatically: when
//! enabling a feature, required dependencies are also enabled.
//! When disabling, only the selected feature is turned off.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Skeleton } from '@/components/Skeleton';
import { Localized, useLocalization } from '@fluent/react';
import { useToast, useContextMenu, ContextMenu } from '@/components';
import LiveSetupPreview from '@/features/setup/components/LiveSetupPreview';
import { l10nErrorMessage } from '@/utils/app-error';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import {
  listAllFeatures,
  listAllFeaturesScoped,
  setFeature,
  setFeaturesBulk,
  type FeatureInfo,
} from '@/api/features';
import './FeatureToggleScreen.css';

/** Duration (ms) for both the row flash and checkmark overlay to persist after a toggle. */
const FLASH_DURATION = 1_400;

// ── Types ──────────────────────────────────────────────────────────

export type { FeatureInfo };

// ── Group ordering ─────────────────────────────────────────────────

const GROUP_ORDER: string[] = [
  'Core',
  'Payments',
  'Products',
  'Staff',
  'Hardware',
  'Business Rules',
  'Restaurant',
  'Scaling',
  'Reporting',
  'Advanced',
];

const GROUP_L10N_IDS: Record<string, string> = {
  'Core': 'feature-toggle-group-core',
  'Payments': 'feature-toggle-group-payments',
  'Products': 'feature-toggle-group-products',
  'Staff': 'feature-toggle-group-staff',
  'Hardware': 'feature-toggle-group-hardware',
  'Business Rules': 'feature-toggle-group-business-rules',
  'Restaurant': 'feature-toggle-group-restaurant',
  'Scaling': 'feature-toggle-group-scaling',
  'Reporting': 'feature-toggle-group-reporting',
  'Advanced': 'feature-toggle-group-advanced',
};

// ── Helpers ─────────────────────────────────────────────────────────

const ICON_PROPS = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** Returns an SVG icon matching the feature group. */
function getGroupIcon(group: string): React.ReactNode {
  switch (group) {
    case 'Core':
      return <svg {...ICON_PROPS}><circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v2m-9.9-4.9l1.4 1.4m12.8 1.4l1.4-1.4M1 12h2m18 0h2M4.2 4.2l1.4 1.4m12.8 12.8l1.4 1.4"/></svg>;
    case 'Payments':
      return <svg {...ICON_PROPS}><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>;
    case 'Products':
      return <svg {...ICON_PROPS}><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>;
    case 'Staff':
      return <svg {...ICON_PROPS}><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6m-3-3h6"/></svg>;
    case 'Hardware':
      return <svg {...ICON_PROPS}><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 12H5a2 2 0 00-2 2v6a2 2 0 002 2h14a2 2 0 002-2v-6a2 2 0 00-2-2h-1"/><path d="M8 18h8"/></svg>;
    case 'Business Rules':
      return <svg {...ICON_PROPS}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>;
    case 'Restaurant':
      return <svg {...ICON_PROPS}><path d="M6 2v20m12-20v5.3c0 3.3-2.7 6-6 6s-6-2.7-6-6V2"/></svg>;
    case 'Scaling':
      return <svg {...ICON_PROPS}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>;
    case 'Reporting':
      return <svg {...ICON_PROPS}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>;
    case 'Advanced':
      return <svg {...ICON_PROPS}><path d="M14.7 6.3a1 1 0 000-1.4l-1.4-1.4a1 1 0 00-1.4 0L7.6 7.8a1 1 0 000 1.4l1.4 1.4"/><path d="M5.4 5.4l-3.1 3.1a2 2 0 000 2.8l4.2 4.2a2 2 0 002.8 0l3.1-3.1"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>;
    default:
      return <svg {...ICON_PROPS}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>;
  }
}

// ── Component ──────────────────────────────────────────────────────

/** Feature flag management screen — groups all 32 feature flags by category with toggle switches and automatic dependency resolution. */
export default function FeatureToggleScreen() {
  const { l10n } = useLocalization();
  // Keep a stable ref to l10n so callbacks can read the latest translations
  // without listing l10n in their deps (which would recreate them every
  // render and re-fire mount effects). Mirrors LicenseSettings.
  const l10nRef = useRef(l10n);
  l10nRef.current = l10n;
  const [features, setFeatures] = useState<FeatureInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [toggling, setToggling] = useState<string | null>(null);
  const [togglingBatch, setTogglingBatch] = useState<string | null>(null);
  const { addToast } = useToast();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken ?? '';
  const cm = useContextMenu();
  const cmInput = useMemo(() => ({
    autoComplete: 'off' as const,
    autoCorrect: 'off' as const,
    spellCheck: false as const,
    'data-gramm': 'false' as const,
    'data-1p-ignore': 'true' as const,
    'data-lpignore': 'true' as const,
    'data-bwignore': 'true' as const,
    onContextMenu: (e: React.MouseEvent<HTMLInputElement>) => cm.open(e, e.currentTarget),
  }), [cm]);

  // Track recently-toggled features for row flash + checkmark animation.
  // Map<featureKey, 'enabled' | 'disabled'>
  const [flashRows, setFlashRows] = useState<Map<string, 'enabled' | 'disabled'>>(new Map());
  // Auto-cleanup ref for flash timeouts.
  const flashTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  /** Trigger row flash + checkmark on a feature key with a given result type. */
  const triggerFlash = useCallback((key: string, kind: 'enabled' | 'disabled') => {
    setFlashRows((prev) => {
      const next = new Map(prev);
      next.set(key, kind);
      return next;
    });
    // Clear any existing timeout for this key.
    const existing = flashTimeoutsRef.current.get(key);
    if (existing) clearTimeout(existing);
    const tid = setTimeout(() => {
      setFlashRows((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      flashTimeoutsRef.current.delete(key);
    }, FLASH_DURATION);
    flashTimeoutsRef.current.set(key, tid);
  }, []);

  // Cleanup flash timeouts on unmount.
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    return () => {
      flashTimeoutsRef.current.forEach((tid) => clearTimeout(tid));
      flashTimeoutsRef.current.clear();
    };
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // ADR #7: the writes below already carry the token (setFeature / setFeaturesBulk), so reading
      // through the ambient command showed the cashier flags from one store while they toggled
      // another's. sessionToken is `rawToken ?? ''` here, so an empty string -- no workspace --
      // still falls back to the ambient read rather than sending a blank token.
      const result = sessionToken
        ? await listAllFeaturesScoped(sessionToken)
        : await listAllFeatures();
      setFeatures(result.features);
    } catch (err) {
      setError(l10nErrorMessage(err, l10nRef.current, 'feature-toggle-error-load'));
    } finally {
      setLoading(false);
    }
     
  }, [sessionToken]);

  useEffect(() => { load(); }, [load]);

  const handleToggle = useCallback(async (key: string, current: boolean) => {
    const newValue = !current;
    setToggling(key);
    try {
      const result = await setFeature(sessionToken, key, newValue);
      setFeatures(result.features);
      triggerFlash(key, newValue ? 'enabled' : 'disabled');

      if (newValue && result.auto_enabled.length > 0) {
        addToast({
          message: l10n.getString('feature-toggle-auto-enabled', { list: result.auto_enabled.join(', ') }),
          type: 'success',
        });
      } else {
        addToast({
          message: l10n.getString(newValue ? 'feature-toggle-enabled' : 'feature-toggle-disabled'),
          type: 'success',
        });
      }
    } catch (err) {
      addToast({
        message: l10nErrorMessage(err, l10n, 'feature-toggle-error-toggle'),
        type: 'error',
      });
    } finally {
      setToggling(null);
    }
  }, [l10n, addToast, triggerFlash, sessionToken]);

  // ── Active feature set for preview ───────────────────────────

  const activeFeatureSet = useMemo(
    () => new Set(features.filter((f) => f.enabled).map((f) => f.key)),
    [features],
  );

  // ── Search filter ──────────────────────────────────────────────

  const query = searchQuery.toLowerCase().trim();

  const matchesSearch = (f: FeatureInfo) =>
    !query ||
    f.key.toLowerCase().includes(query) ||
    f.name.toLowerCase().includes(query) ||
    f.description.toLowerCase().includes(query);

  // ── Group features ────────────────────────────────────────────

  const grouped = GROUP_ORDER
    .map((group) => ({
      group,
      features: features.filter((f) => f.group === group && matchesSearch(f)),
    }))
    .filter((g) => g.features.length > 0);

  // ── Bulk toggle handlers ───────────────────────────────────────

  // Keep a ref to the latest features so toggleGroup doesn't need to
  // depend on `features` (which changes on every toggle, defeating
  // useCallback memoization).
  const featuresRef = useRef(features);
  featuresRef.current = features;

  const toggleGroup = useCallback(async (group: string, enable: boolean) => {
    const currentFeatures = featuresRef.current;
    const groupFeatures = currentFeatures.filter((f) => f.group === group);
    const keys = groupFeatures
      .filter((f) => f.enabled !== enable)
      .map((f) => f.key);

    if (keys.length === 0) return;

    setTogglingBatch(group);
    try {
      // Toggle all features in a single atomic SQLite transaction via
      // set_features_bulk — avoids N individual IPC round-trips.
      const result = await setFeaturesBulk(sessionToken, keys, enable);
      setFeatures(result.features);
      // Trigger flash on each toggled feature.
      keys.forEach((k) => triggerFlash(k, enable ? 'enabled' : 'disabled'));
      addToast({
        message: l10n.getString(
          enable ? 'feature-toggle-bulk-enabled' : 'feature-toggle-bulk-disabled',
          { group },
        ),
        type: 'success',
      });
    } catch (err) {
      addToast({
        message: l10nErrorMessage(err, l10n, 'feature-toggle-error-toggle'),
        type: 'error',
      });
    } finally {
      setTogglingBatch(null);
    }
  }, [l10n, addToast, triggerFlash, sessionToken]);

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="feature-toggle">
      {cm.menu && (
        <ContextMenu
          menu={cm.menu}
          menuRef={cm.menuRef}
          onCopy={cm.handleCopy}
          onPaste={cm.handlePaste}
          onClose={cm.close}
        />
      )}
      <div className="feature-toggle-header">
        <Localized id="feature-toggle-title"><h1 className="feature-toggle-title">Feature Toggles</h1></Localized>
        {features.length > 0 && (
          <Localized
            id="feature-toggle-subtitle"
            vars={{ enabled: features.filter((f) => f.enabled).length, total: features.length }}
          >
            <span className="feature-toggle-subtitle">0 / 0 enabled</span>
          </Localized>
        )}
      </div>

      {loading && (
        <div className="feature-toggle-loading-skeleton" aria-hidden="true">
          {/* Header skeleton: title + subtitle */}
          <div className="feature-toggle-header">
            <Skeleton variant="block" width="14rem" height="1.75rem" />
            <Skeleton variant="text" width="6rem" height="1rem" />
          </div>

          {/* Search bar skeleton */}
          <div className="feature-toggle-skeleton-search">
            <Skeleton variant="text" width="1rem" height="1rem" />
            <Skeleton variant="text" width="100%" height="1.25rem" />
          </div>

          {/* Group card skeletons */}
          {[0, 1, 2].map((g) => (
            <div key={g} className="feature-toggle-group">
              <div className="feature-toggle-group-header">
                <div className="feature-toggle-group-title">
                  <Skeleton variant="circle" width="1.25rem" height="1.25rem" />
                  <Skeleton variant="text" width="8rem" height="1.25rem" />
                  <Skeleton variant="text" width="3rem" height="1.125rem" />
                </div>
                <div className="feature-toggle-bulk-actions">
                  <Skeleton variant="block" width="5rem" height="1.5rem" />
                  <Skeleton variant="block" width="5rem" height="1.5rem" />
                </div>
              </div>
              <Card shadow="xs">
                <div className="feature-toggle-list">
                  {[0, 1, 2, 3].map((r) => (
                    <div key={r} className="feature-toggle-item">
                      <div className="feature-toggle-item-info">
                        <Skeleton variant="text" width="8rem" height="0.875rem" />
                        <Skeleton variant="text" width="14rem" height="0.75rem" />
                      </div>
                      <Skeleton variant="block" width="2.75rem" height="1.5rem" style={{ borderRadius: '1.5rem' }} />
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="feature-toggle-error" role="alert">
          <p>{error}</p>
          <Button variant="secondary" onClick={load}>
            <Localized id="feature-toggle-retry"><span>Retry</span></Localized>
          </Button>
        </div>
      )}

      {/* Search bar */}
      {!loading && !error && (
        <div className="feature-toggle-search">
          <svg className="feature-toggle-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="16" height="16">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <Localized id="feature-toggle-search-placeholder" attrs={{ placeholder: true }}>
            <input
              type="search"
              className="feature-toggle-search-input"
              placeholder="Search features…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label={l10n.getString('feature-toggle-search-aria')}
              {...cmInput}
            />
          </Localized>
          {searchQuery && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              iconOnly
              className="feature-toggle-search-clear"
              onClick={() => setSearchQuery('')}
              aria-label={l10n.getString('feature-toggle-search-clear-aria')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </Button>
          )}
        </div>
      )}

      {!loading && !error && grouped.length === 0 && (
        <Card shadow="sm">
          <div className="feature-toggle-empty">
            {features.length === 0 ? (
              <Localized id="feature-toggle-empty"><p>No features found.</p></Localized>
            ) : (
              <Localized id="feature-toggle-empty-search">
                <p>No features match your search.</p>
              </Localized>
            )}
          </div>
        </Card>
      )}

      {/* Live Preview */}
      {!loading && !error && features.length > 0 && (
        <div className="feature-toggle-preview">
          <LiveSetupPreview selectedFeatures={activeFeatureSet} />
        </div>
      )}

      {!loading && !error && grouped.map(({ group, features: groupFeatures }) => (
        <div key={group} className="feature-toggle-group">
          <div className="feature-toggle-group-header">
            <h2 className="feature-toggle-group-title">
              <span className="feature-toggle-group-icon" aria-hidden="true">{getGroupIcon(group)}</span>
              <Localized id={GROUP_L10N_IDS[group] ?? ''}>{group}</Localized>
              <span className="feature-toggle-group-count" key={`${group}-${groupFeatures.filter((f) => f.enabled).length}`}>
                {groupFeatures.filter((f) => f.enabled).length}/{groupFeatures.length}
              </span>
            </h2>
            <div className="feature-toggle-bulk-actions">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="feature-toggle-bulk-btn"
                disabled={togglingBatch === group}
                onClick={() => toggleGroup(group, true)}
                aria-label={l10n.getString('feature-toggle-bulk-enable-aria', { group })}
              >
                <Localized id="feature-toggle-bulk-enable"><span>Enable All</span></Localized>
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="feature-toggle-bulk-btn feature-toggle-bulk-btn--disable"
                disabled={togglingBatch === group}
                onClick={() => toggleGroup(group, false)}
                aria-label={l10n.getString('feature-toggle-bulk-disable-aria', { group })}
              >
                <Localized id="feature-toggle-bulk-disable"><span>Disable All</span></Localized>
              </Button>
            </div>
          </div>

          <Card shadow="xs">
            <div className="feature-toggle-list" role="group" aria-label={l10n.getString('feature-toggle-group-aria', { group })}>
              {groupFeatures.map((feat) => {
                const depNames = feat.dependencies
                  .map((dk) => features.find((f) => f.key === dk)?.name ?? dk)
                  .join(', ');
                const flashKind = flashRows.get(feat.key);

                return (
                  <div
                    key={feat.key}
                    className={`feature-toggle-item${flashKind ? ` feature-toggle-item--flash-${flashKind}` : ''}`}
                  >
                    <div className="feature-toggle-item-info">
                      <span className="feature-toggle-item-name">{feat.name}</span>
                      <span id={`desc-${feat.key}`} className="feature-toggle-item-desc">{feat.description}</span>
                      {feat.dependencies.length > 0 && (
                        <span className="feature-toggle-item-deps">
                          {l10n.getString('feature-toggle-requires', { deps: depNames })}
                        </span>
                      )}
                    </div>
                    <label className="feature-toggle-switch" aria-label={l10n.getString('feature-toggle-toggle-aria', { name: feat.name })}>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={feat.enabled}
                        aria-checked={feat.enabled}
                        disabled={toggling === feat.key}
                        onChange={() => handleToggle(feat.key, feat.enabled)}
                        aria-describedby={`desc-${feat.key}`}
                      />
                      <span className="feature-toggle-slider" />
                      {/* Success checkmark overlay — appears briefly after toggle */}
                      {flashKind && (
                        <span
                          className={`feature-toggle-checkmark feature-toggle-checkmark--${flashKind}`}
                          aria-hidden="true"
                        >
                          {flashKind === 'enabled' ? (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          ) : (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          )}
                        </span>
                      )}
                    </label>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      ))}
    </div>
  );
}
