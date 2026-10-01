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
import { PaymentMethodCard } from './PaymentMethodCard';
import './RestaurantSettingsScreens.css';

// ── Icons ───────────────────────────────────────────────────────────

function CashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="3" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  );
}

function QrisIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <path d="M14 14h3v3h-3zM17 17h4v4h-4zM14 20h3v1h-3zM20 14v3" />
    </svg>
  );
}

function EdcIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
      <circle cx="6" cy="15" r="1" />
      <circle cx="10" cy="15" r="1" />
    </svg>
  );
}

function MidtransIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function StripeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function GenericRailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  );
}

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

  // New custom rail draft state
  const [newCode, setNewCode] = useState('');
  const [newLabel, setNewLabel] = useState('');

  // ── UI States for Expanded Payment Cards ──────────────────────
  // Cash
  const [cashDrawerAutoKick, setCashDrawerAutoKick] = useState(true);
  const [cashDrawerVerify, setCashDrawerVerify] = useState(false);
  const [cashCustomLabel, setCashCustomLabel] = useState('Cash');

  // QRIS
  const [qrisMode, setQrisMode] = useState<'static' | 'dynamic'>('static');
  const [qrisNmid, setQrisNmid] = useState('ID1020030040050');
  const [qrisSurcharge, setQrisSurcharge] = useState('0.7');
  const [qrisPrintReceipt, setQrisPrintReceipt] = useState(true);

  // EDC
  const [requireEdcTraceCode, setRequireEdcTraceCode] = useState(true);
  const [acceptedCards, setAcceptedCards] = useState<string[]>(['gpn', 'visa', 'mastercard', 'bca']);

  // Midtrans Gateway
  const [midtransLocalEnabled, setMidtransLocalEnabled] = useState(false);
  const [midtransEnv, setMidtransEnv] = useState<'sandbox' | 'production'>('sandbox');
  const [midtransMerchantId, setMidtransMerchantId] = useState('');
  const [midtransClientKey, setMidtransClientKey] = useState('');
  const [midtransServerKey, setMidtransServerKey] = useState('');
  const [midtransChannels, setMidtransChannels] = useState<Record<string, boolean>>({
    gopay: true,
    shopeepay: true,
    bca_va: true,
    mandiri_va: false,
    bni_va: false,
    bri_va: false,
  });
  const [midtransAutoConfirm, setMidtransAutoConfirm] = useState(true);

  // Stripe Processing
  const [stripeLocalEnabled, setStripeLocalEnabled] = useState(false);
  const [stripeMode, setStripeMode] = useState<'test' | 'live'>('test');
  const [stripePublishableKey, setStripePublishableKey] = useState('');
  const [stripeSecretKey, setStripeSecretKey] = useState('');
  const [stripeReader, setStripeReader] = useState('wisepos_e');
  const [stripeCurrency, setStripeCurrency] = useState('IDR');

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

          // Standard core methods + any custom rails are merged by the pure paymentRailsLogic helper
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

  const handleToggleCode = (code: string, checked: boolean) => {
    const idx = drafts.findIndex((d) => d.rail_code.toLowerCase() === code.toLowerCase());
    if (idx >= 0) {
      handleToggleRail(idx, checked);
    } else {
      if (code === 'midtrans') {
        setMidtransLocalEnabled(checked);
        setDrafts((prev) => [
          ...prev,
          { rail_code: 'midtrans', label: 'Midtrans Gateway', is_enabled: checked, parameters: '{}' },
        ]);
      } else if (code === 'stripe') {
        setStripeLocalEnabled(checked);
        setDrafts((prev) => [
          ...prev,
          { rail_code: 'stripe', label: 'Stripe Processing', is_enabled: checked, parameters: '{}' },
        ]);
      }
    }
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

  const handleRemoveCode = (code: string) => {
    const idx = drafts.findIndex((d) => d.rail_code.toLowerCase() === code.toLowerCase());
    if (idx >= 0) {
      handleRemoveRail(idx);
    }
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

  // Find drafts for the 5 targeted payment methods
  const cashDraft = drafts.find((d) => d.rail_code.toLowerCase() === 'cash');
  const cardDraft = drafts.find((d) => d.rail_code.toLowerCase() === 'card');
  const qrisDraft = drafts.find((d) => d.rail_code.toLowerCase() === 'qris');
  const midtransDraft = drafts.find((d) => d.rail_code.toLowerCase() === 'midtrans');
  const stripeDraft = drafts.find((d) => d.rail_code.toLowerCase() === 'stripe');

  const staticQrValue = qrisDraft ? readStaticQrPayload(qrisDraft.parameters) ?? '' : '';

  // Non-specialized rails (e.g. open_bill, credit, or dynamically added custom rails like gopay)
  const specializedCodes = ['cash', 'card', 'qris', 'midtrans', 'stripe'];
  const otherRails = drafts.filter((d) => !specializedCodes.includes(d.rail_code.toLowerCase()));

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
          <p className="restaurant-settings-loading">
            <Localized id="settings-section-loading">Loading…</Localized>
          </p>
        ) : (
          <div className="resto-payment-cards-list">

            {/* ── 1. Cash Payment Card ────────────────────────────── */}
            <PaymentMethodCard
              id="cash"
              code="cash"
              title={cashDraft?.label || 'Cash'}
              description="Accept physical cash currency with automatic change calculation and drawer kick"
              badge="Core Method"
              badgeVariant="primary"
              icon={<CashIcon />}
              enabled={cashDraft ? cashDraft.is_enabled : true}
              onToggle={(enabled) => handleToggleCode('cash', enabled)}
              isCore={true}
            >
              <div className="settings-field settings-field--horizontal">
                <label htmlFor="cash-custom-label" className="settings-label">
                  Checkout Display Label
                </label>
                <input
                  id="cash-custom-label"
                  type="text"
                  className="settings-input"
                  value={cashCustomLabel}
                  onChange={(e) => setCashCustomLabel(e.target.value)}
                  placeholder="Cash"
                />
              </div>

              <div className="resto-toggle-row">
                <div className="resto-toggle-info">
                  <span className="resto-toggle-title">Open Cash Drawer</span>
                  <span className="resto-toggle-desc">
                    Automatically send RJ11 pulse to kick open the cash drawer when completing cash sale
                  </span>
                </div>
                <span className="settings-toggle">
                  <span className="settings-toggle-switch">
                    <input
                      id="cash-drawer-kick"
                      type="checkbox"
                      role="switch"
                      checked={cashDrawerAutoKick}
                      onChange={(e) => setCashDrawerAutoKick(e.target.checked)}
                      aria-label="Open Cash Drawer"
                    />
                    <span className="settings-toggle-slider" />
                  </span>
                </span>
              </div>

              <div style={{ marginTop: 'var(--space-3)' }}>
                <div className="resto-toggle-title" style={{ marginBottom: '6px' }}>Quick Cash Suggestion Presets</div>
                <div className="resto-payment-chips-row">
                  {['Exact Amount', 'Rp 10.000', 'Rp 20.000', 'Rp 50.000', 'Rp 100.000'].map((preset) => (
                    <span key={preset} className="resto-payment-chip resto-payment-chip--active">
                      {preset}
                    </span>
                  ))}
                </div>
                <p className="settings-hint" style={{ marginTop: '4px' }}>
                  Smart denomination suggestion pills rendered on the POS checkout modal for faster cash handling.
                </p>
              </div>

              <div className="resto-toggle-row" style={{ marginTop: 'var(--space-3)' }}>
                <div className="resto-toggle-info">
                  <span className="resto-toggle-title">Cashier Drawer Verification</span>
                  <span className="resto-toggle-desc">
                    Require cashier to acknowledge physical drawer closure before resetting POS cart
                  </span>
                </div>
                <span className="settings-toggle">
                  <span className="settings-toggle-switch">
                    <input
                      id="cash-drawer-verify"
                      type="checkbox"
                      role="switch"
                      checked={cashDrawerVerify}
                      onChange={(e) => setCashDrawerVerify(e.target.checked)}
                      aria-label="Cashier Drawer Verification"
                    />
                    <span className="settings-toggle-slider" />
                  </span>
                </span>
              </div>
            </PaymentMethodCard>

            {/* ── 2. QRIS Payment Card ────────────────────────────── */}
            <PaymentMethodCard
              id="qris"
              code="qris"
              title={qrisDraft?.label || 'QRIS'}
              description="Universal Indonesian QR payment standard (BCA, GoPay, OVO, Dana, ShopeePay, Mobile Banking)"
              badge="National QR"
              badgeVariant="success"
              icon={<QrisIcon />}
              enabled={qrisDraft ? qrisDraft.is_enabled : true}
              onToggle={(enabled) => handleToggleCode('qris', enabled)}
              isCore={true}
              mountBodyWhenCollapsed={false}
            >
              <div style={{ marginBottom: 'var(--space-3)' }}>
                <div className="resto-toggle-title" style={{ marginBottom: '6px' }}>QR Presentation Mode</div>
                <div className="resto-segmented-group" role="group" aria-label="QR Mode">
                  <button
                    type="button"
                    className={`resto-segmented-btn ${qrisMode === 'static' ? 'resto-segmented-btn--active' : ''}`}
                    onClick={() => setQrisMode('static')}
                  >
                    Static QR (Counter / Sticker)
                  </button>
                  <button
                    type="button"
                    className={`resto-segmented-btn ${qrisMode === 'dynamic' ? 'resto-segmented-btn--active' : ''}`}
                    onClick={() => setQrisMode('dynamic')}
                  >
                    Dynamic QR (POS Generated)
                  </button>
                </div>
              </div>

              <div className="settings-field">
                <label htmlFor="resto-static-qris" className="settings-label">
                  <Localized id="settings-localpay-static-qr-label">Static QR payload (EMVCo string)</Localized>
                </label>
                <div className="restaurant-static-qr-box">
                  <textarea
                    id="resto-static-qris"
                    className="settings-input"
                    rows={3}
                    placeholder="00020101021126580014ID.LINKAJA.WWW0118936009110022201389..."
                    value={staticQrValue}
                    onChange={(e) => handleStaticQrChange(e.target.value)}
                    aria-label="Static QR payload (EMVCo string)"
                    spellCheck={false}
                  />
                  <p className="settings-hint">
                    Paste the merchant QR string (EMVCo format) to enable in-app counter QR presentation.
                  </p>
                </div>
              </div>

              <div className="settings-field settings-field--horizontal" style={{ marginTop: 'var(--space-3)' }}>
                <label htmlFor="qris-nmid" className="settings-label">
                  Merchant NMID
                </label>
                <input
                  id="qris-nmid"
                  type="text"
                  className="settings-input"
                  value={qrisNmid}
                  onChange={(e) => setQrisNmid(e.target.value)}
                  placeholder="ID1020030040050"
                />
              </div>

              <div className="settings-field settings-field--horizontal">
                <label htmlFor="qris-surcharge" className="settings-label">
                  MDR Customer Surcharge (%)
                </label>
                <input
                  id="qris-surcharge"
                  type="text"
                  className="settings-input"
                  value={qrisSurcharge}
                  onChange={(e) => setQrisSurcharge(e.target.value)}
                  placeholder="0.7"
                />
              </div>

              <div className="resto-toggle-row" style={{ marginTop: 'var(--space-2)' }}>
                <div className="resto-toggle-info">
                  <span className="resto-toggle-title">Print Pay-at-Table QR</span>
                  <span className="resto-toggle-desc">
                    Print dynamic payment QR code directly on customer pre-check bill slips
                  </span>
                </div>
                <span className="settings-toggle">
                  <span className="settings-toggle-switch">
                    <input
                      id="qris-print-bill"
                      type="checkbox"
                      role="switch"
                      checked={qrisPrintReceipt}
                      onChange={(e) => setQrisPrintReceipt(e.target.checked)}
                      aria-label="Print Pay-at-Table QR"
                    />
                    <span className="settings-toggle-slider" />
                  </span>
                </span>
              </div>
            </PaymentMethodCard>

            {/* ── 3. EDC Terminal Card ────────────────────────────── */}
            <PaymentMethodCard
              id="card"
              code="card"
              title={cardDraft?.label || 'Card / EDC Terminal'}
              description="Physical card payment terminal for Debit and Credit transactions (Visa, Mastercard, GPN)"
              badge="Hardware Terminal"
              badgeVariant="primary"
              icon={<EdcIcon />}
              enabled={cardDraft ? cardDraft.is_enabled : false}
              onToggle={(enabled) => handleToggleCode('card', enabled)}
              isCore={true}
              mountBodyWhenCollapsed={true}
            >
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

              <div style={{ marginTop: 'var(--space-3)' }}>
                <div className="resto-toggle-title" style={{ marginBottom: '6px' }}>Supported Card Networks</div>
                <div className="resto-payment-chips-row">
                  {[
                    { id: 'gpn', label: 'Debit GPN' },
                    { id: 'visa', label: 'Visa' },
                    { id: 'mastercard', label: 'Mastercard' },
                    { id: 'bca', label: 'BCA Card' },
                    { id: 'jcb', label: 'JCB' },
                    { id: 'amex', label: 'American Express' },
                  ].map((network) => {
                    const active = acceptedCards.includes(network.id);
                    return (
                      <button
                        key={network.id}
                        type="button"
                        className={`resto-payment-chip ${active ? 'resto-payment-chip--active' : ''}`}
                        onClick={() =>
                          setAcceptedCards((prev) =>
                            active ? prev.filter((id) => id !== network.id) : [...prev, network.id],
                          )
                        }
                      >
                        {network.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="resto-toggle-row" style={{ marginTop: 'var(--space-3)' }}>
                <div className="resto-toggle-info">
                  <span className="resto-toggle-title">Require Approval Code</span>
                  <span className="resto-toggle-desc">
                    Prompt cashier to input the 6-digit trace/approval code printed on EDC bank slip
                  </span>
                </div>
                <span className="settings-toggle">
                  <span className="settings-toggle-switch">
                    <input
                      id="edc-require-trace"
                      type="checkbox"
                      role="switch"
                      checked={requireEdcTraceCode}
                      onChange={(e) => setRequireEdcTraceCode(e.target.checked)}
                      aria-label="Require Approval Code"
                    />
                    <span className="settings-toggle-slider" />
                  </span>
                </span>
              </div>
            </PaymentMethodCard>

            {/* ── 4. Midtrans Gateway Card ─────────────────────────── */}
            <PaymentMethodCard
              id="midtrans"
              code="midtrans"
              title={midtransDraft?.label || 'Midtrans Gateway'}
              description="Automated Indonesian payment gateway for QRIS, Virtual Accounts, and E-Wallets with instant webhook verification"
              badge="Cloud Gateway"
              badgeVariant="warning"
              icon={<MidtransIcon />}
              enabled={midtransDraft ? midtransDraft.is_enabled : midtransLocalEnabled}
              onToggle={(enabled) => handleToggleCode('midtrans', enabled)}
              isCore={false}
              onRemove={midtransDraft ? () => handleRemoveCode('midtrans') : undefined}
            >
              <div style={{ marginBottom: 'var(--space-3)' }}>
                <div className="resto-toggle-title" style={{ marginBottom: '6px' }}>Gateway Environment</div>
                <div className="resto-segmented-group" role="group" aria-label="Midtrans Environment">
                  <button
                    type="button"
                    className={`resto-segmented-btn ${midtransEnv === 'sandbox' ? 'resto-segmented-btn--active' : ''}`}
                    onClick={() => setMidtransEnv('sandbox')}
                  >
                    Sandbox (Testing)
                  </button>
                  <button
                    type="button"
                    className={`resto-segmented-btn ${midtransEnv === 'production' ? 'resto-segmented-btn--active' : ''}`}
                    onClick={() => setMidtransEnv('production')}
                  >
                    Production (Live)
                  </button>
                </div>
              </div>

              <div className="settings-field settings-field--horizontal">
                <label htmlFor="midtrans-merchant-id" className="settings-label">
                  Merchant ID
                </label>
                <input
                  id="midtrans-merchant-id"
                  type="text"
                  className="settings-input"
                  value={midtransMerchantId}
                  onChange={(e) => setMidtransMerchantId(e.target.value)}
                  placeholder="G123456789"
                />
              </div>

              <div className="settings-field settings-field--horizontal">
                <label htmlFor="midtrans-client-key" className="settings-label">
                  Client Key
                </label>
                <input
                  id="midtrans-client-key"
                  type="text"
                  className="settings-input"
                  value={midtransClientKey}
                  onChange={(e) => setMidtransClientKey(e.target.value)}
                  placeholder="SB-Mid-client-XXXXX"
                />
              </div>

              <div className="settings-field settings-field--horizontal">
                <label htmlFor="midtrans-server-key" className="settings-label">
                  Server Key
                </label>
                <input
                  id="midtrans-server-key"
                  type="password"
                  className="settings-input"
                  value={midtransServerKey}
                  onChange={(e) => setMidtransServerKey(e.target.value)}
                  placeholder="SB-Mid-server-XXXXX"
                />
              </div>

              <div style={{ marginTop: 'var(--space-3)' }}>
                <div className="resto-toggle-title" style={{ marginBottom: '6px' }}>Active Payment Channels</div>
                <div className="resto-payment-checkbox-grid">
                  {[
                    { key: 'gopay', label: 'GoPay / QRIS' },
                    { key: 'shopeepay', label: 'ShopeePay' },
                    { key: 'bca_va', label: 'BCA Virtual Account' },
                    { key: 'mandiri_va', label: 'Mandiri Bill' },
                    { key: 'bni_va', label: 'BNI Virtual Account' },
                    { key: 'bri_va', label: 'BRI Virtual Account' },
                  ].map((ch) => (
                    <label key={ch.key} className="resto-payment-checkbox-item">
                      <input
                        type="checkbox"
                        checked={Boolean(midtransChannels[ch.key])}
                        onChange={(e) =>
                          setMidtransChannels((prev) => ({ ...prev, [ch.key]: e.target.checked }))
                        }
                      />
                      <span>{ch.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="resto-toggle-row" style={{ marginTop: 'var(--space-3)' }}>
                <div className="resto-toggle-info">
                  <span className="resto-toggle-title">Instant Webhook Auto-Complete</span>
                  <span className="resto-toggle-desc">
                    Automatically complete checkout order as soon as Midtrans webhook HTTP notification succeeds
                  </span>
                </div>
                <span className="settings-toggle">
                  <span className="settings-toggle-switch">
                    <input
                      id="midtrans-auto-confirm"
                      type="checkbox"
                      role="switch"
                      checked={midtransAutoConfirm}
                      onChange={(e) => setMidtransAutoConfirm(e.target.checked)}
                      aria-label="Instant Webhook Auto-Complete"
                    />
                    <span className="settings-toggle-slider" />
                  </span>
                </span>
              </div>

              <div className="settings-actions" style={{ justifyContent: 'flex-start', marginTop: 'var(--space-3)' }}>
                <Button variant="secondary" onClick={() => addToast({ message: 'Midtrans API credentials valid (Sandbox)', type: 'success' })}>
                  Test API Keys
                </Button>
              </div>
            </PaymentMethodCard>

            {/* ── 5. Stripe Processing Card ────────────────────────── */}
            <PaymentMethodCard
              id="stripe"
              code="stripe"
              title={stripeDraft?.label || 'Stripe Processing'}
              description="International credit and debit card processing with support for Stripe Terminal smart card readers"
              badge="Global Provider"
              badgeVariant="default"
              icon={<StripeIcon />}
              enabled={stripeDraft ? stripeDraft.is_enabled : stripeLocalEnabled}
              onToggle={(enabled) => handleToggleCode('stripe', enabled)}
              isCore={false}
              onRemove={stripeDraft ? () => handleRemoveCode('stripe') : undefined}
            >
              <div style={{ marginBottom: 'var(--space-3)' }}>
                <div className="resto-toggle-title" style={{ marginBottom: '6px' }}>Account Mode</div>
                <div className="resto-segmented-group" role="group" aria-label="Stripe Mode">
                  <button
                    type="button"
                    className={`resto-segmented-btn ${stripeMode === 'test' ? 'resto-segmented-btn--active' : ''}`}
                    onClick={() => setStripeMode('test')}
                  >
                    Test Mode
                  </button>
                  <button
                    type="button"
                    className={`resto-segmented-btn ${stripeMode === 'live' ? 'resto-segmented-btn--active' : ''}`}
                    onClick={() => setStripeMode('live')}
                  >
                    Live Mode
                  </button>
                </div>
              </div>

              <div className="settings-field settings-field--horizontal">
                <label htmlFor="stripe-pub-key" className="settings-label">
                  Publishable Key
                </label>
                <input
                  id="stripe-pub-key"
                  type="text"
                  className="settings-input"
                  value={stripePublishableKey}
                  onChange={(e) => setStripePublishableKey(e.target.value)}
                  placeholder="pk_test_51XXXXXXXXXXXXX"
                />
              </div>

              <div className="settings-field settings-field--horizontal">
                <label htmlFor="stripe-sec-key" className="settings-label">
                  Secret Key
                </label>
                <input
                  id="stripe-sec-key"
                  type="password"
                  className="settings-input"
                  value={stripeSecretKey}
                  onChange={(e) => setStripeSecretKey(e.target.value)}
                  placeholder="sk_test_51XXXXXXXXXXXXX"
                />
              </div>

              <div className="settings-field settings-field--horizontal">
                <label htmlFor="stripe-reader" className="settings-label">
                  Card Reader Hardware
                </label>
                <SettingsSelect
                  id="stripe-reader"
                  value={stripeReader}
                  onChange={(v) => setStripeReader(v)}
                  options={[
                    { value: 'wisepos_e', label: 'BBPOS WisePOS E (Countertop Wi-Fi)' },
                    { value: 'reader_s700', label: 'Stripe Reader S700 (Handheld Smart POS)' },
                    { value: 'tap_to_pay', label: 'Tap to Pay on Mobile (NFC)' },
                  ]}
                />
              </div>

              <div className="settings-field settings-field--horizontal">
                <label htmlFor="stripe-currency" className="settings-label">
                  Default Settlement Currency
                </label>
                <SettingsSelect
                  id="stripe-currency"
                  value={stripeCurrency}
                  onChange={(v) => setStripeCurrency(v)}
                  options={[
                    { value: 'IDR', label: 'IDR - Indonesian Rupiah' },
                    { value: 'USD', label: 'USD - United States Dollar' },
                    { value: 'SGD', label: 'SGD - Singapore Dollar' },
                    { value: 'EUR', label: 'EUR - Euro' },
                  ]}
                />
              </div>

              <div className="settings-actions" style={{ justifyContent: 'flex-start', marginTop: 'var(--space-3)' }}>
                <Button variant="secondary" onClick={() => addToast({ message: 'Stripe API connection verified', type: 'success' })}>
                  Verify Stripe Keys
                </Button>
              </div>
            </PaymentMethodCard>

            {/* ── Other Configured Rails (e.g. open_bill, credit, or custom rails like gopay) ── */}
            {otherRails.map((rail) => {
              const railIndex = drafts.indexOf(rail);
              const isCore = isCoreRail(rail.rail_code);
              return (
                <PaymentMethodCard
                  key={rail.rail_code}
                  id={rail.rail_code}
                  code={rail.rail_code}
                  title={rail.label}
                  description={`Configured payment option for ${rail.label}`}
                  badge={isCore ? 'Core Method' : 'Custom Rail'}
                  badgeVariant={isCore ? 'default' : 'warning'}
                  icon={<GenericRailIcon />}
                  enabled={rail.is_enabled}
                  onToggle={(enabled) => handleToggleRail(railIndex, enabled)}
                  isCore={isCore}
                  onRemove={!isCore ? () => handleRemoveRail(railIndex) : undefined}
                  removeAriaLabel={`Remove ${rail.label}`}
                >
                  <p className="settings-hint">
                    Active tender rail ready for cashier checkout and receipt attribution.
                  </p>
                </PaymentMethodCard>
              );
            })}

            {/* ── Add Custom Payment Rail Card ───────────────────── */}
            <div className="resto-payment-card-add-rail">
              <Card
                shadow="sm"
                header={
                  <div className="restaurant-settings-card-header">
                    <div>
                      <h2 className="settings-section-title">
                        <Localized id="restaurant-payment-rails-heading">Add Custom Payment Rail</Localized>
                      </h2>
                      <p>
                        <Localized id="restaurant-payment-rails-sub">
                          Register additional digital payment options and tender codes
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
                      placeholder="e.g. ovo, shopeepay, debit_mandiri"
                      aria-label="New rail code"
                    />
                    <input
                      type="text"
                      className="settings-input"
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      placeholder="e.g. OVO E-Wallet"
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
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

export default RestaurantPaymentsScreen;
