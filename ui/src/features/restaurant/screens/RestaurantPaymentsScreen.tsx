import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useTerminalHardware } from '@/hooks/useTerminalHardware';
import { getPrimaryLocationScoped } from '@/api/locations';
import {
  getLocalPaymentMethodsScoped,
  setLocalPaymentMethodsScoped,
  readStaticQrPayload,
  writeStaticQrPayload,
  type LocalPaymentRailArgs,
} from '@/api/local-payment';
import {
  listEdcTerminalsScoped,
  edcTerminalStatusScoped,
  type EdcTerminalDto,
} from '@/api/edc';
import SettingsSelect from '@/features/settings/SettingsSelect';
import { sanitizeRailCode, isCoreRail, mergeCoreRails, computeRailsDirty, type DraftRail } from './paymentRailsLogic';
import './RestaurantSettingsScreens.css';

export interface RestaurantPaymentsScreenProps {
  terminalId?: string;
  onSaved?: () => void;
  onBack?: () => void;
}

export function RestaurantPaymentsScreen({
  terminalId: propTerminalId,
  onSaved,
  onBack,
}: RestaurantPaymentsScreenProps) {
  const { sessionToken, terminalId: contextTerminalId } = useWorkspace();
  const effectiveTerminalId = propTerminalId || contextTerminalId || '';
  const { l10n } = useLocalization();
  const { addToast } = useToast();
  const hw = useTerminalHardware(effectiveTerminalId);

  const [locationId, setLocationId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftRail[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [edcTerminals, setEdcTerminals] = useState<EdcTerminalDto[]>([]);
  const [defaultEdcTerminalId, setDefaultEdcTerminalId] = useState('');
  const [testingEdc, setTestingEdc] = useState(false);

  // New rail draft state
  const [newCode, setNewCode] = useState('');
  const [newLabel, setNewLabel] = useState('');

  // Dirty state tracking
  const originalsRef = useRef<{
    drafts: DraftRail[];
    defaultEdcTerminalId: string;
  }>({ drafts: [], defaultEdcTerminalId: '' });
  const [dirtyVersion, setDirtyVersion] = useState(0);
  const hwInitializedRef = useRef(false);

  // Sync initial EDC terminal preference from hardware profile without wiping drafts on profile updates
  useEffect(() => {
    if (hwInitializedRef.current || !hw.profile) return;
    const currentEdc = hw.profile.localPrefs?.defaultEdcTerminalId ?? '';
    setDefaultEdcTerminalId(currentEdc);
    originalsRef.current.defaultEdcTerminalId = currentEdc;
    hwInitializedRef.current = true;
    setDirtyVersion((v) => v + 1);
  }, [hw.profile]);

  // Load location, payment rails, and EDC terminals
  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    setLoading(true);

    const loadAll = async () => {
      try {
        const [primary, edcList] = await Promise.all([
          getPrimaryLocationScoped(sessionToken),
          listEdcTerminalsScoped(sessionToken).catch(() => [] as EdcTerminalDto[]),
        ]);

        if (cancelled) return;

        if (edcList) {
          setEdcTerminals(edcList.filter((t) => t.isActive));
        }

        if (primary) {
          setLocationId(primary.id);
          const rawRails = await getLocalPaymentMethodsScoped(sessionToken, primary.id);
          if (cancelled) return;

          // Standard core methods + any custom rails are merged by the pure
          // paymentRailsLogic helper (unit-tested).
          const mergedDrafts = mergeCoreRails(rawRails);
          setDrafts(mergedDrafts);
          originalsRef.current.drafts = mergedDrafts.map((d) => ({ ...d }));
        }
      } catch {
        addToast({
          message: l10n.getString('settings-localpay-error-load') || 'Failed to load payment methods',
          type: 'error',
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadAll();
    return () => {
      cancelled = true;
    };
  }, [sessionToken, l10n, addToast]);

  const dirty = useMemo(() => {
    void dirtyVersion;
    return computeRailsDirty(
      originalsRef.current.drafts ?? [],
      drafts,
      originalsRef.current.defaultEdcTerminalId,
      defaultEdcTerminalId,
    );
  }, [drafts, defaultEdcTerminalId, dirtyVersion]);

  const handleToggleRail = (index: number, checked: boolean) => {
    setDrafts((prev) => {
      const copy = [...prev];
      const current = copy[index];
      if (!current) return prev;
      copy[index] = { ...current, is_enabled: checked };
      return copy;
    });
  };

  const handleStaticQrChange = (value: string) => {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.rail_code.toLowerCase() === 'qris') {
          return {
            ...d,
            parameters: writeStaticQrPayload(d.parameters, value),
          };
        }
        return d;
      }),
    );
  };

  const handleAddCustomRail = useCallback(() => {
    const code = sanitizeRailCode(newCode);
    const label = newLabel.trim();
    if (!code || !label) return;
    if (drafts.some((d) => d.rail_code.toLowerCase() === code)) return;

    setDrafts((prev) => [
      ...prev,
      { rail_code: code, label, is_enabled: true, parameters: '{}' },
    ]);
    setNewCode('');
    setNewLabel('');
  }, [newCode, newLabel, drafts]);

  const handleRemoveRail = (index: number) => {
    setDrafts((prev) => prev.filter((_, i) => i !== index));
  };

  // ── Test EDC Terminal ───────────────────────────────────────
  const handleTestEdc = useCallback(async () => {
    if (!sessionToken) return;
    setTestingEdc(true);
    try {
      const res = await edcTerminalStatusScoped(sessionToken, defaultEdcTerminalId || null);
      addToast({
        message: `${l10n.getString('settings-edc-test')}: ${res.status.toUpperCase()}`,
        type: res.status === 'ready' ? 'success' : 'error',
      });
    } catch {
      addToast({
        message: `${l10n.getString('settings-edc-test')}: ERROR`,
        type: 'error',
      });
    } finally {
      setTestingEdc(false);
    }
  }, [sessionToken, defaultEdcTerminalId, l10n, addToast]);

  // ── Save Handler ────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!sessionToken || !locationId) return;
    setSaving(true);
    try {
      const tasks: Promise<unknown>[] = [];

      // 1. Save workspace / location payment rails
      const payload: LocalPaymentRailArgs[] = drafts.map((d) => ({
        rail_code: d.rail_code,
        label: d.label,
        is_enabled: d.is_enabled,
        parameters: d.parameters,
      }));
      tasks.push(setLocalPaymentMethodsScoped(sessionToken, locationId, payload));

      // 2. Save hardware EDC default terminal preference
      if (effectiveTerminalId && hw.profile) {
        hw.updateLocalPrefs({ defaultEdcTerminalId: defaultEdcTerminalId || undefined });
        tasks.push(hw.save());
      }

      await Promise.all(tasks);

      originalsRef.current = {
        drafts: drafts.map((d) => ({ ...d })),
        defaultEdcTerminalId,
      };
      setDirtyVersion((v) => v + 1);

      addToast({
        message: l10n.getString('restaurant-save-success'),
        type: 'success',
      });

      onSaved?.();
    } catch {
      addToast({
        message: l10n.getString('settings-save-error'),
        type: 'error',
      });
    } finally {
      setSaving(false);
    }
  }, [
    sessionToken,
    locationId,
    drafts,
    effectiveTerminalId,
    hw,
    defaultEdcTerminalId,
    onSaved,
    addToast,
    l10n,
  ]);

  const qrisDraft = drafts.find((d) => d.rail_code.toLowerCase() === 'qris');
  const staticQrValue = qrisDraft ? readStaticQrPayload(qrisDraft.parameters) ?? '' : '';

  return (
    <div className="restaurant-settings-screen">
      <div className="restaurant-settings-header" data-testid="restaurant-payments-header">
        <div className="restaurant-settings-header-lead">
          {onBack && (
            <button
              type="button"
              className="restaurant-settings-back-btn"
              onClick={onBack}
              aria-label={l10n.getString('back') || 'Back'}
              data-testid="restaurant-payments-back-btn"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                width="18"
                height="18"
                aria-hidden="true"
              >
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
          )}
          <div className="restaurant-settings-header-title-group">
            <span
              className="restaurant-settings-header-icon"
              data-testid="restaurant-payments-icon"
              aria-hidden="true"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                width="20"
                height="20"
                aria-hidden="true"
              >
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <line x1="2" y1="10" x2="22" y2="10" />
              </svg>
            </span>
            <Localized id="restaurant-payments-title">
              <h1 className="restaurant-settings-title" data-testid="restaurant-payments-title">
                Payment Settings
              </h1>
            </Localized>
          </div>
        </div>

        {!loading && (
          <div className="restaurant-settings-header-actions">
            <span
              className="restaurant-settings-header-dirty"
              style={{ color: dirty ? 'var(--color-warning)' : 'var(--color-fg-muted)' }}
            >
              {dirty ? (
                <Localized id="restaurant-unsaved-changes">Unsaved changes</Localized>
              ) : (
                <Localized id="restaurant-all-saved">All changes saved</Localized>
              )}
            </span>
            <button
              type="button"
              className={`btn btn--primary btn--md resto-anim-btn ${saving ? 'resto-anim-btn--loading' : ''}`}
              disabled={!dirty || saving}
              aria-busy={saving || undefined}
              onClick={handleSave}
              data-testid="restaurant-payments-save-btn"
            >
              <span className="resto-anim-btn__spinner-wrap" aria-hidden="true">
                <span className="resto-anim-btn__spinner" />
              </span>
              <span className="resto-anim-btn__content">
                <Localized id="save">Save Changes</Localized>
              </span>
            </button>
          </div>
        )}
      </div>

      <div className="restaurant-settings-main">
      {loading ? (
        // Was `localpay-loading`, borrowed from LocalPaymentSettingsCard.css —
        // a sheet this screen does not import, so the name resolved nowhere and
        // the rule was never reachable from here. The screen's own sheet owns
        // the loading line now.
        <p className="restaurant-settings-loading">
          <Localized id="settings-section-loading">Loading…</Localized>
        </p>
      ) : (
        <>
          {/* ── Card 1: Core Payment Options ────────────────────── */}
      <Card
        shadow="sm"
        header={
          <div className="restaurant-settings-card-header">
            <div>
              <h2 className="settings-section-title">
                <Localized id="restaurant-payment-methods-heading">Payment Methods</Localized>
              </h2>
              <p>
                <Localized id="restaurant-payment-methods-sub">
                  Enable or disable accepted payment methods at checkout
                </Localized>
              </p>
            </div>
          </div>
        }
      >
        {/* The rails list uses the classes RestaurantSettingsScreens.css already
            defines — restaurant-rails-list / -rail-row / -rail-info / -rail-label /
            -rail-code. Those rules landed with the screen's stylesheet but the
            markup below never adopted them, so it carried the same design as six
            inline style objects and the sheet graded as dead. Wiring the names up
            is what the sheet was written for; the only inline style kept is the
            label's weight, which is a deliberate emphasis on a shared class. */}
        <div className="settings-form">
          <div className="restaurant-rails-list">
          {drafts.map((rail, index) => {
            const isCore = isCoreRail(rail.rail_code);
            return (
              <div className="restaurant-rail-row" key={rail.rail_code}>
                <div className="restaurant-rail-info">
                  <label
                    htmlFor={`rail-toggle-${rail.rail_code}`}
                    className="restaurant-rail-label"
                  >
                    {rail.label}
                  </label>
                  <span className="restaurant-rail-code">{rail.rail_code}</span>
                </div>
                <div className="restaurant-rail-actions">
                  {!isCore && (
                    <button
                      type="button"
                      className="restaurant-rail-remove"
                      onClick={() => handleRemoveRail(index)}
                      aria-label={`Remove ${rail.label}`}
                    >
                      &times;
                    </button>
                  )}
                  <span className="settings-toggle">
                    <span className="sr-only">Toggle {rail.label}</span>
                    <span className="settings-toggle-switch">
                      <input
                        id={`rail-toggle-${rail.rail_code}`}
                        type="checkbox"
                        role="switch"
                        checked={rail.is_enabled}
                        aria-checked={rail.is_enabled}
                        onChange={(e) => handleToggleRail(index, e.target.checked)}
                      />
                      <span className="settings-toggle-slider" />
                    </span>
                  </span>
                </div>
              </div>
            );
          })}
          </div>
        </div>
      </Card>

      {/* ── Card 2: QRIS Configuration (Static QR) ─────────── */}
      {qrisDraft && qrisDraft.is_enabled && (
        <Card
          shadow="sm"
          header={
            <div className="restaurant-settings-card-header">
              <div>
                <h2 className="settings-section-title">QRIS Configuration</h2>
                <p>Static EMVCo QR code string for customer scans at counter or table</p>
              </div>
            </div>
          }
        >
          <div className="settings-form">
            <div className="settings-field">
              <label htmlFor="resto-static-qris" className="settings-label">
                <Localized id="settings-localpay-static-qr-label">Static QR payload</Localized>
              </label>
              <div className="restaurant-static-qr-box">
                <textarea
                  id="resto-static-qris"
                  className="settings-input"
                  rows={3}
                  placeholder="00020101021126580014ID.LINKAJA.WWW0118936009110022201389..."
                  value={staticQrValue}
                  onChange={(e) => handleStaticQrChange(e.target.value)}
                  spellCheck={false}
                />
                <p className="settings-hint">
                  Paste the merchant QR string (EMVCo format) to enable in-app counter QR presentation.
                </p>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ── Card 3: Additional Payment Rails ────────────────── */}
      <Card
        shadow="sm"
        header={
          <div className="restaurant-settings-card-header">
            <div>
              <h2 className="settings-section-title">
                <Localized id="restaurant-payment-rails-heading">Local Payment Rails</Localized>
              </h2>
              <p>
                <Localized id="restaurant-payment-rails-sub">
                  Additional digital rails and custom tender options
                </Localized>
              </p>
            </div>
          </div>
        }
      >
        <div className="settings-form">
          <div className="restaurant-rail-add">
            <input
              type="text"
              className="settings-input"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              placeholder="e.g. gopay, ovo, bca_va"
              aria-label="New rail code"
            />
            <input
              type="text"
              className="settings-input"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="e.g. GoPay QR, OVO"
              aria-label="New rail display label"
            />
            <Button
              variant="secondary"
              onClick={handleAddCustomRail}
              disabled={!newCode.trim() || !newLabel.trim()}
            >
              <Localized id="settings-localpay-add">Add rail</Localized>
            </Button>
          </div>
        </div>
      </Card>

      {/* ── Card 4: EDC Hardware Preferences ────────────────── */}
      <Card
        shadow="sm"
        header={
          <div className="restaurant-settings-card-header">
            <div>
              <h2 className="settings-section-title">
                <Localized id="restaurant-edc-heading">EDC Terminal (Card Payment)</Localized>
              </h2>
              <p>
                <Localized id="restaurant-edc-sub">
                  Configure register-local card payment terminal
                </Localized>
              </p>
            </div>
          </div>
        }
      >
        <div className="settings-form">
          <div className="settings-field settings-field--horizontal">
            <label htmlFor="resto-default-edc" className="settings-label">
              <Localized id="settings-edc-default-select">Default EDC Terminal</Localized>
            </label>
            <SettingsSelect
              id="resto-default-edc"
              value={defaultEdcTerminalId}
              onChange={(v) => setDefaultEdcTerminalId(v)}
              options={[
                { value: '', label: 'None (Manual Card Entry)' },
                ...edcTerminals.map((t) => ({
                  value: t.id,
                  label: `${t.name} (${t.transport} - ${t.address})`,
                })),
              ]}
            />
          </div>

          {defaultEdcTerminalId && (
            <div className="settings-actions" style={{ justifyContent: 'flex-start', marginTop: '8px' }}>
              <Button
                variant="secondary"
                onClick={handleTestEdc}
                disabled={testingEdc}
              >
                <Localized id="settings-edc-test">Test Connection</Localized>
              </Button>
            </div>
          )}
        </div>
      </Card>

      </>
      )}
      </div>
    </div>
  );
}

export default RestaurantPaymentsScreen;
